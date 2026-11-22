import {animationAssets,animationSlots,animationStickers,type AnimationSlot} from './animation-map.js';

/** Read-only media selection. Accepted domain work owns effects and completion. */
export interface ActivityClip {
  roomClip:string;desktopClip:string;mode:'loop'|'once'|'static';durationMs:number;
  mirror?:boolean;
}
export interface ActivityAnimationContext {
  slotId?:string;foodSlot?:string;itemId?:string;startedAt?:number;
  presentationFreeze?:{onsetAt:number;pausedMs:number};
  interaction?:{id:string;action:string;at:number;until:number;text?:string;summary?:string;actor?:{kind?:string}|string};
}
export interface ActivityPlayback {
  version:1;key:string;activityId:string|null;phase:string;kind:string;startedAt:number;
  /** Accepted pause time for this exact cue; startedAt retains its real onset. */
  pausedMs?:number;
  segments:ActivityClip[];gap:boolean;notice?:string;toolOwner:'clip'|'scene'|'none';
  slotId?:string;match?:string;uncovered?:string[];
  feedback?:{id:string;at:number;until:number;text?:string;sticker?:string;slotId?:string;gap?:boolean};
}
type SlotAdmission = (slot:unknown, context:{kind:ActivityPlayback['kind']; foodSlot?:string}) => boolean;
const feelings=new Set(['happy','calm','sweet','heartache','worry','sad','jealous','anger','boredom']);
// Single-clip movement rows identify the registered gaits. Combined rows may
// describe several real phases, but cannot manufacture those phase changes.
const movementClips=new Set(Object.values(animationSlots).filter(slot=>slot.id.startsWith('move.')&&slot.clips.length===1).flatMap(slot=>slot.clips));

function media(id:string,mode:ActivityClip['mode']='loop',mirror=false):ActivityClip {
  const asset=animationAssets[id]??animationAssets.idle;
  return {roomClip:asset.roomClip,desktopClip:asset.desktopClip,durationMs:asset.durationMs,mode,...(mirror?{mirror:true}:{})};
}
function currentKind(home:any):string {
  const her=home.her,activity=home.behavior??{},planned=her.kind==='planned'?activity.presentationKind:undefined;
  return her.asleep?'sleep':her.walking||her.kind==='walk'?'walk':planned==='read'
    ?activity.readingState==='offered'?'read':'reading-wait':planned||(her.kind==='read'?'reading-wait':her.kind||'idle');
}
function singleFeeling(home:any):string|undefined {
  const values=Array.isArray(home.emotion?.feelings)?home.emotion.feelings:[];
  const present=[...new Set(values.filter((value:unknown)=>typeof value==='string'))];
  return present.length===1&&feelings.has(present[0] as string)?present[0] as string:undefined;
}
function onset(value:unknown):number {return typeof value==='number'&&Number.isFinite(value)&&value>0?value:0;}
function primarySlot(kind:string,home:any,context:ActivityAnimationContext):string|undefined {
  if(kind==='walk')return home.her.runStyle==='hurry'?'move.hurry':home.her.runStyle==='happy'?'move.happy':'move.normal';
  if(kind==='eat')return context.foodSlot||(!context.itemId?'food.rice':undefined);
  if(kind==='sleep')return 'sleep.full';
  if(kind==='wake')return 'sleep.full';
  if(kind==='read')return 'read.main';
  if(kind==='reading-wait')return 'rest.calm';
  if(kind==='drink')return 'drink.cup';
  if(['rest','idle','free'].includes(kind))return 'rest.'+(singleFeeling(home)??'calm');
  const normal:Record<string,string>={nap:'sleep.nap',desk:'desk.code',tv:'leisure.tv',phone:'leisure.phone',balcony:'leisure.balcony',bath:'hygiene.bath',toilet:'hygiene.toilet',laundry:'hygiene.laundry',garden_visit:'garden.visit',garden_sell:'trade.sell',garden_buySeed:'trade.buy-seed',garden_buyCompost:'trade.buy-compost'};
  if(normal[kind])return normal[kind];
  if(kind.startsWith('garden_'))return 'garden.'+kind.slice(7);
}
function liveInteraction(home:any,context:ActivityAnimationContext) {
  const value=context.interaction,now=Number(home.now??Date.now());
  if(!value||typeof value.id!=='string'||!onset(value.at)||!onset(value.until)||value.at>now||value.until<=now)return;
  const actor=typeof value.actor==='string'?value.actor:value.actor?.kind;
  if(actor&&actor!=='owner')return;
  return value;
}
function touchSlot(home:any,kind:string):string {
  if(kind==='sleep')return 'touch.asleep';
  if(kind==='react_scare')return 'touch.poke';
  const feeling=singleFeeling(home);
  if(feeling)return 'touch.'+feeling;
  return kind==='react_happy'?'touch.happy':kind==='react_shy'?'touch.sweet':kind==='react_pout'?'touch.anger':'touch.notice';
}
function clipsFor(slot:AnimationSlot|undefined,kind:string,foodSlot:string|undefined) {
  let ids=slot?.clips.slice()??[],gap=!slot||slot.match==='blank',match=slot?.match??'blank';
  const uncovered=slot?.uncovered.slice()??[];
  if(slot?.selectedFoodPosition!==undefined) {
    const food=foodSlot?animationSlots[foodSlot]:undefined;
    if(food?.clips.length===1)ids[slot.selectedFoodPosition]=food.clips[0];
    else {ids=[];gap=true;uncovered.push('Actual food has no dedicated portrayal');}
  }
  // The movie phases are subordinate to actual physical phases. Do not wait in
  // an idle preparation after drinking/eating/work has already begun, or wake
  // because the sleep-loop media's encoded duration elapsed.
  if(kind==='walk')ids=[...new Set(ids.filter(id=>movementClips.has(id)))];
  if(kind==='sleep')ids=ids.filter(id=>id!=='sleep-end');
  if(kind==='wake')ids=slot?.id==='sleep.stretch'?['sleep-end','stretch']:['sleep-end'];
  if(kind==='drink')ids=ids.filter(id=>id==='life-drink');
  if(kind==='eat')ids=ids.filter(id=>id!=='idle'&&id!=='期待开饭'&&id!=='是啊，吃什么');
  if(kind.startsWith('garden_'))ids=ids.filter(id=>id!=='walk'&&(kind==='garden_visit'||id!=='idle'));
  if(slot?.id.startsWith('touch.') && kind!=='sleep') {
    const specific=ids.filter(id=>id!=='look'&&id!=='idle');
    ids=specific.length?specific:ids.length?[ids[0]]:[];
  }
  const composed=ids.find(id=>animationAssets[id]?.composition);
  if(composed) {
    gap=true;match='proxy';uncovered.push('Registered baifan component needs a shared character-prop layer');
    ids=composed==='吃饭·碗饭'?['吃白饭']:composed==='期待开饭'?['look']:[];
  }
  if(slot?.match==='proxy'||uncovered.length)gap=true;
  return {ids,gap,match,uncovered};
}

