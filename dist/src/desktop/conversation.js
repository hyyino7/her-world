import { randomUUID } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
export function sameBinding(a, b) {
    return a.id === b.id && a.path === b.path && a.storageId === b.storageId;
}
export function project(events) {
    const messages = [];
    let turn = null, reason = '';
    for (const event of events) {
        const { type, data } = event;
        if (type === 'turn/start') {
            turn = data.turn ?? null;
            reason = '';
        }
        if (type === 'turn/end' && data.turn === turn) {
            turn = null;
            reason = data.reason?.kind ?? '';
        }
        const role = type === 'assistant/message' ? 'assistant' : type === 'user/message' && data.source?.kind === 'user' ? 'user' : null;
        const message = type === 'assistant/message' ? data.message : data;
        if (role && message) {
            const text = message.content?.filter(part => part.type === 'text').map(part => part.text ?? '').join('') ?? '';
            const display = text || (message.content?.some(part => part.type === 'image') ? '[图片]' : '');
            if (display)
                messages.push({ id: event.seq, turn: data.turn ?? turn ?? undefined, role, text: display });
        }
    }
    return { messages, turn, reason };
}
export class Conversation {
    native;
    binding;
    saved;
    save;
    changed;
    claimUsage;
    active;
    attempt;
    tail = Promise.resolve();
    pending = false;
    revision = 0;
    // Native cancellation may abandon the stream before appending an assistant message.
    // Preserve the last visible text in this window session without changing DSH history.
    stoppedText = new Map();
    constructor(native, binding, saved, save, changed, claimUsage) {
        this.native = native;
        this.binding = binding;
        this.saved = saved;
        this.save = save;
        this.changed = changed;
        this.claimUsage = claimUsage;
    }
    get id() { return this.active?.id; }
    /** Closing a view revokes its queued/in-flight commands, not the native chat. */
    invalidate() {
        this.revision++;
        this.active = undefined;
        this.attempt = undefined;
        this.pending = false;
        this.stoppedText.clear();
    }
    frame(session, frame) {
        if (session.id !== this.id)
            return;
        if (frame.type === 'start')
            this.attempt = { id: frame.attemptId, turn: frame.turn, step: frame.step, text: '', next: 0 };
        if (!this.attempt || this.attempt.id !== frame.attemptId)
            return;
        if (frame.type === 'chunk' && frame.index === this.attempt.next) {
            this.attempt.next++;
            if (frame.chunk?.type !== 'text-delta')
                return;
            this.attempt.text += frame.chunk.text ?? '';
        }
        if (frame.type === 'end')
            this.attempt = undefined;
        this.changed();
    }
    event(session, event) {
        if (session.id !== this.id)
            return;
        if (event.type === 'turn/start' || event.type === 'turn/end')
            this.pending = false;
        if (event.type === 'assistant/message' || event.type === 'turn/end')
            this.attempt = undefined;
        if (['user/message', 'assistant/message', 'turn/start', 'turn/end'].includes(event.type))
            this.changed();
    }
    snapshot() {
        const binding = this.binding(), active = this.active;
        if (!active || !sameBinding(active.binding, binding))
            return { workspaceId: binding.id, sessionId: null, messages: [], turn: null, generating: false, live: '' };
        const events = active.session.snapshotEvents();
        const state = project(events);
        for (const [turn, entry] of this.stoppedText) {
            const end = events.find(e => e.type === 'turn/end' && e.data.turn === turn);
            if (!end || events.some(e => e.type === 'assistant/message' && e.data.turn === turn && e.data.step === entry.step
                && e.data.message?.content?.some(block => block.type === 'text' && block.text)))
                continue;
            state.messages.push({ role: 'assistant', turn, id: end.seq, text: entry.text });
        }
        if (this.stoppedText.size)
            state.messages.sort((a, b) => a.id - b.id);
        return { workspaceId: binding.id, sessionId: active.id, ...state, generating: state.turn !== null || this.pending,
            live: state.turn !== null && this.attempt?.turn === state.turn ? this.attempt.text : '' };
    }
    run(action, input) {
        let binding;
        try {
            binding = { ...this.binding() };
        }
        catch (error) {
            return Promise.reject(error);
        }
        const revision = this.revision;
        const job = this.tail.then(() => this.execute(action, input, binding, revision));
        this.tail = job.catch(() => { });
        return job;
    }
    current(binding, revision, id) {
        if (revision !== this.revision)
            throw Error('小窗已关闭，操作已取消');
        if (!sameBinding(binding, this.binding()))
            throw Error('工作区已切换，操作已取消');
        const ws = this.native.workspaceRegistry.get(binding.id);
        if (!ws || ws.path !== binding.path)
            throw Error('工作区已切换，请重新打开小窗');
        if (id && (!ws.sessionIds.includes(id) || this.native.workspaceRegistry.archivedSessionIds.includes(id)))
            throw Error('该会话不属于当前工作区或已归档');
        return ws;
    }
    async execute(action, input, binding, revision) {
        this.current(binding, revision);
        await this.native.prepareWorkspace?.();
        const ws = this.current(binding, revision), n = this.native, key = binding.storageId ?? binding.id;
        if (input.workspaceId && input.workspaceId !== binding.id)
            throw Error('工作区已切换，请重新打开小窗');
        let id = this.saved(key), associate = false;
        if (id && (!ws.sessionIds.includes(id) || n.workspaceRegistry.archivedSessionIds.includes(id)))
            id = undefined;
        if (action === 'open' && input.sessionId) {
            if (!ws.sessionIds.includes(input.sessionId) || n.workspaceRegistry.archivedSessionIds.includes(input.sessionId))
                throw Error('该会话不属于当前工作区或已归档');
            id = input.sessionId;
            associate = true;
        }
        if (action !== 'open' && (!id || id !== input.sessionId))
            throw Error('会话已改变，请重新打开小窗');
        if (action === 'new' && id) {
            if (this.snapshot().generating || n.agents.get(id)?.status === 'running')
                throw Error('请先停止或等回复完成');
            const session = n.agents.get(id)?.session;
            if (session) {
                const saved = await n.sessions.flush(session);
                this.current(binding, revision, id);
                if (saved === false)
                    throw Error('会话记录暂未保存，请稍后再新建会话');
            }
            await n.workspaceRegistry.archiveSession(id);
            this.current(binding, revision);
            id = undefined;
        }
        if (!id) {
            id = (await n.sessionController.create({ workspaceId: binding.id, sessionId: 'chatpet-' + randomUUID() })).sessionId;
            this.current(binding, revision, id);
            associate = true;
        }
        const { agent, error } = await n.sessionController.resolveAgent(id);
        this.current(binding, revision, id);
        if (error)
            throw error;
        if (!agent || agent.session.id !== id || agent.session.header.cwd !== binding.path)
            throw Error('当前会话不属于绑定工作区');
        if (associate)
            this.save(key, id);
        if (this.active?.id !== id) {
            this.attempt = undefined;
            this.pending = false;
            this.stoppedText.clear();
        }
        this.active = { id, binding, session: agent.session };
        if (action === 'send') {
            const text = input.text?.trim();
            if ((!text && !input.image) || !input.requestId || input.requestId.length > 160)
                throw Error('消息内容或请求编号无效');
            const duplicate = agent.session.snapshotEvents().some(e => e.type === 'user/message' && e.data.source?.rpcId === input.requestId);
            if (!duplicate) {
                if (this.snapshot().generating || agent.status === 'running')
                    throw Error('请先等待或停止当前回复');
                this.pending = true;
                try {
                    const content = input.image ? await n.admitImage?.(input.image) : [];
                    if (input.image && !content)
                        throw Error('原生图片附件服务暂不可用');
                    this.current(binding, revision, id);
                    const message = createUserMessage({ content: [...(text ? [{ type: 'text', text }] : []), ...(content ?? [])], source: { kind: 'user', rpcId: input.requestId } });
                    this.claimUsage?.(id, message.id);
                    agent.followup(message);
                }
                catch (cause) {
                    this.pending = false;
                    throw cause;
                }
            }
        }
        else if (action === 'stop') {
            const current = this.snapshot().turn;
            if (typeof input.turn !== 'number' || input.turn !== current)
                throw Error('此轮已结束');
            if (this.attempt?.turn === current && this.attempt.text)
                this.stoppedText.set(current, { text: this.attempt.text, step: this.attempt.step });
            n.sessionController.cancel({ sessionId: id });
        }
        this.changed();
        return this.snapshot();
    }
}
//# sourceMappingURL=conversation.js.map