import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {emptyHomeState} from '#feiyu-home';
import {CompanionBehavior} from '../../dist/src/living/body/plugin.js';
import {Room} from '../../dist/src/room/plugin.js';

test('native garden care returns the same playback as the Room window after acceptance', async t => {
  const path = mkdtempSync(join(tmpdir(), 'room-garden-tool-'));
  const target = {id: 'fixture', path};
  const now = new Date(2026, 10, 12, 12).getTime();
  t.mock.timers.enable({apis: ['Date'], now});
  const directory = join(path, '.chatpet/data/behavior');
  mkdirSync(directory, {recursive: true});
  const home = emptyHomeState(now);
  home.lastInteractionAt = 0;
  home.needs = {hunger: .1, thirst: .1, bladder: .1, energy: .9, pain: 0};
  writeFileSync(join(directory, 'home.json'), JSON.stringify(home));
  const host = {native: {isAutonomous: () => false, manages: id => id === 'owner-session', validate() {}}, workspace: {
    status: () => ({state: 'ready', target}),
    storageId: () => target.id,
    homeScope: () => ({workspaceId: target.id, path, storageId: target.id, bootId: 'fixture', generation: 0}),
    runtime: {config: {ownerActorId: 'owner', companionId: 'fish'}, identity: () => ({displayName: 'Fixture'}), store: {meta: () => undefined}},
  }};
  const ctx = {petCore: host, get petBehavior() {return behavior;},
    get: name => name === 'petBehavior' ? behavior : undefined,
    on: () => () => {}, petWorld: {sessionStatus: () => ({state: 'ready'})}};
  const behavior = new CompanionBehavior(ctx, host);
  const room = new Room(ctx);
  t.after(async () => {await room.close();await behavior.close();rmSync(path, {recursive: true, force: true});});
  const signal = new AbortController().signal;
  const garden = room.tools().find(tool => tool.name === 'room_garden');
  const result = JSON.parse(await garden.execute({type: 'visit', view: 'full'}, {agent: {id: 'owner-session'}, callId: 'visit', signal}));
  assert.equal(result.accepted, true);
  assert.equal(result.home.her.walking, true);
  assert.equal(result.home.playback?.kind, 'walk');
  const window = await room.request(target.id, 'roomState', {}, 'state', signal);
  assert.deepEqual(result.home.playback, JSON.parse(JSON.stringify(window.playback)));
});
