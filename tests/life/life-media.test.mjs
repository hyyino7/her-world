import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {verifyLifeMedia} from '../../scripts/build/build-life-media.mjs';
import {animationMapURL,loadPlayback} from '../fixtures/playback.mjs';
import {roomAsset} from '../../dist/src/room/assets.js';
import {PetPlatform} from '../../dist/src/desktop/platform/plugin.js';
const {animationAssets}=await import(animationMapURL);
const {resolveActivityPlayback,sampleActivityPlayback}=await loadPlayback();
const upstream=createRequire(import.meta.url)('../../vendor/dsh-pet/platform/runtime.mjs');
const inventory=verifyLifeMedia();
const source=readFileSync('vendor/feiyu-room-template/public/room/app.js','utf8');
const ast=ts.createSourceFile('app.js',source,ts.ScriptTarget.Latest,true);
const clip=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='clipFor').getText(ast);
function choose(her,behavior={}){
  return runInNewContext('('+clip+')(her)',{her,state:{her,behavior,hour:12},Date,resolveActivityPlayback,sampleActivityPlayback,
    petActionOverride:{clip:'dance',until:Date.now()+10000},opinionClip:'eat_snack',opinionUntil:Date.now()+10000,
    sleepPhase:'loop',isSideRun:()=>false,isBackView:()=>false});
}
for(const entry of inventory.animations)test('life media is shared byte-for-byte with Room: '+entry.id,async()=>{
  for(const file of [entry.file,entry.poster.file]){
    const response=await roomAsset(new Request('http://localhost/chatpet-room/assets/pet/'+file));
    assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),readFileSync('src/desktop/assets/'+file));
    const range=await roomAsset(new Request('http://localhost/chatpet-room/assets/pet/'+file,{headers:{Range:'bytes=0-3'}}));
    assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,4);
  }
});
for(const [kind,id] of [['drink','life-drink'],['garden_till','life-garden-till'],['garden_plant','life-garden-plant'],
 ['garden_water','life-garden-water'],['garden_fertilize','life-garden-fertilize'],['garden_harvest','life-garden-harvest'],
 ['garden_sell','life-trade'],['garden_buySeed','life-trade'],['garden_buyCompost','life-trade']])test('Room actual '+kind+' precedes cosmetic or TV clips',()=>assert.equal(choose({kind}),id));
