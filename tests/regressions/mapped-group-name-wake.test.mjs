import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compiledURL} from '../fixtures/playback.mjs';
import {syncBuiltinESMExports} from 'node:module';
import childProcess from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

const forbidden=[],restore=[];
function block(object,key) {
  const previous=object[key];restore.push(()=>{object[key]=previous;});
  object[key]=()=>{forbidden.push(key);throw Error('Forbidden name-wake app/network operation: '+key);};
}
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])block(childProcess,key);
for(const [object,keys] of [[net,['connect','createConnection']],[net.Socket.prototype,['connect']],
  [net.Server.prototype,['listen']],[http,['request','get']],[https,['request','get']],
  [tls,['connect']],[globalThis,['fetch']]])for(const key of keys)block(object,key);
syncBuiltinESMExports();
after(()=>{for(const undo of restore.reverse())undo();syncBuiltinESMExports();assert.deepEqual(forbidden,[]);});

const {createCore}=await import(compiledURL('core/index.js'));
const {GroupSocial,defaultWake}=await import(compiledURL('channels/group-social.js'));
const {createGroupGameplay}=await import(compiledURL('channels/group-material.js'));
const {createMessaging}=await import(compiledURL('channels/messaging.js'));
const {defaults,messagingPreferences,allowedIdentity}=await import(compiledURL('channels/messaging-settings.js'));
const value=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
const settings=patch=>({...defaultWake,atMention:false,nameMention:true,question:false,maxPerMinute:60,maxPerHour:1000,...patch});
const identity=(messageId,group='10',extra={})=>({channel:'qq',accountId:'42',speakerId:'qq:7',speakerName:'Visitor',
  conversationType:'group',conversationId:group,platformMessageId:messageId,...extra});

async function fixture(t,name='小汐') {
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-14T05:00:00Z')});
  const root=realpathSync(mkdtempSync(join(tmpdir(),'mapped-group-name-'))),repo=join(root,'repo');mkdirSync(repo);
  const config={dataDir:join(repo,'.chatpet/data/core'),companionId:'fixture-fish',scopeId:'fixture-scope',
    ownerActorId:'owner',displayName:name,character:'One continuing companion.'};
  let host=createCore(config),sequence=0,groups,active=true,permit=true;
  const cleanups=[];
  const request=()=>host.operator.request('name-wake-'+sequence++);
  const before=value(await host.services.preferences.read(request(),{}));
  const saved=value(await host.services.preferences.save(request(),{expectedRevision:before.revision,conversation:before.conversation,
    workspace:{id:'fixture-world',path:repo,title:'Fixture'}}));
  value(await host.services.workspace.initialize(request(),{expectedPreferencesRevision:saved.revision}));
  const dataDirectory=join(repo,'.chatpet/data/channels');mkdirSync(dataDirectory,{recursive:true});
  const deviceDirectory=join(root,'device');mkdirSync(deviceDirectory);
  const channelConfig=messagingPreferences(defaults,{qq:{enabled:true,accountId:'42',allowGroups:['10','20']}});
  const options={dataDirectory,active:()=>active,allowed:id=>permit&&allowedIdentity(channelConfig,id),
    companionName:()=>host.workspace.runtime.identity().displayName};
  const create=()=>createGroupGameplay(options);
  groups=create();
  t.after(async()=>{for(const cleanup of cleanups.reverse())await cleanup();groups.stop();await host.close();rmSync(root,{recursive:true,force:true});});
  const manage=(groupId,operation,input={})=>groups.manage('42',['10','20'],operation,{groupId,...input});
  const configure=async(groupId='10',wake={})=>{
    const current=await manage(groupId,'groupState');
    return manage(groupId,'groupSettings',{expected:current.settings,
      next:{...current.settings,roleMode:'v2',wake:settings(wake)}});
  };
  const observe=(id,text,segments=[],replyToSelf=false)=>{
    groups.receive(id,{text,segments},{replyToSelf});return groups.decision(id);
  };
  return {root,repo,dataDirectory,deviceDirectory,options,configure,manage,observe,
    get host(){return host;},get groups(){return groups;},
    cleanup:fn=>cleanups.push(fn),
    room:()=>[...groups.rooms.values()][0],
    ledger:()=>JSON.parse(readFileSync([...groups.rooms.keys()][0],'utf8')),
    active:value=>{active=value;},permit:value=>{permit=value;},
    async rename(displayName){const identity=host.workspace.runtime.identity();return value(await host.services.core.reviseIdentity(request(),{
      expectedScope:host.workspace.editScope(),expectedRevision:identity.revision,displayName,character:identity.character}));},
    restartGroups(){groups.stop();groups=create();},
    async restart(){groups.stop();await host.close();host=createCore(config);groups=create();},
  };
}

