import type { Context } from '@deepseek-ai/cordis';
import { constants, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PetCoreHost } from '../index.js';
import {sameHomeBinding} from '../home-binding.js';
import {reject} from '../storage.js';
import type {HomeBinding} from '../workspace.js';

interface Header { id: string; cwd?: string; [key: string]: unknown }
interface Event { seq: number; type: string; [key: string]: unknown }
interface Handle { header: Header; inheritedEventCount?: number; read(): Promise<{events: Event[]}>; append(events: Event[]): Promise<void>; flush(): Promise<void>; close(): Promise<void> }
interface Native {
  get(key: string): unknown;
  sessions: { get(id: string): unknown; flush(session: unknown): Promise<boolean> };
  sessionPersistence: { open(id: string, access: 'read'|'write'): Promise<Handle>; create(header: Header, options?: unknown): Promise<Handle> };
}
interface NativeWorkspace {path:string;sessionIds:readonly string[];attachSession(id:string):Promise<void>}
interface Registry { get(id: string): NativeWorkspace | undefined; archivedSessionIds: readonly string[]; archiveSession(id:string):Promise<unknown> }
interface ChannelScope {workspaceId:string;root:string;directory:string;relativeDirectory:string;prefix:string;knownIds:readonly string[];restored:boolean}
interface ExportScope {sessionId:string;root:string;workspaceId:string;storageId:string;cwd:string;dev:number;ino:number;managedDev:number;managedIno:number;archived:boolean;
  channel?:{directory:string;prefix:string}}
interface PendingExport {scope:ExportScope;attempts:number;retryAt:number}
interface Copy { schema: 1; companionId: string; scopeId: string; storageId: string; header: Header; inheritedEventCount: number; archived: boolean; events: Event[];
  channel?:{directory:string;prefix:string} }
const equal = isDeepStrictEqual;
const key = (id: string) => createHash('sha256').update(id).digest('hex')+'.json';

/** Complete native log copies, not model-facing context. DSH remains the sole
 * session writer and validates imports through create/append/flush. */
