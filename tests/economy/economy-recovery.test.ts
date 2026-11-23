import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, unlinkSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {Context} from '@deepseek-ai/cordis';
import type {PetCoreHost} from '../../src/core/index.js';
import type {CompanionFactActor} from '../../src/contracts/interaction.js';
import {EconomyStore} from '../../src/living/economy/store.js';
import {CompanionEconomy} from '../../src/living/economy/plugin.js';
import type {WorldChanged} from '../../src/contracts/living.js';
import {livingNotifications} from '../fixtures/living-notifications.js';

const owner:CompanionFactActor={kind:'owner',id:'fixture-owner',channel:'settings',sessionId:'fixture-settings'};
const meal='food:improved-meal';
function fixture(t:{after(fn:()=>void):void}) {
  const root=mkdtempSync(join(tmpdir(),'economy-recovery-'));
  const options={workspacePath:root,storageId:'fixture-storage',companionId:'fixture-companion'};
  let store=new EconomyStore(options);
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  return {root,options,get store(){return store;},reopen(){store.close();store=new EconomyStore(options);return store;}};
}

test('owner grant and gift facts commit once, survive restart and stay acknowledged on replay',t=>{
  const f=fixture(t),before=f.store.snapshot().balance;
  f.store.grantMoney('grant-once',17,undefined,owner);
  f.store.giftItem('gift-once',meal,2,undefined,owner);
  f.store.grantMoney('grant-once',17,undefined,owner);
  f.store.giftItem('gift-once',meal,2,undefined,owner);
  const pending=f.store.pendingFacts();
  assert.equal(pending.length,2);
  assert.deepEqual(pending.map(fact=>fact.requestId),['grant-once','gift-once']);
  assert.ok(pending.every(fact=>fact.domain==='economy'&&fact.result.status==='completed'));
  assert.deepEqual(pending[0].actor,owner);
  assert.deepEqual(pending[0].result.before,{balance:before});
  assert.deepEqual(pending[0].result.after,{balance:before+17});
  assert.equal(f.store.snapshot().balance,before+17);
  assert.equal(f.store.snapshot().inventory.find(item=>item.itemId===meal)!.quantity,2);
  assert.equal(f.store.ledger().items.filter(row=>row.requestId==='grant-once').length,1);
  assert.throws(()=>f.store.grantMoney('grant-once',18,undefined,owner),/different input/);
  f.reopen();
  assert.deepEqual(f.store.pendingFacts(),pending);
  f.store.acknowledgeFacts([pending[0].id,pending[0].id]);
  f.reopen();
  f.store.grantMoney('grant-once',17,undefined,owner);
  assert.deepEqual(f.store.pendingFacts(),[pending[1]]);
  f.store.acknowledgeFacts([pending[1].id]);
  assert.deepEqual(f.store.pendingFacts(),[]);
  assert.deepEqual(f.store.readFacts([pending[1].id,pending[0].id,pending[1].id]),[pending[1],pending[0],pending[1]],'Acknowledged facts retain their immutable original content and requested order');
  assert.throws(()=>f.store.readFacts(['unknown-fact']),/original economic interaction fact is unavailable/);
});

test('failure writing the fact rolls back wallet, ledger and request together',t=>{
  const f=fixture(t),before=f.store.snapshot(),ledger=f.store.ledger().items;
  const database=new DatabaseSync(f.store.databasePath);
  try {
    database.exec("CREATE TRIGGER reject_fact BEFORE INSERT ON interaction_facts BEGIN SELECT RAISE(ABORT,'injected fact failure'); END");
    assert.throws(()=>f.store.grantMoney('atomic-grant',11,undefined,owner),/injected fact failure/);
    assert.deepEqual(f.store.snapshot(),before);
    assert.deepEqual(f.store.ledger().items,ledger);
    assert.deepEqual(f.store.pendingFacts(),[]);
    assert.equal(database.prepare('SELECT count(*) AS total FROM requests WHERE id=?').get('atomic-grant')!.total,0);
    database.exec('DROP TRIGGER reject_fact');
    f.store.grantMoney('atomic-grant',11,undefined,owner);
    assert.equal(f.store.snapshot().balance,before.balance+11);
    assert.equal(f.store.pendingFacts().length,1);
  } finally {database.close();}
});

