import { RegistrationTable } from '../core/tables/registry.js';
import { LivingWorld, serviceLabel } from './index.js';
const services = { desktop: 'petDesktop', channels: 'petChannels' };
const outlets = new WeakMap();
export function registerLifeOutlet(ctx, host, slot, callbacks) {
    let hosts = outlets.get(ctx.root);
    if (!hosts)
        outlets.set(ctx.root, hosts = new WeakMap());
    let slots = hosts.get(host);
    if (!slots)
        hosts.set(host, slots = { desktop: new Map(), channels: new Map() });
    const tables = slots[slot];
    const label = serviceLabel(ctx, services[slot]);
    let table = tables.get(label);
    if (!table)
        tables.set(label, table = new RegistrationTable());
    const registration = table.register(slot, { callbacks, fiber: ctx.fiber });
    return { ...registration, async revoke() {
            try {
                await registration.revoke();
            }
            finally {
                if (!table.get(slot) && tables.get(label) === table)
                    tables.delete(label);
            }
        } };
}
export function lookupLifeOutlet(ctx, host, slot) {
    const tables = outlets.get(ctx.root)?.get(host)?.[slot];
    const entry = tables?.get(serviceLabel(ctx, services[slot]))?.get(slot);
    if (entry?.lease.isCurrent() && entry.value.fiber.state === 2 /* FiberState.ACTIVE */)
        return entry.value.callbacks;
}
export function readLifeEnabled(ctx, host, workspaceId) {
    const plan = LivingWorld.lookupPlan(ctx, host);
    // Saved intent owns autonomy even when native execution is unavailable.
    return plan?.bodyClockState(workspaceId)?.enabled ?? plan?.running() ?? false;
}
export function readRunningLifeHome(ctx, host) {
    return LivingWorld.lookupPlan(ctx, host)?.homeSessionId();
}
export function isRunningLifeHome(ctx, host, sessionId) {
    return LivingWorld.lookupPlan(ctx, host)?.isHome(sessionId) === true;
}
//# sourceMappingURL=outlets.js.map