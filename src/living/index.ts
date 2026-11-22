import {Context, FiberState, type Fiber} from '@deepseek-ai/cordis';
import type {PetCoreHost} from '../core/index.js';
import {RegistrationTable} from '../core/tables/registry.js';
import type {HomeBinding} from '../core/workspace.js';
import {Rejection, reject, text} from '../core/storage.js';
import type {CallOptions, ContractError, Result} from '../contracts/common.js';
import {FACT_DOMAIN_NAMES, factDomainOf, type CompanionFactSource} from '../contracts/interaction.js';
import type {WorldChanged, WorldCommandRequest, WorldSnapshot} from '../contracts/living.js';
import type {RegistrationLease, TableRegistration} from '../contracts/tables.js';
import type {CompanionBehavior} from './body/plugin.js';
import type {CompanionLife} from './plan/plugin.js';
import type {CompanionEconomy} from './economy/plugin.js';
import {activityReader} from './plan/activity-reader.js';
import {readFactReferences} from './plan/facts.js';
import {installLivingPrompt} from './prompt-context.js';

interface Areas {body: CompanionBehavior; plan: CompanionLife; economy: CompanionEconomy}
type Area = keyof Areas;
const bodyService = 'petBehavior', lifeService = 'petLife', economyService = 'petEconomy';
const services = {body: bodyService, plan: lifeService, economy: economyService};
type Labels = Record<Area, symbol>;
interface Slot<T> {
  table: RegistrationTable<{value: T; fiber: Fiber}>;
  generation?: symbol;
}
type Slots<T> = Map<symbol, Slot<T>>;
interface Domain {
  worlds: Set<LivingWorld>;
  slots: {[K in Area]: Slots<Areas[K]>};
  changes: Map<string, {valid: () => boolean; bodyOnly: boolean; bodyObservation?: WorldChanged['bodyObservation']}[]>;
  lastNotifiedBinding?: HomeBinding;
  core?: {areas: number; dispose(): void | Promise<void>};
}
const domains = new WeakMap<Context, WeakMap<PetCoreHost, Domain>>();

declare module '@deepseek-ai/cordis' {
  interface Events {'world.changed'(value: WorldChanged): void}
}

export function sameHomeBinding(current: HomeBinding | undefined, captured: HomeBinding | undefined) {
  return current === captured || !!current && !!captured && current.workspaceId === captured.workspaceId &&
    current.path === captured.path && current.storageId === captured.storageId &&
    current.bootId === captured.bootId && current.generation === captured.generation;
}

export function serviceLabel(contextScope: Context, name: string) {
  const defaults = contextScope.root[Context.isolate];
  defaults[name] ??= Symbol(name);
  return contextScope[Context.isolate][name];
}

function labelsOf(contextScope: Context): Labels {
  const label = (name: string) => serviceLabel(contextScope, name);
  return {body: label(services.body), plan: label(services.plan), economy: label(services.economy)};
}

export interface AreaReference<T> {
  readonly value: T;
  isCurrent(): boolean;
}

function currentArea<T>(slot: Slot<T> | undefined, area: Area): (AreaReference<T> & {lease: RegistrationLease}) | undefined {
  const entry = slot?.table.get(area);
  if (!entry) return;
  const {lease, value: {value, fiber}} = entry;
  const isCurrent = () => lease.isCurrent() && fiber.state === FiberState.ACTIVE;
  if (isCurrent()) return {value, lease, isCurrent};
}

export class LivingWorld {
  private entries = 0;

  private constructor(private readonly domain: Domain, private readonly labels: Labels) {}

  private static matching(domain: Domain, labels: Labels) {
    return [...domain.worlds].find(world => world.labels.body === labels.body &&
      world.labels.plan === labels.plan && world.labels.economy === labels.economy);
  }

  static find(ctx: Context, host: PetCoreHost) {
    const domain = domains.get(ctx.root)?.get(host);
    return domain && this.matching(domain, labelsOf(ctx));
  }