test('historical requests are replayed without inventing a new owner experience',t=>{
  const f=fixture(t);
  f.store.grantMoney('historical-grant',5);
  const before=f.store.snapshot();
  f.reopen();
  f.store.grantMoney('historical-grant',5,undefined,owner);
  assert.deepEqual(f.store.snapshot(),before);
  assert.deepEqual(f.store.pendingFacts(),[]);
});

test('reserved consumption retains its fixed effects and reconciles one actual Body proof after restart',t=>{
  const f=fixture(t);
  f.store.giftItem('food-gift',meal,2,undefined,owner);
  const reserved=f.store.beginUse('meal-operation',meal);
  assert.equal(reserved.status,'reserved');
  assert.equal(f.store.snapshot().inventory.find(item=>item.itemId===meal)!.available,1);
  f.store.configure('new-food-effects',{foodEffects:{[meal]:{hunger:-0.1}}});
  f.reopen();
  assert.deepEqual(f.store.itemUse('meal-operation')!.effects,reserved.effects);
  assert.deepEqual(f.store.beginUse('meal-operation',meal),reserved);
  assert.throws(()=>f.store.cancelUse('meal-operation',{operationId:'another-operation',applied:false,bodyReceiptId:'no-effect'}),/does not match/);
  assert.equal(f.store.itemUse('meal-operation')!.status,'reserved');
  const proof={operationId:'meal-operation',applied:true,bodyReceiptId:'durable-body-effect'};
  const consumed=f.store.finishUse('meal-operation',proof);
  assert.equal(consumed.status,'consumed');
  f.reopen();
  assert.deepEqual(f.store.finishUse('meal-operation',proof),consumed);
  const inventory=f.store.snapshot().inventory.find(item=>item.itemId===meal)!;
  assert.equal(inventory.quantity,1);assert.equal(inventory.reserved,0);
  assert.equal(f.store.ledger().items.filter(row=>row.kind==='use-consume').length,1);
  assert.deepEqual(f.store.pendingFacts().map(fact=>fact.type),['item-gift'],'Consumption feedback belongs to Body rather than a duplicate economic event');
  assert.throws(()=>f.store.cancelUse('meal-operation',{...proof,applied:false}),/different body proof/);
  f.store.beginUse('cancelled-meal',meal);
  assert.equal(f.store.cancelUse('cancelled-meal',{operationId:'cancelled-meal',applied:false,bodyReceiptId:'durable-no-effect'}).status,'cancelled');
  assert.equal(f.store.snapshot().inventory.find(item=>item.itemId===meal)!.available,1);
});

test('reading offers persist real text and confirmations only advance the offered content version',t=>{
  const f=fixture(t),itemId='reading:fixture-book';
  const original={itemId,title:'Actual fixture book',text:'Original actual content. '.repeat(130),source:{kind:'owner-import' as const,name:'fixture.txt'}};
  f.store.importBook('import-original',original,owner);
  f.store.giftItem('give-reading',itemId,1,undefined,owner);
  const offer=f.store.readOffer('read-operation',{itemId,segment:0});
  assert.equal(offer.text,original.text.slice(0,1200));
  assert.equal(f.store.snapshot().bookmarks.length,0,'Offering content or owning a book is not completed reading');
  f.reopen();
  assert.deepEqual(f.store.readOffer('read-operation',{itemId,segment:0}),offer);
  f.store.importBook('replace-content',{...original,text:'Replacement text with distinct content.'},owner);
  assert.throws(()=>f.store.confirmReading('read-operation','wrong-token'),/does not match/);
  f.store.confirmReading('read-operation',offer.receiptToken);
  f.store.confirmReading('read-operation',offer.receiptToken);
  const bookmarks=f.store.snapshot().bookmarks;
  assert.equal(bookmarks.length,1);assert.equal(bookmarks[0].version,offer.version);assert.equal(bookmarks[0].offset,offer.endOffset);
  const current=f.store.readOffer('read-replacement',{itemId,segment:0});
  assert.equal(current.text,'Replacement text with distinct content.');
  assert.notEqual(current.version,offer.version);assert.equal(current.bookmark,null);
  assert.throws(()=>f.store.readOffer('read-operation',{itemId,segment:1}),/different content/);
});

