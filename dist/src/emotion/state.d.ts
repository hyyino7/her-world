import type { EmotionSnapshot, EmotionState, EmotionUpdate } from '../contracts/emotion.js';
interface Scope {
    path: string;
    companionId: string;
    scopeId: string;
    storageId: string;
}
interface Document {
    schema: 1;
    companionId: string;
    scopeId: string;
    storageId: string;
    revision: number;
    current: EmotionState | null;
}
export declare function readEmotionState(value: unknown): EmotionState;
export declare class EmotionFile {
    private readonly scope;
    constructor(scope: Scope);
    /** Prepare the existing canonical store without inventing a first feeling. */
    initialize(): void;
    private location;
    private empty;
    load(): {
        document: Document;
        contentHash: string;
    };
    snapshot(value: ReturnType<EmotionFile['load']>): EmotionSnapshot;
    private write;
    update(input: EmotionUpdate, at?: number): EmotionSnapshot;
}
export {};
