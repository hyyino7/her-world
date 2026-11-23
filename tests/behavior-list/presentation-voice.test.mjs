import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveCompanionHome} from '../../dist/tests/behavior-list/entries.js';
import {registerVoiceProvider} from '../../dist/src/desktop/upstream/host/voice/registry.js';
import {eventually} from './entries-lifecycle.test.mjs';
import {presentationFixture,selectHome} from './presentation-r7-fixture.mjs';
import {qqTransport} from './qq-transport.mjs';

const audio = {audio:'AA=='};
const signal = () => new AbortController().signal;
const hear = (room, id, caller = signal()) => room.request(id,'roomVoice',{operation:'hear',payload:audio},'hear',caller);

test('Voice 与 Room 分别撤销时，旧录音结束且重载后只接受新识别', {timeout:10_000}, async t => {
  const f=await presentationFixture(t);
  let recognition;
  await f.ctx.plugin(scope=>scope.provide('speechToText',{
    resolve:value=>value,listProviders:()=>['fixture'],
    transcribe(_audio,signal) { return recognition(signal); },
  }));
  await f.mount('room');
  await f.mount('voice');
  for (const owner of ['voice','room']) {
    const entered=Promise.withResolvers(), late=Promise.withResolvers();
    t.after(()=>late.resolve({text:'released during cleanup'}));
    recognition=signal=>{entered.resolve(signal);return late.promise;};
    const oldRoom=f.ctx.petRoom, oldCompatibility=f.ctx.petVoice, caller=signal();
    const cancelled=assert.rejects(hear(oldRoom,f.id,caller),{name:'AbortError'});
    const providerSignal=await entered.promise;
    await f.unmount(owner);
    await cancelled;
    assert.equal(providerSignal.aborted,true);
    assert.equal(caller.aborted,false);
    if (owner==='room') assert.equal(f.ctx.petVoice,oldCompatibility);
    else await assert.rejects(oldCompatibility.handle({rest:'voice/voices',method:'GET'}),{name:'AbortError'});

    await f.mount(owner);
    recognition=async()=>({text:'current recording'});
    late.resolve({text:'obsolete recording'});
    assert.deepEqual(await hear(f.ctx.petRoom,f.id),{ok:true,text:'current recording'});
  }
});

test('桌宠和 Room 复用语音登记，缺组件或只有合成时沿用原有回包', async t => {
  const f=await presentationFixture(t);
  await f.mount('desktop');
  await f.mount('platform');
  await f.mount('room');
  t.after(f.ctx.petDesktop.onPresentation(()=>{},()=>true));
  const desktop=f.ctx.petDesktop.features, room=f.ctx.petRoom, platform=f.ctx.petPlatform;
  const platformURL=new URL('http://fixture.invalid/chatpet-presentation/voice/voices');
  await assert.rejects(hear(room,f.id),/语音组件尚未启用/);
  await assert.rejects(desktop.request({path:'/voice/voices'}),/语音组件尚未启用/);
  assert.equal((await platform.handle(platformURL,'GET',undefined,signal())).status,503);
  assert.equal(f.core.native.voiceTable.lookup(f.ctx),undefined);

  await f.mount('voice');
  assert.deepEqual(f.core.native.voiceTable.lookup(f.ctx).availability(),{speak:true,hear:false});
  assert.equal((await hear(room,f.id)).reason,'unsupported');
  assert.ok((await desktop.request({path:'/voice/voices'})).voices.length>1);
  assert.equal((await platform.handle(platformURL,'POST',undefined,signal())).status,405);

  const speech=Buffer.from('synthetic speech');
  t.after(registerVoiceProvider({id:'synthetic',name:'synthetic',synthesize:async()=>speech}));
  const result=await desktop.request({path:'/voice/speak',method:'POST',body:JSON.stringify({text:'fixture reply'})});
  assert.deepEqual(result,{audio:speech.toString('base64'),mediaType:'audio/mpeg'});
});

test('启用 QQ 语音但 Voice 缺席时，一条语音回复降级为一条纯文字', async t => {
  const transport=qqTransport(t);
  const f=await presentationFixture(t);
  await f.mount('channels');
  // The scripted native agent does not install optional upstream voice hints.
  const home=await resolveCompanionHome(f.ctx,f.core);
  home.inject=()=>{};
  const channels=f.ctx.petChannels, {messaging}=await channels.request(f.id,'channelStatus',{});
  await channels.request(f.id,'messagingSettings',{expected:messaging.config,
    next:{qq:{enabled:true,accountId:'100',ownerSpeakerId:'200',allowPrivate:['200'],voiceEnabled:true}}});
  f.model=async()=> '[[voice:Synthetic fallback reply]]';
  transport.gateway.onPrivateMessage({kind:'private',selfId:'100',userId:'200',messageId:'voice-fallback',text:'Synthetic owner input'});
  await eventually(()=>transport.sent.length===1,'QQ 文字降级送达');
  const {messaging:result}=await channels.request(f.id,'channelStatus',{});
  assert.deepEqual(transport.sent,[{id:'200',text:'Synthetic fallback reply'}]);
  assert.equal(result.qq.error,'语音合成不可用，已改用文字');
  assert.equal(result.qq.voiceVerified,0);
});

