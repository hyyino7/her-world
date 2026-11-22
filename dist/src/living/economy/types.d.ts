import type { InventoryItem, ReadingBookmark } from '../../contracts/living.js';
import type { BodyMetric, ReadingState } from '../../contracts/behavior.js';
export type { InventoryItem, ReadingBookmark } from '../../contracts/living.js';
export type ItemKind = 'seed' | 'harvest' | 'compost' | 'food' | 'reading';
export interface CatalogItem {
    id: string;
    kind: ItemKind;
    name: string;
    description: string;
    purchasePrice: number | null;
    sellPrice: number | null;
    consumable: boolean;
    cropId?: string;
    bodyAction?: 'feed';
    contentVersion?: string;
    enabled: boolean;
    effects?: BodyNeedDelta;
    /** Registered visual portrayal only; independent of name, price and effects. */
    presentationSlot?: string;
    source?: {
        kind: 'original' | 'owner-import';
        name: string;
    };
}
export type BodyNeedDelta = Partial<Record<BodyMetric, number>>;
export interface CropConfiguration {
    growMs: number;
    seedCost: number;
    sellPrice: number;
    yield: number;
}
export interface EconomyConfiguration {
    version: 1;
    revision: number;
    dailyNetReference: number;
    articlePrice: number;
    bookPrice: number;
    improvedMealPrice: number;
    compostCost: number;
    waterDurationFactor: number;
    fertilizerGrowth: number;
    fertilizerYield: number;
    crops: Record<string, CropConfiguration>;
    itemPrices: Record<string, {
        purchasePrice: number | null;
        sellPrice: number | null;
    }>;
    catalogEnabled: Record<string, boolean>;
    foodEffects: Record<string, BodyNeedDelta>;
}
export type EconomyConfigurationPatch = Partial<Omit<EconomyConfiguration, 'version' | 'revision' | 'dailyNetReference' | 'fertilizerYield' | 'crops' | 'itemPrices'>> & {
    crops?: Record<string, Partial<Pick<CropConfiguration, 'growMs' | 'seedCost'>>>;
    itemPrices?: EconomyConfiguration['itemPrices'];
};
export interface ReadingContent {
    itemId: string;
    title: string;
    text: string;
    version: string;
    format?: 'article' | 'book';
    source: {
        kind: 'original' | 'owner-import';
        name: string;
    };
}
export interface EconomySnapshot {
    storageId: string;
    companionId: string;
    revision: number;
    balance: number;
    inventory: InventoryItem[];
    catalog: CatalogItem[];
    configuration: EconomyConfiguration;
    bookmarks: ReadingBookmark[];
    pendingUses: ItemUse[];
    migration: {
        kind: 'new' | 'legacy-garden';
        sourcePath?: string;
        sourceHash?: string;
        importedAt: number;
    };
}
/** 流水的 owner-grant 记录钱包变动，事实的 money-grant 记录主人互动。 */
export type LedgerKind = 'legacy-import' | 'purchase' | 'sale' | 'owner-grant' | 'owner-gift' | 'owner-configure' | 'owner-import-reading' | 'use-reserve' | 'use-consume' | 'use-cancel' | 'garden' | 'garden-action';
declare const legacyLedgerKind: unique symbol;
/** 历史 SQLite 行中的未知 kind 原样读出。 */
type LegacyLedgerKind = string & {
    readonly [legacyLedgerKind]: true;
};
export interface LedgerEntry {
    sequence: number;
    id: string;
    requestId: string;
    kind: LedgerKind | LegacyLedgerKind;
    at: number;
    moneyDelta: number;
    balance: number;
    itemDeltas: Record<string, number>;
    note: string;
}
export interface ItemUse {
    opId: string;
    requestId: string;
    itemId: string;
    quantity: 1;
    status: 'reserved' | 'consumed' | 'cancelled';
    createdAt: number;
    updatedAt: number;
    bodyReceiptId?: string;
    effects: BodyNeedDelta;
}
export interface BodyUseProof {
    operationId: string;
    applied: boolean;
    bodyReceiptId: string;
}
export interface EconomyStoreOptions {
    workspacePath: string;
    storageId: string;
    companionId: string;
    /** The current Behavior owner supplies existing data; this store never opens legacy files. */
    legacyGarden?: {
        state: unknown;
        sourcePath: string;
        sourceHash: string;
    };
    /** Resolve the preserved legacy source only when a new schema needs import. */
    loadLegacyGarden?: () => {
        state: unknown;
        sourcePath: string;
        sourceHash: string;
    } | undefined;
    /** The caller has evidence that a new empty wallet is forbidden. */
    expectedInitialized?: boolean;
    /** Guard the existing Core binding/lease before every database operation. */
    guard?: () => void;
    walletChanged?: () => void;
    factsCommitted?: () => void;
}
export interface ReadingSegment {
    itemId: string;
    title: string;
    version: string;
    segment: number;
    totalSegments: number;
    text: string;
    startOffset: number;
    endOffset: number;
    nextSegment: number | null;
    source: ReadingContent['source'];
    bookmark: ReadingBookmark | null;
}
export interface ReadingOperationStatus {
    status: ReadingState;
    itemId: string;
    segment: number;
}
export interface ReadingOffer extends ReadingSegment {
    receiptToken: string;
}
