'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const {createServer}=require('node:http');
const {mkdtempSync,readFileSync,rmSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const root=process.cwd(),temp=mkdtempSync(join(tmpdir(),'room-voice-window-'));
app.setPath('userData',join(temp,'profile'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
let server,win,voice,releaseVoice,voiceRegistration;
const timeout=setTimeout(()=>{console.error('Room voice window timed out');app.exit(1);},35000);
async function run(){
  const {CompanionVoice}=await import(pathToFileURL(join(root,'dist/src/voice/plugin.js')).href);
  const {VoiceTable}=await import(pathToFileURL(join(root,'dist/src/core/tables/voice.js')).href);
  const {Context}=await import('@deepseek-ai/cordis');
  const {Room}=await import(pathToFileURL(join(root,'dist/src/room/plugin.js')).href);
  const {roomAsset}=await import(pathToFileURL(join(root,'dist/src/room/assets.js')).href);
  const {registerVoiceProvider}=await import(pathToFileURL(join(root,'dist/src/desktop/upstream/host/voice/registry.js')).href);
  let heard=0,spoken=0;
  const scope=new Context(),voiceTable=new VoiceTable();
  const host={workspace:{status:()=>({state:'ready',target:{id:'fixture',path:temp}}),storageId:()=> 'fixture',
    homeScope:()=>({workspaceId:'fixture',storageId:'fixture',path:temp,bootId:'fixture',generation:0})},native:{voiceTable}};
  voice=new CompanionVoice(host,join(temp,'voice'),()=>({listProviders:()=>['synthetic'],resolve:value=>value,
    transcribe:async value=>{heard++;assert.equal(Buffer.from(value.audio).subarray(0,4).toString(),'RIFF');return {text:'测试语音输入'};}}));
  const wave=Buffer.alloc(44+3200);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);
  wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(16000,24);wave.writeUInt32LE(32000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(3200,40);
  releaseVoice=registerVoiceProvider({id:'synthetic',name:'synthetic',synthesize:async()=>{spoken++;return wave;}});
  voiceRegistration=voiceTable.register(scope,voice);
  const room=new Room({petCore:host,on:()=>()=>{},get:name=>scope.get(name,false),root:scope,[Context.isolate]:scope[Context.isolate]});
  const pending=new Map();
  ipcMain.handle('fixture-room',(event,endpoint,data,requestId)=>{
    assert.equal(event.sender,win.webContents);assert.equal(endpoint,'roomVoice');
    const abort=new AbortController();pending.set(requestId,abort);
    return room.request('fixture',endpoint,data,requestId,abort.signal).finally(()=>pending.delete(requestId));
  });
  ipcMain.on('fixture-cancel',(_event,id)=>pending.get(id)?.abort());
  const preload=join(temp,'preload.cjs');writeFileSync(preload,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('chatpetRoomBridge',{request:(...args)=>ipcRenderer.invoke('fixture-room',...args),cancel:id=>ipcRenderer.send('fixture-cancel',id)});`);
  server=createServer(async(req,res)=>{
    try{
      if(req.url==='/'){
        res.setHeader('content-type','text/html');res.end(`<!doctype html><aside id="roomChat"><header>房间聊天</header><div id="chatLog"><div class="chat-msg her">本地回复</div></div><form id="chatForm"><input id="chatInput"><button id="chatSend">发送</button></form></aside><script>
window.beforeVoiceFetch=window.fetch;
const nativeGetUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
window.delayNextMic=true;
navigator.mediaDevices.getUserMedia=async constraints=>{
  const stream=await nativeGetUserMedia(constraints);
  if(!window.delayNextMic)return stream;
  window.delayNextMic=false;window.lateTracks=stream.getTracks();
  return new Promise(resolve=>{window.releaseLateMic=()=>resolve(stream);});
};
window.beforeVoiceGetUserMedia=navigator.mediaDevices.getUserMedia;
document.getElementById('chatForm').addEventListener('submit',e=>{e.preventDefault();window.sent=document.getElementById('chatInput').value;});
</script><script src="/chatpet-room/shared-core.js"></script><script>window.hearUrls=[];const originalHearControl=window.PetShared.createHearControl;window.PetShared.createHearControl=options=>{window.hearUrls.push(options.hearUrl);return originalHearControl(options);};</script><script type="module" src="/chatpet-room/voice-client.js"></script>`);return;
      }
      const response=await roomAsset(new Request('http://localhost'+req.url));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){res.writeHead(500);res.end(error.message);}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  win=new BrowserWindow({show:false,webPreferences:{preload,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  win.webContents.setAudioMuted(true);
  win.webContents.session.setPermissionRequestHandler((_contents,permission,callback)=>callback(permission==='media'));
  await win.loadURL('http://127.0.0.1:'+server.address().port);
  const cancelled=await win.webContents.executeJavaScript(`(async()=>{
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await wait(50);}throw Error('Delayed permission UI timed out: '+document.hidden+' '+document.body.textContent);};
    await until(()=>!!document.querySelector('#chatForm button[title*=\"松开\"]'));
    const oldMic=document.querySelector('#chatForm button[title*=\"松开\"]'),room=document.getElementById('roomChat'),input=document.getElementById('chatInput');
    const oldUrl=window.hearUrls.at(-1);input.value='保留草稿';oldMic.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:1,bubbles:true}));
    await until(()=>typeof window.releaseLateMic==='function');
    room.hidden=true;await wait(30);room.hidden=false;await wait(30);
    const freshMic=document.querySelector('#chatForm button[title*=\"松开\"]');
    window.releaseLateMic();await until(()=>window.lateTracks.every(track=>track.readyState==='ended'));await wait(250);
    let staleGenerationRejected=false;try{await fetch(oldUrl,{method:'POST',body:JSON.stringify({audio:'AQI='})});}catch(error){staleGenerationRejected=error.name==='AbortError';}
    return {lateTracksStopped:window.lateTracks.every(track=>track.readyState==='ended'),replacedControl:oldMic!==freshMic,staleGenerationRejected,draft:input.value,error:document.querySelector('[role=status]').textContent};
  })()`);
  assert.deepEqual(cancelled,{lateTracksStopped:true,replacedControl:true,staleGenerationRejected:true,draft:'保留草稿',error:''});assert.equal(heard,0);
  const result=await win.webContents.executeJavaScript(`(async()=>{
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await wait(50);}throw Error('UI condition timed out: '+document.body.textContent);};
    await until(()=>!!document.querySelector('#chatForm button[title*="松开"]'));
    const mic=document.querySelector('#chatForm button[title*="松开"]');document.getElementById('chatInput').value='';mic.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:1,bubbles:true}));
    await wait(2500);mic.dispatchEvent(new PointerEvent('pointerup',{button:0,pointerId:1,bubbles:true}));
    const input=document.getElementById('chatInput');input.value='编辑草稿';input.setSelectionRange(input.value.length,input.value.length);
    await until(()=>input.value==='编辑草稿测试语音输入');
    document.getElementById('chatForm').requestSubmit();
    const listen=[...document.querySelectorAll('#roomChat header button')].find(node=>node.textContent==='朗读');listen.click();
    await until(()=>listen.textContent==='朗读');
    return {transcript:window.sent,voiceControls:!!mic&&!!listen,error:document.querySelector('[role=status]').textContent};
  })()`);
  assert.deepEqual(result,{transcript:'编辑草稿测试语音输入',voiceControls:true,error:''});assert.equal(heard,1);assert.equal(spoken,1);
  const restored=await win.webContents.executeJavaScript(`(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide'));return window.fetch===window.beforeVoiceFetch&&navigator.mediaDevices.getUserMedia===window.beforeVoiceGetUserMedia;})()`);
  assert.equal(restored,true);
  console.log(JSON.stringify({ok:true,delayedPermissionCancelled:true,lateTracksStopped:true,staleGenerationRejected:true,draftEditsPreserved:true,wrappersRestored:true,syntheticMicrophone:true,realMicrophone:false,heard,spoken,nativeChatComposer:true,mutedPlayback:true}));
}
app.whenReady().then(run).then(()=>app.quit(),error=>{console.error(error.stack);app.exitCode=1;app.quit();});
app.on('before-quit',()=>{clearTimeout(timeout);void voiceRegistration?.revoke();voice?.release();releaseVoice?.();server?.close();});
app.on('quit',()=>{try{rmSync(temp,{recursive:true,force:true});}catch{}});
