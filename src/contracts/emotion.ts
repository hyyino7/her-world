/** Emotion is companion state, independent of a display or an autonomous Life turn. */
export const ROOM_MOOD_DIMENSIONS = ['happy', 'calm', 'sweet', 'heartache', 'worry', 'sad', 'jealous'] as const;
export const COMPANION_FEELINGS = [...ROOM_MOOD_DIMENSIONS, 'anger', 'boredom'] as const;
export type CompanionFeeling = typeof COMPANION_FEELINGS[number];
export function isCompanionFeeling(value: unknown): value is CompanionFeeling {
  return COMPANION_FEELINGS.some(feeling => feeling === value);
}
export interface EmotionDependency { id: string; revision: string }
export interface EmotionDependencies { sources: EmotionDependency[]; memories: EmotionDependency[] }
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
}
export interface EmotionAsset { name: string; description: string; label?: string }
export interface EmotionCatalog {
  actions: EmotionAsset[];
  stickers: EmotionAsset[];
  supportedFeelings?: string[];
}
