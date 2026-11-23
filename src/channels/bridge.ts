import {chmodSync, lstatSync, mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Context} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
import {createBridge} from '#dsh-world/ecosystem/bridge/bridge';
import {createOutlet, type Push} from '#dsh-world/ecosystem/shared/outlets';
import {durableWrite} from '#dsh-world/life/lifeStore';
import {digest,type CoreStore} from '../core/storage.js';

export const bridgePrefix = '/chatpet-connect';
interface Destination {name: string; url: string; kinds: Push['kind'][]}
export interface BridgePreferences {enabled: boolean; outlets: Destination[]}
const empty: BridgePreferences = {enabled:false, outlets:[]};
export function bridgePreferences(raw: unknown): BridgePreferences {
  const prefs = raw as Partial<BridgePreferences> | null;
  if (!prefs || typeof prefs.enabled !== 'boolean' || !Array.isArray(prefs.outlets) || prefs.outlets.length > 24) throw {code:'INVALID_ARGUMENT'};
  const names = new Set<string>();
  const outlets = prefs.outlets.map(outlet => {
    if (!outlet || typeof outlet.name !== 'string' || !outlet.name.trim() || outlet.name.length > 120 || names.has(outlet.name.trim()) ||
        typeof outlet.url !== 'string' || outlet.url.length > 2048 || !Array.isArray(outlet.kinds) || !outlet.kinds.length ||
        !outlet.kinds.every(k => ['reply','busy','reach'].includes(k))) throw {code:'INVALID_ARGUMENT'};
    const url = new URL(outlet.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw {code:'INVALID_ARGUMENT'};
    names.add(outlet.name.trim());
    return {name:outlet.name.trim(), url:url.href, kinds:[...new Set(outlet.kinds)]};
  });
  return {enabled:prefs.enabled, outlets};
}

export function privateDeviceDirectory(root: string, name: string) {
  const path = join(root, name);
  mkdirSync(path, {recursive:true, mode:0o700});
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('设备接入目录无效');
  return path;
}

export class LocalBridge {
  private preferences: BridgePreferences;
  private instance?: ReturnType<typeof createBridge>;
  private readonly settingsFile: string;
  readonly discovery: string;
  constructor(private ctx: Context, directory: string, private origin: () => string,
    private home: () => Promise<Agent>, private isHome: (id: string) => boolean,
    private quiet: () => boolean, private name: () => string, private store:CoreStore, private storageId:string, private active: () => boolean) {
    this.settingsFile = join(directory, 'local-bridge.json');
    this.discovery = join(directory, 'bridge.json');
    const stat = lstatSync(this.settingsFile, {throwIfNoEntry:false});
    if (stat && (!stat.isFile() || stat.nlink !== 1)) throw Error('本地接入设置路径无效');
    this.preferences = stat ? bridgePreferences(JSON.parse(readFileSync(this.settingsFile, 'utf8'))) : {...empty};
  }
  get current() { return this.instance; }
  status() { return {preferences:this.preferences, running:Boolean(this.instance), discovery:this.instance ? this.discovery : null,
    faults:this.instance?.faults() ?? []}; }
  configure(raw: unknown) {
    const prefs = bridgePreferences(raw);
    durableWrite(this.settingsFile, JSON.stringify(prefs, null, 2));
    this.stop(); this.preferences = prefs;
  }
  private outlets() { return this.preferences.outlets.map(o => createOutlet(o, this.origin)); }
  sync(available: boolean) {
    if (!available || !this.preferences.enabled) { this.stop(); return; }
    if (this.instance) return;
    const file = lstatSync(this.discovery, {throwIfNoEntry:false});
    if (file && (!file.isFile() || file.nlink !== 1)) throw Error('本地桥接路径无效');
    const bridge = createBridge({ctx:this.ctx, prefix:bridgePrefix, home:this.home,
      inWorld:session => this.isHome(session.id), outlets:this.outlets(), origin:this.origin, file:this.discovery, name:this.name()});
    try {
      bridge.start();
      const discovery = JSON.parse(readFileSync(this.discovery, 'utf8'));
      if (!bridge.checkToken(discovery.token)) throw Error('桥接凭据尚未就绪');
      chmodSync(this.discovery, 0o600);
      this.instance = bridge;
    } catch (error) { bridge.stop(); throw error; }
  }
  async reach(push: Push & {deliveryId?:string}, homeId:string) {
    if (!this.active() || !this.instance || this.quiet()) return [];
    const destinations = this.preferences.outlets.filter(o => o.kinds.includes('reach'));
    return Promise.allSettled(destinations.map(async destination => {
      const key = push.deliveryId && digest([this.storageId,homeId,destination.url,push.deliveryId]);
      if (key) {
        const previous = this.store.get<string>('life-outlet-delivery',key);
        if (previous === 'sent') return destination.name;
        if (previous) throw Error('上次推送送达状态待核实');
        this.store.put('life-outlet-delivery',key,'pending');
      }
      await createOutlet(destination,this.origin).send(push);
      if (!this.active()) throw Error('Channel workspace changed');
      if (key) this.store.put('life-outlet-delivery',key,'sent');
      return destination.name;
    }));
  }
  stop() { this.instance?.stop(); this.instance = undefined; }
}
