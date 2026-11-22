import { isDeepStrictEqual } from 'node:util';
import { bridgeRoute, compactRoute } from '#dsh-world/ecosystem/bridge/route';
import { CONTRACT_VERSION } from '../contracts/version.js';
import { digest } from '../core/storage.js';
import { sameHomeBinding } from '../living/index.js';
import { readRunningLifeHome, registerLifeOutlet } from '../living/outlets.js';
import { bridgePrefix, LocalBridge, privateDeviceDirectory } from './bridge.js';
import { createMessaging } from './messaging.js';
import { isCompanionHome, resolveCompanionHome } from '../core/companion-foundation.js';
import { companionChannelDirectory } from './storage.js';
export class CompanionChannels {
    ctx;
    host;
    services;
    profileDir;
    bound;
    closed = false;
    queue = Promise.resolve();
    constructor(ctx, host, services, profileDir) {
        this.ctx = ctx;
        this.host = host;
        this.services = services;
        this.profileDir = profileDir;
    }
    serial(work) {
        const next = this.queue.then(work);
        this.queue = next.catch(() => { });
        return next;
    }
    target() {
        const status = this.host.workspace.status();
        return !this.closed && status.state === 'ready' ? status.target : undefined;
    }
    current(binding) {
        const target = this.target();
        return target?.id === binding.id && target.path === binding.path && this.host.workspace.storageId() === binding.storageId;
    }
    async reconcile(expected) {
        const sameScope = () => !expected || sameHomeBinding(this.host.workspace.homeScope(), expected);
        if (!sameScope())
            return;
        if (this.bound && !this.current(this.bound)) {
            const previous = this.bound;
            this.bound = undefined;
            previous.bridge.stop();
            await previous.messaging.close();
        }
        // Closing an old adapter can await external cleanup. Capture the current
        // root afterwards, and discard a world notice if its binding has moved.
        if (!sameScope())
            return;
        const current = this.target(), storageId = current ? this.host.workspace.storageId() : undefined;
        if (!current || !storageId || !this.profileDir)
            return;
        if (!this.bound) {
            const { id, path } = current, binding = { id, path, storageId };
            const deviceDirectory = privateDeviceDirectory(privateDeviceDirectory(this.profileDir, 'chatpet-channels'), digest(storageId));
            const dataDirectory = companionChannelDirectory(path, deviceDirectory);
            let initializing = true;
            const active = () => this.current(binding) && (!initializing || sameScope());
            const isHome = (sessionId) => active() && isCompanionHome(this.ctx, this.host, sessionId);
            const ownerHome = async () => {
                if (!active())
                    throw Error('主人会话工作区已切换');
                const agent = await resolveCompanionHome(this.ctx, this.host);
                if (!active() || !isHome(agent.id))
                    throw Error('主人会话已切换');
                return agent;
            };
            const bridge = new LocalBridge(this.ctx, deviceDirectory, () => this.services.webServer.getOrigin(), ownerHome, isHome, () => this.host.workspace.runtime.policy().quiet, () => this.host.workspace.runtime.identity().displayName, this.host.workspace.runtime.store, storageId);
            const messaging = await createMessaging(this.ctx, this.host, { deviceDirectory, dataDirectory, workspaceId: id, storageId, active, ownerHome });
            if (!active()) {
                bridge.stop();
                await messaging.close();
                return;
            }
            initializing = false;
            this.bound = { ...binding, messaging, bridge };
        }
        this.bound.bridge.sync(true);
        return this.bound;
    }
    async refresh(change) {
        if (!change)
            return this.serial(() => this.reconcile());
        const binding = this.host.workspace.homeScope();
        if (!binding || change.workspaceId !== binding.workspaceId || change.storageId !== binding.storageId ||
            change.bootId !== binding.bootId || change.generation !== binding.generation)
            return;
        return this.serial(() => this.reconcile(binding));
    }
    get local() { return this.bound && this.current(this.bound) ? this.bound.bridge.current : undefined; }
    qqConnection() {
        const bound = this.bound;
        if (!bound || !this.current(bound))
            return 'off';
        return bound.messaging.qqConnection();
    }
    compact() {
        const home = readRunningLifeHome(this.ctx, this.host);
        if (!home || !this.local || !this.host.native.memoryFor(home))
            return '生活会话或记忆整理未启用';
        if (!this.host.native.hasPendingReviewCompaction(home))
            return '当前没有待整理的已完成对话';
        this.host.native.requestReviewCompaction(home);
        return undefined;
    }
    async reach(workspaceId, push) {
        const bound = this.bound;
        if (!bound || bound.id !== workspaceId || !this.current(bound) || this.host.workspace.runtime.policy().quiet)
            return [];
        const home = readRunningLifeHome(this.ctx, this.host);
        if (!home)
            return [];
        const deliveries = await Promise.allSettled([bound.bridge.reach(push, home), bound.messaging.reach(push, home)]);
        return deliveries.flatMap(result => result.status === 'fulfilled' ? result.value : [result]);
    }
    request(id, operation, input) {
        return this.serial(async () => {
            const bound = await this.reconcile();
            if (!bound || bound.id !== id || !this.current(bound))
                throw { code: 'STALE_BINDING' };
            if (['groupState', 'groupSettings', 'groupSlang', 'groupResearch', 'qzoneState', 'qzoneSettings', 'qzoneDraft', 'qzoneRemove'].includes(operation)) {
                const response = await bound.messaging.group(operation, input);
                if (!this.current(bound))
                    throw { code: 'STALE_BINDING' };
                return response;
            }
            if (operation === 'bridgeSettings') {
                if (!isDeepStrictEqual(input.expected, bound.bridge.status().preferences))
                    throw { code: 'STALE_REVISION' };
                bound.bridge.configure(input.next);
                bound.bridge.sync(true);
            }
            else if (operation === 'messagingSettings') {
                if (!isDeepStrictEqual(input.expected, bound.messaging.status().config))
                    throw { code: 'STALE_REVISION' };
                await bound.messaging.configure(input.next);
            }
            else if (operation !== 'channelStatus')
                throw { code: 'INVALID_ARGUMENT' };
            if (!this.current(bound))
                throw { code: 'STALE_BINDING' };
            return { bridge: bound.bridge.status(), messaging: bound.messaging.status() };
        });
    }
    close() {
        this.closed = true;
        this.bound?.messaging.cancelVoice();
        return this.refresh();
    }
}
export const name = '60-Channels';
export const inject = ['petCore', 'webServer', 'sessionController', 'agents', 'sessions', 'sessionPersistence', 'agentPresets', 'workspaceRegistry'];
export function apply(ctx, config = {}) {
    const services = ctx;
    const profile = ctx.get('profileContext');
    const host = ctx.petCore;
    const channels = new CompanionChannels(ctx, host, services, config.deviceDirectory ?? profile?.dir ?? '');
    ctx.provide('petChannels', channels);
    ctx.effect(() => registerLifeOutlet(ctx, host, 'channels', {
        reach: (workspaceId, push) => channels.reach(workspaceId, push),
    }).revoke);
    ctx.effect(() => services.webServer.register(bridgeRoute(bridgePrefix, () => channels.local)));
    ctx.effect(() => services.webServer.register(compactRoute(bridgePrefix, () => channels.local, () => channels.compact())));
    const refresh = (change) => { void channels.refresh(change).catch(error => ctx.logger.warn('Channel refresh failed', error)); };
    ctx.on('pet/core.changed', () => refresh());
    ctx.on('world.changed', refresh);
    refresh();
    ctx.effect(() => async () => { await channels.close(); });
    ctx.effect(() => host.workspace.runtime.capabilityTable.register({
        id: 'channel.qq', owner: 'qq', contractVersion: CONTRACT_VERSION, order: 7,
        status: () => {
            const state = channels.qqConnection();
            return { state: state === 'online' ? 'ready' : state === 'off' ? 'disabled' : 'unavailable',
                reason: state === 'online' ? null : state === 'off' ? 'QQ is off' : 'QQ is disconnected',
                supportedOperations: state === 'online' ? ['receive', 'reply'] : [] };
        },
    }).revoke);
}
//# sourceMappingURL=plugin.js.map