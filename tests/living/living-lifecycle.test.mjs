import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {Context} from '@deepseek-ai/cordis';
import {createAssistantMessage} from '@deepseek-ai/dsh-llm';
import Sessions from '@deepseek-ai/dsh-session';
import {renderContextSections} from '@deepseek-ai/dsh-system-prompt';
import {createLifeStore} from '#dsh-world/life/lifeStore';
import {presentFact} from '../../dist/src/core/interaction-presentation.js';
import {isCompanionHome, resolveCompanionHome} from '../../dist/src/core/companion-foundation.js';
import {behaviorPlugin, corePlugin, economyPlugin} from '../../dist/tests/behavior-list/entries.js';
import {cordisFixture, eventually, submitPlan} from '../behavior-list/entries-lifecycle.test.mjs';
import {value} from '../behavior-list/fixture.mjs';
import {policyHost} from '../behavior-list/policy-host.mjs';

const zones = {body: 'body', life: 'plan', economy: 'economy'};
const services = {body: 'petBehavior', life: 'petLife', economy: 'petEconomy'};
const homeRecord = f => f.core.workspace.runtime.store.get('companion-home', f.core.workspace.storageId());
const mirrorFile = f => join(f.directory, 'life.json');
const lifeStore = f => createLifeStore(f.directory, Intl.DateTimeFormat().resolvedOptions().timeZone);

test('4 home 镜像写失败时保留 Core 身份，卸载并重挂只交接一次', async t => {
  const f = await cordisFixture(t);
  await f.enable();
  const old = await f.agent(f.life.homeSessionId());
  await eventually(async()=> (await f.life.readPlan(f.id)).plan, '初次迎接已完成');
  await old.whenIdle();
  f.registry.archivedSessionIds.push(old.id);
  const rename = fs.renameSync;
  const fault = t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === mirrorFile(f)) throw Error('Synthetic mirror write failure');
    return rename(from, to);
  });
  syncBuiltinESMExports();
  let home;
  try {
    home = await resolveCompanionHome(f.ctx, f.core);
    assert.equal((await resolveCompanionHome(f.ctx, f.core)).id, home.id);
    assert.deepEqual(homeRecord(f), {sessionId:home.id,arrivalPending:true});
    assert.equal(lifeStore(f).read().homeSessionId, old.id);
    const open = fs.openSync;
    const readFault = t.mock.method(fs, 'openSync', (file, ...args) => {
      if (file === mirrorFile(f)) throw Error('Synthetic mirror read failure');
      return open(file,...args);
    });
    syncBuiltinESMExports();
    try { await f.unload('life'); }
    finally { readFault.mock.restore(); syncBuiltinESMExports(); }
    assert.ok(f.cancellations.some(row => row.sessionId === old.id || row.sessionId === home.id));
  } finally { fault.mock.restore(); syncBuiltinESMExports(); }
  await f.load('life');
  const arrivals = () => f.calls.filter(call => call.agent.id === home.id && call.messages.some(message => message.source.purpose === 'first'));
  await eventually(()=>arrivals().length===1, '重挂补交接后迎接');
  await home.whenIdle();
  assert.deepEqual(homeRecord(f), {sessionId:home.id});
  assert.equal(lifeStore(f).read().homeSessionId, home.id);
  await f.unload('life'); await f.load('life');
  await eventually(()=>f.life.running(),'再次重挂恢复运行');
  assert.equal(arrivals().length,1);
});

test('4 没有 Plan 时前台只登记 Core，挂载暂停的 Plan 后补交接', async t => {
  const f = await cordisFixture(t, {order:['body','economy']});
  const home = await resolveCompanionHome(f.ctx, f.core);
  assert.deepEqual(homeRecord(f), {sessionId:home.id,arrivalPending:true});
  assert.equal(existsSync(mirrorFile(f)), false);
  await f.load('life');
  await eventually(()=>homeRecord(f)?.arrivalPending === undefined && existsSync(mirrorFile(f)), '暂停的 Plan 持久化迎接');
  const visible = lifeStore(f).read();
  assert.equal(visible.homeSessionId, home.id);
  assert.equal(visible.greeting.kind, 'arrival');
  assert.equal(f.life.running(), false);
});

test('4 同名 Plan 已重挂时，旧代收尾不取消共享 home', async t => {
  const f = await cordisFixture(t);
  await f.enable();
  const old = f.life, home = await f.agent(old.homeSessionId());
  await home.whenIdle();
  const gate = Promise.withResolvers(), entered = Promise.withResolvers(), stop = old.stopRuntime.bind(old);
  t.mock.method(old, 'stopRuntime', async (...args) => { entered.resolve(); await gate.promise; await stop(...args); });
  const closing = f.fiber('life').dispose();
  try {
    await entered.promise;
    await f.load('life');
    await eventually(() => f.life?.homeSessionId() === home.id, '新 Plan 正在同一个 home 运行');
    const before = f.cancellations.length;
    gate.resolve();
    await closing;
    assert.equal(f.cancellations.length, before);
    assert.equal(f.life.homeSessionId(), home.id);
  } finally { gate.resolve(); await closing; }
});

test('4 运行时和原生工具以 Core home 为准，下一次有效写修正冲突镜像', async t => {
  const f = await cordisFixture(t);
  await f.enable();
  const home = await f.agent(f.life.homeSessionId()), other = await f.agent('decoy');
  await eventually(async()=> (await f.life.readPlan(f.id)).plan, '初次迎接已完成');
  await home.whenIdle();
  lifeStore(f).update(state => { state.homeSessionId = other.id; state.greeting = {at:new Date().toISOString(),kind:'arrival'}; });
  assert.equal(f.life.isHome(home.id), true);
  assert.equal(f.life.isHome(other.id), false);
  assert.equal(isCompanionHome(f.ctx, f.core, home.id), true);
  assert.ok((await f.input('Home tools', home.id)).schemas.includes('reach_out'));
  assert.ok(!(await f.input('Other tools', other.id)).schemas.includes('reach_out'));
  const preferences = (await f.life.snapshot(f.id)).preferences;
  await f.life.settings(f.id,preferences,{...preferences,review:'23:59'});
  const repaired = lifeStore(f).read();
  assert.equal(repaired.homeSessionId, home.id);
  assert.equal(repaired.greeting, undefined);
});

test('4 同名重挂后旧迎接回调不能改记录、镜像或通知', async t => {
  const f = await cordisFixture(t);
  const home = await resolveCompanionHome(f.ctx, f.core);
  const ports = f.core.native.companionPorts, old = ports.get('applyHomeArrival');
  assert.equal(typeof old, 'function');
  const scope = f.core.workspace.homeScope();
  await f.unload('life'); await f.load('life');
  await eventually(()=>ports.get('applyHomeArrival') !== old, '同名 Plan 已换代');
  await f.life.snapshot(f.id);
  const record = homeRecord(f), bytes = readFileSync(mirrorFile(f)); let notifications = 0;
  const unlisten = f.ctx.on('world.changed',()=>{ notifications++; });
  try {
    assert.equal(old(scope,home.id),false);
    assert.deepEqual(homeRecord(f),record);
    assert.deepEqual(readFileSync(mirrorFile(f)),bytes);
    assert.equal(notifications,0);
  } finally { unlisten(); }
});
const orders = [
  ['body', 'life', 'economy'], ['body', 'economy', 'life'],
  ['life', 'body', 'economy'], ['life', 'economy', 'body'],
  ['economy', 'body', 'life'], ['economy', 'life', 'body'],
];

const readArea = {
  body: (body, id) => body.snapshot(id),
  life: (life, id) => life.readPlan(id),
  economy: (economy, id) => economy.snapshot(id),
};

const readingItem = 'reading:window-and-rain';