export class NativeTranscripts {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = new Map<string,PendingExport>();
  private flushing?:Promise<void>;
  private closed=false;
  private timer?: NodeJS.Timeout;
  private restored?: {key: string; scope: HomeBinding | undefined};
  private channels=new Map<string,ChannelScope>();
  private last?: {target:{id:string;path:string;title:string};sessionIds:string[];archived:string[]};
  constructor(private ctx: Context, private host: PetCoreHost) {}
  private native() { return this.ctx as unknown as Native; }
  private target(allowShutdownSnapshot=false) {
    const status=this.host.workspace.status();
    if(status.state!=='ready' || !status.target) throw Error('Initialize the bound Repo before restoring conversations');
    const registry=this.native().get('workspaceRegistry') as Registry | undefined;
    let workspace=registry?.get(status.target.id);
    if(!workspace && allowShutdownSnapshot && this.last?.target.id===status.target.id && this.last.target.path===status.target.path) {
      // Membership was already checked on the native event. The optional
      // workspace service may unload before Core's final persistence barrier.
      const unavailable=async (_id:string):Promise<never>=>{throw Error('Native workspace mutations are unavailable during shutdown');};
      return {target:status.target,workspace:{path:status.target.path,sessionIds:this.last.sessionIds,attachSession:unavailable},
        registry:{get:()=>undefined,archivedSessionIds:this.last.archived,archiveSession:unavailable}};
    }
    if(!workspace || workspace.path!==status.target.path) throw Error('Native workspace binding changed');
    this.last={target:status.target,sessionIds:[...workspace.sessionIds],archived:[...registry!.archivedSessionIds]};
    return {target:status.target,workspace,registry:registry!};
  }
  private directory(root: string) {
    let directory=root;
    for(const part of ['.chatpet','data','core','native-sessions']) {
      directory=join(directory,part);
      if(!existsSync(directory)) mkdirSync(directory,{mode:0o700});
      const stat=lstatSync(directory);
      if(!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Portable conversation directory must remain inside the Repo');
    }
    return directory;
  }
  private read(path: string): Copy {
    const stat=lstatSync(path);
    if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1) throw Error('Unexpected portable conversation file');
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const value=JSON.parse(readFileSync(fd,'utf8')) as Copy;
      const config=this.host.workspace.runtime.config;
      if(value.schema!==1 || value.companionId!==config.companionId || value.scopeId!==config.scopeId
        || !value.header?.id || !Array.isArray(value.events) || value.events.some((e,i)=>e.seq!==i)) throw Error('Portable native log identity or sequence mismatch');
      if(value.channel) {
        const match=/^\.chatpet\/data\/channels\/conversations\/([a-f0-9]{64})$/.exec(value.channel.directory);
        if(!match || value.channel.prefix!=='chatpet-guest-'+match[1]+'-' || !value.header.id.startsWith(value.channel.prefix)
          || value.header.agentPreset!=='chatpet-channel-guest' || value.header.parentSession)
          throw Error('Portable channel log has an invalid isolated workspace');
      }
      return value;
    } finally {closeSync(fd);}
  }
  private write(path: string, value: unknown) {
    if(existsSync(path)) {const stat=lstatSync(path);if(!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1) throw Error('Refusing to replace portable data link');}
    const temp=path+'.'+randomUUID()+'.tmp',fd=openSync(temp,'wx',0o600);
    try {writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);} finally {closeSync(fd);}
    try {renameSync(temp,path);} finally {if(existsSync(temp)) unlinkSync(temp);}
  }
  private enqueue<T>(operation:()=>Promise<T>) {
    const result=this.tail.then(operation);this.tail=result.catch(()=>{});return result;
  }
  private channelScope(sessionId:string,registry:Registry,root:string,shutdown=false) {
    for(const scope of this.channels.values()) {
      if(scope.root!==root || !sessionId.startsWith(scope.prefix))continue;
      const workspace=registry.get(scope.workspaceId);
      if(workspace?.path===scope.directory) {
        scope.knownIds=[...workspace.sessionIds];
        if(workspace.sessionIds.includes(sessionId))return {scope,workspace};
      } else if(shutdown && !workspace && scope.knownIds.includes(sessionId))return {scope,
        workspace:{path:scope.directory,sessionIds:scope.knownIds,attachSession:async()=>{throw Error('Channel workspace is unavailable during shutdown');}}};
    }
  }
  /** Called only by the authenticated channel adapter after native workspace
   * creation. No arbitrary cwd, model tool or additional channel permission. */
  async registerChannelWorkspace(workspaceId:string,directory:string,prefix:string) {
    return this.enqueue(async()=>{
      const {target,registry}=this.target();
      const local=relative(target.path,directory).split(sep).join('/');
      const match=/^\.chatpet\/data\/channels\/conversations\/([a-f0-9]{64})$/.exec(local);
      const workspace=registry.get(workspaceId);
      if(!match || prefix!=='chatpet-guest-'+match[1]+'-' || workspace?.path!==directory)
        throw Error('Channel transcripts require their registered isolated Repo workspace');
      let checked=target.path;
      for(const part of local.split('/')) {
        checked=join(checked,part);const stat=lstatSync(checked);
        if(!stat.isDirectory() || stat.isSymbolicLink())throw Error('Channel conversation directory must remain inside the Repo');
      }
      let scope=this.channels.get(workspaceId);
      if(!scope || scope.root!==target.path || scope.directory!==directory || scope.prefix!==prefix) {
        scope={workspaceId,root:target.path,directory,relativeDirectory:local,prefix,knownIds:[...workspace.sessionIds],restored:false};
        this.channels.set(workspaceId,scope);
      }
      if(scope.restored)return;
      const copies=this.directory(target.path);
      for(const name of readdirSync(copies).filter(name=>/^[a-f0-9]{64}\.json$/.test(name))) {
        const copy=this.read(join(copies,name));
        if(name!==key(copy.header.id))throw Error('Portable session filename mismatch');
        if(copy.channel?.directory!==local || copy.channel.prefix!==prefix)continue;
        await this.restoreCopy(copy,workspace,directory,registry);
      }
      scope.restored=true;scope.knownIds=[...workspace.sessionIds];
      for(const id of workspace.sessionIds)if(id.startsWith(prefix))this.schedule(id);
    });
  }
  capture(session:{id:string;header:{cwd?:string;parentSession?:unknown;agentPreset?:string}}) {
    let current:ReturnType<NativeTranscripts['target']>;
    try {current=this.target();}catch{return;}
    const {target,registry}=current;
    if(this.host.workspace.sessionStatus(session,registry)?.state==='ready') {this.schedule(session.id);return;}
    const found=this.channelScope(session.id,registry,target.path);
    if(found && session.header.cwd===found.scope.directory && !session.header.parentSession
      && session.header.agentPreset==='chatpet-channel-guest')this.schedule(session.id);
  }
  private async restoreCopy(copy:Copy,workspace:NativeWorkspace,path:string,registry:Registry,validate=()=>{}) {
    validate();
    const native=this.native(),id=copy.header.id,wasAttached=workspace.sessionIds.includes(id);
    let existing:Handle|undefined,missing:Event[]=[];
    try {existing=await native.sessionPersistence.open(id,'read');}
    catch(error) {if(!/not.?found/i.test(String((error as Error).name)))throw error;}
    if(existing) {
      try {
        validate();
        const current=(await existing.read()).events;
        validate();
        const {cwd:_old,...expectedHeader}=copy.header,{cwd:_current,...currentHeader}=existing.header;
        if(existing.header.cwd!==path || !equal(expectedHeader,currentHeader)
          || !equal(current.slice(0,Math.min(current.length,copy.events.length)),copy.events.slice(0,Math.min(current.length,copy.events.length))))
          throw Error('Native session conflicts with portable copy: '+id);
        missing=copy.events.slice(current.length);
      } finally {await existing.close();}
      validate();
      if(missing.length) {
        const writer=await native.sessionPersistence.open(id,'write');
        try {
          validate();
          const current=(await writer.read()).events;
          validate();
          if(!equal(current,copy.events.slice(0,current.length)))throw Error('Native log changed during restore: '+id);
          await writer.append(copy.events.slice(current.length));
          validate();
          await writer.flush();
          validate();
        } finally {await writer.close();}
      }
    } else {
      validate();
      const writer=await native.sessionPersistence.create({...copy.header,cwd:path},copy.inheritedEventCount?{inheritedEventCount:copy.inheritedEventCount}:undefined);
      try {
        validate();
        await writer.append(copy.events);
        validate();
        await writer.flush();
        validate();
      } finally {await writer.close();}
    }
    validate();
    if(!workspace.sessionIds.includes(id)) {
      await workspace.attachSession(id);
      validate();
    }
    if(!wasAttached && copy.archived && !registry.archivedSessionIds.includes(id)) {
      await registry.archiveSession(id);
      validate();
    }
  }
  async restore(caller?: () => void): Promise<void> {
    const scope = this.host.workspace.homeScope?.();
    const validate = () => {
      caller?.();
      if (this.closed || !sameHomeBinding(this.host.workspace.homeScope?.(), scope))
        reject('STALE_BINDING', 'Native transcript binding changed');
    };
    return this.enqueue(async () => {
      validate();
      const {target,workspace,registry}=this.target();
      const binding=target.id+'\n'+target.path;
      if (this.restored?.key === binding && sameHomeBinding(scope, this.restored.scope)) return;
      const directory=this.directory(target.path);
      const config=this.host.workspace.runtime.config;
      this.write(join(directory,'identity.json'),{schema:1,companionId:config.companionId,scopeId:config.scopeId,ownerActorId:config.ownerActorId,storageId:this.host.workspace.storageId()});
      for(const name of readdirSync(directory).filter(name=>/^[a-f0-9]{64}\.json$/.test(name))) {
        const copy=this.read(join(directory,name)),id=copy.header.id;
        if(name!==key(id)) throw Error('Portable session filename mismatch');
        if(copy.channel)continue;
        await this.restoreCopy(copy,workspace,target.path,registry,validate);
        validate();
      }
      this.restored = {key: binding, scope};
      // Also refresh copies when this device already owns a longer native log
      // (for example, recovery after an abrupt previous shutdown).
      for(const id of workspace.sessionIds) this.schedule(id);
    });
  }
  private exportScope(sessionId:string):ExportScope|undefined {
    const {target,workspace:ownerWorkspace,registry}=this.target(true);
    const channel=ownerWorkspace.sessionIds.includes(sessionId)?undefined:this.channelScope(sessionId,registry,target.path,true);
    const workspace=channel?.workspace ?? ownerWorkspace;
    if(!workspace.sessionIds.includes(sessionId))return;
    const stat=lstatSync(target.path);
    if(!stat.isDirectory() || stat.isSymbolicLink())throw Error('Native transcript workspace root changed');
    const managed=lstatSync(join(target.path,'.chatpet'));
    if(!managed.isDirectory() || managed.isSymbolicLink())throw Error('Native transcript managed directory changed');
    return {sessionId,root:target.path,workspaceId:target.id,storageId:this.host.workspace.storageId(),cwd:channel?.scope.directory??target.path,
      dev:stat.dev,ino:stat.ino,managedDev:managed.dev,managedIno:managed.ino,archived:registry.archivedSessionIds.includes(sessionId),
      ...(channel?{channel:{directory:channel.scope.relativeDirectory,prefix:channel.scope.prefix}}:{})};
  }
  private validateScope(scope:ExportScope) {
    const stat=lstatSync(scope.root);
    if(!stat.isDirectory() || stat.isSymbolicLink() || stat.dev!==scope.dev || stat.ino!==scope.ino)throw Error('Native transcript workspace root changed or was replaced');
    const managed=lstatSync(join(scope.root,'.chatpet'));
    if(!managed.isDirectory() || managed.isSymbolicLink() || managed.dev!==scope.managedDev || managed.ino!==scope.managedIno)throw Error('Native transcript managed directory changed or was replaced');
    // The originating binding is the authority. A later binding cannot redirect
    // this export, including during service disposal. Retained identity still
    // has to match before writing to the original Repo.
    const directory=this.directory(scope.root),identity=join(directory,'identity.json');
    if(existsSync(identity)) {
      const file=lstatSync(identity);
      if(!file.isFile() || file.isSymbolicLink() || file.nlink!==1)throw Error('Portable transcript identity changed');
      const value=JSON.parse(readFileSync(identity,'utf8')),config=this.host.workspace.runtime.config;
      if(value.companionId!==config.companionId || value.scopeId!==config.scopeId || value.storageId!==scope.storageId)throw Error('Portable transcript identity changed');
    }
    return directory;
  }
  private async exportCaptured(scope:ExportScope) {
    const {sessionId,cwd,root,workspaceId,storageId}=scope;
    const requireWritable = () => {
      if (!this.host.workspace.retainedWritesAllowed(workspaceId,root,storageId)) throw Error('Originating workspace cannot accept portable transcript writes');
    };
    requireWritable();
    this.validateScope(scope);
    const native=this.native(),live=native.sessions.get(sessionId);
    if(live && await native.sessions.flush(live)===false) throw Error('Native conversation did not flush');
    const reader=await native.sessionPersistence.open(sessionId,'read');
    try {
      if(reader.header.parentSession)return; // Native child sessions are intentionally not portable owner logs.
      if(reader.header.cwd!==cwd || scope.channel && reader.header.agentPreset!=='chatpet-channel-guest')throw Error('Native transcript session scope changed');
      const events=(await reader.read()).events;
      requireWritable();
      const file=join(this.validateScope(scope),key(sessionId));
      if(existsSync(file)) {
        const previous=this.read(file);
        if(previous.storageId!==scope.storageId)throw Error('Portable transcript storage identity changed');
        if(previous.events.length>events.length || !equal(previous.events,events.slice(0,previous.events.length))) throw Error('Refusing to shorten or rewrite the retained native transcript');
      }
      const config=this.host.workspace.runtime.config;
      this.write(file,{schema:1,companionId:config.companionId,scopeId:config.scopeId,storageId:scope.storageId,header:reader.header,
        inheritedEventCount:reader.inheritedEventCount ?? 0,archived:scope.archived,events,
        ...(scope.channel?{channel:scope.channel}:{})} satisfies Copy);
    } finally {await reader.close();}
  }
  async save(sessionId: string): Promise<void> {
    const scope=this.exportScope(sessionId);if(scope)await this.enqueue(()=>this.exportCaptured(scope));
  }
  schedule(sessionId: string) {
    if(this.closed)return;
    const scope=this.exportScope(sessionId);if(!scope)return;
    const id=scope.root+'\n'+scope.workspaceId+'\n'+sessionId,previous=this.pending.get(id);
    this.pending.set(id,{scope,attempts:previous?.attempts??0,retryAt:previous?.retryAt??Date.now()+100});
    this.arm();
  }
  private arm() {
    clearTimeout(this.timer);this.timer=undefined;
    const due=[...this.pending.values()].filter(entry=>entry.attempts<3).map(entry=>entry.retryAt);
    if(this.closed || !due.length || this.flushing)return;
    this.timer=setTimeout(()=>{this.timer=undefined;void this.flush(false).catch(error=>this.ctx.logger('chatpet-transcripts').warn('Portable transcript pending; native originals retained',error));},Math.max(0,Math.min(...due)-Date.now()));
    this.timer.unref();
  }
  async flush(force=true):Promise<void> {
    if(this.flushing) {
      const active=this.flushing;
      try {await active;}catch{/* Each failed entry remains pending for this explicit barrier. */}
      return this.flush(force);
    }
    clearTimeout(this.timer);this.timer=undefined;
    const run=async()=>{
      const errors:unknown[]=[];
      for(const [id,entry] of [...this.pending]) {
        if(!force && (entry.attempts>=3 || entry.retryAt>Date.now()))continue;
        try {
          await this.enqueue(()=>this.exportCaptured(entry.scope));
          if(this.pending.get(id)===entry)this.pending.delete(id);
        } catch(error) {
          const current=this.pending.get(id);
          if(current){current.attempts++;current.retryAt=Date.now()+(current.attempts===1?1000:5000);}
          errors.push(error);
        }
      }
      await this.tail;
      if(errors.length)throw new AggregateError(errors,'Portable transcript exports remain pending');
    };
    this.flushing=run();
    try {await this.flushing;}finally{this.flushing=undefined;this.arm();}
  }
  async close() {this.closed=true;clearTimeout(this.timer);this.timer=undefined;await this.flush();}
}

declare module '@deepseek-ai/cordis' {interface Context {petTranscripts:NativeTranscripts}}
export function installNativeTranscripts(ctx: Context,host: PetCoreHost): NativeTranscripts {
  const logs=new NativeTranscripts(ctx,host);ctx.provide('petTranscripts',logs);
  ctx.on('session/event',(session)=>{
    if(host.workspace.status().state==='ready')logs.capture(session);
  },{global:true});
  ctx.on('pet/core.changed',operation=>{if((operation==='workspace.initialize' || operation==='preferences.save') && host.workspace.status().state==='ready') void logs.restore().catch(error=>ctx.logger('chatpet-transcripts').warn('Native log restore pending',error));});
  (ctx as unknown as {on(name:'domain/changed',handler:(change:{domain:string})=>void):unknown}).on('domain/changed',change=>{
    if(change.domain!=='workspace') return;
    const status=host.workspace.status(),registry=(ctx as unknown as Native).get('workspaceRegistry') as Registry | undefined;
    const workspace=status.target && registry?.get(status.target.id);
    if(status.state==='ready' && workspace && workspace.path===status.target?.path) for(const id of workspace.sessionIds) logs.schedule(id);
  });
  ctx.effect(()=>()=>logs.close());
  return logs;
}
