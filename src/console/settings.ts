import type { Context } from '@deepseek-ai/cordis';
import { unknownEffect, type ContractError } from '../contracts/common.js';
import { BODY_ACTIONS, CARE_ACTIONS } from '../contracts/behavior.js';
import { unwrap } from '../core/console-operations.js';
import { sameHomeBinding } from '../core/home-binding.js';
import type { PetCoreHost } from '../core/index.js';
import { Rejection } from '../core/storage.js';
import { MIGRATION_REASON } from '../core/storage-migration.js';
import { fail, object, requiredText, type ConsoleCode, type SettingsWorkspaceRegistry } from '../core/tables/console.js';
import { animationSlotAllowed } from '../living/body/animation-slots.js';
import { classifyActivity } from '../living/body/presentation.js';
import { withHomePlayback } from '../presentation/playback.js';
import { ROOM_ENDPOINTS } from '../presentation/room-transport.js';
import { estimateTokens } from '#dsh-world/console/snapshot';

export type { SettingsWorkspaceRegistry } from '../core/tables/console.js';

export interface EconomyControls {
  consoleWrite(endpoint: string, input: unknown, requestId: string, signal: AbortSignal, validate: () => void): Promise<unknown>;
}

/** Connection's locally available structural PeerScope subset. */
type SettingsError = {
  code: string;
  message: string;
  details: Record<string, never>;
  effect: ContractError['effect'];
  retry: ContractError['retry'];
};
export type SettingsReply = { ok: true; value: unknown } | { ok: false; error: SettingsError };
export type SettingsHandler = (endpoint: string, payload: unknown, signal: AbortSignal,
  peer: {principal: {kind: string}; signal: AbortSignal}) => Promise<SettingsReply>;

// Exact compatibility routes stay addressable while an optional owner is unloaded.
const owners = {
  core: ['foundation', 'self', 'companion', 'identity', 'quiet', 'preferences', 'initialize', 'profile',
    'lifeDates', 'lifeJournal', 'lifeAlbum', 'lifeSearch', 'lifePhoto', 'lifeForgetPhoto'],
  economy: ['economyView', 'economyPending', 'economyCheck', 'economyRetry', 'economyAbandon'],
  emotion: ['emotionState', 'emotionUpdate'],
  room: ['roomOpen', ...ROOM_ENDPOINTS],
  desktop: ['desktopOpen', 'desktopClose'],
  platform: ['presentationTiming', 'presentationMigration', 'petPlatformAccess', 'petControlAccess', 'petStandaloneAccess'],
  channels: ['qzoneState', 'qzoneSettings', 'qzoneDraft', 'qzoneRemove', 'groupState', 'groupSettings', 'groupSlang',
    'groupResearch', 'channelStatus', 'bridgeSettings', 'messagingSettings'],
  life: ['lifeView', 'lifeControl', 'lifeAction', 'lifePreferences'],
};
const endpointOwners = new Map(Object.entries(owners).flatMap(([owner, endpoints]) => endpoints.map(endpoint => [endpoint, owner])));
const walletWrites = new Set(['economyAction', 'economySettings']);
const walletRecovery = new Set(['economyPending', 'economyCheck', 'economyRetry', 'economyAbandon']);
export const settingsEndpoints = ['snapshot', 'worldView', 'archiveFind', 'archiveRead', ...walletWrites, ...endpointOwners.keys()];

