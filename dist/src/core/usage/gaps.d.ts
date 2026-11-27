import type { CoreStore } from '../storage.js';
declare const empty: {
    writeFailed: number;
    unbound: number;
    rebound: number;
};
export declare function readGaps(store: CoreStore, day: string): {
    writeFailed: number;
    unbound: number;
    rebound: number;
};
export declare function recordGap(store: CoreStore, day: string, reason: keyof typeof empty): void;
export {};
