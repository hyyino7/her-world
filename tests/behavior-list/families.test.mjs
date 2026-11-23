import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import {setTimeout as pause} from 'node:timers/promises';
import {fixture,ownerPlan,until} from './fixture.mjs';
import {cordisFixture,eventually,meal,submitPlan} from './entries-lifecycle.test.mjs';
import {readHearControlSource} from '../../dist/tests/behavior-list/entries.js';
import {cli,emptyWalletMigrationInputs,mockDsh} from '../migrate/helpers.mjs';
import {CONSOLE_WALLET_IMPORT_FILE,CONSOLE_WALLET_STEP} from '../../dist/src/core/storage-migration.js';
import {legacyEconomy} from '../migrate/offline-helpers.mjs';
import {legacyEconomyRows} from '../../scripts/migrate/steps/0003-economy-marker.mjs';

async function cursor(f,expected){await until(async()=>{await f.body.snapshot('world');return (await f.life.readPlan('world')).plan?.cursor===expected;},'计划自动推进到 '+expected);}

test('计划完成事件自动续行一次并跨重启保留',async t=>{
  const f=await fixture(t);await f.enable();
  const guest=await f.begin('guest');await assert.rejects(f.tool(guest,'life_plan_update',{expectedRevision:0,plan:{}}),/admitted|可用/);await f.end(guest);
  await ownerPlan(f,[{id:'one',kind:'hold',activity:'First wait',durationMinutes:1},{id:'two',kind:'hold',activity:'Second wait'}]);
  await until(async()=>!!(await f.life.readPlan('world')).plan?.operationId);
  const first=await f.life.readPlan('world'),firstId=first.plan.operationId;
  assert.equal(first.plan.cursor,0);const calls=f.sent.length;
  t.mock.timers.tick(61_000);await cursor(f,1);
  await until(async()=>!!(await f.life.readPlan('world')).plan?.operationId);
  const next=await f.life.readPlan('world'),nextId=next.plan.operationId;
  assert.notEqual(nextId,firstId);assert.equal((await f.body.inspectPlanned('world',firstId)).status,'completed');
  assert.equal((await f.body.inspectPlanned('world',nextId)).status,'running');
  for(let i=0;i<3;i++)await f.body.snapshot('world');
  assert.equal((await f.life.readPlan('world')).plan.operationId,nextId);assert.equal(f.sent.length,calls,'续行不要求额外模型请求');
  await f.restart();await until(()=>f.life.running());
  const restored=await f.life.readPlan('world');assert.equal(restored.plan.id,first.plan.id);assert.equal(restored.plan.cursor,1);assert.equal(restored.plan.operationId,nextId);
  const saved=JSON.parse(readFileSync(join(f.repo,'.chatpet/data/life/life.json'),'utf8'));assert.ok(saved.currentPlan);
});

test('插件入口种植暂停及重启均不倒退时钟',async t=>{
  const f=await fixture(t);await f.enable();
  // 新菜园没有种子；先按真实目录拨款，再由原生入口提交购买计划。
  const seed=(await f.economy.snapshot('world')).catalog.find(row=>row.id==='seed:radish');
  await f.ownerAction({kind:'grant',amount:seed.purchasePrice},'seed-money');
  await ownerPlan(f,[{id:'buy-seed',kind:'economy',activity:'Buy radish seed',economy:{type:'buy',itemId:seed.id,quantity:1}},{id:'ready',kind:'hold',activity:'Ready to plant'}]);
  await cursor(f,1);
  const purchased=await f.economy.snapshot('world');
  assert.equal(purchased.inventory.find(row=>row.itemId===seed.id).quantity,1);
  assert.equal(purchased.ledger.filter(row=>row.kind==='purchase').length,1);
  await ownerPlan(f,[{id:'till',kind:'garden',activity:'Till',garden:{type:'till',plotId:0}},{id:'plant',kind:'garden',activity:'Plant',garden:{type:'plant',plotId:0,cropId:'radish'}},{id:'hold',kind:'hold',activity:'Watch crops'}]);
  for(let i=0;i<6&&(await f.life.readPlan('world')).plan.cursor<2;i++){t.mock.timers.tick(120_000);await f.body.snapshot('world');await pause(15);}
  await cursor(f,2);
  const garden=()=>f.body.garden('world','state');
  const planted=(await garden()).garden.plots[0];assert.equal(planted.cropId,'radish');
  t.mock.timers.tick(3*3_600_000);await f.body.snapshot('world');const grown=(await garden()).garden.plots[0].progress;assert.ok(grown>0);
  await f.life.control('world',false);const frozen=(await garden()).garden.plots[0].progress;
  t.mock.timers.tick(8*3_600_000);await f.restart();assert.equal((await garden()).garden.plots[0].progress,frozen);
  await f.life.control('world',true);await f.body.setAutonomy('world',true);
  t.mock.timers.tick(24*3_600_000);await f.body.snapshot('world');const mature=(await garden()).garden.plots[0];
  assert.equal(mature.progress,1);assert.equal(mature.mature,true);
  await f.restart();assert.equal((await garden()).garden.plots[0].progress,1);assert.equal((await garden()).garden.plots[0].mature,true);
  assert.ok(existsSync(join(f.repo,'.chatpet/data/economy/economy.sqlite')));
});

