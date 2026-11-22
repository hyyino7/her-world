import type {BehaviorActivity, PlannedActivity} from '../../contracts/behavior.js';
import {registeredAnimationSlots} from './animation-slot-ids.js';

export interface AnimationSlotContext {
  kind: BehaviorActivity['kind'];
  action?: PlannedActivity['action'];
  economy?: Pick<NonNullable<PlannedActivity['economy']>, 'type'>;
  garden?: Record<string,unknown>;
  foodSlot?: PlannedActivity['presentationSlot'];
}

const quietTalk=new Set(['talk.greet','talk.listen','talk.screen','talk.idle','talk.think','talk.praise']);
const foodWorkflows=new Set(['food.await','food.choose','food.finish']);
const foodDetails=new Set(['food.utensils']);

/** One admission rule shared by plan parsing, Body and item metadata. A slot is
 * cosmetic authority only; it cannot grant an item or a new business action. */
export function animationSlotAllowed(value:unknown,input:string|AnimationSlotContext):boolean {
  if(typeof value!=='string' || !registeredAnimationSlots.has(value))return false;
  const context=typeof input==='string'?{kind:input}:input,kind=context.kind;
  const food=value.startsWith('food.')&&!foodWorkflows.has(value)&&!foodDetails.has(value)&&value!=='food.caught';
  if(kind==='food-item')return food;
  if((kind==='room'||kind==='move')&&value.startsWith('move.'))return true;
  if(kind==='hold'||kind==='room'||kind==='rest'||kind==='idle'||kind==='free')
    return value.startsWith('rest.')||quietTalk.has(value)||value==='leisure.balcony';
  if(kind==='read')return value==='read.main'||value==='read.handling';
  if(kind==='body') {
    if(context.action==='water')return value.startsWith('drink.');
    if(context.action==='feed')return value==='food.rice'||value==='food.bowl'||value==='food.utensils';
    if(context.action==='sleep')return value==='sleep.full'||value==='sleep.nap';
    if(context.action==='wake')return value==='sleep.full'||value==='sleep.stretch';
    return false;
  }
  if(kind==='economy') {
    if(context.economy?.type==='consume')return food && (!context.foodSlot || value===context.foodSlot);
    return context.economy?.type==='buy'?value.startsWith('trade.')&&value!=='trade.sell':context.economy?.type==='sell'?value==='trade.sell'||value==='trade.inspect':false;
  }
  if(kind==='garden') {
    const action=String(context.garden?.type??context.garden?.action??'');
    if(action==='sell')return value==='trade.sell'||value==='trade.inspect';
    if(action==='buySeed')return value==='trade.buy-seed'||value==='trade.inspect';
    if(action==='buyCompost')return value==='trade.buy-compost'||value==='trade.inspect';
    return action ? value==='garden.'+action || action==='harvest'&&(value.startsWith('garden.harvest-')||value==='garden.dig-harvest') : value.startsWith('garden.');
  }
  if(kind==='walk')return value.startsWith('move.');
  if(kind==='drink')return value.startsWith('drink.');
  if(kind==='eat')return food && (!context.foodSlot || value===context.foodSlot);
  if(kind==='sleep')return value==='sleep.full'||value==='sleep.nap';
  if(kind==='wake')return value==='sleep.full'||value==='sleep.stretch';
  if(kind==='nap')return value==='sleep.nap';
  if(kind==='desk')return value==='desk.code'||value==='desk.tap';
  if(kind==='tv')return value==='leisure.tv';
  if(kind==='phone')return value==='leisure.phone';
  if(kind==='balcony')return value==='leisure.balcony'||value==='leisure.cool';
  if(kind==='bath'||kind==='toilet'||kind==='laundry')return value==='hygiene.'+kind;
  if(kind==='touch')return value.startsWith('touch.');
  if(kind==='garden_visit')return value==='garden.visit';
  if(kind==='garden_sell')return value==='trade.sell'||value==='trade.inspect';
  if(kind==='garden_buySeed')return value==='trade.buy-seed'||value==='trade.inspect';
  if(kind==='garden_buyCompost')return value==='trade.buy-compost'||value==='trade.inspect';
  if(kind.startsWith('garden_')) {
    const action=kind.slice(7);return value==='garden.'+action || action==='harvest'&&(value.startsWith('garden.harvest-')||value==='garden.dig-harvest');
  }
  return false;
}
export function requirePresentationSlot(value:unknown,context:string|AnimationSlotContext):string {
  if(!animationSlotAllowed(value,context))throw Error('活动动画配对与当前实际活动不兼容');
  return value as string;
}
