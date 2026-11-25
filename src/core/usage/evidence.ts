import type { SenderEntry, UsageEntry } from '../../contracts/usage.js';
import type { SourceBranch, SourceInput } from '../../contracts/tables.js';

type Admission = { message: SourceInput['message']; selection: { branch: Pick<SourceBranch<unknown>, 'turnKind'|'usageEntry'> } };

export class UsageEvidence {
  private readonly claims = new Map<string, SenderEntry>();
  private readonly steps = new Map<string, UsageEntry>();

  claim(sessionId: string, messageId: string, entry: SenderEntry) {
    this.claims.set(JSON.stringify([sessionId, messageId]), entry);
    if (this.claims.size > 4096) this.claims.delete(this.claims.keys().next().value!);
  }

  owner = ({sessionId, message}: SourceInput): UsageEntry =>
    this.claims.get(JSON.stringify([sessionId, message.id])) ?? 'dsh';

  admit(sessionId: string, accepted: readonly Admission[]) {
    // Empty follow-up steps continue the same turn's admitted input.
    const first = accepted.find(item => item.selection.branch.turnKind === 'foreground') ?? accepted[0];
    if (!first) return;
    const declaration = first.selection.branch.usageEntry;
    const entry = typeof declaration === 'function' ? declaration({sessionId, message:first.message}) : declaration;
    this.steps.set(sessionId, entry ?? 'unknown');
    for (const {message} of accepted) this.claims.delete(JSON.stringify([sessionId, message.id]));
  }

  step(sessionId: string) { return this.steps.get(sessionId); }
  end(sessionId: string) { this.steps.delete(sessionId); }
}
