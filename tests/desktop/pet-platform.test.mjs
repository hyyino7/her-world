import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,rmSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {PetPlatform} from '../../dist/src/desktop/platform/plugin.js';
import {DEFAULT_COMPANION_SETTINGS} from '../../dist/src/core/companion-settings.js';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Desktop} from '../../dist/src/desktop/index.js';
import {adaptRoomApp,roomAsset} from '../../dist/src/room/assets.js';
import {behaviorPresentation,feelingLabels} from '../../dist/src/living/body/presentation.js';
import {COMPANION_FEELINGS} from '../../dist/src/contracts/emotion.js';

export function fixture(root,getOrigin=()=> 'http://127.0.0.1',services={}) {
  let target={id:'a',path:root}, turns=[], requests=0;
  let generation=0;
  const homeScope=()=>({workspaceId:target.id,path:target.path,storageId:target.id,bootId:'fixture-workspace',generation});
  const chat={id:'native-session',snapshot:()=>({workspaceId:'a',sessionId:'native-session',messages:turns,reason:'completed',generating:false}),
    run:async(action,input)=>{if(action==='send'){requests++;turns=[...turns,{id:requests*2,role:'user',text:input.text},{id:requests*2+1,role:'assistant',text:'native reply'}];}return chat.snapshot();}};
  let chatOpens=0,presentation;
  const events=new Map(),receipts=[],store=new Map();
  const ctx={logger:Object.assign(()=>console,console),petBehavior:services.petBehavior,connection:{broadcast(){}},get:name=>services[name],on:(name,listener)=>{
    const listeners=events.get(name) ?? new Set();events.set(name,listeners);listeners.add(listener);return()=>listeners.delete(listener);
  },webServer:{getOrigin},
    petCore:{workspace:{status:()=>({state:'ready',target}),companionSettings:()=>structuredClone(DEFAULT_COMPANION_SETTINGS),
      sessionStatus:session=>session.header.cwd===target.path?{state:'ready',target}:null,
      storageId:()=>target.id,homeScope,runtime:{identity:()=>({displayName:'大肥鱼',character:''}),store:{get:(table,key)=>store.get(table+key),put:(table,key,value)=>store.set(table+key,value)}}}},
    petDesktop:{chat,openChat:async()=>{chatOpens++;},recordPlayback:receipt=>receipts.push(receipt),
      onPresentation:receive=>{presentation=receive;return()=>{presentation=undefined;};}}};
  const platform=new PetPlatform(ctx);
  return {platform,ctx,receipts,present:(type,value)=>presentation?.(type,value),publish:(name,...args)=>{for(const receive of events.get(name) ?? [])receive(...args);},
    rebind(id,path=target.path){generation++;target={id,path};},requests:()=>requests,chatOpens:()=>chatOpens};
}

async function configureFixturePet(platform,display='none') {
 const endpoint=new URL('http://localhost/chatpet-presentation/config');
 const current=await platform.handle(endpoint,'GET',undefined,new AbortController().signal);
 const template=current.obj.main.bodyTemplate;
 assert.ok(template,'The current host exposes its explicit body template');
 await platform.handle(endpoint,'PUT',JSON.stringify({pets:[{...template,display}]}),new AbortController().signal);
}

