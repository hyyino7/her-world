import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {compiledURL,loadPlayback} from '../fixtures/playback.mjs';
import {createRequire} from 'node:module';
import {createContext,runInContext} from 'node:vm';
import ts from 'typescript';

const {resolveActivityPlayback,sampleActivityPlayback}=await loadPlayback();
const {CompanionRoom}=await import(compiledURL('living/body/room.js'));
const {CompanionBehavior}=await import(compiledURL('living/body/plugin.js'));
const {PetPlatform}=await import(compiledURL('desktop/platform/plugin.js'));
const {DesktopFeatures}=await import(compiledURL('desktop/features.js'));
const {DEFAULT_COMPANION_SETTINGS}=await import(compiledURL('core/companion-settings.js'));
const upstream=createRequire(import.meta.url)(resolve('vendor/dsh-pet/platform/runtime.mjs'));
const native=readFileSync('vendor/dsh-pet/platform/runtime/electron-helper/events.js','utf8');
const web=readFileSync('src/desktop/platform/client.js','utf8');
const source=readFileSync(new URL('../behavior/activity-playback-carriers.test.mjs',import.meta.url),'utf8');
const tree=ts.createSourceFile('fixture.mjs',source,ts.ScriptTarget.Latest,true);
function fixture(name) {
  const node=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name||ts.isClassDeclaration(n)&&n.name?.text===name||
    ts.isVariableStatement(n)&&n.declarationList.declarations.some(row=>row.name.getText(tree)===name));
  assert.ok(node,'Carrier fixture changed: '+name);return node.getText(tree);
}
const context=createContext({native,web,readFileSync,createContext,runInContext,ts,assert,console,Event,EventTarget});
runInContext(['declaration','clock','Video','descriptor','harness','release'].map(fixture).join('\n')+'\nglobalThis.fixture={declaration,harness,descriptor,release};',context);
const {declaration,harness,descriptor,release}=context.fixture;
function webCardClick() {
  const tree=ts.createSourceFile('client.js',web,ts.ScriptTarget.Latest,true);let found;
  function visit(node) {
    if(ts.isPropertyAssignment(node)&&node.name.getText(tree)==='onClick'
      &&node.initializer.getText(tree).includes('drag.justDragged()'))found=node.initializer.getText(tree);
    if(!found)ts.forEachChild(node,visit);
  }
  visit(tree);assert.ok(found,'Original card click boundary changed');return found;
}
const cardClickSource=webCardClick();

