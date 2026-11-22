import { Context } from '@deepseek-ai/cordis';
import type { VoiceCall, VoiceProvider } from '../../contracts/voice.js';
export declare class VoiceTable {
    private readonly slots;
    register(scope: Context, provider: VoiceProvider): {
        lease: import("../../contracts/tables.js").RegistrationLease;
        revoke: () => Promise<void>;
    };
    lookup(ctx: Context, callerSignal?: AbortSignal): VoiceCall | undefined;
}