test('自主回顾跨日重启续原日期且主人补写不能覆盖历史',async t=>{
  // 使用宿主本地的回顾前一分钟，不依赖运行环境的 UTC 偏移。
  const f=await fixture(t,{now:new Date(2026,10,15,22,59).toISOString()});await f.enable();
  await ownerPlan(f,[]);
  const preferences=(await f.life.snapshot('world')).preferences;
  await f.life.settings('world',preferences,{...preferences,review:'23:00'});
  t.mock.timers.tick(61_000);await f.restart();
  await until(()=>f.agent('home').inbox.nextStep.some(message=>message.source?.purpose==='review'),'自主回顾到达原生入口');
  const first=f.agent('home').inbox.nextStep.find(message=>message.source?.purpose==='review'),day=first.source.reviewDay;
  const failed=await f.begin('home',first);
  await assert.rejects(f.tool(failed,'bash',{}),/restriction|自主回顾/);
  await f.end(failed,'aborted');
  t.mock.timers.tick(24*3_600_000);await f.restart();
  await until(()=>f.agent('home').inbox.nextStep.some(message=>message.source?.reviewDay===day),'跨日恢复原日期');
  const retry=f.agent('home').inbox.nextStep.find(message=>message.source?.reviewDay===day);
  const review=await f.begin('home',retry),path=join(f.repo,'.chatpet/diary',day+'.md');
  await f.tool(review,'write',{file_path:path,content:'Synthetic autonomous diary.'});await f.end(review);
  assert.equal(readFileSync(path,'utf8'),'Synthetic autonomous diary.');
  const owner=await f.begin();await assert.rejects(f.tool(owner,'write',{file_path:path,content:'Overwrite'}),/已经合上|存在|覆盖/);await f.end(owner);
  // 当天的回顾再次失败，留给第二天的主人聊天补写。
  // 旧日期完成后，后续日期有一分钟间隔；只伪造 Date，重启重建到期闹钟。
  t.mock.timers.tick(61_000);await f.restart();
  await until(()=>f.agent('home').inbox.nextStep.some(message=>message.source?.purpose==='review'&&message.source.reviewDay!==day),'当天回顾独立到达');
  const today=f.agent('home').inbox.nextStep.find(message=>message.source?.purpose==='review'&&message.source.reviewDay!==day);
  await f.end(await f.begin('home',today),'aborted');
  t.mock.timers.tick(3*3_600_000);await f.restart();
  const backfill=await f.begin(),historical=join(f.repo,'.chatpet/diary',today.source.reviewDay+'.md');
  await f.tool(backfill,'write',{file_path:historical,content:'Synthetic owner backfill.'});
  await assert.rejects(f.tool(backfill,'write',{file_path:historical,content:'Overwrite'}),/已经合上|存在|覆盖/);await f.end(backfill);
  assert.equal(readFileSync(historical,'utf8'),'Synthetic owner backfill.');
  await f.restart();assert.equal(readFileSync(path,'utf8'),'Synthetic autonomous diary.');
  assert.equal((await f.life.snapshot('world')).life.pendingReviews?.some(row=>row.day===today.source.reviewDay),false);
});

