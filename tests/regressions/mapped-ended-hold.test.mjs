import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext,runInNewContext} from 'node:vm';
import {resolve} from 'node:path';
import {animationMapURL,loadPlayback} from '../fixtures/playback.mjs';
import ts from 'typescript';

const sourceOnly=process.env.CHATPET_ENDED_HOLD_SOURCE_ONLY==='1';
const {sampleActivityPlayback}=await loadPlayback();
const {animationAssets}=await import(animationMapURL);
const native=readFileSync('vendor/dsh-pet/platform/runtime/electron-helper/events.js','utf8');
const web=readFileSync('src/desktop/platform/client.js','utf8');
function declaration(source,name) {
  const tree=ts.createSourceFile('actual.js',source,ts.ScriptTarget.Latest,true);let found;
  function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node.getText(tree);if(!found)ts.forEachChild(node,visit);}
  visit(tree);assert.ok(found,'Actual playback boundary changed: '+name);return found.replace(/^export\s+/,'');
}
const controllerCode=declaration(sourceOnly?readFileSync('src/desktop/platform/activity-playback.js','utf8'):native,'createActivityPlaybackController');
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
function clock() {
  let value=100000,id=0;const jobs=new Map();
  return {now:()=>value,jobs,set(fn,ms){const key=++id;jobs.set(key,{fn,at:value+ms});return key;},clear:key=>jobs.delete(key),
    at:next=>{value=next;},advance(ms){const end=value+ms;let count=0;for(;;){const row=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0];
      if(!row||row[1].at>end)break;assert.ok(++count<100,'No ended retry pump');value=row[1].at;jobs.delete(row[0]);row[1].fn();}value=end;}};
}
class Video extends EventTarget {
  constructor(duration=4.917){super();this.duration=duration;this.readyState=2;this.paused=true;this.plays=0;this.seeks=[];this.position=0;}
  get currentTime(){return this.position;}
  set currentTime(value){this.seeks.push(value);this.position=value;}
  decodedAt(value){this.position=value;}
  pause(){this.paused=true;}
  play(){this.paused=false;this.plays++;return Promise.resolve();}
  end(){this.decodedAt(this.duration);this.paused=true;this.onended?.();this.dispatchEvent(new Event('ended'));}
}
const episode=(durationMs=10040,next=true,key='actual-sigh',mode='once',startedAt=100000)=>({version:1,key,kind:'rest',startedAt,
  segments:[{roomClip:'sick',desktopClip:'工作状态-垂头叹气冒汗',mode,durationMs},
    ...(next?[{roomClip:'idle',desktopClip:'待机呼吸休闲',mode:'loop',durationMs:2000}]:[])]});
function controller() {
  const c=clock(),videos=[],failures=[];let visible=true,player;
  const scope={sampleActivityPlayback};runInNewContext(controllerCode+'\nglobalThis.make=createActivityPlaybackController;',scope);
  player=scope.make({sample:sampleActivityPlayback,now:c.now,set:c.set,clear:c.clear,visible:()=>visible,
    play(part,ticket){const video=new Video(part.roomClip==='sick'?4.917:2);videos.push(video);player.ready(video,part.key,ticket);},
    failure:(...args)=>failures.push(args)});
  return {c,player,videos,failures,front:()=>videos.at(-1),visible:on=>{visible=on;}};
}

