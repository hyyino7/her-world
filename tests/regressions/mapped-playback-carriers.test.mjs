import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext,runInNewContext} from 'node:vm';
import {animationMapSource,animationMapURL,compiledURL} from '../fixtures/playback.mjs';
import ts from 'typescript';

// Reuse the existing fake transport/video/clock fixture, while executing the
// actual generated carriers. Test helpers are not shipped application code.
const native=readFileSync('vendor/dsh-pet/platform/runtime/electron-helper/events.js','utf8');
const web=readFileSync('src/desktop/platform/client.js','utf8');
const fixtureSource=readFileSync(new URL('../behavior/activity-playback-carriers.test.mjs',import.meta.url),'utf8');
const fixtureTree=ts.createSourceFile('fixture.mjs',fixtureSource,ts.ScriptTarget.Latest,true);
function fixtureDeclaration(name) {
  const node=fixtureTree.statements.find(node=>
    ts.isFunctionDeclaration(node)&&node.name?.text===name ||
    ts.isClassDeclaration(node)&&node.name?.text===name ||
    ts.isVariableStatement(node)&&node.declarationList.declarations.some(value=>value.name.getText(fixtureTree)===name));
  assert.ok(node,'Carrier fixture boundary changed: '+name);return node.getText(fixtureTree);
}
const fixtureContext=createContext({native,web,readFileSync,createContext,runInContext,ts,assert,console,Event,EventTarget});
runInContext(['declaration','clock','Video','descriptor','harness','release'].map(fixtureDeclaration).join('\n')+'\nglobalThis.fixture={harness,descriptor,release};',fixtureContext);
const {harness,descriptor,release}=fixtureContext.fixture;
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
const mirrored=(key='mapped-left',at=99500)=>({...descriptor(key,at),segments:[{roomClip:'mapped-left',desktopClip:'原地左转奔跑',mode:'loop',durationMs:2000,mirror:true}]});

for(const carrier of ['native','web']) {
  test(carrier+': an explicit mapped mirror is applied and removed by the next real segment',()=>{
    const h=harness(carrier);h.set({...descriptor('turn-sequence',100000),segments:[
      {roomClip:'left',desktopClip:'原地左转奔跑',mode:'once',durationMs:1000,mirror:true},
      {roomClip:'walk',desktopClip:'原地漂浮踏步',mode:'loop',durationMs:2000,mirror:false},
    ]});
    h.start();h.ready();assert.equal(h.front().style.transform,'scaleX(-1)');
    h.c.advance(1000);h.ready();assert.equal(h.front().style.transform,'');
    assert.equal(h.front().paused,false);assert.equal(h.reports.length,0);
  });
  test(carrier+': mirrored playback survives visible refresh without reloading its movie',()=>{
    const h=harness(carrier);h.set(mirrored());h.start();h.ready();
    const loads=h.a.loads+h.b.loads,requests=h.requests.length;
    h.c.advance(250);h.player.refreshCompanion();
    assert.equal(h.a.loads+h.b.loads,loads);assert.equal(h.requests.length,requests);
    assert.equal(h.front().style.transform,'scaleX(-1)');
  });
  test(carrier+': hidden obsolete mirrored loads cannot overwrite a newer unmirrored activity',()=>{
    const h=harness(carrier);h.set(mirrored());h.start();h.document.hidden=true;h.player.suspendCompanion();
    if(carrier==='web')h.requests[0].onObjectUrl('blob:obsolete');else h.b.emit('loadeddata');
    h.document.hidden=false;h.set({...descriptor('new-walk',h.c.now()-300),segments:[{roomClip:'walk',desktopClip:'原地漂浮踏步',mode:'loop',durationMs:2000}]});
    h.player.refreshCompanion();h.ready();
    assert.equal(h.front().style.transform,'');assert.equal(h.front().paused,false);assert.equal(h.front().currentTime,.3);
  });
  test(carrier+': releasing managed playback retains the original custom-facing behavior',async()=>{
    const h=harness(carrier);h.start();h.ready();assert.equal(h.front().style.transform,'');
    await release(h,carrier);h.ready();
    assert.equal(h.front().style.transform,'scaleX(-1)');assert.equal(h.front().paused,false);
  });
}

async function assets() {
  if(!animationMapSource)return import(animationMapURL);
  return import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(
    readFileSync(animationMapSource,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
}
async function room() {return import(compiledURL('room/assets.js'));}
function roomDeclarations(animationAssets) {
  const source=readFileSync('vendor/feiyu-room-template/public/room/actor.js','utf8');
  const tree=ts.createSourceFile('actor.js',source,ts.ScriptTarget.Latest,true);
  const registry=tree.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations[0]?.name.getText(tree)==='CLIPS').getText(tree).replace('export const','const');
  const actor=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='SpriteActor').getText(tree).replace('export class','class');
  return {source,tree,registry,actor,animationAssets};
}

test('Room registry admits every mapped existing asset without generating new files',async()=>{
  const {animationAssets}=await assets(),code=roomDeclarations(animationAssets);
  const clips=runInNewContext(code.registry+'\nCLIPS;',{animationAssets});
  assert.equal(Object.keys(animationAssets).length,122);
  for(const asset of Object.values(animationAssets)){
    assert.equal(clips[asset.roomClip],'assets/pet/'+asset.roomClip+'.webm');
    assert.ok(readFileSync('src/desktop/assets/'+asset.file).byteLength>0);
  }
  assert.equal(clips.back_idle,'assets/pet/idle.webm','A legacy back alias does not fabricate a back-facing movie');
});

