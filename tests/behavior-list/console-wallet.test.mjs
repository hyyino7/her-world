import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync} from 'node:fs';
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
