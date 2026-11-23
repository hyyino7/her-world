import type { BehaviorPresentation, CompanionExpression } from '../../contracts/behavior.js';
import { type CompanionFeeling } from '../../contracts/emotion.js';
/** Shared semantic names; displays choose their own existing assets. */
export declare const companionFeelings: readonly ["happy", "calm", "sweet", "heartache", "worry", "sad", "jealous", "anger", "boredom"];
export declare const feelingLabels: Record<CompanionFeeling, string>;
/** The actual activity takes precedence. A live touch still needs a single known feeling. */
export declare function classifyActivity(home: any): {
    kind: string;
    physical: string | undefined;
    rest: boolean;
    feelings: ("happy" | "calm" | "sweet" | "heartache" | "worry" | "sad" | "jealous" | "anger" | "boredom")[];
    feeling: "happy" | "calm" | "sweet" | "heartache" | "worry" | "sad" | "jealous" | "anger" | "boredom" | undefined;
    touchFeeling: "happy" | "calm" | "sweet" | "heartache" | "worry" | "sad" | "jealous" | "anger" | "boredom" | undefined;
    namedRestHint: boolean;
};
/** Preserve the legacy semantic response built from the common activity intent. */
export declare function behaviorPresentation(home: any, expression?: CompanionExpression, intent?: {
    kind: string;
    physical: string | undefined;
    rest: boolean;
    feelings: ("happy" | "calm" | "sweet" | "heartache" | "worry" | "sad" | "jealous" | "anger" | "boredom")[];
    feeling: "happy" | "calm" | "sweet" | "heartache" | "worry" | "sad" | "jealous" | "anger" | "boredom" | undefined;
    touchFeeling: "happy" | "calm" | "sweet" | "heartache" | "worry" | "sad" | "jealous" | "anger" | "boredom" | undefined;
    namedRestHint: boolean;
}): BehaviorPresentation;
