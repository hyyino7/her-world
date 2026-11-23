import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {Context} from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import {
  corePlugin, memoryPlugin, lifePlugin, desktopPlugin, roomPlugin, channelsPlugin, voicePlugin, emotionPlugin,
} from '../../dist/tests/behavior-list/entries.js';
import * as consolePlugin from '../../dist/src/console/plugin.js';
import {createCore} from '../../dist/src/core/index.js';
import {qqTransport} from '../behavior-list/qq-transport.mjs';
import {value} from '../behavior-list/fixture.mjs';

const nativeUnavailable = ['unavailable', 'Native component is not available'];
const operations = {
  presentation: ['send', 'stop', 'fold', 'reopen'],
  body: ['open', 'close', 'drag', 'play'],
  life: ['start', 'stop', 'inspect', 'interact'],
};
const ready = ['ready', null];
const pausedLife = ['disabled', 'Life is paused', operations.life];
const stoppedMemory = ['degraded', 'Memory provider stopped; chat continues without recall on failure'];
const disabledMemory = ['disabled', 'Memory is off for the next turn in every conversation; retained Bank and native logs remain'];
const closedDesktop = ['disabled', 'Desktop window is closed'];
const unboundDesktop = ['unavailable', 'Bind a workspace to open the desktop'];
const unavailableExpression = ['unavailable', 'Requires a bound workspace and expression assets'];
const qqStates = {
  off: ['disabled', 'QQ is off'],
  unavailable: ['unavailable', 'QQ is disconnected'],
  online: ['ready', null, ['receive', 'reply']],
};
const rowOrder = [
  ['core.conversation', 'core'], ['memory.lifecycle', 'memory'], ['life.pursuits', 'life'],
  ['desktop.presentation', 'desktop'], ['desktop.body', 'desktop'], ['desktop.room', 'desktop'],
  ['channel.qq', 'qq'], ['voice.speech', 'voice'], ['console.operations', 'console'], ['emotion.expression', 'emotion'],
];
function rows(order, statuses) {
  return order.flatMap(([id, owner]) => {
    if (statuses[id] === null) return [];
    const [state, reason, supportedOperations = []] = statuses[id] ?? nativeUnavailable;
    return [{id, owner, contractVersion: '0.3', state, reason, supportedOperations}];
  });
}

// 以 ceb3529 的公开输出为基准。模块卸载造成的变化集中在缺席期望里。
function expected({bound, desktopOpen, qq, hear, missing}) {
  const desktop = desktopOpen ? ready : bound ? closedDesktop : unboundDesktop;
  const all = {
    'core.conversation': bound
      ? ['ready', 'Native DSH owns ordinary conversation execution', ['native-chat']]
      : ['unavailable', 'Bind a workspace to use the companion'],
    'memory.lifecycle': stoppedMemory,
    'life.pursuits': bound ? pausedLife : ['unavailable', 'Bind a workspace to start Life', operations.life],
    'desktop.presentation': [...desktop, operations.presentation],
    'desktop.body': [...desktop, operations.body],
    'desktop.room': bound ? ['ready', null, ['view', 'garden', 'history']] : ['unavailable', 'Bind a workspace to open the room'],
    'channel.qq': qqStates[bound ? qq : 'off'],
    'voice.speech': !bound ? ['unavailable', 'Bind a workspace to use speech']
      : hear ? ['ready', null, ['speak', 'hear']] : ['degraded', 'Speech recognition provider is unavailable', ['speak']],
    'emotion.expression': bound ? ['ready', null, ['express', 'recordPlayback']] : unavailableExpression,
  };
  const absent = {
    petMemory: {'memory.lifecycle': disabledMemory},
    petLife: {'life.pursuits': null},
    petDesktop: {'desktop.presentation': null, 'desktop.body': null},
    petRoom: {'desktop.room': null},
    petChannels: {'channel.qq': null},
    petVoice: {'voice.speech': null},
    console: {'console.operations': null},
    petEmotion: {'emotion.expression': null},
  };
  return rows(rowOrder, {...all, ...absent[missing]});
}

function temporaryCore() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'capability-table-')));
  const repo = join(root, 'workspace');
  mkdirSync(repo);
  return {
    root, repo,
    cleanup: () => rmSync(root, {recursive: true, force: true}),
    config: {dataDir: join(root, 'core'), companionId: 'fixture', scopeId: 'fixture',
      ownerActorId: 'owner', displayName: 'Fixture', character: ''},
  };
}

test('独立 createCore 只返回当前由 Core 登记的能力', async t => {
  const temp = temporaryCore();
  const host = createCore(temp.config);
  t.after(async () => {try {await host.close();} finally {temp.cleanup();}});
  const actual = value(await host.services.core.listCapabilities(host.operator.request('capabilities'), {}));
  assert.deepEqual(actual, rows(rowOrder.slice(0, 2), {}));
});