test('bound platform runs original config, media, controls, animation and native chat',async()=>{
 const root=mkdtempSync(join(tmpdir(),'chatpet-platform-test-')), {platform,rebind,requests}=fixture(root);
 const request=(endpoint,method='GET',body)=>platform.handle(new URL('http://localhost/chatpet-presentation/'+endpoint),method,body?JSON.stringify(body):undefined,new AbortController().signal);
 try {
  const access=platform.ownerAccess('a'), tools=platform.controlAccess('a');
  assert.notEqual(access.token,tools.token);
  assert.deepEqual((await request('config')).obj.main.pets,[],'Initialization creates no implicit body');
  await configureFixturePet(platform);
  const conf=(await request('config')).obj;
  assert.equal(conf.main.pets[0].name,'大肥鱼');
  assert.equal(conf.main.pets[0].display,'none');
  const p=conf.main.pets[0];
  const multi=await request('config','PUT',{pets:[p,{...p,id:'second',name:'蓝鲸',display:'web',position:{corner:'top-left',marginX:5,marginY:9}}]});
  assert.equal(multi.obj.main?.pets.length??multi.obj.ok,2,JSON.stringify(multi.obj));
  assert.deepEqual(platform.status().pets.map(x=>x.name),['大肥鱼','大肥鱼'],'Every body projects the shared companion identity');
  const pack=platform.status().packsDirectory;
  writeFileSync(join(pack,'mini-config.json'),JSON.stringify({pets:[{...p,id:'packpet',name:'自己的形象'}]}));
  mkdirSync(join(pack,'mini-animation'));writeFileSync(join(pack,'mini-animation','自定义.webm'),'my-pack');
  assert.equal(readFileSync((await request('thumb/mini/自定义.webm')).file,'utf8'),'my-pack');
  assert.equal((await request('thumb/main/点击回应-元气挥手.webm')).kind,'file');
  for(const name of conf.main.animations.baifan)assert.equal((await request('thumb/main/'+encodeURIComponent(name)+'.webm')).kind,'file');
  assert.equal((await request('thumb/main/吃白饭.webm')).kind,'file');
  assert.equal((await request('pic/memes/main/可爱.png')).kind,'file');
  const anim=await request('anim?pet=second&surface=web','POST',{name:'螃蟹走路'});
  assert.equal(anim.obj.ok,true,JSON.stringify(anim.obj));
  assert.equal((await request('state')).obj.pets.second.anim.data.name,'螃蟹走路');
  assert.equal((await request('chat?pet=second','POST',{text:'和同一个伙伴聊天'})).obj.text,'native reply');
  assert.equal((await request('chat?pet=main')).obj.messages.at(-1).content,'native reply');
  assert.equal((await request('chat/memory')).status,404);
  assert.equal((await request('chat/memory','DELETE')).status,404);
  assert.equal(requests(),1);
  const {file}=platform.standaloneAccess('a');
  assert.equal(statSync(file).mode&0o777,0o600);
  assert.equal(JSON.parse(readFileSync(file)).token,access.token);
  rebind('b');platform.sync();
  assert.equal(existsSync(file),false);
  assert.notEqual(platform.ownerAccess('b').token,access.token);
 }finally{platform.close();rmSync(root,{recursive:true,force:true});}
});

test('current appearance config supports an empty editor, a size-232 pet and primary pet settings', async t => {
  const root=mkdtempSync(join(tmpdir(),'chatpet-platform-config-')), {platform}=fixture(root);
  t.after(()=>{platform.close();rmSync(root,{recursive:true,force:true});});
  const directory=join(root,'.chatpet/data/pet-platform'), current=join(directory,'main-config.jsonc');
  mkdirSync(directory,{recursive:true});
  const retired=join(directory,'main-config.json'), old='{"pets":[{"id":"old","size":462}]}';
  writeFileSync(retired,old);

  platform.ownerAccess('a');
  const endpoint=new URL('http://localhost/chatpet-presentation/config'), signal=new AbortController().signal;
  const read=async()=>(await platform.handle(endpoint,'GET',undefined,signal)).obj.main;
  const {pets,bodyTemplate}=await read();
  assert.deepEqual(pets,[]);
  const main={...bodyTemplate,id:'main',size:232,display:'none',fixedEnabled:false};
  const second={...main,id:'second',size:144};
  assert.equal((await platform.handle(endpoint,'PUT',JSON.stringify({pets:[second,main]}),signal)).status,200);
  assert.deepEqual((await read()).pets.map(({id,size})=>[id,size]),[['second',144],['main',232]]);
  await platform.savePreference('desktopFixed',true);
  assert.deepEqual((await read()).pets.map(({id,fixedEnabled})=>[id,fixedEnabled]),[['second',false],['main',true]]);

  const config=JSON.parse(readFileSync(current,'utf8'));
  writeFileSync(current,'// Hand-edited JSONC\n'+JSON.stringify({...config,custom:'https://example.test/a//b'}));
  const timing=platform.status().timing, next={...timing,whisper:timing.whisper+1};
  await platform.saveTiming('a',timing,next);
  const persisted=JSON.parse(readFileSync(current,'utf8'));
  assert.deepEqual(persisted.eventsRefreshSec,next);
  assert.deepEqual(persisted.pets,config.pets);
  assert.equal(persisted.custom,'https://example.test/a//b');
  assert.equal(readFileSync(retired,'utf8'),old);

  platform.close();
  const broken='{"pets": /* unfinished';
  writeFileSync(current,broken);
  assert.throws(()=>platform.ownerAccess('a'),/外观配置无法解析/);
  assert.equal(readFileSync(current,'utf8'),broken);
});

