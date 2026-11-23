import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import type {Context} from '@deepseek-ai/cordis';
import type {PetCoreHost} from '../../src/core/index.js';
import type {CompanionFactActor} from '../../src/contracts/interaction.js';
import {emptyHomeState} from '#feiyu-home';
import {createGarden} from '#feiyu-garden';
import {CompanionBehavior} from '../../src/living/body/plugin.js';
import {LivingView} from '../../src/living/index.js';
import {CompanionEconomy} from '../../src/living/economy/plugin.js';
import {PersistentLifePlan} from '../../src/living/plan/plan.js';

const meal='food:improved-meal';
const owner:CompanionFactActor={kind:'owner',id:'owner',channel:'room',sessionId:'owner-room'};

/** Real Life intent, Body service and Economy service/storage. Only Core's
 * binding/event boundary and the wall clock are fixtures; no model or app runs. */
function fixture(t:TestContext) {
  const root=mkdtempSync(join(tmpdir(),'life-domain-integration-'));
  const target={id:'workspace',path:root,title:'Fixture workspace'},directory=join(root,'.chatpet/data/life');
  const now=Date.parse('2026-11-13T05:00:00Z');
  t.mock.timers.enable({apis:['Date'],now});mkdirSync(directory,{recursive:true});
  const home=emptyHomeState(now);
  Object.assign(home,{needs:{hunger:.8,thirst:.8,energy:.7,bladder:.1,pain:0},asleep:false,
    sleepPending:false,route:null,dwell:null,command:null,freeTarget:null,reactionUntil:0,lastInteractionAt:0,eventLog:[]});
  const garden=createGarden(now);garden.care.autoEnabled=false;
  writeFileSync(join(directory,'home.json'),JSON.stringify(home));
  writeFileSync(join(directory,'garden.json'),JSON.stringify(garden));
  const metadata=new Map<string,unknown>(),events:{name:string;payload:unknown}[]=[];
  const host={workspace:{status:()=>({state:'ready',target}),storageId:()=> 'storage',
    homeScope:()=>({workspaceId:target.id,path:target.path,storageId:'storage',bootId:'fixture',generation:0}),runtime:{
    config:{ownerActorId:'owner',companionId:'fish'},identity:()=>({companionId:'fish',displayName:'Fixture'}),
    store:{persisted:()=>true,meta:(key:string)=>metadata.get(key),setMeta:(key:string,value:unknown)=>metadata.set(key,value),
      transaction:(work:()=>unknown)=>work()},
  }}} as unknown as PetCoreHost;
  let body:CompanionBehavior,economy:CompanionEconomy|undefined;
  const ctx={get:(name:string)=>name==='petBehavior'?body:name==='petEconomy'?economy:undefined,
    on:()=>()=>{},emit:(name:string,payload:unknown)=>{events.push({name,payload});},logger:()=>({warn(){}})} as unknown as Context;
  const openEconomy=()=>{economy=new CompanionEconomy(ctx,host,{body:()=>body});economy.prepare(target);};
  const start=()=>{
    openEconomy();
    const view=new LivingView({economy:()=>economy},undefined,undefined,undefined,binding=>ctx.emit('world.changed',binding));
    body=new CompanionBehavior(ctx,host,view);
    body.activate();
  };
  const plan=()=>new PersistentLifePlan(directory,'fish','storage','UTC');
  start();
  t.after(async()=>{await body.close();economy?.close();rmSync(root,{recursive:true,force:true});});
  const result={root,target,directory,events,get body(){return body;},get economy(){assert.ok(economy);return economy;},plan,
    ownerAction:(action:unknown,id:string)=>{assert.ok(economy);return economy.ownerAction(target.id,action,id,new AbortController().signal,undefined,owner);},
    async restart(){await body.close();economy?.close();start();await body.setAutonomy(target.id,true);},
    unloadEconomy(){economy?.close();economy=undefined;},
    restoreEconomy:openEconomy,
    savedBody:()=>JSON.parse(readFileSync(join(directory,'home.json'),'utf8')),
  };
  return result;
}

