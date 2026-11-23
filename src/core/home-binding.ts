import {isWorldChangeFor} from '../contracts/living.js';
import type {HomeBinding} from './workspace.js';

export {isWorldChangeFor};

export function sameHomeBinding(current: HomeBinding | undefined, captured: HomeBinding | undefined) {
  return current === captured || !!current && current.path === captured?.path && isWorldChangeFor(current, captured);
}