test('settings read creates no body; one host preserves raw configuration while activity overrides only the render view',async()=>{
 const root=mkdtempSync(join(tmpdir(),'chatpet-platform-activity-'));
 let state={her:{kind:'idle',asleep:false},emotion:{feelings:[]}};
 let feeds=0;
 const {platform,chatOpens}=fixture(root,undefined,{petBehavior:{roomState:async()=>state,presentFeed:async(_workspaceId,_interaction,presentationBlocked)=>{
   const blocked=presentationBlocked();
   if(blocked)return {admission:'presentation-blocked',blocked};
   if(state.her.kind==='eat')return {admission:'already-presented'};
   feeds++;state={...state,her:{kind:'eat',asleep:false}};return {admission:'started'};
 }},petEmotion:{}});
 const request=(endpoint,method='GET',body)=>platform.handle(new URL('http://localhost/chatpet-presentation/'+endpoint),method,body?JSON.stringify(body):undefined,new AbortController().signal);
 try {
  assert.equal(platform.status().running,false);assert.equal(existsSync(join(root,'.chatpet')),false);
  platform.ownerAccess('a');await platform.refreshBehavior();
  const raw=(await request('config')).obj;
  assert.ok(raw.main.animations.categories.some(c=>c.id==='吃什么'),'Raw compatible animation pools remain editable');
  const idle=(await request('config-live')).obj;
  assert.ok(!idle.main.animations.categories.some(c=>c.id==='吃什么'));
  assert.deepEqual(idle.main.animations.moves.actions,[],'The continuing shared rest owns the projected animation');
  const menu=(await request('state')).obj.sections.menu.data.items;
  assert.ok(menu.some(i=>i.label==='进入房间'));
  await configureFixturePet(platform);
  await platform.show();await platform.show();assert.equal(platform.status().pets.length,1);assert.equal(platform.status().pets[0].display,'desktop');
  await request('native-chat-window','POST',{});assert.equal(chatOpens(),1);
  const missing=await request('anim?pet=missing&surface=desktop','POST',{name:'吃饭团'});
  assert.equal(missing.obj.ok,false);assert.equal(missing.obj.reason,'unknown-pet');assert.equal(feeds,0);
  assert.equal((await request('anim?pet=main&surface=desktop','POST',{name:'吃饭团'})).obj.ok,true);assert.equal(feeds,1);assert.equal(state.her.kind,'eat');
  state={her:{kind:'eat',asleep:false},emotion:{feelings:['anger']}};await platform.refreshBehavior();
  const eating=(await request('config-live')).obj;
  assert.deepEqual(eating.main.animations.idle,['吃白饭']);assert.equal(eating.main.pets[0].workStatusEnabled,false);
  assert.equal((await request('anim?pet=main&surface=desktop','POST',{name:'写代码'})).status,409);
  assert.equal((await request('anim?pet=main&surface=desktop','POST',{name:'吃饭团'})).obj.ok,true);assert.equal(feeds,1,'A playback retry does not feed twice during the same activity');
  assert.deepEqual((await request('config')).obj.main.animations,raw.main.animations,'editor must not save temporary activity pools');
  const timing=platform.status().timing;
  await platform.saveTiming('a',timing,{balance:1800,whisper:420,sleepTalk:90});
  assert.equal(platform.featurePreferences().desktopWhisperMinutes,7);assert.equal(platform.featurePreferences().desktopSleepTalkSeconds,90);
  await assert.rejects(platform.saveTiming('a',timing,{balance:1800,whisper:480,sleepTalk:90}),/改变/);
  await platform.hide();assert.equal(platform.bodyStatus().running,false);
 }finally{platform.close();rmSync(root,{recursive:true,force:true});}
});

