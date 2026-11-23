import type { CompanionFactActor } from './interaction.js';

interface ActionMembership {
  care?: {order: number; label: string};
  role?: number;
  plan?: number;
  feedback?: true;
}

export const BODY_ACTIONS = {
  command: {role: 1},
  pet: {role: 2, care: {order: 3, label: '摸摸头'}, feedback: true},
  poke: {role: 3, feedback: true},
  feed: {role: 4, care: {order: 1, label: '免费基础餐食'}, plan: 4, feedback: true},
  water: {role: 5, care: {order: 2, label: '倒杯水'}, plan: 3, feedback: true},
  play: {role: 6, care: {order: 4, label: '一起玩'}, plan: 5, feedback: true},
  talk: {role: 7, feedback: true},
  sleep: {role: 8, care: {order: 5, label: '去睡觉'}, plan: 1},
  wake: {role: 9, care: {order: 6, label: '叫醒'}, plan: 2},
  lamp: {role: 10},
} as const satisfies Record<string, ActionMembership>;

export type BodyAction = keyof typeof BODY_ACTIONS;
type ActionIn<Group extends keyof ActionMembership> = {
  [Action in BodyAction]: Group extends keyof (typeof BODY_ACTIONS)[Action] ? Action : never;
}[BodyAction];

export type CareAction = ActionIn<'care'>;
export type PlanBodyAction = ActionIn<'plan'>;
export type FeedbackAction = ActionIn<'feedback'>;

export const BODY_ACTION_NAMES: readonly BodyAction[] = Object.keys(BODY_ACTIONS) as BodyAction[];
const memberships: Readonly<Record<BodyAction, ActionMembership>> = BODY_ACTIONS;

function actionsIn<Group extends keyof ActionMembership>(group: Group,
  orderOf: (membership: NonNullable<ActionMembership[Group]>) => number): readonly ActionIn<Group>[] {
  return BODY_ACTION_NAMES.flatMap(action => {
    const membership = memberships[action][group];
    return membership === undefined ? [] : [{action: action as ActionIn<Group>, order: orderOf(membership)}];
  }).sort((a, b) => a.order - b.order).map(({action}) => action);
}

export const CARE_ACTIONS = actionsIn('care', care => care.order);
export const ROLE_ACTIONS = actionsIn('role', order => order);
export const PLAN_BODY_ACTIONS = actionsIn('plan', order => order);
export const FEEDBACK_ACTIONS = actionsIn('feedback', () => 0);

export function isCareAction(action: unknown): action is CareAction {
  return typeof action === 'string' && (CARE_ACTIONS as readonly string[]).includes(action);
}

export function isPlanBodyAction(action: unknown): action is PlanBodyAction {
  return typeof action === 'string' && (PLAN_BODY_ACTIONS as readonly string[]).includes(action);
}

export const PLAN_KINDS = {
  hold: {target: false, executable: false},
  room: {target: true, executable: false},
  move: {target: true, executable: true},
  garden: {target: false, executable: true},
  body: {target: false, executable: true},
  economy: {target: false, executable: true},
  read: {target: false, executable: true},
} as const;
export type PlanKind = keyof typeof PLAN_KINDS;
const planKindNames = Object.keys(PLAN_KINDS);

export function isPlanKind(kind: unknown): kind is PlanKind {
  return typeof kind === 'string' && planKindNames.includes(kind);
}

export const PLAN_ECONOMY_OPERATIONS = {buy: true, sell: true, consume: true} as const;
export type PlanEconomyOperation = keyof typeof PLAN_ECONOMY_OPERATIONS;
export type PlanTradeOperation = Exclude<PlanEconomyOperation, 'consume'>;
export const PLAN_ECONOMY_OPERATION_NAMES = Object.keys(PLAN_ECONOMY_OPERATIONS) as readonly PlanEconomyOperation[];

export function isPlanEconomyOperation(value: unknown): value is PlanEconomyOperation {
  return typeof value === 'string' && (PLAN_ECONOMY_OPERATION_NAMES as readonly string[]).includes(value);
}

export const PLAN_GARDEN_OPERATIONS = {
  visit: {branch: 'noFields', order: 1},
  till: {branch: 'plot', order: 1},
  plant: {branch: 'plotAndCrop', order: 1},
  water: {branch: 'plot', order: 2},
  fertilize: {branch: 'plot', order: 3},
  harvest: {branch: 'plot', order: 4},
  sell: {branch: 'cropTrade', order: 1},
  buySeed: {branch: 'cropTrade', order: 2},
  buyCompost: {branch: 'quantity', order: 1},
} as const;
export type PlanGardenOperation = keyof typeof PLAN_GARDEN_OPERATIONS;
export const PLAN_GARDEN_OPERATION_NAMES = Object.keys(PLAN_GARDEN_OPERATIONS) as readonly PlanGardenOperation[];

export function isPlanGardenOperation(value: string): value is PlanGardenOperation {
  return (PLAN_GARDEN_OPERATION_NAMES as readonly string[]).includes(value);
}

export const READING_STATES = {unread: true, offered: true, confirmed: true} as const;
export type ReadingState = keyof typeof READING_STATES;