test('Life purchase and consumption settle once through real Body/Economy services across restart',async t=>{
  const f=fixture(t),id=f.target.id,plan=f.plan();
  await f.body.setAutonomy(id,true);await f.ownerAction({kind:'grant',amount:30},'owner-grant');
  const before=await f.body.snapshot(id),catalog=await f.economy.snapshot(id);
  const price=catalog.catalog.find(item=>item.id===meal)!.purchasePrice!;
  await plan.commit(0,{goal:'Choose a meal',reason:'An explicitly accepted autonomous choice',steps:[
    {id:'buy',kind:'economy',activity:'Buy one meal',economy:{type:'buy',itemId:meal,quantity:1}},
    {id:'eat',kind:'economy',activity:'Eat that meal',economy:{type:'consume',itemId:meal,quantity:1}},
  ],nextConsiderAt:null});
  await plan.advance(id,f.body);
  const planId=plan.read().plan!.id;
  assert.equal(plan.read().plan!.cursor,1);
  assert.equal((await f.economy.snapshot(id)).balance,30-price);
  const databasePath=f.economy.prepare(f.target).databasePath,database=new DatabaseSync(databasePath);
  try {database.exec("CREATE TRIGGER reject_consumption BEFORE UPDATE ON uses WHEN json_extract(NEW.value,'$.status')='consumed' BEGIN SELECT RAISE(ABORT,'injected settlement write failure'); END");}
  finally {database.close();}
  await plan.advance(id,f.body);
  const effect=(await f.body.snapshot(id)).needs.hunger;
  assert.ok(effect<before.needs.hunger);assert.equal(plan.read().plan!.cursor,1);
  const uncertain=await f.economy.snapshot(id);
  assert.equal(uncertain.pendingUses.length,1);assert.equal(uncertain.pendingUses[0].status,'reserved');
  assert.equal(uncertain.inventory.find(item=>item.itemId===meal)!.quantity,1);
  assert.equal(uncertain.ledger.filter(row=>row.kind==='use-consume').length,0,
    'A failed SQLite settlement rolls back the item debit after the separate Body effect committed');
  await f.restart();
  assert.equal((await f.body.snapshot(id)).needs.hunger,effect,'Restart must not apply the retained Body effect again');
  const recoveredDatabase=new DatabaseSync(databasePath);
  try {recoveredDatabase.exec('DROP TRIGGER reject_consumption');}finally {recoveredDatabase.close();}
  const restored=f.plan();await restored.advance(id,f.body);
  const snapshot=await f.economy.snapshot(id),receipt=await f.body.inspectPlanned(id,`life:${planId}:eat`);
  assert.equal(receipt?.status,'completed');assert.equal(restored.read().plan!.id,planId);
  assert.equal(restored.read().plan!.cursor,2);assert.equal(snapshot.balance,30-price);
  assert.equal(snapshot.inventory.find(item=>item.itemId===meal)!.quantity,0);
  assert.equal(snapshot.pendingUses.length,0);
  assert.equal(snapshot.ledger.filter(row=>row.kind==='purchase').length,1);
  assert.equal(snapshot.ledger.filter(row=>row.kind==='use-consume').length,1);
  assert.equal((await f.body.snapshot(id)).needs.hunger,effect);
  assert.deepEqual((await f.economy.pendingFacts(id)).map(fact=>fact.type),['money-grant'],
    'Autonomous trades do not invent owner gifts or purchases');
  assert.deepEqual(await f.body.pendingFacts(id),[],'Autonomous consumption does not invent an owner feeding event');
});

