import type { BehaviorActivity, PlannedActivity } from '../../contracts/behavior.js';
export interface AnimationSlotContext {
    kind: BehaviorActivity['kind'];
    action?: PlannedActivity['action'];
    economy?: Pick<NonNullable<PlannedActivity['economy']>, 'type'>;
    garden?: Record<string, unknown>;
    foodSlot?: PlannedActivity['presentationSlot'];
}
/** One admission rule shared by plan parsing, Body and item metadata. A slot is
 * cosmetic authority only; it cannot grant an item or a new business action. */
export declare function animationSlotAllowed(value: unknown, input: string | AnimationSlotContext): boolean;
export declare function requirePresentationSlot(value: unknown, context: string | AnimationSlotContext): string;
