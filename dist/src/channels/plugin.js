import { isDeepStrictEqual } from 'node:util';
import { bridgeRoute, compactRoute } from '#dsh-world/ecosystem/bridge/route';
import { unknownEffect } from '../contracts/common.js';
import { CONTRACT_VERSION } from '../contracts/version.js';
import { digest, Rejection } from '../core/storage.js';
import { object, requiredText } from '../core/tables/console.js';
import { isWorldChangeFor, sameHomeBinding } from '../core/home-binding.js';
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
    scope() { return this.closed ? undefined : this.host.workspace.homeScope(); }
    current(binding) { return sameHomeBinding(this.scope(), binding); }
    async reconcile(expected) {
        const sameScope = () => sameHomeBinding(this.scope(), expected);
        if (!sameScope())
            return;
        if (this.bound && !this.current(this.bound)) {
            const previous = this.bound;
            this.bound = undefined;
            previous.bridge.stop();
            await previous.messaging.close();
            if (!sameScope())
                return;
        }
        if (!expected || !this.profileDir)
            return;
        if (!this.bound) {
            const { workspaceId, path, storageId } = expected;
            const deviceDirectory = privateDeviceDirectory(privateDeviceDirectory(this.profileDir, 'chatpet-channels'), digest(storageId));
            const dataDirectory = companionChannelDirectory(path, deviceDirectory);
            const active = sameScope;
            const isHome = (sessionId) => active() && isCompanionHome(this.ctx, this.host, sessionId);
            const ownerHome = async () => {
                if (!active())
                    throw Error('主人会话工作区已切换');
                const agent = await resolveCompanionHome(this.ctx, this.host);
                if (!active() || !isHome(agent.id))
                    throw Error('主人会话已切换');
                return agent;
            };
            const bridge = new LocalBridge(this.ctx, deviceDirectory, () => this.services.webServer.getOrigin(), ownerHome, isHome, () => this.host.workspace.runtime.policy().quiet, () => this.host.workspace.runtime.identity().displayName, this.host.workspace.runtime.store, storageId, active);
            const messaging = await createMessaging(this.ctx, this.host, { deviceDirectory, dataDirectory, workspaceId, storageId, active, ownerHome });
            if (!active()) {
                bridge.stop();
                await messaging.close();
                return;
            }
            this.bound = { ...expected, messaging, bridge };
        }
        this.bound.bridge.sync(true);
        return this.bound;
    }
    async refresh(change) {
        const binding = this.scope();
        if (change && !isWorldChangeFor(change, binding))
            return;
        if (this.bound && !this.current(this.bound))
            this.bound.messaging.cancelVoice();
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
        if (!bound || bound.workspaceId !== workspaceId || !this.current(bound) || this.host.workspace.runtime.policy().quiet)
            return [];
        const home = readRunningLifeHome(this.ctx, this.host);
        if (!home)
            return [];
        const deliveries = await Promise.allSettled([bound.bridge.reach(push, home), bound.messaging.reach(push, home)]);
        if (!this.current(bound))
            return [];
        return deliveries.flatMap(result => result.status === 'fulfilled' ? result.value : [result]);
    }
    request(id, operation, input, validate) {
        const binding = this.scope();
        const assertCurrent = () => {
            validate?.();
            if (!binding || binding.workspaceId !== id || !this.current(binding))
                throw { code: 'STALE_BINDING' };
        };
        return this.serial(async () => {
            assertCurrent();
            const bound = await this.reconcile(binding);
            assertCurrent();
            if (!bound)
                throw { code: 'STALE_BINDING' };
            if (!Object.hasOwn(channelOperations, operation))
                throw { code: 'INVALID_ARGUMENT' };
            if (channelOperations[operation].group) {
                const response = await bound.messaging.group(operation, input);
                assertCurrent();
                return response;
            }
            let saved = false;
            try {
                if (operation === 'bridgeSettings') {
                    if (!isDeepStrictEqual(input.expected, bound.bridge.status().preferences))
                        throw { code: 'STALE_REVISION' };
                    bound.bridge.configure(input.next);
                    saved = true;
                    bound.bridge.sync(true);
                }
                else if (operation === 'messagingSettings') {
                    if (!isDeepStrictEqual(input.expected, bound.messaging.status().config))
                        throw { code: 'STALE_REVISION' };
                    await bound.messaging.configure(input.next, assertCurrent, () => { saved = true; });
                }
                assertCurrent();
            }
            catch (error) {
                if (saved) {
                    const code = error && typeof error === 'object' && 'code' in error && error.code === 'CANCELLED' ? 'CANCELLED' : 'OUTCOME_UNKNOWN';
                    throw new Rejection(unknownEffect(code, 'Channel configuration saved; refresh to reconcile the change'));
                }
                throw error;
            }
            return { bridge: bound.bridge.status(), messaging: bound.messaging.status() };
        });
    }
    close() {
        this.closed = true;
        this.bound?.messaging.cancelVoice();
        return this.refresh();
    }
}
const channelOperations = {
    channelStatus: { fields: [] },
    bridgeSettings: { fields: ['expected', 'next'] },
    messagingSettings: { fields: ['expected', 'next'] },
    groupState: { fields: ['groupId'], group: true },
    groupSettings: { fields: ['groupId', 'expected', 'next'], group: true },
    groupSlang: { fields: ['groupId', 'content', 'meaning', 'usage', 'status'], group: true },
    groupResearch: { fields: ['groupId', 'content'], group: true },
    qzoneState: { fields: [], group: true },
    qzoneSettings: { fields: ['expected', 'next'], group: true },
    qzoneDraft: { fields: ['text'], group: true },
    qzoneRemove: { fields: ['id'], group: true },
};
export function channelsConsoleOperations(channels) {
    const operations = {};
    for (const [endpoint, { fields }] of Object.entries(channelOperations))
        operations[endpoint] = call => {
            const input = object(call.input, ['workspaceId', ...fields]);
            const id = requiredText(input.workspaceId, 200);
            call.checkBinding(id);
            call.validate();
            return channels.request(id, endpoint, input, call.validate);
        };
    return { operations };
}
export const name = '60-Channels';
export const inject = ['petCore', 'webServer', 'sessionController', 'agents', 'sessions', 'sessionPersistence', 'agentPresets', 'workspaceRegistry'];
export function apply(ctx, config = {}) {
    const services = ctx;
    const profile = ctx.get('profileContext');
    const host = ctx.petCore;
    const channels = new CompanionChannels(ctx, host, services, config.deviceDirectory ?? profile?.dir ?? '');
    ctx.provide('petChannels', channels);
    ctx.effect(() => host.native.consoleOperations.register('channels', channelsConsoleOperations(channels), ctx).revoke);
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