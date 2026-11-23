import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {compiledURL} from '../fixtures/playback.mjs';
import {syncBuiltinESMExports} from 'node:module';
import childProcess from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

const forbidden=[],restore=[];
function block(object,key) {
  const prior=object[key];restore.push(()=>{object[key]=prior;});
  object[key]=()=>{forbidden.push(key);throw Error('Forbidden test app/network operation: '+key);};
}
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])block(childProcess,key);
for(const [object,keys] of [[net,['connect','createConnection']],[net.Socket.prototype,['connect']],
  [net.Server.prototype,['listen']],[http,['request','get']],[https,['request','get']],[tls,['connect']],[globalThis,['fetch']]])
  for(const key of keys)block(object,key);
syncBuiltinESMExports();
after(()=>{for(const undo of restore.reverse())undo();syncBuiltinESMExports();assert.deepEqual(forbidden,[]);});

const {createCore}=await import(compiledURL('core/index.js'));
const {CompanionBehavior}=await import(compiledURL('living/body/plugin.js'));
const {CompanionEconomy}=await import(compiledURL('living/economy/plugin.js'));
const {PersistentLifePlan}=await import(compiledURL('living/plan/plan.js'));
const {Room}=await import(compiledURL('room/plugin.js'));
const {digest}=await import(compiledURL('core/storage.js'));
const value=result=>{assert.equal(result.ok,true,JSON.stringify(result.error));return result.value;};

async function fixture(t,{mode='awake',tilled=false,money=0}={}) {
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'refused-movement-'))),repo=join(root,'workspace');fs.mkdirSync(repo);
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-14T05:00:00Z')});
  const config={dataDir:join(root,'device-core'),companionId:'fish',scopeId:'owner',ownerActorId:'owner',displayName:'Fixture',character:'A continuing companion.'};
  let host=createCore(config),body,economy,room;
  const previous=value(await host.services.preferences.read(host.operator.request('preferences'),{}));
  const bound=value(await host.services.preferences.save(host.operator.request('bind'),{expectedRevision:previous.revision,
    workspace:{id:'workspace',path:repo,title:'Disposable test workspace'},conversation:previous.conversation}));
  value(await host.services.workspace.initialize(host.operator.request('initialize'),{expectedPreferencesRevision:bound.revision}));
  const services=new Map(),listeners=new Map(),logger=Object.assign(()=>logger,{warn(){},info(){},error(){}});
  const ctx={get petCore(){return host;},get petBehavior(){return body;},get:name=>services.get(name),
    on(name,receive){const rows=listeners.get(name)??new Set();listeners.set(name,rows);rows.add(receive);return()=>rows.delete(receive);},
    emit(name,...args){for(const receive of listeners.get(name)??[])receive(...args);},logger};
  services.set('petLife',{running:()=>true,bodyClockState:()=>({enabled:true,restoreElapsed:false})});
  const start=()=>{
    economy=new CompanionEconomy(ctx,host,{body:()=>body,plan:()=>services.get('petLife')});services.set('petEconomy',economy);
    body=new CompanionBehavior(ctx,host,{economy:()=>economy,plan:()=>services.get('petLife')});services.set('petBehavior',body);room=new Room(ctx);
  };start();
  const signal=new AbortController().signal;
  const request=(endpoint,input,id)=>room.request('workspace',endpoint,input,id,signal);
  const garden=()=>economy.gardenPort('workspace').loadGarden(Date.now(),{enabled:true});
  const store=()=>economy.prepare(host.workspace.status().target);
  if(money)await economy.ownerAction('workspace',{kind:'grant',amount:money},'fixture-money',signal);
  if(tilled)assert.equal(store().applyGarden({type:'till',plotId:0},'fixture-till',Date.now()).ok,true);
  await body.roomState('workspace');
  if(mode==='sleep') {
    await body.startPlanned('workspace',{operationId:'fixture-nap',kind:'body',activity:'Actual sleep',action:'sleep',presentationSlot:'sleep.nap'});
    const moving=await body.roomState('workspace');t.mock.timers.setTime(Date.now()+Math.ceil(moving.her.etaMs)+1);await body.roomState('workspace');
    assert.equal(body.binding.room.state.asleep,true);
  }
  const homeFile=body.binding.room.homeFile,directory=dirname(homeFile);
  const plan=new PersistentLifePlan(directory,'fish',host.workspace.storageId(),'UTC');
  const steps=mode==='travel'?[{id:'sleep',kind:'body',activity:'Go to sleep',action:'sleep'}]:mode==='garden'?
    [{id:'garden',kind:'garden',activity:'Till the first plot',garden:{type:'till',plotId:0}}]:
    [{id:'wait',kind:'hold',activity:'Continue the accepted wait',durationMinutes:60},{id:'next',kind:'body',activity:'Continue the next accepted step',action:mode==='sleep'?'wake':'water'}];
  await plan.commit(0,{goal:'Continue the accepted intention',reason:'A rejected action must not change it',steps,nextConsiderAt:null});await plan.advance('workspace',body);await body.roomState('workspace');body.binding.room.flush();
  const state=()=>body.binding.room.state;
  const capture=()=>({state:structuredClone(state()),plan:plan.read(),garden:garden(),economy:store().snapshot(),ledger:store().ledger()});
  t.after(async()=>{await room.close();await body.close();economy.close();await host.close();fs.rmSync(root,{recursive:true,force:true});assert.deepEqual(forbidden,[]);});
  return {ctx,signal,plan,request,garden,store,capture,state,get host(){return host;},get body(){return body;},get room(){return room;},get economy(){return economy;},
    async reopenRoom(){await room.close();room=new Room(ctx);},
    async reopen(){await room.close();await body.close();economy.close();await host.close();host=createCore(config);start();await body.roomState('workspace');},
    async replaceWithHold(thenWater=false){await plan.control(plan.read().revision,'cancel','Owner selected a later activity',body,'workspace');
      await plan.commit(plan.read().revision,{goal:'A later accepted rest',reason:'An old receipt is not a new command',steps:[{id:'later',kind:'hold',activity:'Later rest',durationMinutes:60},
        ...(thenWater?[{id:'water',kind:'body',activity:'Drink after the accepted wait',action:'water'}]:[])],nextConsiderAt:null},body,'workspace');
      await plan.advance('workspace',body);await body.roomState('workspace');body.binding.room.flush();},
    async finishWait(){const end=Date.parse(plan.read().plan.dispatchUntil);t.mock.timers.setTime(end+1);await body.roomState('workspace');await plan.advance('workspace',body);await plan.advance('workspace',body);},
    async finishGarden(){for(let pass=0;pass<12;pass++) {const current=garden();if(!current.care.task && !current.care.queue.some(job=>!job.pausedAt))return current;
      const h=state(),at=h.route?.arriveAt??h.dwell?.until??current.care.nextPlanAt;assert.ok(Number.isFinite(at));t.mock.timers.setTime(Math.max(Date.now()+1,Math.ceil(at)+1));await body.roomState('workspace');}assert.fail('Accepted garden work did not finish');},
  };
}

