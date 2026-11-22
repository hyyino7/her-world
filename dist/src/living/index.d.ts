import { Context, type Fiber } from '@deepseek-ai/cordis';
import type { PetCoreHost } from '../core/index.js';
import type { HomeBinding } from '../core/workspace.js';
import type { CallOptions, ContractError, Result } from '../contracts/common.js';
import { type CompanionFactSource } from '../contracts/interaction.js';
import type { WorldChanged, WorldCommandRequest, WorldSnapshot } from '../contracts/living.js';
import type { RegistrationLease } from '../contracts/tables.js';
import type { CompanionBehavior } from './body/plugin.js';
import type { CompanionLife } from './plan/plugin.js';
import type { CompanionEconomy } from './economy/plugin.js';
interface Areas {
    body: CompanionBehavior;
    plan: CompanionLife;
    economy: CompanionEconomy;
}
type Area = keyof Areas;
declare module '@deepseek-ai/cordis' {
    interface Events {
        'world.changed'(value: WorldChanged): void;
    }
}
export declare function sameHomeBinding(current: HomeBinding | undefined, captured: HomeBinding | undefined): boolean;
export declare function serviceLabel(contextScope: Context, name: string): symbol;
export interface AreaReference<T> {
    readonly value: T;
    isCurrent(): boolean;
}
export declare class LivingWorld {
    private readonly domain;
    private readonly labels;
    private entries;
    private constructor();
    private static matching;
    static find(ctx: Context, host: PetCoreHost): LivingWorld | undefined;
    static lookupPlan(ctx: Context, host: PetCoreHost): CompanionLife | undefined;
    static retain(ctx: Context, host: PetCoreHost, area: Area): {
        world: LivingWorld;
        release: (generation?: symbol) => void;
    };
    retainCore(ctx: Context, host: PetCoreHost, area: Area): (() => void | Promise<void>) | undefined;
    register<K extends Area>(area: K, value: Areas[K], fiber: Fiber): {
        isLatestGeneration: () => boolean;
        lease: RegistrationLease;
        attach(scope: Context, install: (scope: Context, lease: RegistrationLease) => () => void): Promise<void>;
        revoke(): Promise<void>;
    };
    lookup<K extends Area>(area: K): (AreaReference<Areas[K]> & {
        lease: RegistrationLease;
    }) | undefined;
    bindingChanged(ctx: Context, host: PetCoreHost, valid: () => boolean): void;
    changed(ctx: Context, host: PetCoreHost, valid: () => boolean, expected?: HomeBinding, bodyOnly?: boolean, bodyObservation?: WorldChanged['bodyObservation']): void;
}
type AreaPorts = {
    [K in Area]?: () => Areas[K] | undefined;
};
export type LivingPorts = AreaPorts & {
    observe?: boolean;
};
export type RecordCommandEffect = (effect: ContractError['effect'], operationId?: string) => void;
export interface CommandAdmission {
    validate(): void;
    effect: RecordCommandEffect;
}
export declare class LivingView {
    private readonly ports;
    readonly isCurrent: () => boolean;
    private readonly world?;
    readonly isLatestGeneration: () => boolean;
    readonly changed: (binding: HomeBinding, bodyOnly?: boolean, bodyObservation?: WorldChanged['bodyObservation']) => void;
    constructor(ports?: LivingPorts, isCurrent?: () => boolean, world?: LivingWorld | undefined, isLatestGeneration?: () => boolean, changed?: (binding: HomeBinding, bodyOnly?: boolean, bodyObservation?: WorldChanged['bodyObservation']) => void);
    lookup<K extends Area>(area: K): AreaReference<Areas[K]> | undefined;
    get<K extends Area>(area: K): Areas[K] | undefined;
    private boundScope;
    command<T>(host: PetCoreHost, { workspaceId, requestId }: WorldCommandRequest, options: Pick<CallOptions, 'signal'> | undefined, execute: (admission: CommandAdmission) => Promise<T>): Promise<Result<T>>;
    private readFrame;
    worldSnapshot(host: PetCoreHost, workspaceId: string): Promise<WorldSnapshot>;
    factSource(host: PetCoreHost): CompanionFactSource;
    watch<K extends Area>(ctx: Context, area: K, notify: (area: AreaReference<Areas[K]> | undefined, isObserved: () => boolean) => void): () => void;
}
export declare function settleCleanup(...steps: (() => void | Promise<void>)[]): Promise<void>;
export declare function mountLivingArea<K extends Area>(ctx: Context, host: PetCoreHost, area: K, create: (view: LivingView) => Areas[K], start: (value: Areas[K], view: LivingView) => void | (() => void | Promise<void>), close?: (value: Areas[K]) => void | Promise<void>): void;
export declare const livingCaller: () => (() => void) | undefined;
export declare function withLivingCaller<T>(validate: () => void, call: () => T): T;
export declare class InFlight {
    private readonly work;
    run<T>(start: () => Promise<T>): Promise<T>;
    settled(): Promise<void>;
}
export {};