test('missing authoritative storage cannot silently create a replacement wallet',t=>{
  const f=fixture(t);
  f.store.grantMoney('retained-grant',13,undefined,owner);
  f.store.close();unlinkSync(join(f.root,'.chatpet/data/economy/economy.sqlite'));
  assert.throws(()=>new EconomyStore({...f.options,expectedInitialized:true}),/database is missing/);
});

test('notification failure retains a committed fact and acknowledgement rejects a changed binding',async t=>{
  const root=mkdtempSync(join(tmpdir(),'economy-service-facts-')),metadata=new Map<string,unknown>();
  let target={id:'fixture-workspace',path:root};
  const homeScope = () => ({workspaceId: target.id, path: target.path, storageId: target.id, bootId: 'fixture', generation: 0});
  const host={workspace:{status:()=>({state:'ready',target}),storageId:()=>target.id,homeScope,runtime:{config:{companionId:'fixture-companion',ownerActorId:owner.id},store:{
    persisted:()=>true,meta:(key:string)=>metadata.get(key),setMeta:(key:string,value:unknown)=>metadata.set(key,value),transaction:(fn:()=>unknown)=>fn(),
  }}}} as unknown as PetCoreHost;
  const notifications: WorldChanged[] = [];
  const ctx = {emit(name: string, event: WorldChanged) {
    if (name !== 'world.changed') return;
    notifications.push(event);
    throw Error('injected listener failure');
  }, logger: () => ({warn(){}})} as unknown as Context;
  const service = new CompanionEconomy(ctx, host, livingNotifications(t, ctx, host, 'economy'));
  t.after(()=>{service.close();rmSync(root,{recursive:true,force:true});});
  const signal=new AbortController().signal;
  const result=await service.ownerAction(target.id,{kind:'grant',amount:7},'service-grant',signal);
  assert.equal(result.balance, 7);
  assert.deepEqual(notifications, [{workspaceId: target.id, storageId: target.id, bootId: 'fixture', generation: 0}]);
  const pending=await service.pendingFacts(target.id);
  assert.equal(pending.length,1);assert.deepEqual(pending[0].actor,{kind:'owner',id:owner.id,channel:'settings'});
  const original=target.id;target={...target,id:'another-workspace'};
  await assert.rejects(service.acknowledgeFacts(original,[pending[0].id]),/current bound workspace/);
  await assert.rejects(service.readFacts(original,[pending[0].id]),/current bound workspace/);
  target={...target,id:original};
  assert.deepEqual(await service.pendingFacts(original),pending);
  await service.acknowledgeFacts(original,[pending[0].id]);
  assert.deepEqual(await service.pendingFacts(original),[]);
  assert.deepEqual(await service.readFacts(original,[pending[0].id]),pending);
});

test('fresh economy has no starter resources, gifts, salary or fictional experience',t=>{
  const f=fixture(t),saved=f.store.snapshot();
  assert.equal(saved.balance,0);
  assert.ok(saved.inventory.every(item=>item.quantity===0));
  assert.deepEqual(f.store.ledger().items,[]);
  assert.deepEqual(f.store.pendingFacts(),[]);
  f.reopen();
  assert.deepEqual(f.store.snapshot(),saved);
});

for(const [name,patch] of Object.entries({
  dailyTarget:{dailyNetReference:900},fertilizerYield:{fertilizerYield:99},
  cropYield:{crops:{carrot:{yield:99}}},cropBuyback:{crops:{carrot:{sellPrice:99}}},
  genericBuyback:{itemPrices:{'harvest:carrot':{purchasePrice:null,sellPrice:99}}},
  foodResale:{itemPrices:{'food:improved-meal':{purchasePrice:0,sellPrice:99}}},
  harvestAvailability:{catalogEnabled:{'harvest:carrot':false}},
}))test(`owner economic configuration rejects income override: ${name}`,t=>{
  const f=fixture(t),saved=f.store.snapshot();
  // Pick the real game's first crop instead of assuming a particular crop id.
  const crop=Object.keys(saved.configuration.crops)[0],input=JSON.parse(JSON.stringify(patch).replaceAll('carrot',crop));
  assert.throws(()=>f.store.configure('forbidden-'+name,input));
  assert.deepEqual(f.store.snapshot(),saved,'Rejected edits cannot leave partial settings or transactions');
  assert.deepEqual(f.store.ledger().items,[]);
});

