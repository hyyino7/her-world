import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { buildHomePromptLine } from '#feiyu-home';
import { check, digest, reject, text } from '../../core/storage.js';
import { isCareAction } from '../../contracts/behavior.js';
import { bodyPhaseOf, companionBusy } from './activity.js';
import { CompanionRoom } from './room.js';
import { behaviorPresentation } from './presentation.js';
import { gardenHomeProjection } from './garden-receipt.js';
import { LifeControlFileError, readLifeControl } from '../plan/control-file.js';
import { readEconomyFileEvidence, readEconomyJournalEvidence } from '../economy/adoption.js';
import { LivingView, livingCaller, mountLivingArea, sameHomeBinding, settleCleanup } from '../index.js';
const owners = new WeakMap();
/** The only home/garden runtime writer. It does not create agents or model turns. */
export class CompanionBehavior {
    ctx;
    host;
    binding;
    serial = Promise.resolve();
    closed = false;
    closing;
    living;
    autonomous = false;
    fault;
    publicationFault;
    revision = 0;
    expression;
    readingConfirmationEffect;
    subscriptions = [];
    bootId = randomUUID();
    timer;
    deadlineAt;
    awaitingRecovery = false;
    conditions = [];
    worldFacts;
    constructor(ctx, host, ports = {}) {
        this.ctx = ctx;
        this.host = host;
        this.living = ports instanceof LivingView ? ports : new LivingView(ports);
        this.worldFacts = this.living.factSource(host);
        if (!(ports instanceof LivingView))
            this.activate();
    }
    activate() {
        const { ctx, host, living } = this;
        if (owners.has(host))
            throw Error('共享身体已由另一个组件实例管理');
        owners.set(host, this);
        const refreshBinding = (isObserved = () => true) => {
            void this.enqueue(async (validate) => {
                if (!isObserved())
                    return;
                this.synchronize();
                const bound = this.binding;
                if (!bound)
                    return;
                await this.refreshEmotion(bound.id);
                validate();
                if (!isObserved() || this.currentBound(bound.id) !== bound)
                    return;
                if (!living.get('plan') && !this.autonomous) {
                    this.publish('observation', false);
                    return;
                }
                this.advanceRoom(bound);
                this.publish('transition', false);
            }, isObserved).catch(error => { this.fault = String(error); });
        };
        this.subscriptions.push(ctx.on('pet/core.changed', () => refreshBinding()));
        this.subscriptions.push(living.watch(ctx, 'economy', (economy, observed) => {
            refreshBinding(() => observed() && (!economy || economy.isCurrent()));
        }));
        const refresh = (workspaceId) => {
            void this.enqueue(async (validate) => {
                if (!this.binding)
                    return;
                this.synchronize();
                const bound = this.currentBound(workspaceId);
                if (!bound)
                    return;
                await this.refreshEmotion(workspaceId);
                validate();
                if (this.currentBound(workspaceId) === bound)
                    this.publish();
            }).catch(error => { this.fault = String(error); });
        };
        this.subscriptions.push(ctx.on('pet/emotion.changed', workspaceId => refresh(workspaceId)));
        this.subscriptions.push(ctx.on('pet/emotion.expression', event => {
            if (this.closed || !living.isCurrent() || !this.binding)
                return;
            this.synchronize();
            if (!this.currentBound(event.workspaceId))
                return;
            this.expression = { sessionId: event.sessionId, turn: event.turn,
                ...(event.action ? { action: event.action } : {}), ...('actionLabel' in event && typeof event.actionLabel === 'string' ? { actionLabel: event.actionLabel } : {}),
                ...(event.sticker ? { sticker: event.sticker } : {}),
                ...(event.feelings ? { feelings: [...event.feelings] } : {}) };
            refresh(event.workspaceId);
        }));
        let stopLife;
        this.subscriptions.push(() => stopLife?.());
        this.subscriptions.push(living.watch(ctx, 'plan', (plan, observed) => {
            if (!plan) {
                stopLife?.();
                stopLife = undefined;
                void this.enqueue(() => {
                    if (!observed() || living.get('plan'))
                        return;
                    this.synchronize();
                    this.binding?.room.suspendAutonomy();
                    this.autonomous = false;
                    this.publish();
                }, observed).catch(error => { this.fault = String(error); });
                return;
            }
            const { value: life } = plan;
            const current = () => observed() && plan.isCurrent();
            const synchronize = () => {
                if (!current())
                    return;
                void this.enqueue(async (validate) => {
                    if (!current())
                        return;
                    const status = this.host.workspace.status(), admission = status.target ? life.bodyClockState?.(status.target.id) : undefined;
                    if (!this.binding && !life.running() && !admission?.enabled)
                        return;
                    this.synchronize();
                    const bound = this.binding;
                    if (!bound)
                        return;
                    await this.refreshEmotion(bound.id);
                    validate();
                    if (!current() || this.currentBound(bound.id) !== bound)
                        return;
                    this.autonomous = admission?.enabled ?? life.running();
                    if (admission || this.autonomous)
                        bound.room.setAutonomy(this.autonomous, Date.now(), admission?.restoreElapsed);
                    else
                        bound.room.suspendAutonomy();
                    this.publish('transition', false);
                }, current).catch(error => { this.fault = String(error); });
            };
            stopLife = ctx.on('pet/life.changed', synchronize);
            synchronize();
        }));
    }
    enqueue(work, observed = () => true, scope = this.host?.workspace.homeScope?.()) {
        const caller = livingCaller();
        let admitted = true;
        const validate = () => {
            try {
                caller?.();
                if (this.closed || !this.living.isCurrent() || !sameHomeBinding(this.host?.workspace.homeScope?.(), scope))
                    reject('STALE_BINDING', '身体工作区已切换或组件已停止');
            }
            catch (error) {
                admitted = false;
                throw error;
            }
        };
        try {
            validate();
        }
        catch (error) {
            return Promise.reject(error);
        }
        const next = this.serial.then(() => { validate(); return work(validate); });
        const arm = () => { if (admitted && observed())
            this.arm(); };
        this.serial = next.then(arm, arm).catch(error => { this.fault = String(error); });
        return next;
    }
    arm() {
        clearTimeout(this.timer);
        this.timer = undefined;
        if (this.closed || !this.living.isCurrent() || !this.binding) {
            this.deadlineAt = undefined;
            return;
        }
        if (this.awaitingRecovery)
            return;
        const bound = this.binding, scope = bound.scope;
        if (!sameHomeBinding(this.host.workspace.homeScope?.(), scope))
            return;
        const now = Date.now();
        // A queue operation that did not advance physics cannot consume an overdue
        // boundary by rearming from stale needs at a later observation time.
        const at = this.deadlineAt !== undefined && this.deadlineAt <= now ? this.deadlineAt : bound.room.nextWakeAt(now, this.conditions);
        if (at === null) {
            this.deadlineAt = undefined;
            return;
        }
        this.deadlineAt = at;
        // Bound physical deadlines, never an activity-planning interval. Long waits
        // recheck the wall clock using the same segment as the native alarm timer.
        this.timer = setTimeout(() => {
            this.timer = undefined;
            if (!sameHomeBinding(this.host.workspace.homeScope?.(), scope))
                return;
            void this.enqueue(async (validate) => {
                this.synchronize();
                if (this.binding !== bound)
                    return;
                await this.refreshEmotion(bound.id);
                validate();
                if (this.binding !== bound)
                    return;
                this.advanceRoom(bound);
                this.deadlineAt = undefined;
                this.publish();
            }, undefined, scope).catch(error => { this.fault = String(error); });
        }, Math.min(5 * 60_000, Math.max(1, at - Date.now())));
        this.timer.unref();
    }
    advanceRoom(bound) {
        try {
            const result = bound.room.tick();
            this.awaitingRecovery = false;
            this.fault = undefined;
            return result;
        }
        catch (error) {
            // Retain the overdue boundary, but do not spin a 1ms disk retry. A real
            // domain/lifecycle change or explicit state request can reconcile it.
            this.awaitingRecovery = true;
            this.fault = String(error);
            clearTimeout(this.timer);
            this.timer = undefined;
            throw error;
        }
    }
    setReconsiderConditions(workspaceId, conditions) {
        return this.enqueue(() => { this.checked(workspaceId); this.conditions = structuredClone(conditions); });
    }
    nextWakeAt(workspaceId, conditions = []) {
        return this.enqueue(() => this.checked(workspaceId).room.nextWakeAt(Date.now(), conditions));
    }
    synchronize() {
        const status = this.host.workspace.status(), target = status.state === 'ready' ? status.target : null;
        const storageId = target ? this.host.workspace.storageId() : undefined;
        const scope = this.host.workspace.homeScope?.();
        if (this.binding && this.binding.id === target?.id && this.binding.path === target.path && this.binding.storageId === storageId) {
            this.binding.scope = scope;
            return;
        }
        if (status.state !== 'migration-required')
            this.binding?.room.flush();
        this.binding = undefined;
        this.conditions = [];
        this.awaitingRecovery = false;
        this.autonomous = false;
        this.fault = undefined;
        this.publicationFault = undefined;
        this.expression = undefined;
        if (this.closed || !target || !storageId)
            return;
        const legacy = join(target.path, '.chatpet', 'data', 'life');
        const owner = ['home.json', 'garden.json'].some(name => existsSync(join(legacy, name))) ? 'life' : 'behavior';
        let directory = target.path;
        for (const part of ['.chatpet', 'data', owner]) {
            directory = join(directory, part);
            if (!existsSync(directory))
                mkdirSync(directory, { mode: 0o700 });
            const stat = lstatSync(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink())
                throw Error('身体数据目录无效');
        }
        const id = target.id;
        this.binding = { id, path: target.path, storageId, scope,
            room: new CompanionRoom(directory, () => this.ctx.get('petEmotion')?.roomSnapshot(id), legacyFile => {
                const economy = this.living.get('economy');
                if (!economy) {
                    const { companionId } = this.host.workspace.runtime.config;
                    const evidence = readEconomyFileEvidence(target.path, { storageId, companionId });
                    if (evidence.adoption || evidence.storage || evidence.database || readEconomyJournalEvidence(target.path, storageId))
                        throw Error('权威经济组件暂不可用；原钱包、库存与菜园已保留，等待恢复');
                }
                return economy?.gardenPort(id, legacyFile, this.readingConfirmationEffect);
            }, () => {
                const settings = this.host.workspace.companionSettings?.();
                return {
                    hours: settings?.offlineBodyHours ?? 4, needCeiling: (settings?.offlineNeedCeilingPercent ?? 70) / 100,
                    energyFloor: (settings?.offlineEnergyFloorPercent ?? 35) / 100
                };
            }, () => this.living.get('plan')?.bodyClockState?.(id) ?? readLifeControl(target.path)) };
        let admission;
        try {
            admission = this.living.get('plan')?.bodyClockState?.(id);
        }
        catch (error) {
            if (!(error instanceof LifeControlFileError))
                throw error;
            // Room reports an invalid clock at the garden boundary.
        }
        if (admission) {
            this.autonomous = admission.enabled;
            this.binding.room.setAutonomy(admission.enabled, Date.now(), admission.restoreElapsed);
        }
    }
    checked(workspaceId) {
        this.synchronize();
        if (this.closed || !this.binding || this.binding.id !== workspaceId)
            throw Error('身体工作区已切换或组件已停止');
        return this.binding;
    }
    activity() {
        const state = this.binding?.room.state;
        if (!state)
            return { activityId: null, kind: 'idle', phase: 'idle' };
        const planned = this.binding?.room.plannedState();
        const task = state.companionAction;
        const animation = this.binding?.room.presentationActivity() ?? {};
        const onset = state.route?.departAt ?? (state.asleep ? state.sleepStartedAt :
            state.dwell && !state.dwell.target?.plannedOperationId && Number(state.dwell.target?.dwellMs) > 0
                ? state.dwell.until - state.dwell.target.dwellMs :
                task && !task.completedAt && !state.dwell ? task.startedAt :
                    state.kind?.startsWith('react_') && state.reactionUntil > 0 ? state.lastInteractionAt : 0);
        const startedAt = Number.isFinite(onset) && onset > 0 ? onset : 0;
        if (planned?.status === 'running')
            return { activityId: planned.operationId, kind: state.kind, startedAt, ...animation,
                phase: bodyPhaseOf(planned.phase) };
        const requested = task && (!task.completedAt || (state.asleep && task.action === 'sleep')) ? task.id : undefined;
        const automatic = state.route ? 'body:' + digest([state.route.departAt, state.route.arriveAt, state.route.target]) :
            state.dwell ? 'body:' + digest([state.dwell.until, state.dwell.target]) : state.asleep ? 'sleep:' + String(state.sleepStartedAt || 'unknown') : null;
        const currentActivityId = state.route?.target?.gardenJobId ?? state.dwell?.target?.gardenJobId ?? requested ?? automatic;
        return { activityId: currentActivityId,
            kind: state.kind, startedAt, ...animation,
            phase: state.route ? 'moving' : state.asleep ? 'sleeping' : state.sleepPending || state.freeTarget || state.command ? 'pending' :
                state.dwell || state.reactionUntil > Date.now() ? 'working' : task?.completedAt ? 'completed' : 'idle' };
    }
    publicBehavior(her) {
        return { ...this.activity(), busy: companionBusy(her), revision: this.revision, bootId: this.bootId };
    }
    behaviorHome(home, behavior = this.publicBehavior(home.her)) {
        return { ...home, behavior: { ...behavior } };
    }
    publish(reason = 'transition', notifyFirst = reason === 'transition') {
        const bound = this.binding;
        if (!bound || this.closed || !this.living.isCurrent())
            return;
        if (reason === 'observation' && this.deadlineAt !== undefined && Date.now() >= this.deadlineAt) {
            reason = 'transition';
            this.deadlineAt = undefined;
        }
        try {
            const { updatedAt: _updated, lastTickAt: _tick, ...semantic } = bound.room.state;
            // This is an internal projection of the existing JSON save, not an
            // admission path. Keep Core's strict validation of incoming data intact.
            // Domain history may exceed the incoming Core payload budget. Hash the
            // program-owned JSON save directly without admitting it as a new request
            // or deleting operation/fact receipts needed for replay protection.
            const home = bound.room.view(), activity = this.activity();
            const details = [activity, this.autonomous, home.emotion ?? null, this.expression ?? null];
            const persisted = JSON.stringify([semantic, ...details]);
            // Reuse the existing public Body projection; saved metrics stay full precision.
            const visibleState = { ...semantic, needs: home.body };
            const presentation = [visibleState, ...details];
            const presentationFingerprint = createHash('sha256').update(JSON.stringify(presentation)).digest('hex');
            const fingerprint = 'sha256:' + createHash('sha256').update(persisted).digest('hex');
            const changed = fingerprint !== bound.fingerprint;
            const visibleChanged = presentationFingerprint !== bound.presentationFingerprint;
            const hadProjection = bound.presentationFingerprint !== undefined;
            if (changed) {
                bound.fingerprint = fingerprint;
                this.revision++;
            }
            if (visibleChanged) {
                bound.presentationFingerprint = presentationFingerprint;
                const receipts = new Set(Object.values(semantic.interactionReceipts ?? {}));
                // A first read may lazily create the empty execution table.
                const emptyExecutions = semantic.plannedExecutions && Object.keys(semantic.plannedExecutions).length === 0;
                const worldFingerprint = receipts.size || emptyExecutions ? createHash('sha256').update(JSON.stringify(presentation, function (key, value) {
                    if (key === 'acknowledged' && receipts.has(this))
                        return undefined;
                    if (key === 'plannedExecutions' && this === visibleState && emptyExecutions)
                        return undefined;
                    return value;
                })).digest('hex') : presentationFingerprint;
                const worldChanged = worldFingerprint !== bound.worldFingerprint;
                bound.worldFingerprint = worldFingerprint;
                if (bound.scope && worldChanged && (hadProjection || notifyFirst))
                    this.living.changed(bound.scope, true);
            }
            if (!this.publicationFault && (!changed || reason === 'observation' && !visibleChanged))
                return;
            this.ctx.emit('pet/behavior.changed', { workspaceId: bound.id, bootId: this.bootId, revision: this.revision, reason });
            this.publicationFault = undefined;
        }
        catch (error) {
            // Body work and its durable receipt have already committed. A failed
            // observer must be visible without turning that result into a retry.
            const message = String(error);
            const changed = message !== this.publicationFault;
            this.publicationFault = message;
            if (changed) {
                try {
                    this.ctx.logger?.warn?.('Body presentation update failed; execution receipt retained', error);
                }
                catch { /* Snapshot still exposes the fault if logging is unavailable. */ }
            }
        }
    }
    presentationVersion() { return { bootId: this.bootId, revision: this.revision }; }
    currentBound(workspaceId) {
        const status = this.host.workspace.status(), bound = this.binding;
        return !this.closed && this.living.isCurrent() && bound?.id === workspaceId && status.state === 'ready' && status.target?.id === workspaceId &&
            status.target.path === bound.path && this.host.workspace.storageId() === bound.storageId ? bound : undefined;
    }
    async refreshEmotion(workspaceId) {
        // The synchronous room projection only exposes the exact version validated
        // by read(). Refresh before decisions/disclosure, including after reload and
        // corrections while no Emotion listener was mounted.
        await this.ctx.get('petEmotion')?.read?.(workspaceId);
    }
    promptLine(workspaceId) {
        const bound = this.currentBound(workspaceId);
        if (!bound)
            return '';
        const rest = this.restState(workspaceId);
        return buildHomePromptLine(gardenHomeProjection(bound.room.state), { now: Date.now(), allowActivity: true })
            + `\n【身体睡眠回执】${rest.sleeping ? '已入睡' : rest.pending ? '尚未入睡，正在执行睡觉安排' : '未入睡，且没有待执行的睡觉安排'}。睡觉须实际提交 body/sleep；hold 和闹钟都不会自动入睡。`;
    }
    restState(workspaceId) {
        const bound = this.currentBound(workspaceId);
        if (!bound)
            return;
        return { sleeping: bound.room.state.asleep === true, pending: bound.room.state.sleepPending === true };
    }
    snapshot(workspaceId) {
        return this.enqueue(async (validate) => {
            const before = this.checked(workspaceId);
            await this.refreshEmotion(workspaceId);
            validate();
            const bound = this.checked(workspaceId);
            if (bound !== before)
                throw Error('身体工作区已切换');
            const execution = JSON.stringify(bound.room.plannedState());
            this.advanceRoom(bound);
            this.publish(execution === JSON.stringify(bound.room.plannedState()) ? 'observation' : 'transition');
            const home = this.behaviorHome(bound.room.view());
            const { revision, bootId, ...behavior } = home.behavior;
            return { workspaceId, storageId: bound.storageId, bootId, revision,
                autonomyEnabled: this.autonomous, behavior, home, needs: structuredClone(bound.room.state.needs), presentation: behaviorPresentation(home, this.expression), fault: this.fault ?? this.publicationFault ?? null,
                ...(bound.room.plannedState() ? { planned: bound.room.plannedState() } : {}) };
        });
    }
    worldSnapshot(workspaceId) { return this.living.worldSnapshot(this.host, workspaceId); }
    worldCommands = {
        care: ({ action, ...request }, options) => this.living.command(this.host, request, options, async ({ effect }) => {
            check(isCareAction(action), '未知的身体动作');
            text(request.requestId, 'request id', 256);
            try {
                const { changed } = await this.act(request.workspaceId, action, request.requestId, undefined, effect);
                return { changed };
            }
            catch (error) {
                // The legacy Body receipt reports fingerprint conflict before applying anything.
                if (error instanceof Error && error.message === '同一互动请求不能用于不同内容') {
                    effect('none');
                    reject('CONFLICT', error.message);
                }
                throw error;
            }
        }),
    };
    roomState(workspaceId) {
        return this.snapshot(workspaceId).then(value => ({ ...value.home, lifeEnabled: value.autonomyEnabled,
            identity: { displayName: this.host.workspace.runtime.identity().displayName },
            autonomyEnabled: value.autonomyEnabled, presentation: value.presentation,
            behavior: value.home.behavior }));
    }
    roomAction(workspaceId, input, by = '伙伴', interaction, recordEffect) {
        return this.enqueue(async (validate) => {
            const before = this.checked(workspaceId);
            await this.refreshEmotion(workspaceId);
            validate();
            const bound = this.checked(workspaceId);
            if (bound !== before)
                throw Error('身体工作区已切换');
            this.expression = undefined;
            this.advanceRoom(bound);
            const config = this.host.workspace.runtime?.config;
            const source = interaction ?? { requestId: randomUUID(), actor: { kind: by === '大肥鱼' ? 'companion' : 'owner',
                    id: by === '大肥鱼' ? (config?.companionId ?? 'companion') : (config?.ownerActorId ?? 'owner'), channel: 'room' } };
            recordEffect?.('unknown');
            const result = bound.room.act(input, by, Date.now(), source);
            recordEffect?.('partial');
            this.publish();
            const behavior = this.publicBehavior(result.home.her);
            const home = this.behaviorHome(result.home, behavior);
            return { ...result, home: { ...home, presentation: behaviorPresentation(home, this.expression) }, behavior };
        });
    }
    act(workspaceId, action, requestId = randomUUID(), channel = 'desktop', recordEffect) {
        if (!isCareAction(action))
            return Promise.reject(Error('未知的身体动作'));
        return this.roomAction(workspaceId, { action }, '主人', { requestId, actor: { kind: 'owner', id: this.host.workspace.runtime?.config?.ownerActorId ?? 'owner', channel } }, recordEffect);
    }
    pendingFacts(workspaceId) { return this.enqueue(() => this.checked(workspaceId).room.pendingFacts()); }
    readFacts(workspaceId, ids) { return this.enqueue(() => this.checked(workspaceId).room.readFacts(ids)); }
    acknowledgeFacts(workspaceId, ids) {
        return this.enqueue(() => { this.checked(workspaceId).room.acknowledgeFacts(ids); });
    }
    garden(workspaceId, operation, input) {
        return this.enqueue(async (validate) => {
            const before = this.checked(workspaceId);
            await this.refreshEmotion(workspaceId);
            validate();
            const bound = this.checked(workspaceId);
            if (bound !== before)
                throw Error('身体工作区已切换');
            const execution = JSON.stringify(bound.room.plannedState());
            const result = bound.room.garden(operation, input);
            this.publish(operation === 'state' && execution === JSON.stringify(bound.room.plannedState()) ? 'observation' : 'transition');
            const home = 'home' in result ? result.home : undefined;
            const behavior = this.publicBehavior((home || bound.room.view()).her);
            return { ...result, behavior, ...(home ? { home: this.behaviorHome(home, behavior) } : {}) };
        });
    }
    setAutonomy(workspaceId, enabled) {
        return this.enqueue(async (validate) => {
            const before = this.checked(workspaceId);
            await this.refreshEmotion(workspaceId);
            validate();
            const bound = this.checked(workspaceId);
            if (bound !== before)
                throw Error('身体工作区已切换');
            const admission = enabled ? this.living.get('plan')?.bodyClockState?.(workspaceId) : undefined;
            bound.room.setAutonomy(enabled, Date.now(), admission?.restoreElapsed);
            this.autonomous = enabled;
            this.publish();
        });
    }
    gardenClockState(workspaceId) {
        return this.currentBound(workspaceId)?.room.gardenClockState();
    }
    plannedCall(workspaceId, work, validate = () => { }, observation = false) {
        return this.enqueue(async (admit) => {
            const before = this.checked(workspaceId);
            await this.refreshEmotion(workspaceId);
            admit();
            const bound = this.checked(workspaceId);
            if (bound !== before)
                throw Error('身体工作区已切换');
            validate();
            const execution = JSON.stringify(bound.room.plannedState()), result = work(bound.room);
            this.awaitingRecovery = false;
            this.publish(observation && execution === JSON.stringify(bound.room.plannedState()) ? 'observation' : 'transition');
            return result;
        });
    }
    consumeFood(workspaceId, input, validate = () => { }) {
        return this.plannedCall(workspaceId, room => room.consumeFood(input), validate);
    }
    readPlannedSegment(workspaceId, operationId, validate = () => { }) {
        return this.plannedCall(workspaceId, room => room.readPlannedSegment(operationId), validate);
    }
    confirmPlannedReading(workspaceId, operationId, receiptToken, validate = () => { }, recordEffect) {
        return this.plannedCall(workspaceId, room => {
            // The room reaches the Economy port synchronously, after checking the original reading.
            this.readingConfirmationEffect = recordEffect;
            try {
                return room.confirmPlannedReading(operationId, receiptToken);
            }
            finally {
                this.readingConfirmationEffect = undefined;
            }
        }, validate);
    }
    startPlanned(workspaceId, input) {
        return this.plannedCall(workspaceId, room => room.startPlanned(input));
    }
    inspectPlanned(workspaceId, operationId) {
        return this.plannedCall(workspaceId, room => room.inspectPlanned(operationId), () => { }, true);
    }
    pausePlanned(workspaceId, operationId) {
        return this.plannedCall(workspaceId, room => room.pausePlanned(operationId));
    }
    resumePlanned(workspaceId, operationId) {
        return this.plannedCall(workspaceId, room => room.resumePlanned(operationId));
    }
    cancelPlanned(workspaceId, operationId) {
        return this.plannedCall(workspaceId, room => room.cancelPlanned(operationId));
    }
    close() {
        if (this.closing)
            return this.closing;
        this.closed = true;
        clearTimeout(this.timer);
        this.timer = undefined;
        this.deadlineAt = undefined;
        return this.closing = settleCleanup(...this.subscriptions.splice(0), async () => {
            await this.serial;
            const writable = this.binding && this.host.workspace.status().state !== 'migration-required';
            try {
                if (writable)
                    this.binding?.room.suspendAutonomy();
            }
            finally {
                try {
                    if (writable)
                        this.binding?.room.flush();
                }
                finally {
                    this.binding = undefined;
                    if (owners.get(this.host) === this)
                        owners.delete(this.host);
                }
            }
        });
    }
}
export const name = '25-Behavior';
export const inject = ['petCore'];
export function apply(ctx) {
    const host = ctx.petCore;
    return mountLivingArea(ctx, host, 'body', view => new CompanionBehavior(ctx, host, view), (behavior, view) => {
        behavior.activate();
        ctx.provide('petBehavior', behavior);
        const ports = host.native?.companionPorts;
        if (ports?.scopeFor(ctx, 'petBehavior'))
            return ports.register('bodyAvailable', () => view.lookup('body')?.value === behavior).revoke;
    });
}
//# sourceMappingURL=plugin.js.map