function unchanged(f,before) {
  for(const key of ['kind','activity','room','spot','freePos','needs','counts','asleep','sleepPending','sleepStartedAt','route','dwell','command','freeTarget','companionAction','currentPlannedOperation','interactionReturn','plannedExecutions'])
    assert.deepEqual(f.state()[key],before.state[key],key);
  assert.deepEqual(f.plan.read(),before.plan);assert.deepEqual(f.store().snapshot(),before.economy);assert.deepEqual(f.store().ledger(),before.ledger);
  const now=f.garden();for(const key of ['plots','seeds','coins','compost','inventory','care','stats','log'])assert.deepEqual(now[key],before.garden[key],'garden '+key);
}

for(const action of ['go','place'])test('sleeping '+action+' refusal keeps the real sleep wait and its queued wake through replay and full restart',async t=>{
  const f=await fixture(t,{mode:'sleep'}),input={action,pos:[6.3,5.1]},before=f.capture();
  const refused=await f.request('roomAction',input,'sleep-movement');assert.equal(refused.changed,false);assert.equal(refused.fact.result.status,'unchanged');
  assert.deepEqual(refused.fact.actor,{kind:'owner',id:'owner',channel:'room'});assert.deepEqual(refused.fact.result.before,refused.fact.result.after);unchanged(f,before);
  await f.plan.advance('workspace',f.body);assert.equal(f.plan.read().plan.status,'active');
  assert.deepEqual((await f.request('roomAction',input,'sleep-movement')).fact,refused.fact);await f.reopen();
  assert.deepEqual((await f.request('roomAction',input,'sleep-movement')).fact,refused.fact);assert.equal(f.state().asleep,true);assert.equal(f.plan.read().plan.status,'active');
  await f.finishWait();assert.equal(f.state().asleep,false);assert.equal(f.plan.read().plan.cursor,2);assert.equal(f.plan.read().plan.status,'waiting');
  const wakeEvents=f.state().eventLog.filter(event=>event.type==='wake').length;
  const after=f.capture();assert.equal((await f.request('roomAction',input,'sleep-movement')).changed,false);unchanged(f,after);
  assert.equal(f.state().eventLog.filter(event=>event.type==='wake').length,wakeEvents);
});

