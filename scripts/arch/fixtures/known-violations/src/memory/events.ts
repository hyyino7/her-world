export function subscribe(ctx) {
  ctx.on('pet/fixture-unregistered-subscription', () => {});
  ctx.emit('pet/not-declared');
  ctx.on('session/event', () => {});
}
