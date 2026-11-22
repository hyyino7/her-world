import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {join} from 'node:path';
import {createContext,runInContext} from 'node:vm';

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function settle(){for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));}
function fixture({waitMedia=false,waitResume=false}={}) {
  const media=deferred(),resumed=deferred(),heard=deferred(),requested=deferred(),contexts=[],streams=[],intervals=new Map(),hints=[];
  let calls=0,submitted;
  const freshStream=()=>{const track={stopped:0,stop(){this.stopped++;}};const stream={track,getTracks:()=>[track]};streams.push(stream);return stream;};
  class AudioContext {
    closed=0;processor;destination={};
    constructor(){contexts.push(this);}
    createMediaStreamSource(){return {connect(){},disconnect(){}};}
    createScriptProcessor(){return this.processor={connect(){},disconnect(){},onaudioprocess:null};}
    resume(){return waitResume&&contexts.length===1?resumed.promise:Promise.resolve();}
    close(){this.closed++;return Promise.resolve();}
  }
  const events=new Map(),mic={dataset:{},disabled:false,addEventListener:(name,fn)=>events.set(name,fn),setPointerCapture(){}};
  const input={value:'',isConnected:true,selectionStart:0,selectionEnd:0,setSelectionRange(from,to){this.selectionStart=from;this.selectionEnd=to;},focus(){},blur(){}};
  const document={hidden:false,activeElement:null,addEventListener(){}};
  const window={setInterval:fn=>{const key=intervals.size+1;intervals.set(key,fn);return key;},clearInterval:key=>intervals.delete(key)};
  const context=createContext({window,document,navigator:{mediaDevices:{getUserMedia:()=>{calls++;return waitMedia&&calls===1?media.promise:Promise.resolve(freshStream());}}},
    AudioContext,AbortController,AbortSignal,DOMException,URL,Uint8Array,Float32Array,Int16Array,DataView,TextDecoder,
    setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout(){},btoa:text=>Buffer.from(text,'binary').toString('base64'),
    fetch:async(_url,options)=>{submitted=options;requested.resolve(options.signal);return heard.promise;}});
  runInContext(readFileSync('src/desktop/helper/upstream/shared-core.js','utf8'),context);
  const control=window.PetShared.createHearControl({micBtn:mic,input,hearUrl:'http://fixture/voice/hear',hint:{show:text=>hints.push(text),flash:text=>hints.push(text),hide:()=>hints.push('')},resizeInput(){}});
  function samples(){contexts.at(-1).processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(8000).fill(.2)}});}
  return {control,input,mic,media,resumed,heard,requested,contexts,streams,hints,intervals,freshStream,samples,submitted:()=>submitted,
    finish:()=>heard.resolve({json:async()=>({ok:true,text:'old transcript'})}),close:()=>{control.dispose();media.resolve(freshStream());resumed.resolve();heard.resolve({json:async()=>({ok:false})});}};
}

test('R2-4: a late microphone permission result is released and cannot replace a reopened recording',async()=>{
  const f=fixture({waitMedia:true});
  try {f.control.start();await settle();f.control.dispose();f.control.start();await settle();assert.equal(f.control.isHearing(),true);
    const late=f.freshStream();f.media.resolve(late);await settle();assert.equal(late.track.stopped,1);assert.equal(f.control.isHearing(),true);
    assert.equal(f.contexts.length,1,'cancelled permission must not create another AudioContext');
  }finally{f.close();await settle();}
});

test('R2-4: cancellation releases stream and context while AudioContext.resume is still pending',async()=>{
  const f=fixture({waitResume:true});
  try {f.control.start();await settle();assert.equal(f.contexts.length,1);f.control.dispose();
    assert.equal(f.streams[0].track.stopped,1);assert.equal(f.contexts[0].closed,1);
    f.control.start();await settle();assert.equal(f.control.isHearing(),true);f.resumed.resolve();await settle();
    assert.equal(f.control.isHearing(),true);assert.equal(f.streams[0].track.stopped,1);
  }finally{f.close();await settle();}
});

