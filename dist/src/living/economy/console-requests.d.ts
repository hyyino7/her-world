import type { DatabaseSync } from 'node:sqlite';
import type { PlannedExecution } from '../../contracts/behavior.js';
import type { EconomyConfigurationPatch, ReadingContent } from './types.js';
declare const actionEndpoint = "economyAction", settingsEndpoint = "economySettings";
type WalletFields = {
    amount?: number;
    itemId?: string;
    quantity?: number;
    note?: string;
    title?: string;
    content?: string;
    format?: ReadingContent['format'];
    source?: {
        name: string;
    };
};
declare const receipt: {
    grant: (_id: string, { amount, note }: WalletFields) => {
        readonly operation: "grant-money";
        readonly payload: {
            readonly amount: number | undefined;
            readonly note: string | undefined;
        };
    };
    gift: (_id: string, { itemId, quantity, note }: WalletFields) => {
        readonly operation: "gift-item";
        readonly payload: {
            readonly itemId: string | undefined;
            readonly quantity: number | undefined;
            readonly note: string | undefined;
        };
    };
    buy: (_id: string, { itemId, quantity }: WalletFields) => {
        readonly operation: "purchase";
        readonly payload: {
            readonly itemId: string | undefined;
            readonly quantity: number | undefined;
        };
    };
    sell: (_id: string, { itemId, quantity }: WalletFields) => {
        readonly operation: "sell";
        readonly payload: {
            readonly itemId: string | undefined;
            readonly quantity: number | undefined;
        };
    };
    importReading: (id: string, { title, content, format, source }: WalletFields) => {
        readonly operation: "import-reading";
        readonly payload: {
            readonly source: {
                readonly kind: "owner-import";
                readonly name: string | undefined;
            };
            readonly format?: "article" | "book" | undefined;
            readonly itemId: `reading:owner-${string}`;
            readonly title: string | undefined;
            readonly text: string | undefined;
        };
    };
    feed: () => {
        readonly operation: "consume";
    };
};
type WalletAction = WalletFields & {
    kind: keyof typeof receipt;
};
export declare function walletActionReceipt(id: string, action: WalletAction): {
    readonly operation: "grant-money";
    readonly payload: {
        readonly amount: number | undefined;
        readonly note: string | undefined;
    };
} | {
    readonly operation: "gift-item";
    readonly payload: {
        readonly itemId: string | undefined;
        readonly quantity: number | undefined;
        readonly note: string | undefined;
    };
} | {
    readonly operation: "purchase";
    readonly payload: {
        readonly itemId: string | undefined;
        readonly quantity: number | undefined;
    };
} | {
    readonly operation: "sell";
    readonly payload: {
        readonly itemId: string | undefined;
        readonly quantity: number | undefined;
    };
} | {
    readonly operation: "import-reading";
    readonly payload: {
        readonly source: {
            readonly kind: "owner-import";
            readonly name: string | undefined;
        };
        readonly format?: "article" | "book" | undefined;
        readonly itemId: `reading:owner-${string}`;
        readonly title: string | undefined;
        readonly text: string | undefined;
    };
} | {
    readonly operation: "consume";
};
type WalletInput = {
    workspaceId: string;
} & ({
    action: WalletAction;
} | {
    expectedVersion: string;
    next: EconomyConfigurationPatch;
});
export type WalletRequest = {
    endpoint: typeof actionEndpoint | typeof settingsEndpoint;
    input: WalletInput;
    fingerprint: string;
};
export type WalletEvidence = {
    declined?: boolean;
    savedSnapshot?: string;
    execution?: PlannedExecution;
} & ({
    state: 'committed';
} | {
    state: 'partial';
} | {
    state: 'no-evidence';
} | {
    state: 'conflict';
});
export type WalletState = WalletEvidence['state'] | 'abandoned';
type Binding = {
    storageId: string;
    companionId: string;
};
export declare function normalizeWalletRequest(endpoint: string, raw: unknown): WalletRequest;
export declare const consoleFoodOperationId: (requestId: string) => string;
export declare function legacyWalletDigest(requestId: string, { input }: WalletRequest): string | undefined;
export declare function installConsoleRequests(db: DatabaseSync): void;
export declare class ConsoleRequests {
    private readonly db;
    private readonly binding;
    constructor(db: DatabaseSync, binding: Binding);
    get(id: string): {
        state: "pending" | "committed" | "declined" | "abandoned";
        fingerprint: string;
        request: WalletRequest | undefined;
    } | undefined;
    pending(): Record<string, import("node:sqlite").SQLOutputValue>[];
    recentCommitted(): Record<string, import("node:sqlite").SQLOutputValue>[];
    waitsForRetry(operationId: string): boolean;
    add(id: string, request: WalletRequest): void;
    finish(id: string, fingerprint: string, state: 'committed' | 'declined' | 'abandoned'): void;
}
export {};
