import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import type {SpeakerIdentity} from '#dsh-world/ecosystem/shared/identity';
import {createGroupGameplay} from '../../src/channels/group-material.js';
import {createQzoneLedger} from '../../src/channels/group-qzone.js';

test('Room group features retain source attribution and stay inside one native group and device account', async () => {
  const dir = mkdtempSync(join(tmpdir(),'chatpet-group-fixture-'));
  const network:string[] = [], sends:string[] = [], forwards:string[] = [];
  const options = {dataDirectory:dir, active:()=>true, allowed:(id:SpeakerIdentity)=>id.channel==='qq' && ['10','20'].includes(id.conversationId),
    search:async(query:string)=>{network.push(query);return {sources:[{url:'https://example.org/lexicon',title:'Public word'}]};}};
  let groups = createGroupGameplay(options);
  const first:SpeakerIdentity = {channel:'qq',accountId:'42',speakerId:'qq:7',speakerName:'A',conversationId:'10',conversationType:'group',platformMessageId:'first'};
  const other = {...first,conversationId:'20'}, differentAccount = {...first,accountId:'41'};
  const message = {text:'查看好感度。群内说摆摆鱼。',segments:[
    {type:'at',data:{qq:'42'}},{type:'forward',data:{id:'forward-10'}},
    {type:'mface',data:{emoji_id:'face_10',summary:'蓝鱼收藏'}},
  ]};
  const transport = {forward:async(id:string)=>{forwards.push(id);return {messages:[{sender:{nickname:'转发人'},content:[
    {type:'text',data:{text:'群内转发内容'}},{type:'forward',data:{id:'nested-10'}}]}]};},
    sendSticker:async(id:SpeakerIdentity, stickerId:string)=>{sends.push(id.conversationId+':'+stickerId);}};
  const manage = (operation:string, data:Record<string,unknown>={})=>groups.manage('42',['10','20'],operation,{groupId:'10',...data});
  const material = (identity:SpeakerIdentity)=>groups.material({identity,text:message.text,sessionId:'fixture'});
  try {
    groups.receive(first,message,{replyToSelf:false});
    groups.receive(first,message,{replyToSelf:false});
    assert.match(material(first),/互动次数：1 次/);
    assert.doesNotMatch(material(other),/互动次数|forward-10|face_10/);
    assert.doesNotMatch(material(differentAccount),/互动次数|forward-10|face_10/);
    await groups.action(first,'qq_memory_append',{messageId:'first',note:'喜欢逗鱼'},transport);
    assert.match(material(first),/喜欢逗鱼/);
    assert.doesNotMatch(material(other),/喜欢逗鱼/);
    await groups.action(first,'qq_memory_update',{messageId:'first',note:'喜欢种花'},transport);
    assert.doesNotMatch(material(first),/喜欢逗鱼/);
    assert.match(material(first),/喜欢种花/);
    await groups.action(first,'qq_memory_remove',{messageId:'first'},transport);
    assert.doesNotMatch(material(first),/喜欢种花/);
    assert.equal(material({...first,conversationType:'private'}),'');
    await assert.rejects(groups.action(other,'qq_get_forward_msg',{id:'forward-10'},transport));
    assert.deepEqual(forwards,[]);
    assert.match(JSON.stringify(await groups.action(first,'qq_get_forward_msg',{id:'forward-10'},transport)),/群内转发内容/);
    await groups.action(first,'qq_get_forward_msg',{id:'nested-10'},transport);
    assert.deepEqual(forwards,['forward-10','nested-10']);
    await assert.rejects(groups.action(other,'qq_collect_sticker',{id:'face_10',messageId:'first'},transport));
    await groups.action(first,'qq_collect_sticker',{id:'face_10',messageId:'first',note:'微笑'},transport);
    await groups.action(first,'qq_sticker_note',{id:'face_10',note:'本群专用'},transport);
    await groups.action(first,'qq_send_sticker',{id:'face_10'},transport);
    assert.deepEqual(sends,['10:face_10']);
    assert.deepEqual(await groups.action(other,'qq_list_stickers',{},transport),[]);
    await assert.rejects(groups.action(other,'qq_send_sticker',{id:'face_10'},transport));
    await assert.rejects(groups.action(first,'qq_slang_submit',{term:'外群新词',messageId:'first'},transport));
    await groups.action(first,'qq_slang_submit',{term:'摆摆鱼',messageId:'first'},transport);
    await groups.action(first,'qq_slang_submit',{term:'摆摆鱼',messageId:'first'},transport);
    assert.deepEqual(await groups.action(other,'qq_slang_query',{},transport),[]);
    assert.deepEqual(network,[]);
    const research = await manage('groupResearch',{content:'摆摆鱼'});
    assert.ok('available' in research && research.available);
    assert.deepEqual(network,['摆摆鱼']);
    const marked = await manage('groupSlang',{content:'摆摆鱼',meaning:'群内玩笑',status:'confirmed'});
    assert.ok('settings' in marked && marked.settings);
    assert.equal(marked.slang[0].count,1);
    await assert.rejects(manage('groupResearch',{content:'摆摆鱼'}));
    const next = {...marked.settings, roleMode:'v2', roleCard:'## Common\nA群角色\n## Old [v1]\n一代说法\n## New [v2]\n二代说法'};
    await manage('groupSettings',{expected:marked.settings,next});
    await assert.rejects(manage('groupSettings',{expected:marked.settings,next}));
    assert.match(material(first),/A群角色[\s\S]+二代说法/);
    assert.doesNotMatch(material(first),/一代说法/);
    assert.match(material(first),/群内玩笑/);
    assert.doesNotMatch(material(other),/A群角色|群内玩笑|本群专用/);
    groups.stop();
    groups = createGroupGameplay(options);
    assert.match(material(first),/A群角色/);
    const saved = await manage('groupState');
    assert.ok('settings' in saved && saved.settings);
    await manage('groupSettings',{expected:saved.settings,next:{...saved.settings,forwards:false,slang:false,stickers:false}});
    await assert.rejects(groups.action(first,'qq_get_forward_msg',{id:'forward-10'},transport));
    await assert.rejects(groups.action(first,'qq_list_stickers',{},transport));
    assert.doesNotMatch(material(first),/群内玩笑/);
    await assert.rejects(groups.manage('42',['20'],'groupState',{groupId:'10'}));
  } finally {groups.stop();rmSync(dir,{recursive:true,force:true});}
});