for(const [action,pos] of [['go',[9999,9999]],['place',[9999,9999]],['place',[]]])test('awake rejected '+action+' '+JSON.stringify(pos)+' preserves accepted work and native source attribution',async t=>{
  const f=await fixture(t),before=f.capture(),input={action,pos,actor:{kind:'system',id:'forged'}};
  const refused=await f.request('roomAction',input,'invalid-movement');assert.equal(refused.changed,false);assert.deepEqual(refused.fact.actor,{kind:'owner',id:'owner',channel:'room'});unchanged(f,before);
  await f.plan.advance('workspace',f.body);assert.equal(f.plan.read().plan.status,'active');
  await assert.rejects(f.request('roomAction',{...input,pos:[6.3,5.1]},'invalid-movement'));
  await assert.rejects(f.body.roomAction('workspace',{action:'go',pos:[6.3,5.1]},'大肥鱼',{requestId:'companion-move',actor:{kind:'companion',id:'fish',channel:'dsh'}}));unchanged(f,before);
});

for(const action of ['go','place'])test('invalid '+action+' during an accepted sleep trip does not park the route or prevent arrival',async t=>{
  const f=await fixture(t,{mode:'travel'}),before=f.capture();assert.equal(f.state().sleepPending,true);assert.ok(f.state().route);
  assert.equal((await f.request('roomAction',{action,pos:[9999,9999]},'invalid-trip')).changed,false);unchanged(f,before);
  t.mock.timers.setTime(Math.ceil(f.state().route.arriveAt)+1);await f.body.roomState('workspace');await f.plan.advance('workspace',f.body);
  assert.equal(f.state().asleep,true);assert.equal(f.plan.read().plan.cursor,1);assert.equal(f.plan.read().plan.status,'waiting');
});

for(const action of ['go','place'])test('accepted '+action+' still interrupts once and cannot overwrite its saved interruption receipt with the preview',async t=>{
  const f=await fixture(t),before=f.capture(),id=before.plan.plan.operationId,input={action,pos:[6.3,5.1]};
  const accepted=await f.request('roomAction',input,'valid-movement');assert.equal(accepted.changed,true);assert.equal(accepted.fact.result.status,'completed');
  assert.equal(f.state().plannedExecutions[id].status,'interrupted');assert.ok(f.state().plannedExecutions[id].parkedAt);assert.equal(f.state().dwell?.target?.plannedOperationId,undefined);
  await f.plan.advance('workspace',f.body);assert.equal(f.plan.read().plan.status,'paused');const after=f.capture();
  assert.deepEqual((await f.request('roomAction',input,'valid-movement')).fact,accepted.fact);unchanged(f,after);assert.deepEqual(f.store().snapshot(),before.economy);
});

const rejectedGarden=[
  {name:'unprepared soil',input:{type:'plant',plotId:0,cropId:'radish'},pattern:/松土/},
  {name:'no seeds',input:{type:'plant',plotId:0,cropId:'radish'},tilled:true,pattern:/种子/},
  {name:'no money',input:{type:'buySeed',cropId:'radish',quantity:1},pattern:/金币/},
  {name:'invalid plot',input:{type:'till',plotId:99},pattern:/田地/},
];
for(const endpoint of ['roomPlant','roomCare'])for(const scenario of rejectedGarden)test(endpoint+' refuses '+scenario.name+' without interrupting the real plan, including repeated delivery',async t=>{
  const f=await fixture(t,{tilled:scenario.tilled}),before=f.capture(),result=await f.request(endpoint,scenario.input,'refused-garden');
  assert.equal(result.ok,false);assert.match(result.message,scenario.pattern);unchanged(f,before);await f.plan.advance('workspace',f.body);assert.equal(f.plan.read().plan.status,'active');
  assert.deepEqual(await f.request(endpoint,scenario.input,'refused-garden'),result);unchanged(f,before);await f.reopen();
  assert.equal((await f.request(endpoint,scenario.input,'refused-garden')).ok,false);assert.equal(f.plan.read().plan.status,'active');
});

for(const endpoint of ['roomPlant','roomCare'])test(endpoint+' refusal retains an already accepted physical garden job and its current plan',async t=>{
  const f=await fixture(t,{mode:'garden'}),before=f.capture();assert.ok(before.garden.care.task);assert.ok(before.state.route?.target?.gardenJobId);
  const refused=await f.request(endpoint,{type:'plant',plotId:1,cropId:'radish'},'garden-while-busy');assert.equal(refused.ok,false);unchanged(f,before);
});

