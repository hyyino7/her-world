import {type Context, FiberState} from '@deepseek-ai/cordis';
import {addAbortListener} from 'node:events';
import type {VoiceCall, VoiceProvider} from '../../contracts/voice.js';
import {RegistrationTable, serviceIsolation} from './registry.js';

const service = 'petVoice';

export class VoiceTable {
  private readonly slots = new Map<symbol, RegistrationTable<{
    provider: VoiceProvider;
    scope: Context;
    signal: AbortSignal;
  }>>();

  register(scope: Context, provider: VoiceProvider) {
    const label = serviceIsolation(scope, service);
    let slot = this.slots.get(label);
    if (!slot) this.slots.set(label, slot = new RegistrationTable());
    const lifetime = new AbortController();
    const registration = slot.register(service, {provider, scope, signal: lifetime.signal});
    return {
      lease: registration.lease,
      revoke: async () => {
        if (!registration.lease.isCurrent()) return;
        const revoked = registration.revoke();
        this.slots.delete(label);
        lifetime.abort();
        await revoked;
      },
    };
  }

  lookup(ctx: Context, callerSignal?: AbortSignal): VoiceCall | undefined {
    const entry = this.slots.get(serviceIsolation(ctx, service))?.get(service);
    if (!entry?.lease.isCurrent()) return;
    const {provider, scope, signal: lifetime} = entry.value;
    if (scope.root !== ctx.root || scope.fiber.state !== FiberState.ACTIVE) return;
    const signal = callerSignal ? AbortSignal.any([lifetime, callerSignal]) : lifetime;
    const assertCurrent = () => {
      signal.throwIfAborted();
      entry.lease.assertCurrent();
      if (scope.fiber.state !== FiberState.ACTIVE) throw new DOMException('语音组件已撤销', 'AbortError');
    };
    return {
      assertCurrent,
      availability() {
        assertCurrent();
        return provider.availability();
      },
      async handle(input) {
        assertCurrent();
        let listener!: ReturnType<typeof addAbortListener>;
        const cancelled = new Promise<never>((_, reject) => {
          listener = addAbortListener(signal, () => reject(signal.reason));
        });
        try {
          const work = Promise.resolve().then(() => {
            assertCurrent();
            return provider.handle({...input, signal});
          });
          const result = await Promise.race([work, cancelled]);
          assertCurrent();
          return result;
        } finally {
          listener[Symbol.dispose]();
        }
      },
    };
  }
}
