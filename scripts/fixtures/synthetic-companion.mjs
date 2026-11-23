#!/usr/bin/env node
// Fixed synthetic content only. No installed application, model or personal Repo.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createCore } from '../../dist/src/core/index.js';
import { CompanionRoom } from '../../dist/src/living/body/room.js';
import { CompanionBehavior } from '../../dist/src/living/body/plugin.js';
import { CompanionEconomy } from '../../dist/src/living/economy/plugin.js';
import { PersistentLifePlan } from '../../dist/src/living/plan/plan.js';
import { EmotionFile } from '../../dist/src/emotion/state.js';
import { RecentLedger } from '../../dist/src/emotion/recent.js';
import { DesktopImages } from '../../dist/src/desktop/images.js';
import { RoomImages } from '../../dist/src/room/images.js';
import { NativeTranscripts } from '../../dist/src/core/native/transcripts.js';
import { CompanionVoice } from '../../dist/src/voice/plugin.js';
import { companionChannelDirectory } from '../../dist/src/channels/storage.js';
import { messagingStorage } from '../../dist/src/channels/messaging-storage.js';
import { createQQInbox } from '../../dist/src/channels/qq-inbox.js';
import { channelUsage } from '../../dist/src/channels/usage.js';
import { createLifeStore, durableWrite } from '#dsh-world/life/lifeStore';
import { backupPlan } from '../lib/offline-backup.mjs';
import { inspectRepoBinding } from '../lib/repo-storage.mjs';
const storage = JSON.parse(readFileSync(new URL('../../arch/storage.json', import.meta.url), 'utf8'));

const project = fileURLToPath(new URL('../../', import.meta.url));
export const content = {character:'SYNTHETIC_CHARACTER_817', profile:'SYNTHETIC_PROFILE_817', self:'SYNTHETIC_SELF_817',
  diary:'SYNTHETIC_DIARY_817', memory:'SYNTHETIC_JASMINE_817', withdrawn:'SYNTHETIC_WITHDRAWN_817'};
