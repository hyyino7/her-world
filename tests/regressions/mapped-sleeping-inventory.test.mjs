import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {compiledURL} from '../fixtures/playback.mjs';
import {syncBuiltinESMExports} from 'node:module';
import {runInNewContext} from 'node:vm';
import childProcess from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import ts from 'typescript';

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
const {digest}=await import(compiledURL('core/storage.js'));
const {CompanionBehavior}=await import(compiledURL('living/body/plugin.js'));
const {CompanionEconomy}=await import(compiledURL('living/economy/plugin.js'));
const {PersistentLifePlan}=await import(compiledURL('living/plan/plan.js'));
const {settingsHandler}=await import(compiledURL('console/settings.js'));
const meal='food:improved-meal',requestId='sleeping-inventory-meal';
const operation=id=>'owner-food:'+digest(id).slice(7,55);
const value=result=>{assert.equal(result.ok,true,JSON.stringify(result.error));return result.value;};

async function fixture(t) {
  const root=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'sleeping-inventory-'))),repo=join(root,'workspace');fs.mkdirSync(repo);
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-14T05:00:00Z')});
  const config={dataDir:join(root,'device-core'),companionId:'fish',scopeId:'owner',ownerActorId:'owner',displayName:'Fixture',character:'A continuing companion.'};
  let host=createCore(config),body,economy;
  const before=value(await host.services.preferences.read(host.operator.request('preferences'),{}));
  const saved=value(await host.services.preferences.save(host.operator.request('bind'),{expectedRevision:before.revision,
    workspace:{id:'workspace',path:repo,title:'Disposable test workspace'},conversation:before.conversation}));
  value(await host.services.workspace.initialize(host.operator.request('initialize'),{expectedPreferencesRevision:saved.revision}));
  const registered={id:'workspace',path:repo,status:async()=> 'ok'},registry={get:id=>id===registered.id?registered:undefined};
  const services=new Map(),listeners=new Map(),warnings=[];
  const logger=Object.assign(()=>logger,{warn:(...args)=>warnings.push(args),info(){},error(){}});
  const ctx={get:name=>services.get(name),on(name,receive){const set=listeners.get(name)??new Set();listeners.set(name,set);set.add(receive);return()=>set.delete(receive);},
    emit(name,...args){for(const receive of listeners.get(name)??[])receive(...args);},logger};
  services.set('petLife',{running:()=>true,bodyClockState:()=>({enabled:true,restoreElapsed:false})});
  const start=()=>{
    economy=new CompanionEconomy(ctx,host,{body:()=>body,plan:()=>services.get('petLife')});services.set('petEconomy',economy);
    body=new CompanionBehavior(ctx,host,{economy:()=>economy,plan:()=>services.get('petLife')});services.set('petBehavior',body);
  };
  start();
  const signal=new AbortController().signal,peer={signal,principal:{kind:'owner'}};
  const handler=settingsHandler(()=>host,()=>registry,undefined,undefined,undefined,undefined,undefined,undefined,undefined,()=>economy);
  const call=(id=requestId,itemId=meal)=>handler('economyAction',{requestId:id,input:{workspaceId:registered.id,action:{kind:'feed',itemId,quantity:1}}},signal,peer);
  value(await handler('economyAction',{requestId:'fixture-gift',input:{workspaceId:registered.id,action:{kind:'gift',itemId:meal,quantity:1}}},signal,peer));
  await body.act(registered.id,'sleep','fixture-sleep','desktop');
  let home=await body.roomState(registered.id);t.mock.timers.setTime(Date.now()+Math.ceil(home.her.etaMs)+1);home=await body.roomState(registered.id);
  assert.equal(home.her.asleep,true);
  const homeFile=body.binding.room.homeFile;
  const plan=new PersistentLifePlan(dirname(homeFile),'fish',host.workspace.storageId(),'UTC');
  await plan.commit(0,{goal:'Continue accepted sleep',reason:'Wait quietly without waking',steps:[{id:'wait',kind:'hold',activity:'Keep sleeping',durationMinutes:120}],nextConsiderAt:null});
  await plan.advance(registered.id,body);await body.roomState(registered.id);body.binding.room.flush();
  const read=()=>JSON.parse(fs.readFileSync(homeFile,'utf8'));
  const state=()=>body.binding.room.state;
  const store=()=>economy.prepare(registered);
  const inventory=()=>store().snapshot().inventory.find(row=>row.itemId===meal);
  const terminal=result=>{const execution=value(result).execution;assert.equal(execution.status,'failed');assert.equal(execution.phase,'completed');assert.match(execution.reason,/先叫醒/);return execution;};
  t.after(async()=>{await body.close();economy.close();await host.close();fs.rmSync(root,{recursive:true,force:true});assert.deepEqual(forbidden,[]);});
  return {repo,ctx,services,signal,peer,handler,call,terminal,plan,read,state,store,inventory,homeFile,
    get host(){return host;},get body(){return body;},get economy(){return economy;},
    async reopen(){await body.close();economy.close();await host.close();host=createCore(config);assert.equal(host.workspace.status().state,'ready');start();await body.roomState(registered.id);},
    async wake(){await body.act(registered.id,'wake','fixture-wake','desktop');t.mock.timers.setTime(Date.now()+20000);await body.roomState(registered.id);assert.equal(state().asleep,false);},
  };
}