async function pluginFixture(t) {
  const temp = temporaryCore();
  const root = new Context();
  const fibers = [];
  t.after(async () => {
    try {
      for (const fiber of fibers.reverse()) await fiber.dispose();
    } finally {
      temp.cleanup();
    }
  });
  const install = async (plugin, config) => {
    const fiber = await root.plugin(plugin, config);
    fibers.push(fiber);
    return fiber;
  };

  let desktopOpen = false, hear = false, qq = 'off';
  const transport = qqTransport(t);
  const fakeTransport = globalThis.__behaviorQQTransport;
  globalThis.__behaviorQQTransport = options => ({...fakeTransport(options), getState: () => qq});
  const workspace = {id: 'world', path: temp.repo, title: 'Fixture', sessionIds: [], status: () => 'ok'};
  const routes = new Map();
  const peer = {principal: {kind: 'owner'}, signal: new AbortController().signal};
  await install({
    apply(ctx) {
      for (const service of ['agents', 'sessions', 'sessionPersistence', 'agentLoop', 'agentPresets',
        'sessionController', 'petBehavior']) ctx.provide(service, {});
      ctx.provide('profileContext', {dir: temp.root});
      ctx.provide('workspaceRegistry', {get: id => id === workspace.id ? workspace : undefined, list: () => [workspace]});
      ctx.provide('webServer', {getOrigin: () => 'http://fixture.invalid', register: () => () => {}});
      ctx.provide('petPlatform', {bodyStatus: () => ({running: desktopOpen})});
      ctx.provide('speechToText', {transcribe() {}, resolve() {}, listProviders: () => hear ? ['fixture'] : []});
      ctx.provide('connection', {browserPeer: peer, fetch: {register(route) {
        routes.set(route.path, route.fetch);
        return () => routes.delete(route.path);
      }}});
    },
  });
  await install(SystemPrompt, {includeHarnessIdentity: false});
  await install(Tools);
  await install(corePlugin, {...temp.config, memory: {
    python: resolve('.venv/bin/python'), dataDir: join(temp.repo, '.chatpet/data/memory'),
  }});
  const host = root.get('petCore');
  const plugins = {
    console: consolePlugin, petMemory: memoryPlugin, petLife: lifePlugin, petDesktop: desktopPlugin, petRoom: roomPlugin,
    petChannels: channelsPlugin, petVoice: voicePlugin, petEmotion: emotionPlugin,
  };
  const loaded = new Map();
  async function load(service) {
    loaded.set(service, await install(plugins[service]));
    const module = service === 'console' ? undefined : root.get(service);
    if (service !== 'console') assert.ok(module, service + ' 已加载');
    if (service === 'petEmotion') module.registerCatalog('fixture', {
      actions: [{name: 'wave', description: 'Fixture action'}], stickers: [],
    });
  }
  for (const service of Object.keys(plugins)) await load(service);
  let sequence = 0;
  const request = () => host.operator.request('capabilities-' + sequence++);
  return {
    modules: Object.keys(plugins), load,
    async unload(service) {
      const fiber = loaded.get(service);
      await fiber.dispose();
      fibers.splice(fibers.indexOf(fiber), 1);
      loaded.delete(service);
      if (service !== 'console') assert.equal(root.get(service), undefined, service + ' 已卸载');
    },
    async bind() {
      const {revision, conversation} = value(await host.services.preferences.read(request(), {}));
      const saved = value(await host.services.preferences.save(request(), {expectedRevision: revision, conversation,
        workspace: {id: workspace.id, path: workspace.path, title: workspace.title}}));
      assert.equal(value(await host.services.workspace.initialize(request(), {expectedPreferencesRevision: saved.revision})).state, 'ready');
    },
    async setQQ(bound, state) {
      qq = state;
      const channels = root.get('petChannels');
      if (!bound || !channels) return;
      const {messaging} = await channels.request(workspace.id, 'channelStatus', {});
      if (messaging.config.qq.enabled !== (state !== 'off')) {
        await channels.request(workspace.id, 'messagingSettings', {
          expected: messaging.config, next: {qq: {enabled: state !== 'off', accountId: '100'}},
        });
      }
      if (state !== 'off') assert.ok(transport.gateway, 'QQ 已连接合成传输层');
    },
    setPresentation(open, recognition) {desktopOpen = open; hear = recognition;},
    async list() {return value(await host.services.core.listCapabilities(request(), {}));},
    async sourcePolicies() {
      await root.get('petChannels').refresh();
      return host.native.sourceTable.policyRows();
    },
    async snapshot() {
      const method = 'chatpetSettings/snapshot', path = '/api/' + method;
      const response = await routes.get(path)(new Request('http://fixture.invalid' + path, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({type: 'client-request', method, rpcId: 'snapshot', payload: {requestId: 'snapshot', input: {}}}),
      }));
      return value((await response.json()).result);
    },
  };
}

