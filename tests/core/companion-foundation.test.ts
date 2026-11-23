import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { Result } from '../../src/contracts/common.js';
import { createCore } from '../../src/core/index.js';
import { companionWritingScope, isCompanionHome, renderCompanionFoundation, resolveCompanionHome } from '../../src/core/companion-foundation.js';
import { readSelfPrompt, trackCompanionWriting } from '../../src/core/companion-writing.js';
import { createWorldService } from '../../src/world/service.js';

const ok = <T>(r:Result<T>) => {if (!r.ok) throw Error(r.error.message); return r.value;};
async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(),'pet-foundation-'))), repo=join(root,'repo'); mkdirSync(repo);
  const host=createCore({dataDir:join(repo,'.chatpet/data/core'),companionId:'fish',scopeId:'owner',ownerActorId:'owner',displayName:'Fish',character:'Fixture'});
  const prefs=ok(await host.services.preferences.read(host.operator.request('prefs'),{}));
  const saved=ok(await host.services.preferences.save(host.operator.request('bind'),{expectedRevision:prefs.revision,workspace:{id:'repo',path:repo,title:'Repo'},conversation:prefs.conversation}));
  ok(await host.services.workspace.initialize(host.operator.request('init'),{expectedPreferencesRevision:saved.revision}));
  const workspace={id:'repo',path:repo,sessionIds:['owner-chat'],attachSession:async(id:string)=>{workspace.sessionIds.push(id);}};
  const registry={get:(id:string)=>id==='repo'?workspace:undefined,archivedSessionIds:[] as string[]};
  const services=new Map<string,unknown>([['workspaceRegistry',registry]]);
  const ctx={get:(name:string)=>services.get(name)} as unknown as Context;
  const session={id:'owner-chat',header:{cwd:repo,agentPreset:'standard'}};
  const agent={id:session.id,session} as unknown as Agent;
  return {root,repo,host,workspace,registry,services,ctx,agent,close:async()=>{host.native.memory=undefined;await host.close();rmSync(root,{recursive:true,force:true});}};
}

test('a current Repo reads the blank foundation without changing its manifest, and owner edits are revisioned',async()=>{
  const f=await fixture();
  try {
    const file=join(f.repo,'.chatpet/COMPANION.md');
    const manifest=readFileSync(join(f.repo,'.chatpet/manifest.json'),'utf8');
    const original=ok(await f.host.services.workspace.readFoundation(f.host.operator.request('foundation.read'),{}));
    assert.equal(original.source,'empty');assert.equal(original.text,'');assert.equal(readFileSync(file,'utf8'),'');
    const saved=ok(await f.host.services.workspace.saveFoundation(f.host.operator.request('foundation.save'),{workspaceId:'repo',expectedRevision:original.revision,text:'# Owner foundation\nKeep my speaking style.'}));
    assert.equal(saved.source,'owner');assert.equal(f.host.workspace.foundation().text,saved.text);
    writeFileSync(file,'# Edited outside the settings\n');
    const stale=await f.host.services.workspace.saveFoundation(f.host.operator.request('foundation.stale'),{workspaceId:'repo',expectedRevision:saved.revision,text:'Stale overwrite'});
    assert.equal(stale.ok,false);assert.equal(readFileSync(file,'utf8'),'# Edited outside the settings\n');
    assert.equal(readFileSync(join(f.repo,'.chatpet/manifest.json'),'utf8'),manifest);
  } finally {await f.close();}
});

