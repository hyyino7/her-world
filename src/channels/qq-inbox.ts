import type {UserMessage} from '@deepseek-ai/dsh-llm';
import type {ChannelContextMessage} from '#dsh-world/ecosystem/shared/context';
import type {SpeakerIdentity} from '#dsh-world/ecosystem/shared/identity';
import {digest, type CoreStore} from '../core/storage.js';

export interface QQInput {
  identity:SpeakerIdentity; text:string; at:string; record:boolean; directed:boolean; replyToSelf:boolean;
  segments?:{type:string;data?:Record<string,unknown>}[];
}
export interface QQReceived extends QQInput {
  kind:'qq-input'; version:1; key:string; storageId:string; owner:boolean;
  state:'received'|'queued'|'ignored'|'batched'|'admitted'; mode?:'v1'|'v2'; batchId?:string;
}
export interface QQSubmission {sessionId:string; message:UserMessage; context?:UserMessage}
export interface QQBatch {
  kind:'qq-batch'; version:1; key:string; storageId:string; owner:boolean; identity:SpeakerIdentity;
  state:'queued'|'unknown'|'admitted'; inputs:string[]; question:string; context:ChannelContextMessage[]; mode:'v1'|'v2';
  submission?:QQSubmission;
}
interface Options {
  store:Pick<CoreStore,'get'|'put'|'all'|'transaction'>; storageId:string;
  active():boolean; allowed(id:SpeakerIdentity):boolean; owner(id:SpeakerIdentity):boolean;
  probe(submission:QQSubmission):Promise<'admitted'|'absent'|'unknown'>;
}
const kind='channel-received';
/** Pending input is a receipt checkpoint, not another chat log or agent queue.
 * The original QQ batcher and native inbox still execute every request. */
export function createQQInbox(options:Options) {
  const {store,storageId}=options;
  let cachedCounts:{pending:number;uncertain:number}|undefined;
  const valid=(row:{storageId:string;identity:SpeakerIdentity;owner:boolean})=>options.active() && row.storageId===storageId
    && options.allowed(row.identity) && options.owner(row.identity)===row.owner;
  const keyFor=(id:SpeakerIdentity)=>digest([storageId,id.channel,id.accountId,id.conversationType,id.conversationId,id.speakerId,id.platformMessageId]);
  function save<T extends {key:string}>(row:T):T {store.put(kind,row.key,row);cachedCounts=undefined;return row;}
  function readBatch(key:string) {return store.get<QQBatch>(kind,key)!;}
  function admitted(batch:QQBatch) {
    store.transaction(()=>{
      // Native transcripts now own the content. Retain only dedupe/routing proof.
      for(const key of batch.inputs) {
        const row=store.get<QQReceived>(kind,key)!;
        store.put(kind,key,{kind:row.kind,version:1,key,storageId,owner:row.owner,identity:row.identity,state:'admitted',batchId:batch.key});
      }
      store.put(kind,batch.key,{kind:batch.kind,version:1,key:batch.key,storageId,owner:batch.owner,identity:batch.identity,state:'admitted',
        inputs:batch.inputs,sessionId:batch.submission!.sessionId,messageId:batch.submission!.message.id,
        sourceDigest:digest(batch.submission!.message.source)});
    });
    cachedCounts=undefined;
  }
  return {
    receive(input:QQInput):QQReceived|undefined {
      if(!options.active() || !options.allowed(input.identity))return;
      const key=keyFor(input.identity), previous=store.get<QQReceived>(kind,key);
      if(previous)return previous.kind==='qq-input' && valid(previous)?previous:undefined;
      return save<QQReceived>({...input,kind:'qq-input',version:1,key,storageId,owner:options.owner(input.identity),state:'received'});
    },
    ready(row:QQReceived,mode:'v1'|'v2',wake:boolean) {
      if(!valid(row))return;
      const current=store.get<QQReceived>(kind,row.key)!;
      if(current.state!=='received')return current;
      if(!wake) {
        save({kind:current.kind,version:1,key:current.key,storageId,owner:current.owner,identity:current.identity,state:'ignored'});
        return {...current,mode,state:'ignored' as const};
      }
      return save<QQReceived>({...current,mode,state:wake?'queued':'ignored'});
    },
    pendingInputs:()=>store.all<QQReceived>(kind).filter(row=>row?.kind==='qq-input' && valid(row) && ['received','queued'].includes(row.state)),
    pendingBatches:()=>store.all<QQBatch>(kind).filter(row=>row?.kind==='qq-batch' && valid(row) && row.state!=='admitted'),
    batch(items:QQReceived[],question:string,context:ChannelContextMessage[]):QQBatch|undefined {
      if(!items.length || items.some(row=>!valid(row)))return;
      return store.transaction(()=>{
        if(items.some(row=>store.get<QQReceived>(kind,row.key)?.state!=='queued'))return;
        const last=items.at(-1)!, key='qq-batch:'+digest(items.map(row=>row.key));
        const result=save<QQBatch>({kind:'qq-batch',version:1,key,storageId,owner:last.owner,identity:last.identity,state:'queued',
          inputs:items.map(row=>row.key),question,context,mode:last.mode!});
        for(const row of items)save({...row,state:'batched',batchId:key});
        return result;
      });
    },
    checkpoint(batch:QQBatch,submission:QQSubmission) {
      const current=readBatch(batch.key);
      if(!valid(current) || current.state==='admitted')throw Error('QQ original input binding is unavailable');
      if(current.submission && digest(current.submission)!==digest(submission))throw Error('QQ original submission changed');
      save({...current,state:'unknown',submission});
    },
    async reconcile(batch:QQBatch):Promise<'ready'|'admitted'|'unknown'|'blocked'> {
      const current=readBatch(batch.key);
      if(!valid(current))return 'blocked';
      if(current.state==='admitted')return 'admitted';
      if(!current.submission)return 'ready';
      let result:'admitted'|'absent'|'unknown';
      try {result=await options.probe(current.submission);} catch {result='unknown';}
      if(!valid(current))return 'blocked';
      if(result==='admitted'){admitted(current);return 'admitted';}
      save({...current,state:result==='absent'?'queued':'unknown'});
      return result==='absent'?'ready':'unknown';
    },
    current:readBatch,
    inputs:(batch:QQBatch)=>batch.inputs.map(key=>store.get<QQReceived>(kind,key)!),
    counts(){
      if(cachedCounts)return {...cachedCounts};
      const rows=store.all<QQReceived|QQBatch>(kind).filter(row=>row?.storageId===storageId && row.identity?.channel==='qq');
      cachedCounts={pending:rows.filter(row=>row.kind==='qq-input' && ['received','queued','batched'].includes(row.state)).length,
        uncertain:rows.filter(row=>row.kind==='qq-batch' && row.state==='unknown').length};
      return {...cachedCounts};
    },
  };
}