test('shop products retain purchasing, availability, actual reading import and food customization',t=>{
  const f=fixture(t),crop=Object.keys(f.store.snapshot().configuration.crops)[0];
  f.store.importBook('import-shop',{itemId:'reading:owner-product',title:'Owner product',text:'Actual text for the shop.'});
  f.store.configure('shop-config',{
    articlePrice:7,bookPrice:12,improvedMealPrice:8,compostCost:4,
    waterDurationFactor:1.4,fertilizerGrowth:1.3,crops:{[crop]:{growMs:86400000,seedCost:2}},
    itemPrices:{'reading:owner-product':{purchasePrice:3,sellPrice:null}},
    catalogEnabled:{'reading:owner-product':false},foodEffects:{[meal]:{hunger:-0.4}},
  });
  const item=()=>f.store.snapshot().catalog.find(row=>row.id==='reading:owner-product')!;
  assert.equal(item().purchasePrice,3);assert.equal(item().enabled,false);
  assert.equal(f.store.snapshot().catalog.find(row=>row.id==='seed:'+crop)!.purchasePrice,2);
  f.store.grantMoney('startup',3);
  assert.throws(()=>f.store.purchase('cannot-buy-downlisted','reading:owner-product',1));
  f.store.configure('list-product',{catalogEnabled:{'reading:owner-product':true}});
  f.store.purchase('buy-custom-product','reading:owner-product',1);
  assert.equal(f.store.snapshot().balance,0);
  assert.equal(f.store.snapshot().inventory.find(row=>row.itemId==='reading:owner-product')!.quantity,1);
  assert.deepEqual(f.store.snapshot().bookmarks,[],'Purchasing is not reading');
});

test('legacy income overrides cannot affect current quotes or new crop rules and reads preserve stored data',t=>{
  const f=fixture(t),before=f.store.snapshot(),crop=Object.keys(before.configuration.crops)[0];
  f.store.grantMoney('retained-money',17);f.store.giftItem('retained-harvest','harvest:'+crop,2);
  const db=new DatabaseSync(f.store.databasePath);
  try{
    const old=JSON.parse(String(db.prepare("SELECT value FROM meta WHERE key='configuration'").get()!.value));
    old.dailyNetReference=999;old.fertilizerYield=99;old.crops[crop].yield=99;old.crops[crop].sellPrice=99;
    old.itemPrices['harvest:'+crop]={purchasePrice:null,sellPrice:777};old.catalogEnabled['harvest:'+crop]=false;
    old.itemPrices[meal]={purchasePrice:2,sellPrice:888};
    const raw=JSON.stringify(old);db.prepare("UPDATE meta SET value=? WHERE key='configuration'").run(raw);
    const garden=JSON.parse(String(db.prepare("SELECT value FROM meta WHERE key='garden'").get()!.value));
    garden.plots[0]={...garden.plots[0],tilled:true,cropId:crop,progress:0.2,moisture:0.8,fertilized:false,plantedAt:Date.now(),cropProfile:{growMs:123456,yield:11,waterDurationFactor:1,fertilizerGrowth:1.5,fertilizerYield:7}};
    db.prepare("UPDATE meta SET value=? WHERE key='garden'").run(JSON.stringify(garden));
    f.reopen();const saved=f.store.snapshot();
    assert.equal(saved.balance,17);assert.equal(saved.inventory.find(row=>row.itemId==='harvest:'+crop)!.quantity,2);
    assert.equal(saved.configuration.crops[crop].yield,before.configuration.crops[crop].yield);
    assert.equal(saved.configuration.fertilizerYield,before.configuration.fertilizerYield);
    assert.equal(saved.catalog.find(row=>row.id==='harvest:'+crop)!.sellPrice,before.catalog.find(row=>row.id==='harvest:'+crop)!.sellPrice);
    assert.equal(saved.catalog.find(row=>row.id==='harvest:'+crop)!.enabled,true);
    assert.equal(saved.catalog.find(row=>row.id===meal)!.sellPrice,null);
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='configuration'").get()!.value,raw,'Reading never rewrites legacy config');
    const retained=JSON.parse(String(db.prepare("SELECT value FROM meta WHERE key='garden'").get()!.value));
    assert.deepEqual(retained.plots[0].cropProfile,garden.plots[0].cropProfile,'Existing planted cohort keeps its accepted profile');
    const price=saved.catalog.find(row=>row.id==='harvest:'+crop)!.sellPrice!;
    f.store.sell('sell-retained','harvest:'+crop,2);
    assert.equal(f.store.snapshot().balance,17+2*price,'Existing holdings sell at the common game quote');
    f.store.giftItem('seed-for-new-cohort','seed:'+crop,1);
    const now=Date.now();
    assert.ok(f.store.applyGarden({type:'till',plotId:1},'till-new-cohort',now,{enabled:false}).ok);
    assert.ok(f.store.applyGarden({type:'plant',plotId:1,cropId:crop},'plant-new-cohort',now,{enabled:false}).ok);
    const planted=f.store.readGarden(now,{enabled:false});
    assert.equal(planted.plots[1].cropProfile.yield,before.configuration.crops[crop].yield);
    assert.equal(planted.plots[1].cropProfile.fertilizerYield,before.configuration.fertilizerYield);
    assert.equal(planted.plots[0].cropProfile.yield,11,'A new planting does not rewrite an old cohort');
  }finally{db.close();}
});


