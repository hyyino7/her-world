import {roomOverview,gardenOverview,stateViewParameter,factIdsParameter} from './tool-context.js';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { ImageBlock } from '@deepseek-ai/dsh-llm';
import { lstatSync, readFileSync } from 'node:fs';
import type {} from '../living/body/plugin.js';
import { RoomWindow } from './window.js';
import { digest, reject } from '../core/storage.js';
import { sameHomeBinding, withLivingCaller } from '../living/index.js';
import { OWNER_LIFE_TOOL_SOURCES } from '../core/native/conversation.js';
import { isHistoryObject } from '../core/native/history-maintenance.js';
import { ROLE_ACTIONS } from '../contracts/behavior.js';
import type { CompanionToolDeclaration } from '../contracts/tables.js';
import { CONTRACT_VERSION } from '../contracts/version.js';
import { RoomChat } from './chat.js';
import { roomPhoto, type PhotoLook, type PhotoView } from './photo.js';
import { roomAsset, roomPrefix } from './assets.js';
import {classifyActivity} from '../living/body/presentation.js';
import { animationSlotAllowed } from '../living/body/animation-slots.js';
import { withHomePlayback } from '../presentation/playback.js';

const roomHomePlayback = (home:unknown) => withHomePlayback(home,animationSlotAllowed,classifyActivity);
function roomPlaybackReply<T extends {home?: unknown}>(result:T):T {
  return result.home ? {...result,home:roomHomePlayback(result.home)} : result;
}
import {isRoomEndpoint, ROOM_ENDPOINTS, roomVoiceRoute} from '../presentation/room-transport.js';
import {fail, object, requiredText, type ConsoleOperation} from '../core/tables/console.js';

const output = {schema:{type:'string' as const}, render: (_:unknown, text:string) => [{type:'text' as const, text}]};

export const roomStateDeclaration = {
  name:'room_state',sources:OWNER_LIFE_TOOL_SOURCES,
  historyOverview(_args,value) {
    if(isHistoryObject(value)&&isHistoryObject(value.layout)&&Array.isArray(value.layout.rooms)
      &&isHistoryObject(value.layout.spots)&&isHistoryObject(value.her)&&isHistoryObject(value.body))return roomOverview(value);
  },
} satisfies CompanionToolDeclaration;
const roomGardenDeclaration = {
  name:'room_garden',sources:OWNER_LIFE_TOOL_SOURCES,
  historyOverview(args,value) {
    if(isHistoryObject(args)&&args.type==='state'&&isHistoryObject(value)&&isHistoryObject(value.garden)
      &&Array.isArray(value.garden.plots)&&isHistoryObject(value.garden.care))return gardenOverview(value);
  },
} satisfies CompanionToolDeclaration;
export const roomHistoryTools = [roomStateDeclaration,roomGardenDeclaration] as const;