export const value = result => { assert.ok(result.ok, 'Synthetic public operation failed'); return result.value; };
const write = (file, text) => { mkdirSync(dirname(file), {recursive:true}); writeFileSync(file, text, {mode:0o600}); };
export function openDomains(host) {
  let body, economy;
  const ctx = {get:() => undefined, on:() => () => {}, emit() {}, logger:() => ({warn(){}})};
  economy = new CompanionEconomy(ctx, host, {body:()=>body});
  economy.prepare(host.workspace.status().target);
  body = new CompanionBehavior(ctx, host, {economy:()=>economy});
  return {body, economy, async close() { await body.close(); economy.close(); }};
}
export async function generateSynthetic(out, variant = 'current') {
  assert.ok(['current','legacy'].includes(variant), 'Expected current or legacy');
  out = resolve(out); mkdirSync(out, {recursive:true}); out = realpathSync(out);
  assert.equal(readdirSync(out).length, 0, 'Synthetic output must be empty');
  const repo = join(out, 'repo'), home = join(out, 'dsh'), profile = join(home, 'profiles', 'fixture');
  const managed = join(repo, '.chatpet'), data = join(managed, 'data');
  mkdirSync(repo);
  const config = {companionId:'synthetic-companion-817', scopeId:'synthetic-scope-817', ownerActorId:'synthetic-owner-817',
    dataDir:join(data, 'core'), displayName:'fixture', character:content.character,
    memory:{python:join(project, '.venv/bin/python'), dataDir:join(data, 'memory')}};
  const target = {id:'synthetic-workspace-817', path:repo, title:'fixture'};
  const host = createCore(config); let domains;
  let sequence = 0; const request = () => host.operator.request('fixture-' + ++sequence);
  try {
    const before = value(await host.services.preferences.read(request(), {}));
    const prefs = value(await host.services.preferences.save(request(), {expectedRevision:before.revision, workspace:target, conversation:before.conversation}));
    assert.equal(value(await host.services.workspace.initialize(request(), {expectedPreferencesRevision:prefs.revision})).state, 'ready');
    // Lay out the synthetic legacy files after admitting a genuinely new Repo.
    const bodyDirectory = join(data, variant === 'legacy' ? 'life' : 'behavior');
    mkdirSync(bodyDirectory, {recursive:true});
    const initial = new CompanionRoom(bodyDirectory, () => undefined);
    initial.setAutonomy(true); initial.setAutonomy(false); initial.flush();
    if (variant === 'legacy') {
      const manifestFile = join(managed, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      for (const [from,to] of [['self.md','data/life/self.md'], ['diary/','data/life/diary/'],
        ['self.history/','data/life/self.history/'], ['data/core/photos/','data/life/photos/']]) {
        renameSync(join(managed, from), join(managed, to));
        manifest.files = manifest.files.map(name => name.startsWith(from) ? to + name.slice(from.length) : name);
      }
      writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    }
    const profileValue = value(await host.services.workspace.readProfile(request(), {}));
    value(await host.services.workspace.saveProfile(request(), {expectedScope:host.workspace.editScope(), expectedRevision:profileValue.revision, text:content.profile}));
    const foundation = value(await host.services.workspace.readFoundation(request(), {}));
    value(await host.services.workspace.saveFoundation(request(), {workspaceId:target.id, expectedRevision:foundation.revision, text:'SYNTHETIC_FOUNDATION_817'}));
    host.records.connect(id => id === target.id ? {...target, sessionIds:['fixture-session']} : undefined);
    await host.records.saveSelf(target.id, (await host.records.readSelf(target.id)).revision, content.self);
    const library = host.records.getLibrary(target.id);
    durableWrite(join(library.paths.diaryDir, '2026-01-01.md'), content.diary);
    durableWrite(join(library.paths.historyDir, 'fixture.md'), content.self);
    const image = {ref:{type:'image', attachmentId:'synthetic-image-817', mediaType:'image/png', bytes:1, width:1, height:1}, data:Buffer.from([0])};
    library.album().keep(image, 'SYNTHETIC_PHOTO_817', ['fixture']);
    const life = createLifeStore(join(data, 'life'), 'UTC');
    life.update(state => {state.homeSessionId = 'fixture-session'; state.spend = {day:'2026-01-01', yuan:1};});
    life.appendWake({time:'2026-01-01T00:00:00Z', reason:'fixture'});
    life.appendActivity({time:'2026-01-01T00:00:00Z', kind:'fixture'});
    life.appendCompaction({time:'2026-01-01T00:00:00Z', reason:'fixture'});
    const plan = new PersistentLifePlan(join(data, 'life'), config.companionId, host.workspace.storageId(), 'UTC');
    await plan.commit(0, {goal:'SYNTHETIC_PLAN_817', reason:'fixture', steps:[{id:'hold', kind:'hold', activity:'fixture'}], nextConsiderAt:null});
    domains = openDomains(host);
    await domains.economy.ownerAction(target.id, {kind:'gift', itemId:'food:improved-meal', quantity:2}, 'fixture-gift', new AbortController().signal,
      undefined, {kind:'owner',id:config.ownerActorId,channel:'room',sessionId:'fixture-session'});
    assert.equal((await domains.economy.snapshot(target.id)).inventory.find(row => row.itemId === 'food:improved-meal').quantity, 2);
    await domains.body.snapshot(target.id);
    const scope = {path:repo, companionId:config.companionId, scopeId:config.scopeId, storageId:host.workspace.storageId()};
    const emotion = new EmotionFile(scope, () => null), previous = emotion.load();
    emotion.update({expectedRevision:previous.document.revision, expectedHash:previous.contentHash, mood:'fixture calm', reason:'SYNTHETIC_EMOTION_817'});
    assert.equal(emotion.load().document.current.mood, 'fixture calm');
    const recent = new RecentLedger(target, () => ({recentActionCount:4,recentActionMinutes:10,recentMoodCount:4,recentMoodHours:1}));
    recent.playback({id:'fixture-play',name:'fixture play',kind:'pet',status:'playing'});
    assert.equal(recent.read().actions.length, 1);
    host.native.resolveNativeScope = () => ({workspaceId:target.id,path:repo,storageId:host.workspace.storageId(),guest:false});
    const sources = host.native.observeInputs('fixture-session', 1, [{id:'fixture-message',source:{kind:'user'},content:[{type:'text',text:content.memory}]}]);
    await host.native.memory.prepare('fixture-session');
    const port = host.native.memory.connection;
    const memory = await port.call('propose', {operation_id:'fixture-memory',content:content.memory,sources:sources.map(id => ({id,revision:'1'}))});
    await port.call('observe', {source_id:'fixture-withdraw-source',content:content.withdrawn,revision:'1',actor_id:config.ownerActorId});
    const withdrawn = await port.call('propose', {operation_id:'fixture-withdraw',content:content.withdrawn,sources:[{id:'fixture-withdraw-source',revision:'1'}]});
    await port.call('withdraw', {memory_id:withdrawn.id,expected_version:withdrawn.version});
    assert.ok((await host.native.memory.findForOwner(target.id, content.memory)).items.some(row => row.id === memory.id));
    assert.ok(!(await host.native.memory.findForOwner(target.id, content.withdrawn)).items.some(row => row.id === withdrawn.id));
    const binding = {root:repo, storageId:host.workspace.storageId()};
    write(join(profile, 'node_modules/her-world/package.json'), JSON.stringify({name:'her-world',version:'0.1.8',synthetic:true}));
    write(join(profile, 'cordis.patch.yml'), '# Synthetic configuration\n');
    const registryFile = join(home, 'storages/workspace.json');
    write(registryFile, JSON.stringify({unit:{name:'workspace',version:1},global:{workspaceIds:[target.id],archivedSessionIds:[],pinnedSessionIds:[],defaultWorkspaceId:target.id},
      tables:{workspaces:{[target.id]:{path:repo,title:'fixture',sessionIds:['fixture-session']}}}}));
    const backup = backupPlan({repo,workspaceId:target.id,storageId:binding.storageId,profileDir:profile,dshHome:home,config});
    for (const root of backup.roots.filter(row => row.id.startsWith('sessions-'))) write(join(root.path, 'fixture-session/session.v4.jsonl.zstd'), 'SYNTHETIC_NATIVE_LOG_817');
    write(join(backup.cacheDirectory, 'fixture-session.json'), JSON.stringify({synthetic:'SYNTHETIC_CACHE_817'}));
    write(join(backup.attachmentsDirectory, 'v1/objects/00/fixture'), 'SYNTHETIC_ATTACHMENT_817');
    const registry = {get:id => id === target.id ? {...target,sessionIds:['fixture-session']} : undefined, archivedSessionIds:[]};
    const transcripts = new NativeTranscripts({get:key => key === 'workspaceRegistry' ? registry : undefined,
      sessions:{get:() => undefined},sessionPersistence:{open:async () => ({header:{id:'fixture-session',cwd:repo},read:async () => ({events:[{seq:1,type:'fixture',data:content.memory}]}),close:async () => {}})}}, host);
    try { await transcripts.save('fixture-session'); } finally { await transcripts.close(); }
    const attachments = {admitPromptContent:async rows => rows};
    for (const Images of [DesktopImages,RoomImages]) await new Images(host, () => attachments).admit({data:'AA==',mediaType:'image/png'});
    mkdirSync(backup.channelsDirectory, {recursive:true});
    const channelData = companionChannelDirectory(repo, backup.channelsDirectory);
    const messaging = messagingStorage(backup.channelsDirectory, channelData); messaging.save(messaging.current);
    const inbox = createQQInbox({store:host.workspace.runtime.store,storageId:binding.storageId,active:() => true,allowed:() => true,owner:() => true,probe:async () => 'absent'});
    const speaker = {channel:'qq',accountId:'123',conversationType:'private',conversationId:'456',speakerId:'qq:456',platformMessageId:'789'};
    assert.ok(inbox.receive({identity:speaker,text:'SYNTHETIC_QQ_817',at:'2026-01-01T00:00:00Z',record:true,directed:true,replyToSelf:false}));
    let listener;
    const usage = channelUsage({on:(_event,fn) => {listener=fn;return () => {};}},host,binding.storageId,() => true);
    listener({id:'fixture-session'},{type:'user/message',data:{source:{kind:'user',identity:speaker}}});
    listener({id:'fixture-session'},{type:'assistant/message',seq:2,data:{usage:{inputTokens:1,outputTokens:1}}}); usage.stop();
    assert.equal(usage.read('qq','123').requests, 1);
    const voice = new CompanionVoice(host, join(profile, 'chatpet-voice'), () => undefined);
    try { await voice.handle({rest:'voice/voices',method:'GET'}); } finally { voice.release(); }
    // Browser-only rows have no filesystem owner; keep an explicit synthetic
    // export outside the backed-up Repo instead of inventing a runtime location.
    write(join(out, 'browser-localStorage.json'), JSON.stringify({'chatpet:economy:pending:fixture':{synthetic:true},'home-fixture':{synthetic:true}}));
    const installation = join(out, 'installation.json');
    write(installation, JSON.stringify({status:'installed',packageInstalled:true,profileDir:profile,config}, null, 2));
    assert.equal((await host.records.readSelf(target.id)).text, content.self);
    assert.equal(plan.read().plan.goal, 'SYNTHETIC_PLAN_817');
    assert.equal(inspectRepoBinding(config).storageId, binding.storageId);
    return {out,repo,home,profile,managed,data,config,target,installation,storageId:binding.storageId,
      variant, memoryId:memory.id, withdrawnId:withdrawn.id, declaredEntries:storage.entries.map(row => row.id)};
  } finally { try { await domains?.close(); } finally { await host.close(); } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), options = {};
    while (args.length) {
      const key = args.shift(); assert.ok(['--out','--variant'].includes(key) && !options[key]); options[key] = args.shift();
    }
    assert.ok(options['--out']);
    await generateSynthetic(options['--out'], options['--variant'] ?? 'current');
    console.log(JSON.stringify({generated:true, variant:options['--variant'] ?? 'current'}));
  } catch (error) { console.error('Synthetic generation failed:', error.message); process.exitCode = 1; }
}