test('语音插件关闭取消识别并拒绝晚到音频和结果',async t=>{
  let finish,captured,calls=0;
  const recognizer={listProviders:()=>['synthetic'],resolve:input=>input,
    transcribe(_input,signal){captured=signal;calls++;return new Promise(resolve=>{finish=resolve;});}};
  const f=await fixture(t,{recognizer,life:false,economy:false});
  const source=readHearControlSource(),from=source.indexOf('function createHearControl(opts) {'),to=source.indexOf('\n//#endregion',from);
  assert.ok(from>=0&&to>from);
  let grant,finishRecording,intervals=0;
  const input={isConnected:true,value:'',selectionStart:0,selectionEnd:0,focus(){},blur(){},setSelectionRange(){}};
  const voiceTable=f.host.native.voiceTable, scope=f.agent('home').ctx.root;
  const factory=vm.runInNewContext(source.slice(from,to)+'\ncreateHearControl',{
    AbortController,document:{activeElement:null},window:{setInterval(){intervals++;return 1;},clearInterval(){intervals=0;}},canRecord:()=>true,
    startRecording:()=>new Promise(resolve=>{grant=()=>resolve({elapsedMs:()=>500,cancel(){},stop:()=>new Promise(ok=>{finishRecording=ok;})});}),
    hearAudio:async(_url,_audio,signal)=>{
      const voice=voiceTable.lookup(scope,signal);
      assert.ok(voice);
      const result=await voice.handle({rest:'voice/hear',method:'POST',body:JSON.stringify({audio:'AQI='})});
      return result.obj;
    },
    toBase64:()=> 'AQI=',MIN_RECORD_MS:100,MAX_RECORD_MS:24000,SILENCE_PEAK:.1});
  const control=()=>factory({micBtn:{dataset:{},addEventListener(){}},input,hint:{show(){},hide(){},flash(){}},resizeInput(){},hearUrl:'fixture://voice'});
  const first=control();first.start();grant();await pause(1);first.stop();finishRecording({peak:1,wave:new ArrayBuffer(0)});
  await until(()=>calls===1);finish({text:'Synthetic recognized input'});await until(()=>!!input.value);
  await f.end(await f.begin('home',{id:'spoken',role:'user',source:{kind:'user'},content:[{type:'text',text:input.value}]}));first.dispose();input.value='';
  const second=control();second.start();grant();await pause(1);second.stop();finishRecording({peak:1,wave:new ArrayBuffer(0)});
  await until(()=>calls===2);assert.equal(captured.aborted,false);second.dispose();assert.equal(captured.aborted,true,'控件关闭取消在途识别');
  finish({text:'Late control result must not be used'});await pause(5);assert.equal(input.value,'');assert.equal(intervals,0);
  // 控件保持存活，由假宿主执行插件 effect 清理；不能先由控件取消请求。
  const third=control();third.start();grant();await pause(1);third.stop();finishRecording({peak:1,wave:new ArrayBuffer(0)});
  await until(()=>calls===3);assert.equal(captured.aborted,false);await f.restart();assert.equal(captured.aborted,true,'插件卸载必须经 effect 取消在途识别');
  finish({text:'Late plugin result must not be used'});await pause(5);assert.equal(input.value,'');assert.equal(intervals,0);third.dispose();
  const late=control();late.start();late.dispose();grant();await pause(5);assert.equal(calls,3);assert.equal(input.value,'');
  await f.restart();const events=JSON.parse(readFileSync(f.logFile('home'),'utf8'));
  assert.equal(events.filter(event=>event.type==='user/message'&&event.data.id==='spoken').length,1);
  assert.ok(!JSON.stringify(events).includes('Late control result must not be used'));
  assert.ok(!JSON.stringify(events).includes('Late plugin result must not be used'));
});

