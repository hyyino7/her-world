import { DesktopFeatures } from './features.js';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import type { Context } from '@deepseek-ai/cordis';
import type { PetCoreHost } from '../core/index.js';
import { isDesktopSwitch } from '../core/companion-settings.js';
import type {} from '../emotion/plugin.js';
import { workAnimationEligible } from '../emotion/index.js';
import type { PlaybackReceipt } from '../emotion/index.js';
import { Conversation, sameBinding, type Binding, type NativeDesktopHost, type NativeEvent, type NativeSession, type StreamFrame } from './conversation.js';

type Work = { session: string; turn: number; start: number; stage: string; workspaceId: string; entered?: boolean; terminal?: boolean };
type HostServices = NativeDesktopHost & {
  getPresentation?(): {show(): Promise<unknown>; hide(validate?: () => void): Promise<unknown>; bodyStatus(): {running:boolean};
    savePreference?(key:string,value:boolean):Promise<unknown>} | undefined;
  getEmotion(): import('../emotion/plugin.js').CompanionEmotion | undefined;
  isLifeHome?(id: string): boolean;
  on(name: string, handler: (data: { agent: { session: NativeSession }; frame: StreamFrame }) => void,
    options: { global: boolean }): () => void;
};
const desks = new WeakMap<PetCoreHost, Desktop>();
export function desktopFor(host: PetCoreHost): Desktop {
  const desktop = desks.get(host);
  if (!desktop) throw Error('桌宠尚未就绪');
  return desktop;
}

export class Desktop {
  private child?: ChildProcess;
  private ready?: Promise<void>;
  private readyReject?: (error:Error) => void;
  private tick?: NodeJS.Timeout;
  private clock?: NodeJS.Timeout;
  private work?: Work;
  private bodyBinding?: Binding;
  private readonly chatVoice = new Map<number, AbortController>();
  readonly chat: Conversation;
  features?: DesktopFeatures;
  constructor(private native: HostServices, private host: PetCoreHost) {
    const store = host.workspace.runtime.store;
    this.chat = new Conversation(native, () => this.target(), key => store.get<string>('desktop-session', key),
      (key, id) => store.put('desktop-session', key, id), () => this.changed());
  }

