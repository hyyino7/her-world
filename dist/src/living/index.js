import { Context } from '@deepseek-ai/cordis';
import { RegistrationTable } from '../core/tables/registry.js';
import { sameHomeBinding } from '../core/home-binding.js';
import { Rejection, reject, text } from '../core/storage.js';
import { FACT_DOMAIN_NAMES, factDomainOf } from '../contracts/interaction.js';
import { activityReader } from './plan/activity-reader.js';
import { readFactReferences } from './plan/facts.js';
import { installLivingPrompt } from './prompt-context.js';
const bodyService = 'petBehavior', lifeService = 'petLife', economyService = 'petEconomy';
const services = { body: bodyService, plan: lifeService, economy: economyService };
const domains = new WeakMap();
export { sameHomeBinding };
export function serviceLabel(contextScope, name) {
    const defaults = contextScope.root[Context.isolate];
    defaults[name] ??= Symbol(name);
    return contextScope[Context.isolate][name];
}
function labelsOf(contextScope) {
    const label = (name) => serviceLabel(contextScope, name);
    return { body: label(services.body), plan: label(services.plan), economy: label(services.economy) };
}
function currentArea(slot, area) {
    const entry = slot?.table.get(area);
    if (!entry)
        return;
    const { lease, value: { value, fiber } } = entry;
    const isCurrent = () => lease.isCurrent() && fiber.state === 2 /* FiberState.ACTIVE */;
    if (isCurrent())
        return { value, lease, isCurrent };
}
export class LivingWorld {
    domain;
    labels;
    entries = 0;
    constructor(domain, labels) {
        this.domain = domain;
        this.labels = labels;
    }
    static matching(domain, labels) {
        return [...domain.worlds].find(world => world.labels.body === labels.body &&
            world.labels.plan === labels.plan && world.labels.economy === labels.economy);
    }
    static lookupPlan(ctx, host) {
        const domain = domains.get(ctx.root)?.get(host);
        return domain && currentArea(domain.slots.plan.get(serviceLabel(ctx, lifeService)), 'plan')?.value;
    }
    static retain(ctx, host, area) {
        const root = ctx.root;
        let hosts = domains.get(root);
        if (!hosts)
            domains.set(root, hosts = new WeakMap());
        let domain = hosts.get(host);
        if (!domain) {
            domain = { worlds: new Set(), slots: { body: new Map(), plan: new Map(), economy: new Map() }, changes: new Map() };
            hosts.set(host, domain);
        }
        const labels = labelsOf(ctx);
        const world = this.matching(domain, labels) ?? new LivingWorld(domain, labels);
        domain.worlds.add(world);
        world.entries++;
        return { world, release: (generation) => {
                const slots = domain.slots[area], label = labels[area];
                const slot = slots.get(label);
                if (slot && slot.generation === generation && !slot.table.get(area))
                    slots.delete(label);
                if (--world.entries === 0)
                    domain.worlds.delete(world);
                if (!domain.worlds.size)
                    hosts.delete(host);
            } };
    }
    retainCore(ctx, host, area) {
        const ports = host.native?.companionPorts;
        if (!ports)
            return;
        const scope = ports.scopeFor(ctx, services[area]);
        if (!scope)
            return;
        if (!this.domain.core) {
            const labels = labelsOf(scope.ctx);
            const world = LivingWorld.matching(this.domain, labels) ?? new LivingWorld(this.domain, labels);
            const visible = () => world.lookup('body') || world.lookup('plan') || world.lookup('economy');
            const dispose = scope.ctx.effect(() => {
                const activity = ports.register('activities', {
                    activityDays: binding => visible() ? activityReader.activityDays(binding) : [],
                    activity: (binding, day) => visible() ? activityReader.activity(binding, day) : [],
                });
                try {
                    const stopPrompt = installLivingPrompt(scope.ctx, host, world, scope.ownerScope);
                    return () => settleCleanup(activity.revoke, stopPrompt);
                }
                catch (error) {
                    void activity.revoke();
                    throw error;
                }
            });
            this.domain.core = { areas: 0, dispose };
        }
        const core = this.domain.core;
        core.areas++;
        return () => {
            if (--core.areas)
                return;
            this.domain.core = undefined;
            return core.dispose();
        };
    }
    register(area, value, fiber) {
        const slots = this.domain.slots[area], label = this.labels[area];
        let slot = slots.get(label);
        if (!slot)
            slots.set(label, slot = { table: new RegistrationTable() });
        const registration = slot.table.register(area, { value, fiber });
        const { generation } = registration.lease;
        slot.generation = generation;
        // Revocation hides the area immediately. A replacement also fences its draining writes.
        return { ...registration, isLatestGeneration: () => slot.generation === generation };
    }
    lookup(area) {
        return currentArea(this.domain.slots[area].get(this.labels[area]), area);
    }
    bindingChanged(ctx, host, valid) {
        if (!valid())
            return;
        try {
            const binding = host.workspace.homeScope();
            if (!binding)
                this.domain.lastNotifiedBinding = undefined;
            else if (!sameHomeBinding(this.domain.lastNotifiedBinding, binding))
                this.changed(ctx, host, valid, binding);
        }
        catch { /* Binding may already be unavailable during teardown. */ }
    }
    changed(ctx, host, valid, expected, bodyOnly = false, bodyObservation) {
        // Notification failures cannot invalidate completed domain work.
        try {
            const binding = expected ?? host.workspace.homeScope();
            if (!binding || !sameHomeBinding(host.workspace.homeScope(), binding))
                return;
            const { workspaceId, path, storageId, bootId, generation } = binding;
            const key = JSON.stringify([workspaceId, path, storageId, bootId, generation]);
            const notice = { valid, bodyOnly, bodyObservation };
            const pending = this.domain.changes.get(key);
            if (pending) {
                pending.push(notice);
                return;
            }
            const guards = [notice];
            this.domain.changes.set(key, guards);
            queueMicrotask(() => {
                this.domain.changes.delete(key);
                try {
                    if (!sameHomeBinding(host.workspace.homeScope(), binding))
                        return;
                    const current = guards.filter(guard => guard.valid());
                    if (!current.length)
                        return;
                    this.domain.lastNotifiedBinding = binding;
                    const observation = current.every(guard => guard.bodyObservation) ? current.at(-1)?.bodyObservation : undefined;
                    ctx.emit('world.changed', { workspaceId, storageId, bootId, generation,
                        ...(current.every(guard => guard.bodyOnly) ? { bodyOnly: true } : {}),
                        ...(observation ? { bodyObservation: observation } : {}) });
                }
                catch { /* A failed observer has no effect on the committed result. */ }
            });
        }
        catch { /* Binding may already be unavailable during teardown. */ }
    }
}
export class LivingView {
    ports;
    isCurrent;
    world;
    isLatestGeneration;
    changed;
    constructor(ports = {}, isCurrent = () => true, world, isLatestGeneration = isCurrent, changed = () => { }) {
        this.ports = ports;
        this.isCurrent = isCurrent;
        this.world = world;
        this.isLatestGeneration = isLatestGeneration;
        this.changed = changed;
    }
    lookup(area) {
        if (this.world)
            return this.world.lookup(area);
        const ports = this.ports;
        const read = ports[area], value = read?.();
        if (value)
            return { value, isCurrent: () => read?.() === value };
    }
    get(area) { return this.lookup(area)?.value; }
    boundScope(host, workspaceId) {
        const binding = host.workspace.homeScope();
        if (!this.isCurrent() || binding?.workspaceId !== workspaceId)
            reject('STALE_BINDING', '生活工作区已切换或组件已停止');
        const validate = () => {
            if (!this.isCurrent() || !sameHomeBinding(host.workspace.homeScope(), binding))
                reject('STALE_BINDING', '生活工作区或组件已切换');
        };
        return { binding, validate };
    }
    async command(host, { workspaceId, requestId }, options, execute) {
        const signal = options?.signal;
        const outcome = { effect: 'none' };
        let validateBinding;
        const validate = () => {
            signal?.throwIfAborted();
            validateBinding?.();
        };
        try {
            text(requestId, 'request id');
            outcome.operationId = requestId;
            validateBinding = this.boundScope(host, workspaceId).validate;
            const value = await withLivingCaller(validate, () => execute({ validate, effect(effect, operationId) {
                    outcome.effect = effect;
                    if (operationId !== undefined)
                        outcome.operationId = operationId;
                } }));
            validate();
            return { ok: true, value };
        }
        catch (error) {
            const { effect, operationId } = outcome;
            if (effect === 'none') {
                if (signal?.aborted)
                    return { ok: false, error: { code: 'CANCELLED', message: '生活命令已取消', operationId, effect, retry: 'same_request' } };
                // Queue failures may use the old facade's untyped binding/cancellation error.
                if (!(error instanceof Rejection))
                    try {
                        validate();
                    }
                    catch (denial) {
                        error = denial;
                    }
                if (error instanceof Rejection)
                    return { ok: false, error: { operationId, ...error.detail } };
                return { ok: false, error: { code: 'INTERNAL', message: String(error), operationId, effect, retry: 'same_request' } };
            }
            const message = error instanceof Error ? error.message : String(error);
            if (effect === 'unknown')
                return { ok: false, error: { code: 'OUTCOME_UNKNOWN', message, operationId, effect, retry: 'reconcile' } };
            return { ok: false, error: { code: signal?.aborted ? 'CANCELLED' : 'INTERNAL', message, operationId, effect, retry: 'reconcile' } };
        }
    }
    readFrame(host, workspaceId, includePlan = false) {
        const scope = this.boundScope(host, workspaceId);
        const body = this.lookup('body'), economy = this.lookup('economy');
        const plan = includePlan ? this.lookup('plan') : undefined;
        const sameArea = (area, ref) => this.lookup(area)?.value === ref?.value && (!ref || ref.isCurrent());
        const validate = () => {
            scope.validate();
            if (!sameArea('body', body) || !sameArea('economy', economy) || (includePlan && !sameArea('plan', plan)))
                reject('STALE_BINDING', '生活工作区或组件已切换');
        };
        return { ...scope, body, economy, validate };
    }
    async worldSnapshot(host, workspaceId) {
        const { binding, body, economy, validate } = this.readFrame(host, workspaceId, true);
        const snapshot = body && await withLivingCaller(validate, () => body.value.snapshot(workspaceId));
        validate();
        const wallet = economy?.value.walletView(workspaceId) ?? null;
        validate();
        return { workspaceId, storageId: binding.storageId, wallet,
            body: snapshot ? { available: true, snapshot: structuredClone(snapshot) } : { available: false } };
    }
    factSource(host) {
        const references = (ids) => ids.map(id => {
            const domain = factDomainOf(id);
            if (!domain)
                reject('INVALID_ARGUMENT', '未知互动事实所属区');
            return { domain, id };
        });
        return {
            pendingFacts: async (workspaceId) => {
                const frame = this.readFrame(host, workspaceId);
                const facts = await Promise.all(FACT_DOMAIN_NAMES.map(domain => withLivingCaller(frame.validate, () => frame[domain]?.value.pendingFacts(workspaceId) ?? [])));
                frame.validate();
                return facts.flat().sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
            },
            readFacts: async (workspaceId, ids) => {
                const frame = this.readFrame(host, workspaceId);
                return withLivingCaller(frame.validate, () => readFactReferences(workspaceId, references(ids), domain => frame[domain]?.value, frame.validate));
            },
            acknowledgeFacts: async (workspaceId, ids) => {
                const frame = this.readFrame(host, workspaceId), refs = references(ids);
                const batches = FACT_DOMAIN_NAMES.flatMap(domain => {
                    const batch = refs.filter(ref => ref.domain === domain).map(ref => ref.id);
                    if (!batch.length)
                        return [];
                    const source = frame[domain]?.value;
                    if (!source)
                        throw Error('原互动事实所属组件暂不可用，保留原编号等待恢复');
                    return [{ source, batch }];
                });
                for (const { source, batch } of batches)
                    await withLivingCaller(frame.validate, () => source.acknowledgeFacts(workspaceId, batch));
                frame.validate();
            },
        };
    }
    watch(ctx, area, notify) {
        if (!this.world && !this.ports.observe)
            return () => { };
        let current;
        let observation;
        const update = () => {
            if (!this.isCurrent())
                return;
            const next = this.lookup(area);
            if (current?.value === next?.value && (!current || current.isCurrent()))
                return;
            const tell = (ref) => {
                const generation = observation = Symbol(area);
                notify(ref, () => observation === generation);
            };
            if (current)
                tell();
            current = next;
            if (next)
                tell(next);
        };
        const stop = ctx.on('internal/status', update);
        try {
            update();
        }
        catch (error) {
            stop();
            throw error;
        }
        return () => { observation = undefined; stop(); };
    }
}
export async function settleCleanup(...steps) {
    const settled = await Promise.allSettled(steps.map(async (step) => step()));
    const errors = settled.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (errors.length)
        throw new AggregateError(errors, 'Living area cleanup failed');
}
export function mountLivingArea(ctx, host, area, create, start, close = value => value.close()) {
    const { world, release } = LivingWorld.retain(ctx, host, area);
    let registration;
    let stopPort, stopCore;
    let value, cleanup, stopStatus;
    const dispose = () => cleanup ??= settleCleanup(() => registration?.revoke(), () => stopPort?.(), () => stopCore?.(), () => { if (value)
        return close(value); }).finally(() => { stopStatus?.(); release(registration?.lease.generation); });
    try {
        ctx.effect(() => dispose);
        const active = () => world.lookup(area)?.lease === registration?.lease && registration !== undefined;
        const view = new LivingView({}, () => registration?.lease.isCurrent() === true &&
            (ctx.fiber.state === 1 /* FiberState.LOADING */ || ctx.fiber.state === 2 /* FiberState.ACTIVE */), world, () => registration?.isLatestGeneration() === true, (binding, bodyOnly, observation) => world.changed(ctx, host, active, binding, bodyOnly, observation));
        value = create(view);
        registration = world.register(area, value, ctx.fiber);
        ctx.on('pet/core.changed', () => world.bindingChanged(ctx, host, active));
        stopStatus = ctx.root.on('internal/status', (fiber, previous) => {
            if (fiber !== ctx.fiber)
                return;
            if (fiber.state === 2 /* FiberState.ACTIVE */)
                world.changed(ctx, host, active);
            else if (previous === 2 /* FiberState.ACTIVE */)
                world.changed(ctx, host, () => registration?.isLatestGeneration() === true && !world.lookup(area));
        });
        stopPort = start(value, view);
        stopCore = world.retainCore(ctx, host, area);
    }
    catch (error) {
        // Cordis joins this cleanup through the effect when synchronous apply fails.
        void dispose().catch(() => { });
        throw error;
    }
}
// Handoff only during the synchronous call into a queue. The receiving queue
// keeps its guard across awaits without leaking it to later events or timers.
let callerGuard;
export const livingCaller = () => callerGuard;
export function withLivingCaller(validate, call) {
    validate();
    const previous = callerGuard;
    callerGuard = validate;
    try {
        return call();
    }
    finally {
        callerGuard = previous;
    }
}
export class InFlight {
    work = new Set();
    run(start) {
        const task = start();
        this.work.add(task);
        const done = () => { this.work.delete(task); };
        void task.then(done, done);
        return task;
    }
    async settled() { await Promise.allSettled(this.work); }
}
//# sourceMappingURL=index.js.map