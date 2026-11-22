import {basename, dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// The fixtures also run against a compiled package in cwd or an explicit
// compiled control alongside its own dependencies.
const sourceDirectory = 'presentation';
const override = process.env.CHATPET_PLAYBACK_TEST_MODULE;
const playbackPath = resolve(override || 'dist/src/' + sourceDirectory + '/playback.js');
const playbackURL = pathToFileURL(playbackPath);
const emittedRoot = new URL(basename(dirname(playbackPath)) === 'presentation' ? '../' : '../../', playbackURL);

export const animationMapURL = new URL('./animation-map.js', playbackURL);
export const animationMapSource = override ? undefined : resolve('src/' + sourceDirectory + '/animation-map.ts');

export function compiledURL(path) {
  return new URL(path, emittedRoot);
}

export async function loadPlayback() {
  const media=await import(playbackURL);
  if (media.animationSlotAllowed) return media;
  const {animationSlotAllowed}=await import(compiledURL('living/body/animation-slots.js'));
  const {classifyActivity}=await import(compiledURL('living/body/presentation.js'));
  return {...media,resolveActivityPlayback:home=>media.resolveActivityPlayback(home,animationSlotAllowed,classifyActivity),
    withHomePlayback:home=>media.withHomePlayback(home,animationSlotAllowed,classifyActivity)};
}
