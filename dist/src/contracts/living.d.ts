import type { BehaviorSnapshot, CareAction, PlannedExecution } from './behavior.js';
import type { CallOptions, RequestContext, Result, Revision } from './common.js';
export interface InventoryItem {
    itemId: string;
    quantity: number;
    reserved: number;
    available: number;
}
export interface ReadingBookmark {
    itemId: string;
    version: string;
    offset: number;
    updatedAt: number;
}
export interface WalletView {
    readonly balance: number;
    readonly inventory: readonly Readonly<InventoryItem>[];
    readonly reading: readonly Readonly<{
        itemId: string;
        version: string;
        bookmark: Readonly<ReadingBookmark> | null;
    }>[];
}
export interface WorldSnapshot {
    readonly workspaceId: string;
    readonly storageId: string;
    readonly body: {
        readonly available: true;
        readonly snapshot: Readonly<BehaviorSnapshot>;
    } | {
        readonly available: false;
    };
    readonly wallet: WalletView | null;
}
/** Invalidate the previous snapshot. This signal is not a persistence receipt. */
export type WorldChanged = Pick<WorldSnapshot, 'workspaceId' | 'storageId'> & {
    readonly bootId: string;
    readonly generation: number;
    readonly bodyOnly?: true;
};
export interface WorldCommandRequest {
    workspaceId: string;
    requestId: RequestContext['requestId'];
}
type CommandOptions = Pick<CallOptions, 'signal'>;
type TradeRequest = WorldCommandRequest & {
    itemId: string;
    quantity?: number;
};
export interface WorldCommands {
    care(input: WorldCommandRequest & {
        action: CareAction;
    }, options?: CommandOptions): Promise<Result<{
        changed: boolean;
    }>>;
    executePlanStep(input: WorldCommandRequest & {
        expectedRevision: Revision;
        planId: string;
        stepId: string;
    }, options?: CommandOptions): Promise<Result<{
        operationId: string;
        execution: PlannedExecution | null;
    }>>;
    confirmReading(input: WorldCommandRequest & {
        expectedRevision: Revision;
        operationId: string;
        receiptToken: string;
    }, options?: CommandOptions): Promise<Result<PlannedExecution>>;
    buy(input: TradeRequest, options?: CommandOptions): Promise<Result<WalletView>>;
    sell(input: TradeRequest, options?: CommandOptions): Promise<Result<WalletView>>;
}
export {};