  private target() {
    const { state, target } = this.host.workspace.status();
    if (state !== 'ready' || !target) throw Error('请先在大肥鱼设置里绑定并初始化工作区');
    return {...target,storageId:this.host.workspace.storageId()};
  }
  private bodyCurrent() {
    try { return Boolean(this.bodyBinding && sameBinding(this.bodyBinding,this.target())); } catch { return false; }
  }
  private readonly surfaces = new Map<(type:string, value:unknown)=>void, ()=>boolean>();
  onPresentation(receive:(type:string, value:unknown)=>void, available:()=>boolean) {
    this.surfaces.set(receive,available);
    return () => { this.surfaces.delete(receive); };
  }
  presentationAvailable() { return this.status().running || [...this.surfaces.values()].some(active=>active()); }
  private push(type: string, value: unknown, nativeWindow = true) {
    if (['say','balance','sleep','sleep-text','notice','work','expression','preferences','chat','identity'].includes(type)) {
      for (const receive of this.surfaces.keys()) {
        try { receive(type,value); } catch (error) { console.warn('Desktop presentation update failed', error); }
      }
    }
    if (nativeWindow && this.child?.stdin?.writable && !this.child.stdin.destroyed) this.child.stdin.write(JSON.stringify({ type, value }) + '\n');
  }
  presentLife(text: string, sticker?: string) {
    if (this.host.workspace.runtime.policy().quiet) throw Error('安静模式中，主动消息未发送');
    const local = this.bodyCurrent() && this.status().running &&
      this.child?.stdin?.writable && !this.child.stdin.destroyed;
    if (!local && ![...this.surfaces.values()].some(active=>active())) throw Error('当前桌宠不可用，主动消息未发送');
    this.push('say', { text, sticker, automatic: true, life: true });
  }
  private changed() {
    if (!this.child || this.tick) return;
    this.tick = setTimeout(() => {
      this.tick = undefined;
      try { this.push('chat', this.chat.snapshot()); }
      catch { this.push('chat', { sessionId: null, messages: [], generating: false, live: '' }); }
    }, 40);
  }
  private belongs(session: NativeSession) {
    const state = this.host.workspace.sessionStatus(session, this.native.workspaceRegistry);
    return state?.state === 'ready' ? state.target : undefined;
  }
  event(session: NativeSession, event: NativeEvent) {
    this.chat.event(session, event);
    if (event.type === 'turn/end' && event.data.reason?.kind === 'completed' && this.belongs(session) && !this.native.isLifeHome?.(session.id) && this.host.workspace.companionSettings().desktopReplyBubble) {
      const messages = session.snapshotEvents().filter(e => e.type === 'assistant/message' && e.data.turn === event.data.turn);
      const text = messages.at(-1)?.data.message?.content?.filter(part => part.type === 'text').map(part => part.text ?? '').join('') ?? '';
      if (text) this.push('say', { text, sessionId: session.id, turn: event.data.turn });
    }
    if (!['turn/start','turn/end','tool/call','tool/result','approval/asked'].includes(event.type)) return;
    let target; try { target = this.belongs(session); } catch { return; }
    if (!target) return;
    if (event.type === 'turn/start') {
      this.work = { session: session.id, turn: event.data.turn!, start: event.time, workspaceId: target.id, stage: 'thinking' };
    } else {
      const work = this.work;
      if (!work || work.session !== session.id || (event.data.turn !== undefined && work.turn !== event.data.turn)) return;
      if (event.type === 'turn/end') {
        const eligible = workAnimationEligible(work.start, event.time, this.host.workspace.companionSettings().workAnimationDelaySeconds);
        const reason = event.data.reason?.kind;
        this.work = work.entered && eligible && ['completed','error','max-tokens'].includes(reason ?? '')
          ? { ...work, terminal: true, stage: reason === 'completed' ? 'success' : 'error' } : undefined;
      } else {
        work.stage = event.type === 'tool/result' ? 'result' : event.type === 'approval/asked' ? 'waiting' : 'working';
      }
    }
    this.workUpdate();
  }
  private workUpdate() {
    clearTimeout(this.clock);
    const work = this.work;
    if (!work || !this.presentationAvailable()) { if (work?.terminal) this.work = undefined; this.push('work', null); return; }
    const target = this.target(), delay = this.host.workspace.companionSettings().workAnimationDelaySeconds;
    if (work.workspaceId !== target.id) { this.work = undefined; this.push('work', null); return; }
    if (work.terminal || workAnimationEligible(work.start, Date.now(), delay)) {
      work.entered = true;
      this.push('work', work);
      if (work.terminal) this.work = undefined;
    } else {
      this.push('work', null);
      this.clock = setTimeout(() => {
        try { this.workUpdate(); } catch { this.push('work', null); }
      }, Math.max(1, work.start + delay * 1000 - Date.now() + 1));
    }
  }
  expression(value: { workspaceId: string; sessionId: string; turn: number; action?: string; sticker?: string }) {
    if (this.host.workspace.status().target?.id !== value.workspaceId) return;
    this.push('expression', { ...value, sticker: value.sessionId === this.chat.id ? value.sticker : undefined }, this.bodyCurrent());
  }
  settingsChanged() {
    if (!this.child && !this.surfaces.size) return;
    const close = () => { void this.closeWindow().catch(error => console.warn('Desktop presentation hide failed after chat cleanup',error)); };
    try { if (this.child && !this.bodyCurrent()) close(); else { this.push('identity', {displayName:this.host.workspace.runtime.identity().displayName}); this.push('preferences', this.host.workspace.companionSettings()); this.workUpdate(); } }
    catch { close(); }
  }
  async savePreference(data:Record<string,unknown>) {
    const key=data.key;
    if (!['desktopClickSound','desktopReplyBubble','desktopWhisperEnabled','desktopBalanceEnabled','desktopFixed','desktopConfineToScreen'].includes(String(key)) || !isDesktopSwitch(String(key),data.value)) throw Error('无效桌宠设置');
    if(key!=='desktopReplyBubble') {
      const presentation=this.native.getPresentation?.();
      if(!presentation?.savePreference)throw Error('请启用桌宠展示模块后修改外观设置');
      return presentation.savePreference(String(key),data.value);
    }
    const current=this.host.workspace.companionConfiguration();
    const saved=await this.host.services.workspace.saveCompanion(this.host.operator.request('desktop-setting:'+randomUUID()), {
      workspaceId:this.target().id,expectedSettings:current,settings:{...current,[String(key)]:data.value}});
    if(!saved.ok)throw Error(saved.error.message);
    this.settingsChanged();
    return saved.value;
  }
  recordPlayback(data:PlaybackReceipt) {
    this.native.getEmotion()?.recordPlayback({...data,workspaceId:this.target().id});
  }
  status() { return this.native.getPresentation?.()?.bodyStatus() ?? {running:false}; }
  async start() {
    const presentation=this.native.getPresentation?.();
    if (!presentation) throw Error('桌宠展示模块尚未就绪');
    await presentation.show();
    this.features?.restore();
    this.workUpdate();
  }
  async openChat() {
    const target = this.target();
    if (this.child && !this.bodyCurrent()) this.closeChat();
    if (this.child) {
      const child=this.child;await this.ready;
      if(this.child!==child||!this.bodyCurrent()||!sameBinding(target,this.target()))throw Error('小窗已关闭或工作区已切换');
      this.push('show-chat', true); return;
    }
    const bin = process.env.DSH_CHATBOT_ELECTRON_PATH || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'electron/Electron.app/Contents/MacOS/Electron');
    if (!existsSync(bin)) throw Error('找不到桌宠 Electron，请检查已安装的桌面运行环境');
    const root = dirname(createRequire(import.meta.url).resolve('her-world/package.json'));
    const env: NodeJS.ProcessEnv = { ...process.env, CHATPET_CHAT_ONLY:'1' }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(bin, [join(root, 'src/desktop/helper/main.cjs')], { env, stdio: ['pipe','pipe','pipe'] });
    this.child = child; this.bodyBinding = target;
    child.stderr.resume();
    child.stdin.on('error', () => {});
    let done!: () => void, fail!: (error: Error) => void;
    this.ready = new Promise<void>((resolve, reject) => { done = resolve; fail = reject; });
    this.readyReject=fail;
    const timeout = setTimeout(() => { fail(Error('桌宠窗口启动超时')); child.kill(); }, 15000);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      if (this.child !== child) return;
      if (msg.type === 'ready') {
        if(!this.bodyCurrent()){this.closeChat();return;}
        clearTimeout(timeout); done(); this.push('show-chat',true); this.settingsChanged(); return;
      }
      if (msg.type === 'voice-cancel') this.chatVoice.get(msg.id)?.abort();
      if (msg.type === 'request') void this.handle(msg);
    });
    const closed = (message: string) => {
      clearTimeout(timeout); fail(Error(message)); lines.close();
      if (this.child === child) this.closeChat();
    };
    child.once('error', error => closed('桌宠窗口启动失败：' + error.message));
    child.once('exit', (code, signal) => closed('桌宠窗口已退出（' + (signal ?? code ?? '未知原因') + '）'));
    try { await this.ready; }
    finally { if(this.child===child)this.readyReject=undefined; }
  }
  private async handle(msg: { id: number; action: string; input?: Record<string, unknown>; cancellableVoice?: boolean }) {
    const child = this.child;
    let voice: AbortController | undefined;
    try {
      const target = this.target();
      if (!this.bodyCurrent()) { await this.closeWindow(); return; }
      const data = msg.input ?? {};
      let result;
      if (msg.action === 'open-session') {
        result = await this.chat.run('open', {sessionId:String(data.sessionId),workspaceId:target.id});
      } else if (msg.action === 'desktop-api') {
        if (!this.features) throw Error('桌宠功能尚未就绪');
        if (msg.cancellableVoice) {
          voice = new AbortController();
          this.chatVoice.set(msg.id, voice);
        }
        result = await this.features.request(data, voice?.signal);
      } else if (msg.action === 'preferences') {
        result = this.host.workspace.companionSettings();
      } else if (msg.action === 'identity') {
        result = {displayName:this.host.workspace.runtime.identity().displayName};
      } else if (msg.action === 'desktop-preference') {
        result = await this.savePreference(data);
      } else if (msg.action === 'playback') {
        const receipt = data as unknown as PlaybackReceipt;
        this.recordPlayback(receipt);
      } else if (['open','new','send','stop'].includes(msg.action)) {
        result = await this.chat.run(msg.action as 'open'|'new'|'send'|'stop', data);
      } else throw Error('未知操作');
      if (child === this.child) this.push('response', { id: msg.id, ok: true, result });
    } catch (e) {
      if (child === this.child) this.push('response', { id: msg.id, ok: false, error: e instanceof Error ? e.message : '操作失败' });
    } finally {
      if (voice && this.chatVoice.get(msg.id) === voice) this.chatVoice.delete(msg.id);
    }
  }
  async closeWindow(validate?: () => void) {
    this.closeChat();
    await this.native.getPresentation?.()?.hide(validate);
    validate?.();
  }
  closeChat() {
    clearTimeout(this.tick); clearTimeout(this.clock); this.tick = undefined; this.clock = undefined;
    const child = this.child; this.child = undefined; this.bodyBinding = undefined;
    for (const voice of this.chatVoice.values()) voice.abort();
    this.chatVoice.clear();
    this.readyReject?.(Error('小窗已关闭，操作已取消')); this.readyReject=undefined; this.ready=undefined;
    this.chat.invalidate();
    if (this.work) this.work.entered = false;
    try { this.features?.pause(); } catch(error) { console.warn('Desktop background cancellation failed',error); }
    if (child) {
      try { child.stdin?.end(); } catch(error) { console.warn('Desktop chat input close failed',error); }
      if(child.exitCode===null) {
        const timeout = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 2000);
        timeout.unref();
        child.once('exit', () => clearTimeout(timeout));
      }
    }
  }
}

