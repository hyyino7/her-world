import { digest } from '../core/storage.js';
const kind = 'channel-received';
/** Pending input is a receipt checkpoint, not another chat log or agent queue.
 * The original QQ batcher and native inbox still execute every request. */
export function createQQInbox(options) {
    const { store, storageId } = options;
    let cachedCounts;
    const valid = (row) => options.active() && row.storageId === storageId
        && options.allowed(row.identity) && options.owner(row.identity) === row.owner;
    const keyFor = (id) => digest([storageId, id.channel, id.accountId, id.conversationType, id.conversationId, id.speakerId, id.platformMessageId]);
    function save(row) { store.put(kind, row.key, row); cachedCounts = undefined; return row; }
    function readBatch(key) { return store.get(kind, key); }
    function admitted(batch) {
        store.transaction(() => {
            // Native transcripts now own the content. Retain only dedupe/routing proof.
            for (const key of batch.inputs) {
                const row = store.get(kind, key);
                store.put(kind, key, { kind: row.kind, version: 1, key, storageId, owner: row.owner, identity: row.identity, state: 'admitted', batchId: batch.key });
            }
            store.put(kind, batch.key, { kind: batch.kind, version: 1, key: batch.key, storageId, owner: batch.owner, identity: batch.identity, state: 'admitted',
                inputs: batch.inputs, sessionId: batch.submission.sessionId, messageId: batch.submission.message.id,
                sourceDigest: digest(batch.submission.message.source) });
        });
        cachedCounts = undefined;
    }
    return {
        receive(input) {
            if (!options.active() || !options.allowed(input.identity))
                return;
            const key = keyFor(input.identity), previous = store.get(kind, key);
            if (previous)
                return previous.kind === 'qq-input' && valid(previous) ? previous : undefined;
            return save({ ...input, kind: 'qq-input', version: 1, key, storageId, owner: options.owner(input.identity), state: 'received' });
        },
        ready(row, mode, wake) {
            if (!valid(row))
                return;
            const current = store.get(kind, row.key);
            if (current.state !== 'received')
                return current;
            if (!wake) {
                save({ kind: current.kind, version: 1, key: current.key, storageId, owner: current.owner, identity: current.identity, state: 'ignored' });
                return { ...current, mode, state: 'ignored' };
            }
            return save({ ...current, mode, state: wake ? 'queued' : 'ignored' });
        },
        pendingInputs: () => store.all(kind).filter(row => row?.kind === 'qq-input' && valid(row) && ['received', 'queued'].includes(row.state)),
        pendingBatches: () => store.all(kind).filter(row => row?.kind === 'qq-batch' && valid(row) && row.state !== 'admitted'),
        batch(items, question, context) {
            if (!items.length || items.some(row => !valid(row)))
                return;
            return store.transaction(() => {
                if (items.some(row => store.get(kind, row.key)?.state !== 'queued'))
                    return;
                const last = items.at(-1), key = 'qq-batch:' + digest(items.map(row => row.key));
                const result = save({ kind: 'qq-batch', version: 1, key, storageId, owner: last.owner, identity: last.identity, state: 'queued',
                    inputs: items.map(row => row.key), question, context, mode: last.mode });
                for (const row of items)
                    save({ ...row, state: 'batched', batchId: key });
                return result;
            });
        },
        checkpoint(batch, submission) {
            const current = readBatch(batch.key);
            if (!valid(current) || current.state === 'admitted')
                throw Error('QQ original input binding is unavailable');
            if (current.submission && digest(current.submission) !== digest(submission))
                throw Error('QQ original submission changed');
            save({ ...current, state: 'unknown', submission });
        },
        async reconcile(batch) {
            const current = readBatch(batch.key);
            if (!valid(current))
                return 'blocked';
            if (current.state === 'admitted')
                return 'admitted';
            if (!current.submission)
                return 'ready';
            let result;
            try {
                result = await options.probe(current.submission);
            }
            catch {
                result = 'unknown';
            }
            if (!valid(current))
                return 'blocked';
            if (result === 'admitted') {
                admitted(current);
                return 'admitted';
            }
            save({ ...current, state: result === 'absent' ? 'queued' : 'unknown' });
            return result === 'absent' ? 'ready' : 'unknown';
        },
        current: readBatch,
        inputs: (batch) => batch.inputs.map(key => store.get(kind, key)),
        counts() {
            if (cachedCounts)
                return { ...cachedCounts };
            const rows = store.all(kind).filter(row => row?.storageId === storageId && row.identity?.channel === 'qq');
            cachedCounts = { pending: rows.filter(row => row.kind === 'qq-input' && ['received', 'queued', 'batched'].includes(row.state)).length,
                uncertain: rows.filter(row => row.kind === 'qq-batch' && row.state === 'unknown').length };
            return { ...cachedCounts };
        },
    };
}
/** Read the native splice vocabulary without mutating/replaying its inbox.
 * Any removed/canceled/consumed trace without user/message remains uncertain. */
export function qqAdmission(events, message) {
    const lists = { 'next-turn': [], 'next-step': [] };
    let seen = false, conflict = false;
    const matches = (word) => word?.id === message.id;
    for (const event of events) {
        if (event.type === 'user/message' && matches(event.data)) {
            return digest(event.data.source) === digest(message.source) && digest(event.data.content) === digest(message.content) ? 'admitted' : 'unknown';
        }
        if (event.type !== 'agent/inbox/spliced')
            continue;
        const { target, start, removedCount, inserted } = event.data;
        if (!lists[target] || !Number.isInteger(start) || !Array.isArray(inserted)) {
            conflict = true;
            continue;
        }
        const words = lists[target], removed = words.splice(start, removedCount ?? 0, ...inserted);
        if (inserted.some(matches) || removed.some(matches))
            seen = true;
    }
    return conflict || seen ? 'unknown' : 'absent';
}
/** Reads only the originally captured native session, including archived logs.
 * It never resolves/creates a home merely to prove whether input was admitted. */
export async function probeQQAdmission(native, submission, active) {
    if (!active())
        return 'unknown';
    const session = native.sessions.get(submission.sessionId);
    if (session && !await native.sessions.flush(session))
        return 'unknown';
    if (!active())
        return 'unknown';
    const reader = await native.get('sessionPersistence').open(submission.sessionId, 'read');
    let result;
    try {
        result = qqAdmission((await reader.read()).events, submission.message);
    }
    finally {
        await reader.close();
    }
    if (!active())
        return 'unknown';
    if (result !== 'absent')
        return result;
    const agent = native.agents.get(submission.sessionId);
    if (agent && (agent.status !== 'idle' || [...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(item => item.id === submission.message.id)))
        return 'unknown';
    return 'absent';
}
//# sourceMappingURL=qq-inbox.js.map