import { fail, requiredText } from '../core/tables/console.js';
import { ROOM_MOOD_DIMENSIONS } from '../contracts/emotion.js';
import { OWNER_LIFE_TOOL_SOURCES } from '../core/native/conversation.js';
import { registerWorldPrompt, registerWorldContext } from '../core/native/prompt.js';
import { COMPANION_FEELINGS, decideExpression, expressionStream, readRoomMood } from './index.js';
import { RecentLedger } from './recent.js';
import { EmotionFile, readEmotionState } from './state.js';
import { CONTRACT_VERSION } from '../contracts/version.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
export class CompanionEmotion {
    host;
    listeners = new Set();
    catalogs = new Map();
    confirmed = new Map();
    changes = new Set();
    queue = Promise.resolve();
    closed = false;
    /** Preset-local hook attachment; shares this service and its turn state. */
    attachGuest;
    constructor(host) {
        this.host = host;
    }
    get catalog() {
        const entries = [...this.catalogs.values()].map(entry => entry.value);
        const unique = (items) => [...new Map(items.map(item => [item.name, item])).values()];
        return structuredClone({ actions: unique(entries.flatMap(entry => entry.actions)), stickers: unique(entries.flatMap(entry => entry.stickers)),
            supportedFeelings: [...new Set([...COMPANION_FEELINGS, ...entries.flatMap(entry => entry.supportedFeelings ?? [])])] });
    }
    registerCatalog(owner, catalog) {
        if (this.closed)
            throw Error('Emotion component is closed');
        if (!owner || !catalog || !Array.isArray(catalog.actions) || !Array.isArray(catalog.stickers))
            throw Error('Invalid expression catalog');
        for (const item of [...catalog.actions, ...catalog.stickers])
            if (!item || typeof item.name !== 'string' || !item.name || item.name.length > 160 || typeof item.description !== 'string' || item.description.length > 2000)
                throw Error('Invalid expression asset');
        if (catalog.supportedFeelings?.some(item => typeof item !== 'string' || !item || item.length > 48))
            throw Error('Invalid supported feelings');
        const token = Symbol(owner);
        this.catalogs.set(owner, { token, value: structuredClone(catalog) });
        return () => { if (this.catalogs.get(owner)?.token === token)
            this.catalogs.delete(owner); };
    }
    onExpression(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    onChanged(listener) { this.changes.add(listener); return () => { this.changes.delete(listener); }; }
    confirm(workspaceId, snapshot) {
        const old = this.confirmed.get(workspaceId);
        this.confirmed.set(workspaceId, snapshot);
        if (!this.closed && (old?.status !== snapshot.status || old.contentHash !== snapshot.contentHash)) {
            for (const listener of this.changes)
                listener(workspaceId, structuredClone(snapshot));
        }
    }
    file(id) {
        const binding = this.host.workspace.status();
        if (binding.state !== 'ready' || binding.target?.id !== id)
            throw Error('Emotion requires the current bound workspace');
        const runtime = this.host.workspace.runtime, storageId = this.host.workspace.storageId();
        return new EmotionFile({ path: binding.target.path, storageId, companionId: runtime.config.companionId, scopeId: runtime.config.scopeId });
    }
    ledger(id) {
        const state = this.host.workspace.status();
        if (state.state !== 'ready' || state.target?.id !== id)
            return null;
        return new RecentLedger({ ...state.target, id: this.host.workspace.storageId() }, () => this.host.workspace.companionSettings());
    }
    recordPlayback(receipt) {
        if (receipt.kind !== 'expression' && receipt.kind !== 'random')
            return;
        if (!['playing', 'ended', 'cancelled', 'failed'].includes(receipt.status) ||
            typeof receipt.id !== 'string' || !this.catalog.actions.some(action => action.name === receipt.name))
            return;
        this.ledger(receipt.workspaceId)?.playback(receipt);
    }
    async read(workspaceId) {
        let snapshot;
        try {
            if (this.closed)
                throw Error('Emotion component is closed');
            const file = this.file(workspaceId);
            snapshot = file.snapshot(file.load());
            this.confirm(workspaceId, snapshot);
            return structuredClone(snapshot);
        }
        catch (error) {
            const unavailable = { status: 'unavailable', revision: snapshot?.revision ?? 0,
                contentHash: snapshot?.contentHash ?? '', reason: error instanceof Error ? error.message : 'Emotion unavailable' };
            this.confirm(workspaceId, unavailable);
            return unavailable;
        }
    }
    current(workspaceId) {
        try {
            if (this.closed)
                return;
            const file = this.file(workspaceId);
            return file.snapshot(file.load()).state;
        }
        catch {
            return;
        }
    }
    roomSnapshot(workspaceId) {
        const current = this.current(workspaceId), roomMood = readRoomMood(current?.roomMood);
        if (current)
            return { ...(roomMood ?? {}), label: current.mood, updatedAt: current.at, ...(current.feelings ? { feelings: current.feelings } : {}) };
    }
    async update(workspaceId, input, assertCurrent) {
        const run = this.queue.then(async () => {
            if (this.closed)
                throw Error('Emotion component is closed');
            assertCurrent?.();
            const { expectedRevision: _revision, expectedHash: _hash, ...values } = input;
            const candidate = readEmotionState({ ...values, reason: input.reason ?? '', at: Date.now(), memories: input.memories ?? [] });
            const snapshot = this.file(workspaceId).update(input, candidate.at);
            this.confirm(workspaceId, snapshot);
            return structuredClone(snapshot);
        });
        this.queue = run.catch(() => { });
        return run;
    }
    async experience(workspaceId) {
        return this.ledger(workspaceId)?.read() ?? { actions: [], moods: [] };
    }
    retire(workspaceId, memoryId) {
        // Explicit preference withdrawal can prune associated short-lived feedback;
        // it does not erase the companion's independently retained emotional state.
        this.ledger(workspaceId)?.retire(memoryId);
    }
    complete(sessionId, turn, current = () => true) {
        // Footer updates have no editor revision of their own. Read and apply them
        // in the same queue as explicit edits so concurrent surfaces cannot all
        // read one stale revision and silently lose later emotional updates.
        const run = this.queue.then(() => this.completeTurn(sessionId, turn, current));
        this.queue = run.catch(() => { });
        return run;
    }
    async completeTurn(sessionId, turn, current) {
        if (this.closed || !turn.intent || !current())
            return;
        const ledger = this.ledger(turn.workspaceId);
        if (!ledger)
            return;
        const previousRead = await this.read(turn.workspaceId), previous = previousRead.state;
        if (this.closed || !current())
            return;
        const carriesReason = !turn.intent.reason && (!turn.intent.mood || turn.intent.mood === previous?.mood);
        let state = previous;
        if (turn.intent.mood || turn.intent.feelings || turn.intent.roomMood || turn.intent.reason) {
            const next = this.file(turn.workspaceId).update({
                expectedRevision: previousRead.revision, expectedHash: previousRead.contentHash,
                mood: turn.intent.mood ?? previous?.mood ?? turn.intent.feelings?.[0] ?? '平静',
                reason: turn.intent.reason ?? (carriesReason ? previous?.reason : '') ?? '',
                memories: [],
                ...(turn.intent.feelings ? { feelings: turn.intent.feelings } : carriesReason && previous?.feelings ? { feelings: previous.feelings } : {}),
                ...(turn.intent.roomMood ? { roomMood: turn.intent.roomMood } : carriesReason && previous?.roomMood ? { roomMood: previous.roomMood } : {}),
            });
            this.confirm(turn.workspaceId, next);
            state = next.state;
        }
        if (this.closed)
            return;
        const intent = { ...turn.intent, mood: state?.mood, feelings: state?.feelings };
        const moodChanged = state && (state.mood !== previous?.mood || state.reason !== previous?.reason);
        ledger.reply({ ...turn.intent, mood: moodChanged ? state?.mood : undefined, reason: state?.reason }, turn.user, turn.memoryIds);
        const catalog = this.catalog;
        const expression = decideExpression(intent, catalog, this.host.workspace.companionSettings());
        const selected = catalog.actions.find(action => action.name === expression.action);
        const event = { workspaceId: turn.workspaceId, sessionId, turn: turn.turn, ...expression,
            ...(selected ? { actionLabel: selected.label ?? selected.name } : {}) };
        for (const listener of this.listeners)
            listener(event);
    }
    async close() { this.closed = true; this.catalogs.clear(); this.listeners.clear(); this.changes.clear(); this.confirmed.clear(); await this.queue; }
}
const instances = new WeakMap();
export function emotionFor(host) {
    let value = instances.get(host);
    if (!value) {
        value = new CompanionEmotion(host);
        instances.set(host, value);
    }
    return value;
}
export function installEmotion(ctx, host) {
    const emotion = emotionFor(host);
    const turns = new Map();
    function bound(session) {
        const shared = host.native.nativeScopeFor(session.id);
        if (shared)
            return { id: shared.workspaceId, path: shared.path, guest: shared.guest };
        const status = ctx.petWorld.sessionStatus(session);
        return status?.state === 'ready' && status.target ? { id: status.target.id, path: status.target.path, guest: false } : undefined;
    }
    const warn = (error) => ctx.logger('chatpet-emotion').warn('Recent expression unavailable', error instanceof Error ? error.message : 'unknown');
    // Keep the existing anonymous callback's vocabulary scope stable for R8.
    const playback = host.native.registerPlaybackEvidence(((sessionId, playbackId) => {
        const turn = turns.get(sessionId);
        const scope = host.native.nativeScopeFor(sessionId);
        if (!turn || !scope || scope.workspaceId !== turn.workspaceId || scope.path !== turn.path)
            return;
        const ledger = emotion.ledger(turn.workspaceId);
        const action = ledger?.read().actions.find(item => item.id === playbackId);
        if (!action || !ledger)
            return;
        const label = emotion.catalog.actions.find(item => item.name === action.name)?.label ?? action.name;
        const result = { playing: '已开始', ended: '已播完', cancelled: '已中断', failed: '播放中出错' }[action.status];
        return { occurredAt: action.at, text: `桌宠播放记录 ${action.id}，动作 ${label}（${action.name}），${result}`, associated(memoryId) {
                try {
                    ledger.associate(action.name, memoryId);
                }
                catch (error) {
                    warn(error);
                }
            } };
    }));
    const expressionGuide = () => [
        '你是同一个大肥鱼，无论是否显示在桌面或房间。保持自己持续的心情，区别于用户情绪、实际行为、工作状态和交互状态。愤怒与无聊可分别用 feelings 中的 anger、boredom 表达，也可以用准确的文字表达其他感受；不要按关键词推断，不把它们换算成开心，不引入自动衰减。',
        JSON.stringify({ available: emotion.catalog }),
        '展示组件可以提供动作和贴图。只从当前可用清单选择，没展示组件也可以维护自己的情绪。情绪变化不自动改变睡觉、吃饭等实际行为，也不自动叫醒。没有合适的视觉素材就只保留感受，不假装已经播放。',
        '有可靠经历或自己的新感受时，可用本轮回复末尾的 pet-expression 更新情绪；当前有 pet_emotion_update 工具时也可带快照的 revision 和 contentHash 维护。没有变化不必写。更新情绪不需要另一次模型调用。',
        '用户对动作的反馈先留在近期记录；仅在当前会话确有记忆写入工具时，可用真实原话保存明确的长期偏好。长期动作偏好需 pet_memory_remember 的 playback_id。访客不因此获得主人工具。不要仅凭旧台账再提交长期记忆。',
        '同轮兼容方式：正常正文后另起一行写 <pet-expression> 加一行内 JSON，无需代码围栏。字段均可省略：mood、reason、feelings、action、sticker。action/sticker选清单name。roomMood仅在有可靠的房间数值时填写，文字情绪不要求数值，也不按文字编造分数。',
        `roomMood如提供则为 {"mood":76,"dims":{"happy":68}}；总体mood与各维度范围0到100。兼容维度是${ROOM_MOOD_DIMENSIONS.join('、')}。anger/boredom保留语义feelings，不替换成这些维度。feedback仅用本轮真实用户评价：{"playbackId":"真实记录id","quote":"逐字原话"}。`,
    ].join('\n');
    const string = { type: 'string', required: true };
    const updateTool = defineTool({ name: 'pet_emotion_update', description: '维护同一陪伴者的当前情绪。用快照的revision/contentHash防止覆盖新修改。文字状态无需房间数值。愤怒和无聊可用feelings的anger、boredom，情绪变化不自动改变实际行为。',
        parameters: { expected_revision: { type: 'integer', required: true }, expected_hash: string, mood: string, reason: { type: 'string' },
            feelings: { type: 'array', items: { type: 'string' } } },
        output: { schema: { type: 'string' }, render: (_, value) => [{ type: 'text', text: value }] },
        async execute(args, exec) {
            const agent = exec.agent, workspace = agent && bound(agent.session);
            const turn = agent && turns.get(agent.id);
            if (!agent || !workspace || workspace.guest || !turn)
                throw Error('Emotion update requires a bound owner conversation');
            const assertCurrent = () => {
                playback.lease.assertCurrent();
                if (turns.get(agent.id) !== turn || !host.native.emotionAllowed(agent.id, turn.turn, 'tool'))
                    throw Error('Emotion update requires a bound owner conversation');
                host.native.validate(agent.id);
            };
            assertCurrent();
            const saved = await emotion.update(workspace.id, { expectedRevision: args.expected_revision, expectedHash: args.expected_hash, mood: args.mood, reason: args.reason,
                ...(args.feelings ? { feelings: args.feelings } : {}) }, assertCurrent);
            return JSON.stringify(saved);
        } });
    ctx.tools.register(updateTool, { when: ({ agent }) => Boolean(agent && bound(agent.session) && !bound(agent.session)?.guest) });
    ctx.effect(() => host.native.toolTable.register({ name: updateTool.name, sources: OWNER_LIFE_TOOL_SOURCES }).revoke);
    const promptState = new Map();
    const attached = new WeakSet();
    const prompts = [];
    const registerPrompt = (...args) => {
        const prompt = registerWorldPrompt(...args);
        prompts.push(prompt);
        return prompt;
    };
    const attach = (scopeCtx, withPrompts = true) => {
        if (attached.has(scopeCtx))
            return;
        attached.add(scopeCtx);
        if (withPrompts) {
            registerPrompt(scopeCtx, 'chatpet.expression-guide', 32, agent => bound(agent.session) ? expressionGuide() : '');
            prompts.push(registerWorldContext(scopeCtx, 'chatpet.expression-state', 33, agent => bound(agent.session) ? promptState.get(agent.id) ?? '' : '', async (agent) => {
                const workspace = bound(agent.session);
                if (!workspace) {
                    promptState.delete(agent.id);
                    return;
                }
                const [snapshot, recent] = await Promise.all([emotion.read(workspace.id), emotion.experience(workspace.id)]);
                if (bound(agent.session)?.id !== workspace.id) {
                    promptState.delete(agent.id);
                    return;
                }
                const current = snapshot.state;
                const moods = recent.moods;
                if (bound(agent.session)?.id !== workspace.id) {
                    promptState.delete(agent.id);
                    return;
                }
                promptState.set(agent.id, JSON.stringify({
                    emotionStatus: current ? snapshot.status : snapshot.state ? 'unavailable' : snapshot.status, revision: snapshot.revision, contentHash: snapshot.contentHash,
                    currentCompanionEmotion: current ? { mood: current.mood, reason: current.reason, at: current.at,
                        ...(current.feelings ? { feelings: current.feelings } : {}), ...(current.roomMood ? { roomMood: current.roomMood } : {}) } : null,
                    actions: recent.actions.slice(-24).map(({ id, name, at, status, feedback }) => ({ id, name, time: new Date(at).toISOString(), status, feedback: feedback.map(f => f.quote) })),
                    moods: moods.slice(-8).map(({ mood, reason, at }) => ({ mood, reason, time: new Date(at).toISOString() })),
                }));
            }));
        }
        scopeCtx.on('session/event', async (session, event) => {
            try {
                if (event.type === 'turn/start') {
                    turns.delete(session.id);
                    const w = bound(session);
                    if (w)
                        turns.set(session.id, { turn: event.data.turn, workspaceId: w.id, path: w.path, memoryIds: [], memoryCalls: new Map() });
                    return;
                }
                const turn = turns.get(session.id);
                if (!turn)
                    return;
                if (event.type === 'user/message' && event.data.source.kind === 'user') {
                    turn.user = { id: event.data.id, text: event.data.content.flatMap(b => b.type === 'text' ? [b.text] : []).join('\n') };
                }
                if (event.type === 'step/start')
                    turn.intent = undefined;
                if (event.type === 'tool/call' && ['pet_memory_remember', 'pet_memory_correct', 'pet_memory_forget'].includes(event.data.name)) {
                    const args = JSON.parse(event.data.arguments);
                    turn.memoryCalls.set(event.data.callId, { name: event.data.name, memoryId: args.memory_id, playbackId: args.playback_id });
                }
                if (event.type === 'tool/result') {
                    const message = event.data.message, call = turn.memoryCalls.get(message.toolCallId);
                    turn.memoryCalls.delete(message.toolCallId);
                    if (!call || message.isError || bound(session)?.id !== turn.workspaceId)
                        return;
                    if (call.name === 'pet_memory_remember') {
                        const text = message.content.flatMap(b => b.type === 'text' ? [b.text] : []).join('');
                        const result = JSON.parse(text);
                        if (call.playbackId && typeof result.memoryId === 'string') {
                            turn.memoryIds.push(result.memoryId);
                        }
                    }
                    else if (typeof call.memoryId === 'string')
                        emotion.retire(turn.workspaceId, call.memoryId);
                }
                if (event.type === 'turn/end') {
                    turns.delete(session.id);
                    if (event.data.turn !== turn.turn || event.data.reason.kind !== 'completed')
                        return;
                    const w = bound(session);
                    if (w?.id === turn.workspaceId && w.path === turn.path) {
                        const footerAllowed = host.native.captureEmotionFooter(session.id, turn.turn);
                        if (footerAllowed)
                            await emotion.complete(session.id, turn, () => playback.lease.isCurrent() && footerAllowed());
                    }
                }
            }
            catch (error) {
                warn(error);
            }
        }, { global: true });
        scopeCtx.on('llm/stream', async function* (options, next) {
            const turn = options.sessionId && turns.get(options.sessionId);
            if (!turn || options.purpose || !host.native.nativeScopeFor(String(options.sessionId))) {
                yield* next();
                return;
            }
            yield* expressionStream(next(), intent => { if (!options.signal?.aborted)
                turn.intent = intent; });
        }, { global: true });
        scopeCtx.on('agent/disposed', ({ agent }) => { turns.delete(agent.id); promptState.delete(agent.id); }, { global: true });
    };
    attach(ctx);
    // Preset-local waterfalls share each section's per-Agent registration map.
    emotion.attachGuest = scope => {
        for (const prompt of prompts)
            prompt.attach(scope);
        attach(scope, false);
    };
    ctx.effect(() => async () => {
        const revoked = playback.revoke();
        turns.clear();
        promptState.clear();
        emotion.attachGuest = undefined;
        await revoked;
    });
}
export const name = '20-Emotion';
export const inject = ['petCore', 'petWorld', 'systemPrompt', 'agents', 'tools'];
export function emotionConsoleOperations(emotion) {
    const update = (write) => call => {
        const raw = call.input;
        if (!raw || typeof raw !== 'object')
            fail('INVALID_ARGUMENT');
        const id = requiredText(raw.workspaceId, 200);
        call.checkBinding(id);
        const { workspaceId: _id, ...input } = raw;
        return write ? emotion.update(id, input, call.validate) : emotion.read(id);
    };
    return {
        operations: { emotionState: update(false), emotionUpdate: update(true) },
        status(workspaceId) {
            const current = emotion.current(workspaceId);
            const label = (asset) => asset.label || asset.name;
            return { current: current ? { mood: current.mood, at: current.at } : null,
                actions: emotion.catalog.actions.map(label), stickers: emotion.catalog.stickers.map(label) };
        },
    };
}
export function apply(ctx) {
    const host = ctx.petCore;
    installEmotion(ctx, host);
    const emotion = emotionFor(host);
    ctx.provide('petEmotion', emotion);
    ctx.effect(() => host.native.consoleOperations.register('emotion', emotionConsoleOperations(emotion), ctx).revoke);
    const unsubscribe = emotion.onExpression(value => ctx.emit('pet/emotion.expression', value));
    const changed = emotion.onChanged((id, snapshot) => ctx.emit('pet/emotion.changed', id, snapshot));
    ctx.effect(() => async () => {
        unsubscribe();
        changed();
        if (instances.get(host) === emotion)
            instances.delete(host);
        await emotion.close();
    });
    ctx.effect(() => host.workspace.runtime.capabilityTable.register({
        id: 'emotion.expression', owner: 'emotion', contractVersion: CONTRACT_VERSION, order: 10,
        status: () => host.workspace.status().state === 'ready' && emotion.catalog.actions.length > 0
            ? { state: 'ready', reason: null, supportedOperations: ['express', 'recordPlayback'] }
            : { state: 'unavailable', reason: 'Requires a bound workspace and expression assets', supportedOperations: [] },
    }).revoke);
}
//# sourceMappingURL=plugin.js.map