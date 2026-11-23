import type { Context } from '@deepseek-ai/cordis';
import type { PetCoreHost } from '../index.js';
/** Complete native log copies, not model-facing context. DSH remains the sole
 * session writer and validates imports through create/append/flush. */
export declare class NativeTranscripts {
    private ctx;
    private host;
    private tail;
    private pending;
    private flushing?;
    private closed;
    private timer?;
    private restored?;
    private channels;
    private last?;
    constructor(ctx: Context, host: PetCoreHost);
    private native;
    private target;
    private directory;
    private read;
    private write;
    private enqueue;
    private channelScope;
    /** Called only by the authenticated channel adapter after native workspace
     * creation. No arbitrary cwd, model tool or additional channel permission. */
    registerChannelWorkspace(workspaceId: string, directory: string, prefix: string): Promise<void>;
    capture(session: {
        id: string;
        header: {
            cwd?: string;
            parentSession?: unknown;
            agentPreset?: string;
        };
    }): void;
    private restoreCopy;
    restore(caller?: () => void): Promise<void>;
    private exportScope;
    private validateScope;
    private exportCaptured;
    save(sessionId: string): Promise<void>;
    schedule(sessionId: string): void;
    private arm;
    flush(force?: boolean): Promise<void>;
    close(): Promise<void>;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        petTranscripts: NativeTranscripts;
    }
}
export declare function installNativeTranscripts(ctx: Context, host: PetCoreHost): NativeTranscripts;
