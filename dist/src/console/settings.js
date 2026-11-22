import { Rejection } from '../core/storage.js';
import { MIGRATION_REASON } from '../core/storage-migration.js';
import { estimateTokens } from '#dsh-world/console/snapshot';
import { desktopAppearanceDefaults } from '../desktop/appearance.js';
import { BODY_ACTIONS, CARE_ACTIONS, isCareAction } from '../contracts/behavior.js';
const messages = {
    STALE_BINDING: '工作区绑定已改变，请刷新。',
    STALE_REVISION: '设置已被其他操作修改，请刷新后重新编辑。',
    CONFLICT: '设置已被其他操作修改，请刷新后重新编辑。',
    INVALID_ARGUMENT: '设置值无效，请检查填写内容。', UNAUTHORIZED: '当前连接没有修改设置的权限。',
    DISABLED: 'Core 当前不可用，请检查核心模块状态。',
    'migration-required': '伙伴资料暂时无法使用。请刷新设置查看原因和操作提示。',
    UNAVAILABLE: '00-Core 尚未就绪，请检查核心模块是否启用。',
    WORLD_UNAVAILABLE: '大肥鱼的 World 组件尚未加载。',
    PROFILE_UNAVAILABLE: '人设预览无法加载。请检查角色、用户资料和上下文字符上限。',
    MEMORY_UNAVAILABLE: '长期记忆服务尚未配置或不可用。',
    NOT_FOUND: '所选工作区不存在，请刷新工作区列表。',
    WORKSPACE_INVALID: '绑定 Repo 的 .chatpet 资料无法加载。请检查 manifest.json、SOUL.md、USER.md 和 core.json 后刷新。原文件未被覆盖。',
    LIMIT_REACHED: '已达到当前资源或调用限制，请检查设置后重试。',
    INELIGIBLE: '相关来源已撤回或无法校验，当前内容暂不展示。',
    CANCELLED: '请求已取消，请刷新核对实际保存结果。',
    ENOENT: '工作区资料尚未初始化或已移动，请在工作区页检查绑定与初始化状态。',
    OUTCOME_UNKNOWN: '部分设置可能已保存，请刷新读取实际状态后再继续。',
};
function fail(code) { throw { code }; }
function object(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail('INVALID_ARGUMENT');
    const obj = value;
    if (Object.keys(obj).length !== keys.length || keys.some(key => !Object.hasOwn(obj, key)))
        fail('INVALID_ARGUMENT');
    return obj;
}
function unwrap(value) {
    if (!value.ok)
        fail(value.error.code);
    return value.value;
}
function requiredText(value, max) {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
        fail('INVALID_ARGUMENT');
    return value.trim();
}
const sectionModules = new Map([['profile', 'persona'], ['sessions', 'archive'], ['emotion', 'mood']]);
export function settingsHandler(getHost, getWorkspaces, getDesktop, getWorldModules, getEmotion, getLife, getRoom, getChannels, getPlatform, getEconomy) {
    return async (endpoint, payload, signal, peer) => {
        try {
            if (peer.principal.kind !== 'owner' || peer.signal.aborted)
                fail('UNAUTHORIZED');
            if (signal.aborted)
                fail('CANCELLED');
            const host = getHost();
            if (!host)
                fail('UNAVAILABLE');
            const body = object(payload, ['requestId', 'input']);
            if (typeof body.requestId !== 'string' || body.requestId.length < 1 || body.requestId.length > 160)
                fail('INVALID_ARGUMENT');
            if (endpoint !== 'snapshot' && host.workspace.status().state === 'migration-required')
                fail('migration-required');
            const context = () => host.operator.request(`settings:${endpoint}:${body.requestId}`);
            const options = { signal };
            if (['economyView', 'economyAction', 'economySettings'].includes(endpoint)) {
                const keys = endpoint === 'economyView' ? [] : endpoint === 'economyAction' ? ['action'] : ['expectedVersion', 'next'];
                const input = object(body.input, ['workspaceId', ...keys]);
                const workspaceId = requiredText(input.workspaceId, 200), binding = host.workspace.status();
                const registered = getWorkspaces()?.get(workspaceId), economy = getEconomy?.();
                if (!economy)
                    fail('UNAVAILABLE');
                if (binding.state !== 'ready' || binding.target?.id !== workspaceId || !registered || registered.path !== binding.target.path)
                    fail('STALE_BINDING');
                const validate = () => {
                    if (peer.principal.kind !== 'owner' || peer.signal.aborted)
                        fail('UNAUTHORIZED');
                    if (signal.aborted)
                        fail('CANCELLED');
                    const current = host.workspace.status();
                    if (getHost() !== host || getEconomy?.() !== economy || getWorkspaces()?.get(workspaceId) !== registered
                        || current.state !== 'ready' || current.target?.id !== workspaceId || current.target.path !== registered.path
                        || current.revision !== binding.revision || current.sourceRevision !== binding.sourceRevision)
                        fail('STALE_BINDING');
                };
                if (await registered.status() !== 'ok')
                    fail('NOT_FOUND');
                validate();
                const combinedSignal = AbortSignal.any([signal, peer.signal]);
                const value = endpoint === 'economyView' ? await economy.snapshot(workspaceId, validate, { includeWritableKeys: true })
                    : endpoint === 'economyAction' ? await economy.ownerAction(workspaceId, input.action, body.requestId, combinedSignal, validate)
                        : await economy.settings(workspaceId, requiredText(input.expectedVersion, 256), input.next, body.requestId, combinedSignal, validate);
                validate();
                return { ok: true, value };
            }
            if (endpoint === 'foundation') {
                const writing = Boolean(body.input && typeof body.input === 'object' && Object.hasOwn(body.input, 'text'));
                const input = object(body.input, writing ? ['workspaceId', 'expectedRevision', 'text'] : ['workspaceId']);
                if (host.workspace.status().target?.id !== input.workspaceId)
                    fail('STALE_BINDING');
                const value = writing ? unwrap(await host.services.workspace.saveFoundation(context(), {
                    workspaceId: requiredText(input.workspaceId, 200), expectedRevision: requiredText(input.expectedRevision, 256), text: input.text
                }, options))
                    : unwrap(await host.services.workspace.readFoundation(context(), {}, options));
                return { ok: true, value };
            }
            if (endpoint === 'self') {
                const writing = Boolean(body.input && typeof body.input === 'object' && Object.hasOwn(body.input, 'text'));
                const input = object(body.input, writing ? ['workspaceId', 'expectedRevision', 'text'] : ['workspaceId']);
                const id = requiredText(input.workspaceId, 200);
                if (host.workspace.status().target?.id !== id)
                    fail('STALE_BINDING');
                const value = writing ? await host.records.saveSelf(id, requiredText(input.expectedRevision, 256), input.text)
                    : await host.records.readSelf(id);
                if (signal.aborted || peer.signal.aborted)
                    fail('CANCELLED');
                return { ok: true, value };
            }
            if (endpoint === 'emotionState' || endpoint === 'emotionUpdate') {
                const raw = body.input;
                if (!raw || typeof raw !== 'object')
                    fail('INVALID_ARGUMENT');
                const id = requiredText(raw.workspaceId, 200);
                if (host.workspace.status().target?.id !== id)
                    fail('STALE_BINDING');
                const emotion = getEmotion?.();
                if (!emotion?.read || !emotion.update)
                    fail('UNAVAILABLE');
                const { workspaceId: _id, ...update } = raw;
                const value = endpoint === 'emotionState' ? await emotion.read(id) : await emotion.update(id, update);
                if (getEmotion?.() !== emotion || host.workspace.status().target?.id !== id)
                    fail('STALE_BINDING');
                return { ok: true, value };
            }
            if (endpoint === 'roomOpen') {
                const input = object(body.input, ['workspaceId']);
                const id = requiredText(input.workspaceId, 200), room = getRoom?.();
                if (host.workspace.status().target?.id !== id)
                    fail('STALE_BINDING');
                if (!room?.open)
                    fail('UNAVAILABLE');
                const value = await room.open(id);
                if (getRoom?.() !== room || host.workspace.status().target?.id !== id)
                    fail('STALE_BINDING');
                return { ok: true, value };
            }
            if (endpoint === 'desktopAppearance') {
                object(body.input, []);
                return { ok: true, value: desktopAppearanceDefaults() };
            }
            if (endpoint === 'presentationTiming' || endpoint === 'presentationMigration') {
                const input = object(body.input, endpoint === 'presentationTiming' ? ['workspaceId', 'expected', 'eventsRefreshSec'] : ['workspaceId', 'field', 'choice', 'expectedConfigHash']);
                const id = requiredText(input.workspaceId, 200), platform = getPlatform?.();
                if (host.workspace.status().target?.id !== id)
                    fail('STALE_BINDING');
                if (!platform)
                    fail('UNAVAILABLE');
                let value;
                if (endpoint === 'presentationTiming') {
                    if (!platform.saveTiming)
                        fail('UNAVAILABLE');
                    value = await platform.saveTiming(id, input.expected, input.eventsRefreshSec);
                }
                else {
                    if (!platform.resolveMigration || !['legacy', 'current'].includes(String(input.choice)))
                        fail('INVALID_ARGUMENT');
                    value = platform.resolveMigration(id, requiredText(input.field, 300), input.choice, requiredText(input.expectedConfigHash, 64));
                }
                if (signal.aborted || peer.signal.aborted)
                    fail('CANCELLED');
                if (getPlatform?.() !== platform || host.workspace.status().target?.id !== id)
                    fail('STALE_BINDING');
                return { ok: true, value };
            }
            if (['petPlatformAccess', 'petControlAccess', 'petStandaloneAccess'].includes(endpoint)) {
                const input = object(body.input, ['workspaceId']);
                const target = host.workspace.status();
                if (target.state !== 'ready' || target.target?.id !== input.workspaceId)
                    fail('STALE_BINDING');
                const platform = getPlatform?.();
                if (!platform)
                    fail('UNAVAILABLE');
                const id = target.target.id;
                const value = endpoint === 'petPlatformAccess' ? platform.ownerAccess(id) :
                    endpoint === 'petControlAccess' ? platform.controlAccess(id) : await platform.standaloneAccess(id);
                if (host.workspace.status().target?.id !== input.workspaceId || getPlatform?.() !== platform)
                    fail('STALE_BINDING');
                return { ok: true, value };
            }
            const channelFields = { channelStatus: ['workspaceId'], bridgeSettings: ['workspaceId', 'expected', 'next'],
                messagingSettings: ['workspaceId', 'expected', 'next'], groupState: ['workspaceId', 'groupId'],
                groupSettings: ['workspaceId', 'groupId', 'expected', 'next'], groupSlang: ['workspaceId', 'groupId', 'content', 'meaning', 'usage', 'status'],
                groupResearch: ['workspaceId', 'groupId', 'content'], qzoneState: ['workspaceId'], qzoneSettings: ['workspaceId', 'expected', 'next'],
                qzoneDraft: ['workspaceId', 'text'], qzoneRemove: ['workspaceId', 'id'] };
            if (Object.hasOwn(channelFields, endpoint)) {
                const input = object(body.input, channelFields[endpoint]);
                const id = requiredText(input.workspaceId, 200), channels = getChannels?.();
                if (!channels)
                    fail('UNAVAILABLE');
                if (host.workspace.status().target?.id !== id)
                    fail('STALE_BINDING');
                const value = await channels.request(id, endpoint, input);
                if (getChannels?.() !== channels || host.workspace.status().target?.id !== id)
                    fail('STALE_BINDING');
                if (signal.aborted || peer.signal.aborted)
                    fail('CANCELLED');
                return { ok: true, value };
            }
            if (['roomState', 'roomAction', 'roomGarden', 'roomPlant', 'roomCare', 'roomChat', 'roomTelevision', 'roomHistory', 'roomVoice'].includes(endpoint)) {
                const input = object(body.input, ['workspaceId', 'data']);
                const id = requiredText(input.workspaceId, 200), room = getRoom?.();
                if (!room)
                    fail('UNAVAILABLE');
                if (host.workspace.status().target?.id !== id)
                    fail('STALE_BINDING');
                if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data))
                    fail('INVALID_ARGUMENT');
                const roomSignal = AbortSignal.any([signal, peer.signal]);
                const value = await room.request(id, endpoint, input.data, body.requestId, roomSignal).catch(error => {
                    if (roomSignal.aborted)
                        fail('CANCELLED');
                    throw error;
                });
                if (getRoom?.() !== room || host.workspace.status().target?.id !== id)
                    fail('STALE_BINDING');
                if (signal.aborted || peer.signal.aborted)
                    fail('CANCELLED');
                return { ok: true, value };
            }
            if (['lifePreferences', 'lifeDates', 'lifeJournal', 'lifeAlbum', 'lifePhoto', 'lifeForgetPhoto', 'lifeSearch'].includes(endpoint)) {
                const fields = endpoint === 'lifePreferences' ? ['expected', 'next'] : endpoint === 'lifeSearch' ? ['query', 'offset'] : endpoint === 'lifeDates' ? [] :
                    [endpoint === 'lifeJournal' ? 'day' : endpoint === 'lifeAlbum' ? 'offset' : 'id'];
                const input = object(body.input, ['workspaceId', ...fields]);
                const id = requiredText(input.workspaceId, 200);
                const life = getLife?.();
                if (host.workspace.status().target?.id !== id)
                    fail('STALE_BINDING');
                if (endpoint === 'lifePreferences' && !life?.settings)
                    fail('UNAVAILABLE');
                let value;
                if (endpoint === 'lifePreferences')
                    value = await life.settings(id, input.expected, input.next);
                else if (endpoint === 'lifeSearch')
                    value = await host.records.library(id, 'search', { query: input.query, offset: input.offset });
                else if (endpoint === 'lifeDates')
                    value = await host.records.library(id, 'dates');
                else if (endpoint === 'lifeJournal')
                    value = await host.records.library(id, 'journal', input.day);
                else if (endpoint === 'lifeAlbum')
                    value = await host.records.library(id, 'album', input.offset);
                else
                    value = await host.records.library(id, endpoint === 'lifePhoto' ? 'photo' : 'forgetPhoto', input.id);
                if (signal.aborted || peer.signal.aborted)
                    fail('CANCELLED');
                if ((endpoint === 'lifePreferences' && getLife?.() !== life) || host.workspace.status().target?.id !== id)
                    fail('STALE_BINDING');
                return { ok: true, value };
            }
            if (endpoint === 'lifeView' || endpoint === 'lifeControl' || endpoint === 'lifeAction') {
                const key = endpoint === 'lifeControl' ? 'enabled' : endpoint === 'lifeAction' ? 'action' : null;
                const input = object(body.input, ['workspaceId', ...(key ? [key] : [])]);
                const state = host.workspace.status();
                if (state.state !== 'ready' || state.target?.id !== input.workspaceId)
                    fail('STALE_BINDING');
                const life = getLife?.();
                if (!life)
                    fail('UNAVAILABLE');
                if (endpoint === 'lifeControl' && typeof input.enabled !== 'boolean')
                    fail('INVALID_ARGUMENT');
                if (endpoint === 'lifeAction' && !isCareAction(input.action))
                    fail('INVALID_ARGUMENT');
                const workspaceId = input.workspaceId;
                const value = endpoint === 'lifeView' ? await life.snapshot(workspaceId)
                    : endpoint === 'lifeControl' ? await life.control(workspaceId, input.enabled)
                        : await life.act(workspaceId, input.action, body.requestId, 'settings');
                if (signal.aborted || peer.signal.aborted)
                    fail('CANCELLED');
                if (getLife?.() !== life || host.workspace.status().target?.id !== workspaceId)
                    fail('STALE_BINDING');
                return { ok: true, value: endpoint === 'lifeView' ? { ...value,
                        roomAvailable: Boolean(getRoom?.()), channelsAvailable: Boolean(getChannels?.()),
                        careActions: CARE_ACTIONS.map(action => ({ action, label: BODY_ACTIONS[action].care.label })),
                    } : value };
            }
            if (endpoint === 'snapshot') {
                object(body.input, []);
                const editorScope = host.workspace.editScope();
                const identity = unwrap(await host.services.core.getIdentity(context(), {}, options));
                const policy = unwrap(await host.services.core.getPolicy(context(), {}, options));
                const prefs = unwrap(await host.services.preferences.read(context(), {}, options));
                const workspace = unwrap(await host.services.workspace.inspect(context(), {}, options));
                const migrating = workspace.state === 'migration-required';
                let migrationHelp = null;
                if (migrating)
                    switch (workspace.migrationReason) {
                        case MIGRATION_REASON.bindingNotMigratable:
                            migrationHelp = '在版本页换回 0.2.0，把工作区选择和初始化理顺后再升级。';
                            break;
                        case MIGRATION_REASON.migrationIncomplete:
                            migrationHelp = workspace.olderMigrationJournal
                                ? '退出 DSH，换回原版本的包和源码续做，或按回退流程恢复。'
                                : '退出 DSH，使用与已安装版本一致的源码和原备份，通过 --resume 续做。完成后重启 DSH。';
                            break;
                        case MIGRATION_REASON.storageVersionOutdated:
                            migrationHelp = '退出 DSH，从与已安装版本一致的源码运行迁移命令。迁移成功后重启 DSH。';
                            break;
                        default:
                            migrationHelp = '退出 DSH，用与已安装版本一致的源码检查存储清单、迁移日志和绑定。核对备份后按离线诊断处理。';
                    }
                const profile = unwrap(await host.services.workspace.readProfile(context(), {}, options));
                const capabilities = unwrap(await host.services.core.listCapabilities(context(), {}, options));
                const registry = getWorkspaces();
                const workspaces = await Promise.all((registry?.list() ?? []).map(async (workspace) => ({
                    id: workspace.id, title: workspace.title, path: workspace.path, state: await workspace.status(),
                })));
                if (getHost() !== host || signal.aborted || peer.signal.aborted)
                    fail('CANCELLED');
                host.workspace.assertEditScope(editorScope);
                return { ok: true, value: { identity: { revision: identity.revision, displayName: identity.displayName, character: identity.character },
                        policy, preferences: prefs, capabilities, workspaces, workspaceAvailable: Boolean(registry), workspace, migrationHelp, profile, editorScope,
                        storage: host.workspace.storageStatus(),
                        desktop: migrating ? null : getDesktop?.(host)?.status() ?? null,
                        platformAvailable: !migrating && Boolean(getPlatform?.()),
                        presentation: migrating ? null : getPlatform?.()?.status?.() ?? null,
                        memory: { enabled: !migrating && Boolean(host.native.memory && host.native.memoryEnabledForNewSessions()),
                            provider: host.native.memory?.connection.lifecycle ?? null,
                            error: host.native.memory?.lastError ?? null },
                        worldModules: getWorldModules?.() ?? [],
                        companion: workspace.state === 'ready' ? host.workspace.companionConfiguration() : null,
                        nativeConversationReady: workspace.state === 'ready' && Boolean(registry) } };
            }
            if (endpoint === 'worldView' || endpoint === 'archiveFind' || endpoint === 'archiveRead') {
                const archiveKey = endpoint === 'archiveFind' ? 'query' : endpoint === 'archiveRead' ? 'memoryId' : null;
                const input = object(body.input, ['workspaceId', archiveKey ?? 'section']);
                const { workspaceId } = input;
                if (typeof workspaceId !== 'string' || !workspaceId.trim())
                    fail('INVALID_ARGUMENT');
                const argument = archiveKey ? requiredText(input[archiveKey], archiveKey === 'query' ? 240 : 256) : '';
                const module = archiveKey ? 'memory' : typeof input.section === 'string' && sectionModules.get(input.section);
                if (!module)
                    fail('INVALID_ARGUMENT');
                const modulesReady = () => getWorldModules?.().includes(module);
                if (!modulesReady())
                    fail('WORLD_UNAVAILABLE');
                const binding = unwrap(await host.services.workspace.inspect(context(), {}, options));
                const registered = getWorkspaces()?.get(workspaceId);
                if (binding.state !== 'ready' || binding.target?.id !== workspaceId || registered?.id !== workspaceId
                    || registered.path !== binding.target.path)
                    fail('STALE_BINDING');
                if (await registered.status() !== 'ok')
                    fail('NOT_FOUND');
                // Directory availability is asynchronous. Resolve the services and binding
                // again before reading any workspace content from the current owners.
                const verifyCurrentScope = () => {
                    if (peer.signal.aborted)
                        fail('UNAUTHORIZED');
                    if (signal.aborted)
                        fail('CANCELLED');
                    if (getHost() !== host || !modulesReady())
                        fail('WORLD_UNAVAILABLE');
                    const now = host.workspace.status();
                    if (getWorkspaces()?.get(workspaceId) !== registered || now.state !== 'ready'
                        || now.target?.id !== workspaceId || now.target.path !== registered.path
                        || now.revision !== binding.revision || now.sourceRevision !== binding.sourceRevision)
                        fail('STALE_BINDING');
                };
                verifyCurrentScope();
                if (archiveKey) {
                    const memory = host.native.memory;
                    if (!memory)
                        fail('MEMORY_UNAVAILABLE');
                    let value;
                    try {
                        value = archiveKey === 'query' ? await memory.findForOwner(workspaceId, argument)
                            : await memory.readForOwner(workspaceId, argument);
                    }
                    catch (error) {
                        verifyCurrentScope();
                        const code = error instanceof Rejection ? error.detail.code
                            : error && typeof error === 'object' && 'code' in error ? error.code : undefined;
                        if (code === 'STALE_BINDING' || code === 'INELIGIBLE')
                            fail(code);
                        const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
                        if (status === 403 || status === 404 || status === 409)
                            fail('INELIGIBLE');
                        fail('MEMORY_UNAVAILABLE');
                    }
                    verifyCurrentScope();
                    return { ok: true, value };
                }
                if (input.section === 'sessions')
                    return { ok: true, value: { workspaceId, sessions: registered.sessionIds?.length ?? null } };
                if (input.section === 'profile') {
                    let profile;
                    try {
                        profile = host.native.context();
                    }
                    catch {
                        fail('PROFILE_UNAVAILABLE');
                    }
                    const estimatedTokens = estimateTokens([profile.identity, profile.user].filter(Boolean).join('\n\n'));
                    return { ok: true, value: { workspaceId, profile: { ...profile, estimatedTokens } } };
                }
                const emotion = getEmotion?.();
                const current = emotion?.current(workspaceId);
                const label = (asset) => asset.label || asset.name;
                return { ok: true, value: { workspaceId,
                        emotion: emotion ? {
                            current: current ? { mood: current.mood, at: current.at } : null,
                            actions: emotion.catalog.actions.map(label), stickers: emotion.catalog.stickers.map(label),
                        } : null,
                    } };
            }
            if (endpoint === 'desktopOpen' || endpoint === 'desktopClose') {
                const input = object(body.input, ['workspaceId']);
                const desktop = getDesktop?.(host);
                if (!desktop)
                    fail('UNAVAILABLE');
                const workspace = host.workspace.status();
                if (workspace.target?.id !== input.workspaceId || (endpoint === 'desktopOpen' && workspace.state !== 'ready'))
                    fail('STALE_BINDING');
                if (endpoint === 'desktopOpen')
                    await desktop.start();
                else
                    await desktop.closeWindow();
                return { ok: true, value: desktop.status() };
            }
            if (endpoint === 'companion') {
                const input = object(body.input, ['workspaceId', 'expectedSettings', 'settings']);
                return { ok: true, value: unwrap(await host.services.workspace.saveCompanion(context(), {
                        workspaceId: input.workspaceId, expectedSettings: input.expectedSettings,
                        settings: input.settings,
                    }, options)) };
            }
            if (endpoint === 'initialize') {
                const input = object(body.input, ['expectedPreferencesRevision']);
                const prefs = unwrap(await host.services.preferences.read(context(), {}, options));
                const target = prefs.workspace && getWorkspaces()?.get(prefs.workspace.id);
                if (!target || target.path !== prefs.workspace?.path || await target.status() !== 'ok')
                    fail('NOT_FOUND');
                return { ok: true, value: unwrap(await host.services.workspace.initialize(context(), {
                        expectedPreferencesRevision: input.expectedPreferencesRevision,
                    }, options)) };
            }
            if (endpoint === 'profile') {
                const input = object(body.input, ['expectedScope', 'expectedRevision', 'text']);
                return { ok: true, value: unwrap(await host.services.workspace.saveProfile(context(), {
                        expectedScope: input.expectedScope,
                        expectedRevision: input.expectedRevision, text: input.text,
                    }, options)) };
            }
            if (endpoint === 'identity') {
                const input = object(body.input, ['expectedScope', 'expectedRevision', 'displayName', 'character']);
                const identity = unwrap(await host.services.core.reviseIdentity(context(), input, options));
                return { ok: true, value: { revision: identity.revision, displayName: identity.displayName, character: identity.character } };
            }
            if (endpoint === 'quiet') {
                const input = object(body.input, ['expectedRevision', 'quiet']);
                if (typeof input.quiet !== 'boolean')
                    fail('INVALID_ARGUMENT');
                return { ok: true, value: unwrap(await host.services.preferences.setQuiet(context(), {
                        expectedRevision: input.expectedRevision, quiet: input.quiet,
                    }, options)) };
            }
            if (endpoint === 'preferences') {
                const input = object(body.input, ['expectedRevision', 'workspaceId', 'conversation']);
                if (input.workspaceId !== null && typeof input.workspaceId !== 'string')
                    fail('INVALID_ARGUMENT');
                let workspace = null;
                if (input.workspaceId !== null) {
                    const target = getWorkspaces()?.get(input.workspaceId);
                    if (!target)
                        fail('NOT_FOUND');
                    if (await target.status() !== 'ok')
                        fail('NOT_FOUND');
                    workspace = { id: target.id, title: target.title, path: target.path };
                }
                object(input.conversation, ['maxContextChars', 'maxSteps', 'maxToolCalls', 'maxDurationMs']);
                return { ok: true, value: unwrap(await host.services.preferences.save(context(), {
                        expectedRevision: input.expectedRevision, workspace,
                        conversation: input.conversation,
                    }, options)) };
            }
            fail('INVALID_ARGUMENT');
        }
        catch (error) {
            const code = error instanceof Rejection ? error.detail.code : typeof error === 'object' && error && 'code' in error ? String(error.code) : 'INTERNAL';
            if (['economyView', 'economyAction', 'economySettings'].includes(endpoint)) {
                const economic = {
                    INELIGIBLE: '余额或可用物品不足，或该商品暂不可交易。请核对钱包与库存。',
                    NOT_FOUND: '所选物品或原操作不存在，请刷新商店与库存。',
                    UNAVAILABLE: '经济资料暂不可用。原钱包与未决操作保留，请检查绑定和经济组件状态。',
                    INVALID_ARGUMENT: '请检查金额、数量、阅读内容或经济设置。',
                };
                if (economic[code])
                    return { ok: false, error: { code, message: economic[code], details: {} } };
            }
            return { ok: false, error: { code, message: messages[code] ?? '设置操作未完成，请刷新核对实际状态。', details: {} } };
        }
    };
}
//# sourceMappingURL=settings.js.map