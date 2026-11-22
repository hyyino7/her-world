import { DatabaseSync } from 'node:sqlite';
import type { ContractError, RejectedCode } from '../contracts/common.js';
export declare class Rejection extends Error {
    readonly detail: ContractError;
    constructor(detail: ContractError);
}
export declare function reject(code: Exclude<RejectedCode, 'EXPIRED_USE'>, message: string): never;
export declare function unavailable(message: string): never;
export declare function check(condition: unknown, message: string): asserts condition;
export declare function text(value: unknown, label: string, max?: number): asserts value is string;
export declare function integer(value: unknown, label: string, min?: number, max?: number): asserts value is number;
export declare function timestamp(value: unknown): asserts value is string;
export declare const id: (prefix: string) => string;
export declare const now: () => string;
/** JSON is the persistence boundary. Reject prototypes, non-finite values and oversized payloads. */
export declare function canonical(value: unknown): string;
export declare const digest: (value: unknown) => string;
export declare const bytesDigest: (value: Uint8Array) => string;
export declare function revision(actual: number, expected: number): void;
/** One process owns one Core database. Only trusted host configuration selects storage paths. */
export declare class CoreStore {
    db: DatabaseSync;
    readonly directory: string;
    private readonly lockPath;
    private readonly lockToken;
    private closed;
    private recovering;
    private databaseFile;
    constructor(directory: string);
    /** A live connection alone does not establish that its database is still in the Repo. */
    persisted(): boolean;
    /** Explicit initialization may recover this live connection, never another cached identity. */
    ensurePersisted(): Promise<void>;
    meta<T>(key: string): T | undefined;
    setMeta(key: string, value: unknown): void;
    get<T>(kind: string, key: string): T | undefined;
    require<T>(kind: string, key: string): T;
    put(kind: string, key: string, value: unknown): void;
    all<T>(kind: string): T[];
    transaction<T>(fn: () => T): T;
    mutate<T>(principal: string, operation: string, requestId: string, input: unknown, fn: () => T): T;
    close(): void;
}
