import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createUserMessage, freezeMessage } from '@deepseek-ai/dsh-llm';
import { createHash } from 'node:crypto';
import { SessionSeq } from '@deepseek-ai/dsh-session';
import "../hostContract.js";
import { errorText, Faults } from "../faults.js";
import { keepSelfCopy } from "../self.js";
import { formatLocalTime } from "../timeContext.js";
import { inWorld } from "../sourceArchive.js";
import { homeTitle, roomTitle, worldNames } from "../worldPrompt.js";
import { admit, reassembleOnChange } from "../worldScope.js";
import { budgetText, cancelReply, greetingText, checkReply, earlyStopText, nextLocalTime, nextReview, planReply, resolveAlarmTime, reviewOf, reviewText, wakeText, validClockTime } from "./alarm.js";
import { summarizeSince } from "./activity.js";
import { createAlarmTimer, realTimers } from "./alarmTimer.js";
import { createEarlyStopWatch } from "./earlyStop.js";
import { closedDiaryRefusal } from "./diary.js";
import { createHome, markHomeArrival } from "./home.js";
import { createJournal } from "./journal.js";
import { stepCost } from "./pricing.js";
import { exampleTime, readAlarmMessages } from "./messages.js";
import { createToolRegistry } from "./toolRegistry.js";
import { alarmDescriptions, lifeTools } from "./tools.js";
import { photoTools } from "./photoTools.js";
/** How long a word may sit in her home without its turn starting a step before the console says so. */
const STALL_MINUTES = 5;
// Transport limits and debounce, not a life cadence or a fact-retention policy.
const FACT_BATCH_LIMIT = 16;
const FACT_COALESCE_MS = 400;
const sourceDigest = source => createHash('sha256').update(JSON.stringify(source)).digest('hex');
const withValue = (key, value) => (value === undefined ? {} : { [key]: value });
/**
 * Her life line: one pending alarm, kept in life.json and delivered into her home with `agent.steer`, the
 * tools she sets it with, the home itself, a new home's greeting and the evening look back. The parts live in
 * their own modules; this wires them.
 */
