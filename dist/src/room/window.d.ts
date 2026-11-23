import type { BehaviorChange } from '../contracts/behavior.js';
import type { WorldChanged } from '../contracts/living.js';
import type { HomeBinding } from '../core/workspace.js';
import { type RoomEndpoint } from '../presentation/room-transport.js';
interface Host {
    binding(): HomeBinding | undefined;
    origin(): string | undefined;
    request(workspaceId: string, endpoint: RoomEndpoint, data: Record<string, unknown>, requestId: string, signal: AbortSignal): Promise<unknown>;
}
/** Presentation-only process. Owner state and every native turn stay in DSH. */
export declare class RoomWindow {
    private host;
    private child?;
    private bound?;
    private ready?;
    private loaded;
    private lifetime?;
    private requests;
    constructor(host: Host);
    status(): {
        running: boolean;
        ready: boolean;
        workspaceId: string | null;
    };
    reconcile(): void;
    changed(change: WorldChanged, version: Pick<BehaviorChange, 'bootId' | 'revision'>): void;
    open(workspaceId: string): Promise<{
        running: boolean;
        ready: boolean;
        workspaceId: string | null;
    }>;
    private send;
    private handle;
    closeWindow(): void;
}
export {};
