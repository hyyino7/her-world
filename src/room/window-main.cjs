'use strict';
// Isolated framed presentation process, following the existing Desktop helper.
const {app,BrowserWindow,ipcMain,desktopCapturer,dialog,powerMonitor}=require('electron');
const {createInterface}=require('node:readline');
const {mkdtempSync,rmSync}=require('node:fs');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const url=process.env.CHATPET_ROOM_URL;
const parsed=new URL(url);
if(!['http:','https:'].includes(parsed.protocol)||!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||parsed.pathname!=='/chatpet-room/index.html')throw Error('Invalid Room origin');
const endpoints=/* room transport */ {"roomState":true,"roomAction":true,"roomGarden":true,"roomPlant":true,"roomCare":true,"roomChat":true,"roomTelevision":true,"roomHistory":true,"roomVoice":true};
const profile=mkdtempSync(join(tmpdir(),'chatpet-room-window-'));app.setPath('userData',profile);
let win,sequence=0,quitting=false,locked=false,suspended=false,visibilityRevision=0;
const pending=new Map();
const out=value=>process.stdout.write(JSON.stringify(value)+'\n');
function owned(event){return !quitting&&win&&!win.isDestroyed()&&event.sender===win.webContents&&event.senderFrame===event.sender.mainFrame&&event.senderFrame.url===url;}
function visibility(){return {visible:Boolean(!quitting&&!locked&&!suspended&&win&&!win.isDestroyed()&&win.isVisible()&&!win.isMinimized()),revision:visibilityRevision};}
function publishVisibility(){
  visibilityRevision++;
  if(win&&!win.isDestroyed())win.webContents.send('chatpet-room:visibility',visibility());
}
ipcMain.handle('chatpet-room:visibility',event=>{if(!owned(event))throw Error('Invalid Room window');return visibility();});
ipcMain.handle('chatpet-room:request',(event,endpoint,data,requestId)=>{
  if(!owned(event)||typeof endpoint!=='string'||!Object.hasOwn(endpoints,endpoint)||!data||typeof data!=='object'||Array.isArray(data)||typeof requestId!=='string'||!requestId||requestId.length>160)throw Error('Invalid Room request');
  const id=++sequence;
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,requestId});out({type:'request',id,endpoint,data,requestId});});
});
ipcMain.on('chatpet-room:cancel',(event,requestId)=>{
  if(!owned(event)||typeof requestId!=='string')return;
  out({type:'cancel',requestId});
  for(const [id,waiter]of pending)if(waiter.requestId===requestId){pending.delete(id);waiter.reject(Error('房间请求已取消'));}
});
createInterface({input:process.stdin}).on('line',line=>{
  let message;try{message=JSON.parse(line);}catch{return;}
  if(message.type==='focus'&&win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}
  if(message.type==='changed'&&win&&!win.isDestroyed()&&win.webContents.mainFrame.url===url) {
    const change=message.change;
    if(change&&typeof change.workspaceId==='string'&&typeof change.bootId==='string'&&Number.isSafeInteger(change.revision)&&change.revision>=0)
      win.webContents.send('chatpet-room:changed',{workspaceId:change.workspaceId,bootId:change.bootId,revision:change.revision,reason:change.reason});
  }
  if(message.type==='response'){
    const waiter=pending.get(message.id);if(!waiter)return;pending.delete(message.id);
    message.ok?waiter.resolve(message.value):waiter.reject(Error(message.error||'房间操作失败'));
  }
}).on('close',()=>app.quit());
process.stdout.on('error',()=>app.quit());
app.on('before-quit',()=>{quitting=true;for(const waiter of pending.values())waiter.reject(Error('房间窗口已关闭'));pending.clear();});
app.on('quit',()=>{try{rmSync(profile,{recursive:true,force:true});}catch{}});
app.on('window-all-closed',()=>app.quit());
app.whenReady().then(async()=>{
  app.dock?.hide();
  locked=powerMonitor.getSystemIdleState?.(1)==='locked';
  win=new BrowserWindow({title:'伙伴的房间',width:1280,height:900,minWidth:800,minHeight:560,show:false,
    webPreferences:{preload:join(__dirname,'window-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,spellcheck:false}});
  for(const event of ['show','hide','minimize','restore'])win.on(event,publishVisibility);
  powerMonitor.on('lock-screen',()=>{locked=true;publishVisibility();});
  powerMonitor.on('unlock-screen',()=>{locked=false;publishVisibility();});
  powerMonitor.on('suspend',()=>{suspended=true;publishVisibility();});
  powerMonitor.on('resume',()=>{suspended=false;publishVisibility();});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  const session=win.webContents.session;
  session.setPermissionRequestHandler((contents,permission,callback,details)=>{
    const owned=win&&!win.isDestroyed()&&contents===win.webContents&&details.requestingUrl===url;
    const microphone=permission==='media'&&Array.isArray(details.mediaTypes)&&details.mediaTypes.length>0&&details.mediaTypes.every(type=>type==='audio');
    callback(Boolean(owned&&(permission==='display-capture'||microphone)));
  });
  session.setDisplayMediaRequestHandler(async(request,callback)=>{
    if(!win||win.isDestroyed()||request.frame!==win.webContents.mainFrame){callback({});return;}
    try{
      const sources=await desktopCapturer.getSources({types:['screen','window']});
      const result=await dialog.showMessageBox(win,{type:'question',title:'选择房间电视画面',message:'选择要分享给房间电视的画面',buttons:['取消',...sources.map(source=>source.name)],cancelId:0,defaultId:0});
      const source=sources[result.response-1];callback(source?{video:source}:{});
    }catch{callback({});}
  },{useSystemPicker:true});
  await win.loadURL(url);
  if(!quitting){win.show();win.focus();out({type:'ready'});}
}).catch(error=>{console.error(error.message);app.exit(1);});
