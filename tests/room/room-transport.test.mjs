import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {apply as applyConsole} from '../../dist/src/console/plugin.js';
import {roomAsset} from '../../dist/src/room/assets.js';

const routes = [
  ['/api/home/state','roomState'],
  ['/api/home/act','roomAction'],
  ['/api/garden/state','roomGarden'],
  ['/api/garden/act','roomPlant'],
  ['/api/garden/control','roomCare'],
  ['/api/room/chat','roomChat',310000,300000],
  ['/api/tv/opinion','roomTelevision',310000,300000],
  ['/api/room/history','roomHistory'],
  ['/api/room/voice','roomVoice',310000],
];
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the served Room transport carries all endpoints through the native preload, with cancellation', async () => {
  const origin = 'http://localhost', invoked = [], cancelled = [], deadlines = [];
  let bridge, resolve;
  const ipc = new EventEmitter();
  ipc.invoke = (_channel, endpoint, data) => {
    invoked.push({endpoint, data:JSON.parse(JSON.stringify(data))});
    return new Promise(done => {resolve = done;});
  };
  ipc.send = (...args) => cancelled.push(args);
  const timer = (schedule, delay) => {deadlines.push({schedule, delay}); return deadlines.length;};
  runInNewContext(source('../../src/room/window-preload.cjs'), {
    require(name) {
      assert.equal(name, 'electron');
      return {ipcRenderer:ipc, contextBridge:{exposeInMainWorld(_name, value) {bridge = value;}}};
    },
    window:{addEventListener() {}}, queueMicrotask,
  });
  const response = await roomAsset(new Request(origin + '/chatpet-room/native-room.js'));
  assert.equal(response.status, 200);
  const exports = {};
  const code = ts.transpileModule(await response.text(), {
    compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS},
  }).outputText;
  runInNewContext(code, {exports, window:{chatpetRoomBridge:bridge}, location:{origin},
    URL, crypto, Response, setTimeout:timer, clearTimeout() {}});
  for (const [path, endpoint, timeout = 20000] of routes) {
    const pending = exports.roomRequest(path, {body:'{"from":"fixture"}'});
    assert.equal(deadlines.at(-1).delay, timeout);
    assert.deepEqual(invoked.at(-1), {endpoint, data:{from:'fixture'}});
    resolve({endpoint});
    assert.deepEqual(await (await pending).json(), {endpoint});
  }
  assert.equal(invoked.length, 9);
  await assert.rejects(bridge.request('lifeDates', {}, 'fixture'));
  await assert.rejects(bridge.request(['roomState'], {}, 'fixture'));
  await assert.rejects(bridge.request('constructor', {}, 'fixture'));
  const abort = new AbortController();
  const pending = exports.roomRequest('/api/room/voice', {signal:abort.signal});
  abort.abort();
  assert.equal(cancelled.at(-1)[0], 'chatpet-room:cancel');
  await assert.rejects(pending, /房间请求已结束/);
});

test('Console timeouts stay available without Room and preserve the original RPC periods', async () => {
  let registered, factory;
  const deadlines = [];
  runInNewContext(source('../../src/console/client.js'), {
    window:{__ModuleLoader__:{load(module) {factory = module.factory;}}},
    AbortController, crypto,
    setTimeout(_expire, delay) {deadlines.push(delay);},
    clearTimeout() {},
  });
  const registeredRequests = [];
  const console = factory(() => ({createElement(){}}));
  console.apply({
    slots:{inject(_name, fn){fn();}, register(route){if(route.inject) registered = route.inject().request;}},
    connection:{rpc:{call(prefix, method, body) {registeredRequests.push({prefix, method, body}); return {ok:true, value:method};}}},
  });
  for (const [_path, endpoint, _roomTimeout, timeout = 15000] of [...routes, ['/unused','lifeDates']]) {
    assert.equal(await registered(endpoint, {}, undefined, 'fixture'), 'chatpetSettings/' + endpoint);
    assert.equal(deadlines.at(-1), timeout);
    assert.equal(registeredRequests.at(-1).body.requestId, 'fixture');
  }
});

test('Console registers the Room subset in the owner RPC table and keeps lifeDates on records', async () => {
  const signal = new AbortController().signal, handlers = new Map(), dispatched = [], dates = [];
  const peer = {principal:{kind:'owner'}, signal};
  const host = {workspace:{status:()=>({state:'ready',target:{id:'fixture'}})}, records:{library(...args) {dates.push(args);return ['today'];}}};
  const room = {async request(id, endpoint, _data, requestId, signal) {
    signal.throwIfAborted();
    dispatched.push({id, endpoint, requestId});
    return endpoint;
  }};
  let activeRoom = room;
  const services = {petCore:host};
  applyConsole({
    get(name) {return name === 'petRoom' ? activeRoom : services[name];},
    inject() {},
    connection:{browserPeer:peer, fetch:{register(route) {
      assert.equal(handlers.has(route.path), false);
      handlers.set(route.path, route.fetch);
    }}},
  });
  async function request(endpoint, input) {
    const method = 'chatpetSettings/' + endpoint, path = '/api/' + method;
    const data = {type:'client-request',rpcId:'1',method,payload:{requestId:'test-id',input}};
    const response = await handlers.get(path)(new Request('http://localhost' + path, {method:'POST',
      headers:{'content-type':'application/json'},body:JSON.stringify(data)}));
    return (await response.json()).result;
  }
  for (const [, endpoint] of routes)
    assert.deepEqual(await request(endpoint, {workspaceId:'fixture',data:{}}), {ok:true,value:endpoint});
  assert.deepEqual(dispatched, routes.map(([, endpoint])=>({id:'fixture',endpoint,requestId:'test-id'})));
  peer.principal.kind = 'guest';
  assert.equal((await request('roomState', {workspaceId:'fixture',data:{}})).error.code,'UNAUTHORIZED');
  peer.principal.kind = 'owner';
  activeRoom = undefined;
  assert.equal((await request('roomState', {workspaceId:'fixture',data:{}})).error.code,'UNAVAILABLE');
  assert.deepEqual(await request('lifeDates', {workspaceId:'fixture'}), {ok:true,value:['today']});
  assert.deepEqual(dates, [['fixture','dates']]);
});
