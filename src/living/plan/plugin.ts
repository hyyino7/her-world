import { fail, object, requiredText, type ConsoleOperation } from '../../core/tables/console.js';
import {reviewDiaryStatus} from './review-completion.js';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type {SessionId} from '@deepseek-ai/dsh-session';
import { existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {createHash} from 'node:crypto';
import { createLifeRuntime, type LifeDeps } from '#dsh-world/life/runtime';
import { createLifeStore, durableWrite } from '#dsh-world/life/lifeStore';
import { registerWorldPrompt } from '../../core/native/prompt.js';
import type { PetCoreHost } from '../../core/index.js';
import { ensureCompanionHomeSession, resolveCompanionHome, resolveHomeAgent } from '../../core/companion-foundation.js';
import type { HomeBinding } from '../../core/workspace.js';
import { createHomeStore } from './home-store.js';
import { defaultLifePreferences, parseLifePreferences, type LifePreferences } from './library.js';
import type { CompanionRecordLibrary, RecordOperation } from '../../core/records.js';
import { companionRecordPaths } from '../../core/record-paths.js';
import { installLifeReview, REVIEW_ALARM_FILE } from './review.js';
import type {CompanionBehavior} from '../body/plugin.js';
import { PersistentLifePlan, expiredDispatchDeadline, parsePlanDraft, type CurrentLifePlan } from './plan.js';
import { registerPlanTools } from './plan-tools.js';
import {presentFacts} from '../../core/interaction-presentation.js';
import { FACT_DOMAIN_NAMES, type CompanionFact, type FactDomain } from '../../contracts/interaction.js';
import { isCareAction, type PlannedExecution } from '../../contracts/behavior.js';
import type { WorldCommands } from '../../contracts/living.js';
import {integer, reject, text, unavailable} from '../../core/storage.js';
import { CONTRACT_VERSION } from '../../contracts/version.js';
import {readFactReferences} from './facts.js';
import {createLifeSourceAdapter} from './tool-policy.js';
import type {TableRegistration} from '../../contracts/tables.js';
import {recordGardenPause, type GardenClock, type GardenPause} from '../economy/garden-clock.js';
import {lifeDirectories, readLifeControl, readLifeSettings, safeLifeFile} from './control-file.js';
import {InFlight, LivingView, mountLivingArea, sameHomeBinding, settleCleanup, withLivingCaller, type AreaReference, type CommandAdmission, type LivingPorts} from '../index.js';
import {lookupLifeOutlet} from '../outlets.js';

type Runtime = ReturnType<typeof createLifeRuntime>;
interface Workspace { id: string; path: string; sessionIds: readonly string[]; attachSession(id: string): Promise<void> }
interface Native {
  get(name: string): any;
  sessionController: {
    create(input: {workspaceId: string; agentPreset: string}): Promise<{sessionId: string}>;
    resolveAgent(id: string): Promise<{agent?: Agent; error?: {message: string}}>;
    rename(input: {sessionId: string; title: string}): Promise<unknown>;
    cancel(input: {sessionId: string}): unknown;
  };
}
interface Bound { id: string; path: string; directory: string; library: CompanionRecordLibrary; plan: PersistentLifePlan;
  scope: HomeBinding; home: ReturnType<typeof createHomeStore> }

/** The upstream fact layer is the only state writer. World owns scheduling,
 * journal and native home recovery; Core owns every model step and Memory. */
export class CompanionLife {
  private binding?: Bound;
  private runtime?: Runtime;
  private drainingRuntime?: Runtime;
  private enabled = false;
  private restoredClock = false;
  private pauses?: readonly GardenPause[];
  private preferences: LifePreferences = {...defaultLifePreferences};
  private closed = false;
  private closing?: Promise<void>;
  private readonly living: LivingView;
  private readonly inFlight = new InFlight();
  private fault?: string;
  private serial: Promise<unknown> = Promise.resolve();
  private timer?: NodeJS.Timeout;
  private tickGuards: (()=>boolean)[] = [];
  private subscriptions: (()=>void)[] = [];
  private sourceRegistration?: TableRegistration;
  readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  constructor(private ctx: Context, private host: PetCoreHost, private preset: string, ports: LivingPorts | LivingView = {}) {
    this.living = ports instanceof LivingView ? ports : new LivingView(ports);
    if (!(ports instanceof LivingView)) this.activate();
  }
  activate() {
    const {ctx, host} = this;
    for(const dispose of registerPlanTools(ctx,host,this))ctx.effect(()=>dispose);
    installLifeReview(ctx, host, () => {
      const workspace = this.current();
      if (this.isOpen() && workspace && this.binding?.id===workspace.id && this.binding.path===workspace.path) return {
        id: workspace.id, directory: companionRecordPaths(workspace.path).directory, sessionIds: workspace.sessionIds,
        isHome: (id: string) => this.isHome(id), timeZone: this.timeZone, running:this.running(),
      };
    }, this.inFlight);
    registerWorldPrompt(ctx, 'chatpet.life', 34, agent => {
      if (!this.running() || ctx.petWorld.sessionStatus(agent.session)?.state !== 'ready') return '';
      return this.runtime?.isHome(agent.id) ?
        '这是你当前的自主规划投递会话，不是生活状态的存储位置。收到生活唤醒时先用 life_plan_read 读取持久计划及版本，然后实际保存本次考虑结果：需要改变意图用 life_plan_update；决定继续原活动或保持等待用 life_plan_keep，不重建活动；需要暂停或取消用 life_activity_control。没有计划时也由你决定，不必等主人逐项安排；想安静等待可保存有原因的空步骤计划并将 nextConsiderAt 设为 null。口头描述、读取状态或只设闹钟都不能代替保存生活意图。经济活动先用 pet_economy_state 查看真实目录、余额与库存；收菜、出售、补种和库存餐食都由你明确选择并写入计划，成熟不会自动处理。阅读步骤先取得该步原 operationId，再用 life_read_segment 接收实际文字，读到内容后用 life_read_confirm 确认原片段，动画或购买不能冒充阅读或读懂。根据兴趣和真实状态安排有原因的完整活动，不用密集动作清单替代生活。由程序持续执行已接受活动，模型回复结束或动画结束不代表活动结束。不必为了每个小动作再唤醒。允许长时间继续、休息或没有下一安排。hold、躺在床上和下次考虑时间都不会让身体入睡；决定睡觉时用 life_plan_update 明确安排 kind=body、action=sleep，再按需要接 hold 等待。入睡要以身体回执及 asleep 状态为准；失败时查看真实原因并修订或恢复原计划，不能用“睡了”的文字代替。有限活动全部完成后若未选下次考虑时间，会给你一次接续机会；你仍可明确选择等待，不会被反复催促。plan_next 设置同一计划下次考虑时间，check_alarm 查看。需要主动联系时用 reach_out，不必每轮发言；生活事件不是用户发言。普通主人聊天无需每轮重写计划。保持现有人设、自述和记忆。' : '';
    });
    const changed=()=>this.scheduleTick();
    this.subscriptions.push(ctx.on('pet/core.changed',changed));
    this.scheduleTick();
  }
  registerSource() {
    this.sourceRegistration = this.host.native.sourceTable.register(createLifeSourceAdapter(this.ctx,this.host,(id,message)=>
      this.running() && this.runtime?.isHome(id) === true && message.source.kind === 'dsh-world-life'
        && (!('facts' in message.source) || this.runtime.acceptsFactMessage(id,message))));
  }
  /** Domain changes and native alarms wake Life; an idle world needs no pump. */
  noticeDomainChange(scope: HomeBinding, sourceCurrent: () => boolean) {
    this.scheduleTick(scope,sourceCurrent);
  }
  private scheduleTick(scope = this.host.workspace.homeScope(), sourceCurrent = () => true) {
    const current=()=>sourceCurrent() && sameHomeBinding(this.host.workspace.homeScope(),scope);
    if(!this.isOpen() || !current())return;
    this.tickGuards.push(current);
    if(this.timer)return;
    this.timer=setTimeout(()=>{
      this.timer=undefined;
      const guards=this.tickGuards.splice(0);
      if(guards.some(guard=>guard()))
        void this.enqueue(async()=>{if(guards.some(guard=>guard()))await this.tick();}).catch(error=>{this.fault=String(error);});
    },0);
    this.timer.unref();
  }
  private notifyLife(scope: HomeBinding, synchronizeBody = true) {
    if(!this.isOpen() || !sameHomeBinding(this.host.workspace.homeScope(),scope))return;
    this.noticeDomainChange(scope,()=>this.isOpen());
    if(!synchronizeBody)return;
    const body=this.living.lookup('body');
    if(body)void body.value.syncLifeClock(this,()=>this.isOpen() && body.isCurrent() &&
      sameHomeBinding(this.host.workspace.homeScope(),scope));
  }
  private native() { return this.ctx as unknown as Native; }
  private isOpen() { return !this.closed && this.living.isCurrent(); }
  private assertOpen() { if (!this.isOpen()) throw Error('生活组件已停止'); }
  private guardArea(area?: AreaReference<unknown>, validate?: () => void) {
    return () => {
      this.assertOpen();
      if(area && !area.isCurrent())throw Error('生活区已变化');
      validate?.();
    };
  }
  private enqueue<T>(work: () => Promise<T>, {finishOnClose = false} = {}): Promise<T> {
    if (!this.isOpen()) return Promise.reject(Error('生活组件已停止'));
    const scope=this.host.workspace.homeScope();
    const next = this.serial.then(()=>{
      if(!finishOnClose)this.assertOpen();
      if(!sameHomeBinding(this.host.workspace.homeScope(),scope))reject('STALE_BINDING','生活工作区已切换');
      return work();
    });
    this.serial = next.catch(() => {}); return next;
  }
  private current() {
    const status = this.host.workspace.status();
    if (status.state !== 'ready' || !status.target) return;
    const workspace = this.native().get('workspaceRegistry')?.get(status.target.id) as Workspace | undefined;
    return workspace?.path === status.target.path ? workspace : undefined;
  }
  private isCurrentBinding(bound: Bound) {
    if (this.binding !== bound || !this.living.isLatestGeneration()) return false;
    const current = this.current();
    return current?.id === bound.id && current.path === bound.path
      && sameHomeBinding(this.host.workspace.homeScope(),bound.scope)
      && this.host.workspace.storageId() === bound.plan.storageId
      && this.host.workspace.runtime.identity().companionId === bound.plan.companionId;
  }
  private assertCurrentBinding(bound: Bound) {
    if (!this.isCurrentBinding(bound)) throw Error('生活工作区已切换');
  }
  running() {
    return this.isOpen() && this.enabled && !!this.runtime && !!this.binding && this.isCurrentBinding(this.binding);
  }
  /** Saved clock intent is independent of native planner readiness. This read
   * never waits on Life's queue or initializes a missing control directory. */
  bodyClockState(workspaceId:string):(GardenClock & {restoreElapsed:boolean})|undefined {
    if(!this.isOpen())return;
    const current=this.current();if(!current||current.id!==workspaceId)return;
    if(this.binding?.id===current.id&&this.binding.path===current.path
      &&sameHomeBinding(this.host.workspace.homeScope(),this.binding.scope))
      return {enabled:this.enabled,restoreElapsed:this.enabled&&this.restoredClock,...(this.pauses && {pauses:this.pauses})};
    const saved=readLifeControl(current.path);
    const enabled=saved?.enabled ?? false;
    return {enabled,restoreElapsed:enabled,...(saved?.pauses && {pauses:saved.pauses})};
  }
  isHome(id: string) { return this.running() && this.runtime?.isHome(id) === true; }
  homeSessionId() { return this.running() ? this.runtime?.snapshot().homeSessionId : undefined; }
  /** Presentation reads the original body's two distinct states: walking to bed
   * can be cancelled, but the sleeping animation starts only after arrival. */
  restState(workspaceId: string) {
    if (this.isOpen()) return this.living.get('body')?.restState(workspaceId);
  }
  private publishRest() { lookupLifeOutlet(this.ctx, this.host, 'desktop')?.restore(); }
  private directory(root: string) {
    const directories = lifeDirectories(root);
    for (const dir of directories) {
      if (!existsSync(dir)) mkdirSync(dir, {mode: 0o700});
      const stat = lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('生活数据目录无效');
    }
    return directories[2];
  }
  private async synchronize() {
    this.assertOpen();
    if (this.binding ? this.isCurrentBinding(this.binding) : !this.current()) return;
    const scope = this.host.workspace.homeScope();
    await this.stopRuntime();
    this.assertOpen();
    if(!sameHomeBinding(this.host.workspace.homeScope(),scope))reject('STALE_BINDING','生活工作区已切换');
    this.binding = undefined; this.enabled = false; this.restoredClock=false;this.pauses=undefined;this.fault = undefined;
    const current = this.current();
    if (!current || !scope) return;
    const directory = this.directory(current.path);
    for (const name of ['home.json', 'life.json']) safeLifeFile(join(directory, name));
    const settings=readLifeSettings(current.path);
    this.enabled=settings?.enabled ?? false;
    this.restoredClock=this.enabled;
    this.pauses=settings?.pauses;
    this.preferences=settings?.preferences ?? {...defaultLifePreferences};
    const storageId=scope.storageId;
    const home = createHomeStore(createLifeStore(directory,this.timeZone),directory,this.host.workspace,scope,
      ()=>{
        this.living.changed(scope);
        this.notifyLife(scope);
      });
    const bound: Bound = {id: current.id, path: current.path, directory, library: this.host.records.getLibrary(current.id),
      plan:new PersistentLifePlan(directory,this.host.workspace.runtime.identity().companionId,storageId,this.timeZone,
        ()=>this.isCurrentBinding(bound),()=>this.notifyWorld(bound)),scope,home};
    this.binding = bound;
    const record = this.host.workspace.readCompanionHome(scope);
    if (record?.arrivalPending) this.applyHomeArrival(scope,record.sessionId);
  }
  applyHomeArrival(scope: HomeBinding, sessionId: string): boolean {
    const bound = this.binding;
    if (!bound || !this.isOpen() || !this.isCurrentBinding(bound)) return false;
    try {
      const record = this.host.workspace.readCompanionHome(scope);
      if (scope.generation !== bound.scope.generation || record?.sessionId !== sessionId) return false;
      if (record.arrivalPending && bound.home.applyArrival(sessionId)) this.runtime?.reschedulePlan();
      return true;
    } catch (error) {
      this.fault = String(error);
      return false;
    }
  }
  private notifyWorld(bound: Bound) {
    this.living.changed(bound.scope);
  }
  private async startRuntime(resumed = false) {
    if (this.runtime || !this.binding || !this.enabled || !this.isOpen()) return;
    const bound = this.binding, native = this.native(), host = this.host;
    const canStart = () => this.isOpen() && this.enabled && this.isCurrentBinding(bound);
    lookupLifeOutlet(this.ctx, host, 'desktop')?.pause();
    await this.ctx.get('petTranscripts')?.restore();
    if (!canStart()) return;
    // Foreground Room and Life share Core's single-flight opener. Its moveIn
    // records World's pending arrival, so reusing this home does not skip it.
    await resolveCompanionHome(this.ctx, this.host, this.preset);
    if (!canStart()) return;
    const {store} = bound.home;
    const active = () => this.runtime === runtime && canStart();
    const canWrite = () => (this.runtime === runtime || this.drainingRuntime === runtime) && this.isCurrentBinding(bound);
    const member = (id: string) => active() && this.current()?.sessionIds.includes(id) === true
      && !native.get('workspaceRegistry')?.archivedSessionIds.includes(id) && !host.native.isGuest(id);
    const runtime: Runtime = createLifeRuntime({
      ctx: this.ctx, store: {...store,
        write: state=>{
          if(!canWrite())throw Error('生活工作区或执行通道已变化');
          store.write(state);
        },
        appendWake: wake=>{if(canWrite())store.appendWake(wake);},
      },
      config: {worldId: this.host.workspace.storageId(), agentPreset: this.preset, timeZone: this.timeZone, companionName: this.host.workspace.runtime.identity().displayName},
      names: {get companion() {return host.workspace.runtime.identity().displayName;}, partner:'伙伴'},
      options: {worldDir: bound.directory, roomDir: bound.path, diaryDir: bound.library.paths.diaryDir, selfFile: bound.library.paths.selfFile, timeZone: this.timeZone,
        schedule: () => this.preferences, alarmFile: REVIEW_ALARM_FILE},
      dailyBudget: () => this.preferences.dailyBudget ?? undefined,
      // The upstream runtime only forwards this store to photoTools.
      photos: () => bound.library.photoTools as ReturnType<NonNullable<LifeDeps['photos']>>,
      reviewDiaryStatus: (day,session,messageId) => {
        if(!active() || !member(session.id))throw Error('Review workspace or home changed');
        return reviewDiaryStatus(host,{id:bound.id,directory:bound.library.paths.directory,timeZone:this.timeZone,
          sessionIds:this.current()!.sessionIds,isHome:id=>this.isHome(id)},day,session,messageId);
      },
      afterReview: () => {
        if(!active() || !this.preferences.compactAfterReview || !this.running())return;
        const id = host.workspace.readCompanionHome(bound.scope)?.sessionId;
        if (id) host.native.requestReviewCompaction(id);
      },
      inWorkspace: id => canWrite()
        && this.current()?.sessionIds.includes(id) === true && !host.native.isGuest(id),
      alarmContext: () => [this.living.get('body')?.promptLine(bound.id),bound.plan.summary()].filter(Boolean).join('\n'),
      hasCurrentPlan: () => !!bound.plan.read().plan,
      requirePlanningDecision: true,
      planningRepairAttempts: () => this.preferences.planningRepairAttempts ?? 1,
      // Native alarm tools and failure retries must share the same intent
      // queue as plan replacement, body controls and the execution tick.
      // Keep the hooks below synchronous: the runtime queues the whole change.
      serializePlanChange: work => this.enqueue(async () => {
        if(!active())throw Error('生活工作区或执行通道已变化，请刷新当前计划');
        return work();
      }),
      setNextConsideration: (at,note,reason) => bound.plan.setNextConsideration(at,note,reason),
      onPlanningFailure: (at,reason) => bound.plan.retryAt(at,reason),
      facts: {
        pending:async()=> (await this.pendingFacts(bound,active)).map(fact=>({domain:fact.domain,id:fact.id})),
        read:async refs=>{
          const sources=new Map(FACT_DOMAIN_NAMES.map(domain=>[domain,this.factSource(domain)]));
          const validate=()=>{
            if(!active())throw Error('互动事实工作区已切换');
          };
          const facts=await withLivingCaller(validate,()=>readFactReferences(bound.id,refs,domain=>{
            const source=sources.get(domain);
            return source?.isCurrent() ? source.value : undefined;
          },validate));
          return {facts,text:presentFacts(facts)};
        },
        confirmAdmission:(sessionId,messageId,sourceDigest)=>this.inFlight.run(async()=>{
          if(!active() || !this.current()?.sessionIds.includes(sessionId))throw Error('原互动事实会话已离开绑定工作区');
          const matches=(events:readonly any[])=>events.some(event=>event.type==='user/message' && event.data.id===messageId
            && createHash('sha256').update(JSON.stringify(event.data.source)).digest('hex')===sourceDigest);
          const session=this.ctx.sessions.get(sessionId as SessionId);
          if(session) {
            if(!await this.ctx.sessions.flush(session))throw Error('原互动事实的原生记录尚未持久化');
            if(!active())throw Error('原互动事实工作区已切换');
            return matches(session.snapshotEvents());
          }
          // An archived/disposed home need not be reactivated merely to finish
          // acknowledgement. Read its original native log without another agent.
          const reader=await native.get('sessionPersistence').open(sessionId,'read');
          try {
            const events=(await reader.read()).events;
            if(!active())throw Error('原互动事实工作区已切换');
            return matches(events);
          }
          finally {await reader.close();}
        }),
        acknowledge:async refs=>{
          for(const domain of FACT_DOMAIN_NAMES) {
            const ids=refs.filter(ref=>ref.domain===domain).map(ref=>ref.id);if(!ids.length)continue;
            if(!active())throw Error('互动事实工作区已切换');
            const source=this.factSource(domain);if(!source)throw Error('互动事实所属组件暂不可用');
            const validate=()=>{if(!active() || !source.isCurrent())throw Error('互动事实所属组件已变化');};
            await withLivingCaller(validate,()=>source.value.acknowledgeFacts(bound.id,ids));validate();
          }
        },
      },
      host: {
        workspace: async () => {
          const current = this.current();
          if (current?.id !== bound.id || current.path !== bound.path) throw Error('生活工作区已切换');
          return current;
        },
        createSession: async (_cwd, agentPreset, workspaceId) => {
          if (!active() || workspaceId!==bound.id) throw Error('生活工作区已切换');
          const id = await ensureCompanionHomeSession(this.ctx,host,bound.scope,agentPreset);
          if(!member(id))throw Error('生活会话不属于当前工作区');
          bound.home.refresh();
          return id;
        },
        resolveAgent: async id => {
          if(!active())throw Error('生活工作区已切换');
          const agent = await resolveHomeAgent(this.ctx,host,bound.scope,id);
          if(!active() || agent && !member(id))throw Error('生活工作区已切换');
          return agent;
        },
        isArchived: id => native.get('workspaceRegistry')?.archivedSessionIds.includes(id) ?? false,
        rename: async (sessionId, title) => {
          if(!member(sessionId))throw Error('生活会话不属于当前工作区');
          await native.get('sessionController').rename({sessionId, title});
          if(!active())throw Error('生活工作区已切换');
        },
        origin: () => native.get('webServer')?.getOrigin() ?? '',
      },
      notifier: {outlets: [{get name() {return host.workspace.runtime.identity().displayName || '伙伴';}, kinds: ['reach'], send: async push => {
        if (!active()) throw Error('生活已停止');
        if (this.host.workspace.runtime.policy().quiet) throw Error('安静模式中，主动消息未发送');
        const desktop = lookupLifeOutlet(this.ctx, host, 'desktop');
        let delivered = false;
        try { delivered = desktop?.present(push.text,push.image) ?? false; }
        catch (error) { this.ctx.logger.warn('Life presentation delivery failed',error); }
        const results = await lookupLifeOutlet(this.ctx, host, 'channels')?.reach(bound.id, push) ?? [];
        if (!delivered && !results.some(result => result.status === 'fulfilled')) throw Error('当前没有送达主动消息的渠道');
      }}]},
    });
    this.runtime = runtime;
    try {
      await runtime.start({resumed});
    } catch (error) {
      runtime.stop();
      if(this.runtime===runtime) {
        this.runtime = undefined;
        this.notifyWorld(bound);
      }
      throw error;
    }
    if(active()) {
      this.notifyWorld(bound);
      this.notifyLife(bound.scope);
    }
  }
  private async stopRuntime(pausing?: Bound) {
    const runtime = this.runtime;
    let bodyError:unknown;
    try {
      if(pausing) {
        const body = this.living.lookup('body');
        const validate = () => {
          this.assertCurrentBinding(pausing);
          if (body && !body.isCurrent()) throw Error('生活区已变化');
        };
        validate();
        const saved=pausing.plan.read();
        if(saved.plan && ['active','waiting'].includes(saved.plan.status)) {
          await pausing.plan.control(saved.revision,'pause','Autonomous life paused',body?.value,pausing.id,validate);
          validate();
          pausing.plan.markAutoResume(true);
        }
        if (body) await withLivingCaller(validate,()=>body.value.setAutonomy(pausing.id,false));
      }
    }catch(error){bodyError=error;}
    // A stale or unavailable optional body must never prevent cancellation of
    // the old native home after rebinding or during component disposal.
    if(runtime && this.runtime===runtime){
      this.drainingRuntime = runtime;
      this.runtime = undefined;
      if(this.binding) {
        this.notifyWorld(this.binding);
        this.notifyLife(this.binding.scope);
      }
      const id = this.living.isLatestGeneration() ? this.binding?.home.sessionId() : undefined;
      await settleCleanup(
        ()=>runtime.stop(),
        async()=>{if(id)await this.native().get('sessionController').cancel({sessionId:id});},
        async()=>{
          try { await runtime.settled(); }
          finally { if(this.drainingRuntime===runtime)this.drainingRuntime=undefined; }
        },
      );
    }
    if(bodyError)throw bodyError;
  }
  private async tick() {
    if (!this.isOpen()) return;
    await this.synchronize();
    if (!this.enabled || !this.binding) return;
    const bound=this.binding;
    const body=this.living.lookup('body'), validate=this.guardArea(body,()=>this.assertCurrentBinding(bound));
    let advanced=false;
    if(body) {
      const behavior=body.value;
      await this.resumeAcceptedPlan(bound,body);validate();
      const before=bound.plan.read().plan;
      advanced=await bound.plan.advance(bound.id,behavior,validate);validate();
      this.scheduleContinuation(before,bound.plan.read().plan);
      await withLivingCaller(validate,()=>behavior.setReconsiderConditions(bound.id,bound.plan.read().plan?.reconsiderWhen ?? []));
      validate();
    }
    await this.startRuntime();
    validate();
    if(advanced)this.runtime?.reschedulePlan();
    this.runtime?.notifyFacts();
  }
  private scheduleContinuation(before: CurrentLifePlan | null, after: CurrentLifePlan | null) {
    // A committed completion schedules the next accepted step even if a
    // later native startup or observer fails.
    if(before && after?.id===before.id && after.cursor>before.cursor && after.status==='active' &&
      after.cursor<after.steps.length && !after.replanReason)this.scheduleTick();
  }
  private async resumeAcceptedPlan(bound:Bound,body=this.living.lookup('body')) {
    if(!this.enabled||!this.isOpen()||!this.isCurrentBinding(bound))return;
    const saved=bound.plan.read();
    if(saved.plan?.resumeOnEnable&&saved.plan.status==='paused') {
      const validate=this.guardArea(body,()=>this.assertCurrentBinding(bound));
      await bound.plan.control(saved.revision,'resume','Autonomous life resumed',body?.value,bound.id,validate);
      validate();
      bound.plan.markAutoResume(false);
    }
  }
  private factSource(domain:FactDomain) {
    return this.living.lookup(domain);
  }
  private async pendingFacts(bound:Bound,active:()=>boolean):Promise<CompanionFact[]> {
    if(!active())throw Error('互动事实工作区已切换');
    const sources=FACT_DOMAIN_NAMES.map(domain=>this.factSource(domain));
    const results=await Promise.all(sources.map(async source=>{
      if(!source?.value.pendingFacts)return [];
      const validate=()=>{if(!active() || !source.isCurrent())throw Error('互动事实所属组件已变化');};
      const facts=await withLivingCaller(validate,()=>source.value.pendingFacts(bound.id));validate();
      return facts;
    }));
    return results.flat().sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id));
  }
  snapshot(workspaceId: string) {
    return this.enqueue(async () => {
      await this.synchronize();
      if (this.binding?.id !== workspaceId) throw Error('生活工作区已切换');
      const store = createLifeStore(this.binding.directory, this.timeZone);
      const body=this.living.lookup('body'), validate=this.guardArea(body);
      const state={workspaceId,enabled:this.enabled,running:this.running(),timeZone:this.timeZone,preferences:{...this.preferences}};
      const home=await (body && withLivingCaller(validate,()=>body.value.roomState(workspaceId)));
      validate();
      return {...state, home: home ?? null,
        life: this.runtime?.snapshot() ?? this.binding.home.store.read(),
        activity: store.activityDays().slice(0, 2).reverse().flatMap(day => store.activity(day)).slice(-20),
        fault: this.fault ?? null};
    });
  }
  /** Synchronous, read-only prompt projection; no implicit scheduling or model calls. */
  currentPlanSummary(workspaceId:string) {
    const current=this.current(),bound=this.binding;
    if(!this.isOpen()||current?.id!==workspaceId)return '';
    let summary:string;
    if(bound?.id===workspaceId && bound.path===current.path)summary=bound.plan.summary();
    else {
      // Prompt assembly may occur inside native Life startup. Do not enqueue
      // behind startup or create files: read the already persisted record only.
      const file=join(current.path,'.chatpet','data','life','life.json');safeLifeFile(file);
      if(!existsSync(file))summary=JSON.stringify({revision:0,plan:null});
      else {
        if(lstatSync(file).size>64*1024)throw Error('生活状态超出可读取范围，原文件已保留');
        const state=JSON.parse(readFileSync(file,'utf8'));
        summary=PersistentLifePlan.describe(PersistentLifePlan.decode(state,this.host.workspace.runtime.identity().companionId,this.host.workspace.storageId()));
      }
    }
    return `【当前生活计划】自主生活${this.running()?'运行中':'未运行'}。以下是持久计划与实际执行回执；意图不等于完成。\n${summary}`;
  }
  private async checkedPlan(workspaceId:string) {
    await this.synchronize();
    this.assertOpen();
    if(!this.binding || this.binding.id!==workspaceId)throw Error('生活工作区已切换');
    return this.binding;
  }
  readPlan(workspaceId:string,validate:()=>void=()=>{}) {
    return this.enqueue(async()=>{
      const bound=await this.checkedPlan(workspaceId);validate();
      return {enabled:this.enabled,running:this.running(),...bound.plan.read()};
    });
  }
  readonly worldCommands: Pick<WorldCommands, 'executePlanStep' | 'confirmReading'> = {
    executePlanStep: ({expectedRevision,planId,stepId,...request}, options) =>
      this.living.command(this.host, request, options, ({validate,effect}) => {
        integer(expectedRevision,'plan revision');text(planId,'plan id');text(stepId,'step id');
        return this.enqueue(async () => {
          validate();
          const bound=await this.checkedPlan(request.workspaceId);validate();
          const {revision,plan}=bound.plan.read();
          if(revision!==expectedRevision || plan?.id!==planId || plan.steps[plan.cursor]?.id!==stepId)
            reject('STALE_REVISION','生活计划或当前步骤已变化，请重新读取');
          if(!this.enabled)reject('DISABLED','自主生活已暂停');
          if(plan.status!=='active' && plan.status!=='waiting')reject('INELIGIBLE','当前计划不能执行步骤');
          const body=this.living.lookup('body');
          if(!body)unavailable('共享身体组件尚未启用');
          const admit=()=>{validate();if(!body.isCurrent())reject('STALE_BINDING','共享身体组件已变化');};
          const operationId=`life:${plan.id}:${stepId}`;
          effect('none',operationId);
          const advanced=await bound.plan.advance(bound.id,body.value,admit,effect);
          admit();
          const after=bound.plan.read().plan;
          const receipt=after?.execution as PlannedExecution | undefined;
          const execution=receipt?.operationId===operationId ? receipt : null;
          this.scheduleContinuation(plan,after);
          if(advanced)this.runtime?.reschedulePlan();
          const awaitingReceipt=after?.status==='waiting' && after.operationId===operationId &&
            (!execution || execution.status==='running');
          if(after?.replanReason && (!awaitingReceipt && !execution ||
            after.triggeredConditions.some(condition=>!plan.triggeredConditions.includes(condition)))) {
            effect('none');
            reject('STALE_REVISION',after.replanReason);
          }
          if(awaitingReceipt) {
            // The existing recovery record preserves this specific refusal before dispatch.
            if(after.pauseReason===`Error: ${expiredDispatchDeadline}`) {
              effect('none');
              reject('INELIGIBLE',expiredDispatchDeadline);
            }
            effect('unknown');
            throw Error(after.replanReason ?? '原步骤的派工结果待核对');
          }
          return {operationId,execution};
        });
      }),
    confirmReading: ({expectedRevision,operationId,receiptToken,...request}, options) =>
      this.living.command(this.host, request, options, async admission => {
        integer(expectedRevision,'plan revision');text(operationId,'reading operation',160);text(receiptToken,'reading receipt token',160);
        const {execution}=await this.confirmPlannedReading(request.workspaceId,expectedRevision,operationId,receiptToken,admission.validate,admission);
        return execution;
      }),
  };
  updatePlan(workspaceId:string,expectedRevision:number,raw:unknown,validate:()=>void=()=>{}) {
    const draft=parsePlanDraft(raw);
    return this.enqueue(async()=>{
      const bound=await this.checkedPlan(workspaceId);validate();
      const body=this.living.lookup('body'), admit=this.guardArea(body,validate);
      const result=await bound.plan.commit(expectedRevision,draft,body?.value,workspaceId,admit);admit();
      this.runtime?.reschedulePlan();this.notifyLife(bound.scope);
      return {enabled:this.enabled,running:this.running(),...result};
    });
  }
  keepPlan(workspaceId:string,expectedRevision:number,reason:string,nextConsiderAt:string|null,validate:()=>void=()=>{}) {
    return this.enqueue(async()=>{
      const bound=await this.checkedPlan(workspaceId);validate();
      const result=bound.plan.keep(expectedRevision,reason,nextConsiderAt);
      this.runtime?.reschedulePlan();this.notifyLife(bound.scope);return result;
    });
  }
  private checkReadingPlan(bound:Bound,expectedRevision:number,operationId:string,allowCompleted=false,contract=false) {
    const current=bound.plan.read(),plan=current.plan;
    const active=plan?.operationId===operationId && plan.steps[plan.cursor]?.kind==='read';
    const completed=allowCompleted && plan?.steps.slice(0,plan.cursor).some(step=>step.kind==='read' && operationId===`life:${plan.id}:${step.id}`);
    if(current.revision!==expectedRevision || !plan || !(active || completed) || !['active','waiting'].includes(plan.status)) {
      const message='Reading requires the current plan revision and its active original reading operation';
      if(contract)reject('STALE_REVISION',message);
      throw Error(message);
    }
    if(!this.running()) {
      const message='Resume autonomous Life before progressing a planned reading activity';
      if(contract)reject('DISABLED',message);
      throw Error(message);
    }
    return plan;
  }
  readPlannedSegment(workspaceId:string,expectedRevision:number,operationId:string,validate:()=>void=()=>{}) {
    return this.enqueue(async()=>{
      const bound=await this.checkedPlan(workspaceId);
      const guard=()=>{validate();this.checkReadingPlan(bound,expectedRevision,operationId);};guard();
      const body=this.behavior(), admit=this.guardArea(body);
      const segment=await withLivingCaller(admit,()=>body.value.readPlannedSegment(workspaceId,operationId,guard));admit();guard();
      return {...segment,operationId,confirmation:'Read this actual text before calling life_read_confirm with the returned receiptToken. Receiving an animation or owning the item does not advance the bookmark or establish understanding.'};
    });
  }
  confirmPlannedReading(workspaceId:string,expectedRevision:number,operationId:string,receiptToken:string,validate:()=>void=()=>{},
    command?: CommandAdmission) {
    return this.enqueue(async()=>{
      command?.validate();
      const bound=await this.checkedPlan(workspaceId);
      const guard=()=>{validate();return this.checkReadingPlan(bound,expectedRevision,operationId,true,!!command);};
      const original=guard();
      const body=this.behavior(), admit=this.guardArea(body,validate);
      const execution=await withLivingCaller(admit,()=>body.value.confirmPlannedReading(workspaceId,operationId,receiptToken,guard,command?.effect));admit();guard();
      if(command && original.operationId!==operationId)return {execution,...bound.plan.read()};
      // Completion is still accounted by the same persistent-plan executor.
      // The tool's confirmation records actual text receipt, never comprehension.
      await bound.plan.advance(workspaceId,body.value,admit);admit();
      this.runtime?.reschedulePlan();this.notifyLife(bound.scope);return {execution,...bound.plan.read()};
    });
  }
  controlPlan(workspaceId:string,expectedRevision:number,action:'pause'|'resume'|'cancel',reason:string,validate:()=>void=()=>{}) {
    if(!['pause','resume','cancel'].includes(action) || typeof reason!=='string' || !reason.trim())throw Error('Invalid life activity control');
    return this.enqueue(async()=>{
      const bound=await this.checkedPlan(workspaceId);validate();
      if(action==='resume' && !this.running())throw Error('Enable autonomous Life before resuming; this tool does not change that setting');
      const body=this.living.lookup('body'), admit=this.guardArea(body,validate);
      const result=await bound.plan.control(expectedRevision,action,reason,body?.value,workspaceId,admit);admit();
      this.runtime?.reschedulePlan();this.notifyLife(bound.scope);return result;
    });
  }
  private writeControl(bound: Bound, enabled: boolean, preferences: LifePreferences, pauses: readonly GardenPause[] | undefined) {
    const file = join(bound.directory, 'control.json'); safeLifeFile(file);
    if (pauses?.some(pause=>pause.to!==null)) {
      let committedAt: number | undefined;
      try { committedAt=this.living.get('economy')?.committedGardenAt(bound.id); }
      catch { /* An unavailable Economy leaves the interval history intact. */ }
      const at=committedAt;
      if (at!==undefined) pauses=pauses.filter(({to})=>to===null || to>at);
    }
    this.assertCurrentBinding(bound);
    durableWrite(file, JSON.stringify({version:1, enabled, preferences, pauses}, null, 2));
    this.pauses=pauses;
  }
  control(workspaceId: string, enabled: boolean, validate?: () => void) {
    return this.enqueue(async () => {
      // A queued pause may finish on its existing binding during disposal.
      if (this.isOpen()) await this.synchronize();
      if (enabled) this.assertOpen();
      const bound = this.binding;
      if (bound?.id !== workspaceId) throw Error('生活工作区已切换');
      validate?.();
      const changed=enabled!==this.enabled;
      const pauses=changed ? recordGardenPause(this.pauses,enabled,Date.now()) : this.pauses;
      this.writeControl(bound,enabled,this.preferences,pauses);
      this.enabled = enabled;this.restoredClock=false;this.fault = undefined;
      if(changed)this.notifyWorld(bound);
      // Body observes committed intent now, before native home/model startup.
      this.notifyLife(bound.scope,enabled);
      if (enabled) {
        await this.resumeAcceptedPlan(bound);
        await this.startRuntime(true);
      }
      else {
        if (this.isOpen()) this.publishRest();
        await this.stopRuntime(bound);
      }
      return {enabled, running: this.running()};
    }, {finishOnClose: !enabled});
  }
  act(workspaceId: string, action: string, requestId?:string, channel='settings', validate?: () => void) {
    if (!isCareAction(action)) return Promise.reject(Error('未知的生活动作'));
    return this.forwardToBody(body=>body.act(workspaceId,action,requestId,channel),validate);
  }
  private behavior() {
    this.assertOpen();
    const behavior = this.living.lookup('body');
    if (!behavior) throw Error('共享身体组件尚未启用');
    return behavior;
  }
  private forwardToBody<T>(work:(body:CompanionBehavior)=>Promise<T>, caller?: () => void):Promise<T> {
    const body=this.behavior(), validate=this.guardArea(body,caller);
    return this.inFlight.run(async()=>{
      const result=await withLivingCaller(validate,()=>work(body.value));
      validate();return result;
    });
  }
  /** Compatibility methods delegate; Behavior remains available after Life unload. */
  roomAction(workspaceId: string, input: unknown, by = '伙伴') {
    return this.forwardToBody(body=>body.roomAction(workspaceId,input,by));
  }
  roomState(workspaceId: string) { return this.forwardToBody(body=>body.roomState(workspaceId)); }
  garden(workspaceId: string, operation: 'state' | 'act' | 'control', input?: unknown) {
    return this.forwardToBody(body=>body.garden(workspaceId,operation,input));
  }
  settings(workspaceId: string, expected: unknown, next: unknown, validate?: () => void) {
    return this.enqueue(async () => {
      await this.synchronize();
      this.assertOpen();
      const bound = this.binding;
      if (!bound || bound.id !== workspaceId) throw {code: 'STALE_BINDING'};
      const preferences = parseLifePreferences(next);
      if (JSON.stringify(parseLifePreferences(expected)) !== JSON.stringify(this.preferences)) throw {code: 'STALE_REVISION'};
      const before = this.preferences;
      validate?.();
      this.writeControl(bound,this.enabled,preferences,this.pauses);
      this.preferences = preferences;
      if (before.wake !== preferences.wake || before.review !== preferences.review) this.runtime?.reschedule();
      return {preferences};
    });
  }
  library(workspaceId: string, operation: RecordOperation, input?: unknown) {
    this.assertOpen();
    return this.inFlight.run(()=>this.host.records.library(workspaceId,operation,input));
  }
  close(): Promise<void> {
    if(this.closing)return this.closing;
    this.closed = true; clearTimeout(this.timer);this.timer=undefined;this.tickGuards=[];
    const subscriptions=this.subscriptions.splice(0);
    return this.closing=settleCleanup(
      ()=>this.sourceRegistration?.revoke(),
      ...subscriptions,
      ()=>{if(subscriptions.length)this.publishRest();},
      ()=>this.stopRuntime(),
      async()=>{await this.serial;},
      ()=>this.inFlight.settled(),
    ).finally(()=>{this.binding=undefined;});
  }
}
export const name = '40-Life';
export const inject = ['petCore', 'petWorld', 'agents', 'sessions', 'tools', 'systemPrompt'];
export interface Config { agentPreset?: string }
declare module '@deepseek-ai/cordis' {
  interface Context { petLife: CompanionLife }
}
export function lifeConsoleOperations(life: Pick<CompanionLife, 'snapshot' | 'control' | 'act' | 'settings'>) {
  const lifeView: ConsoleOperation = call => {
    const {workspaceId} = object(call.input, ['workspaceId']);
    call.checkBinding(workspaceId, true);
    return life.snapshot(workspaceId as string);
  };
  const lifeControl: ConsoleOperation = call => {
    const {workspaceId, enabled} = object(call.input, ['workspaceId', 'enabled']);
    call.checkBinding(workspaceId, true);
    if (typeof enabled !== 'boolean') fail('INVALID_ARGUMENT');
    return life.control(workspaceId as string, enabled, call.validate);
  };
  const lifeAction: ConsoleOperation = call => {
    const {workspaceId, action} = object(call.input, ['workspaceId', 'action']);
    call.checkBinding(workspaceId, true);
    if (!isCareAction(action)) fail('INVALID_ARGUMENT');
    return life.act(workspaceId as string, action, call.requestId, 'settings', call.validate);
  };
  const lifePreferences: ConsoleOperation = call => {
    const {workspaceId, expected, next} = object(call.input, ['workspaceId', 'expected', 'next']);
    const id = requiredText(workspaceId, 200);
    call.checkBinding(id);
    return life.settings(id, expected, next, call.validate);
  };
  return {operations: {lifeView, lifeControl, lifeAction, lifePreferences}};
}