test('shared controller: an early ended one-shot retains its unique absolute boundary without tail replay',()=>{
  const h=controller(),p=episode();h.player.update(p);const video=h.front();h.c.advance(4917);
  const timer=[...h.c.jobs.keys()][0];video.end();const plays=video.plays,seeks=video.seeks.length;
  assert.equal([...h.c.jobs.keys()][0],timer);assert.equal([...h.c.jobs.values()][0].at,110040);
  for(let i=0;i<5;i++){video.end();h.player.update(p,true);}
  assert.equal(video.plays,plays);assert.equal(video.seeks.length,seeks);assert.equal(video.paused,true);assert.equal(h.c.jobs.size,1);
  h.c.advance(5123);assert.equal(h.player.sample().roomClip,'idle');assert.equal(h.front().paused,false);assert.equal(h.c.jobs.size,0);
});
test('shared controller: an accurate 4917ms sigh can finish just before its shared sample boundary',()=>{
  const h=controller(),p=episode(4917);h.player.update(p);h.c.advance(4916);h.front().end();
  assert.equal(h.front().paused,true);assert.equal(h.player.sample().roomClip,'sick');assert.equal(h.c.jobs.size,1);
  h.c.advance(1);assert.equal(h.player.sample().roomClip,'idle');assert.equal(h.front().paused,false);
});
test('shared controller: a final early-ended segment stays still through its later logical completion',()=>{
  const h=controller(),p=episode(10040,false);h.player.update(p);h.c.advance(4917);const video=h.front();video.end();
  const plays=video.plays,seeks=video.seeks.length;h.c.advance(5123);h.player.update(p,true);
  assert.equal(h.player.sample().complete,true);assert.equal(video.plays,plays);assert.equal(video.seeks.length,seeks);assert.equal(h.c.jobs.size,0);
});
test('shared controller: same-key hidden resume holds, but a new buffer is restored to the final frame once',()=>{
  const h=controller(),p=episode();h.player.update(p);h.c.advance(4917);const first=h.front();first.end();
  const plays=first.plays,seeks=first.seeks.length,late=first.onended;
  h.visible(false);h.player.suspend();late();assert.equal(h.c.jobs.size,0);h.c.advance(500);h.visible(true);h.player.update(p,true);
  assert.equal(first.plays,plays);assert.equal(first.seeks.length,seeks);assert.equal(h.c.jobs.size,1);
  first.readyState=0;h.player.update(p,true);const restored=h.front();assert.notEqual(restored,first);
  assert.equal(restored.plays,0);assert.equal(restored.paused,true);assert.ok(Math.abs(restored.currentTime-4.916)<.0001);
  const restoredSeeks=restored.seeks.length;late();h.player.update(p,true);restored.end();h.player.update(p,true);
  assert.equal(restored.seeks.length,restoredSeeks);assert.equal(restored.plays,0);
});
test('shared controller: hidden stale ended cannot freeze a current clip, and a new operation clears the hold',()=>{
  const h=controller(),p=episode();h.player.update(p);const video=h.front(),late=video.onended;
  h.visible(false);h.player.suspend();late();h.c.advance(500);h.visible(true);h.player.update(p,true);
  assert.equal(video.paused,false);assert.ok(Math.abs(video.currentTime-.5)<.0001);
  video.end();h.player.update(episode(10040,true,'different-operation','once',h.c.now()));
  assert.equal(h.front().paused,false);assert.equal(h.front().currentTime,0);late();assert.equal(h.front().paused,false);
});
test('shared controller: loop ended and decoder errors retain their original recovery behavior',()=>{
  const h=controller(),p=episode(4917,false,'actual-loop','loop');h.player.update(p);h.c.advance(1000);const video=h.front(),plays=video.plays;
  video.end();assert.equal(video.plays,plays+1);assert.equal(video.paused,false);assert.equal(video.currentTime,1);
  h.player.update(episode());h.front().end();h.front().dispatchEvent(new Event('error'));
  assert.equal(h.failures.length,1);assert.equal(h.c.jobs.size,1);
  h.player.update(episode(10040,true,'after-error'));assert.equal(h.front().paused,false);
});