test('全部模块加载后登记九行会话策略，且每个授权面引用有效的行为清单条目', async t => {
  const f = await pluginFixture(t);
  await f.bind();
  const policies = await f.sourcePolicies();
  assert.deepEqual(policies.map(policy => policy.row), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const index = JSON.parse(readFileSync(new URL('../behavior-list/index.json', import.meta.url), 'utf8'));
  const behaviorIds = new Set(index.entries.map(entry => entry.id));
  for (const policy of policies) {
    const declarations = [policy.tools, policy.memoryObservation, policy.emotionUpdate?.footer, policy.emotionUpdate?.tool];
    for (const declaration of declarations) {
      assert.ok(declaration?.description.trim(), `第 ${policy.row} 行缺少授权说明`);
      assert.ok(Array.isArray(declaration.behaviorIds), `第 ${policy.row} 行缺少行为清单引用`);
      for (const id of declaration.behaviorIds) assert.ok(behaviorIds.has(id), `第 ${policy.row} 行引用了未知条目 ${id}`);
    }
  }
});

test('能力输出逐行匹配旧版，覆盖单模块卸载和恢复', async t => {
  const f = await pluginFixture(t);
  for (const bound of [false, true]) {
    if (bound) await f.bind();
    async function compare(missing, phase) {
      for (const qq of Object.keys(qqStates)) {
        await f.setQQ(bound, qq);
        for (const desktopOpen of [false, true]) for (const hear of [false, true]) {
          f.setPresentation(desktopOpen, hear);
          const scenario = {bound, desktopOpen, qq, hear, missing};
          assert.deepEqual(await f.list(), expected(scenario), JSON.stringify({phase, ...scenario}));
        }
      }
    }
    await compare(undefined, '全部加载');
    for (const service of f.modules) {
      await f.unload(service);
      await compare(service, '缺席');
      await f.load(service);
      await compare(undefined, '恢复 ' + service);
    }
  }
});

function descendants(node) {
  if (!node?.children) return [];
  return node.children.flatMap(child => [child, ...descendants(child)]);
}

function renderStatus(path, snapshot) {
  let entry, page, props, cursor;
  const state = [], effects = [];
  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({type, props, children}),
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], next => {state[index] = typeof next === 'function' ? next(state[index]) : next;}];
    },
    useRef: current => ({current}),
    useId: () => 'fixture',
    useEffect(fn) {effects.push(fn);},
  };
  runInNewContext(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    window: {__ModuleLoader__: {load: info => {entry = info;}}},
    AbortController, crypto, setTimeout, clearTimeout,
  });
  entry.factory(() => React).apply({
    connection: {rpc: {call: async () => ({ok: true, value: snapshot})}},
    slots: {
      inject(name, register) {if (name === 'settings.section') register();},
      register(slot, component) {page = component; props = slot.inject();},
    },
  });
  const render = () => {cursor = 0; return descendants(page(props));};
  return {render, effects};
}

test('设置页缺席状态、哔哩哔哩和 Memory 使用各自的显示规则', async t => {
  const f = await pluginFixture(t);
  await f.bind();
  const snapshot = await f.snapshot();
  const capabilities = snapshot.capabilities.filter(({owner}) => !['emotion', 'desktop', 'life', 'qq', 'voice'].includes(owner));
  for (const path of ['../../src/console/client.js', '../../src/desktop/platform/client.js']) {
    const {render, effects} = renderStatus(path, {...snapshot, capabilities});
    const initial = render();
    // 通过实际的页面挂载、快照请求和工作区标签打开运行状态。
    const cleanup = effects.map(effect => effect()).filter(Boolean);
    t.after(() => cleanup.forEach(dispose => dispose()));
    initial.find(node => node?.props?.role === 'tab' && node.children[0] === '工作区').props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    const detail = render().find(node => node?.type === 'details' && node.children[0].children[0] === '运行状态');
    const terms = descendants(detail).filter(node => ['dt', 'dd'].includes(node?.type)).map(node => node.children[0]);
    assert.deepEqual(terms, [
      '核心服务', '可用', '记忆', '未运行，按需启动', '情绪', '不可用', '桌宠', '不可用', '生活', '不可用',
      'QQ', '不可用', '哔哩哔哩', '未报告', '语音', '不可用', 'World 基础组件', '已加载 ' + snapshot.worldModules.length + ' 项',
    ], path);
  }
});