  static lookupPlan(ctx: Context, host: PetCoreHost) {
    const domain = domains.get(ctx.root)?.get(host);
    return domain && currentArea(domain.slots.plan.get(serviceLabel(ctx, lifeService)), 'plan')?.value;
  }

  static retain(ctx: Context, host: PetCoreHost, area: Area) {
    const root = ctx.root;
    let hosts = domains.get(root);
    if (!hosts) domains.set(root, hosts = new WeakMap());
    let domain = hosts.get(host);
    if (!domain) {
      domain = {worlds: new Set(), slots: {body: new Map(), plan: new Map(), economy: new Map()}, changes: new Map()};
      hosts.set(host, domain);
    }
    const labels = labelsOf(ctx);
    const world = this.matching(domain, labels) ?? new LivingWorld(domain, labels);
    domain.worlds.add(world);
    world.entries++;
    return {world, release: (generation?: symbol) => {
      const slots = domain.slots[area], label = labels[area];
      const slot = slots.get(label);
      if (slot && slot.generation === generation && !slot.table.get(area)) slots.delete(label);
      if (--world.entries === 0) domain.worlds.delete(world);
      if (!domain.worlds.size) hosts.delete(host);
    }};
  }

  retainCore(ctx: Context, host: PetCoreHost, area: Area) {
    const ports = host.native?.companionPorts;
    if (!ports) return;
    const scope = ports.scopeFor(ctx, services[area]);
    if (!scope) return;
    if (!this.domain.core) {
      const labels = labelsOf(scope.ctx);
      const world = LivingWorld.matching(this.domain, labels) ?? new LivingWorld(this.domain, labels);
      const visible = () => world.lookup('body') || world.lookup('plan') || world.lookup('economy');
      const dispose = scope.ctx.effect(() => {
        const activity = ports.register('activities', {
          activityDays:binding => visible() ? activityReader.activityDays(binding) : [],
          activity:(binding, day) => visible() ? activityReader.activity(binding, day) : [],
        });
        try {
          const stopPrompt = installLivingPrompt(scope.ctx, host, world, scope.ownerScope);
          return () => settleCleanup(activity.revoke, stopPrompt);
        } catch (error) {
          void activity.revoke();
          throw error;
        }
      });
      this.domain.core = {areas:0, dispose};
    }
    const core = this.domain.core;
    core.areas++;
    return () => {
      if (--core.areas) return;
      this.domain.core = undefined;
      return core.dispose();
    };
  }

  register<K extends Area>(area: K, value: Areas[K], fiber: Fiber) {
    const slots: Slots<Areas[K]> = this.domain.slots[area], label = this.labels[area];
    let slot = slots.get(label);
    if (!slot) slots.set(label, slot = {table: new RegistrationTable()});
    const registration = slot.table.register(area, {value, fiber});
    const {generation} = registration.lease;
    slot.generation = generation;
    // Revocation hides the area immediately. A replacement also fences its draining writes.
    return {...registration, isLatestGeneration: () => slot.generation === generation};
  }

  lookup<K extends Area>(area: K): (AreaReference<Areas[K]> & {lease: RegistrationLease}) | undefined {
    return currentArea<Areas[K]>(this.domain.slots[area].get(this.labels[area]), area);
  }

  bindingChanged(ctx: Context, host: PetCoreHost, valid: () => boolean) {
    if (!valid()) return;
    try {
      const binding = host.workspace.homeScope();
      if (!binding) this.domain.lastNotifiedBinding = undefined;
      else if (!sameHomeBinding(this.domain.lastNotifiedBinding, binding)) this.changed(ctx, host, valid, binding);
    } catch { /* Binding may already be unavailable during teardown. */ }
  }

