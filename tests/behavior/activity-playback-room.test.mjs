import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {animationMapURL,loadPlayback} from '../fixtures/playback.mjs';
import ts from 'typescript';

const {resolveActivityPlayback, sampleActivityPlayback} = await loadPlayback();
const {animationAssets}=await import(animationMapURL);
const source = readFileSync('vendor/feiyu-room-template/public/room/actor.js', 'utf8');
const appSource = readFileSync('vendor/feiyu-room-template/public/room/app.js', 'utf8');
const ast = ts.createSourceFile('actor.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const klass = ast.statements.find(node=>ts.isClassDeclaration(node)&&node.name.text==='SpriteActor').getText(ast).replace('export class','class');
const registry = ast.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations[0].name.getText(ast)==='CLIPS').getText(ast).replace('export const','const');
const sampleHome = (kind='drink',startedAt=1000,id='one')=>({now:startedAt,her:{kind,activity:'Actual activity',asleep:kind==='sleep',walking:kind==='walk',spot:kind==='sleep'?'bed':'free',pose:'stand'},behavior:{bootId:'boot',activityId:id,phase:kind==='sleep'?'sleeping':'working',startedAt}});
const flush = async()=>{await Promise.resolve();await Promise.resolve();};

function fixture() {
  let clock=1000,sequence=0,globalEnded=0;
  const timers=new Map(),pending=[],textures=[];
  class Video extends EventTarget {
    constructor(){super();this.currentTime=0;this.duration=NaN;this.readyState=2;this.paused=true;this.playCount=0;}
    pause(){this.paused=true;}
    play(){this.paused=false;this.playCount++;return Promise.resolve();}
  }
  function layer() {
    const video=new Video();
    return {video,mesh:{visible:false},material:{opacity:0},texture:{},fade:0,target:0,loads:[],suspended:false,
      load(file){
        const asset=Object.values(animationAssets).find(asset=>file==='assets/pet/'+asset.roomClip+'.webm');
        assert.ok(asset,'Registered movie fixture: '+file);video.duration=asset.durationMs/1000;
        this.loads.push(file);if(this.delay)return new Promise(resolve=>pending.push({layer:this,resolve}));return Promise.resolve();
      },
      play(){if(!this.suspended)this.video.play();},setTarget(value){this.target=value;}};
  }
  const context={animationAssets,Date:{now:()=>clock},performance:{now:()=>clock},setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id),
    THREE:{SRGBColorSpace:'srgb',LinearFilter:'linear',TextureLoader:class{async loadAsync(path){const texture={path,dispose(){this.disposed=true;}};textures.push(texture);return texture;}}}};
  runInNewContext(`const LOOP_TRIM={run_happy:0.9};${registry}\nconst POSTER=Object.fromEntries(Object.keys(CLIPS).map(k=>[k,'assets/pet/'+k+'.png']));${klass}\nglobalThis.Actor=SpriteActor;globalThis.clips=CLIPS;`,context);
  const actor=Object.create(context.Actor.prototype);
  Object.assign(actor,{active:0,current:'',visible:true,suspended:false,layers:[layer(),layer()],clipLog:[],onEnded:()=>globalEnded++});
  const set=(home)=>actor.setPlayback(resolveActivityPlayback(home),sampleActivityPlayback,()=>clock);
  const tick=async(value)=>{clock=value;for(const [id,timer]of Array.from(timers)){if(timer.at<=clock){timers.delete(id);timer.fn();}}await flush();};
  return {actor,set,tick,timers,pending,textures,clips:context.clips,at(value){clock=value;},ended:()=>globalEnded};
}