/** Read the native splice vocabulary without mutating/replaying its inbox.
 * Any removed/canceled/consumed trace without user/message remains uncertain. */
export function qqAdmission(events:readonly {type:string;data:any}[],message:UserMessage):'admitted'|'absent'|'unknown' {
  const lists:Record<string,UserMessage[]>={'next-turn':[],'next-step':[]};
  let seen=false,conflict=false;
  const matches=(word:UserMessage)=>word?.id===message.id;
  for(const event of events) {
    if(event.type==='user/message' && matches(event.data)) {
      return digest(event.data.source)===digest(message.source) && digest(event.data.content)===digest(message.content)?'admitted':'unknown';
    }
    if(event.type!=='agent/inbox/spliced')continue;
    const {target,start,removedCount,inserted}=event.data;
    if(!lists[target] || !Number.isInteger(start) || !Array.isArray(inserted)){conflict=true;continue;}
    const words=lists[target], removed=words.splice(start,removedCount??0,...inserted);
    if(inserted.some(matches)||removed.some(matches))seen=true;
  }
  return conflict||seen?'unknown':'absent';
}

interface NativeQQ {
  sessions:{get(id:string):unknown;flush(session:unknown):Promise<boolean>};
  agents:{get(id:string):{status:string;inbox:{nextStep:readonly UserMessage[];nextTurn:readonly UserMessage[]}}|undefined};
  get(name:'sessionPersistence'):{open(id:string,access:'read'):Promise<{read():Promise<{events:{type:string;data:any}[]}>;close():Promise<void>}>};
}
/** Reads only the originally captured native session, including archived logs.
 * It never resolves/creates a home merely to prove whether input was admitted. */
export async function probeQQAdmission(native:NativeQQ,submission:QQSubmission,active:()=>boolean):Promise<'admitted'|'absent'|'unknown'> {
  if(!active())return 'unknown';
  const session=native.sessions.get(submission.sessionId);
  if(session && !await native.sessions.flush(session))return 'unknown';
  if(!active())return 'unknown';
  const reader=await native.get('sessionPersistence').open(submission.sessionId,'read');
  let result:'admitted'|'absent'|'unknown';
  try {result=qqAdmission((await reader.read()).events,submission.message);} finally {await reader.close();}
  if(!active())return 'unknown';
  if(result!=='absent')return result;
  const agent=native.agents.get(submission.sessionId);
  if(agent && (agent.status!=='idle' || [...agent.inbox.nextStep,...agent.inbox.nextTurn].some(item=>item.id===submission.message.id)))return 'unknown';
  return 'absent';
}
