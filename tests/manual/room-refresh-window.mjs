import {Context} from '@deepseek-ai/cordis';
import {LivingView, LivingWorld} from '../../dist/src/living/index.js';
// The actual Room process, preload, scene and Behavior share only a disposable
// workspace. The native event path has no periodic Room poll.
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {CompanionBehavior} from '../../dist/src/living/body/plugin.js';
import {Room} from '../../dist/src/room/plugin.js';
import {roomAsset} from '../../dist/src/room/assets.js';
import {emptyHomeState} from '#feiyu-home';

const temporary=realpathSync(mkdtempSync(join(tmpdir(),'room-event-window-')));
const directory=join(temporary,'.chatpet/data/life');mkdirSync(directory,{recursive:true});
writeFileSync(join(directory,'home.json'),JSON.stringify(emptyHomeState()));
const errors=[];
let target={id:'fixture',path:temporary,sessionIds:[]},origin,behavior,room,ready=false,reads=0;
let emotion={label:'初始心情',feelings:['calm'],updatedAt:1};
const events=new Map(),views=[];
const emit=(name,...args)=>{for(const listener of events.get(name) ?? [])listener(...args);};
const host={native:{},workspace:{status:()=>({state:'ready',target}),storageId:()=>target.id,
 homeScope:()=>({workspaceId:target.id,path:target.path,storageId:target.id,bootId:'fixture',generation:0}),runtime:{config:{companionId:'fixture'},identity:()=>({displayName:'Fixture'}),store:{meta:()=>undefined}}}};
const registry={get:id=>id===target.id?target:undefined,archivedSessionIds:[]};
const ctx={petCore:host,workspaceRegistry:registry,
  get(name){return name==='petBehavior'?behavior:name==='petEmotion'?{read:async()=>{},roomSnapshot:()=>emotion}:name==='webServer'?{getOrigin:()=>origin}:undefined;},
  get petBehavior(){return behavior;},emit,
  on(name,listener){const listeners=events.get(name) ?? new Set();events.set(name,listeners);listeners.add(listener);return()=>listeners.delete(listener);},
};
const until=async(read,label,ms=16000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await read())return;await delay(15);}throw Error('Timed out: '+label+' '+JSON.stringify({reads,errors,views:views.slice(-2)}));};
const injection=`<script type="module">
 const report=()=>fetch('/fixture-view',{method:'POST',body:JSON.stringify({activity:document.getElementById('activityText')?.textContent,emotion:document.getElementById('emotionChip')?.textContent})});
 const observer=new MutationObserver(report);observer.observe(document.getElementById('activityText'),{childList:true});observer.observe(document.getElementById('emotionChip'),{childList:true});
 const timer=setInterval(()=>{if(document.getElementById('loading')?.classList.contains('hide')){clearInterval(timer);void report();void fetch('/fixture-ready');}},20);
</script>`;
const server=createServer(async(req,res)=>{
 try{
  if(req.url==='/fixture-error'){let raw='';for await(const chunk of req)raw+=chunk;errors.push(raw);res.end('ok');return;}
  if(req.url==='/fixture-ready'){ready=true;res.end('ok');return;}
  if(req.url==='/fixture-view'){let raw='';for await(const chunk of req)raw+=chunk;views.push({...JSON.parse(raw),at:Date.now()});res.end('ok');return;}
  const response=await roomAsset(new Request('http://127.0.0.1'+req.url,{method:req.method}));
  const headers=Object.fromEntries(response.headers);delete headers['content-length'];
  let body=Buffer.from(await response.arrayBuffer());
  if(req.url==='/chatpet-room/index.html')body=Buffer.from(body.toString().replace('<head>',`<head><script>for(const name of ['error','unhandledrejection'])addEventListener(name,e=>fetch('/fixture-error',{method:'POST',body:String(e.reason?.stack||e.error?.stack||e.message)}));</script>`)+injection);
  if(req.url==='/chatpet-room/app.js'){
    assert.ok(!/setInterval\(poll/.test(body.toString()),'Native Room must use change notifications');
  }
  res.writeHead(response.status,headers);res.end(body);
 }catch(error){res.writeHead(500);res.end(String(error));}
});
const {world, release: releaseWorld}=LivingWorld.retain(new Context(),host,'body');
function mountBody(){
 const next=new CompanionBehavior(ctx,host,new LivingView({},undefined,undefined,undefined,
   (scope,bodyOnly,observation)=>world.changed(ctx,host,()=>behavior===next,scope,bodyOnly,observation)));
 next.activate();
 return next;
}
let held=false,heldReady,releaseHeld;
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+server.address().port;
 behavior=mountBody();room=new Room(ctx);
 const request=room.request.bind(room);
 room.request=async(...args)=>{
   const value=await request(...args);if(args[1]==='roomState'){reads++;if(held){held=false;heldReady();await new Promise(resolve=>{releaseHeld=resolve;});}}
   return value;
 };
 await room.open(target.id);await until(()=>ready && reads>=1,'initial snapshot, native subscription and scene');
 await delay(50);const before=reads;
 emit('world.changed',{...host.workspace.homeScope(),workspaceId:'another-workspace'});
 await delay(70);assert.equal(reads,before,'unrelated workspace changes do not wake this Room');
 const started=Date.now(),result=await behavior.act(target.id,'feed');
 await until(()=>views.some(view=>view.at>=started && view.activity.includes(result.home.her.activity)),'body event appears through native notification',1000);
 const latency=views.find(view=>view.at>=started && view.activity.includes(result.home.her.activity)).at-started;
 assert.ok(latency<1000,JSON.stringify({latency}));

 // An old in-flight response must not overwrite a newer Emotion revision.
 held=true;const captured=new Promise(resolve=>{heldReady=resolve;});
 emotion={label:'过时的难过',feelings:['sad'],updatedAt:2};emit('pet/emotion.changed',target.id,{});
 await captured;
 emotion={label:'最新的开心',feelings:['happy'],updatedAt:3};emit('pet/emotion.changed',target.id,{});
 await behavior.snapshot(target.id);releaseHeld();
 await until(()=>views.some(view=>view.emotion.includes('最新的开心')),'queued refresh after in-flight response');
 assert.ok(!views.some(view=>view.emotion.includes('过时的难过')),'stale revision is never painted');

 // Existing bootId/revision also rejects a response from an unloaded service.
 held=true;const oldBootCaptured=new Promise(resolve=>{heldReady=resolve;});
 emotion={label:'旧一代状态',feelings:['worry'],updatedAt:4};emit('pet/emotion.changed',target.id,{});
 await oldBootCaptured;await behavior.close();
 emotion={label:'新一代状态',feelings:['calm'],updatedAt:5};behavior=mountBody();
 await behavior.snapshot(target.id);
 // Match the native area activation notification after the replacement is ready.
 world.changed(ctx,host,()=>!!behavior);
 releaseHeld();
 await until(()=>views.some(view=>view.emotion.includes('新一代状态')),'replacement Behavior generation');
 assert.ok(!views.some(view=>view.emotion.includes('旧一代状态')),'old generation never overwrites replacement');
 console.log(JSON.stringify({ok:true,nativeWindow:true,preloadBridge:true,bodyMirrorMs:latency,nativeEventRefresh:true,
   wrongWorkspaceIgnored:true,staleRevisionRejected:true,oldBootRejected:true,reads,modelCalls:0,personalProfile:false}));
}finally{
 releaseHeld?.();await room?.close();await behavior?.close();releaseWorld();server.closeAllConnections();
 if(server.listening)await new Promise(resolve=>server.close(resolve));rmSync(temporary,{recursive:true,force:true});
}