for(const returnToOriginal of [false,true]) test(
 'closing desktop pets stops after an in-flight config write changes binding'+(returnToOriginal?' A→B→A':' A→B'),async t=>{
 const root=mkdtempSync(join(tmpdir(),'chatpet-desktop-hide-'));
 const a=join(root,'a'),b=join(root,'b');
 mkdirSync(a);mkdirSync(b);
 const {platform,ctx,rebind}=fixture(a);
 t.after(()=>{platform.close();rmSync(root,{recursive:true,force:true});});
 const request=(endpoint,method='GET',body)=>platform.handle(new URL('http://localhost/chatpet-presentation/'+endpoint),
   method,body&&JSON.stringify(body),new AbortController().signal);
 async function configure() {
   const {obj:{main:{bodyTemplate:pet}}}=await request('config');
   assert.equal((await request('config','PUT',{pets:[{...pet,display:'web'},{...pet,id:'second',display:'web'}]})).status,200);
 }
 await configure();
 rebind('b',b);
 await configure();
 rebind('a',a);
 assert.equal(platform.ownerAccess('a').path,'/chatpet-presentation');
 const entered=Promise.withResolvers(),resume=Promise.withResolvers();
 let calls=0;
 ctx.petDesktop.features={restore(){},refresh(){if(++calls===1){entered.resolve();return resume.promise;}}};
 const hiding=assert.rejects(platform.hide(),error=>error.code==='STALE_BINDING');
 try {
   await entered.promise;
   rebind('b',b);
   if(returnToOriginal)rebind('a',a);
 } finally {resume.resolve();}
 await hiding;
 assert.deepEqual((await request('config')).obj.main.pets.map(({id,display})=>[id,display]),
   [['main',returnToOriginal?'none':'web'],['second','web']]);
});

test('connected standalone attaches to the managed host without requiring or spawning another Electron body',async()=>{
 const root=mkdtempSync(join(tmpdir(),'chatpet-connected-')),calls=[];
 const server=createServer((req,res)=>{calls.push({path:req.url,authorization:req.headers.authorization});req.resume();res.setHeader('Content-Type','application/json');res.end('{"ok":true}');});
 try{
  await new Promise((ok,no)=>server.once('error',no).listen(0,'127.0.0.1',ok));
  const file=join(root,'connection.json');writeFileSync(file,JSON.stringify({baseUrl:'http://127.0.0.1:'+server.address().port+'/chatpet-presentation',token:'fixture'}),{mode:0o600});
  const child=spawn(process.execPath,[fileURLToPath(new URL('../../src/desktop/standalone.mjs',import.meta.url)),'--connection',file],{env:{...process.env,DSH_CHATBOT_ELECTRON_PATH:'/nonexistent/must-not-spawn'}});
  let error='';child.stderr.on('data',data=>error+=data);child.stdout.resume();
  assert.equal(await new Promise((ok,no)=>{child.once('error',no);child.once('exit',ok);}),0,error);
  assert.deepEqual(calls.map(c=>c.path),['/chatpet-presentation/presentation','/chatpet-presentation/native-chat-window']);
  assert.ok(calls.every(c=>c.authorization==='Bearer fixture'));
 }finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));rmSync(root,{recursive:true,force:true});}
});