test('3E 世界快照支持单挂钱包，并隔离整个身体投影的返回副本', async t => {
  const f = await cordisFixture(t, {order: ['economy']});
  await f.ownerAction({kind:'grant',amount:100}, 'snapshot-funding');
  const purchase = await f.ownerAction({kind:'buy',itemId:readingItem}, 'snapshot-book');
  const version = purchase.catalog.find(item => item.id === readingItem).contentVersion;
  const read = () => f.economy.worldSnapshot(f.id);
  const initial = await read();
  assert.equal(initial.workspaceId, f.id);
  assert.equal(initial.storageId, f.core.workspace.storageId());
  assert.deepEqual(initial.body, {available:false});
  assert.equal(initial.wallet.balance, purchase.balance);
  assert.deepEqual(initial.wallet.inventory, purchase.inventory);
  assert.deepEqual(initial.wallet.reading, [{itemId:readingItem,version,bookmark:null}]);
  const reading = f.economy.gardenPort(f.id);
  const offer = reading.readSegment('snapshot-reading', {itemId:readingItem,segment:0}, Date.now());
  reading.confirmRead('snapshot-reading', offer.receiptToken, Date.now());
  const bookmark = {itemId:readingItem,version,offset:offer.endOffset,updatedAt:Date.now()};
  assert.deepEqual((await read()).wallet.reading, [{itemId:readingItem,version,bookmark}]);

  await f.load('body');
  const snapshot = await f.body.worldSnapshot(f.id);
  assert.equal(snapshot.body.available, true);
  assert.deepEqual(snapshot.body.snapshot, await f.body.snapshot(f.id));
  const pristine = structuredClone(snapshot);
  snapshot.body.snapshot.home.layout.size.w = -1;
  snapshot.body.snapshot.needs.thirst = -1;
  snapshot.wallet.reading[0].bookmark.offset = -1;
  assert.deepEqual(await read(), pristine);
  await assert.rejects(f.body.worldSnapshot('other-workspace'));
});

test('3E 事实流按原编号跨区回读，缺区保留确认，原生日志落盘后可确认', async t => {
  const f = await cordisFixture(t, {order:['economy','body']});
  const {worldFacts} = f.body;
  await f.body.act(f.id, 'water', 'world-facts-water');
  await f.ownerAction({kind:'grant',amount:10}, 'world-facts-grant');
  t.mock.timers.tick(1);
  await f.ownerAction({kind:'buy',itemId:'seed:radish'}, 'world-facts-buy');
  const facts = await worldFacts.pendingFacts(f.id);
  assert.deepEqual(facts.map(row => row.requestId), ['world-facts-water','world-facts-grant','world-facts-buy']);
  const [body, grant, purchase] = facts, reordered = [purchase,body,grant,purchase];
  const ids = reordered.map(fact => fact.id);
  assert.deepEqual(await worldFacts.readFacts(f.id, ids), reordered);
  await f.unload('economy');
  await assert.rejects(worldFacts.acknowledgeFacts(f.id, [body.id,purchase.id]));
  assert.deepEqual(await worldFacts.pendingFacts(f.id), [body]);
  await f.load('economy');

  const agent = await f.agent();
  const sessions = f.ctx.sessions, flush = sessions.flush.bind(sessions);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const probe = t.mock.method(sessions, 'flush', async session => {
    if (session !== agent.session) return flush(session);
    entered.resolve();
    await release.promise;
    const flushed = await flush(session);
    assert.equal(flushed, true);
    await worldFacts.acknowledgeFacts(f.id, ids);
    return flushed;
  });
  const turn = f.input('Read the original facts.');
  try {
    await entered.promise;
    assert.deepEqual(await worldFacts.pendingFacts(f.id), facts);
  } finally { release.resolve(); }
  const call = await turn;
  probe.mock.restore();
  const logged = JSON.parse(call.sections.find(row => row.name === 'chatpet.interactions').text).facts;
  assert.deepEqual(logged, facts.map(presentFact));
  assert.ok(f.saved(agent.id).events.some(row => row.type === 'user/message' &&
    row.data.source.sections?.some(section => section.name === 'chatpet.interactions')));
  assert.deepEqual(await worldFacts.pendingFacts(f.id), []);
  assert.deepEqual(await worldFacts.readFacts(f.id, ids), reordered);
});

function expectedWorldNotice(core, bodyOnly = false) {
  const {workspaceId,storageId,bootId,generation}=core.workspace.homeScope();
  return {workspaceId,storageId,bootId,generation,...(bodyOnly ? {bodyOnly:true} : {})};
}

test('3E 世界通知覆盖三区，合并同批交易，读快照和旧租约不产生回声', async t => {
  const f = await cordisFixture(t);
  const changes = [], read = () => f.economy.worldSnapshot(f.id);
  await read();
  await delay(15);
  const off = f.ctx.on('world.changed', change => changes.push(change));
  t.after(off);
  const expected = expectedWorldNotice(f.core);
  const before = await read();
  await Promise.all([f.ownerAction({kind:'grant',amount:7}, 'world-notice-7'),
    f.ownerAction({kind:'grant',amount:3}, 'world-notice-3')]);
  assert.deepEqual(changes.splice(0), [expected]);
  assert.equal((await read()).wallet.balance, before.wallet.balance + 10);
  await f.ownerAction({kind:'grant',amount:3}, 'world-notice-3');
  await assert.rejects(f.ownerAction({kind:'buy',itemId:'seed:radish',quantity:1_000_000}, 'world-notice-refused'));
  assert.deepEqual(changes, []);

  await f.body.act(f.id, 'water', 'world-notice-water');
  assert.deepEqual(changes.splice(0), [expectedWorldNotice(f.core,true)]);
  assert.ok((await read()).body.snapshot.needs.thirst < before.body.snapshot.needs.thirst);
  const {revision} = await f.life.readPlan(f.id);
  await f.life.updatePlan(f.id, revision, {goal:'Rest',reason:'Fixture',steps:[],nextConsiderAt:null});
  assert.deepEqual(changes.splice(0), [expected]);
  await read();
  await delay(10);
  assert.deepEqual(changes, []);

  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const emotion = await f.ctx.plugin({apply(ctx) {
    ctx.provide('petEmotion', {roomSnapshot() {}, async read() { entered.resolve(); await release.promise; }});
  }});
  const retired = assert.rejects(f.body.act(f.id, 'feed', 'world-notice-retired'));
  let unloading;
  try {
    await entered.promise;
    unloading = f.unload('body');
    await eventually(() => changes.length > 0, '卸载通知没有等待旧身体操作');
    assert.deepEqual(changes.splice(0), [expected]);
    assert.deepEqual((await read()).body, {available:false});
  } finally { release.resolve(); await unloading; await emotion.dispose(); }
  await retired;
  assert.deepEqual(changes, []);
  await f.load('body');
  assert.deepEqual(changes.splice(0), [expected]);
  assert.equal((await read()).body.available, true);
});

async function bindingFixture(t) {
  t.mock.timers.enable({apis:['Date'],now:new Date(2026,10,15,22,59)});
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'her-world-binding-')));
  const repo = join(root, 'workspace'), effects = [], workspaces = new Map();
  const {ctx:{root:ctx}} = await policyHost(repo, effects);
  t.after(async () => {
    try {
      await ctx.fiber.dispose();
      for (const dispose of effects.reverse()) await dispose();
    }
    finally { rmSync(root, {recursive:true,force:true}); }
  });
  await ctx.plugin(Sessions);
  await ctx.plugin({apply(scope) {
    scope.provide('agents', {get:() => undefined,list:() => []});
    scope.provide('agentLoop', {});
    scope.provide('sessionPersistence', {});
    scope.provide('workspaceRegistry', {get:id => workspaces.get(id),archivedSessionIds:[]});
  }});
  await ctx.plugin(corePlugin, {dataDir:join(repo,'.chatpet/data/core'),companionId:'fish',scopeId:'owner',
    ownerActorId:'owner',displayName:'Fixture',character:'Synthetic companion'});
  return {ctx,core:ctx.petCore,repo,workspace(id,path=repo) {
    const target = {id,path,title:'Synthetic workspace'};
    workspaces.set(id, {...target,sessionIds:[]});
    return target;
  }};
}

async function selectWorkspace(core, workspace) {
  const request = () => core.operator.request(randomUUID());
  const preferences = value(await core.services.preferences.read(request(), {}));
  const saved = value(await core.services.preferences.save(request(), {
    workspace, expectedRevision:preferences.revision, conversation:preferences.conversation,
  }));
  const initialized = value(await core.services.workspace.initialize(request(), {
    expectedPreferencesRevision:saved.revision,
  }));
  assert.equal(initialized.state, 'ready');
}

