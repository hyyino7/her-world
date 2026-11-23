import {Context, FiberState} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
import type {ActivityRecord} from '#dsh-world/life/types';
import {RegistrationTable, serviceIsolation} from './registry.js';
import type {HomeBinding} from '../workspace.js';

export interface CompanionBinding {
  workspaceId: string;
  path: string;
  storageId: string;
}

export interface ActivityReader {
  activityDays(binding: CompanionBinding): readonly string[];
  activity(binding: CompanionBinding, day: string): readonly ActivityRecord[];
}

type OwnerScope = (agent: Agent) => CompanionBinding | undefined;
interface Ports {
  bodyAvailable(): boolean;
  activities: ActivityReader;
  lifeOwnsAlbum(sessionId: string): boolean;
  watchingTelevision(sessionId: string): boolean;
  isRunningLifeHome(sessionId: string): boolean;
  applyHomeArrival(scope: HomeBinding, sessionId: string): boolean;
}

const roomService = 'petRoom';
type OpenRoomWindow = (workspaceId: string) => Promise<{running:boolean;ready:boolean;workspaceId:string|null}>;

export class CompanionPorts {
  private readonly roomWindows = new Map<symbol, RegistrationTable<{scope: Context; open: OpenRoomWindow}>>();
  private scope?: {ctx: Context; ownerScope: OwnerScope};
  private readonly slots: {[K in keyof Ports]: RegistrationTable<Ports[K]>} = {
    bodyAvailable: new RegistrationTable(),
    activities: new RegistrationTable(),
    lifeOwnsAlbum: new RegistrationTable(),
    watchingTelevision: new RegistrationTable(),
    isRunningLifeHome: new RegistrationTable(),
    applyHomeArrival: new RegistrationTable(),
  };

  bind(ctx: Context, ownerScope: OwnerScope) {
    const scope = this.scope = {ctx, ownerScope};
    return () => { if (this.scope === scope) this.scope = undefined; };
  }

  /** Match the consumer's Cordis visibility for this provider's service. */
  scopeFor(provider: Context, service: string) {
    const scope = this.scope;
    if (scope && scope.ctx.root === provider.root &&
        scope.ctx[Context.isolate][service] === provider[Context.isolate][service]) return scope;
  }

  registerRoomWindow(scope: Context, open: OpenRoomWindow) {
    const label = serviceIsolation(scope, roomService);
    let slot = this.roomWindows.get(label);
    if (!slot) this.roomWindows.set(label, slot = new RegistrationTable());
    const registration = slot.register(roomService, {scope, open});
    return {
      revoke: () => {
        if (registration.lease.isCurrent()) this.roomWindows.delete(label);
        return registration.revoke();
      },
    };
  }

  roomWindowFor(ctx: Context): OpenRoomWindow | undefined {
    const entry = this.roomWindows.get(serviceIsolation(ctx, roomService))?.get(roomService);
    if (entry?.lease.isCurrent() && entry.value.scope.root === ctx.root &&
        entry.value.scope.fiber.state === FiberState.ACTIVE) return entry.value.open;
  }

  register<K extends keyof Ports>(name: K, port: Ports[K]) { return this.slots[name].register(name, port); }

  get<K extends keyof Ports>(name: K): Ports[K] | undefined {
    const entry = this.slots[name].get(name);
    if (entry?.lease.isCurrent()) return entry.value;
  }
}
