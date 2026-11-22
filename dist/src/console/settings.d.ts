import type { Context } from '@deepseek-ai/cordis';
import { type ContractError } from '../contracts/common.js';
import type { PetCoreHost } from '../core/index.js';
import { type SettingsWorkspaceRegistry } from '../core/tables/console.js';
export type { SettingsWorkspaceRegistry } from '../core/tables/console.js';
export interface EconomyControls {
    consoleWrite(endpoint: string, input: unknown, requestId: string, signal: AbortSignal, validate: () => void): Promise<unknown>;
    consoleRecover(endpoint: string, workspaceId: string, requestId: string, acceptNoEvidence: boolean, signal: AbortSignal, validate: () => void): Promise<unknown>;
}
/** Connection's locally available structural PeerScope subset. */
type SettingsError = {
    code: string;
    message: string;
    details: Record<string, never>;
    effect: ContractError['effect'];
    retry: ContractError['retry'];
};
export type SettingsReply = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: SettingsError;
};
export type SettingsHandler = (endpoint: string, payload: unknown, signal: AbortSignal, peer: {
    principal: {
        kind: string;
    };
    signal: AbortSignal;
}) => Promise<SettingsReply>;
export declare const settingsEndpoints: string[];
/** Owner-only exact RPCs share admission. Both wallet write routes use the durable owner registry. */
export declare function settingsHandler(getHost: () => PetCoreHost | undefined, getWorkspaces: () => SettingsWorkspaceRegistry | undefined, getWorldModules?: () => readonly string[], getEconomy?: () => EconomyControls | undefined, scope?: Context): SettingsHandler;
