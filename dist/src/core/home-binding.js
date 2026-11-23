import { isWorldChangeFor } from '../contracts/living.js';
export { isWorldChangeFor };
export function sameHomeBinding(current, captured) {
    return current === captured || !!current && current.path === captured?.path && isWorldChangeFor(current, captured);
}
//# sourceMappingURL=home-binding.js.map