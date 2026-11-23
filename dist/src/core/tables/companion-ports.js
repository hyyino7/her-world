import { Context } from '@deepseek-ai/cordis';
import { RegistrationTable, serviceIsolation } from './registry.js';
const roomService = 'petRoom';
export class CompanionPorts {
    roomWindows = new Map();
    scope;
    slots = {
        bodyAvailable: new RegistrationTable(),
        activities: new RegistrationTable(),
        lifeOwnsAlbum: new RegistrationTable(),
        watchingTelevision: new RegistrationTable(),
        isRunningLifeHome: new RegistrationTable(),
        applyHomeArrival: new RegistrationTable(),
    };
    bind(ctx, ownerScope) {
        const scope = this.scope = { ctx, ownerScope };
        return () => { if (this.scope === scope)
            this.scope = undefined; };
    }
    /** Match the consumer's Cordis visibility for this provider's service. */
    scopeFor(provider, service) {
        const scope = this.scope;
        if (scope && scope.ctx.root === provider.root &&
            scope.ctx[Context.isolate][service] === provider[Context.isolate][service])
            return scope;
    }
    registerRoomWindow(scope, open) {
        const label = serviceIsolation(scope, roomService);
        let slot = this.roomWindows.get(label);
        if (!slot)
            this.roomWindows.set(label, slot = new RegistrationTable());
        const registration = slot.register(roomService, { scope, open });
        return {
            revoke: () => {
                if (registration.lease.isCurrent())
                    this.roomWindows.delete(label);
                return registration.revoke();
            },
        };
    }
    roomWindowFor(ctx) {
        const entry = this.roomWindows.get(serviceIsolation(ctx, roomService))?.get(roomService);
        if (entry?.lease.isCurrent() && entry.value.scope.root === ctx.root &&
            entry.value.scope.fiber.state === 2 /* FiberState.ACTIVE */)
            return entry.value.open;
    }
    register(name, port) { return this.slots[name].register(name, port); }
    get(name) {
        const entry = this.slots[name].get(name);
        if (entry?.lease.isCurrent())
            return entry.value;
    }
}
//# sourceMappingURL=companion-ports.js.map