test('Room joins the common offset and progress snapshots do not restart its clip',async()=>{
  const f=fixture(),home=sampleHome();f.at(2650);f.set(home);await flush();
  const active=f.actor.layers[f.actor.active];assert.equal(f.actor.current,'life-drink');assert.equal(active.video.currentTime,1.65);
  const loads=f.actor.layers.reduce((n,l)=>n+l.loads.length,0),position=active.video.currentTime;
  f.at(2900);f.set({...home,now:2900});await flush();
  assert.equal(f.actor.layers.reduce((n,l)=>n+l.loads.length,0),loads);assert.equal(active.video.currentTime,position);
});

test('a new operation using the same media receives its own current offset',async()=>{
  const f=fixture();f.at(2500);f.set(sampleHome('drink',1000,'first'));await flush();
  f.set(sampleHome('drink',2400,'second'));await flush();
  assert.equal(f.actor.layers[f.actor.active].video.currentTime,.1);
  assert.equal(f.actor.layers.reduce((n,l)=>n+l.loads.length,0),2);
});

test('sleep entry advances only its visual segment and late windows skip the finished entry',async()=>{
  const f=fixture(),home=sampleHome('sleep');f.set(home);await flush();
  assert.equal(f.actor.current,'sleep_in');assert.equal(f.timers.size,1);
  const playback=resolveActivityPlayback(home),entryEnd=playback.startedAt+playback.segments[0].durationMs;
  await f.tick(entryEnd-1);assert.equal(f.actor.current,'sleep_in');assert.equal(f.timers.size,1);
  await f.tick(entryEnd);assert.equal(f.actor.current,'sleep_loop');assert.equal(f.timers.size,0);
  assert.equal(home.her.kind,'sleep');assert.equal(home.behavior.phase,'sleeping');assert.equal(f.ended(),0);
  const late=fixture();late.at(entryEnd+1000);late.set(home);await flush();assert.equal(late.actor.current,'sleep_loop');
});

test('once playback holds its last frame without the legacy ended or idle chain',async()=>{
  const f=fixture(),home=sampleHome('wake');f.set(home);await flush();
  const current=f.actor.layers[f.actor.active];f.at(20000);current.video.dispatchEvent(new Event('ended'));await flush();
  assert.equal(f.actor.current,'sleep_out');assert.equal(current.video.paused,true);assert.ok(Math.abs(current.video.currentTime-(current.video.duration-.001))<.0001);assert.equal(f.ended(),0);
  assert.equal(f.actor.layers.reduce((n,l)=>n+l.loads.length,0),1);
});

test('hidden Room has no segment timer and resumes directly at the current segment',async()=>{
  const f=fixture(),home=sampleHome('sleep'),playback=resolveActivityPlayback(home);f.set(home);await flush();f.actor.setSuspended(true);
  assert.equal(f.timers.size,0);assert.ok(f.actor.layers.every(l=>l.video.paused));
  const resumeAt=playback.startedAt+playback.segments[0].durationMs+playback.segments[1].durationMs+2920;
  f.at(resumeAt);f.actor.setSuspended(false);await flush();assert.equal(f.actor.current,'sleep_loop');assert.equal(f.timers.size,0);
  assert.ok(Math.abs(f.actor.layers[f.actor.active].video.currentTime-2.92)<.001);
});

test('A to B to A late loads cannot activate the superseded A generation',async()=>{
  const f=fixture();f.actor.layers.forEach(l=>l.delay=true);
  f.set(sampleHome('drink',1000,'first'));f.set(sampleHome('planned',1000,'middle'));f.set(sampleHome('drink',1500,'last'));
  f.at(1800);f.pending[0].resolve();await flush();assert.equal(f.actor.layers[f.actor.active].target,0);
  f.pending[2].resolve();await flush();assert.equal(f.actor.layers[f.actor.active].target,1);assert.equal(f.actor.layers[f.actor.active].video.currentTime,.3);
  f.pending[1].resolve();await flush();assert.equal(f.actor.current,'life-drink');
});

