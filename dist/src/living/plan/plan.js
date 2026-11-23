import { randomUUID } from 'node:crypto';
import { withLivingCaller } from '../index.js';
import { createLifeStore, LIFE_STATE_MAX_BYTES } from '#dsh-world/life/lifeStore';
import { PLAN_KINDS, isPlanKind, isPlanBodyAction, isPlanEconomyOperation, isPlanGardenOperation, isBodyMetric, PlannedAdmissionWaitError } from '../../contracts/behavior.js';
import { requirePresentationSlot } from '../body/animation-slots.js';
import { gardenReceiptText } from '../body/garden-receipt.js';
export const expiredDispatchDeadline = 'The activity absolute deadline elapsed before Body admission; revise the original plan explicitly';
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function check(value, message) { if (!value)
    throw Error(message); }
function string(value, label) {
    check(typeof value === 'string' && value.trim().length > 0 && value.length <= 32768, `Invalid ${label}`);
}
function instant(value) {
    check(typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)), 'Use an ISO time with an explicit timezone');
}
const validateStepFields = {
    hold() { },
    // Room and move only need the shared target check.
    room() { },
    move() { },
    garden(value, step) {
        check(object(value.garden), 'Garden activity requires an explicit operation');
        check(isPlanGardenOperation(String(value.garden.type)), 'Unsupported garden operation');
        // Existing garden validation remains authoritative for quantities, plots and balances.
        step.garden = structuredClone(value.garden);
    },
    body(value, step) {
        check(isPlanBodyAction(String(value.action)), 'Unsupported bodily activity');
        step.action = value.action;
    },
    economy(value, step) {
        check(object(value.economy), 'Economy activity requires an explicit transaction');
        const input = value.economy;
        check(isPlanEconomyOperation(String(input.type)), 'Unsupported economy activity');
        string(input.itemId, 'catalog item');
        check(Number.isSafeInteger(input.quantity) && Number(input.quantity) > 0, 'Quantity must be a positive integer');
        if (input.type === 'consume')
            check(input.quantity === 1, 'A food activity consumes one item per durable body effect');
        step.economy = { type: input.type, itemId: input.itemId, quantity: input.quantity };
    },
    read(value, step) {
        check(object(value.reading), 'Reading activity requires a book and segment');
        string(value.reading.itemId, 'reading item id');
        check(Number.isSafeInteger(value.reading.segment) && Number(value.reading.segment) >= 0, 'Reading segment must be a nonnegative integer');
        step.reading = { itemId: value.reading.itemId, segment: value.reading.segment };
    },
};
/** Validate executable structure and queue reachability without choosing a routine. */
export { parsePlan as parsePlanDraft };
function parsePlan(raw) {
    check(object(raw), 'Invalid life plan');
    string(raw.goal, 'goal');
    string(raw.reason, 'reason');
    check(Array.isArray(raw.steps), 'Plan steps must be an array; empty is valid');
    const ids = new Set();
    const steps = raw.steps.map((value) => {
        check(object(value), 'Invalid activity');
        string(value.id, 'step id');
        string(value.activity, 'activity');
        check(/^[\p{L}\p{N}_.-]{1,48}$/u.test(value.id), 'Activity id must be a short stable identifier');
        check(value.activity.length <= 80, 'Use a short activity label; put the explanation in the plan reason');
        check(!ids.has(value.id), 'Activity ids must be unique');
        ids.add(value.id);
        check(isPlanKind(String(value.kind)), 'Unsupported activity kind');
        const step = { id: value.id, kind: value.kind, activity: value.activity };
        // Admission and timing coerce kind; field dispatch uses the original string only.
        const kind = step.kind;
        if (typeof kind === 'string') {
            if (PLAN_KINDS[kind].target) {
                string(value.room, 'room');
                string(value.spot, 'spot');
                step.room = value.room;
                step.spot = value.spot;
            }
            validateStepFields[kind](value, step);
        }
        if (value.presentationSlot !== undefined)
            step.presentationSlot = requirePresentationSlot(value.presentationSlot, step);
        if (PLAN_KINDS[String(value.kind)]?.executable)
            check(value.durationMinutes === undefined && value.until === undefined, 'Executable activities finish on actual receipts; use a following hold or room step for sustained animation');
        check(value.durationMinutes === undefined || value.until === undefined, 'Choose a duration or an end time');
        if (value.durationMinutes !== undefined) {
            check(typeof value.durationMinutes === 'number' && Number.isFinite(value.durationMinutes) && value.durationMinutes > 0, 'Duration must be positive; no fixed activity duration is imposed');
            check(Number.isFinite(new Date(Date.now() + value.durationMinutes * 60_000).getTime()), 'Duration exceeds the supported clock range');
            step.durationMinutes = value.durationMinutes;
        }
        if (value.until !== undefined) {
            instant(value.until);
            step.until = value.until;
        }
        return step;
    });
    for (const [index, step] of steps.entries()) {
        check(!(typeof step.kind === 'string' && PLAN_KINDS[step.kind].executable === false && step.durationMinutes === undefined && step.until === undefined && index < steps.length - 1), `Activity ${step.id} waits for explicit control and blocks later steps. Use move for arrival, set durationMinutes/until for a finite stay, or put indefinite waiting last. nextConsiderAt only wakes planning; it does not complete the activity.`);
    }
    check(raw.nextConsiderAt === null || typeof raw.nextConsiderAt === 'string', 'Specify nextConsiderAt, or null to wait for an event');
    if (raw.nextConsiderAt !== null)
        instant(raw.nextConsiderAt);
    check(raw.reconsiderWhen === undefined || Array.isArray(raw.reconsiderWhen), 'Invalid reconsideration conditions');
    const reconsiderWhen = (raw.reconsiderWhen ?? []).map((value) => {
        check(object(value) && isBodyMetric(String(value.metric)) && ['gte', 'lte'].includes(String(value.comparison))
            && typeof value.value === 'number' && Number.isFinite(value.value) && value.value >= 0 && value.value <= 1, 'Invalid body-state condition');
        return value;
    });
    return { goal: raw.goal, reason: raw.reason, steps, nextConsiderAt: raw.nextConsiderAt, reconsiderWhen };
}
/** One scoped intent in World's existing life.json. Body receipts own actual execution.
 * The owning CompanionLife queue serializes every intent mutation, including
 * native alarm tools and retry callbacks, across awaits of the body service. */
