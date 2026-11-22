import { LivingView, type LivingPorts, type RecordCommandEffect } from '../index.js';
import type { Context } from '@deepseek-ai/cordis';
import type { PetCoreHost, WorkspaceTarget } from '../../core/index.js';
import type { CapabilityRegistration } from '../../contracts/tables.js';
import type { PlanTradeOperation } from '../../contracts/behavior.js';
import type { WorldCommands } from '../../contracts/living.js';
import type { RoomEconomyPort } from '../body/room.js';
import { EconomyStore } from './store.js';
import { type WalletState } from './console-requests.js';
import type { EconomyConfigurationPatch, EconomySnapshot, ItemUse } from './types.js';
import type { CompanionFact, CompanionFactActor } from '../../contracts/interaction.js';
export declare const economyStateToolDeclaration: {
    name: string;
    sources: readonly ("life" | "owner" | "review")[];
    historyOverview(_args: unknown, value: unknown): (Omit<EconomySnapshot & {
        ledger: import("./types.js").LedgerEntry[];
    }, "migration" | "ledger" | "configuration" | "inventory"> & {
        view: string;
        configurationRevision: number;
        inventory: import("./types.js").InventoryItem[];
        stockNote: string;
        ledgerCount: number;
        details: {
            tool: string;
            view: string;
        };
    }) | undefined;
};
/** One synchronous ledger per active Core binding. Body owns effect receipts;
 * this service owns money/items and never creates another assistant runtime. */
