import { type ConsoleOperation } from '../core/tables/console.js';
import type { Context } from '@deepseek-ai/cordis';
import type { PetCoreHost } from '../core/index.js';
import { type ExpressionEvent, type PlaybackReceipt, type ReplyIntent } from './index.js';
import { RecentLedger, type RecentExperience } from './recent.js';
import type { EmotionCatalog, EmotionSnapshot, EmotionState, EmotionUpdate } from '../contracts/emotion.js';
interface Turn {
    turn: number;
    workspaceId: string;
    path: string;
    intent?: ReplyIntent;
    user?: {
        id: string;
        text: string;
    };
    memoryIds: string[];
    memoryCalls: Map<string, {
        name: string;
        memoryId?: string;
        playbackId?: string;
    }>;
}
export declare class CompanionEmotion {
    readonly host: PetCoreHost;
    private readonly listeners;
    private readonly catalogs;
    private readonly confirmed;
    private readonly changes;
    private queue;
    private closed;
    /** Preset-local hook attachment; shares this service and its turn state. */
    attachGuest?: (scope: Context) => void;
    constructor(host: PetCoreHost);
    get catalog(): EmotionCatalog;
    registerCatalog(owner: string, catalog: EmotionCatalog): () => void;
    onExpression(listener: (event: ExpressionEvent) => void): () => void;
    onChanged(listener: (workspaceId: string, snapshot: EmotionSnapshot) => void): () => void;
    private confirm;
    private file;
    ledger(id: string): RecentLedger | null;
    recordPlayback(receipt: PlaybackReceipt): void;
    read(workspaceId: string): Promise<EmotionSnapshot>;
    current(workspaceId: string): EmotionState | undefined;
    roomSnapshot(workspaceId: string): {
        feelings?: string[] | undefined;
        label: string;
        updatedAt: number;
        mood?: number | undefined;
        dims?: Partial<Record<"happy" | "calm" | "sweet" | "heartache" | "worry" | "sad" | "jealous", number>> | undefined;
    } | undefined;
    update(workspaceId: string, input: EmotionUpdate, assertCurrent?: () => void): Promise<EmotionSnapshot>;
    experience(workspaceId: string): Promise<RecentExperience>;
    retire(workspaceId: string, memoryId: string): void;
    complete(sessionId: string, turn: Turn, current?: () => boolean): Promise<void>;
    private completeTurn;
    close(): Promise<void>;
}
export declare function emotionFor(host: PetCoreHost): CompanionEmotion;
export declare function installEmotion(ctx: Context, host: PetCoreHost): void;
export declare const name = "20-Emotion";
export declare const inject: string[];
declare module '@deepseek-ai/cordis' {
    interface Context {
        petEmotion: CompanionEmotion;
    }
    interface Events {
        'pet/emotion.expression'(value: ExpressionEvent): void;
        'pet/emotion.changed'(workspaceId: string, snapshot: EmotionSnapshot): void;
    }
}
export declare function emotionConsoleOperations(emotion: Pick<CompanionEmotion, 'current' | 'catalog' | 'read' | 'update'>): {
    operations: {
        emotionState: ConsoleOperation;
        emotionUpdate: ConsoleOperation;
    };
    status(workspaceId: string): {
        current: {
            mood: string;
            at: number;
        } | null;
        actions: string[];
        stickers: string[];
    };
};
export declare function apply(ctx: Context): void;
export {};
