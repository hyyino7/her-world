import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import '../hostContract.ts';
import type { WorldConfig } from '../types.ts';
import type { WorldNames } from '../worldPrompt.ts';
import { type LifeTimers } from './alarmTimer.ts';
import type { LifeHost } from './host.ts';
import type { LifeStore } from './lifeStore.ts';
import type { Notifier } from './notify.ts';
import type { PhotoStore } from './photos.ts';
import type { Alarm, LifeOptions, Review, FactRef } from './types.ts';
export interface LifeDeps {
    ctx: Context;
    config: WorldConfig;
    /** Shared identity may expose getters so renaming does not restart Life. */
    names?: WorldNames;
    options: LifeOptions;
    store: LifeStore;
    host: LifeHost;
    notifier: Notifier;
    clock?: () => Date;
    timers?: LifeTimers;
    /** CNY her home may spend a day; undefined or absent is no limit. */
    dailyBudget?: () => number | undefined;
    /** Current home ledger total. Unavailable leaves today's spend and reminder untouched. */
    spentToday?: (homeSessionId: string, day: string) => {yuan: number} | {unavailable: true};
    /** Called after verified diary completion when reviewDiaryStatus is provided; legacy hosts receive it on review delivery. */
    afterReview?: () => void;
    /** Opt-in native write receipt verification; existing old diaries are retained. */
    reviewDiaryStatus?: (day:string,session:Agent['session'],messageId:string) => 'written'|'existing'|'missing';
    /** Read-only facts appended after the user's alarm template is rendered. */
    alarmContext?: (now: Date) => string | undefined;
    photos?: () => PhotoStore;
    /** Her room's workspace; the life line reaches only its sessions. Absent, every session of hers. */
    inWorkspace?: (sessionId: string) => boolean;
    /** A durable plan suppresses the old morning fallback and early-stop prompt. */
    hasCurrentPlan?: () => boolean;
    /** Opt in to durable decisions for every native Life wake, including first arrival and return. */
    requirePlanningDecision?: boolean;
    /** Nonnegative integer correction budget for missing saves; defaults to one, never a life cadence. */
    planningRepairAttempts?: () => number;
    /** Join the plan owner's queue, including body controls awaiting execution. */
    serializePlanChange?: <T>(work: () => T) => Promise<T>;
    /** The plan owner commits its next consideration and alarm in one store update. */
    setNextConsideration?: (at: string | undefined, note: string, reason?: 'schedule' | 'cancel') => void;
    /** Persist a failed autonomous wake's retry projection; runtime retains native backoff. */
    onPlanningFailure?: (at: string, reason: string) => void;
    /** Durable domain facts; Life retains references, never another fact authority. */
    facts?: {
        pending(): Promise<FactRef[]>;
        read(refs: readonly FactRef[]): Promise<{text: string; facts: readonly unknown[]}>;
        /** Prove this exact native input is durable before clearing domain pending state. */
        /** True if durable; false only when the original log was readable and lacked this input. */
        confirmAdmission(sessionId: string, messageId: string, sourceDigest: string): Promise<boolean>;
        acknowledge(refs: readonly FactRef[]): Promise<void>;
    };
}
/**
 * Her life line: one pending alarm, kept in life.json and delivered into her home with `agent.steer`, the
 * tools she sets it with, the home itself, a new home's greeting and the evening look back. The parts live in
 * their own modules; this wires them.
 */
export declare function createLifeRuntime(deps: LifeDeps): {
    start: (options?: {
        resumed?: boolean;
    }) => Promise<void>;
    stop: () => void;
    planNext: (input: {
        at?: string;
        after_minutes?: number;
    }, note: string, validate?: () => void) => string | Promise<string>;
    checkAlarm: () => string;
    cancelAlarm: (validate?: () => void) => string | Promise<string>;
    deliver: () => Promise<void>;
    reschedule: () => void;
    reschedulePlan: () => void;
    /** Coalesce notifications, then discover unacknowledged domain references. */
    notifyFacts: () => void;
    acceptsFactMessage: (sessionId: string, message: {id: string; source: unknown}) => boolean;
    snapshot: () => {
        homeSessionId: string | undefined;
        alarm: Alarm | undefined;
        review: Review | undefined;
        pendingReviews: import("./types.ts").LifeState['pendingReviews'];
        spend: import("./types.ts").Spend | undefined;
        currentPlan: unknown;
        planRevision: number | undefined;
        planningRecovery: import("./types.ts").PlanningRecovery | undefined;
        faults: string[];
    };
    /** Resolves once no alarm delivery is in flight (its durability flush can outlast the turn it starts). */
    settled: () => Promise<void>;
    home: () => Promise<Agent>;
    /** Whether this session is her home now; the world prompt gives the home its world line. */
    isHome: (sessionId: string) => boolean;
};
export type LifeRuntime = ReturnType<typeof createLifeRuntime>;