test('clearing shared playback removes its boundary wakeup and returns renderer ownership',async()=>{
  const f=fixture();f.set(sampleHome('sleep'));await flush();assert.equal(f.timers.size,1);
  f.actor.clearPlayback();assert.equal(f.timers.size,0);assert.equal(f.actor.playback,null);assert.equal(f.actor.clipPlaybackKey,null);
  await f.tick(24000);assert.equal(f.actor.current,'sleep_in');
});

test('a delayed load remains paused while hidden and repositions on resume',async()=>{
  const f=fixture();f.actor.layers.forEach(l=>l.delay=true);f.set(sampleHome());f.actor.setSuspended(true);f.at(2500);
  f.pending[0].resolve();await flush();assert.ok(f.actor.layers.every(l=>l.video.paused));
  f.at(3600);f.actor.setSuspended(false);assert.equal(f.actor.layers[f.actor.active].video.currentTime,.6);
});

test('decode failure displays a static poster, records a fault and never settles an activity',async()=>{
  const f=fixture();f.actor.layers.forEach(l=>{l.video.readyState=0;l.video.error={code:3};});f.set(sampleHome());await flush();await flush();
  assert.equal(f.actor.playbackFault,'Animation unavailable: life-drink');assert.ok(f.actor.layers[f.actor.active].posterTexture);
  assert.ok(f.actor.layers.every(l=>l.video.paused));assert.equal(f.ended(),0);
  f.actor.setSuspended(true);f.actor.setSuspended(false);assert.ok(f.actor.layers.every(l=>l.video.paused));
});

function appFunction(name) {
  const tree=ts.createSourceFile('app.js',appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  return tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(tree);
}

test('bound Room selects the shared action and retains actual body state through cosmetic pressure',()=>{
  const home=sampleHome('eat'),calls=[];home.playback=resolveActivityPlayback(home);
  const before=JSON.stringify(home),scope={state:home,Date:{now:()=>1000},resolveActivityPlayback,sampleActivityPlayback,
    actor:{setPlayback(p,s){calls.push(s(p,1000).roomClip);}},lastSleep:false,sleepPhase:'out',petActionOverride:{clip:'dance'},model3d:null,chibi:null};
  runInNewContext(appFunction('clipFor')+'\n'+appFunction('syncCharacter')+'\nsyncCharacter();globalThis.clip=clipFor(state.her);',scope);
  assert.deepEqual(calls,['eat_rice']);assert.equal(scope.clip,'eat_rice');assert.equal(scope.petActionOverride,null);assert.equal(JSON.stringify(home),before);
});

test('sprite garden clips suppress only duplicate hand tools; 3D retains its existing rigs',()=>{
  const start=appSource.indexOf('    const clipTools ='),end=appSource.indexOf('\n    // run_hurry',start);
  const code=appSource.slice(start,end),her={gardenWork:{type:'water'},elev:0},calls=[];
  const scope={state:{...sampleHome('garden_water'),playback:resolveActivityPlayback(sampleHome('garden_water'))},her,
    use3dActive:()=>false,dragging:false,placeHold:null,VIEW:{mode:'overview'},displayPos:[1,2],facing:0,
    gardenController:{updateCharacter(value){calls.push(value);}}};
  runInNewContext(code,scope);assert.equal(calls[0].gardenWork,null);
  scope.use3dActive=()=>true;runInNewContext('{'+code+'}',scope);assert.equal(calls[1].gardenWork,her.gardenWork);
});

test('all shared clip keys are registered in the Room player',()=>{
  const f=fixture();for(const kind of ['idle','walk','eat','nap','desk','sleep','wake','play','react_happy','react_pout','react_shy','react_scare','drink','garden_till','garden_plant','garden_water','garden_fertilize','garden_harvest','garden_sell','garden_buySeed','garden_buyCompost']) {
    for(const segment of resolveActivityPlayback(sampleHome(kind)).segments)assert.ok(f.clips[segment.roomClip],kind+' -> '+segment.roomClip);
  }
});
