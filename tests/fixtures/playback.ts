import {animationSlotAllowed} from '../../src/living/body/animation-slots.js';
import {resolveActivityPlayback as resolve,withHomePlayback as project} from '../../src/living/body/playback.js';

export {animationSlotAllowed,requirePresentationSlot} from '../../src/living/body/animation-slots.js';
export {sampleActivityPlayback,type ActivityPlayback} from '../../src/living/body/playback.js';
export {animationAssets,animationSlots,animationStickers,animationRoomAliases} from '../../src/living/body/animation-map.js';
export const resolveActivityPlayback = (home:unknown) => resolve(home,animationSlotAllowed);
export const withHomePlayback = (home:unknown) => project(home,animationSlotAllowed);
export const animationAllocation = 'src/living/body/animation-allocation.json';
