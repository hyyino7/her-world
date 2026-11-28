import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {createChannelSourceAdapter} from '../../src/channels/sessions.js';
import {appendUsage, usageDay, type UsageRow} from '../../src/core/usage/ledger.js';
import {channelTotals, daysBefore, homeSpend} from '../../src/core/usage/totals.js';
import {usageReport} from '../../src/core/usage/report.js';

const {fixture} = await import(new URL('../../../tests/behavior-list/fixture.mjs', import.meta.url).href);
const now = '2026-12-30T02:00:00Z';
const stamp = Date.parse(now), today = usageDay(stamp);
function record(root: string, changes: Partial<UsageRow> = {}) {
  const day = usageDay(changes.ended_at ?? stamp);
  appendUsage(root,{started_at:stamp, ended_at:stamp, day, session_id:'home', entry:'qq-owner', preset:'standard',
    purpose:null, provider:'deepseek', model:'deepseek-flash', requested_effort:null, outcome:'completed',
    input_miss:1e6, output:0, cache_read:null, cache_write:null, reasoning:null, ...changes});
}

test('home 增量金额随日、会话、文件身份和重建标记失效，两种汇总隔离读错', async t => {
  const f = await fixture(t,{life:false,economy:false,now}), scope = f.host.workspace.homeScope();
  const path = join(scope.path,'.chatpet/data/usage/ledger.sqlite');
  const home = (id='home', day=today) => homeSpend(scope,id,day);
  const channels = () => channelTotals(scope,today);
  assert.equal(home().status,'absent');
  assert.equal(channels().qq.status,'absent');
  assert.equal(existsSync(path),false);
  record(f.repo);
  assert.equal(home().yuan,2);
  assert.equal(home().status,'recorded');
  record(f.repo,{purpose:'compaction',cache_write:3});
  record(f.repo,{model:'unknown'});
  record(f.repo,{input_miss:null,output:null});
  const sum = home();
  assert.deepEqual([sum.calls,sum.priced,sum.unpriced,sum.yuan,sum.partial,sum.missingUsage],[4,2,1,4,true,1]);
  assert.equal(home('other').status,'empty');
  assert.equal(home('home',daysBefore(today,1)).status,'empty');
  assert.deepEqual(home(),sum);
  assert.equal(channels().wechat.status,'empty');
  renameSync(path,path+'.previous');
  record(f.repo,{input_miss:7e6});
  assert.equal(home().yuan,14);
  renameSync(path,path+'.replacement');
  renameSync(path+'.previous',path);
  assert.deepEqual(home(),sum);
  writeFileSync(path,'synthetic broken ledger');
  assert.equal(home().issue,'unavailable');
  assert.equal(channels().qq.issue,'unavailable');
  record(f.repo,{entry:'wechat-guest'});
  assert.deepEqual([home().status,home().calls,channels().qq.status,channels().wechat.calls],['recovered',1,'recovered',1]);
  const db = new DatabaseSync(path);
  try { db.exec("UPDATE meta SET value='9' WHERE key='version'"); } finally { db.close(); }
  assert.equal(home().issue,'upgrade');
  assert.equal(channels().wechat.issue,'upgrade');
});

test('渠道 30 天合计等于逐日金额之和，昨天和第 30 天计入，窗口外及其他渠道独立', async t => {
  const start = stamp - 30*86400000;
  const f = await fixture(t,{life:false,economy:false,now:new Date(start).toISOString()}), scope = f.host.workspace.homeScope();
  f.host.native.sourceTable.register(createChannelSourceAdapter({
    guest:id=>id==='guest',ownerActorId:()=>'owner',admit:id=>id==='guest'?'guest':'owner',
  }));
  async function call(channel: string, id: string, forMessageId?: string) {
    const identity = {channel,accountId:'fixture',conversationId:'private',speakerId:channel+':'+id};
    const message = createUserMessage({source:forMessageId?{kind:'dsh-world-reply-nudge',forMessageId}:{kind:'user',identity},
      content:[{type:'text',text:'synthetic channel input'}]});
    const active = await f.begin(id,message);
    const options = {sessionId:id,provider:'deepseek',model:'deepseek-flash',purpose:forMessageId?'compaction':undefined};
    const stream = await f.middleware('llm/stream',[options],async function* () {
      yield {type:'usage',usage:{inputTokens:1e6,outputTokens:0}};
      yield {type:'finish',reason:{kind:'completed'}};
    });
    for await (const _ of stream) {}
    await f.end(active);
    return message.id;
  }
  let guestInput: string | undefined;
  for (const offset of [30,29,1,0]) {
    t.mock.timers.setTime(stamp-offset*86400000);
    const id = offset%2?'guest':'home';
    const messageId = await call('qq',id);
    if (id==='guest') guestInput = messageId;
  }
  assert.ok(guestInput);
  await call('qq','guest',guestInput);
  await call('wechat','home');
  const {qq,wechat} = channelTotals(scope,today);
  let daily = 0;
  for (let offset=0;offset<30;offset++) {
    const groups = usageReport(f.host,scope,daysBefore(today,offset)).groups;
    for (const group of groups) if (group.entry.startsWith('qq-')) daily += group.yuan;
  }
  assert.deepEqual([qq.from,qq.to,qq.calls,qq.input,qq.missingRead,qq.missingWrite,wechat.calls],
    [daysBefore(today,29),today,4,4e6,4,4,1]);
  assert.equal(qq.yuan,daily);
  assert.equal(daily,8);
});