test('3E 生活区先装载后绑定，首次就绪只通知一次', async t => {
  const {ctx,core,workspace} = await bindingFixture(t);
  const target = workspace('initial');
  const changes = [];
  t.after(ctx.on('world.changed', change => changes.push(change)));
  await ctx.plugin(behaviorPlugin);
  const read = () => ctx.petBehavior.worldSnapshot(target.id);
  await assert.rejects(read());
  assert.deepEqual(changes, []);

  await selectWorkspace(core, target);
  await delay(0);
  assert.deepEqual(changes.splice(0), [expectedWorldNotice(core)]);
  const snapshot = await read();
  assert.equal(snapshot.body.available, true);
  assert.equal((await read()).body.snapshot.revision, snapshot.body.snapshot.revision);
  assert.deepEqual(changes, []);
});

test('3E 生活区运行中切换绑定，只通知新工作区一次', async t => {
  const {ctx,core,repo,workspace} = await bindingFixture(t);
  const first = workspace('initial');
  await selectWorkspace(core, first);
  await ctx.plugin(behaviorPlugin);
  const read = id => ctx.petBehavior.worldSnapshot(id);
  const prior = await read(first.id);
  const changes = [];
  t.after(ctx.on('world.changed', change => changes.push(change)));
  const path = join(repo, 'another-workspace');
  mkdirSync(path);
  const target = workspace('second',path);
  await selectWorkspace(core, target);
  await delay(0);
  const storageId = core.workspace.storageId();
  assert.notEqual(storageId, prior.storageId);
  assert.deepEqual(changes.splice(0), [expectedWorldNotice(core)]);
  await assert.rejects(read(first.id));
  const next = await read(target.id);
  assert.equal(next.workspaceId, target.id);
  assert.equal(next.storageId, storageId);
  assert.equal(next.body.available, true);
  assert.equal((await read(target.id)).body.snapshot.revision, next.body.snapshot.revision);
  assert.deepEqual(changes, []);
});

test('3E 同一 Repo 换 DSH 工作区 ID 后，复用钱包的提交通知新绑定', async t => {
  const {ctx,core,workspace} = await bindingFixture(t);
  const first = workspace('portable-first'), next = workspace('portable-rebound');
  await selectWorkspace(core, first);
  const storageId = core.workspace.storageId();
  await ctx.plugin(economyPlugin);
  const economy = ctx.petEconomy, store = economy.prepare(first);
  const funded = await economy.ownerAction(first.id, {kind:'grant',amount:100}, 'portable-funding', new AbortController().signal);
  const price = funded.catalog.find(row => row.id === readingItem).purchasePrice;
  await selectWorkspace(core, next);
  assert.equal(core.workspace.storageId(), storageId);
  await delay(0);

  const changes = [];
  t.after(ctx.on('world.changed', change => changes.push(change)));
  const buy = economy.worldCommands.buy;
  const request = {requestId:'portable-book',itemId:readingItem};
  const stale = await buy({...request,workspaceId:first.id});
  assert.equal(stale.error.code, 'STALE_BINDING');
  assert.deepEqual(changes, []);
  const purchased = value(await buy({...request,workspaceId:next.id}));
  assert.equal(purchased.balance, funded.balance - price);
  assert.equal(economy.prepare(next), store);
  assert.deepEqual((await economy.worldSnapshot(next.id)).wallet, purchased);
  assert.deepEqual(changes, [expectedWorldNotice(core)]);
});

test('3E 仅确认事实投递时，身体修订正常递增，世界通知无回声', async t => {
  const f = await cordisFixture(t, {order:['body']});
  await f.body.act(f.id, 'water', 'acknowledgement-water');
  const before = await f.body.snapshot(f.id);
  const facts = await f.body.worldFacts.pendingFacts(f.id);
  assert.equal(facts.length, 1);
  const changes = [];
  t.after(f.ctx.on('world.changed', event => changes.push(event)));
  await f.body.worldFacts.acknowledgeFacts(f.id, [facts[0].id]);
  const after = await f.body.snapshot(f.id);
  assert.deepEqual(await f.body.worldFacts.pendingFacts(f.id), []);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(changes, []);
});

async function saveCommandStep(f, step, reconsiderWhen = []) {
  const {revision} = await f.life.readPlan(f.id);
  const saved = await f.life.updatePlan(f.id, revision, {
    goal:'Fixture activity',reason:'Test the original step',steps:[step],nextConsiderAt:null,reconsiderWhen,
  });
  assert.equal(saved.enabled, true);
  return {workspaceId:f.id,requestId:'execute-'+step.id,expectedRevision:saved.revision,planId:saved.plan.id,stepId:step.id};
}

const holdStep = {id:'rest',kind:'hold',activity:'Rest'};
const operationFor = ({planId,stepId}) => `life:${planId}:${stepId}`;

test('3E 派工后回执交接失败，命令要求核对原执行编号', async t => {
  const f = await cordisFixture(t);
  await f.enable();
  const step = await saveCommandStep(f, {...holdStep,durationMinutes:5});
  const operationId = operationFor(step);
  const dispatch = f.body.startPlanned.bind(f.body);
  const failed = t.mock.method(f.body, 'startPlanned', async (...args) => {
    await dispatch(...args);
    throw Error('Synthetic dispatch response lost');
  });
  const execute = f.life.worldCommands.executePlanStep;
  const result = await execute(step);
  failed.mock.restore();

  const {plan,revision} = await f.life.readPlan(f.id);
  assert.equal(plan.status, 'waiting');
  assert.equal(plan.cursor, 0);
  assert.equal(plan.operationId, operationId);
  assert.match(plan.replanReason, /Synthetic dispatch response lost/);
  assert.equal((await f.body.inspectPlanned(f.id, operationId)).status, 'running');
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.deepEqual([result.error.code,result.error.effect,result.error.retry,result.error.operationId],
    ['OUTCOME_UNKNOWN','unknown','reconcile',operationId]);
  assert.equal(value(await execute({...step,expectedRevision:revision})).execution.operationId, operationId);
});

test('3E 绝对截止已过且 Body 无回执，命令确定拒绝派工', async t => {
  const f = await cordisFixture(t);
  await f.enable();
  const step = await saveCommandStep(f, {...holdStep,until:new Date(Date.now()+1_000).toISOString()});
  t.mock.timers.tick(1_001);
  const execute = f.life.worldCommands.executePlanStep;
  const result = await execute(step);
  const operationId = operationFor(step), {plan,revision} = await f.life.readPlan(f.id);
  assert.equal(plan.status, 'waiting');
  assert.equal(plan.operationId, operationId);
  assert.match(plan.replanReason, /absolute deadline elapsed/);
  assert.equal(await f.body.inspectPlanned(f.id, operationId), undefined);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.deepEqual([result.error.code,result.error.effect,result.error.retry,result.error.operationId],
    ['INELIGIBLE','none','never',operationId]);
  assert.deepEqual(await execute({...step,expectedRevision:revision}), result);
});

test('3E 身体条件触发重考虑时，命令要求刷新计划', async t => {
  const f = await cordisFixture(t);
  await f.enable();
  const step = await saveCommandStep(f, holdStep, [{metric:'thirst',comparison:'lte',value:.1}]);
  await f.body.act(f.id, 'water', 'trigger-reconsideration');
  const result = await f.life.worldCommands.executePlanStep(step);
  const {plan} = await f.life.readPlan(f.id);
  assert.deepEqual(plan.triggeredConditions, [0]);
  assert.match(plan.replanReason, /Body condition changed: thirst/);
  assert.equal(plan.operationId, undefined);
  assert.equal(await f.body.inspectPlanned(f.id, operationFor(step)), undefined);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.deepEqual([result.error.code,result.error.effect,result.error.retry], ['STALE_REVISION','none','refresh']);
});

