import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {emptyHomeState} from '#feiyu-home';
import {CompanionBehavior} from '../../dist/src/living/body/plugin.js';
import {CompanionVoice} from '../../dist/src/voice/plugin.js';
import {canonical,digest} from '../../dist/src/core/storage.js';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('R3: Body publication accepts a large retained history without weakening Core admission or losing receipts',async t=>{
  const now=Date.UTC(2026,10,13,12);t.mock.timers.enable({apis:['Date'],now});
  const root=mkdtempSync(join(tmpdir(),'body-history-code-')),directory=join(root,'.chatpet/data/life');mkdirSync(directory,{recursive:true});
  const home=emptyHomeState(now),actor={kind:'owner',id:'owner',channel:'desktop'},fingerprint=digest({input:{action:'water'},actor});
  home.needs={hunger:.1,thirst:.8,bladder:.1,energy:.9,pain:0};home.lastInteractionAt=0;home.interactionReceipts={};
  for(let i=0;i<12000;i++) {
    const requestId='history-'+i,key=digest(requestId);
    home.interactionReceipts[key]={fingerprint,acknowledged:true,changed:true,fact:{version:1,id:'body:'+key,requestId,domain:'body',type:'water',
      occurredAt:new Date(now-1000).toISOString(),actor,result:{status:'completed',summary:'Owner water interaction was committed and acknowledged.',before:{hunger:.1,thirst:.8,bladder:.1,energy:.9,pain:0},after:{hunger:.1,thirst:.1,bladder:.1,energy:.9,pain:0}}}};
  }
  assert.ok(Buffer.byteLength(JSON.stringify(home))>4*1024*1024);assert.throws(()=>canonical(home),/Payload too large/);
  writeFileSync(join(directory,'home.json'),JSON.stringify(home));
  const target={id:'a',path:root},host={native:{},workspace:{status:()=>({state:'ready',target}),storageId:()=>'a',
    runtime:{config:{ownerActorId:'owner',companionId:'fish'},store:{meta:()=>undefined},identity:()=>({displayName:'Fixture'})}}};
  const changes=[],warnings=[];const ctx={on:()=>()=>{},get:()=>undefined,emit:(name,event)=>{if(name==='pet/behavior.changed')changes.push(event);},logger:{warn:(...args)=>warnings.push(args)}};
  let behavior=new CompanionBehavior(ctx,host);
  t.after(async()=>{await behavior.close();rmSync(root,{recursive:true,force:true});});
  const first=await behavior.snapshot('a');assert.equal(first.fault,null);assert.ok(changes.length>0);
  const published=changes.length;await behavior.snapshot('a');assert.equal(changes.length,published,'unchanged internal JSON does not create extra publications');
  const counts=structuredClone(behavior.binding.room.state.counts);
  await behavior.act('a','water','history-0');assert.deepEqual(behavior.binding.room.state.counts,counts,'a retained acknowledged request remains deduplicated');
  const accepted=await behavior.act('a','water','new-water');assert.ok(accepted.fact);
  assert.equal((await behavior.snapshot('a')).fault,null);assert.ok(changes.length>published);
  const saved=JSON.parse(readFileSync(join(directory,'home.json'),'utf8'));assert.equal(Object.keys(saved.interactionReceipts).length,12001);
  assert.equal(saved.interactionReceipts[digest('history-0')].acknowledged,true);assert.deepEqual(warnings,[]);
  assert.throws(()=>canonical(saved),/Payload too large/,'public Core input budget stays unchanged');
  await behavior.close();behavior=new CompanionBehavior(ctx,host);
  await behavior.act('a','water','new-water');assert.equal((await behavior.snapshot('a')).fault,null);
  assert.equal(behavior.binding.room.state.counts.water,saved.counts.water,'reopening preserves the new interaction receipt without reapplying water');
});

