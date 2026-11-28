import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {qqTransport} from './qq-transport.mjs';
import {fixture, until, value} from './fixture.mjs';

const route = {sessionId:'home',provider:'deepseek-official',model:'deepseek-flash'};
const counters = {inputTokens:100,cacheReadTokens:40,cacheWriteTokens:5,outputTokens:10};
const now = '2026-11-26T02:00:00Z';
async function* response(usage) {
  yield {type:'text-delta',text:'合成回复'};
  if (usage) yield {type:'usage',usage};
  yield {type:'finish',reason:{kind:'completed'}};
}
async function run(f, options = route, usage = counters) {
  const stream = await f.middleware('llm/stream',[options],() => response(usage));
  const output = [];
  for await (const chunk of stream) output.push(chunk);
  assert.equal(output[0].text,'合成回复');
}
const report = async (f, extra = {}) => value(await f.settings('usageLedger',{workspaceId:'world',...extra}));

test('模型调用途中换绑又返回时，两份账本都不写，漏记可从设置读回', async t => {
  const f = await fixture(t,{life:false,economy:false,console:true,now});
  const ledger = path => join(path,'.chatpet/data/usage/ledger.sqlite');
  const original = f.repo, replacement = join(f.root,'replacement');
  mkdirSync(replacement);
  const empty = await report(f);
  assert.equal(empty.firstDay,null);
  assert.equal(empty.summary.calls,0);
  assert.equal(existsSync(ledger(original)),false);
  const stream = await f.middleware('llm/stream',[route],() => response(counters));
  const iterator = stream[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.text,'合成回复');
  await f.bind(replacement);
  assert.equal((await report(f)).gaps.rebound,0);
  await f.bind(original);
  for await (const _ of iterator) { /* finish the original call */ }
  assert.equal(existsSync(ledger(original)) || existsSync(ledger(replacement)),false);
  assert.equal((await report(f)).gaps.rebound,1);
  const request = () => f.host.operator.request(crypto.randomUUID());
  const prefs = value(await f.host.services.preferences.read(request(),{}));
  value(await f.host.services.preferences.save(request(),{expectedRevision:prefs.revision,workspace:null,conversation:prefs.conversation}));
  await run(f,{...route,sessionId:'dsh-pet',purpose:'chatpet-whisper'});
  await run(f,{...route,sessionId:'foreign'});
  await f.bind(original);
  await f.restart();
  assert.deepEqual((await report(f)).gaps,{writeFailed:0,unbound:1,rebound:1});
  await run(f);
  assert.equal((await report(f)).summary.calls,1);
  writeFileSync(ledger(original),'synthetic corrupt database');
  const corrupt = await report(f);
  assert.equal(corrupt.issue,'unavailable');
  assert.deepEqual(corrupt.gaps,{writeFailed:0,unbound:1,rebound:1});
  await run(f);
  const recovered = await report(f);
  assert.ok(recovered.recovery);
  assert.equal(recovered.summary.calls,1);
  const db = new DatabaseSync(ledger(original));
  db.exec("UPDATE meta SET value='2' WHERE key='version'"); db.close();
  await run(f);
  const newer = await report(f);
  assert.equal(newer.issue,'upgrade');
  assert.equal(newer.gaps.writeFailed,1);
});