test('R2-4: disposing a pending transcription aborts it and stale success/finally cannot alter a new recording',async()=>{
  const f=fixture();
  try {f.control.start();await settle();f.samples();f.control.stop();const signal=await f.requested.promise;
    f.control.dispose();assert.equal(signal.aborted,true);f.input.value='new draft';f.control.start();await settle();
    f.finish();await settle();assert.equal(f.input.value,'new draft');assert.equal(f.control.isHearing(),true);assert.equal(f.mic.dataset.hear,'recording');
  }finally{f.close();await settle();}
});

test('R2-4: ordinary recording still uses the original WAV encoder and inserts a successful transcript',async()=>{
  const f=fixture();
  try {f.control.start();await settle();f.samples();f.control.stop();await f.requested.promise;f.finish();await settle();
    assert.equal(f.input.value,'old transcript');assert.equal(f.control.isHearing(),false);assert.equal(f.streams[0].track.stopped,1);
    const wave=Buffer.from(JSON.parse(f.submitted().body).audio,'base64');assert.equal(wave.toString('ascii',0,4),'RIFF');
    assert.equal(wave.readUInt16LE(22),1);assert.equal(wave.readUInt32LE(24),16000);assert.equal(wave.length,44+8000*2);
  }finally{f.close();await settle();}
});

test('R2-4: a rejected old permission dialog cannot reset or report an error into the new recording',async()=>{
  const f=fixture({waitMedia:true});
  try {f.control.start();await settle();f.control.dispose();f.control.start();await settle();const hints=[...f.hints];
    f.media.reject(Error('old permission denied'));await settle();assert.equal(f.control.isHearing(),true);assert.deepEqual(f.hints,hints);
  }finally{f.close();await settle();}
});

test('R2-4: a late transcription failure cannot clear a reopened recording or its hint',async()=>{
  const f=fixture();
  try {f.control.start();await settle();f.samples();f.control.stop();await f.requested.promise;f.control.dispose();
    f.control.start();await settle();const hints=[...f.hints];f.heard.reject(Error('old network failure'));await settle();
    assert.equal(f.control.isHearing(),true);assert.deepEqual(f.hints,hints);
  }finally{f.close();await settle();}
});

function chatFixture() {
  const elements=new Map(),listeners=new Map(),fresh=deferred();let receive;
  const make=()=>({value:'',textContent:'',style:{},dataset:{},hidden:false,disabled:false,scrollHeight:0,scrollTop:0,clientHeight:0,
    setAttribute(){},addEventListener(){},append(){},replaceChildren(){},focus(){},click(){}});
  const element=id=>{if(!elements.has(id))elements.set(id,make());return elements.get(id);};
  const disposed=[];const document={hidden:false,getElementById:element,createElement:make,addEventListener:(name,fn)=>listeners.set(name,fn)};
  const window={pet:{call:async(name)=>name==='identity'?{displayName:'Fixture'}:name==='catalog'?{stickers:[]}:name==='new'?fresh.promise:{},listen:fn=>{receive=fn;}},
    PetShared:{setVoiceBase(){},createHearControl:()=>({dispose:()=>disposed.push('dispose')}),stopManualSpeech(){},firstImageFromClipboard(){},dragHasFiles(){}},addEventListener:(name,fn)=>listeners.set('window:'+name,fn)};
  runInContext(readFileSync('src/desktop/helper/chat.js','utf8'),createContext({window,document,performance:{now:()=>0},Image:class {},setTimeout,clearTimeout}));
  const snapshot=sessionId=>receive('chat',{workspaceId:'fixture',sessionId,messages:[],generating:false,turn:null});
  return {window,document,disposed,element,listeners,snapshot,fresh};
}