  changed(ctx: Context, host: PetCoreHost, valid: () => boolean, expected?: HomeBinding, bodyOnly = false,
    bodyObservation?: WorldChanged['bodyObservation']) {
    // Notification failures cannot invalidate completed domain work.
    try {
      const binding = expected ?? host.workspace.homeScope();
      if (!binding || !sameHomeBinding(host.workspace.homeScope(), binding)) return;
      const {workspaceId, path, storageId, bootId, generation} = binding;
      const key = JSON.stringify([workspaceId, path, storageId, bootId, generation]);
      const notice = {valid, bodyOnly, bodyObservation};
      const pending = this.domain.changes.get(key);
      if (pending) { pending.push(notice); return; }
      const guards = [notice];
      this.domain.changes.set(key, guards);
      queueMicrotask(() => {
        this.domain.changes.delete(key);
        try {
          if (!sameHomeBinding(host.workspace.homeScope(), binding)) return;
          const current = guards.filter(guard => guard.valid());
          if (!current.length) return;
          this.domain.lastNotifiedBinding = binding;
          const observation = current.every(guard => guard.bodyObservation) ? current.at(-1)?.bodyObservation : undefined;
          ctx.emit('world.changed', {workspaceId, storageId, bootId, generation,
            ...(current.every(guard => guard.bodyOnly) ? {bodyOnly:true} : {}),
            ...(observation ? {bodyObservation:observation} : {})});
        } catch { /* A failed observer has no effect on the committed result. */ }
      });
    } catch { /* Binding may already be unavailable during teardown. */ }
  }
}

type AreaPorts = {[K in Area]?: () => Areas[K] | undefined};
export type LivingPorts = AreaPorts & {observe?: boolean};
export type RecordCommandEffect = (effect: ContractError['effect'], operationId?: string) => void;
export interface CommandAdmission {
  validate(): void;
  effect: RecordCommandEffect;
}

export class LivingView {
  constructor(private readonly ports: LivingPorts = {}, readonly isCurrent = () => true,
    private readonly world?: LivingWorld, readonly isLatestGeneration = isCurrent,
    readonly changed: (binding: HomeBinding, bodyOnly?: boolean,
      bodyObservation?: WorldChanged['bodyObservation']) => void = () => {}) {}

  lookup<K extends Area>(area: K): AreaReference<Areas[K]> | undefined {
    if (this.world) return this.world.lookup(area);
    const ports: AreaPorts = this.ports;
    const read = ports[area], value = read?.();
    if (value) return {value, isCurrent: () => read?.() === value};
  }

  get<K extends Area>(area: K): Areas[K] | undefined { return this.lookup(area)?.value; }

  private boundScope(host: PetCoreHost, workspaceId: string) {
    const binding = host.workspace.homeScope();
    if (!this.isCurrent() || binding?.workspaceId !== workspaceId) reject('STALE_BINDING', '生活工作区已切换或组件已停止');
    const validate = () => {
      if (!this.isCurrent() || !sameHomeBinding(host.workspace.homeScope(), binding)) reject('STALE_BINDING', '生活工作区或组件已切换');
    };
    return {binding, validate};
  }

  async command<T>(host: PetCoreHost, {workspaceId, requestId}: WorldCommandRequest, options: Pick<CallOptions, 'signal'> | undefined,
    execute: (admission: CommandAdmission) => Promise<T>): Promise<Result<T>> {
    const signal = options?.signal;
    const outcome: {effect: ContractError['effect']; operationId?: string} = {effect:'none'};
    let validateBinding: (() => void) | undefined;
    const validate = () => {
      signal?.throwIfAborted();
      validateBinding?.();
    };
    try {
      text(requestId, 'request id');
      outcome.operationId = requestId;
      validateBinding = this.boundScope(host, workspaceId).validate;
      const value = await withLivingCaller(validate, () => execute({validate, effect(effect, operationId) {
        outcome.effect = effect;
        if (operationId !== undefined) outcome.operationId = operationId;
      }}));
      validate();
      return {ok:true,value};
    } catch (error) {
      const {effect,operationId} = outcome;
      if (effect === 'none') {
        if (signal?.aborted) return {ok:false,error:{code:'CANCELLED',message:'生活命令已取消',operationId,effect,retry:'same_request'}};
        // Queue failures may use the old facade's untyped binding/cancellation error.
        if (!(error instanceof Rejection)) try { validate(); } catch (denial) { error = denial; }
        if (error instanceof Rejection) return {ok:false,error:{operationId,...error.detail}};
        return {ok:false,error:{code:'INTERNAL',message:String(error),operationId,effect,retry:'same_request'}};
      }
      const message = error instanceof Error ? error.message : String(error);
      if (effect === 'unknown')
        return {ok:false,error:{code:'OUTCOME_UNKNOWN',message,operationId,effect,retry:'reconcile'}};
      return {ok:false,error:{code:signal?.aborted ? 'CANCELLED' : 'INTERNAL',message,operationId,effect,retry:'reconcile'}};
    }
  }

