/** 运行中的 waiting 和 completed 在身体画面中与 pending 一起显示为待执行。 */
export function bodyPhaseOf(phase) {
    return phase === 'moving' || phase === 'working' ? phase : 'pending';
}
const mealInsertionKinds = ['idle', 'play', 'idle_look', 'react_happy', 'react_pout', 'react_shy', 'react_scare'];
/** 吃饭准入使用 homeView 的画面状态，呈现分类器用自己的分类选画面。 */
export function feedAdmission(her) {
    if (!her || her.asleep || her.walking)
        return 'blocked';
    if (her.kind === 'eat')
        return 'already-presented';
    return !her.busy && mealInsertionKinds.includes(her.kind) ? 'start' : 'blocked';
}
//# sourceMappingURL=activity.js.map