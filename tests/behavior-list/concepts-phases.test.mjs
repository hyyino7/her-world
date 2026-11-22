import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './fixture.mjs';
import {loadPlayback} from '../fixtures/playback.mjs';

const {resolveActivityPlayback}=await loadPlayback();

const phase = snapshot => snapshot.behavior.phase;

test('阅读的待取文、已取文和确认终态投影到身体与播放', async t => {
  const f = await fixture(t,{life:false});
  const title = '合成读物', text = '实际读取的合成段落。';
  const imported = await f.ownerAction({kind:'importReading',title,content:text,source:{name:'fixture'}},'import');
  const itemId = imported.catalog.find(item => item.name === title).id;
  await f.ownerAction({kind:'gift',itemId},'gift');
  const operationId = 'read', reading = {itemId,segment:0};
  const snapshot = () => f.body.snapshot('world');
  const presentation = ({behavior,home}) => [behavior.presentationKind,behavior.readingState,resolveActivityPlayback(home).kind];
  await f.body.startPlanned('world',{operationId,kind:'read',activity:title,reading});
  let current = await snapshot();
  assert.deepEqual(presentation(current),['reading-wait','unread','reading-wait']);
  assert.deepEqual([current.planned.status,current.planned.phase,phase(current)],['running','waiting','pending']);
  const offer = await f.body.readPlannedSegment('world',operationId);
  assert.equal(offer.text,text);
  const offered = await snapshot();
  assert.deepEqual(presentation(offered),['read','offered','read']);
  const confirmed = await f.body.confirmPlannedReading('world',operationId,offer.receiptToken);
  assert.deepEqual([confirmed.status,confirmed.phase],['completed','completed']);
  assert.equal(f.economy.gardenPort('world').readingStatus(operationId,reading).status,'confirmed');
  current = await snapshot();
  assert.deepEqual(presentation(current),[undefined,undefined,'idle']);
});

test('身体快照投影运行中执行阶段及独立身体阶段', async t => {
  const f = await fixture(t,{life:false});
  const path = join(f.repo,'.chatpet/data/life/home.json'), snapshot = () => f.body.snapshot('world');
  const base = JSON.parse(readFileSync(path,'utf8'));
  const restore = extra => f.restart(() => writeFileSync(path,JSON.stringify({...base,...extra})));
  assert.equal(phase(await snapshot()),'idle');
  await f.body.roomAction('world',{action:'poke'},'主人');
  assert.equal(phase(await snapshot()),'working');
  t.mock.timers.tick(7_000);
  assert.equal(phase(await snapshot()),'completed');
  await f.body.roomAction('world',{action:'command',room:'living',spot:'tv'},'主人');
  assert.equal(phase(await snapshot()),'moving');
  t.mock.timers.tick(10_000);
  assert.equal(phase(await snapshot()),'pending');
  await f.body.act('world','sleep','sleeping');
  t.mock.timers.tick(120_000);
  assert.equal(phase(await snapshot()),'sleeping');

  const pending = await f.body.startPlanned('world',{operationId:'garden',kind:'garden',activity:'巡视',garden:{type:'visit'}});
  assert.deepEqual([pending.status,pending.phase,phase(await snapshot())],['running','pending','pending']);
  await f.body.cancelPlanned('world',pending.operationId);
  await restore({
    kind:'tv',dwell:{until:Date.now()+30_000,target:{kind:'tv',room:'living',spot:'sofa',dwellMs:30_000}},
    companionAction:{id:'dwell',action:'command',startedAt:Date.now(),completedAt:0},
  });
  assert.equal(phase(await snapshot()),'working');

  await restore({});
  await f.body.startPlanned('world',{operationId:'hold',kind:'hold',activity:'休息'});
  let current = await snapshot();
  assert.deepEqual([current.planned.status,current.planned.phase,phase(current)],['running','working','working']);
  await f.body.cancelPlanned('world','hold');
  await f.body.startPlanned('world',{operationId:'sleep',kind:'body',activity:'睡觉',action:'sleep'});
  current = await snapshot();
  assert.deepEqual([current.planned.status,current.planned.phase,phase(current)],['running','moving','moving']);

  // 从磁盘验证投影对现有字段组合的处理。执行器正常结束时会同时写入终态。
  const operationId = 'legacy-phase';
  await restore({});
  const feed = await f.body.startPlanned('world',{operationId,kind:'body',activity:'喂食',action:'feed'});
  assert.deepEqual([feed.status,feed.phase],['completed','completed']);
  await f.restart(() => {
    const stored = JSON.parse(readFileSync(path,'utf8'));
    const row = stored.plannedExecutions[operationId];
    row.status = 'running';
    delete row.effectAppliedAt;
    stored.currentPlannedOperation = operationId;
    writeFileSync(path,JSON.stringify(stored));
  });
  current = await snapshot();
  assert.deepEqual([current.planned.status,current.planned.phase,phase(current)],['running','completed','pending']);
});