test('Qzone checks the original quota, confirmed public draft and durable unknown delivery before sending', async () => {
  const dir=mkdtempSync(join(tmpdir(),'chatpet-qq-publishing-'));
  let time=Date.UTC(2020,0,2,6);
  const create=()=>createQzoneLedger(dir,'42',()=>time);
  const sent:string[]=[], post=async(text:string)=>{sent.push(text);return {tid:'platform-'+sent.length};};
  try {
    const ledger=create(), current=ledger.manage('qzoneState').settings;
    ledger.manage('qzoneDraft',{text:'今天的西红柿发芽了。'});
    await ledger.tick([],post);
    assert.deepEqual(sent,[]);
    await assert.rejects(ledger.publish('这是模型自己写的公开草稿',[],post));
    ledger.manage('qzoneSettings',{expected:current,next:{enabled:true,times:['13:00','13:40'],dailyMax:2}});
    await Promise.all([ledger.tick([],post),ledger.tick([],post)]);
    assert.deepEqual(sent,['今天的西红柿发芽了。']);
    assert.equal(create().manage('qzoneState').posts[0].status,'sent');
    const exact='这是一段仅属于某个群聊而且绝对不希望被自动公开转载的原始文字';
    ledger.manage('qzoneDraft',{text:exact});
    await assert.rejects(ledger.publish(exact,[exact],post));
    const blocked=ledger.manage('qzoneState').drafts.find(d=>d.text===exact)!;
    ledger.manage('qzoneRemove',{id:blocked.id});
    ledger.manage('qzoneDraft',{text:'我又画了一条海鱼。'});
    await assert.rejects(ledger.publish('我又画了一条海鱼。',[],post));
    time+=40*60_000;
    await assert.rejects(ledger.tick([],async()=>{throw Error('lost receipt');}));
    await create().tick([],post);
    const uncertain=create().manage('qzoneState').drafts.find(d=>d.status==='uncertain')!;
    assert.ok(uncertain);
    await assert.rejects(create().publish(uncertain.text,[],post));
    assert.throws(()=>create().manage('qzoneDraft',{text:uncertain.text}));
    assert.equal(sent.length,1);
    assert.equal(createQzoneLedger(dir,'43',()=>time).manage('qzoneState').drafts.length,0);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('v2 uses per-group unread receipts, wake triggers, bounded feedback and one explicit quoted message', async () => {
  const dataDirectory=mkdtempSync(join(tmpdir(),'chatpet-group-v2-'));
  const create=()=>createGroupGameplay({dataDirectory,active:()=>true,allowed:()=>true});
  let groups=create();
  const ids=(conversationId:string, platformMessageId:string, speakerId='qq:7'):SpeakerIdentity=>({
    channel:'qq',accountId:'42',speakerId,speakerName:'群友',conversationId,conversationType:'group',platformMessageId,
  });
  const manage=(groupId:string,operation:string,input:Record<string,unknown>={})=>groups.manage('42',['10','20'],operation,{groupId,...input});
  const configure=async(groupId:string,roleMode:'v1'|'v2',wake:Record<string,unknown>={})=>{
    const result=await manage(groupId,'groupState');
    assert.ok('settings' in result && result.settings);
    await manage(groupId,'groupSettings',{expected:result.settings,next:{...result.settings,roleMode,wake:{...result.settings.wake,...wake}}});
  };
  const receive=(id:SpeakerIdentity,text:string,segments?:{type:string;data:Record<string,unknown>}[])=>{
    groups.receive(id,{text,segments},{replyToSelf:false});
    return groups.decision(id);
  };
  const ordinary=ids('10','101'), called=ids('10','102','qq:8'), capped=ids('10','103');
  const other=ids('20','202');
  try {
    assert.deepEqual(groups.decision(ordinary,true),{mode:'v1',wake:true});
    assert.equal(groups.response(ordinary,'普通发言'),'普通发言');
    assert.equal(groups.response(ordinary,' [SILENT] '),'');
    assert.equal(groups.response(ordinary,'例如 [SILENT] 标记'),'例如 [SILENT] 标记');
    await configure('10','v2',{keywords:['DS']});
    await configure('20','v2',{speakerIds:['7']});
    assert.deepEqual(receive(ordinary,'ADS 是个缩写。'),{mode:'v2',wake:false});
    assert.deepEqual(receive(called,'聊聊 DS'),{mode:'v2',wake:true});
    assert.equal(groups.decision(called,true).wake,false);
    assert.equal(receive(capped,'你会不会画画？').wake,false);
    assert.equal(receive(other,'乙群自己的一条话').wake,true);
    await assert.rejects(groups.action(called,'qq_mark_read',{throughSeq:2},{}));
    const unread=await groups.action(called,'qq_get_unread',{},{});
    assert.match(JSON.stringify(unread),/ADS.*聊聊 DS.*画画/);
    assert.doesNotMatch(JSON.stringify(unread),/乙群/);
    await assert.rejects(groups.action(called,'qq_mark_read',{throughSeq:4},{}));
    assert.deepEqual(await groups.action(called,'qq_mark_read',{throughSeq:2},{}),{count:2,throughSeq:2});
    assert.deepEqual(await groups.action(called,'qq_feedback',{decision:'silent'},{}),{feedback:'选择旁观'});
    assert.equal(groups.response(called,'不能发出的内部说明','v2'),'');
    await assert.rejects(groups.action(called,'qq_reply',{replyToMessageId:'202',text:'不应该跨群'},{}));
    await groups.action(called,'qq_reply',{replyToMessageId:'101',text:'我接的是前面那句话'}, {});
    assert.equal(groups.quoteTarget(called),'101');
    assert.equal(groups.response(called,'内部说明','v2'),'我接的是前面那句话');
    assert.equal(groups.quoteTarget(called),undefined);
    assert.equal(groups.response(called,'内部说明','v2'),'');
    const reply=ids('10','104');
    receive(reply,'原来如此',[{type:'reply',data:{id:'101'}},{type:'text',data:{text:'原来如此'}}]);
    const quoted=groups.material({identity:reply,text:'原来如此',sessionId:'group10'});
    assert.match(quoted,/实际引用.*101.*群友.*ADS/);
    await groups.action(called,'qq_report_feedback',{level:'warning',message:'转发不可用。token=PRIVATEKEY'}, {});
    for(let i=0;i<4;i++) await groups.action(called,'qq_report_feedback',{message:'群内报告 '+i},{});
    await assert.rejects(groups.action(called,'qq_report_feedback',{message:'第六条'},{}));
    const snapshot=await manage('10','groupState');
    assert.ok('social' in snapshot && snapshot.social);
    assert.equal(snapshot.social.unread,2);
    assert.equal(snapshot.social.reports.length,5);
    assert.match(snapshot.social.reports[0].message,/\*\*\*/);
    assert.doesNotMatch(JSON.stringify(snapshot.social.reports),/PRIVATEKEY/);
    const otherSnapshot=await manage('20','groupState');
    assert.ok('social' in otherSnapshot && otherSnapshot.social);
    assert.deepEqual(otherSnapshot.social.reports,[]);
    groups.stop();
    groups=create();
    await assert.rejects(groups.action(capped,'qq_mark_read',{throughSeq:3},{}));
    const recovered=await groups.action(capped,'qq_get_unread',{},{});
    assert.doesNotMatch(JSON.stringify(recovered),/聊聊 DS/);
    assert.match(JSON.stringify(recovered),/画画/);
    await groups.action(capped,'qq_send_message',{text:'这条将在切换模式时取消'}, {});
    await configure('10','v1');
    assert.equal(groups.response(capped,'内部说明','v2'),'');
    await assert.rejects(groups.action(capped,'qq_get_unread',{},{}));
    assert.equal(groups.response(capped,'普通回复','v1'),'普通回复');
  } finally {groups.stop();rmSync(dataDirectory,{recursive:true,force:true});}
});
