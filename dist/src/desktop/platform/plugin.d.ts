import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type PresentationMigrationReceipt } from './migration.js';
import { type ConsoleOperation } from '../../core/tables/console.js';
/** Playback reports are renderer-owned; a control token may only query/wait. */
export declare function controlRouteAllowed(rest: string, method: string): boolean;
declare module '@deepseek-ai/cordis' {
    interface Context {
        petPlatform: PetPlatform;
    }
}
export declare const name = "35-PetPlatform";
export declare const inject: string[];
export declare class PetPlatform {
    private ctx;
    private bound?;
    private homeBinding?;
    private directory;
    private ownerToken;
    private toolToken;
    private mediaToken;
    private scope;
    private cleanup;
    private setup;
    private lookup;
    private router?;
    private providers;
    private privateDirectory?;
    private behavior;
    private behaviorKey;
    private animationFeedbackKey;
    private identityKey;
    private expressionAction?;
    private refreshing?;
    private refreshAgain;
    private behaviorRead?;
    private playbackKinds;
    private playbackReported;
    private migration?;
    private restartPresentation?;
    private presentationStatus?;
    constructor(ctx: Context);
    private selected;
    close(): void;
    sync(): void;
    private ensure;
    private pets;
    bodyStatus(): {
        running: boolean;
        requested?: undefined;
        starting?: undefined;
    } | {
        running: boolean;
        requested: boolean;
        starting: boolean;
    };
    featurePreferences(): {
        desktopWhisperEnabled?: undefined;
        desktopBalanceEnabled?: undefined;
        desktopWhisperImageEnabled?: undefined;
        desktopWhisperMinutes?: undefined;
        desktopSleepTalkSeconds?: undefined;
        desktopBalanceMinutes?: undefined;
    } | {
        desktopWhisperEnabled: boolean;
        desktopBalanceEnabled: boolean;
        desktopWhisperImageEnabled: boolean;
        desktopWhisperMinutes: number;
        desktopSleepTalkSeconds: any;
        desktopBalanceMinutes: number;
    };
    savePreference(key: string, value: boolean): Promise<{
        desktopWhisperEnabled: boolean;
        desktopBalanceEnabled: boolean;
        desktopWhisperImageEnabled: boolean;
        desktopWhisperMinutes: number;
        desktopSleepTalkSeconds: number;
        desktopBalanceMinutes: number;
        desktopSize: number;
        desktopFixed: boolean;
        desktopConfineToScreen: boolean;
        desktopClickSound: boolean;
        desktopReplyBubble: boolean;
        desktopWorkStatusEnabled: boolean;
        desktopTrayEnabled: boolean;
        desktopAppearance: Record<string, unknown>;
        desktopBubbleSeconds: number;
        workAnimationDelaySeconds: number;
        stickerProbabilityPercent: number;
        recentActionCount: number;
        recentActionMinutes: number;
        recentMoodCount: number;
        recentMoodHours: number;
        memorySummaryTurns: number;
        memorySummaryIdleMinutes: number;
        memorySummaryMinimumMinutes: number;
        memoryRecallCount: number;
        memoryRecallBlockChars: number;
        offlineBodyHours: number;
        offlineNeedCeilingPercent: number;
        offlineEnergyFloorPercent: number;
    } | {
        desktopWhisperEnabled: boolean;
        desktopBalanceEnabled: boolean;
        desktopWhisperImageEnabled: boolean;
        desktopWhisperMinutes: number;
        desktopSleepTalkSeconds: any;
        desktopBalanceMinutes: number;
        desktopSize: number;
        desktopFixed: boolean;
        desktopConfineToScreen: boolean;
        desktopClickSound: boolean;
        desktopReplyBubble: boolean;
        desktopWorkStatusEnabled: boolean;
        desktopTrayEnabled: boolean;
        desktopAppearance: Record<string, unknown>;
        desktopBubbleSeconds: number;
        workAnimationDelaySeconds: number;
        stickerProbabilityPercent: number;
        recentActionCount: number;
        recentActionMinutes: number;
        recentMoodCount: number;
        recentMoodHours: number;
        memorySummaryTurns: number;
        memorySummaryIdleMinutes: number;
        memorySummaryMinimumMinutes: number;
        memoryRecallCount: number;
        memoryRecallBlockChars: number;
        offlineBodyHours: number;
        offlineNeedCeilingPercent: number;
        offlineEnergyFloorPercent: number;
    }>;
    saveTiming(workspaceId: string, expected: unknown, next: unknown): Promise<{
        path: string;
        pets: never[];
        running: boolean;
        timing?: undefined;
        migration?: undefined;
        activity?: undefined;
        representation?: undefined;
        packsDirectory?: undefined;
    } | {
        path: string;
        pets: {
            id: any;
            name: any;
            display: any;
            position: any;
            assetRoot: any;
        }[];
        running: boolean;
        timing: any;
        migration: PresentationMigrationReceipt | undefined;
        activity: any;
        representation: {
            packGaps: any[];
            exclusive: boolean;
            action: undefined;
            notice: undefined;
            gap: boolean;
            activityId?: undefined;
            phase?: undefined;
            progress?: undefined;
            playback?: undefined;
        } | {
            packGaps: any[];
            exclusive: boolean;
            action: string;
            gap: boolean;
            activityId: string | null;
            phase: string;
            progress: {
                now: any;
                etaMs: any;
                gardenWork: any;
            };
            playback: import("../../presentation/playback.js").ActivityPlayback;
            notice: string | undefined;
        };
        packsDirectory: string;
    }>;
    resolveMigration(workspaceId: string, field: string, choice: 'legacy' | 'current', expectedConfigHash: string): {
        path: string;
        pets: never[];
        running: boolean;
        timing?: undefined;
        migration?: undefined;
        activity?: undefined;
        representation?: undefined;
        packsDirectory?: undefined;
    } | {
        path: string;
        pets: {
            id: any;
            name: any;
            display: any;
            position: any;
            assetRoot: any;
        }[];
        running: boolean;
        timing: any;
        migration: PresentationMigrationReceipt | undefined;
        activity: any;
        representation: {
            packGaps: any[];
            exclusive: boolean;
            action: undefined;
            notice: undefined;
            gap: boolean;
            activityId?: undefined;
            phase?: undefined;
            progress?: undefined;
            playback?: undefined;
        } | {
            packGaps: any[];
            exclusive: boolean;
            action: string;
            gap: boolean;
            activityId: string | null;
            phase: string;
            progress: {
                now: any;
                etaMs: any;
                gardenWork: any;
            };
            playback: import("../../presentation/playback.js").ActivityPlayback;
            notice: string | undefined;
        };
        packsDirectory: string;
    };
    show(): Promise<{
        path: string;
        pets: never[];
        running: boolean;
        timing?: undefined;
        migration?: undefined;
        activity?: undefined;
        representation?: undefined;
        packsDirectory?: undefined;
    } | {
        path: string;
        pets: {
            id: any;
            name: any;
            display: any;
            position: any;
            assetRoot: any;
        }[];
        running: boolean;
        timing: any;
        migration: PresentationMigrationReceipt | undefined;
        activity: any;
        representation: {
            packGaps: any[];
            exclusive: boolean;
            action: undefined;
            notice: undefined;
            gap: boolean;
            activityId?: undefined;
            phase?: undefined;
            progress?: undefined;
            playback?: undefined;
        } | {
            packGaps: any[];
            exclusive: boolean;
            action: string;
            gap: boolean;
            activityId: string | null;
            phase: string;
            progress: {
                now: any;
                etaMs: any;
                gardenWork: any;
            };
            playback: import("../../presentation/playback.js").ActivityPlayback;
            notice: string | undefined;
        };
        packsDirectory: string;
    }>;
    hide(): Promise<void>;
    private presentExpression;
    private refreshBehavior;
    private readBehavior;
    private activityAsset;
    private playback;
    private reportPlayback;
    private projectConfig;
    private projectIdentity;
    identityChanged(): void;
    ownerAccess(expected?: string): {
        path: string;
        token: string;
        mediaToken: string;
    };
    private baseUrl;
    standaloneAccess(expected?: string): {
        file: string;
    };
    controlAccess(expected: string): {
        baseUrl: string;
        path: string;
        token: string;
    };
    status(): {
        path: string;
        pets: never[];
        running: boolean;
        timing?: undefined;
        migration?: undefined;
        activity?: undefined;
        representation?: undefined;
        packsDirectory?: undefined;
    } | {
        path: string;
        pets: {
            id: any;
            name: any;
            display: any;
            position: any;
            assetRoot: any;
        }[];
        running: boolean;
        timing: any;
        migration: PresentationMigrationReceipt | undefined;
        activity: any;
        representation: {
            packGaps: any[];
            exclusive: boolean;
            action: undefined;
            notice: undefined;
            gap: boolean;
            activityId?: undefined;
            phase?: undefined;
            progress?: undefined;
            playback?: undefined;
        } | {
            packGaps: any[];
            exclusive: boolean;
            action: string;
            gap: boolean;
            activityId: string | null;
            phase: string;
            progress: {
                now: any;
                etaMs: any;
                gardenWork: any;
            };
            playback: import("../../presentation/playback.js").ActivityPlayback;
            notice: string | undefined;
        };
        packsDirectory: string;
    };
    private nativeChat;
    /** Current shared clips and built-in life names use the same bytes as Room.
     * Keep user files/packs intact; other names retain upstream routing. */
    private builtinLifeMedia;
    private builtinMedia;
    /** Keep the original sleep/wake and ordinary action lock admission. */
    private careBlocked;
    private openRoom;
    private feedAnimation;
    handle(url: URL, method: string, raw: string | undefined, signal: AbortSignal, actorKind?: 'owner' | 'companion'): Promise<any>;
    http(req: IncomingMessage, res: ServerResponse): Promise<any>;
}
export declare function platformConsoleOperations(platform: Pick<PetPlatform, 'ownerAccess' | 'controlAccess' | 'standaloneAccess' | 'saveTiming' | 'resolveMigration' | 'status'>): {
    operations: Record<string, ConsoleOperation>;
    status: () => {
        path: string;
        pets: never[];
        running: boolean;
        timing?: undefined;
        migration?: undefined;
        activity?: undefined;
        representation?: undefined;
        packsDirectory?: undefined;
    } | {
        path: string;
        pets: {
            id: any;
            name: any;
            display: any;
            position: any;
            assetRoot: any;
        }[];
        running: boolean;
        timing: any;
        migration: PresentationMigrationReceipt | undefined;
        activity: any;
        representation: {
            packGaps: any[];
            exclusive: boolean;
            action: undefined;
            notice: undefined;
            gap: boolean;
            activityId?: undefined;
            phase?: undefined;
            progress?: undefined;
            playback?: undefined;
        } | {
            packGaps: any[];
            exclusive: boolean;
            action: string;
            gap: boolean;
            activityId: string | null;
            phase: string;
            progress: {
                now: any;
                etaMs: any;
                gardenWork: any;
            };
            playback: import("../../presentation/playback.js").ActivityPlayback;
            notice: string | undefined;
        };
        packsDirectory: string;
    };
};
export declare function apply(ctx: Context): void;
