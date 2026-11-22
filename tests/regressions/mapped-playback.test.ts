import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {animationAllocation,animationAssets,animationSlots,animationStickers,animationRoomAliases} from '../fixtures/playback.js';
import {resolveActivityPlayback,sampleActivityPlayback,animationSlotAllowed,requirePresentationSlot} from '../fixtures/playback.js';
const home=(kind='idle',context:any={})=>({now:2000,her:{kind,activity:'Actual activity',spot:'sofa',pose:'stand'},behavior:{activityId:'accepted',phase:'working',startedAt:1000,animationContext:context},emotion:{feelings:[] as string[],updatedAt:0}});
const clip=(s:any,at=2000)=>sampleActivityPlayback(resolveActivityPlayback(s)!,at)!;

test('the generated runtime index covers the approved name map without extra assets',()=>{
  const design=JSON.parse(readFileSync(animationAllocation,'utf8'));
  assert.deepEqual(Object.keys(animationAssets),design.assets.map((row:any)=>row.id));
  assert.deepEqual(Object.keys(animationSlots),design.slots.map((row:any)=>row.id));
  assert.deepEqual(Object.keys(animationStickers),design.stickers.map((row:any)=>row.label));
  for(const row of design.slots){const slot=animationSlots[row.id];assert.deepEqual(slot.clips,row.clips);assert.equal(slot.match,row.match);}
  assert.equal(animationRoomAliases['assets/pet/walk.webm'],'螃蟹走路.webm');
  assert.equal(animationRoomAliases['assets/pet/walk_fast.webm'],'侧身急躁跑.webm');
  assert.equal(animationRoomAliases['assets/pet/run_hurry.webm'],'侧身急躁跑.webm');
});