test('actual Core current name selects V2 wake, without treating the old product name as an alias',async t=>{
  const f=await fixture(t);await f.configure();
  assert.deepEqual(f.observe(identity('current'),'小汐，来看看'),{mode:'v2',wake:true});
  assert.deepEqual(f.observe(identity('product'),'大肥鱼，来看看'),{mode:'v2',wake:false});
  assert.equal(f.ledger().unread.find(row=>row.messageId==='current').reason,'nameMention');
  assert.equal(f.ledger().unread.find(row=>row.messageId==='product').reason,null);
});

test('a cached actual Social instance reads a Core rename on the next message',async t=>{
  const f=await fixture(t);await f.configure();f.observe(identity('before'),'小汐，来看看');
  const cached=f.room();await f.rename('小澜');
  assert.equal(f.observe(identity('old'),'小汐，来看看').wake,false);
  assert.equal(f.observe(identity('new'),'小澜，来看看').wake,true);
  assert.equal(f.room(),cached);assert.equal(f.host.workspace.runtime.identity().displayName,'小澜');
  assert.equal(f.ledger().unread[0].reason,'nameMention','An earlier fact retains its original reason');
});

test('Core and Social restart retain the renamed authority without reinterpreting old receipts',async t=>{
  const f=await fixture(t);await f.configure();f.observe(identity('original'),'小汐，来看看');
  await f.rename('小澜');await f.restart();
  assert.equal(f.host.workspace.runtime.identity().displayName,'小澜');
  assert.equal(f.observe(identity('after-old'),'小汐，来看看').wake,false);
  assert.equal(f.observe(identity('after-new'),'小澜，来看看').wake,true);
  assert.equal(f.ledger().unread.find(row=>row.messageId==='original').reason,'nameMention');
});

test('an empty Core name does not invent a default nickname and original case matching remains',async t=>{
  const f=await fixture(t);await f.configure();await f.rename('');
  assert.equal(f.observe(identity('no-name'),'大肥鱼，来看看').wake,false);
  await f.rename('XiaoXi');
  assert.equal(f.observe(identity('case'),'@xIaOxI, hello').wake,true);
});

test('a name present only in attributed quoted material does not wake V2',async t=>{
  const f=await fixture(t);await f.configure();
  f.observe(identity('named'),'小汐，来看看',[{type:'text',data:{text:'小汐，来看看'}}]);
  assert.equal(f.observe(identity('quote'),'[引用 Visitor：小汐，来看看] 明白了',[
    {type:'reply',data:{id:'named'}},{type:'text',data:{text:'明白了'}}]).wake,false);
  assert.equal(f.ledger().unread.find(row=>row.messageId==='quote').reason,null);
  assert.match(f.groups.material({identity:identity('quote'),text:'明白了',sessionId:'fixture'}),/实际引用.*named.*Visitor/);
});

test('original at, keyword, question, speaker and probability wake rules keep their priority and bounds',async t=>{
  const f=await fixture(t);
  const cases=[
    [{nameMention:false,atMention:true},'hello',[{type:'at',data:{qq:'42'}}],'atMention'],
    [{nameMention:false,atMention:true},'hello',[{type:'at',data:{qq:'43'}}],null],
    [{nameMention:false,keywords:['DS']},'ADS is a label',[],null],
    [{nameMention:false,keywords:['DS']},'hello DS',[],'keyword:DS'],
    [{nameMention:false,question:true},'你会不会画画？',[],'question'],
    [{nameMention:false,speakerIds:['7']},'hello',[],'speaker:Visitor'],
    [{nameMention:false,probability:1},'hello',[],'probability'],
    [{nameMention:false,probability:0},'hello',[],null],
  ];
  for(const [index,[wake,text,segments,reason]] of cases.entries()){
    await f.configure('10',wake);const id=identity('rule-'+index),result=f.observe(id,text,segments);
    assert.equal(result.wake,reason!==null,'Original rule '+index);
    assert.equal(f.ledger().unread.find(row=>row.messageId===id.platformMessageId).reason,reason);
  }
  await f.configure('10',{nameMention:false,atMention:true});
  assert.equal(f.observe(identity('reply-to-self'),'hello',[],true).wake,true);
});

test('dynamic name input preserves deduplication, native read receipts and wake rate limits',async t=>{
  const f=await fixture(t);await f.configure('10',{maxPerMinute:1,maxPerHour:2});
  const first=identity('first'),second=identity('second');
  assert.equal(f.observe(first,'小汐，来看看').wake,true);
  assert.equal(f.observe(first,'same platform message is not reclassified').wake,false);
  assert.equal(f.observe(second,'小汐，来看看').wake,false);
  assert.equal(f.ledger().unread.length,2);assert.equal(f.ledger().wakes.length,1);
  t.mock.timers.setTime(Date.now()+60_001);assert.equal(f.groups.decision(second).wake,true);
  assert.equal(f.ledger().wakes.length,2);
  t.mock.timers.setTime(Date.now()+60_001);assert.equal(f.observe(identity('hour-cap'),'小汐，来看看').wake,false);
  await assert.rejects(f.groups.action(first,'qq_mark_read',{throughSeq:2},{}));
  const offered=await f.groups.action(first,'qq_get_unread',{},{});assert.equal(offered.readThroughSeq,3);
  assert.deepEqual(await f.groups.action(first,'qq_mark_read',{throughSeq:1},{}),{count:1,throughSeq:1});
  await f.rename('小澜');f.restartGroups();
  await assert.rejects(f.groups.action(second,'qq_mark_read',{throughSeq:2},{}));
  const refetched=await f.groups.action(second,'qq_get_unread',{},{});assert.equal(refetched.messages.length,2);
  assert.deepEqual(await f.groups.action(second,'qq_mark_read',{throughSeq:2},{}),{count:1,throughSeq:2});
  assert.equal(f.ledger().unread[0].messageId,'hour-cap');
});

