import { createUserMessage } from '@deepseek-ai/dsh-llm';
interface Message {
    role?: string;
    source?: {
        kind?: string;
        rpcId?: string;
    };
    content?: readonly {
        type: string;
        text?: string;
    }[];
}
export interface NativeEvent {
    type: string;
    time: number;
    seq: number;
    data: {
        turn?: number;
        step?: number;
        message?: Message;
        interrupted?: boolean;
        reason?: {
            kind: string;
        };
        name?: string;
    } & Message;
}
export interface NativeSession {
    id: string;
    header: {
        cwd: string;
        parentSession?: unknown;
        origin?: string;
    };
    snapshotEvents(): NativeEvent[];
}
interface NativeAgent {
    status: string;
    session: NativeSession;
    followup(message: ReturnType<typeof createUserMessage>): void;
}
export interface NativeDesktopHost {
    prepareWorkspace?(): Promise<void>;
    admitImage?(image: {
        data: string;
        mediaType: string;
    }): Promise<ReturnType<typeof createUserMessage>['content']>;
    sessionController: {
        create(req: {
            workspaceId: string;
            sessionId: string;
        }): Promise<{
            sessionId: string;
        }>;
        resolveAgent(id: string): Promise<{
            agent?: NativeAgent;
            error?: Error;
        }>;
        cancel(req: {
            sessionId: string;
        }): {
            accepted: boolean;
        };
    };
    agents: {
        get(id: string): NativeAgent | undefined;
    };
    sessions: {
        flush(session: NativeSession): Promise<boolean | void>;
    };
    workspaceRegistry: {
        get(id: string): {
            path: string;
            sessionIds: readonly string[];
        } | undefined;
        archivedSessionIds: readonly string[];
        archiveSession(id: string): Promise<unknown>;
    };
}
export interface Binding {
    id: string;
    path: string;
    storageId?: string;
}
export declare function sameBinding(a: Binding, b: Binding): boolean;
interface DesktopCommand {
    sessionId?: string;
    workspaceId?: string;
    turn?: number;
    text?: string;
    requestId?: string;
    image?: {
        data: string;
        mediaType: string;
    };
}
type DesktopAction = 'open' | 'new' | 'send' | 'stop';
interface MessageRow {
    id: number;
    turn?: number;
    role: 'user' | 'assistant';
    text: string;
}
export declare function project(events: NativeEvent[]): {
    messages: MessageRow[];
    turn: number | null;
    reason: string;
};
export interface StreamFrame {
    type: 'start' | 'chunk' | 'end';
    attemptId: string;
    turn?: number;
    step?: number;
    index?: number;
    chunk?: {
        type: string;
        text?: string;
    };
}
export declare class Conversation {
    private native;
    private binding;
    private saved;
    private save;
    private changed;
    private claimUsage?;
    private active?;
    private attempt?;
    private tail;
    private pending;
    private revision;
    private readonly stoppedText;
    constructor(native: NativeDesktopHost, binding: () => Binding, saved: (workspace: string) => string | undefined, save: (workspace: string, id: string) => void, changed: () => void, claimUsage?: ((sessionId: string, messageId: string) => void) | undefined);
    get id(): string | undefined;
    /** Closing a view revokes its queued/in-flight commands, not the native chat. */
    invalidate(): void;
    frame(session: NativeSession, frame: StreamFrame): void;
    event(session: NativeSession, event: NativeEvent): void;
    snapshot(): {
        workspaceId: string;
        sessionId: null;
        messages: never[];
        turn: null;
        generating: boolean;
        live: string;
    } | {
        generating: boolean;
        live: string;
        messages: MessageRow[];
        turn: number | null;
        reason: string;
        workspaceId: string;
        sessionId: string;
    };
    run(action: DesktopAction, input: DesktopCommand): Promise<{
        workspaceId: string;
        sessionId: null;
        messages: never[];
        turn: null;
        generating: boolean;
        live: string;
    } | {
        generating: boolean;
        live: string;
        messages: MessageRow[];
        turn: number | null;
        reason: string;
        workspaceId: string;
        sessionId: string;
    }>;
    private current;
    private execute;
}
export {};
