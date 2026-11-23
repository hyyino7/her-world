import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CoreRuntime} from '../../dist/src/core/runtime.js';
import {DEFAULT_COMPANION_SETTINGS} from '../../dist/src/core/companion-settings.js';
import {MemoryProcessHost} from '../../vendor/mnemosyne/src/memory-process.js';
import {MemoryClient} from '../../vendor/mnemosyne/src/memory-client.js';

// The red run can load baseline-transpiled owning modules. Production checks
// use the current emitted modules; neither mode starts a real service/model.
const load=async(name,normal)=>import(process.env.CHATPET_R6_MEMORY_BASELINE
  ? pathToFileURL(join(process.env.CHATPET_R6_MEMORY_BASELINE,name)).href : normal);
const {NativeMemory}=await load('native-memory.mjs','../../dist/src/core/native/memory.js');
const {MemoryConnection}=await load('client.mjs','../../dist/src/memory/client.js');
const {CoreNative}=await load('native.mjs','../../dist/src/core/native/conversation.js');
const {apply:applyAgent}=await load('agent.mjs','../../dist/src/core/native/agent.js');
const {installMemoryBatch}=await load('batch.mjs','../../dist/src/memory/batch.js');

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(done=>setImmediate(done));};
async function fixture(t) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'r6-memory-scope-'))),paths={A:join(root,'a'),B:join(root,'b')};
  for(const path of Object.values(paths))mkdirSync(path);
  const runtime=new CoreRuntime({dataDir:join(root,'core'),companionId:'fish',scopeId:'owner',ownerActorId:'human',displayName:'Fixture',character:'Fixture'});
  let selected='A';const requests=[],observations=new Map(),gates=new Map();let starts=0;
  const scope=()=>({workspaceId:selected,path:paths[selected],storageId:'bank-'+selected,guest:false});
  const move=name=>{selected=name;const previous=runtime.store.get('preferences','current');runtime.store.put('preferences','current',{
    revision:(previous?.revision??1)+1,workspace:{id:name,path:paths[name],title:name},conversation:runtime.defaultConversation});};
  move('A');
  const settings={...DEFAULT_COMPANION_SETTINGS,memorySummaryTurns:1,memorySummaryIdleMinutes:0,memorySummaryMinimumMinutes:0};
  const files={runtime,status:()=>({state:'ready',target:{id:selected,path:paths[selected]}}),storageId:()=>scope().storageId,
    companionSettings:()=>settings,companionConfiguration:()=>settings,sessionStatus:()=>({state:'ready',target:{id:selected,path:paths[selected]}})};
  runtime.files=files;
  t.mock.method(MemoryProcessHost.prototype,'start',async function(){
    this.child={pid:++starts,killed:false,exitCode:null,signalCode:null};this.ready=true;
    this.baseUrl='http://not-contacted.invalid/'+starts;return this.info();
  });
  t.mock.method(MemoryProcessHost.prototype,'stop',async function(){this.ready=false;this.child=null;return {state:'stopped'};});
  t.mock.method(MemoryClient.prototype,'request',async function(_method,path,body){
    const operation=path.split('/').at(-1),bank=body.scope.bankId;
    requests.push({operation,bank,args:structuredClone(body)});
    const gate=gates.get(operation);if(gate){gates.delete(operation);gate.entered.resolve();await gate.release.promise;}
    const source='source-'+bank,dependencies={sources:[{id:source,revision:'1'}],memories:[]};
    const record={memory:{id:'memory-'+bank,version:1,content:'private '+bank+' text'},dependencies};
    if(operation==='context')return {text:'private '+bank+' text',records:[record]};
    if(operation==='recall')return {records:[record]};
    if(operation==='read')return record;
    if(operation==='materialize')return body.sources.map(row=>({sourceId:row.id,revision:row.revision,observationId:'materialized-'+row.id,text:'original '+bank,actorId:'provider'}));
    if(operation==='validate')return {decision:'eligible'};
    if(operation==='observe') {
      const key=bank+':'+body.source_id,id=observations.get(key)??'observed-'+key;observations.set(key,id);return {observationId:id};
    }
    if(operation==='archive')return {archived:true};
    if(operation==='summary')return {id:'summary-'+bank+'-'+body.summary_seq};
    if(operation==='propose')return {id:'preference-'+bank,version:1,content:body.content};
    throw Error('Unexpected fixture operation '+operation);
  });
  const memory=new NativeMemory(runtime,{dataDir:join(paths.A,'.chatpet/data/memory'),python:resolve('/inert/python')});
  const native=new CoreNative(runtime);native.memory=memory;native.resolveNativeScope=scope;
  const token=()=>({...scope(),preferencesRevision:runtime.store.get('preferences','current').revision});
  const prepare=async(session='owner')=>{
    const before=token();await memory.prepare(session,scope());return before;
  };
  const connect=()=>memory.connection.start({companionId:'fish',scopeId:'owner',bankId:scope().storageId},scope().path,selected==='A');
  const gate=operation=>{const entry={entered:deferred(),release:deferred()};gates.set(operation,entry);return entry;};
  const source=id=>{runtime.store.put('source',id,{sourceId:id,origin:'owner_statement',actorId:'human',recordedAt:new Date().toISOString(),rootSourceIds:[],text:'Original source'});
    runtime.store.put('memory-source-work',id,{sourceId:id,workspaceId:scope().storageId,state:'queued',observationId:null});};
  t.after(async()=>{for(const gate of gates.values())gate.release.resolve();await memory.close();runtime.close();rmSync(root,{recursive:true,force:true});});
  return {root,runtime,files,memory,native,requests,observations,scope,move,prepare,token,connect,gate,source,settings};
}

