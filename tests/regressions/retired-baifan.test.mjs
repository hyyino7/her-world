import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {animationMapURL,compiledURL} from '../fixtures/playback.mjs';
import {createContext,runInContext} from 'node:vm';
import ts from 'typescript';

// Packaged output is the subject. Frozen-package runs need no pinned inputs.
const client=readFileSync('src/desktop/platform/client.js','utf8');
const tree=ts.createSourceFile('client.js',client,ts.ScriptTarget.Latest,true);
const {CompanionRoom}=await import(compiledURL('living/body/room.js'));
const {animationAssets}=await import(animationMapURL);
function fn(name) {
  let found;
  function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node.getText(tree);if(!found)ts.forEachChild(node,visit);}
  visit(tree);assert.ok(found,'Ordinary Pet function lost: '+name);return found;
}

test('generated client contains no independent Baifan game, registration, storage or polling closure',()=>{
  for(const marker of ['src/client/baifan','mountBaifan','makeBaifanLayer','dsh-pet-baifan','chatpet-baifan','menu.tick','bf-rice','bf-score'])
    assert.equal(client.includes(marker),false,'Retired runtime fragment: '+marker);
});
test('actual app registration mounts only the ordinary Pet overlay and retains its public service/editor',()=>{
  const slots=[],provided=new Map(),effects=[],requests=[],intervals=[];
  const rt={useEffect:fn=>effects.push(fn),useRef:value=>({current:value}),useState:value=>[value,()=>{}],useCallback:fn=>fn};
  const jsx=(component,props)=>typeof component==='function'?component(props):{component,props};
  const scope=createContext({console,makePetUI:()=>()=>({kind:'ordinary-pet'}),makePetConfigSection:()=>()=>({kind:'appearance-editor'}),
    getStateSnapshot:()=>null,takeMenuEvents:()=>({ok:true,events:{}}),readPose:()=>null,readProgress:()=>null,
    NS$1:'pet',dicts$1:{},NS:'chat',dicts:{},
    window:{setInterval:(...args)=>{intervals.push(args);return 1;}},fetch:(...args)=>{requests.push(args);throw Error('Unexpected setup request');},
    require:name=>name==='react'?rt:name==='react/jsx-runtime'?{jsx}:name==='react-dom/client'?{createRoot(){}}:name==='react-dom'?{flushSync(){}}:{}});
  runInContext(fn('makeFactory')+'\nglobalThis.plugin=makeFactory()(require);',scope);
  const ctx={effect(fn){effects.push(fn);},locale:{bind:()=>key=>key},provide:(name,value)=>provided.set(name,value),
    slots:{inject(_slot,register){for(const _ of register()){}},register:(spec,component)=>{slots.push({spec,component});return()=>{};}}};
  scope.plugin.apply(ctx);
  assert.deepEqual(slots.filter(row=>row.spec.name==='shell.overlay').map(row=>row.spec.id),['chatpet-pet']);
  for(const row of slots.filter(row=>row.spec.name==='shell.overlay'))row.component();
  assert.equal(intervals.length,0);assert.equal(requests.length,0,'No game menu, lock or movement request during registration/mount');
  assert.ok(provided.has('chatpetPresentation'));assert.ok(provided.has('chatpetAppearanceEditor'));
});
test('ordinary action, wake and third-party menu callbacks remain executable',async()=>{
  const posts=[],played=[],menuClicks=[];
  const scope=createContext({console,ROUTE_PATH:'/presentation',postAction:async(...args)=>{posts.push(args);return true;},
    setMenuClick:(...args)=>menuClicks.push(args),isNoMirrorAnimation:()=>false});
  runInContext(fn('createMenuActions')+'\nglobalThis.createMenuActions=createMenuActions;',scope);
  const menu=scope.createMenuActions({petId:'main',sleeping:()=>false,warn:assert.fail,
    animations:()=>({categories:[],moves:{actions:[]}}),isFacingRight:()=>false,stopMove(){},playOnce:(...args)=>played.push(args)});
  menu.run({anim:'Registered ordinary movie'},'actual-playback');menu.run({action:'wake'});
  menu.run({action:'third-party',owner:'ordinary-plugin',label:'Ordinary item'});await Promise.resolve();
  assert.deepEqual(played,[['Registered ordinary movie','actual-playback']]);
  assert.equal(posts[0][0],'/presentation/wake?pet=main');assert.equal(posts[1][0],'/presentation/menu/click');
  assert.deepEqual(menuClicks,[['ordinary-plugin','Ordinary item','main']]);
});
test('ordinary lock freeze retains its deadline and explicit release without a game heartbeat',()=>{
  let now=1000,frozen=false,sequence=0;const timers=new Map(),effects=[],events=[];
  const scope=createContext({Date:{now:()=>now},window:{setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)}});
  runInContext(['freezeDeadline','dispatchCue','createLockFreeze'].map(fn).join('\n')+'\nglobalThis.make=createLockFreeze;',scope);
  const input={lock:{locked:true,expiresAt:9000},lockTick:1,onFrozen:()=>events.push('frozen'),onResumed:()=>events.push('resumed'),
    setFrozen(on){if(frozen===on)return null;frozen=on;return {kind:on?'frozen':'resumed'};}};
  const lock=scope.make({useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)})(input);
  const cleanup=effects[0]();assert.equal(frozen,true);assert.equal(timers.size,1);assert.equal([...timers.values()][0].at,9000);
  lock.release();assert.equal(frozen,false);assert.equal(timers.size,0);assert.deepEqual(events,['frozen','resumed']);cleanup();
});
test('food PNG components and meal animation composition mappings remain packaged',()=>{
  for(const name of ['bowl-full.png','bowl-empty.png','rice-ball.png'])
    assert.ok(readFileSync('vendor/dsh-pet/platform/assets/pic/baifan/'+name).byteLength>0,name);
  assert.equal(animationAssets['吃饭·碗饭'].composition,'baifan-bowl');
  assert.equal(animationAssets['吃饭团'].composition,'baifan-riceball');
});
test('ordinary free basic feeding still completes one actual Body fact without a minigame or wallet',t=>{
  const dir=mkdtempSync(join(tmpdir(),'retired-baifan-feed-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  t.mock.timers.enable({apis:['Date'],now:100000});const room=new CompanionRoom(dir,()=>undefined);
  Object.assign(room.state,{room:'living',spot:'sofa',route:null,dwell:null,asleep:false,sleepPending:false,
    needs:{hunger:.8,thirst:.2,energy:.8,bladder:.1,pain:0},lastTickAt:100000});
  const interaction={requestId:'actual-free-meal',actor:{kind:'owner',id:'fixture-owner',channel:'room'}};
  const before=room.state.counts.feed,result=room.act({action:'feed'},'主人',100000,interaction);
  assert.equal(result.changed,true);assert.equal(room.state.counts.feed,before+1);assert.ok(room.state.needs.hunger<.8);
  assert.equal(result.home.basicLiving.feed.free,true);assert.match(result.fact.result.summary,/免费基础餐食/);
  assert.equal(room.pendingFacts().length,1);room.act({action:'feed'},'主人',100000,interaction);
  assert.equal(room.state.counts.feed,before+1);assert.equal(room.pendingFacts().length,1);room.flush();
});
