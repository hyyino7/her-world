import { type GardenClock } from '../economy/garden-clock.js';
import type { CompanionEmotion } from '../../emotion/plugin.js';
import { type PlannedActivity, type PlannedExecution, type BehaviorAnimationContext, type BodyMetric, type PlanTradeOperation, type ReadingState } from '../../contracts/behavior.js';
import type { CompanionFact, CompanionFactActor } from '../../contracts/interaction.js';
export interface RoomInteractionContext {
    requestId: string;
    actor: CompanionFactActor;
}
export interface OfflineBodyPolicy {
    hours: number;
    needCeiling: number;
    energyFloor: number;
}
export interface RoomFoodReservation {
    opId: string;
    status: 'reserved' | 'consumed' | 'cancelled';
    itemId: string;
    effects: Partial<Record<BodyMetric, number>>;
    label: string;
    /** Trusted catalog portrayal captured with the actual consumption checkpoint. */
    presentationSlot?: string;
}
export interface RoomReadingInput {
    itemId: string;
    segment: number;
}
export interface RoomReadingSegment extends RoomReadingInput {
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
}
export interface RoomEconomyPort {
    /** Complete legacy aggregate, with authoritative wallet and inventory projection. */
    loadGarden(now: number, clock?: GardenClock): any;
    saveGarden(state: any, now: number): any;
    actGarden(input: Record<string, unknown>, now: number, clock?: GardenClock): {
        ok: boolean;
        message: string;
        garden: any;
    };
    gardenRules(): any;
    transaction(operationId: string, input: {
        type: PlanTradeOperation;
        itemId: string;
        quantity: number;
    }, now: number): {
        status: 'completed' | 'failed' | 'waiting';
        message?: string;
    };
    /** Validate current catalog eligibility and available stock without a write. */
    preflightFood(itemId: string): void;
    /** Read-only registered catalog metadata, never inferred from item labels. */
    foodPresentation?(itemId: string): string | undefined;
    reserveFood(operationId: string, itemId: string, now: number): RoomFoodReservation;
    finishFood(operationId: string, proof: {
        operationId: string;
        applied: boolean;
        bodyReceiptId: string;
    }, now: number): RoomFoodReservation;
    inspectUse(operationId: string): RoomFoodReservation | undefined;
    consoleFoodPending?(operationId: string): boolean;
    cancelUse(operationId: string, proof: {
        operationId: string;
        applied: false;
        bodyReceiptId: string;
    }, now: number): RoomFoodReservation | undefined;
    readSegment(operationId: string, input: RoomReadingInput, now: number): RoomReadingSegment;
    confirmRead(operationId: string, receiptToken: string, now: number): {
        status: 'confirmed';
        itemId: string;
        segment: number;
    };
    readingStatus(operationId: string, input: RoomReadingInput): {
        status: ReadingState;
        itemId: string;
        segment: number;
    };
}
/** All callers enter through CompanionBehavior's serialized workspace binding.
 * The caretaker checkpoints motion and receipt-bearing garden jobs itself. */
