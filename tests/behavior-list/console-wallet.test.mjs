import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {panelNodes, renderEconomyPanel} from './economy-panel.mjs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ConsoleRequests, normalizeWalletRequest} from '../../dist/src/living/economy/console-requests.js';
import {fixture, value} from './fixture.mjs';

const workspaceId = 'world';
const meal = 'food:improved-meal';
const walletFile = f => join(f.repo, '.chatpet/data/economy/economy.sqlite');
const call = (f, endpoint, input = {}, id) => f.settings(endpoint, {workspaceId, ...input}, id);
const recovery = (f, endpoint, requestId, input = {}) => call(f, endpoint, {requestId, ...input});
const state = async (...args) => value(await recovery(...args)).state;

test('原号查证区分已提交、同号异内容和无证据，显式放弃保留原编号', async t => {
  const f = await fixture(t, {console:true, life:false});
  f.workspace.status = async () => 'ok';
  const before = await f.economy.snapshot(workspaceId);
  const input = {workspaceId, expectedVersion:before.configurationVersion, next:{compostCost:13}};
  // The original owner has committed, but its old client only retained the request.
  await f.economy.settings(workspaceId, input.expectedVersion, input.next, 'committed-save', new AbortController().signal);
  {
    using db = new DatabaseSync(walletFile(f));
    const rows = new ConsoleRequests(db, {storageId:before.storageId, companionId:before.companionId});
    rows.add('committed-save', normalizeWalletRequest('economySettings', input));
    rows.add('queued', normalizeWalletRequest('economyAction', {workspaceId, action:{kind:'grant', amount:4}}));
    rows.add('collision', normalizeWalletRequest('economyAction', {workspaceId, action:{kind:'grant', amount:5}}));
  }
  await f.ownerAction({kind:'grant',amount:6}, 'collision');
  await f.restart();
  assert.deepEqual(value(await call(f, 'economyPending')).map(row => row.requestId), ['collision','committed-save','queued']);
  const ledger = () => {
    using db = new DatabaseSync(walletFile(f), {readOnly:true});
    return db.prepare('SELECT * FROM requests ORDER BY id').all();
  };
  const receipts = ledger();
  assert.equal(await state(f, 'economyCheck', 'committed-save'), 'committed');
  assert.equal(await state(f, 'economyCheck', 'collision'), 'conflict');
  assert.equal(await state(f, 'economyCheck', 'queued'), 'no-evidence');
  assert.deepEqual(ledger(), receipts);
  assert.equal(value(await call(f, 'economyPending')).length, 3, '查证后仍由主人逐项处理');
  assert.equal((await recovery(f, 'economyRetry', 'collision')).error.code, 'CONFLICT');
  assert.equal((await recovery(f, 'economyAbandon', 'queued', {acceptNoEvidence:false})).error.code, 'CONFLICT');
  assert.equal(await state(f, 'economyAbandon', 'queued', {acceptNoEvidence:true}), 'abandoned');
  assert.equal((await call(f, 'economyAction', {action:{kind:'grant',amount:4}}, 'queued')).error.code, 'CONFLICT');
  assert.equal(await state(f, 'economyRetry', 'committed-save'), 'committed');
  const after = await f.economy.snapshot(workspaceId);
  assert.equal(after.configuration.compostCost, 13);
  assert.equal(after.ledger.filter(row => row.requestId === 'committed-save').length, 1);
});

test('重启后持久待办按原号查证且只在显式重试时到账一次', async t => {
  const f = await fixture(t,{console:true,life:false});
  f.workspace.status = async () => 'ok';
  const original = 'original-credit', input = {workspaceId,action:{kind:'grant',amount:2}};
  const before = await f.economy.snapshot(workspaceId);
  {
    using db = new DatabaseSync(walletFile(f));
    new ConsoleRequests(db,{storageId:before.storageId,companionId:before.companionId})
      .add(original,normalizeWalletRequest('economyAction',input));
  }
  await f.restart();
  const page = renderEconomyPanel(async (endpoint,input,_signal,id) => value(await f.settings(endpoint,input,id)));
  page.render();
  t.after(page.mount());
  await setImmediate();
  const [pending] = panelNodes(page.render(),node => node.type === 'div' && node.props?.key === original);
  assert.ok(pending,'重开钱包从现有钱包库加载原号');
  const [check] = panelNodes(pending,node => node.type === 'button' && node.children[0] === '按原号查证');
  await check.props.onClick();
  assert.equal(await state(f,'economyCheck',original),'no-evidence');
  assert.equal((await f.economy.snapshot(workspaceId)).balance,before.balance);
  const [retry] = panelNodes(page.render(),node => node.type === 'button' && node.children[0] === '重试原操作');
  await retry.props.onClick();
  assert.equal(await state(f,'economyRetry',original),'committed');
  assert.deepEqual(value(await call(f,'economyPending')),[]);
  const after = await f.economy.snapshot(workspaceId);
  assert.equal(after.balance,before.balance+2);
  assert.equal(after.ledger.filter(row=>row.requestId===original).length,1);
});