const roomSource=readFileSync('vendor/feiyu-room-template/public/room/actor.js','utf8');
const roomTree=ts.createSourceFile('actor.js',roomSource,ts.ScriptTarget.Latest,true);
const actorClass=roomTree.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='SpriteActor').getText(roomTree).replace('export class','class');
const registry=roomTree.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations[0].name.getText(roomTree)==='CLIPS').getText(roomTree).replace('export const','const');
function room() {
  const c=clock();let legacyEnded=0;const textures=[];
  const scope={animationAssets,Date:{now:c.now},performance:{now:c.now},setTimeout:c.set,clearTimeout:c.clear,
    THREE:{SRGBColorSpace:'srgb',LinearFilter:'linear',TextureLoader:class{async loadAsync(){const texture={dispose(){}};textures.push(texture);return texture;}}}};
  runInNewContext('const LOOP_TRIM={run_happy:.9};'+registry+'\nconst POSTER={idle:"idle.png"};'+actorClass+'\nglobalThis.Actor=SpriteActor;',scope);
  const layer=()=>({video:new Video(),mesh:{visible:true},material:{},texture:{},loads:0,fade:0,target:0,suspended:false,
    load(file){this.loads++;this.video.duration=file.endsWith('/sick.webm')?4.917:2;return Promise.resolve();},
    play(){if(!this.suspended)this.video.play();},setTarget(value){this.target=value;}});
  const actor=Object.create(scope.Actor.prototype);Object.assign(actor,{active:0,current:'',visible:true,suspended:false,layers:[layer(),layer()],clipLog:[],onEnded:()=>legacyEnded++});
  return {c,actor,textures,front:()=>actor.layers[actor.active].video,active:()=>actor.layers[actor.active],ended:()=>legacyEnded,
    async set(p){actor.setPlayback(p,sampleActivityPlayback,c.now);await flush();},async advance(ms){c.advance(ms);await flush();}};
}
test('Room: early sigh ended holds without force-seek/play and its original boundary still advances',async()=>{
  const h=room();await h.set(episode());await h.advance(4917);const video=h.front(),timer=[...h.c.jobs.keys()][0];video.end();
  const plays=video.plays,seeks=video.seeks.length;assert.equal([...h.c.jobs.keys()][0],timer);
  for(let i=0;i<5;i++){video.end();h.actor.refreshPlayback(true);}
  assert.equal(video.plays,plays);assert.equal(video.seeks.length,seeks);assert.equal(h.c.jobs.size,1);assert.equal(h.ended(),0);
  await h.advance(5123);assert.equal(h.actor.current,'idle');assert.equal(h.front().paused,false);assert.equal(h.c.jobs.size,0);
});
test('Room: accurate sigh boundary, hidden hold and a replaced buffer preserve one final-frame restore',async()=>{
  const h=room();await h.set(episode(4917));await h.advance(4916);h.front().end();await h.advance(1);assert.equal(h.actor.current,'idle');
  await h.set(episode(10040,true,'new-hold','once',h.c.now()));await h.advance(4917);const first=h.front(),late=first._onceEnded;first.end();
  const plays=first.plays,seeks=first.seeks.length;h.actor.setSuspended(true);assert.equal(h.c.jobs.size,0);await h.advance(500);h.actor.setSuspended(false);
  assert.equal(first.plays,plays);assert.equal(first.seeks.length,seeks);
  const replacement=new Video();h.active().video=replacement;h.actor.refreshPlayback(true);
  assert.equal(replacement.plays,0);assert.equal(replacement.paused,true);assert.ok(Math.abs(replacement.currentTime-4.916)<.0001);
  const restoredSeeks=replacement.seeks.length;late();h.actor.refreshPlayback(true);assert.equal(replacement.seeks.length,restoredSeeks);
  replacement.readyState=0;h.actor.refreshPlayback(true);replacement.decodedAt(0);replacement.readyState=2;h.actor.refreshPlayback(true);
  assert.equal(replacement.seeks.length,restoredSeeks+1);h.actor.refreshPlayback(true);assert.equal(replacement.seeks.length,restoredSeeks+1);
});
test('Room: a late old ended cannot hold a new operation and legacy ended still runs',async()=>{
  const h=room();await h.set(episode());const old=h.front(),late=old._onceEnded;h.actor.setSuspended(true);
  await h.set(episode(10040,true,'next-operation','once',h.c.now()));late();h.actor.setSuspended(false);await flush();
  assert.equal(h.front().paused,false);assert.equal(h.front().currentTime,0);assert.equal(h.ended(),0);
  h.actor.clearPlayback();await h.actor.setClip('sleep_out',{once:true});await flush();h.front().end();assert.equal(h.ended(),1);
});