function assertSleepPreserved(f,original,plan) {
  for(const key of ['asleep','sleepStartedAt','kind','activity','needs','counts','route','dwell','companionAction','currentPlannedOperation','interactionReturn'])
    assert.deepEqual(f.state()[key],original[key],key);
  assert.deepEqual(f.state().plannedExecutions[original.currentPlannedOperation],original.plannedExecutions[original.currentPlannedOperation]);
  assert.deepEqual(f.plan.read(),plan);
}

function denialFact(f,id=requestId) {
  const receipt=f.read().interactionReceipts[digest(id)],fact=receipt.fact;
  assert.equal(receipt.changed,false);assert.equal(fact.result.status,'unchanged');assert.equal(fact.type,'feed');
  assert.equal(fact.requestId,id);assert.equal(fact.operationId,operation(id));assert.match(fact.result.summary,/先叫醒/);
  assert.deepEqual(fact.actor,{kind:'owner',id:'owner',channel:'settings'});assert.deepEqual(fact.result.before,fact.result.after);
  return fact;
}

test('real Settings/Core/Economy/Body record sleeping inventory refusal without interrupting the accepted sleep plan or reserving stock',async t=>{
  const f=await fixture(t),original=structuredClone(f.state()),plan=f.plan.read(),economy=f.store().snapshot(),ledger=f.store().ledger();
  const refused=f.terminal(await f.call()),fact=denialFact(f),row=f.read().plannedExecutions[operation(requestId)];
  assert.equal(refused.operationId,operation(requestId));assert.ok(row.effectDeclinedAt);assert.equal(row.effectAppliedAt,undefined);
  assert.equal(row.settlementCompletedAt,row.effectDeclinedAt,'A no-reservation refusal needs no later inventory settlement');
  for(const hidden of ['interaction','input','effectDeclinedAt','settlementCompletedAt'])assert.equal(hidden in refused,false);
  assertSleepPreserved(f,original,plan);assert.deepEqual(f.store().snapshot(),economy);assert.deepEqual(f.store().ledger(),ledger);
  assert.equal(f.store().itemUse(operation(requestId)),undefined);assert.equal(f.inventory().quantity,1);assert.equal(f.inventory().reserved,0);
  assert.deepEqual(await f.body.readFacts('workspace',[fact.id]),[fact]);
  const pending=await f.body.pendingFacts('workspace');assert.equal(pending.filter(row=>row.id===fact.id).length,1);
  assert.deepEqual(f.terminal(await f.call()),refused);assert.deepEqual(denialFact(f),fact);
});

