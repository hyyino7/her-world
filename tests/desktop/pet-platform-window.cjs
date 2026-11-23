// Exercise the composed client with DSH's shipped React and a disposable, authenticated host.
const {app,BrowserWindow} = require('electron');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const {createServer}=require('node:http'), assert=require('node:assert/strict');
const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'chatpet-platform-window-')));
app.setPath('userData',path.join(dir,'profile'));
const repo=path.join(dir,'bound'); fs.mkdirSync(repo);
process.env.CHATPET_PRESENTATION_PROFILE=path.join(dir,'native-helper-profile');
// Observe collision impulses emitted by the unmodified renderer in the real multi-window helper.
const collisions=path.join(dir,'collisions.jsonl');
fs.writeFileSync(collisions,'');
const observer=path.join(dir,'observe.cjs'),runner=path.join(dir,'run-electron');
fs.writeFileSync(observer,`const {ipcMain}=require('electron');const fs=require('node:fs');
ipcMain.on('pet:collide-result',(_event,value)=>fs.appendFileSync(process.env.CHATPET_TEST_COLLISIONS,JSON.stringify(value)+'\\n'));
require(process.argv[2]);`);
fs.writeFileSync(runner,'#!/bin/sh\nexec "$CHATPET_TEST_ELECTRON" "$CHATPET_TEST_OBSERVER" "$@"\n',{mode:0o700});
Object.assign(process.env,{CHATPET_TEST_ELECTRON:process.execPath,CHATPET_TEST_OBSERVER:observer,CHATPET_TEST_COLLISIONS:collisions,DSH_PET_ELECTRON_PATH:runner});
const factory=path.resolve(__dirname,'../../src/desktop/platform/client.js');
const frontend=path.join(process.env.DSH_APP || '/Applications/DeepSeek Harness.app','Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets');
const entry=fs.readdirSync(frontend).find(name=>/^index-.*\.js$/.test(name));
let win, server, platform, bootstrap, ctx, address;
const errors=[];
const clock=ms=>new Promise(ok=>setTimeout(ok,ms));
async function until(fn,label,ms=14000) {
  const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await clock(90);}
  throw Error(label+' | '+errors.filter(m=>!m.includes('facing=')).slice(-15).join(' | '));
}
const page=`<!doctype html><meta charset="utf-8"><div id="root"></div><div id="test-pets"></div><script>
window.__ModuleLoader__={load(e){window.plugin=e;},create({staticModules}){window.mods=staticModules;throw Error('Fixture modules captured');}};
</script><script src="/platform.js"></script><script type="module" src="/${entry}"></script>`;
async function main(){
 await app.whenReady();
 const {PetPlatform}=await import('../../dist/src/desktop/platform/plugin.js');
 const {CompanionPorts}=await import('../../dist/src/core/tables/companion-ports.js');
 const {Context}=await import('@deepseek-ai/cordis');
 const scope=new Context();
 const {RecentLedger}=await import('../../dist/src/emotion/recent.js');
 const {DEFAULT_COMPANION_SETTINGS}=await import('../../dist/src/core/companion-settings.js');
 const receipts=[];
 const ledger=new RecentLedger({id:'test',path:repo},()=>DEFAULT_COMPANION_SETTINGS);
 const chat={id:'session',snapshot:()=>({messages:[],sessionId:'session',workspaceId:'test',generating:false}),run:async()=>chat.snapshot()};
 const handlers=new Set();
 const companionPorts=new CompanionPorts(), roomOpens=[];
 companionPorts.registerRoomWindow(scope,async workspaceId=>{
   roomOpens.push(workspaceId);
   return {running:true,ready:true,workspaceId};
 });
 ctx={root:scope.root,fiber:scope.fiber,[Context.isolate]:scope[Context.isolate],get:()=>undefined,logger:console,connection:{broadcast(){},authenticatedUrl:url=>url},on:(name,fn)=>{
   if(name==='session/event')handlers.add(fn);return ()=>handlers.delete(fn);
 },petDesktop:{chat,recordPlayback(receipt){receipts.push(receipt);ledger.playback(receipt);}},webServer:{getOrigin:()=>address},
   petCore:{native:{companionPorts},workspace:{
     runtime:{identity:()=>({displayName:'大肥鱼',character:''})},
     companionSettings:()=>({...DEFAULT_COMPANION_SETTINGS,desktopSize:232,desktopFixed:false,desktopWorkStatusEnabled:true}),
     sessionStatus:()=>({target:{id:'test'}}),status:()=>({state:'ready',target:{id:'test',path:repo}}),
   }}};
 platform=new PetPlatform(ctx);
 const access=platform.ownerAccess('test');
 const dispatch=(r,method='GET',input)=>platform.handle(new URL('http://localhost/chatpet-presentation/'+r),method,input?JSON.stringify(input):undefined,new AbortController().signal);
 const mainConfig=(await dispatch('config')).obj.main;
 assert.deepEqual(mainConfig.pets,[]);
 const original=mainConfig.bodyTemplate;
 assert.ok(original);
 const left={...original,id:'second',name:'第二只',position:{corner:'top-left',marginX:5,marginY:5}};
 const randomAnimations={...mainConfig.animations,idle:['点击回应-元气挥手'],turn:['点击回应-元气挥手'],categories:[],moves:{...mainConfig.animations.moves,actions:[]}};
 const setPools=random=>{
   // Upstream's form-save route intentionally does not edit animation pools.
   // Prepare only this disposable fixture's original JSONC configuration.
   const file=path.join(repo,'.chatpet/data/pet-platform/main-config.jsonc');
   const config=JSON.parse(fs.readFileSync(file,'utf8'));
   config.animations=random?randomAnimations:mainConfig.animations;
   config.animationWeights=random?{idle:100,turn:0,move:0}:mainConfig.animationWeights;
   fs.writeFileSync(file,JSON.stringify(config));
 };
 setPools(true);
 await dispatch('config','PUT',{pets:[{...original,display:'web'},{...left,display:'web'}],physics:{...mainConfig.physics,gravity:0},
   animations:randomAnimations,animationWeights:{idle:100,turn:0,move:0}});
 assert.deepEqual((await dispatch('config')).obj.main.animations.idle,['点击回应-元气挥手']);
 server=createServer((req,res)=>{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname.startsWith('/chatpet-presentation/')){
     // DSH Desktop's dsh-app://app proxy removes the browser's plugin cookies.
     delete req.headers.cookie;
     if(req.method==='POST' && /menu\/click|lock|anim|position/.test(url.pathname)) errors.push(req.method+' '+url.pathname.replace(/\/m\/[a-f0-9]+/,'')+url.search);
     return platform.http(req,res);
   }
   if(url.pathname==='/fixture-owner'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(platform.ownerAccess('test')));}
   if(url.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(page);}
   const file=url.pathname==='/platform.js'?factory:path.join(frontend,path.basename(url.pathname));
   if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
   res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(file));
 });
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok)); address='http://127.0.0.1:'+server.address().port;ctx.webServer.port=server.address().port;
 win=new BrowserWindow({width:840,height:640,show:false,webPreferences:{contextIsolation:true,sandbox:true}});
 win.webContents.on('console-message',(_e,detail,msg)=>{ const text=typeof detail==='object'?detail.message:msg;if(text)errors.push(text); });
 await win.loadURL(address);
 const ev=code=>win.webContents.executeJavaScript(code);
 await until(()=>ev('!!(window.mods?.react && window.plugin)'), 'DSH React load');
 const mount=()=>ev(`(()=>{const slots=[],services=new Map(), dispose=[];
  window.testVibrations=[];Object.defineProperty(navigator,'vibrate',{configurable:true,value:ms=>{window.testVibrations.push(ms);return true;}});
  window.testNotifications=[];window.Notification=class{static permission='granted';constructor(title,opts){this.title=title;this.opts=opts;window.testNotifications.push(this);}close(){}};
  services.set('uiWorkspace',{openSession(id){window.notificationSession=id;}});
  const noop=()=>()=>{};
  const c={locale:{register:noop,bind:()=>key=>key},connection:{rpc:{call:async(_path,method)=>({ok:true,value:method.endsWith('snapshot')?{preferences:{workspace:{id:'test'}}}:await(await fetch('/fixture-owner')).json()})}},
    slots:{inject(_n,fn){const r=fn();if(r?.next)for(const _ of r){};}, register(meta,render){if(meta.name==='shell.overlay')slots.push([meta.id,render]);return ()=>{};}},
    plugin(p){p.apply(c);window.mountViews?.();return {dispose:async()=>{}};},effect(fn){const d=fn();if(typeof d==='function')dispose.push(d);}, inject(_names,fn){fn(c);}, get:n=>services.get(n),provide:(n,v)=>services.set(n,v),
    commandUi:{decorate:noop},remote:{commands:{}},on:noop};
  const modules=m=>window.mods[m];window.plugin.factory(modules).apply(c);
  const react=modules('react');const ui=modules('react-dom/client').createRoot(document.querySelector('#test-pets'));
  window.mountViews=()=>ui.render(react.createElement(react.Fragment,null,...slots.map(([id,Component])=>react.createElement(Component,{key:id}))));window.mountViews();
  window.testServices=services;window.stopPets=()=>{ui.unmount();for(const d of dispose.reverse())d();};
  return slots.map(s=>s[0]);
 })()`);
 await mount();
 await until(()=>ev('[...document.querySelectorAll("video")].filter(v=>v.videoWidth>0).length >= 2'), 'two decoded browser pets');
 await until(()=>ledger.read().actions.some(action=>action.name==='wave'),'decoded browser random start reaches recent Emotion ledger').catch(async error=>{
   console.error(JSON.stringify({receipts,videos:await ev("[...document.querySelectorAll('video')].map(v=>({src:v.src,paused:v.paused,time:v.currentTime,classes:v.className}))")}));throw error;
 });
 assert.ok(receipts.some(receipt=>receipt.kind==='random' && receipt.name==='wave' && receipt.status==='playing'));
 setPools(false);await dispatch('config','PUT',{physics:mainConfig.physics});
 const poses=await until(()=>ev(`JSON.stringify(['main','second'].map(id=>window.testServices.get('chatpetPresentation').pose(id)))`).then(text=>{const list=JSON.parse(text);return list.every(x=>x)?list:false;}),'two live pose reports');
 await dispatch('anim?pet=second&surface=web','POST',{name:'螃蟹走路'});
 await until(()=>ev("JSON.stringify(window.testServices.get('chatpetPresentation').progress('second') || {})").then(v=>v.includes('螃蟹走路')),'third-party animation on second pet');
 const state=(await dispatch('state')).obj;
 assert.ok(state.sections.menu.data.items.some(item=>item.owner==='chatpet.room' && item.label==='进入房间'));
 await ev(`document.querySelector('.dsh-pet-hit').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:220,clientY:250}))`);
 await until(()=>ev("!!document.querySelector('.dsh-pet-menu')"), 'pet context menu');
 await ev(`[...document.querySelectorAll('.dsh-pet-menu-item')].find(n=>n.textContent.includes('更多')).dispatchEvent(new MouseEvent('mouseenter'))`);
 await until(()=>ev(`[...document.querySelectorAll('.dsh-pet-menu-item')].some(n=>n.textContent.trim()==='进入房间' && n.getClientRects().length)`),'Room menu visible');
 await ev(`[...document.querySelectorAll('.dsh-pet-menu-item')].find(n=>n.textContent.trim()==='进入房间' && n.getClientRects().length).click()`);
 await until(()=>roomOpens.length===1,'Room menu reached the registered window port');
 assert.deepEqual(roomOpens,['test']);
 await ev('window.stopPets()');
 platform.close();platform.ownerAccess('test');
 await win.loadURL(address);
 await until(()=>ev('!!(window.mods?.react && window.plugin)'), 'React reload');
 await mount();
 await until(()=>ev('[...document.querySelectorAll("video")].filter(v=>v.videoWidth>0).length>=2'),'reload two decoded pets');
 const pose=id=>ev(`window.testServices.get('chatpetPresentation').pose(${JSON.stringify(id)})`);
 const place=async(id,x,y)=>{
   const res=await dispatch('position?pet='+id+'&surface=web','POST',{mode:'instant',x,y});
   assert.equal(res.obj.ok,true,JSON.stringify(res));
   await until(async()=>{const at=await pose(id);return Math.abs(at.x-x)<.025 && Math.abs(at.y-y)<.025;},id+' position');
 };
 await place('main',.27,.55);await place('second',.5,.55);
 const thrown=await dispatch('throw?pet=main&surface=web','POST',{angle:0,power:950});
 assert.equal(thrown.obj.ok,true,JSON.stringify(thrown));
 await until(async()=>Math.abs((await pose('second')).x-.5)>.035,'second pet moved from collision',4000);
 await place('main',.30,.45);await place('second',.72,.45);
 const sensorKinds=await ev(`[typeof DeviceMotionEvent, typeof DeviceOrientationEvent]`);
 if(sensorKinds.every(k=>k==='function')) {
   await ev(`window.dispatchEvent(new DeviceMotionEvent('devicemotion',{acceleration:{x:32,y:0,z:0}}))`);
   await until(async()=>Math.abs((await pose('main')).x-.30)>.035,'synthetic device shake moves pet',3000);
 }
 const haptics=await ev('window.testVibrations.length');
 assert.ok(haptics>0);
 const notify=(cwd)=>{for(const receive of handlers)receive({header:{id:'notif-test',cwd}},{type:'approval/asked',seq:1,data:{toolName:'测试工具',reason:'确认测试'}});};
 await ev("Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});window.dispatchEvent(new Event('blur'))");
 notify('/another-binding');
 assert.equal((await dispatch('state')).obj.sections.notify.data,null);
 notify(repo);
 await until(()=>ev("window.testNotifications.length===1"),'native approval notification in background');
 await ev("window.testNotifications[0].onclick()");
 assert.equal(await ev('window.notificationSession'),'notif-test');
 await ev('window.stopPets()');
 const browserRandomCount=receipts.filter(receipt=>receipt.kind==='random' && receipt.status==='playing').length;
 setPools(true);
 const result=await dispatch('config','PUT',{trayEnabled:false,physics:{...mainConfig.physics,gravity:0,petCollision:true},pets:[{...original,display:'desktop'},{...left,display:'desktop'}],
   animations:randomAnimations,animationWeights:{idle:100,turn:0,move:0}});
 assert.equal(result.obj.main.pets.filter(p=>p.display==='desktop').length,2);
 const desktopPoses=await until(async()=>{
   const reports=await Promise.all(['main','second'].map(p=>dispatch('pose?pet='+p)));
   return reports.every(r=>r.obj?.ok)?reports.map(r=>r.obj):false;
 },'two original native helper windows report their poses',22000);
 await until(()=>receipts.filter(receipt=>receipt.kind==='random' && receipt.status==='playing').length>browserRandomCount,
   'decoded native random start reaches recent Emotion ledger');
 assert.ok(ledger.read().actions.some(action=>action.name==='wave'));
 setPools(false);await dispatch('config','PUT',{physics:mainConfig.physics});
 assert.notEqual(desktopPoses[0].x,desktopPoses[1].x);
 const nativePose=async id=>(await dispatch('pose?pet='+id)).obj;
 for(const [id,x] of [['main',.32],['second',.5]]) {
   assert.equal((await dispatch('position?surface=desktop&pet='+id,'POST',{x,y:.52,mode:'instant'})).obj.ok,true);
   await until(async()=>{const pose=await nativePose(id);return Math.abs(pose.x-x)<.022 && Math.abs(pose.y-.52)<.022;},'native position '+id);
 }
 await clock(100);
 assert.equal((await dispatch('throw?surface=desktop&pet=main','POST',{angle:0,power:1})).obj.ok,true);
 await until(()=>fs.readFileSync(collisions,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).some(hit=>hit.targetId==='second' && hit.vx>0),'native helper transfers throw impulse to the other window',6500);
 await until(async()=>(await nativePose('second')).x>.5015,'second desktop pet responds to the impulse',3500);
 console.log(JSON.stringify({status:'passed',browserPets:poses.length,decodedMedia:true,thirdPartyAnimation:true,randomPlaybackToLedger:{browser:true,native:true},roomMenu:true,browserCollision:true,hapticRequests:haptics,syntheticShake:sensorKinds.every(k=>k==='function'),nativeWindows:desktopPoses.length,nativeCollision:true,sessionNotification:true}));
}
main().then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1);}).finally(()=>{
 win?.destroy();platform?.close();server?.closeAllConnections();server?.close();fs.rmSync(dir,{recursive:true,force:true});
});
