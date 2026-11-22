import {animationSlotAllowed} from '../../src/living/body/animation-slots.js';
import {resolveActivityPlayback as resolve,withHomePlayback as project} from '../../src/presentation/playback.js';

export {animationSlotAllowed,requirePresentationSlot} from '../../src/living/body/animation-slots.js';
export {sampleActivityPlayback,type ActivityPlayback} from '../../src/presentation/playback.js';
export {animationAssets,animationSlots,animationStickers,animationRoomAliases} from '../../src/presentation/animation-map.js';
export const resolveActivityPlayback = (home:unknown) => resolve(home,animationSlotAllowed);
export const withHomePlayback = (home:unknown) => project(home,animationSlotAllowed);
export const animationAllocation = 'src/presentation/animation-allocation.json';
