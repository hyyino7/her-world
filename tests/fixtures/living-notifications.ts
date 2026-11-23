import {Context} from '@deepseek-ai/cordis';
import type {PetCoreHost} from '../../src/core/index.js';
import {LivingView, LivingWorld, type LivingPorts} from '../../src/living/index.js';

export function livingNotifications(t: {after(cleanup: () => void): void}, ctx: Context,
  host: PetCoreHost, area: 'body' | 'economy', ports: LivingPorts = {}) {
  const {world, release} = LivingWorld.retain(new Context(), host, area);
  t.after(release);
  return new LivingView(ports, undefined, undefined, undefined,
    (scope, bodyOnly, observation) => world.changed(ctx, host, () => true, scope, bodyOnly, observation));
}