test('R6-02: a prepared A recall refuses a B connection even after the visible binding is A',async t=>{
  const f=await fixture(t),binding=await f.prepare();
  f.move('B');await f.connect();f.move('A');
  await assert.rejects(f.memory.recall('owner','question',true,binding),/changed/);
  assert.equal(f.memory.context('owner'),'');assert.deepEqual(f.runtime.store.all('memory-provider-source'),[]);
  assert.equal(f.requests.some(row=>row.operation==='context'),false);
});
test('R6-02: logical Bank guard rejects a wrong connection without any revision change',async t=>{
  const f=await fixture(t),binding=await f.prepare();
  await f.memory.connection.start({companionId:'fish',scopeId:'owner',bankId:'bank-B'},join(f.root,'b'),false);
  await assert.rejects(f.memory.recall('owner','question',false,binding),error=>error.code==='STALE_BINDING');
  assert.equal(f.requests.length,0);assert.equal(f.memory.context('owner'),'');
});
for(const operation of ['context','materialize'])test(`R6-02: late ${operation} cannot publish text or materialize sources after A→B→A`,async t=>{
  const f=await fixture(t),binding=await f.prepare(),gate=f.gate(operation);
  const recalling=f.memory.recall('owner','question',true,binding);await gate.entered.promise;
  f.move('B');await f.connect();f.move('A');await f.connect();gate.release.resolve();
  await assert.rejects(recalling,/changed/);assert.equal(f.memory.context('owner'),'');
  assert.equal(f.runtime.store.get('source','source-bank-A'),undefined);
  assert.equal(f.runtime.store.get('memory-ack','source-bank-A'),undefined);
});
test('R6-02: successful recall pins both provider calls and publishes only after source materialization',async t=>{
  const f=await fixture(t),binding=await f.prepare(),gate=f.gate('materialize');
  const pending=f.memory.recall('owner','question',true,binding);await gate.entered.promise;
  assert.equal(f.memory.context('owner'),'');gate.release.resolve();
  assert.deepEqual(await pending,['source-bank-A']);assert.equal(f.memory.context('owner'),'private bank-A text');
  assert.deepEqual(f.requests.map(row=>[row.operation,row.bank]),[['context','bank-A'],['materialize','bank-A']]);
  assert.equal(f.runtime.store.require('source','source-bank-A').text,'original bank-A');
  f.move('B');f.move('A');assert.equal(f.memory.context('owner'),'','An obsolete context does not revive on ABA');
});
test('R6-02: missing operation scope cannot silently select the current Bank',async t=>{
  const f=await fixture(t);await f.prepare();
  await assert.rejects(f.memory.recall('owner','question',false),/changed/);
  await assert.rejects(f.memory.detail('memory-bank-A'),/changed/);
  assert.equal(f.requests.length,0);
});
test('R6-02: detail validates and materializes the same Bank before returning its full text',async t=>{
  const f=await fixture(t),binding=await f.prepare();const result=await f.memory.detail('memory-bank-A',binding);
  assert.match(result.text,/private bank-A text/);assert.deepEqual(result.sources,['source-bank-A']);
  assert.ok(f.requests.length>=4);assert.ok(f.requests.every(row=>row.bank==='bank-A'));
});
test('R6-02: stale detail cannot write provider sources after an awaited read',async t=>{
  const f=await fixture(t),binding=await f.prepare(),gate=f.gate('read');
  const reading=f.memory.detail('memory-bank-A',binding);await gate.entered.promise;
  f.move('B');f.move('A');gate.release.resolve();
  await assert.rejects(reading,/changed/);assert.equal(f.runtime.store.get('source','source-bank-A'),undefined);
});
test('R6-02: lost acknowledgement retains original queued source and retries the original observation ID',async t=>{
  const f=await fixture(t);f.source('owner-source');const gate=f.gate('observe');
  const pending=f.memory.prepare('owner',f.scope());await gate.entered.promise;f.move('B');f.move('A');gate.release.resolve();
  await assert.rejects(pending,/changed/);assert.equal(f.runtime.store.get('memory-ack','owner-source'),undefined);
  assert.equal(f.runtime.store.require('memory-source-work','owner-source').state,'queued');
  await f.memory.prepare('owner',f.scope());
  assert.equal(f.observations.size,1);assert.equal(f.requests.filter(row=>row.operation==='observe').length,2);
  assert.equal(f.runtime.store.require('memory-ack','owner-source').observationId,'observed-bank-A:owner-source');
});
test('R6-02: archived logs mark only their captured Bank and cannot commit a late archive flag',async t=>{
  const f=await fixture(t);await f.prepare('archive');const gate=f.gate('archive');
  const pending=f.memory.archive('archive','A',f.scope().path,[]);await gate.entered.promise;
  f.move('B');f.move('A');gate.release.resolve();await assert.rejects(pending,/changed/);
  assert.equal(f.runtime.store.require('memory-session','archive').archived,false);
  await f.memory.archive('archive','A',f.scope().path,[]);
  assert.equal(f.runtime.store.require('memory-session','archive').archived,true);
  assert.ok(f.requests.every(row=>row.bank==='bank-A'));
});
test('R6-02: owner archive search also rejects an equal-identity ABA result',async t=>{
  const f=await fixture(t),gate=f.gate('recall');const pending=f.memory.findForOwner('A','query');await gate.entered.promise;
  f.move('B');f.move('A');gate.release.resolve();await assert.rejects(pending,/changed/);
});
test('R6-02: closing Memory rejects an in-flight context and clears previous visible recall',async t=>{
  const f=await fixture(t),binding=await f.prepare();await f.memory.recall('owner','before',true,binding);
  const gate=f.gate('context'),pending=f.memory.recall('owner','late',true,binding);await gate.entered.promise;
  await f.memory.close();gate.release.resolve();await assert.rejects(pending,/changed|closed/);assert.equal(f.memory.context('owner'),'');
});
test('R6-02: the actual connection rejects late replies after replacing A with a new A client',async t=>{
  const f=await fixture(t);const c=new MemoryConnection(f.memory.connection.config);t.after(()=>c.close());
  await c.start({companionId:'fish',scopeId:'owner',bankId:'bank-A'},f.scope().path,true);
  const gate=f.gate('context'),pending=c.call('context',{},'bank-A');await gate.entered.promise;
  await c.start({companionId:'fish',scopeId:'owner',bankId:'bank-B'},join(f.root,'b'),false);
  await c.start({companionId:'fish',scopeId:'owner',bankId:'bank-A'},f.scope().path,true);
  gate.release.resolve();await assert.rejects(pending,error=>error.code==='STALE_BINDING');
});