// Read the emitted original service, replacing only filesystem/provider edges.
// Its actual validation, cache lookup, serial queue and timeout remain in use.
function synthesisFixture(t,{external=false,holdEvery=false}={}) {
  const files=new Map(),calls=[],pending=[],started=deferred();let pruneCount=0;
  const synthesize=async input=>{calls.push(input);started.resolve(input);const gate=deferred();pending.push(gate);if(calls.length>1&&!holdEvery)gate.resolve();await gate.promise;if(!external)files.set(input.target,Buffer.from('fixture audio'));return Buffer.from('fixture audio');};
  const modules={
    'node:fs/promises':{stat:async path=>{if(!files.has(path))throw Object.assign(Error('missing'),{code:'ENOENT'});return {isFile:()=>true,size:files.get(path).length};},writeFile:async(path,bytes)=>{files.set(path,bytes);}},
    './cache.js':{cacheKey:(_source,_voice,_rate,text)=>text,cachePath:(_root,key)=>'/fixture-cache/'+key,ensureCacheDir:async()=>'/fixture-cache',pruneCache:async()=>{pruneCount++;}},
    './edge.js':{VoiceSynthError:class extends Error{},synthesize},
    './registry.js':{BUILTIN_VOICE_ID:'fixture-builtin',activeVoiceProvider:()=>external?{id:'fixture-external',name:'Fixture',synthesize}:null},
    './voices.js':{DEFAULT_VOICE:'fixture-voice',VOICES:[],isKnownVoice:value=>value==='fixture-voice'},
  };
  const source=readFileSync('dist/src/voice/upstream/host/voice/speak.js','utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={};runInNewContext(code,{exports,require:name=>{assert.ok(modules[name],name);return modules[name];},Date,AbortSignal,setTimeout,clearTimeout});
  const service=exports.createVoiceService({userRoot:'/fixture-root',synthesize});
  const host={workspace:{status:()=>({state:'ready',target:{id:'a'}}),storageId:()=>'a'}};
  const voice=new CompanionVoice(host,'/unused-device-cache',()=>undefined);
  voice.scope={id:'a',workspaceId:'a',tools:Promise.resolve({voice:service,speech:{}})};
  t.after(()=>{for(const gate of pending)gate.resolve();voice.release();});
  const speak=(text,signal)=>{const work=voice.handle({rest:'voice/speak',method:'POST',body:JSON.stringify({text}),signal});void work.catch(()=>{});return work;};
  return {voice,service,speak,files,calls,pending,started,prunes:()=>pruneCount};
}

for(const external of [false,true])test(`R3: cancelled queued ${external?'registered':'builtin'} speech never starts synthesis`,async t=>{
  const f=synthesisFixture(t,{external}),first=f.speak('first');await f.started.promise;
  const controller=new AbortController(),second=f.speak('second',controller.signal);const rejected=assert.rejects(second,/abort/i);
  await settle();controller.abort();f.pending[0].resolve();await first;await rejected;
  assert.equal(f.calls.length,1);assert.equal(f.files.has('/fixture-cache/second'),false);
});

test('R3: component release suppresses pending requests while preserving the existing queue owner',async t=>{
  const f=synthesisFixture(t),first=f.speak('first');const firstRejection=assert.rejects(first,/abort/i);await f.started.promise;
  const second=f.speak('second');const secondRejection=assert.rejects(second,/abort/i);await settle();
  f.voice.release();assert.equal(f.calls[0].signal.aborted,true,'lifetime cancellation reaches the already started builtin implementation');
  assert.equal(f.calls.length,1);f.pending[0].resolve();await firstRejection;await secondRejection;assert.equal(f.calls.length,1);
});

test('R3: a cancelled already-submitted external provider retains serial ownership and cannot commit late cache',async t=>{
  const f=synthesisFixture(t,{external:true,holdEvery:true}),controller=new AbortController();
  const old=f.speak('old',controller.signal),rejected=assert.rejects(old,/abort/i);await f.started.promise;
  controller.abort();const next=f.speak('next');await settle();assert.equal(f.calls.length,1,'caller abort does not release an uncancellable active provider');
  f.pending[0].resolve();await rejected;await settle();assert.equal(f.calls.length,2);assert.equal(f.files.has('/fixture-cache/old'),false);
  f.pending[1].resolve();assert.equal((await next).kind,'file');assert.equal(f.files.has('/fixture-cache/next'),true);
});

test('R3: a caller cancelled during cache lookup cannot receive cached speech',async t=>{
  const f=synthesisFixture(t),controller=new AbortController();f.files.set('/fixture-cache/cached',Buffer.from('fixture cached'));
  const pending=f.service.speak({text:'cached'},controller.signal);controller.abort();await assert.rejects(pending,/abort/i);
  assert.equal(f.calls.length,0);assert.equal(f.files.size,1);
});

test('R3: the original builtin encoder cannot commit audio returned after caller cancellation',async()=>{
  const started=deferred(),finish=deferred(),writes=[];
  const modules={
    'node:fs/promises':{writeFile:async(...args)=>{writes.push(args);},rename:async()=>{writes.push(['rename']);},rm:async()=>{}},
    '@andresaya/edge-tts':{EdgeTTS:class {async generate(){started.resolve();return finish.promise;}}},
  };
  const source=readFileSync('dist/src/voice/upstream/host/voice/edge.js','utf8'),exports={};
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  runInNewContext(code,{exports,require:name=>{assert.ok(modules[name],name);return modules[name];}});
  const controller=new AbortController(),pending=exports.synthesize({signal:controller.signal,text:'fixture',voice:'fixture',rate:'+0%',target:'/fixture-target'});
  const rejection=assert.rejects(pending,/abort/i);await started.promise;controller.abort();finish.resolve({audio:Buffer.from('fixture audio')});
  await rejection;assert.deepEqual(writes,[]);
});