export const BODY_METRICS = {
  hunger: 'ceiling',
  thirst: 'ceiling',
  energy: 'floor',
  bladder: 'ceiling',
  pain: 'none',
} as const;
export type BodyMetric = keyof typeof BODY_METRICS;
export const BODY_METRIC_NAMES = Object.keys(BODY_METRICS) as readonly BodyMetric[];

export function isBodyMetric(value: string): value is BodyMetric {
  return Object.hasOwn(BODY_METRICS, value);
}

/** 自然语言活动标签，沿用序列化字段 activity。 */
export type ActivityLabel = string;
/** 已派发操作的编号。 */
export type OperationId = string;
/** 快照中的当前活动编号，来自执行、菜园任务、照料任务或自动生成的摘要。 */
export type CurrentActivityId = string | null;

/** completed 来自身体任务的 completedAt。 */
export type BodyPhase = 'idle' | 'pending' | 'moving' | 'working' | 'sleeping' | 'completed';
/**
 * completed 表示执行已结束，结果由 ExecutionStatus 区分，包括失败和取消。
 * 终态以 status 为准：旧存档有 running + completed，菜园执行失败会写 failed + waiting。
 */
export type ExecutionPhase = 'pending' | 'moving' | 'working' | 'waiting' | 'completed';
export type ExecutionStatus = 'running' | 'paused' | 'completed' | 'cancelled' | 'interrupted' | 'failed';

/** Read-only media hints grounded in the current accepted operation and facts. */
export interface BehaviorAnimationContext {
  slotId?: string;
  /** Real execution/phase onset when known; never a snapshot/window timestamp. */
  startedAt?: number;
  /** Frozen duration of this exact, known media cue in its original execution. */
  presentationFreeze?: {onsetAt: number; pausedMs: number};
  itemId?: string;
  foodSlot?: string;
  interaction?: {
    id: string;
    action: string;
    at: number;
    until: number;
    text: string;
    actor: CompanionFactActor;
  };
}

export type FeedAdmission = 'start' | 'already-presented' | 'blocked';

/** Actual semantic activity is distinct from a surface's animation receipt. */
export interface BehaviorActivity {
  activityId: CurrentActivityId;
  kind: string;
  /** Persisted phase onset when known; zero never claims a historical start. */
  startedAt?: number;
  phase: BodyPhase;
  /** 为真时桌宠不能发起一次新投喂。已经在吃饭时也为真，吃饭素材仍放行且不再投喂。 */
  busy: boolean;
  /** 当前活动对已声明目标动作的准入。具体请求仍须在 Body 串行入口复核。 */
  interruptibility: {feed: FeedAdmission};
  /** Derived from accepted execution and real content receipts, never activity prose. */
  presentationKind?: 'read' | 'reading-wait' | 'rest';
  readingState?: ReadingState;
  animationContext?: BehaviorAnimationContext;
}
export interface BehaviorChange { workspaceId: string; bootId: string; revision: number; reason?:'observation'|'transition' }
export interface CompanionExpression { sessionId: string; turn: number; action?: string; actionLabel?: string; sticker?: string; feelings?: string[] }
export interface BehaviorPresentation {
  action: string; activity: string; exclusive: boolean; fallback?: boolean;
  feelings: string[]; emotionLabel: string; expression?: CompanionExpression;
}
export interface BehaviorSnapshot extends BehaviorChange {
  storageId: string; autonomyEnabled: boolean; behavior: BehaviorActivity;
  home: any; presentation: BehaviorPresentation; fault: string | null;
  planned?: PlannedExecution;
  /** Unrounded authoritative metrics for deterministic plan conditions. */
  needs:Record<BodyMetric,number>;
}

/** A durable program execution receipt; it is not a visual animation receipt. */
export interface PlannedActivity {
  operationId: OperationId;
  kind: PlanKind;
  activity: ActivityLabel;
  /** Optional registered portrayal; never grants an operation, object or effect. */
  presentationSlot?: string;
  room?: string;
  spot?: string;
  garden?: Record<string, unknown>;
  action?: PlanBodyAction;
  economy?: {type: PlanEconomyOperation; itemId: string; quantity: number};
  reading?: {itemId: string; segment: number};
  until?: string;
  /** Durations freeze while paused; explicit calendar deadlines do not. */
  freezeOnPause?: boolean;
}
/** Body's synchronous admission guard ran before the durable execution intent
 * or any effect was submitted. Only this proof permits admission to be retried. */
export interface PlannedAdmissionWait {
  version: 1;
  kind: 'owner-activity';
  operationId: string;
  requestId: string;
  observedAt: string;
}
export class PlannedAdmissionWaitError extends Error {
  constructor(readonly wait: PlannedAdmissionWait) {
    super('身体仍在完成主人已安排的活动，完成后继续原计划');
    this.name = 'PlannedAdmissionWaitError';
  }
}
export interface PlannedExecution {
  operationId: OperationId;
  kind: PlanKind;
  status: ExecutionStatus;
  phase: ExecutionPhase;
  activity: ActivityLabel;
  startedAt: string;
  updatedAt: string;
  until?: string;
  /** Completion contract, derived from the accepted operation. */
  completion?: 'arrival' | 'deadline' | 'explicit-control' | 'receipt';
  reason?: string;
  /** A real program handoff that requires a native model turn, not animation. */
  awaitingInput?: 'reading-content';
  /** A temporary owner interaction retains this accepted operation for safe return. */
  resumeAfterInteraction?: boolean;
}