function tap(kind,submit=async()=>true) {
  const h=harness(kind),sent=[],pending=[],squashes=[],sounds=[];let sequence=0;
  h.context.crypto={randomUUID:()=>kind+'-actual-click-'+(++sequence)};
  const post=(url,payload)=>{sent.push({url,payload});const promise=Promise.resolve().then(()=>submit(url,payload));pending.push(promise);return promise;};
  let click,setClicks,setFrozen,setPending,pendingSquash,drag,setSleeping;
  if(kind==='native') {
    Object.assign(h.context,{BASE:'/presentation',ORIGIN:'http://fixture',isOpenShortcut:e=>Boolean(e?.ctrlKey||e?.metaKey),playClickSound:()=>sounds.push('click')});
    h.context.window.petBridge={openDshSite(){}};h.context.S.postAction=post;
    runInContext(readFileSync('vendor/dsh-pet/platform/runtime/electron-helper/sprite/input.js','utf8'),h.context);
    Object.assign(h.sprite,{dragState:{active:false,dragging:false},justDragged:false,pressScoreFired:false,
      pendingSquash:false,startSquash:video=>squashes.push(video)});
    h.sprite.animations.clicks=['legacy-click'];
    click=event=>h.sprite.onClick(event||{});setClicks=clips=>{h.sprite.animations.clicks=clips;};
    setFrozen=on=>{h.sprite.frozen=on;};setPending=on=>{h.sprite.pendingSquash=on;};pendingSquash=()=>h.sprite.pendingSquash;
    setSleeping=on=>{h.sprite.sleeping=on;h.sprite.sleepPhase=on?'loop':null;};
  } else {
    Object.assign(h.context,{ROUTE_PATH:'/presentation',postAction:post,performance:{now:h.c.now},
      IDLE_PRESS:{active:false,dragging:false},JUST_DRAGGED_MS:100,SLINGSHOT_DOUBLE_MS:200,
      createDragFollow:()=>({stop(){},aim(){},start(){}}),createTouchPress:()=>({arm(){},cancel(){},move(){}}),
      noteGrab:()=>false,playClickSound:()=>sounds.push('click'),pick:items=>items[0],log$1(){}});
    h.context.window.addEventListener=()=>{};h.context.window.removeEventListener=()=>{};
    runInContext(declaration(web,'createDrag')+'\n'+declaration(web,'createCardDrag')+'\nglobalThis.makeDrag=createCardDrag;',h.context);
    const squash={current:false},live={current:{ownAnim:h.player,flow:{sleeping:()=>false},releaseLock(){},tipOn:()=>false}},cfgRef={get current(){return h.cfg();}};
    drag=h.context.makeDrag({useRef:value=>({current:value}),useEffect(){}})({cfgRef,live,pendingSquash:squash,
      motion:{metrics:()=>({size:100,halfW:50,halfH:30}),stopMove(){},flight:{stop(){},isFlying:()=>false},box:()=>null},
      card:{animRef:{current:'accepted'}},root:()=>null,setAnim:()=>assert.fail('Managed tap must not select legacy click media'),
      setOnce:()=>assert.fail('Managed tap must not restart the animation cue'),setTipOn(){},bumpSeq:()=>assert.fail('Managed tap must not bump animation sequence')});
    h.cfg().animations.clicks=['legacy-click'];h.cfg().animations.drag=[];
    let sleepPhase=null;
    Object.assign(h.context,{drag,ownAnim:h.player,cfg:h.cfg(),cfgRef,liveRef:{current:{flow:{sleepPhase:()=>sleepPhase},squash:{start:video=>squashes.push(video)}}}});
    runInContext('globalThis.cardClick='+cardClickSource+';',h.context);
    click=event=>h.context.cardClick(event||{});setClicks=clips=>{h.cfg().animations.clicks=clips;};
    setFrozen=on=>h.player.setFrozen(on);setPending=on=>{squash.current=on;};pendingSquash=()=>squash.current;
    setSleeping=on=>{sleepPhase=on?'loop':null;};
  }
  return {...h,sent,sounds,squashes,click,drag,setClicks,setFrozen,setPending,pendingSquash,setSleeping,
    async settled(){await Promise.all(pending);}};
}

for(const kind of ['native','web']) {
  test(kind+': actual managed click sends one care operation and keeps the current movie',async()=>{
    const h=tap(kind);h.start();h.ready();const loads=h.a.loads+h.b.loads,at=h.front().currentTime;
    h.click();await h.settled();assert.equal(h.sent.length,1);assert.equal(h.sent[0].payload.path,'/pet');
    assert.equal(h.sent[0].payload.method,'POST');assert.equal(JSON.parse(h.sent[0].payload.body).requestId,kind+'-actual-click-1');
    assert.equal(h.a.loads+h.b.loads,loads);assert.equal(h.front().currentTime,at);assert.equal(h.pendingSquash(),false);
    assert.equal(h.squashes.length,0);assert.equal(h.sounds.length,1);
    h.click();await h.settled();assert.equal(JSON.parse(h.sent[1].payload.body).requestId,kind+'-actual-click-2');
  });
  test(kind+': care still works with no legacy click movie and a held lock admits no care',async()=>{
    const h=tap(kind);h.start();h.ready();h.setClicks([]);h.click();await h.settled();assert.equal(h.sent.length,1);
    h.setFrozen(true);h.click();await h.settled();assert.equal(h.sent.length,1);assert.equal(h.pendingSquash(),false);
  });
  test(kind+': shortcut-modified clicks do not become owner care',async()=>{
    const h=tap(kind);h.start();h.ready();h.click({ctrlKey:true});h.click({metaKey:true});await h.settled();assert.equal(h.sent.length,0);
  });
  test(kind+': the actual shared sleeping descriptor requests wake without a second pet fact',async()=>{
    const h=tap(kind);h.set({...descriptor('sleep',100000),kind:'sleep'});h.start();h.ready();h.setSleeping(true);h.click();await h.settled();
    assert.equal(h.sent.length,1);
    if(kind==='native'){assert.match(h.sent[0].url,/\/wake\?pet=main$/);assert.equal(h.sent[0].payload,undefined);}
    else {assert.equal(h.sent[0].payload.path,'/wake');assert.ok(JSON.parse(h.sent[0].payload.body).requestId);}
  });
}