test('R2-4: actual compact chat revokes voice on new-session request and incoming session change',async()=>{
  const f=chatFixture();await settle();f.snapshot('a');const before=f.disposed.length;
  const pending=f.element('fresh').onclick();assert.ok(f.disposed.length>before,'new request revokes voice before awaiting the bridge');
  f.fresh.resolve({workspaceId:'fixture',sessionId:'a-new',messages:[]});await pending;
  const middle=f.disposed.length;f.snapshot('b');assert.ok(f.disposed.length>middle,'native session switch revokes prior recording');
});

test('R2-4: hiding and page teardown revoke the compact voice operation',async()=>{
  const f=chatFixture();await settle();f.snapshot('a');const before=f.disposed.length;
  f.document.hidden=true;f.listeners.get('visibilitychange')();assert.ok(f.disposed.length>before);
  const middle=f.disposed.length;f.listeners.get('window:pagehide')();assert.ok(f.disposed.length>middle);
});

test('R2-4: explicit hide and Escape revoke voice before the native window becomes hidden',async()=>{
  const f=chatFixture();await settle();f.snapshot('a');const before=f.disposed.length;
  await f.element('hide').onclick();assert.ok(f.disposed.length>before);
  const middle=f.disposed.length;f.listeners.get('keydown')({key:'Escape',isComposing:false});assert.ok(f.disposed.length>middle);
});

test('compact voice forwards request cancellation and window hide by request ID', async () => {
  const frames=[], input=new EventEmitter();
  let protocol, window;
  class BrowserWindow extends EventEmitter {
    webContents=Object.assign(new EventEmitter(),{setWindowOpenHandler(){}});
    constructor() { super(); window=this; }
    setVisibleOnAllWorkspaces() {}
    loadFile() {}
  }
  const electron={BrowserWindow,app:{setPath(){},on(){},whenReady:async()=>{}},
    screen:{getPrimaryDisplay:()=>({workArea:{}})},ipcMain:{handle(){}},
    protocol:{registerSchemesAsPrivileged(){},handle(_scheme,fn){protocol=fn;}}};
  const modules={'electron':electron,'node:readline':{createInterface:()=>input},'node:path':{join},
    'node:fs':{mkdtempSync:()=>'/fixture'},'node:os':{tmpdir:()=>'/fixture'}};
  const process={env:{CHATPET_CHAT_ONLY:'1'},stdin:{},stdout:{on(){},write:line=>frames.push(JSON.parse(line))}};
  const context=createContext({process,__dirname:'/fixture',require:name=>modules[name]??{},
    AbortController,AbortSignal,Buffer,URL,Request,Response});
  runInContext(readFileSync('src/desktop/helper/main.cjs','utf8'),context);
  await settle();
  const start=signal=>protocol(new Request('dsh-pet-bridge://dsh-pet/dsh-pet-7340/voice/hear',{
    method:'POST',body:'{"audio":"AA=="}',signal,
  }));
  const respond=(id,text)=>input.emit('line',JSON.stringify({type:'response',value:{id,ok:true,result:{text}}}));
  const caller=new AbortController(), first=start(caller.signal);
  await settle();
  const firstRequest=frames.at(-1);
  assert.equal(firstRequest.cancellableVoice,true);
  caller.abort();
  assert.deepEqual(frames.at(-1),{type:'voice-cancel',id:firstRequest.id});
  assert.equal((await first).status,400);

  const hidden=start();
  await settle();
  const hiddenRequest=frames.at(-1);
  window.emit('hide');
  assert.deepEqual(frames.at(-1),{type:'voice-cancel',id:hiddenRequest.id});
  assert.equal((await hidden).status,400);

  const reopened=start();
  await settle();
  const reopenedRequest=frames.at(-1);
  respond(hiddenRequest.id,'old transcript');
  respond(reopenedRequest.id,'current transcript');
  assert.deepEqual(await (await reopened).json(),{text:'current transcript'});
});