  private readFrame(host: PetCoreHost, workspaceId: string, includePlan = false) {
    const scope = this.boundScope(host, workspaceId);
    const body = this.lookup('body'), economy = this.lookup('economy');
    const plan = includePlan ? this.lookup('plan') : undefined;
    const sameArea = (area: Area, ref?: AreaReference<unknown>) =>
      this.lookup(area)?.value === ref?.value && (!ref || ref.isCurrent());
    const validate = () => {
      scope.validate();
      if (!sameArea('body', body) || !sameArea('economy', economy) || (includePlan && !sameArea('plan', plan)))
        reject('STALE_BINDING', '生活工作区或组件已切换');
    };
    return {...scope, body, economy, validate};
  }

  async worldSnapshot(host: PetCoreHost, workspaceId: string): Promise<WorldSnapshot> {
    const {binding, body, economy, validate} = this.readFrame(host, workspaceId, true);
    const snapshot = body && await withLivingCaller(validate, () => body.value.snapshot(workspaceId));
    validate();
    const wallet = economy?.value.walletView(workspaceId) ?? null;
    validate();
    return {workspaceId,storageId:binding.storageId,wallet,
      body:snapshot ? {available:true,snapshot:structuredClone(snapshot)} : {available:false}};
  }

  factSource(host: PetCoreHost): CompanionFactSource {
    const references = (ids: readonly string[]) => ids.map(id => {
      const domain = factDomainOf(id);
      if (!domain) reject('INVALID_ARGUMENT', '未知互动事实所属区');
      return {domain,id};
    });
    return {
      pendingFacts: async workspaceId => {
        const frame = this.readFrame(host, workspaceId);
        const facts = await Promise.all(FACT_DOMAIN_NAMES.map(domain =>
          withLivingCaller(frame.validate, () => frame[domain]?.value.pendingFacts(workspaceId) ?? [])));
        frame.validate();
        return facts.flat().sort((a,b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
      },
      readFacts: async (workspaceId, ids) => {
        const frame = this.readFrame(host, workspaceId);
        return withLivingCaller(frame.validate, () =>
          readFactReferences(workspaceId, references(ids), domain => frame[domain]?.value, frame.validate));
      },
      acknowledgeFacts: async (workspaceId, ids) => {
        const frame = this.readFrame(host, workspaceId), refs = references(ids);
        const batches = FACT_DOMAIN_NAMES.flatMap(domain => {
          const batch = refs.filter(ref => ref.domain === domain).map(ref => ref.id);
          if (!batch.length) return [];
          const source = frame[domain]?.value;
          if (!source) throw Error('原互动事实所属组件暂不可用，保留原编号等待恢复');
          return [{source,batch}];
        });
        for (const {source,batch} of batches)
          await withLivingCaller(frame.validate, () => source.acknowledgeFacts(workspaceId, batch));
        frame.validate();
      },
    };
  }

  watch<K extends Area>(ctx: Context, area: K,
    notify: (area: AreaReference<Areas[K]> | undefined, isObserved: () => boolean) => void): () => void {
    if (!this.world && !this.ports.observe) return () => {};
    let current: AreaReference<Areas[K]> | undefined;
    let observation: symbol | undefined;
    const update = () => {
      if (!this.isCurrent()) return;
      const next = this.lookup(area);
      if (current?.value === next?.value && (!current || current.isCurrent())) return;
      const tell = (ref?: AreaReference<Areas[K]>) => {
        const generation = observation = Symbol(area);
        notify(ref, () => observation === generation);
      };
      if (current) tell();
      current = next;
      if (next) tell(next);
    };
    const stop = ctx.on('internal/status', update);
    try { update(); }
    catch (error) { stop(); throw error; }
    return () => { observation = undefined; stop(); };
  }
}

export async function settleCleanup(...steps: (() => void | Promise<void>)[]) {
  const settled = await Promise.allSettled(steps.map(async step => step()));
  const errors = settled.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  if (errors.length) throw new AggregateError(errors, 'Living area cleanup failed');
}

export function mountLivingArea<K extends Area>(ctx: Context, host: PetCoreHost, area: K,
  create: (view: LivingView) => Areas[K], start: (value: Areas[K], view: LivingView) => void | (() => void | Promise<void>),
  close: (value: Areas[K]) => void | Promise<void> = value => value.close()) {
  const {world, release} = LivingWorld.retain(ctx, host, area);
  let registration: (TableRegistration & {isLatestGeneration(): boolean}) | undefined;
  let stopPort: void | (() => void | Promise<void>), stopCore: (() => void | Promise<void>) | undefined;
  let value: Areas[K] | undefined, cleanup: Promise<void> | undefined, stopStatus: (() => void) | undefined;
  const dispose = () => cleanup ??= settleCleanup(
    () => registration?.revoke(),
    () => stopPort?.(),
    () => stopCore?.(),
    () => {if(value) return close(value);},
  ).finally(() => { stopStatus?.(); release(registration?.lease.generation); });
  try {
    ctx.effect(() => dispose);
    const active = () => world.lookup(area)?.lease === registration?.lease && registration !== undefined;
    const view = new LivingView({}, () => registration?.lease.isCurrent() === true &&
      (ctx.fiber.state === FiberState.LOADING || ctx.fiber.state === FiberState.ACTIVE), world,
      () => registration?.isLatestGeneration() === true,
      (binding, bodyOnly, observation) => world.changed(ctx, host, active, binding, bodyOnly, observation));
    value = create(view);
    registration = world.register(area, value, ctx.fiber);
    ctx.on('pet/core.changed', () => world.bindingChanged(ctx, host, active));
    stopStatus = ctx.root.on('internal/status', (fiber, previous) => {
      if (fiber !== ctx.fiber) return;
      if (fiber.state === FiberState.ACTIVE) world.changed(ctx, host, active);
      else if (previous === FiberState.ACTIVE)
        world.changed(ctx, host, () => registration?.isLatestGeneration() === true && !world.lookup(area));
    });
    stopPort = start(value, view);
    stopCore = world.retainCore(ctx, host, area);
  } catch (error) {
    // Cordis joins this cleanup through the effect when synchronous apply fails.
    void dispose().catch(() => {});
    throw error;
  }
}

// Handoff only during the synchronous call into a queue. The receiving queue
// keeps its guard across awaits without leaking it to later events or timers.
let callerGuard: (() => void) | undefined;
export const livingCaller = () => callerGuard;
export function withLivingCaller<T>(validate: () => void, call: () => T): T {
  validate();
  const previous = callerGuard;
  callerGuard = validate;
  try { return call(); }
  finally { callerGuard = previous; }
}

export class InFlight {
  private readonly work = new Set<Promise<unknown>>();

  run<T>(start: () => Promise<T>): Promise<T> {
    const task = start();
    this.work.add(task);
    const done = () => { this.work.delete(task); };
    void task.then(done, done);
    return task;
  }

  async settled() { await Promise.allSettled(this.work); }
}
