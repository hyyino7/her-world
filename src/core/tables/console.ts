import { type Context, FiberState } from '@deepseek-ai/cordis';
import type { ContractError } from '../../contracts/common.js';
import type { RegistrationLease } from '../../contracts/tables.js';
import type { WorkspaceTarget } from '../preferences.js';
import { RegistrationTable, serviceIsolation } from './registry.js';

export interface SettingsWorkspace extends WorkspaceTarget {
  readonly sessionIds?: readonly string[];
  status(): Promise<'ok' | 'missing-dir'>;
}
export interface SettingsWorkspaceRegistry {
  list(): SettingsWorkspace[];
  get(id: string): SettingsWorkspace | undefined;
}

export type ConsoleCode = ContractError['code']
  | 'WORLD_UNAVAILABLE' | 'PROFILE_UNAVAILABLE' | 'MEMORY_UNAVAILABLE' | 'WORKSPACE_INVALID' | 'ENOENT';

export function fail(code: ConsoleCode): never { throw {code}; }

export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_ARGUMENT');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) fail('INVALID_ARGUMENT');
  return result;
}

export function requiredText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('INVALID_ARGUMENT');
  return value.trim();
}

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

const services: Record<string, string> = {
  channels: 'petChannels', desktop: 'petDesktop', economy: 'petEconomy', emotion: 'petEmotion',
  life: 'petLife', platform: 'petPlatform', room: 'petRoom',
};

function label(owner: string, contextScope?: Context): string | symbol {
  const service = services[owner];
  return contextScope && service ? serviceIsolation(contextScope, service) : owner;
}

export class ConsoleTable {
  private readonly slots = new Map<string | symbol, RegistrationTable<ConsoleOperations & {scope?: Context}>>();

  register(owner: string, value: ConsoleOperations, scope?: Context) {
    const key = label(owner, scope);
    let slot = this.slots.get(key);
    if (!slot) this.slots.set(key, slot = new RegistrationTable());
    const registration = slot.register(owner, {...value, scope});
    return {
      lease: registration.lease,
      revoke: () => {
        if (registration.lease.isCurrent()) this.slots.delete(key);
        return registration.revoke();
      },
    };
  }

  get(owner: string, scope?: Context): {value: ConsoleOperations; lease: RegistrationLease} | undefined {
    const entry = this.slots.get(label(owner, scope))?.get(owner);
    if (!entry?.lease.isCurrent()) return;
    const provider = entry.value.scope;
    if (provider && (provider.root !== scope?.root || provider.fiber.state !== FiberState.ACTIVE)) return;
    return entry;
  }
}