test('native: original drag and score guards admit no care, and no click squash leaks to later playback',async()=>{
  const h=tap('native');h.start();h.ready();
  h.sprite.dragState.active=true;h.click();h.sprite.dragState.active=false;h.sprite.justDragged=true;h.click();
  h.sprite.justDragged=false;h.sprite.pressScoreFired=true;h.click();await h.settled();assert.equal(h.sent.length,0);
  h.click();await h.settled();h.set(descriptor('unrelated-next-phase',h.c.now()));h.player.refreshCompanion();h.ready();
  assert.equal(h.squashes.length,0);h.setPending(true);h.player.refreshCompanion();assert.equal(h.pendingSquash(),false);
  h.setPending(true);await release(h,'native');h.ready();assert.equal(h.pendingSquash(),false);assert.equal(h.squashes.length,0);
});
test('web: original active press guard rejects care',async()=>{
  const h=tap('web');h.start();h.ready();const hit={classList:{add(){}},setPointerCapture(){}};
  h.drag.onPointerDown({button:0,clientX:10,clientY:10,currentTarget:hit,pointerId:1,pointerType:'mouse'});
  h.click();await h.settled();assert.equal(h.sent.length,0);
});
test('web: the actual card adapter clears old click squash on shared application and release',()=>{
  const h=harness('web'),effects=[],squashes=[],pendingSquash={current:true};let player;
  Object.assign(h.context,{createOwnAnimation:deps=>(player=h.context.make(deps)),petBridge:{reload(){}},registerPose:()=>()=>{},registerProgress:()=>()=>{}});
  h.context.window.addEventListener=()=>{};h.context.window.removeEventListener=()=>{};
  runInContext(declaration(web,'createCardAnimation')+'\nglobalThis.makeCardAnimation=createCardAnimation;',h.context);
  const cfgRef={current:h.cfg()},input={cfgRef,pendingSquash,petId:'main',workStatusRef:{current:null},
    card:{state:{anim:'initial',cuePlayback:null,once:false,seq:0},animRef:{current:'initial'},facingRef:{current:'right'},actions:{setCustomPos(){}}},
    live:{current:{center:()=>({x:0,y:0}),stopMove(){},drag:{stopFollow(){},isActive:()=>false},flight:{stop(){}},
      walk:{hasPending:()=>false},squash:{stop(){},start:video=>squashes.push(video)}}},
    videoA:()=>h.a,videoB:()=>h.b,report(){},setCuePlayback(){}};
  h.context.makeCardAnimation({useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)})(input);
  const cleanups=effects.map(fn=>fn());h.ready();assert.equal(pendingSquash.current,false);assert.equal(squashes.length,0);
  pendingSquash.current=true;player.refreshCompanion();assert.equal(pendingSquash.current,false);
  pendingSquash.current=true;h.set(undefined);cfgRef.current=h.cfg();player.refreshCompanion();h.ready();
  assert.equal(pendingSquash.current,false);assert.equal(squashes.length,0);
  for(const cleanup of cleanups)cleanup?.();player.dispose();
});

