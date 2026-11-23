import { RegistrationTable, serviceIsolation } from './registry.js';
export function fail(code) { throw { code }; }
export function object(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail('INVALID_ARGUMENT');
    const result = value;
    if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key)))
        fail('INVALID_ARGUMENT');
    return result;
}
export function requiredText(value, max) {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
        fail('INVALID_ARGUMENT');
    return value.trim();
}
const services = {
    channels: 'petChannels', desktop: 'petDesktop', economy: 'petEconomy', emotion: 'petEmotion',
    life: 'petLife', platform: 'petPlatform', room: 'petRoom',
};
function label(owner, contextScope) {
    const service = services[owner];
    return contextScope && service ? serviceIsolation(contextScope, service) : owner;
}
export class ConsoleTable {
    slots = new Map();
    register(owner, value, scope) {
        const key = label(owner, scope);
        let slot = this.slots.get(key);
        if (!slot)
            this.slots.set(key, slot = new RegistrationTable());
        const registration = slot.register(owner, { ...value, scope });
        return {
            lease: registration.lease,
            revoke: () => {
                if (registration.lease.isCurrent())
                    this.slots.delete(key);
                return registration.revoke();
            },
        };
    }
    get(owner, scope) {
        const entry = this.slots.get(label(owner, scope))?.get(owner);
        if (!entry?.lease.isCurrent())
            return;
        const provider = entry.value.scope;
        if (provider && (provider.root !== scope?.root || provider.fiber.state !== 2 /* FiberState.ACTIVE */))
            return;
        return entry;
    }
}
//# sourceMappingURL=console.js.map