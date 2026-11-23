import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Context} from '@deepseek-ai/cordis';
import {LivingView, LivingWorld} from '../../dist/src/living/index.js';
import {RoomWindow} from '../../dist/src/room/window.js';
import {CompanionBehavior} from '../../dist/src/living/body/plugin.js';
import {emptyHomeState,advanceHomeState,homeView} from '../../vendor/feiyu-room-template/home-state.js';
import {roomReaders} from '../fixtures/room-readers.mjs';

function bodyFixture(t) {
  let now=1_000_000,state=emptyHomeState(now);const events=[];
  const scope={workspaceId:'a',path:'/fixture/a',storageId:'a',bootId:'core',generation:1};
  const host={workspace:{homeScope:()=>scope,runtime:{identity:()=>({displayName:'Fixture'})}}};
  const ctx={emit(name,event){if(name==='world.changed')events.push(event);},
    get(){throw Error('Use native notification subscribers, not direct Desktop restore');}};
  const {world,release}=LivingWorld.retain(new Context(),host,'body');
  t.after(release);
  const living=new LivingView({},undefined,undefined,undefined,
    (binding,bodyOnly,observation)=>world.changed(ctx,host,()=>true,binding,bodyOnly,observation));
  const room={get state(){return state;},tick(){now++;state=advanceHomeState(state,now,{goalPolicy:'planned',autonomy:false,passive:true}).state;},
    presentationActivity:()=>undefined,plannedState:()=>null,nextWakeAt:()=>null,view:()=>homeView(state,now,{}),garden(){this.tick();return{ok:true,garden:{plots:[]}};}};
  const body=Object.assign(Object.create(CompanionBehavior.prototype),{living,
    binding:{id:'a',storageId:'a',room,scope},serial:Promise.resolve(),revision:0,bootId:'boot',autonomous:true,
    synchronize(){},arm(){},refreshEmotion:async()=>{},ctx,host});
  return {body,events,room,scope,world};
}

test('reads keep raw time, publish visible changes, and retain threshold/phase transitions',async t=>{
  const {body,events,room,scope,world}=bodyFixture(t);
  world.changed(body.ctx,body.host,()=>true);
  const first=await body.snapshot('a');
  for(let i=0;i<20;i++)await body.garden('a','state');
  const {path,...worldScope}=scope;
  assert.deepEqual(events,[worldScope],'The mount refresh is the only notification while visible state stays constant');
  assert.ok((await body.snapshot('a')).needs.thirst>first.needs.thirst);
  room.state.needs.thirst+=.02;await body.snapshot('a');
  assert.deepEqual(events.at(-1),{...worldScope,bodyOnly:true,bodyObservation:body.presentationVersion()});
  const n=events.length;body.deadlineAt=0;await body.snapshot('a');assert.equal(events.length,n+1);
  assert.deepEqual(events.at(-1),{...worldScope,bodyOnly:true});
  room.state.activity='A newly accepted activity';body.publish();await Promise.resolve();assert.equal(events.length,n+2);
});

test('Room and garden consume covered versions but follow newer, explicit and resumed reads',async t=>{
  const {body,room,scope}=bodyFixture(t);
  const readers=roomReaders(()=>body.roomState('a'),()=>body.garden('a','state'));
  const window=new RoomWindow({binding:()=>scope});
  window.bound=scope;window.child={};
  window.send=message=>readers.changed(message.change);
  body.ctx.emit=(name,event)=>{if(name==='world.changed')window.changed(event,body.presentationVersion());};
  await readers.start();await readers.drain();assert.ok(readers.counts.main<=2&&readers.counts.garden<=2);
  const before=readers.counts;room.state.needs.thirst+=.02;await body.snapshot('a');await readers.drain();
  assert.ok(readers.counts.main>before.main&&readers.counts.garden>before.garden);
  readers.visibility(false);const hidden=readers.counts;readers.changed({bootId:body.bootId,revision:body.revision});await readers.drain();assert.deepEqual(readers.counts,hidden);
  readers.visibility(true);await readers.start();await readers.drain();assert.ok(readers.counts.main>hidden.main&&readers.counts.garden>hidden.garden);
});

