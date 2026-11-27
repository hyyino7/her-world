import type { SenderEntry, UsageEntry } from '../../contracts/usage.js';
import type { SourceBranch, SourceInput } from '../../contracts/tables.js';
type Admission = {
    message: SourceInput['message'];
    selection: {
        branch: Pick<SourceBranch<unknown>, 'turnKind' | 'usageEntry'>;
    };
};
export declare class UsageEvidence {
    private readonly claims;
    private readonly steps;
    claim(sessionId: string, messageId: string, entry: SenderEntry): void;
    owner: ({ sessionId, message }: SourceInput) => UsageEntry;
    admit(sessionId: string, accepted: readonly Admission[]): void;
    beginStep(sessionId: string, accepted: readonly Admission[], signal?: AbortSignal): ((entered: boolean) => void) | undefined;
    step(sessionId: string): "life" | "desktop" | "unknown" | "review" | "dsh" | "television" | "qq-owner" | "qq-guest" | "qq-nudge" | "wechat-owner" | "wechat-guest" | "chatpet-whisper" | "chatpet-dream" | "maintenance" | "room" | undefined;
    end(sessionId: string): void;
}
export {};