export function registerDesktop(ctx: Context, host: PetCoreHost): void {
  // Workspace/controller can arrive after Core; Cordis requires service lookup outside declared injections.
  function service<T>(current: T | undefined, key: string): T {
    if (!current) throw Error('DSH 服务暂不可用：' + key);
    return current;
  }
  const native: HostServices = {
    get workspaceRegistry() { return service(ctx.get('workspaceRegistry'), 'workspaceRegistry'); },
    get sessionController() { return service(ctx.get('sessionController'), 'sessionController'); },
    get agents() { return service(ctx.get('agents') as NativeDesktopHost['agents'] | undefined, 'agents'); },
    get sessions() { return service(ctx.get('sessions') as NativeDesktopHost['sessions'] | undefined, 'sessions'); },
    prepareWorkspace: async () => {await desk.features?.restoreImages();await ctx.get('petTranscripts')?.restore();},
    admitImage: image => {
      if (!desk.features) throw Error('桌宠图片入口尚未就绪');
      return desk.features.images.admit(image);
    },
    getEmotion: () => ctx.get('petEmotion'),
    getPresentation: () => ctx.get('petPlatform'),
    isLifeHome: id => ctx.get('petLife')?.isHome(id) ?? false,
    on: (ctx.on as HostServices['on']).bind(ctx),
  };
  const desk = new Desktop(native, host);
  desk.features = new DesktopFeatures(ctx, host, (type, value) => {
    desk['push'](type, value, desk['bodyCurrent']());
  }, () => desk.presentationAvailable(), () => Boolean(desk['work'] && !desk['work'].terminal));
  desks.set(host, desk);
  const stream = native.on('agent/assistant-stream', ({ agent, frame }) => desk.chat.frame(agent.session, frame), { global: true });
  const event = ctx.on('session/event', (session, entry) => desk.event(session as unknown as NativeSession, entry as unknown as NativeEvent), { global: true });
  const settings = ctx.on('pet/core.changed', operation => {
    if (operation.startsWith('preferences.') || operation.startsWith('workspace.') || operation === 'reviseIdentity') desk.settingsChanged();
  });
  const expression = ctx.on('pet/emotion.expression', value => desk.expression(value));
  ctx.effect(() => async () => { stream(); event(); settings(); expression(); desk.closeChat(); await desk.features?.close(); desks.delete(host); });
}
