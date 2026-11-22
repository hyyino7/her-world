import type { Context } from '@deepseek-ai/cordis';
import {randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, mkdtempSync, renameSync, rmSync} from 'node:fs';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, relative, sep} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {isDeepStrictEqual} from 'node:util';
import type {NativeSession} from '../conversation.js';
import type {} from '../plugin.js';
import {desktopHomePlayback,activityPresentation,eatingClips,physicalClips,sleepingClips,projectActivityConfig} from './activity.js';
import {migratePresentation,resolvePresentationMigration,type PresentationMigrationReceipt} from './migration.js';
import { companionFeelings } from '../../living/body/presentation.js';
import type { PlaybackReceipt } from '../../emotion/index.js';
import type { CompanionFactActor } from '../../contracts/interaction.js';
import type { CareAction } from '../../contracts/behavior.js';
import { sameHomeBinding, withLivingCaller } from '../../living/index.js';

const load = createRequire(import.meta.url);
const root = dirname(load.resolve('her-world/package.json'));
const vendor = join(root, 'vendor', 'dsh-pet', 'platform');
const assets = join(root,'src','desktop','assets');
const catalog = JSON.parse(readFileSync(join(assets,'catalog.json'),'utf8')) as {actions: Asset[]; stickers: Asset[]};
interface Asset {id:string; label:string; file:string;description?:string;group?:string}
const expressionCatalog = {
  actions: catalog.actions.filter(asset=>!physicalClips.has(asset.label) && (asset.group==='expression' || ['点击回应-傲娇生气','悠闲哼歌','开心小跑'].includes(asset.id)))
    .map(asset=>({name:asset.id,label:asset.label,description:asset.description || asset.label})),
  stickers:catalog.stickers.map(asset=>({name:asset.id,label:asset.label,description:asset.description || asset.label})),
  supportedFeelings:[...companionFeelings],
};
const route = '/chatpet-presentation';
const json = (obj: unknown, status = 200) => ({kind:'json', obj, status});
const controls = new Set(['anim','position','throw','pose','lock','lock/release','broadcast','bubble/clear','menu/item','pose/report','menu/click','menu/events']);
/** Playback reports are renderer-owned; a control token may only query/wait. */
export function controlRouteAllowed(rest:string, method:string) {
  return controls.has(rest) || method==='GET' && /^playback\/[^/]+$/.test(rest);
}
const upstream = load(join(vendor,'runtime.mjs'));
type Clean = () => void;
declare module '@deepseek-ai/cordis' { interface Context {petPlatform: PetPlatform} }
export const name = '35-PetPlatform';
export const inject = ['petCore','petDesktop','webServer','connection'];

function inside(dir: string, file: string) {
  const path = relative(realpathSync(dir),realpathSync(file));
  return path !== '..' && !path.startsWith('..'+sep) && !path.startsWith(sep);
}

function dataFolder(bound: string) {
  let directory = realpathSync(bound);
  for (const part of ['.chatpet','data','pet-platform']) {
    directory = join(directory,part);
    if (!existsSync(directory)) mkdirSync(directory,{mode:0o700});
    if (!lstatSync(directory).isDirectory()) throw Error('桌宠平台资料目录无效');
  }
  return directory;
}

function safeConfig(directory: string) {
  for (const file of ['main-config.jsonc','main-config.json','logs.txt']) {
    const path = join(directory,file);
    try { if (!lstatSync(path).isFile()) throw Error('桌宠配置文件无效'); }
    catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const packs = join(directory,'pet');
  if (!existsSync(packs)) mkdirSync(packs,{mode:0o700});
  if (!lstatSync(packs).isDirectory() || readdirSync(packs,{withFileTypes:true}).some(item=>item.isSymbolicLink())) throw Error('桌宠素材包路径无效');
}

function matches(value: string, token: string) {
  const a = Buffer.from(value), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a,b);
}

export class PetPlatform {
  private bound?: {id:string; path:string};
  private directory = '';
  private ownerToken = '';
  private toolToken = '';
  private mediaToken = '';
  private scope = new AbortController();
  private cleanup: Clean[] = [];
  private setup: any;
  private lookup: any;
  private router?: (url:string, method:string, body?:string, signal?:AbortSignal)=>Promise<any>;
  private providers: any;
  private privateDirectory?: string;
  private behavior: any;
  private behaviorKey = '';
  private animationFeedbackKey = '';
  private identityKey = '';
  private expressionAction?: string;
  private refreshing?:Promise<void>;
  private refreshAgain=false;
  private behaviorRead?: {bound:{id:string;path:string};scope:AbortController;observation?:{bootId:string;revision:number}};
  private playbackKinds=new Map<string,PlaybackReceipt['kind']>();
  private playbackReported=new Map<string,string>();
  private migration?:PresentationMigrationReceipt;
  private restartPresentation?:()=>void;
  private presentationStatus?:()=>{running:boolean;starting:boolean};