test('typed room movement hints reuse the left-turn asset with a shared mirror flag',()=>{
  assert.equal(animationSlotAllowed('move.right',{kind:'room'}),true);
  assert.equal(animationSlotAllowed('move.right',{kind:'hold'}),false);
  const left=home('walk',{slotId:'move.left'}),right=home('walk',{slotId:'move.right'});
  const a=clip(left),b=clip(right);
  assert.equal(a.desktopClip,'原地左转奔跑');assert.equal(b.desktopClip,a.desktopClip);assert.equal(b.mirror,true);assert.equal(a.mirror,undefined);
  assert.notEqual(resolveActivityPlayback(left)!.key,resolveActivityPlayback(right)!.key);
});
test('a route uses its movement while future quiet portrayal waits until arrival',()=>{
  const s=home('planned',{slotId:'rest.happy'});Object.assign(s.her,{walking:true,runStyle:'hurry'});Object.assign(s.behavior,{presentationKind:'rest'});
  s.emotion={feelings:['happy'],updatedAt:900};
  assert.equal(clip(s).desktopClip,'侧身急躁跑');
  Object.assign(s.her,{walking:false});assert.equal(resolveActivityPlayback(s)!.slotId,'rest.happy');
});
test('arrival cannot keep performing an earlier movement hint',()=>{
  const s=home('planned',{slotId:'move.right'});Object.assign(s.behavior,{presentationKind:'rest'});
  const p=resolveActivityPlayback(s)!;assert.equal(p.kind,'rest');assert.equal(p.gap,true);assert.equal(clip(s).desktopClip,'待机呼吸休闲');
});
test('a movement style hint cannot override a known incompatible actual run style',()=>{
  for(const [runStyle,slotId,expected]of [['hurry','move.happy','侧身急躁跑'],['happy','move.hurry','开心小跑']]){
    const s=home('walk',{slotId});Object.assign(s.her,{walking:true,runStyle});
    const p=resolveActivityPlayback(s)!;assert.equal(p.slotId,'move.'+runStyle);assert.equal(p.gap,true);assert.equal(clip(s).desktopClip,expected);
    s.behavior.animationContext={slotId:'move.'+runStyle};assert.equal(resolveActivityPlayback(s)!.gap,false);
  }
});
test('movement combinations never insert a pause or arrival into an active route',()=>{
  for(const slotId of ['move.depart','move.arrive','move.interrupt','move.tired']){
    const s=home('walk',{slotId});Object.assign(s.her,{walking:true});Object.assign(s.behavior,{phase:'moving'});
    const before=JSON.stringify(s),p=resolveActivityPlayback(s)!;
    assert.deepEqual(p.segments.map(part=>[part.desktopClip,part.mode]),[['原地漂浮踏步','loop']]);
    for(const at of [1000,12000,25000,86400000])assert.equal(sampleActivityPlayback(p,at)!.desktopClip,'原地漂浮踏步');
    assert.equal(resolveActivityPlayback({...s,now:25000})!.key,p.key);assert.equal(JSON.stringify(s),before);
  }
});
test('a started garden visit uses the actual route and never replays arrival movement',()=>{
  const s=home('garden_visit');Object.assign(s.her,{walking:true});
  assert.equal(resolveActivityPlayback(s)!.kind,'walk');assert.equal(clip(s).desktopClip,'原地漂浮踏步');
  Object.assign(s.her,{walking:false});
  const arrived=resolveActivityPlayback(s)!;
  assert.equal(arrived.kind,'garden_visit');assert.equal(arrived.startedAt,1000);
  assert.equal(clip(s).desktopClip,'东张西望');assert.equal(arrived.segments.some(part=>part.desktopClip==='原地漂浮踏步'),false);
  const lookEnd=arrived.startedAt+arrived.segments[0].durationMs;
  assert.equal(sampleActivityPlayback(arrived,lookEnd-1)!.desktopClip,'东张西望');
  assert.equal(sampleActivityPlayback(arrived,lookEnd)!.desktopClip,'待机呼吸休闲');
  s.now=3000;assert.equal(resolveActivityPlayback(s)!.key,arrived.key);
  assert.deepEqual(resolveActivityPlayback(JSON.parse(JSON.stringify(s))),arrived);
});
test('dedicated missing motion stays empty rather than inventing a direction or held prop',()=>{
  for(const slotId of ['move.back','move.carry','move.turn']){
    const s=home('walk',{slotId}),p=resolveActivityPlayback(s)!;
    assert.equal(p.gap,true);assert.equal(p.segments[0].mode,'static');assert.equal(p.segments[0].desktopClip,'待机呼吸休闲');
  }
});
test('the actual item metadata selects lunch and ignores a crab phrase',()=>{
  const s=home('eat',{foodSlot:'food.lunch',itemId:'food:improved-meal'});s.her.activity='A freely worded description mentioning 小鱼干 or crab';
  assert.equal(clip(s).desktopClip,'吃午餐');assert.equal(resolveActivityPlayback(s)!.gap,false);
  s.behavior.animationContext={};assert.equal(clip(s).desktopClip,'吃白饭');
});
test('catalog food names do not infer an unregistered portrayal',()=>{
  const s=home('eat',{itemId:'food:unknown'});s.her.activity='吃西瓜';
  const p=resolveActivityPlayback(s)!;assert.equal(p.gap,true);assert.equal(p.segments[0].mode,'static');assert.notEqual(clip(s).desktopClip,'吃西瓜');
});
test('a requested food portrayal cannot change the real catalog food',()=>{
  const s=home('eat',{slotId:'food.crab',foodSlot:'food.lunch',itemId:'food:improved-meal'});
  assert.equal(clip(s).desktopClip,'吃午餐');assert.equal(resolveActivityPlayback(s)!.gap,true);
  assert.equal(animationSlotAllowed('food.crab',{kind:'economy',economy:{type:'consume'},foodSlot:'food.lunch'}),false);
});
test('free care cannot request an unrelated specific dish or a new choosing/waiting phase',()=>{
  assert.equal(animationSlotAllowed('food.rice',{kind:'body',action:'feed'}),true);
  for(const value of ['food.crab','food.await','food.choose','food.finish'])assert.equal(animationSlotAllowed(value,{kind:'body',action:'feed'}),false);
  assert.equal(requirePresentationSlot('food.lunch',{kind:'food-item'}),'food.lunch');
  assert.throws(()=>requirePresentationSlot('read.main',{kind:'body',action:'feed'}));
});
test('registered component movies are not passed off as a cross-surface composition',()=>{
  const bowl=resolveActivityPlayback(home('eat',{foodSlot:'food.bowl'}))!;
  assert.equal(bowl.gap,true);assert.equal(bowl.match,'proxy');assert.equal(bowl.segments[0].desktopClip,'吃白饭');
  const ball=resolveActivityPlayback(home('eat',{foodSlot:'food.riceball'}))!;
  assert.equal(ball.gap,true);assert.equal(ball.segments[0].mode,'static');assert.notEqual(ball.segments[0].desktopClip,'吃饭团');
});
test('drinking already underway does not replay a full preparation idle or create another drink',()=>{
  const s=home('drink',{slotId:'drink.sequence'}),before=JSON.stringify(s),p=resolveActivityPlayback(s)!;
  assert.deepEqual(p.segments.map(part=>part.desktopClip),['生活-捧杯喝水']);assert.equal(p.segments[0].mode,'loop');
  sampleActivityPlayback(p,80000);assert.equal(JSON.stringify(s),before);
});
test('sleep combines existing entry and loop but never invents waking from elapsed media',()=>{
  const s=home('sleep',{slotId:'sleep.full'});Object.assign(s.her,{asleep:true,spot:'bed'});
  const p=resolveActivityPlayback(s)!;
  assert.deepEqual(p.segments.map(part=>part.desktopClip),['睡觉-开始','睡觉-循环']);
  assert.equal(sampleActivityPlayback(p,86400000)!.desktopClip,'睡觉-循环');
  Object.assign(s.her,{asleep:false,kind:'wake'});assert.deepEqual(resolveActivityPlayback(s)!.segments.map(part=>part.desktopClip),['睡觉-起来']);
});
test('a real reading offer cannot be bypassed by a visual slot',()=>{
  const s=home('planned',{slotId:'read.main'});Object.assign(s.behavior,{presentationKind:'read',readingState:'unread'});
  assert.equal(resolveActivityPlayback(s)!.kind,'reading-wait');assert.equal(clip(s).desktopClip,'待机呼吸休闲');
  Object.assign(s.behavior,{readingState:'offered'});assert.equal(clip(s).desktopClip,'生活-专心阅读');
  assert.equal(animationSlotAllowed('read.main',{kind:'hold'}),false);
  assert.equal(animationSlotAllowed('read.with-notes',{kind:'read'}),false,'No real note-writing execution exists');
});
test('emotional rest shares one stable accepted timeline and stops at quiet rest',()=>{
  const s=home('planned',{startedAt:1000});Object.assign(s.behavior,{presentationKind:'rest'});s.emotion={feelings:['happy'],updatedAt:900};
  const p=resolveActivityPlayback(s)!;
  assert.deepEqual(p.segments.map(part=>[part.desktopClip,part.mode]),[['待机呼吸休闲','once'],['悠闲哼歌','once'],['待机呼吸休闲','loop']]);
  assert.equal(sampleActivityPlayback(p,12000)!.desktopClip,'悠闲哼歌');assert.equal(sampleActivityPlayback(p,30000)!.desktopClip,'待机呼吸休闲');
  assert.equal(resolveActivityPlayback({...s,now:4000})!.key,p.key);
});
test('a genuine newer emotion changes visual onset without changing an accepted operation',()=>{
  const s=home('planned',{startedAt:1000});Object.assign(s.behavior,{presentationKind:'rest'});s.emotion={feelings:['sad'],updatedAt:1500};
  const p=resolveActivityPlayback(s)!;assert.equal(p.startedAt,1500);assert.equal(p.activityId,'accepted');assert.equal(p.gap,true);assert.equal(p.slotId,'rest.sad');
});
test('a rest presentation hint follows the current companion feeling instead of replacing it',()=>{
  const s=home('planned',{slotId:'rest.happy',startedAt:1000});Object.assign(s.behavior,{presentationKind:'rest'});s.emotion={feelings:['sad'],updatedAt:1500};
  const before=JSON.stringify(s),p=resolveActivityPlayback(s)!;
  assert.equal(p.slotId,'rest.sad');assert.equal(sampleActivityPlayback(p,12000)!.desktopClip,'工作状态-垂头叹气冒汗');
  assert.ok(p.uncovered!.includes('Requested slot is incompatible with the actual activity'));assert.equal(JSON.stringify(s),before);
  s.emotion={feelings:['happy'],updatedAt:1700};const accepted=resolveActivityPlayback(s)!;
  assert.equal(accepted.slotId,'rest.happy');assert.equal(accepted.gap,false);assert.equal(accepted.startedAt,1700);
  assert.equal(resolveActivityPlayback({...s,now:5000})!.key,accepted.key);
});
test('mixed or unknown feelings retain neutral rest even with a specific emotional hint',()=>{
  for(const values of [['sad','happy'],['happy','sad'],[],['curious'],['sad','curious']]){
    const s=home('idle',{slotId:'rest.happy'});s.emotion={feelings:values,updatedAt:1000};
    const p=resolveActivityPlayback(s)!;assert.equal(p.slotId,'rest.calm');assert.equal(p.gap,true);assert.equal(clip(s).desktopClip,'待机呼吸休闲');
  }
});
test('mixed feelings do not acquire an invented hard-coded emotion priority',()=>{
  for(const values of [['sad','happy'],['happy','sad']]){const s=home('idle');s.emotion={feelings:values,updatedAt:1000};assert.equal(resolveActivityPlayback(s)!.slotId,'rest.calm');}
});
test('unknown rest starts skip historical gestures when a window opens',()=>{
  const s=home('idle');s.behavior.startedAt=0;s.emotion={feelings:['happy'],updatedAt:0};
  const p=resolveActivityPlayback(s)!;assert.equal(p.startedAt,0);assert.equal(sampleActivityPlayback(p,2000)!.desktopClip,'待机呼吸休闲');
});
const pet=(id='owner-touch')=>({id,action:'pet',at:1500,until:5000,actor:{kind:'owner'},summary:'主人刚摸了摸你的头'});
test('busy touch uses CURRENT with fact feedback and does not restart actual reading',()=>{
  const s=home('planned');Object.assign(s.behavior,{presentationKind:'read',readingState:'offered'});s.emotion={feelings:['sweet'],updatedAt:1000};
  const before=resolveActivityPlayback(s)!;s.behavior.animationContext={interaction:pet()};const p=resolveActivityPlayback(s)!;
  assert.equal(p.key,before.key);assert.equal(p.segments[0].desktopClip,'生活-专心阅读');assert.equal(p.feedback!.id,'owner-touch');assert.equal(p.feedback!.text,'主人刚摸了摸你的头');assert.equal(p.feedback!.sticker,'可爱');
  const next=resolveActivityPlayback({...s,now:6000})!;assert.equal(next.feedback,undefined);assert.equal(next.key,before.key);
});
test('a low-mood pet reaction may use the sad proxy while ordinary looking remains looking',()=>{
  const s=home('idle_look');s.emotion={feelings:['sad'],updatedAt:1000};assert.equal(clip(s).desktopClip,'东张西望');
  s.behavior.animationContext={interaction:pet()};const p=resolveActivityPlayback(s)!;assert.equal(p.slotId,'touch.sad');assert.equal(p.segments[0].desktopClip,'工作状态-垂头叹气冒汗');assert.equal(p.segments[0].mode,'once');
});
test('real fright from the body is not replaced by happy emotion on head touch',()=>{
  const s=home('react_scare',{interaction:pet()});s.emotion={feelings:['happy'],updatedAt:1000};
  assert.equal(clip(s).desktopClip,'被吓一跳');
});
test('receipt acknowledgement, old/future events or non-owner events cannot fabricate a fresh gesture',()=>{
  for(const interaction of [{...pet(),until:1900},{...pet(),at:2100},{...pet(),actor:{kind:'companion'}}]){
    const s=home('idle_look',{interaction});s.emotion={feelings:['sad'],updatedAt:1000};assert.equal(clip(s).desktopClip,'东张西望');assert.equal(resolveActivityPlayback(s)!.feedback,undefined);
  }
});
test('blank hygiene remains a truthful static gap instead of tooth brushing or table wiping',()=>{
  for(const kind of ['bath','toilet','laundry']){const p=resolveActivityPlayback(home(kind))!;assert.equal(p.gap,true);assert.equal(p.segments[0].mode,'static');assert.equal(p.kind,kind);}
});
test('optional games, food and seasonal assets do not become generic hold plans',()=>{
  for(const slot of ['food.crab','garden.harvest','read.main','hygiene.teeth','input.pick-up'])assert.equal(animationSlotAllowed(slot,{kind:'hold'}),false);
  assert.throws(()=>requirePresentationSlot('not-a-slot',{kind:'hold'}));
  assert.equal(animationSlotAllowed('talk.listen',{kind:'hold'}),true);
});

test('existing garden trade jobs admit their matching transaction portrayal only',()=>{
  for(const [type,slot] of [['sell','trade.sell'],['buySeed','trade.buy-seed'],['buyCompost','trade.buy-compost']]){
    assert.equal(requirePresentationSlot(slot,{kind:'garden',garden:{type}}),slot);
    assert.equal(animationSlotAllowed('garden.till',{kind:'garden',garden:{type}}),false);
  }
});
