import type {Context} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
import {isDeepStrictEqual} from 'node:util';
import {bridgeRoute, compactRoute} from '#dsh-world/ecosystem/bridge/route';
import type {Push} from '#dsh-world/ecosystem/shared/outlets';
import {CONTRACT_VERSION} from '../contracts/version.js';
import {digest} from '../core/storage.js';
import type {PetCoreHost} from '../core/index.js';
import {registerLifeOutlet} from '../living/outlets.js';
import {bridgePrefix, LocalBridge, privateDeviceDirectory} from './bridge.js';
import {createMessaging} from './messaging.js';
import {isCompanionHome, resolveCompanionHome} from '../core/companion-foundation.js';
import {companionChannelDirectory} from './storage.js';

interface Services {
  webServer: {getOrigin(): string; register(route: ReturnType<typeof bridgeRoute>): () => void};
  profileContext?: {dir: string};
  sessionController: {resolveAgent(id: string): Promise<{agent?: Agent}>};
}
type Binding = {id:string; path:string; storageId:string; bridge:LocalBridge; messaging:Awaited<ReturnType<typeof createMessaging>>};
export class CompanionChannels {
  private bound?: Binding;
  private closed = false;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private ctx: Context, private host: PetCoreHost, private services: Services, private profileDir: string) {}
  private serial<T>(work: () => Promise<T>) {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }
  private target() {
    const status = this.host.workspace.status();
    return !this.closed && status.state === 'ready' ? status.target : undefined;
  }
  private current(binding: Pick<Binding,'id'|'path'|'storageId'>) {
    const target=this.target();
    return target?.id===binding.id && target.path===binding.path && this.host.workspace.storageId()===binding.storageId;
  }
  private async reconcile() {
    if (this.bound && !this.current(this.bound)) {
      const previous = this.bound; this.bound = undefined;
      previous.bridge.stop(); await previous.messaging.close();
    }
    // Closing an old adapter can await external cleanup. Capture the current
    // root afterwards, rather than reopening a root which has already moved.
    const current = this.target(), storageId = current ? this.host.workspace.storageId() : undefined;
    if (!current || !storageId || !this.profileDir) return;
    if (!this.bound) {
      const {id,path}=current, binding={id,path,storageId};
      const deviceDirectory = privateDeviceDirectory(privateDeviceDirectory(this.profileDir, 'chatpet-channels'), digest(storageId));
      const dataDirectory=companionChannelDirectory(path,deviceDirectory);
      const active = () => this.current(binding);
      const isHome = (sessionId: string) => active() && isCompanionHome(this.ctx,this.host,sessionId);
      const ownerHome = async () => {
        if (!active()) throw Error('主人会话工作区已切换');
        const agent = await resolveCompanionHome(this.ctx,this.host);
        if (!active() || !isHome(agent.id)) throw Error('主人会话已切换');
        return agent;
      };
      const bridge = new LocalBridge(this.ctx, deviceDirectory, () => this.services.webServer.getOrigin(), ownerHome, isHome,
        () => this.host.workspace.runtime.policy().quiet, () => this.host.workspace.runtime.identity().displayName,
        this.host.workspace.runtime.store,storageId);
      const messaging = await createMessaging(this.ctx, this.host, {deviceDirectory, dataDirectory, workspaceId:id, storageId, active, ownerHome});
      if (!active()) { bridge.stop(); await messaging.close(); return; }
      this.bound = {...binding, messaging, bridge};
    }
    this.bound.bridge.sync(true);
    return this.bound;
  }
  refresh() { return this.serial(() => this.reconcile()); }
  get local() { return this.bound && this.current(this.bound) ? this.bound.bridge.current : undefined; }
  qqConnection(): 'off'|'online'|'unavailable' {
    const bound=this.bound;
    if(!bound || !this.current(bound))return 'off';
    const state=bound.messaging.qqConnection();
    return state;
  }
  compact() {
    const home = this.ctx.get('petLife')?.homeSessionId();
    if (!home || !this.local || !this.host.native.memoryFor(home)) return '生活会话或记忆整理未启用';
    if (!this.host.workspace.runtime.store.get<{turns:number}>('memory-batch', home)?.turns)
      return '当前没有待整理的已完成对话';
    this.host.native.requestReviewCompaction(home);
    return undefined;
  }
  async reach(workspaceId: string, push: Push) {
    const bound = this.bound;
    if (!bound || bound.id !== workspaceId || !this.current(bound) || this.host.workspace.runtime.policy().quiet) return [];
    const home = this.ctx.get('petLife')?.homeSessionId();
    if (!home) return [];
    const deliveries = await Promise.allSettled([bound.bridge.reach(push,home),bound.messaging.reach(push,home)]);
    return deliveries.flatMap(result => result.status === 'fulfilled' ? result.value : [result]);
  }
  request(id: string, operation: string, input: Record<string, unknown>) {
    return this.serial(async () => {
      const bound = await this.reconcile();
      if (!bound || bound.id !== id || !this.current(bound)) throw {code:'STALE_BINDING'};
      if (['groupState','groupSettings','groupSlang','groupResearch','qzoneState','qzoneSettings','qzoneDraft','qzoneRemove'].includes(operation)) {
        const response = await bound.messaging.group(operation, input);
        if (!this.current(bound)) throw {code:'STALE_BINDING'};
        return response;
      }
      if (operation === 'bridgeSettings') {
        if (!isDeepStrictEqual(input.expected,bound.bridge.status().preferences)) throw {code:'STALE_REVISION'};
        bound.bridge.configure(input.next);
        bound.bridge.sync(true);
      } else if (operation === 'messagingSettings') {
        if (!isDeepStrictEqual(input.expected, bound.messaging.status().config)) throw {code:'STALE_REVISION'};
        await bound.messaging.configure(input.next as Parameters<typeof bound.messaging.configure>[0]);
      } else if (operation !== 'channelStatus') throw {code:'INVALID_ARGUMENT'};
      if (!this.current(bound)) throw {code:'STALE_BINDING'};
      return {bridge:bound.bridge.status(), messaging:bound.messaging.status()};
    });
  }
  close() {
    this.closed = true;
    this.bound?.messaging.cancelVoice();
    return this.refresh();
  }
}