test('用量设置按入口预设用途分行，区分缺用量、未知价格和部分估算，并核对生活卡读数', async t => {
  const f = await fixture(t,{console:true,now});
  await f.enable();
  const home = await f.home(), active = await f.begin(home.id), opts = {...route,sessionId:home.id};
  await run(f,opts);
  const event = home.session.append('assistant/message',{turn:active.turn,message:{role:'assistant',source:opts,content:[]},usage:counters,stream:[]});
  await f.emit('session/event',home.session,event);
  const firstSpend = value(await f.settings('lifeView',{workspaceId:'world'})).ledgerSpend;
  assert.ok(firstSpend.yuan>0);
  await run(f,opts,null);
  await run(f,{...opts,purpose:'compaction',model:'unknown-model'});
  const page = await report(f), ordinary = page.groups.find(row=>!row.purpose);
  assert.equal(page.issue,null);
  assert.equal(page.groups.length,2);
  assert.equal(ordinary.entry,'dsh');
  assert.equal(ordinary.calls,2);
  assert.deepEqual([ordinary.input,ordinary.read,ordinary.write,ordinary.output,ordinary.missingUsage],[100,40,5,10,1]);
  assert.equal(page.summary.calls,3);
  assert.equal(page.summary.partial,true);
  assert.equal(page.summary.priced,1);
  assert.equal(page.prices.length,2);
  assert.ok(page.prices.some(value=>value.endsWith('缓存写')) && page.prices.some(value=>value.endsWith('无价格')));
  assert.equal(page.firstDay,page.day);
  const view = value(await f.settings('lifeView',{workspaceId:'world'}));
  assert.deepEqual([view.ledgerSpend.calls,view.ledgerSpend.priced,view.ledgerSpend.unpriced,view.ledgerSpend.missingUsage],
    [3,1,1,1]);
  assert.equal(view.ledgerSpend.yuan,firstSpend.yuan);
  assert.equal(view.ledgerSpend.yuan,page.summary.yuan);
  assert.equal(view.ledgerSpend.partial,true);
  await f.end(active);
  for (const day of ['2026-11-31','1900-01-01','2099-01-01']) {
    assert.equal((await f.settings('usageLedger',{workspaceId:'world',day})).error.code,'INVALID_ARGUMENT');
  }
  assert.equal((await f.settings('usageLedger',{workspaceId:'another'})).error.code,'STALE_BINDING');
  assert.equal((await report(f,{day:page.minDay})).groups.length,0);
});

test('跨午夜的调用按结束日入账，按开始时段估价', async t => {
  // Thursday 09:30 in Beijing is peak. Saturday at the same time is off-peak.
  const start = new Date('2026-11-26T01:30:00Z');
  const f = await fixture(t,{life:false,economy:false,console:true,now:start.toISOString()});
  const before = await report(f);
  const stream = await f.middleware('llm/stream',[route],() => response(counters));
  const iterator = stream[Symbol.asyncIterator](); await iterator.next();
  t.mock.timers.tick(48 * 3600000);
  for await (const _ of iterator) {}
  const after = await report(f);
  assert.notEqual(before.day,after.day);
  assert.equal(after.firstDay,after.day);
  assert.equal(after.summary.calls,1);
  assert.equal(after.summary.yuan,(100*2 + 40*.04 + 10*8)/1e6);
  assert.equal((await report(f,{day:before.day})).summary.calls,0);
});

test('home 预算按账本跨线每天送达一次，压缩等下一条助手消息，读错保留原状态', async t => {
  const f = await fixture(t,{console:true,now});
  await f.enable();
  const home = await f.home(), opts = {...route,sessionId:home.id};
  const view = async () => value(await f.settings('lifeView',{workspaceId:'world'}));
  const {preferences} = await view();
  await f.life.settings('world',preferences,{...preferences,dailyBudget:1});
  const usage = {inputTokens:300000,outputTokens:0};
  const messages = () => f.sent.filter(message=>message.content.some(block=>block.text?.includes('手上的事收个尾')));
  async function reply(tokens = usage) {
    const active = await f.begin(home.id);
    await run(f,opts,tokens);
    await message(active,tokens);
    await f.end(active);
  }
  async function message(active,tokens) {
    const event = home.session.append('assistant/message',{
      turn:active.turn,message:{role:'assistant',source:opts,content:[]},usage:tokens,stream:[]});
    await f.emit('session/event',home.session,event);
  }
  await reply();
  assert.equal((await view()).life.spend.yuan,0.6);
  assert.equal(messages().length,0);
  await reply();
  await until(()=>messages().length===1,'当天第一次越线送到 home');
  assert.ok(home.inbox.nextStep.includes(messages()[0]) || home.inbox.nextTurn.includes(messages()[0]));
  await reply();
  assert.equal(messages().length,1);

  t.mock.timers.tick(24*3600000);
  await reply();
  await run(f,{...opts,purpose:'compaction'},usage);
  const compressed = await view();
  assert.equal(compressed.ledgerSpend.yuan,1.2);
  assert.equal(compressed.life.spend.yuan,0.6);
  assert.equal(messages().length,1);
  await reply({inputTokens:0,outputTokens:0});
  await until(()=>messages().length===2,'下一条带用量的助手消息触发提醒');
  const saved = (await view()).life.spend;
  assert.equal(saved.reminded,true);
  assert.equal(saved.yuan,1.2);
  t.mock.timers.tick(24*3600000);
  const db = new DatabaseSync(join(f.repo,'.chatpet/data/usage/ledger.sqlite'));
  try { db.exec("UPDATE meta SET value='2' WHERE key='version'"); } finally { db.close(); }
  await reply({inputTokens:1e6,outputTokens:0});
  const unreadable = await view();
  assert.equal(unreadable.ledgerSpend.issue,'upgrade');
  assert.deepEqual(unreadable.life.spend,saved);
  assert.equal(unreadable.running,true);
  assert.equal(messages().length,2);
});