const messages: Partial<Record<ConsoleCode, string>> = {
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

const economicMessages: Partial<Record<ConsoleCode, string>> = {
  INELIGIBLE: '余额或可用物品不足，或该商品暂不可交易。请核对钱包与库存。',
  NOT_FOUND: '所选物品或原操作不存在，请刷新商店与库存。',
  UNAVAILABLE: '经济资料暂不可用。原钱包与未决操作保留，请检查绑定和经济组件状态。',
  INVALID_ARGUMENT: '请检查金额、数量、阅读内容或经济设置。',
};

function settingsError(endpoint: string, error: unknown): SettingsReply {
  const detail = error instanceof Rejection ? error.detail : undefined;
  const code = detail?.code ?? (error && typeof error === 'object' && 'code' in error ? String(error.code) : 'INTERNAL');
  const economic = endpoint === 'economyView' || walletWrites.has(endpoint) || walletRecovery.has(endpoint);
  const message = (economic && economicMessages[code as ConsoleCode]) || messages[code as ConsoleCode]
    || '设置操作未完成，请刷新核对实际状态。';
  const effect = detail?.effect ?? (code === 'OUTCOME_UNKNOWN' || code === 'INTERNAL' ? 'unknown' : 'none');
  const retry = detail?.retry ?? (effect === 'unknown' ? 'reconcile'
    : code === 'STALE_BINDING' || code === 'STALE_REVISION' ? 'refresh' : 'never');
  return {ok: false, error: {code, message, details: {}, effect, retry}};
}

const sectionModules = new Map([['profile', 'persona'], ['sessions', 'archive'], ['emotion', 'mood']]);

/** Owner-only exact RPCs share admission. Both wallet write routes use the durable owner registry. */
export function settingsHandler(
  getHost: () => PetCoreHost | undefined,
  getWorkspaces: () => SettingsWorkspaceRegistry | undefined,
  getWorldModules?: () => readonly string[],
  getEconomy?: () => EconomyControls | undefined,
  scope?: Context,
): SettingsHandler {
  return async (endpoint, payload, signal, peer) => {
    try {
      if (peer.principal.kind !== 'owner' || peer.signal.aborted) fail('UNAUTHORIZED');
      if (signal.aborted) fail('CANCELLED');
      const host = getHost();
      if (!host) fail('UNAVAILABLE');
      const body = object(payload, ['requestId', 'input']);
      if (typeof body.requestId !== 'string' || body.requestId.length < 1 || body.requestId.length > 160) fail('INVALID_ARGUMENT');
      if (endpoint !== 'snapshot' && host.workspace.status().state === 'migration-required') fail('migration-required');
      const table = host.native.consoleOperations;
      const context = () => host.operator.request(`settings:${endpoint}:${body.requestId}`);
      const options = {signal: AbortSignal.any([signal, peer.signal])};
      if (walletWrites.has(endpoint)) {
        const input = object(body.input, ['workspaceId', ...(endpoint === 'economyAction' ? ['action'] : ['expectedVersion','next'])]);
        const workspaceId = requiredText(input.workspaceId, 200), home = host.workspace.homeScope();
        const binding = host.workspace.status(), registered = getWorkspaces()?.get(workspaceId), economy = getEconomy?.();
        if (!economy) fail('UNAVAILABLE');
        if (!home || binding.state !== 'ready' || home.workspaceId !== workspaceId || registered?.path !== home.path) fail('STALE_BINDING');
        const validate = () => {
          if (peer.principal.kind !== 'owner' || peer.signal.aborted) fail('UNAUTHORIZED');
          if (signal.aborted) fail('CANCELLED');
          const current = host.workspace.status();
          if (getHost() !== host || getEconomy?.() !== economy || getWorkspaces()?.get(workspaceId) !== registered
            || !sameHomeBinding(host.workspace.homeScope(),home) || current.state !== 'ready'
            || current.revision !== binding.revision || current.sourceRevision !== binding.sourceRevision) fail('STALE_BINDING');
        };
        const available = await registered.status();
        validate();
        if (available !== 'ok') fail('NOT_FOUND');
        try {
          const value = await economy.consoleWrite(endpoint, input, body.requestId, options.signal, validate);
          validate();
          return {ok: true, value};
        } catch (error) {
          if (options.signal.aborted && !(error instanceof Rejection))
            throw new Rejection(unknownEffect('CANCELLED', 'Check the original wallet request after cancellation'));
          throw error;
        }
      }
      if (endpoint === 'snapshot') {
        object(body.input, []);
        const editorScope=host.workspace.editScope();
        const identity = unwrap(await host.services.core.getIdentity(context(), {}, options));
        const policy = unwrap(await host.services.core.getPolicy(context(), {}, options));
        const prefs = unwrap(await host.services.preferences.read(context(), {}, options));
        const workspace = unwrap(await host.services.workspace.inspect(context(), {}, options));
        const migrating = workspace.state === 'migration-required';
        let migrationHelp: string | null = null;
        if (migrating) switch (workspace.migrationReason) {
          case MIGRATION_REASON.bindingNotMigratable:
            migrationHelp = '退出 DSH，先核对工作区选择和绑定，再参考 v0.5.0 tag 的工具说明。'; break;
          case MIGRATION_REASON.migrationIncomplete:
            migrationHelp = '退出 DSH，保留原日志和备份，使用 v0.5.0 tag 的工具检查未完成的迁移。'; break;
          case MIGRATION_REASON.storageVersionOutdated:
            migrationHelp = '退出 DSH，使用 v0.5.0 tag 的工具把存储迁移到 0.5.0。完成后再启动 DSH。'; break;
          default:
            migrationHelp = '退出 DSH，用 v0.5.0 tag 的工具检查存储清单、迁移日志和绑定。核对原备份后再处理。';
        }
        const profile = unwrap(await host.services.workspace.readProfile(context(), {}, options));
        const capabilities = unwrap(await host.services.core.listCapabilities(context(), {}, options));
        const registry = getWorkspaces();
        const workspaces = await Promise.all((registry?.list() ?? []).map(async workspace => ({
          id: workspace.id, title: workspace.title, path: workspace.path, state: await workspace.status(),
        })));
        if(signal.aborted || peer.signal.aborted || getHost()!==host)fail('CANCELLED');
        host.workspace.assertEditScope(editorScope);
        return { ok: true, value: { identity: { revision: identity.revision, displayName: identity.displayName, character: identity.character },
          policy, preferences: prefs, capabilities, workspaces, workspaceAvailable: Boolean(registry), workspace, migrationHelp, profile, editorScope,
          storage: host.workspace.storageStatus(),
          desktop: migrating ? null : table.get('desktop', scope)?.value.status?.(workspace.target?.id ?? '') ?? null,
          platformAvailable:!migrating && Boolean(table.get('platform', scope)),
          presentation:migrating ? null : table.get('platform', scope)?.value.status?.(workspace.target?.id ?? '') ?? null,
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
        if (typeof workspaceId !== 'string' || !workspaceId.trim()) fail('INVALID_ARGUMENT');
        const argument = archiveKey ? requiredText(input[archiveKey], archiveKey === 'query' ? 240 : 256) : '';
        const module = archiveKey ? 'memory' : typeof input.section === 'string' && sectionModules.get(input.section);
        if (!module) fail('INVALID_ARGUMENT');
        const modulesReady = () => getWorldModules?.().includes(module);
        if (!modulesReady()) fail('WORLD_UNAVAILABLE');
        const binding = unwrap(await host.services.workspace.inspect(context(), {}, options));
        const registered = getWorkspaces()?.get(workspaceId);
        if (binding.state !== 'ready' || binding.target?.id !== workspaceId || registered?.id !== workspaceId
          || registered.path !== binding.target.path) fail('STALE_BINDING');
        if (await registered.status() !== 'ok') fail('NOT_FOUND');

        // Directory availability is asynchronous. Resolve the services and binding
        // again before reading any workspace content from the current owners.
        const verifyCurrentScope = () => {
          if (peer.signal.aborted) fail('UNAUTHORIZED');
          if (signal.aborted) fail('CANCELLED');
          if (getHost() !== host || !modulesReady()) fail('WORLD_UNAVAILABLE');
          const now = host.workspace.status();
          if (getWorkspaces()?.get(workspaceId) !== registered || now.state !== 'ready'
            || now.target?.id !== workspaceId || now.target.path !== registered.path
            || now.revision !== binding.revision || now.sourceRevision !== binding.sourceRevision) fail('STALE_BINDING');
        };
        verifyCurrentScope();
        if (archiveKey) {
          const memory = host.native.memory;
          if (!memory) fail('MEMORY_UNAVAILABLE');
          let value;
          try {
            value = archiveKey === 'query' ? await memory.findForOwner(workspaceId, argument)
              : await memory.readForOwner(workspaceId, argument);
          } catch (error) {
            verifyCurrentScope();
            const code = error instanceof Rejection ? error.detail.code
              : error && typeof error === 'object' && 'code' in error ? error.code : undefined;
            if (code === 'STALE_BINDING' || code === 'INELIGIBLE') fail(code);
            const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
            if (status === 403 || status === 404 || status === 409) fail('INELIGIBLE');
            fail('MEMORY_UNAVAILABLE');
          }
          verifyCurrentScope();
          return { ok: true, value };
        }
        if (input.section === 'sessions') return { ok: true, value: { workspaceId, sessions: registered.sessionIds?.length ?? null } };
        if (input.section === 'profile') {
          let profile;
          try { profile = host.native.context(); } catch { fail('PROFILE_UNAVAILABLE'); }
          const estimatedTokens = estimateTokens([profile.identity, profile.user].filter(Boolean).join('\n\n'));
          return { ok: true, value: { workspaceId, profile: { ...profile, estimatedTokens } } };
        }
        return {ok: true, value: {workspaceId, emotion: table.get('emotion', scope)?.value.status?.(workspaceId) ?? null}};
      }
      const owner = endpointOwners.get(endpoint);
      if (!owner) fail('INVALID_ARGUMENT');
      const entry = table.get(owner, scope), operation = entry?.value.operations[endpoint];
      if (!entry || !operation) fail('UNAVAILABLE');

      let binding: ReturnType<PetCoreHost['workspace']['status']> | undefined;
      let home: ReturnType<PetCoreHost['workspace']['homeScope']>;
      const validate = () => {
        if (options.signal.aborted) fail('CANCELLED');
        if (getHost() !== host || table.get(owner, scope) !== entry) fail('STALE_BINDING');
        if (!binding) return;
        const current = host.workspace.status();
        if (current.target?.id !== binding.target?.id || current.target?.path !== binding.target?.path
          || current.state !== binding.state || !sameHomeBinding(host.workspace.homeScope(), home)) fail('STALE_BINDING');
      };
      const checkBinding = (workspaceId: unknown, ready = false) => {
        binding = host.workspace.status();
        if (binding.target?.id !== workspaceId || (ready && binding.state !== 'ready')) fail('STALE_BINDING');
        home = host.workspace.homeScope();
        validate();
      };
      const cancelledReply = () => new Rejection(unknownEffect('CANCELLED', 'Console reply cancelled'));
      let value: unknown;
      try {
        value = await operation({input: body.input, requestId: body.requestId, signal: options.signal,
          getWorkspaces, checkBinding, validate});
      } catch (error) {
        if (options.signal.aborted && !(error instanceof Rejection)
          && (owner === 'room' || error === options.signal.reason)) throw cancelledReply();
        throw error;
      }
      if (options.signal.aborted) throw cancelledReply();
      validate();
      if (owner !== 'life' || endpoint === 'lifePreferences') return {ok: true, value};
      const life = value as {home?: Parameters<typeof withHomePlayback>[0]};
      const projected = life.home ? {...life, home: withHomePlayback(life.home, animationSlotAllowed, classifyActivity)} : life;
      return {ok: true, value: endpoint !== 'lifeView' ? projected : {...projected,
        roomAvailable: Boolean(table.get('room', scope)), channelsAvailable: Boolean(table.get('channels', scope)),
        careActions: CARE_ACTIONS.map(action => ({action, label: BODY_ACTIONS[action].care.label})),
      }};
    } catch (error) {
      return settingsError(endpoint, error);
    }
  };
}
