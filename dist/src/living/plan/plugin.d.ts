import { type ConsoleOperation } from '../../core/tables/console.js';
import type { Context } from '@deepseek-ai/cordis';
import type { PetCoreHost } from '../../core/index.js';
import type { HomeBinding } from '../../core/workspace.js';
import { type LifePreferences } from './library.js';
import type { RecordOperation } from '../../core/records.js';
import { type CurrentLifePlan } from './plan.js';
import { type CompanionFact } from '../../contracts/interaction.js';
import { type PlannedExecution } from '../../contracts/behavior.js';
import type { WorldCommands } from '../../contracts/living.js';
import { type GardenClock } from '../economy/garden-clock.js';
import { LivingView, type CommandAdmission, type LivingPorts } from '../index.js';
/** The upstream fact layer is the only state writer. World owns scheduling,
 * journal and native home recovery; Core owns every model step and Memory. */
export declare class CompanionLife {
    private ctx;
    private host;
    private preset;
    private binding?;
    private runtime?;
    private drainingRuntime?;
    private enabled;
    private restoredClock;
    private pauses?;
    private preferences;
    private closed;
    private closing?;
    private readonly living;
    private readonly inFlight;
    private fault?;
    private serial;
    private timer?;
    private tickGuards;
    private subscriptions;
    private sourceRegistration?;
    readonly timeZone: string;
    constructor(ctx: Context, host: PetCoreHost, preset: string, ports?: LivingPorts | LivingView);
    activate(): void;
    registerSource(): void;
    /** Domain changes and native alarms wake Life; an idle world needs no pump. */
    noticeDomainChange(scope: HomeBinding, sourceCurrent: () => boolean): void;
    private scheduleTick;
    private notifyLife;
    private native;
    private isOpen;
    private assertOpen;
    private guardArea;
    private enqueue;
    private current;
    private isCurrentBinding;
    private assertCurrentBinding;
    running(): boolean;
    /** Saved clock intent is independent of native planner readiness. This read
     * never waits on Life's queue or initializes a missing control directory. */
    bodyClockState(workspaceId: string): (GardenClock & {
        restoreElapsed: boolean;
    }) | undefined;
    isHome(id: string): boolean;
    homeSessionId(): string | undefined;
    private publishRest;
    private directory;
    private synchronize;
    applyHomeArrival(scope: HomeBinding, sessionId: string): boolean;
    private notifyWorld;
    private startRuntime;
    private stopRuntime;
    private tick;
    private scheduleContinuation;
    private resumeAcceptedPlan;
    private factSource;
    private pendingFacts;
    snapshot(workspaceId: string): Promise<{
        home: any;
        life: import("../../../vendor/dsh-world/lib/life/types.js").LifeState | {
            homeSessionId: string | undefined;
            alarm: import("../../../vendor/dsh-world/lib/life/types.js").Alarm | undefined;
            review: import("../../../vendor/dsh-world/lib/life/types.js").Review | undefined;
            pendingReviews: import("../../../vendor/dsh-world/lib/life/types.js").LifeState["pendingReviews"];
            spend: import("../../../vendor/dsh-world/lib/life/types.js").Spend | undefined;
            currentPlan: unknown;
            planRevision: number | undefined;
            planningRecovery: import("../../../vendor/dsh-world/lib/life/types.js").PlanningRecovery | undefined;
            faults: string[];
        };
        activity: import("../../../vendor/dsh-world/lib/life/types.js").ActivityRecord[];
        fault: string | null;
        workspaceId: string;
        enabled: boolean;
        running: boolean;
        timeZone: string;
        preferences: {
            wake: string;
            review: string;
            dailyBudget: number | null;
            compactAfterReview: boolean | null;
            planningRepairAttempts: number | null;
        };
    }>;
    /** Synchronous, read-only prompt projection; no implicit scheduling or model calls. */
    currentPlanSummary(workspaceId: string): string;
    private checkedPlan;
    readPlan(workspaceId: string, validate?: () => void): Promise<{
        revision: number;
        plan: CurrentLifePlan | null;
        enabled: boolean;
        running: boolean;
    }>;
    readonly worldCommands: Pick<WorldCommands, 'executePlanStep' | 'confirmReading'>;
    updatePlan(workspaceId: string, expectedRevision: number, raw: unknown, validate?: () => void): Promise<{
        revision: number;
        plan: CurrentLifePlan | null;
        enabled: boolean;
        running: boolean;
    }>;
    keepPlan(workspaceId: string, expectedRevision: number, reason: string, nextConsiderAt: string | null, validate?: () => void): Promise<{
        revision: number;
        plan: CurrentLifePlan | null;
    }>;
    private checkReadingPlan;
    readPlannedSegment(workspaceId: string, expectedRevision: number, operationId: string, validate?: () => void): Promise<{
        operationId: string;
        confirmation: string;
        title: string;
        version: string;
        totalSegments: number;
        text: string;
        startOffset: number;
        endOffset: number;
        nextSegment: number | null;
        receiptToken: string;
        source: {
            kind: string;
            name: string;
        };
        itemId: string;
        segment: number;
    }>;
    confirmPlannedReading(workspaceId: string, expectedRevision: number, operationId: string, receiptToken: string, validate?: () => void, command?: CommandAdmission): Promise<{
        revision: number;
        plan: CurrentLifePlan | null;
        execution: PlannedExecution;
    }>;
    controlPlan(workspaceId: string, expectedRevision: number, action: 'pause' | 'resume' | 'cancel', reason: string, validate?: () => void): Promise<{
        revision: number;
        plan: CurrentLifePlan | null;
    }>;
    private writeControl;
    control(workspaceId: string, enabled: boolean, validate?: () => void): Promise<{
        enabled: boolean;
        running: boolean;
    }>;
    act(workspaceId: string, action: string, requestId?: string, channel?: string, validate?: () => void): Promise<{
        home: any;
        behavior: import("../../contracts/behavior.js").BehaviorActivity & {
            revision: number;
            bootId: ReturnType<typeof import("crypto").randomUUID>;
        };
        ok: boolean;
        changed: boolean;
        event: any;
        room?: any;
        fact?: CompanionFact;
    }>;
    private behavior;
    private forwardToBody;
    settings(workspaceId: string, expected: unknown, next: unknown, validate?: () => void): Promise<{
        preferences: LifePreferences;
    }>;
    library(workspaceId: string, operation: RecordOperation, input?: unknown): Promise<string[] | {
        photos: import("../../../vendor/dsh-world/lib/life/photos.js").PhotoSummary[];
        total: number;
        hasMore: boolean;
        limit: number;
        offset: number;
    } | {
        diary: string | null;
        day: string;
        activity: readonly import("../../../vendor/dsh-world/lib/life/types.js").ActivityRecord[];
        dialogue?: undefined;
        diaries?: undefined;
        removed?: undefined;
        mediaType?: undefined;
        data?: undefined;
    } | {
        dialogue: {
            items: import("../../core/review-dialogue.js").DialogueLine[];
            nextOffset: number | undefined;
            coverage: "partial" | "eligible";
        } | undefined;
        diaries: {
            date: string;
            excerpt: string;
        }[];
        removed?: undefined;
        mediaType?: undefined;
        data?: undefined;
    } | {
        removed: boolean;
        dialogue?: undefined;
        diaries?: undefined;
        mediaType?: undefined;
        data?: undefined;
    } | {
        mediaType: any;
        data: string;
        dialogue?: undefined;
        diaries?: undefined;
        removed?: undefined;
    }>;
    close(): Promise<void>;
}
export declare const name = "40-Life";
export declare const inject: string[];
export interface Config {
    agentPreset?: string;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        petLife: CompanionLife;
    }
}
export declare function lifeConsoleOperations(life: Pick<CompanionLife, 'snapshot' | 'control' | 'act' | 'settings'>): {
    operations: {
        lifeView: ConsoleOperation;
        lifeControl: ConsoleOperation;
        lifeAction: ConsoleOperation;
        lifePreferences: ConsoleOperation;
    };
};
export declare function apply(ctx: Context, config?: Config): void;
