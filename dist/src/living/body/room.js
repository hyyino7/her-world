import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME_ACTIONS, HOME_LAYOUT, HOME_TOUCH_REACTION_MS, advanceHomeState, nextHomeBoundary, applyCatalogFood, applyHomeAction, beginPlannedHomeActivity, pausePlannedHomeActivity, resumePlannedHomeActivity, homeView, normalizeHomeState, saveHomeState } from '#feiyu-home';
import { createGardenCaretaker, nextGardenCareBoundary } from '#feiyu-room/garden-autonomy';
import { actGarden, loadGarden, saveGarden } from '#feiyu-room/garden-store';
import { advanceGarden, applyGardenAction, gardenView } from '#feiyu-garden';
import { advanceGardenClock } from '../economy/garden-clock.js';
import { LifeControlFileError } from '../plan/control-file.js';
import { applyRoomAction, normalizeRoomState, roomView } from '#feiyu-room/room-state';
import { randomUUID } from 'node:crypto';
import { initialBodyState } from './initial-state.js';
import { BODY_METRICS, BODY_METRIC_NAMES, FEEDBACK_ACTIONS, ROLE_ACTIONS, PLAN_KINDS, isPlanKind, isPlanBodyAction, isPlanEconomyOperation, isPlanGardenOperation, PlannedAdmissionWaitError } from '../../contracts/behavior.js';
import { requirePresentationSlot, animationSlotAllowed } from './animation-slots.js';
import { canonical, digest } from '../../core/storage.js';
import { gardenHomeProjection, gardenReceiptProjection, gardenReceiptText } from './garden-receipt.js';
// 离线时饥饿、口渴和如厕需求有上限，体力有单独的 energyFloor，疼痛不随离线时间变化。
const offlineNeedMetrics = BODY_METRIC_NAMES.filter(metric => BODY_METRICS[metric] === 'ceiling');
const terminalExecution = new Set(['completed', 'cancelled', 'failed']);
const validatePlannedFields = {
    hold(input) {
        if (input.room !== undefined || input.spot !== undefined)
            throw Error('原地活动不能指定移动目标');
    },
    // Room and move only need the shared target check.
    room() { },
    move() { },
    garden(input) {
        if (!input.garden || !isPlanGardenOperation(String(input.garden.type)))
            throw Error('菜园计划须指定一项明确操作');
    },
    body(input) {
        if (!isPlanBodyAction(input.action))
            throw Error('身体计划须指定已有的身体动作');
    },
    economy(input) {
        const transaction = input.economy;
        if (!transaction || !isPlanEconomyOperation(transaction.type) || typeof transaction.itemId !== 'string' || !transaction.itemId.trim()
            || !Number.isSafeInteger(transaction.quantity) || transaction.quantity <= 0 || transaction.type === 'consume' && transaction.quantity !== 1)
            throw Error('经济计划须给出有效目录物品、明确操作及整数数量；每次食用一份');
    },
    read(input) {
        if (!input.reading || typeof input.reading.itemId !== 'string' || !input.reading.itemId.trim()
            || !Number.isSafeInteger(input.reading.segment) || input.reading.segment < 0)
            throw Error('阅读计划须指定已持有读物及实际片段编号');
    },
};
function safeFile(file) {
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (stat && (!stat.isFile() || stat.nlink !== 1))
        throw Error('生活数据文件无效，已保留原文件');
    return Boolean(stat);
}
function record(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw Error('动作格式无效');
    return input;
}
const companionActions = new Set(ROLE_ACTIONS);
const feedbackActions = FEEDBACK_ACTIONS;
/** All callers enter through CompanionBehavior's serialized workspace binding.
 * The caretaker checkpoints motion and receipt-bearing garden jobs itself. */
