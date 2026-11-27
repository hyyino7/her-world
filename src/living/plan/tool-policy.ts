import type {Context} from '@deepseek-ai/cordis';
import type {UserMessage} from '@deepseek-ai/dsh-session';
import type {SourceAdapter,SourceBranch} from '../../contracts/tables.js';
import type {PetCoreHost} from '../../core/index.js';
import {companionWritingScope} from '../../core/companion-foundation.js';
import {assertLifeReviewFile,lifeReviewFileAccessKey,type LifeReviewFileAccess} from './review-files.js';
import {matchesNativeScope,type NativeScope,type NativeSourceContext} from '../../core/native/conversation.js';
import type {CompanionToolTable} from '../../core/tables/tools.js';
import {upstreamAlbumToolNames} from '../../core/album-tools.js';

const reviewFileTools = new Set(['read','write']);
const upstreamLifeTools = ['plan_next','check_alarm','cancel_alarm','reach_out',...upstreamAlbumToolNames];

export function registerLifeToolPolicy(ctx:Context,table:CompanionToolTable):void {
  // DSH owns the local alarm, home and preset registrations.
  for(const name of upstreamLifeTools)ctx.effect(() => table.register({name,sources:['life','review']}).revoke);
  for(const name of reviewFileTools)ctx.effect(() => table.register({name,sources:['review']}).revoke);
}

/** Capability names, never phrase matching or command-string filtering. */
export function lifeToolAllowed(table:CompanionToolTable,name:string,review=false):boolean {
  return table.get(name)?.sources.includes(review?'review':'life') ?? false;
}

/** File tools belong to the native preset, not the global registry. Life only
 * registers its own domain tools locally: never pass those local names to
 * restrict(). Inspect the host service's views, keeping its scope identity. */
export function lifeInheritedToolNames<S>(
  tools:{definitions(scope?:S):readonly {name:string}[]}, agent:S, review=false,
):string[] {
  return [...new Set([
    ...tools.definitions().map(tool=>tool.name),
    ...(review?tools.definitions(agent).filter(tool=>reviewFileTools.has(tool.name)).map(tool=>tool.name):[]),
  ])];
}

/** Native scoped restrictions have exact disposers; ordinary turns are restored. */
export function restrictLifeTools(
  table:CompanionToolTable,scoped:{restrict(filter:{allow:readonly string[]}):()=>void}, inheritedNames:readonly string[], review=false,
):()=>void {
  return scoped.restrict({allow:inheritedNames.filter(name=>lifeToolAllowed(table,name,review))});
}
interface LifeSourceContext extends NativeSourceContext {
  sessionId:string;
  hasFacts:boolean;
  fileAccess?():LifeReviewFileAccess;
}

export function createLifeSourceAdapter(ctx:Context,host:PetCoreHost,accepts:(sessionId:string,message:UserMessage)=>boolean):SourceAdapter<LifeSourceContext> {
  const interrupted=new Map<string,{scope:NativeScope;day:string}>();
  const classify=(message:UserMessage)=>{
    const {source}=message;
    if(source.kind==='dsh-world-life')return 'purpose' in source&&source.purpose==='review'?'review':'life';
  };
  const branch=(kind:NonNullable<ReturnType<typeof classify>>):SourceBranch<LifeSourceContext>=>{
    const review=kind==='review';
    return {
      turnKind:'background',toolSource:kind,usageEntry:kind,
      toolPolicy:{
        install:agent=>restrictLifeTools(host.native.toolTable,agent.ctx.tools,lifeInheritedToolNames(ctx.tools,agent,review),review),
        allows:exec=>lifeToolAllowed(host.native.toolTable,exec.name,review),
        denial:review
          ?'自主回顾不能使用 bash、edit 或编程工具；请改用已开放的 read 读取记录目录/素材、write 写入指定日期日记和自述。此次拒绝不表示 read/write 无权限。'
          :'自主生活仅使用当前生活能力；普通主人对话仍沿用原生工具权限',
      },
      memoryObservation:{
        input:({sessionId,hasFacts})=>({origin:'virtual_action',actorId:hasFacts?'system:companion-world':host.workspace.runtime.config.companionId,
          sourceKind:'system',attribution:{channel:'dsh',sessionId}}),
        reply:({sessionId})=>({channel:'dsh',sessionId}),
      },
      emotionUpdate:{footer:true,tool:true},
      historyProjection:{participates:!review,protectsTurn:review},
      policyRow:{
        row:review?4:3,branch:kind,trustedActor:'伙伴或生活事实系统',selectionKey:'已绑定工作区的共享 home',
        historyScope:'共享 home',preset:'Life 的 agentPreset，由共享 home 使用',
        lifecycle:review?'后台轮次，未完成的回顾可续接，主人输入接管':'后台轮次，主人输入接管',
        bindingCheck:'原生工作区绑定与来源登记代次',
        tools:{description:review?'生活能力及受回顾路径约束的 read、write':'生活能力',behaviorIds:review?['B07','M2A-28']:['B01','M2A-12','M2A-13']},
        memoryObservation:{description:'观察生活输入、事实和完成的回复',behaviorIds:['M2A-22']},
        emotionUpdate:{
          footer:{description:'允许回复 footer 更新共享情绪',behaviorIds:[review?'M2A-16':'M2A-12']},
          tool:{description:'允许 pet_emotion_update 更新共享情绪',behaviorIds:review?[]:['M2A-12']},
        },
      },
    };
  };
  return {
    id:'life',order:0,sources:['dsh-world-life'],classify,
    branches:{life:branch('life'),review:{
      ...branch('review'),
      fileAccess:(tool,path,context)=>assertLifeReviewFile(host,context.fileAccess!(),tool,path),
    }},
    admit:({sessionId,message})=>{
      const saved=classify(message);
      if(!saved)return {kind:'unclaimed'};
      if(!accepts(sessionId,message))return {kind:'rejected',reason:'Life requires its running home and a valid fact batch'};
      const pending=interrupted.get(sessionId);
      const scope=pending||saved==='review'?host.native.nativeScopeFor(sessionId):undefined;
      const resumed=pending&&matchesNativeScope(scope,pending.scope)?pending:undefined;
      if(pending&&!resumed)interrupted.delete(sessionId);
      const review=saved==='review'||!!resumed;
      const source=message.source;
      const reviewDay=saved==='review'&&'reviewDay' in source&&typeof source.reviewDay==='string'?source.reviewDay:resumed?.day;
      const fileAccess=review?():LifeReviewFileAccess=>{
        if(!scope||!matchesNativeScope(host.native.nativeScopeFor(sessionId),scope))throw Error('自主回顾的文件范围暂时无法核对');
        return {workspaceId:scope.workspaceId,root:scope.path,storageId:scope.storageId,sessionId,guest:scope.guest,
          reviewDay,writing:companionWritingScope(ctx,host)};
      }:undefined;
      const context:LifeSourceContext={sessionId,policyKey:JSON.stringify([review,reviewDay]),
        hasFacts:'facts' in source&&Array.isArray(source.facts)&&source.facts.length>0,
        fileAccess,fileAccessKey:fileAccess&&(()=>lifeReviewFileAccessKey(fileAccess())),
        continueAfterInterrupt:reviewDay?scope=>{
          const continuation={scope,day:reviewDay};
          interrupted.set(sessionId,continuation);
          return ()=>{if(interrupted.get(sessionId)===continuation)interrupted.delete(sessionId);};
        }:undefined,
      };
      return {kind:'accepted',branch:review?'review':'life',context};
    },
  };
}
