export class UsageEvidence {
    claims = new Map();
    steps = new Map();
    claim(sessionId, messageId, entry) {
        this.claims.set(JSON.stringify([sessionId, messageId]), entry);
        if (this.claims.size > 4096)
            this.claims.delete(this.claims.keys().next().value);
    }
    owner = ({ sessionId, message }) => this.claims.get(JSON.stringify([sessionId, message.id])) ?? 'dsh';
    admit(sessionId, accepted) {
        this.beginStep(sessionId, accepted)?.(true);
    }
    beginStep(sessionId, accepted, signal) {
        // Empty follow-up steps continue the same turn's admitted input.
        const first = accepted.find(item => item.selection.branch.turnKind === 'foreground') ?? accepted[0];
        if (!first || signal?.aborted)
            return;
        const declaration = first.selection.branch.usageEntry;
        const entry = typeof declaration === 'function' ? declaration({ sessionId, message: first.message }) : declaration;
        const previous = this.steps.get(sessionId), current = { entry: entry ?? 'unknown' };
        this.steps.set(sessionId, current);
        const rollback = () => {
            if (this.steps.get(sessionId) !== current)
                return;
            if (previous)
                this.steps.set(sessionId, previous);
            else
                this.steps.delete(sessionId);
        };
        signal?.addEventListener('abort', rollback, { once: true });
        return (entered) => {
            signal?.removeEventListener('abort', rollback);
            if (!entered)
                rollback();
            else if (this.steps.get(sessionId) === current) {
                for (const { message } of accepted)
                    this.claims.delete(JSON.stringify([sessionId, message.id]));
            }
        };
    }
    step(sessionId) { return this.steps.get(sessionId)?.entry; }
    end(sessionId) { this.steps.delete(sessionId); }
}
//# sourceMappingURL=evidence.js.map