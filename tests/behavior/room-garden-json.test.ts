import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Context} from '@deepseek-ai/cordis';
import type {PetCoreHost} from '../../src/core/index.js';
import {emptyHomeState, homeView} from '#feiyu-home';
import {createGarden} from '#feiyu-garden';
import {canonical} from '../../src/core/storage.js';
import {CompanionBehavior} from '../../src/living/body/plugin.js';
import {Room} from '../../src/room/plugin.js';
import type {WorldChanged} from '../../src/contracts/living.js';
import {livingNotifications} from '../fixtures/living-notifications.js';

const jobs = [
  {action: {type: 'buySeed', cropId: 'tomato', quantity: 1}, plotId: null},
  {action: {type: 'sell', cropId: 'tomato', quantity: 1}, plotId: null},
  {action: {type: 'buyCompost', quantity: 1}, plotId: null},
  {action: {type: 'visit'}, plotId: null},
  {action: {type: 'water', plotId: 0}, plotId: 0},
];

for (const {action, plotId} of jobs) test(`Room ${action.type} stays JSON-safe through walking, work and completion`, async t => {
  const root = mkdtempSync(join(tmpdir(), 'room-garden-json-'));
  let behavior: CompanionBehavior;
  let room: Room;
  t.after(async () => {
    try {await room?.close(); await behavior?.close();}
    finally {rmSync(root, {recursive: true, force: true});}
  });
  const now = new Date(2026, 10, 12, 12).getTime();
  t.mock.timers.enable({apis: ['Date'], now});
  const directory = join(root, '.chatpet/data/life');
  mkdirSync(directory, {recursive: true});
  const body = emptyHomeState(now);
  body.lastInteractionAt = 0;
  body.needs = {hunger: .1, thirst: .1, bladder: .1, energy: .9, pain: 0};
  const garden = createGarden(now);
  garden.plots[0].progress = .3;
  garden.plots[0].tilled = true;
  garden.plots[0].cropId = 'tomato';
  garden.plots[0].plantedAt = now;
  garden.care.autoEnabled = false;
  garden.coins = 100;
  garden.inventory.tomato = 2;
  writeFileSync(join(directory, 'home.json'), JSON.stringify(body));
  writeFileSync(join(directory, 'garden.json'), JSON.stringify(garden));
  const target = {id: 'fixture', path: root, sessionIds: []};
  const host = {native: {}, workspace: {status: () => ({state: 'ready', target}), storageId: () => target.id,
    homeScope: () => ({workspaceId:target.id,path:target.path,storageId:target.id,bootId:'fixture',generation:0}),
    runtime:{config:{ownerActorId:'owner',companionId:'fish'},identity:()=>({displayName:'Fixture'}),store:{meta:()=>undefined}}}} as unknown as PetCoreHost;
  const events: WorldChanged[] = [];
  const ctx = {petCore: host, get petBehavior() {return behavior;},
    get: (name: string) => name === 'petBehavior' ? behavior : undefined,
    on: () => () => {}, emit: (name: string, value: WorldChanged) => {if (name === 'world.changed') events.push(value);}} as unknown as Context;
  behavior = new CompanionBehavior(ctx, host, livingNotifications(t, ctx, host, 'body'));
  behavior.activate();
  room = new Room(ctx);
  const signal = new AbortController().signal;
  let sequence = 0;
  const request = (endpoint: string, data: Record<string, unknown> = {}) =>
    room.request(target.id, endpoint, data, 'garden-json-' + ++sequence, signal) as Promise<any>;

  const accepted = await request('roomCare', {...action, requestId: 'once'});
  const receiptId=accepted.requestId;
  assert.equal(accepted.accepted, true);
  assert.doesNotThrow(() => canonical(accepted));
  const saved = () => JSON.parse(readFileSync(join(directory, 'home.json'), 'utf8'));
  assert.equal(saved().route.target.gardenPlotId, plotId);
  const walking = await request('roomState');
  assert.equal(walking.her.walking, true);
  assert.doesNotThrow(() => canonical(walking));

  t.mock.timers.tick(Math.ceil(saved().route.arriveAt - Date.now()) + 1);
  await request('roomGarden');
  const working = await request('roomState');
  assert.equal(working.her.gardenWork.plotId, plotId);
  assert.doesNotThrow(() => canonical(working));
  t.mock.timers.tick(Math.ceil(saved().dwell.until - Date.now()) + 1);
  const finished = await request('roomGarden');
  assert.doesNotThrow(() => canonical(finished));
  assert.equal(finished.garden.care.task, null);
  assert.equal(finished.garden.care.receipts.filter((row: any) => row.requestId === receiptId).length, 1);
  assert.equal(finished.garden.care.receipts.find((row: any) => row.requestId === receiptId).status, 'completed');
  assert.ok(events.some(event => event.workspaceId === target.id && event.storageId === target.id
    && event.bootId === 'fixture' && event.generation === 0 && event.bodyOnly),
  'The real Behavior publisher emits successful state changes for the active binding');
});

test('an older non-plot garden task projects an explicit null plot ID', () => {
  const now = new Date(2026, 10, 12, 12).getTime();
  const state = emptyHomeState(now);
  Object.assign(state, {room: 'garden', spot: 'shop', kind: 'garden_buySeed',
    dwell: {until: now + 5000, target: {room: 'garden', spot: 'shop', gardenJobId: 'older-task', gardenAction: 'buySeed'}}});
  const view = homeView(state, now);
  assert.equal(view.her.gardenWork.plotId, null);
  assert.doesNotThrow(() => canonical(view));
});

test('the strict JSON boundary still rejects undefined fields', () => {
  assert.throws(() => canonical({gardenPlotId: undefined}), /Expected plain JSON/);
});
