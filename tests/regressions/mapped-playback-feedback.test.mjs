import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {animationMapURL,compiledURL,loadPlayback} from '../fixtures/playback.mjs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const {resolveActivityPlayback}=await loadPlayback();
const {animationStickers}=await import(animationMapURL);
const {PetPlatform}=await import(compiledURL('desktop/platform/plugin.js'));
const upstream=createRequire(import.meta.url)(resolve('vendor/dsh-pet/platform/runtime.mjs'));
const source=readFileSync('vendor/feiyu-room-template/public/room/app.js','utf8');
const tree=ts.createSourceFile('app.js',source,ts.ScriptTarget.Latest,true);
const fn=name=>tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(tree);
function room(){
 let now=1000,visible=true,response;const created=[];
 const el={textContent:'',children:[],classes:new Set(),appendChild(x){this.children.push(x);}};
 el.classList={add:x=>el.classes.add(x),remove:x=>el.classes.delete(x)};
 const scope={animationStickers,roomRequest:async()=>({ok:true,json:async()=>response}),withToken:x=>x,toast(){},poll:async()=>{},Date:{now:()=>now},displayAllowed:()=>visible,clearTimeout(){},requestViewRefresh(){},syncTvOpinionTimer(){},clearOpenViewKeys(){},document:{createElement(tag){const x={tag,style:{}};created.push(x);return x;}},$:()=>el};
 runInNewContext(`let bubbleOn=true,SHOT=false,VIEW={mode:'overview'},bubbleUntil=0,animationFeedbackKey='',bubbleFeedbackId;
 let state,pendingAction='',presentationReady=true,presentationGeneration=0,viewRefreshTimer,presentationNeedsSnapshot=false,presentationLoop,mediaGate,gardenController,tvStream,tvCastPending;const actor={setSuspended(){}};
 ${fn('setBubble')}\n${fn('presentAnimationFeedback')}\n${fn('synchronizePresentation')}\n${fn('act')}
 function applyState(s){state=s;presentAnimationFeedback(s);}
 globalThis.view={act,apply:presentAnimationFeedback,say:setBubble,sync:synchronizePresentation,waiting:()=>presentationNeedsSnapshot,until:()=>bubbleUntil};`,scope);
 return {el,created,act:payload=>{response=payload;return scope.view.act('pet');},at(x){now=x;},visible(x){visible=x;},sync:()=>scope.view.sync(),waiting:()=>scope.view.waiting(),apply:s=>scope.view.apply(s),say:(...x)=>scope.view.say(...x),until:()=>scope.view.until()};
}
const event=(id='touch')=>({id,action:'pet',at:1000,until:9000,text:'主人刚摸了摸你的头',actor:{kind:'owner'}});
function home(id='touch'){
 return {now:1000,her:{kind:'planned',activity:'Continue actual reading',pose:'sit'},emotion:{feelings:['sweet'],updatedAt:500},
 behavior:{bootId:'body',activityId:'read',phase:'working',presentationKind:'read',readingState:'offered',animationContext:{interaction:event(id)}}};
}
function framed(id='touch'){const s=home(id);return {...s,playback:resolveActivityPlayback(s)};}

test('busy head touch uses real facts/sticker while the reading clip and key remain unchanged',()=>{
 const s=home(),before=resolveActivityPlayback({...s,behavior:{...s.behavior,animationContext:{}}});
 const p=resolveActivityPlayback(s);assert.equal(p.key,before.key);assert.deepEqual(p.segments,before.segments);
 assert.equal(p.feedback.text,event().text);assert.equal(p.feedback.sticker,'可爱');
 const r=room();r.apply({...s,playback:p});assert.equal(r.el.textContent,event().text);
 assert.equal(r.created.length,1);assert.equal(r.created[0].src,'assets/stickers/cute.png');assert.equal(r.until(),9000);
});
test('repeat snapshots do not replay feedback or extend the real episode window',()=>{
 const r=room(),s=framed();r.apply(s);r.at(4000);r.apply(s);assert.equal(r.created.length,1);assert.equal(r.until(),9000);
 r.at(9000);r.apply(s);assert.equal(r.el.textContent,'');assert.equal(r.el.classes.has('show'),false);
});
test('hidden feedback is not consumed and a current visible snapshot can display it once',()=>{
 const r=room(),s=framed();r.visible(false);r.apply(s);assert.equal(r.created.length,0);
 r.visible(true);r.at(2000);r.apply(s);assert.equal(r.created.length,1);assert.equal(r.until(),9000);
});
test('expired/future feedback never appears and an expired owner bubble does not clear newer chat',()=>{
 const r=room(),s=framed();r.at(10000);r.apply(s);assert.equal(r.created.length,0);
 r.at(500);r.apply(s);assert.equal(r.created.length,0);
 r.at(1000);r.apply(s);r.say('A newer actual chat reply',3000);r.at(10000);r.apply(s);
 assert.equal(r.el.textContent,'A newer actual chat reply');
});
test('unknown sticker names cannot become external URLs or markup',()=>{
 const r=room();r.say('<script>plain text</script>',1000,'../../secret.png');
 assert.equal(r.el.textContent,'<script>plain text</script>');assert.equal(r.created.length,0);
});