export function createLifeRuntime(deps) {
    const { ctx, config, options, store, host } = deps;
    const { timeZone } = options;
    const names = deps.names ?? worldNames(config);
    const clock = deps.clock ?? (() => new Date());
    const timers = deps.timers ?? realTimers;
    const faults = new Faults();
    const includes = (session) => inWorld(session, config, deps.inWorkspace);
    const disposers = [];
    const state = store.read();
    const refreshState = () => store.refresh?.(state);
    const hasCurrentPlan = () => deps.hasCurrentPlan?.() ?? state.currentPlan != null;
    const requirePlanningDecision = deps.requirePlanningDecision === true;
    const planRevision = () => state.planRevision ?? 0;
    const decisionRevision = () => state.planDecisionRevision ?? 0;
    const currentRecovery = () => state.planningRecovery?.revision === planRevision() ? state.planningRecovery : undefined;
    function clearPlanningRecovery() {
        delete state.planningRecovery;
        faults.clear('planning');
    }
    function prunePlanningRecovery() {
        if (requirePlanningDecision && state.planningRecovery && !currentRecovery()) {
            clearPlanningRecovery();
            store.write(state);
        }
    }
    function planningFault() {
        if (!requirePlanningDecision) return;
        const recovery = currentRecovery();
        if (recovery) faults.set('planning', recovery.message);
        else faults.clear('planning');
    }
    // Alarm delivery and its plan clock are acknowledged in the same Life write.
    function consumePlanClock(alarm) {
        if (alarm.source !== 'plan' || !state.currentPlan || typeof state.currentPlan !== 'object') return;
        if (state.currentPlan.nextConsiderAt === alarm.at)
            state.currentPlan = { ...state.currentPlan, nextConsiderAt: null };
    }
    function restorePlanClock(alarm, revision) {
        if (!hasCurrentPlan()) return requirePlanningDecision ? revision === planRevision() : revision === undefined;
        if (revision === undefined || revision !== planRevision() || !state.currentPlan || typeof state.currentPlan !== 'object') return false;
        if (state.currentPlan.nextConsiderAt && state.currentPlan.nextConsiderAt !== alarm.at) return false;
        state.currentPlan = { ...state.currentPlan, nextConsiderAt: alarm.at };
        return true;
    }
    let stopped = false;
    let delivery;
    let factDiscovery;
    let factNoticeTimer;
    let planningTurn;
    function currentTurn(session, endSeq = session.seq - 1) {
        for (let seq = endSeq; seq >= 0; seq--) {
            const event = session.eventAt(SessionSeq(seq));
            if (event?.type === 'turn/start') return event.data.turn;
        }
    }
    // The owner message may have been admitted before our Life word in the same
    // native turn. Looking only at later events would miss that interruption.
    function ownerAlreadySpoke(session, messageSeq) {
        for (let seq = messageSeq - 1; seq >= 0; seq--) {
            const event = session.eventAt(SessionSeq(seq));
            if (event?.type === 'turn/start') break;
            if (event?.type === 'user/message' && event.data.source.kind === 'user') return true;
        }
        return false;
    }
    function planningReceipt(session, pending, messageSeq) {
        return { sessionId: session.id, turn: currentTurn(session, messageSeq), planRevision: pending.planRevision,
            ownerInterrupted: requirePlanningDecision && ownerAlreadySpoke(session, messageSeq), messageId: pending.messageId, messageSeq,
            ...(requirePlanningDecision ? { decisionRevision: pending.decisionRevision ?? 0 } : {}),
            ...withValue('recoveryMessageId', pending.recoveryMessageId), ...withValue('recoveryAttempts', pending.recoveryAttempts) };
    }
    /** Bookkeeping after the fact: a failure is a fault, never a broken turn. */
    function record(work) {
        try {
            work();
            faults.clear('state');
        }
        catch (error) {
            faults.set('state', `生活状态没能保存：${errorText(error)}`);
            ctx.logger.error(error);
        }
    }
    /** Her alarm wording, read when it is used; an unreadable template is a fault and the shipped one is used. */
    function alarmMessages() {
        const messages = readAlarmMessages(options.alarmFile);
        if (messages.error)
            faults.set('alarm-template', messages.error);
        else
            faults.clear('alarm-template');
        return messages;
    }
    const wake = () => options.schedule().wake;
    const templateValues = () => ({ name: names.companion, partner: names.partner, homeTitle: names.companion ? homeTitle(names) : '伙伴的家', timeZone, fallbackWakeTime: wake(), example: exampleTime(timeZone) });
    /**
     * What she actually did between setting this alarm and hearing it, in one line.
     *
     * Read from the activity log rather than from her own account of the time, so the alarm can contradict
     * her note: "歇着" plus forty tool calls is a different sentence from "歇着" plus none. Both days the
     * alarm could straddle are read, because a plan set at 23:50 and heard at 00:30 has its work split.
     */
    const didSince = (alarm, now) => {
        const dayOf = (at) => formatLocalTime(new Date(at), timeZone).slice(0, 10);
        const days = [...new Set([dayOf(alarm.setAt), dayOf(now)])];
        const records = days.flatMap(each => store.activity(each)).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
        return summarizeSince(records, alarm.setAt, now);
    };
    const lifeMessage = (text) => createUserMessage({ source: { kind: 'dsh-world-life' }, content: [{ type: 'text', text }] });
    const say = (agent, message) => {
        refreshState();
        if (stopped || agent.id !== state.homeSessionId || host.isArchived(agent.id)) throw new Error('生活会话已停止或被替换');
        admit(includes, agent).steer(typeof message === 'string' ? lifeMessage(message) : message);
        return ctx.sessions.flush(agent.session);
    };
    // Delivery is a step that starts with the word, not a steer that did not throw: a turn can take the word out
    // of the inbox and never reach its first step (the host still starting, the app closed), and the word is then
    // lost. The host logs the word as a `user/message` only after its step has started, so that event is the proof.
    /** Whether the word is still queued in her home, to be taken by a coming step. */
    const queued = (agent, id) => [...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => message.id === id);
    let stallTimer;
    function watchStall(pending) {
        if (stallTimer !== undefined)
            timers.clear(stallTimer);
        stallTimer = timers.set(() => {
            stallTimer = undefined;
            if (stopped || state.delivering?.messageId !== pending.messageId)
                return;
            faults.set('stall', `${pending.what}在 ${formatLocalTime(new Date(pending.sentAt), timeZone).slice(11, 16)} 送进了家，${STALL_MINUTES} 分钟了这一轮还没开始`);
        }, Math.max(0, Date.parse(pending.sentAt) + STALL_MINUTES * 60_000 - clock().getTime()));
    }
    function settle() {
        const pending = state.delivering;
        delete state.delivering;
        if (stallTimer !== undefined) {
            timers.clear(stallTimer);
            stallTimer = undefined;
        }
        faults.clear('stall');
        return pending;
    }
    function confirmed() {
        const pending = state.delivering;
        if (!pending)
            return;
        if ('facts' in pending.job) {
            // Commit consumption before acknowledging the domain. If this write
            // fails, the native message remains the reconciliation evidence.
            const previousAck = state.factAcknowledgement, previousAdmission = state.lastFactAdmission, previousBatch = state.factBatch;
            state.factAcknowledgement = pending.job.facts;
            state.lastFactAdmission = {messageId: pending.messageId, sessionId: pending.sessionId,
                sourceDigest: pending.job.facts.sourceDigest};
            delete state.factBatch;
            delete state.delivering;
            try { store.write(state); }
            catch (error) {
                state.delivering = pending;
                if (previousAck) state.factAcknowledgement = previousAck; else delete state.factAcknowledgement;
                if (previousAdmission) state.lastFactAdmission = previousAdmission; else delete state.lastFactAdmission;
                if (previousBatch) state.factBatch = previousBatch; else delete state.factBatch;
                faults.set('delivery', `互动事实已进入原生步骤，确认等待重试：${errorText(error)}`);
                ctx.logger.error(error);
                timer.failed();
                return;
            }
            settle();
            faults.clear('delivery');
            // Never await domain queues from native session persistence callbacks.
            notifyFacts();
            return;
        }
        settle();
        const now = clock();
        faults.clear('delivery');
        record(() => { store.write(state); store.appendWake({ scheduledAt: pending.scheduledAt, deliveredAt: now.toISOString(), source: pending.source, lateMs: Math.max(0, now.getTime() - Date.parse(pending.scheduledAt)) }); });
        // Admitting a planning message does not prove its model turn succeeded.
        // Preserve retry backoff until that native turn completes successfully.
        if (pending.planRevision === undefined) timer.reset();
        else timer.arm();
    }
    /** Back on the schedule: her own alarm unless a plan of hers replaced it meanwhile, otherwise as it was. */
    function neverRan(why) {
        const pending = settle();
        if (!pending)
            return;
        refreshState();
        if (state.reviewWake?.messageId === pending.messageId) delete state.reviewWake;
        if (requirePlanningDecision && pending.planRevision !== undefined && pending.planRevision !== planRevision()) {
            // A new owner decision supersedes even an unstarted greeting or
            // review. It keeps its own alarm and must not be reawakened here.
            record(() => store.write(state));
            timer.arm();
            return;
        }
        const { job } = pending;
        if ('alarm' in job) {
            refreshState();
            if ((!state.alarm || state.alarm.source === 'fallback') && restorePlanClock(job.alarm, pending.planRevision))
                state.alarm = job.alarm;
        }
        else if ('review' in job)
            state.review = job.review;
        else if ('facts' in job)
            state.factBatch = job.facts;
        else
            state.greeting ??= job.greeting;
        record(() => store.write(state));
        faults.set('delivery', `${pending.what}没开始，${timer.failed()} 分钟后重新送：${why}`);
    }
    /**
     * After a restart: the word sent last time is in the log (it ran; counted now), still queued or in a live turn
     * (watched as if just sent), or gone with the turn that took it (sent again).
     */
    async function reconcile(agent) {
        const pending = state.delivering;
        if (!pending)
            return;
        if (pending.sessionId !== agent.id) {
            if ('facts' in pending.job) {
                try {
                    if (!deps.facts || !pending.job.facts.sourceDigest) throw new Error('原互动事实的投递校验信息暂不可用');
                    const admitted = await deps.facts.confirmAdmission(pending.sessionId,pending.messageId,pending.job.facts.sourceDigest);
                    if (stopped) return;
                    refreshState();
                    if (state.delivering?.messageId !== pending.messageId) return;
                    return admitted ? confirmed() : neverRan('原会话持久日志可读，未记录这条互动事实');
                } catch (error) {
                    if (!stopped) {
                        faults.set('facts', `原会话互动事实待核对，尚未重送：${errorText(error)}`);
                        timer.failed();
                    }
                    return;
                }
            }
            return neverRan('家换过了');
        }
        const { session } = agent;
        for (let seq = session.seq - 1; seq >= 0; seq--) {
            const event = session.eventAt(SessionSeq(seq));
            if (event?.type === 'user/message' && event.data.id === pending.messageId) {
                if ((requirePlanningDecision || pending.source === 'plan') && pending.planRevision !== undefined && !state.planningWake)
                    state.planningWake = planningReceipt(session, pending, seq);
                return confirmed();
            }
        }
        if (queued(agent, pending.messageId) || agent.status === 'running')
            return watchStall(pending);
        neverRan('上次那一轮没开始就中断了');
    }
    /** Written before the steer, so a crash right after it still finds the word; unsaved, it is still sent and watched. */
    function expect(agent, message, what, scheduledAt, source, job, now) {
        prunePlanningRecovery();
        const recovery = currentRecovery();
        // Only the alarm projected for this particular failed decision inherits
        // its bounded correction count. An independent event is a new chance.
        const correction = requirePlanningDecision && recovery?.status === 'retrying'
            && 'alarm' in job && job.alarm.source === 'plan' && recovery.retryAt === job.alarm.at;
        const factJob = 'facts' in job;
        const reviewJob = source === 'review' && !!deps.reviewDiaryStatus;
        if (!factJob && requirePlanningDecision && recovery && !correction) clearPlanningRecovery();
        const pending = { messageId: message.id, sessionId: agent.id, sentAt: now.toISOString(), what, scheduledAt, source, job,
            ...(!factJob && !reviewJob && requirePlanningDecision ? { planRevision: planRevision(), decisionRevision: decisionRevision() }
                : source === 'plan' && hasCurrentPlan() ? { planRevision: state.planRevision } : {}),
            ...(correction ? { recoveryMessageId: recovery.messageId, recoveryAttempts: recovery.attempts } : {}) };
        state.delivering = pending;
        if (reviewJob) state.reviewWake = {day:job.review.day,sessionId:agent.id,messageId:message.id};
        // This is an admission record, not optional after-the-fact bookkeeping.
        // A message must not start when its consumption cannot be recovered.
        store.write(state);
        watchStall(pending);
    }
    function nextJob() {
        refreshState();
        if (state.delivering && 'facts' in state.delivering.job)
            return {kind:'fact-reconcile',at:state.delivering.sentAt};
        if (state.factAcknowledgement) return {kind:'fact-ack', at:state.factAcknowledgement.at, facts:state.factAcknowledgement};
        if (state.factBatch) return {kind:'facts', at:state.factBatch.at, facts:state.factBatch};
        // An admitted native turn owns its receipt until the queued decision
        // check settles it. Hiding due work also avoids a zero-delay timer loop.
        if (requirePlanningDecision && state.planningWake) return;
        const { greeting, review, alarm } = state;
        if (state.reviewWake) return;
        const retry = validClockTime(options.schedule().review) && state.pendingReviews?.find(item => item.retryAt);
        if (retry && (!review || Date.parse(retry.retryAt) < Date.parse(review.at))
            && (!alarm || Date.parse(retry.retryAt) <= Date.parse(alarm.at)))
            return {kind:'review',at:retry.retryAt,review:{at:retry.at,day:retry.day}};
        if (greeting)
            return { kind: 'greeting', at: greeting.at, greeting };
        if (review && (!alarm || Date.parse(review.at) <= Date.parse(alarm.at)))
            return { kind: 'review', at: review.at, review };
        return alarm && { kind: 'alarm', at: alarm.at, alarm };
    }
    const timer = createAlarmTimer({ clock, timers, dueAlarm: () => nextJob()?.at, fire: () => void deliver() });
    const morning = (now) => ({ at: nextLocalTime(now, wake(), timeZone).toISOString(), note: '', setAt: now.toISOString(), source: 'fallback' });
    /** A new alarm replaces a failing one, so its backoff and fault go with it. Saved or not, it is armed. */
    function setAlarm(alarm) {
        if (stopped)
            return;
        state.alarm = alarm;
        faults.clear('delivery', 'alarm');
        try {
            store.write(state);
        }
        catch (error) {
            faults.set('alarm', `闹钟没能保存：${errorText(error)}`);
            throw error;
        }
        finally {
            timer.reset();
        }
    }
    /** Nothing pending means resting until the next morning. Unsaved, it still rings while the app keeps running. */
    function fallbackAlarm() {
        refreshState();
        if ((requirePlanningDecision && (state.planningWake || state.delivering))
            || state.alarm || state.greeting || stopped || hasCurrentPlan() || !validClockTime(wake()))
            return;
        try {
            setAlarm(morning(clock()));
        }
        catch (error) {
            faults.set('alarm', `断线保护闹钟没能保存：${errorText(error)}`);
            ctx.logger.error(error);
        }
    }
    function planNext(input, note, validate) {
        const change = () => {
            validate?.();
            if (stopped)
                throw new Error('生活线已停止');
            const now = clock();
            const at = resolveAlarmTime(input, now, timeZone);
            refreshState();
            const replaced = state.alarm;
            if ((hasCurrentPlan() || requirePlanningDecision) && deps.setNextConsideration) {
                deps.setNextConsideration(at.toISOString(), note.trim(), 'schedule');
                reschedulePlan();
            } else if (hasCurrentPlan()) throw new Error('当前生活计划没有可用的时间更新接口');
            else setAlarm({ at: at.toISOString(), note: note.trim(), setAt: now.toISOString(), source: 'plan' });
            return planReply(at, replaced, timeZone);
        };
        // The owner queue also covers awaited body changes. Do not reserve a
        // revision here and then write outside that queue when the tool runs.
        return deps.serializePlanChange ? deps.serializePlanChange(change) : change();
    }
    const checkAlarm = () => { refreshState(); return checkReply(state.alarm, clock(), timeZone); };
    /** Back to the morning fallback, exactly as if she had set nothing. */
    function cancelAlarm(validate) {
        const change = () => {
            validate?.();
            if (stopped)
                throw new Error('生活线已停止');
            refreshState();
            const cancelled = state.alarm;
            if ((hasCurrentPlan() || requirePlanningDecision) && deps.setNextConsideration) {
                deps.setNextConsideration(undefined, '', 'cancel');
                reschedulePlan();
            } else if (hasCurrentPlan()) throw new Error('当前生活计划没有可用的时间更新接口');
            else if (!requirePlanningDecision && cancelled?.source === 'plan' && validClockTime(wake()))
                setAlarm(morning(clock()));
            else if (cancelled?.source === 'plan') {
                delete state.alarm;
                store.write(state);
                timer.reset();
            } else
                fallbackAlarm();
            return cancelReply(cancelled, state.alarm, timeZone);
        };
        return deps.serializePlanChange ? deps.serializePlanChange(change) : change();
    }
    /**
     * Moves what is pending to the console's review and morning times when they differ (changed now, or while her
     * world was stopped). The pending look back keeps its day; the plugin's morning alarm moves to the new time after
     * it was set, at once if that has passed. An alarm of hers is left alone. True when anything moved.
     */
    function followSchedule() {
        refreshState();
        const now = clock(), { review, wake: morningTime } = options.schedule();
        const timeOf = (at) => formatLocalTime(new Date(at), timeZone).slice(11, 16);
        let moved = false;
        if (!state.review && validClockTime(review)) {
            state.review = nextReview(now, timeZone, review);
            moved = true;
        } else if (state.review && !validClockTime(review)) {
            delete state.review;
            moved = true;
        } else if (state.review && timeOf(state.review.at) !== review) {
            state.review = reviewOf(state.review.day, now, timeZone, review);
            moved = true;
        }
        if (state.alarm?.source === 'fallback' && (!validClockTime(morningTime) || hasCurrentPlan())) {
            delete state.alarm;
            moved = true;
        } else if (state.alarm?.source === 'fallback' && timeOf(state.alarm.at) !== morningTime) {
            const at = nextLocalTime(new Date(state.alarm.setAt), morningTime, timeZone);
            state.alarm = { ...state.alarm, at: (at > now ? at : now).toISOString() };
            moved = true;
        }
        return moved;
    }
    function reschedule() {
        if (stopped) return;
        if (followSchedule()) record(() => store.write(state));
        fallbackAlarm();
        timer.reset();
    }
    /** The plan owner has already committed its alarm projection. */
    function reschedulePlan() {
        if (stopped) return;
        refreshState();
        prunePlanningRecovery();
        planningFault();
        timer.reset();
    }
    // Delivery: one at a time, the next only once the last started a step; a failure backs off, and a newer alarm keeps its own time.
    function deliver() {
        const job = nextJob();
        if (stopped || !job || state.delivering && job.kind !== 'fact-reconcile')
            return delivery ?? Promise.resolve();
        return delivery ??= (job.kind === 'fact-reconcile' ? home.open().then(agent => { if (!stopped) return reconcile(agent); }).catch(error => { faults.set('facts',errorText(error));timer.failed(); })
            : job.kind === 'fact-ack' ? acknowledgeFacts(job.facts) : job.kind === 'facts' ? sendFacts(job.facts)
            : job.kind === 'alarm' ? send(job.alarm) : job.kind === 'review' ? lookBack(job.review) : greet(job.greeting)).finally(() => { delivery = undefined; });
    }
    /** A native step acknowledgement is separate from understanding or replying. */
    async function acknowledgeFacts(batch) {
        try {
            if (!deps.facts) throw new Error('互动事实所属组件暂不可用');
            refreshState();
            const admission = state.lastFactAdmission;
            if (!admission || admission.messageId !== batch.messageId || admission.sourceDigest !== batch.sourceDigest)
                throw new Error('原互动事实的原生步骤凭据暂不匹配');
            if (!await deps.facts.confirmAdmission(admission.sessionId,admission.messageId,admission.sourceDigest))
                throw new Error('原互动事实尚无匹配的持久原生输入');
            if (stopped) return;
            await deps.facts.acknowledge(batch.refs);
            if (stopped) return;
            refreshState();
            if (state.factAcknowledgement?.messageId !== batch.messageId) return;
            delete state.factAcknowledgement;
            try { store.write(state); }
            catch (error) { state.factAcknowledgement = batch; throw error; }
            faults.clear('facts');
            timer.reset();
            notifyFacts();
        } catch (error) {
            if (stopped) return;
            faults.set('facts', `互动事实确认待恢复：${errorText(error)}`);
            timer.failed();
        }
    }
    async function discoverFacts() {
        if (stopped || !deps.facts) return;
        refreshState();
        if (state.factAcknowledgement || state.factBatch || state.delivering) { timer.arm(); return; }
        const refs = (await deps.facts.pending()).slice(0, FACT_BATCH_LIMIT);
        if (stopped || !refs.length) return;
        refreshState();
        if (state.factAcknowledgement || state.factBatch || state.delivering) { timer.arm(); return; }
        const batch = {at:clock().toISOString(), messageId:lifeMessage('').id, refs};
        state.factBatch = batch;
        try { store.write(state); }
        catch (error) { delete state.factBatch; throw error; }
        timer.arm();
    }
    function notifyFacts() {
        if (stopped || !deps.facts || factNoticeTimer !== undefined) return;
        factNoticeTimer = timers.set(() => {
            factNoticeTimer = undefined;
            factDiscovery ??= discoverFacts().catch(error => {
                faults.set('facts', `互动事实尚未投递：${errorText(error)}`);
                ctx.logger.error(error);
            }).finally(() => { factDiscovery = undefined; });
        }, FACT_COALESCE_MS);
    }
    function acceptsFactMessage(sessionId, message) {
        refreshState();
        if (stopped || sessionId !== state.homeSessionId || !message.source || typeof message.source !== 'object') return false;
        const digest = sourceDigest(message.source);
        const pending = state.delivering;
        if (pending?.sessionId === sessionId && pending.messageId === message.id && 'facts' in pending.job)
            return pending.job.facts.sourceDigest === digest;
        const admitted = state.lastFactAdmission;
        return admitted?.sessionId === sessionId && admitted.messageId === message.id && admitted.sourceDigest === digest;
    }
    async function sendFacts(batch) {
        let agent;
        try {
            if (!deps.facts) throw new Error('互动事实所属组件暂不可用');
            agent = await home.open();
            if (stopped) return;
            refreshState();
            if (state.factBatch?.messageId !== batch.messageId || state.delivering) return;
            const material = await deps.facts.read(batch.refs);
            if (stopped || host.isArchived(agent.id) || !includes(agent.session)) return;
            refreshState();
            if (state.factBatch?.messageId !== batch.messageId || state.delivering) return;
            const source = {kind:'dsh-world-life',facts:material.facts};
            const message = freezeMessage({...createUserMessage({source,content:[{type:'text',text:material.text}]}),id:batch.messageId});
            batch.sourceDigest = sourceDigest(source);
            expect(agent, message, '互动事实', batch.at, 'facts', {facts:batch}, clock());
            await say(agent, message);
            if (!stopped) faults.clear('facts');
        } catch (error) {
            if (stopped) return;
            // The pending native message may already be queued or admitted.
            // Retain it; never re-steer based only on a failed flush.
            refreshState();
            const pending = state.delivering?.messageId === batch.messageId;
            if (pending && agent) await reconcile(agent);
            faults.set('facts', `互动事实投递待恢复：${errorText(error)}`);
            // neverRan already advances the native backoff; confirmed schedules
            // only domain acknowledgement. Do not count either outcome twice.
            if (!pending || state.delivering?.messageId === batch.messageId) timer.failed();
        }
        if (!stopped) timer.arm();
    }
    /**
     * A message of the plugin's own, taken off the schedule while it is sent and put back if it fails: it backs
     * off like an alarm, and its turn is never asked about as an early stop. It counts once its turn starts a step.
     */
    async function sayOwn(what, source, scheduledAt, job, take, putBack, text, delivered) {
        let messageId;
        let baselineRevision;
        try {
            const agent = await home.open();
            if (stopped)
                return;
            take();
            const now = clock();
            const message = createUserMessage({source:{kind:'dsh-world-life',purpose:source,
                ...('review' in job ? {reviewDay:job.review.day} : {})},content:[{type:'text',text:text(now)}]});
            expect(agent, message, what, scheduledAt, source, job, now);
            messageId = message.id;
            baselineRevision = state.delivering?.planRevision;
            earlyStop.startsOwnTurn();
            await say(agent, message);
            if (!stopped)
                delivered?.();
        }
        catch (error) {
            ctx.logger.error(error);
            if (stopped)
                return;
            refreshState();
            // Flush may fail after the native message was already admitted, or
            // after a newer owner decision. Neither permits replaying this word.
            if (requirePlanningDecision && messageId && (state.delivering?.messageId !== messageId || baselineRevision !== planRevision())) {
                if (state.delivering?.messageId === messageId) settle();
                record(() => store.write(state));
                faults.set('delivery', `${what}的投递确认失败：${errorText(error)}`);
                timer.arm();
                return;
            }
            earlyStop.ownTurnFailed();
            settle();
            putBack();
            record(() => store.write(state));
            faults.set('delivery', `${what}没送到，${timer.failed()} 分钟后重试：${errorText(error)}`);
            return;
        }
        if (stopped)
            return;
        faults.clear('home');
        timer.arm();
    }
    /**
     * A new home's first words, so it has a turn (the host lists no session without one) and she knows she moved;
     * or the word that her world has started again.
     */
    const greet = (greeting) => sayOwn(greeting.kind === 'arrival' ? '新家的第一句话' : '重新开始的那句话', greeting.kind === 'arrival' ? 'first' : 'return', greeting.at, { greeting }, () => { delete state.greeting; }, () => { state.greeting ??= greeting; }, () => greetingText(greeting.kind, timeZone, wake(), alarmMessages(), templateValues()));
    /** The day whose look back her home is in now: its diary stays open until that turn ends, even past midnight. */
    let reviewing;
    /** A day's diary is open until its look back has ended: today, and a day whose look back is still to come or under way. */
    function openDiaryDays(today) {
        const days = new Set([today]);
        if (state.review && state.review.day < today)
            days.add(state.review.day);
        if (reviewing)
            days.add(reviewing);
        if (state.reviewWake) days.add(state.reviewWake.day);
        return days;
    }
    /** The evening look back on her day; her 我是谁 is kept as it was, so she can rewrite it freely. */
    function reviewStatus(day, session, messageId) {
        try { return deps.reviewDiaryStatus?.(day,session,messageId) ?? 'missing'; }
        catch (error) { faults.set('review', `日记写入待核对：${errorText(error)}`); return 'unknown'; }
    }
    function finishOwnerBackfills(session, event) {
        if (!deps.reviewDiaryStatus || !state.pendingReviews?.length || state.reviewWake) return;
        const events = session.snapshotEvents();
        const start = events.findLastIndex(item => item.type === 'turn/start' && item.data.turn === event.data.turn);
        if (start < 0) return;
        const input = events.slice(start).find(item => item.type === 'user/message' && item.data.source.kind === 'user');
        if (!input) return;
        const completed = state.pendingReviews.filter(item => reviewStatus(item.day,session,input.data.id) === 'written');
        if (!completed.length) return;
        const days = new Set(completed.map(item => item.day));
        state.pendingReviews = state.pendingReviews.filter(item => !days.has(item.day));
        store.write(state);
        if (!state.pendingReviews.length) faults.clear('review');
    }
    function finishReview(session, reason) {
        const wake = state.reviewWake;
        if (!wake || wake.sessionId !== session.id) return;
        const events = session.snapshotEvents(), input = events.findIndex(event => event.type === 'user/message' && event.data.id === wake.messageId);
        if (input < 0) {
            if (reason === 'aborted') {
                delete state.reviewWake;
                const item = state.pendingReviews?.find(item => item.day === wake.day);
                if (item) { delete item.retryAt; item.failure = `日记 ${item.day} 未核实投递；保留补写任务`; }
                store.write(state);
            }
            return;
        }
        const turn = events.slice(0,input).reverse().find(event => event.type === 'turn/start')?.data.turn;
        const end = events.slice(input).find(event => event.type === 'turn/end' && event.data.turn === turn);
        if (!end && reason !== 'aborted') return;
        const item = state.pendingReviews?.find(item => item.day === wake.day);
        if (!item) { delete state.reviewWake; store.write(state); return; }
        const status = reviewStatus(wake.day,session,wake.messageId);
        if (status === 'unknown') {
            delete state.reviewWake;
            delete item.retryAt;
            item.failure = `日记 ${item.day} 的写入结果无法核对；保留任务，等待后续回顾`;
            store.write(state);
            faults.set('review',item.failure);
            timer.arm();
            return;
        }
        delete state.reviewWake;
        if (status === 'written' || status === 'existing') {
            state.pendingReviews = state.pendingReviews.filter(value => value.day !== wake.day);
            if (state.pendingReviews[0]) state.pendingReviews[0].retryAt = new Date(clock().getTime()+60_000).toISOString();
            faults.clear('review');
            store.write(state);
            deps.afterReview?.();
        } else {
            const why = wake.ownerInterrupted ? 'owner-interrupted' : reason ?? end?.data.reason.kind ?? 'interrupted';
            item.failure = `日记 ${item.day} 尚无成功写入回执（${why}）；保留补写任务`;
            const maximum = deps.planningRepairAttempts?.() ?? 1;
            // A technical retry is bounded. Owner/native cancellation waits for
            // a later scheduled review instead of reviving the cancelled turn.
            if (!['aborted','forked','owner-interrupted'].includes(why) && (item.attempts ?? 0) < maximum) {
                item.attempts = (item.attempts ?? 0) + 1;
                item.retryAt = new Date(clock().getTime()+60_000).toISOString();
            } else delete item.retryAt;
            store.write(state);
            faults.set('review',item.failure);
        }
        timer.arm();
    }
    function lookBack(review) {
        let snapshot;
        if (deps.reviewDiaryStatus) {
            state.pendingReviews ??= [];
            if (!state.pendingReviews.some(item => item.day === review.day))
                state.pendingReviews.push({...review,attempts:0});
            // A new daily opportunity also carries older unfinished dates.
            // Each exact day is dispatched separately, with its own file scope.
            review = state.pendingReviews[0];
            delete review.retryAt;
        }
        const take = () => {
            reviewing = review.day;
            try {
                snapshot = keepSelfCopy(options.selfFile, review.day);
                faults.clear('snapshot');
            } catch (error) { faults.set('snapshot', `我是谁没能留底：${errorText(error)}`); ctx.logger.error(error); }
            if (validClockTime(options.schedule().review)) {
                const next = nextReview(clock(), timeZone, options.schedule().review);
                // Retrying an older date must not consume tomorrow's review.
                if (!state.review || Date.parse(state.review.at) <= clock().getTime()) state.review = next;
            } else delete state.review;
        };
        const existing = (dir) => { const file = join(options.worldDir, dir, `${review.day}.jsonl`); return existsSync(file) ? file : undefined; };
        return sayOwn('每日回顾', 'review', review.at, { review }, take, () => { state.review = review; }, now => reviewText(review, now, {
            ...withValue('conversations', existing('conversations')), ...withValue('activity', existing('activity')), ...withValue('snapshot', snapshot),
            diaryDir: options.diaryDir, selfFile: options.selfFile,
        }, timeZone, wake(), alarmMessages(), templateValues()), deps.reviewDiaryStatus ? undefined : () => deps.afterReview?.());
    }
    async function send(alarm) {
        let planRevision;
        let messageId;
        try {
            // Resolve (or rebuild) the home first: a rebuilt home must still see this alarm as pending.
            const agent = await home.open();
            refreshState();
            if (stopped)
                return;
            if (state.alarm !== alarm) {
                timer.arm();
                return;
            }
            // Cleared before steering, so a turn that ends quickly already sees "no alarm" and gets the fallback.
            delete state.alarm;
            planRevision = requirePlanningDecision ? state.planRevision ?? 0 : hasCurrentPlan() ? state.planRevision : undefined;
            consumePlanClock(alarm);
            const now = clock();
            const text = wakeText(alarm, now, timeZone, wake(), alarmMessages(), { ...templateValues(), did: alarm.source === 'fallback' ? '' : didSince(alarm, now) });
            const context = deps.alarmContext?.(now);
            const message = lifeMessage(context ? `${text}\n\n${context}` : text);
            expect(agent, message, '闹钟', alarm.at, alarm.source, { alarm }, now);
            messageId = message.id;
            await say(agent, message);
        }
        catch (error) {
            ctx.logger.error(error);
            if (stopped)
                return;
            refreshState();
            if (requirePlanningDecision && messageId && state.delivering?.messageId !== messageId) {
                faults.set('delivery', `闹钟的投递确认失败：${errorText(error)}`);
                timer.arm();
                return;
            }
            settle();
            if (state.alarm && state.alarm !== alarm) {
                record(() => store.write(state));
                faults.set('delivery', `闹钟送达失败：${errorText(error)}`);
                timer.arm();
                return;
            }
            if (!restorePlanClock(alarm, planRevision)) {
                record(() => store.write(state));
                timer.arm();
                return;
            }
            state.alarm = alarm;
            record(() => store.write(state));
            faults.set('delivery', `闹钟送达失败，${timer.failed()} 分钟后重试：${errorText(error)}`);
            return;
        }
        if (stopped)
            return;
        // Steered and durable; it counts as delivered once her home starts a step with it (see `confirmed`).
        faults.clear('home');
        timer.arm();
    }
    // Stopping early: asked once per alarm whether she is done.
    const earlyStop = createEarlyStopWatch();
    function askIfDoneEarly(completed) {
        refreshState();
        if (requirePlanningDecision || hasCurrentPlan()) return;
        const now = clock();
        const alarm = state.alarm;
        if (!earlyStop.turnEnded(completed, alarm, now) || stopped)
            return;
        alarm.nudged = true;
        record(() => store.write(state));
        earlyStop.startsOwnTurn();
        const text = earlyStopText(alarm, now, timeZone, alarmMessages(), templateValues());
        void home.open().then(agent => stopped ? undefined : say(agent, text)).catch(error => { earlyStop.ownTurnFailed(); ctx.logger.error(error); });
    }
    function retryFailedPlanning(session, event) {
        const turn = planningTurn;
        if (!turn || turn.sessionId !== session.id || turn.turn !== event.data.turn) return;
        const change = () => {
            // A replacement wake may have started while this callback waited
            // behind an owner operation. It owns its own receipt and retry.
            if (stopped || planningTurn !== turn) return;
            refreshState();
            const wake = state.planningWake;
            if (!wake || wake.messageId !== turn.messageId || wake.sessionId !== turn.sessionId
                || wake.turn !== turn.turn || wake.planRevision !== turn.planRevision
                || wake.decisionRevision !== turn.decisionRevision) return;
            if (requirePlanningDecision) {
                settlePlanningDecision(turn, event.data.reason.kind);
                return;
            }
            const forgetPlanning = (reset = true) => {
                delete state.planningWake; store.write(state); planningTurn = undefined;
                if (reset) timer.reset();
            };
            if (turn.ownerInterrupted || wake.ownerInterrupted || !['error', 'blocked', 'max-tokens'].includes(event.data.reason.kind) || !deps.onPlanningFailure) {
                forgetPlanning(); return;
            }
            const plan = state.currentPlan;
            if (!hasCurrentPlan() || !plan || typeof plan !== 'object' || !['active', 'waiting'].includes(plan.status)
                || turn.planRevision !== state.planRevision || plan.nextConsiderAt || state.alarm || stopped) {
                forgetPlanning(); return;
            }
            const minutes = timer.failed();
            const at = new Date(clock().getTime() + minutes * 60_000).toISOString();
            deps.onPlanningFailure(at, event.data.reason.kind);
            refreshState();
            forgetPlanning(false);
            faults.set('planning', `自主规划未完成，已保留生活进度，将在 ${minutes} 分钟后重试`);
            timer.arm();
        };
        const failed = (error) => {
            faults.set(requirePlanningDecision ? 'planning-save' : 'planning', `自主规划重试时间没能保存：${errorText(error)}`);
            ctx.logger.error(error);
        };
        try {
            if (deps.serializePlanChange) {
                // Do not await from the native session event/flush path: Life
                // startup/shutdown can already hold the same owner queue.
                void deps.serializePlanChange(change).catch(failed);
            } else change();
        } catch (error) {
            failed(error);
        }
    }
    /** Runs only within the plan owner's queue, never awaited by native events. */
    function settlePlanningDecision(turn, reason) {
        const finish = () => {
            delete state.planningWake;
            store.write(state);
            faults.clear('planning-save');
            if (planningTurn === turn) planningTurn = undefined;
            planningFault();
            fallbackAlarm();
            timer.arm();
        };
        // A real plan decision or an owner's words supersedes this receipt.
        // Native alarm edits alone change timing, not the durable decision.
        if (turn.ownerInterrupted || state.planningWake.ownerInterrupted || (turn.decisionRevision ?? 0) !== decisionRevision()) {
            if (state.planningRecovery?.revision === turn.planRevision) clearPlanningRecovery();
            finish();
            return;
        }
        if (turn.planRevision !== planRevision()) {
            state.planningRecovery = { revision: planRevision(), attempts: 0, status: 'waiting', reason: 'missing-decision',
                message: '本轮自主考虑未保存生活决策，保留更新后的安排，等待下一次机会', messageId: turn.messageId };
            finish();
            return;
        }
        const recovery = currentRecovery();
        // Saving a correction budget precedes the host's alarm projection. A
        // crash between those writes resumes that same projection, never a new
        // correction allowance or another model message.
        const projectRecovery = (prepared) => {
            deps.onPlanningFailure(prepared.retryAt, prepared.reason);
            refreshState();
            state.planningRecovery = { ...prepared, revision: planRevision() };
            if (state.alarm?.at !== prepared.retryAt) {
                state.planningRecovery.status = 'waiting';
                state.planningRecovery.message = prepared.reason === 'missing-decision'
                    ? '自主规划未保存生活决策，等待新的主人指示或生活事件'
                    : `自主规划未完成（${prepared.reason}），等待新的主人指示或生活事件`;
                delete state.planningRecovery.retryAt;
            }
            finish();
        };
        if (recovery?.messageId === turn.messageId) {
            if (recovery.status === 'retrying' && recovery.retryAt && !state.alarm && !state.currentPlan?.nextConsiderAt && deps.onPlanningFailure)
                projectRecovery(recovery);
            else {
                if (recovery.status === 'retrying' && state.alarm && state.alarm.at !== recovery.retryAt) {
                    state.planningRecovery = { ...recovery, status: 'waiting', message: '自主规划未完成，保留已有安排，等待下一次机会' };
                    delete state.planningRecovery.retryAt;
                }
                finish();
            }
            return;
        }
        const attempts = recovery && recovery.messageId === turn.recoveryMessageId
            && recovery.attempts === turn.recoveryAttempts ? recovery.attempts : 0;
        const missing = reason === 'completed';
        const failure = missing ? 'missing-decision' : reason;
        const saveRecovery = (status, message, used = attempts, retryAt) => {
            state.planningRecovery = { revision: planRevision(), attempts: used, status, reason: failure,
                message, messageId: turn.messageId, ...withValue('retryAt', retryAt) };
            finish();
        };
        // Explicit native stop/fork is not permission to revive the owner's
        // stopped turn. Remember it so an app restart cannot bootstrap it.
        if (reason === 'aborted' || reason === 'forked') {
            saveRecovery('waiting', '自主规划已停止，等待新的主人指示或生活事件');
            return;
        }
        const maximum = deps.planningRepairAttempts?.() ?? 1;
        if (missing && attempts >= maximum) {
            saveRecovery('waiting', `自主规划未保存生活决策，${attempts} 次自动补救机会已用完，等待新的主人指示或生活事件`);
            return;
        }
        // plan_next without a durable plan remains a missing decision, but its
        // alarm is an existing opportunity and must not be overwritten.
        if (state.alarm || state.greeting || state.delivering || state.currentPlan?.nextConsiderAt) {
            saveRecovery('waiting', missing ? '自主规划未保存生活决策，保留已有安排，等待下一次机会'
                : `自主规划未完成（${reason}），保留已有安排，等待下一次机会`);
            return;
        }
        if (!deps.onPlanningFailure) {
            saveRecovery('waiting', missing ? '自主规划未保存生活决策，等待新的主人指示或生活事件'
                : `自主规划未完成（${reason}），等待新的主人指示或生活事件`);
            return;
        }
        const minutes = timer.failed();
        const at = new Date(clock().getTime() + minutes * 60_000).toISOString();
        const prepared = { revision: planRevision(), attempts: attempts + (missing ? 1 : 0), status: 'retrying', reason: failure,
            message: missing ? `自主规划未保存生活决策，将在 ${minutes} 分钟后尝试补救`
                : `自主规划未完成（${reason}），已保留生活进度，将在 ${minutes} 分钟后重试`, messageId: turn.messageId, retryAt: at };
        state.planningRecovery = prepared;
        store.write(state);
        projectRecovery(prepared);
    }
    function reconcilePlanning(agent) {
        refreshState();
        const wake = state.planningWake;
        if (!wake) return;
        planningTurn = wake;
        if (wake.sessionId !== agent.id) {
            retryFailedPlanning({id:wake.sessionId}, {data:{turn:wake.turn,reason:{kind:requirePlanningDecision ? 'interrupted' : 'error'}}});
            return;
        }
        let ended;
        let turn = wake.turn;
        for (let seq = wake.messageSeq + 1; seq < agent.session.seq; seq++) {
            const event = agent.session.eventAt(SessionSeq(seq));
            if (event?.type === 'turn/start') turn = event.data.turn;
            if (event?.type === 'turn/end' && event.data.turn === wake.turn) ended = event;
            if (event?.type === 'user/message' && event.data.source.kind === 'user' && (requirePlanningDecision || turn === wake.turn)) wake.ownerInterrupted = true;
        }
        if (ended) retryFailedPlanning(agent.session, ended);
        else if (agent.status !== 'running' || (requirePlanningDecision && currentTurn(agent.session) !== wake.turn))
            retryFailedPlanning(agent.session, {data:{turn:wake.turn,reason:{kind:requirePlanningDecision ? 'interrupted' : 'error'}}});
    }
    // What her home spends: each model step priced as it lands; past the daily budget she is told once that day.
    function spent(sessionId, usage, model) {
        const now = clock();
        const day = formatLocalTime(now, timeZone).slice(0, 10);
        const amount = deps.spentToday?.(sessionId, day);
        if (amount && 'unavailable' in amount)
            return;
        const spend = state.spend?.day === day ? state.spend : (state.spend = { day, yuan: 0 });
        if (amount)
            spend.yuan = amount.yuan;
        else
            spend.yuan += stepCost(usage, model, now);
        const budget = deps.dailyBudget?.();
        const remind = budget !== undefined && spend.yuan >= budget && !spend.reminded;
        if (remind)
            spend.reminded = true;
        record(() => store.write(state));
        if (!remind)
            return;
        const text = budgetText(spend.yuan, budget, alarmMessages(), templateValues());
        void home.open().then(agent => {
            if (stopped)
                return;
            // Into the running turn at its next step, or a turn of its own that is not asked about.
            if (agent.status !== 'running')
                earlyStop.startsOwnTurn();
            return say(agent, text);
        }).catch(error => { earlyStop.ownTurnFailed(); ctx.logger.error(error); });
    }
    // Her tools and her home.
    const notifier = {
        ...(deps.notifier.toast ? { toast: (title, body) => faults.track('toast', '系统通知没送到', () => deps.notifier.toast(title, body)) } : {}),
        outlets: deps.notifier.outlets.map(outlet => ({ ...outlet, send: push => faults.track(`outlet:${outlet.name}`, `${outlet.name}没送到`, () => outlet.send(push)) })),
    };
    const tools = createToolRegistry({
        faults, logger: ctx.logger,
        inWorld: agent => !stopped && includes(agent.session),
        isHome: agent => agent.id === state.homeSessionId,
        guard: ({ name, arguments: args, agent }) => {
            refreshState();
            const today = formatLocalTime(clock(), timeZone).slice(0, 10);
            const backfill = new Set(deps.reviewDiaryStatus ? state.pendingReviews?.map(item => item.day) : []);
            return closedDiaryRefusal(name, args, options.diaryDir, agent?.session.header.cwd ?? options.roomDir, openDiaryDays(today), today, backfill);
        },
        tools: agent => [
            ...lifeTools({
                planNext: (input, note, validate) => planNext(input, note, () => {
                    admit(includes, agent);
                    if (host.isArchived(agent.id)) throw new Error('对话已归档，未修改生活计划');
                    validate?.();
                }),
                checkAlarm,
                cancelAlarm: validate => cancelAlarm(() => {
                    admit(includes, agent);
                    if (host.isArchived(agent.id)) throw new Error('对话已归档，未修改生活计划');
                    validate?.();
                }),
                notifier, names, origin: () => { try {
                    return host.origin();
                }
                catch {
                    return undefined;
                } }, descriptions: alarmDescriptions(alarmMessages(), templateValues()) }),
            ...deps.photos ? photoTools({ agent, store: deps.photos, attachments: () => ctx.get('attachments'), inside: () => !stopped && agent.id === state.homeSessionId && includes(agent.session) }) : [],
        ],
    });
    const attach = (agent) => !stopped && includes(agent.session) ? tools.attach(agent) : tools.detach(agent);
    const home = createHome({
        host, roomDir: options.roomDir, agentPreset: config.agentPreset,
        get title() { return names.companion ? homeTitle(names) : '伙伴的家'; }, get roomTitle() { return names.companion ? roomTitle(names) : '伙伴的房间'; }, faults, logger: ctx.logger,
        current: () => { refreshState(); return state.homeSessionId; },
        // A new home greets her at once (the pending alarm moves in too and rings at its own time).
        moveIn(sessionId) {
            markHomeArrival(state, sessionId, clock().toISOString());
            tools.releaseOldHomes();
            store.write(state);
        },
        opened: attach,
        inWorld: includes,
        stopped: () => stopped,
    });
    const journal = createJournal({ store, faults, roomDir: options.roomDir, logger: ctx.logger });
    /** `resumed`: started again from the console; unless an alarm of her own is pending, she is told she is back. */
    async function start(options = {}) {
        disposers.push(ctx.on('agent/created', ({ agent }) => { attach(agent); return undefined; }), reassembleOnChange(ctx, attach), ctx.on('agent/pre-step', ({ agent }, next) => { attach(agent); return next(); }, { prepend: true }), ctx.on('agent/disposed', ({ agent }) => tools.forget(agent)), ctx.on('agent/inbox/inserted', ({ agent, message: inserted }) => {
            attach(agent);
            // Her partner's words reach her at the next step, like being called while busy.
            if (!includes(agent.session) || agent.id !== state.homeSessionId || inserted.source.kind !== 'user' || agent.status !== 'running')
                return;
            if (!agent.inbox.nextTurn.some(queued => queued.id === inserted.id))
                return;
            agent.inbox.remove(inserted.id);
            agent.steer(inserted);
        }), ctx.on('session/event', (session, event) => {
            if (!includes(session))
                return;
            refreshState();
            journal.world(session, event);
            if (event.type === 'turn/end') finishOwnerBackfills(session,event);
            if (session.id !== state.homeSessionId)
                return;
            journal.home(session, event);
            if (event.type === 'assistant/message' && event.data.usage)
                spent(session.id, event.data.usage, event.data.message.source.model);
            if (event.type === 'user/message' && event.data.source.kind === 'user') {
                earlyStop.partnerSpoke();
                if (state.reviewWake) { state.reviewWake.ownerInterrupted = true; store.write(state); }
                if (requirePlanningDecision && state.planningRecovery) {
                    clearPlanningRecovery();
                    store.write(state);
                }
            }
            // Before the fallback below, so a word whose turn never ran goes back first.
            const pending = state.delivering;
            if (event.type === 'user/message') {
                const turn = currentTurn(session);
                if (event.data.source.kind === 'user' && planningTurn?.sessionId === session.id && (requirePlanningDecision || planningTurn.turn === turn)) {
                    planningTurn.ownerInterrupted = true;
                    if (state.planningWake?.messageId === planningTurn.messageId) {state.planningWake.ownerInterrupted = true; store.write(state);}
                }
                if (event.data.source.kind === 'dsh-world-life' && pending?.messageId === event.data.id
                    && (requirePlanningDecision || pending.source === 'plan') && pending.planRevision !== undefined) {
                    planningTurn = planningReceipt(session, pending, event.seq);
                    state.planningWake = planningTurn;
                    store.write(state);
                }
            }
            if (pending?.sessionId === session.id) {
                if (event.type === 'user/message' && event.data.id === pending.messageId)
                    confirmed();
                else if (event.type === 'turn/end') {
                    const agent = ctx.agents.get(session.id);
                    if (!agent || !queued(agent, pending.messageId))
                        neverRan(`那一轮没开始就结束了（${event.data.reason.kind}）`);
                }
            }
            if (event.type !== 'turn/end')
                return;
            if (deps.reviewDiaryStatus) finishReview(session,event.data.reason.kind);
            if (state.delivering?.source !== 'review')
                reviewing = undefined;
            home.turnEnded(session.id);
            retryFailedPlanning(session, event);
            fallbackAlarm();
            // A stopped or failed turn is not her deciding she is done.
            askIfDoneEarly(event.data.reason.kind === 'completed');
        }));
        for (const agent of ctx.agents.list())
            attach(agent);
        if (!state.review && validClockTime(deps.options.schedule().review)) {
            state.review = nextReview(clock(), timeZone, deps.options.schedule().review);
            record(() => store.write(state));
        }
        if (followSchedule())
            record(() => store.write(state));
        if (requirePlanningDecision) {
            prunePlanningRecovery();
            planningFault();
        }
        try {
            const agent = await home.open();
            if (stopped || !includes(agent.session)) return;
            faults.clear('home');
            await reconcile(agent);
            reconcilePlanning(agent);
            if (deps.reviewDiaryStatus && state.reviewWake) {
                finishReview(agent.session,agent.status === 'idle' ? 'aborted' : undefined);
                // A replaced home cannot own the old capability or block new work.
                if (state.reviewWake && state.reviewWake.sessionId !== agent.id) {
                    delete state.reviewWake; store.write(state);
                }
            }
            for (const item of state.pendingReviews ?? []) if (item.failure) faults.set('review',item.failure);
            // Recover only dates proven by this Life store's delivered review
            // records. Do not invent past tasks by scanning arbitrary files.
            if (deps.reviewDiaryStatus) {
                const today = formatLocalTime(clock(),timeZone).slice(0,10);
                for (const wake of store.wakes()) {
                    if (wake.source !== 'review' || !Number.isFinite(Date.parse(wake.scheduledAt))) continue;
                    const day = formatLocalTime(new Date(wake.scheduledAt),timeZone).slice(0,10);
                    if (day > today || state.pendingReviews?.some(item => item.day === day)) continue;
                    if (reviewStatus(day,agent.session,'') === 'missing') {
                        state.pendingReviews ??= [];
                        state.pendingReviews.push({day,at:wake.scheduledAt,attempts:0,failure:`日记 ${day} 在已投递回顾后仍缺失；等待补写`});
                    }
                }
                if (state.pendingReviews?.length) {
                    state.pendingReviews.sort((a,b)=>a.day.localeCompare(b.day));
                    store.write(state);
                }
            }
            // The morning fallback is the plugin's, not a plan of hers: starting again wakes her rather than leaving her asleep till then.
            const bootstrap = requirePlanningDecision && !hasCurrentPlan() && !state.greeting
                && !state.delivering && !state.planningWake && !state.alarm
                && (options.resumed || !currentRecovery());
            if (bootstrap || (!requirePlanningDecision && options.resumed && !state.greeting && state.alarm?.source !== 'plan')) {
                if (requirePlanningDecision && options.resumed) clearPlanningRecovery();
                state.greeting = { at: clock().toISOString(), kind: 'return' };
                record(() => store.write(state));
            }
            // A restart with nothing scheduled and no turn to end would otherwise never wake her again.
            if (agent.status !== 'running')
                fallbackAlarm();
        }
        catch (error) {
            if (!stopped) {
                faults.set('home', `家打不开：${errorText(error)}`);
                ctx.logger.error(error);
            }
        }
        timer.arm();
        notifyFacts();
    }
    function stop() {
        if (stopped)
            return;
        stopped = true;
        timer.stop();
        if (factNoticeTimer !== undefined) {timers.clear(factNoticeTimer);factNoticeTimer = undefined;}
        if (stallTimer !== undefined) {
            timers.clear(stallTimer);
            stallTimer = undefined;
        }
        for (const dispose of disposers.splice(0).reverse())
            dispose();
        tools.clear();
    }
    return {
        start, stop, planNext, checkAlarm, cancelAlarm, deliver, reschedule, reschedulePlan, notifyFacts, acceptsFactMessage,
        snapshot: () => { refreshState(); planningFault(); return { homeSessionId: state.homeSessionId, alarm: state.alarm, review: state.review, pendingReviews: state.pendingReviews, spend: state.spend,
            currentPlan: state.currentPlan, planRevision: state.planRevision, planningRecovery: currentRecovery(), faults: faults.list() }; },
        /** Resolves once no alarm delivery is in flight (its durability flush can outlast the turn it starts). */
        settled: async () => { while (delivery || factDiscovery)
            await Promise.all([delivery,factDiscovery]); },
        home: () => home.open(),
        /** Whether this session is her home now; the world prompt gives the home its world line. */
        isHome: (sessionId) => { refreshState(); return !stopped && sessionId === state.homeSessionId; },
    };
}