test('actual economy settings first edits submit writable fields without losing shop changes',t=>{
  const source=readFileSync(process.env.CHATPET_ECONOMY_SETTINGS_CLIENT??resolve('src/console/client.js'),'utf8');
  const from=source.indexOf('const changed=(key,value)=>setEdit('),until=source.indexOf('const config=edit?.next||view?.configuration',from);
  assert.ok(from>=0&&until>from,'Actual Economy editor submission path is present');
  const methods=source.slice(source.indexOf('const updateCrop=',until),source.indexOf('const price=',until));
  for(const action of ['base-price','crop-price','item-price']){
    const f=fixture(t),snapshot=f.store.snapshot(),crop=Object.keys(snapshot.configuration.crops)[0];
    const context:any={view:{...snapshot,configurationVersion:String(snapshot.configuration.revision)},config:snapshot.configuration,catalog:snapshot.catalog,edit:undefined};
    context.setEdit=(update:(value:unknown)=>unknown)=>{context.edit=update(context.edit);};
    runInNewContext(source.slice(from,until)+methods+';globalThis.changed=changed;globalThis.updateCrop=updateCrop;globalThis.updatePrice=updatePrice;',context);
    if(action==='base-price')context.changed('articlePrice',6);
    else if(action==='crop-price')context.updateCrop(crop,'seedCost',2);
    else context.updatePrice(meal,'purchasePrice',5);
    // Serialize exactly as an RPC request crosses the UI/service boundary.
    const input=JSON.parse(JSON.stringify(context.edit));
    assert.ok(!Object.hasOwn(input.next,'dailyNetReference')&&!Object.hasOwn(input.next,'fertilizerYield'));
    assert.ok(Object.values(input.next.crops).every((value:any)=>!Object.hasOwn(value,'sellPrice')&&!Object.hasOwn(value,'yield')));
    f.store.configure('ui-'+action,input.next,Number(input.expectedVersion));
    const actual=f.store.snapshot();
    if(action==='base-price')assert.equal(actual.configuration.articlePrice,6);
    else if(action==='crop-price')assert.equal(actual.catalog.find(row=>row.id==='seed:'+crop)!.purchasePrice,2);
    else assert.equal(actual.catalog.find(row=>row.id===meal)!.purchasePrice,5);
  }
});

test('ledger preserves old kinds and new grants retain distinct ledger and fact types',t=>{
  const f=fixture(t);
  f.store.grantMoney('legacy-kind',5);
  const legacyKind='旧版钱包:特殊入账';
  const db=new DatabaseSync(f.store.databasePath);
  try {
    db.prepare('UPDATE ledger SET kind=? WHERE request_id=?').run(legacyKind,'legacy-kind');
  } finally {db.close();}
  f.reopen();

  f.store.grantMoney('current-kind',7,undefined,owner);
  f.store.grantMoney('current-kind',7,undefined,owner);
  const entries=f.store.ledger().items;
  assert.deepEqual(entries.filter(row=>row.requestId==='current-kind').map(row=>row.kind),['owner-grant']);
  assert.equal(entries.find(row=>row.requestId==='legacy-kind')?.kind,legacyKind);
  assert.deepEqual(f.store.pendingFacts().map(fact=>fact.type),['money-grant']);
});
