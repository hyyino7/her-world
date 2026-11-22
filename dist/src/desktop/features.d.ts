import { DesktopImages } from './images.js';
import type { Context } from '@deepseek-ai/cordis';
import type { PetCoreHost } from '../core/index.js';
import type { CompanionFactActor } from '../contracts/interaction.js';
export declare class DesktopFeatures {
    private ctx;
    private host;
    private publish;
    private available;
    private busy;
    private todosByRoot;
    private shownRest?;
    readonly images: DesktopImages;
    private whispering?;
    private lastWhisper;
    private lastDream;
    private lastBalance;
    private checking;
    private closed;
    private readonly voiceLifetime;
    private timer?;
    private maintenance?;
    private scheduling;
    private scheduleRevision;
    private maintenanceFailed;
    private subscriptions;
    private generation?;
    constructor(ctx: Context, host: PetCoreHost, publish: (type: string, value: unknown) => void, available: () => boolean, busy: () => boolean);
    private get;
    private preferences;
    private target;
    private current;
    private same;
    private assertCurrent;
    private lifeOwnsAutonomy;
    private automaticAllowed;
    private proactiveAllowed;
    private todos;
    restoreImages(): Promise<void>;
    private rest;
    restore(force?: boolean): void;
    request(input: {
        path?: unknown;
        method?: unknown;
        body?: unknown;
        actor?: CompanionFactActor;
    }, signal?: AbortSignal): Promise<any>;
    balance(): Promise<any>;
    whisper(image?: string, dream?: boolean, automatic?: boolean): Promise<any>;
    private tick;
    /** All lifecycle/configuration callers converge on one replaceable deadline.
     * Busy, quiet and unavailable states wait for their actual change event. */
    refresh(): Promise<void>;
    private rearm;
    private schedule;
    pause(): void;
    close(): Promise<void>;
}
