import { check, integer } from './storage.js';
import { parseDesktopAppearance } from '../desktop/appearance.js';
export const DEFAULT_COMPANION_SETTINGS = Object.freeze({
    desktopSize: 232,
    desktopFixed: false,
    desktopConfineToScreen: false,
    desktopClickSound: true,
    desktopReplyBubble: true,
    desktopWhisperEnabled: false,
    desktopWhisperImageEnabled: true,
    desktopSleepTalkSeconds: 60,
    desktopWorkStatusEnabled: true,
    desktopTrayEnabled: true,
    desktopAppearance: {},
    desktopBalanceEnabled: false,
    desktopBalanceMinutes: 30,
    desktopWhisperMinutes: 5,
    desktopBubbleSeconds: 10,
    workAnimationDelaySeconds: 5,
    stickerProbabilityPercent: 35,
    recentActionCount: 10,
    recentActionMinutes: 30,
    recentMoodCount: 3,
    recentMoodHours: 24,
    memorySummaryTurns: 10,
    memorySummaryIdleMinutes: 10,
    memorySummaryMinimumMinutes: 5,
    memoryRecallCount: 8,
    memoryRecallBlockChars: 600,
    offlineBodyHours: 4,
    offlineNeedCeilingPercent: 70,
    offlineEnergyFloorPercent: 35,
});
export const EMPTY_COMPANION_CONFIGURATION = Object.freeze(Object.fromEntries(Object.keys(DEFAULT_COMPANION_SETTINGS).map(key => [key, null])));
const desktopSwitches = Object.keys(DEFAULT_COMPANION_SETTINGS)
    .filter(key => typeof DEFAULT_COMPANION_SETTINGS[key] === 'boolean');
export function isDesktopSwitch(key, value) {
    return Object.hasOwn(DEFAULT_COMPANION_SETTINGS, key) && typeof DEFAULT_COMPANION_SETTINGS[key] === 'boolean' &&
        typeof value === 'boolean';
}
const RANGES = {
    desktopSleepTalkSeconds: [1, 86400], desktopSize: [96, 512], desktopBalanceMinutes: [1, 1440],
    desktopWhisperMinutes: [1, 1440], desktopBubbleSeconds: [1, 300], workAnimationDelaySeconds: [0, 3600],
    stickerProbabilityPercent: [0, 100], recentActionCount: [0, 500], recentActionMinutes: [0, 10080],
    recentMoodCount: [0, 100], recentMoodHours: [0, 720], memorySummaryTurns: [1, 200],
    memorySummaryIdleMinutes: [1, 1440], memorySummaryMinimumMinutes: [0, 1440], memoryRecallCount: [1, 50],
    memoryRecallBlockChars: [128, 4000],
    offlineBodyHours: [0, 168], offlineNeedCeilingPercent: [0, 100], offlineEnergyFloorPercent: [0, 100],
};
export function parseCompanionConfiguration(raw) {
    check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'Invalid companion settings');
    check(Object.keys(raw).every(key => Object.hasOwn(DEFAULT_COMPANION_SETTINGS, key) || key === 'memoryColdHours'), 'Unexpected companion setting');
    const { memoryColdHours, ...current } = raw;
    // A retired, previously inert recall option is tolerated in old workspaces.
    if (memoryColdHours !== undefined && memoryColdHours !== null)
        integer(memoryColdHours, 'legacy memoryColdHours', 1, 720);
    const result = { ...EMPTY_COMPANION_CONFIGURATION, ...current };
    for (const key of desktopSwitches)
        check(result[key] === null || isDesktopSwitch(key, result[key]), 'Invalid Desktop switch');
    for (const [key, range] of Object.entries(RANGES)) {
        const value = result[key];
        if (value !== null)
            integer(value, key, range[0], range[1]);
    }
    if (result.desktopAppearance !== null)
        result.desktopAppearance = parseDesktopAppearance(result.desktopAppearance);
    return result;
}
/** These values make native consumers type-safe; they are never persisted as
 * owner choices. Unconfigured optional effects stay inactive. */
const UNCONFIGURED_RUNTIME = {
    ...DEFAULT_COMPANION_SETTINGS,
    desktopClickSound: false, desktopReplyBubble: false, desktopWhisperEnabled: false,
    desktopWhisperImageEnabled: false, desktopWorkStatusEnabled: false, desktopTrayEnabled: false,
    desktopBalanceEnabled: false, stickerProbabilityPercent: 0,
    recentActionCount: 0, recentActionMinutes: 0, recentMoodCount: 0, recentMoodHours: 0,
};
export function resolveCompanionSettings(configuration) {
    return Object.fromEntries(Object.entries(UNCONFIGURED_RUNTIME).map(([key, fallback]) => [key, configuration[key] ?? fallback]));
}
/** Compatibility entry for native consumers that require complete mechanics. */
export function parseCompanionSettings(raw) {
    return resolveCompanionSettings(parseCompanionConfiguration(raw));
}
//# sourceMappingURL=companion-settings.js.map