async function voiceAndSearchInFlight(t) {
  const transport=qqTransport(t);
  const f=await presentationFixture(t);
  const speaking=Promise.withResolvers(), lateSpeech=Promise.withResolvers();
  const searching=Promise.withResolvers(), lateSearch=Promise.withResolvers();
  await f.ctx.plugin(scope=>{
    scope.provide('web',{search(){searching.resolve();return lateSearch.promise;}});
    scope.effect(()=>f.core.native.voiceTable.register(scope,{
      availability:()=>({speak:true,hear:false}),
      async handle({signal}) { speaking.resolve(signal); return lateSpeech.promise; },
    }).revoke);
  });
  await f.mount('channels');
  const home=await resolveCompanionHome(f.ctx,f.core);
  home.inject=()=>{};
  const channels=f.ctx.petChannels, {messaging}=await channels.request(f.id,'channelStatus',{});
  await channels.request(f.id,'messagingSettings',{expected:messaging.config,
    next:{qq:{enabled:true,accountId:'100',ownerSpeakerId:'200',allowPrivate:['200'],allowGroups:['6789'],voiceEnabled:true}}});
  await channels.request(f.id,'groupSlang',{groupId:'6789',content:'fixtureword',status:'candidate',meaning:'',usage:''});
  f.model=async()=> '[[voice:Synthetic fixture reply]]';
  transport.gateway.onPrivateMessage({kind:'private',selfId:'100',userId:'200',messageId:'voice-in-flight',text:'Synthetic owner input'});
  const callerSignal=await speaking.promise;
  const search=channels.request(f.id,'groupResearch',{groupId:'6789',content:'fixtureword'});
  const rejected=assert.rejects(search,{code:'STALE_BINDING'});
  await searching.promise;
  const release=()=>{
    lateSearch.resolve({sources:[]});
    lateSpeech.resolve({kind:'json',status:200,obj:{ok:false}});
  };
  t.after(release);
  return {f,channels,transport,callerSignal,rejected,release};
}

test('关闭 Channels 时，即使查询尚未结束也会立即取消 QQ 语音', {timeout:10_000}, async t => {
  const {channels,transport,callerSignal,rejected,release}=await voiceAndSearchInFlight(t);
  const closing=channels.close();
  try {
    assert.equal(callerSignal.aborted,true);
    assert.deepEqual(transport.sent,[]);
  } finally {
    release();
    await Promise.all([rejected,closing]);
  }
  assert.deepEqual(transport.sent,[]);
});

test('回到 A 后取消旧 QQ 合成并保持零送达', {timeout:10_000}, async t => {
  const {f,channels,transport,callerSignal,rejected,release}=await voiceAndSearchInFlight(t);
  const secondPath=realpathSync(mkdtempSync(join(tmpdir(),'her-world-qq-rebind-')));
  t.after(()=>rmSync(secondPath,{recursive:true,force:true}));
  const original=f.core.workspace.homeScope(), second=await f.registry.create(secondPath);
  try {
    await selectHome(f,second);
    const current=await selectHome(f,f.bound);
    assert.equal(current.storageId,original.storageId);
    assert.notEqual(current.generation,original.generation);
    assert.equal(callerSignal.aborted,true);
  } finally {
    release();
    await rejected;
  }
  assert.equal((await channels.request(f.id,'channelStatus',{})).messaging.config.qq.enabled,true);
  assert.deepEqual(transport.sent,[]);
});

test('撤销在途的 QQ 语音合成不会改发文字', {timeout:10_000}, async t => {
  const transport=qqTransport(t), f=await presentationFixture(t);
  const speaking=Promise.withResolvers(), lateSpeech=Promise.withResolvers();
  const voice=await f.ctx.plugin(scope=>{
    scope.effect(()=>f.core.native.voiceTable.register(scope,{
      availability:()=>({speak:true,hear:false}),
      async handle({signal}) { speaking.resolve(signal); return lateSpeech.promise; },
    }).revoke);
  });
  t.after(()=>lateSpeech.resolve({kind:'json',status:200,obj:{ok:false}}));
  await f.mount('channels');
  const home=await resolveCompanionHome(f.ctx,f.core);
  home.inject=()=>{};
  const channels=f.ctx.petChannels, {messaging}=await channels.request(f.id,'channelStatus',{});
  await channels.request(f.id,'messagingSettings',{expected:messaging.config,
    next:{qq:{enabled:true,accountId:'100',ownerSpeakerId:'200',allowPrivate:['200'],voiceEnabled:true}}});
  f.model=async()=> '[[voice:Synthetic interrupted speech]]';
  transport.gateway.onPrivateMessage({kind:'private',selfId:'100',userId:'200',messageId:'voice-cancelled',text:'Synthetic owner input'});
  const providerSignal=await speaking.promise;
  await voice.dispose();
  assert.equal(providerSignal.aborted,true);
  lateSpeech.resolve({kind:'json',status:200,obj:{ok:false}});
  await new Promise(setImmediate);
  assert.deepEqual(transport.sent,[]);
});
