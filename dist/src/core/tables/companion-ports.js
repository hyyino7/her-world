import { Context } from '@deepseek-ai/cordis';
import { RegistrationTable } from './registry.js';
export class CompanionPorts {
    scope;
    slots = {
        bodyAvailable: new RegistrationTable(),
        activities: new RegistrationTable(),
        lifeOwnsAlbum: new RegistrationTable(),
        watchingTelevision: new RegistrationTable(),
        openRoomWindow: new RegistrationTable(),
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
    register(name, port) { return this.slots[name].register(name, port); }
    get(name) {
        const entry = this.slots[name].get(name);
        if (entry?.lease.isCurrent())
            return entry.value;
    }
}
//# sourceMappingURL=companion-ports.js.map