function agentFixture(f) {
  const listeners=new Map(),agents=new Map(),warnings=[];
  const registry={get:id=>id===f.scope().workspaceId?{id,path:f.scope().path,sessionIds:['owner']}:undefined,archivedSessionIds:[]};
  const ctx={get:name=>name==='workspaceRegistry'?registry:undefined,agents:{get:id=>agents.get(id)},sessions:{get:()=>undefined,flush:async()=>true},
    tools:{register:()=>()=>{},guard:()=>()=>{},definitions:()=>[]},systemPrompt:{section:()=>()=>{}},effect(){},
    on(name,handler){const rows=listeners.get(name)??[];rows.push(handler);listeners.set(name,rows);return()=>{};},
    logger:()=>({warn:(...args)=>warnings.push(args)})};
  const events=[],replacements=[];
  const session={id:'owner',header:{cwd:f.scope().path,agentPreset:'standard'},surface:{nodes:[]},snapshotEvents:()=>events,eventAt:seq=>events[seq],append:(type,data,intent)=>replacements.push({type,data,intent})};
  const agent={id:'owner',session,ctx,status:'running'};agents.set('owner',agent);
  const host={workspace:f.files,native:f.native,records:{}},world={sessionStatus:()=>({state:'ready'})};
  const stop=applyAgent(ctx,host,world),step=listeners.get('agent/pre-step').at(-1);
  const payload={agent,turn:1,step:1,signal:new AbortController().signal,messages:[{role:'user',id:'input',source:{kind:'user'},content:[{type:'text',text:'Question'}]}]};
  return {ctx,agent,stop,step,payload,warnings,events,replacements,request:listeners.get('agent/request').at(-1)};
}
test('R6-02: actual native admission continues ordinary chat with empty recall after provider failure',async t=>{
  const f=await fixture(t),a=agentFixture(f);t.after(()=>a.stop());
  a.events.push({type:'user/message',data:{id:'old-recall',source:{kind:'chatpet-recall'},content:[{type:'text',text:'Previous recall'}]}});
  a.agent.session.surface.nodes.push(0);
  t.mock.method(f.memory.connection,'call',async()=>{throw Error('fixture provider unavailable');});
  const decision=await a.step(a.payload,async()=>({kind:'enter',messages:[]}));
  assert.equal(decision.kind,'enter');assert.deepEqual(decision.messages,[]);assert.equal(f.memory.context('owner'),'');
  await a.request({agent:a.agent,turn:1,step:1},async()=>({}));
  assert.equal(a.replacements.length,1);assert.equal(a.replacements[0].intent.surfaceOp.op,'replace');
  assert.ok(a.warnings.length>0);
});
test('R6-02: actual native admission strips recalled text if binding changes while next middleware awaits',async t=>{
  const f=await fixture(t),a=agentFixture(f);t.after(()=>a.stop());
  const decision=await a.step(a.payload,async()=>{f.move('B');f.move('A');return {kind:'enter',messages:[]};});
  assert.equal(decision.kind,'enter');assert.deepEqual(decision.messages,[]);assert.equal(f.memory.context('owner'),'');
});
test('R6-02: actual owner Memory tools pass the prepared binding through detail and source capture',async t=>{
  const f=await fixture(t);const tool=f.native.tools('owner').find(tool=>tool.name==='pet_memory_read');
  const result=await tool.execute({memory_id:'memory-bank-A'},{callId:'read-1'});
  assert.match(result,/private bank-A text/);assert.ok(f.requests.every(row=>row.bank==='bank-A'));
});
test('R6-02: actual Memory tool refuses an ABA continuation between preparation and detail',async t=>{
  const f=await fixture(t),prepare=f.memory.prepare.bind(f.memory);
  t.mock.method(f.memory,'prepare',async(...args)=>{const binding=await prepare(...args);f.move('B');await f.connect();f.move('A');return binding;});
  const tool=f.native.tools('owner').find(tool=>tool.name==='pet_memory_read');
  await assert.rejects(tool.execute({memory_id:'memory-bank-A'},{callId:'read-stale'}),/changed/);
  assert.equal(f.requests.some(row=>row.operation==='read'),false);assert.equal(f.runtime.store.get('source','source-bank-B'),undefined);
});