  constructor(private ctx: Context) {}
  private selected() {
    const state = this.ctx.petCore.workspace.status();
    return state.state === 'ready' ? state.target : undefined;
  }
  close() {
    this.scope.abort();
    this.behaviorRead=undefined;this.refreshing=undefined;this.refreshAgain=false;
    if (this.privateDirectory) { rmSync(this.privateDirectory,{recursive:true,force:true}); this.privateDirectory=undefined; }
    for (const dispose of this.cleanup.splice(0).reverse()) dispose();
    this.setup?.playback.cancelAll();
    this.setup?.state.cancelAll();
    this.bound=undefined; this.router=undefined; this.lookup=undefined; this.setup=undefined;
    this.behavior=undefined;this.behaviorKey='';this.animationFeedbackKey='';this.identityKey='';this.expressionAction=undefined;
    this.playbackKinds.clear();this.playbackReported.clear();
    this.migration=undefined;this.restartPresentation=undefined;this.presentationStatus=undefined;
    this.ownerToken=''; this.toolToken=''; this.mediaToken=''; this.providers=undefined;
  }
  sync() {
    const target=this.selected();
    if (this.bound && (target?.id!==this.bound.id || target?.path!==this.bound.path)) this.close();
  }
  private ensure() {
    this.sync();
    const target=this.selected();
    if (!target) throw Error('请先绑定并初始化工作区');
    if (this.bound) return;
    this.directory=dataFolder(target.path);
    safeConfig(this.directory);
    const config=join(this.directory,'main-config.jsonc');
    if (!existsSync(config) && !existsSync(join(this.directory,'main-config.json'))) {
      writeFileSync(config,JSON.stringify({pets:[]},null,2),{mode:0o600,flag:'wx'});
    }
    this.migration=migratePresentation(this.directory,this.ctx.petCore.workspace.companionSettings());
    this.scope=new AbortController();
    this.bound={id:target.id,path:target.path};
    this.ownerToken=randomBytes(32).toString('hex'); this.toolToken=randomBytes(32).toString('hex'); this.mediaToken=randomBytes(32).toString('hex');
    const scope = this.scope;
    try {
      const ctx = this.ctx;
      const {logger,connection,webServer} = ctx as Context & {connection:unknown;webServer:unknown};
      const bridge = {
        logger, connection, webServer,
        get: (name: 'standaloneAi' | 'attachments' | 'shutdownApp') => {
          // 上游 setup 和路由只经 optionalService 读取这三项。
          switch (name) {
            case 'standaloneAi': return ctx.get('standaloneAi',false);
            case 'attachments': return ctx.get('attachments',false);
            case 'shutdownApp': return ctx.get('shutdownApp',false);
          }
        },
        provide: (_n:string,value:any)=>{this.providers=value;},
        effect: (setup:()=>Clean|void)=>{ const stop=setup(); if(stop)this.cleanup.push(stop); },
        on: (event:'session/event'|'agent/error', receive:(session:any, data:any)=>void) => {
          const forward = (item:any,data?:any) => {
            const session=item?.session ?? item;
            if (!scope.signal.aborted && session?.header?.cwd===target.path &&
              ctx.petCore.workspace.sessionStatus(session,ctx.get('workspaceRegistry',false))?.target?.id===target.id) receive(item,data);
          };
          if(event==='session/event')return ctx.on('session/event',forward,{global:true});
          return ctx.on('agent/error',forward,{global:true});
        },
      };
      const setup=this.setup=upstream.createHostSetup(bridge,this.directory);
      const lookup=this.lookup=upstream.createPetLookup(setup);
      const work=upstream.createWorkStatusBridge(setup);
      // Native Desktop owns the configured delay. Keep upstream reduction and
      // notifications, but do not publish a second immediate renderer state.
      const watchedWork={...work,publishWorkStatus:()=>{
        if(setup.workStatus.snapshot().state===null)
          setup.state.writeSection('workStatus',{state:null,task:null,sessionId:null});
      }};
      const notify=upstream.createSessionNotify({...setup,...watchedWork,ctx:bridge});
      upstream.registerSessionWatch({...setup,...watchedWork,...notify,ctx:bridge});
      this.cleanup.push(()=> {
        lookup.lock.releaseAll(); work.stopWorkStatusFlush();
        for(const timers of [notify.terminalTimers,notify.notifyActivityTimers]) for(const timer of timers.values())clearTimeout(timer);
      });
      if (this.ctx.petDesktop.onPresentation) this.cleanup.push(this.ctx.petDesktop.onPresentation((type,value)=>{
        if (scope.signal.aborted || this.selected()?.id!==target.id) return;
        setup.state.writeSection('nativeBody/'+type,value);
        if(type==='work') {
          const work=value as {stage:string;session:string}|null;
          setup.state.writeSection('workStatus',{state:work?.stage ?? null,task:null,sessionId:work?.session ?? null});
          return;
        }
        const frame = value as {text?:string;sticker?:string;whisper?:boolean;dream?:boolean;sleeping?:boolean;pending?:boolean};
        if(type==='balance') { setup.state.writeSection('balance',value); return; }
        if(type==='expression') { this.presentExpression(value); return; }
        if(type!=='say' && type!=='sleep')return;
        const cfg = upstream.readAllConfig(setup.configPaths);
        for(const entry of Object.values(cfg) as any[]) for(const pet of entry.pets ?? []) {
          if(type==='sleep') {
            if(this.behavior?.her)continue;
            if(frame.sleeping) {
              const names=upstream.pickSleepNames(entry.animations);
              if(names)lookup.sleep.enter(pet.id,names);
            } else lookup.sleep.wake(pet.id);
          } else if(type==='say' && frame.text) {
            const image=catalog.stickers.find(sticker=>sticker.id===frame.sticker || sticker.label===frame.sticker)?.label;
            setup.state.writePet(pet.id,'say',{text:frame.text,image,duration:this.ctx.petCore.workspace.companionSettings().desktopBubbleSeconds*1000,anim:!this.behavior?.her && frame.whisper === true && !frame.dream});
          }
        }
      },()=>!scope.signal.aborted && this.selected()?.id===target.id && setup.state.waiterCount()>0));
      this.ctx.petDesktop.features?.restore(true);
      const desktops=upstream.createDesktopHelper({
        ...setup, ctx:bridge, effectivePetList:()=>upstream.flattenPetList(upstream.readAllConfig(setup.configPaths)),
        reportDownload:()=>{},
        getHandlePetRoute:()=> async (raw:string,method:string,body?:string,signal?:AbortSignal)=>{
          const url=new URL(raw,'http://localhost');
          if(url.pathname.startsWith('/dsh-pet-7340/'))url.pathname=route+url.pathname.slice('/dsh-pet-7340'.length);
          if(url.pathname===route+'/config' && method==='GET')url.pathname=route+'/config-live';
          if(scope.signal.aborted)return json({ok:false},409);
          return this.handle(url,method,body,signal ?? scope.signal);
        },
      });
      this.restartPresentation=desktops.requestRestart;
      this.presentationStatus=desktops.status;
      this.cleanup.push(()=>{desktops.markDisposed();desktops.stopHelper('dsh-host-stop');});
      this.router=upstream.createHttpRoute({...setup,...lookup,...work,...notify,ctx:bridge,
        assetRootFor:(ext:string)=>join(vendor,'assets',ext==='.mov'?'mov':'webm'),
        userRootFor:(ext:string)=>join(this.directory,'main-animation',ext==='.mov'?'mov':'webm'),
        requestRestart:desktops.requestRestart, canQuit:()=>false,
        publishWhisper:async(petId:string, image?:string)=>{
          const result=await this.ctx.petDesktop.features?.whisper(image);
          if(!result?.ok)throw Error(result?.message || '碎碎念暂不可用');
          return result;
        },
        refreshBalance:async()=>this.ctx.petDesktop.features?.balance(),
      }).handlePetRoute;
      setup.menuRegistry.register({owner:'chatpet.room',labels:['进入房间'],target:'both'});
      setup.menuRegistry.register({owner:'chatpet.native-chat',labels:['原生流式聊天'],target:'both'});
      setup.state.writeSection('menu',{items:setup.menuRegistry.snapshot()});
      this.cleanup.push(this.ctx.on('pet/behavior.changed',event=>{
        if(event.workspaceId!==target.id || scope.signal.aborted)return;
        const reading=this.behaviorRead;
        if(event.reason==='observation' && reading?.scope===scope && reading.bound===this.bound &&
          typeof event.bootId==='string' && event.bootId && Number.isSafeInteger(event.revision) && event.revision>=0) {
          const previous=reading.observation;
          if(previous && previous.bootId!==event.bootId)this.refreshAgain=true;
          if(!previous || previous.bootId!==event.bootId || event.revision>previous.revision)
            reading.observation={bootId:event.bootId,revision:event.revision};
          return;
        }
        void this.refreshBehavior();
      }));
      if(typeof this.ctx.inject==='function') {
        const fiber=this.ctx.inject(['petBehavior'],child=>{
          void this.refreshBehavior();
          child.effect(()=>()=>{void this.refreshBehavior();});
        });
        this.cleanup.push(()=>{void fiber.dispose();});
      }
      void this.refreshBehavior();
      desktops.startHelper();
    } catch (error) { this.close(); throw error; }
  }
  private pets(): any[] {
    const name=this.ctx.petCore.workspace.runtime.identity().displayName;
    return Object.values(upstream.readAllConfig(this.setup.configPaths)).flatMap((cfg:any)=>(cfg.pets ?? []).map((pet:any)=>({...pet,name})));
  }
  bodyStatus() {
    this.sync();
    if(!this.bound || !this.setup)return {running:false};
    const pets=this.pets(),requested=pets.some(p=>p.display!=='none');
    const running=pets.some(p=>['desktop','both'].includes(p.display)) && Boolean(this.presentationStatus?.().running) ||
      pets.some(p=>['web','both'].includes(p.display)) && this.setup.state.waiterCount()>0;
    return {running,requested,starting:requested && !running};
  }
  featurePreferences() {
    this.sync();
    if(!this.setup)return {};
    const config=upstream.readAllConfig(this.setup.configPaths).main;
    const pets=this.pets(), timing=config.eventsRefreshSec;
    return {desktopWhisperEnabled:pets.some(p=>p.whisperEnabled),desktopBalanceEnabled:pets.some(p=>p.balanceEnabled),
      desktopWhisperImageEnabled:config.whisperImageEnabled!==false,
      desktopWhisperMinutes:timing.whisper/60,desktopSleepTalkSeconds:timing.sleepTalk,desktopBalanceMinutes:timing.balance/60};
  }
  async savePreference(key:string,value:boolean) {
    this.ensure();
    const top:Record<string,string>={desktopClickSound:'clickSoundEnabled',desktopConfineToScreen:'confineToScreen'};
    const body:Record<string,string>={desktopFixed:'fixedEnabled',desktopWhisperEnabled:'whisperEnabled',desktopBalanceEnabled:'balanceEnabled'};
    if(!top[key] && !body[key])throw Error('无效桌宠设置');
    const config=upstream.readAllConfig(this.setup.configPaths).main, id=this.migration?.bodyId ?? config.pets[0]?.id;
    const result=await this.handle(new URL(route+'/config','http://localhost'),'PUT',JSON.stringify({
      pets:config.pets.map((pet:any)=>pet.id===id && body[key] ? {...pet,[body[key]]:value} : pet),...(top[key] ? {[top[key]]:value} : {})}),this.scope.signal);
    if(result.status>=400 || result.obj?.ok===false)throw Error(result.obj?.message || '设置保存失败');
    return {...this.ctx.petCore.workspace.companionSettings(),...this.featurePreferences(),[key]:value};
  }
  async saveTiming(workspaceId:string,expected:unknown,next:unknown) {
    this.ownerAccess(workspaceId);
    const config=upstream.readAllConfig(this.setup.configPaths).main;
    if(!isDeepStrictEqual(config.eventsRefreshSec,expected))throw Error('设置已改变，请刷新后重试');
    if(!upstream.topFieldValid('eventsRefreshSec',next))throw Error('时间间隔无效');
    // 0.4.7 reads this section but its form-save whitelist does not write it.
    // Preserve every other JSONC field through the original parser and an atomic scoped write.
    this.migration=migratePresentation(this.directory,this.ctx.petCore.workspace.companionSettings());
    const file=this.setup.configPaths.userFile, before=readFileSync(file,'utf8'), raw=upstream.readJsonc(file);
    if(!raw || typeof raw!=='object' || Array.isArray(raw))throw Error('外观配置无法解析，已保留原文件');
    const draft=join(this.directory,randomUUID()+'.tmp');
    try {
      writeFileSync(draft,JSON.stringify({...raw,eventsRefreshSec:next},null,2)+'\n',{mode:0o600,flag:'wx'});
      if(readFileSync(file,'utf8')!==before)throw Error('设置已改变，请刷新后重试');
      renameSync(draft,file);
    }finally{rmSync(draft,{force:true});}
    this.migration=migratePresentation(this.directory,this.ctx.petCore.workspace.companionSettings());
    this.setup.state.writeSection('config',{});this.restartPresentation?.();
    await this.ctx.petDesktop.features?.refresh();
    return this.status();
  }
  resolveMigration(workspaceId:string,field:string,choice:'legacy'|'current',expectedConfigHash:string) {
    this.ownerAccess(workspaceId);
    if(!/^[a-f0-9]{64}$/.test(expectedConfigHash))throw Error('请刷新后再选择配置');
    this.migration=resolvePresentationMigration(this.directory,[{field,choice}],undefined,expectedConfigHash);
    this.setup.state.writeSection('config',{});this.restartPresentation?.();
    void this.ctx.petDesktop.features?.refresh();
    return this.status();
  }
  async show() {
    this.ensure();
    if(this.pets().some(p=>p.display==='desktop' || p.display==='both')) {await this.ctx.petDesktop.features?.refresh();return this.status();}
    const pet=this.pets().find(p=>p.id==='main') ?? this.pets()[0];
    if(!pet)throw Error('请先配置一个桌宠形象');
    const result=await this.handle(new URL(route+'/pet-display','http://localhost'),'POST',JSON.stringify({id:pet.id,display:'desktop'}),this.scope.signal);
    if(result.status>=400 || result.obj?.ok===false)throw Error(result.obj?.message || '桌宠暂时无法显示');
    return this.status();
  }
  async hide() {
    if(!this.bound)return;
    for(const pet of this.pets().filter(p=>p.display!=='none')) {
      await this.handle(new URL(route+'/pet-display','http://localhost'),'POST',JSON.stringify({id:pet.id,display:'none'}),this.scope.signal);
    }
    await this.ctx.petDesktop.features?.refresh();
  }
  private presentExpression(event:any) {
    if(!this.bound || event.workspaceId!==this.bound.id)return;
    this.expressionAction=event.action;
    const busy=Boolean(this.behavior?.her);
    const action=catalog.actions.find(asset=>asset.id===event.action && !physicalClips.has(asset.label));
      this.expressionAction=action?.label;
    const sticker=catalog.stickers.find(asset=>asset.id===event.sticker);
    for(const pet of this.pets()) {
      const own=upstream.readAllConfig(this.setup.configPaths).main.pets.some((p:any)=>p.id===pet.id);
      if(action && !busy && own)this.setup.state.writePet(pet.id,'anim',{name:action.label,playbackId:this.playback(pet.id,action.label,'expression')});
      if(sticker && event.sessionId===this.ctx.petDesktop.chat.id) {
        const text=this.ctx.petDesktop.chat.snapshot().messages.filter(m=>m.role==='assistant' && m.turn===event.turn).at(-1)?.text;
        if(text)this.setup.state.writePet(pet.id,'say',{text,image:sticker.label,anim:false});
      }
    }
    this.setup.state.writeSection('config',{});
  }
  private async refreshBehavior():Promise<void> {
    if(this.scope.signal.aborted)return;
    if(this.refreshing){this.refreshAgain=true;return this.refreshing;}
    const scope=this.scope;
    // Install the existing in-flight promise before entering a service which
    // may publish synchronously. A retired scope cannot clear its replacement.
    const refresh=Promise.resolve().then(async()=>{
      do {
        if(scope.signal.aborted || this.scope!==scope)return;
        this.refreshAgain=false;await this.readBehavior();
      }while(this.refreshAgain && !scope.signal.aborted && this.scope===scope);
    }).finally(()=>{
      if(this.refreshing!==refresh)return;
      this.refreshing=undefined;
      // A domain event may arrive after the loop decides to exit but before
      // this cleanup. Keep that request on the same caller's await chain.
      if(this.refreshAgain && !scope.signal.aborted && this.scope===scope)return this.refreshBehavior();
    });
    this.refreshing=refresh;return refresh;
  }
  private async readBehavior() {
    if(!this.bound || this.scope.signal.aborted)return;
    const bound=this.bound,scope=this.scope;
    const reading:NonNullable<PetPlatform['behaviorRead']>={bound,scope};
    this.behaviorRead=reading;
    let next:any;
    try {
      const service=(this.ctx as any).get('petBehavior',false);
      next=service ? desktopHomePlayback(await service.roomState(bound.id)) : undefined;
      if(this.bound!==bound || scope.signal.aborted)return;
      const prior=this.behavior;
      this.behavior=next;
      const emotion=(this.ctx as any).get('petEmotion',false);
      const key=JSON.stringify([next?.her,next?.behavior,next?.emotion?.label,next?.emotion?.updatedAt,next?.emotion?.feelings,next?.presentation,Boolean(emotion)]);
      if(key===this.behaviorKey)return;
      this.expressionAction=catalog.actions.find(asset=>asset.id===next?.presentation?.expression?.action)?.label;
      this.behaviorKey=key;
      this.setup.state.writeSection('nativeBody/behavior',next ?? null);
      const feedback=activityPresentation(next).playback?.feedback;
      const now=Date.now();
      const feedbackActive=Boolean(feedback && feedback.at<=now && feedback.until>now);
      if(feedbackActive && feedback) {
        const feedbackKey=JSON.stringify([next?.behavior?.bootId,feedback.id]);
        if(feedbackKey!==this.animationFeedbackKey) {
          this.animationFeedbackKey=feedbackKey;
          for(const pet of this.pets()) {
            const own=upstream.readAllConfig(this.setup.configPaths).main.pets.some((p:any)=>p.id===pet.id);
            if(!own)continue;
            const sticker=catalog.stickers.find(row=>row.label===feedback.sticker);
            this.setup.state.writePet(pet.id,'say',{text:feedback.text ?? '',...(sticker?{image:sticker.label}:{}),duration:feedback.until-now,expiresAt:feedback.until,anim:false});
          }
        }
      }

      // Progress observations update the projection without restarting the
      // current clip. Only an actual operation/phase/activity transition does.
      const transition=(value:any)=>activityPresentation(value).playback?.key;
      if(transition(prior)===transition(next) && JSON.stringify(activityPresentation(prior).playback?.feedback)===JSON.stringify(feedback))return;
      // The original players consume the shared descriptor via config-live.
      // A second sleep/anim request would start a separate renderer timeline.
      this.setup.state.writeSection('config',{});
      for(const pet of this.pets()) {
        const own=upstream.readAllConfig(this.setup.configPaths).main.pets.some((p:any)=>p.id===pet.id);
        const notice=!own && next?.her ? `${next.her.activity} · 自定义形象缺少对应活动动画` : activityPresentation(next).notice;
        if(notice && !(own && feedbackActive))this.setup.state.writePet(pet.id,'say',{text:notice,anim:false});
      }
    }catch(error){this.ctx.logger(name).warn('Body presentation refresh pending',error);}
    finally {
      if(this.behaviorRead===reading) {
        this.behaviorRead=undefined;
        const observed=reading.observation,received=next?.behavior;
        // A Body snapshot publishes its observation before resolving this very
        // read. Only an observation not covered by that result needs another
        // pass; external transitions and explicit refreshes retain their flag.
        if(observed && this.bound===bound && !scope.signal.aborted &&
          !(received?.bootId===observed.bootId && Number.isSafeInteger(received.revision) && received.revision>=observed.revision))
          this.refreshAgain=true;
      }
    }
  }
  private activityAsset(): string | undefined {
    return activityPresentation(this.behavior,this.expressionAction).action;
  }
  private playback(petId:string,name:string,kind:PlaybackReceipt['kind']) {
    const record=this.setup.playback.create(petId,name);
    this.playbackKinds.set(record.playbackId,kind);
    if(this.playbackKinds.size>512) {
      const oldest=this.playbackKinds.keys().next().value!;
      this.playbackKinds.delete(oldest);this.playbackReported.delete(oldest);
    }
    return record.playbackId;
  }
  private reportPlayback(playbackId:string) {
    const record=this.setup.playback.get(playbackId);
    if(!record || record.status==='accepted' || this.playbackReported.get(playbackId)===record.status)return;
    this.playbackReported.set(playbackId,record.status);
    const asset=catalog.actions.find(asset=>asset.label===record.name || asset.id===record.name);
    if(!asset)return;
    const kind=this.playbackKinds.get(playbackId) ?? (asset.group==='expression'?'expression':'idle');
    this.ctx.petDesktop.recordPlayback({id:playbackId,name:asset.id,status:record.status,kind,workspaceId:this.bound!.id});
    // Host records expire after a minute; bound this observational cache too.
    if(this.playbackReported.size>512) {
      const oldest=this.playbackReported.keys().next().value!;
      this.playbackReported.delete(oldest);this.playbackKinds.delete(oldest);
    }
  }
  private projectConfig(config:any) {
    return this.projectIdentity(projectActivityConfig(config,this.behavior,this.expressionAction));
  }
  private projectIdentity(config:any) {
    const projected=structuredClone(config), identity=this.ctx.petCore.workspace.runtime.identity();
    for(const entry of Object.values(projected) as any[]) {
      if(!entry || !Array.isArray(entry.pets))continue;
      entry.whisperPrompt=identity.character;
      for(const pet of entry.pets) {
        pet.name=identity.displayName || '伙伴';
        pet.whisperPrompt=identity.character;
      }
    }
    if(projected.main) {
      const template=upstream.readJsonc(this.setup.configPaths.defaultFile)?.pets?.[0];
      if(template)projected.main.bodyTemplate={...template,name:identity.displayName || '伙伴',
        whisperPrompt:identity.character,display:'none',whisperEnabled:false,balanceEnabled:false,workStatusEnabled:false};
    }
    return projected;
  }
  identityChanged() {
    this.sync();
    if(!this.setup)return;
    const identity=this.ctx.petCore.workspace.runtime.identity(), key=JSON.stringify([identity.displayName,identity.character]);
    if(key===this.identityKey)return;
    this.identityKey=key;this.setup.state.writeSection('config',{});
  }
  ownerAccess(expected?:string) {
    this.ensure();
    if(expected && expected!==this.bound!.id)throw Error('已切换工作区');
    return {path:route,token:this.ownerToken,mediaToken:this.mediaToken};
  }
  private baseUrl() {
    const origin=new URL((this.ctx as any).webServer.getOrigin());
    if (!['http:','https:'].includes(origin.protocol)) throw Error('桌宠宿主地址不可用');
    return new URL(route,origin).href;
  }
  standaloneAccess(expected?:string) {
    const {token}=this.ownerAccess(expected);
    const baseUrl=this.baseUrl();
    this.privateDirectory ??= mkdtempSync(join(tmpdir(),'chatpet-standalone-'));
    const file=join(this.privateDirectory,'standalone.json');
    const draft=join(this.privateDirectory,randomUUID()+'.tmp');
    try {
      writeFileSync(draft,JSON.stringify({baseUrl,token}),{mode:0o600,flag:'wx'});
      renameSync(draft,file);
    } finally { rmSync(draft,{force:true}); }
    return {file};
  }
  controlAccess(expected:string) {
    this.ownerAccess(expected);
    return {baseUrl:this.baseUrl(),path:route,token:this.toolToken};
  }
  status() {
    this.sync();
    if(!this.setup)return {path:route,pets:[],running:false};
    const main=upstream.readAllConfig(this.setup.configPaths).main;
    return {path:route,pets:this.pets().map(({id,name,display,position,assetRoot})=>({id,name,display,position,assetRoot})),
      running:this.bodyStatus().running,timing:main.eventsRefreshSec,
      migration:this.migration,
      activity:this.behavior?.behavior,representation:{...activityPresentation(this.behavior,this.expressionAction),
        packGaps:this.behavior?.her ? this.pets().filter(p=>!main.pets.some((own:any)=>own.id===p.id)).map(p=>p.id) : []},packsDirectory:join(this.directory,'pet')};
  }
  private async nativeChat(pet: string, method: string, raw: string|undefined, signal:AbortSignal) {
    const who=this.lookup.requirePet(new URLSearchParams({pet}),()=>upstream.readAllConfig(this.setup.configPaths));
    if(!who.ok)return who.res;
    const chat=this.ctx.petDesktop.chat;
    const current=await chat.run('open',{});
    signal.throwIfAborted();
    if (!current.sessionId) return json({ok:false,message:'原生会话暂不可用'});
    if (method==='GET') return json({ok:true,messages:current.messages.map(m=>({role:m.role,content:m.text,ts:m.id})),sessionId:current.sessionId});
    if (method!=='POST') return json({ok:false,message:'在原生会话中管理历史记录'},405);
    const blocked=this.lookup.sleepBlocked(pet,new URLSearchParams());
    if (blocked) return blocked;
    const input=JSON.parse(raw || '{}');
    const image=input.attachment;
    const last=current.messages.at(-1)?.id ?? -1;
    const sent=await chat.run('send',{sessionId:current.sessionId,workspaceId:current.workspaceId,text:input.text,
      ...(image ? {image:{data:image.base64,mediaType:image.mediaType}} : {}),requestId:input.requestId || randomUUID()});
    const binding=this.bound;
    const combined = AbortSignal.any([signal,this.scope.signal,AbortSignal.timeout(5*60_000)]);
    // Admission and retention belong to Core. Wait for the same native turn's final rendered assistant text.
    while (!combined.aborted && this.bound===binding) {
      const result=chat.snapshot();
      if (result.sessionId!==sent.sessionId)break;
      if (!result.generating) {
        const reply=result.messages.filter(m=>m.role==='assistant' && m.id>last).at(-1);
        if (!reply || ('reason' in result && result.reason && result.reason!=='completed')) return json({ok:false,message:'原生会话未完成回复'});
        return json({ok:true,text:reply.text,sessionId:result.sessionId});
      }
      await wait(90,undefined,{signal:combined});
    }
    return json({ok:false,message:'原生会话已关闭'});
  }
  /** Current shared clips and built-in life names use the same bytes as Room.
   * Keep user files/packs intact; other names retain upstream routing. */
  private builtinLifeMedia(rest:string) {
    const parts=rest.split('/');
    if(parts.length===4 && parts[0]==='pic' && parts[1]==='memes' && parts[2]==='main') {
      const feedback=activityPresentation(this.behavior).playback?.feedback;
      const sticker=catalog.stickers.find(row=>row.label===feedback?.sticker && row.label+'.png'===parts[3]);
      if(sticker)return {kind:'file',status:200,file:join(assets,sticker.file),contentType:'image/png'};
    }
    if(parts.length!==3 || parts[0]!=='thumb' || parts[1]!=='main')return;
    const sharedNames=activityPresentation(this.behavior).playback?.segments.map(part=>part.desktopClip) ?? [];
    const asset=catalog.actions.find(row=>(row.group==='life' || sharedNames.includes(row.label)) && row.label+'.webm'===parts[2]);
    if(asset)return {kind:'file',status:200,file:join(assets,asset.file),contentType:'video/webm'};
  }
  private builtinMedia(rest:string) {
    const parts=rest.split('/');
    if (parts.some(x=>x==='.' || x==='..' || x.includes('\\'))) return;
    const file=parts.at(-1) ?? '';
    const resolveAsset=(entries:Asset[], ext:string)=>entries.find(asset=>asset.label+ext===file)?.file;
    if(parts[0]==='thumb' && parts.length===3 && !existsSync(join(this.directory,'pet',parts[1]+'-animation'))) {
      const name=resolveAsset(catalog.actions,'.webm');
      if(name)return {kind:'file',status:200,file:join(assets,name),contentType:'video/webm'};
    }
    if(parts[0]==='pic' && parts[1]==='memes' && parts.length===4 && !existsSync(join(this.directory,'pet',parts[2]+'-memes'))) {
      const name=resolveAsset(catalog.stickers,'.png');
      if(name)return {kind:'file',status:200,file:join(assets,name),contentType:'image/png'};
    }
    if(rest==='font/上首软糖体.ttf') return {kind:'file',status:200,file:join(assets,'fonts','soft-candy.ttf'),contentType:'font/ttf'};
    if(rest==='sound/click-duck.wav')return {kind:'file',status:200,file:join(assets,'sound/click-duck.wav'),contentType:'audio/wav'};
  }
  /** Keep the original sleep/wake and ordinary action lock admission. */
  private careBlocked(action:string,pet:string,params:URLSearchParams) {
    const who=this.lookup.requirePet(new URLSearchParams({pet}),()=>upstream.readAllConfig(this.setup.configPaths));
    if(!who.ok)return who.res;
    // The original sleep route rejects even the holder's matching lock token.
    // Wake remains allowed; ordinary pet care uses the existing token gate.
    if(action==='sleep' && this.lookup.lock.locked(who.petId))return json({ok:false,reason:'locked',message:'这只桌宠正被占用，不能睡觉'});
    if(action==='pet')return this.lookup.lockBlocked(who.petId,params);
  }
  private openRoom() {
    const open=this.ctx.petCore.native.companionPorts.get('openRoomWindow');
    if(!open)throw Error('房间模块未启用');
    return open(this.bound!.id);
  }
  private async feedAnimation(url:URL,raw:string|undefined,caller:AbortSignal,requestId:string,actor:CompanionFactActor,
    presentationBlocked:()=>ReturnType<typeof json>|undefined) {
    const body=this.ctx.get('petBehavior',false);
    if(!body)return presentationBlocked() ?? json({ok:false,reason:'body-unavailable',message:'共享身体暂不可用'},503);
    const bound=this.bound!, workspace=this.ctx.petCore.workspace, binding=workspace.homeScope?.();
    const signal=AbortSignal.any([caller,this.scope.signal]);
    const validate=()=>{
      signal.throwIfAborted();
      if(this.bound!==bound || !sameHomeBinding(workspace.homeScope?.(),binding) || this.ctx.get('petBehavior',false)!==body)
        throw Error('工作区或身体组件已切换');
    };
    const result=await withLivingCaller(validate,()=>body.presentFeed(bound.id,{requestId,actor},presentationBlocked));
    validate();
    if(result.admission==='presentation-blocked')return result.blocked;
    if(result.admission==='blocked')return json({ok:false,reason:'activity-busy',message:'当前活动进行中，请先完成或结束该活动'},409);
    const receipt={requestId,admission:result.admission,...(result.fact?{effect:result.fact.result.status}:{})};
    if(result.admission==='replayed')return json({ok:true,...receipt});
    const playback=await this.router!(url.pathname+url.search,'POST',raw,signal);
    validate();
    return playback.kind==='json' ? {...playback,obj:{...playback.obj,...receipt}} : playback;
  }
  async handle(url:URL,method:string,raw:string|undefined,signal:AbortSignal,actorKind:'owner'|'companion'='owner') {
    this.ensure();
    const rest=decodeURIComponent(url.pathname.slice(route.length+1)), pet=url.searchParams.get('pet') || 'main';
    const config=this.ctx.petCore.workspace.runtime?.config;
    const actor:CompanionFactActor={kind:actorKind,id:actorKind==='owner'?(config?.ownerActorId ?? 'owner'):(config?.companionId ?? 'companion'),channel:actorKind==='owner'?'desktop':'dsh-tool'};
    if(rest==='presentation') {
      if(method==='GET')return json(this.bodyStatus());
      if(method!=='POST')return json({ok:false},405);
      const input=JSON.parse(raw || '{}');
      if(input.action==='show')return json(await this.show());
      if(input.action==='hide'){await this.hide();return json(this.bodyStatus());}
      return json({ok:false},400);
    }
    if(rest==='native-chat-window') {
      if(method!=='POST')return json({ok:false},405);
      await this.ctx.petDesktop.openChat();return json({ok:true});
    }
    if(rest==='room-window') {
      if(method!=='POST')return json({ok:false},405);
      return json(await this.openRoom());
    }
    if(rest==='menu/click' && method==='POST') {
      const input=JSON.parse(raw || '{}');
      if(input.owner==='chatpet.room') {
        await this.openRoom();return json({ok:true});
      }
      if(input.owner==='chatpet.native-chat'){await this.ctx.petDesktop.openChat();return json({ok:true});}
    }
    if(rest==='native-preferences') {
      if(method==='GET')return json(this.ctx.petCore.workspace.companionSettings());
      if(method==='POST')return json(await this.ctx.petDesktop.savePreference(JSON.parse(raw || '{}')));
      return json({ok:false},405);
    }
    if(rest==='native-playback') {
      if(method!=='POST')return json({ok:false},405);
      const receipt=JSON.parse(raw || '{}');
      const asset=catalog.actions.find(asset=>asset.id===receipt.name || asset.label===receipt.name);
      if(asset && !physicalClips.has(asset.label) && ['expression','random'].includes(receipt.kind))
        this.ctx.petDesktop.recordPlayback({...receipt,name:asset.id,workspaceId:this.bound!.id});
      return json({ok:true});
    }
    if(rest==='native-feature') {
      if(method!=='POST')return json({ok:false},405);
      const input=JSON.parse(raw || '{}');
      if(!/^\/(?:sleep|wake|pet|whisper|balance)(?:\?|$)/.test(input.path))return json({ok:false},400);
      const features=this.ctx.petDesktop.features;
      if(!features)return json({ok:false},503);
      const target=new URL(input.path,'https://pet.local/'),action=target.pathname.slice(1);
      const nativeCareActions: readonly string[] = ['sleep','wake','pet'] satisfies readonly CareAction[];
      if(nativeCareActions.includes(action)) {
        if(!target.searchParams.has('lock') && url.searchParams.has('lock'))target.searchParams.set('lock',url.searchParams.get('lock')!);
        const blocked=this.careBlocked(action,target.searchParams.get('pet') || pet,target.searchParams);
        if(blocked)return blocked;
      }
      return json(await features.request({...input,actor}));
    }
    if (rest==='native-chat') {
      if (method==='GET') return json(this.ctx.petDesktop.chat.snapshot());
      const data=JSON.parse(raw || '{}');
      if (method!=='POST' || !['open','new','send','stop'].includes(data.action)) return json({ok:false},400);
      return json(await this.ctx.petDesktop.chat.run(data.action,data.input ?? {}));
    }
    if (rest==='chat') return this.nativeChat(pet,method,raw,signal);
    if (rest==='chat/memory') return json({ok:true,orphans:[]},method==='GET'?200:405);
    if (rest.startsWith('voice/')) {
      const voice=this.ctx.petCore.native.voiceTable.lookup(this.ctx,AbortSignal.any([signal,this.scope.signal]));
      if (!voice) return json({ok:false,message:'语音组件未启用'},503);
      const result=await voice.handle({rest,method,body:raw});
      voice.assertCurrent();
      return result;
    }
    if (rest==='sleep' || rest==='wake') {
      if(method!=='POST')return json({ok:false},405);
      const blocked=this.careBlocked(rest,pet,url.searchParams);
      if(blocked)return blocked;
      const features=this.ctx.petDesktop.features;
      if(!features)return json({ok:false,message:'桌宠生活状态不可用'},503);
      return json(await features.request({path:'/'+rest,method,body:raw,actor}));
    }
    if (rest==='todos' || rest.startsWith('todos/')) {
      const feature=this.ctx.petDesktop.features;
      if(!feature)return json({ok:false,message:'桌宠待办不可用'},503);
      return json(await feature.request({path:'/'+rest+url.search,method,body:raw,actor}));
    }
    safeConfig(this.directory);
    const requestScope=this.scope;
    const live=rest==='config-live' && method==='GET';
    if(live)await this.refreshBehavior();
    const pathname=live ? route+'/config' : url.pathname;
    if(rest==='lock' && method==='POST' && this.behavior?.her?.asleep)return json({ok:false,reason:'sleeping',message:'请先叫醒，再开始互动'},409);
    if(rest==='anim' && method==='POST') {
      const input=JSON.parse(raw || '{}');
      const requestId=typeof input.requestId==='string'?input.requestId:randomUUID();
      const cfg=upstream.readAllConfig(this.setup.configPaths);
      const decide=(cfg:unknown)=>upstream.decideAnim({cfg,requested:String(url.searchParams.get('pet') ?? ''),name:input.name,url:input.url,facing:input.facing});
      const rejectPresentation=(cfg:unknown,petId:string)=>
        this.lookup.surfaceBlocked(cfg,petId,url.searchParams) || this.lookup.lockBlocked(petId,url.searchParams);
      const decision=decide(cfg);
      if(decision.ok) {
        const requested=decision.name;
        if(eatingClips.has(requested))return this.feedAnimation(url,raw,signal,requestId,actor,()=>{
          const current=upstream.readAllConfig(this.setup.configPaths), fresh=decide(current);
          return fresh.ok ? rejectPresentation(current,fresh.petId) : json({ok:false,reason:fresh.reason,message:fresh.message});
        });
        const blocked=rejectPresentation(cfg,decision.petId);
        if(blocked)return blocked;
        await this.refreshBehavior();
        requestScope.signal.throwIfAborted();
        signal.throwIfAborted();
        const behavior=this.ctx.get('petBehavior',false);
        if(behavior && (sleepingClips.has(requested) || requested==='睡觉-起来')) {
          const result=await behavior.roomAction(this.bound!.id,{action:requested==='睡觉-起来'?'wake':'sleep'},actorKind==='owner'?'主人':'大肥鱼',{requestId,actor});
          await this.refreshBehavior();
          return json({ok:true,accepted:true,home:desktopHomePlayback(result?.home),behavior:this.behavior?.behavior});
        }
        if(behavior && physicalClips.has(requested))return json({ok:false,reason:'activity-required',message:'请通过共享行为操作执行这项活动'},409);
        if(this.behavior?.her && requested!==this.activityAsset())return json({ok:false,reason:'activity-busy',message:'桌宠正在呈现共享活动，请通过行为操作改变活动'},409);
      }
    }
    const reserved=['GET','HEAD'].includes(method)?this.builtinLifeMedia(rest):undefined;
    const routed=reserved ?? this.router!(pathname+url.search,method,raw,AbortSignal.any([signal,requestScope.signal]));
    // The native long-poll reader is the existing presentation-availability
    // signal. Re-evaluate maintenance when a resumed renderer joins it.
    if(rest==='state' && method==='GET')void this.ctx.petDesktop.features?.refresh();
    const result=await routed;
    if (requestScope.signal.aborted) return json({ok:false,message:'工作区已切换'},409);
    const report=/^playback\/([^/]+)\/report$/.exec(rest);
    if(report && method==='POST' && result.kind==='json' && result.obj?.ok===true)this.reportPlayback(report[1]);
    const data=result.status===404 ? this.builtinMedia(rest) ?? result : result;
    if(data.status<400 && !['GET','HEAD'].includes(method) && ['config','pet-config','pet-display'].includes(rest))await this.ctx.petDesktop.features?.refresh();
    if (data.kind==='file' && ![this.directory,vendor,assets].some(base=>inside(base,data.file))) return json({ok:false},403);
    if(data.kind==='json' && (live || ['config','pet-config','pet-display'].includes(rest)) && data.obj?.main)
      return {...data,obj:live ? this.projectConfig(data.obj) : this.projectIdentity(data.obj)};
    return data;
  }
  async http(req:IncomingMessage,res:ServerResponse) {
    const abort=new AbortController(), stop=()=>abort.abort();
    res.on('close',stop);
    try {
      this.sync();
      const url=new URL(req.url ?? '/', 'http://localhost');
      const mediaPath=url.pathname.match(/^\/chatpet-presentation\/m\/([a-f0-9]{64})(\/.*)$/);
      if(mediaPath) {
        if(!this.mediaToken || !matches(mediaPath[1],this.mediaToken))return upstream.sendJson(res,401,{ok:false});
        url.pathname=route+mediaPath[2];
      }
      const rest=decodeURIComponent(url.pathname.slice(route.length+1));
      const media=!!mediaPath && ['GET','HEAD'].includes(req.method ?? '') &&
        /^(thumb\/|pic\/|font\/|sound\/|logo$|character$|pet-avatar$)/.test(rest);
      const bearer=String(req.headers.authorization ?? '').replace(/^Bearer /,'');
      const owner=!!this.ownerToken && matches(bearer,this.ownerToken);
      const tool=!!this.toolToken && matches(bearer,this.toolToken) && controlRouteAllowed(rest,req.method || 'GET');
      if(!owner && !tool && !media)return upstream.sendJson(res,401,{ok:false});
      const authorizedScope=this.scope;
      const method=req.method || 'GET';
      const origin=req.headers.origin;
      if (origin && origin!=='dsh-app://app' && new URL(origin).host!==req.headers.host) return upstream.sendJson(res,403,{ok:false});
      const raw=['POST','PATCH','PUT'].includes(method)? await upstream.readBody(req):undefined;
      this.sync();
      if(authorizedScope.signal.aborted)return upstream.sendJson(res,401,{ok:false});
      const result=await this.handle(url,method,raw,AbortSignal.any([abort.signal,authorizedScope.signal]),tool&&!owner?'companion':'owner');
      if (abort.signal.aborted)return;
      if(authorizedScope.signal.aborted)return upstream.sendJson(res,401,{ok:false});
      if(result.kind==='file') return upstream.sendFile(req,res,result.file,result.contentType);
      if(result.kind==='json') return upstream.sendJson(res,result.status,result.obj,{...result.headers,'cache-control':'no-store'});
      if(result.kind==='text') return upstream.sendText(res,result.status,result.body);
    } catch (error) {
      if(!res.headersSent && !res.destroyed) upstream.sendJson(res,400,{ok:false,message:error instanceof Error?error.message:'请求失败'});
    } finally {res.off('close',stop);}
  }
}
export function apply(ctx:Context) {
  const platform=new PetPlatform(ctx);
  ctx.provide('petPlatform',platform);
  const web=(ctx as any).webServer;
  ctx.effect(()=>web.register({kind:'prefix',path:route,handler:(req:IncomingMessage,res:ServerResponse)=>platform.http(req,res)}));
  const off=ctx.on('pet/core.changed',()=>platform.identityChanged());
  ctx.inject(['petEmotion'],scope=>{
    const release=scope.petEmotion.registerCatalog('desktop',expressionCatalog);
    scope.effect(()=>release);
  });
  ctx.effect(()=>()=>{off();platform.close();});
}
