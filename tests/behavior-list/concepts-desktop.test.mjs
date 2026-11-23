import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture, signal} from './fixture.mjs';

test('Desktop 动画入口按共享身体状态准入吃饭和睡醒素材', async t => {
  const f = await fixture(t, {platform:true,life:false});
  const platform = f.service('petPlatform');
  platform.ownerAccess('world');
  const request = (path, method = 'GET', body) => platform.handle(
    new URL('http://fixture.invalid/chatpet-presentation/'+path),method,JSON.stringify(body),signal());
  const {main:{bodyTemplate,animations}} = (await request('config')).obj;
  const configured = await request('config','PUT',{pets:[{...bodyTemplate,display:'web'}]});
  assert.equal(configured.status,200);
  const anim = (name,id) => request('anim?pet=main&surface=web','POST',{name,requestId:id});
  const state = () => f.body.roomState('world');
  const feeds = async () => (await f.body.pendingFacts('world')).filter(fact => fact.type === 'feed');
  const assertBusy = async id => {
    const {status,obj} = await anim('吃饭团',id);
    assert.equal(status,409);
    assert.deepEqual(obj,{ok:false,reason:'activity-busy',message:'当前活动进行中，请先完成或结束该活动'});
    assert.ok(!(await feeds()).some(fact => fact.requestId === id));
  };
  const settle = async () => { t.mock.timers.tick(13_000); await state(); };

  assert.equal((await state()).her.kind,'idle');
  assert.equal((await anim('吃饭团','idle-feed')).obj.ok,true);
  assert.equal((await state()).her.kind,'eat');
  const [first] = await feeds();
  assert.equal(first.requestId,'idle-feed');
  assert.equal((await anim('吃白饭','eating-feed')).obj.ok,true);
  assert.deepEqual(await feeds(),[first]);
  await settle();
  const physical = await anim('晨间刷牙','brush');
  assert.equal(physical.status,409);
  assert.deepEqual(physical.obj,{ok:false,reason:'activity-required',message:'请通过共享行为操作执行这项活动'});
  await f.body.act('world','water','drink');
  assert.equal((await state()).her.kind,'drink');
  await assertBusy('drinking-feed');
  await settle();

  for (const [action,kind] of [['pet','react_shy'],['poke','react_scare']]) {
    await f.body.roomAction('world',{action},'主人');
    const before = await state();
    assert.equal(before.her.kind,kind);
    assert.equal(before.presentation.action,'activity');
    assert.equal((await anim('吃饭团',kind)).obj.ok,true);
    assert.equal((await feeds()).at(-1).requestId,kind);
    await settle();
  }
  await f.body.roomAction('world',{action:'command',room:'her_room',spot:'bed'},'主人');
  const {her} = await state();
  assert.equal(her.walking,true);
  await assertBusy('walking-feed');
  t.mock.timers.tick(Math.ceil(her.etaMs)+1);
  assert.equal((await state()).her.walking,false);
  assert.equal((await anim('原地小憩沉眠','sleep-clip')).obj.accepted,true);
  assert.equal((await state()).her.asleep,true);
  await assertBusy('sleeping-feed');

  assert.equal((await anim('睡觉-起来','unlisted-wake')).obj.reason,'unknown-animation');
  assert.equal((await state()).her.asleep,true);
  const path = join(f.repo,'.chatpet/data/pet-platform/main-config.jsonc');
  const stored = JSON.parse(readFileSync(path,'utf8'));
  writeFileSync(path,JSON.stringify({...stored,animations:{...animations,idle:[...animations.idle,'睡觉-起来']}}));
  assert.equal((await anim('睡觉-起来','wake-clip')).obj.accepted,true);
  assert.equal((await state()).her.asleep,false);
  const facts = await f.body.pendingFacts('world');
  assert.deepEqual(facts.filter(fact => ['sleep','wake'].includes(fact.type)).map(fact => [fact.requestId,fact.type]),
    [['sleep-clip','sleep'],['wake-clip','wake']]);
});

test('公开身体快照的忙碌状态与 Desktop 吃饭准入一致', async t => {
  const f = await fixture(t, {platform:true,life:false});
  const platform = f.service('petPlatform');
  platform.ownerAccess('world');
  const request = (path, method = 'GET', body) => platform.handle(
    new URL('http://fixture.invalid/chatpet-presentation/'+path),method,JSON.stringify(body),signal());
  const {main:{bodyTemplate}} = (await request('config')).obj;
  assert.equal((await request('config','PUT',{pets:[{...bodyTemplate,display:'web'}]})).status,200);

  const snapshot = () => f.body.snapshot('world');
  const expectReceiptBusy = async (receipt, busy, hasHome = true) => {
    const {behavior} = await snapshot();
    assert.equal(behavior.busy, busy);
    assert.equal(receipt.behavior.busy, behavior.busy);
    assert.deepEqual(receipt.behavior.interruptibility, behavior.interruptibility);
    if (hasHome) assert.equal(receipt.home.behavior.busy, behavior.busy);
    else assert.equal('home' in receipt, false);
  };
  const expectAdmission = async (id, {kind, walking = false, asleep = false, busy}) => {
    const {home, behavior} = await snapshot();
    if (kind) assert.equal(home.her.kind, kind);
    assert.equal(home.her.walking, walking);
    assert.equal(home.her.asleep, asleep);
    assert.equal(behavior.busy, busy);
    assert.equal(behavior.interruptibility.feed, busy ? 'blocked' : 'start');
    assert.equal(home.behavior.busy, busy);
    assert.equal((await f.body.roomState('world')).behavior.busy, busy);
    const {status, obj} = await request('anim?pet=main&surface=web','POST',{name:'吃饭团',requestId:id});
    const facts = await f.body.pendingFacts('world');
    assert.equal(facts.some(fact => fact.requestId === id && fact.type === 'feed'), !busy);
    if (busy) {
      assert.equal(status, 409);
      assert.deepEqual(obj, {ok:false,reason:'activity-busy',message:'当前活动进行中，请先完成或结束该活动'});
    } else {
      assert.equal(status, 200);
      assert.equal(obj.ok, true);
    }
    return home.her;
  };

  await expectAdmission('idle-meal', {kind:'idle',busy:false});
  t.mock.timers.tick(13_000);
  await expectReceiptBusy(await f.body.act('world','water','drink'), true);
  await expectReceiptBusy(await f.body.garden('world','state'), true, false);
  await expectReceiptBusy(await f.body.garden('world','control',{type:'auto',enabled:false}), true);
  await expectAdmission('drinking-meal', {kind:'drink',busy:true});
  t.mock.timers.tick(13_000);
  await expectReceiptBusy(await f.body.roomAction('world',{action:'pet'},'主人'), false);
  await expectAdmission('reacting-meal', {kind:'react_shy',busy:false});
  t.mock.timers.tick(13_000);
  await f.body.roomAction('world',{action:'command',room:'her_room',spot:'bed'},'主人');
  const walking = await expectAdmission('walking-meal', {walking:true,busy:true});
  t.mock.timers.tick(Math.ceil(walking.etaMs)+1);
  assert.equal((await request('anim?pet=main&surface=web','POST',{name:'原地小憩沉眠'})).obj.accepted,true);
  await expectAdmission('sleeping-meal', {asleep:true,busy:true});
});
