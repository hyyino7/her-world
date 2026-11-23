import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCore } from '../../src/core/index.js';
import { emotionFor, CompanionEmotion } from '../../src/emotion/plugin.js';
import type { Result } from '../../src/contracts/common.js';

test('text-only emotion survives neutral replies, ledger expiry and restart without invented Room scores', async () => {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'pet-emotion-'))), repo=join(root,'repo'); mkdirSync(repo);
  const config={dataDir:join(repo,'.chatpet/data/core'),companionId:'fish',scopeId:'owner',ownerActorId:'owner',displayName:'Fish',character:'Fixture'};
  let host=createCore(config);
  const ok=<T>(r:Result<T>)=>{if(!r.ok) throw Error(r.error.message);return r.value;};
  try {
    const prefs=ok(await host.services.preferences.read(host.operator.request('prefs'),{}));
    const saved=ok(await host.services.preferences.save(host.operator.request('bind'),{expectedRevision:prefs.revision,workspace:{id:'repo',path:repo,title:'Repo'},conversation:prefs.conversation}));
    ok(await host.services.workspace.initialize(host.operator.request('init'),{expectedPreferencesRevision:saved.revision}));
    const emotion=emotionFor(host), events:unknown[]=[]; emotion.onExpression(e=>events.push(e));
    const turn={turn:1,workspaceId:'repo',path:repo,memoryIds:[],memoryCalls:new Map()};
    await emotion.complete('session',{...turn,intent:{mood:'平常'}});
    assert.equal(emotion.roomSnapshot('repo')?.mood, undefined, 'Earlier textual moods do not receive invented scores');
    assert.equal(emotion.roomSnapshot('repo')?.label,'平常','Text-only feelings still reach Room');
    await emotion.complete('session',{...turn,intent:{mood:'愉快',reason:'共同完成了一次比较',roomMood:{mood:78,dims:{happy:40}},action:'spin'}});
    await emotion.complete('session',{...turn,turn:2,intent:{action:'wave'}});
    assert.equal(emotion.current('repo')?.mood,'愉快');
    assert.equal((events.at(-1) as {mood:string}).mood,'愉快');
    assert.equal(emotion.roomSnapshot('repo')?.dims?.happy,40);
    const settings=host.workspace.companionConfiguration();
    ok(await host.services.workspace.saveCompanion(host.operator.request('retention'),{workspaceId:'repo',expectedSettings:settings,settings:{...settings,recentMoodHours:0}}));
    assert.deepEqual(emotion.ledger('repo')!.read().moods,[]);
    assert.equal(emotion.current('repo')?.mood,'愉快','Current emotional state is separate from retained changes');
    await host.close();host=createCore(config);
    assert.equal(emotionFor(host).current('repo')?.reason,'共同完成了一次比较');
    assert.ok(readFileSync(join(repo,'.chatpet/data/emotion/state.json'),'utf8').includes('共同完成了一次比较'));
    assert.equal(host.workspace.runtime.store.get('emotion-state',host.workspace.storageId()),undefined,'New writes do not continue writing the old Core row');
    assert.equal(emotionFor(host).roomSnapshot('repo')?.mood,78);
    emotionFor(host).retire('repo','unrelated'); assert.ok(emotionFor(host).current('repo'));
    assert.ok(emotionFor(host).current('repo'), 'Unrelated correction does not invalidate an independent emotion');
  } finally {await host.close();rmSync(root,{recursive:true,force:true});}
});


