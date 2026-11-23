import { type RecordCommandEffect } from '../index.js';
import { type LifeStore } from '#dsh-world/life/lifeStore';
import type { CompanionBehavior } from '../body/plugin.js';
import { type BodyMetric, type PlannedActivity, type PlannedAdmissionWait } from '../../contracts/behavior.js';
export type PlanStatus = 'active' | 'paused' | 'waiting' | 'completed' | 'cancelled';
export declare function canContinuePlan(status: PlanStatus): boolean;
export declare const PLAN_COMPARISONS: readonly ["gte", "lte"];
export declare const expiredDispatchDeadline = "The activity absolute deadline elapsed before Body admission; revise the original plan explicitly";
export interface LifeStep {
    id: string;
    kind: PlannedActivity['kind'];
    activity: string;
    presentationSlot?: string;
    room?: string;
    spot?: string;
    garden?: Record<string, unknown>;
    action?: PlannedActivity['action'];
    economy?: PlannedActivity['economy'];
    reading?: PlannedActivity['reading'];
    durationMinutes?: number;
    until?: string;
}
export interface LifeCondition {
    metric: BodyMetric;
    comparison: typeof PLAN_COMPARISONS[number];
    value: number;
}
export interface CurrentLifePlan {
    version: 1;
    id: string;
    revision: number;
    companionId: string;
    storageId: string;
    goal: string;
    reason: string;
    status: PlanStatus;
    steps: LifeStep[];
    cursor: number;
    operationId?: string;
    dispatchUntil?: string;
    /** Explicit Body proof that this original operation has not been submitted. */
    admissionWait?: PlannedAdmissionWait;
    execution?: unknown;
    nextConsiderAt: string | null;
    reconsiderWhen: LifeCondition[];
    triggeredConditions: number[];
    pauseReason: string | null;
    replanReason: string | null;
    resumeOnEnable?: boolean;
    /** One actual-content request per original reading operation, retained on pause. */
    readingAttentionOperationId?: string;
    createdAt: string;
    updatedAt: string;
}
export interface PlanDraft {
    goal: string;
    reason: string;
    steps: LifeStep[];
    nextConsiderAt: string | null;
    reconsiderWhen?: LifeCondition[];
}
/** Validate executable structure and queue reachability without choosing a routine. */
export { parsePlan as parsePlanDraft };
declare function parsePlan(raw: unknown): PlanDraft;
/** One scoped intent in World's existing life.json. Body receipts own actual execution.
 * The owning CompanionLife queue serializes every intent mutation, including
 * native alarm tools and retry callbacks, across awaits of the body service. */
export declare class PersistentLifePlan {
    readonly directory: string;
    readonly companionId: string;
    readonly storageId: string;
    private readonly isCurrent;
    private readonly changed?;
    readonly store: LifeStore;
    constructor(directory: string, companionId: string, storageId: string, timeZone: string, isCurrent?: () => boolean, changed?: (() => void) | undefined);
    read(): {
        revision: number;
        plan: CurrentLifePlan | null;
    };
    static decode(state: {
        currentPlan?: unknown;
        planRevision?: number;
    }, companionId: string, storageId: string): {
        revision: number;
        plan: CurrentLifePlan | null;
    };
    private projection;
    private change;
    commit(expectedRevision: number, draft: PlanDraft, behavior?: CompanionBehavior, workspaceId?: string, validate?: () => void): Promise<{
        revision: number;
        plan: CurrentLifePlan | null;
    }>;
    /** Used by native plan_next/cancel_alarm and consumption of the same pending wake. */
    setNextConsideration(at: string | undefined, note: string, reason?: string): void;
    retryAt(at: string, reason: string): void;
    /** An explicit consideration receipt, preserving operation IDs and progress. */
    keep(expectedRevision: number, reason: string, nextConsiderAt: string | null): {
        revision: number;
        plan: CurrentLifePlan | null;
    };
    markAutoResume(enabled: boolean): void;
    control(expectedRevision: number, action: 'pause' | 'resume' | 'cancel', reason: string, behavior?: CompanionBehavior, workspaceId?: string, validate?: () => void): Promise<{
        revision: number;
        plan: CurrentLifePlan | null;
    }>;
    /** Only explicit events create a wake. Repeated ticks cannot create a polling loop. */
    reconsider(reason: string, condition?: number, recordEffect?: RecordCommandEffect): boolean;
    /** Serialized by CompanionLife; no model is called here. */
    advance(workspaceId: string, behavior: CompanionBehavior, validate?: () => void, recordEffect?: RecordCommandEffect): Promise<boolean>;
    summary(): string;
    static describe({ revision, plan }: {
        revision: number;
        plan: CurrentLifePlan | null;
    }): string;
}
