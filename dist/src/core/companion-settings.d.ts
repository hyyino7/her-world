export declare const desktopAppearanceDefaults: () => {
    [x: string]: unknown;
};
export declare const DEFAULT_COMPANION_SETTINGS: Readonly<{
    desktopSize: 232;
    desktopFixed: false;
    desktopConfineToScreen: false;
    desktopClickSound: true;
    desktopReplyBubble: true;
    desktopWhisperEnabled: false;
    desktopWhisperImageEnabled: true;
    desktopSleepTalkSeconds: 60;
    desktopWorkStatusEnabled: true;
    desktopTrayEnabled: true;
    desktopAppearance: Record<string, unknown>;
    desktopBalanceEnabled: false;
    desktopBalanceMinutes: 30;
    desktopWhisperMinutes: 5;
    desktopBubbleSeconds: 10;
    workAnimationDelaySeconds: 5;
    stickerProbabilityPercent: 35;
    recentActionCount: 10;
    recentActionMinutes: 30;
    recentMoodCount: 3;
    recentMoodHours: 24;
    memorySummaryTurns: 10;
    memorySummaryIdleMinutes: 10;
    memorySummaryMinimumMinutes: 5;
    memoryRecallCount: 8;
    memoryRecallBlockChars: 600;
    offlineBodyHours: 4;
    offlineNeedCeilingPercent: 70;
    offlineEnergyFloorPercent: 35;
}>;
export type CompanionSettings = {
    -readonly [K in keyof typeof DEFAULT_COMPANION_SETTINGS]: K extends 'desktopAppearance' ? Record<string, unknown> : (typeof DEFAULT_COMPANION_SETTINGS)[K] extends boolean ? boolean : number;
};
/** Saved choices stay distinct from runtime mechanics. Null means unconfigured,
 * including when an older document omitted the field entirely. */
export type CompanionConfiguration = {
    [K in keyof CompanionSettings]: CompanionSettings[K] | null;
};
export declare const EMPTY_COMPANION_CONFIGURATION: Readonly<CompanionConfiguration>;
export declare function isDesktopSwitch(key: string, value: unknown): value is boolean;
export declare function parseCompanionConfiguration(raw: unknown): CompanionConfiguration;
export declare function resolveCompanionSettings(configuration: CompanionConfiguration): CompanionSettings;
/** Compatibility entry for native consumers that require complete mechanics. */
export declare function parseCompanionSettings(raw: unknown): CompanionSettings;