test('3E 等待重考虑快照时取消，原计划没有写入或派工', async t => {
  const f = await cordisFixture(t);
  await f.enable();
  const step = await saveCommandStep(f, holdStep, [{metric:'thirst',comparison:'lte',value:.1}]);
  const before = await f.life.readPlan(f.id);
  const cancellation = new AbortController(), snapshot = f.body.snapshot.bind(f.body);
  const reading = t.mock.method(f.body, 'snapshot', async id => {
    const projection = await snapshot(id);
    cancellation.abort();
    return projection;
  });
  const result = await f.life.worldCommands.executePlanStep(step, {signal:cancellation.signal});
  reading.mock.restore();
  assert.deepEqual(await f.life.readPlan(f.id), before);
  assert.equal(await f.body.inspectPlanned(f.id, operationFor(step)), undefined);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.deepEqual([result.error.code,result.error.effect,result.error.retry], ['CANCELLED','none','same_request']);
});

test('3E 原阅读被暂停时，确认命令未推进书签', async t => {
  const f = await cordisFixture(t);
  await f.ownerAction({kind:'grant',amount:100}, 'paused-reading-funding');
  await f.ownerAction({kind:'buy',itemId:readingItem}, 'paused-reading-book');
  await f.enable();
  const step = await saveCommandStep(f, {id:'read',kind:'read',activity:'Read',reading:{itemId:readingItem,segment:0}});
  const {operationId,execution} = value(await f.life.worldCommands.executePlanStep(step));
  assert.equal(execution.status, 'running');
  const offer = await f.life.readPlannedSegment(f.id, step.expectedRevision, operationId);
  assert.equal((await f.body.pausePlanned(f.id, operationId)).status, 'paused');
  const result = await f.life.worldCommands.confirmReading({
    workspaceId:f.id,requestId:'paused-reading-confirm',expectedRevision:step.expectedRevision,
    operationId,receiptToken:offer.receiptToken,
  });
  assert.equal((await f.economy.worldSnapshot(f.id)).wallet.reading[0].bookmark, null);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.deepEqual([result.error.effect,result.error.retry], ['none','same_request']);
});

test('3E 三区命令使用实际回执，原步骤重放不施效或推进下一步', async t => {
  const f = await cordisFixture(t);
  const request = requestId => ({workspaceId:f.id,requestId});
  const {care} = f.body.worldCommands, {buy,sell} = f.economy.worldCommands;
  const {executePlanStep,confirmReading} = f.life.worldCommands;
  const water = {...request('world-care'),action:'water'};
  assert.deepEqual(await care(water), {ok:true,value:{changed:true}});
  assert.deepEqual(await care(water), {ok:true,value:{changed:true}});
  const careConflict = await care({...water,action:'feed'});
  assert.deepEqual([careConflict.error.code,careConflict.error.effect,careConflict.error.retry], ['CONFLICT','none','never']);
  assert.equal((await f.body.pendingFacts(f.id)).filter(row => row.requestId === water.requestId).length, 1);
  const seeds = 'seed:radish', stock = wallet => wallet.inventory.find(row => row.itemId === seeds).quantity;
  await f.ownerAction({kind:'grant',amount:100}, 'world-command-funding');
  const before = (await f.economy.worldSnapshot(f.id)).wallet;
  const catalog = (await f.economy.snapshot(f.id)).catalog.find(row => row.id === seeds);
  const purchase = {...request('world-buy'),itemId:seeds};
  const bought = await buy(purchase);
  assert.equal(bought.ok, true);
  assert.equal(bought.value.balance, before.balance - catalog.purchasePrice);
  assert.equal(stock(bought.value), stock(before) + 1);
  assert.deepEqual(await buy(purchase), bought);
  const tradeConflict = await buy({...purchase,quantity:2});
  assert.deepEqual([tradeConflict.error.code,tradeConflict.error.effect,tradeConflict.error.retry], ['CONFLICT','none','never']);
  const saleItem = 'harvest:radish';
  const stocked = await f.ownerAction({kind:'gift',itemId:saleItem,quantity:2}, 'world-sell-stock');
  const sale = {...request('world-sell'),itemId:saleItem};
  const sold = await sell(sale);
  assert.equal(sold.ok, true);
  assert.equal(sold.value.balance, stocked.balance + stocked.catalog.find(row => row.id === saleItem).sellPrice);
  assert.equal(sold.value.inventory.find(row => row.itemId === saleItem).quantity, 1);
  assert.deepEqual(await sell(sale), sold);

  const compost = {...request('world-compost'),itemId:'compost'};
  const cancelled = await buy(compost,{signal:AbortSignal.abort()});
  assert.deepEqual([cancelled.error.code,cancelled.error.effect,cancelled.error.retry], ['CANCELLED','none','same_request']);
  const {Rejection} = await import('../../dist/src/core/storage.js');
  const failedRead = t.mock.method(f.economy,'snapshot',async () => {
    throw new Rejection({code:'UNAVAILABLE',message:'Synthetic projection failure',effect:'none',retry:'same_request'});
  });
  const partial = await buy(compost);
  failedRead.mock.restore();
  assert.deepEqual([partial.error.effect,partial.error.retry], ['partial','reconcile']);
  const paid = (await f.economy.worldSnapshot(f.id)).wallet;
  assert.equal(paid.inventory.find(row=>row.itemId==='compost').quantity, 1);
  assert.deepEqual(await buy(compost), {ok:true,value:paid});

  assert.equal((await buy({...request('world-book'),itemId:readingItem})).ok, true);
  let completed = false;
  f.model = async call => {
    if (call.messages.some(message => message.source.kind === 'user')) {
      const {plan,revision} = await submitPlan(call, [
        {id:'read',kind:'read',activity:'Read',reading:{itemId:readingItem,segment:0}},
        {id:'seeds',kind:'economy',activity:'Buy seeds',economy:{type:'buy',itemId:seeds,quantity:1}},
      ]);
      const step = {...request('world-step'),expectedRevision:revision,planId:plan.id,stepId:'read'};
      const operationId = `life:${plan.id}:read`;
      const executed = await executePlanStep(step);
      assert.equal(executed.ok, true);
      assert.equal(executed.value.operationId, operationId);
      assert.equal(executed.value.execution.status, 'running');
      assert.deepEqual(await executePlanStep(step), executed);
      const offer = JSON.parse(await call.tool('life_read_segment',{expectedRevision:revision,operationId}));
      assert.ok(offer.text.length > 0);
      const confirmation = {...request('world-confirm'),expectedRevision:revision,operationId,receiptToken:offer.receiptToken};
      const invalidToken = await confirmReading({...confirmation,receiptToken:'wrong-token'});
      assert.deepEqual([invalidToken.error.code,invalidToken.error.effect,invalidToken.error.retry], ['CONFLICT','none','never']);
      const confirmed = await confirmReading(confirmation);
      assert.equal(confirmed.ok, true);
      assert.equal(confirmed.value.status, 'completed');
      assert.equal((await f.life.readPlan(f.id)).plan.cursor, 1);
      assert.deepEqual(await confirmReading(confirmation), confirmed);
      assert.equal((await f.life.readPlan(f.id)).plan.cursor, 1);
      assert.equal(stock((await f.economy.worldSnapshot(f.id)).wallet), stock(before) + 1);
      const stale = await executePlanStep({...step,expectedRevision:revision-1});
      assert.deepEqual([stale.ok,stale.error.effect,stale.error.retry], [false,'none','refresh']);
      const retired = await executePlanStep(step);
      assert.deepEqual([retired.ok,retired.error.effect,retired.error.retry], [false,'none','refresh']);
      const bookmark = (await f.economy.worldSnapshot(f.id)).wallet.reading[0].bookmark;
      assert.equal(bookmark.version, offer.version);
      assert.equal(bookmark.offset, offer.endOffset);
      await call.tool('life_plan_keep',{expectedRevision:revision,reason:'Keep the remaining step',
        nextConsiderAt:new Date(Date.now() + 3_600_000).toISOString()});
      completed = true;
    }
    return 'Synthetic reply';
  };
  await f.enable();
  const home = await f.agent(f.life.homeSessionId());
  await home.whenIdle();
  try {
    t.mock.timers.tick(15_000);
    await f.input('Read and confirm the original fragment.',home.id);
    assert.equal(completed, true);
    await home.whenIdle();
  } finally {
    await f.life.control(f.id,false);
    await home.whenIdle();
  }
});