test('HTTP rejects visitor chat, accepts owner headers and confines media tokens to assets',async()=>{
 const root=mkdtempSync(join(tmpdir(),'chatpet-platform-web-')),{platform,requests}=fixture(root,()=> 'http://127.0.0.1:'+server.address().port);
 const server=createServer((req,res)=>platform.http(req,res));
 try{
  await new Promise((ok,no)=>server.once('error',no).listen(0,'127.0.0.1',ok));
  const base='http://127.0.0.1:'+server.address().port+'/chatpet-presentation';
  const owner=platform.ownerAccess('a'),control=platform.controlAccess('a');
  assert.equal(control.baseUrl,base);
  await configureFixturePet(platform);
  await platform.handle(new URL(base+'/pet-display'),'POST',JSON.stringify({id:'main',display:'web'}),new AbortController().signal);
  const action=await fetch(control.baseUrl+'/anim?pet=main&surface=web',{method:'POST',headers:{Authorization:'Bearer '+control.token},body:JSON.stringify({name:'螃蟹走路'})});
  const accepted=await action.json();assert.equal(accepted.ok,true);
  const req=(path,method='GET',token,body)=>fetch(base+'/'+path,{method,headers:token?{Authorization:'Bearer '+token}:{},body});
  assert.equal((await req('native-chat')).status,401);
  assert.equal((await req('chat?pet=main','POST',control.token,'{"text":"denied"}')).status,401);
  const playback=await req('playback/'+accepted.playbackId,'GET',control.token);
  assert.equal(playback.status,200);assert.equal((await playback.json()).status,'accepted');
  assert.equal((await req('playback/'+accepted.playbackId+'/report','POST',control.token,'{"status":"playing"}')).status,401);
  const waiting=req('playback/'+accepted.playbackId+'?wait=ended&timeout=1000','GET',control.token);
  assert.equal((await req('playback/'+accepted.playbackId+'/report','POST',owner.token,'{"status":"playing"}')).status,200);
  assert.equal((await req('playback/'+accepted.playbackId+'/report','POST',owner.token,'{"status":"ended"}')).status,200);
  const ended=await waiting;assert.equal(ended.status,200);assert.equal((await ended.json()).status,'ended');
  assert.equal(requests(),0);
  assert.equal((await req('m/'+owner.mediaToken+'/native-chat')).status,401);
  assert.equal((await req('m/'+owner.mediaToken+'/chat?pet=main','POST',undefined,'{"text":"denied"}')).status,401);
  const publicMedia=await req('m/'+owner.mediaToken+'/thumb/main/待机呼吸休闲.webm');
  assert.equal(publicMedia.status,200);assert.ok((await publicMedia.arrayBuffer()).byteLength>1024);
  assert.equal((await req('config','GET',owner.token)).status,200);
  assert.equal((await req('native-chat','POST',owner.token,JSON.stringify({action:'send',input:{text:'online'}}))).status,200);
  assert.equal(requests(),1);
 } finally {server.closeAllConnections();await new Promise(ok=>server.close(ok));platform.close();rmSync(root,{recursive:true,force:true});}
});

test('normal host reports only verified playback transitions into Emotion and refreshes shared behavior by events',async()=>{
 const root=mkdtempSync(join(tmpdir(),'chatpet-presentation-receipt-'));
 let home={her:{kind:'idle',activity:'安静地待着',asleep:false},emotion:{feelings:[]}};
 const services={};
 const {platform,ctx,receipts,publish,present}=fixture(root,undefined,services);
 const request=(path,method='GET',body)=>platform.handle(new URL('http://localhost/chatpet-presentation/'+path),method,body?JSON.stringify(body):undefined,new AbortController().signal);
 try{
  platform.ownerAccess('a');await platform.refreshBehavior();
  await configureFixturePet(platform);
  const config=(await request('config')).obj;
  await request('config','PUT',{pets:[{...config.main.pets[0],display:'web'}]});
  present('expression',{workspaceId:'a',sessionId:'native-session',turn:1,action:'wave'});
  const playback=(await request('state')).obj.pets.main.anim.data.playbackId;
  assert.equal(receipts.length,0,'accepted requests are not observed playback');
  await request('playback/'+playback+'/report','POST',{status:'playing'});
  await request('playback/'+playback+'/report','POST',{status:'playing'});
  await request('playback/'+playback+'/report','POST',{status:'ended'});
  await request('playback/'+playback+'/report','POST',{status:'playing'});
  assert.deepEqual(receipts.map(({id,name,status,kind})=>({id,name,status,kind})),[
    {id:playback,name:'wave',status:'playing',kind:'expression'},
    {id:playback,name:'wave',status:'ended',kind:'expression'}]);
  services.petBehavior={roomState:async()=>home};
  home={her:{kind:'eat',activity:'正在吃饭',asleep:false},emotion:{feelings:['anger']}};
  publish('world.changed',ctx.petCore.workspace.homeScope());
  await platform.refreshing;
  assert.equal(platform.status().activity,undefined);
  assert.equal(platform.status().representation.action,'吃白饭');
 }finally{platform.close();rmSync(root,{recursive:true,force:true});}
});

