import test from 'node:test';
import assert from 'node:assert/strict';
import {roomOverview,gardenOverview} from '../../src/room/tool-context.js';
import {economyOverview,economyPage} from '../../src/living/economy/tool-context.js';
import {planOverview} from '../../src/living/plan/tool-context.js';
import {presentFacts} from '../../src/core/interaction-presentation.js';
import {Room} from '../../src/room/plugin.js';
import type {Context} from '@deepseek-ai/cordis';
import {HOME_LAYOUT,emptyHomeState,homeView} from '#feiyu-home';
import {createGarden,gardenView} from '#feiyu-garden';
import {EconomyStore} from '../../src/living/economy/store.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('room overview retains all exact navigation IDs, needs and restrictions without geometry',()=>{
  const full=homeView(emptyHomeState(Date.now()),Date.now()),before=JSON.stringify(full),view=roomOverview(full);
  assert.deepEqual(view.body,full.body);assert.equal(view.her.immobile,full.her.immobile);assert.equal(view.her.asleep,full.her.asleep);
  assert.deepEqual(view.layout.rooms.map((room:any)=>room.id),full.layout.rooms.map((room:any)=>room.id));
  for(const [room,spots] of Object.entries(HOME_LAYOUT.spots))assert.deepEqual(Object.keys(view.layout.spots[room]),Object.keys(spots));
  assert.equal(JSON.stringify(full),before);assert.ok(JSON.stringify(view).length<before.length*.75);
});

test('native Room tools default to overview only for autonomous reads and preserve explicit full and mutations',async()=>{
  const home=homeView(emptyHomeState(Date.now()),Date.now());let autonomous=true;const controls:unknown[]=[];
  const receipt={id:'original-fact',domain:'body',result:{before:{thirst:.8},after:{thirst:.2}}};
  const behavior = {roomState: async () => home, readFacts: async (_id: string, ids: string[]) => {
    assert.deepEqual(ids, [receipt.id]);return [receipt];
  }, garden: async (_id: string, operation: string, args: unknown) => {
    controls.push({operation,args});return {ok:true,garden:{plots:[],care:{receipts:[]}}};
  }};
  const target = {id: 'workspace', path: '/fixture/home'};
  const room = new Room({petCore:{workspace:{
    status: () => ({state: 'ready', target}),
    homeScope: () => ({workspaceId: target.id, path: target.path, storageId: target.id, bootId: 'fixture', generation: 0}),
  }, native:{isAutonomous: () => autonomous, manages: (id: string) => id === 'home', validate() {}}},
  petBehavior: behavior, petWorld:{sessionStatus: () => ({state: 'ready'})},
  get: (name: string) => name === 'petBehavior' ? behavior : undefined, on: () => () => {}} as unknown as Context);
  const tools=room.tools(),state=tools.find(tool=>tool.name==='room_state')!,garden=tools.find(tool=>tool.name==='room_garden')!;
  const signal = new AbortController().signal;
  const exec={agent:{id:'home', session: {}},callId:'once',signal} as any;
  assert.equal(JSON.parse(await state.execute({},exec) as string).view,'overview');
  assert.deepEqual(JSON.parse(await state.execute({factIds:[receipt.id]},exec) as string),{facts:[receipt]});
  await assert.rejects(state.execute({factIds:[]},exec),/fact IDs/);
  const full = JSON.parse(await state.execute({view:'full'},exec) as string);
  const {playback, ...preservedHome} = full;
  assert.deepEqual(preservedHome, home);
  assert.equal(playback.version, 1);
  assert.deepEqual(full, JSON.parse(JSON.stringify(await room.request(target.id, 'roomState', {}, 'room-full', signal))));
  await assert.rejects(garden.execute({type:'water',plotId:0},exec),/life_plan_update/);assert.equal(controls.length,0);
  autonomous=false;assert.deepEqual(JSON.parse(await state.execute({},exec) as string),full);
  await garden.execute({type:'water',plotId:0,view:'overview'},exec);
  assert.deepEqual((controls[0] as any).args,{type:'water',plotId:0,requestId:(controls[0] as any).args.requestId});
});