export const name = '60-Channels';
export const inject = ['petCore','webServer','sessionController','agents','sessions','sessionPersistence','agentPresets','workspaceRegistry'];
export function apply(ctx: Context, config: {deviceDirectory?:string} = {}) {
  const services = ctx as unknown as Services;
  const profile = (ctx as unknown as {get(key: string): Services['profileContext']}).get('profileContext');
  const host = ctx.petCore;
  const channels = new CompanionChannels(ctx, host, services, config.deviceDirectory ?? profile?.dir ?? '');
  ctx.provide('petChannels', channels);
  ctx.effect(() => registerLifeOutlet(ctx, host, 'channels', {
    reach: (workspaceId, push) => channels.reach(workspaceId, push),
  }).revoke);
  ctx.effect(() => services.webServer.register(bridgeRoute(bridgePrefix, () => channels.local)));
  ctx.effect(() => services.webServer.register(compactRoute(bridgePrefix, () => channels.local, () => channels.compact())));
  const refresh = () => { void channels.refresh().catch(error => ctx.logger.warn('Channel refresh failed', error)); };
  ctx.on('pet/core.changed', refresh);
  ctx.on('pet/life.changed', refresh);
  refresh();
  ctx.effect(() => async () => { await channels.close(); });
  ctx.effect(() => host.workspace.runtime.capabilityTable.register({
    id: 'channel.qq', owner: 'qq', contractVersion: CONTRACT_VERSION, order: 7,
    status: () => {
      const state = channels.qqConnection();
      return {state: state === 'online' ? 'ready' : state === 'off' ? 'disabled' : 'unavailable',
        reason: state === 'online' ? null : state === 'off' ? 'QQ is off' : 'QQ is disconnected',
        supportedOperations: state === 'online' ? ['receive', 'reply'] : []};
    },
  }).revoke);
}
declare module '@deepseek-ai/cordis' {interface Context {petChannels: CompanionChannels}}
