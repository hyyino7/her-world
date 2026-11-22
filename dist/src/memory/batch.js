import { digest } from '../core/storage.js';
/** dsh-chatbot's turn/idle/minimum-interval policy over DSH's existing
 * compaction maintenance transaction. Original events remain in the native log. */
export function installMemoryBatch(ctx, host) {
    const store = host.workspace.runtime.store;
    const running = new Map();
    const reviews = new Set();
    const requests = host.native.registerReviewCompaction(id => { if (host.native.memoryFor(id))
        reviews.add(id); }, id => Boolean(store.get('memory-batch', id)?.turns));
    const matches = (row) => {
        const status = host.workspace.status();
        return status.state === 'ready' && status.target?.id === row.workspaceId && status.target.path === row.path;
    };
    ctx.on('session/event', (session, event) => {
        if (!host.native.memoryFor(session.id) || event.type !== 'turn/end' || event.data.reason.kind !== 'completed')
            return;
        const native = ctx;
        const bound = host.workspace.sessionStatus(session, native.get('workspaceRegistry'));
        const scope = host.native.nativeScopeFor(session.id);
        if (!scope || (!scope.guest && (bound?.state !== 'ready' || !bound.target)))
            return;
        const old = store.get('memory-batch', session.id);
        store.put('memory-batch', session.id, { sessionId: session.id, workspaceId: scope.workspaceId, path: scope.path,
            turns: (old?.turns ?? 0) + 1, lastActivity: event.time, lastAttempt: old?.lastAttempt ?? 0, retryAt: old?.retryAt ?? 0, failures: old?.failures ?? 0, ...(old?.summary ? { summary: old.summary } : {}), ...(old?.lastSummary ? { lastSummary: old.lastSummary } : {}) });
    }, { global: true });
    async function run(row, agent, signal) {
        const memory = host.native.memoryFor(row.sessionId);
        const services = ctx;
        const presets = services.get('agentPresets');
        const compaction = (presets?.serviceFor?.(agent, 'compaction') ?? services.get('compaction'));
        if (!memory || !compaction)
            throw Error('Native compaction service is unavailable');
        const binding = await memory.prepare(row.sessionId);
        if (!matches(row) || signal.aborted)
            return false;
        memory.assertBinding(binding);
        let pending = row.summary;
        const recovered = [...agent.session.snapshotEvents()].reverse().find(event => String(event.type) === 'compaction/summary' && event.time >= row.lastActivity);
        if (!pending && recovered) {
            const data = recovered.data;
            pending = { seq: recovered.seq, content: data.summary.flatMap(part => part.type === 'text' ? [part.text ?? ''] : []).join('\n'),
                sources: store.get('native-session-sources', row.sessionId) ?? [], turns: row.turns };
        }
        if (!pending) {
            const result = await compaction.compactNow(agent, signal);
            if (!matches(row) || signal.aborted)
                return false;
            memory.assertBinding(binding);
            if (result) {
                pending = { seq: result.summarySeq,
                    content: result.summary.flatMap(part => part.type === 'text' ? [part.text ?? ''] : []).join('\n'),
                    sources: store.get('native-session-sources', row.sessionId) ?? [], turns: row.turns };
                const latest = store.get('memory-batch', row.sessionId);
                store.put('memory-batch', row.sessionId, { ...latest, summary: pending });
            }
        }
        if (pending) {
            const checkpoint = pending.seq;
            let withheld = null;
            const sources = [...pending.sources];
            memory.assertBinding(binding);
            const bank = binding.storageId;
            const tracked = sources.every(id => store.get('memory-source-work', id)?.workspaceId === bank);
            // A native checkpoint can still contain original text from a Memory-off
            // period. Keep it in DSH, but do not silently backfill it into the Bank.
            if (!tracked) {
                pending = undefined;
                withheld = 'memory_off_sources_not_observed';
            }
            if (pending)
                await memory.capture(sources, binding);
            // Withhold a checkpoint containing withdrawn material without rejecting
            // the native chat or retrying the same unusable summary indefinitely.
            const decision = pending ? await memory.connection.validate({ sources: sources.map(id => ({ id, revision: '1' })), memories: [] }, bank) : 'ineligible';
            memory.assertBinding(binding);
            if (decision === 'unknown')
                throw Error('Memory summary source status unavailable');
            if (decision === 'ineligible' && pending) {
                pending = undefined;
                withheld = 'source_withdrawn_or_corrected';
            }
            const saved = pending && sources.length ? await memory.connection.call('summary', { session_id: row.sessionId, summary_seq: pending.seq, content: pending.content,
                sources: sources.map(id => ({ id, revision: '1' })) }, bank) : undefined;
            memory.assertBinding(binding);
            if (saved?.id && pending)
                store.put('native-summary-memory', digest([row.sessionId, pending.seq]), saved.id);
            const latest = store.get('memory-batch', row.sessionId);
            store.put('memory-batch', row.sessionId, { ...latest, lastSummary: { seq: checkpoint, state: saved?.id ? 'joined' : 'withheld', reason: saved?.id ? null : withheld ?? 'no_observed_sources', at: Date.now() } });
        }
        memory.assertBinding(binding);
        const latest = store.get('memory-batch', row.sessionId);
        // Maintenance serializes waking input; preserve any newly completed turns.
        const { summary: _summary, error: _error, ...clean } = latest;
        store.put('memory-batch', row.sessionId, { ...clean, turns: Math.max(0, latest.turns - (pending?.turns ?? row.turns)), failures: 0, retryAt: 0 });
        return true;
    }
    const interval = setInterval(() => {
        for (const row of store.all('memory-batch')) {
            if (!row.turns || !matches(row) || running.has(row.sessionId))
                continue;
            const configured = host.workspace.companionConfiguration(), now = Date.now();
            const review = reviews.has(row.sessionId) && host.native.companionPorts.get('isRunningLifeHome')?.(row.sessionId);
            const dueTurns = configured.memorySummaryTurns != null && row.turns >= configured.memorySummaryTurns;
            const dueIdle = configured.memorySummaryIdleMinutes != null && now - row.lastActivity >= configured.memorySummaryIdleMinutes * 60_000;
            if (!review && !dueTurns && !dueIdle)
                continue;
            if (row.retryAt && now < row.retryAt)
                continue;
            if (row.lastAttempt && now - row.lastAttempt < Math.max(1000, (configured.memorySummaryMinimumMinutes ?? 0) * 60_000))
                continue;
            const agent = ctx.agents.get(row.sessionId);
            if (!agent || agent.status !== 'idle')
                continue;
            const abort = new AbortController();
            store.put('memory-batch', row.sessionId, { ...row, lastAttempt: now });
            const done = run(row, agent, abort.signal).then(consumed => {
                if (consumed && !abort.signal.aborted && review)
                    reviews.delete(row.sessionId);
            }).catch(error => {
                const latest = store.get('memory-batch', row.sessionId);
                if (latest && matches(row)) {
                    const messages = [];
                    for (let e = error; e instanceof Error; e = e.cause)
                        messages.push(e.message);
                    const failures = (latest.failures ?? 0) + 1;
                    // dsh-chatbot native-chat.ts: failed work backs off, retaining originals.
                    const delay = [60_000, 300_000, 900_000, 3_600_000][Math.min(failures - 1, 3)];
                    store.put('memory-batch', row.sessionId, { ...latest, failures, retryAt: Date.now() + delay, error: messages.join(': ') || 'Summary failed' });
                }
                ctx.logger('chatpet-memory').warn('Batch summary pending; original conversation retained', error);
            }).finally(() => running.delete(row.sessionId));
            running.set(row.sessionId, { abort, done });
        }
    }, 1000);
    interval.unref();
    const stop = async () => {
        clearInterval(interval);
        const revoke = requests.revoke();
        reviews.clear();
        for (const job of running.values())
            job.abort.abort();
        await Promise.all([...running.values()].map(job => job.done).concat(revoke));
    };
    ctx.effect(() => stop);
    return stop;
}
//# sourceMappingURL=batch.js.map