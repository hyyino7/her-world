import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadPlayback} from '../fixtures/playback.mjs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Default to actual shipped content in cwd, including frozen-package runs.
// The explicit override records the unchanged implementation as a red control.
const source=readFileSync(process.env.CHATPET_ROOM_LAYER_TEST_SOURCE||'vendor/feiyu-room-template/public/room/actor.js','utf8');
const tree=ts.createSourceFile('actor.js',source,ts.ScriptTarget.Latest,true);
const declaration=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='Layer');
assert.ok(declaration,'Actual Room Layer boundary changed');
const {sampleActivityPlayback}=await loadPlayback();
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
function clock(initial=0) {
  let now=initial,sequence=0,scheduled=0;const jobs=new Map();
  return {jobs,now:()=>now,scheduled:()=>scheduled,set(fn,ms){const id=++sequence;scheduled++;jobs.set(id,{fn,at:now+ms});return id;},clear:id=>jobs.delete(id),
    advance(ms){const until=now+ms;let turns=0;for(;;){const due=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0];
      if(!due||due[1].at>until)break;assert.ok(++turns<=2000,'No Layer polling loop');now=due[1].at;jobs.delete(due[0]);due[1].fn();}now=until;}};
}
class Video {
  constructor(){this.listeners=new Map();this.readyState=0;this.loads=0;this.plays=0;this.pauses=0;this.paused=true;this.mode='pending';this.style={};this.duration=10.042;this.currentTime=0;}
  addEventListener(type,fn,options={}){const rows=this.listeners.get(type)||new Map();if(!rows.has(fn))rows.set(fn,{once:options.once});this.listeners.set(type,rows);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  count(type){return this.listeners.get(type)?.size||0;}
  emit(type){for(const [fn,options] of [...(this.listeners.get(type)||[])]){if(!this.listeners.get(type)?.has(fn))continue;
    if(options.once)this.listeners.get(type).delete(fn);fn({type,target:this});}}
  set src(value){if(this.throwAt==='src')throw Error('Synchronous src failure');this.source=value;this.readyState=0;this.error=null;}
  get src(){return this.source;}
  load(){this.loads++;if(this.throwAt==='load')throw Error('Synchronous load failure');
    if(this.mode==='ready-only')this.readyState=2;
    if(this.mode==='sync-loadeddata'){this.readyState=2;this.emit('loadeddata');}
    if(this.mode==='sync-canplay'){this.readyState=2;this.emit('canplay');}
    if(this.mode==='sync-error'){this.error={code:3};this.emit('error');}}
  play(){this.plays++;if(this.throwAt==='play')throw Error('Synchronous play failure');
    if(this.mode==='reject-play')return Promise.reject(Error('Asynchronous play rejection'));
    this.paused=false;if(this.mode==='sync-play-canplay'){this.readyState=2;this.emit('canplay');}return Promise.resolve();}
  pause(){this.pauses++;this.paused=true;}
  ready(){this.readyState=2;this.emit('loadeddata');}
  end(){this.currentTime=this.duration;this.paused=true;this.emit('ended');}
  remove(){this.removed=true;}
}
function fixture() {
  const c=clock(),scope={setTimeout:c.set,clearTimeout:c.clear};
  runInNewContext(declaration.getText(tree)+'\nglobalThis.Layer=Layer;',scope);
  const layer=Object.create(scope.Layer.prototype),video=new Video();
  Object.assign(layer,{video,src:'',mesh:{visible:false},loadLog:[],suspended:false});
  return {c,layer,video,count:()=>['loadeddata','canplay','error'].reduce((n,type)=>n+video.count(type),0)};
}

test('1000 successful Layer loads retain no error/canplay closures after the old timeout window',async()=>{
  const f=fixture();
  for(let i=0;i<1000;i++){const pending=f.layer.load('clip-'+i);f.video.readyState=2;f.video.emit('loadeddata');await pending;}
  f.c.advance(4500);
  assert.equal(f.video.count('error'),0);assert.equal(f.video.count('canplay'),0);assert.equal(f.video.count('loadeddata'),0);
  assert.equal(f.c.jobs.size,0);assert.ok(f.layer.loadLog.length<=12);
});
test('the original 12-entry load log cap also bounds completion records under repeated loads',async()=>{
  const f=fixture();f.video.mode='sync-loadeddata';
  for(let i=0;i<1000;i++)await f.layer.load('clip-'+i);
  f.c.advance(4500);assert.ok(f.layer.loadLog.length<=12,'Completion records must retain the original 12-entry cap: '+f.layer.loadLog.length);
  assert.equal(f.layer.loadLog.at(-1).s,'clip-999');assert.equal(f.layer.loadLog.at(-1).p,'finish');
});
test('a normal successful load immediately removes all owned listeners and its fallback timer',async()=>{
  const f=fixture(),pending=f.layer.load('first');assert.equal(f.count(),3);assert.equal(f.c.jobs.size,1);
  f.video.readyState=2;f.video.emit('canplay');await pending;
  assert.equal(f.count(),0);assert.equal(f.c.jobs.size,0);assert.equal(f.layer._pendingLoad,null);
  const finish=f.layer.loadLog.filter(row=>row.p==='finish').length;f.video.emit('loadeddata');f.video.emit('error');f.c.advance(4500);
  assert.equal(f.layer.loadLog.filter(row=>row.p==='finish').length,finish);
});
test('same-source pending work is reused and a decoded cache hit allocates no new work',async()=>{
  const f=fixture(),pending=f.layer.load('same');assert.equal(f.layer.load('same'),pending);
  assert.equal(f.video.loads,1);assert.equal(f.video.plays,1);assert.equal(f.c.jobs.size,1);assert.equal(f.count(),3);
  f.video.readyState=2;f.video.emit('loadeddata');await pending;const scheduled=f.c.scheduled();
  await f.layer.load('same');assert.equal(f.video.loads,1);assert.equal(f.video.plays,1);assert.equal(f.c.scheduled(),scheduled);
  assert.equal(f.count(),0);assert.equal(f.c.jobs.size,0);
});
for(const mode of ['ready-only','sync-loadeddata','sync-canplay','sync-error','sync-play-canplay'])
  test(mode+': synchronous completion cannot leave listeners or allocate a late fallback timer',async()=>{
    const f=fixture();f.video.mode=mode;await f.layer.load('sync');await flush();
    assert.equal(f.count(),0);assert.equal(f.c.jobs.size,0);assert.equal(f.c.scheduled(),0);
    assert.equal(f.layer._pendingLoad,null);assert.equal(f.video.loads,1);assert.equal(f.video.plays,1);
    assert.equal(f.layer.loadLog.filter(row=>row.p==='finish').length,1);
  });
test('asynchronous errors and fallback timeouts both settle once and clean every owned resource',async()=>{
  for(const cause of ['error','timeout']) {
    const f=fixture(),pending=f.layer.load(cause);
    if(cause==='error'){f.video.error={code:3};f.video.emit('error');}else f.c.advance(4500);
    await pending;assert.equal(f.count(),0);assert.equal(f.c.jobs.size,0);
    f.video.emit('canplay');f.video.emit('loadeddata');f.c.advance(4500);
    assert.equal(f.layer.loadLog.filter(row=>row.p==='finish').length,1);
  }
});
test('overlapping loads clean only their own callbacks and preserve the newest pending identity',async()=>{
  const f=fixture();let otherCalls=0;const other=()=>otherCalls++;f.video.addEventListener('loadeddata',other);
  const otherTimer=f.c.set(()=>{},9999),first=f.layer.load('first'),oldFinish=[...f.video.listeners.get('error').keys()][0];
  const second=f.layer.load('second');assert.notEqual(second,first);assert.equal(f.layer._pendingLoad,second);
  oldFinish();await first;await flush();assert.equal(f.layer._pendingLoad,second);
  assert.equal(f.video.count('error'),1);assert.equal(f.video.count('canplay'),1);assert.equal(f.video.count('loadeddata'),2);
  assert.equal(f.c.jobs.size,2);oldFinish();assert.equal(f.c.jobs.size,2);
  f.video.readyState=2;f.video.emit('loadeddata');await second;await flush();
  assert.equal(f.video.count('loadeddata'),1);assert.equal(f.video.count('error'),0);assert.equal(f.video.count('canplay'),0);
  assert.equal(otherCalls,1);assert.equal(f.c.jobs.size,1);assert.ok(f.c.jobs.has(otherTimer));assert.equal(f.layer._pendingLoad,null);
});
test('a shared event settles overlapping attempts without retaining either closure',async()=>{
  const f=fixture(),first=f.layer.load('first'),second=f.layer.load('second');f.video.readyState=2;f.video.emit('canplay');
  await Promise.all([first,second]);await flush();assert.equal(f.count(),0);assert.equal(f.c.jobs.size,0);assert.equal(f.layer._pendingLoad,null);
  assert.equal(f.layer.loadLog.filter(row=>row.p==='finish').length,2);
});
test('synchronous source/load/play exceptions preserve rejection while releasing listeners and pending ownership',async()=>{
  for(const at of ['src','load','play']) {
    const f=fixture();f.video.throwAt=at;const pending=f.layer.load('exception');await assert.rejects(pending,/Synchronous/);await flush();
    assert.equal(f.count(),0);assert.equal(f.c.jobs.size,0);assert.equal(f.layer._pendingLoad,null);
    f.video.throwAt=null;f.video.mode='sync-loadeddata';await f.layer.load('exception');assert.equal(f.count(),0);assert.equal(f.c.jobs.size,0);
  }
});
test('an exception after an already completed synchronous event cannot reverse that completion',async()=>{
  const f=fixture();f.video.mode='sync-loadeddata';f.video.throwAt='play';await f.layer.load('completed');await flush();
  assert.equal(f.count(),0);assert.equal(f.c.jobs.size,0);assert.equal(f.layer._pendingLoad,null);
});
test('a rejected play promise retains the original fallback and hidden layers never prime playback',async()=>{
  const rejected=fixture();rejected.video.mode='reject-play';const pending=rejected.layer.load('rejected');await flush();
  assert.equal(rejected.c.jobs.size,1);rejected.c.advance(4500);await pending;assert.equal(rejected.count(),0);assert.equal(rejected.c.jobs.size,0);
  const hidden=fixture();hidden.layer.suspended=true;hidden.video.mode='sync-loadeddata';await hidden.layer.load('hidden');
  assert.equal(hidden.video.plays,0);assert.equal(hidden.count(),0);assert.equal(hidden.c.jobs.size,0);
});

// Integrate the actual actor and actual Layer. Only DOM/media, Three geometry
// and time are external seams; load(), setClip() and update() stay unmodified.
function actorFixture() {
  const c=clock(100000),videos=[];
  class Vector2 {
    constructor(x=0,y=0){this.x=x;this.y=y;}
    set(x,y){this.x=x;this.y=y;return this;}
    distanceTo(other){return Math.hypot(this.x-other.x,this.y-other.y);}
    copy(other){return this.set(other.x,other.y);}
    lerp(other,k){return this.set(this.x+(other.x-this.x)*k,this.y+(other.y-this.y)*k);}
  }
  const vector=()=>({set(){},setScalar(){}});
  class Group {constructor(){this.position=vector();this.scale=vector();this.rotation={};this.children=[];}add(item){this.children.push(item);}}
  class Texture {dispose(){this.disposed=true;}}
  class Material {constructor(value){Object.assign(this,value);}clone(){return new Material({...this});}dispose(){}}
  class Mesh extends Group {constructor(geometry,material){super();this.geometry=geometry;this.material=material;this.visible=true;}clone(){return new Mesh(this.geometry,this.material);}}
  const THREE={Group,Vector2,Mesh,MeshBasicMaterial:Material,PlaneGeometry:class{dispose(){}},CanvasTexture:Texture,VideoTexture:Texture,
    TextureLoader:class{async loadAsync(){return new Texture();}},SRGBColorSpace:'srgb',LinearFilter:'linear',DoubleSide:'double'};
  const document={body:{appendChild(){}},createElement(type){
    if(type==='video'){const video=new Video();videos.push(video);return video;}
    if(type==='canvas')return {getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),beginPath(){},ellipse(){},fill(){}})};
    throw Error('Unexpected actor DOM element: '+type);
  }};
  const names=['LOOP_TRIM','CLIPS','POSTER','PLANE_W','PLANE_H','FEET_CENTER_Y','FADE_MS'];
  const constants=names.map(name=>tree.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations[0]?.name.getText(tree)===name).getText(tree).replace(/^export\s+/,''));
  const shadow=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='shadowTexture').getText(tree);
  const actor=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='SpriteActor').getText(tree).replace(/^export\s+/,'');
  const scope={THREE,document,animationAssets:{},setTimeout:c.set,clearTimeout:c.clear,performance:{now:c.now},Date:{now:c.now}};
  runInNewContext(constants.join('\n')+'\n'+shadow+'\n'+declaration.getText(tree)+'\n'+actor+'\nglobalThis.actor=new SpriteActor(new THREE.Group());',scope);
  const value=scope.actor,camera={position:{x:0,z:2}};
  const playback=(clip,id,mode='loop')=>({version:1,key:id,kind:'rest',startedAt:c.now(),segments:[{roomClip:clip,desktopClip:clip,mode,durationMs:clip==='sick'?4917:10042}]});
  return {actor:value,c,videos,active:()=>value.layers[value.active],
    set:(clip,id,mode='loop')=>value.setPlayback(playback(clip,id,mode),sampleActivityPlayback,c.now),
    frames(count=120){for(let i=0;i<count;i++){c.advance(1000/6);value.update(1/6,camera,{pos:[6.3,5.1]});}}};
}