test('owner inventory feeding preserves a real Life hold and its original provenance through service restart',async t=>{
  const f=fixture(t),id=f.target.id,plan=f.plan();await f.body.setAutonomy(id,true);
  await f.ownerAction({kind:'gift',itemId:meal,quantity:2},'owner-meals');
  await plan.commit(0,{goal:'Continue resting',reason:'No new arrangement is needed',steps:[{id:'rest',kind:'hold',activity:'Resting'}],nextConsiderAt:null});
  await plan.advance(id,f.body);const original=plan.read().plan!.operationId;
  const first=await f.ownerAction({kind:'feed',itemId:meal},'owner-feed');
  assert.equal(first.execution?.status,'completed');
  const effect=(await f.body.snapshot(id)).needs.hunger,facts=await f.body.pendingFacts(id);
  assert.equal(facts.length,1);assert.deepEqual(facts[0].actor,owner);
  assert.equal(facts[0].requestId,'owner-feed');assert.equal(facts[0].type,'feed');
  assert.equal(f.savedBody().interactionReturn,original);
  await f.restart();await f.ownerAction({kind:'feed',itemId:meal},'owner-feed');
  assert.equal((await f.body.snapshot(id)).needs.hunger,effect);
  assert.deepEqual(await f.body.pendingFacts(id),facts);
  t.mock.timers.tick(13_000);await f.body.snapshot(id);await f.plan().advance(id,f.body);
  const restored=f.plan().read().plan!,snapshot=await f.economy.snapshot(id);
  assert.equal(restored.operationId,original);assert.equal(restored.status,'active');assert.equal(restored.nextConsiderAt,null);
  assert.equal((await f.body.inspectPlanned(id,original!))?.status,'running');
  assert.equal(snapshot.inventory.find(item=>item.itemId===meal)!.quantity,1);
  assert.equal(snapshot.ledger.filter(row=>row.kind==='use-consume').length,1);
  assert.deepEqual((await f.economy.pendingFacts(id)).map(fact=>fact.type),['item-gift'],
    'The completed feeding fact belongs to Body rather than a duplicate Economy event');
});

test('real reading survives plan pause/restart and confirms only its offered content version',async t=>{
  const f=fixture(t),id=f.target.id,itemId='reading:integration-book';await f.body.setAutonomy(id,true);
  const original={itemId,title:'Actual integration text',text:'A distinct passage from the original version. '.repeat(70),source:{kind:'owner-import' as const,name:'fixture.txt'}};
  f.economy.prepare(f.target).importBook('original-text',original,owner);
  await f.ownerAction({kind:'gift',itemId},'owner-book');
  let plan=f.plan();await plan.commit(0,{goal:'Read real content',reason:'An actual text is available',steps:[
    {id:'read',kind:'read',activity:'Read first segment',reading:{itemId,segment:0}},
    {id:'rest',kind:'hold',activity:'Rest after reading'},
  ],nextConsiderAt:null});
  await plan.advance(id,f.body);const operation=plan.read().plan!.operationId!;
  assert.equal((await f.economy.snapshot(id)).bookmarks.length,0);
  const waiting=await f.body.roomState(id);
  assert.equal(waiting.behavior.presentationKind,'reading-wait');assert.equal(waiting.behavior.readingState,'unread');
  assert.equal(f.economy.prepare(f.target).readingStatus(operation,{itemId,segment:0}).status,'unread',
    'Display reads do not manufacture a content offer');
  const beforeOffer=f.events.length;
  const offer=await f.body.readPlannedSegment(id,operation);
  assert.equal(offer.text,original.text.slice(0,1200));
  const reading=await f.body.roomState(id);
  assert.equal(reading.behavior.presentationKind,'read');assert.equal(reading.behavior.readingState,'offered');
  assert.ok(f.events.slice(beforeOffer).some(event=>event.name==='world.changed'),
    'A committed actual-content offer invalidates the same body projection');
  assert.equal((await f.economy.snapshot(id)).bookmarks.length,0,'Receiving text is not confirmation or comprehension');
  await plan.control(plan.read().revision,'pause','Owner paused the reading',f.body,id);
  assert.notEqual((await f.body.roomState(id)).behavior.presentationKind,'read');
  await assert.rejects(f.body.confirmPlannedReading(id,operation,offer.receiptToken),/暂停或取消/);
  await f.restart();plan=f.plan();assert.equal(plan.read().plan!.status,'paused');
  await plan.control(plan.read().revision,'resume','Continue the original passage',f.body,id);
  assert.equal((await f.body.roomState(id)).behavior.presentationKind,'read','Original receipt is still authoritative after pause and restart');
  const reopened=await f.body.readPlannedSegment(id,operation);assert.deepEqual(reopened,offer);
  f.economy.prepare(f.target).importBook('replacement-text',{...original,text:'The replacement version contains a different passage.'},owner);
  await assert.rejects(f.body.confirmPlannedReading(id,operation,'wrong-token'),/does not match/);
  await f.body.confirmPlannedReading(id,operation,offer.receiptToken);
  await f.body.confirmPlannedReading(id,operation,offer.receiptToken);await plan.advance(id,f.body);
  const bookmarks=(await f.economy.snapshot(id)).bookmarks;
  assert.equal(bookmarks.length,1);assert.equal(bookmarks[0].version,offer.version);assert.equal(bookmarks[0].offset,offer.endOffset);
  assert.equal(plan.read().plan!.cursor,1);
  const current=f.economy.prepare(f.target).readOffer('replacement-offer',{itemId,segment:0});
  assert.notEqual(current.version,offer.version);assert.equal(current.bookmark,null);
  assert.equal(current.text,'The replacement version contains a different passage.');
});

