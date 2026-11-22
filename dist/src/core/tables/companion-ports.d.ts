import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ActivityRecord } from '#dsh-world/life/types';
import type { HomeBinding } from '../workspace.js';
export interface CompanionBinding {
    workspaceId: string;
    path: string;
    storageId: string;
}
export interface ActivityReader {
    activityDays(binding: CompanionBinding): readonly string[];
    activity(binding: CompanionBinding, day: string): readonly ActivityRecord[];
}
type OwnerScope = (agent: Agent) => CompanionBinding | undefined;
interface Ports {
    bodyAvailable(): boolean;
    activities: ActivityReader;
    lifeOwnsAlbum(sessionId: string): boolean;
    watchingTelevision(sessionId: string): boolean;
    openRoomWindow(workspaceId: string): Promise<{
        running: boolean;
        ready: boolean;
        workspaceId: string | null;
    }>;
    isRunningLifeHome(sessionId: string): boolean;
    applyHomeArrival(scope: HomeBinding, sessionId: string): boolean;
}
export declare class CompanionPorts {
    private scope?;
    private readonly slots;
    bind(ctx: Context, ownerScope: OwnerScope): () => void;
    /** Match the consumer's Cordis visibility for this provider's service. */
    scopeFor(provider: Context, service: string): {
        ctx: Context;
        ownerScope: OwnerScope;
    } | undefined;
    register<K extends keyof Ports>(name: K, port: Ports[K]): import("../../contracts/tables.js").TableRegistration;
    get<K extends keyof Ports>(name: K): Ports[K] | undefined;
}
export {};
