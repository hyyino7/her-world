import type { BodyPhase, ExecutionPhase, FeedAdmission } from '../../contracts/behavior.js';
/** 运行中的 waiting 和 completed 在身体画面中与 pending 一起显示为待执行。 */
export declare function bodyPhaseOf(phase: ExecutionPhase): BodyPhase;
interface PresentedCompanion {
    asleep: boolean;
    walking: boolean;
    busy: boolean;
    kind: string;
}
/** 吃饭准入使用 homeView 的画面状态，呈现分类器用自己的分类选画面。 */
export declare function feedAdmission(her: PresentedCompanion | null | undefined): FeedAdmission;
export {};
