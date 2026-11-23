import {FiberState, type Context, type Fiber} from '@deepseek-ai/cordis';
import type {Push} from '#dsh-world/ecosystem/shared/outlets';
import type {PetCoreHost} from '../core/index.js';
import {RegistrationTable} from '../core/tables/registry.js';
import {LivingWorld, serviceLabel} from './index.js';

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
type OutletTables<T> = Map<symbol, RegistrationTable<{callbacks: T; fiber: Fiber}>>;
type Slots = {[K in Slot]: OutletTables<LifeOutlets[K]>};
const services = {desktop: 'petDesktop', channels: 'petChannels'};
const outlets = new WeakMap<Context, WeakMap<PetCoreHost, Slots>>();

export function registerLifeOutlet<K extends Slot>(ctx: Context, host: PetCoreHost, slot: K, callbacks: LifeOutlets[K]) {
  let hosts = outlets.get(ctx.root);
  if (!hosts) outlets.set(ctx.root, hosts = new WeakMap());
  let slots = hosts.get(host);
  if (!slots) hosts.set(host, slots = {desktop: new Map(), channels: new Map()});
  const tables: OutletTables<LifeOutlets[K]> = slots[slot];
  const label = serviceLabel(ctx, services[slot]);
  let table = tables.get(label);
  if (!table) tables.set(label, table = new RegistrationTable());
  const registration = table.register(slot, {callbacks, fiber: ctx.fiber});
  return {...registration, async revoke() {
    try { await registration.revoke(); }
    finally {
      if (!table.get(slot) && tables.get(label) === table) tables.delete(label);
    }
  }};
}

export function lookupLifeOutlet<K extends Slot>(ctx: Context, host: PetCoreHost, slot: K): LifeOutlets[K] | undefined {
  const tables: OutletTables<LifeOutlets[K]> | undefined = outlets.get(ctx.root)?.get(host)?.[slot];
  const entry = tables?.get(serviceLabel(ctx, services[slot]))?.get(slot);
  if (entry?.lease.isCurrent() && entry.value.fiber.state === FiberState.ACTIVE) return entry.value.callbacks;
}

export function readLifeEnabled(ctx: Context, host: PetCoreHost, workspaceId: string): boolean {
  const plan = LivingWorld.lookupPlan(ctx, host);
  // Saved intent owns autonomy even when native execution is unavailable.
  return plan?.bodyClockState(workspaceId)?.enabled ?? plan?.running() ?? false;
}

export function readRunningLifeHome(ctx: Context, host: PetCoreHost) {
  return LivingWorld.lookupPlan(ctx, host)?.homeSessionId();
}

export function isRunningLifeHome(ctx: Context, host: PetCoreHost, sessionId: string) {
  return LivingWorld.lookupPlan(ctx, host)?.isHome(sessionId) === true;
}
