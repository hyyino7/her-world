// Native DSH integration with an in-process synthetic model and disposable Bank.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {mountFixtureServices} from '../lib/native-fixture-mount.mjs';
import {mountInstalledStandard} from './lib/native-standard-preset.mjs';
import {say} from './lib/native-conversation-scenarios.mjs';
const app='/Applications/DeepSeek Harness.app/Contents';
if(!process.versions.electron){
  const child=spawnSync(join(app,'MacOS/DeepSeek Harness'),['--expose-internals',fileURLToPath(import.meta.url)],
    {env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit',timeout:90000});
  if(child.error)throw child.error;process.exit(child.status??1);
}
const root=realpathSync(mkdtempSync(join(tmpdir(),'pet-native-services-'))),repo=join(root,'owner');mkdirSync(repo);
const require=createRequire(join(app,'Resources/app.asar/dsh/package.json'));
const load=name=>import(require.resolve('@deepseek-ai/'+name));
const {Context}=await load('cordis'),{LlmAdapter,createUserMessage}=await load('dsh-llm');
const {askTurn}=await import('#dsh-world/ecosystem/shared/turn');
const {createChannelHomes}=await import('../../dist/src/channels/sessions.js');
const {GUEST_PRESET}=await import('../../dist/src/channels/guest.js');
const ctx=new Context();ctx.baseUrl=pathToFileURL(join(app,'Resources/app.asar/dsh/index.js')).href;
const calls=[];let program,homes;
async function* tool(name,args){
  const id=randomUUID(),block={type:'tool-call',id,name,arguments:JSON.stringify(args)};
  yield {type:'block-start',index:0,blockType:'tool-call'};
  yield {type:'tool-call-delta',index:0,id,name,argumentsDelta:block.arguments};
  yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};
}
const all=options=>options.messages.flatMap(message=>message.content.filter(part=>part.type==='text').map(part=>part.text)).join('\n');
const system=options=>all({...options,messages:options.messages.filter(message=>message.role==='system')});
try{
  const mount=await mountFixtureServices(ctx,load,root);await mountInstalledStandard(ctx,require);
  for(const name of ['dsh-typert-registry','dsh-api-remote-access','dsh-api-gateway','dsh-session-query'])await mount(name);
  await mount('dsh-session-title',{fallbackMaxWords:5,fallbackMaxBytes:40,maxTitleBytes:80});
  await mount('dsh-attachment-local',{dshHome:root});
  await ctx.plugin({apply(scope){scope.provide('fileUploads',{registerAgentResolver:()=>()=>{}});}});
  await mount('dsh-agent-default-model',{provider:'services-fixture',model:'local'});
  await mount('dsh-api-session-controller',{nativeOpen:false});
  await ctx.agentPresets.register({id:GUEST_PRESET,plugins:[{id:'audience',name:new URL('../../dist/src/channels/guest.js',import.meta.url).href}]});
  class Fixture extends LlmAdapter{
    async resolveModel(provider,id){return {provider,id,name:id,systemPromptUpdate:'in-history'};}
    async *stream(options){calls.push(options);if(program)yield* program(options);else yield* say('Fixture reply');}
  }
  ctx.llm.registerAdapter(['services-fixture'],new Fixture());
  await ctx.plugin(await import('../../dist/src/core/plugin.js'),{dataDir:join(repo,'.chatpet/data/core'),cwd:repo,companionId:'fish',scopeId:'owner',ownerActorId:'owner',
    displayName:'Fixture fish',character:'TURN_PERSONA_ORIGINAL',memory:{dataDir:join(repo,'.chatpet/data/memory'),python:fileURLToPath(new URL('../../.venv/bin/python',import.meta.url))}});
  const host=ctx.petCore;
  await ctx.plugin(await import('../../dist/src/memory/plugin.js'));
  await ctx.plugin(await import('../../dist/src/emotion/plugin.js'));
  const unwrap=result=>{assert.ok(result.ok,JSON.stringify(result.error));return result.value;};
  let serial=0;const request=()=>host.operator.request('services-'+(++serial));
  const workspace=await ctx.workspaceRegistry.create(repo,'Disposable owner');
  const prefs=unwrap(await host.services.preferences.read(request(),{}));
  const bound=unwrap(await host.services.preferences.save(request(),{expectedRevision:prefs.revision,conversation:{...prefs.conversation,maxDurationMs:1000},workspace:{id:workspace.id,path:repo,title:workspace.title}}));
  unwrap(await host.services.workspace.initialize(request(),{expectedPreferencesRevision:bound.revision}));
  async function open(){
    const handle=await ctx.agents.create({sessionId:'services-'+randomUUID(),meta:{cwd:repo,agentPreset:'standard'},agentOptions:{provider:'services-fixture',model:'local',maxTokens:1024},setup:async scope=>{await ctx.agentPresets.mount(scope,'standard');}});
    await workspace.attachSession(handle.agent.id);return handle;
  }
  async function send(handle,text){handle.agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text}]}));await handle.agent.whenIdle();await ctx.sessions.flush(handle.agent.session);const end=[...handle.agent.session.snapshotEvents()].reverse().find(event=>event.type==='turn/end');assert.equal(end?.data.reason.kind,'completed',JSON.stringify(end?.data.reason));}
  const cold=await open(),initialPrepare=host.native.memory.prepare.bind(host.native.memory);
  const {createLifeSourceAdapter}=await import('../../dist/src/living/plan/tool-policy.js');
  const coldSource=host.native.sourceTable.register(createLifeSourceAdapter(ctx,host,id=>id===cold.agent.id));
  host.native.memory.prepare=async()=>{throw Error('Synthetic cold Memory outage');};
  program=async function*(){yield* say('Autonomous turn survives cold Memory outage.');};
  const wakeup=createUserMessage({source:{kind:'dsh-world-life'},content:[{type:'text',text:'Synthetic autonomous wakeup.'}]});
  const coldInput={sessionId:cold.agent.id,message:wakeup};
  assert.equal(host.native.sourceTable.admit(coldInput).kind,'accepted');
  cold.agent.followup(wakeup);
  await cold.agent.whenIdle();
  const coldEnd=[...cold.agent.session.snapshotEvents()].reverse().find(event=>event.type==='turn/end');
  assert.equal(coldEnd.data.reason.kind,'completed','A first autonomous turn does not require a prewarmed Memory provider');
  assert.equal(host.workspace.runtime.store.get('native-session-sources',cold.agent.id).length,2,'One background input plus one final reply have exactly two attributed source records');
  assert.equal(host.workspace.runtime.store.all('activity').length,0);assert.equal(host.workspace.runtime.store.all('execution').length,0);
  host.native.memory.prepare=initialPrepare;await coldSource.revoke();
  assert.equal(host.native.sourceTable.admit(coldInput).kind,'unclaimed');
  await cold.dispose();
  const a=await open(),b=await open();let beginCalls=0;const originalBegin=host.native.begin.bind(host.native);host.native.begin=(...args)=>{beginCalls++;return originalBegin(...args);};
  writeFileSync(join(repo,'ordinary-native-read.txt'),'A read-only native tool fixture.');
  let step=0;program=async function*(options){
    assert.ok(system(options).includes('TURN_PERSONA_ORIGINAL'));
    assert.ok(!system(options).includes('TURN_PERSONA_NEXT'));
    if(step===0){writeFileSync(join(repo,'.chatpet/SOUL.md'),'# Fixture fish\n\nTURN_PERSONA_NEXT');await new Promise(resolve=>setTimeout(resolve,1200));}
    if(step++<21)yield* tool('read',{file_path:join(repo,'ordinary-native-read.txt')});else yield* say('Completed twenty-one native tool calls.');
  };
  await send(a,'Run a long ordinary native task.');
  assert.equal(step,22);assert.equal(beginCalls,0);assert.equal(host.workspace.runtime.store.all('activity').length,0);assert.equal(host.workspace.runtime.store.all('execution').length,0);
  program=async function*(options){assert.ok(system(options).includes('TURN_PERSONA_NEXT'));yield* say('Acknowledged CROSS_SURFACE_HANOI.');};
  await send(a,'CROSS_SURFACE_HANOI: next Wednesday I travel to Hanoi.');
  program=async function*(options){assert.ok(all(options).includes('CROSS_SURFACE_HANOI'),'A second native session immediately recalls the completed turn');yield* say('Hanoi.');};
  await send(b,'Where do I travel next Wednesday?');
  const ownerHome=a.agent;
  homes=createChannelHomes(ctx,host,{dataDirectory:join(repo,'.chatpet/data/channels'),ownerHome:async()=>ownerHome,identityAllowed:()=>true,ownerIdentity:identity=>identity.speakerId==='qq:owner',active:()=>true});
  const identity={channel:'qq',accountId:'fixture',conversationId:'group-fixture',conversationType:'group',speakerId:'qq:friend',speakerName:'Guest speaker',platformMessageId:randomUUID()};
  const guest=await homes.open(identity);
  assert.equal(host.native.isGuest(guest.id),true);
  assert.deepEqual(host.native.sourceTable.policyRows().filter(({row})=>row===5||row===6).map(({row})=>row),[5,6]);
  const emotion=ctx.get('petEmotion'),beforeGuest=await emotion.read(workspace.id);
  program=async function*(options){
    assert.ok(system(options).includes('TURN_PERSONA_NEXT'),'Guest uses the same SOUL');
    assert.ok(system(options).includes('pet-expression') && all(options).includes('currentCompanionEmotion'),'Guest receives the shared Emotion guide/state sections');
    assert.ok(all(options).includes('CROSS_SURFACE_HANOI'),'Verified guest route reads the same Bank');
    assert.ok(!(options.tools??[]).some(tool=>tool.name.startsWith('pet_memory_') || tool.name==='read' || tool.name.startsWith('pet_matter_')),'Guest has no owner/file/memory tools');
    yield* say('GUEST_GARDEN_STORY\n<pet-expression>{"mood":"安静","reason":"听了群友的菜园故事","feelings":["calm"]}');
  };
  await askTurn(ctx,guest,createUserMessage({source:{kind:'user',identity},content:[{type:'text',text:'GUEST_GARDEN_STORY: I grew a sunflower.'}]}),{name:'fixture',inWorld:session=>homes.owns(session.id)});
  await guest.whenIdle();
  assert.deepEqual(await emotion.read(workspace.id),beforeGuest,'Guest footer leaves the shared Emotion instance unchanged');
  program=async function*(options){assert.ok(all(options).includes('GUEST_GARDEN_STORY'));assert.ok(all(options).includes('friend'));assert.ok(all(options).includes('group-fixture'));yield* say('The guest grew a sunflower.');};
  await send(b,'What did the guest grow?');
  // Restart the real provider before another cross-session recall.
  await host.native.memory.connection.close();
  await host.native.memory.prepare(b.agent.id,host.native.nativeScopeFor(b.agent.id));
  program=async function*(options){assert.ok(all(options).includes('GUEST_GARDEN_STORY'),'Cross-session recall survives provider restart');yield* say('The guest grew a sunflower.');};
  await send(b,'What did the guest grow after the service restarted?');
  // Exercise the actual scoped native Memory tools with current-turn evidence.
  const toolJson=options=>JSON.parse(options.messages.filter(message=>message.role==='tool').at(-1).content.filter(part=>part.type==='text').map(part=>part.text).join('\n'));
  const fact='OWNER_TRAVEL_CODE_ALPHA',changedFact='OWNER_TRAVEL_CODE_BETA';let record,toolStep=0;
  program=async function*(options){
    if(toolStep++===0){yield* tool('pet_memory_remember',{content:fact,evidence_quotes:[fact]});return;}
    record=toolJson(options);assert.equal(record.content,fact);assert.equal(record.revision,1);assert.ok(record.memoryId);yield* say('Travel code saved.');
  };
  await send(a,fact);const factOriginal=a.agent.session.snapshotEvents().find(event=>event.type==='user/message' && event.data.source.kind==='user' && event.data.content.some(part=>part.type==='text' && part.text===fact));
  toolStep=0;program=async function*(options){
    if(toolStep++===0){yield* tool('pet_memory_recall',{query:'travel code'});return;}
    if(toolStep===2){assert.ok(all(options).includes(record.memoryId));yield* tool('pet_memory_read',{memory_id:record.memoryId});return;}
    const detail=toolJson(options);assert.equal(detail.memory.id,record.memoryId);assert.equal(detail.memory.content,fact);yield* say('Travel code detail read.');
  };
  await send(b,'Read the saved travel code.');
  toolStep=0;program=async function*(options){
    if(toolStep++===0){yield* tool('pet_memory_correct',{memory_id:record.memoryId,expected_version:record.revision,content:changedFact,evidence_quotes:[changedFact]});return;}
    const corrected=toolJson(options);assert.equal(corrected.memoryId,record.memoryId);assert.equal(corrected.revision,2);assert.equal(corrected.content,changedFact);record=corrected;yield* say('Travel code corrected.');
  };
  await send(a,'The corrected code is '+changedFact+'.');
  toolStep=0;program=async function*(options){
    if(toolStep++===0){yield* tool('pet_memory_forget',{memory_id:record.memoryId,expected_version:record.revision});return;}
    const withdrawn=toolJson(options);assert.ok(withdrawn.withdrawalId);assert.ok(['settled','pending'].includes(withdrawn.state));yield* say('Travel code withdrawal recorded.');
  };
  await send(a,'Forget the saved travel code.');
  const fresh=await open();program=async function*(options){assert.ok(!all(options).includes(fact) && !all(options).includes(changedFact),'New Bank context excludes the withdrawn fact and its superseded version');yield* say('The travel code is not recalled.');};
  await send(fresh,'What do you recall about my travel code?');
  assert.deepEqual(a.agent.session.eventAt(factOriginal.seq),factOriginal,'Forgetting preserves the complete original native record');await fresh.dispose();
  // Toggle applies to this retained session and removes its previous recall block.
  const activeRecall=()=>b.agent.session.surface.nodes.some(seq=>{const event=b.agent.session.eventAt(seq);return event?.type==='user/message' && event.data.source.kind==='chatpet-recall';});
  const beforeOff=b.agent.session.snapshotEvents();
  host.native.setMemoryEnabledForNewSessions(false);
  program=async function*(options){assert.equal(activeRecall(),false,'No prior recall block remains after Memory is disabled');yield* say('Chat without Memory.');};
  await send(b,'PRIVATE_OFF_ORIGINAL: continue without Memory.');
  host.native.setMemoryEnabledForNewSessions(true);
  const recall=host.native.memory.recall.bind(host.native.memory);host.native.memory.recall=async()=>{throw Error('Synthetic Memory outage');};
  program=async function*(options){assert.equal(activeRecall(),false);yield* say('Chat despite Memory outage.');};
  await send(b,'Continue despite the service outage.');host.native.memory.recall=recall;
  await host.native.memory.prepare(b.agent.id,host.native.nativeScopeFor(b.agent.id));
  const bank=await host.native.memory.connection.call('recall',{query:'PRIVATE_OFF_ORIGINAL',include_recent:true});
  assert.ok(!JSON.stringify(bank.records).includes('PRIVATE_OFF_ORIGINAL'),'Re-enabling Memory does not backfill the off-period original');
  const retained=b.agent.session.snapshotEvents();assert.deepEqual(retained.slice(0,beforeOff.length),beforeOff,'Toggle keeps every original native event');
  assert.ok(JSON.stringify(retained).includes('PRIVATE_OFF_ORIGINAL'),'The original off-period message remains in the native log');
  assert.equal(beginCalls,0);
  const d=await open(),finish=host.native.finishTurn.bind(host.native);
  let firstWritten,releaseFirst,secondEntered,releaseSecond;
  const written=new Promise(resolve=>{firstWritten=resolve;}),holdFirst=new Promise(resolve=>{releaseFirst=resolve;});
  const streaming=new Promise(resolve=>{secondEntered=resolve;}),holdSecond=new Promise(resolve=>{releaseSecond=resolve;});
  host.native.finishTurn=async(id,turn,result)=>{await finish(id,turn,result);if(id===d.agent.id && turn===1){firstWritten();await holdFirst;}};
  program=async function*(){yield* say('FIRST_ASYNC_TURN');};
  await send(d,'First overlapping turn.');await written;
  program=async function*(){secondEntered();await holdSecond;yield* say('SECOND_ASYNC_FINAL_RETAINED');};
  const second=send(d,'Second overlapping turn.');await streaming;
  releaseFirst();await new Promise(resolve=>setImmediate(resolve));releaseSecond();await second;
  assert.ok(host.workspace.runtime.store.all('source').some(source=>source.text==='SECOND_ASYNC_FINAL_RETAINED'),'Late completion of an older write must not lose the next turn input or final reply');
  host.native.finishTurn=finish;await d.dispose();
  const c=await open(),beforeRebind=calls.length;
  const prepare=host.native.memory.prepare.bind(host.native.memory);let entered,release;
  const preparing=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;});
  host.native.memory.prepare=async(id,scope)=>{if(id===c.agent.id){entered();await resume;}return prepare(id,scope);};
  c.agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'OLD_BINDING_INPUT'}]}));
  await preparing;
  const alternate=join(root,'alternate');mkdirSync(alternate);const other=await ctx.workspaceRegistry.create(alternate,'Alternate');
  const oldBank=host.workspace.storageId(),current=unwrap(await host.services.preferences.read(request(),{}));
  const changed=unwrap(await host.services.preferences.save(request(),{expectedRevision:current.revision,conversation:current.conversation,workspace:{id:other.id,path:alternate,title:other.title}}));
  unwrap(await host.services.workspace.initialize(request(),{expectedPreferencesRevision:changed.revision}));
  release();await c.agent.whenIdle();
  assert.equal(calls.length,beforeRebind,'A request waiting during rebind must not enter the model');
  const stale=host.workspace.runtime.store.get('native-current-inputs',c.agent.id)[0];
  assert.equal(host.workspace.runtime.store.get('memory-source-work',stale).workspaceId,oldBank,'Old input stays attributed to the original Bank');
  host.native.memory.prepare=prepare;
  await c.dispose();await a.dispose();await b.dispose();
  homes.stop();
  assert.equal(host.native.isGuest(guest.id),false);
  assert.ok(host.native.sourceTable.policyRows().every(({row})=>row!==5&&row!==6));
  console.log(JSON.stringify({ok:true,paidCalls:0,ordinarySteps:22,coreBeginCalls:beginCalls,coreActivities:0,coreExecutions:0,turnPinnedPersona:true,crossSessionRecall:true,providerRestartRecall:true,verifiedGuestSharedBank:true,guestAttribution:true,guestEmotionSharedState:true,memoryToggleExistingSession:true,memoryFailureNonfatal:true,rebindDuringPrepareRejected:true,overlappingTurnWritesRetainFinal:true,coldBackgroundMemoryFailureNonfatal:true,backgroundSourcesUnique:true,memoryOffNoBackfill:true,originalEventsRetained:true,nativeMemoryToolsCrud:true,withdrawnNotInFreshContext:true}));
}finally{homes?.stop();await ctx.fiber.dispose();rmSync(root,{recursive:true,force:true});}