test('Room reading needs the same actual content-offer state as Desktop',()=>{
  assert.equal(choose({kind:'planned',activity:'I read every book'},{presentationKind:'reading-wait',readingState:'unread'}),'idle');
  assert.equal(choose({kind:'planned'},{presentationKind:'read',readingState:'offered'}),'life-read');
  assert.equal(choose({kind:'planned'},{presentationKind:'read',readingState:'confirmed'}),'idle');
  assert.equal(choose({kind:'planned',walking:true},{presentationKind:'read',readingState:'offered'}),'mapped-walk');
  assert.equal(choose({kind:'planned',asleep:true,spot:'bed'},{presentationKind:'read',readingState:'offered'}),'sleep_loop');
});
test('Room media alias never exposes arbitrary desktop uploads or private paths',async()=>{
  for(const name of ['assets/pet/other.webm','assets/pet/life-secret.png','assets/pet/%2e%2e%2fcore.json','assets/pet/life-animations.json']){
    const response=await roomAsset(new Request('http://localhost/chatpet-room/'+name));assert.equal(response.status,404);
  }
});
test('the real Room action-bar entry cannot replace a bound activity or cancel its route',()=>{
  const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='playPetAction').getText(ast);
  for(const kind of ['planned','drink','garden_water','walk','idle']) {
    const calls=[],messages=[];
    runInNewContext('('+fn+')("dance","Preview")',{state:{her:{kind,walking:kind==='walk'},behavior:{bootId:'body'}},
      toast:text=>messages.push(text),charMode:'webm',actor:{setClip:()=>calls.push('play')},act:()=>calls.push('domain'),
      setBubble:()=>calls.push('bubble'),setTimeout:()=>calls.push('timer')});
    assert.deepEqual(calls,[]);assert.equal(messages.length,1);
  }
});
for(const kind of ['walk','drink','planned','garden_water'])test('real Room synchronization replaces an obsolete wake transition with '+kind,()=>{
  const sync=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='syncCharacter').getText(ast),played=[];
  const scope={resolveActivityPlayback,sampleActivityPlayback,state:{her:{kind,walking:kind==='walk',asleep:false,spot:'free',pos:[1,1]},
    behavior:{bootId:'body',presentationKind:'read',readingState:'offered'}},lastSleep:true,sleepPhase:'out',
    petActionOverride:{clip:'dance',until:Date.now()+10000},opinionClip:'eat_snack',opinionUntil:Date.now()+10000,
    isSideRun:()=>false,isBackView:()=>false,ONCE:new Set(),lastOnceKey:'',lastOnceAt:0,Date,
    actor:{current:'sleep_out',setPlayback(value){const name=sampleActivityPlayback(value).roomClip;if(this.current!==name){played.push(name);this.current=name;}},setClip(name){played.push(name);this.current=name;}},model3d:null,chibi:null};
  runInNewContext(clip+'\n'+sync+'\nsyncCharacter();syncCharacter();',scope);
  assert.deepEqual(played,[kind==='walk'?'mapped-walk':kind==='drink'?'life-drink':kind==='planned'?'life-read':'life-garden-water']);
  assert.equal(scope.sleepPhase,'none');
});
test('shared idle never rotates into a time/hash-driven physical animation',()=>{
  assert.equal(choose({kind:'idle',spot:'room-name',pose:'stand'},{bootId:'body'}),'idle');
});
for(const location of ['user-root','per-pack'])test('Desktop reserved life media uses the same installed bytes despite '+location+' collisions',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'life-media-priority-'));
  const petDir=join(dir,'pet'),userRoot=join(dir,'main-animation','webm');mkdirSync(petDir,{recursive:true});mkdirSync(userRoot,{recursive:true});
  const ownDir=join(petDir,'main-animation');if(location==='per-pack')mkdirSync(ownDir);
  const platform=new PetPlatform({petCore:{workspace:{runtime:{config:{}}}},petDesktop:{}});
  platform.ensure=()=>{};platform.directory=dir;
  let routed=0;
  const nativeRoute=upstream.createHttpRoute({petConfigDir:petDir,userRootFor:()=>userRoot,assetRootFor:()=>join(dir,'missing')}).handlePetRoute;
  platform.router=(...args)=>{routed++;return nativeRoute(...args);};
  try{
    for(const entry of inventory.animations){
      const collision=join(location==='per-pack'?ownDir:userRoot,entry.label+'.webm');writeFileSync(collision,'user data remains untouched');
      for(const method of ['GET','HEAD']){
        const response=await platform.handle(new URL('http://localhost/chatpet-presentation/thumb/main/'+encodeURIComponent(entry.label)+'.webm'),method,undefined,new AbortController().signal);
        assert.equal(response.kind,'file');assert.deepEqual(readFileSync(response.file),readFileSync('src/desktop/assets/'+entry.file));
      }
      assert.equal(readFileSync(collision,'utf8'),'user data remains untouched');
    }
    assert.equal(routed,0,'Reserved immutable names are served before upstream user-file routing');
    const ordinary=join(location==='per-pack'?ownDir:userRoot,'custom.webm');writeFileSync(ordinary,'custom animation');
    const response=await platform.handle(new URL('http://localhost/chatpet-presentation/thumb/main/custom.webm'),'GET',undefined,new AbortController().signal);
    assert.equal(readFileSync(response.file,'utf8'),'custom animation');assert.equal(routed,1);
    platform.scope.abort();const stale=await platform.handle(new URL('http://localhost/chatpet-presentation/thumb/main/'+encodeURIComponent(inventory.animations[0].label)+'.webm'),'GET',undefined,new AbortController().signal);
    assert.equal(stale.status,409,'The immutable-file fast path retains binding lifetime rejection');
  }finally{platform.close();rmSync(dir,{recursive:true,force:true});}
});

