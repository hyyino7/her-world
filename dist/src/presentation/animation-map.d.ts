export interface AnimationAsset {
    id: string;
    roomClip: string;
    desktopClip: string;
    file: string;
    posterFile?: string;
    durationMs: number;
    composition?: string;
}
export interface AnimationSlot {
    id: string;
    clips: string[];
    match: 'direct' | 'combined' | 'proxy' | 'blank';
    uncovered: string[];
    stickers: string[];
    bodySource?: 'current' | 'return';
    selectedFoodPosition?: number;
    mirror?: boolean;
}
export interface AnimationSticker {
    id: string;
    label: string;
    file: string;
}
export declare const animationAssets: Record<string, AnimationAsset>;
export declare const animationSlots: Record<string, AnimationSlot>;
export declare const animationStickers: Record<string, AnimationSticker>;
export declare const animationRoomAliases: Record<string, string>;
