export type StorageVersions = Readonly<Record<string, number>>;
export declare const MIGRATION_REASON: {
    readonly storageVersionOutdated: "storage-version-outdated";
    readonly manifestMismatch: "manifest-mismatch";
    readonly migrationIncomplete: "migration-incomplete";
    readonly journalInvalid: "journal-invalid";
    readonly journalStepMismatch: "journal-step-mismatch";
    readonly bindingChanged: "binding-changed";
    readonly bindingNotMigratable: "binding-not-migratable";
};
export type MigrationReason = typeof MIGRATION_REASON[keyof typeof MIGRATION_REASON];
export declare const INITIAL_STORAGE_VERSIONS: Readonly<{
    behavior: 1;
    channels: 1;
    core: 1;
    desktop: 1;
    economy: 1;
    emotion: 1;
    life: 1;
    memory: 1;
    room: 1;
    voice: 1;
}>;
export declare const HOME_STORAGE_VERSIONS: Readonly<{
    core: 2;
    living: 2;
    channels: 1;
    desktop: 1;
    emotion: 1;
    memory: 1;
    room: 1;
    voice: 1;
}>;
export interface MigrationStepContract {
    id: string;
    from: StorageVersions | null;
    to: StorageVersions;
}
export declare const INITIAL_STORAGE_STEP: Readonly<{
    id: "0001-storage-manifest";
    from: null;
    to: Readonly<{
        behavior: 1;
        channels: 1;
        core: 1;
        desktop: 1;
        economy: 1;
        emotion: 1;
        life: 1;
        memory: 1;
        room: 1;
        voice: 1;
    }>;
}>;
export declare const HOME_STORAGE_STEP: Readonly<{
    id: "0002-home-identity";
    from: Readonly<{
        behavior: 1;
        channels: 1;
        core: 1;
        desktop: 1;
        economy: 1;
        emotion: 1;
        life: 1;
        memory: 1;
        room: 1;
        voice: 1;
    }>;
    to: Readonly<{
        core: 2;
        living: 2;
        channels: 1;
        desktop: 1;
        emotion: 1;
        memory: 1;
        room: 1;
        voice: 1;
    }>;
}>;
export declare const ECONOMY_STORAGE_STEP: Readonly<{
    id: "0003-economy-marker";
    from: Readonly<{
        core: 2;
        living: 2;
        channels: 1;
        desktop: 1;
        emotion: 1;
        memory: 1;
        room: 1;
        voice: 1;
    }>;
    to: Readonly<{
        core: 3;
        living: 3;
        channels: 1;
        desktop: 1;
        emotion: 1;
        memory: 1;
        room: 1;
        voice: 1;
    }>;
}>;
export declare const CONSOLE_WALLET_STEP: Readonly<{
    id: "0004-console-wallet";
    from: Readonly<{
        core: 3;
        living: 3;
        channels: 1;
        desktop: 1;
        emotion: 1;
        memory: 1;
        room: 1;
        voice: 1;
    }>;
    to: Readonly<{
        living: 4;
        core: 3;
        channels: 1;
        desktop: 1;
        emotion: 1;
        memory: 1;
        room: 1;
        voice: 1;
    }>;
}>;
export declare const CONSOLE_WALLET_IMPORT_FILE = "console-wallet-import.json";
type WalletImportBinding = {
    storageId: string;
    companionId: string;
};
export interface WalletImportProof {
    format: 1;
    mode: 'import';
    binding: WalletImportBinding;
    wallet: 'adopted' | 'absent';
    round: string;
    sourceCount: number;
    sourceDigest: string;
    requestCount: number;
    requestDigest: string;
    exportDigest: string;
}
export declare const freshWalletImportProof: (binding: WalletImportBinding) => {
    format: number;
    mode: string;
    binding: WalletImportBinding;
};
export declare function storageManifest(companionId: string, modules: StorageVersions): {
    schemaVersion: number;
    companionId: string;
    modules: Readonly<Record<string, number>>;
};
export declare function storageManifestIndex(manifest: unknown, companionId: string, contract: readonly MigrationStepContract[]): number;
export declare function validateMigrationContract(contract: unknown): asserts contract is MigrationStepContract[];
export declare function isWalletImportProof(value: unknown, storageId: string): value is WalletImportProof;
export interface WalletImportJournal {
    exportFile: string;
    rollbackFile: string;
    rollbackDigest: string;
    codeFingerprint: string;
    proof: WalletImportProof;
}
interface JournalHeader {
    id: string;
    backup: string;
    backupHash: string;
    binding?: {
        storageId: string;
        repoHash: string;
    };
    economyAdopted?: boolean;
    walletImport?: WalletImportJournal;
    steps: MigrationStepContract[];
}
interface JournalSegment {
    header: JournalHeader;
    states: Map<string, string>;
}
export declare class MigrationBindingChanged extends Error {
}
export declare const settled: (segment: JournalSegment) => boolean;
export declare const isStepSettled: (event: string | undefined) => event is "skip" | "done";
export declare function parseMigrationJournal(text: string): {
    rows: unknown[];
    truncated: boolean;
};
export declare function decodeMigrationJournal(journal: ReturnType<typeof parseMigrationJournal>, storageId: string): {
    last: JournalSegment | undefined;
    truncated: boolean;
};
export {};
