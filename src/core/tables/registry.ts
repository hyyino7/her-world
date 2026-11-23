import { Context } from '@deepseek-ai/cordis';
import type { RegistrationLease, TableRegistration } from '../../contracts/tables.js';

export function serviceIsolation(contextScope: Context, service: string) {
  contextScope.root[Context.isolate][service] ??= Symbol(service);
  return contextScope[Context.isolate][service];
}

interface Entry<Value> {
  readonly value: Value;
  readonly order: number;
  readonly lease: RegistrationLease;
}

interface Ordering<Value> {
  order(value: Value): number;
  overlaps?(left: Value, right: Value): boolean;
}

export class RegistrationTable<Value> {
  private readonly registrations = new Map<string, Entry<Value>>();

  constructor(private readonly ordering?: Ordering<Value>) {}

  register(key: string, value: Value): TableRegistration {
    if (this.registrations.has(key)) throw new Error(`Duplicate registration: ${key}`);
    const order = this.ordering ? this.ordering.order(value) : 0;
    if (!Number.isFinite(order)) throw new Error(`Invalid registration order: ${key}`);
    if (this.ordering && [...this.registrations.values()].some(entry =>
      entry.order === order && (this.ordering?.overlaps?.(entry.value, value) ?? true))) {
      throw new Error(`Duplicate registration order: ${order}`);
    }

    const generation = Symbol(key);
    const isCurrent = () => this.registrations.get(key)?.lease.generation === generation;
    const assertCurrent = () => {
      if (!isCurrent()) throw new Error(`Registration is no longer current: ${key}`);
    };
    const lease: RegistrationLease = Object.freeze({
      generation, isCurrent, assertCurrent,
      guard<Args extends unknown[], Output>(callback: (...args: Args) => Output) {
        return (...args: Args) => {
          assertCurrent();
          return callback(...args);
        };
      },
    });
    const scopes = new Map<Context, { dispose?: () => Promise<void> }>();
    this.registrations.set(key, { value, order, lease });
    return {
      lease,
      async attach(scope, install) {
        assertCurrent();
        if (scopes.has(scope)) return;
        const attachment: { dispose?: () => Promise<void> } = {};
        scopes.set(scope, attachment);
        try {
          attachment.dispose = scope.effect(() => {
            const release = install(scope, lease);
            return () => {
              scopes.delete(scope);
              return release();
            };
          });
          if (!isCurrent()) await attachment.dispose();
        } catch (error) {
          scopes.delete(scope);
          throw error;
        }
      },
      revoke: async () => {
        if (!isCurrent()) return;
        this.registrations.delete(key);
        const results = await Promise.allSettled([...scopes.values()].map(async attachment => attachment.dispose?.()));
        const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        if (errors.length) throw new AggregateError(errors, `Failed to revoke registration: ${key}`);
      },
    };
  }

  get(key: string): Entry<Value> | undefined {
    return this.registrations.get(key);
  }

  entries(): readonly Entry<Value>[] {
    return [...this.registrations.values()].sort((left, right) => left.order - right.order);
  }
}