export class Room {
  readonly chat: RoomChat;
  private closed = false;
  private readonly lifetime = new AbortController();
  private receipts = new Map<string, {fingerprint:string; result:unknown}>();
  private subscriptions:(()=>void)[]=[];
  readonly window: RoomWindow;
  constructor(private ctx: Context) {
    this.chat = new RoomChat(ctx);
    this.window = new RoomWindow({
      binding: () => this.binding(),
      origin: () => (ctx as unknown as {get(key:'webServer'):{getOrigin():string}|undefined}).get('webServer')?.getOrigin(),
      request:(...args)=>this.request(...args),
    });
    this.subscriptions.push(ctx.on('pet/core.changed',()=>{
      this.window.reconcile();
      this.chat.reconcile();
    }));
    this.subscriptions.push(ctx.on('world.changed',change=>{
      const version=ctx.get('petBehavior')?.presentationVersion?.();
      if(version)this.window.changed(change,version);
    }));
  }
  open(workspaceId:string){this.assert(workspaceId);return this.window.open(workspaceId);}
  closeWindow(){this.window.closeWindow();}
  status(){return this.window.status();}
  private binding() { return this.closed ? undefined : this.ctx.petCore.workspace.homeScope(); }
  private assert(workspaceId: string) {
    const binding = this.binding();
    if (binding?.workspaceId !== workspaceId) reject('STALE_BINDING','房间工作区已切换');
    return binding;
  }
  private admission(workspaceId: string, signal: AbortSignal) {
    const binding=this.assert(workspaceId), behavior=this.ctx.get('petBehavior');
    const validate=()=>{
      signal.throwIfAborted();
      if(!sameHomeBinding(this.binding(),binding) || this.ctx.get('petBehavior')!==behavior)
        reject('STALE_BINDING','房间工作区或身体组件已切换');
    };
    validate();
    return {binding,validate};
  }
  async request(workspaceId:string, endpoint:string, data:Record<string,unknown>, requestId:string, caller:AbortSignal):Promise<unknown> {
    const signal=AbortSignal.any([caller,this.lifetime.signal]);
    const {binding,validate}=this.admission(workspaceId,signal);
    if (!isRoomEndpoint(endpoint)) throw Error('未知的房间操作');
    const reply=async (task:Promise<unknown>)=>{const value=await task;validate();return value;};
    const storageId=binding.storageId;
    const behavior = this.ctx.petBehavior;
    if (endpoint === 'roomState') return reply(withLivingCaller(validate,()=>behavior.roomState(workspaceId)).then(roomHomePlayback));
    if (endpoint === 'roomGarden') return reply(withLivingCaller(validate,()=>behavior.garden(workspaceId,'state')).then(roomPlaybackReply));
    if (endpoint === 'roomHistory') return reply(this.chat.history(workspaceId,validate));
    if (endpoint === 'roomVoice') {
      const host=this.ctx.petCore;
      const voice=host.native.voiceTable.lookup(this.ctx,signal,validate);
      if (!voice) throw Error('语音组件尚未启用');
      const route=roomVoiceRoute(data.operation);
      if (!route) throw Error('无效的房间语音操作');
      const response=await voice.handle({...route,body:route.method==='GET'?undefined:JSON.stringify(data.payload)});
      voice.assertCurrent();validate();
      if (response.kind==='json') return response.obj;
      const stat=lstatSync(response.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size>2*1024*1024 || response.contentType!=='audio/mpeg') throw Error('合成语音文件无效或过大');
      return {ok:true,audio:readFileSync(response.file).toString('base64'),mediaType:response.contentType};
    }
    if (endpoint === 'roomChat' || endpoint === 'roomTelevision') return reply(this.chat.reply(workspaceId, endpoint === 'roomTelevision', data, requestId, signal,validate));
    const key = digest([workspaceId, storageId, endpoint, requestId]), fingerprint = digest(data);
    const prior = this.receipts.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw Error('同一房间请求的操作已变化');
      return prior.result;
    }
    const careRequestId=['pause','resume','cancel'].includes(String(data.type))&&typeof data.requestId==='string'?data.requestId:key;
    const result = await withLivingCaller(validate,()=>endpoint === 'roomAction' ? behavior.roomAction(workspaceId, data,'主人',{requestId:key,
      actor:{kind:'owner',id:this.ctx.petCore.workspace.runtime?.config?.ownerActorId ?? 'owner',channel:'room'}}) : endpoint === 'roomPlant' ? behavior.garden(workspaceId, 'act', {...data,requestId:key}) :
      behavior.garden(workspaceId, 'control', {...data, requestId:careRequestId}));
    validate();
    const projected=roomPlaybackReply(result);
    this.receipts.set(key,{fingerprint,result:projected});
    if (this.receipts.size > 256) this.receipts.delete(this.receipts.keys().next().value!);
    return projected;
  }
  watching(id:string) { return this.chat.watching(id); }
  toolScope(agent?: Agent) {
    const workspace = this.ctx.petCore.workspace.status();
    return !this.closed && workspace.target && workspace.state === 'ready' && agent && this.ctx.get('petBehavior') &&
      !this.chat.watching(agent.id) && this.ctx.petWorld.sessionStatus(agent.session)?.state === 'ready' ? workspace.target.id : undefined;
  }
  private checked(exec: ToolRunContext) {
    exec.signal.throwIfAborted();
    const id = this.toolScope(exec.agent);
    if (!id || !exec.agent || !this.ctx.petCore.native.manages(exec.agent.id)) throw Error('房间工具需要当前工作区中已准入的原生会话');
    this.ctx.petCore.native.validate(exec.agent.id);
    return id;
  }
  private toolAdmission(exec: ToolRunContext) {
    const id=this.checked(exec), {validate:current}=this.admission(id,exec.signal);
    const validate=()=>{ current(); if(this.checked(exec)!==id) reject('STALE_BINDING','房间会话已切换'); };
    return {id,validate};
  }
  tools() {
    const behavior = this.ctx.petBehavior;
    const state = defineTool({name:roomStateDeclaration.name,description:'查看自己的真实房间状态、所在位置、身体需要和同一世界可去的房间/家具标识。',parameters:{view:stateViewParameter,factIds:factIdsParameter},output,
      execute: async ({view,factIds},exec) => {const {id,validate}=this.toolAdmission(exec);
        if(factIds){if(factIds.length<1||factIds.length>16)throw Error('Expected 1–16 fact IDs');
          const facts=await withLivingCaller(validate,()=>behavior.readFacts(id,factIds));validate();return JSON.stringify({facts});}
        const state=await withLivingCaller(validate,()=>behavior.roomState(id));validate();
        return JSON.stringify((view??(exec.agent && this.ctx.petCore.native.isAutonomous(exec.agent.id)?'overview':'full'))==='overview'?roomOverview(state):roomHomePlayback(state));}});
    const act = defineTool({name:'room_action',description:'在自己的房间移动到 room_state 里的 room/spot，或进行日常互动。睡着需先 wake，不舒服时不能移动。talk 的 text 是给房间的留言。',parameters:{
      action:{type:'string',enum:ROLE_ACTIONS,required:true}, room:{type:'string'},spot:{type:'string'},text:{type:'string'},on:{type:'boolean'}},output,
      execute:async (input,exec) => {
        if(exec.agent && this.ctx.petCore.native.isAutonomous(exec.agent.id))throw Error('自主生活请通过 life_plan_update 提交持久活动；普通房间操作仍供主人交互使用');
        const {id,validate}=this.toolAdmission(exec);
        const result = await withLivingCaller(validate,()=>behavior.roomAction(id,input,'大肥鱼',{requestId:digest([exec.agent!.id,exec.callId]),
          actor:{kind:'companion',id:this.ctx.petCore.workspace.runtime.config.companionId,channel:'dsh',sessionId:exec.agent!.id}}));
        validate();
        return JSON.stringify({changed:result.changed,event:result.event,her:result.home.her,body:result.home.body});
      }});
    const garden = defineTool({name:roomGardenDeclaration.name,description:'查看菜园，自己走去照料某块田或管理自主照料。state 返回作物、田块、库房和任务。control 按真实时间排队，读取结果确认是否完成。',parameters:{
      view:stateViewParameter,
      type:{type:'string',enum:['state','visit','careNow','auto','till','plant','water','fertilize','harvest','sell','buySeed','buyCompost'],required:true},
      plotId:{type:'integer'},cropId:{type:'string'},quantity:{type:'integer'},enabled:{type:'boolean'},decision:{type:'string',enum:['force','defer']}},output,
      execute:async(input,exec) => {
        if(input.type!=='state' && exec.agent && this.ctx.petCore.native.isAutonomous(exec.agent.id))throw Error('自主园艺请通过 life_plan_update 安排明确步骤，不直接连派操作');
        const {id,validate}=this.toolAdmission(exec);
        const {view,...operation}=input;
        const state=await withLivingCaller(validate,()=>input.type==='state' ? behavior.garden(id,'state') :
          behavior.garden(id,'control',{...operation,requestId:digest([exec.agent!.id,exec.callId])}));
        validate();
        return JSON.stringify(input.type==='state' && (view??(exec.agent && this.ctx.petCore.native.isAutonomous(exec.agent.id)?'overview':'full'))==='overview'?gardenOverview(state):state);
      }});
    const photo = defineTool({name:'room_photo',description:'拍下自己当前房间的真实画面。overview 是含自己的近景，eyes 是自己的第一视角。look 可向前或看向室内。返回会话内可查看的照片。',parameters:{
      view:{type:'string',enum:['overview','eyes']},look:{type:'string',enum:['forward','room']}},
      output:{schema:{type:'string'},render:(_,value) => [JSON.parse(value) as ImageBlock]},
      execute:async({view='overview',look='forward'},exec) => {
        const {id,validate}=this.toolAdmission(exec);
        const home=await withLivingCaller(validate,()=>behavior.roomState(id));
        const garden=await withLivingCaller(validate,()=>behavior.garden(id,'state'));
        validate();
        const image = await roomPhoto(roomHomePlayback(home), roomPlaybackReply(garden), view as PhotoView, look as PhotoLook, exec.signal);
        validate();
        const block = (await this.chat.images.admit(image,validate)).find(part=>part.type === 'image');
        validate();
        if (!block) throw Error('当前房间的照片不可用');
        return JSON.stringify(block);
      }});
    return [state,act,garden,photo];
  }
  async close() {this.closed = true;this.lifetime.abort();for(const stop of this.subscriptions.splice(0))stop();this.closeWindow(); this.receipts.clear(); await this.chat.close();}
}

