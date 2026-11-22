import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { RoomWindow } from './window.js';
import { RoomChat } from './chat.js';
export declare const roomStateDeclaration: {
    name: string;
    sources: readonly ("life" | "owner" | "review")[];
    historyOverview(_args: unknown, value: unknown): {
        [x: string]: any;
    } | undefined;
};
export declare const roomHistoryTools: readonly [{
    name: string;
    sources: readonly ("life" | "owner" | "review")[];
    historyOverview(_args: unknown, value: unknown): {
        [x: string]: any;
    } | undefined;
}, {
    name: string;
    sources: readonly ("life" | "owner" | "review")[];
    historyOverview(args: unknown, value: unknown): {
        [x: string]: any;
    } | undefined;
}];
export declare class Room {
    private ctx;
    readonly chat: RoomChat;
    private closed;
    private readonly lifetime;
    private receipts;
    private subscriptions;
    readonly window: RoomWindow;
    constructor(ctx: Context);
    open(workspaceId: string): Promise<{
        running: boolean;
        ready: boolean;
        workspaceId: string | null;
    }>;
    closeWindow(): void;
    status(): {
        running: boolean;
        ready: boolean;
        workspaceId: string | null;
    };
    private binding;
    private assert;
    private admission;
    request(workspaceId: string, endpoint: string, data: Record<string, unknown>, requestId: string, caller: AbortSignal): Promise<unknown>;
    watching(id: string): boolean;
    toolScope(agent?: Agent): string | undefined;
    private checked;
    private toolAdmission;
    tools(): ToolDefinition[];
    close(): Promise<void>;
}
export declare const name = "50-Room";
export declare const inject: string[];
declare module '@deepseek-ai/cordis' {
    interface Context {
        petRoom: Room;
    }
}
export declare function apply(ctx: Context): void;