test('canonical emotion ignores retired Core rows, rejects stale writers and remains independent of Memory after reload', async () => {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'pet-emotion-file-'))),repo=join(root,'repo');mkdirSync(repo);
  const host=createCore({dataDir:join(repo,'.chatpet/data/core'),companionId:'fish',scopeId:'owner',ownerActorId:'owner',displayName:'Fish',character:'Fixture'});
  const ok=<T>(r:Result<T>)=>{if(!r.ok)throw Error(r.error.message);return r.value;};
  try {
    const prefs=ok(await host.services.preferences.read(host.operator.request('prefs'),{}));
    const saved=ok(await host.services.preferences.save(host.operator.request('bind'),{expectedRevision:prefs.revision,workspace:{id:'repo',path:repo,title:'Repo'},conversation:prefs.conversation}));
    const legacy={mood:'有点无聊',reason:'先前聊过的偏好',at:1234,memories:['fact'],roomMood:{mood:44,dims:{calm:12}}};
    host.workspace.runtime.store.put('emotion-state',host.workspace.storageId(),legacy);
    ok(await host.services.workspace.initialize(host.operator.request('init'),{expectedPreferencesRevision:saved.revision}));
    let emotion=new CompanionEmotion(host);
    const initial=await emotion.read('repo');assert.equal(initial.status,'empty');assert.equal(initial.state,undefined);
    assert.deepEqual(host.workspace.runtime.store.get('emotion-state',host.workspace.storageId()),legacy);
    const changed=await emotion.update('repo',{expectedRevision:initial.revision,expectedHash:initial.contentHash,mood:'生气但正在吃饭',reason:'自己的感受',feelings:['anger','boredom']});
    assert.deepEqual(changed.state?.feelings,['anger','boredom']);assert.equal(changed.state?.roomMood,undefined,'Text update invents no numeric mood');
    await assert.rejects(emotion.update('repo',{expectedRevision:initial.revision,expectedHash:initial.contentHash,mood:'stale'}),/changed/);
    const linked=await emotion.update('repo',{expectedRevision:changed.revision,expectedHash:changed.contentHash,mood:'平静',reason:'关联旧事实',memories:['fact']});
    assert.equal(linked.status,'ready');
    const file=join(repo,'.chatpet/data/emotion/state.json'),retained=readFileSync(file,'utf8');
    emotion=new CompanionEmotion(host);
    assert.deepEqual(emotion.current('repo')?.memories,['fact']);
    const withdrawn=await emotion.read('repo');assert.equal(withdrawn.status,'ready');assert.equal(withdrawn.state?.reason,'关联旧事实');
    assert.equal(readFileSync(file,'utf8'),retained,'An unavailable Bank neither rewrites nor clears the emotion file');
    const offline=await emotion.update('repo',{expectedRevision:withdrawn.revision,expectedHash:withdrawn.contentHash,mood:'不依赖记忆的平静',feelings:['calm']});
    assert.equal(offline.state?.mood,'不依赖记忆的平静');
    assert.equal((await emotion.read('repo')).status,'ready');
    host.workspace.runtime.store.put('emotion-state',host.workspace.storageId(),{...legacy,mood:'stale legacy overwrite'});
    assert.equal((await emotion.read('repo')).state?.mood,'不依赖记忆的平静','Canonical file never falls back to old Core state');
    const document=JSON.parse(readFileSync(file,'utf8'));
    for (const old of [{...document,importedLegacy:true}, {...document,current:{...document.current,dependencies:{sources:[],memories:[]}}}]) {
      const bytes=JSON.stringify(old);writeFileSync(file,bytes);
      assert.equal((await emotion.read('repo')).status,'unavailable');
      assert.equal(readFileSync(file,'utf8'),bytes);
    }
    writeFileSync(file,'{manual edit still incomplete');
    assert.equal((await emotion.read('repo')).status,'unavailable');
    await assert.rejects(emotion.update('repo',{expectedRevision:linked.revision,expectedHash:linked.contentHash,mood:'replace corruption'}));
    assert.equal(readFileSync(file,'utf8'),'{manual edit still incomplete','Corrupt owner content is retained, never replaced by migration');
    const disposeOld=emotion.registerCatalog('display',{actions:[{name:'anger',description:'An angry expression'}],stickers:[],supportedFeelings:['anger','boredom']});
    const disposeNew=emotion.registerCatalog('display',{actions:[{name:'wave',description:'A wave'}],stickers:[]});
    disposeOld();assert.equal(emotion.catalog.actions[0]?.name,'wave','Old display cleanup cannot remove the replacement registration');
    disposeNew();assert.deepEqual(emotion.catalog.actions,[]);
  } finally {await host.close();rmSync(root,{recursive:true,force:true});}
});


test('all nine semantic feelings work without displays, Memory or invented numeric scores', async () => {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'pet-feelings-'))),repo=join(root,'repo');mkdirSync(repo);
  const host=createCore({dataDir:join(repo,'.chatpet/data/core'),companionId:'fish',scopeId:'owner',ownerActorId:'owner',displayName:'Fish',character:'Fixture'});
  const ok=<T>(r:Result<T>)=>{if(!r.ok)throw Error(r.error.message);return r.value;};
  try {
    const prefs=ok(await host.services.preferences.read(host.operator.request('prefs'),{}));
    const saved=ok(await host.services.preferences.save(host.operator.request('bind'),{expectedRevision:prefs.revision,workspace:{id:'repo',path:repo,title:'Repo'},conversation:prefs.conversation}));
    ok(await host.services.workspace.initialize(host.operator.request('init'),{expectedPreferencesRevision:saved.revision}));
    const emotion=new CompanionEmotion(host),feelings=['happy','calm','sweet','heartache','worry','sad','jealous','anger','boredom'];
    assert.deepEqual(emotion.catalog.supportedFeelings,feelings);
    for (const [index,feeling] of feelings.entries()) {
      await emotion.complete('session',{turn:index+1,workspaceId:'repo',path:repo,memoryIds:[],memoryCalls:new Map(),intent:{feelings:[feeling]}});
      assert.deepEqual(emotion.current('repo')?.feelings,[feeling]);
      assert.deepEqual(emotion.roomSnapshot('repo')?.feelings,[feeling]);
      assert.equal(emotion.roomSnapshot('repo')?.mood,undefined);
    }
    const events:string[]=[];emotion.onExpression(event=>{if(event.mood)events.push(event.mood);});
    await Promise.all([
      emotion.complete('compact',{turn:100,workspaceId:'repo',path:repo,memoryIds:[],memoryCalls:new Map(),intent:{mood:'先完成的回复',feelings:['happy']}}),
      emotion.complete('room',{turn:101,workspaceId:'repo',path:repo,memoryIds:[],memoryCalls:new Map(),intent:{mood:'随后完成的回复',feelings:['calm']}}),
    ]);
    assert.deepEqual(events,['先完成的回复','随后完成的回复'],'Concurrent surfaces both publish their accepted emotional updates');
    assert.equal(emotion.current('repo')?.mood,'随后完成的回复');
  } finally {await host.close();rmSync(root,{recursive:true,force:true});}
});
