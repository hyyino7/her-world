import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {WebSocketServer} from 'ws';
import {conversationKey} from '#dsh-world/ecosystem/shared/identity';
import {createMessaging} from '../../dist/src/channels/messaging.js';
import {digest} from '../../dist/src/core/storage.js';
import {call,say} from '../checks/lib/native-conversation-scenarios.mjs';

async function until(check, description) {
  for(let i=0;i<240;i++){const result=await check();if(result)return result;await new Promise(resolve=>setTimeout(resolve,35));}
  throw Error('Timed out waiting for '+description);
}
export async function checkMessaging({ctx,host,workspace,deviceDirectory,home,mockLife,setProgram}) {
  const dataDirectory=join(workspace.path,'.chatpet/data/channels');
  const originalWarn=ctx.logger.warn;
  ctx.logger.warn=(...args)=>console.error(...args);
  const deliveries=[];
  const http=createServer(async(req,res)=>{
    const parts=[];for await(const part of req)parts.push(part);
    deliveries.push(JSON.parse(Buffer.concat(parts).toString('utf8')));res.writeHead(200);res.end('{"ok":true}');
  });
  const ws=new WebSocketServer({port:0,host:'127.0.0.1'});
  await once(ws,'listening');
  http.listen(0,'127.0.0.1');await once(http,'listening');
  const origin=ctx.webServer.getOrigin(), outlet='http://127.0.0.1:'+http.address().port+'/notify';
  const voiceFile=join(deviceDirectory,'speech-fixture.mp3');
  writeFileSync(voiceFile,Buffer.from('ID3 synthetic fixture speech'));
  let spoken;
  await ctx.plugin(scope=>scope.effect(()=>host.native.voiceTable.register(scope,{availability:()=>({speak:true,hear:false}),async handle(request){
    assert.equal(request.rest,'voice/speak');spoken=JSON.parse(request.body).text;
    return {kind:'file',file:voiceFile,contentType:'audio/mpeg'};
  }}).revoke));
  let client, msg, iterations=0;
  const actions=[];
  ws.on('connection',socket=>{
    client=socket;
    socket.on('message',wire=>{
      const input=JSON.parse(wire.toString());
      actions.push(input);
      const data=input.action==='get_forward_msg'?{messages:[{sender:{nickname:'fixture'},message:[{type:'text',data:{text:'forwarded fixture'}}]}]}:input.action==='send_qzone_msg'?{tid:'synthetic-post',time:1}:input.action==='get_msg'?{message:[{type:'record',data:{}}]}:
        input.action==='fetch_ptt_text'?{text:'QQ speech transcript'}:{message_id:3000+actions.length};
      socket.send(JSON.stringify({status:'ok',retcode:0,data,echo:input.echo}));
    });
  });
  const start=()=>createMessaging(ctx,host,{deviceDirectory,dataDirectory,workspaceId:workspace.id,storageId:host.workspace.storageId(),ownerHome:async()=>home,active:()=>true});
  try {
    msg=await start();assert.equal(msg.status().wechat.path,null);assert.equal(client,undefined);
    await msg.configure({qq:{enabled:true,accountId:'100',ownerSpeakerId:'101',allowPrivate:['101','102'],allowGroups:['201'],voiceEnabled:true,
      wsUrl:'ws://127.0.0.1:'+ws.address().port},wechat:{enabled:true,accountId:'wx-fixture',ownerSpeakerId:'owner',allowPrivate:['owner','visitor'],allowGroups:['group@chatroom','other@chatroom']}});
    assert.equal(msg.status().wechat.error,null);
    await until(()=>client && msg.status().qq.connected,'SDK to connect');
    const toolsOf=options=>(options.tools??[]).map(t=>t.name).sort();
    const textOf=options=>options.messages.flatMap(m=>m.content.filter(b=>b.type==='text').map(b=>b.text)).join('\n');
    const latest=options=>options.messages.filter(m=>m.role==='tool').at(-1);
    let qqNames,qqText;
    setProgram(async function*(options){iterations++;qqNames=toolsOf(options);qqText=textOf(options);yield* say('QQ fixture reply');});
    const groupPrefs=await msg.group('groupState',{groupId:'201'});
    await msg.group('groupSettings',{groupId:'201',expected:groupPrefs.settings,next:{...groupPrefs.settings,roleCard:'QQ_FIXTURE_GROUP_CARD'}});
    const group={time:Math.floor(Date.now()/1000),self_id:100,post_type:'message',message_type:'group',sub_type:'normal',message_id:7001,user_id:102,group_id:201,
      sender:{user_id:102,nickname:'Member',card:'',role:'member'},message:[{type:'at',data:{qq:'100'}},{type:'text',data:{text:'hello'}}]};
    for(const evt of [group,group,{...group,self_id:199,message_id:7002},{...group,user_id:100,message_id:7003},{...group,group_id:204,message_id:7004}])client.send(JSON.stringify(evt));
    await until(()=>actions.some(a=>a.action==='send_group_msg'),'QQ group reply through the SDK');
    assert.equal(iterations,1);assert.ok(qqText.includes('QQ_FIXTURE_GROUP_CARD'));assert.ok(qqNames.includes('qq_get_forward_msg'));assert.ok(!qqNames.some(t=>t.startsWith('wechat_')));
    assert.equal(actions.filter(a=>a.action==='send_group_msg').length,1);assert.equal(actions.at(-1).params.group_id,201);
    assert.ok(!qqText.includes('PRIVATE_FIXTURE_USER_MARKER'));
    client.send(JSON.stringify({...group,message_type:'private',sub_type:'friend',message_id:7005,user_id:101,message:[{type:'text',data:{text:'private'}}]}));
    await until(()=>actions.some(a=>a.action==='send_private_msg'),'QQ owner reply through the SDK');assert.ok(qqText.includes('PRIVATE_FIXTURE_USER_MARKER'));
    client.send(JSON.stringify({...group,message_type:'private',sub_type:'friend',message_id:7006,user_id:102,message:[{type:'record',data:{file:'do-not-open-local-fixture'}}]}));
    await until(()=>msg.status().qq.voiceVerified===1,'authorized speech synthesized, sent, and confirmed').catch(error=>{throw Error(JSON.stringify({status:msg.status().qq,actions:actions.map(a=>a.action),spoken,iterations}),{cause:error});});
    assert.equal(spoken,'QQ fixture reply');assert.ok(qqText.includes('QQ speech transcript')&&!qqText.includes('do-not-open-local-fixture'));
    assert.equal(actions.find(a=>a.action==='fetch_ptt_text').params.message_id,'7006');
    assert.ok(actions.find(a=>a.action==='send_private_msg' && a.params.user_id===102).params.message[0].data.file.startsWith('base64://'));
    assert.equal(msg.status().qq.usage.requests,3);assert.equal(msg.status().qq.usage.inputTokens,36);
    const publicDraft='A fixture about clouds.';
    await msg.group('qzoneDraft',{text:publicDraft});
    setProgram(async function*(){yield* say('[[qzone:'+publicDraft+']]');});
    client.send(JSON.stringify({...group,message_type:'private',sub_type:'friend',message_id:7007,user_id:101,message:[{type:'text',data:{text:'publish the approved draft'}}]}));
    await until(async()=>(await msg.group('qzoneState',{})).drafts[0].status==='sent','approved Qzone draft receipt');
    assert.equal(actions.filter(a=>a.action==='send_qzone_msg').length,1);
    let groupStep=0;
    setProgram(async function*(opts){
      if(groupStep>0)assert.ok(!latest(opts)?.isError,JSON.stringify(latest(opts)));
      if(groupStep++===0){yield* call('qq_get_forward_msg',{id:'good-forward'});return;}
      if(groupStep===2){assert.ok(textOf(opts).includes('forwarded fixture'));yield* call('qq_collect_sticker',{messageId:'7008',id:'short'});return;}
      if(groupStep===3){yield* call('qq_send_sticker',{id:'short'});return;}
      yield* say('group checked');
    });
    client.send(JSON.stringify({...group,message_id:7008,message:[...group.message,{type:'forward',data:{id:'good-forward'}},
      {type:'mface',data:{emoji_id:'short',summary:'test smile'}}]}));
    await until(()=>actions.filter(a=>a.action==='send_group_msg').length===2,'QQ scoped forward and sticker tools');
    assert.equal(actions.find(a=>a.action==='get_forward_msg').params.id,'good-forward');
    assert.deepEqual(actions.find(a=>a.action==='send_custom_face').params,{group_id:201,emoji_id:'short'});assert.ok(!actions.some(a=>a.action==='fetch_custom_face_detail'));
    let quietV1=false;
    setProgram(async function*(){quietV1=true;yield* say('[SILENT]');});
    client.send(JSON.stringify({...group,message_id:7011}));
    await until(()=>quietV1&&!ctx.agents.list().some(a=>a.status==='running'),'V1 silence marker');
    assert.equal(actions.filter(a=>a.action==='send_group_msg').length,2);
    const prefsV1=(await msg.group('groupState',{groupId:'201'})).settings;
    await msg.group('groupSettings',{groupId:'201',expected:prefsV1,next:{...prefsV1,roleMode:'v2',wake:{...prefsV1.wake,anyMessage:true,maxPerMinute:3}}});
    let activeStep=0;
    setProgram(async function*(opts){
      if(activeStep++===0){assert.ok(toolsOf(opts).includes('qq_send_message'));yield* call('qq_send_message',{text:'accepted active group reply',replyToMessageId:'7009'});}
      else {assert.ok(!latest(opts)?.isError);yield* say('internal group explanation');}
    });
    client.send(JSON.stringify({...group,message_id:7009,message:[{type:'text',data:{text:'ordinary group input'}}]}));
    await until(()=>actions.some(a=>a.action==='send_group_msg'&&JSON.stringify(a.params.message).includes('accepted active group reply')),'V2 reply chosen by native tool');
    const selected=actions.find(a=>a.action==='send_group_msg'&&JSON.stringify(a.params.message).includes('accepted active group reply'));
    assert.deepEqual(selected.params.message[0],{type:'reply',data:{id:'7009'}});
    let silentStep=0;
    setProgram(async function*(opts){
      if(silentStep>0)assert.ok(!latest(opts)?.isError,JSON.stringify(latest(opts)));
      switch(silentStep++) {
        case 0: yield* call('qq_get_unread',{});return;
        case 1: assert.ok(textOf(opts).includes('quiet discussion'));yield* call('qq_mark_read',{throughSeq:2});return;
        case 2: yield* call('qq_report_feedback',{level:'info',message:'This group is taking a break.'});return;
        case 3: yield* call('qq_feedback',{decision:'silent'});return;
        default: yield* say('internal silent explanation');
      }
    });
    client.send(JSON.stringify({...group,message_id:7010,message:[{type:'text',data:{text:'quiet discussion'}}]}));
    await until(()=>silentStep===5&&!ctx.agents.list().some(a=>a.status==='running'),'v2 silence, read cursor and observation report');
    const observed=await msg.group('groupState',{groupId:'201'});
    assert.equal(observed.social.unread,0);
    assert.equal(observed.social.reports.at(-1).message,'This group is taking a break.');
    assert.equal(actions.filter(a=>a.action==='send_group_msg').length,3);
    const discovery=msg.status().wechat.path, key=JSON.parse(readFileSync(discovery));
    assert.equal(statSync(discovery).mode & 0o777,0o600);assert.ok(!JSON.stringify(msg.status()).includes(key.token));
    const post=async(body,token=key.token)=>{const res=await fetch(origin+key.path,{method:'POST',headers:{'x-dsh-world-token':token},body:JSON.stringify(body)});return [res.status,await res.json()];};
    const ok=async body=>{const [code,data]=await post(body);assert.equal(code,200,JSON.stringify(data));return data;};
    const inbox={outbox:{accountId:'wx-fixture',chats:['owner','visitor','group@chatroom','other@chatroom','not-allowed'].map(id=>({id,name:id}))}};
    assert.equal((await post(inbox,'invalid'))[0],403);assert.equal((await post({outbox:{...inbox.outbox,accountId:'wrong'}}))[0],403);
    await ok(inbox); assert.equal(msg.status().wechat.chats,4);
    const identity=(who,conversationId,id)=>({channel:'wechat',accountId:'wx-fixture',speakerId:'wechat:'+who,conversationId,conversationType:conversationId.endsWith('@chatroom')?'group':'private',platformMessageId:id});
    assert.equal((await post({identity:identity('someone','visitor','bad'),text:'hello'}))[0],403);
    const visitor=identity('visitor','visitor','image-1'), hash=value=>createHash('sha256').update(value).digest('hex');
    const data=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==','base64'),file=hash(data)+'.png';
    const wxDataDirectory=join(dataDirectory,'wechat-'+digest([host.workspace.storageId(),'wx-fixture']).slice(7,31));
    const imgDir=join(wxDataDirectory,'incoming',hash(conversationKey(visitor)));
    mkdirSync(imgDir,{recursive:true});writeFileSync(join(imgDir,file),data);
    const image={id:'image:1',occurredAt:new Date().toISOString(),text:'image',identity:visitor,image:{file,quality:'original'}};
    let wxNames,wxImage,wxText;
    setProgram(async function*(options){iterations++;wxNames=toolsOf(options);wxImage=options.messages.some(m=>m.content.some(b=>b.type==='image'));wxText=textOf(options);yield* say('WX plain reply');});
    const count=iterations;
    const ask={identity:visitor,media:[image]};
    assert.ok((await ok(ask)).id);assert.equal((await ok(ask)).duplicate,true);
    assert.equal(iterations,count+1);assert.deepEqual(wxNames,['wechat_history','wechat_image','wechat_send']);assert.ok(wxImage && wxText.includes('[微信图片]'));
    const plain=(await ok(inbox)).job;assert.equal(plain.chatId,'visitor');assert.equal(plain.messages[0].text,'WX plain reply');assert.equal((await ok(inbox)).job.id,plain.id);
    await ok({receipt:{id:plain.id,status:'sent',confirmed:1}});assert.equal((await ok(inbox)).job,undefined);
    let quoteSeen=false;
    setProgram(async function*(opts) {quoteSeen=textOf(opts).includes('fixture external quote');yield* say('owner quote handled');});
    await ok({identity:identity('owner','owner','quote-owner'),text:'owner note',
      reference:{id:'17',type:'text',speakerId:'wechat:another',text:'fixture external quote'}});
    assert.ok(quoteSeen);
    const entered=home.session.snapshotEvents().find(e=>e.type==='user/message'&&e.data.source.kind==='user'&&e.data.source.identity?.platformMessageId==='quote-owner');
    assert.ok(entered && !JSON.stringify(entered.data.content).includes('fixture external quote') && JSON.stringify(entered.data.content).includes('owner note'));
    const ownerWrite=(await ok(inbox)).job;await ok({receipt:{id:ownerWrite.id,status:'sent',confirmed:1}});
    const grp=identity('guest','group@chatroom','explicit-2');
    const commands=[
      ['wechat_history',{chatId:'other@chatroom'}],['wechat_image',{chatId:'other@chatroom',messageId:'fake:5'}],
      ['wechat_send',{chatId:'other@chatroom',messages:[{type:'text',text:'should never leave'}]}],
      ['wechat_send',{chatId:grp.conversationId,messages:[{type:'image',path:join(deviceDirectory,'messaging.json')}]}],
      ['wechat_send',{chatId:grp.conversationId,messages:[{type:'text',text:'WX explicit reply'}]}],
    ];
    let step=0,denials=0;
    setProgram(async function*(options){
      const response=latest(options);
      if(step>0 && step<5) {assert.ok(response?.isError,JSON.stringify(response));denials++;}
      const command=commands[step++];
      if(command)yield* call(...command);else yield* say('already sent');
    });
    await ok({identity:grp,text:'send'}); const explicit=await until(async()=>(await ok(inbox)).job,'explicit outgoing event');
    assert.equal(denials,4);assert.equal(explicit.chatId,grp.conversationId);assert.deepEqual(explicit.messages,[{type:'text',text:'WX explicit reply'}]);
    await ok({receipt:{id:explicit.id,status:'uncertain',confirmed:0}});assert.equal((await ok(inbox)).job,undefined);assert.equal(msg.status().wechat.uncertain,1);
    await until(()=>!ctx.agents.list().some(agent=>agent.status==='running'),'previous tool turn complete');
    const requestId=identity('guest','group@chatroom','history-3');
    const dir=join(wxDataDirectory,'incoming',hash(conversationKey(requestId)));
    mkdirSync(dir,{recursive:true});writeFileSync(join(dir,file),data);
    const record={...image,identity:requestId,id:'history:8',text:'the fixture image'};
    let readStep=0, sawGroupImage=false;
    setProgram(async function*(opts){
      if(readStep++===0){yield* call('wechat_history',{chatId:grp.conversationId});return;}
      if(readStep===2){assert.ok(!latest(opts)?.isError);assert.ok(textOf(opts).includes('the fixture image'));yield* call('wechat_image',{chatId:grp.conversationId,messageId:record.id});return;}
      sawGroupImage=opts.messages.some(m=>m.content.some(b=>b.type==='image'));yield* say('group photo seen');
    });
    const reading=ok({identity:requestId,text:'read our group history'});
    for(const withImage of [false,true]) {
      const rd=await until(async()=>(await ok(inbox)).read,'history request');
      assert.equal(rd.chatId,grp.conversationId);assert.equal(Boolean(rd.imageId),withImage);
      const {image:attachment,...msgRecord}=record;
      const lookup={id:rd.id,accountId:rd.accountId,chatId:rd.chatId,messages:[withImage?record:msgRecord]};
      assert.equal((await ok({readResult:lookup})).readAccepted,true);
    }
    await reading;assert.ok(sawGroupImage);
    const photoJob=(await ok(inbox)).job;assert.equal(photoJob.messages[0].text,'group photo seen');await ok({receipt:{id:photoJob.id,status:'sent',confirmed:1}});
    assert.ok(msg.status().wechat.usage.requests>=6);assert.ok(msg.status().wechat.usage.outputTokens>=18);
    await msg.close();assert.equal((await fetch(origin+key.path)).status,404);assert.ok(!existsSync(discovery));
    msg=await start();const next=JSON.parse(readFileSync(msg.status().wechat.path));
    const again=await fetch(origin+next.path,{method:'POST',headers:{'x-dsh-world-token':next.token},body:JSON.stringify(ask)});
    assert.equal((await again.json()).duplicate,true);await msg.configure({qq:{enabled:false},wechat:{enabled:false}});assert.equal((await fetch(origin+next.path)).status,404);
    await msg.close();msg=undefined;
    await mockLife.dispose();
    setProgram(async function*(){yield* say('Home ready');});
    const behaviorComponent=ctx.get('petBehavior')?undefined:await ctx.plugin(await import('../../dist/src/living/body/plugin.js'));
    const lifeComponent=await ctx.plugin(await import('../../dist/src/living/plan/plugin.js'));
    const channelsComponent=await ctx.plugin(await import('../../dist/src/channels/plugin.js'),{deviceDirectory:join(deviceDirectory,'host')});
    const life=ctx.petLife, channels=ctx.petChannels, request=(op,input={})=>channels.request(workspace.id,op,input);
    await life.control(workspace.id,true);
    const liveHome=(await life.snapshot(workspace.id)).life.homeSessionId;
    const agent=ctx.agents.get(liveHome);
    await until(()=>agent?.status==='idle'&&agent.session.snapshotEvents().some(e=>e.type==='turn/end'),'real Life home');
    const before=await request('channelStatus');
    const prefs=await request('messagingSettings',{expected:before.messaging.config,next:{
      qq:{enabled:true,ownerReach:true,accountId:'100',ownerSpeakerId:'101',allowPrivate:['101'],wsUrl:'ws://127.0.0.1:'+ws.address().port},
      wechat:{enabled:true,ownerReach:true,accountId:'wx-fixture',ownerSpeakerId:'owner',allowPrivate:['owner']}}});
    assert.ok(prefs.messaging.wechat.path,JSON.stringify(prefs.messaging.wechat));
    const currentWx=JSON.parse(readFileSync(prefs.messaging.wechat.path));
    const checked=async body=>{const res=await fetch(origin+currentWx.path,{method:'POST',headers:{'x-dsh-world-token':currentWx.token},body:JSON.stringify(body)});assert.equal(res.status,200);return res.json();};
    await checked(inbox);
    const connected=await request('bridgeSettings',{expected:before.bridge.preferences,next:{enabled:true,outlets:[{name:'fixture',url:outlet,kinds:['reply','reach']}]}});
    await until(async()=>(await request('channelStatus')).messaging.qq.connected,'real QQ owner outlet');
    const bridge=JSON.parse(readFileSync(connected.bridge.discovery));
    let phase=0;
    const proactive='Fixture Life greeting';
    setProgram(async function*(options) {
      if(phase++===0){assert.ok(textOf(options).includes('from external program'));yield* call('reach_out',{text:proactive});}
      else {assert.ok(!latest(options)?.isError,JSON.stringify(latest(options)));yield* say('Home replies to the bridge');}
    });
    const sayHome=async text=>fetch(origin+bridge.sayPath,{method:'POST',headers:{'x-dsh-world-token':bridge.token},body:JSON.stringify({text})});
    assert.equal((await sayHome('from external program')).status,202);
    const job=await until(async()=>(await checked(inbox)).job,'real Life to owner WeChat');
    assert.equal(job.chatId,'owner');assert.equal(job.messages[0].text,proactive);
    await checked({receipt:{id:job.id,status:'sent',confirmed:1}});
    await until(()=>agent.status==='idle'&&phase>=2,'native reach_out with acknowledgments');
    assert.ok(deliveries.some(d=>d.kind==='reach'&&d.text===proactive));
    assert.ok(deliveries.some(d=>d.kind==='reply'));
    assert.ok(actions.some(a=>a.action==='send_private_msg'&&a.params.user_id===101&&JSON.stringify(a.params.message).includes(proactive)));
    const callId=agent.session.snapshotEvents().filter(e=>e.type==='tool/call'&&e.data.name==='reach_out').at(-1).data.callId;
    const replayPush={text:proactive,kind:'reach',name:'Dafeiyu',deliveryId:callId};
    const lastQQ=actions.length;
    const replayed=await channels.reach(workspace.id,replayPush);
    assert.ok(replayed.filter(r=>r.status==='fulfilled').length>=2);assert.equal(actions.length,lastQQ);assert.equal((await checked(inbox)).job,undefined);
    const policy=host.workspace.runtime.policy();
    assert.ok((await host.services.preferences.setQuiet(host.operator.request('reach-quiet'),{expectedRevision:policy.revision,quiet:true})).ok);
    assert.deepEqual(await channels.reach(workspace.id,{...replayPush,deliveryId:'quiet-new-call'}),[]);
    assert.equal(actions.length,lastQQ);assert.equal((await checked(inbox)).job,undefined);
    await channelsComponent.dispose();await lifeComponent.dispose();await behaviorComponent?.dispose();
    assert.equal((await fetch(origin+bridge.sayPath)).status,404);

    console.log(JSON.stringify({ok:true,qqSdk:'loopback',voiceTranscriptAndReceipt:true,channelUsage:true,ownerReachDedup:true,nativeBridgePush:true,qzoneReceipt:true,groupForwardAndSticker:true,wechatProtocol:4,media:true,groupTools:true,visitorTools:wxNames,blockedTools:denials,plainAndExplicitQueuedOnce:true,restartDedup:true,paidCalls:0}));
  } finally {
    ctx.logger.warn=originalWarn;
    await msg?.close();for(const socket of ws.clients)socket.terminate();await new Promise(resolve=>ws.close(resolve));http.closeAllConnections();await new Promise(resolve=>http.close(resolve));
  }
}
