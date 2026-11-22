import type { PetCoreHost } from '../core/index.js';
import type { WorkspaceTarget } from '../core/preferences.js';
import type { CompanionEmotion } from '../emotion/plugin.js';
import type { CompanionLife } from '../living/plan/plugin.js';
import { type RoomEndpoint } from '../presentation/room-transport.js';
export interface EconomyControls {
    snapshot(workspaceId: string, validate?: () => void, options?: {
        includeWritableKeys?: boolean;
    }): Promise<unknown>;
    ownerAction(workspaceId: string, action: unknown, requestId: string, signal: AbortSignal, validate: () => void): Promise<unknown>;
    settings(workspaceId: string, expectedVersion: string, next: unknown, requestId: string, signal: AbortSignal, validate: () => void): Promise<unknown>;
}
interface RoomControls {
    request(workspaceId: string, endpoint: RoomEndpoint, data: Record<string, unknown>, requestId: string, signal: AbortSignal): Promise<unknown>;
    open?(workspaceId: string): Promise<unknown>;
}
/** Structural subset of the native Connection RPC contract; no new transport. */
export type SettingsReply = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
        details: Record<string, never>;
    };
};
export type SettingsHandler = (endpoint: string, payload: unknown, signal: AbortSignal, peer: {
    principal: {
        kind: string;
    };
    signal: AbortSignal;
}) => Promise<SettingsReply>;
export interface SettingsWorkspace extends WorkspaceTarget {
    readonly sessionIds?: readonly string[];
    status(): Promise<'ok' | 'missing-dir'>;
}
export interface SettingsWorkspaceRegistry {
    list(): SettingsWorkspace[];
    get(id: string): SettingsWorkspace | undefined;
}
/** Owner-only, finite endpoint map. No caller-supplied operation, actor or authority is forwarded. */
interface DesktopControls {
    status(): {
        running: boolean;
    };
    start(): Promise<unknown>;
    closeWindow(): unknown;
}
export declare function settingsHandler(getHost: () => PetCoreHost | undefined, getWorkspaces: () => SettingsWorkspaceRegistry | undefined, getDesktop?: (host: PetCoreHost) => DesktopControls | undefined, getWorldModules?: () => readonly string[], getEmotion?: () => Pick<CompanionEmotion, 'current' | 'catalog'> & Partial<Pick<CompanionEmotion, 'read' | 'update'>> | undefined, getLife?: () => (Pick<CompanionLife, 'snapshot' | 'control' | 'act'> & Partial<Pick<CompanionLife, 'settings' | 'library'>>) | undefined, getRoom?: () => RoomControls | undefined, getChannels?: () => Pick<import('../channels/plugin.js').CompanionChannels, 'request'> | undefined, getPlatform?: () => Pick<import('../desktop/platform/plugin.js').PetPlatform, 'ownerAccess' | 'controlAccess' | 'standaloneAccess'> & Partial<Pick<import('../desktop/platform/plugin.js').PetPlatform, 'status' | 'saveTiming' | 'resolveMigration'>> | undefined, getEconomy?: () => EconomyControls | undefined): SettingsHandler;
export {};