test('a deadline armed during rebinding cannot publish after returning to the same workspace',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1_000_000});
  const {body,events,room}=bodyFixture(t);
  const first={workspaceId:'a',path:'/fixture/a',storageId:'a',bootId:'core',generation:1};
  let binding=first;
  body.host.workspace.homeScope=()=>binding;
  body.binding.scope=first;
  room.nextWakeAt=()=>Date.now()+1000;
  delete body.arm;
  body.arm();
  binding=undefined;
  body.arm();
  binding={...first,generation:3};
  t.mock.timers.tick(1000);
  await body.serial;
  clearTimeout(body.timer);
  assert.deepEqual(events,[]);
});

test('Plan and wallet invalidation refresh Room and garden at the same Body revision',async t=>{
  const {body,scope,world}=bodyFixture(t);
  const readers=roomReaders(()=>body.roomState('a'),()=>body.garden('a','state'));
  const window=new RoomWindow({binding:()=>scope});
  window.bound=scope;window.child={};
  window.send=message=>readers.changed(message.change);
  body.ctx.emit=(name,event)=>{if(name==='world.changed')window.changed(event,body.presentationVersion());};
  await readers.start();await readers.drain();
  const before=readers.counts;
  world.changed(body.ctx,body.host,()=>true);
  await readers.drain();
  assert.deepEqual(readers.counts,{main:before.main+1,garden:before.garden+1});
});

for(const trigger of ['newer','boot','explicit'])test('in-flight Room/garden reads retain '+trigger+' refreshes',async()=>{
  let version={bootId:'one',revision:1},release,held=true;
  const pending=new Promise(resolve=>{release=resolve;});
  const read=async()=>{if(held)await pending;return{behavior:{...version},garden:{plots:[]}};};
  const readers=roomReaders(read,read),first=readers.start();
  readers.changed(version);
  if(trigger==='explicit')await readers.start();
  else readers.changed({bootId:trigger==='boot'?'two':'one',revision:2});
  held=false;release();await first;
  version={bootId:trigger==='boot'?'two':'one',revision:2};await readers.drain();
  assert.deepEqual(readers.counts,{main:2,garden:2});
});

test('adaptive quality respects deliberate FPS/tier and resizes before drawing',()=>{
  const app=readFileSync('vendor/feiyu-room-template/public/room/app.js','utf8');
  const code=app.slice(app.indexOf('  // 自适应：'),app.indexOf('  world.setClock?.(state?.hour || 0, 0);',app.indexOf('  // 自适应：')));
  for(const [fps,target,tier,initial,expected]of [[6,6,'standard',1.35,1.35],[30,30,'low',1,1],[2,6,'standard',1.35,1]]){
    const order=[];const c=vm.createContext({fpsAcc:0,fpsN:0,lastAdapt:0,ratio:initial,measuredFps:target,presentationResizePending:true,
      now:0,elapsed:1/fps,devicePixelRatio:2,tier,SHOT:false,innerWidth:64,innerHeight:64,canvas:{width:1,height:1},scene:{},camera:{},presentationFps:()=>target,
      renderer:{setPixelRatio(value){order.push('resize');},setSize(){order.push('size');},render(){order.push('draw');}}});
    for(let i=1;i<=180;i++){c.now=i*1000/fps;vm.runInContext('{'+code+'}',c);assert.equal(order.at(-1),'draw');}
    assert.equal(Number(c.ratio.toFixed(2)),expected);
  }
  const resize=app.slice(app.indexOf('function onResize()'),app.indexOf("addEventListener('resize'"));assert.ok(!resize.includes('renderer.setSize'));
});