test('3C 事实准备期间 Economy 重挂会作废两段，下一轮仍能读到并确认', async t => {
  const f = await cordisFixture(t);
  const agent = await f.agent();
  await f.body.act(f.id, 'water', 'prepare-body');
  await f.ownerAction({kind:'grant',amount:10}, 'prepare-economy');
  const old = f.economy, pending = old.pendingFacts.bind(old);
  const native = f.core.native, observe = native.observeFacts.bind(native);
  const observations = [];
  t.mock.method(native,'observeFacts',(id, facts, ...args) => {
    if (id === agent.id) observations.push(facts.map(fact=>fact.requestId));
    return observe(id, facts, ...args);
  });
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  t.mock.method(old, 'pendingFacts', async id => {
    const facts = await pending(id);
    entered.resolve();
    await release.promise;
    return facts;
  });
  const assembling = f.ctx.systemPrompt.assemble({agent,scope:agent});
  let fresh;
  try {
    await entered.promise;
    await f.unload('economy');
    await f.load('economy');
    await f.ownerAction({kind:'grant',amount:1}, 'prepare-new-economy');
    fresh = (await f.economy.pendingFacts(f.id)).find(fact=>fact.requestId==='prepare-new-economy');
  } finally { release.resolve(); }
  assert.ok(fresh);
  const sections = renderContextSections(await assembling);
  assert.ok(observations.every(ids=>!ids.includes('prepare-economy') || ids.includes(fresh.requestId)),
    'Native evidence must never observe the retired Economy preparation');
  const interactions = sections.find(row=>row.name==='chatpet.interactions');
  // Prompt reassembly must render both sections using the new lease.
  assert.ok(sections.some(row=>row.name==='chatpet.environment'));
  assert.ok(interactions);
  assert.ok(JSON.parse(interactions.text).facts.some(fact=>fact.id===fresh.id));
  assert.equal((await f.body.pendingFacts(f.id)).length, 1);
  assert.equal((await f.economy.pendingFacts(f.id)).length, 2);
  const next = await f.input('Inspect them again.');
  const facts = JSON.parse(next.sections.find(row=>row.name==='chatpet.interactions').text).facts;
  assert.deepEqual(facts.map(fact=>fact.domain), ['body','economy','economy']);
  await eventually(async()=>!(await f.body.pendingFacts(f.id)).length && !(await f.economy.pendingFacts(f.id)).length,'新轮次确认两区事实');
});

test('3C 原生日志落盘期间 Plan 重挂会保留事实，下一轮可确认', async t => {
  const f = await cordisFixture(t);
  const agent = await f.agent();
  await f.body.act(f.id, 'water', 'flush-body');
  const [fact] = await f.body.pendingFacts(f.id);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const sessions = f.ctx.sessions, flush = sessions.flush.bind(sessions);
  const probe = t.mock.method(sessions, 'flush', async session => {
    if (session === agent.session) { entered.resolve(); await release.promise; }
    return flush(session);
  });
  const input = f.input('Inspect this result.');
  try {
    await entered.promise;
    await f.unload('life');
    await f.load('life');
  } finally { release.resolve(); }
  await input;
  probe.mock.restore();
  assert.deepEqual(await f.body.pendingFacts(f.id), [fact]);
  const next = await f.input('Inspect it again.');
  assert.ok(next.sections.find(row=>row.name==='chatpet.interactions')?.text.includes(fact.id));
  await eventually(async()=>!(await f.body.pendingFacts(f.id)).length,'新轮次确认身体事实');
});

function ownedHooks(ctx, fiber) {
  return Object.values(ctx.events._hooks).flat().filter(hook => {
    for (let owner = hook.ctx.fiber; owner !== ctx.fiber; owner = owner.parent.fiber) {
      if (owner === fiber) return true;
    }
    return false;
  });
}

function livingTimers(t) {
  const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
  const pending = {body: new Set(), tick: new Set(), upstream: new Set(), alarm: new Set()};
  const created = {body: 0, tick: 0, upstream: 0};
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
    const stack = Error().stack;
    const area = stack.includes('CompanionBehavior.arm') ? 'body'
      : stack.includes('CompanionLife.scheduleTick') ? 'tick'
      : stack.includes('/life/alarmTimer.js') ? 'upstream' : undefined;
    if (!area) return set(callback, ms, ...args);
    const handle = set((...values) => {
      pending[area].delete(handle);
      pending.alarm.delete(handle);
      callback(...values);
    }, ms, ...args);
    pending[area].add(handle);
    created[area]++;
    if (area === 'upstream' && /\barm \([^\n]+\/alarmTimer\.js:/u.test(stack)) pending.alarm.add(handle);
    return handle;
  });
  t.mock.method(globalThis, 'clearTimeout', handle => {
    for (const handles of Object.values(pending)) handles.delete(handle);
    clear(handle);
  });
  return {pending, created};
}

for (const order of orders) {
  for (const first of Object.keys(zones)) {
    test(`R6 ${order.join(' → ')}，先卸载 ${first} 再重挂`, async t => {
      const {LivingWorld} = await import('../../dist/src/living/index.js');
      const f = await cordisFixture(t, {order});
      const world = LivingWorld.find(f.ctx, f.core);
      assert.ok(world);
      const slots = Object.fromEntries(order.map(key => [key, world.lookup(zones[key])]));
      for (const key of order) assert.equal(slots[key].value, f.ctx.get(services[key]));

      const fiber = f.fiber(first);
      assert.ok(ownedHooks(f.ctx, fiber).length > 0);
      await f.unload(first);
      assert.equal(f.ctx.get(services[first]), undefined);
      assert.equal(world.lookup(zones[first]), undefined);
      assert.equal(slots[first].lease.isCurrent(), false);
      assert.equal(ownedHooks(f.ctx, fiber).length, 0);
      for (const key of order.filter(key => key !== first)) {
        const value = f.ctx.get(services[key]);
        assert.equal(value, slots[key].value);
        assert.equal(world.lookup(zones[key]).lease, slots[key].lease);
        await readArea[key](value, f.id);
      }

      await f.load(first);
      const next = world.lookup(zones[first]);
      assert.equal(LivingWorld.find(f.ctx, f.core), world);
      assert.equal(next.value, f.ctx.get(services[first]));
      assert.notEqual(next.value, slots[first].value);
      assert.notEqual(next.lease.generation, slots[first].lease.generation);
      await fiber.dispose();
      assert.equal(world.lookup(zones[first]).lease, next.lease);
      for (const key of [...order].reverse()) await f.unload(key);
      assert.equal(LivingWorld.find(f.ctx, f.core), undefined);
      for (const zone of Object.values(zones)) assert.equal(world.lookup(zone), undefined);
      assert.equal(existsSync(join(f.repo, '.chatpet/data/economy/economy.lock')), false);
    });
  }
}

test('R6 只隔离目标服务自己的标签，同标签能重新找到原区', async t => {
  const {LivingWorld} = await import('../../dist/src/living/index.js');
  const f = await cordisFixture(t);
  const original = LivingWorld.find(f.ctx, f.core);
  const old = original.lookup('plan');
  assert.throws(() => original.register('plan', old.value, f.fiber('life')), /Duplicate registration/);
  await f.unload('life');
  const label = Symbol('isolated Life');
  const isolated = f.ctx.isolate('petLife', label);
  await f.load('life', isolated);
  const world = LivingWorld.find(isolated, f.core);
  const plan = isolated.get('petLife');
  assert.notEqual(world, original);
  assert.ok(plan);
  assert.equal(original.lookup('plan'), undefined);
  assert.equal(world.lookup('plan').value, plan);
  assert.equal(world.lookup('body').lease, original.lookup('body').lease);
  assert.equal(world.lookup('economy').lease, original.lookup('economy').lease);
  assert.equal(LivingWorld.find(f.ctx.isolate('petLife', label), f.core), world);
  assert.equal(LivingWorld.find(new Context(), f.core), undefined);
  const otherScope = f.ctx.isolate('petCore');
  const other = {...f.core};
  const host = await otherScope.plugin({apply: ctx => ctx.provide('petCore', other)});
  try { assert.equal(LivingWorld.find(otherScope, other), undefined); }
  finally { await host.dispose(); }

  await f.unload('life');
  await f.load('life');
  assert.equal(LivingWorld.find(isolated, f.core), undefined);
  assert.equal(original.lookup('plan').value, f.life);
  assert.notEqual(original.lookup('plan').lease.generation, old.lease.generation);
});