test('normal renderer state consumes the native Desktop strict work delay without an immediate upstream bypass',async t=>{
 const root=mkdtempSync(join(tmpdir(),'chatpet-normal-work-'));
 const {platform,ctx,publish}=fixture(root);
 const desktop=new Desktop({getPresentation:()=>({bodyStatus:()=>({running:true})}),getEmotion:()=>undefined},ctx.petCore);
 ctx.petDesktop=desktop;
 try{
  platform.ownerAccess('a');
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});
  const session={id:'native-session',header:{cwd:root},snapshotEvents:()=>[]};
  let turn=0,seq=0;
  const event=(type,reason)=>{
    if(type==='turn/start')turn++;
    const value={type,time:Date.now(),seq:++seq,data:{turn,...(reason?{reason:{kind:reason}}:{})}};
    desktop.event(session,value);publish('session/event',session,value);
  };
  const stage=async()=> (await platform.handle(new URL('http://localhost/chatpet-presentation/state'),'GET',undefined,new AbortController().signal)).obj.sections.workStatus?.data.state ?? null;
  event('turn/start');t.mock.timers.tick(5000);assert.equal(await stage(),null);
  event('turn/end','completed');assert.equal(await stage(),null);
  event('turn/start');t.mock.timers.tick(5001);assert.equal(await stage(),'thinking');
  event('tool/call');assert.equal(await stage(),'working');
  event('turn/end','completed');assert.equal(await stage(),'success');
  t.mock.timers.tick(60_001);assert.equal(await stage(),null,'upstream terminal cleanup still clears the shared renderer state');
  event('turn/start');t.mock.timers.tick(200);event('turn/end','error');assert.equal(await stage(),null);
 }finally{t.mock.timers.reset();platform.close();rmSync(root,{recursive:true,force:true});}
});

test('all nine feelings preserve actual activity and Room displays text without inventing a numeric mood',async()=>{
 const source=readFileSync(new URL('../../vendor/feiyu-room-template/public/room/app.js',import.meta.url),'utf8');
 const adapted=adaptRoomApp(source);
 assert.throws(()=>adaptRoomApp('changed upstream'),/source changed/);
 const chipSource=adapted.slice(adapted.indexOf('  const emo = state.emotion;'),adapted.indexOf("  $('qqText').textContent"));
 const render=new Function('state','$','companionLabel',chipSource);
 const renderChip=state=>render(state,()=>chip,()=> '大肥鱼');
 const chip={textContent:'',title:'',classList:{toggle(){}}};
 for(const feeling of COMPANION_FEELINGS){
  renderChip({emotion:{feelings:[feeling]}});
  assert.equal(chip.textContent,'心情 · '+feelingLabels[feeling]);
  assert.equal(behaviorPresentation({her:{kind:'eat',activity:'正在吃饭'},emotion:{feelings:[feeling]}}).action,'eat');
  assert.equal(behaviorPresentation({her:{kind:'idle',asleep:true},emotion:{feelings:[feeling]}}).action,'sleep');
 }
 renderChip({emotion:{label:'有点想你',mood:68}});assert.equal(chip.textContent,'心情 · 有点想你');
 renderChip({emotion:{label:'旧的中文心情'}});assert.equal(chip.textContent,'心情 · 旧的中文心情');
 renderChip({emotion:null});assert.equal(chip.textContent,'');
 const activitySource=adapted.slice(adapted.indexOf('  const expressionText ='),adapted.indexOf("  $('barEnergy').style.width"));
 const renderActivity=new Function('state','her','$','charMode="webm"',activitySource);
 const expression={sessionId:'chat',turn:2,action:'wave',actionLabel:'元气挥手'};
 const idle={kind:'idle',activity:'安静待着'};
 renderActivity({presentation:behaviorPresentation({her:idle},expression)},idle,()=>chip);
 assert.equal(chip.textContent,'安静待着 · 表情：元气挥手');
 const sleeping={kind:'idle',asleep:true,activity:'正在睡觉'};
 renderActivity({presentation:behaviorPresentation({her:sleeping},expression)},sleeping,()=>chip);
 assert.equal(chip.textContent,'正在睡觉');
 const response=await roomAsset(new Request('http://localhost/chatpet-room/app.js'));
 assert.equal(response.status,200);assert.ok((await response.text()).includes('const emotionWords'));
});
