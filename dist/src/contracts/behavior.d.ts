import type { CompanionFactActor } from './interaction.js';
interface ActionMembership {
    care?: {
        order: number;
        label: string;
    };
    role?: number;
    plan?: number;
    feedback?: true;
}
export declare const BODY_ACTIONS: {
    readonly command: {
        readonly role: 1;
    };
    readonly pet: {
        readonly role: 2;
        readonly care: {
            readonly order: 3;
            readonly label: "摸摸头";
        };
        readonly feedback: true;
    };
    readonly poke: {
        readonly role: 3;
        readonly feedback: true;
    };
    readonly feed: {
        readonly role: 4;
        readonly care: {
            readonly order: 1;
            readonly label: "免费基础餐食";
        };
        readonly plan: 4;
        readonly feedback: true;
    };
    readonly water: {
        readonly role: 5;
        readonly care: {
            readonly order: 2;
            readonly label: "倒杯水";
        };
        readonly plan: 3;
        readonly feedback: true;
    };
    readonly play: {
        readonly role: 6;
        readonly care: {
            readonly order: 4;
            readonly label: "一起玩";
        };
        readonly plan: 5;
        readonly feedback: true;
    };
    readonly talk: {
        readonly role: 7;
        readonly feedback: true;
    };
    readonly sleep: {
        readonly role: 8;
        readonly care: {
            readonly order: 5;
            readonly label: "去睡觉";
        };
        readonly plan: 1;
    };
    readonly wake: {
        readonly role: 9;
        readonly care: {
            readonly order: 6;
            readonly label: "叫醒";
        };
        readonly plan: 2;
    };
    readonly lamp: {
        readonly role: 10;
    };
};
export type BodyAction = keyof typeof BODY_ACTIONS;
type ActionIn<Group extends keyof ActionMembership> = {
    [Action in BodyAction]: Group extends keyof (typeof BODY_ACTIONS)[Action] ? Action : never;
}[BodyAction];
export type CareAction = ActionIn<'care'>;
export type PlanBodyAction = ActionIn<'plan'>;
export type FeedbackAction = ActionIn<'feedback'>;
export declare const BODY_ACTION_NAMES: readonly BodyAction[];
export declare const CARE_ACTIONS: readonly ActionIn<"care">[];
export declare const ROLE_ACTIONS: readonly ActionIn<"role">[];
export declare const PLAN_BODY_ACTIONS: readonly ActionIn<"plan">[];
export declare const FEEDBACK_ACTIONS: readonly ActionIn<"feedback">[];
export declare function isCareAction(action: unknown): action is CareAction;
export declare function isPlanBodyAction(action: unknown): action is PlanBodyAction;
export declare const PLAN_KINDS: {
    readonly hold: {
        readonly target: false;
        readonly executable: false;
    };
    readonly room: {
        readonly target: true;
        readonly executable: false;
    };
    readonly move: {
        readonly target: true;
        readonly executable: true;
    };
    readonly garden: {
        readonly target: false;
        readonly executable: true;
    };
    readonly body: {
        readonly target: false;
        readonly executable: true;
    };
    readonly economy: {
        readonly target: false;
        readonly executable: true;
    };
    readonly read: {
        readonly target: false;
        readonly executable: true;
    };
};
export type PlanKind = keyof typeof PLAN_KINDS;
export declare function isPlanKind(kind: unknown): kind is PlanKind;
export declare const PLAN_ECONOMY_OPERATIONS: {
    readonly buy: true;
    readonly sell: true;
    readonly consume: true;
};
export type PlanEconomyOperation = keyof typeof PLAN_ECONOMY_OPERATIONS;
export type PlanTradeOperation = Exclude<PlanEconomyOperation, 'consume'>;
export declare const PLAN_ECONOMY_OPERATION_NAMES: readonly PlanEconomyOperation[];
export declare function isPlanEconomyOperation(value: unknown): value is PlanEconomyOperation;
export declare const PLAN_GARDEN_OPERATIONS: {
    readonly visit: {
        readonly branch: "noFields";
        readonly order: 1;
    };
    readonly till: {
        readonly branch: "plot";
        readonly order: 1;
    };
    readonly plant: {
        readonly branch: "plotAndCrop";
        readonly order: 1;
    };
    readonly water: {
        readonly branch: "plot";
        readonly order: 2;
    };
    readonly fertilize: {
        readonly branch: "plot";
        readonly order: 3;
    };
    readonly harvest: {
        readonly branch: "plot";
        readonly order: 4;
    };
    readonly sell: {
        readonly branch: "cropTrade";
        readonly order: 1;
    };
    readonly buySeed: {
        readonly branch: "cropTrade";
        readonly order: 2;
    };
    readonly buyCompost: {
        readonly branch: "quantity";
        readonly order: 1;
    };
};
export type PlanGardenOperation = keyof typeof PLAN_GARDEN_OPERATIONS;
export declare const PLAN_GARDEN_OPERATION_NAMES: readonly PlanGardenOperation[];
export declare function isPlanGardenOperation(value: string): value is PlanGardenOperation;
export declare const READING_STATES: {
    readonly unread: true;
    readonly offered: true;
    readonly confirmed: true;
};
export type ReadingState = keyof typeof READING_STATES;
export declare const BODY_METRICS: {
    readonly hunger: "ceiling";
    readonly thirst: "ceiling";
    readonly energy: "floor";
    readonly bladder: "ceiling";
    readonly pain: "none";
};
export type BodyMetric = keyof typeof BODY_METRICS;
export declare const BODY_METRIC_NAMES: readonly BodyMetric[];
export declare function isBodyMetric(value: string): value is BodyMetric;
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
    presentationFreeze?: {
        onsetAt: number;
        pausedMs: number;
    };
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
    interruptibility: {
        feed: FeedAdmission;
    };
    /** Derived from accepted execution and real content receipts, never activity prose. */
    presentationKind?: 'read' | 'reading-wait' | 'rest';
    readingState?: ReadingState;
    animationContext?: BehaviorAnimationContext;
}
export interface BehaviorChange {
    workspaceId: string;
    bootId: string;
    revision: number;
    reason?: 'observation' | 'transition';
}
export interface CompanionExpression {
    sessionId: string;
    turn: number;
    action?: string;
    actionLabel?: string;
    sticker?: string;
    feelings?: string[];
}
export interface BehaviorPresentation {
    action: string;
    activity: string;
    exclusive: boolean;
    fallback?: boolean;
    feelings: string[];
    emotionLabel: string;
    expression?: CompanionExpression;
}
export interface BehaviorSnapshot extends BehaviorChange {
    storageId: string;
    autonomyEnabled: boolean;
    behavior: BehaviorActivity;
    home: any;
    presentation: BehaviorPresentation;
    fault: string | null;
    planned?: PlannedExecution;
    /** Unrounded authoritative metrics for deterministic plan conditions. */
    needs: Record<BodyMetric, number>;
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
    economy?: {
        type: PlanEconomyOperation;
        itemId: string;
        quantity: number;
    };
    reading?: {
        itemId: string;
        segment: number;
    };
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
export declare class PlannedAdmissionWaitError extends Error {
    readonly wait: PlannedAdmissionWait;
    constructor(wait: PlannedAdmissionWait);
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
export {};
