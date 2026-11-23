/** Emotion is companion state, independent of a display or an autonomous Life turn. */
export const ROOM_MOOD_DIMENSIONS = ['happy', 'calm', 'sweet', 'heartache', 'worry', 'sad', 'jealous'];
export const COMPANION_FEELINGS = [...ROOM_MOOD_DIMENSIONS, 'anger', 'boredom'];
export function isCompanionFeeling(value) {
    return COMPANION_FEELINGS.some(feeling => feeling === value);
}
//# sourceMappingURL=emotion.js.map