export function resolveActivityPlayback(home:any,animationSlotAllowed:SlotAdmission):ActivityPlayback|undefined {
  if(!home?.her)return;
  const her=home.her,activity=home.behavior??{},context:ActivityAnimationContext=activity.animationContext??{};
  const kind=currentKind(home),interaction=liveInteraction(home,context);
  let selected=primarySlot(kind,home,context),rejected=false;
  const moving=kind==='walk',requested=context.slotId;
  // A future activity's portrayal may accompany its accepted route, but cannot
  // replace the route. Food identity is catalog-owned, never an activity phrase.
  if(requested) {
    let compatible=animationSlotAllowed(requested,{kind,foodSlot:context.foodSlot});
    if(compatible&&['rest','idle','free'].includes(kind)&&requested.startsWith('rest.')&&feelings.has(requested.slice(5)))
      compatible=requested===selected;
    if(compatible&&moving&&['move.happy','move.hurry'].includes(requested)&&['happy','hurry'].includes(her.runStyle))
      compatible=requested==='move.'+her.runStyle;
    if(compatible)selected=requested;
    else if(!moving||requested.startsWith('move.'))rejected=true;
  }
  const touch=interaction&&['pet','poke'].includes(interaction.action);
  const response=kind.startsWith('react_')||kind==='idle_look';
  if(touch&&response)selected=interaction.action==='poke'?'touch.poke':touchSlot(home,kind);
  let startedAt=onset(activity.startedAt);
  if(['rest','idle','free'].includes(kind))startedAt=Math.max(onset(context.startedAt),onset(home.emotion?.updatedAt),startedAt);
  if(touch&&response)startedAt=interaction.at;
  const freeze=context.presentationFreeze,pausedMs=['rest','idle','free'].includes(kind)&&startedAt>0
    && freeze?.onsetAt===startedAt&&Number.isSafeInteger(freeze.pausedMs)&&freeze.pausedMs>0?freeze.pausedMs:0;
  const slot=selected?animationSlots[selected]:undefined;
  let built=clipsFor(slot,kind,context.foodSlot),segments:ActivityClip[]=[];
  if(kind==='reading-wait')built={ids:['idle'],gap:false,match:'direct',uncovered:[]};
  if(kind==='sleep'&&!startedAt)built.ids=built.ids.filter(id=>id!=='sleep-start');
  if(!selected) {
    const direct:Record<string,string>={play:'dance',idle_look:'look',react_happy:'点击回应-开心跃动',react_pout:'点击回应-傲娇生气',react_shy:'点击回应-害羞惊讶',react_scare:'被吓一跳'};
    if(direct[kind])built={ids:[direct[kind]],gap:kind==='play',match:kind==='play'?'proxy':'direct',uncovered:kind==='play'?['The actual generic play has no selected specific game portrayal']:[]};
  }
  const once=kind==='wake'||response;
  segments=built.ids.map((id,index)=>media(id,index<built.ids.length-1||once?'once':'loop',Boolean(slot?.mirror)));
  if(!segments.length)segments=[media('idle','static')];
  if(rejected)built.uncovered.push('Requested slot is incompatible with the actual activity');
  const gap=built.gap||rejected;
  const notice=kind==='reading-wait'?'等待取得真实阅读内容':rejected?'动画配对不兼容，已保留实际活动':gap
    ?`${her.activity||kind} · ${built.match==='proxy'?'使用近似动画，专属细节待补齐':'缺少对应活动动画'}`:undefined;
  const result:ActivityPlayback={version:1,key:JSON.stringify([activity.bootId??'',activity.activityId??null,activity.phase??'',kind,startedAt,pausedMs,her.spot??'',her.pose??'',selected??'',segments.map(part=>[part.roomClip,part.mode,part.mirror??false])]),
    activityId:activity.activityId??null,phase:activity.phase??'idle',kind,startedAt,segments,gap,slotId:selected,match:built.match,uncovered:built.uncovered,
    ...(pausedMs?{pausedMs}:{}),
    ...(notice?{notice}:{}),toolOwner:kind.startsWith('garden_')&&kind!=='garden_visit'?'clip':'none'};
  if(interaction) {
    const feedbackSlot=touch?animationSlots[interaction.action==='poke'?'touch.poke':touchSlot(home,kind)]:undefined;
    const sticker=feedbackSlot?.stickers.find(label=>Boolean(animationStickers[label]));
    result.feedback={id:interaction.id,at:interaction.at,until:interaction.until,
      ...(interaction.text||interaction.summary?{text:interaction.text||interaction.summary}:{}),
      ...(sticker?{sticker}:{}),...(feedbackSlot?{slotId:feedbackSlot.id,gap:feedbackSlot.match==='proxy'||feedbackSlot.uncovered.length>0}:{})};
  }
  return result;
}