test('careNow force rejected by an existing different receipt cannot resume the original paused garden plan',async t=>{
  const f=await fixture(t,{mode:'garden'}),operation=f.plan.read().plan.operationId;
  await f.request('roomCare',{type:'pause',requestId:operation},'pause-original');await f.plan.advance('workspace',f.body);
  assert.equal(f.plan.read().plan.status,'paused');await f.request('roomCare',{type:'auto',enabled:false},'conflicting-care');await f.reopenRoom();
  const before=f.capture(),refused=await f.request('roomCare',{type:'careNow',decision:'force'},'conflicting-care');assert.equal(refused.ok,false);assert.match(refused.message,/相同请求/);unchanged(f,before);
});

test('a rejected control of a nonexistent garden task cannot pause a separate hold',async t=>{
  const f=await fixture(t),before=f.capture(),result=await f.request('roomCare',{type:'cancel',requestId:'missing-original'},'cancel-missing');
  assert.equal(result.ok,false);unchanged(f,before);
});

test('accepted direct garden purchase interrupts once and commits the original economic action only once',async t=>{
  const f=await fixture(t,{money:100}),before=f.capture(),input={type:'buySeed',cropId:'radish',quantity:2};
  assert.equal((await f.request('roomPlant',input,'valid-purchase')).ok,true);assert.equal(f.state().plannedExecutions[before.plan.plan.operationId].status,'interrupted');
  const after=f.capture(),key=digest(['workspace',f.host.workspace.storageId(),'roomPlant','valid-purchase']);
  assert.equal(after.ledger.items.filter(row=>row.requestId===key).length,1);assert.equal(after.garden.seeds.radish-before.garden.seeds.radish,2);
  await f.request('roomPlant',input,'valid-purchase');assert.deepEqual(f.store().snapshot(),after.economy);assert.deepEqual(f.store().ledger(),after.ledger);
});

test('accepted caretaker work interrupts the hold, retains its new physical route and settles one seed purchase',async t=>{
  const f=await fixture(t,{money:100}),before=f.capture(),input={type:'buySeed',cropId:'radish',quantity:1};
  const accepted=await f.request('roomCare',input,'valid-care');assert.equal(accepted.ok,true);assert.equal(accepted.accepted,true);
  assert.equal(f.state().plannedExecutions[before.plan.plan.operationId].status,'interrupted');assert.ok(f.state().route?.target?.gardenJobId);
  await f.finishGarden();assert.equal(f.garden().seeds.radish-before.garden.seeds.radish,1);
  const after=f.capture();await f.request('roomCare',input,'valid-care');assert.deepEqual(f.store().snapshot(),after.economy);assert.deepEqual(f.store().ledger(),after.ledger);
});

test('force care resumes the original paused garden row after the original caretaker admits it, without duplicating the job',async t=>{
  const f=await fixture(t,{mode:'garden'}),operation=f.plan.read().plan.operationId;
  await f.request('roomCare',{type:'pause',requestId:operation},'pause-original');assert.equal(f.state().plannedExecutions[operation].status,'paused');
  const receiptBefore=f.garden().care.receipts.find(row=>row.requestId===operation),result=await f.request('roomCare',{type:'careNow',decision:'force'},'resume-care');
  assert.equal(result.ok,true);assert.equal(f.state().plannedExecutions[operation].status,'running');
  const receipt=f.garden().care.receipts.find(row=>row.requestId===operation);assert.equal(receipt.jobId,receiptBefore.jobId);
  assert.equal([f.garden().care.task,...f.garden().care.queue].filter(job=>job?.id===receipt.jobId).length,1);
});

for(const endpoint of ['roomPlant','roomCare'])test(endpoint+' completed request replay after restart cannot interrupt a later accepted plan or spend twice',async t=>{
  const f=await fixture(t,{money:100}),input={type:'buySeed',cropId:'radish',quantity:1};
  assert.equal((await f.request(endpoint,input,'completed-old-request')).ok,true);if(endpoint==='roomCare')await f.finishGarden();
  await f.replaceWithHold();await f.reopen();const before=f.capture();
  assert.equal((await f.request(endpoint,input,'completed-old-request')).ok,true);unchanged(f,before);
});

