import { type ActivityPlayback } from '../../living/body/playback.js';
export declare const desktopHomePlayback: (home: unknown) => any;
/** Semantic exclusions from the shipped catalogue; these clips assert a physical activity. */
export declare const eatingClips: Set<string>;
export declare const sleepingClips: Set<string>;
export declare const lifeActivityClips: Readonly<{
    drink: "生活-捧杯喝水";
    read: "生活-专心阅读";
    garden_till: "生活-松土";
    garden_plant: "生活-播种";
    garden_water: "生活-浇水";
    garden_fertilize: "生活-施肥";
    garden_harvest: "生活-采收";
    garden_sell: "生活-整理交易";
    garden_buySeed: "生活-整理交易";
    garden_buyCompost: "生活-整理交易";
}>;
export declare const physicalClips: Set<string>;
export declare function activityPresentation(state: any, expression?: string): {
    exclusive: boolean;
    action: undefined;
    notice: undefined;
    gap: boolean;
    activityId?: undefined;
    phase?: undefined;
    progress?: undefined;
    playback?: undefined;
} | {
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
    playback: ActivityPlayback;
    notice: string | undefined;
};
/** A renderer-only projection. Never return this from the configuration editor's read endpoint. */
export declare function projectActivityConfig(config: any, state: any, expression?: string): any;