test('the same rejected Settings request survives full Core/Body/Economy restart and waking; a fresh awake request consumes once',async t=>{
  const f=await fixture(t),refused=f.terminal(await f.call()),fact=denialFact(f);
  await f.body.acknowledgeFacts('workspace',[fact.id]);await f.reopen();
  assert.deepEqual(f.terminal(await f.call()),refused);assert.equal(f.read().interactionReceipts[digest(requestId)].acknowledged,true);
  await f.wake();const awake=structuredClone(f.state().needs);
  assert.deepEqual(f.terminal(await f.call()),refused);assert.deepEqual(f.state().needs,awake);assert.equal(f.inventory().quantity,1);
  const completed=value(await f.call('new-awake-meal')).execution;assert.equal(completed.status,'completed');assert.equal(f.inventory().quantity,0);
  const counts=structuredClone(f.state().counts),needs=structuredClone(f.state().needs);
  assert.deepEqual(value(await f.call('new-awake-meal')).execution,completed);assert.deepEqual(f.state().counts,counts);assert.deepEqual(f.state().needs,needs);
  assert.deepEqual(f.terminal(await f.call()),refused,'An old refusal precedes current inventory preflight even after the last meal was used');
  assert.equal(f.inventory().quantity,0);assert.equal(f.inventory().reserved,0);assert.deepEqual(denialFact(f),fact);
  assert.equal((await f.body.pendingFacts('workspace')).some(row=>row.id===fact.id),false,'Replay cannot resurrect an acknowledged fact');
});

test('sleeping refusal fingerprints reject changed item, actor attribution, request or operation identities without rewriting the original receipt',async t=>{
  const f=await fixture(t),refused=f.terminal(await f.call()),saved=f.read(),stock=f.store().snapshot();
  assert.equal((await f.call(requestId,'food:other-item')).ok,false);
  const actor={kind:'owner',id:'owner',channel:'settings'};
  for(const changed of [{...actor,channel:'desktop'},{...actor,id:'different-owner'},{...actor,sessionId:'new-session'}])
    await assert.rejects(f.economy.ownerAction('workspace',{kind:'feed',itemId:meal},requestId,f.signal,()=>{},changed));
  await assert.rejects(f.body.consumeFood('workspace',{operationId:operation(requestId),itemId:meal,interaction:{requestId:'other-request',actor}}));
  await assert.rejects(f.body.consumeFood('workspace',{operationId:'other-operation',itemId:meal,interaction:{requestId,actor}}));
  assert.deepEqual(f.terminal(await f.call()),refused);assert.deepEqual(f.read().plannedExecutions,saved.plannedExecutions);
  assert.deepEqual(f.read().interactionReceipts,saved.interactionReceipts);assert.deepEqual(f.store().snapshot(),stock);
});

test('a terminal no-effect refusal remains terminal while the optional Economy binding is absent and resumes no settlement on recovery',async t=>{
  const f=await fixture(t),refused=f.terminal(await f.call()),row=structuredClone(f.read().plannedExecutions[operation(requestId)]),stock=f.store().snapshot();
  f.services.delete('petEconomy');
  assert.deepEqual(await f.body.consumeFood('workspace',{operationId:operation(requestId),itemId:meal,
    interaction:{requestId,actor:{kind:'owner',id:'owner',channel:'settings'}}}),refused);
  assert.deepEqual(f.read().plannedExecutions[operation(requestId)],row);assert.equal(f.state().asleep,true);
  f.services.set('petEconomy',f.economy);await f.body.roomState('workspace');
  assert.deepEqual(f.terminal(await f.call()),refused);assert.deepEqual(f.store().snapshot(),stock);assert.equal(f.store().itemUse(operation(requestId)),undefined);
});