export function roomConsoleOperations(room: Pick<Room, 'open' | 'request'>) {
  const operations: Record<string, ConsoleOperation> = {
    roomOpen(call) {
      const input = object(call.input, ['workspaceId']);
      const id = requiredText(input.workspaceId, 200);
      call.checkBinding(id);
      call.validate();
      return room.open(id);
    },
  };
  for (const endpoint of ROOM_ENDPOINTS) operations[endpoint] = call => {
    const input = object(call.input, ['workspaceId', 'data']);
    const id = requiredText(input.workspaceId, 200);
    call.checkBinding(id);
    const {data} = input;
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail('INVALID_ARGUMENT');
    call.validate();
    return room.request(id, endpoint, data as Record<string, unknown>, call.requestId, call.signal);
  };
  return {operations};
}

export const name = '50-Room';
export const inject = ['petCore','petWorld','petBehavior','agents','sessions','tools','workspaceRegistry','sessionController'];
declare module '@deepseek-ai/cordis' {interface Context {petRoom:Room}}
export function apply(ctx:Context) {
  const room = new Room(ctx);
  ctx.provide('petRoom',room);
  const host = ctx.petCore;
  ctx.effect(() => host.native.consoleOperations.register('room', roomConsoleOperations(room), ctx).revoke);
  const tools = ctx.tools as unknown as {register(tool:ToolDefinition,options:{when(ctx:{agent?:Agent}):boolean}):()=>void};
  for (const tool of room.tools()) {
    tools.register(tool,{when:({agent})=>!!room.toolScope(agent)});
    const declaration=roomHistoryTools.find(({name})=>name===tool.name) ?? {name:tool.name,sources:['owner']};
    ctx.effect(() => host.native.toolTable.register(declaration).revoke);
  }
  ctx.inject(['webServer' as never], scope => {
    const server = (scope as unknown as {webServer:{register(route:{kind:'prefix';path:string;resource:typeof roomAsset}):()=>void}}).webServer;
    scope.effect(() => server.register({kind:'prefix',path:roomPrefix,resource:roomAsset}));
  });
  const ports=host.native.companionPorts;
  if(ports.scopeFor(ctx,'petRoom'))
    ctx.effect(()=>ports.register('openRoomWindow',workspaceId=>room.open(workspaceId)).revoke);
  ctx.effect(() => {
    const source = host.native.sourceTable.register(room.chat.sourceAdapter());
    const television = ports.scopeFor(ctx, 'petRoom') && ports.register('watchingTelevision', id => room.watching(id));
    return async () => {
      try { await source.revoke(); }
      finally {
        try { await room.close(); }
        finally { await television?.revoke(); }
      }
    };
  });
  ctx.effect(() => host.workspace.runtime.capabilityTable.register({
    id: 'desktop.room', owner: 'desktop', contractVersion: CONTRACT_VERSION, order: 6,
    status: () => {
      const bound = host.workspace.status().state === 'ready';
      return {
        state: bound ? 'ready' : 'unavailable', reason: bound ? null : 'Bind a workspace to open the room',
        supportedOperations: bound ? ['view', 'garden', 'history'] : [],
      };
    },
  }).revoke);
}