test('R6 旧 Plan 观察恢复后不得写盘或在新代之前发布', async t => {
  const f = await cordisFixture(t);
  await f.body.snapshot(f.id);
  await f.body.setAutonomy(f.id, true);
  const changes = [];
  const stop = f.ctx.on('world.changed', change => {if(change.bodyOnly)changes.push(change);});
  const release = [Promise.withResolvers(), Promise.withResolvers()];
  let reads = 0;
  const emotion = await f.ctx.plugin({apply(ctx) {
    ctx.provide('petEmotion', {roomSnapshot() {}, async read() {
      const index = reads++;
      await release[index]?.promise;
    }});
  }});
  try {
    const home = join(f.directory, 'home.json');
    const saved = readFileSync(home, 'utf8');
    t.mock.timers.tick(60_000);
    f.life.notifyLife(f.core.workspace.homeScope());
    await eventually(() => reads === 1, '旧 Plan 的观察已到达情绪读取');
    await f.unload('life');
    await f.load('life');
    const newClock = t.mock.method(f.life, 'bodyClockState');
    release[0].resolve();
    await eventually(() => reads === 2, '新 Plan 的观察已到达情绪读取');
    assert.equal(newClock.mock.callCount(), 1, '只有新观察可读取新 Plan 的时钟');
    assert.equal(readFileSync(home, 'utf8'), saved, '旧 Plan 的观察写了身体检查点');
    assert.deepEqual(changes, [], '旧 Plan 的观察发布了身体变化');
  } finally {
    for (const gate of release) gate.resolve();
    await f.body.snapshot(f.id);
    stop();
    await emotion.dispose();
  }
});

test('R6 卸载停掉实际身体计时、计划 tick、上游闹钟和各自订阅', async t => {
  const {pending, created} = livingTimers(t);
  const f = await cordisFixture(t);
  const fibers = {body: f.fiber('body'), life: f.fiber('life'), economy: f.fiber('economy')};
  await f.enable('23:30');
  await f.body.act(f.id, 'water', 'r6-timed-care');
  await eventually(() => pending.body.size && pending.alarm.size, '物理和上游闹钟已调度');
  assert.ok(ownedHooks(f.ctx, fibers.life).length > 0);
  assert.ok(ownedHooks(f.ctx, fibers.body).length > 0);
  await f.unload('body');
  assert.equal(pending.body.size, 0);
  assert.equal(ownedHooks(f.ctx, fibers.body).length, 0);
  assert.ok(ownedHooks(f.ctx, fibers.life).length > 0);
  assert.ok(ownedHooks(f.ctx, fibers.economy).length > 0);
  await f.ownerAction({kind:'grant',amount:1},'r6-schedule-from-fact');
  assert.ok(pending.tick.size > 0);
  await f.unload('life');
  assert.equal(pending.tick.size, 0);
  assert.equal(pending.upstream.size, 0);
  assert.equal(ownedHooks(f.ctx, fibers.life).length, 0);
  assert.ok(ownedHooks(f.ctx, fibers.economy).length > 0);
  await f.unload('economy');
  assert.equal(ownedHooks(f.ctx, fibers.economy).length, 0);

  const before = {...created};
  f.ctx.emit('pet/core.changed');
  f.ctx.emit('pet/emotion.changed', f.id);
  f.ctx.emit('world.changed', expectedWorldNotice(f.core));
  t.mock.timers.tick(3_600_000);
  await delay(10);
  assert.deepEqual(created, before);
  assert.ok(Object.values(pending).every(handles => handles.size === 0));
});

test('R6 Economy 卸载取消路径解析，并等守卫收尾后关库释锁', async t => {
  const release = Promise.withResolvers();
  let resolving, inFlight = 0, dispatched = 0, disposed = false;
  const f = await cordisFixture(t, {io: {async resolve(path, {signal}) {
    resolving = signal;
    inFlight++;
    try { await release.promise; signal.throwIfAborted(); return path; }
    finally { inFlight--; }
  }}});
  const lock = join(f.repo, '.chatpet/data/economy/economy.lock');
  const committed = await f.ownerAction({kind: 'grant', amount: 13}, 'r6-retained-grant');
  assert.ok(existsSync(lock));
  const exec = {name: 'write', token: Symbol('r6-file'), arguments: {file_path: join(f.repo, 'safe.md')},
    signal: new AbortController().signal};
  const operation = f.ctx.waterfall('tools/pre-execute', exec, async () => {dispatched++; return {kind: 'allow'};});
  const outcome = Promise.allSettled([operation]);
  let unloading;
  try {
    await eventually(() => resolving, 'Economy 原生解析已进入');
    unloading = f.unload('economy').then(() => {disposed = true;});
    await eventually(() => resolving.aborted || disposed, '解析取消或入口已退场');
    assert.equal(resolving.aborted, true);
    assert.equal(exec.signal.aborted, false);
    assert.equal(disposed, false);
    assert.equal(inFlight, 1);
    assert.ok(existsSync(lock));
  } finally {
    release.resolve();
    await outcome;
    await unloading;
  }
  assert.equal(dispatched, 0);
  assert.equal(inFlight, 0);
  assert.equal(existsSync(lock), false);
  await f.load('economy');
  assert.equal((await f.economy.snapshot(f.id)).balance, committed.balance);
});

test('Economy 原生文件守卫保护钱包目录和独立采用证据', async t => {
  const f = await cordisFixture(t, {order:['economy']});
  const file = join(f.repo,'.chatpet/data/living/economy-adoption.json'), original = readFileSync(file);
  for (const [name,path,denied] of [
    ['write',file,true], ['read',file,true], ['write',join(file,'..'),true],
    ['write',join(f.repo,'.chatpet/data/economy/storage.json'),true], ['write',join(file,'../unrelated.json'),false],
  ]) {
    const exec = {name,token:Symbol(name),arguments:{file_path:path},signal:new AbortController().signal};
    const gate = await f.ctx.waterfall('tools/pre-execute',exec,async () => ({kind:'allow'}));
    assert.equal(gate.kind,'allow');
    const denial = f.ctx.tools.checkGuards(exec);
    if (denied) assert.match(denial,/经济账本由程序结算/);
    else assert.equal(denial,undefined);
    f.ctx.emit('tools/result',exec);
  }
  assert.deepEqual(readFileSync(file),original);
});

test('R6 Economy 卸载等待跨区设置请求，旧请求不能写配置', async t => {
  const f = await cordisFixture(t);
  await f.body.snapshot(f.id);
  const before = await f.economy.snapshot(f.id);
  const release = Promise.withResolvers();
  let reads = 0, disposed = false;
  const emotion = await f.ctx.plugin({apply(ctx) {
    ctx.provide('petEmotion', {roomSnapshot() {}, async read() {
      if (++reads === 1) await release.promise;
    }});
  }});
  const lock = join(f.repo, '.chatpet/data/economy/economy.lock');
  const signal = new AbortController().signal;
  const operation = f.economy.settings(f.id, before.configurationVersion, {articlePrice: 23}, 'r6-stale-settings', signal);
  const outcome = Promise.allSettled([operation]);
  let unloading;
  try {
    await eventually(() => reads === 1, '设置的 Body 检查点已进入情绪读取');
    unloading = f.unload('economy').then(() => {disposed = true;});
    await eventually(() => !f.economy, 'Economy 门面已撤下');
    await delay(10);
    assert.equal(disposed, false);
    assert.ok(existsSync(lock));
  } finally {
    release.resolve();
    await outcome;
    await unloading;
    await f.body.snapshot(f.id);
    await emotion.dispose();
  }
  await assert.rejects(operation, /Economy is stopped/);
  assert.equal(existsSync(lock), false);
  await f.load('economy');
  assert.equal((await f.economy.snapshot(f.id)).configurationVersion, before.configurationVersion);
});