test('a failed atomic Body checkpoint commits neither refusal receipt nor fact and reserves nothing before an explicit retry',async t=>{
  const f=await fixture(t),before=fs.readFileSync(f.homeFile,'utf8'),stock=f.store().snapshot(),ledger=f.store().ledger(),rename=fs.renameSync;
  let blocked=0;
  const deny=t.mock.method(fs,'renameSync',(from,to)=>{
    if(to===f.homeFile && fs.readFileSync(from,'utf8').includes(operation(requestId))) {blocked++;const error=Error('Fixture atomic checkpoint refused');error.code='EACCES';throw error;}
    return rename(from,to);
  });
  const response=await f.call();assert.equal(response.ok,false);assert.equal(blocked,1);
  assert.equal(fs.readFileSync(f.homeFile,'utf8'),before);assert.equal(f.state().plannedExecutions[operation(requestId)],undefined);
  assert.equal(f.state().interactionReceipts?.[digest(requestId)],undefined);assert.deepEqual(f.store().snapshot(),stock);assert.deepEqual(f.store().ledger(),ledger);
  assert.equal(f.store().itemUse(operation(requestId)),undefined);deny.mock.restore();
  f.terminal(await f.call());denialFact(f);assert.equal(f.inventory().quantity,1);assert.equal(f.inventory().reserved,0);
});

test('a lost Settings response after the refusal checkpoint retains the same terminal result for an awake retry',async t=>{
  const f=await fixture(t),caller=new AbortController();let committed=false;
  const stop=f.ctx.on('pet/behavior.changed',()=>{
    if(f.state().plannedExecutions[operation(requestId)]?.status==='failed'){committed=true;caller.abort();}
  });
  const result=await f.handler('economyAction',{requestId,input:{workspaceId:'workspace',action:{kind:'feed',itemId:meal,quantity:1}}},caller.signal,f.peer);
  stop();assert.equal(committed,true);assert.equal(result.ok,false);
  const row=f.read().plannedExecutions[operation(requestId)],fact=denialFact(f);
  assert.equal(row.status,'failed');assert.equal(f.store().itemUse(operation(requestId)),undefined);
  await f.wake();f.terminal(await f.call());assert.deepEqual(f.read().plannedExecutions[operation(requestId)],row);
  assert.deepEqual(denialFact(f),fact);assert.equal(f.inventory().quantity,1);assert.equal(f.inventory().reserved,0);
});

test('the existing Economy UI clears the sleeping request and displays wake-first from the terminal Settings receipt',async t=>{
  const f=await fixture(t),source=fs.readFileSync('src/console/client.js','utf8'),tree=ts.createSourceFile('actual-client.js',source,ts.ScriptTarget.Latest,true);
  let send;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='send'&&node.parameters[0]?.name.getText(tree)==='operation')send=node.getText(tree);ts.forEachChild(node,visit);}visit(tree);assert.ok(send);
  const storage=new Map(),ui={pending:null,fault:'',feedback:'',busy:false},operationRequest={endpoint:'economyAction',requestId,input:{workspaceId:'workspace',action:{kind:'feed',itemId:meal,quantity:1}}};
  const scope={locked:{current:false},unresolved:{current:null},lifetime:{current:{signal:f.signal}},storageKey:'fixture-pending',
    localStorage:{setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    setBusy:value=>{ui.busy=value;},setFault:value=>{ui.fault=value;},setFeedback:value=>{ui.feedback=value;},setPending:value=>{ui.pending=value;},setEdit(){},setAmount(){},setNote(){},setImported(){},setTitle(){},
    request:async(endpoint,input,signal,id)=>{const result=await f.handler(endpoint,{requestId:id,input},signal,f.peer);if(!result.ok)throw Object.assign(Error(result.error.message),result.error);return result.value;},refresh:async()=>{},
  };
  runInNewContext(send+'\nglobalThis.sendActual=send;',scope);await scope.sendActual(operationRequest);
  assert.equal(ui.pending,null);assert.equal(scope.unresolved.current,null);assert.equal(storage.has('fixture-pending'),false);assert.equal(ui.busy,false);
  assert.match(ui.fault,/先叫醒/);assert.match(ui.feedback,/未完成/);assert.equal(f.state().asleep,true);assert.equal(f.inventory().quantity,1);
});