for(const type of ['pause','resume','cancel'])test('historical completed caretaker '+type+' after full restart preserves a later hold and its actual next water step',async t=>{
  const f=await fixture(t),historicalId='historical-completed-till';
  assert.equal((await f.request('roomCare',{type:'till',plotId:0},historicalId)).ok,true);await f.finishGarden();
  const requestId=digest(['workspace',f.host.workspace.storageId(),'roomCare',historicalId]);
  assert.equal(f.garden().care.receipts.find(row=>row.requestId===requestId).status,'completed');
  await f.replaceWithHold(true);await f.reopen();const before=f.capture(),at=Date.now(),sample=f.state().lastTickAt;
  const result=await f.request('roomCare',{type,requestId},'historical-'+type);
  assert.equal(result.ok,true);assert.equal(result.status,'completed');assert.notEqual(result.accepted,true);
  unchanged(f,before);assert.equal(Date.now(),at);assert.equal(f.state().lastTickAt,sample);
  await f.plan.advance('workspace',f.body);assert.equal(f.plan.read().plan.status,'active');
  const water=f.state().counts.water;await f.finishWait();
  assert.equal(f.plan.read().plan.cursor,2);assert.equal(f.plan.read().plan.status,'waiting');assert.equal(f.state().counts.water,water+1);
  assert.deepEqual(f.store().ledger(),before.ledger);
});

for(const owner of ['caretaker','body-row'])test('live '+owner+' garden pause/resume/cancel remain effective once on the original job',async t=>{
  const f=await fixture(t,{mode:owner==='body-row'?'garden':'awake'});
  let requestId;
  if(owner==='body-row')requestId=f.plan.read().plan.operationId;
  else {await f.request('roomCare',{type:'till',plotId:0},'live-owner-job');requestId=digest(['workspace',f.host.workspace.storageId(),'roomCare','live-owner-job']);}
  const original=f.garden().care.receipts.find(row=>row.requestId===requestId),stock=f.store().snapshot(),ledger=f.store().ledger();
  assert.ok(original);assert.ok(f.state().route?.target?.gardenJobId);
  for(const type of ['pause','resume','cancel']) {
    const result=await f.request('roomCare',{type,requestId},'live-control-'+type);assert.equal(result.ok,true);
    const garden=f.garden(),receipt=garden.care.receipts.find(row=>row.requestId===requestId),jobs=[garden.care.task,...garden.care.queue].filter(job=>job?.id===original.jobId);
    assert.equal(receipt.jobId,original.jobId);assert.equal(garden.care.receipts.filter(row=>row.requestId===requestId).length,1);
    if(type==='pause'){assert.equal(receipt.status,'paused');assert.equal(jobs.length,1);assert.ok(jobs[0].pausedAt);assert.equal(f.state().route,null);}
    else if(type==='resume'){assert.ok(['queued','running'].includes(receipt.status));assert.equal(jobs.length,1);assert.equal(jobs[0].pausedAt,0);assert.equal(f.state().route.target.gardenJobId,original.jobId);}
    else {assert.equal(receipt.status,'cancelled');assert.equal(jobs.length,0);assert.equal(f.state().route,null);assert.equal(f.state().dwell,null);}
    if(owner==='body-row')assert.equal(f.state().plannedExecutions[requestId].status,type==='pause'?'paused':type==='resume'?'running':'cancelled');
    const after=f.capture();assert.deepEqual(await f.request('roomCare',{type,requestId},'live-control-'+type),result);unchanged(f,after);
    if(owner==='caretaker' && type==='resume'){await f.reopen();const running=f.capture();assert.equal((await f.request('roomCare',{type,requestId},'live-control-'+type)).accepted,false);unchanged(f,running);}
  }
  const after=f.store().snapshot();assert.equal(after.balance,stock.balance);assert.deepEqual(after.inventory,stock.inventory);assert.deepEqual(after.pendingUses,stock.pendingUses);assert.deepEqual(f.store().ledger(),ledger);
  assert.equal(f.garden().plots[0].tilled,false,'Control never completes the unfinished till effect');
});

for(const type of ['pause','resume'])test('unfinished caretaker '+type+' replay after Life resume and restart preserves accepted work',async t=>{
  const f=await fixture(t),job='unfinished-'+type;
  await f.request('roomCare',{type:'careNow',decision:'defer'},job);
  const requestId=digest(['workspace',f.host.workspace.storageId(),'roomCare',job]),input={type,requestId};
  await f.request('roomCare',input,'old-control');
  await f.plan.control(f.plan.read().revision,'pause','Pause before explicit recovery',f.body,'workspace');
  await f.plan.control(f.plan.read().revision,'resume','Continue the original wait',f.body,'workspace');
  await f.reopen();const before=f.capture();
  const result=await f.request('roomCare',input,'old-control');assert.equal(result.ok,true);unchanged(f,before);assert.equal(result.accepted,false);
  await f.plan.advance('workspace',f.body);assert.equal(f.plan.read().plan.status,'active');
  assert.equal(f.plan.read().plan.cursor,0);assert.equal(f.plan.read().plan.steps[1].action,'water');
});