test('shared original clip bytes cannot be shadowed by custom same-name files',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'shared-original-media-'));
  const root=join(dir,'pet','main-animation');mkdirSync(root,{recursive:true});
  const platform=new PetPlatform({petCore:{workspace:{runtime:{config:{}}}},petDesktop:{}});
  platform.ensure=()=>{};platform.directory=dir;
  platform.behavior={her:{kind:'eat'},behavior:{activityId:'meal',phase:'working'}};
  platform.router=()=>{throw Error('Shared original media must use its installed route');};
  try{
    writeFileSync(join(root,'吃白饭.webm'),'custom bytes remain untouched');
    const response=await platform.handle(new URL('http://localhost/chatpet-presentation/thumb/main/'+encodeURIComponent('吃白饭')+'.webm'),'GET',undefined,new AbortController().signal);
    assert.equal(response.kind,'file');assert.deepEqual(readFileSync(response.file),readFileSync('src/desktop/assets/吃白饭.webm'));
    assert.equal(readFileSync(join(root,'吃白饭.webm'),'utf8'),'custom bytes remain untouched');
  }finally{platform.close();rmSync(dir,{recursive:true,force:true});}
});
test('Room serves the common compiled timeline and original pout clip through fixed aliases',async()=>{
  const response=await roomAsset(new Request('http://localhost/chatpet-room/activity-playback.js'));
  assert.equal(response.status,200);const code=await response.text();assert.match(code,/export function resolveActivityPlayback/);assert.match(code,/export function sampleActivityPlayback/);
  const reaction=await roomAsset(new Request('http://localhost/chatpet-room/assets/pet/react_pout.webm'));
  assert.equal(reaction.status,200);assert.deepEqual(Buffer.from(await reaction.arrayBuffer()),readFileSync('src/desktop/assets/点击回应-傲娇生气.webm'));
});

test('every canonical Room clip retains the exact Desktop bytes during later asset review',async()=>{
  const catalog=JSON.parse(readFileSync('src/desktop/assets/catalog.json','utf8'));
  const actorSource=readFileSync('vendor/feiyu-room-template/public/room/actor.js','utf8');
  const actorTree=ts.createSourceFile('actor.js',actorSource,ts.ScriptTarget.Latest,true);
  const declaration=actorTree.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations[0]?.name.getText(actorTree)==='CLIPS').getText(actorTree).replace('export const','const');
  const registered=runInNewContext(declaration+';CLIPS;',{animationAssets});
  const seen=new Set();
  for(const kind of ['idle','free','rest','walk','eat','sleep','wake','play','idle_look','garden_visit','react_happy','react_pout','react_shy','react_scare','drink','planned','desk','nap','garden_till','garden_plant','garden_water','garden_fertilize','garden_harvest','garden_sell','garden_buySeed','garden_buyCompost']){
    const value=resolveActivityPlayback({her:{kind,asleep:kind==='sleep',spot:kind==='sleep'?'bed':'free'},behavior:{startedAt:1000,presentationKind:'read',readingState:'offered'}});
    for(const part of value.segments){
      if(seen.has(part.roomClip))continue;seen.add(part.roomClip);
      const file=catalog.actions.find(row=>row.label===part.desktopClip)?.file;assert.ok(file,part.desktopClip);
      const response=await roomAsset(new Request('http://localhost/chatpet-room/'+registered[part.roomClip]));
      assert.equal(response.status,200,part.roomClip);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),readFileSync('src/desktop/assets/'+file),part.roomClip+' must share Desktop content');
    }
  }
  assert.ok(seen.has('sleep_in') && seen.has('life-read') && seen.has('eat_rice'));
});
