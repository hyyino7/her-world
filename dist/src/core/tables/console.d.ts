import { type Context } from '@deepseek-ai/cordis';
import type { ContractError } from '../../contracts/common.js';
import type { RegistrationLease } from '../../contracts/tables.js';
import type { WorkspaceTarget } from '../preferences.js';
export interface SettingsWorkspace extends WorkspaceTarget {
    readonly sessionIds?: readonly string[];
    status(): Promise<'ok' | 'missing-dir'>;
}
export interface SettingsWorkspaceRegistry {
    list(): SettingsWorkspace[];
    get(id: string): SettingsWorkspace | undefined;
}
export type ConsoleCode = ContractError['code'] | 'WORLD_UNAVAILABLE' | 'PROFILE_UNAVAILABLE' | 'MEMORY_UNAVAILABLE' | 'WORKSPACE_INVALID' | 'ENOENT';
export declare function fail(code: ConsoleCode): never;
export declare function object(value: unknown, keys: readonly string[]): Record<string, unknown>;
export declare function requiredText(value: unknown, max: number): string;
export interface ConsoleCall {
    input: unknown;
    requestId: string;
    signal: AbortSignal;
    getWorkspaces(): SettingsWorkspaceRegistry | undefined;
    checkBinding(workspaceId: unknown, ready?: boolean): void;
    validate(): void;
}
export type ConsoleOperation = (call: ConsoleCall) => unknown | Promise<unknown>;
export interface ConsoleOperations {
    operations: Readonly<Record<string, ConsoleOperation>>;
    status?(workspaceId: string): unknown;
}
export declare class ConsoleTable {
    private readonly slots;
    register(owner: string, value: ConsoleOperations, scope?: Context): {
        lease: RegistrationLease;
        revoke: () => Promise<void>;
    };
    get(owner: string, scope?: Context): {
        value: ConsoleOperations;
        lease: RegistrationLease;
    } | undefined;
}
