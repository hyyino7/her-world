import type { Context } from '@deepseek-ai/cordis';
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent';
import type { SessionEvent, SessionId, UserMessage } from '@deepseek-ai/dsh-session';
import type {} from '../plugin.js';
import type {} from '@deepseek-ai/dsh-system-prompt';
import type {} from '@deepseek-ai/dsh-tools';
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm';
import type { RegistrationLease } from '../../contracts/tables.js';
import { nativeResult } from './result.js';
import type { PetCoreHost } from '../index.js';
import { registerWorldPrompt, retireLegacyPrompt, retireDynamicContext } from './prompt.js';
import { WorldRecall } from './recall.js';
import type { PetWorld } from '../../world/service.js';
import {matchesNativeScope,type NativeScope,type NativeSourceSelection} from './conversation.js';
import {installCompanionFoundation} from '../companion-foundation.js';
import {installSourceFileGuard} from '../life-review-files.js';
import {installUsageListener} from '../usage/listener.js';
import {prepareLifeHistory,applyLifeHistory,type HistoryProjection} from './history-maintenance.js';

export const name = 'chatpet-agent';
export const inject = ['petCore', 'petWorld', 'agents', 'systemPrompt', 'tools'];
interface WorkspaceView { id: string; path: string; sessionIds: readonly string[] }
interface ManagedTurn {
  turn:number;scope:NativeScope;background:boolean;lifePolicy?:NativeSourceSelection;
  persistentToolGuard?:NativeSourceSelection;
  extensionAdmissions:Set<RegistrationLease>;
}
interface NativeServices {
  get(name: 'workspaceRegistry'): { get(id: string): WorkspaceView | undefined; archivedSessionIds: readonly string[] } | undefined;
  sessionPersistence: { open(id: SessionId, access: 'read'): Promise<{read(): Promise<{events: readonly SessionEvent[]}>; close(): Promise<void>}> };
  on(name: 'domain/changed', handler: (change: {domain: string; table: string; value?: {archivedSessionIds?: readonly string[]}}) => void): unknown;
}
/** DSH owns ordinary turn execution and permissions. Core supplies scoped services. */
export function apply(ctx: Context, host: PetCoreHost = ctx.petCore, world: PetWorld = ctx.petWorld): () => Promise<void> {
  const native = ctx as unknown as NativeServices;
  const agents = new Map<string, Agent>();
  const inputs = new Map<string, string>();
  const turns = new Map<string, ManagedTurn>();
  const lifePolicies = new Map<Agent,{selection:NativeSourceSelection;release:()=>void}>();
  const continuations = new Map<string,()=>void>();
  const pending = new Set<Promise<unknown>>();
  const historyReady=new Map<Agent,NativeScope>();
  const historyPrepared=new Map<Agent,{scope:NativeScope;changes:HistoryProjection[]}>();
  let historyClosing=false;
  const recall = new WorldRecall();
  const agentFor = (id:string) => ctx.agents.get(id as SessionId) ?? agents.get(id);
  const nativeScopeFor = (id:string):NativeScope|undefined => {
    const status=host.workspace.status();
    if(status.state!=='ready' || !status.target)return;
    const agent=agentFor(id);
    const guest=host.native.isGuest(id);
    if(!guest && (!agent || world.sessionStatus(agent.session)?.state!=='ready'))return;
    return {workspaceId:status.target.id,path:status.target.path,storageId:host.workspace.storageId(),guest};
  };
  host.native.resolveNativeScope=nativeScopeFor;
  const stopUsage = installUsageListener(ctx, host, agentFor);
  const sameNativeScope=(id:string,expected:NativeScope)=>matchesNativeScope(nativeScopeFor(id),expected);
  const currentExtensions=(saved:ManagedTurn)=>[...saved.extensionAdmissions].every(lease=>lease.isCurrent());
  const currentTurn=(id:string,saved:ManagedTurn)=>sameNativeScope(id,saved.scope)
    && currentExtensions(saved)
    && (!saved.background||!saved.lifePolicy||saved.lifePolicy.lease.isCurrent())
    && (!saved.persistentToolGuard||saved.persistentToolGuard.lease.isCurrent());
  const clearContinuation=(id:string)=>{
    const clear=continuations.get(id);continuations.delete(id);clear?.();
  };
  const releaseLifePolicy=(agent:Agent)=>{
    const policy=lifePolicies.get(agent);lifePolicies.delete(agent);policy?.release();
  };
  const selectSource=(agent:Agent,message:UserMessage)=>{
    const decision=host.native.sourceTable.admit({sessionId:agent.id,message});
    switch(decision.kind) {
      case 'accepted': return decision;
      case 'unclaimed': ctx.logger('chatpet-agent').debug?.('Native source denied',decision.kind);return;
      case 'rejected': ctx.logger('chatpet-agent').debug?.('Native source denied',decision.kind,decision.reason);return;
      case 'failed': ctx.logger('chatpet-agent').warn('Native source denied',decision.kind,decision.error);return;
    }
  };
  const constrainLife=(agent:Agent,selection:NativeSourceSelection)=>{
    // New inbox facts do not replace capabilities already admitted for the
    // running native turn. Owner input lifts its mask before the next assembly.
    if(turns.get(agent.id)?.lifePolicy&&agent.status==='running')return;
    const saved=lifePolicies.get(agent)?.selection;
    if(saved?.lease.generation===selection.lease.generation&&saved.context.policyKey===selection.context.policyKey)return;
    releaseLifePolicy(agent);
    const release=selection.branch.toolPolicy?.install?.(agent);
    lifePolicies.set(agent,{selection,release:()=>release?.()});
  };
  // A denied interactive envelope rejects the step even without a registered branch.
  const interactiveEnvelope=(message:UserMessage)=>message.source.kind==='user' || message.source.kind==='dsh-world-reply-nudge';
  const selectStepSources=(agent:Agent,messages:readonly UserMessage[])=>{
    const interactive=new Map<UserMessage,NativeSourceSelection>();
    for(const message of messages) {
      if(!interactiveEnvelope(message))continue;
      const selection=selectSource(agent,message);
      if(!selection)return;
      interactive.set(message,selection);
    }
    return messages.flatMap(message=>{
      const selection=interactive.get(message) ?? selectSource(agent,message);
      return selection ? [{message,selection}] : [];
    });
  };
  const trackExtensions=(saved:ManagedTurn,accepted:readonly {selection:NativeSourceSelection}[])=>{
    for(const {selection} of accepted)if(selection.toolSourceLease)saved.extensionAdmissions.add(selection.lease);
    return currentExtensions(saved);
  };
  // DSH resolves schemas before pre-step. Install the native mask while its
  // trusted inbox input is queued, and recheck at step admission below.
  const stopSourceInbox=ctx.on('agent/inbox/inserted',({agent,message})=>{
    if(!nativeScopeFor(agent.id))return;
    const selection=selectSource(agent,message);
    if(!selection)return;
    if(selection.branch.turnKind==='foreground') {
      clearContinuation(agent.id);releaseLifePolicy(agent);
    } else if(selection.branch.toolPolicy?.install&&turns.get(agent.id)?.background!==false) {
      constrainLife(agent,selection);
    }
  });
  const stopReviewFiles=installSourceFileGuard(ctx,agent=>{
    const turn=turns.get(agent.id),policy=turn?.lifePolicy;
    if(!turn?.background||!policy?.branch.fileAccess)return;
    return {lease:policy.lease,key:()=>policy.context.fileAccessKey?.(),check:policy.branch.fileAccess};
  });
  const watch=(work:Promise<unknown>)=>{
    pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
    return work;
  };
  const drainHistory=(agent:Agent)=>{
    const scope=historyReady.get(agent);
    if(historyClosing||!scope||agent.status!=='idle')return;
    historyReady.delete(agent);
    if(!sameNativeScope(agent.id,scope)||scope.guest)return;
    void watch(prepareLifeHistory(agent,()=>!historyClosing&&sameNativeScope(agent.id,scope),
      message=>host.native.sourceTable.classify(message),host.native.toolTable).then(changes=>{
      if(changes.length&&!historyClosing&&sameNativeScope(agent.id,scope))historyPrepared.set(agent,{scope,changes});
    }).catch(error=>{
      ctx.logger('chatpet-context').warn('History maintenance pending; original events retained',error);
    }));
  };
  const stopHistoryStatus=ctx.on('agent/status',({agent,status})=>{
    if(status==='idle')queueMicrotask(()=>drainHistory(agent));
  },{global:true});
  let archiveTail: Promise<void> = Promise.resolve();
  function syncArchives(publishedIds?: readonly string[]): Promise<void> {
    const memory=host.native.memoryFor('');if(!memory)return Promise.resolve();
    const run=archiveTail.then(async()=>{
      const status=host.workspace.status(),target=status.state==='ready'?status.target:undefined;
      const registry=native.get('workspaceRegistry'),view=target && registry?.get(target.id);
      if(!target || !view || view.path!==target.path)return;
      for(const id of publishedIds ?? registry?.archivedSessionIds ?? []) {
        if(!view.sessionIds.includes(id) || ctx.agents.get(id as SessionId)?.status==='running' || !memory.needsArchive(id,target.id,target.path))continue;
        const live=ctx.sessions.get(id as SessionId);
        if(live && !await ctx.sessions.flush(live))throw Error('Cannot archive an unflushed native session');
        const reader=await native.sessionPersistence.open(id as SessionId,'read');
        try {await memory.archive(id,target.id,target.path,(await reader.read()).events);}finally{await reader.close();}
      }
    });
    archiveTail=run.catch(error=>ctx.logger('chatpet-memory').warn('Native archive pending; will retry',error));
    return run;
  }
  native.on('domain/changed',change=>{
    if(change.domain==='workspace' && change.table==='' && change.value?.archivedSessionIds?.length)
      void syncArchives(change.value.archivedSessionIds).catch(()=>{});
  });
  const profiles=new WeakMap<Agent,{turn:number;text:string}>();
  const disposePrompt=registerWorldPrompt(ctx,'chatpet.profile',10,agent=>{
    const scope=nativeScopeFor(agent.id);if(!scope)return '';
    const events=agent.session.snapshotEvents();
    const turn=[...events].reverse().find(event=>event.type==='turn/start')?.data.turn ?? -1;
    const saved=profiles.get(agent);if(saved?.turn===turn)return saved.text;
    const {identity,user}=host.native.context();const text=[identity,scope.guest?'':user].filter(Boolean).join('\n\n');
    profiles.set(agent,{turn,text});return text;
  });
  const disposeFoundation=installCompanionFoundation(ctx,host,world);
  const scanned=new WeakMap<Agent,boolean>();
  const onRequest = ({agent,turn,step}: {agent:Agent;turn:number;step:number},next:()=>Promise<LlmCallConfig>)=>{
    const bound=!!nativeScopeFor(agent.id);
    if(scanned.get(agent)!==bound){retireLegacyPrompt(agent.session,turn,step,bound);scanned.set(agent,bound);}
    const prepared=historyPrepared.get(agent);historyPrepared.delete(agent);
    if(prepared&&sameNativeScope(agent.id,prepared.scope)) {
      const meter=(ctx as unknown as {get(name:string):unknown}).get('tokenMeter') as {estimateMessage(message:import('@deepseek-ai/dsh-llm').Message):number}|undefined;
      if(meter)applyLifeHistory(agent,prepared.changes,meter);
    }
    retireDynamicContext(agent,turn,step);
    recall.request(agent.session,turn,step,bound && !!host.native.memoryFor(agent.id));
    return next();
  };
  ctx.on('agent/request',onRequest);
  const tools=ctx.tools;
  for(const tool of host.native.tools()){
    tools.register(tool,{
      when:context=>{
        const scope=context.agent && nativeScopeFor(context.agent.id);
        return Boolean(scope && !scope.guest && (!tool.name.startsWith('pet_memory_') || host.native.memoryFor(context.agent!.id)));
      },
    });
    ctx.effect(() => host.native.toolTable.register({name:tool.name,sources:tool.sources}).revoke);
  }
  // Background allowances stay on autonomous input only. DSH enforces native
  // permissions/cancellation for ordinary user work, without a second counter.
  ctx.tools.guard(exec=>{
    if(!exec.agent || !turns.has(exec.agent.id))return;
    const saved=turns.get(exec.agent.id)!;
    if(!sameNativeScope(exec.agent.id,saved.scope))return '会话已离开原绑定工作区';
    if(!currentExtensions(saved))return '自主轮次的来源登记已撤销';
    for(const policy of [saved.persistentToolGuard,saved.background && saved.lifePolicy]) {
      if(!policy)continue;
      const {branch,lease}=policy;
      if(!lease.isCurrent())return '自主轮次的来源登记已撤销';
      if(branch.toolPolicy?.allows?.(exec)===false)return branch.toolPolicy.denial;
    }
    if(saved.background)try{host.native.guardTool(exec.agent.id);}catch{return '自主轮次已结束或超过限额';}
  });
  const onStep=async(payload:{agent:Agent;turn:number;step:number;messages:UserMessage[];signal:AbortSignal},next:()=>Promise<PreStepDecision>):Promise<PreStepDecision>=>{
    const scope=nativeScopeFor(payload.agent.id);
    if(!scope) {
      if(turns.has(payload.agent.id))return {kind:'reject'};
      return next();
    }
    agents.set(payload.agent.id,payload.agent);
    let saved=turns.get(payload.agent.id);
    const first=!saved || saved.turn!==payload.turn;
    let stepInputs: ReturnType<typeof selectStepSources>;
    if(first) {
      const accepted=selectStepSources(payload.agent,payload.messages);
      if(!accepted?.length)return {kind:'reject'};
      stepInputs=accepted;
      const selections=accepted.map(({selection})=>selection);
      const foreground=selections.some(selection=>selection.branch.turnKind==='foreground');
      saved={turn:payload.turn,scope,background:!foreground,extensionAdmissions:new Set(),
        persistentToolGuard:selections.find(selection=>selection.context.guardDuringTakeover)};
      if(!trackExtensions(saved,accepted))return {kind:'reject'};
      turns.set(payload.agent.id,saved);
      if(foreground){clearContinuation(payload.agent.id);releaseLifePolicy(payload.agent);}else {
        for(const selection of selections)if(!selection.context.guardDuringTakeover)constrainLife(payload.agent,selection);
        saved.lifePolicy=lifePolicies.get(payload.agent)?.selection;
      }
      inputs.set(payload.agent.id,accepted[0].message.id);
      if(!scope.guest) {
        if(!await host.native.sourceTable.beforeFirstStep(()=>currentTurn(payload.agent.id,saved!)))return {kind:'reject'};
        await ctx.get('petTranscripts')?.restore();
        if(!currentTurn(payload.agent.id,saved))return {kind:'reject'};
      }
      host.native.observeInputs(payload.agent.id,payload.turn,accepted.map(({message})=>message),scope);
    }
    if(!sameNativeScope(payload.agent.id,saved!.scope)||!currentExtensions(saved!))return {kind:'reject'};
    if(!first) {
      const admitted=selectStepSources(payload.agent,payload.messages);
      if(!admitted||!trackExtensions(saved!,admitted))return {kind:'reject'};
      stepInputs=admitted;
      if(admitted.length)host.native.observeInputs(payload.agent.id,payload.turn,admitted.map(({message})=>message),saved!.scope);
      if(saved!.background && admitted.some(({selection})=>selection.branch.turnKind==='foreground')) {
        // A real owner input takes over this native turn; autonomous limits do
        // not become a hidden cap on the owner's subsequent tool work.
        host.native.finish(payload.agent.id);
        saved!.background=false;
        clearContinuation(payload.agent.id);
        releaseLifePolicy(payload.agent);
      }
    }
    if(saved!.background) {
      if(!currentTurn(payload.agent.id,saved!))return {kind:'reject'};
      await host.native.begin(payload.agent.id,payload.turn,payload.messages,payload.signal,{
        cancel:()=>payload.agent.cancel({kind:'user'}),
      });
      if(!currentTurn(payload.agent.id,saved!))return {kind:'reject'};
    }
    let text='';
    let checkMemory: (()=>void)|undefined;
    if(first) {
      const memory=host.native.memoryFor(payload.agent.id);
      if(memory)try {
        const binding=await memory.prepare(payload.agent.id,saved!.scope);
        if(!currentTurn(payload.agent.id,saved!))return {kind:'reject'};
        await syncArchives();
        if(!currentTurn(payload.agent.id,saved!))return {kind:'reject'};
        host.native.useTranscript(payload.agent.id,[...payload.agent.session.surface.nodes],payload.agent.session.snapshotEvents());
        const query=payload.messages.flatMap(message=>message.content.flatMap(part=>part.type==='text'?[part.text]:[])).join('\n');
        await memory.recall(payload.agent.id,query,true,binding);
        if(!currentTurn(payload.agent.id,saved!))return {kind:'reject'};
        text=memory.context(payload.agent.id);
        checkMemory=()=>memory.assertBinding(binding);
      }catch(error){memory.clear(payload.agent.id);memory.unavailable(error);ctx.logger('chatpet-memory').warn('Memory unavailable; native chat continues',error);}
      else host.native.memory?.clear(payload.agent.id);
    }
    if(payload.signal.aborted)return {kind:'reject'};
    const finishEntry=host.native.usageEvidence.beginStep(payload.agent.id,stepInputs ?? [],payload.signal);
    let entered=false;
    try {
      let decision=await next();
      if(decision.kind!=='enter')return decision;
      if(payload.signal.aborted || !currentTurn(payload.agent.id,saved!))return {kind:'reject'};
      if(first) {
        if(checkMemory)try{checkMemory();}catch(error){
          text='';host.native.memory?.clear(payload.agent.id);host.native.memory?.unavailable(error);
        }
        // An empty replacement explicitly retires the prior recall after toggle or failure.
        recall.refresh(payload.agent.session,saved!.scope.storageId,true);
        const message=recall.prepare(payload.agent.session,text);
        decision={...decision,startsRequestSeries:true,messages:message?[message,...decision.messages]:decision.messages};
      }
      entered=true;
      return decision;
    } finally { finishEntry?.(entered); }
  };
  // Basic compaction uses a normal listener and may already be mounted by the preset.
  ctx.on('agent/pre-step',onStep,{prepend:true});
  host.native.attachGuest=scope=>{disposePrompt.attach(scope);scope.on('agent/pre-step',onStep,{prepend:true});scope.on('agent/request',onRequest);};
  ctx.on('session/event',(session,event)=>{
    if(String(event.type)==='compaction/end' && !(event.data as {error?:unknown}).error)recall.compacted(session);
    if(event.type!=='turn/end')return;
    host.native.usageEvidence.end(session.id);
    const saved=turns.get(session.id);if(!saved)return;
    const result=nativeResult(session.snapshotEvents(),inputs.get(session.id) ?? '');
    clearContinuation(session.id);
    const selection=saved.lifePolicy;
    if(saved.background&&selection?.lease.isCurrent()&&result.state!=='completed') {
      const clear=selection.context.continueAfterInterrupt?.(saved.scope);
      if(clear)continuations.set(session.id,clear);
    }
    if(saved.background)host.native.finish(session.id);
    const agent=agents.get(session.id);if(agent)releaseLifePolicy(agent);
    const done=host.native.finishTurn(session.id,saved.turn,result).then(()=>{
      if(agent&&saved.background&&selection?.lease.isCurrent()&&selection.branch.historyProjection?.participates&&result.state==='completed'&&!historyClosing) {
        historyReady.set(agent,saved.scope);queueMicrotask(()=>drainHistory(agent));
      }
    }).catch(error=>{
      host.native.memory?.unavailable(error);ctx.logger('chatpet-memory').warn('Conversation retained; Memory write pending',error);
    }).finally(()=>{if(turns.get(session.id)===saved){turns.delete(session.id);inputs.delete(session.id);}if(native.get('workspaceRegistry')?.archivedSessionIds?.includes(session.id))void syncArchives([session.id]).catch(()=>{});});
    return watch(done);
  },{global:true});
  ctx.on('agent/disposed',({agent})=>{
    host.native.usageEvidence.end(agent.id);
    void host.native.end(agent.id).catch(()=>{});
    host.native.memory?.clear(agent.id);
    agents.delete(agent.id);turns.delete(agent.id);inputs.delete(agent.id);
    clearContinuation(agent.id);
    historyReady.delete(agent);historyPrepared.delete(agent);
    releaseLifePolicy(agent);
  },{global:true});
  let stopped:Promise<void>|undefined;
  const stop=()=>stopped ??= (async()=>{
    stopUsage();
    historyClosing=true;historyReady.clear();historyPrepared.clear();stopHistoryStatus();
    await Promise.allSettled([...pending]);await archiveTail;
    disposePrompt();disposeFoundation();
    stopSourceInbox();stopReviewFiles();for(const agent of [...lifePolicies.keys()])releaseLifePolicy(agent);
    if(host.native.resolveNativeScope===nativeScopeFor){host.native.resolveNativeScope=undefined;host.native.attachGuest=undefined;}
    agents.clear();turns.clear();inputs.clear();for(const id of continuations.keys())clearContinuation(id);
  })();
  ctx.effect(()=>stop);return stop;
}
