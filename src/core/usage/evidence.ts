import type { SenderEntry, UsageEntry } from '../../contracts/usage.js';
import type { SourceBranch, SourceInput } from '../../contracts/tables.js';

type Admission = { message: SourceInput['message']; selection: { branch: Pick<SourceBranch<unknown>, 'turnKind'|'usageEntry'> } };

export class UsageEvidence {
  private readonly claims = new Map<string, SenderEntry>();
  private readonly steps = new Map<string, {entry: UsageEntry}>();

  claim(sessionId: string, messageId: string, entry: SenderEntry) {
    this.claims.set(JSON.stringify([sessionId, messageId]), entry);
    if (this.claims.size > 4096) this.claims.delete(this.claims.keys().next().value!);
  }

  owner = ({sessionId, message}: SourceInput): UsageEntry =>
    this.claims.get(JSON.stringify([sessionId, message.id])) ?? 'dsh';

  admit(sessionId: string, accepted: readonly Admission[]) {
    this.beginStep(sessionId, accepted)?.(true);
  }

  beginStep(sessionId: string, accepted: readonly Admission[], signal?: AbortSignal) {
    // Empty follow-up steps continue the same turn's admitted input.
    const first = accepted.find(item => item.selection.branch.turnKind === 'foreground') ?? accepted[0];
    if (!first || signal?.aborted) return;
    const declaration = first.selection.branch.usageEntry;
    const entry = typeof declaration === 'function' ? declaration({sessionId, message:first.message}) : declaration;
    const previous = this.steps.get(sessionId), current = {entry: entry ?? 'unknown'} as const;
    this.steps.set(sessionId, current);
    const rollback = () => {
      if (this.steps.get(sessionId) !== current) return;
      if (previous) this.steps.set(sessionId, previous);
      else this.steps.delete(sessionId);
    };
    signal?.addEventListener('abort', rollback, {once:true});
    return (entered: boolean) => {
      signal?.removeEventListener('abort', rollback);
      if (!entered) rollback();
      else if (this.steps.get(sessionId) === current) {
        for (const {message} of accepted) this.claims.delete(JSON.stringify([sessionId, message.id]));
      }
    };
  }

  step(sessionId: string) { return this.steps.get(sessionId)?.entry; }
  end(sessionId: string) { this.steps.delete(sessionId); }
}
