import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';
import type {BehaviorChange} from '../contracts/behavior.js';
import type {WorldChanged} from '../contracts/living.js';
import type {HomeBinding} from '../core/workspace.js';
import {sameHomeBinding} from '../living/index.js';

export const ROOM_ENDPOINTS = ['roomState','roomAction','roomGarden','roomPlant','roomCare','roomChat','roomTelevision','roomHistory','roomVoice'] as const;
interface Host {
  binding():HomeBinding|undefined;
  origin():string|undefined;
  request(workspaceId:string,endpoint:string,data:Record<string,unknown>,requestId:string,signal:AbortSignal):Promise<unknown>;
}

/** Presentation-only process. Owner state and every native turn stay in DSH. */
export class RoomWindow {
  private child?:ChildProcessWithoutNullStreams;
  private bound?:HomeBinding;
  private ready?:Promise<void>;
  private loaded=false;
  private lifetime?:AbortController;
  private requests=new Map<string,AbortController>();
  constructor(private host:Host) {}
  status(){return {running:!!this.child,ready:this.loaded,workspaceId:this.bound?.workspaceId??null};}
  reconcile(){
    const current=this.host.binding(),old=this.bound;
    if(old&&!sameHomeBinding(current,old))this.closeWindow();
  }
  changed(change:WorldChanged,version:Pick<BehaviorChange,'bootId'|'revision'>){
    this.reconcile();
    const bound=this.bound;
    if(!this.child || !bound || bound.workspaceId!==change.workspaceId || bound.storageId!==change.storageId ||
      bound.bootId!==change.bootId || bound.generation!==change.generation)return;
    this.send({type:'changed',change:{workspaceId:bound.workspaceId,...version,reason:change.bodyOnly?'transition':'world'}});
  }
  async open(workspaceId:string){
    this.reconcile();
    const bound=this.host.binding();
    if(!bound||bound.workspaceId!==workspaceId)throw Error('房间工作区已切换');
    const active=this.child;
    if(active){
      await this.ready;this.reconcile();
      if(this.child!==active)throw Error('房间工作区已切换');
      this.send({type:'focus'});return this.status();
    }
    const origin=this.host.origin();
    if(!origin)throw Error('DSH房间页面服务尚未就绪');
    const base=new URL(origin);
    if(!['http:','https:'].includes(base.protocol)||!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw Error('房间页面需要本机DSH服务');
    const url=new URL('/chatpet-room/index.html',base).href;
    const bin=process.env.DSH_CHATBOT_ELECTRON_PATH||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'electron/Electron.app/Contents/MacOS/Electron');
    if(!existsSync(bin))throw Error('找不到房间Electron，请检查已安装的桌面运行环境');
    const root=dirname(createRequire(import.meta.url).resolve('her-world/package.json'));
    const env:NodeJS.ProcessEnv={...process.env,CHATPET_ROOM_URL:url};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(bin,[join(root,'src/room/window-main.cjs')],{env,stdio:['pipe','pipe','pipe']});
    this.child=child;this.bound=bound;this.loaded=false;this.lifetime=new AbortController();
    child.stdin.on('error',()=>{});child.stderr.resume();
    let resolve!:()=>void,reject!:(error:Error)=>void;
    this.ready=new Promise<void>((done,fail)=>{resolve=done;reject=fail;});
    const timeout=setTimeout(()=>{reject(Error('房间窗口启动超时'));if(this.child===child)this.closeWindow();},20000);
    const lines=createInterface({input:child.stdout});
    lines.on('line',line=>{
      if(this.child!==child||line.length>4*1024*1024)return;
      let message;try{message=JSON.parse(line);}catch{return;}
      if(message.type==='ready'){clearTimeout(timeout);this.loaded=true;resolve();return;}
      if(message.type==='cancel'&&typeof message.requestId==='string'){this.requests.get(message.requestId)?.abort();return;}
      if(message.type==='request')void this.handle(child,message);
    });
    const closed=(message:string)=>{
      clearTimeout(timeout);reject(Error(message));lines.close();
      if(this.child===child){this.lifetime?.abort();this.requests.clear();this.child=undefined;this.bound=undefined;this.loaded=false;}
    };
    child.once('error',error=>closed('房间窗口启动失败：'+error.message));
    child.once('exit',()=>closed('房间窗口已关闭'));
    await this.ready;this.reconcile();
    if(this.child!==child)throw Error('房间工作区已切换');
    return this.status();
  }
  private send(message:unknown){if(this.child?.stdin.writable&&!this.child.stdin.destroyed)this.child.stdin.write(JSON.stringify(message)+'\n');}
  private async handle(child:ChildProcessWithoutNullStreams,message:{id?:unknown;endpoint?:unknown;data?:unknown;requestId?:unknown}){
    let id=message.id;
    if(!Number.isSafeInteger(id))return;
    try{
      this.reconcile();
      if(this.child!==child||!this.bound||!this.lifetime)throw Error('房间窗口已失效');
      if(typeof message.endpoint!=='string'||!ROOM_ENDPOINTS.includes(message.endpoint as typeof ROOM_ENDPOINTS[number])||
        typeof message.requestId!=='string'||!message.requestId||message.requestId.length>160||!message.data||typeof message.data!=='object'||Array.isArray(message.data))throw Error('无效的房间请求');
      if(this.requests.has(message.requestId))throw Error('房间请求仍在执行');
      const abort=new AbortController();this.requests.set(message.requestId,abort);
      const signal=AbortSignal.any([abort.signal,this.lifetime.signal]);
      let value;
      try{
        value=await this.host.request(this.bound.workspaceId,message.endpoint,message.data as Record<string,unknown>,message.requestId,signal);
        signal.throwIfAborted();
      }finally{if(this.requests.get(message.requestId)===abort)this.requests.delete(message.requestId);}
      this.reconcile();
      if(this.child===child)this.send({type:'response',id,ok:true,value});
    }catch(error){this.reconcile();if(this.child===child)this.send({type:'response',id,ok:false,error:error instanceof Error?error.message:'房间操作失败'});}
  }
  closeWindow(){
    const child=this.child;this.child=undefined;this.bound=undefined;this.loaded=false;
    this.lifetime?.abort();this.lifetime=undefined;for(const abort of this.requests.values())abort.abort();this.requests.clear();
    if(child){child.stdin.end();const timeout=setTimeout(()=>{if(child.exitCode===null)child.kill();},2000);timeout.unref();child.once('exit',()=>clearTimeout(timeout));}
  }
}