for(const change of ['none','provider','binding'])test(`Playback preference associates a Bank result only while its ${change} registration and binding are current`,async t=>{
  const f=await fixture(t);
  f.native.observeInputs('owner',1,[{role:'user',id:'owner-input',source:{kind:'user'},
    content:[{type:'text',text:'Please repeat the observed action'}]}]);
  const resolvePlayback=()=>({
    text:'Observed synthetic playback',occurredAt:0,
    associated(memoryId){f.runtime.store.put('fixture-playback-association','playback',memoryId);},
  });
  const provider=f.native.registerPlaybackEvidence(resolvePlayback);
  const gate=f.gate('propose');
  const tool=f.native.tools('owner').find(row=>row.name==='pet_memory_remember');
  const pending=tool.execute({content:'Repeat the observed action',evidence_quotes:['repeat the observed action'],playback_id:'playback'},{callId:'remember'});
  await Promise.race([gate.entered.promise,pending]);
  if(change==='provider'){
    await provider.revoke();
    f.native.registerPlaybackEvidence(resolvePlayback);
  }
  if(change==='binding'){f.move('B');f.move('A');}
  gate.release.resolve();
  if(change==='none'){
    assert.equal(JSON.parse(await pending).memoryId,'preference-bank-A');
    assert.equal(f.runtime.store.get('fixture-playback-association','playback'),'preference-bank-A');
  }else{
    await assert.rejects(pending,/no longer current|changed/);
    assert.equal(f.runtime.store.get('fixture-playback-association','playback'),undefined);
  }
  const submission=f.requests.find(row=>row.operation==='propose');
  assert.equal(submission.bank,'bank-A');
  assert.equal(submission.args.sources.length,2);
});