test('ordinary hold descriptions never manufacture a reading receipt or display classification',async t=>{
  const f=fixture(t),id=f.target.id;await f.body.setAutonomy(id,true);
  await f.body.startPlanned(id,{operationId:'quiet-hold',kind:'hold',activity:'Read a very interesting book'});
  const snapshot=await f.body.roomState(id);assert.equal(snapshot.behavior.presentationKind,'rest');
  assert.equal(snapshot.behavior.readingState,undefined);assert.equal((await f.economy.snapshot(id)).bookmarks.length,0);
});

test('Economy unload retains a pending Life transaction while free care works and recovery uses the same wallet',async t=>{
  const f=fixture(t),id=f.target.id,plan=f.plan();await f.body.setAutonomy(id,true);
  await f.ownerAction({kind:'grant',amount:30},'original-wallet');
  const gardenFile=join(f.directory,'garden.json'),legacyBytes=readFileSync(gardenFile,'utf8');
  await plan.commit(0,{goal:'Buy a chosen meal',reason:'The choice precedes the outage',steps:[
    {id:'buy',kind:'economy',activity:'Buy one meal',economy:{type:'buy',itemId:meal,quantity:1}},
  ],nextConsiderAt:null});
  f.unloadEconomy();await plan.advance(id,f.body);const operation=plan.read().plan!.operationId!;
  const pending=await f.body.inspectPlanned(id,operation);
  assert.equal(pending?.status,'running');assert.equal(pending?.phase,'waiting');
  const before=(await f.body.snapshot(id)).needs;
  await f.body.act(id,'water','outage-water','desktop');await f.body.act(id,'feed','outage-basic-meal','room');
  const after=(await f.body.snapshot(id)).needs;
  assert.ok(after.thirst<before.thirst);assert.ok(after.hunger<before.hunger);
  assert.equal(readFileSync(gardenFile,'utf8'),legacyBytes,'An unavailable authority cannot reactivate the legacy JSON garden writer');
  f.restoreEconomy();await plan.advance(id,f.body);await plan.advance(id,f.body);
  const snapshot=await f.economy.snapshot(id),price=snapshot.catalog.find(item=>item.id===meal)!.purchasePrice!;
  assert.equal(snapshot.balance,30-price);assert.equal(snapshot.companionId,'fish');assert.equal(snapshot.storageId,'storage');
  assert.equal(snapshot.inventory.find(item=>item.itemId===meal)!.quantity,1);
  assert.equal(snapshot.ledger.filter(row=>row.kind==='purchase').length,1);
  assert.equal((await f.body.inspectPlanned(id,operation))?.status,'completed');
  assert.equal(plan.read().plan!.cursor,1);
  assert.deepEqual((await f.body.pendingFacts(id)).map(fact=>fact.requestId),['outage-water','outage-basic-meal']);
});