export class PersistentLifePlan {
    directory;
    companionId;
    storageId;
    isCurrent;
    changed;
    store;
    constructor(directory, companionId, storageId, timeZone, isCurrent = () => true, changed) {
        this.directory = directory;
        this.companionId = companionId;
        this.storageId = storageId;
        this.isCurrent = isCurrent;
        this.changed = changed;
        this.store = createLifeStore(directory, timeZone);
    }
    read() {
        return PersistentLifePlan.decode(this.store.read(), this.companionId, this.storageId);
    }
    static decode(state, companionId, storageId) {
        const plan = state.currentPlan;
        if (plan) {
            check(plan.version === 1 && plan.companionId === companionId && plan.storageId === storageId, 'Life plan belongs to another companion or format');
            check(Number.isSafeInteger(plan.revision) && Number.isSafeInteger(plan.cursor) && plan.cursor >= 0 && plan.cursor <= plan.steps.length, 'Life plan progress is invalid; original state retained');
            parsePlan(plan);
            check(['active', 'paused', 'waiting', 'completed', 'cancelled'].includes(plan.status) && Array.isArray(plan.triggeredConditions), 'Invalid stored plan status');
            check(!plan.operationId || !!plan.steps[plan.cursor] && plan.operationId === `life:${plan.id}:${plan.steps[plan.cursor].id}`, 'Stored activity does not match the current plan step');
            if (plan.dispatchUntil)
                instant(plan.dispatchUntil);
            if (plan.admissionWait) {
                const wait = plan.admissionWait;
                check(object(wait) && wait.version === 1 && wait.kind === 'owner-activity' && wait.operationId === plan.operationId
                    && typeof wait.requestId === 'string' && wait.requestId.length > 0, 'Invalid pending Body admission; original state retained');
                instant(wait.observedAt);
                check(!plan.execution, 'An unsubmitted admission cannot already have an execution receipt');
            }
        }
        const revision = state.planRevision ?? plan?.revision ?? 0;
        check(Number.isSafeInteger(revision) && revision >= 0 && (!plan || plan.revision === revision), 'Stored life plan revisions disagree');
        return { revision, plan: plan ?? null };
    }
    projection(plan) {
        return JSON.stringify([plan?.cursor, plan?.status, plan?.execution]);
    }
    change(expectedRevision, work, schedule = true, intentChange = true, options = {}) {
        check(this.isCurrent(), 'Life workspace changed; the old plan was not updated');
        check(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 'Invalid expected plan revision');
        let visibleChanged = intentChange;
        options.recordEffect?.('unknown');
        const saved = this.store.update(state => {
            const actual = state.planRevision ?? state.currentPlan?.revision ?? 0;
            check(actual === expectedRevision, 'Life plan changed; read the current plan before submitting again');
            const previous = state.currentPlan ?? null;
            const before = this.changed && !intentChange ? this.projection(previous) : undefined;
            const next = work(previous);
            if (before !== undefined)
                visibleChanged = this.projection(next) !== before;
            state.planRevision = actual + (intentChange ? 1 : 0);
            if (options.resetRecovery ?? intentChange)
                delete state.planningRecovery;
            if (options.decision)
                state.planDecisionRevision = state.planRevision;
            if (next) {
                next.revision = state.planRevision;
                next.updatedAt = new Date().toISOString();
            }
            state.currentPlan = next;
            if (schedule) {
                if (next && ['active', 'waiting'].includes(next.status) && next.nextConsiderAt)
                    state.alarm = { at: next.nextConsiderAt, note: next.replanReason || next.reason, setAt: new Date().toISOString(), source: 'plan' };
                else
                    delete state.alarm;
            }
        });
        options.recordEffect?.('partial');
        if (visibleChanged)
            this.changed?.();
        return saved;
    }
    async commit(expectedRevision, draft, behavior, workspaceId, validate = () => { }) {
        validate();
        draft = parsePlan(draft);
        const old = this.read();
        check(old.revision === expectedRevision, 'Life plan changed; read it again');
        if (draft.nextConsiderAt)
            check(Date.parse(draft.nextConsiderAt) > Date.now(), 'Next consideration must be in the future');
        for (const step of draft.steps)
            if (step.until)
                check(Date.parse(step.until) > Date.now(), 'A new activity cannot have an end time in the past');
        const now = new Date().toISOString();
        const plan = { version: 1, id: randomUUID(), revision: expectedRevision + 1, companionId: this.companionId, storageId: this.storageId,
            ...structuredClone(draft), status: 'active', cursor: 0, reconsiderWhen: draft.reconsiderWhen ?? [], triggeredConditions: [],
            pauseReason: null, replanReason: null, createdAt: now, updatedAt: now };
        const candidate = { ...this.store.read(), planRevision: plan.revision, currentPlan: plan };
        if (plan.nextConsiderAt)
            candidate.alarm = { at: plan.nextConsiderAt, note: plan.reason, setAt: now, source: 'plan' };
        else
            delete candidate.alarm;
        // Core's existing record envelope is technical capacity, not a life-time
        // policy. Leave space for an execution receipt and native delivery metadata.
        check(Buffer.byteLength(JSON.stringify(candidate, null, 2)) + 8 * 1024 <= LIFE_STATE_MAX_BYTES, 'Life plan leaves insufficient room for durable execution metadata; previous plan retained');
        if (behavior && workspaceId && plan.reconsiderWhen.length) {
            const snapshot = await withLivingCaller(validate, () => behavior.snapshot(workspaceId));
            plan.triggeredConditions = plan.reconsiderWhen.flatMap((condition, index) => {
                const value = snapshot.needs?.[condition.metric] ?? snapshot.home.body?.[condition.metric];
                return typeof value === 'number' && (condition.comparison === 'gte' ? value >= condition.value : value <= condition.value) ? [index] : [];
            });
        }
        validate();
        if (old.plan?.operationId) {
            check(behavior && workspaceId, 'The body must be available before replacing an executing plan');
            const operationId = old.plan.operationId;
            const accepted = await withLivingCaller(validate, () => behavior.inspectPlanned(workspaceId, operationId));
            validate();
            if (accepted)
                await withLivingCaller(validate, () => behavior.cancelPlanned(workspaceId, operationId));
        }
        validate();
        this.change(expectedRevision, () => plan, true, true, { decision: true });
        return this.read();
    }
    /** Used by native plan_next/cancel_alarm and consumption of the same pending wake. */
    setNextConsideration(at, note, reason) {
        const current = this.read();
        if (at)
            instant(at);
        if (!current.plan) {
            check(this.isCurrent(), 'Life workspace changed');
            this.store.update(state => {
                if (at)
                    state.alarm = { at, note, setAt: new Date().toISOString(), source: 'plan' };
                else
                    delete state.alarm;
                // A clock/cancellation is newer intent, but not a saved life decision.
                state.planRevision = current.revision + 1;
                delete state.planningRecovery;
            });
            this.changed?.();
            return;
        }
        this.change(current.revision, plan => {
            if (!plan)
                return null;
            plan.nextConsiderAt = at ?? null;
            if (reason === 'schedule' && note)
                plan.reason = note;
            return plan;
        });
    }
    retryAt(at, reason) {
        instant(at);
        const { revision, plan } = this.read();
        if (!plan) {
            check(this.isCurrent(), 'Life workspace changed');
            // Bootstrap failures use the same native alarm and durable pending-wake
            // recovery as an existing plan, without inventing an activity for her.
            this.store.update(state => {
                if (!state.currentPlan && !state.alarm)
                    state.alarm = { at, note: reason, setAt: new Date().toISOString(), source: 'plan' };
            });
            return;
        }
        if (!['active', 'waiting'].includes(plan.status) || plan.nextConsiderAt)
            return;
        this.change(revision, current => { check(current, 'No current plan'); current.nextConsiderAt = at; current.replanReason = reason; return current; }, true, false);
    }
    /** An explicit consideration receipt, preserving operation IDs and progress. */
    keep(expectedRevision, reason, nextConsiderAt) {
        string(reason, 'consideration reason');
        if (nextConsiderAt !== null) {
            instant(nextConsiderAt);
            check(Date.parse(nextConsiderAt) > Date.now(), 'Next consideration must be in the future');
        }
        this.change(expectedRevision, current => {
            check(current && ['active', 'waiting'].includes(current.status), 'Only an active or waiting plan can be kept; use the explicit pause/resume controls');
            check(!object(current.execution) || current.execution.status !== 'failed', 'A failed activity needs a revised plan, not a claim that it can continue');
            check(current.status !== 'waiting' || current.cursor === current.steps.length, 'An unfinished activity is waiting for recovery; inspect the failure and revise the plan before continuing');
            current.reason = reason;
            current.nextConsiderAt = nextConsiderAt;
            current.replanReason = null;
            current.pauseReason = null;
            return current;
        }, true, true, { decision: true });
        return this.read();
    }
    markAutoResume(enabled) {
        const { revision, plan } = this.read();
        if (!plan)
            return;
        this.change(revision, current => { check(current, 'No current plan'); current.resumeOnEnable = enabled; return current; }, false);
    }
    async control(expectedRevision, action, reason, behavior, workspaceId, validate = () => { }) {
        validate();
        const current = this.read();
        check(current.revision === expectedRevision && current.plan, 'Life plan changed or does not exist');
        const plan = current.plan;
        check(!['completed', 'cancelled'].includes(plan.status), 'This plan has ended; submit a new plan');
        if (action === 'resume')
            check(!object(plan.execution) || plan.execution.status !== 'failed', 'A failed activity needs a revised plan, not a replay of the failed operation');
        let execution;
        if (plan.operationId) {
            check(behavior && workspaceId, 'The body must be available to control an executing activity');
            const operationId = plan.operationId;
            const accepted = await withLivingCaller(validate, () => behavior.inspectPlanned(workspaceId, operationId));
            validate();
            if (accepted)
                execution = await withLivingCaller(validate, () => action === 'pause' ? behavior.pausePlanned(workspaceId, operationId)
                    : action === 'cancel' ? behavior.cancelPlanned(workspaceId, operationId) : behavior.resumePlanned(workspaceId, operationId));
        }
        validate();
        this.change(expectedRevision, current => {
            check(current, 'No current plan');
            current.status = action === 'resume' ? 'active' : action === 'pause' ? 'paused' : 'cancelled';
            current.pauseReason = action === 'resume' ? null : reason;
            if (action === 'resume') {
                current.replanReason = null;
                current.status = current.cursor < current.steps.length ? 'active' : 'waiting';
                if (current.nextConsiderAt && Date.parse(current.nextConsiderAt) <= Date.now())
                    current.nextConsiderAt = null;
                if (object(execution) && execution.status === 'failed') {
                    current.status = 'waiting';
                    current.replanReason = String(execution.reason || 'Activity cannot be resumed');
                    current.pauseReason = current.replanReason;
                    current.nextConsiderAt = new Date().toISOString();
                }
            }
            if (execution)
                current.execution = execution;
            if (action === 'cancel')
                current.nextConsiderAt = null;
            return current;
        }, true, true, { decision: true });
        return this.read();
    }
    /** Only explicit events create a wake. Repeated ticks cannot create a polling loop. */
    reconsider(reason, condition, recordEffect) {
        const { revision, plan } = this.read();
        if (!plan || !['active', 'waiting'].includes(plan.status) || plan.replanReason || condition !== undefined && plan.triggeredConditions.includes(condition))
            return false;
        this.change(revision, current => {
            check(current, 'No current plan');
            current.replanReason = reason;
            current.nextConsiderAt = new Date().toISOString();
            if (condition !== undefined)
                current.triggeredConditions.push(condition);
            return current;
        }, true, true, { recordEffect });
        return true;
    }
    /** Serialized by CompanionLife; no model is called here. */
    async advance(workspaceId, behavior, validate = () => { }, recordEffect) {
        validate();
        let current = this.read();
        let plan = current.plan;
        if (!plan || !['active', 'waiting'].includes(plan.status))
            return false;
        // A body operation can commit before its caller receives the result.
        // Reconcile that stable receipt even if a later observer error left Life
        // waiting with no acknowledgement (or its previous running receipt).
        const awaitingReceipt = plan.status === 'waiting' && !!plan.operationId &&
            (!object(plan.execution) || plan.execution.status === 'running');
        if (!plan.replanReason && plan.reconsiderWhen.length) {
            const snapshot = await withLivingCaller(validate, () => behavior.snapshot(workspaceId));
            validate();
            for (const [index, condition] of plan.reconsiderWhen.entries()) {
                const value = snapshot.needs?.[condition.metric] ?? snapshot.home.body?.[condition.metric];
                if (typeof value !== 'number')
                    continue;
                const satisfied = condition.comparison === 'gte' ? value >= condition.value : value <= condition.value;
                if (!satisfied && plan.triggeredConditions.includes(index)) {
                    const latest = this.read();
                    this.change(latest.revision, p => { check(p, 'No current plan'); p.triggeredConditions = p.triggeredConditions.filter(n => n !== index); return p; }, false, false, { recordEffect });
                }
                if (satisfied && this.reconsider(`Body condition changed: ${condition.metric} ${condition.comparison} ${condition.value}`, index, recordEffect))
                    return true;
            }
        }
        if (plan.status !== 'active' && !awaitingReceipt)
            return false;
        const step = plan.steps[plan.cursor];
        // An empty plan is intentional rest/waiting, not a request to generate another goal.
        if (!step)
            return false;
        if (plan.replanReason && !plan.operationId)
            return false;
        if (!plan.operationId) {
            const operationId = `life:${plan.id}:${step.id}`;
            this.change(current.revision, p => {
                check(p, 'No current plan');
                p.operationId = operationId;
                delete p.execution;
                p.dispatchUntil = step.until ?? (step.durationMinutes === undefined ? undefined : new Date(Date.now() + step.durationMinutes * 60_000).toISOString());
                return p;
            }, false, false, { recordEffect });
            current = this.read();
            plan = current.plan;
        }
        const operationId = plan.operationId;
        let recordingReceipt = false;
        try {
            let execution = await withLivingCaller(validate, () => behavior.inspectPlanned(workspaceId, operationId));
            validate();
            if (!execution) {
                // Absence is not proof that an acknowledged effect may be repeated.
                // Keep the original waiting plan available for explicit reconciliation.
                if (awaitingReceipt)
                    return false;
                if (plan.replanReason)
                    return false;
                check(!plan.execution, 'A previously acknowledged activity has lost its durable receipt; preserve the state and reconcile it before replay');
                if (step.until)
                    check(Date.parse(step.until) > Date.now(), expiredDispatchDeadline);
                // Relative stays start when Body becomes available, not while a short
                // owner reaction owns it. An absolute calendar deadline never moves.
                if (plan.admissionWait && step.durationMinutes !== undefined) {
                    this.change(current.revision, p => { check(p, 'No current plan'); p.dispatchUntil = new Date(Date.now() + step.durationMinutes * 60_000).toISOString(); return p; }, false, false, { recordEffect });
                    current = this.read();
                    plan = current.plan;
                }
                const until = plan.dispatchUntil;
                try {
                    execution = await withLivingCaller(validate, () => {
                        recordEffect?.('unknown');
                        return behavior.startPlanned(workspaceId, { operationId, kind: step.kind, activity: step.activity,
                            ...(step.room ? { room: step.room, spot: step.spot } : {}), ...(step.garden ? { garden: step.garden } : {}), ...(step.action ? { action: step.action } : {}), ...(step.economy ? { economy: step.economy } : {}), ...(step.reading ? { reading: step.reading } : {}),
                            ...(step.presentationSlot ? { presentationSlot: step.presentationSlot } : {}),
                            ...(until ? { until, freezeOnPause: step.durationMinutes !== undefined } : {}) });
                    });
                    recordEffect?.('partial');
                }
                catch (error) {
                    const waiting = error instanceof PlannedAdmissionWaitError && error.wait.operationId === operationId;
                    if (waiting)
                        recordEffect?.('none');
                    validate();
                    if (!waiting)
                        throw error;
                    const latest = this.read();
                    if (latest.plan?.id !== plan.id || latest.plan.operationId !== operationId)
                        return false;
                    if (JSON.stringify(latest.plan.admissionWait) !== JSON.stringify(error.wait))
                        this.change(latest.revision, p => {
                            check(p, 'No current plan');
                            p.admissionWait = structuredClone(error.wait);
                            p.pauseReason = error.message;
                            return p;
                        }, false, false, { recordEffect });
                    return false;
                }
            }
            validate();
            current = this.read();
            // The await may outlive a binding or an intent: never apply its result to a replacement plan.
            if (current.plan?.id !== plan.id || current.plan.operationId !== operationId)
                return false;
            const readingReady = execution.kind === 'read' && execution.status === 'running' && execution.awaitingInput === 'reading-content'
                && current.plan.readingAttentionOperationId !== operationId;
            if (!awaitingReceipt && !readingReady && execution.status === 'running' && JSON.stringify(current.plan.execution) === JSON.stringify(execution))
                return false;
            const completedPlan = execution.status === 'completed' && current.plan.cursor + 1 === current.plan.steps.length && !current.plan.nextConsiderAt;
            recordingReceipt = true;
            recordEffect?.('partial');
            this.change(current.revision, p => {
                check(p, 'No current plan');
                p.execution = execution;
                if (p.admissionWait) {
                    delete p.admissionWait;
                    p.pauseReason = null;
                }
                if (awaitingReceipt && ['running', 'completed'].includes(execution.status)) {
                    p.status = 'active';
                    p.pauseReason = null;
                    p.replanReason = null;
                }
                if (readingReady) {
                    p.readingAttentionOperationId = operationId;
                    if (!p.replanReason) {
                        p.replanReason = '当前阅读已就绪：用 life_read_segment 取得原片段，实际读到文字后 life_read_confirm；完成本次考虑请用 life_plan_keep 保留原安排或明确调整';
                        p.nextConsiderAt = new Date().toISOString();
                    }
                }
                if (execution.status === 'completed') {
                    p.cursor++;
                    delete p.operationId;
                    delete p.dispatchUntil;
                    if (p.cursor === p.steps.length) {
                        p.status = 'waiting';
                        // One real completion transition earns one consideration, not a
                        // polling rule. An empty plan or an indefinite hold never enters
                        // this branch; an already chosen consideration time is retained.
                        if (completedPlan) {
                            p.replanReason = '本轮生活活动已完成，考虑接下来继续、休息或等待';
                            p.nextConsiderAt = new Date().toISOString();
                        }
                    }
                }
                else if (execution.status === 'interrupted' && execution.resumeAfterInteraction) {
                    // Temporary Body ownership is not a new life intention. Keep the
                    // original plan admitted while Body reconciles and returns safely.
                    p.pauseReason = execution.reason || 'Temporary owner interaction';
                }
                else if (['paused', 'interrupted', 'cancelled'].includes(execution.status)) {
                    p.status = 'paused';
                    p.pauseReason = execution.reason || 'Activity interrupted; resume or revise the plan explicitly';
                }
                else if (execution.status === 'failed') {
                    p.status = 'waiting';
                    p.pauseReason = execution.reason || 'Activity failed';
                }
                return p;
            }, execution.status === 'completed' || awaitingReceipt || readingReady, false, { resetRecovery: completedPlan });
            if (completedPlan || readingReady)
                return true;
            if (execution.status === 'failed') {
                const failed = this.read();
                this.change(failed.revision, p => { check(p, 'No current plan'); p.replanReason = execution.reason || 'Activity failed'; p.nextConsiderAt = new Date().toISOString(); return p; });
                return true;
            }
            if (awaitingReceipt)
                return true;
        }
        catch (error) {
            validate();
            // Read/reconcile and Life-save failures must stay visible. An old wait
            // reason is not evidence that a newly failed persistence step succeeded.
            if (awaitingReceipt || recordingReceipt)
                throw error;
            const latest = this.read();
            if (latest.plan?.id !== plan.id)
                throw error;
            if (latest.plan.replanReason)
                return false;
            this.change(latest.revision, p => { check(p, 'No current plan'); delete p.admissionWait; p.status = 'waiting'; p.pauseReason = String(error); p.replanReason = String(error); p.nextConsiderAt = new Date().toISOString(); return p; });
            return true;
        }
        return false;
    }
    summary() {
        return PersistentLifePlan.describe(this.read());
    }
    static describe({ revision, plan }) {
        const clip = (value) => value && value.length > 600 ? value.slice(0, 600) + '…' : value;
        const execution = object(plan?.execution) && plan.execution.kind === 'garden' && typeof plan.execution.reason === 'string'
            ? { ...plan.execution, reason: gardenReceiptText(plan.execution.reason) } : plan?.execution;
        return JSON.stringify({ revision, plan: plan ? { id: plan.id, goal: clip(plan.goal), reason: clip(plan.reason), status: plan.status,
                current: plan.steps[plan.cursor] ?? null, remainingPreview: plan.steps.slice(plan.cursor + 1, plan.cursor + 3), remainingCount: Math.max(0, plan.steps.length - plan.cursor - 1), execution,
                pauseReason: clip(plan.pauseReason), replanReason: clip(plan.replanReason), nextConsiderAt: plan.nextConsiderAt, reconsiderWhen: plan.reconsiderWhen } : null });
    }
}
//# sourceMappingURL=plan.js.map