export class CompanionRoom {
    emotion;
    economy;
    offlinePolicy;
    lifeClock;
    state;
    dirty = false;
    homeFile;
    gardenFile;
    caretaker;
    autonomous = false;
    economyFault;
    economyBlocked = false;
    lastUnavailableCheckpoint = 0;
    returningFromInteraction = false;
    acceptingFoodInteraction;
    constructor(directory, emotion, economy = () => undefined, offlinePolicy = () => ({ hours: 4, needCeiling: .7, energyFloor: .35 }), lifeClock = () => undefined) {
        this.emotion = emotion;
        this.economy = economy;
        this.offlinePolicy = offlinePolicy;
        this.lifeClock = lifeClock;
        this.homeFile = join(directory, 'home.json');
        this.gardenFile = join(directory, 'garden.json');
        if (safeFile(this.homeFile)) {
            const saved = record(JSON.parse(readFileSync(this.homeFile, 'utf8')));
            // Missing creation metadata would enter the upstream demonstration-story
            // fallback. Preserve such a save for inspection instead of inventing one.
            if (!Number.isFinite(Number(saved.createdAt)) || Number(saved.createdAt) <= 0)
                throw Error('身体存档缺少有效创建时间，原文件已保留');
            this.state = normalizeHomeState(saved);
            if (this.state.gardenClockEnabled !== undefined && typeof this.state.gardenClockEnabled !== 'boolean')
                throw Error('菜园时钟状态无效，原文件已保留');
            const window = this.state.offlineBodyWindow;
            if (window && (![window.startAt, window.endAt, window.negativeUntil].every(Number.isFinite)
                || window.endAt < window.startAt || window.negativeUntil < window.startAt
                || ![window.energyFloor, ...offlineNeedMetrics.map(key => window.needCeilings?.[key])]
                    .every(value => Number.isFinite(value) && value >= 0 && value <= 1)))
                throw Error('离线身体时间窗口无效，原文件已保留');
        }
        else {
            this.state = initialBodyState();
            this.checkpoint(this.state);
        }
        this.caretaker = createGardenCaretaker({
            homeFile: this.homeFile, gardenFile: this.gardenFile, getEnv: () => ({ emotion: this.emotion(),
                // Life owns goal selection. Physics and natural time keep their own
                // admission, independently of the retired reference goal generators.
                autonomy: false, passive: this.autonomous, goalPolicy: 'planned' }),
            storage: {
                loadHomeState: (_file, now) => normalizeHomeState(this.state, now),
                saveHomeState: (_file, state, now) => this.checkpoint(state, now),
                loadGarden: (_file, now = Date.now()) => this.loadGardenState(now),
                saveGarden: (_file, state) => this.saveGardenState(state),
            },
        });
    }
    economyPort() {
        let port;
        try {
            port = this.economy(this.gardenFile);
            if (port) {
                this.economyFault = undefined;
                this.economyBlocked = false;
            }
        }
        catch (error) {
            // A failed first migration is not proof that a new authority committed.
            // Fail closed in this runtime and let a later successful attempt retry.
            this.economyFault = String(error);
            this.economyBlocked = true;
            return;
        }
        if (port && this.state.economyGardenAuthority !== true) {
            const next = structuredClone(this.state);
            next.economyGardenAuthority = true;
            // Once accepted, optional-service loss can never reopen the old JSON wallet.
            this.checkpoint(next);
        }
        return port;
    }
    gardenAuthorityUnavailable() { return this.state.economyGardenAuthority === true || this.economyBlocked; }
    requireEconomy() {
        const port = this.economyPort();
        if (!port)
            throw Error(this.economyFault || '经济组件暂不可用，原交易与库存保留，等待恢复');
        return port;
    }
    loadGardenState(now = Date.now()) {
        const clock = this.gardenClock();
        const port = this.economyPort();
        if (!port && this.gardenAuthorityUnavailable())
            throw Error('经济组件暂不可用，菜园保留并等待恢复');
        try {
            if (port)
                return port.loadGarden(now, clock);
            safeFile(this.gardenFile);
            return advanceGardenClock(loadGarden(this.gardenFile, now), now, clock, advanceGarden);
        }
        catch (error) {
            if (port) {
                this.economyBlocked = true;
                this.economyFault = String(error);
            }
            throw error;
        }
    }
    /** Undefined means clock intent has not been restored, never an owner pause.
     * Keep elapsed crop time until an explicit admission establishes otherwise. */
    gardenClockState() { return this.state.gardenClockEnabled; }
    gardenClock() {
        const clock = this.lifeClock();
        return clock?.pauses !== undefined ? clock : { enabled: this.gardenClockState() !== false };
    }
    saveGardenState(state, now = Date.now()) {
        const port = this.economyPort();
        if (port) {
            try {
                return port.saveGarden(state, now);
            }
            catch (error) {
                this.economyBlocked = true;
                this.economyFault = String(error);
                throw error;
            }
        }
        if (this.gardenAuthorityUnavailable())
            throw Error('经济组件暂不可用，不能向旧菜园存档写入');
        safeFile(this.gardenFile);
        return saveGarden(this.gardenFile, state);
    }
    gardenUnavailable(now, clockFault) {
        const parked = this.currentExecution();
        if (parked && ['paused', 'interrupted', 'cancelled'].includes(parked.status) && parked.kind !== 'garden'
            && !(parked.status === 'cancelled' && parked.kind === 'economy') && !parked.parkedAt)
            this.parkExecution(parked, now, parked.status === 'cancelled');
        const target = this.state.route?.target ?? this.state.dwell?.target;
        if (target?.gardenJobId) {
            this.state = pausePlannedHomeActivity(this.state, target.gardenJobId, now);
            this.checkpoint(this.state, now);
        }
        const physical = this.currentExecution();
        const physicalTarget = this.state.route?.target ?? this.state.dwell?.target;
        if (physical?.status === 'running' && ['body', 'hold', 'room', 'move'].includes(physical.kind) && physical.phase === 'pending'
            && (physical.resuming || physicalTarget?.plannedOperationId !== physical.operationId))
            this.dispatchExecution(physical, now, physical.resuming === true);
        const arrivalRoute = this.state.route;
        const advanced = advanceHomeState(this.state, now, { emotion: this.emotion(), autonomy: false, passive: this.autonomous, goalPolicy: 'planned', gardenReady: false });
        this.state = advanced.state;
        if (advanced.changed)
            this.dirty = true;
        const planned = this.currentExecution();
        if (planned?.status === 'running' && (planned.kind === 'garden' || !clockFault && ['economy', 'read'].includes(planned.kind))
            && (planned.phase !== 'waiting' || planned.awaitingInput !== undefined || clockFault && planned.reason !== clockFault.message))
            this.updateExecution(planned, { phase: 'waiting', reason: clockFault?.message ?? '经济组件暂不可用，保留原执行编号并等待恢复', awaitingInput: undefined }, now);
        const current = this.currentExecution(), active = this.state.route?.target ?? this.state.dwell?.target;
        if (current?.status === 'running' && current.kind === 'body' && current.effectAppliedAt && (current.input.action !== 'sleep' || this.state.asleep))
            this.updateExecution(current, { status: 'completed', phase: 'completed' }, now);
        else if (current?.status === 'running' && ['hold', 'room', 'move'].includes(current.kind)) {
            if (current.kind === 'move' && this.completeMove(current, now)) {
                // Arrival owns completion even when Economy is unavailable.
            }
            else if (active?.plannedOperationId === current.operationId) {
                const phase = this.state.route ? 'moving' : 'working', arrival = this.roomArrival(current, arrivalRoute);
                if (current.phase !== phase || Object.keys(arrival).length)
                    this.updateExecution(current, { phase, ...arrival }, now);
            }
            else
                this.updateExecution(current, current.until && now >= Date.parse(current.until)
                    ? { status: 'completed', phase: 'completed' } : { status: 'interrupted', phase: 'waiting', reason: '身体活动已被其他安排接手' }, now);
        }
        const request = this.state.companionAction;
        if (request && !request.completedAt && !this.requestedActive(now)) {
            request.completedAt = now;
            this.checkpoint(this.state, now);
        }
        if (this.dirty && now - this.lastUnavailableCheckpoint >= 20_000) {
            this.checkpoint(this.state, now);
            this.lastUnavailableCheckpoint = now;
        }
        return { unavailable: true, status: 'waiting', message: clockFault?.message ?? (this.economyFault || '经济组件暂不可用，菜园及原任务保留并等待恢复') };
    }
    requestedActive(now = Date.now()) {
        return this.state.companionAction && !this.state.companionAction.completedAt &&
            Boolean(this.state.route || this.state.dwell || this.state.sleepPending || this.state.freeTarget ||
                this.state.command || this.state.reactionUntil > now);
    }
    stopAutomatic(now) {
        if (this.requestedActive(now) || this.state.route?.target?.gardenJobId || this.state.dwell?.target?.gardenJobId || this.currentExecution())
            return;
        if (this.state.route || this.state.dwell || this.state.sleepPending) {
            this.state.route = null;
            this.state.dwell = null;
            this.state.sleepPending = false;
            this.state.walking = false;
            if (!this.state.asleep) {
                this.state.kind = 'idle';
                this.state.activity = '自主活动已暂停';
            }
            this.checkpoint(this.state, now);
        }
    }
    setAutonomy(enabled, now = Date.now(), preserveElapsed = false) {
        const admitted = this.gardenClockState();
        if (enabled === this.autonomous && admitted === enabled)
            return;
        const restoreElapsed = enabled && (preserveElapsed || admitted === true);
        // Settle the active interval before pausing; discard disabled time before
        // an explicit enable, except an admitted enabled-restart restoration.
        if (this.autonomous) {
            const garden = this.tick(now);
            // Ordinary active reads may remain projections. A pause is a boundary:
            // retain that active interval before disabled time starts being discarded.
            if (garden?.unavailable !== true)
                this.saveGardenState(advanceGarden(this.loadGardenState(now), now), now);
        }
        else if (!restoreElapsed) {
            if (admitted !== true)
                this.state.gardenClockEnabled = false;
            this.tick(now);
        }
        else if (enabled && now > this.state.lastTickAt) {
            const previous = this.state.offlineBodyWindow;
            if (previous && this.state.lastTickAt < previous.endAt)
                previous.endAt = Math.max(previous.endAt, now);
            else {
                const policy = this.offlinePolicy(), startAt = this.state.lastTickAt;
                this.state.offlineBodyWindow = { startAt, endAt: now, negativeUntil: startAt + policy.hours * 3_600_000,
                    needCeilings: Object.fromEntries(offlineNeedMetrics.map(key => [key, policy.needCeiling])),
                    energyFloor: policy.energyFloor };
            }
            // The same durable window survives any later partial checkpoint/restart.
            // Reads never open another window and no new activity is selected here.
            this.checkpoint(this.state, now);
        }
        this.state.gardenClockEnabled = enabled;
        this.checkpoint(this.state, now);
        this.autonomous = enabled;
        if (!enabled)
            this.stopAutomatic(now);
        this.tick(now);
        this.flush();
    }
    /** Component disposal stops this executor, not the saved owner's clock.
     * Settle before releasing it so a replacement cannot lose projected growth. */
    suspendAutonomy(now = Date.now()) {
        if (this.autonomous) {
            const garden = this.tick(now);
            if (garden?.unavailable !== true)
                this.saveGardenState(advanceGarden(this.loadGardenState(now), now), now);
        }
        this.autonomous = false;
        this.stopAutomatic(now);
        this.flush();
    }
    checkpoint(state, now) {
        safeFile(this.homeFile);
        if (state.visitors)
            state.visitors.lamp = state.lamp && !state.asleep;
        try {
            this.state = saveHomeState(this.homeFile, state, now);
        }
        catch (error) {
            // Some retained executor transitions mutate their in-memory record before
            // reaching this shared commit seam. Restore the actual previous file on
            // failure so a later read cannot publish an uncommitted completion/fact.
            if (safeFile(this.homeFile))
                this.state = normalizeHomeState(JSON.parse(readFileSync(this.homeFile, 'utf8')), now);
            throw error;
        }
        this.dirty = false;
        return this.state;
    }
    flush() { if (this.dirty)
        this.checkpoint(this.state); }
    nextWakeAt(now = Date.now(), conditions = []) {
        const physical = nextHomeBoundary(this.state, now, this.autonomous ? conditions : [], this.autonomous), candidates = [];
        if (physical !== null)
            candidates.push(physical);
        const current = this.currentExecution();
        if (current?.status === 'running' && current.until && Date.parse(current.until) > now)
            candidates.push(Date.parse(current.until));
        if (this.state.interactionReturn && Number(this.state.reactionUntil) > now)
            candidates.push(Number(this.state.reactionUntil));
        try {
            const garden = this.loadGardenState(now), at = nextGardenCareBoundary(garden, this.state, now, { autonomy: false, goalPolicy: 'planned' });
            if (at !== null)
                candidates.push(at);
        }
        catch { /* Optional authority recovery is driven by service lifecycle events. */ }
        return candidates.length ? Math.min(...candidates) : null;
    }
    interactions(state = this.state) {
        const rows = state.interactionReceipts;
        if (rows !== undefined && (!rows || typeof rows !== 'object' || Array.isArray(rows)))
            throw Error('互动事实存档无效，已保留原文件');
        return state.interactionReceipts ??= {};
    }
    interaction(input, source) {
        if (!source.requestId || source.requestId.length > 256 || !source.actor.id || !source.actor.channel)
            throw Error('互动来源无效');
        canonical(source);
        const key = digest(source.requestId), fingerprint = digest({ input, actor: source.actor });
        const prior = this.interactions()[key];
        if (prior && prior.fingerprint !== fingerprint)
            throw Error('同一互动请求不能用于不同内容');
        return { key, fingerprint, prior };
    }
    interactionFact(input, source) {
        const { prior } = this.interaction(input, source);
        if (prior)
            return structuredClone(prior.fact);
    }
    pendingFacts() {
        return Object.values(this.interactions()).filter(row => !row.acknowledged).map(row => structuredClone(row.fact));
    }
    readFacts(ids) {
        const facts = new Map(Object.values(this.interactions()).map(row => [row.fact.id, row.fact]));
        return ids.map(id => { const fact = facts.get(id); if (!fact)
            throw Error('原互动事实不存在，保留投递状态等待核对'); return structuredClone(fact); });
    }
    acknowledgeFacts(ids) {
        const selected = new Set(ids), next = structuredClone(this.state);
        let changed = false;
        for (const row of Object.values(this.interactions(next)))
            if (selected.has(row.fact.id) && !row.acknowledged) {
                row.acknowledged = true;
                changed = true;
            }
        if (changed)
            this.checkpoint(next);
    }
    forgetInteractionReturn() {
        const id = this.state.interactionReturn;
        if (typeof id === 'string') {
            const row = this.executions()[id];
            if (row)
                delete row.resumeAfterInteraction;
            delete this.state.interactionReturn;
        }
    }
    returnFromInteraction(now) {
        const id = this.state.interactionReturn;
        if (this.returningFromInteraction || !this.autonomous || typeof id !== 'string')
            return;
        const row = this.executions()[id], current = this.currentExecution();
        if (!row || !row.resumeAfterInteraction || terminalExecution.has(row.status)) {
            this.forgetInteractionReturn();
            this.checkpoint(this.state, now);
            return;
        }
        if (current && current.operationId !== id && !terminalExecution.has(current.status) || this.requestedActive(now))
            return;
        this.returningFromInteraction = true;
        try {
            const result = this.resumePlanned(id, now);
            if (result.status === 'running' || terminalExecution.has(result.status)) {
                this.forgetInteractionReturn();
                this.checkpoint(this.state, now);
            }
        }
        finally {
            this.returningFromInteraction = false;
        }
    }
    executions() {
        const rows = this.state.plannedExecutions;
        if (rows !== undefined && (!rows || typeof rows !== 'object' || Array.isArray(rows)))
            throw Error('计划执行记录无效，原文件已保留');
        return this.state.plannedExecutions ??= {};
    }
    currentExecution() {
        const id = this.state.currentPlannedOperation;
        return typeof id === 'string' ? this.executions()[id] : undefined;
    }
    publicExecution(row) {
        const { input: _input, fingerprint: _fingerprint, pausedAt: _pausedAt, remainingMs: _remainingMs, parkedAt: _parkedAt, resuming: _resuming, effectAppliedAt: _effectAppliedAt, effectDeclinedAt: _effectDeclinedAt, settlementCompletedAt: _settlementCompletedAt, executionStartedAt: _executionStartedAt, presentationBaseAt: _presentationBaseAt, pausedMs: _pausedMs, presentationFreeze: _presentationFreeze, interaction: _interaction, ...value } = row;
        const completion = row.kind === 'move' ? 'arrival' : ['room', 'hold'].includes(row.kind) ? row.until ? 'deadline' : 'explicit-control' : 'receipt';
        return structuredClone({ ...value, ...(row.kind === 'garden' && value.reason ? { reason: gardenReceiptText(value.reason) } : {}), completion, ...(row.status === 'running' && row.phase === 'working' && completion === 'explicit-control'
                ? { reason: '已就位，持续活动等待明确调整或取消；不会因到达或下次考虑时间自动结束，后续步骤尚未开始。' } : {}) });
    }
    updateExecution(row, values, now) {
        // Optional fields cleared by a transition must be absent in memory as
        // well as on disk. JSON.stringify omits undefined, but keeps the caller's
        // object alive; retaining it would break strict semantic fingerprints.
        const fields = row;
        for (const [key, value] of Object.entries(values)) {
            if (value === undefined)
                delete fields[key];
            else
                fields[key] = value;
        }
        row.updatedAt = new Date(now).toISOString();
        if (['completed', 'failed'].includes(row.status) && this.state.currentPlannedOperation === row.operationId)
            this.state.currentPlannedOperation = null;
        this.checkpoint(this.state, now);
    }
    parkExecution(row, now, cancel = false) {
        if (row.parkedAt || this.consoleFoodPending(row))
            return;
        if (row.kind === 'garden') {
            let result;
            try {
                if (this.economyPort() || !this.gardenAuthorityUnavailable())
                    result = this.caretaker.control({ type: cancel ? 'cancel' : 'pause', requestId: row.operationId }, now);
            }
            catch (error) {
                if (!(error instanceof LifeControlFileError))
                    throw error;
            }
            if (!result) {
                const target = this.state.route?.target ?? this.state.dwell?.target;
                this.state = pausePlannedHomeActivity(this.state, target?.gardenJobId || row.operationId, now);
                this.checkpoint(this.state, now);
                return;
            }
            if (!result.ok && !['completed', 'cancelled', 'failed'].includes(result.status ?? ''))
                throw Error(result.message);
            if (result.status === 'completed' || result.status === 'failed')
                this.updateExecution(this.executions()[row.operationId], { status: result.status, phase: 'completed', reason: result.message }, now);
            else if (!cancel && result.status === 'cancelled')
                this.updateExecution(this.executions()[row.operationId], { status: 'failed', phase: 'completed', reason: result.message }, now);
        }
        else {
            this.state = pausePlannedHomeActivity(this.state, row.operationId, now);
            if (cancel && row.kind === 'economy' && row.input.economy?.type === 'consume') {
                const port = this.economyPort();
                if (!port) {
                    this.checkpoint(this.state, now);
                    return;
                }
                try {
                    if (row.effectAppliedAt) {
                        const settled = port.finishFood(row.operationId, { operationId: row.operationId, applied: true, bodyReceiptId: row.operationId }, now);
                        if (settled.status !== 'consumed')
                            throw Error('身体效果已保存，仍等待原库存消费结算');
                        row.settlementCompletedAt = now;
                    }
                    else {
                        if (!row.effectDeclinedAt) {
                            row.effectDeclinedAt = now;
                            this.checkpoint(this.state, now);
                        }
                        port.cancelUse(row.operationId, { operationId: row.operationId, applied: false, bodyReceiptId: row.operationId }, now);
                    }
                }
                catch (error) {
                    this.updateExecution(row, { phase: 'waiting', reason: String(error) }, now);
                    return;
                }
            }
        }
        row = this.executions()[row.operationId];
        row.parkedAt = now;
        if (cancel && this.state.currentPlannedOperation === row.operationId)
            this.state.currentPlannedOperation = null;
        this.checkpoint(this.state, now);
    }
    dispatchEconomy(row, now) {
        try {
            const port = this.requireEconomy(), input = row.input.economy;
            if (input.type !== 'consume') {
                const receipt = port.transaction(row.operationId, { ...input, type: input.type }, now);
                this.updateExecution(row, { status: receipt.status === 'completed' ? 'completed' : receipt.status === 'failed' ? 'failed' : 'running',
                    phase: receipt.status === 'waiting' ? 'waiting' : 'completed', reason: receipt.message }, now);
                return;
            }
            let reservation = port.inspectUse(row.operationId);
            // The durable Body effect is the only permission to settle a reservation.
            if (row.effectAppliedAt) {
                if (!reservation) {
                    this.updateExecution(row, { phase: 'waiting', reason: '原身体效果已记录，但库存预留回执缺失；等待核对原编号' }, now);
                    return;
                }
                if (reservation.status === 'cancelled') {
                    this.updateExecution(row, { phase: 'waiting', reason: '身体效果与已取消的库存预留冲突；保留原回执等待核对' }, now);
                    return;
                }
                reservation = port.finishFood(row.operationId, { operationId: row.operationId, applied: true, bodyReceiptId: row.operationId }, now);
                this.updateExecution(row, reservation.status === 'consumed' ? { status: 'completed', phase: 'completed', reason: undefined, settlementCompletedAt: now }
                    : { phase: 'waiting', reason: '身体效果已保存，等待原库存消费回执' }, now);
                return;
            }
            if (row.effectDeclinedAt) {
                if (reservation?.status === 'reserved')
                    port.cancelUse(row.operationId, { operationId: row.operationId, applied: false, bodyReceiptId: row.operationId }, now);
                this.updateExecution(row, { status: 'failed', phase: 'completed', reason: '原餐食已明确记录为未施效，不重放身体效果' }, now);
                return;
            }
            if (reservation?.status === 'consumed') {
                this.updateExecution(row, { phase: 'waiting', reason: '库存已有结算回执，但身体效果记录缺失；等待核对，不重复进食' }, now);
                return;
            }
            if (reservation?.status === 'cancelled') {
                this.updateExecution(row, { status: 'failed', phase: 'completed', reason: '原库存预留已取消，未重复消费' }, now);
                return;
            }
            if (this.state.route || this.state.dwell || this.state.command || this.state.freeTarget || this.state.sleepPending || this.state.asleep) {
                this.updateExecution(row, reservation ? { phase: 'waiting', reason: this.state.asleep ? '她正在睡觉，请先叫醒；原餐食仍预留，未施加身体效果' : '原餐食仍预留，等待身体当前安排结束再核对' }
                    : { status: 'failed', phase: 'completed', reason: this.state.asleep ? '她正在睡觉，请先叫醒；尚未食用库存餐食' : '身体正在执行其他安排，尚未食用库存餐食' }, now);
                return;
            }
            reservation ??= port.reserveFood(row.operationId, input.itemId, now);
            if (reservation.itemId !== input.itemId || reservation.opId !== row.operationId || reservation.status !== 'reserved') {
                this.updateExecution(row, { phase: 'waiting', reason: '库存预留与原身体执行编号不一致，等待核对' }, now);
                return;
            }
            const before = structuredClone(this.state.needs);
            const result = applyCatalogFood(structuredClone(this.state), { effects: reservation.effects, label: reservation.label, source: input.itemId, at: now });
            if (!result.changed) {
                row.effectDeclinedAt = now;
                this.checkpoint(this.state, now);
                port.cancelUse(row.operationId, { operationId: row.operationId, applied: false, bodyReceiptId: row.operationId }, now);
                this.updateExecution(row, { status: 'failed', phase: 'completed', reason: '身体没有接受库存餐食' }, now);
                return;
            }
            const next = result.state;
            next.plannedExecutions[row.operationId].effectAppliedAt = now;
            next.plannedExecutions[row.operationId].phase = 'waiting';
            next.plannedExecutions[row.operationId].reason = '身体效果已保存，正在核对库存消费回执';
            next.plannedExecutions[row.operationId].updatedAt = new Date(now).toISOString();
            next.companionAction = { id: row.operationId, action: 'catalog-food', itemId: input.itemId, source: 'economy-inventory', startedAt: now, completedAt: 0,
                ...(reservation.presentationSlot && animationSlotAllowed(reservation.presentationSlot, { kind: 'food-item' }) ? { presentationSlot: reservation.presentationSlot } : {}) };
            if (row.interaction) {
                const key = digest(row.interaction.requestId), fact = { version: 1, id: `body:${key}`, requestId: row.interaction.requestId,
                    domain: 'body', type: 'feed', occurredAt: new Date(now).toISOString(), actor: structuredClone(row.interaction.actor), operationId: row.operationId,
                    result: { status: 'completed', summary: `主人给予的${reservation.label}已实际食用，身体效果已保存。`, before, after: structuredClone(next.needs) } };
                this.interactions(next)[key] = { fingerprint: digest({ itemId: input.itemId, actor: row.interaction.actor }), fact, acknowledged: false, changed: true };
            }
            // The catalog effect and applied marker commit in the SAME Body file.
            // Keep the old in-memory state until that atomic checkpoint succeeds.
            this.checkpoint(next, now);
            row = this.executions()[row.operationId];
            reservation = port.finishFood(row.operationId, { operationId: row.operationId, applied: true, bodyReceiptId: row.operationId }, now);
            this.updateExecution(row, reservation.status === 'consumed' ? { status: 'completed', phase: 'completed', reason: undefined, settlementCompletedAt: now }
                : { phase: 'waiting', reason: '身体效果已保存，等待原库存消费回执' }, now);
        }
        catch (error) {
            // An unavailable/ambiguous transaction is never a second intent. Query
            // this same operation ID again; do not reapply an acknowledged effect.
            const original = this.executions()[row.operationId], detail = error?.detail;
            const refused = detail?.effect === 'none' && ['INVALID_ARGUMENT', 'NOT_FOUND', 'INELIGIBLE', 'LIMIT_REACHED', 'DISABLED'].includes(detail.code ?? '');
            if (refused && !original.effectAppliedAt) {
                // A deterministic denial with an explicit no-effect contract can end
                // the intent. Unknown storage/commit outcomes keep the original ID.
                original.effectDeclinedAt ??= now;
                this.checkpoint(this.state, now);
                const port = this.economyPort();
                if (port?.inspectUse(row.operationId)?.status === 'reserved')
                    port.cancelUse(row.operationId, { operationId: row.operationId, applied: false, bodyReceiptId: row.operationId }, now);
                this.updateExecution(original, { status: 'failed', phase: 'completed', reason: String(error) }, now);
            }
            else if (original.phase !== 'waiting' || original.reason !== String(error))
                this.updateExecution(original, { phase: 'waiting', reason: String(error) }, now);
        }
    }
    consoleFoodPending(row, economy) {
        return row.kind === 'economy' && row.input.economy?.type === 'consume'
            && (economy ?? this.economyPort())?.consoleFoodPending?.(row.operationId);
    }
    dispatchReading(row, now, resume) {
        try {
            const receipt = this.requireEconomy().readingStatus(row.operationId, row.input.reading);
            if (receipt.status === 'confirmed') {
                this.state = pausePlannedHomeActivity(this.state, row.operationId, now);
                this.updateExecution(this.executions()[row.operationId], { status: 'completed', phase: 'completed', reason: undefined, awaitingInput: undefined }, now);
                return;
            }
            const target = this.state.route?.target ?? this.state.dwell?.target;
            if (target?.plannedOperationId !== row.operationId) {
                const start = resume ? resumePlannedHomeActivity : beginPlannedHomeActivity;
                this.state = start(this.state, row.input, now);
                this.executions()[row.operationId].executionStartedAt ??= now;
            }
            row = this.executions()[row.operationId];
            const phase = this.state.route ? 'moving' : 'waiting', reason = '等待取得真实文字并明确确认本次片段；阅读动画不推进书签';
            if (row.phase !== phase || row.reason !== reason || row.awaitingInput !== 'reading-content')
                this.updateExecution(row, { phase, reason, awaitingInput: 'reading-content' }, now);
        }
        catch (error) {
            this.updateExecution(this.executions()[row.operationId], { phase: 'waiting', reason: String(error), awaitingInput: undefined }, now);
        }
    }
    dispatchExecution(row, now, resume = false) {
        if (row.kind === 'move' && this.state.asleep) {
            this.updateExecution(row, { status: 'failed', phase: 'completed', reason: '身体正在睡觉，先明确醒来再移动' }, now);
            return;
        }
        if (row.kind === 'economy') {
            this.dispatchEconomy(row, now);
            return;
        }
        if (row.kind === 'read') {
            this.dispatchReading(row, now, resume);
            return;
        }
        if (row.until && Date.parse(row.until) <= now && ['hold', 'room'].includes(row.kind)) {
            this.updateExecution(row, row.executionStartedAt
                ? { status: 'completed', phase: 'completed' }
                : { status: 'failed', phase: 'completed', reason: '活动结束时间已过，身体尚未接收执行，不能标记为已完成' }, now);
            return;
        }
        if (row.kind === 'garden') {
            if (!resume && (this.state.route || this.state.dwell || this.state.command || this.state.freeTarget || this.state.sleepPending)) {
                this.updateExecution(row, { status: 'failed', phase: 'completed', reason: '身体正在执行其他安排，尚未接收这项菜园计划' }, now);
                return;
            }
            // Persistence failures propagate with the durable pending intent intact;
            // they cannot turn an ambiguously committed transaction into a new job.
            const result = this.caretaker.control(resume ? { type: 'resume', requestId: row.operationId }
                : { ...row.input.garden, requestId: row.operationId }, now);
            if (!result.ok) {
                this.updateExecution(this.executions()[row.operationId], { status: 'failed', phase: 'completed', reason: result.message }, now);
                return;
            }
        }
        else if (row.kind === 'body') {
            if (row.effectAppliedAt) {
                // The original effect and receipt committed together. Resume only the
                // outstanding physical sleep transition, never feed/drink twice.
                if (resume && row.input.action === 'sleep' && !this.state.asleep)
                    this.state.sleepPending = true;
            }
            else {
                if (this.state.route || this.state.dwell || this.state.command || this.state.freeTarget || this.state.sleepPending) {
                    this.updateExecution(row, { status: 'failed', phase: 'completed', reason: '身体正在执行其他安排，尚未接收这项身体活动' }, now);
                    return;
                }
                const result = applyHomeAction(this.state, { action: row.input.action, at: now, by: '当前计划', emotion: this.emotion() });
                if (!result.changed && !(['sleep', 'wake'].includes(row.input.action) && this.state.asleep === (row.input.action === 'sleep'))) {
                    this.updateExecution(row, { status: 'failed', phase: 'completed', reason: result.event?.text || '身体没有接受这项活动' }, now);
                    return;
                }
                this.state = result.state;
                row = this.executions()[row.operationId];
                row.effectAppliedAt = now;
                this.state.companionAction = { id: row.operationId, action: row.input.action, startedAt: now, completedAt: 0,
                    ...(animationSlotAllowed(row.input.presentationSlot, row.input) ? { presentationSlot: row.input.presentationSlot } : {}) };
                // This is the effect commit boundary, not a later acknowledgement file.
                this.checkpoint(this.state, now);
            }
        }
        else {
            const start = resume ? resumePlannedHomeActivity : beginPlannedHomeActivity;
            let state;
            try {
                state = start(this.state, { ...row.input, ...(row.until ? { until: row.until } : {}) }, now);
            }
            catch (error) {
                this.updateExecution(row, { status: 'failed', phase: 'completed', reason: String(error) }, now);
                return;
            }
            this.state = state;
            row = this.executions()[row.operationId];
            if (!resume)
                row.executionStartedAt ??= now;
            if (row.kind === 'room') {
                if (this.state.route) {
                    delete row.presentationBaseAt;
                    delete row.pausedMs;
                    delete row.presentationFreeze;
                }
                else if (!resume && !this.state.asleep && this.state.dwell?.target?.plannedOperationId === row.operationId)
                    row.presentationBaseAt = now;
            }
        }
        row = this.executions()[row.operationId];
        delete row.resuming;
        row.phase = this.state.route ? 'moving' : row.kind === 'garden' ? 'pending' : 'working';
        this.checkpoint(this.state, now);
    }
    planAdmissionWait(operationId, now, ownerMeal = false, gardenRequired = false) {
        // Legacy/owner jobs are accepted work too, even before they own a route.
        // Do not discard them or allow an unrelated plan to slip between jobs.
        const available = this.economyPort();
        let garden;
        try {
            if (available || !this.gardenAuthorityUnavailable())
                garden = this.loadGardenState(now);
        }
        catch (error) {
            if (gardenRequired || !(error instanceof LifeControlFileError))
                throw error;
        }
        if (garden?.care.pendingConflict)
            throw Error('菜园还有等待主人决定的安排，先处理原安排再接收计划');
        if (garden && [garden.care.task, ...garden.care.queue].some((job) => job && !(ownerMeal && job.pausedAt) && job.requestId !== operationId
            && !(job.deferUntilIdle === true && job.deferOperationId === operationId)))
            throw Error('菜园仍有已接受的其他任务，原队列保留，完成或明确取消后再接收计划');
        const request = this.state.companionAction;
        const recorded = request && this.executions()[request.id];
        // A short visual reaction after an acknowledged completed plan step must
        // not prevent its next step. Unfinished owner-directed work does block it.
        if (this.requestedActive(now) && (!recorded || !terminalExecution.has(recorded.status))
            && !(ownerMeal && recorded && ['paused', 'interrupted'].includes(recorded.status)))
            return { version: 1, kind: 'owner-activity', operationId, requestId: request.id, observedAt: new Date(now).toISOString() };
    }
    executionRecord(input, now, interaction) {
        return { operationId: input.operationId, kind: input.kind, activity: input.activity,
            status: 'running', phase: 'pending', startedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
            ...(interaction ? { interaction: structuredClone(interaction) } : {}),
            ...(input.until ? { until: input.until } : {}), input: structuredClone(input), fingerprint: digest(input) };
    }
    startPlanned(input, now = Date.now(), ownerMeal = false) {
        if (!input || !isPlanKind(input.kind))
            throw Error('未知的计划活动');
        if (typeof input.operationId !== 'string' || !input.operationId || input.operationId.length > 96
            || /[\u0000-\u001f\u007f]/.test(input.operationId) || ['__proto__', 'constructor', 'prototype'].includes(input.operationId))
            throw Error('计划执行编号无效');
        const { activity: label } = input;
        if (typeof label !== 'string' || !label.trim() || label.length > 80)
            throw Error('计划活动描述须为1到80字');
        if (input.until !== undefined && (typeof input.until !== 'string' || !Number.isFinite(Date.parse(input.until))))
            throw Error('计划结束时间无效');
        if (input.presentationSlot !== undefined) {
            const foodSlot = input.kind === 'economy' && input.economy?.type === 'consume'
                ? this.economyPort()?.foodPresentation?.(input.economy.itemId) : undefined;
            requirePresentationSlot(input.presentationSlot, { ...input, ...(foodSlot ? { foodSlot } : {}) });
        }
        if (input.freezeOnPause !== undefined && typeof input.freezeOnPause !== 'boolean')
            throw Error('计划暂停计时方式无效');
        const kind = input.kind;
        const { target, executable } = PLAN_KINDS[kind];
        if (target && (typeof input.room !== 'string' || typeof input.spot !== 'string' || !HOME_LAYOUT.spots[input.room]?.[input.spot]))
            throw Error('计划中的房间位置不存在');
        validatePlannedFields[kind](input);
        if (executable && input.until !== undefined)
            throw Error('执行活动依据真实回执结束，持续动画请另加原地或房间活动');
        canonical(input);
        const previous = this.executions()[input.operationId], fingerprint = digest(input);
        if (previous) {
            if (previous.fingerprint !== fingerprint)
                throw Error('同一计划执行编号不能用于不同内容');
            if (ownerMeal && this.consoleFoodPending(previous) && !terminalExecution.has(previous.status))
                this.dispatchEconomy(previous, now);
            this.tick(now);
            return this.publicExecution(this.executions()[input.operationId]);
        }
        const current = this.currentExecution();
        if (current && !terminalExecution.has(current.status))
            throw Error('身体已有未结束的计划，先恢复或取消原执行');
        const wait = this.planAdmissionWait(input.operationId, now, ownerMeal, input.kind === 'garden');
        // This typed refusal is emitted only here, before checkpoint or dispatch.
        // Errors from reads, checkpoints, dispatch and resume carry no such proof.
        if (wait)
            throw new PlannedAdmissionWaitError(wait);
        if (!ownerMeal && !this.returningFromInteraction)
            this.forgetInteractionReturn();
        const row = this.executionRecord(input, now, ownerMeal ? this.acceptingFoodInteraction : undefined);
        this.executions()[row.operationId] = row;
        this.state.currentPlannedOperation = row.operationId;
        // Persist the intent before any native executor/transaction can accept it.
        this.checkpoint(this.state, now);
        this.dispatchExecution(this.executions()[row.operationId], now);
        this.tick(now);
        return this.publicExecution(this.executions()[row.operationId]);
    }
    consumeFood(input, now = Date.now()) {
        if (!input || typeof input.operationId !== 'string' || !input.operationId || input.operationId.length > 96
            || /[\u0000-\u001f\u007f]/.test(input.operationId) || ['__proto__', 'constructor', 'prototype'].includes(input.operationId)
            || typeof input.itemId !== 'string' || !input.itemId.trim() || input.itemId.length > 256)
            throw Error('库存餐食须指定有效原执行编号和目录物品');
        if (input.interaction) {
            canonical(input.interaction);
            const old = this.interactions()[digest(input.interaction.requestId)];
            if (old && (old.fact.operationId !== input.operationId || old.fingerprint !== digest({ itemId: input.itemId, actor: input.interaction.actor })))
                throw Error('同一互动请求不能用于不同内容');
        }
        const existing = this.executions()[input.operationId];
        if (existing) {
            if (existing.kind !== 'economy' || existing.input.economy?.type !== 'consume' || existing.input.economy.itemId !== input.itemId)
                throw Error('相同执行编号不能用于不同餐食');
            if (canonical(existing.interaction ?? null) !== canonical(input.interaction ?? null))
                throw Error('相同餐食执行编号不能更换互动来源');
            if ((!terminalExecution.has(existing.status) || existing.effectAppliedAt && !existing.settlementCompletedAt)
                && this.consoleFoodPending(existing)) {
                const active = this.currentExecution();
                if (existing.effectAppliedAt || !active || active.operationId === existing.operationId)
                    this.dispatchEconomy(existing, now);
            }
            this.tick(now);
            return this.publicExecution(this.executions()[input.operationId]);
        }
        this.tick(now);
        this.requireEconomy().preflightFood(input.itemId);
        const activity = { operationId: input.operationId, kind: 'economy', activity: '食用库存餐食', economy: { type: 'consume', itemId: input.itemId, quantity: 1 } };
        if (this.state.asleep) {
            const next = structuredClone(this.state), reason = '她正在睡觉，请先叫醒；本次库存餐食未执行，未预留或消耗物品，原生活安排保留';
            const row = this.executionRecord(activity, now, input.interaction);
            Object.assign(row, { status: 'failed', phase: 'completed', reason, effectDeclinedAt: now, settlementCompletedAt: now });
            next.plannedExecutions[row.operationId] = row;
            if (input.interaction) {
                const key = digest(input.interaction.requestId), needs = structuredClone(next.needs);
                const fact = { version: 1, id: `body:${key}`, requestId: input.interaction.requestId, domain: 'body', type: 'feed',
                    occurredAt: new Date(now).toISOString(), actor: structuredClone(input.interaction.actor), operationId: row.operationId,
                    result: { status: 'unchanged', summary: reason, before: needs, after: structuredClone(needs) } };
                this.interactions(next)[key] = { fingerprint: digest({ itemId: input.itemId, actor: input.interaction.actor }), fact, acknowledged: false, changed: false };
            }
            // The original Body checkpoint owns both the terminal no-effect receipt
            // and its fact. Do not claim current activity or touch inventory on denial.
            this.checkpoint(next, now);
            return this.publicExecution(row);
        }
        const active = this.currentExecution();
        if (active?.kind === 'economy' && active.input.economy?.type === 'consume' && !terminalExecution.has(active.status))
            throw Error('原餐食仍在核对消费结果，已保留原生活活动；完成后再食用下一份');
        if ((this.state.route || this.state.dwell || this.state.command || this.state.freeTarget || this.state.sleepPending)
            && (!active || active.status !== 'running'))
            throw Error('身体仍在完成已接受的其他安排，原安排保留，稍后再食用库存餐食');
        this.interruptPlanned(now, '临时食用主人给予的餐食，随后继续原活动');
        const previous = this.currentExecution();
        if (previous?.status === 'interrupted') {
            previous.resumeAfterInteraction = true;
            this.state.interactionReturn = previous.operationId;
        }
        if (previous && previous.status !== 'running') {
            this.state.currentPlannedOperation = null;
            this.checkpoint(this.state, now);
        }
        // Store trusted attribution with the accepted intent before dispatch; a
        // restart before the effect must retain the original owner and request.
        return this.startOwnerFood(activity, input.interaction, now);
    }
    startOwnerFood(activity, interaction, now) {
        // startPlanned owns validation and the durable dispatch boundary.
        this.acceptingFoodInteraction = interaction;
        try {
            return this.startPlanned(activity, now, true);
        }
        finally {
            this.acceptingFoodInteraction = undefined;
        }
    }
    checkedReading(operationId) {
        const row = this.executions()[operationId];
        if (!row || row.kind !== 'read' || row.status !== 'running' || this.state.currentPlannedOperation !== operationId)
            throw Error('仅可阅读当前正在执行的原计划片段，暂停或取消的安排不会推进书签');
        return row;
    }
    readPlannedSegment(operationId, now = Date.now()) {
        this.tick(now);
        const row = this.checkedReading(operationId);
        return this.requireEconomy().readSegment(operationId, row.input.reading, now);
    }
    confirmPlannedReading(operationId, receiptToken, now = Date.now()) {
        const previous = this.executions()[operationId];
        if (previous?.kind === 'read' && previous.status === 'completed') {
            this.requireEconomy().confirmRead(operationId, receiptToken, now);
            return this.publicExecution(previous);
        }
        this.tick(now);
        const after = this.executions()[operationId];
        if (after?.kind === 'read' && after.status === 'completed') {
            this.requireEconomy().confirmRead(operationId, receiptToken, now);
            return this.publicExecution(after);
        }
        const row = this.checkedReading(operationId);
        this.requireEconomy().confirmRead(operationId, receiptToken, now);
        this.dispatchReading(row, now, false);
        return this.publicExecution(this.executions()[operationId]);
    }
    inspectPlanned(operationId, now = Date.now()) {
        this.tick(now);
        const row = this.executions()[operationId];
        return row ? this.publicExecution(row) : undefined;
    }
    originalFood(operationId) {
        if (!safeFile(this.homeFile))
            throw Error('缺少原身体检查点');
        const saved = record(JSON.parse(readFileSync(this.homeFile, 'utf8')));
        const rows = saved.plannedExecutions === undefined ? {} : record(saved.plannedExecutions);
        const row = rows[operationId];
        if (!row)
            return undefined;
        return { execution: this.publicExecution(row), operationId: row.operationId, itemId: row.input.economy?.itemId,
            requestId: row.interaction?.requestId, actor: row.interaction?.actor,
            applied: row.effectAppliedAt !== undefined, declined: row.effectDeclinedAt !== undefined,
            settled: row.settlementCompletedAt !== undefined };
    }
    plannedState() {
        const row = this.currentExecution();
        return row ? this.publicExecution(row) : undefined;
    }
    presentationBase(row) {
        const start = row.kind === 'hold' ? row.executionStartedAt : row.kind === 'room' ? row.presentationBaseAt : undefined;
        return typeof start === 'number' && Number.isFinite(start) && start > 0 ? start : 0;
    }
    presentationCue(row) {
        const start = this.presentationBase(row);
        if (!start)
            return 0;
        const emotionAt = this.emotion()?.updatedAt;
        return Math.max(start, typeof emotionAt === 'number' && Number.isFinite(emotionAt) && emotionAt > 0 ? emotionAt : 0);
    }
    /** The owned destination dwell proves arrival, including after a reopen. */
    completeMove(row, now) {
        if (this.state.route || this.state.asleep || this.state.dwell?.target?.plannedOperationId !== row.operationId
            || this.state.room !== row.input.room || this.state.spot !== row.input.spot)
            return false;
        // Release only this operation's dwell before admitting the next step.
        this.state = pausePlannedHomeActivity(this.state, row.operationId, now);
        this.state.activity = '已到达目标位置';
        this.updateExecution(row, { status: 'completed', phase: 'completed' }, now);
        return true;
    }
    /** Only an owned physical route arrival establishes a new quiet phase.
     * A moving receipt with its persisted arrival also covers the existing
     * physical-save/phase-ack crash boundary, without inventing an old onset. */
    roomArrival(row, route) {
        const target = this.state.dwell?.target, at = this.state.arrivedAt;
        if (row.kind !== 'room' || this.state.route || this.state.asleep || target?.plannedOperationId !== row.operationId
            || typeof at !== 'number' || !Number.isFinite(at) || at <= 0)
            return {};
        const owned = route?.target?.plannedOperationId === row.operationId && at >= route.departAt;
        const recovered = row.phase === 'moving' && typeof row.executionStartedAt === 'number'
            && Number.isFinite(row.executionStartedAt) && row.executionStartedAt > 0 && at >= row.executionStartedAt;
        if (!owned && !recovered)
            return {};
        return { presentationBaseAt: at, pausedMs: undefined, presentationFreeze: undefined };
    }
    pausedDuration(value) {
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
    }
    pausePresentation(row) {
        const onsetAt = this.presentationCue(row);
        if (!onsetAt || row.input.freezeOnPause === false || onsetAt === this.presentationBase(row))
            return {};
        return row.presentationFreeze?.onsetAt === onsetAt ? {} : { presentationFreeze: { onsetAt, pausedMs: 0 } };
    }
    resumePresentation(row, now) {
        const onsetAt = this.presentationCue(row), baseAt = this.presentationBase(row), pausedAt = row.pausedAt;
        if (!onsetAt || row.input.freezeOnPause === false || typeof pausedAt !== 'number' || !Number.isFinite(pausedAt) || pausedAt <= 0)
            return {};
        const elapsed = (start) => Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Math.max(0, now - Math.max(pausedAt, start))));
        const add = (previous, duration) => Math.min(Number.MAX_SAFE_INTEGER, this.pausedDuration(previous) + duration);
        const progress = { pausedMs: add(row.pausedMs, elapsed(baseAt)) };
        // Keep only the current real emotion cue alongside quiet-phase progress.
        // If Emotion is unavailable, retain its last cue so enabling it again does
        // not lose a known pause; the real phase onset keeps its own total.
        const cue = onsetAt > baseAt ? onsetAt : row.presentationFreeze?.onsetAt;
        if (typeof cue === 'number' && Number.isFinite(cue) && cue > baseAt)
            progress.presentationFreeze = { onsetAt: cue,
                pausedMs: add(row.presentationFreeze?.onsetAt === cue ? row.presentationFreeze.pausedMs : 0, elapsed(cue)) };
        return progress;
    }
    /** A read-only display context; receipts and the existing executor remain
     * authoritative. Acknowledgement never changes visual event identity. */
    animationContext(row = this.currentExecution(), now = Date.now()) {
        const context = {};
        const sleepWait = this.state.asleep && this.state.room === 'her_room' && this.state.spot === 'bed' && !this.state.route
            && row?.status === 'running' && ['hold', 'room'].includes(row.kind) && this.state.dwell?.target?.plannedOperationId === row.operationId;
        if (row?.status === 'running') {
            if (!sleepWait && row.input.presentationSlot)
                context.slotId = row.input.presentationSlot;
            const baseAt = this.presentationBase(row);
            if (!sleepWait && !this.state.route && baseAt) {
                context.startedAt = baseAt;
                const onsetAt = this.presentationCue(row), pausedMs = onsetAt === baseAt ? this.pausedDuration(row.pausedMs)
                    : row.presentationFreeze?.onsetAt === onsetAt ? this.pausedDuration(row.presentationFreeze.pausedMs) : 0;
                if (row.input.freezeOnPause !== false && pausedMs > 0)
                    context.presentationFreeze = { onsetAt, pausedMs };
            }
            const input = row.input;
            if (input.kind === 'read')
                context.itemId = input.reading?.itemId;
            if (input.kind === 'economy')
                context.itemId = input.economy?.itemId;
        }
        const action = this.state.companionAction;
        // A body effect can complete its plan receipt while its actual portrayal
        // continues. Keep the accepted hint on that same physical action, never on
        // a later plan, route, owner action or coincidentally matching activity.
        const bodyKind = { feed: 'eat', water: 'drink', wake: 'wake' };
        const bodyActionCurrent = action && !this.state.route && (!this.state.dwell || sleepWait) && !this.state.freeTarget
            && !this.state.command && !this.state.sleepPending && !this.state.walking
            && (action.action === 'sleep' ? this.state.asleep && this.state.kind === 'sleep'
                : !this.state.asleep && !action.completedAt && this.state.kind === bodyKind[action.action] && this.requestedActive(now));
        if (!context.slotId && (!row || row.status !== 'running' || row.operationId === action?.id || sleepWait) && bodyActionCurrent
            && animationSlotAllowed(action.presentationSlot, { kind: 'body', action: action.action }))
            context.slotId = action.presentationSlot;
        if (this.state.kind === 'eat' && action?.action === 'catalog-food' && !action.completedAt)
            context.itemId = typeof action.itemId === 'string' ? action.itemId : context.itemId;
        if (this.state.kind === 'eat' && context.itemId && action?.action === 'catalog-food'
            && action.itemId === context.itemId && animationSlotAllowed(action.presentationSlot, { kind: 'food-item' }))
            context.foodSlot = action.presentationSlot;
        const at = Number(this.state.lastInteractionAt), until = Number(this.state.reactionUntil);
        if (Number.isFinite(at) && at > 0 && at <= now && Number.isFinite(until) && until > now && until > at) {
            const receipts = this.state.interactionReceipts;
            if (receipts && typeof receipts === 'object' && !Array.isArray(receipts)) {
                const candidates = Object.values(receipts);
                for (let index = candidates.length - 1; index >= 0; index--) {
                    const fact = candidates[index]?.fact;
                    if (fact?.domain !== 'body' || fact.actor?.kind !== 'owner' || fact.result?.status !== 'completed'
                        || !feedbackActions.includes(fact.type)
                        || typeof fact.id !== 'string' || Date.parse(fact.occurredAt) !== at)
                        continue;
                    const type = fact.type;
                    const duration = type === 'pet' || type === 'poke' ? HOME_TOUCH_REACTION_MS[type] : Infinity;
                    const feedbackUntil = Math.min(until, at + duration);
                    if (feedbackUntil <= now)
                        continue;
                    context.interaction = { id: fact.id, action: fact.type, at, until: feedbackUntil, text: fact.result.summary, actor: structuredClone(fact.actor) };
                    break;
                }
            }
        }
        return context;
    }
    /** Classification neither delivers text nor advances bookmarks. */
    presentationActivity() {
        const row = this.currentExecution(), target = this.state.dwell?.target, context = this.animationContext(row);
        const base = Object.keys(context).length ? { animationContext: context } : {};
        if (row?.status !== 'running' || this.state.route || this.state.kind !== 'planned'
            || target?.plannedOperationId !== row.operationId)
            return base;
        if (row.kind === 'hold' || row.kind === 'room')
            return { ...base, presentationKind: 'rest' };
        if (row.kind !== 'read')
            return base;
        try {
            const port = this.economyPort(), receipt = port?.readingStatus(row.operationId, row.input.reading);
            if (receipt)
                return { ...base, presentationKind: receipt.status === 'offered' ? 'read' : 'reading-wait', readingState: receipt.status };
        }
        catch { /* Existing unavailable-authority projection remains authoritative. */ }
        return { ...base, presentationKind: 'reading-wait' };
    }
    pausePlanned(operationId, now = Date.now(), reason = '自主计划已暂停') {
        this.tick(now);
        let row = this.executions()[operationId];
        if (!row)
            throw Error('原计划执行不存在');
        if (terminalExecution.has(row.status) || row.status === 'paused')
            return this.publicExecution(row);
        this.updateExecution(row, { ...this.pausePresentation(row), status: 'paused', phase: 'waiting', reason, pausedAt: row.pausedAt ?? now,
            ...(row.until && row.input.freezeOnPause !== false ? { remainingMs: row.remainingMs ?? Math.max(0, Date.parse(row.until) - now) } : { remainingMs: undefined }) }, now);
        row = this.executions()[operationId];
        this.parkExecution(row, now);
        return this.publicExecution(this.executions()[operationId]);
    }
    resumePlanned(operationId, now = Date.now()) {
        this.tick(now);
        let row = this.executions()[operationId];
        if (!row)
            throw Error('原计划执行不存在');
        if (row.status === 'running' || terminalExecution.has(row.status) || this.consoleFoodPending(row))
            return this.publicExecution(row);
        if (row.input.freezeOnPause === false && row.until && Date.parse(row.until) <= now) {
            this.updateExecution(row, { status: 'failed', phase: 'completed', reason: '活动的绝对结束时间已过，暂停期间不能算作已执行，也不能自动延长截止时间' }, now);
            return this.publicExecution(this.executions()[operationId]);
        }
        const current = this.currentExecution();
        if (current && current.operationId !== operationId && !terminalExecution.has(current.status))
            throw Error('身体已由另一项计划接手');
        if (this.planAdmissionWait(operationId, now, false, row.kind === 'garden'))
            throw Error('身体仍在完成主人已安排的活动，完成后再恢复原执行');
        if (this.state.route || this.state.dwell || this.state.command || this.state.freeTarget || this.state.sleepPending)
            throw Error('身体仍在完成新的安排，原计划保持暂停，完成后再恢复');
        this.state.currentPlannedOperation = operationId;
        this.updateExecution(row, { ...this.resumePresentation(row, now), status: 'running', phase: 'pending', reason: undefined, parkedAt: undefined, resuming: true,
            pausedAt: undefined, remainingMs: undefined,
            ...(row.input.freezeOnPause !== false && row.remainingMs !== undefined ? { until: new Date(now + row.remainingMs).toISOString() } : {}) }, now);
        row = this.executions()[operationId];
        this.dispatchExecution(row, now, true);
        this.tick(now);
        return this.publicExecution(this.executions()[operationId]);
    }
    cancelPlanned(operationId, now = Date.now()) {
        this.tick(now);
        let row = this.executions()[operationId];
        if (!row)
            throw Error('原计划执行不存在');
        if (this.state.interactionReturn === operationId)
            this.forgetInteractionReturn();
        if (terminalExecution.has(row.status))
            return this.publicExecution(row);
        this.updateExecution(row, { status: 'cancelled', phase: 'completed', reason: '原计划执行已取消', parkedAt: undefined }, now);
        row = this.executions()[operationId];
        this.parkExecution(row, now, true);
        return this.publicExecution(this.executions()[operationId]);
    }
    interruptPlanned(now, reason) {
        let row = this.currentExecution();
        if (!row || row.status !== 'running')
            return;
        this.updateExecution(row, { ...this.pausePresentation(row), status: 'interrupted', phase: 'waiting', reason, pausedAt: now,
            ...(row.until && row.input.freezeOnPause !== false ? { remainingMs: Math.max(0, Date.parse(row.until) - now) } : { remainingMs: undefined }) }, now);
        row = this.executions()[row.operationId];
        this.parkExecution(row, now);
    }
    /** Older same-bed waits have a real execution receipt but no explicit wait
     * flag. Restore only that semantic distinction before either physics path;
     * an unowned legacy physical endpoint retains its original finite meaning. */
    preserveAcceptedSleepWait() {
        const state = this.state, target = state.dwell?.target, id = state.currentPlannedOperation;
        if (!state.asleep || state.room !== 'her_room' || state.spot !== 'bed' || state.route
            || !target || target.preserveSleep !== undefined || target.kind !== 'planned' || target.effect
            || target.room !== 'her_room' || target.spot !== 'bed' || typeof id !== 'string' || target.plannedOperationId !== id)
            return;
        const row = state.plannedExecutions?.[id];
        if (!row || row.operationId !== id || row.status !== 'running' || !['hold', 'room'].includes(row.kind)
            || row.input?.operationId !== id || row.input.kind !== row.kind
            || row.kind === 'room' && (row.input.room !== 'her_room' || row.input.spot !== 'bed'))
            return;
        target.preserveSleep = true;
        this.dirty = true;
    }
    tick(now = Date.now()) {
        this.preserveAcceptedSleepWait();
        const economy = this.economyPort();
        if (!economy && this.gardenAuthorityUnavailable())
            return this.gardenUnavailable(now);
        try {
            return this.tickAvailable(now, economy);
        }
        catch (error) {
            if (error instanceof LifeControlFileError)
                return this.gardenUnavailable(now, error);
            if (!this.economyBlocked)
                throw error;
            return this.gardenUnavailable(now);
        }
    }
    tickAvailable(now, economy) {
        // A cancelled food intent may have outlived its current-activity pointer.
        // Reconcile its original reservation as soon as the authority is back.
        for (const row of Object.values(this.executions())) {
            if (row.kind !== 'economy' || row.input.economy?.type !== 'consume' || this.consoleFoodPending(row, economy))
                continue;
            if (row.effectAppliedAt && !row.settlementCompletedAt && row.status !== 'running') {
                try {
                    const settled = economy?.finishFood(row.operationId, { operationId: row.operationId, applied: true, bodyReceiptId: row.operationId }, now);
                    if (settled?.status === 'consumed')
                        this.updateExecution(row, { settlementCompletedAt: now }, now);
                }
                catch (error) {
                    const reason = String(error);
                    if (row.reason !== reason)
                        this.updateExecution(row, { phase: 'waiting', reason }, now);
                }
            }
            if (row.status === 'cancelled' && !row.parkedAt)
                this.parkExecution(row, now, true);
        }
        if (!this.autonomous)
            this.stopAutomatic(now);
        let planned = this.currentExecution();
        if (planned && this.consoleFoodPending(planned, economy)) {
            // The request stays durable while Life can continue with another activity.
            this.state.currentPlannedOperation = null;
            this.checkpoint(this.state, now);
            planned = undefined;
        }
        if (planned && ['paused', 'interrupted', 'cancelled'].includes(planned.status))
            this.parkExecution(planned, now, planned.status === 'cancelled');
        if (planned?.status === 'running' && ['economy', 'read'].includes(planned.kind)) {
            this.dispatchExecution(planned, now);
            planned = this.currentExecution();
        }
        if (planned?.status === 'running' && planned.phase === 'pending' && !['economy', 'read'].includes(planned.kind)) {
            // Recover a crash after the durable intent but before dispatch. Existing
            // physical ownership/receipts suppress duplicate route and transaction work.
            const target = this.state.route?.target ?? this.state.dwell?.target;
            const garden = planned.kind === 'garden' ? this.loadGardenState(now) : undefined;
            const received = garden?.care.receipts.some((row) => row.requestId === planned.operationId);
            if (planned.resuming || target?.plannedOperationId !== planned.operationId && !received)
                this.dispatchExecution(planned, now, planned.resuming === true);
        }
        const arrivalRoute = this.state.route;
        const result = this.caretaker.tick(now);
        if (result.state !== this.state && result.changed)
            this.dirty = true;
        this.state = result.state;
        planned = this.currentExecution();
        if (planned?.status === 'running') {
            const target = this.state.route?.target ?? this.state.dwell?.target;
            if (planned.kind === 'economy') {
                // The transaction/body checkpoint above owns completion, not motion.
            }
            else if (planned.kind === 'read') {
                const receipt = economy?.readingStatus(planned.operationId, planned.input.reading);
                if (receipt?.status === 'confirmed')
                    this.dispatchReading(planned, now, false);
            }
            else if (planned.kind === 'body') {
                if (planned.effectAppliedAt && (planned.input.action !== 'sleep' || this.state.asleep))
                    this.updateExecution(planned, { status: 'completed', phase: 'completed' }, now);
                else if (planned.input.action === 'sleep') {
                    if (target?.effect === 'sleep')
                        target.plannedOperationId = planned.operationId;
                    const phase = this.state.route ? 'moving' : 'pending';
                    if (phase !== planned.phase)
                        this.updateExecution(planned, { phase }, now);
                }
            }
            else if (planned.kind === 'garden') {
                const receipt = result.garden.care.receipts.find((row) => row.requestId === planned.operationId);
                if (receipt && ['completed', 'failed', 'cancelled'].includes(receipt.status))
                    this.updateExecution(planned, { status: receipt.status === 'completed' ? 'completed' : receipt.status === 'cancelled' ? 'interrupted' : 'failed', phase: receipt.status === 'completed' ? 'completed' : 'waiting', reason: receipt.message }, now);
                else {
                    const rawPhase = result.garden.care.task?.requestId === planned.operationId ? result.garden.care.task.phase : 'pending';
                    const phase = rawPhase === 'walking' ? 'moving' : rawPhase === 'working' ? 'working' : 'pending';
                    if (phase !== planned.phase)
                        this.updateExecution(planned, { phase }, now);
                }
            }
            else if (planned.kind === 'move' && this.completeMove(planned, now)) {
                // Actual physical arrival, never an animation or elapsed-time guess.
            }
            else if (target?.plannedOperationId === planned.operationId) {
                const phase = this.state.route ? 'moving' : 'working', arrival = this.roomArrival(planned, arrivalRoute);
                if (planned.phase !== phase || Object.keys(arrival).length)
                    this.updateExecution(planned, { phase, ...arrival }, now);
            }
            else
                this.updateExecution(planned, planned.until && now >= Date.parse(planned.until)
                    ? { status: 'completed', phase: 'completed' } : { status: 'interrupted', phase: 'waiting', reason: '身体活动已被其他安排接手' }, now);
        }
        const request = this.state.companionAction;
        if (request && !request.completedAt && !this.requestedActive(now)) {
            request.completedAt = now;
            if (!this.autonomous && ['eat', 'drink', 'play'].includes(this.state.kind)) {
                this.state.kind = 'idle';
                this.state.activity = '安静地待着';
            }
            this.checkpoint(this.state, now);
        }
        this.returnFromInteraction(now);
        return gardenReceiptProjection(result.garden);
    }
    view(now = Date.now()) {
        const view = homeView(gardenHomeProjection(this.state), now, { emotion: this.emotion() });
        if (view.emotion)
            view.emotion.source = 'chatpet-emotion';
        const room = roomView(this.state.visitors, now);
        return { ...view, basicLiving: { feed: { free: true, label: '免费基础餐食' }, water: { free: true, label: '免费基础饮水' } }, room: { ...room, lamp: view.env.lamp } };
    }
    act(input, by = '伙伴', now = Date.now(), interaction) {
        const data = record(input), action = data.action;
        if (typeof action !== 'string' || !HOME_ACTIONS.includes(action))
            throw Error('未知的房间动作');
        if (by === '大肥鱼' && !companionActions.has(action))
            throw Error('角色不能执行这项房间操作');
        if (action === 'command') {
            if (typeof data.room !== 'string' || typeof data.spot !== 'string' || !Object.hasOwn(HOME_LAYOUT.spots, data.room)
                || !Object.hasOwn(HOME_LAYOUT.spots[data.room], data.spot))
                throw Error('没有这个房间位置');
            if (by === '大肥鱼' && this.state.asleep)
                throw Error('她睡着了，先叫醒再去其他地方');
            if (by === '大肥鱼' && this.state.needs.pain >= 0.7)
                throw Error('她身体不舒服，暂时不能走动');
        }
        if (action === 'talk' && (typeof data.text !== 'string' || !data.text.trim()))
            throw Error('留言不能为空');
        const text = typeof data.text === 'string' ? data.text.trim().slice(0, 120) : '';
        const receipt = interaction ? this.interaction(data, interaction) : undefined;
        if (receipt?.prior) {
            const { prior } = receipt, home = this.view(now);
            return { ok: true, changed: prior.changed, event: { type: prior.fact.type, text: prior.fact.result.summary }, home, room: home.room, fact: structuredClone(prior.fact) };
        }
        const noChange = action === 'sleep' && (this.state.asleep || this.state.sleepPending) || action === 'wake' && !this.state.asleep && !this.state.sleepPending;
        if (!interaction && action === 'sleep' && (this.state.asleep || this.state.sleepPending)) {
            return { ok: true, changed: false, event: null, home: this.view(now) };
        }
        if (!interaction && action === 'wake' && !this.state.asleep && !this.state.sleepPending)
            return { ok: true, changed: false, event: null, home: this.view(now) };
        const incidental = ['talk', 'lamp', 'visit', 'pet', 'poke', 'feed', 'water', 'play'].includes(action);
        const event = { action, text, room: data.room, spot: data.spot, pos: data.pos, free: data.free === true, on: data.on, at: now, by };
        // Reuse the original pure movement result before retiring accepted work.
        // An admitted preview is discarded: the real action must use the latest
        // state containing the interruption receipt, never overwrite it with this
        // pre-interruption projection or commit a preview effect twice.
        const movement = ['go', 'place'].includes(action) ? applyHomeAction(this.state, { ...event, emotion: this.emotion() }) : undefined;
        const refused = movement?.changed === false;
        if (!incidental && !noChange && !refused) {
            this.forgetInteractionReturn();
            this.interruptPlanned(now, '新的身体安排打断了当前计划');
        }
        if (!this.autonomous && !refused)
            this.stopAutomatic(now);
        const before = structuredClone(this.state.needs);
        const result = refused ? movement : noChange ? { state: normalizeHomeState(this.state, now), changed: false, event: null } : applyHomeAction(this.state, { ...event, emotion: this.emotion() });
        let fact;
        if (interaction && receipt) {
            const who = interaction.actor.kind === 'owner' ? '主人' : interaction.actor.kind === 'companion' ? '你自己' : '系统';
            const labels = {
                water: interaction.actor.kind === 'companion' ? '喝水' : '喂水', feed: '给予免费基础餐食', pet: '摸摸', poke: '轻戳', play: '陪伴玩耍',
                sleep: '安排睡觉', wake: '叫醒', talk: '留言', lamp: '调整灯光', visit: '来到房间', command: '安排位置', go: '指定移动', place: '放置角色',
                sick: undefined, heal: undefined,
            };
            // 上游准入仍由 HOME_ACTIONS 决定，契约测试核对两边的动作集合。
            const factType = action;
            const summary = result.event?.reason === 'sleeping' ? `${who}${labels[factType]}未执行：${result.event.text}`
                : action === 'sleep' && result.state.sleepPending ? `${who}的睡觉安排已接收，正在前往床，尚未入睡。`
                    : action === 'talk' ? `${who}的留言已保存：${text}` : `${who}${labels[factType] || action}${result.changed ? '已完成' : '没有改变当前状态'}。`;
            fact = { version: 1, id: `body:${receipt.key}`, requestId: interaction.requestId, domain: 'body', type: factType, occurredAt: new Date(now).toISOString(), actor: structuredClone(interaction.actor),
                result: { status: result.changed ? 'completed' : 'unchanged', summary, before, after: structuredClone(result.state.needs) } };
            result.state.interactionReceipts = { ...this.interactions(), [receipt.key]: { fingerprint: receipt.fingerprint, fact, acknowledged: false, changed: result.changed } };
        }
        if (result.changed) {
            // Additive host attribution survives the original normalizer. Native
            // route/dwell and garden receipts remain the actual execution authority.
            if (!result.event?.activityPreserved && ((!result.state.route && !result.state.dwell && !this.currentExecution()) || ['command', 'go', 'place', 'sleep', 'wake'].includes(action))) {
                result.state.companionAction = { id: randomUUID(), action, startedAt: now, completedAt: 0 };
            }
            // Keep the original visitors/notes record in the same atomic checkpoint as
            // the corresponding body event. A retry cannot see one without the other.
            if (['visit', 'pet', 'feed', 'play', 'talk', 'lamp'].includes(action)) {
                const roomEvent = action === 'lamp' ? { ...event, on: result.state.lamp } : event;
                const visitors = applyRoomAction(normalizeRoomState(this.state.visitors, now), roomEvent);
                result.state.visitors = visitors.state;
            }
            this.checkpoint(result.state, now);
            this.tick(now);
        }
        else if (fact)
            this.checkpoint(result.state, now);
        const home = this.view(now);
        return { ok: true, changed: result.changed, event: fact ? { ...result.event, type: action, text: fact.result.summary } : result.event, home, room: home.room, ...(fact ? { fact } : {}) };
    }
    garden(operation, input, now = Date.now()) {
        if (operation === 'state') {
            const garden = this.tick(now);
            return { ok: garden?.unavailable !== true, garden };
        }
        if (!this.economyPort() && this.gardenAuthorityUnavailable())
            return { ok: false, status: 'waiting', message: '经济组件暂不可用，原菜园与交易保留并等待恢复', garden: this.gardenUnavailable(now) };
        try {
            const action = record(input);
            if (operation === 'control') {
                this.gardenClock();
                const planned = this.currentExecution();
                if (['pause', 'resume', 'cancel'].includes(String(action.type)) && typeof action.requestId === 'string'
                    && this.executions()[action.requestId]?.kind === 'garden') {
                    const execution = action.type === 'pause' ? this.pausePlanned(action.requestId, now)
                        : action.type === 'resume' ? this.resumePlanned(action.requestId, now) : this.cancelPlanned(action.requestId, now);
                    return { ok: execution.status !== 'failed', accepted: execution.status === 'running', status: execution.status,
                        message: execution.reason || (execution.status === 'running' ? '本次园艺已继续；后续生活安排是否恢复以生活计划为准' : '已更新原园艺执行状态'), execution,
                        garden: this.tick(now), home: this.view(now) };
                }
                // Asking or deferring care must not first interrupt the very activity
                // the owner chose to finish. Reuse a running garden operation unchanged.
                let result = this.caretaker.control(action, now);
                if (action.type === 'careNow' && action.decision === 'force') {
                    if (planned?.kind === 'garden' && ['paused', 'interrupted'].includes(planned.status) && result.ok
                        && (result.status === 'paused' || result.accepted === true)) {
                        const execution = this.resumePlanned(planned.operationId, now);
                        if (execution.status !== 'running')
                            return { ok: execution.status === 'completed', accepted: false, status: execution.status,
                                message: execution.reason || '原园艺任务没有继续执行', execution, garden: this.tick(now), home: this.view(now) };
                        // The original paused response has no write/effect. Only that case
                        // needs control again after resuming; an accepted result is reused.
                        if (result.accepted !== true)
                            result = this.caretaker.control(action, now);
                        return { ...result, message: '仅继续本次园艺；后续生活安排是否恢复以生活计划为准', execution,
                            garden: this.tick(now), home: this.view(now) };
                    }
                    if (result.ok && result.accepted === true && planned?.kind !== 'garden') {
                        this.interruptPlanned(now, '主人选择先去菜园，原活动已暂停');
                        result = { ...result, garden: this.tick(now), home: this.view(now) };
                    }
                }
                else if (result.ok && result.accepted === true && result.status !== 'completed' && !['careNow', 'auto', 'state'].includes(String(action.type))) {
                    this.interruptPlanned(now, '新的菜园安排打断了当前计划');
                    result = { ...result, garden: this.tick(now), home: this.view(now) };
                }
                if (result.home?.emotion)
                    result.home.emotion.source = 'chatpet-emotion';
                return result;
            }
            if (operation !== 'act')
                throw Error('未知的菜园操作');
            this.tick(now);
            const port = this.economyPort();
            if (!port)
                safeFile(this.gardenFile);
            const revision = port ? this.loadGardenState(now).economyRevision : undefined;
            const clock = this.gardenClock();
            const result = port ? port.actGarden(action, now, clock) : this.actUnadoptedGarden(action, now, clock);
            // The authoritative action is committed once. A refusal must not retire
            // accepted Body work. An old Economy receipt has no new revision; a new
            // commit interrupts against the latest checkpoint.
            const committed = result.ok && !(Number.isSafeInteger(revision) && result.garden?.economyRevision === revision);
            if (committed && action.type !== 'state')
                this.interruptPlanned(now, '新的菜园安排打断了当前计划');
            return { ...result, garden: committed ? this.tick(now) : result.garden };
        }
        catch (error) {
            if (!(error instanceof LifeControlFileError))
                throw error;
            const garden = this.gardenUnavailable(now, error);
            return { ok: false, status: garden.status, message: garden.message, garden };
        }
    }
    actUnadoptedGarden(action, now, clock) {
        if (clock.pauses === undefined)
            return actGarden(this.gardenFile, action, now);
        const state = advanceGardenClock(loadGarden(this.gardenFile, now), now, clock, advanceGarden);
        const result = applyGardenAction(state, action, now);
        if (result.ok)
            saveGarden(this.gardenFile, result.state);
        return { ok: result.ok, message: result.message, garden: gardenView(result.state, now) };
    }
}
//# sourceMappingURL=room.js.map