test('garden overview preserves current plots, queues, conflicts and every failure with full details available',()=>{
  const garden=createGarden(Date.now());
  garden.plots[0].tilled=true;
  const original=gardenView(garden,Date.now());
  original.plots[1].moisture=.43;original.plots[1].fertilized=true;
  original.care.receipts=[{status:'failed',message:'Original failure',requestId:'operation-a',fingerprint:'internal'}];
  original.care.pendingConflict={requestId:'unresolved'};
  const full={ok:true,garden:original},before=JSON.stringify(full),view=gardenOverview(full);
  assert.deepEqual(view.garden.seeds,original.seeds);assert.deepEqual(view.garden.inventory,original.inventory);
  for(let i=0;i<original.plots.length;i++)assert.deepEqual({...view.garden.emptyPlotDefaults,...view.garden.plots[i]},original.plots[i],'Empty-plot defaults must reconstruct every exact field');
  assert.equal(view.garden.plots[0].tilled,true);assert.deepEqual(view.garden.care.queue,original.care.queue);
  assert.deepEqual(view.garden.care.pendingConflict,original.care.pendingConflict);
  assert.equal(view.garden.care.failures[0].requestId,'operation-a');assert.equal(view.garden.care.failures[0].message,'Original failure');
  assert.equal(JSON.stringify(full),before);assert.deepEqual(gardenOverview({ok:false,message:'unavailable'}),{ok:false,message:'unavailable'});
});

test('economy overview and pages retain every catalog choice, ownership, pending uses and exact prices',t=>{
  const root=mkdtempSync(join(tmpdir(),'context-economy-'));const store=new EconomyStore({workspacePath:root,storageId:'storage',companionId:'fish'});
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  const full={...store.snapshot(),ledger:store.ledger().items},before=JSON.stringify(full),view=economyOverview(full);
  assert.deepEqual(view.catalog,full.catalog);assert.deepEqual(view.bookmarks,full.bookmarks);assert.deepEqual(view.pendingUses,full.pendingUses);
  assert.equal(view.balance,full.balance);assert.equal(JSON.stringify(full),before);
  const rows:unknown[]=[];for(let offset:number|null=0;offset!==null;) {const page:ReturnType<typeof economyPage>=economyPage(full,'catalog',offset,3);rows.push(...page.items);offset=page.nextOffset;}
  assert.deepEqual(rows,full.catalog);assert.throws(()=>economyPage(full,'ledger',-1),/offset/);
});

test('plan overview keeps full remaining intent and actual reading/transaction receipt identifiers',()=>{
  const plan={id:'original-plan',revision:4,goal:'Read then eat',reason:'My own choice',status:'active',cursor:1,
    steps:[{id:'done'},{id:'read',kind:'read',reading:{itemId:'book',segment:2}},{id:'eat',kind:'economy',economy:{itemId:'meal'}}],
    execution:{operationId:'original-reading',status:'waiting',receiptToken:'actual-offer'},nextConsiderAt:null,
    pauseReason:'owner interruption',replanReason:'pending proof',storageId:'storage',companionId:'fish',createdAt:'original'};
  const view=planOverview({revision:4,plan});
  for(const key of ['id','revision','goal','reason','status','cursor','steps','execution','nextConsiderAt','pauseReason','replanReason'])assert.deepEqual((view.plan as any)[key],(plan as any)[key]);
});

test('compact interactions retain separate ordered facts and provenance without copying numeric receipts',()=>{
  const facts=(['water','feed','pet'] as const).map((type,index)=>({version:1 as const,id:'fact-'+index,requestId:'request-'+index,domain:'body' as const,type,
    occurredAt:new Date(1000+index).toISOString(),actor:{kind:'owner' as const,id:'owner',channel:'room'},
    result:{status:'completed' as const,summary:type+' actually completed',before:{thirst:.8},after:{thirst:.2}}}));
  const original=JSON.stringify(facts),view=JSON.parse(presentFacts(facts));
  assert.deepEqual(view.facts.map((fact:any)=>fact.id),facts.map(fact=>fact.id));
  for(let i=0;i<facts.length;i++){assert.deepEqual(view.facts[i].actor,facts[i].actor);assert.equal(view.facts[i].at,facts[i].occurredAt);assert.equal(view.facts[i].summary,facts[i].result.summary);}
  assert.equal(JSON.stringify(facts),original);
});
