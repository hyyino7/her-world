import type {Context} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
import {createHash} from 'node:crypto';
import {chmodSync, lstatSync, readFileSync, realpathSync} from 'node:fs';
import {basename, join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {createWechatModule} from '#dsh-world/adapters/wechat-scoped';
import {createQqHome} from '#dsh-world/adapters/qq-home';
import type {Push} from '#dsh-world/ecosystem/shared/outlets';
import {conversationKey, speakerIdentity, type SpeakerIdentity} from '#dsh-world/ecosystem/shared/identity';
import type {PetCoreHost} from '../core/index.js';
import {check, digest} from '../core/storage.js';
import {privateDeviceDirectory} from './bridge.js';
import {channelUsage} from './usage.js';
import {createChannelHomes} from './sessions.js';
import {allowedIdentity, editableMessagingFields, messagingPreferences, ownerIdentity} from './messaging-settings.js';
import {createQzoneLedger} from './group-qzone.js';
import {createGroupGameplay} from './group-material.js';
import {openQQ, type QQOptions, type QQTransport} from './qq.js';
import {messagingStorage} from './messaging-storage.js';
import {createQQInbox,probeQQAdmission} from './qq-inbox.js';

interface Options {
  deviceDirectory:string; dataDirectory:string; workspaceId:string; storageId:string; ownerHome():Promise<Agent>; active():boolean;
  qqTransport?(opts:QQOptions):QQTransport;
}
interface Server {getOrigin():string; register(route:ReturnType<typeof createWechatModule>['route']):()=>void}
function safeFile(file:string) {
  const stat=lstatSync(file,{throwIfNoEntry:false});
  check(!stat || stat.isFile() && !stat.isSymbolicLink() && stat.nlink===1,'Invalid channel data file');
  return !!stat;
}
function identityInTurn(agent:Agent) {
  for (const event of [...agent.session.snapshotEvents()].reverse()) {
    if (event.type==='turn/start') break;
    if (event.type==='user/message' && event.data.source.kind==='user' && 'identity' in event.data.source)
      return speakerIdentity(event.data.source.identity);
  }
}
function acceptsVisitorSend(incoming:string, id:SpeakerIdentity, args:unknown) {
  const input=args as {messages?:{type?:string;path?:string}[]};
  if (!Array.isArray(input.messages)) return false;
  const directory=join(incoming,createHash('sha256').update(conversationKey(id)).digest('hex'));
  return input.messages.every(item=>{
    if(item?.type==='text')return true;
    if(!item || !['image','sticker'].includes(item.type??'') || typeof item.path!=='string')return false;
    const file=basename(item.path);
    if(!/^[a-f0-9]{64}\.png$/.test(file)||item.path!==join(directory,file))return false;
    try {
      if(!safeFile(item.path)||realpathSync(item.path)!==item.path||lstatSync(item.path).size>10*1024*1024)return false;
      return createHash('sha256').update(readFileSync(item.path)).digest('hex')+'.png'===file;
    } catch {return false;}
  });
}
const visitorTools=new Set(['wechat_send','wechat_history','wechat_image']);
export async function createMessaging(ctx:Context, host:PetCoreHost, options:Options) {
  const persistence=messagingStorage(options.deviceDirectory,options.dataDirectory), store=host.workspace.runtime.store;
  let config=persistence.current;
  let closed=false;
  const active=()=>!closed&&options.active();
  const allowed=(id:SpeakerIdentity)=>active()&&allowedIdentity(config,id);
  const owner=(id:SpeakerIdentity)=>active()&&ownerIdentity(config,id);
  const homes=createChannelHomes(ctx,host,{...options,active,identityAllowed:allowed,ownerIdentity:owner});
  const usage=channelUsage(ctx,host,options.storageId,homes.allowsReply);
  const web=(ctx as unknown as {get(name:'web'):{search(input:{query:string;maxResults:number}):Promise<{sources:{url:string;title?:string;snippet?:string}[]}>}|undefined}).get('web');
  const groups=createGroupGameplay({dataDirectory:options.dataDirectory,active,allowed,
    companionName:()=>host.workspace.runtime.identity().displayName,
    search:web?query=>web.search({query,maxResults:5}):undefined});
  const receipt=(id:SpeakerIdentity)=>digest([options.storageId,id.channel,id.accountId,id.conversationType,id.conversationId,id.speakerId,id.platformMessageId]);
  let qq:ReturnType<typeof openQQ>|undefined, qqHome:ReturnType<typeof createQqHome>|undefined, qqError:string|null=null;
  let qqVoice:AbortController|undefined;
  let wx:ReturnType<typeof createWechatModule>|undefined, unregister:(()=>void)|undefined, wxFile:string|null=null, wxError:string|null=null;

  async function qqStart() {
    if (!active()||!config.qq.enabled) return;
    try {
      const transport=options.qqTransport??(await import('#dsh-world/adapters/qq-sdk')).createBridge;
      if(!active())return;
      qqHome=createQqHome({ctx,voiceEnabled:()=>config.qq.voiceEnabled,groupMaterial:input=>groups.material(input),home:async (id,expected)=>{
        const agent=await homes.open(id,expected);
        if(id.conversationType==='group') groups.bind(agent,id,()=>homes.allowsReply(agent.id,id),{
          forward:messageId=>{check(qq,'QQ 已停用');return qq.forward(id,messageId);},
          sendSticker:(target,stickerId)=>{check(qq && target.accountId===id.accountId && target.conversationId===id.conversationId,'群目标已变更');return qq.sendSticker(id,stickerId);}
        });
        return agent;
      },replyNudge:(agent,original,message)=>homes.replyNudge(agent.id,original,message),inWorld:session=>active() &&
        homes.owns(session.id)});
      const home=qqHome;
      const qqAccount=config.qq.accountId;
      const voiceLifetime=qqVoice=new AbortController();
      const qqActive=()=>active() && !voiceLifetime.signal.aborted && config.qq.enabled && config.qq.accountId===qqAccount;
      const inbox=createQQInbox({store,storageId:options.storageId,active:qqActive,allowed,owner,
        probe:submission=>probeQQAdmission(ctx as unknown as Parameters<typeof probeQQAdmission>[0],submission,qqActive)});
      qq=openQQ({settings:config.qq,qzone:createQzoneLedger(options.dataDirectory,qqAccount),
        active:qqActive,allowed,owner,inbox,transport,async speak(text) {
        const voice=host.native.voiceTable.lookup(ctx,voiceLifetime.signal);check(voice && qqActive(),'语音未启用');
        const response=await voice.handle({rest:'voice/speak',method:'POST',body:JSON.stringify({text})});
        voice.assertCurrent();
        check(response.kind==='file' && response.contentType==='audio/mpeg' && safeFile(response.file)
          && lstatSync(response.file).size<=4*1024*1024 && qqActive(),'合成音频不可用');
        return readFileSync(response.file);
      },groupQuote:id=>groups.quoteTarget(id),decideGroup:(id,trigger,recovering)=>groups.decision(id,trigger,recovering),groupResponse:(id,text,mode)=>groups.response(id,text,mode),
        observeGroup:(id,message,flags)=>groups.receive(id,message,flags),ask:(text,id,history,mode,delivery)=>home.ask(text,id,history,mode,delivery)});
      qqError=null;
    } catch(error) {
      qqVoice?.abort();qqVoice=undefined;
      qqHome?.stop();qqHome=undefined;
      qqError=error instanceof Error && error.message.includes('环境变量')?'QQ 凭据环境变量未设置':'QQ SDK 或本机 WebSocket 适配器不可用';
    }
  }
  function wxStart() {
    if(!active()||!config.wechat.enabled)return;
    const settings=config.wechat;
    try {
      const accountKey=digest([options.storageId,settings.accountId]).slice(7,31);
      const dir=privateDeviceDirectory(options.deviceDirectory,'wechat-'+accountKey), discovery=join(dir,'wechat.json');
      const dataDirectory=privateDeviceDirectory(options.dataDirectory,'wechat-'+accountKey);
      safeFile(discovery);
      for(const name of ['wechat-outbox.sqlite','wechat-outbox.sqlite-shm','wechat-outbox.sqlite-wal'])safeFile(join(dataDirectory,name));
      const incoming=privateDeviceDirectory(dataDirectory,'incoming'), stickers=privateDeviceDirectory(dataDirectory,'stickers');
      privateDeviceDirectory(stickers,'incoming');
      const server=(ctx as unknown as {webServer:Server}).webServer;
      const module=createWechatModule({ctx,file:discovery,dataDirectory,worldId:'chatpet-'+accountKey,incomingDir:incoming,allowedHosts:[],
        origin:()=>server.getOrigin(),settings:()=>({contextMessages:settings.contextMessages,bufferSeconds:settings.bufferSeconds}),
        home:async id=>{check(allowed(id),'WeChat identity unavailable');return homes.open(id);},
        inWorld:session=>active() && homes.owns(session.id),
        toolAllowed(agent,name,args) {
          if(!active())return false;
          const visitor=homes.identityFor(agent.id);
          // At registration the shared home needs the full owner catalog. At
          // execution, its current turn controls which account/target may act.
          if(!visitor && args===undefined)return homes.owns(agent.id);
          const external=visitor??identityInTurn(agent);
          if(!external)return homes.owns(agent.id);
          if(external.channel!=='wechat'||!allowed(external)||!homes.allowsReply(agent.id,external))return false;
          if(!visitor&&owner(external)) {
            if(args && name==='wechat_send') return (args as {chatId?:string}).chatId===external.conversationId;
            return true;
          }
          return visitorTools.has(name) && (!args || (args as {chatId?:string}).chatId===external.conversationId
            && (name!=='wechat_send'||acceptsVisitorSend(incoming,external,args)));
        },
        acceptBody(body) {
          check(active()&&body,'WeChat unavailable');
          if ('outbox' in body) {
            const inbox=body.outbox as {accountId?:string;chats?:{id:string;name:string}[];presence?:{groups?:{chatId:string}[]}};
            check(inbox?.accountId===settings.accountId && Array.isArray(inbox.chats),'Unconfigured WeChat account');
            const chats=inbox.chats.filter(chat=>chat && (settings.allowPrivate.includes(chat.id)||settings.allowGroups.includes(chat.id)));
            const presence=inbox.presence?.groups ? {...inbox.presence,groups:inbox.presence.groups.filter(g=>chats.some(c=>c.id===g.chatId))}:undefined;
            return {...body,outbox:{...inbox,chats,...(presence?{presence}:{})}};
          }
          if ('identity' in body) {
            const identity=speakerIdentity(body.identity);
            check(identity.channel==='wechat' && identity.platformMessageId && allowed(identity),'Unconfigured WeChat conversation');
          }
          return body;
        },
        reachAllowed:(account,chat)=>active() && !host.workspace.runtime.policy().quiet &&
          config.wechat.ownerReach && config.wechat.enabled && config.wechat.accountId===account && config.wechat.ownerSpeakerId===chat && config.wechat.allowPrivate.includes(chat),
        canReply:(identity,sessionId)=>allowed(identity) && homes.allowsReply(sessionId,identity),
        async receive(identity,ask) {
          check(identity.platformMessageId && allowed(identity),'Invalid WeChat delivery');
          const key=receipt(identity), previous=store.get<{state:string}>('channel-received',key);
          if (previous?.state==='done')return {duplicate:true};
          check(!previous,'WeChat delivery needs reconciliation');
          store.put('channel-received',key,{state:'started'});
          try {
            const answer=await ask();
            store.put('channel-received',key,{state:'done'});
            return answer;
          } catch(error) {
            if(error instanceof Error && error.constructor.name==='WechatHomeBusy')store.put('channel-received',key,null);
            throw error;
          }
        },
      });
      wx=module;
      module.start();chmodSync(discovery,0o600);unregister=server.register(module.route);wxFile=discovery;wxError=null;
    } catch(error) {ctx.logger.warn('WeChat adapter startup failed',error);unregister?.();unregister=undefined;void wx?.stop();wx=undefined;wxFile=null;wxError='微信适配器接口启动失败，请检查设备目录和路由';}
  }
  async function stopQQ(){qqVoice?.abort();qqVoice=undefined;groups.unbind();qqHome?.stop();qqHome=undefined;const prev=qq;qq=undefined;await prev?.close();}
  async function stopWechat(){unregister?.();unregister=undefined;const prev=wx;wx=undefined;wxFile=null;await prev?.stop();}
  await qqStart();wxStart();
  return {
    cancelVoice() { qqVoice?.abort(); },
    qqConnection(): 'off'|'online'|'unavailable' {
      return !active() || !config.qq.enabled ? 'off' : qq?.status().connected ? 'online' : 'unavailable';
    },
    status(){return {config:structuredClone(config),fields:editableMessagingFields(),qq:{connected:false,state:config.qq.enabled?'unavailable':'off',error:qqError,
      sent:0,failed:0,blocked:0,outbox:0,voiceReceived:0,voiceVerified:0,voiceUncertain:0,...qq?.status(),usage:usage.read('qq',config.qq.accountId),credentialSet:!!config.qq.tokenEnv&&!!process.env[config.qq.tokenEnv]},
      wechat:{account:null,lastContactAt:null,chats:0,pending:0,uncertain:0,...wx?.status(),error:wxError,path:wxFile,presence:wx?.presence(new Date())??null,usage:usage.read('wechat',config.wechat.accountId)}};},
    async configure(patch:Parameters<typeof messagingPreferences>[1]){
      const next=messagingPreferences(config,patch);check(active(),'Channel workspace changed');
      const updateQQ=!isDeepStrictEqual(next.qq,config.qq)||Boolean(qqError);
      const updateWX=!isDeepStrictEqual(next.wechat,config.wechat)||Boolean(wxError);
      persistence.save(next);
      config=next;
      if(updateQQ){await stopQQ();qqError=null;await qqStart();}
      if(updateWX){await stopWechat();wxError=null;wxStart();}
    },
    async reach(push:Push & {deliveryId?:string},homeId?:string):Promise<PromiseSettledResult<string>[]> {
      if(!active() || !homeId || !ctx.get('petLife')?.isHome(homeId) || host.workspace.runtime.policy().quiet ||
        push.kind!=='reach' || !push.deliveryId || !push.text.trim())return [];
      const senders=(['qq','wechat'] as const).filter(platform=>{
        const prefs=config[platform];return prefs.enabled && prefs.ownerReach && prefs.allowPrivate.includes(prefs.ownerSpeakerId);
      }).map(async platform=>{
        const prefs=config[platform], recipient=prefs.ownerSpeakerId;
        const identity=speakerIdentity({channel:platform,accountId:prefs.accountId,conversationType:'private',conversationId:recipient,
          speakerId:platform+':'+recipient, platformMessageId:'life:'+push.deliveryId});
        const entry=digest([receipt(identity),homeId]);
        if (!owner(identity))throw Error('主人接收身份已变更');
        if(platform==='qq'){
          const state=store.get<{state:string}>('channel-reach',entry);
          if(state?.state==='sent')return 'QQ';
          if(state)throw Error('QQ 主动消息回执待核对');
          check(qq?.status().connected && (!config.qq.mutedUntil || Date.now()>=Date.parse(config.qq.mutedUntil)), '主人 QQ 已离线或处于静默时段');
          store.put('channel-reach',entry,{state:'uncertain'});
          const messageId=await qq.reach(identity,push.text);
          store.put('channel-reach',entry,{state:'sent',messageId});return 'QQ';
        }
        check(wx,'微信尚未接入');
        await wx.reach(identity,homeId,push.text);return '微信';
      });
      return Promise.allSettled(senders);
    },
    group:(operation:string,input:Record<string,unknown>)=>operation.startsWith('qzone')?createQzoneLedger(options.dataDirectory,config.qq.accountId).manage(operation,input):groups.manage(config.qq.accountId,config.qq.allowGroups,operation,input),
    async close(){closed=true;usage.stop();groups.stop();homes.stop();await Promise.all([stopQQ(),stopWechat()]);},
  };
}