test('QQ 主人和访客跨账号合计，旧记录停写，账本不可读时渠道设置仍可保存', async t => {
  const transport = qqTransport(t);
  const f = await fixture(t,{channels:true,console:true,life:false,economy:false,now,configure(services){
    services.set('agentPresets',{composedPreset:scope=>services.get('agents').list()
      .find(agent=>agent.ctx===scope)?.session.header.agentPreset});
  }});
  const request = async (endpoint, input={}) => value(await f.settings(endpoint,{workspaceId:'world',...input}));
  const configure = async qq => {
    const {messaging} = await request('channelStatus');
    return (await request('messagingSettings',{expected:messaging.config,next:{qq}})).messaging;
  };
  const old = () => ['channel-usage','channel-usage-event'].map(kind=>f.host.workspace.runtime.store.all(kind));
  assert.deepEqual(old(),[[],[]]);
  for (const [i,accountId,userId] of [[1,'100','200'],[2,'101','201']]) {
    await configure({enabled:true,accountId,ownerSpeakerId:'200',allowPrivate:['200','201']});
    const messageId='usage-'+i;
    transport.gateway.onPrivateMessage({kind:'private',selfId:accountId,userId,messageId,text:'Synthetic QQ'});
    const pending = () => f.agents().find(agent=>agent.inbox.nextTurn.some(row=>row.source.identity?.platformMessageId===messageId));
    await until(pending,'QQ 输入按身份投递到原生会话');
    const agent = pending(), message = agent.inbox.nextTurn.find(row=>row.source.identity?.platformMessageId===messageId);
    assert.equal(agent.id === (await f.home()).id,i===1);
    const active = await f.begin(agent.id,message);
    await run(f,{...route,sessionId:agent.id});
    await f.end(active);
    await until(()=>transport.sent.length===i,'QQ 回复已送达');
    const {qq,wechat} = (await request('channelStatus')).messaging;
    assert.deepEqual([qq.usage.calls,qq.usage.input,qq.usage.read,qq.usage.write,qq.usage.output,wechat.usage.calls],
      [i,i*100,i*40,i*5,i*10,0]);
    assert.deepEqual(old(),[[],[]]);
  }
  const page = await report(f);
  assert.deepEqual(page.groups.map(row=>row.entry).sort(),['qq-guest','qq-owner']);
  await f.restart();
  const {messaging} = await request('channelStatus');
  assert.equal(messaging.qq.usage.yuan,page.summary.yuan);
  writeFileSync(join(f.repo,'.chatpet/data/usage/ledger.sqlite'),'synthetic unreadable ledger');
  const saved = await configure({enabled:false});
  assert.equal(saved.qq.usage.issue,'unavailable');
  assert.equal(saved.wechat.usage.issue,'unavailable');
  assert.equal(saved.qq.state,'off');
  assert.equal((await request('channelStatus')).messaging.config.qq.enabled,false);
  assert.deepEqual(old(),[[],[]]);
});
