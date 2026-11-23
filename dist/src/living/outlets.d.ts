import { type Context } from '@deepseek-ai/cordis';
import type { Push } from '#dsh-world/ecosystem/shared/outlets';
import type { PetCoreHost } from '../core/index.js';
interface LifeOutlets {
    desktop: {
        pause(): void;
        restore(): void;
        present(text: string, sticker?: string): boolean;
    };
    channels: {
        reach(workspaceId: string, push: Push): Promise<PromiseSettledResult<string>[]>;
    };
}
type Slot = keyof LifeOutlets;
export declare function registerLifeOutlet<K extends Slot>(ctx: Context, host: PetCoreHost, slot: K, callbacks: LifeOutlets[K]): {
    revoke(): Promise<void>;
    lease: import("../contracts/tables.js").RegistrationLease;
    attach(scope: Context, install: (scope: Context, lease: import("../contracts/tables.js").RegistrationLease) => () => void): Promise<void>;
};
export declare function lookupLifeOutlet<K extends Slot>(ctx: Context, host: PetCoreHost, slot: K): LifeOutlets[K] | undefined;
export declare function readLifeEnabled(ctx: Context, host: PetCoreHost, workspaceId: string): boolean;
export declare function readRunningLifeHome(ctx: Context, host: PetCoreHost): string | undefined;
export declare function isRunningLifeHome(ctx: Context, host: PetCoreHost, sessionId: string): boolean;
export {};