test('R6 Economy 挂载中途失败会撤登记并关库，之后可同名重挂', async t => {
  const {LivingWorld} = await import('../../dist/src/living/index.js');
  const f = await cordisFixture(t, {order: ['body', 'life']});
  const world = LivingWorld.find(f.ctx, f.core);
  const body = f.body, life = f.life;
  const removeConflictingInitializer = f.core.workspace.registerInitializer('economy', () => {});
  const lock = join(f.repo, '.chatpet/data/economy/economy.lock');
  try {
    await assert.rejects(f.load('economy'), /Workspace initializer already registered/);
    assert.equal(f.economy, undefined);
    assert.equal(world.lookup('economy'), undefined);
    assert.equal(existsSync(lock), false);
    assert.equal(f.body, body);
    assert.equal(f.life, life);
  } finally { removeConflictingInitializer(); }
  await f.load('economy');
  assert.equal(world.lookup('economy').value, f.economy);
  assert.ok(existsSync(lock));
});

test('R6 Life 卸载等待原生持久日志的无信号读取关闭 reader', async t => {
  const original = 'prior-home', release = Promise.withResolvers();
  let readers = 0, inFlight = 0, disposed = false;
  const f = await cordisFixture(t, {io: {
    open(id) { if (id === original) readers++; },
    close(id) { if (id === original) readers--; },
    async read(id, read) {
      if (id !== original) return read();
      inFlight++;
      try { await release.promise; return read(); }
      finally { inFlight--; }
    },
  }});
  await f.bound.attachSession(original);
  await f.body.act(f.id, 'water', 'r6-original-receipt');
  const fact = (await f.body.pendingFacts(f.id)).at(-1);
  const source = {kind: 'dsh-world-life', facts: [fact]}, messageId = 'r6-fact-message';
  const sourceDigest = createHash('sha256').update(JSON.stringify(source)).digest('hex');
  const log = JSON.stringify({header: {id: original}, events: [{type: 'user/message', data: {id: messageId, source}}]});
  writeFileSync(f.logFile(original), log);
  const store = createLifeStore(f.directory, Intl.DateTimeFormat().resolvedOptions().timeZone);
  const at = new Date().toISOString();
  store.write({...store.read(), delivering: {sessionId: original, messageId, sentAt: at, scheduledAt: at,
    source: 'facts', what: '互动事实', job: {facts: {at, messageId, sourceDigest, refs: [{domain: fact.domain, id: fact.id}]}}}});
  let unloading;
  const enabling = Promise.allSettled([f.enable()]);
  try {
    await eventually(() => inFlight === 1, 'Life 已打开原生持久日志');
    unloading = f.unload('life').then(() => {disposed = true;});
    await eventually(() => !f.life, 'Life 门面已撤下');
    await delay(10);
    assert.equal(disposed, false);
    assert.equal(readers, 1);
  } finally {
    release.resolve();
    await enabling;
    await unloading;
  }
  assert.equal(readers, 0);
  assert.equal(inFlight, 0);
  assert.equal(readFileSync(f.logFile(original), 'utf8'), log);
  assert.ok((await f.body.pendingFacts(f.id)).some(row => row.id === fact.id));
});

async function runningHold(t) {
  const f = await cordisFixture(t);
  f.model = async call => {
    if (call.messages.some(message => message.source.kind === 'dsh-world-life'))
      await submitPlan(call, [{id: 'rest', kind: 'hold', activity: 'Resting', durationMinutes: 10}]);
    return 'Synthetic reply';
  };
  await f.enable();
  const plan = await eventually(async () => {
    const {plan} = await f.life.readPlan(f.id);
    return plan?.execution?.status === 'running' && plan;
  }, '定时活动已取得 Body 运行回执');
  return {f, plan};
}

test('Body 和 Economy 提交可越过堵住的 Plan 队列，出队后合并推进', async t => {
  const f = await cordisFixture(t);
  await f.life.snapshot(f.id);
  await delay(0);
  const gate = Promise.withResolvers(), entered = Promise.withResolvers();
  const blocked = f.life.enqueue(async () => { entered.resolve(); await gate.promise; });
  await entered.promise;
  const tick = t.mock.method(f.life, 'tick');
  try {
    const [care, wallet] = await Promise.race([
      Promise.all([
        f.body.act(f.id, 'water', 'queued-plan-water'),
        f.ownerAction({kind:'grant',amount:12},'queued-plan-grant'),
      ]),
      delay(1000).then(() => { throw Error('生活三区通知阻塞了已提交的请求'); }),
    ]);
    assert.equal(care.fact.requestId,'queued-plan-water');
    assert.equal(wallet.ledger[0].requestId,'queued-plan-grant');
    assert.equal(tick.mock.callCount(),0);
    await delay(0);
  } finally { gate.resolve(); await blocked; }
  await eventually(()=>tick.mock.callCount()===1,'Plan 出队后消费合并通知');
  await delay(0);
  assert.equal(tick.mock.callCount(),1);
});

test('Plan 常规落盘不等待 Body 同步，显式暂停等待 Body 原执行', async t => {
  const {f, plan} = await runningHold(t);
  const gate = Promise.withResolvers(), entered = Promise.withResolvers();
  const refreshEmotion = f.body.refreshEmotion.bind(f.body);
  const read = t.mock.method(f.body,'refreshEmotion',async id=>{
    entered.resolve();
    await gate.promise;
    return refreshEmotion(id);
  });
  try {
    const {revision} = await f.life.readPlan(f.id);
    const kept = await f.life.keepPlan(f.id,revision,'Keep the accepted operation',null);
    assert.equal(kept.plan.operationId,plan.operationId);
    await entered.promise;
    read.mock.restore();
  } finally { gate.resolve(); }
  const inspection = holdPauseInspection(t,f);
  let finished = false;
  const pausing = f.life.control(f.id,false).then(result=>{finished=true;return result;});
  try {
    await eventually(inspection.waiting,'Plan 在等待 Body 原执行回执');
    assert.equal(finished,false);
    assert.equal(f.life.bodyClockState(f.id).enabled,false);
  } finally { inspection.release(); }
  assert.deepEqual(await pausing,{enabled:false,running:false});
  assert.equal((await f.body.inspectPlanned(f.id,plan.operationId)).status,'paused');
  assert.equal((await f.body.snapshot(f.id)).autonomyEnabled,false);
});

test('显式关闭 Life 在计划读取失败时仍关闭 Body 自治',async t=>{
  const {f}=await runningHold(t);
  assert.equal((await f.body.snapshot(f.id)).autonomyEnabled,true);
  const file=join(f.life.binding.directory,'life.json');
  const original=readFileSync(file);
  // Delay the ordinary background clock update so only explicit pause can stop Body.
  const sync=f.body.syncLifeClock.bind(f.body), release=Promise.withResolvers();
  const background=t.mock.method(f.body,'syncLifeClock',async(...args)=>{await release.promise;return sync(...args);});
  writeFileSync(file,'{');
  try {
    await assert.rejects(f.life.control(f.id,false),/not valid JSON/);
    assert.equal(f.life.bodyClockState(f.id).enabled,false);
    assert.equal(f.life.running(),false);
    assert.equal((await f.body.snapshot(f.id)).autonomyEnabled,false);
  } finally {
    writeFileSync(file,original);
    background.mock.restore();
    release.resolve();
  }
});

test('Economy 的 Plan 通知失败后，新事实与请求回执仍能在重开后核对', async t => {
  const f = await cordisFixture(t);
  const notify = t.mock.method(f.life,'noticeDomainChange',()=>{throw Error('synthetic notice failure');});
  const requestId='committed-before-plan-notice',action={kind:'grant',amount:17};
  const first=await f.ownerAction(action,requestId);
  const [fact]=await f.economy.pendingFacts(f.id);
  assert.equal(fact.requestId,requestId);
  assert.equal(notify.mock.callCount(),1);
  const replay=await f.ownerAction(action,requestId);
  assert.equal(replay.balance,first.balance);
  assert.equal(notify.mock.callCount(),1,'原号回查不重复通知');
  notify.mock.restore();
  await f.unload('economy'); await f.load('economy');
  assert.deepEqual(await f.economy.pendingFacts(f.id),[fact]);
  assert.equal((await f.economy.snapshot(f.id)).balance,first.balance);
});

