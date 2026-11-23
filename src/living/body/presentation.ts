import type { BehaviorPresentation, CompanionExpression } from '../../contracts/behavior.js';
import { COMPANION_FEELINGS, isCompanionFeeling, type CompanionFeeling } from '../../contracts/emotion.js';

export const feelingLabels: Record<CompanionFeeling, string> = {
  happy:'开心',calm:'平静',sweet:'甜蜜',heartache:'心疼',worry:'担心',sad:'难过',jealous:'吃醋',anger:'生气',boredom:'无聊',
};

/** The actual activity takes precedence. A live touch still needs a single known feeling. */
export function classifyActivity(home: any) {
  const her = home?.her;
  const behavior = home?.behavior;
  const planned = her?.kind === 'planned' ? behavior?.presentationKind : undefined;
  const physical = her?.asleep ? 'sleep' : (her?.walking || her?.kind === 'walk') ? 'walk' : undefined;
  const kind: string = physical ?? (planned === 'read' ? (behavior?.readingState === 'offered' ? 'read' : 'reading-wait')
    : planned || (her?.kind === 'read' ? 'reading-wait' : her?.kind || 'idle'));
  const rest = ['rest','idle','free'].includes(kind);
  const values: unknown[] = Array.isArray(home?.emotion?.feelings) ? home.emotion.feelings : [];
  const feelings = values.filter(isCompanionFeeling);
  const feeling = feelings.includes('anger') ? 'anger' : feelings.includes('boredom') ? 'boredom'
    : COMPANION_FEELINGS.find(value => feelings.includes(value));
  const distinct = [...new Set(values.filter(value => typeof value === 'string'))];
  const touchFeeling = distinct.length === 1 && isCompanionFeeling(distinct[0]) ? distinct[0] : undefined;
  const requested = behavior?.animationContext?.slotId;
  const namedRestHint = rest && typeof requested === 'string' && requested.startsWith('rest.')
    && isCompanionFeeling(requested.slice(5));

  return {kind, physical, rest, feelings, feeling, touchFeeling, namedRestHint};
}

/** Preserve the legacy semantic response built from the common activity intent. */
export function behaviorPresentation(home: any, expression?: CompanionExpression, intent = classifyActivity(home)): BehaviorPresentation {
  const her = home?.her;
  const {physical, feelings, feeling} = intent;
  const base = {
    activity: her?.activity || her?.kind || '安静地待着', feelings,
    emotionLabel: home?.emotion?.label || feelings.map(value => feelingLabels[value]).join('、'),
    ...(expression ? {expression} : {}),
  };
  if (!her) return {...base, action:'idle', exclusive:false};
  if (physical) return {...base, action:physical, exclusive:true};
  if (['eat','react_happy','react_pout','idle_look'].includes(her.kind)) return {...base, action:her.kind, exclusive:true};
  if (!['idle','play'].includes(her.kind)) return {...base, action:'activity', exclusive:true, fallback:true};
  if (expression?.action) return {...base, action:'expression', exclusive:true};
  return feeling ? {...base, action:'emotion/'+feeling, exclusive:true,
    fallback:!['happy','anger','boredom'].includes(feeling)} : {...base, action:'idle', exclusive:false};
}
