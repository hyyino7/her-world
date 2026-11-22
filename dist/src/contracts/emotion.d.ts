/** Emotion is companion state, independent of a display or an autonomous Life turn. */
export declare const ROOM_MOOD_DIMENSIONS: readonly ["happy", "calm", "sweet", "heartache", "worry", "sad", "jealous"];
export declare const COMPANION_FEELINGS: readonly ["happy", "calm", "sweet", "heartache", "worry", "sad", "jealous", "anger", "boredom"];
export type CompanionFeeling = typeof COMPANION_FEELINGS[number];
export declare function isCompanionFeeling(value: unknown): value is CompanionFeeling;
export interface EmotionDependency {
    id: string;
    revision: string;
}
export interface EmotionDependencies {
    sources: EmotionDependency[];
    memories: EmotionDependency[];
}
export interface EmotionRoomMood {
    mood: number;
    dims: Partial<Record<typeof ROOM_MOOD_DIMENSIONS[number], number>>;
}
export interface EmotionState {
    mood: string;
    reason: string;
    at: number;
    memories: string[];
    /** Semantic feelings, including anger and boredom, never inferred from words or converted to numeric happiness. */
    feelings?: string[];
    roomMood?: EmotionRoomMood;
    /** Retained legacy provenance metadata; Emotion no longer requires a live Memory provider. */
    dependencies?: EmotionDependencies;
}
export interface EmotionSnapshot {
    status: 'ready' | 'empty' | 'unavailable';
    revision: number;
    contentHash: string;
    state?: EmotionState;
    /** Legacy optional read metadata, retained for API compatibility. */
    material?: EmotionDependencies;
    reason?: string;
}
export interface EmotionUpdate {
    expectedRevision: number;
    expectedHash: string;
    mood: string;
    reason?: string;
    feelings?: string[];
    roomMood?: EmotionRoomMood;
    memories?: string[];
    dependencies?: EmotionDependencies;
}
export interface EmotionAsset {
    name: string;
    description: string;
    label?: string;
}
export interface EmotionCatalog {
    actions: EmotionAsset[];
    stickers: EmotionAsset[];
    supportedFeelings?: string[];
}
