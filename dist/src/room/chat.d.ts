import type { Context } from '@deepseek-ai/cordis';
import { type UserMessage } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { DesktopImages } from '../desktop/images.js';
import type { SourceAdapter } from '../contracts/tables.js';
import type { NativeSourceContext } from '../core/native/conversation.js';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'chatpet-room-tv': {
            kind: 'chatpet-room-tv';
            rpcId: string;
        };
    }
}
interface TelevisionSourceContext extends NativeSourceContext {
    sessionId: string;
}
export declare function televisionImage(input: unknown): {
    mediaType: string;
    data: string;
};
export declare function roomHistory(events: readonly SessionEvent[]): {
    role: "user" | "assistant";
    text: string;
}[];
export declare class RoomChat {
    private ctx;
    readonly images: DesktopImages;
    private readonly admission;
    private active?;
    private busy;
    private titles;
    private readonly stopping;
    constructor(ctx: Context);
    private get native();
    private binding;
    private prefix;
    private existing;
    isRoom(id: string): boolean;
    allows(id: string, message: UserMessage): boolean;
    watching(id: string): boolean;
    sourceAdapter(): SourceAdapter<TelevisionSourceContext>;
    private agent;
    history(workspaceId: string, validate: () => void): Promise<{
        ok: boolean;
        messages: {
            role: "user" | "assistant";
            text: string;
        }[];
    }>;
    reply(workspaceId: string, television: boolean, data: Record<string, unknown>, requestId: string, caller: AbortSignal, current: () => void): Promise<{
        ok: boolean;
        reply: string;
    }>;
    close(): Promise<void>;
}
export {};