function desktop(t){
 const dir=mkdtempSync(join(tmpdir(),'mapped-feedback-'));mkdirSync(join(dir,'pet'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));t.mock.timers.enable({apis:['Date'],now:1000});
 let state=home();const writes=[];
 const platform=new PetPlatform({get:name=>name==='petBehavior'?{roomState:async()=>state}:undefined,logger:()=>({warn(error){throw error;}})});
 platform.bound={id:'workspace',path:dir};
 const configPaths={defaultFile:resolve('vendor/dsh-pet/platform/assets/config.jsonc'),userFile:join(dir,'main.json'),legacyUserFile:join(dir,'old.json'),petDir:join(dir,'pet')};
 const own=upstream.readAllConfig(configPaths).main.pets[0];assert.ok(own);
 platform.pets=()=>[own];
 platform.setup={configPaths,playback:{cancelAll(){}},state:{cancelAll(){},writeSection:(key,value)=>writes.push({key,value}),writePet:(id,key,value)=>writes.push({id,key,value})}};
 t.after(()=>platform.close());
 return {platform,writes,set:s=>{state=s;}};
}
test('Desktop feedback uses existing say without anim, repeated events do not replay and next event keeps main key',async t=>{
 const f=desktop(t);await f.platform.readBehavior();const say=f.writes.filter(x=>x.key==='say');
 assert.equal(say.length,1);assert.equal(say[0].value.text,event().text);assert.equal(say[0].value.image,'可爱');assert.equal(say[0].value.anim,false);assert.equal(say[0].value.expiresAt,event().until);
 f.set({...home(),now:2000,her:{...home().her,etaMs:400}});await f.platform.readBehavior();assert.equal(f.writes.filter(x=>x.key==='say').length,1);
 f.set(home('next-touch'));await f.platform.readBehavior();assert.equal(f.writes.filter(x=>x.key==='say').length,2);
 assert.equal(f.writes.filter(x=>x.key==='anim').length,0);
});
test('an obsolete asynchronous Body read cannot publish mapped feedback after a binding change',async t=>{
 const f=desktop(t);let done;f.platform.ctx.get=()=>({roomState:()=>new Promise(resolve=>{done=resolve;})});
 const pending=f.platform.readBehavior();f.platform.bound={id:'another',path:'/disposable-other'};done(home());await pending;
 assert.equal(f.writes.length,0);
});

test('a proxy gap notice cannot overwrite a committed owner fact, including a phase change in its live window',async t=>{
 const f=desktop(t),s=home();s.her={kind:'rest',activity:'Quiet actual rest'};s.behavior={...s.behavior,presentationKind:'rest',startedAt:500};
 s.emotion={feelings:['sad'],updatedAt:500};f.set(s);
 const actual=resolveActivityPlayback(s);assert.equal(actual.gap,true);assert.ok(actual.notice);
 await f.platform.readBehavior();assert.deepEqual(f.writes.filter(x=>x.key==='say').map(x=>x.value.text),[event().text]);
 f.set({...s,behavior:{...s.behavior,phase:'another-real-phase'}});await f.platform.readBehavior();
 assert.deepEqual(f.writes.filter(x=>x.key==='say').map(x=>x.value.text),[event().text]);
});

test('Room hides the old bubble through hidden expiry and a pending or failed fresh snapshot',()=>{
 const r=room(),s=framed();r.apply(s);assert.equal(r.el.classes.has('show'),true);
 r.visible(false);r.sync();assert.equal(r.el.classes.has('show'),false);
 r.at(10000);r.visible(true);r.sync();assert.equal(r.waiting(),true);
 assert.equal(r.el.classes.has('show'),false,'No stale bubble while the fresh request is pending or fails');
 r.apply(s);assert.equal(r.el.textContent,'');assert.equal(r.el.classes.has('show'),false);
 r.say('Fresh actual chat',3000);r.apply(s);assert.equal(r.el.textContent,'Fresh actual chat');
});

test('actual Room act response retains shared fact/sticker ownership instead of legacy reaction replacement',async()=>{
 const r=room(),s=framed();await r.act({ok:true,home:s,event:{reaction:'Legacy reaction text'}});
 assert.equal(r.el.textContent,event().text);assert.equal(r.created.length,1);assert.equal(r.until(),9000);
 r.at(9000);r.apply(s);assert.equal(r.el.textContent,'');assert.equal(r.el.classes.has('show'),false);
});