test('the Core foundation works without Life and omits absent capabilities and other workspaces',async()=>{
  const f=await fixture();
  try {
    const world=createWorldService(f.host,()=>f.registry);
    assert.equal(renderCompanionFoundation(f.ctx,f.host,world,f.agent),'','An unconfigured foundation supplies no bundled persona');
    const before=ok(await f.host.services.workspace.readFoundation(f.host.operator.request('foundation.base'),{}));
    ok(await f.host.services.workspace.saveFoundation(f.host.operator.request('foundation.owner'),{workspaceId:'repo',expectedRevision:before.revision,
      text:'Owner-authored foundation. Self: {{selfFile}}\n{{#records}}RECORDS_AVAILABLE{{/records}}\n{{#memory}}MEMORY_AVAILABLE{{/memory}}\n{{#behavior}}BODY_AVAILABLE{{/behavior}}\n{{#emotion}}EMOTION_AVAILABLE{{/emotion}}'}));
    const text=renderCompanionFoundation(f.ctx,f.host,world,f.agent);
    assert.ok(text.includes('Owner-authored foundation.'));
    assert.ok(text.includes(join(companionWritingScope(f.ctx,f.host)!.directory,'self.md')));
    assert.ok(text.includes('RECORDS_AVAILABLE'));
    for(const absent of ['MEMORY_AVAILABLE','BODY_AVAILABLE','EMOTION_AVAILABLE'])assert.ok(!text.includes(absent));
    const other={id:'outside',session:{id:'outside',header:{cwd:'/other',agentPreset:'standard'}}} as unknown as Agent;
    assert.equal(renderCompanionFoundation(f.ctx,f.host,world,other),'');
    const guest={id:'owner-chat',session:{id:'owner-chat',header:{cwd:f.repo,agentPreset:'chatpet-channel-guest'}}} as unknown as Agent;
    assert.equal(renderCompanionFoundation(f.ctx,f.host,world,guest),'');
  } finally {await f.close();}
});

test('ordinary self writing remains owner-scoped without depending on a Memory component',async()=>{
  const f=await fixture();
  try {
    const scope=companionWritingScope(f.ctx,f.host)!;mkdirSync(scope.directory,{recursive:true});
    const file=join(scope.directory,'self.md');writeFileSync(file,'# 性子\nI was quiet.');
    let beforeWrite:Function|undefined;
    const ctx={on:(name:string,callback:Function)=>{if(name==='tools/pre-execute')beforeWrite=callback;}} as unknown as Context;
    trackCompanionWriting(ctx,f.host,()=>scope);
    f.host.native.memory={sourcesForWriting:async()=>{throw Error('Bank offline');}} as unknown as NonNullable<typeof f.host.native.memory>;
    await beforeWrite!({agent:f.agent,name:'write',arguments:{path:file}},async()=>({kind:'allow'}));
    writeFileSync(file,'# 性子\nI have become more willing to speak.');
    assert.ok((await readSelfPrompt(f.host,scope,f.agent.id)).includes('more willing'));
    f.host.native.memory=undefined;
    assert.ok((await readSelfPrompt(f.host,scope,f.agent.id)).includes('more willing'),'Self-description remains readable with Memory disabled');
    assert.equal(await readSelfPrompt(f.host,scope,'another-workspace'),'','Shared Bank access does not grant another session owner file access');
    assert.ok(readFileSync(file,'utf8').includes('more willing'),'Reading and switching Memory does not rewrite the original');
  } finally {await f.close();}
});

test('foreground owner home reuses one native session without Life or autonomous wakeups',async()=>{
  const f=await fixture();
  try {
    let created=0, renamed=0;
    const agents=new Map<string,Agent>();
    Object.assign(f.ctx,{logger:()=>({error:()=>{}}),sessionController:{
      create:async({agentPreset}:{agentPreset:string})=>{
        const id='foreground-home-'+(++created);f.workspace.sessionIds.push(id);
        agents.set(id,{id,session:{id,header:{cwd:f.repo,agentPreset}}} as unknown as Agent);
        return {sessionId:id};
      },
      resolveAgent:async(id:string)=>({agent:agents.get(id)}),rename:async()=>{renamed++;},
    }});
    f.services.set('sessionController',(f.ctx as unknown as {sessionController:unknown}).sessionController);
    const [first,second]=await Promise.all([resolveCompanionHome(f.ctx,f.host,'standard'),resolveCompanionHome(f.ctx,f.host,'standard')]);
    assert.equal(created,1);assert.equal(first.id,second.id);assert.equal(renamed,1);
    assert.equal(isCompanionHome(f.ctx,f.host,first.id),true);assert.equal(isCompanionHome(f.ctx,f.host,'other'),false);
    assert.equal((await resolveCompanionHome(f.ctx,f.host,'standard')).id,first.id);
    const message=createUserMessage({source:{kind:'dsh-world-life'},content:[]});
    assert.equal(f.host.native.sourceTable.admit({sessionId:first.id,message}).kind,'unclaimed','Opening a foreground home grants no autonomous admission');
    assert.equal(created,1);
    assert.deepEqual(f.host.workspace.runtime.store.get('companion-home',f.host.workspace.storageId()),
      {sessionId:first.id,arrivalPending:true});
    assert.equal(existsSync(join(f.repo,'.chatpet/data/life/life.json')),false);
  } finally {await f.close();}
});