if(!sourceOnly) {
  const fixtureSource=readFileSync(new URL('../behavior/activity-playback-carriers.test.mjs',import.meta.url),'utf8');
  const fixtureTree=ts.createSourceFile('fixture.mjs',fixtureSource,ts.ScriptTarget.Latest,true);
  const extract=name=>fixtureTree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name||ts.isClassDeclaration(n)&&n.name?.text===name||
    ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(fixtureTree)===name)).getText(fixtureTree);
  const scope=createContext({native,web,readFileSync,createContext,runInContext,ts,assert,console,Event,EventTarget});
  runInContext(['declaration','clock','Video','descriptor','harness','release'].map(extract).join('\n')+'\nglobalThis.fixture={harness,release};',scope);
  const {harness,release}=scope.fixture;
  function observe(video) {let position=video.currentTime;const seeks=[];Object.defineProperty(video,'currentTime',{get:()=>position,set:value=>{position=value;seeks.push(value);}});
    return {seeks,end(){position=video.duration;video.paused=true;video.emit('ended');}};}
  for(const kind of ['native','web']) {
    test(kind+' generated: a short encoded one-shot cannot reenter ended until the true next segment',()=>{
      const h=harness(kind);h.a.duration=h.b.duration=4.917;h.set(episode());h.start();h.ready();const video=h.front(),watched=observe(video);
      h.c.advance(4917);watched.end();const plays=video.plays,seeks=watched.seeks.length;
      for(let i=0;i<4;i++){watched.end();h.player.refreshCompanion();}
      h.player.setFrozen(true);h.player.setFrozen(false);
      assert.equal(video.plays,plays);assert.equal(watched.seeks.length,seeks);assert.equal(h.c.count(),1);
      h.c.advance(5123);h.ready();assert.equal(h.front().paused,false);assert.equal(h.c.count(),0);
    });
    test(kind+' generated: correct sigh duration, same-key hidden restoration and legacy release stay compatible',async()=>{
      const h=harness(kind);h.a.duration=h.b.duration=4.917;h.set(episode(4917));h.start();h.ready();h.c.advance(4916);observe(h.front()).end();
      h.c.advance(1);h.ready();assert.equal(h.front().paused,false);
      h.set(episode(10040,false,'final-hold','once',h.c.now()));h.player.refreshCompanion();h.ready();const video=h.front(),watched=observe(video);
      h.c.advance(4917);watched.end();const plays=video.plays,seeks=watched.seeks.length;
      h.document.hidden=true;h.player.suspendCompanion();h.c.advance(500);h.document.hidden=false;h.player.refreshCompanion();
      assert.equal(video.plays,plays);assert.equal(watched.seeks.length,seeks);assert.equal(video.paused,true);
      const priorPlays=new Map([[h.a,h.a.plays],[h.b,h.b.plays]]);video.readyState=0;
      h.document.hidden=true;h.player.suspendCompanion();h.document.hidden=false;h.player.refreshCompanion();h.ready();
      const restored=h.front(),restoredWatch=observe(restored);assert.notEqual(restored,video);
      assert.equal(restored.plays,priorPlays.get(restored));assert.equal(restored.paused,true);assert.ok(Math.abs(restored.currentTime-4.916)<.0001);
      h.player.setFrozen(true);h.player.setFrozen(false);restoredWatch.end();h.player.refreshCompanion();
      assert.equal(restoredWatch.seeks.length,0);assert.equal(restored.plays,priorPlays.get(restored));
      await release(h,kind);h.ready();assert.equal(h.front().paused,false);
    });
  }
}
