import {Context} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
import type {ActivityRecord} from '#dsh-world/life/types';
import {RegistrationTable} from './registry.js';
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
  openRoomWindow(workspaceId: string): Promise<{running:boolean;ready:boolean;workspaceId:string|null}>;
  isRunningLifeHome(sessionId: string): boolean;
  applyHomeArrival(scope: HomeBinding, sessionId: string): boolean;
}

export class CompanionPorts {
  private scope?: {ctx: Context; ownerScope: OwnerScope};
  private readonly slots: {[K in keyof Ports]: RegistrationTable<Ports[K]>} = {
    bodyAvailable: new RegistrationTable(),
    activities: new RegistrationTable(),
    lifeOwnsAlbum: new RegistrationTable(),
    watchingTelevision: new RegistrationTable(),
    openRoomWindow: new RegistrationTable(),
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

  register<K extends keyof Ports>(name: K, port: Ports[K]) { return this.slots[name].register(name, port); }

  get<K extends keyof Ports>(name: K): Ports[K] | undefined {
    const entry = this.slots[name].get(name);
    if (entry?.lease.isCurrent()) return entry.value;
  }
}
