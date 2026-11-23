import type { CompanionSettings } from '../core/companion-settings.js';
import type { StreamChunk } from '@deepseek-ai/dsh-llm';
import { type EmotionRoomMood } from '../contracts/emotion.js';
/** The same strict threshold applies on a timer, after dragging and after an animation ends. */
export declare function workAnimationEligible(startedAt: number | null, now: number, delaySeconds: number): boolean;
export interface ExpressionAsset {
    name: string;
    description: string;
    label?: string;
}
export interface ExpressionCatalog {
    actions: ExpressionAsset[];
    stickers: ExpressionAsset[];
}
/** Shared semantic vocabulary; optional Room scores remain a separate legacy representation. */
export { COMPANION_FEELINGS } from '../contracts/emotion.js';
export type RoomMood = EmotionRoomMood;
export declare function readRoomMood(value: unknown): RoomMood | undefined;
export interface ReplyIntent {
    action?: string;
    sticker?: string;
    mood?: string;
    /** Semantic feelings, such as anger or boredom; not a numeric happiness conversion. */
    feelings?: string[];
    roomMood?: RoomMood;
    reason?: string;
    feedback?: {
        playbackId: string;
        quote: string;
    };
}
export interface ExpressionEvent {
    workspaceId: string;
    sessionId: string;
    turn: number;
    action?: string;
    sticker?: string;
    mood?: string;
    feelings?: string[];
    /** Human-readable expression intent for displays without the corresponding asset. */
    actionLabel?: string;
}
export interface PlaybackReceipt {
    workspaceId: string;
    id: string;
    name: string;
    status: 'playing' | 'ended' | 'cancelled' | 'failed';
    kind: 'expression' | 'random' | 'idle' | 'work';
}
export declare function decideExpression(intent: ReplyIntent, catalog: ExpressionCatalog, settings: Pick<CompanionSettings, 'stickerProbabilityPercent'>, random?: () => number): Pick<ExpressionEvent, 'action' | 'sticker' | 'mood' | 'feelings'>;
export declare function expressionStream(stream: AsyncIterable<StreamChunk>, collect: (intent: ReplyIntent) => void): AsyncGenerator<StreamChunk>;
