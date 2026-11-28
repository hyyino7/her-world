import type { DatabaseSync } from 'node:sqlite';
import type { HomeBinding } from '../workspace.js';
import { type UsageRow } from './ledger.js';
export declare function total(): {
    calls: number;
    missingUsage: number;
    input: number;
    output: number;
    read: number;
    write: number;
    missingRead: number;
    missingWrite: number;
    priced: number;
    unpriced: number;
    yuan: number;
    partial: boolean;
};
type Total = ReturnType<typeof total>;
export declare function measure(row: UsageRow): {
    usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number | undefined;
        cacheWriteTokens: number | undefined;
    };
    price: {
        yuan: null;
        missing: string[];
    } | {
        yuan: number;
        missing: string[];
    };
} | undefined;
export declare function add(target: Total, measured: ReturnType<typeof measure>): void;
export declare function ledgerIssue(error: unknown): "unavailable" | "upgrade";
export declare function recoveryMarker(db: DatabaseSync): string | undefined;
export declare function daysBefore(day: string, days: number): string;
type Status = 'absent' | 'empty' | 'recorded' | 'recovered' | 'unavailable';
export declare function homeSpend(scope: Pick<HomeBinding, 'path'>, sessionId: string | undefined, day: string): {
    status: Status;
    issue: string | null;
    calls: number;
    missingUsage: number;
    input: number;
    output: number;
    read: number;
    write: number;
    missingRead: number;
    missingWrite: number;
    priced: number;
    unpriced: number;
    yuan: number;
    partial: boolean;
};
export declare function channelTotals(scope: Pick<HomeBinding, 'path'>, today: string): {
    qq: {
        from: string;
        to: string;
        status: Status;
        issue: string | null;
        calls: number;
        missingUsage: number;
        input: number;
        output: number;
        read: number;
        write: number;
        missingRead: number;
        missingWrite: number;
        priced: number;
        unpriced: number;
        yuan: number;
        partial: boolean;
    };
    wechat: {
        from: string;
        to: string;
        status: Status;
        issue: string | null;
        calls: number;
        missingUsage: number;
        input: number;
        output: number;
        read: number;
        write: number;
        missingRead: number;
        missingWrite: number;
        priced: number;
        unpriced: number;
        yuan: number;
        partial: boolean;
    };
};
export {};
