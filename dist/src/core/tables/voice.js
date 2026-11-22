import { addAbortListener } from 'node:events';
import { RegistrationTable, serviceIsolation } from './registry.js';
const service = 'petVoice';
export class VoiceTable {
    slots = new Map();
    register(scope, provider) {
        const label = serviceIsolation(scope, service);
        let slot = this.slots.get(label);
        if (!slot)
            this.slots.set(label, slot = new RegistrationTable());
        const lifetime = new AbortController();
        const registration = slot.register(service, { provider, scope, signal: lifetime.signal });
        return {
            lease: registration.lease,
            revoke: async () => {
                if (!registration.lease.isCurrent())
                    return;
                const revoked = registration.revoke();
                this.slots.delete(label);
                lifetime.abort();
                await revoked;
            },
        };
    }
    lookup(ctx, callerSignal) {
        const entry = this.slots.get(serviceIsolation(ctx, service))?.get(service);
        if (!entry?.lease.isCurrent())
            return;
        const { provider, scope, signal: lifetime } = entry.value;
        if (scope.root !== ctx.root || scope.fiber.state !== 2 /* FiberState.ACTIVE */)
            return;
        const signal = callerSignal ? AbortSignal.any([lifetime, callerSignal]) : lifetime;
        const assertCurrent = () => {
            signal.throwIfAborted();
            entry.lease.assertCurrent();
            if (scope.fiber.state !== 2 /* FiberState.ACTIVE */)
                throw new DOMException('语音组件已撤销', 'AbortError');
        };
        return {
            assertCurrent,
            availability() {
                assertCurrent();
                return provider.availability();
            },
            async handle(input) {
                assertCurrent();
                let listener;
                const cancelled = new Promise((_, reject) => {
                    listener = addAbortListener(signal, () => reject(signal.reason));
                });
                try {
                    const work = Promise.resolve().then(() => {
                        assertCurrent();
                        return provider.handle({ ...input, signal });
                    });
                    const result = await Promise.race([work, cancelled]);
                    assertCurrent();
                    return result;
                }
                finally {
                    listener[Symbol.dispose]();
                }
            },
        };
    }
}
//# sourceMappingURL=voice.js.map