export declare class CompanionEconomy {
    private readonly ctx;
    readonly host: PetCoreHost;
    private current?;
    private preparationFailure?;
    private closed;
    private readonly living;
    private readonly inFlight;
    private readonly walletInFlight;
    constructor(ctx: Context, host: PetCoreHost, ports?: LivingPorts | LivingView);
    private assertOpen;
    protectedDirectory(): string | undefined;
    initializationFiles(target: WorkspaceTarget): readonly string[];
    private retainedGarden;
    /** Initialization is schema preparation only: no allowance, gifts or goals. */
    prepare(target: WorkspaceTarget, legacyFile?: string, initializing?: boolean): EconomyStore;
    capabilityStatus(): ReturnType<CapabilityRegistration['status']>;
    private bound;
    private use;
    private gardenClock;
    committedGardenAt(workspaceId: string): number | undefined;
    gardenPort(workspaceId: string, legacyFile?: string, recordReadingEffect?: RecordCommandEffect): RoomEconomyPort;
    snapshot(workspaceId: string, validate?: () => void, options?: {
        includeWritableKeys?: boolean;
    }): Promise<{
        writableKeys?: {
            itemPrices: string[];
            catalogEnabled: string[];
        } | undefined;
        workspaceId: string;
        ledger: import("./types.js").LedgerEntry[];
        configurationVersion: string;
        access: {
            readonly mode: "bounded";
            readonly detail: "余额与物品由程序结算。原生文件工具防误改；同一系统账户的命令和其他插件仍可访问文件。";
        };
        storageId: string;
        companionId: string;
        revision: number;
        balance: number;
        inventory: import("./types.js").InventoryItem[];
        catalog: import("./types.js").CatalogItem[];
        configuration: import("./types.js").EconomyConfiguration;
        bookmarks: import("./types.js").ReadingBookmark[];
        pendingUses: ItemUse[];
        migration: {
            kind: "new" | "legacy-garden";
            sourcePath?: string;
            sourceHash?: string;
            importedAt: number;
        };
    } | {
        writableKeys?: {
            itemPrices: string[];
            catalogEnabled: string[];
        } | undefined;
        workspaceId: string;
        ledger: import("./types.js").LedgerEntry[];
        configurationVersion: string;
        access: {
            readonly mode: "bounded";
            readonly detail: "余额与物品由程序结算。原生文件工具防误改；同一系统账户的命令和其他插件仍可访问文件。";
        };
        storageId: string;
        companionId: string;
        revision: number;
        balance: number;
        inventory: import("./types.js").InventoryItem[];
        catalog: import("./types.js").CatalogItem[];
        configuration: import("./types.js").EconomyConfiguration;
        bookmarks: import("./types.js").ReadingBookmark[];
        pendingUses: ItemUse[];
        migration: {
            kind: "new" | "legacy-garden";
            sourcePath?: string;
            sourceHash?: string;
            importedAt: number;
        };
    }>;
    private walletSnapshot;
    walletView(workspaceId: string): import("../../contracts/living.js").WalletView;
    worldSnapshot(workspaceId: string): Promise<import("../../contracts/living.js").WorldSnapshot>;
    readonly worldCommands: Pick<WorldCommands, PlanTradeOperation>;
    private worldTrade;
    pendingFacts(workspaceId: string): Promise<CompanionFact[]>;
    readFacts(workspaceId: string, ids: readonly string[]): Promise<CompanionFact[]>;
    acknowledgeFacts(workspaceId: string, ids: readonly string[]): Promise<void>;
    private notifyFacts;
    private openWallet;
    private walletEvidence;
    private walletUnknown;
    consoleWrite(endpoint: string, input: unknown, id: string, signal: AbortSignal, validate: () => void): Promise<unknown>;
    consoleRecover(endpoint: string, workspaceId: string, id: string, acceptNoEvidence: boolean, signal: AbortSignal, validate: () => void): Promise<Record<string, import("node:sqlite").SQLOutputValue>[] | {
        readonly state: WalletState;
    }>;
    private finishWallet;
    private dispatchWallet;
    ownerAction(workspaceId: string, action: any, requestId: string, signal: AbortSignal, validate?: () => void, trustedActor?: CompanionFactActor, recordEffect?: RecordCommandEffect): Promise<{
        execution?: import("../../contracts/behavior.js").PlannedExecution | undefined;
        writableKeys?: {
            itemPrices: string[];
            catalogEnabled: string[];
        } | undefined;
        workspaceId: string;
        ledger: import("./types.js").LedgerEntry[];
        configurationVersion: string;
        access: {
            readonly mode: "bounded";
            readonly detail: "余额与物品由程序结算。原生文件工具防误改；同一系统账户的命令和其他插件仍可访问文件。";
        };
        storageId: string;
        companionId: string;
        revision: number;
        balance: number;
        inventory: import("./types.js").InventoryItem[];
        catalog: import("./types.js").CatalogItem[];
        configuration: import("./types.js").EconomyConfiguration;
        bookmarks: import("./types.js").ReadingBookmark[];
        pendingUses: ItemUse[];
        migration: {
            kind: "new" | "legacy-garden";
            sourcePath?: string;
            sourceHash?: string;
            importedAt: number;
        };
    } | {
        execution?: import("../../contracts/behavior.js").PlannedExecution | undefined;
        writableKeys?: {
            itemPrices: string[];
            catalogEnabled: string[];
        } | undefined;
        workspaceId: string;
        ledger: import("./types.js").LedgerEntry[];
        configurationVersion: string;
        access: {
            readonly mode: "bounded";
            readonly detail: "余额与物品由程序结算。原生文件工具防误改；同一系统账户的命令和其他插件仍可访问文件。";
        };
        storageId: string;
        companionId: string;
        revision: number;
        balance: number;
        inventory: import("./types.js").InventoryItem[];
        catalog: import("./types.js").CatalogItem[];
        configuration: import("./types.js").EconomyConfiguration;
        bookmarks: import("./types.js").ReadingBookmark[];
        pendingUses: ItemUse[];
        migration: {
            kind: "new" | "legacy-garden";
            sourcePath?: string;
            sourceHash?: string;
            importedAt: number;
        };
    }>;
    settings(workspaceId: string, expectedVersion: string, next: EconomyConfigurationPatch, requestId: string, signal: AbortSignal, validate?: () => void): Promise<{
        writableKeys?: {
            itemPrices: string[];
            catalogEnabled: string[];
        } | undefined;
        workspaceId: string;
        ledger: import("./types.js").LedgerEntry[];
        configurationVersion: string;
        access: {
            readonly mode: "bounded";
            readonly detail: "余额与物品由程序结算。原生文件工具防误改；同一系统账户的命令和其他插件仍可访问文件。";
        };
        storageId: string;
        companionId: string;
        revision: number;
        balance: number;
        inventory: import("./types.js").InventoryItem[];
        catalog: import("./types.js").CatalogItem[];
        configuration: import("./types.js").EconomyConfiguration;
        bookmarks: import("./types.js").ReadingBookmark[];
        pendingUses: ItemUse[];
        migration: {
            kind: "new" | "legacy-garden";
            sourcePath?: string;
            sourceHash?: string;
            importedAt: number;
        };
    } | {
        writableKeys?: {
            itemPrices: string[];
            catalogEnabled: string[];
        } | undefined;
        workspaceId: string;
        ledger: import("./types.js").LedgerEntry[];
        configurationVersion: string;
        access: {
            readonly mode: "bounded";
            readonly detail: "余额与物品由程序结算。原生文件工具防误改；同一系统账户的命令和其他插件仍可访问文件。";
        };
        storageId: string;
        companionId: string;
        revision: number;
        balance: number;
        inventory: import("./types.js").InventoryItem[];
        catalog: import("./types.js").CatalogItem[];
        configuration: import("./types.js").EconomyConfiguration;
        bookmarks: import("./types.js").ReadingBookmark[];
        pendingUses: ItemUse[];
        migration: {
            kind: "new" | "legacy-garden";
            sourcePath?: string;
            sourceHash?: string;
            importedAt: number;
        };
    }>;
    stopAdmission(): void;
    settled(): Promise<void>;
    close(): void;
}
export declare const name = "22-Economy";
export declare const inject: string[];
declare module '@deepseek-ai/cordis' {
    interface Context {
        petEconomy: CompanionEconomy;
    }
}
export declare function apply(ctx: Context): void;