export declare class CompanionRoom {
    private emotion;
    private economy;
    private offlinePolicy;
    private lifeClock;
    state: any;
    private dirty;
    private readonly homeFile;
    private readonly gardenFile;
    private readonly caretaker;
    private autonomous;
    private economyFault?;
    private economyBlocked;
    private lastUnavailableCheckpoint;
    private returningFromInteraction;
    private acceptingFoodInteraction?;
    constructor(directory: string, emotion: () => ReturnType<CompanionEmotion['roomSnapshot']>, economy?: (legacyGardenFile: string) => RoomEconomyPort | undefined, offlinePolicy?: () => OfflineBodyPolicy, lifeClock?: () => GardenClock | undefined);
    private economyPort;
    private gardenAuthorityUnavailable;
    private requireEconomy;
    private loadGardenState;
    /** Undefined means clock intent has not been restored, never an owner pause.
     * Keep elapsed crop time until an explicit admission establishes otherwise. */
    gardenClockState(): boolean | undefined;
    private gardenClock;
    private saveGardenState;
    private gardenUnavailable;
    private requestedActive;
    private stopAutomatic;
    setAutonomy(enabled: boolean, now?: number, preserveElapsed?: boolean): void;
    /** Component disposal stops this executor, not the saved owner's clock.
     * Settle before releasing it so a replacement cannot lose projected growth. */
    suspendAutonomy(now?: number): void;
    private checkpoint;
    flush(): void;
    nextWakeAt(now?: number, conditions?: readonly {
        metric: string;
        comparison: string;
        value: number;
    }[]): number | null;
    private interactions;
    private interaction;
    interactionFact(input: unknown, source: RoomInteractionContext): CompanionFact | undefined;
    pendingFacts(): CompanionFact[];
    readFacts(ids: readonly string[]): CompanionFact[];
    acknowledgeFacts(ids: readonly string[]): void;
    private forgetInteractionReturn;
    private returnFromInteraction;
    private executions;
    private currentExecution;
    private publicExecution;
    private updateExecution;
    private parkExecution;
    private dispatchEconomy;
    private consoleFoodPending;
    private dispatchReading;
    private dispatchExecution;
    private planAdmissionWait;
    private executionRecord;
    startPlanned(input: PlannedActivity, now?: number, ownerMeal?: boolean): PlannedExecution;
    consumeFood(input: {
        operationId: string;
        itemId: string;
        interaction?: RoomInteractionContext;
    }, now?: number): PlannedExecution;
    private startOwnerFood;
    private checkedReading;
    readPlannedSegment(operationId: string, now?: number): RoomReadingSegment;
    confirmPlannedReading(operationId: string, receiptToken: string, now?: number): PlannedExecution;
    inspectPlanned(operationId: string, now?: number): PlannedExecution | undefined;
    originalFood(operationId: string): {
        execution: PlannedExecution;
        operationId: string;
        itemId: string | undefined;
        requestId: string | undefined;
        actor: CompanionFactActor | undefined;
        applied: boolean;
        declined: boolean;
        settled: boolean;
    } | undefined;
    plannedState(): PlannedExecution | undefined;
    private presentationBase;
    private presentationCue;
    /** The owned destination dwell proves arrival, including after a reopen. */
    private completeMove;
    /** Only an owned physical route arrival establishes a new quiet phase.
     * A moving receipt with its persisted arrival also covers the existing
     * physical-save/phase-ack crash boundary, without inventing an old onset. */
    private roomArrival;
    private pausedDuration;
    private pausePresentation;
    private resumePresentation;
    /** A read-only display context; receipts and the existing executor remain
     * authoritative. Acknowledgement never changes visual event identity. */
    private animationContext;
    /** Classification neither delivers text nor advances bookmarks. */
    presentationActivity(): {
        presentationKind?: 'read' | 'reading-wait' | 'rest';
        readingState?: ReadingState;
        animationContext?: BehaviorAnimationContext;
    };
    pausePlanned(operationId: string, now?: number, reason?: string): PlannedExecution;
    resumePlanned(operationId: string, now?: number): PlannedExecution;
    cancelPlanned(operationId: string, now?: number): PlannedExecution;
    private interruptPlanned;
    /** Older same-bed waits have a real execution receipt but no explicit wait
     * flag. Restore only that semantic distinction before either physics path;
     * an unowned legacy physical endpoint retains its original finite meaning. */
    private preserveAcceptedSleepWait;
    tick(now?: number): any;
    private tickAvailable;
    view(now?: number): any;
    act(input: unknown, by?: string, now?: number, interaction?: RoomInteractionContext): {
        ok: boolean;
        changed: boolean;
        event: any;
        home: any;
        room?: any;
        fact?: CompanionFact;
    };
    garden(operation: 'state' | 'act' | 'control', input: unknown, now?: number): {
        ok: boolean;
        accepted?: boolean;
        status?: string;
        message: string;
        garden?: any;
        home?: any;
    } | {
        ok: boolean;
        garden: any;
    } | {
        message: string;
        execution: PlannedExecution;
        garden: any;
        home: any;
        ok: boolean;
        accepted?: boolean;
        status?: string;
    };
    private actLegacyGarden;
}
