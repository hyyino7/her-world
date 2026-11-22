import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {LivingView} from '../../dist/src/living/index.js';
import {CompanionBehavior} from '../../dist/src/living/body/plugin.js';
import {emptyHomeState,advanceHomeState,homeView} from '../../vendor/feiyu-room-template/home-state.js';
import {roomReaders} from '../fixtures/room-readers.mjs';

function bodyFixture() {
  let now=1_000_000,state=emptyHomeState(now);const events=[];
  const room={get state(){return state;},tick(){now++;state=advanceHomeState(state,now,{goalPolicy:'planned',autonomy:false,passive:true}).state;},
    presentationActivity:()=>undefined,plannedState:()=>null,nextWakeAt:()=>null,view:()=>homeView(state,now,{}),garden(){this.tick();return{ok:true,garden:{plots:[]}};}};
  const body=Object.assign(Object.create(CompanionBehavior.prototype),{living:new LivingView(),
    binding:{id:'a',storageId:'a',room},serial:Promise.resolve(),revision:0,bootId:'boot',autonomous:true,
    synchronize(){},arm(){},refreshEmotion:async()=>{},ctx:{emit(_name,event){events.push(event);},get(){throw Error('Use native notification subscribers, not direct Desktop restore');}},
    host:{workspace:{runtime:{identity:()=>({displayName:'Fixture'})}}}});
  return{body,events,room};
}

test('reads keep raw time, publish visible changes, and retain threshold/phase transitions',async()=>{
  const {body,events,room}=bodyFixture();const first=await body.snapshot('a');
  for(let i=0;i<20;i++)await body.garden('a','state');
  assert.equal(events.length,1);assert.ok((await body.snapshot('a')).needs.thirst>first.needs.thirst);
  room.state.needs.thirst+=.02;await body.snapshot('a');assert.equal(events.at(-1).reason,'observation');
  const n=events.length;body.deadlineAt=0;await body.snapshot('a');assert.equal(events.length,n+1);assert.equal(events.at(-1).reason,'transition');
  room.state.activity='A newly accepted activity';body.publish();assert.equal(events.length,n+2);
});

test('Room and garden consume covered versions but follow newer, explicit and resumed reads',async()=>{
  const {body,events,room}=bodyFixture();
  const readers=roomReaders(()=>body.roomState('a'),()=>body.garden('a','state'));
  body.ctx.emit=(_name,event)=>{events.push(event);readers.changed(event);};
  await readers.start();await readers.drain();assert.ok(readers.counts.main<=2&&readers.counts.garden<=2);
  const before=readers.counts;room.state.needs.thirst+=.02;await body.snapshot('a');await readers.drain();
  assert.ok(readers.counts.main>before.main&&readers.counts.garden>before.garden);
  readers.visibility(false);const hidden=readers.counts;readers.changed({bootId:body.bootId,revision:body.revision});await readers.drain();assert.deepEqual(readers.counts,hidden);
  readers.visibility(true);await readers.start();await readers.drain();assert.ok(readers.counts.main>hidden.main&&readers.counts.garden>hidden.garden);
});

test('Plan and wallet invalidation refresh Room and garden at the same Body revision',async()=>{
  const {body}=bodyFixture();
  const readers=roomReaders(()=>body.roomState('a'),()=>body.garden('a','state'));
  await readers.start();await readers.drain();
  const before=readers.counts;
  readers.changed({...body.presentationVersion(),reason:'world'});
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
