import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Context } from '@deepseek-ai/cordis';
import type { PetCoreHost } from '../../src/core/index.js';
import { currentPosition, emptyHomeState } from '#feiyu-home';
import { createGarden } from '#feiyu-garden';
import { DesktopFeatures } from '../../src/desktop/features.js';
import { CompanionLife } from '../../src/living/plan/plugin.js';
import { CompanionBehavior } from '../../src/living/body/plugin.js';
import { CompanionRoom } from '../../src/living/body/room.js';
import { CompanionRecordLibrary } from '../../src/core/records.js';
import type { RoomMood } from '../../src/emotion/index.js';
import type {WorldChanged} from '../../src/contracts/living.js';
import {livingNotifications} from '../fixtures/living-notifications.js';

test('visits and ordinary care preserve an autonomous trip and its current position', t => {
  const directory = mkdtempSync(join(tmpdir(), 'companion-autonomous-motion-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const now = new Date(2026, 10, 12, 12, 10).getTime();
  t.mock.timers.enable({apis: ['Date'], now});
  const body = emptyHomeState(now);
  Object.assign(body, {room: 'living', spot: 'sofa', asleep: false, sleepPending: false,
    route: null, dwell: null, command: null, freeTarget: null, reactionUntil: 0,
    nextDecisionAt: 0, lastInteractionAt: 0, lastVisitAt: 0,
    needs: {hunger: 0.1, thirst: 0.72, bladder: 0.1, energy: 0.9, pain: 0}});
  const garden = createGarden(now);
  garden.care.autoEnabled = false;
  writeFileSync(join(directory, 'home.json'), JSON.stringify(body));
  writeFileSync(join(directory, 'garden.json'), JSON.stringify(garden));
  const room = new CompanionRoom(directory, () => undefined);
  room.setAutonomy(true, now);
  room.startPlanned({operationId:'fixture-walk',kind:'room',activity:'Walking to the sink',room:'kitchen',spot:'sink'},now);
  assert.ok(room.state.route, 'An explicitly accepted Life activity starts its trip');
  assert.equal(room.state.companionAction, undefined, 'This is not an owner-requested trip');
  const route = structuredClone(room.state.route);
  t.mock.timers.tick(Math.round((route.arriveAt - route.departAt) / 4));

  const interactions = [
    {input: {action: 'visit'}, changed: true},
    {input: {action: 'visit'}, changed: false}, // Native reopen inside the visit cooldown.
    {input: {action: 'pet'}, changed: true},
    {input: {action: 'feed'}, changed: true},
    {input: {action: 'lamp', on: false}, changed: true},
    {input: {action: 'talk', text: 'Keep going.'}, changed: true},
  ];
  for (const {input, changed} of interactions) {
    const at = Date.now();
    assert.ok(at < route.arriveAt, 'Each interaction happens while the trip is still in progress');
    const expected = currentPosition(room.state, at);
    const result = room.act(input, '伙伴', at);
    assert.equal(result.changed, changed, `${input.action} keeps its original admission behavior`);
    assert.deepEqual(room.state.route, route, `${input.action} must not cancel or restart the route`);
    assert.equal(result.home.her.walking, true);
    assert.ok(Math.hypot(result.home.her.pos[0] - expected[0], result.home.her.pos[1] - expected[1]) < 0.002,
      `${input.action} must leave the body at its current point rather than its destination`);
    t.mock.timers.tick(100);
  }
});

test('the desktop and room use one saved body through pending sleep, arrival, cancellation, restart and rebinding', async t => {
  const base = mkdtempSync(join(tmpdir(), 'companion-body-'));
  t.after(() => rmSync(base, {recursive: true, force: true}));
  const workspaces = ['a', 'b'].map(id => ({id, path: join(base, id), sessionIds: [] as string[]}));
  let target = workspaces[0], generation = 0;
  const now = new Date(2026, 10, 11, 12, 10).getTime();
  t.mock.timers.enable({apis: ['Date'], now});
  for (const workspace of workspaces) {
    const directory = join(workspace.path, '.chatpet/data/life');
    mkdirSync(directory, {recursive: true});
    writeFileSync(join(directory, 'control.json'), JSON.stringify({version: 1, enabled: true}));
    const body = emptyHomeState(now);
    body.lastInteractionAt = now;
    writeFileSync(join(directory, 'home.json'), JSON.stringify(body));
    const garden = createGarden(now);
    garden.care.autoEnabled = false;
    writeFileSync(join(directory, 'garden.json'), JSON.stringify(garden));
  }
  const registry = {get: (id: string) => workspaces.find(w => w.id === id)};
  const host = {native: {}, workspace: {status: () => ({state: 'ready', target}), storageId: () => target.id,
    homeScope: () => ({workspaceId: target.id, path: target.path, storageId: target.id, bootId: 'fixture', generation}),
    runtime:{config:{ownerActorId:'owner',companionId:'fish'},identity:()=>({displayName:'Fixture'}),store:{meta:()=>undefined}}}} as unknown as PetCoreHost;
  const frames: {type: string; value: any}[] = [];
  let mood: RoomMood | undefined = {mood: 78, dims: {happy: 35}};
  let features: DesktopFeatures, life: CompanionLife, behavior: CompanionBehavior;
  const listeners=new Map<string,Set<(...args:any[])=>void>>();
  const context = {
    get(name: string) {
      if (name === 'petLife') return life;
      if (name === 'petBehavior') return behavior;
      if (name === 'petDesktop') return {features};
      if (name === 'workspaceRegistry') return registry;
      if (name === 'petEmotion') return {roomSnapshot: () => mood && {...mood, label: 'current mood', updatedAt: now}};
    },
    tools: {register() {}}, on(name:string,fn:(...args:any[])=>void){const set=listeners.get(name)??new Set();listeners.set(name,set);set.add(fn);return()=>set.delete(fn);}, effect: () => () => {}, emit(name:string,...args:any[]){for(const fn of listeners.get(name)??[])fn(...args);},logger:()=>({warn(){}}),
  } as unknown as Context;
  features = new DesktopFeatures(context, host, (type, value) => frames.push({type, value}), () => true, () => false);
  life = new CompanionLife(context, host, 'standard', {body:()=>behavior});
  behavior = new CompanionBehavior(context, host, livingNotifications(t, context, host, 'body', {plan:()=>life}));
  behavior.activate();
  await behavior.setAutonomy(target.id, true);
  t.after(async () => {await life.close(); await behavior.close(); await features.close();});
  const desktop = (path: string) => features.request({path, method: 'POST'});
  const rest = () => frames.filter(frame => frame.type === 'sleep').at(-1)?.value;
  const pet = await life.act(target.id, 'pet');
  assert.equal(pet.home.her.kind, 'react_happy');
  assert.equal(pet.home.emotion.source, 'chatpet-emotion');
  mood = {mood: 28, dims: {sad: 35}};
  assert.equal((await life.act(target.id, 'pet')).home.her.kind, 'idle_look');
  mood = undefined;
  assert.equal((await life.roomState(target.id)).emotion, null);

  await desktop('/sleep');
  assert.deepEqual(rest(), {sleeping: false, pending: true});
  assert.equal((await life.act(target.id, 'sleep')).changed, false);
  await desktop('/wake');
  assert.deepEqual(life.restState(target.id), {sleeping: false, pending: false});
  await life.act(target.id, 'sleep');
  t.mock.timers.tick(12_000); // The preceding wake reaction finishes before a new trip starts.
  await life.garden(target.id, 'state');
  const homeFile = join(target.path, '.chatpet/data/life/home.json');
  const arriving = JSON.parse(readFileSync(homeFile, 'utf8')).route.arriveAt;
  t.mock.timers.tick(Math.ceil(arriving - Date.now()) + 1);
  await life.garden(target.id, 'state');
  assert.ok(rest().sleeping);
  assert.equal((await life.roomState(target.id)).her.asleep, true);
  const sleepingLamp = await life.roomAction(target.id, {action:'lamp', on:true});
  assert.equal(sleepingLamp.home.env.lamp, false);
  assert.equal(sleepingLamp.home.room.lamp, false);
  assert.equal(sleepingLamp.home.room.events.at(-1).text, 'off');
  await assert.rejects(life.roomAction(target.id, {action: 'command', room: 'living', spot: 'sofa'}, '大肥鱼'), /睡着了/);
  await life.close();
  life = new CompanionLife(context, host, 'standard', {body:()=>behavior});
  await life.roomState(target.id); features.restore();
  assert.ok(rest().sleeping);
  await desktop('/wake');
  assert.equal(JSON.parse(readFileSync(homeFile, 'utf8')).asleep, false);
  assert.equal((await life.roomState(target.id)).room.lamp, true);
  await assert.rejects(life.roomAction(target.id, {action: 'sick'}, '大肥鱼'), /不能/);

  const note = {action: 'talk', text: 'Water the garden together'};
  const [first, second] = await Promise.all([life.roomAction(target.id, note), life.roomAction(target.id, {...note, text: 'Later'})]);
  assert.equal(first.home.room.notes.length, 1);
  assert.equal(second.home.room.notes.length, 2);
  const garden = await life.garden(target.id, 'state');
  assert.equal(garden.garden.plots.length, 8);
  const plotId = garden.garden.plots.find((p: {tilled: boolean}) => !p.tilled).id;
  assert.ok((await life.garden(target.id, 'act', {type: 'till', plotId})).ok);
  const control = {type: 'auto', enabled: false, requestId: 'once'};
  assert.ok((await life.garden(target.id, 'control', control)).ok);
  assert.equal((await life.garden(target.id, 'control', control)).garden.care.receipts.filter((r: {requestId: string}) => r.requestId === 'once').length, 1);
  target = workspaces[1]; generation++;
  await assert.rejects(life.roomAction('a', note), /切换/);
  assert.equal((await life.roomState(target.id)).room.notes.length, 0);
  target = workspaces[0]; generation++;
  assert.deepEqual((await life.roomState(target.id)).room.notes.map((n: {text: string}) => n.text), [note.text, 'Later']);
});

test('paused or absent Life permits explicit body and garden work without passive catch-up or autonomous jobs', async t => {
  const base = mkdtempSync(join(tmpdir(), 'companion-paused-'));
  t.after(() => rmSync(base,{recursive:true,force:true}));
  const target = {id:'repo',path:base};
  const now = new Date(2026,10,11,12,10).getTime();
  t.mock.timers.enable({apis:['Date'],now});
  const directory = join(base,'.chatpet/data/life'); mkdirSync(directory,{recursive:true});
  const body = emptyHomeState(now); body.lastInteractionAt = 0;
  const garden = createGarden(now); garden.care.autoEnabled = true;
  writeFileSync(join(directory,'home.json'),JSON.stringify(body));
  writeFileSync(join(directory,'garden.json'),JSON.stringify(garden));
  const host = {native:{},records:{getLibrary:()=>new CompanionRecordLibrary(base,'Asia/Ho_Chi_Minh')},workspace:{status:()=>({state:'ready',target}),storageId:()=>target.id,
    homeScope(){return {workspaceId:target.id,path:target.path,storageId:this.storageId(),bootId:'fixture-boot',generation:0};},
    readCompanionHome:()=>undefined,
    runtime:{config:{ownerActorId:'owner',companionId:'fish'},identity:()=>({displayName:'Fixture',companionId:'fish'}),store:{meta:()=>undefined}}}} as unknown as PetCoreHost;
  const changes: WorldChanged[] = [];
  let behavior:CompanionBehavior;
  const ctx = {get:(name:string)=>name==='petBehavior'?behavior:name==='workspaceRegistry'?{get:()=>({...target,sessionIds:[]})}:undefined,
    emit:(name:string,change:WorldChanged)=>{if (name === 'world.changed') changes.push(change);},
    tools:{register(){}},on:()=>()=>{},effect:()=>()=>{}} as unknown as Context;
  behavior = new CompanionBehavior(ctx, host, livingNotifications(t, ctx, host, 'body'));
  behavior.activate(); t.after(()=>behavior.close());
  const initial = await behavior.snapshot(target.id);
  const originalNeeds = {...initial.home.body};
  const originalGarden = (await behavior.garden(target.id,'state')).garden;
  t.mock.timers.tick(3_600_000);
  const paused = await behavior.snapshot(target.id);
  const unchanged = (await behavior.garden(target.id,'state')).garden;
  assert.deepEqual(paused.home.body,originalNeeds);
  assert.deepEqual(unchanged.plots,originalGarden.plots);
  assert.equal(unchanged.care.task,null,'No automatic task starts while Life is absent');
  assert.equal(paused.autonomyEnabled,false);
  const fed = await behavior.act(target.id,'feed');
  assert.ok(fed.home.body.hunger < originalNeeds.hunger);
  t.mock.timers.tick(13_000); await behavior.roomState(target.id);
  const plotId=unchanged.plots.find((plot:any)=>!plot.tilled).id;
  const request={type:'till',plotId,requestId:'one-request'};
  const accepted=await behavior.garden(target.id,'control',request);
  assert.equal((accepted as {accepted?:boolean}).accepted,true);
  // The planned executor starts accepted work without imposing a visit cadence.
  const homeFile=join(directory,'home.json');
  let saved=JSON.parse(readFileSync(homeFile,'utf8'));
  assert.ok(saved.route?.target.gardenJobId);
  t.mock.timers.tick(Math.ceil(saved.route.arriveAt-Date.now())+1);await behavior.garden(target.id,'state');
  saved=JSON.parse(readFileSync(homeFile,'utf8'));
  assert.ok(saved.dwell?.target.gardenJobId);
  t.mock.timers.tick(Math.ceil(saved.dwell.until-Date.now())+1);
  const completed=(await behavior.garden(target.id,'state')).garden;
  assert.equal(completed.plots[plotId].tilled,true);
  assert.equal(completed.care.receipts.find((row:any)=>row.requestId==='one-request').status,'completed');
  await behavior.garden(target.id,'control',request);
  const replay=(await behavior.garden(target.id,'state')).garden;
  assert.equal(replay.care.receipts.filter((row:any)=>row.requestId==='one-request').length,1);
  assert.equal(replay.care.task,null,'Autonomy does not start after requested completion');
  await behavior.setAutonomy(target.id,true);
  t.mock.timers.tick(3_000);
  const automatic=(await behavior.garden(target.id,'state')).garden;
  assert.equal(automatic.care.task,null,'Enabling Life never restores the retired rule-based garden planner');
  await behavior.setAutonomy(target.id,false);
  const stopped=(await behavior.garden(target.id,'state')).garden;
  assert.equal(stopped.care.task,null);
  assert.deepEqual(stopped.inventory,replay.inventory,'Stopping automatic work does not manufacture its harvest');
  const life=new CompanionLife(ctx,host,'standard',{body:()=>behavior});
  await life.control(target.id,false);await life.close();
  assert.ok((await behavior.act(target.id,'pet')).changed,'Unloading the actual Life owner leaves the body service operational');
  assert.ok(changes.some(change => change.workspaceId === target.id && change.bodyOnly));
});