function stoppedHomeMigration(f) {
  const {config} = f.core.workspace.runtime, storageId = f.core.workspace.storageId();
  const data = join(f.repo,'.chatpet/data'), home = join(dirname(f.repo),'migration-dsh');
  const profileDir = join(home,'profiles','fixture'), installation = join(home,'installation.json');
  const sessionIds = [...f.bound.sessionIds], archivedSessionIds = [...f.registry.archivedSessionIds];
  const put = (file,object) => { mkdirSync(dirname(file),{recursive:true}); writeFileSync(file,JSON.stringify(object)); };
  return () => {
    const mirrorFile = join(data,'life/life.json'), mirror = readFileSync(mirrorFile);
    const {homeSessionId} = JSON.parse(mirror);
    {
      using db = new DatabaseSync(join(config.dataDir,'core.sqlite'));
      const result = db.prepare("DELETE FROM records WHERE kind='companion-home' AND id=?").run(storageId);
      assert.equal(result.changes,1);
    }
    legacyEconomy({config,storageId,data,repo:f.repo});
    rmSync(join(data,'storage-manifest.json'));
    rmSync(join(data,CONSOLE_WALLET_IMPORT_FILE));
    put(join(profileDir,'node_modules/her-world/package.json'),{name:'her-world',version:'0.2.0'});
    put(join(home,'storages/workspace.json'),{unit:{name:'workspace',version:1},global:{workspaceIds:[f.id],archivedSessionIds},
      tables:{workspaces:{[f.id]:{path:f.repo,title:'Fixture',sessionIds}}}});
    put(installation,{status:'installed',packageInstalled:true,profileDir,config});
    const {walletExport,walletRollback} = emptyWalletMigrationInputs({
      config,storageId,installation,home,repo:f.repo,out:home,profile:profileDir,target:{id:f.id},
    });
    const result = cli({home},['run','--installation',installation,'--backup',join(home,'backup'),
      '--wallet-export',walletExport,'--wallet-rollback',walletRollback]);
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).steps,[
      {id:'0001-storage-manifest',state:'complete'}, {id:'0002-home-identity',state:'complete'}, {id:'0003-economy-marker',state:'complete'},
      {id:CONSOLE_WALLET_STEP.id,state:'complete'},
    ]);
    assert.deepEqual(readFileSync(mirrorFile),mirror);
    using db = new DatabaseSync(join(config.dataDir,'core.sqlite'),{readOnly:true});
    assert.deepEqual(legacyEconomyRows(db),[]);
    assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM records WHERE kind='companion-home' AND id=?").get(storageId).value),
      {sessionId:homeSessionId});
  };
}