test('Console 钱包忽略浏览器残留旧待办并正常处理新请求', async t => {
  const f = await fixture(t,{console:true,life:false});
  f.workspace.status = async () => 'ok';
  const key = 'chatpet:economy:pending:' + workspaceId;
  const raw = JSON.stringify({endpoint:'economyAction',requestId:'residual-old-request',
    input:{workspaceId,action:{kind:'grant',amount:87}}});
  const residual = new Map([[key,raw]]), touches = [], calls = [];
  const storage = {
    get(key) { touches.push('read'); return residual.get(key); },
    set(key,value) { touches.push('write'); residual.set(key,value); },
    delete(key) { touches.push('delete'); return residual.delete(key); },
  };
  const before = await f.economy.snapshot(workspaceId);
  const page = renderEconomyPanel(async (endpoint,input,_signal,id) => {
    calls.push({endpoint,id});
    return value(await f.settings(endpoint,input,id));
  },workspaceId,{storage});
  page.render();
  t.after(page.mount());
  await setImmediate();
  const [amount] = panelNodes(page.render(),node => node.type === 'field' && node.props.label === '金额');
  amount.props.onChange('1');
  const nodes = page.render();
  assert.equal(panelNodes(nodes,node => node.props?.role === 'alert' || node.children.includes('待确认钱包操作')).length,0);
  const [grant] = panelNodes(nodes,node => node.type === 'button' && node.children[0] === '给零花钱');
  assert.equal(grant.props.disabled,false);
  await grant.props.onClick();
  assert.equal(panelNodes(page.render(),node => node.props?.role === 'alert').length,0);
  const writes = calls.filter(call => call.endpoint === 'economyAction');
  assert.equal(writes.length,1);
  assert.ok(calls.every(call => call.endpoint !== 'economyRetry' && call.id !== 'residual-old-request'));
  assert.deepEqual(value(await call(f,'economyPending')),[]);
  const after = await f.economy.snapshot(workspaceId);
  assert.equal(after.balance,before.balance+1);
  assert.equal(after.ledger.filter(row=>row.requestId===writes[0].id).length,1);
  assert.deepEqual(touches,[]);
  assert.equal(residual.get(key),raw);
});

