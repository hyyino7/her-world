import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type Push } from '#dsh-world/ecosystem/shared/outlets';
import { type CoreStore } from '../core/storage.js';
export declare const bridgePrefix = "/chatpet-connect";
interface Destination {
    name: string;
    url: string;
    kinds: Push['kind'][];
}
export interface BridgePreferences {
    enabled: boolean;
    outlets: Destination[];
}
export declare function bridgePreferences(raw: unknown): BridgePreferences;
export declare function privateDeviceDirectory(root: string, name: string): string;
export declare class LocalBridge {
    private ctx;
    private directory;
    private origin;
    private home;
    private isHome;
    private quiet;
    private name;
    private store;
    private storageId;
    private active;
    private preferences;
    private instance?;
    private readonly settingsFile;
    readonly discovery: string;
    constructor(ctx: Context, directory: string, origin: () => string, home: () => Promise<Agent>, isHome: (id: string) => boolean, quiet: () => boolean, name: () => string, store: CoreStore, storageId: string, active: () => boolean);
    get current(): {
        start: () => void;
        stop: () => void;
        say: (text: string) => Promise<{
            id: string;
        }>;
        checkToken: (value: string | undefined) => boolean;
        faults: () => string[];
    } | undefined;
    status(): {
        preferences: BridgePreferences;
        running: boolean;
        discovery: string | null;
        faults: string[];
    };
    configure(raw: unknown): void;
    private outlets;
    sync(available: boolean): void;
    reach(push: Push & {
        deliveryId?: string;
    }, homeId: string): Promise<PromiseSettledResult<string>[]>;
    stop(): void;
}
export {};
