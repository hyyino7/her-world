import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, readdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {priceCall} from '../../src/world/usage.js';
import {readGaps} from '../../src/core/usage/gaps.js';
import {readLedger, usageDay} from '../../src/core/usage/ledger.js';

const {fixture} = await import(new URL('../../../tests/behavior-list/fixture.mjs', import.meta.url).href);
const options = {sessionId:'home', provider:'deepseek', model:'deepseek-flash', reasoningEffort:'high'};
const usage = {inputTokens: 3, outputTokens: 8, cacheReadTokens: 2};

test('账本只存列白名单和最后一份计量，消息、提示、工具及输出哨兵均未落盘', async t => {
  const f = await fixture(t, {life:false, economy:false});
  const directory = join(f.repo,'.chatpet/data/usage'), path = join(directory,'ledger.sqlite');
  const sentinels = ['USER_SENTINEL', 'SYSTEM_SENTINEL', 'TOOL_SENTINEL', 'OUTPUT_SENTINEL'];
  const request = {...options, system:sentinels[1], messages:[{role:'user',content:sentinels[0]},
    {role:'tool',content:sentinels[2]}], tools:[{description:sentinels[2]}]};
  const chunks = [{type:'text-delta',text:sentinels[3]}, {type:'usage',usage:{inputTokens:1,outputTokens:1}},
    {type:'usage',usage}, {type:'finish',reason:{kind:'completed'}}];
  async function send(input: object = request) {
    const stream = await f.middleware('llm/stream',[input], async function* () { yield* chunks; });
    let index = 0;
    for await (const chunk of stream) assert.equal(chunk, chunks[index++]);
    assert.equal(index,chunks.length);
  }
  assert.equal(readLedger(f.repo, () => assert.fail('账本不存在')), undefined);
  assert.equal(existsSync(directory),false);
  await send();
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode=WAL');
    await send();
    const names = db.prepare('PRAGMA table_info(calls)').all().map(c => c.name);
    assert.deepEqual(names, ['started_at','ended_at','day','session_id','entry','preset','purpose','provider','model',
      'requested_effort','outcome','input_miss','output','cache_read','cache_write','reasoning']);
    const rows = db.prepare('SELECT * FROM calls').all();
    assert.equal(rows.length,2);
    assert.deepEqual([rows[0].input_miss, rows[0].output, rows[0].cache_read, rows[0].cache_write, rows[0].requested_effort],
      [3,8,2,null,'high']);
    const files = readdirSync(directory);
    assert.ok(files.includes('ledger.sqlite-wal') && files.includes('ledger.sqlite-shm'));
    for (const file of files) for (const value of sentinels) assert.ok(!readFileSync(join(directory,file)).includes(value));
    await send({...request,model:'this is a message\nnot an identifier'});
    db.exec('ALTER TABLE calls ADD COLUMN message TEXT');
    await send();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM calls').get()!.n,2);
    assert.equal(readGaps(f.host.workspace.runtime.store, usageDay(Date.now())).writeFailed,2);
  } finally { db.close(); }
});

test('多步假聊天在目录只读、模拟磁盘满和坏库时继续，漏记跨重启，下一流可恢复', async t => {
  const f = await fixture(t,{life:false,economy:false});
  const dir = join(f.repo,'.chatpet/data/usage'), path = join(dir,'ledger.sqlite');
  const day = usageDay(Date.now());
  const gaps = () => readGaps(f.host.workspace.runtime.store,day);
  let attempts = 0;
  async function chat() {
    const active = await f.begin();
    for (let step=0;step<2;step++) {
      if (step) await f.step(active);
      const stream = await f.middleware('llm/stream',[options],async function* () {
        attempts++; yield {type:'text-delta', text:'合成回复'}; yield {type:'finish',reason:{kind:'completed'}};
      });
      let reply = '';
      for await (const chunk of stream) if (chunk.type === 'text-delta') reply += chunk.text;
      assert.equal(reply,'合成回复');
    }
    await f.end(active);
  }
  await chat();
  const count = () => readLedger(f.repo,db=>Number(db.prepare('SELECT COUNT(*) AS n FROM calls').get()!.n));
  assert.equal(count(),attempts);
  chmodSync(dir,0o500);
  try { await chat(); } finally { chmodSync(dir,0o700); }
  assert.equal(gaps().writeFailed,2);
  const db = new DatabaseSync(path);
  try {
    db.exec("CREATE TRIGGER disk_full BEFORE INSERT ON calls BEGIN SELECT RAISE(FAIL, 'database or disk is full'); END");
    await chat();
    db.exec('DROP TRIGGER disk_full');
  } finally { db.close(); }
  assert.equal(count(),2);
  assert.equal(gaps().writeFailed,4);
  await f.restart();
  assert.equal(gaps().writeFailed,4);
  await chat();
  assert.equal(count(),attempts - 4);
  writeFileSync(path,'synthetic damaged sqlite');
  assert.throws(count);
  await chat();
  assert.equal(count(),2);
  assert.equal(gaps().writeFailed,4);
  const archive = readdirSync(dir).find(name=>/^ledger\.sqlite\.corrupt-\d+$/.test(name))!;
  assert.equal(readFileSync(join(dir,archive),'utf8'),'synthetic damaged sqlite');
  const newer = new DatabaseSync(path);
  newer.prepare("UPDATE meta SET value='2' WHERE key='version'").run(); newer.close();
  await chat();
  assert.throws(count,/LEDGER_UPGRADE/);
  assert.equal(gaps().writeFailed,6);
  assert.equal(readdirSync(dir).filter(file=>file.includes('corrupt')).length,1);
  symlinkSync(join(dir,archive),path+'-wal');
  try { await chat(); assert.throws(count,/INVALID_LEDGER_FILE/); } finally { unlinkSync(path+'-wal'); }
  assert.equal(gaps().writeFailed,8);
});

test('估价按请求开始时的路由、版本和北京时间峰谷选择单价', () => {
  const at = Date.parse('2026-11-25T01:00:00Z');
  const counters = {inputTokens:1e6,outputTokens:1e6,cacheReadTokens:1e6,reasoningTokens:300};
  assert.deepEqual(priceCall(counters,'deepseek-official','deepseek-v4-pro',at),{yuan:36.3,missing:[]});
  assert.equal(priceCall(counters,'deepseek','deepseek-v4-pro',at-1).yuan,18.15);
  assert.deepEqual(priceCall({...counters,cacheWriteTokens:2},'deepseek','deepseek-flash',at),{yuan:10.04,missing:['缓存写']});
  assert.equal(priceCall(counters,'deepseek','deepseek-flash',0).yuan,null);
  assert.equal(priceCall(counters,'other','deepseek-flash',at).yuan,null);
  assert.equal(priceCall(counters,'deepseek','unknown-model',at).yuan,null);
});
