import { DesktopImages } from './images.js';
import { existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { PetCoreHost } from '../core/index.js';
import {randomUUID} from 'node:crypto';
import type {CareAction} from '../contracts/behavior.js';
import type {CompanionFactActor} from '../contracts/interaction.js';
import {isWorldChangeFor} from '../contracts/living.js';
import {isVoiceRoute} from '../contracts/voice.js';
import {sameBinding, type Binding} from './conversation.js';
import {DEFAULT_CONVERSATION} from '../core/options.js';
import {readLifeEnabled} from '../living/outlets.js';

// 上游功能按需加载。构建直接把这些模块生成到 dist 下的相对位置。
const MAX_TIMER_MS = 2_147_483_647;
/** Ask the original policy for the first eligible reminder rather than polling
 * or copying its interval table. Before the deadline eligibility is monotonic;
 * after the deadline the original policy supplies the next reminder directly. */
function nextTodoWake(todo:any,now:number,policy:any):number|null {
  if(todo.done||todo.dueAt===null)return null;
  const due=policy.nextReminderAt(todo,now);
  if(due!==null&&due<=now)return now;
  if(todo.dueAt<=now)return due;
  const ready=(at:number)=>{const next=policy.nextReminderAt(todo,at);return next!==null&&next<=at;};
  let low=now+1,high=todo.dueAt-1;
  if(high>=low&&ready(high)) {
    while(low<high){const middle=low+Math.floor((high-low)/2);if(ready(middle))high=middle;else low=middle+1;}
    return low;
  }
  const atDeadline=policy.nextReminderAt(todo,todo.dueAt);
  return atDeadline===null?null:Math.max(todo.dueAt,atDeadline);
}
export class DesktopFeatures {
  private todosByRoot = new Map<string, any>();
  private shownRest?: {path: string; sleeping: boolean; pending: boolean};
  readonly images: DesktopImages;
  private whispering?: Promise<any>;
  private lastWhisper = Date.now();
  private lastDream = Date.now();
  private lastBalance = Date.now();
  private checking = false;
  private closed = false;
  private readonly voiceLifetime = new AbortController();
  private timer?: NodeJS.Timeout;
  private maintenance?: Promise<void>;
  private scheduling:Promise<void>=Promise.resolve();
  private scheduleRevision=0;
  private maintenanceFailed=false;
  private subscriptions:(()=>void)[]=[];
  private generation?: {abort: AbortController; binding: Binding; automatic: boolean; dream: boolean};
  constructor(private ctx: Context, private host: PetCoreHost,
    private publish: (type: string, value: unknown) => void, private available: () => boolean,
    private busy: () => boolean) {
    this.images = new DesktopImages(host, () => this.ctx.get('attachments'));
    if(typeof ctx.on==='function') {
      this.subscriptions.push(ctx.on('pet/core.changed',operation=>{
        if(operation.startsWith('preferences.')||operation.startsWith('workspace.')||operation==='setQuiet'||operation==='reviseIdentity')void this.refresh();
      }),ctx.on('world.changed',change=>{
        if(isWorldChangeFor(change,this.host.workspace.homeScope()))this.restore(false);
      }),ctx.on('session/event',(session,entry)=>{
        if(['turn/start','turn/end'].includes(entry.type)&&session.header.cwd===this.host.workspace.status().target?.path)void this.refresh();
      },{global:true}));
    }
    void this.refresh();
  }
  private preferences() {
    const presentation=this.ctx.get('petPlatform',false);
    return {...this.host.workspace.companionSettings(),...presentation?.featurePreferences()};
  }
  private target() {
    const state = this.host.workspace.status();
    if (state.state !== 'ready' || !state.target) throw Error('请先绑定并初始化工作区');
    return {...state.target, storageId:this.host.workspace.storageId?.() ?? state.target.id};
  }
  private current(binding: Binding) {
    try { return !this.closed && sameBinding(binding, this.target()); } catch { return false; }
  }
  private same(binding: Binding) { return this.current(binding) && this.available(); }
  private assertCurrent(binding: Binding) { if (!this.current(binding)) throw Error('桌宠工作区已切换，操作已取消'); }
  private lifeOwnsAutonomy(workspaceId:string):boolean {
    return readLifeEnabled(this.ctx, this.host, workspaceId);
  }
  private automaticAllowed(binding:Binding,dream:boolean) {
    return this.proactiveAllowed(binding)
      && !this.lifeOwnsAutonomy(binding.id) && this.preferences().desktopWhisperEnabled
      && this.rest(binding).sleeping===dream;
  }
  private proactiveAllowed(binding:Binding) {return this.same(binding) && !this.busy() && !this.host.workspace.runtime.policy().quiet;}
  private async todos(binding = this.target()) {
    this.assertCurrent(binding);
    const root = binding.path, key = JSON.stringify([binding.id, root, binding.storageId]);
    let dir = root;
    for (const part of ['.chatpet', 'data', 'desktop']) {
      dir = join(dir, part);
      if (!existsSync(dir)) mkdirSync(dir, {mode:0o700});
      if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw Error('桌宠数据路径无效');
    }
    const file = join(dir, 'todos.json');
    const types = await import('./upstream/host/todo/types.js' as string);
    this.assertCurrent(binding);
    for (const candidate of [file,file+'.tmp']) {
      if (existsSync(candidate)) {const stat=lstatSync(candidate);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('待办文件无效');}
    }
    if (existsSync(file)) {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('待办文件无效');
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      if (raw.version !== 1 || !Array.isArray(raw.todos) || types.parseTodoFile(raw).length !== raw.todos.length) throw Error('待办文件损坏，已保留原文');
    }
    let store = this.todosByRoot.get(key);
    if (!store) {
      const {TodoStore} = await import('./upstream/host/todo/store.js' as string);
      this.assertCurrent(binding);
      store = new TodoStore({file,log:this.ctx.logger('chatpet-desktop')}); this.todosByRoot.set(key,store);
    }
    return store;
  }
  restoreImages() {return this.images.restore();}
  private rest(target: {id: string; path: string}) {
    return this.ctx.get('petBehavior')?.restState(target.id) ?? {sleeping:false,pending:false};
  }
  restore(force = true) {
    const target = this.host.workspace.status().target;
    void this.refresh();
    if (this.closed || !target) return;
    const {sleeping, pending} = this.rest(target);
    const old = this.shownRest;
    if (!force && old?.path === target.path && old.sleeping === sleeping && old.pending === pending) return;
    this.shownRest = {path: target.path, sleeping, pending};
    if (old?.path !== target.path || old.sleeping !== sleeping) this.lastDream = Date.now();
    this.publish('sleep', sleeping ? {sleeping, pending, start:'sleep-start',loop:'sleep-loop',end:'sleep-end'} : {sleeping, pending});
  }
  async request(input: {path?: unknown; method?: unknown; body?: unknown; actor?:CompanionFactActor}, signal?: AbortSignal) {
    if(this.closed)throw Error('桌宠组件正在关闭');
    const target = this.target();
    const path = String(input.path ?? ''), method = String(input.method ?? 'GET');
    const url = new URL(path, 'https://pet.local/');
    const rest = url.pathname.replace(/^\//, '');
    if (isVoiceRoute(rest)) {
      const lifetime = this.voiceLifetime.signal;
      const service = this.host.native.voiceTable.lookup(this.ctx, signal ? AbortSignal.any([signal, lifetime]) : lifetime);
      if (!service) throw Error('语音组件尚未启用');
      const result = await service.handle({rest,method,body:typeof input.body === 'string' ? input.body : undefined});
      service.assertCurrent();
      if (!this.same(target)) throw Error('桌宠工作区已切换');
      return result.kind === 'file' ? {audio:readFileSync(result.file).toString('base64'), mediaType:result.contentType} : result.obj;
    }
    if (rest === 'todos' || /^todos\/[A-Za-z0-9_-]+$/.test(rest)) {
      const {handleTodoRoutes} = await import('./upstream/host/routes/todos.js' as string);
      this.assertCurrent(target);
      const todos = await this.todos(target);
      this.assertCurrent(target);
      // The original store serializes accepted writes to this captured Repo.
      // A later rebind can cancel the response, never redirect the write to B.
      const result = await handleTodoRoutes({todos,log:this.ctx.logger('chatpet-desktop')},
        {rest,method,body:typeof input.body === 'string' ? input.body : undefined});
      this.assertCurrent(target);
      await this.refresh();
      this.assertCurrent(target);
      return result?.obj ?? {ok:false,message:'不支持的待办请求'};
    }
    if (method !== 'POST') throw Error('不支持的操作');
    if (rest === 'whisper') return this.whisper(url.searchParams.get('image') ?? undefined);
    if (rest === 'balance') return this.balance();
    if (rest === 'sleep' || rest === 'wake' || rest === 'pet') {
      const action: CareAction = rest;
      const behavior=this.ctx.get('petBehavior');
      if(!behavior)throw Error('身体与行为模块未启用');
      const payload=typeof input.body==='string'?JSON.parse(input.body || '{}'):{};
      const requestId=typeof payload.requestId==='string'?payload.requestId:randomUUID();
      const result = input.actor && behavior.roomAction
        ? await behavior.roomAction(target.id,{action},input.actor.kind==='owner'?'主人':'大肥鱼',{requestId,actor:input.actor})
        : await behavior.act(target.id, action,requestId,'desktop');
      this.assertCurrent(target);
      if (rest === 'pet') return {ok:true};
      this.restore(false);
      if (!result || result.changed) {
        if (this.rest(target).pending) this.publish('notice', {text: result?.home.her.activity});
        else this.publish('sleep-text', {sleeping: this.rest(target).sleeping});
      }
      return {ok:true};
    }
    throw Error('此功能尚未接入：' + rest);
  }
  async balance() {
    const target = this.target();
    const model = this.ctx.get('agentDefaultModel')?.currentSelection();
    if (!model?.provider) throw Error('当前对话未配置服务商');
    const {queryBalance} = await import('./upstream/host/balance/index.js' as string);
    this.assertCurrent(target);
    const result = await queryBalance(model.provider,
      async (ref: string) => (await this.ctx.get('credentials')?.resolve(ref))?.value,
      this.ctx.get('deepseekAccount') ? () => this.ctx.get('deepseekAccount').getBalance({version:'0.0.0',locale:'zh-CN',timezoneOffsetSeconds:-new Date().getTimezoneOffset()*60}) : undefined);
    if (this.same(target)) this.publish('balance', result);
    return result;
  }
  async whisper(image?: string, dream = false, automatic = false) {
    if (this.whispering) return this.whispering;
    const target = this.target();
    if(automatic && !this.automaticAllowed(target,dream))return {ok:false,reason:'cancelled'};
    if (this.rest(target).sleeping && !dream) throw Error((this.host.workspace.runtime.identity().displayName || '伙伴') + '正在睡觉，先叫醒再聊吧');
    if (this.busy()) throw Error('正在回复，等这一轮结束再碎碎念吧');
    const catalog = JSON.parse(readFileSync(new URL('../../../src/desktop/assets/catalog.json', import.meta.url),'utf8'));
    // Keep upstream's one-shot native LLM call: no extra agent, transcript or
    // Memory writer. Provider usage is still billed; this is a duration bound,
    // not the autonomous native session's step/tool accounting.
    const maxDurationMs = this.host.workspace.runtime.conversation?.maxDurationMs ?? DEFAULT_CONVERSATION.maxDurationMs;
    const system = this.host.native.context().identity;
    const selection = this.ctx.get('agentDefaultModel')?.currentSelection();
    const abort = new AbortController(), generation = {abort,binding:target,automatic,dream}; this.generation = generation;
    const timeout = setTimeout(() => abort.abort(Error('后台碎碎念已达到时长上限')), maxDurationMs);
    timeout.unref();
    const run = async () => {
      const {generateWhisper, SLEEP_TALK_INSTRUCTION} = await import('./upstream/host/whisper.js' as string);
      const {pickMeme, matchMeme} = await import('./upstream/host/memes.js' as string);
      const pool = catalog.stickers.map((item: {id: string; description: string}) => ({name: item.id, desc: item.description}));
      const forced = image && matchMeme(pool, image);
      if (image && !forced) throw Error('没有这张贴图');
      const meme = forced || (!dream && this.preferences().desktopWhisperImageEnabled && pickMeme(pool));
      if (abort.signal.aborted || !this.same(target) || automatic && !this.automaticAllowed(target,dream))return {ok:false,reason:'cancelled'};
      const llm = this.ctx.get('llm');
      const nativeLlm = llm && {resolveModelInfo:llm.resolveModelInfo?.bind(llm),stream:(options: any) => {
        this.assertCurrent(target); abort.signal.throwIfAborted();
        if(automatic && !this.automaticAllowed(target,dream))throw Error('自动碎碎念已取消');
        return llm.stream({...options,signal:AbortSignal.any([options.signal,abort.signal])});
      }};
      const result = await generateWhisper({llm:nativeLlm,agentDefaultModel:{currentSelection:()=>selection}}, {
        system,
        ...(dream ? {instruction:SLEEP_TALK_INSTRUCTION} : {}),
        ...(meme ? {meme} : {}),
      });
      if (this.same(target) && !abort.signal.aborted && (!automatic || this.automaticAllowed(target,dream))) {
        if (result.ok) this.publish('say',{text:result.text,sticker:result.image,automatic,whisper:!dream,dream});
        else this.publish('notice',{text:result.message ?? '碎碎念生成失败'});
      }
      return result;
    };
    if (dream) this.lastDream = Date.now();
    else this.lastWhisper = Date.now();
    this.whispering = run().finally(() => {clearTimeout(timeout);this.whispering=undefined;if(this.generation===generation)this.generation=undefined;void this.refresh();});
    return this.whispering;
  }
  private async tick() {
    if (this.checking || this.closed || !this.available() || this.busy() || this.host.workspace.runtime.policy().quiet) return;
    this.checking = true;
    try {
      const target = this.target(), now = Date.now(), settings = this.preferences();
      const {sleeping} = this.rest(target);
      const todos = await this.todos(target), policy = await import('./upstream/host/todo/policy.js' as string);
      this.assertCurrent(target);
      for (const todo of sleeping ? [] : await todos.list()) {
        const due = policy.nextReminderAt(todo,now);
        if (due !== null && due <= now && this.proactiveAllowed(target)) {
          this.publish('say',{text:policy.reminderText(todo,now),reminder:true});
          await todos.markReminded(todo.id,now); break;
        }
      }
      this.assertCurrent(target);
      if(!this.proactiveAllowed(target))return;
      if (settings.desktopBalanceEnabled && !sleeping && now-this.lastBalance>=settings.desktopBalanceMinutes*60_000) {this.lastBalance=now;await this.balance();}
      const {automaticWhisperSchedule} = await import('./upstream/host/whisper-policy.js' as string);
      const period = sleeping ? settings.desktopSleepTalkSeconds : settings.desktopWhisperMinutes * 60;
      const schedule = automaticWhisperSchedule(undefined, settings.desktopWhisperEnabled, period);
      const previous = sleeping ? this.lastDream : this.lastWhisper;
      if (this.same(target) && !this.lifeOwnsAutonomy(target.id) && schedule.enabled && now - previous >= schedule.periodSec * 1000) await this.whisper(undefined, sleeping, true);
    } catch (error) { this.maintenanceFailed=true;this.ctx.logger('chatpet-desktop').warn('Desktop maintenance pending',error); }
    finally { this.checking=false;void this.rearm(false); }
  }
  /** All lifecycle/configuration callers converge on one replaceable deadline.
   * Busy, quiet and unavailable states wait for their actual change event. */
  refresh():Promise<void> {
    if(this.generation && (!this.current(this.generation.binding)
      || this.generation.automatic && !this.automaticAllowed(this.generation.binding,this.generation.dream)))
      this.generation.abort.abort(Error('碎碎念的当前条件已改变，生成已取消'));
    return this.rearm(true);
  }
  private rearm(retryFailure:boolean):Promise<void> {
    if(this.closed)return Promise.resolve();
    if(retryFailure)this.maintenanceFailed=false;
    const revision=++this.scheduleRevision;clearTimeout(this.timer);this.timer=undefined;
    this.scheduling=this.scheduling.then(()=>this.schedule(revision)).catch(error=>{
      if(!this.closed&&revision===this.scheduleRevision)this.ctx.logger('chatpet-desktop').warn('Desktop maintenance pending',error);
    });
    return this.scheduling;
  }
  private async schedule(revision:number):Promise<void> {
    if(revision!==this.scheduleRevision||this.closed||this.maintenanceFailed||this.maintenance||this.checking||!this.available()||this.busy()||this.host.workspace.runtime.policy().quiet)return;
    const target=this.target(),settings=this.preferences(),{sleeping}=this.rest(target),now=Date.now();
    let next=Number.POSITIVE_INFINITY;
    if(!sleeping) {
      const todos=await this.todos(target),policy=await import('./upstream/host/todo/policy.js' as string);
      for(const todo of await todos.list()){const due=nextTodoWake(todo,now,policy);if(due!==null)next=Math.min(next,due);}
      if(settings.desktopBalanceEnabled)next=Math.min(next,this.lastBalance+settings.desktopBalanceMinutes*60_000);
    }
    if(!this.lifeOwnsAutonomy(target.id)) {
      const {automaticWhisperSchedule}=await import('./upstream/host/whisper-policy.js' as string);
      const period=sleeping?settings.desktopSleepTalkSeconds:settings.desktopWhisperMinutes*60;
      const schedule=automaticWhisperSchedule(undefined,settings.desktopWhisperEnabled,period);
      if(schedule.enabled)next=Math.min(next,(sleeping?this.lastDream:this.lastWhisper)+schedule.periodSec*1000);
    }
    if(revision!==this.scheduleRevision||this.closed||!this.same(target)||this.busy()||this.host.workspace.runtime.policy().quiet||!Number.isFinite(next))return;
    this.timer=setTimeout(()=>{
      this.timer=undefined;
      if(!this.maintenance)this.maintenance=this.tick().finally(()=>{this.maintenance=undefined;void this.rearm(false);});
    },Math.max(1,Math.min(MAX_TIMER_MS,next-Date.now())));
    this.timer.unref();
  }
  pause() {this.generation?.abort.abort(Error('碎碎念已取消'));this.lastWhisper=Date.now();void this.refresh();}
  async close() {
    this.closed=true;this.scheduleRevision++;clearTimeout(this.timer);this.timer=undefined;
    this.voiceLifetime.abort();
    for(const stop of this.subscriptions.splice(0))stop();
    this.pause();await Promise.all([this.whispering?.catch(()=>{}),this.maintenance,this.scheduling]);
  }
}