export function apply(ctx: Context, config: Config = {}) {
  const host = ctx.petCore;
  return mountLivingArea(ctx,host,'plan',view=>new CompanionLife(ctx,host,config.agentPreset ?? 'standard',view),(life,view)=>{
    life.activate();
    ctx.provide('petLife', life);
    ctx.effect(() => host.native.consoleOperations.register('life', lifeConsoleOperations(life), ctx).revoke);
    life.registerSource();
    ctx.effect(() => host.workspace.runtime.capabilityTable.register({
      id: 'life.pursuits', owner: 'life', contractVersion: CONTRACT_VERSION, order: 3,
      status: () => {
        const bound = host.workspace.status().state === 'ready';
        const running = bound && life.running();
        return {
          state: bound ? running ? 'ready' : 'disabled' : 'unavailable',
          reason: bound ? running ? null : 'Life is paused' : 'Bind a workspace to start Life',
          supportedOperations: ['start', 'stop', 'inspect', 'interact'],
        };
      },
    }).revoke);
    const ports = host.native.companionPorts;
    if (!ports.scopeFor(ctx, 'petLife')) return;
    const isHome = (id: string) => view.lookup('plan')?.value === life && life.isHome(id);
    const album = ports.register('lifeOwnsAlbum', isHome);
    const review = ports.register('isRunningLifeHome', isHome);
    const arrival = ports.register('applyHomeArrival', (scope,sessionId) =>
      view.lookup('plan')?.value === life && life.applyHomeArrival(scope,sessionId));
    return () => settleCleanup(album.revoke, review.revoke, arrival.revoke);
  });
}
