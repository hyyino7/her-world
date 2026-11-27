import { DatabaseSync } from 'node:sqlite';
import { type UsageEntry } from '../../contracts/usage.js';
export interface UsageRow {
    started_at: number;
    ended_at: number;
    day: string;
    session_id: string | null;
    entry: UsageEntry;
    preset: string;
    purpose: string | null;
    provider: string;
    model: string;
    requested_effort: string | null;
    outcome: string;
    input_miss: number | null;
    output: number | null;
    cache_read: number | null;
    cache_write: number | null;
    reasoning: number | null;
}
export declare const usageDay: (at: number) => string;
export declare function readLedger<T>(root: string, read: (db: DatabaseSync) => T): T | undefined;
export declare function appendUsage(root: string, row: UsageRow): void;
