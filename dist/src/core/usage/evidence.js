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
        // Empty follow-up steps continue the same turn's admitted input.
        const first = accepted.find(item => item.selection.branch.turnKind === 'foreground') ?? accepted[0];
        if (!first)
            return;
        const declaration = first.selection.branch.usageEntry;
        const entry = typeof declaration === 'function' ? declaration({ sessionId, message: first.message }) : declaration;
        this.steps.set(sessionId, entry ?? 'unknown');
        for (const { message } of accepted)
            this.claims.delete(JSON.stringify([sessionId, message.id]));
    }
    step(sessionId) { return this.steps.get(sessionId); }
    end(sessionId) { this.steps.delete(sessionId); }
}
//# sourceMappingURL=evidence.js.map