test('Body 或 Plan 缺席时，暂停和原执行保留，钱包提交仍可核对', async t => {
  const {f, plan} = await runningHold(t);
  const home = f.life.homeSessionId();
  await f.unload('body');
  await assert.rejects(f.life.control(f.id,false),/body must be available/);
  assert.equal(f.life.running(),false);
  assert.equal(f.life.bodyClockState(f.id).enabled,false);
  assert.equal((await f.life.readPlan(f.id)).plan.operationId,plan.operationId);
  assert.ok(f.cancellations.some(call=>call.sessionId===home));
  await f.unload('life');
  await f.ownerAction({kind:'grant',amount:9},'plan-absent-grant');
  assert.ok((await f.economy.pendingFacts(f.id)).some(fact=>fact.requestId==='plan-absent-grant'));
  await f.load('life');
  assert.equal((await f.life.readPlan(f.id)).enabled,false);
});

test('绑定 A→B→A 后，旧代通知无法排进当前 Plan', async t => {
  const f=await cordisFixture(t);
  await f.life.snapshot(f.id);
  await delay(0);
  const gate=Promise.withResolvers(), entered=Promise.withResolvers();
  const blocked=f.life.enqueue(async()=>{entered.resolve();await gate.promise;});
  await entered.promise;
  const saved=f.core.workspace.homeScope(), readScope=f.core.workspace.homeScope.bind(f.core.workspace);
  let scope=saved;
  const binding=t.mock.method(f.core.workspace,'homeScope',()=>scope);
  const tick=t.mock.method(f.life,'tick');
  try {
    await f.ownerAction({kind:'grant',amount:1},'old-a-notice');
    await delay(0); // Let the old timer enter the blocked serial queue.
    scope={...saved,workspaceId:'foreign',generation:saved.generation+1};
    scope={...saved,generation:saved.generation+2};
    gate.resolve();
    await blocked;
    await delay(0);
    assert.equal(tick.mock.callCount(),0);
    await f.ownerAction({kind:'grant',amount:1},'current-a-notice');
    await eventually(()=>tick.mock.callCount()===1,'当前代的钱包事实可以推进 Plan');
  } finally { gate.resolve(); await blocked; binding.mock.restore(); }
  assert.deepEqual(f.core.workspace.homeScope(),readScope());
});

function holdPauseInspection(t, {body, life}) {
  const gate = Promise.withResolvers();
  const inspect = body.inspectPlanned.bind(body);
  let waiting = false;
  t.mock.method(body, 'inspectPlanned', async (workspaceId, operationId) => {
    const receipt = await inspect(workspaceId, operationId);
    if (life.bodyClockState(workspaceId)?.enabled === false) {
      waiting = true;
      await gate.promise;
    }
    return receipt;
  });
  return {waiting: () => waiting, release: gate.resolve};
}

test('3B 显式暂停等待 Body 时卸载 Life，重挂后保留暂停并按原编号恢复', async t => {
  const {f, plan} = await runningHold(t);
  const life = f.life, {operationId} = plan;
  const inspection = holdPauseInspection(t, f);
  const pausing = Promise.allSettled([life.control(f.id, false)]);
  let unloading;
  try {
    await eventually(inspection.waiting, '显式暂停正在等待原 Body 回执');
    unloading = f.unload('life');
    await eventually(() => !f.life, 'Life 门面已撤下');
    await assert.rejects(life.control(f.id, false), /生活组件已停止/);
  } finally {
    inspection.release();
    await pausing;
    await unloading;
  }

  await f.load('life');
  const saved = await f.life.readPlan(f.id);
  const paused = await f.body.inspectPlanned(f.id, operationId);
  assert.deepEqual({
    enabled: saved.enabled, plan: saved.plan.status, resumeOnEnable: saved.plan.resumeOnEnable,
    operationId: saved.plan.operationId, receipt: paused.status,
  }, {enabled: false, plan: 'paused', resumeOnEnable: true, operationId, receipt: 'paused'});
  const [result] = await pausing;
  assert.deepEqual(result, {status: 'fulfilled', value: {enabled: false, running: false}});

  const pauseMs = 60 * 60_000;
  t.mock.timers.tick(pauseMs);
  assert.deepEqual(await f.life.control(f.id, true), {enabled: true, running: true});
  const resumed = (await f.life.readPlan(f.id)).plan;
  const receipt = await f.body.inspectPlanned(f.id, operationId);
  assert.deepEqual({status: resumed.status, operationId: resumed.operationId, resumeOnEnable: resumed.resumeOnEnable},
    {status: 'active', operationId, resumeOnEnable: false});
  assert.equal(receipt.operationId, operationId);
  assert.equal(receipt.status, 'running');
  assert.equal(Date.parse(receipt.until), Date.parse(plan.execution.until) + pauseMs);
});

function appendUsage(session) {
  const turn = (session.snapshotEvents().findLast(event => event.type === 'turn/start')?.data.turn ?? 0) + 1;
  const step = 1, reason = {kind: 'completed'};
  session.append('turn/start', {turn});
  session.append('step/start', {turn, step});
  const event = session.append('assistant/message', {
    turn, step, stream: [], usage: {inputTokens: 1000, outputTokens: 125},
    message: createAssistantMessage({source: {provider: 'fixture', model: 'scripted'}, content: [{type: 'text', text: 'Synthetic usage'}]}),
  }, {surfaceOp: 'append'});
  session.append('step/end', {turn, step, reason});
  session.append('turn/end', {turn, reason});
  return event;
}

test('3B 暂停等 Body 与运行时收尾期间照常落盘 home 花费，重挂淘汰旧写入', async t => {
  const {f} = await runningHold(t);
  const life = f.life, fiber = f.fiber('life'), runtime = life.runtime;
  const homeId = life.homeSessionId();
  assert.ok(homeId);
  const home = await f.agent(homeId);
  await home.whenIdle();
  const store = createLifeStore(f.directory, life.timeZone);
  const spend = () => store.read().spend?.yuan ?? 0;
  const sessionHooks = () => f.ctx.events._hooks['session/event'].filter(hook => hook.ctx.fiber === fiber);
  const liveHooks = sessionHooks();

  const inspection = holdPauseInspection(t, f), finish = Promise.withResolvers();
  const settled = runtime.settled.bind(runtime);
  let retiredHooks;
  t.mock.method(runtime, 'settled', async () => {
    const remaining = new Set(sessionHooks());
    retiredHooks = liveHooks.filter(hook => !remaining.has(hook));
    await Promise.all([settled(), finish.promise]);
  });
  const pausing = Promise.allSettled([life.control(f.id, false)]);
  let unloading;
  try {
    await eventually(inspection.waiting, '显式暂停正在等待 Body，home 仍能提交在途记账');
    const before = spend();
    appendUsage(home.session);
    const duringPause = spend();

    inspection.release();
    await eventually(() => retiredHooks, '上游运行时进入 settled');
    assert.ok(retiredHooks.length > 0);
    unloading = fiber.dispose();
    await eventually(() => !f.ctx.get('petLife', false), '旧 Life 门面已撤下');
    // 模拟原生事件分发已取出该监听器，运行时撤订后才交付回调。
    const recordLateUsage = () => {
      const event = appendUsage(home.session);
      for (const {callback} of retiredHooks) callback(home.session, event);
    };
    recordLateUsage();
    const duringSettlement = spend();

    await f.load('life');
    assert.notEqual(f.life, life);
    recordLateUsage();
    const afterRemount = spend();
    await f.unload('life');
    recordLateUsage();
    assert.deepEqual({pausing: duringPause > before, settling: duringSettlement > duringPause,
      afterRemount, afterReplacementClosed: spend()},
    {pausing: true, settling: true, afterRemount: duringSettlement, afterReplacementClosed: duringSettlement});
  } finally {
    inspection.release();
    finish.resolve();
    await pausing;
    await unloading;
  }
  const [result] = await pausing;
  assert.deepEqual(result, {status: 'fulfilled', value: {enabled: false, running: false}});
});