async function runG9(t, migrate = false) {
  const f=await cordisFixture(t);
  await f.ownerAction({kind:'gift',itemId:meal},'plan-meal');
  const hungerBefore=(await f.body.snapshot(f.id)).needs.hunger;
  const databasePath=join(f.repo,'.chatpet/data/economy/economy.sqlite');
  const sql=statement=>{
    const db=new DatabaseSync(databasePath);
    try {db.exec(statement);} finally {db.close();}
  };
  sql("CREATE TRIGGER reject_consumption BEFORE UPDATE ON uses WHEN json_extract(NEW.value,'$.status')='consumed' BEGIN SELECT RAISE(ABORT,'injected settlement write failure'); END");
  let submitted;
  f.model=async call=>{
    if (call.messages.some(message=>message.source.kind==='dsh-world-life')) {
      assert.equal(submitted,undefined,'自动续行不要求第二次模型规划');
      submitted=await submitPlan(call,[
        {id:'meal',kind:'economy',activity:'Eat the gifted meal',economy:{type:'consume',itemId:meal,quantity:1}},
        {id:'rest',kind:'hold',activity:'Rest after the meal'},
      ]);
    }
    return 'Plan accepted';
  };
  await f.enable();
  const homeId=await eventually(()=>f.life.homeSessionId(),'生活打开共享 home');
  const {agent:home}=await f.ctx.sessionController.resolveAgent(homeId);
  assert.ok(home);
  const plan=await eventually(async()=>{
    const {plan}=await f.life.readPlan(f.id);
    return plan?.operationId && (await f.economy.snapshot(f.id)).pendingUses.some(row=>row.opId===plan.operationId) && plan;
  },'餐食已预留并保留原执行编号');
  await home.whenIdle();
  assert.equal(plan.cursor,0);
  const checkpoint=()=>JSON.parse(readFileSync(join(f.directory,'home.json'),'utf8'));
  const applied=checkpoint().plannedExecutions[plan.operationId], hunger=checkpoint().needs.hunger;
  assert.ok(applied.effectAppliedAt);
  assert.ok(hunger<hungerBefore);
  const countUsed=snapshot=>snapshot.ledger.filter(row=>row.kind==='use-consume').length;
  const quantity=snapshot=>snapshot.inventory.find(row=>row.itemId===meal).quantity;
  const before=await f.economy.snapshot(f.id);
  assert.equal(before.pendingUses[0].status,'reserved');
  assert.equal(countUsed(before),0);
  assert.equal(quantity(before),1);
  const blocked=await f.body.inspectPlanned(f.id,plan.operationId);
  assert.equal(blocked.status,'running');
  assert.equal(blocked.phase,'waiting');
  assert.match(blocked.reason,/injected settlement write failure/);
  const native=f.saved(home.id).events;
  assert.ok(native.some(event=>event.type==='user/message'&&event.data.source.kind==='dsh-world-life'));
  assert.ok(native.some(event=>event.type==='tool/call'&&event.data.name==='life_plan_update'));

  if (migrate) mockDsh(t);
  const migrateHome = migrate ? stoppedHomeMigration(f) : undefined;
  await f.restart(()=>{
    assert.equal(checkpoint().plannedExecutions[plan.operationId].effectAppliedAt,applied.effectAppliedAt);
    sql('DROP TRIGGER reject_consumption');
    migrateHome?.();
  });
  const next=await eventually(async()=>{
    const {plan}=await f.life.readPlan(f.id);
    return plan?.cursor===1 && plan.operationId && (await f.body.inspectPlanned(f.id,plan.operationId))?.status==='running' && plan;
  },'无需新模型调用即续行下一步骤');
  assert.equal(next.id,plan.id);
  assert.notEqual(next.operationId,plan.operationId);
  assert.equal((await f.body.inspectPlanned(f.id,plan.operationId)).status,'completed');
  const after=await f.economy.snapshot(f.id);
  assert.deepEqual(after.pendingUses,[]);
  assert.equal(quantity(after),0);
  assert.equal(countUsed(after),1);
  assert.equal(after.ledger.find(row=>row.kind==='use-consume').requestId,plan.operationId);
  assert.equal(await eventually(()=>f.life.homeSessionId(),'生活恢复原 home'),home.id);
  assert.deepEqual(f.sessionCreateCalls,[home.id]);
  assert.equal((await f.body.snapshot(f.id)).needs.hunger,hunger);
  assert.equal(checkpoint().plannedExecutions[plan.operationId].effectAppliedAt,applied.effectAppliedAt);
  assert.equal(f.calls.filter(call=>call.messages.some(message=>message.source.kind==='dsh-world-life')).length,1);
}
test('Life 原生计划在身体效果落盘后跨重启只结算一次并自动续行', t=>runG9(t));
test('4 在同一合成绑定迁移 home 后复跑 G9 原断言', t=>runG9(t,true));

test('Life 原生睡眠计划从移动到睡眠并跨重启保留完成回执', async t => {
  const f = await cordisFixture(t);
  let submitted = false;
  f.model = async call => {
    if (!submitted && call.messages.some(message => message.source.kind === 'dsh-world-life')) {
      submitted = true;
      await submitPlan(call,[{id:'sleep',kind:'body',activity:'去床上睡觉',action:'sleep'}]);
    }
    return 'Synthetic model response';
  };
  await f.enable();
  const homeId = await eventually(() => f.life.homeSessionId(),'生活打开共享 home');
  const moving = await eventually(async () => {
    const {plan} = await f.life.readPlan(f.id);
    const snapshot = await f.body.snapshot(f.id);
    return plan?.operationId && snapshot.planned?.operationId === plan.operationId &&
      snapshot.planned.phase === 'moving' && snapshot;
  },'睡眠步骤已派发且身体在移动');
  const {operationId} = moving.planned;
  assert.equal(moving.behavior.phase,'moving');
  assert.equal(moving.behavior.activityId,operationId);
  await (await f.agent(homeId)).whenIdle();
  assert.ok(f.saved(homeId).events.some(event => event.type === 'tool/call' && event.data.name === 'life_plan_update'));
  t.mock.timers.tick(120_000);
  const sleeping = await f.body.snapshot(f.id);
  assert.equal(sleeping.behavior.phase,'sleeping');
  const completed = await f.body.inspectPlanned(f.id,operationId);
  assert.deepEqual([completed.status,completed.phase],['completed','completed']);
  await f.restart();
  assert.equal((await f.body.snapshot(f.id)).behavior.phase,'sleeping');
  assert.deepEqual(await f.body.inspectPlanned(f.id,operationId),completed);
});