test('name wake cannot bypass the existing activity, account or group admission',async t=>{
  const f=await fixture(t);await f.configure();f.observe(identity('accepted'),'hello');const before=f.ledger();
  f.active(false);f.observe(identity('inactive'),'小汐，来看看');f.active(true);
  f.permit(false);f.observe(identity('denied'),'小汐，来看看');f.permit(true);
  f.observe(identity('foreign','10',{accountId:'43'}),'小汐，来看看');
  f.observe(identity('group','30'),'小汐，来看看');
  assert.deepEqual(f.ledger(),before);
});

test('a standalone Social uses the supplied live Core name and keeps no implicit product-name authority',async t=>{
  const f=await fixture(t),file=join(f.root,'standalone.json');
  const social=new GroupSocial(file,()=>f.host.workspace.runtime.identity().displayName),wake=settings({});
  const first=identity('standalone-current');social.observe(first,'小汐，来看看',[],false,wake);
  assert.equal(social.wake(first,false,wake),true);
  await f.rename('小澜');const next=identity('standalone-new');social.observe(next,'小澜，来看看',[],false,wake);
  assert.equal(social.wake(next,false,wake),true);
  const unnamed=new GroupSocial(join(f.root,'unnamed.json')),old=identity('unnamed');
  unnamed.observe(old,'大肥鱼，来看看',[],false,wake);assert.equal(unnamed.wake(old,false,wake),false);
});

test('actual createMessaging wiring obtains Core names for successive gateway inputs without an adapter restart',async t=>{
  const f=await fixture(t),listeners=new Map(),native=[],outbound=[];let gateway,starts=0,stops=0;
  const ctx={logger:Object.assign(()=>({warn(){},error(){}}),{warn(){},error(){}}),
    get:()=>undefined,on(name,handler){const list=listeners.get(name)??new Set();listeners.set(name,list);list.add(handler);return()=>list.delete(handler);}};
  const denied=()=>{outbound.push('unexpected output');throw Error('No account/model output is permitted');};
  const transport=options=>{gateway=options;return {start:async()=>{starts++;options.onState('online');},stop:async()=>{stops++;},getState:()=> 'online',
    sendPrivate:denied,sendGroup:denied,sendCustomFace:denied,publishQzone:denied,getForward:denied,
    sendGroupSticker:denied,recordText:denied,sendVoice:denied};};
  const messaging=await createMessaging(ctx,f.host,{deviceDirectory:f.deviceDirectory,dataDirectory:f.dataDirectory,
    workspaceId:'fixture-world',storageId:f.host.workspace.storageId(),active:()=>true,
    ownerHome:async()=>{native.push('unexpected native home');throw Error('No native/model turn permitted');},qqTransport:transport});
  f.cleanup(()=>messaging.close());
  await messaging.configure({qq:{accountId:'42',allowGroups:['10'],autoReply:false}});
  const current=await messaging.group('groupState',{groupId:'10'});
  await messaging.group('groupSettings',{groupId:'10',expected:current.settings,
    next:{...current.settings,roleMode:'v2',wake:settings({})}});
  await messaging.configure({qq:{enabled:true}});assert.equal(messaging.qqConnection(),'online');
  const deliver=(messageId,text)=>gateway.onGroupMessage({kind:'group',selfId:'42',userId:'7',groupId:'10',messageId,text,
    segments:[{type:'text',data:{text}}],sender:{nickname:'Visitor'}});
  const socialFile=()=>{
    const directory=join(f.dataDirectory,'group-material');
    return join(directory,readdirSync(directory)[0],'social.json');
  };
  deliver('wire-current','小汐，来看看');deliver('wire-product','大肥鱼，来看看');
  await f.rename('小澜');deliver('wire-old','小汐，来看看');deliver('wire-new','小澜，来看看');
  const ledger=JSON.parse(readFileSync(socialFile(),'utf8'));
  assert.deepEqual(ledger.unread.map(row=>[row.messageId,row.reason]),[
    ['wire-current','nameMention'],['wire-product',null],['wire-old',null],['wire-new','nameMention']]);
  assert.equal(starts,1);assert.equal(stops,0);assert.deepEqual(native,[]);assert.deepEqual(outbound,[]);
  assert.equal(messaging.status().config.qq.autoReply,false,'Observation does not grant a model turn');
  await messaging.close();assert.equal(stops,1);assert.ok([...listeners.values()].every(list=>list.size===0));
});
