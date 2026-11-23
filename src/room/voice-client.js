// Room supplies a narrow transport; original Pet controls own recording, WAV
// encoding, transcription UI and speech playback. No second chat runtime.
import {roomRequest, roomVoiceOperations, roomVoicePath} from './native-room.js';

const shared=window.PetShared, form=document.getElementById('chatForm'), input=document.getElementById('chatInput');
if (shared && form && input) {
  const base=new URL('./',import.meta.url), originalFetch=window.fetch;
  const room=document.getElementById('roomChat'), mediaDevices=navigator.mediaDevices, originalGetUserMedia=mediaDevices?.getUserMedia;
  let current, destroyed=false, reading=0;
  const visible=()=>!destroyed&&!room?.hidden&&!document.hidden;
  const active=owner=>current===owner&&!owner.controller.signal.aborted&&visible();
  const aborted=()=>new DOMException('房间语音请求已结束','AbortError');
  const stopTracks=stream=>{for(const track of stream.getTracks())try{track.stop();}catch{}};
  const hint=document.createElement('p');hint.setAttribute('role','status');hint.style.cssText='margin:0;padding:0 10px 8px;color:#a9c3df;font-size:12px';hint.hidden=true;form.after(hint);
  const show=text=>{hint.textContent=text;hint.hidden=!text;};
  const listen=document.createElement('button');listen.type='button';listen.textContent='朗读';listen.title='朗读最近一条回复';document.querySelector('#roomChat header')?.append(listen);

  // These paths are never public HTTP state endpoints. The existing authenticated
  // Room RPC carries them to the same Voice service used by compact chat.
  const voiceFetch=async(resource,options={})=>{
    const url=new URL(resource instanceof Request?resource.url:String(resource),location.href);
    const operation=url.pathname.startsWith(base.pathname+'voice/')?url.pathname.slice((base.pathname+'voice/').length):'';
    if (url.origin!==base.origin || !roomVoiceOperations.has(operation)) return originalFetch.call(window,resource,options);
    const owner=current;
    if(!owner||!active(owner)||(operation==='hear'&&url.searchParams.get('roomVoiceGeneration')!==owner.token))throw aborted();
    const signal=AbortSignal.any([owner.controller.signal,...(options.signal?[options.signal]:[])]);
    const response=await roomRequest(roomVoicePath,{method:'POST',body:JSON.stringify({operation,payload:options.body?JSON.parse(options.body):undefined}),signal});
    const data=await response.json();signal.throwIfAborted();if(!active(owner))throw aborted();
    if (operation==='speak' && response.ok && data.ok!==false && typeof data.audio==='string') {
      const bytes=Uint8Array.from(atob(data.audio),value=>value.charCodeAt(0));
      return new Response(bytes,{headers:{'content-type':data.mediaType || 'audio/mpeg','cache-control':'no-store'}});
    }
    return Response.json(data,{status:response.ok?200:response.status});
  };
  window.fetch=voiceFetch;
  // The original recorder does not own an unresolved permission request. Keep
  // its stream bound to the control that requested it, even after a reopen.
  const getUserMedia=async constraints=>{
    if(!constraints?.audio||constraints.video)return originalGetUserMedia.call(mediaDevices,constraints);
    const owner=current;if(!owner||!active(owner))throw aborted();
    const stream=await originalGetUserMedia.call(mediaDevices,constraints);
    if(!active(owner)){stopTracks(stream);throw aborted();}
    for(const old of owner.streams)if(old.getTracks().every(track=>track.readyState==='ended'))owner.streams.delete(old);
    owner.streams.add(stream);return stream;
  };
  if(originalGetUserMedia)mediaDevices.getUserMedia=getUserMedia;
  shared.setVoiceBase(base.href.replace(/\/$/,''));
  function bindMicrophone(){
    if(!visible())return;
    const mic=document.createElement('button');mic.type='button';mic.textContent='按住说话';mic.title='松开后转成文字，检查后发送';form.insertBefore(mic,input);
    // Preserve the original control's current-selection insertion behavior while
    // making its input disappear when this generation ends. The Room keeps its
    // real input and all existing chat listeners/draft edits.
    const owner=current={controller:new AbortController(),token:crypto.randomUUID(),streams:new Set(),mic};
    const draft={
      get isConnected(){return active(owner)&&input.isConnected;},
      get value(){return input.value;},set value(value){if(active(owner))input.value=value;},
      get selectionStart(){return input.selectionStart;},get selectionEnd(){return input.selectionEnd;},
      setSelectionRange(...args){if(active(owner))input.setSelectionRange(...args);},
      focus(){if(active(owner))input.focus();},blur(){if(active(owner))input.blur();},
    };
    const hintForOwner=text=>{if(active(owner))show(text);else owner.control?.dispose();};
    mic.addEventListener('pointerdown',event=>{
      if(!active(owner)){event.stopImmediatePropagation();return;}
      input.blur();
    },{capture:true});
    const hearUrl=new URL('voice/hear',base);hearUrl.searchParams.set('roomVoiceGeneration',owner.token);
    owner.control=shared.createHearControl({micBtn:mic,input:draft,hearUrl:hearUrl.href,
      hint:{show:hintForOwner,flash:hintForOwner,hide:()=>hintForOwner('')},resizeInput:()=>{
        if(!active(owner))return;
        input.dispatchEvent(new Event('input',{bubbles:true}));
      }});
  }
  function stopReading(){reading++;shared.stopManualSpeech();listen.textContent='朗读';}
  listen.onclick=()=>{
    if (listen.textContent==='停止朗读'){stopReading();return;}
    const lines=[...document.querySelectorAll('#chatLog .chat-msg.her:not(.typing)')];
    let remaining=lines.at(-1)?.textContent?.trim() || '';
    if (!remaining){show('还没有可以朗读的回复');return;}
    stopReading();const current=reading;listen.textContent='停止朗读';
    const next=()=>{
      if (current!==reading)return;
      if (!remaining){listen.textContent='朗读';return;}
      let end=Math.min(500,remaining.length);if (end<remaining.length && /[\uD800-\uDBFF]/u.test(remaining[end-1]))end--;
      const text=remaining.slice(0,end);remaining=remaining.slice(end);
      shared.speakText(text,phase=>{
        if(current!==reading)return;
        if(phase==='idle')next();
        if(phase==='failed'){stopReading();show('语音合成失败，请检查语音组件和服务');}
      });
    };next();
  };
  function release(){
    const owner=current;current=undefined;
    if(owner){owner.controller.abort();owner.control?.dispose();for(const stream of owner.streams)stopTracks(stream);owner.mic.remove();}
    stopReading();show('');bindMicrophone();
  }
  const observer=new MutationObserver(release);
  if(room)observer.observe(room,{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('visibilitychange',release);
  window.addEventListener('pagehide',()=>{
    destroyed=true;release();observer.disconnect();document.removeEventListener('visibilitychange',release);
    if(window.fetch===voiceFetch)window.fetch=originalFetch;
    if(originalGetUserMedia&&mediaDevices.getUserMedia===getUserMedia)mediaDevices.getUserMedia=originalGetUserMedia;
  },{once:true});
  bindMicrophone();
}