test('Console 投喂只查不动，Body 部分提交只由显式同号重试续完', async t => {
  const f = await fixture(t, {console:true, life:false});
  f.workspace.status = async () => 'ok';
  await f.body.setAutonomy(workspaceId, true);
  await f.ownerAction({kind:'gift',itemId:meal}, 'give-meal');
  const file = walletFile(f), homeFile = join(f.repo,'.chatpet/data/life/home.json');
  {
    using db = new DatabaseSync(file);
    db.exec("CREATE TRIGGER synthetic_interrupt BEFORE UPDATE ON uses BEGIN SELECT RAISE(ABORT, 'synthetic settlement interrupt'); END;");
  }
  const action = {action:{kind:'feed', itemId:meal}};
  const started = value(await call(f, 'economyAction', action, 'feed-original'));
  assert.equal(started.execution.phase, 'waiting');
  assert.equal(started.inventory.find(row => row.itemId === meal).reserved, 1);
  const homeBytes = readFileSync(homeFile);
  const walletRows = () => {
    using db = new DatabaseSync(file, {readOnly:true});
    return ['meta','items','uses','console_wallet_requests'].map(table => db.prepare(`SELECT * FROM ${table}`).all());
  };
  const savedRows = walletRows();
  for (let index = 0; index < 3; index++) assert.equal(await state(f, 'economyCheck', 'feed-original'), 'partial');
  assert.deepEqual(walletRows(), savedRows);
  assert.deepEqual(readFileSync(homeFile), homeBytes);
  assert.equal((await recovery(f, 'economyAbandon', 'feed-original', {acceptNoEvidence:true})).error.code, 'CONFLICT');
  assert.equal((await call(f, 'economyAction', {action:{kind:'grant', amount:1}}, 'new-console')).error.code, 'CONFLICT');
  {
    using db = new DatabaseSync(file);
    db.exec('DROP TRIGGER synthetic_interrupt');
  }
  await f.restart();
  await f.body.setAutonomy(workspaceId, true);
  const pending = await f.body.snapshot(workspaceId);
  assert.equal(pending.planned, undefined, '待结算的 Console 原号留在回执，释放 Life 活动位置');
  await f.ownerAction({kind:'grant', amount:1}, 'other-owner-path');
  assert.equal((await f.economy.snapshot(workspaceId)).pendingUses.length, 1);
  assert.equal((await call(f, 'economyAction', action, 'feed-original')).error.code, 'OUTCOME_UNKNOWN');
  const race = await Promise.all([
    recovery(f, 'economyRetry', 'feed-original'),
    recovery(f, 'economyAbandon', 'feed-original', {acceptNoEvidence:true}),
  ]);
  assert.equal(value(race[0]).state, 'committed');
  assert.ok(!race[1].ok || race[1].value.state === 'committed');
  assert.equal(await state(f, 'economyCheck', 'feed-original'), 'committed');
  assert.equal(value(await call(f, 'economyPending')).length, 0);
  const after = await f.economy.snapshot(workspaceId);
  assert.deepEqual((await f.body.snapshot(workspaceId)).needs, pending.needs);
  assert.equal(after.inventory.find(row => row.itemId === meal).quantity, 0);
  assert.equal(after.ledger.filter(row => row.kind === 'use-consume').length, 1);
});


test('Console 钱包写入与四个恢复入口拒绝上一代绑定的请求', async t => {
  const f = await fixture(t, {console:true, life:false});
  f.workspace.status = async () => 'ok';
  const scope = f.host.workspace.homeScope();
  const {revision,sourceRevision} = f.host.workspace.status();
  const balance = (await f.economy.snapshot(workspaceId)).balance;
  const other = join(f.root,'other');
  mkdirSync(other);
  const endpoints = [
    ['economyAction',{action:{kind:'grant',amount:4}}],
    ['economySettings',{expectedVersion:'1',next:{compostCost:13}}],
    ['economyPending',{}],
    ['economyCheck',{requestId:'original'}],
    ['economyRetry',{requestId:'original'}],
    ['economyAbandon',{requestId:'original',acceptNoEvidence:true}],
  ];
  {
    using db = new DatabaseSync(walletFile(f));
    new ConsoleRequests(db, {storageId:scope.storageId, companionId:f.config.companionId})
      .add('original',normalizeWalletRequest('economyAction',{workspaceId,action:{kind:'grant',amount:3}}));
  }
  const started = Promise.withResolvers(), resume = Promise.withResolvers();
  let waiting = 0;
  f.workspace.status = () => {
    if (++waiting === endpoints.length) started.resolve();
    return resume.promise;
  };
  const outdated = endpoints.map(([endpoint,input]) => call(f,endpoint,input));
  await started.promise;
  await f.bind(other);
  await f.bind(f.repo);
  // Exercise matching persisted revisions while Core supplies the genuine new binding generation.
  const status = f.host.workspace.status.bind(f.host.workspace);
  t.mock.method(f.host.workspace,'status',() => ({...status(),revision,sourceRevision}));
  resume.resolve('ok');
  assert.notEqual(f.host.workspace.homeScope().generation,scope.generation);
  const replies = await Promise.all(outdated);
  assert.deepEqual(replies.map((reply,index) => [endpoints[index][0],reply.error?.code]),
    endpoints.map(([endpoint]) => [endpoint,'STALE_BINDING']));
  assert.equal((await f.economy.snapshot(workspaceId)).balance,balance);
  assert.equal(await state(f,'economyCheck','original'),'no-evidence');
});