/** Playback is attached by the carriers to their existing home response. */
export function withHomePlayback(home:any,animationSlotAllowed:SlotAdmission) {
  if(!home?.her || home.playback)return home;
  return {...home,playback:resolveActivityPlayback(home,animationSlotAllowed)};
}

/** Self-contained for both generated carriers: no resolver/table is inlined.
 * Unknown starts skip historical one-shots; loops share a cosmetic clock. */
export function sampleActivityPlayback(playback:ActivityPlayback,now=Date.now()) {
  if(!playback||playback.version!==1||!Array.isArray(playback.segments)||!playback.segments.length)return;
  const pausedMs=typeof playback.pausedMs==='number'&&Number.isSafeInteger(playback.pausedMs)&&playback.pausedMs>0?playback.pausedMs:0;
  let index=0,elapsed=playback.startedAt>0?Math.max(0,now-playback.startedAt-pausedMs):Math.max(0,now);
  if(!playback.startedAt)index=playback.segments.length-1;
  while(index<playback.segments.length-1&&elapsed>=playback.segments[index].durationMs){elapsed-=playback.segments[index].durationMs;index++;}
  const part=playback.segments[index],duration=Math.max(1,part.durationMs);
  const complete=part.mode!=='loop'&&(!playback.startedAt||elapsed>=duration);
  const offsetMs=part.mode==='static'?0:part.mode==='loop'?elapsed%duration:complete?Math.max(0,duration-1):elapsed;
  return {...part,key:playback.key+':'+index,offsetMs,complete,...(index<playback.segments.length-1?{nextInMs:Math.max(1,duration-elapsed)}:{})};
}