function integration(t,feeling='sweet',activityKind='hold') {
  const dir=mkdtempSync(join(tmpdir(),'mapped-tap-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  t.mock.timers.enable({apis:['Date'],now:100000});mkdirSync(join(dir,'pet'));
  const room=new CompanionRoom(dir,()=>({feelings:[feeling],updatedAt:99000}));
  Object.assign(room.state,{room:'living',spot:'sofa',route:null,dwell:null,command:null,freeTarget:null,asleep:false,sleepPending:false,
    kind:'idle',activity:'Quiet rest',reactionUntil:0,lastTickAt:100000,needs:{hunger:.2,thirst:.2,energy:.8,bladder:.1,pain:0}});
  room.startPlanned({operationId:'tap-rest',kind:activityKind,...(activityKind==='room'?{room:'living',spot:'sofa'}:{}),activity:'Sustained actual rest',until:new Date(200000).toISOString()},100000);
  const frames=[],writes=[],calls=[],binding={id:'fixture',path:dir,storageId:'fixture'};
  const projection=Object.create(CompanionBehavior.prototype);
  Object.assign(projection,{binding:{room},bootId:'fixture-body',revision:0});
  const snapshot=()=>projection.presentHome(room.view(Date.now()));
  const behavior={roomState:async()=>snapshot(),restState:()=>({sleeping:room.state.asleep,pending:room.state.sleepPending}),
    roomAction:async(id,input,by,interaction)=>{calls.push({id,input,by,interaction});return room.act(input,by,Date.now(),interaction);}};
  const host={workspace:{status:()=>({state:'ready',target:binding}),storageId:()=>binding.storageId,companionSettings:()=>DEFAULT_COMPANION_SETTINGS,
    runtime:{config:{ownerActorId:'trusted-owner',companionId:'fixture-fish'},identity:()=>({displayName:'Fixture'})}}};
  const ctx={petCore:host,petDesktop:{},get:name=>name==='petBehavior'?behavior:undefined,logger:()=>({warn(){},info(){}})};
  const features=new DesktopFeatures(ctx,host,(type,value)=>frames.push({type,value}),()=>false,()=>false);ctx.petDesktop.features=features;
  const platform=new PetPlatform(ctx);platform.ensure=()=>{};platform.bound=binding;
  const configPaths={defaultFile:resolve('vendor/dsh-pet/platform/assets/config.jsonc'),userFile:join(dir,'main.json'),legacyUserFile:join(dir,'old.json'),petDir:join(dir,'pet')};
  const own=upstream.readAllConfig(configPaths).main.pets[0];platform.pets=()=>[own];
  platform.setup={configPaths,playback:{cancelAll(){}},state:{cancelAll(){},writeSection(){},writePet:(id,key,value)=>writes.push({id,key,value})}};
  platform.lookup=upstream.createPetLookup({configPaths,state:platform.setup.state});
  t.after(async()=>{platform.close();await features.close();room.flush();});
  const request=async(payload,actorKind='owner')=>{const reply=await platform.handle(new URL('http://fixture/chatpet-presentation/native-feature?pet=main'),'POST',JSON.stringify(payload),new AbortController().signal,actorKind);assert.equal(reply.status,200);return reply.obj;};
  return {room,snapshot,features,platform,frames,writes,calls,request};
}
for(const kind of ['native','web'])test('Body integration '+kind+': generated click retains a trusted fact and shared key without sleep publications',async t=>{
  const f=integration(t),before=resolveActivityPlayback(f.snapshot());
  const h=tap(kind,async(_url,payload)=>{await f.request({...payload,actor:{kind:'system',id:'untrusted-input'}});return true;});
  h.set(before);h.start();h.ready();const loads=h.a.loads+h.b.loads;
  h.click();await h.settled();const after=resolveActivityPlayback(f.snapshot());
  assert.equal(after.key,before.key);assert.deepEqual(after.segments,before.segments);assert.ok(after.feedback);
  assert.equal(f.calls[0].interaction.requestId,JSON.parse(h.sent[0].payload.body).requestId);
  assert.deepEqual(f.calls[0].interaction.actor,{kind:'owner',id:'trusted-owner',channel:'desktop'});
  assert.equal(f.room.pendingFacts().length,1);assert.equal(f.room.pendingFacts()[0].actor.kind,'owner');
  assert.equal(f.frames.length,0,'Pet care cannot publish sleep-text, sleep or unrelated notices');
  h.set(after);h.player.refreshCompanion();assert.equal(h.a.loads+h.b.loads,loads);
  await f.platform.readBehavior();assert.equal(f.writes.filter(x=>x.key==='say').at(-1).value.text,after.feedback.text);
  await f.request(h.sent[0].payload);assert.equal(f.room.pendingFacts().length,1,'Transport retry uses the original operation id');
  assert.equal(f.room.state.counts.pet,1);
});


test('web: actual descriptor sleep/awake owns tap intent despite a stale independent sleep leaf',async()=>{
  for(const [kind,oldLeaf,wanted] of [['sleep',false,'/wake'],['read',true,'/pet']]){
    const h=tap('web');h.set({...descriptor('truth-'+kind,100000),kind});h.start();h.ready();h.setSleeping(oldLeaf);
    h.click();await h.settled();assert.equal(h.sent.length,1);assert.equal(h.sent[0].payload.path,wanted);
    assert.equal(h.squashes.length,0);assert.equal(h.pendingSquash(),false);
    h.click({metaKey:true});h.setFrozen(true);h.click();await h.settled();assert.equal(h.sent.length,1);
  }
});

test('Body integration web: a real sleeping descriptor wakes through the existing owner care path exactly once',async t=>{
  const f=integration(t);f.room.cancelPlanned('tap-rest');
  f.room.startPlanned({operationId:'sleep',kind:'body',activity:'Actual sleep',action:'sleep',presentationSlot:'sleep.nap'});
  if(f.room.state.route){t.mock.timers.setTime(Math.ceil(f.room.state.route.arriveAt)+1);f.room.tick();}
  assert.equal(f.room.state.asleep,true);
  const h=tap('web',async(_url,payload)=>{await f.request(payload);return true;});
  h.set(resolveActivityPlayback(f.snapshot()));h.start();h.ready();h.setSleeping(false);h.click();await h.settled();
  assert.equal(h.sent.length,1);assert.equal(h.sent[0].payload.path,'/wake');assert.equal(f.room.state.asleep,false);
  assert.equal(f.calls[0].input.action,'wake');assert.equal(f.room.pendingFacts().filter(x=>x.type==='pet').length,0);
  assert.equal(f.room.pendingFacts().filter(x=>x.type==='wake').length,1);
  const energy=f.room.state.needs.energy;await f.request(h.sent[0].payload);
  assert.equal(f.room.state.needs.energy,energy);assert.equal(f.room.pendingFacts().filter(x=>x.type==='wake').length,1);
});


for(const action of ['feed','water'])for(const kind of ['native','web'])test('Body integration '+kind+': touch keeps an actual short '+action+' operation and its original deadline',async t=>{
  const f=integration(t);f.room.cancelPlanned('tap-rest');
  f.room.startPlanned({operationId:'short-'+action,kind:'body',activity:'Actual short care',action,
    presentationSlot:action==='feed'?'food.bowl':'drink.sequence'});
  const initial=structuredClone(f.room.state.companionAction),deadline=f.room.state.reactionUntil,original=resolveActivityPlayback(f.snapshot());
  assert.equal(original.kind,action==='feed'?'eat':'drink');
  const h=tap(kind,async(_url,payload)=>{await f.request(payload);return true;});h.set(original);h.start();h.ready();
  t.mock.timers.setTime(Date.now()+1000);h.click();await h.settled();
  const after=resolveActivityPlayback(f.snapshot());
  assert.equal(after.kind,original.kind);assert.equal(after.key,original.key);assert.deepEqual(after.segments,original.segments);
  assert.deepEqual(f.room.state.companionAction,initial);assert.equal(f.room.state.reactionUntil,deadline);
  assert.equal(after.feedback.id,f.room.pendingFacts().find(x=>x.type==='pet').id);
  await f.request(h.sent[0].payload);assert.equal(f.room.state.counts.pet,1);
  t.mock.timers.setTime(deadline+1);f.room.tick();assert.equal(f.room.state.kind,'idle');
});


test('web: shared sleep readers drive menus/keyboard and do not instantiate a second sleep/random machine',()=>{
  let current={companionPlayback:{kind:'sleep'}},created=0,applied=0,ended=0;
  const scope=createContext({createSleepMachine:()=>{created++;return {sleeping:()=>true,phase:()=> 'start',apply(){applied++;},consumeEnded(){ended++;return true;}};},log$2(){}});
  runInContext(declaration(web,'createAnimationFlow')+'\nglobalThis.make=createAnimationFlow;',scope);
  const flow=scope.make({useRef:value=>({current:value})})({cfg:()=>current},null);
  assert.equal(flow.sleeping(),true);assert.equal(flow.sleepPhase(),'loop');
  flow.applySleep({sleeping:false});flow.pickNext();flow.applyEndedCue({kind:'event-done'});flow.resumeWorkStatusAnim();
  assert.equal(created,0);assert.equal(applied,0);assert.equal(ended,0);
  current={companionPlayback:{kind:'read'}};assert.equal(flow.sleeping(),false);assert.equal(flow.sleepPhase(),null);
  flow.applySleep({sleeping:true});flow.applyEndedCue({kind:'ignore'});assert.equal(created,0);
  current={};flow.applySleep({sleeping:true});assert.equal(created,1);assert.equal(applied,1);
  assert.equal(flow.sleeping(),true);assert.equal(flow.sleepPhase(),'start');flow.applyEndedCue({kind:'ignore'});assert.equal(ended,1);
});


for(const activityKind of ['hold','room'])for(const kind of ['native','web'])test('frozen Body progress '+activityKind+'/'+kind+': a missed pause snapshot still resumes the actual combined clip at its saved active offset',t=>{
  const f=integration(t,'happy',activityKind),before=resolveActivityPlayback(f.snapshot()),h=tap(kind);
  h.a.duration=h.b.duration=30;h.set(before);h.start();h.ready();
  t.mock.timers.setTime(103000);f.room.pausePlanned('tap-rest');
  t.mock.timers.setTime(163000);f.room.resumePlanned('tap-rest');const resumed=resolveActivityPlayback(f.snapshot());
  assert.equal(resumed.startedAt,before.startedAt);assert.equal(resumed.pausedMs,60000);assert.notEqual(resumed.key,before.key);
  h.c.advance(63000);h.set(resumed);h.player.refreshCompanion();h.ready();
  const expected=sampleActivityPlayback(resumed,Date.now());assert.equal(expected.offsetMs,3000);
  assert.ok(Math.abs(h.front().currentTime-expected.offsetMs/1000)<.002);assert.equal(h.front().paused,false);
  assert.equal(sampleActivityPlayback(resumed,Date.now()).roomClip,sampleActivityPlayback(before,103000).roomClip);
});

for(const activityKind of ['hold','room'])test('frozen Body progress '+activityKind+'/Room: the real shared sample seeks the existing actor to its active offset after pause',t=>{
  const f=integration(t,'happy',activityKind),before=resolveActivityPlayback(f.snapshot());
  t.mock.timers.setTime(103000);f.room.pausePlanned('tap-rest');t.mock.timers.setTime(163000);f.room.resumePlanned('tap-rest');
  const resumed=resolveActivityPlayback(f.snapshot()),sample=sampleActivityPlayback(resumed,Date.now());
  const code=readFileSync('vendor/feiyu-room-template/public/room/actor.js','utf8'),tree=ts.createSourceFile('actor.js',code,ts.ScriptTarget.Latest,true);
  const actor=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name.text==='SpriteActor');
  const method=actor.members.find(node=>ts.isMethodDeclaration(node)&&node.name.getText(tree)==='alignPlayback').getText(tree);
  const scope=createContext({});runInContext('globalThis.methods={'+method+'};',scope);
  const layer={video:{duration:30,currentTime:0,paused:true,pause(){this.paused=true;}},mesh:{scale:{x:1}},play(){this.video.paused=false;}};scope.methods.alignPlayback.call({},layer,sample);
  assert.equal(layer.video.currentTime,3);assert.equal(layer.video.paused,false);assert.equal(layer.video.currentTime,sampleActivityPlayback(before,103000).offsetMs/1000);
});