test('出售回执可以按原号查证与重放且只到账一次', async t => {
  const f = await fixture(t,{console:true,life:false});
  f.workspace.status = async () => 'ok';
  const item = (await f.economy.snapshot(workspaceId)).catalog.find(row => row.kind === 'harvest' && row.sellPrice > 0);
  assert.ok(item);
  await f.ownerAction({kind:'gift',itemId:item.id},'stock-for-sale');
  const input = {action:{kind:'sell',itemId:item.id}};
  const sold = value(await call(f,'economyAction',input,'original-sale'));
  assert.equal(await state(f,'economyCheck','original-sale'),'committed');
  assert.deepEqual(value(await call(f,'economyPending')),[]);
  value(await call(f,'economyAction',input,'original-sale'));
  const after = await f.economy.snapshot(workspaceId);
  assert.equal(after.balance,sold.balance);
  assert.equal(after.ledger.filter(row => row.requestId === 'original-sale').length,1);
});

test('余额不足或配置版本过期的明确拒绝释放钱包且原号不会后来执行', async t => {
  const f = await fixture(t,{console:true,life:false});
  f.workspace.status = async () => 'ok';
  const before = await f.economy.snapshot(workspaceId);
  const buy = {action:{kind:'buy',itemId:meal}};
  const refusal = await call(f,'economyAction',buy,'cannot-afford');
  assert.equal(refusal.error?.code,'INELIGIBLE');
  assert.equal(refusal.error?.effect,'none');
  assert.deepEqual(value(await call(f,'economyPending')),[]);
  const stale = await call(f,'economySettings',{
    expectedVersion:String(Number(before.configurationVersion)+1),next:{compostCost:13},
  },'old-config');
  assert.equal(stale.error?.code,'STALE_REVISION');
  assert.equal(stale.error?.effect,'none');
  assert.deepEqual(value(await call(f,'economyPending')),[]);
  value(await call(f,'economyAction',{action:{kind:'grant',amount:100}},'fund-wallet'));
  const repeat = await call(f,'economyAction',buy,'cannot-afford');
  assert.equal(repeat.ok,false);
  assert.equal((await f.economy.snapshot(workspaceId)).inventory.some(row => row.itemId === meal && row.quantity > 0),false);
});

test('Console 已提交但遗失的回包在重启和重开钱包后仍可按原号查证', async t => {
  const f = await fixture(t,{console:true,life:false});
  f.workspace.status = async () => 'ok';
  const original = 'committed-before-disconnect';
  const before = await f.economy.snapshot(workspaceId);
  // Response is generated successfully, but never delivered to the page.
  value(await call(f,'economyAction',{action:{kind:'grant',amount:7}},original));
  assert.deepEqual(value(await call(f,'economyPending')),[]);
  await f.restart();
  const page = renderEconomyPanel(async (endpoint,input,_signal,id) => value(await f.settings(endpoint,input,id)));
  page.render();
  t.after(page.mount());
  await setImmediate();
  const [receipt] = panelNodes(page.render(),node => node.type === 'div' && node.props?.key === original);
  assert.ok(receipt,'重开页面仍可找到原号');
  const [check] = panelNodes(receipt,node => node.type === 'button' && node.children[0] === '按原号查证');
  await check.props.onClick();
  assert.ok(panelNodes(page.render(),node => node.type === 'p' && node.children.includes('已提交')).length);
  assert.equal((await f.economy.snapshot(workspaceId)).balance,before.balance+7);
});

test('Console 钱包已到账后换绑仍可按原号查证', async t => {
  const f = await fixture(t,{console:true,life:false});
  f.workspace.status = async () => 'ok';
  const before = await f.economy.snapshot(workspaceId), id = 'committed-before-rebind';
  const entered = Promise.withResolvers(), resume = Promise.withResolvers();
  const snapshot = f.economy.snapshot.bind(f.economy);
  const pause = t.mock.method(f.economy,'snapshot',async (...args) => {
    const value = await snapshot(...args);
    entered.resolve();
    await resume.promise;
    return value;
  });
  const reply = call(f,'economyAction',{action:{kind:'grant',amount:3}},id);
  try {
    await entered.promise;
    const other = join(f.root,'other');
    mkdirSync(other);
    await f.bind(other);
    await f.bind(f.repo);
  } finally {
    resume.resolve();
    pause.mock.restore();
  }
  const response = await reply;
  const after = await f.economy.snapshot(workspaceId);
  assert.equal(after.balance,before.balance+3);
  assert.equal(after.ledger.filter(row => row.requestId === id).length,1);
  assert.equal(await state(f,'economyCheck',id),'committed');
  assert.equal(response.ok,false);
  assert.equal(response.error.code,'OUTCOME_UNKNOWN');
  assert.equal(response.error.effect,'unknown');
  assert.equal(response.error.retry,'reconcile');
});