test('R6-02: registered guest chat retains the selected shared Bank without creating another Memory scope',async t=>{
  const f=await fixture(t);
  const source=f.native.sourceTable.register({id:'guest-scope-fixture',order:10,sources:[],isGuest:()=>true,branches:{},admit:()=>({kind:'unclaimed'})});
  const a=agentFixture(f);t.after(()=>a.stop());t.after(()=>source.revoke());
  const decision=await a.step(a.payload,async()=>({kind:'enter',messages:[]}));
  assert.equal(decision.kind,'enter');assert.equal(decision.messages[0].source.bank,'bank-A');
  assert.ok(f.requests.some(row=>row.operation==='context'));assert.ok(f.requests.every(row=>row.bank==='bank-A'));
});
test('R6-02: summary compaction ABA leaves its original batch pending without wrong-Bank submission',async t=>{
  const f=await fixture(t);f.source('owner-source');await f.prepare();
  const gate=deferred(),entered=deferred();let stop,event;
  const session={id:'owner',snapshotEvents:()=>[]},agent={session,status:'idle'};
  const ctx={get:name=>name==='workspaceRegistry'?{get:()=>({path:f.scope().path,sessionIds:['owner']})}:name==='agentPresets'?{serviceFor:()=>({compactNow:async()=>{entered.resolve();await gate.promise;return {summarySeq:42,summary:[{type:'text',text:'Actual native summary'}]};}})}:undefined,
    agents:{get:()=>agent},on(name,handler){if(name==='session/event')event=handler;},effect:fn=>{stop=fn();},logger:()=>({warn(){}})};
  t.mock.timers.enable({apis:['Date','setInterval'],now:1_800_000_000_000});
  t.after(async()=>{gate.resolve();await stop?.();t.mock.timers.reset();});
  f.runtime.store.put('native-session-sources','owner',['owner-source']);
  installMemoryBatch(ctx,{workspace:f.files,native:f.native});
  event(session,{type:'turn/end',time:Date.now(),data:{reason:{kind:'completed'}}});t.mock.timers.tick(1000);
  await entered.promise;f.move('B');await f.connect();f.move('A');gate.resolve();await flush();
  assert.equal(f.requests.some(row=>row.operation==='summary'),false);
  const row=f.runtime.store.require('memory-batch','owner');assert.equal(row.turns,1);assert.match(row.error,/changed/);
  assert.equal(f.runtime.store.get('native-summary-memory','owner'),undefined);
});