test('Room applies shared mirroring per layer while retaining the existing legacy flip input',async()=>{
  const {animationAssets}=await assets(),code=roomDeclarations(animationAssets);
  const context=createContext({animationAssets,performance:{now:()=>0}});
  runInContext('const LOOP_TRIM={};const POSTER={};'+code.registry+'\n'+code.actor+'\nglobalThis.Actor=SpriteActor;',context);
  const actor=Object.create(context.Actor.prototype);
  const vector=()=>({x:1,y:1,set(x,y){this.x=x;this.y=y;},distanceTo(){return 0;},copy(){},lerp(){}});
  const shadow=()=>({position:{set(){}},scale:{setScalar(){},set(){}},material:{opacity:0},visible:true});
  const layer=()=>({mesh:{scale:{x:1}},video:{duration:2,currentTime:0,paused:true,pause(){this.paused=true;}},play(){this.video.paused=false;},tick(){}});
  Object.assign(actor,{_time:0,_pos:vector(),_target:vector(),_elev:0,layers:[layer(),layer()],active:0,playback:{key:'accepted'},visible:true,
    group:{position:{set(){}},rotation:{}},floorShadow:shadow(),surfaceShadow:shadow()});
  actor.alignPlayback(actor.layers[0],{offsetMs:500,mode:'loop',mirror:true});
  actor.alignPlayback(actor.layers[1],{offsetMs:500,mode:'loop',mirror:false});
  actor.update(.016,{position:{x:0,z:2}},{pos:[1,1],flip:false});
  assert.equal(actor.layers[0].mesh.scale.x,-1);assert.equal(actor.layers[1].mesh.scale.x,1);
  actor.playback=null;actor.update(.016,{position:{x:0,z:2}},{pos:[1,1],flip:false});
  assert.ok(actor.layers.every(layer=>layer.mesh.scale.x===1));
});

test('all registered Room video and sticker routes serve the exact installed Desktop bytes',async()=>{
  const {animationAssets,animationStickers}=await assets(),{roomAsset}=await room();
  for(const asset of Object.values(animationAssets)){
    const response=await roomAsset(new Request('http://localhost/chatpet-room/assets/pet/'+encodeURIComponent(asset.roomClip)+'.webm'));
    assert.equal(response.status,200,asset.id);assert.equal(response.headers.get('content-type'),'video/webm');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),readFileSync('src/desktop/assets/'+asset.file),asset.id);
    if(asset.posterFile){
      const poster=await roomAsset(new Request('http://localhost/chatpet-room/assets/pet/'+encodeURIComponent(asset.roomClip)+'.png'));
      assert.equal(poster.status,200);assert.deepEqual(Buffer.from(await poster.arrayBuffer()),readFileSync('src/desktop/assets/'+asset.posterFile));
    }
  }
  assert.equal(Object.keys(animationStickers).length,27);
  for(const sticker of Object.values(animationStickers)){
    const response=await roomAsset(new Request('http://localhost/chatpet-room/assets/stickers/'+encodeURIComponent(sticker.file)));
    assert.equal(response.status,200,sticker.id);assert.deepEqual(Buffer.from(await response.arrayBuffer()),readFileSync('src/desktop/assets/'+sticker.file));
  }
});

test('every legacy Room video URL resolves through the shared registry, including duplicate aliases',async()=>{
  const {animationAssets,animationRoomAliases}=await assets(),{roomAsset}=await room(),code=roomDeclarations(animationAssets);
  const clips=runInNewContext(code.registry+'\nCLIPS;',{animationAssets});
  const declaration=code.tree.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations[0]?.name.getText(code.tree)==='CLIPS');
  const literals=declaration.declarationList.declarations[0].initializer.arguments[0].properties;
  const aliases=literals.filter(node=>ts.isPropertyAssignment(node)&&ts.isStringLiteral(node.initializer)).map(node=>({key:node.name.text,url:node.initializer.text}));
  assert.equal(aliases.length,42);
  for(const alias of aliases){
    const url=clips[alias.key];assert.equal(url,alias.url,alias.key);
    const target=animationRoomAliases[url];assert.ok(target,'Registered old alias '+alias.key);
    const response=await roomAsset(new Request('http://localhost/chatpet-room/'+url));
    assert.equal(response.status,200,alias.key);assert.deepEqual(Buffer.from(await response.arrayBuffer()),readFileSync('src/desktop/assets/'+target),alias.key);
  }
  assert.ok(animationRoomAliases['assets/pet/walk_fast.webm']);
  assert.equal(animationRoomAliases['assets/pet/walk_fast.webm'],animationRoomAliases['assets/pet/run_hurry.webm']);
});

test('mapped media keeps range, HEAD and fixed registry routing without exposing arbitrary paths',async()=>{
  const {animationAssets}=await assets(),{roomAsset}=await room();
  const asset=Object.values(animationAssets).find(asset=>asset.roomClip.startsWith('mapped-'));
  assert.ok(asset);const url='http://localhost/chatpet-room/assets/pet/'+encodeURIComponent(asset.roomClip)+'.webm';
  const head=await roomAsset(new Request(url,{method:'HEAD'}));assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  const range=await roomAsset(new Request(url,{headers:{Range:'bytes=0-3'}}));assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,4);
  for(const route of ['assets/pet/mapped-not-registered.webm','assets/stickers/not-registered.png','assets/stickers/%2e%2e%2fcore.json','assets/pet/%252e%252e%252fsecret.webm']){
    const response=await roomAsset(new Request('http://localhost/chatpet-room/'+route));assert.equal(response.status,404,route);
  }
  const module=await roomAsset(new Request('http://localhost/chatpet-room/animation-map.js'));
  assert.equal(module.status,200);assert.match(await module.text(),/export const animationAssets/);
});
