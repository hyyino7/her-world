import { resolveActivityPlayback, sampleActivityPlayback, withHomePlayback, type ActivityPlayback } from '../../living/body/playback.js';
import {animationSlotAllowed} from '../../living/body/animation-slots.js';

export const desktopHomePlayback = (home:unknown) => withHomePlayback(home,animationSlotAllowed);

/** Semantic exclusions from the shipped catalogue; these clips assert a physical activity. */
export const eatingClips = new Set([
  '偷吃零食被抓住','中秋赏月吃月饼','吃Token','吃冰淇淋融化','吃午餐','吃大闸蟹',
  '吃年糕','吃早餐','吃晚餐','吃汤圆','吃白饭','吃粽子','吃糖葫芦','吃腊八粥',
  '吃西瓜','吃重阳糕','吃长寿面','吃青团','吃饭·碗饭','吃饭团','吃饺子','大口吃零食','涮火锅',
]);
export const sleepingClips=new Set(['睡觉-开始','睡觉-循环','原地小憩沉眠']);
export const lifeActivityClips = Object.freeze({
  drink:'生活-捧杯喝水',read:'生活-专心阅读',garden_till:'生活-松土',garden_plant:'生活-播种',
  garden_water:'生活-浇水',garden_fertilize:'生活-施肥',garden_harvest:'生活-采收',
  garden_sell:'生活-整理交易',garden_buySeed:'生活-整理交易',garden_buyCompost:'生活-整理交易',
});
export const physicalClips=new Set([...eatingClips,...sleepingClips,...Object.values(lifeActivityClips),'轻快摇摆舞','睡觉-起来','打瞌睡被惊醒','晨间刷牙']);
export function activityPresentation(state:any, expression?:string) {
  const playback:ActivityPlayback|undefined=state?.playback ?? resolveActivityPlayback(state,animationSlotAllowed);
  if(!playback)return {exclusive:false,action:undefined,notice:undefined,gap:false};
  const selected=sampleActivityPlayback(playback,state.now ?? Date.now());
  return {exclusive:true,action:selected?.desktopClip ?? '待机呼吸休闲',gap:playback.gap,
    activityId:playback.activityId,phase:playback.phase,
    progress:{now:state.now,etaMs:state.her?.etaMs,gardenWork:state.her?.gardenWork},
    playback,notice:playback.notice};
}
/** A renderer-only projection. Never return this from the configuration editor's read endpoint. */
export function projectActivityConfig(config:any,state:any,expression?:string) {
  if(!state)return config;
  const projected=structuredClone(config), presentation=activityPresentation(state,expression);
  for(const [root,entry] of Object.entries(projected) as [string,any][]) {
    if(!entry.animations)continue;
    const animations=entry.animations;
    const selected=root==='main' ? presentation.action : animations.idle[0];
    if(presentation.exclusive && selected) {
      // Unknown packs retain their valid local clip and report a representation
      // gap in status/text; they are never evidence of complete visual mirroring.
      animations.idle=[selected];animations.turn=[selected];
      animations.clicks=[selected];animations.categories=[];
      animations.moves={...animations.moves,actions:[]};
      animations.events=Object.fromEntries(Object.entries(animations.events ?? {}).map(([key,slots])=>[key,(slots as any[]).map(()=>selected)]));
      if(animations.baifan)animations.baifan=animations.baifan.map(()=>selected);
      entry.animationWeights={idle:100,turn:0,move:0};
      for(const pet of entry.pets ?? []) {
        pet.workStatusEnabled=false;
        if(root==='main')pet.companionPlayback=presentation.playback;
      }
    } else if(root==='main') {
      // Preserve cosmetic variety and movement while excluding false eating/sleeping facts.
      const safe=(names:string[])=>names.filter(name=>!physicalClips.has(name));
      animations.idle=safe(animations.idle);if(!animations.idle.length)animations.idle=['待机呼吸休闲'];
      animations.turn=safe(animations.turn);animations.clicks=safe(animations.clicks);
      animations.categories=animations.categories.map((category:any)=>({...category,actions:safe(category.actions)})).filter((category:any)=>category.actions.length);
    }
  }
  return projected;
}
