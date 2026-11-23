import type { CoreRuntime } from './runtime.js';
import { type CorePreferences, type WorkspaceTarget } from './preferences.js';
import { type CompanionConfiguration, type CompanionSettings } from './companion-settings.js';
import type { CompanionIdentity, AttentionPolicy, WorkspaceEditScope } from '../contracts/core.js';
import type { ServiceCall } from '../contracts/common.js';
import { type MigrationReason } from './storage-migration.js';
import type { CompanionBinding } from './tables/companion-ports.js';
type InitializerFiles = readonly string[] | ((target: WorkspaceTarget) => readonly string[]);
export interface WorkspaceStatus {
    state: 'unbound' | 'pending' | 'ready' | 'unavailable' | 'migration-required';
    revision: number | null;
    target: WorkspaceTarget | null;
    files: readonly string[];
    error: string | null;
    sourceRevision: string | null;
    migrationReason?: MigrationReason;
}
type NativeSessionScope = {
    id: string;
    header: {
        cwd?: string;
        parentSession?: unknown;
        origin?: string;
        agentPreset?: string;
    };
};
type NativeWorkspaceRegistry = {
    get(id: string): {
        path: string;
        sessionIds: readonly string[];
    } | undefined;
};
export interface WorkspaceService {
    inspect: ServiceCall<Record<string, never>, WorkspaceStatus>;
    initialize: ServiceCall<{
        expectedPreferencesRevision: number;
    }, WorkspaceStatus>;
    readProfile: ServiceCall<Record<string, never>, {
        revision: number;
        text: string;
    }>;
    saveCompanion: ServiceCall<{
        workspaceId: string;
        expectedSettings: CompanionConfiguration;
        settings: CompanionConfiguration;
    }, CompanionConfiguration>;
    saveProfile: ServiceCall<{
        expectedScope: WorkspaceEditScope;
        expectedRevision: number;
        text: string;
    }, {
        revision: number;
        text: string;
    }>;
    readFoundation: ServiceCall<Record<string, never>, CompanionFoundation>;
    saveFoundation: ServiceCall<{
        workspaceId: string;
        expectedRevision: string;
        text: string;
    }, CompanionFoundation>;
}
export interface CompanionFoundation {
    text: string;
    revision: string;
    source: 'empty' | 'owner';
    path: string;
}
export interface HomeBinding extends CompanionBinding {
    bootId: string;
    generation: number;
}
export interface HomeRecord {
    sessionId: string;
    arrivalPending?: true;
}
/** Core-owned repository authority; module runtime data has its own writers. */
export declare class CoreWorkspace {
    readonly runtime: CoreRuntime;
    readonly port: WorkspaceService;
    private readonly initializers;
    private migrationBlocked?;
    private homeGeneration;
    private committedTarget;
    constructor(runtime: CoreRuntime);
    /** Captured by the editor, then checked inside the original synchronous
     * configuration mutation. No new binding generation or durable state. */
    editScope(): WorkspaceEditScope;
    assertEditScope(expected: WorkspaceEditScope): void;
    private binding;
    configurationCommitted(operation: string): void;
    homeScope(): HomeBinding | undefined;
    readCompanionHome(scope: HomeBinding): Readonly<HomeRecord> | undefined;
    writeCompanionHome(scope: HomeBinding, expected: HomeRecord | undefined, next: HomeRecord): void;
    private directory;
    private read;
    private initializationMarker;
    private retainedFiles;
    private inspectMigration;
    /** Match the binding and declared inventory accepted by inspectRepoBinding. */
    private offlineBindingReady;
    private migrationBlockFor;
    private migrationBlock;
    migrationReason(): MigrationReason | undefined;
    assertMigrationReady(target?: WorkspaceTarget | null): void;
    retainedWritesAllowed(workspaceId: string, path: string, storageId: string): boolean;
    private atomic;
    private soul;
    private documents;
    storageId(): string;
    private storageIdFor;
    /** Module-owned synchronous schema preparation, never a service start. */
    registerInitializer(id: string, run: (target: WorkspaceTarget) => void, files?: InitializerFiles): () => void;
    private validateInventory;
    private inventory;
    private verifyInventory;
    private verifyDeclaredFiles;
    private initialize;
    private adopt;
    synchronize(operation: string): void;
    private replace;
    write(kind: 'identity' | 'policy' | 'preferences', value: CompanionIdentity | AttentionPolicy | CorePreferences): void;
    /** One workspace membership check shared by native Core, Memory, Emotion and Desktop. */
    sessionStatus(session: NativeSessionScope, registry: NativeWorkspaceRegistry | undefined): WorkspaceStatus | null;
    companionConfiguration(): CompanionConfiguration;
    companionSettings(): CompanionSettings;
    /** Inspect actual storage, independently of document/binding readiness. Never
     * move a live database or make a configured fallback look already migrated. */
    storageStatus(): {
        complete: boolean;
        core: {
            current: string;
            expected: string | null;
            ready: boolean;
        };
        memory: {
            configured: string;
            current: string | null;
            expected: string | null;
            ready: boolean;
        } | null;
        workingDirectory: {
            configured: string | null;
            expected: string | null;
            ready: boolean;
        };
        runtime: {
            python: string;
            directory: string | null;
            ready: boolean;
        } | null;
    };
    /** Reading never creates files or substitutes a bundled personality. */
    foundation(): CompanionFoundation;
    status(): WorkspaceStatus;
}
export {};