test('actual Actor rapid A to B pauses a settled transparent old Layer once after normal draw ticks',async()=>{
  const f=actorFixture();f.set('idle','A');const stale=f.active();f.set('life-drink','B');const current=f.active();
  f.frames(12);assert.ok(stale._pendingLoad);assert.ok(current._pendingLoad);
  assert.equal(stale.video.paused,false);assert.equal(current.video.paused,false);assert.equal(stale.video.pauses,0);assert.equal(current.video.pauses,0);
  stale.video.ready();current.video.ready();await flush();assert.equal(stale._pendingLoad,null);f.frames();
  assert.equal(stale.video.paused,true);assert.equal(stale.video.pauses,1);assert.equal(stale.mesh.visible,false);
  assert.equal(stale.fade,0);assert.equal(stale.target,0);assert.equal(current.video.paused,false);assert.equal(current.fade,1);assert.equal(current.target,1);
  f.frames();assert.equal(stale.video.pauses,1);assert.equal(f.c.jobs.size,0);
});
test('actual Actor A to B to A reuses pending decoding and cannot pause the newly current A',async()=>{
  const f=actorFixture();f.set('idle','A-first');const currentA=f.active();f.set('life-drink','B');const staleB=f.active();
  f.set('idle','A-current');assert.equal(f.active(),currentA);assert.equal(currentA.video.loads,1);
  currentA.video.ready();await flush();f.frames(6);assert.equal(currentA.video.paused,false);assert.equal(currentA.video.pauses,0);
  assert.ok(staleB._pendingLoad);assert.equal(staleB.video.paused,false);assert.equal(staleB.video.pauses,0);
  staleB.video.ready();await flush();f.frames();assert.equal(staleB.video.paused,true);assert.equal(staleB.video.pauses,1);
  assert.equal(currentA.video.paused,false);assert.equal(currentA.target,1);assert.equal(currentA.fade,1);
  f.set('life-drink','B-reused');assert.equal(f.active(),staleB);await flush();f.frames();
  assert.equal(staleB.video.loads,1);assert.equal(staleB.video.paused,false);assert.equal(staleB.target,1);assert.equal(currentA.video.paused,true);
});
test('actual Actor keeps an outgoing visible movie until the replacement is ready and its fade reaches zero',async()=>{
  const f=actorFixture();f.set('idle','A');const outgoing=f.active();outgoing.video.ready();await flush();f.frames(2);
  f.set('life-drink','B');const current=f.active();f.frames(2);assert.equal(outgoing.target,1);assert.equal(outgoing.video.paused,false);
  current.video.ready();await flush();f.frames(1);assert.ok(outgoing.fade>0);assert.equal(outgoing.video.pauses,0);
  f.frames(1);assert.equal(outgoing.fade,0);assert.equal(outgoing.video.paused,true);assert.equal(outgoing.video.pauses,1);
  f.frames();assert.equal(outgoing.video.pauses,1);assert.equal(current.video.paused,false);
});
test('actual Actor current once/loop and held end frames do not become transparent-layer cleanup targets',async()=>{
  for(const mode of ['loop','once']) {
    const f=actorFixture();f.set(mode==='once'?'sick':'idle','current-'+mode,mode);const layer=f.active();
    if(mode==='once')layer.video.duration=4.917;layer.video.ready();await flush();f.frames(2);
    assert.equal(layer.target,1);assert.equal(layer.video.paused,false);assert.equal(layer.video.pauses,0);
    if(mode==='once'){layer.video.end();assert.equal(layer.video.paused,true);}
    const plays=layer.video.plays,pauses=layer.video.pauses;f.frames();
    assert.equal(layer.video.plays,plays);assert.equal(layer.video.pauses,pauses);assert.equal(layer.fade,1);assert.equal(layer.mesh.visible,true);
    assert.equal(layer.video.paused,mode==='once');
  }
});
test('actual Actor inactive loads stop after event/error/timeout settles without stopping pending metadata priming',async()=>{
  for(const outcome of ['loadeddata','error','timeout']) {
    const f=actorFixture();f.set('idle','stale-'+outcome);const stale=f.active();f.set('life-drink','current-'+outcome);const current=f.active();
    current.video.ready();await flush();f.frames(6);assert.ok(stale._pendingLoad);assert.equal(stale.video.paused,false);assert.equal(stale.video.pauses,0);
    if(outcome==='loadeddata')stale.video.ready();
    else if(outcome==='error'){stale.video.error={code:3};stale.video.emit('error');}
    else f.c.advance(4500);
    await flush();f.frames(1);assert.equal(stale.video.paused,true);assert.equal(stale.video.pauses,1);assert.equal(stale.mesh.visible,false);
    assert.equal(current.video.paused,false);assert.equal(f.actor.playbackFault,null);assert.equal(f.c.jobs.size,0);
  }
});
test('actual Actor hide/suspend and current poster fallback retain their original media ownership',async()=>{
  const f=actorFixture();f.set('idle','stale');const stale=f.active();f.set('life-drink','current');const current=f.active();current.video.ready();await flush();
  f.actor.setSuspended(true);const paused=stale.video.pauses;stale.video.ready();await flush();f.frames();
  assert.equal(stale.video.paused,true);assert.equal(current.video.paused,true);assert.equal(stale.video.pauses,paused);
  f.actor.setSuspended(false);await flush();f.frames();assert.equal(stale.video.paused,true);assert.equal(stale.video.pauses,paused);assert.equal(current.video.paused,false);
  const failed=actorFixture();failed.set('life-drink','failed');const layer=failed.active();layer.video.error={code:3};layer.video.emit('error');
  await flush();await flush();failed.frames();assert.ok(layer.posterTexture);assert.equal(layer.target,1);assert.equal(layer.video.paused,true);
  assert.equal(failed.actor.playbackFault,'Animation unavailable: life-drink');assert.equal(failed.c.jobs.size,0);
});
