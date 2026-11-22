'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const endpoints=/* room transport */ {"roomState":true,"roomAction":true,"roomGarden":true,"roomPlant":true,"roomCare":true,"roomChat":true,"roomTelevision":true,"roomHistory":true,"roomVoice":true};
const changeListeners=new Set();
const visibilityListeners=new Set();
let latestChange;
let latestVisibility;
const visibility=(_event,value)=>{
  if(!value||typeof value.visible!=='boolean'||!Number.isSafeInteger(value.revision)||value.revision<0||latestVisibility?.revision>value.revision)return;
  latestVisibility={visible:value.visible,revision:value.revision};
  for(const listener of visibilityListeners)listener({...latestVisibility});
};
const changed=(_event,value)=>{
  if(!value||typeof value.workspaceId!=='string'||typeof value.bootId!=='string'||!Number.isSafeInteger(value.revision)||value.revision<0)return;
  latestChange={workspaceId:value.workspaceId,bootId:value.bootId,revision:value.revision,reason:value.reason};
  for(const listener of changeListeners)listener({...latestChange});
};
ipcRenderer.on('chatpet-room:changed',changed);
ipcRenderer.on('chatpet-room:visibility',visibility);
window.addEventListener('unload',()=>{changeListeners.clear();visibilityListeners.clear();ipcRenderer.removeListener('chatpet-room:changed',changed);ipcRenderer.removeListener('chatpet-room:visibility',visibility);},{once:true});
contextBridge.exposeInMainWorld('chatpetRoomBridge',Object.freeze({
  onVisibility(listener){
    if(typeof listener!=='function')throw Error('Invalid Room visibility listener');
    visibilityListeners.add(listener);
    if(latestVisibility)queueMicrotask(()=>{if(visibilityListeners.has(listener))listener({...latestVisibility});});
    else void ipcRenderer.invoke('chatpet-room:visibility').then(value=>visibility(null,value)).catch(()=>{});
    return()=>visibilityListeners.delete(listener);
  },
  onChanged(listener){
    if(typeof listener!=='function')throw Error('无效的房间订阅');
    changeListeners.add(listener);
    if(latestChange)queueMicrotask(()=>{if(changeListeners.has(listener))listener({...latestChange});});
    return()=>changeListeners.delete(listener);
  },
  request(endpoint,data,requestId){
    if(typeof endpoint!=='string'||!Object.hasOwn(endpoints,endpoint)||!data||typeof data!=='object'||Array.isArray(data)||typeof requestId!=='string'||!requestId||requestId.length>160)return Promise.reject(Error('无效的房间请求'));
    return ipcRenderer.invoke('chatpet-room:request',endpoint,data,requestId);
  },
  cancel(requestId){if(typeof requestId==='string'&&requestId.length<=160)ipcRenderer.send('chatpet-room:cancel',requestId);},
}));
