import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mountFixtureServices} from '../lib/native-fixture-mount.mjs';
import {mountInstalledStandard} from './lib/native-standard-preset.mjs';
import {say} from './lib/native-conversation-scenarios.mjs';

const app = '/Applications/DeepSeek Harness.app/Contents';
if (!process.versions.electron) {
  const child = spawnSync(join(app, 'MacOS/DeepSeek Harness'), ['--expose-internals', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {env: {...process.env, ELECTRON_RUN_AS_NODE:'1'}, stdio:'inherit', timeout:90000});
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}
const root = realpathSync(mkdtempSync(join(tmpdir(), 'chatpet-channel-homes-')));
const repo = join(root, 'owner'), deviceDirectory = join(root, 'device');
mkdirSync(repo); mkdirSync(deviceDirectory);
const require = createRequire(join(app, 'Resources/app.asar/dsh/package.json'));
const load = name => import(require.resolve('@deepseek-ai/' + name));
const {Context} = await load('cordis');
const {LlmAdapter, createUserMessage} = await load('dsh-llm');
const {createChannelHomes} = await import('../../dist/src/channels/sessions.js');
const {guestPrompt, GUEST_PRESET} = await import('../../dist/src/channels/guest.js');
const {askTurn} = await import('#dsh-world/ecosystem/shared/turn');
const {createQqHome} = await import('#dsh-world/adapters/qq-home');
const ctx = new Context();
ctx.baseUrl = pathToFileURL(join(app, 'Resources/app.asar/dsh/index.js')).href;
const calls = [];
let homes, program;
try {
  const mount = await mountFixtureServices(ctx, load, root);
  await mountInstalledStandard(ctx, require);
  for (const name of ['dsh-typert-registry','dsh-api-remote-access','dsh-api-gateway','dsh-session-query']) await mount(name);
  await mount('dsh-session-title', {fallbackMaxWords:5, fallbackMaxBytes:40, maxTitleBytes:80});
  await mount('dsh-attachment-local', {dshHome:root});
  await ctx.plugin({apply(scope){scope.provide('fileUploads',{registerAgentResolver:()=>()=>{}});}});
  await mount('dsh-agent-default-model', {provider:'channel-fixture', model:'local'});
  await mount('dsh-api-session-controller', {nativeOpen:false});
  await ctx.agentPresets.register({id:GUEST_PRESET, plugins:[
    {id:'audience', name:new URL('../../dist/src/channels/guest.js', import.meta.url).href},
  ]});
  const preset = await ctx.agentPresets.resolve(GUEST_PRESET);
  assert.ok(!preset.broken, preset.broken);
  class Fixture extends LlmAdapter {
    async *stream(options) {
      calls.push({id:options.sessionId, tools:options.tools?.map(t => t.name) ?? [],
        text:options.messages.flatMap(m => m.content.filter(b => b.type === 'text').map(b=>b.text)).join('\n')});
      if (program) {
        for await (const chunk of program(options)) {
          if(chunk.type==='finish')yield {type:'usage',usage:{inputTokens:12,outputTokens:3,cacheReadTokens:2}};
          yield chunk;
        }
      }
      else yield* say('收到当前聊天');
    }
  }
  ctx.llm.registerAdapter(['channel-fixture'], new Fixture());
  await ctx.plugin(await import('../../dist/src/core/plugin.js'), {dataDir:join(repo,'.chatpet/data/core'), cwd:repo,
    companionId:'fish', scopeId:'fixture', ownerActorId:'owner', displayName:'大肥鱼', character:'PRIVATE_FIXTURE_PERSONA'});
  const host = ctx.petCore, unwrap = r => {assert.ok(r.ok,JSON.stringify(r.error));return r.value;};
  const request = tag => host.operator.request('channel-fixture-' + tag);
  const workspace = await ctx.workspaceRegistry.create(repo, 'Disposable owner');
  const prefs = unwrap(await host.services.preferences.read(request('read'), {}));
  const bound = unwrap(await host.services.preferences.save(request('bind'), {expectedRevision:prefs.revision,conversation:prefs.conversation,
    workspace:{id:workspace.id,path:workspace.path,title:workspace.title}}));
  unwrap(await host.services.workspace.initialize(request('init'), {expectedPreferencesRevision:bound.revision}));
  writeFileSync(join(repo,'.chatpet/USER.md'), '# User\nPRIVATE_FIXTURE_USER_MARKER\n');
  const {sessionId: homeId} = await ctx.sessionController.create({workspaceId:workspace.id, agentPreset:'standard'});
  const {agent:home} = await ctx.sessionController.resolveAgent(homeId);
  const mockLife=await ctx.plugin({apply(scope){scope.provide('petLife', {isHome:id=>id === homeId});}});
  const identity = (who, id, type = 'private', account = 'first') => ({
    channel:'qq', accountId:account, speakerId:'qq:' + who, conversationId:id, conversationType:type,
    platformMessageId:'fixture-' + crypto.randomUUID(),
  });
  const owner = identity('owner','self'), friend = identity('friend','friend'), another = identity('other','other');
  const group = identity('owner','room','group'), groupMember = identity('friend','room','group');
  const config = {dataDirectory:join(repo,'.chatpet/data/channels'), ownerHome:async()=>home, identityAllowed:i => ['first','second'].includes(i.accountId),
    ownerIdentity:i => i.channel === 'qq' && i.accountId === 'first' && i.speakerId === 'qq:owner', active:()=>true};
  homes = createChannelHomes(ctx,host,config);
  assert.deepEqual(host.native.sourceTable.policyRows().filter(({row})=>row===5||row===6).map(({row})=>row),[5,6]);
  const {channelTotals} = await import('../../dist/src/core/usage/totals.js');
  const {usageDay} = await import('../../dist/src/core/usage/ledger.js');
  const qqCount = () => channelTotals(host.workspace.homeScope(),usageDay(Date.now())).qq.calls;
  const beforeChats = qqCount();
  const send = async (source, text) => {
    const agent = await homes.open(source);
    const words = createUserMessage({source:{kind:'user',identity:source},content:[{type:'text',text}]});
    assert.equal(await askTurn(ctx, agent, words, {name:'fixture',inWorld:s=>homes.owns(s.id)}),'收到当前聊天');
    assert.equal(calls.at(-1).id, agent.id);
    return agent;
  };
  assert.equal((await send(owner, 'hi owner')).id, home.id);
  assert.ok(calls.at(-1).text.includes('PRIVATE_FIXTURE_USER_MARKER'));
  const a = await send(friend, 'FRIEND_ONLY_FIXTURE');
  const b = await send(another, 'OTHER_ONLY_FIXTURE');
  const c = await send(group, 'GROUP_ONLY_FIXTURE');
  assert.equal((await send(groupMember, 'same group')).id,c.id);
  assert.equal((await send(friend,'friend again')).id,a.id);
  assert.ok(calls.at(-1).text.includes('FRIEND_ONLY_FIXTURE'));
  const wrongAccount = await send(identity('owner','self','private','second'), 'second account');
  assert.equal(qqCount()-beforeChats,7);
  assert.equal(new Set([home.id,a.id,b.id,c.id,wrongAccount.id]).size,5);
  for (const row of calls.filter(row => row.id !== home.id)) {
    assert.deepEqual(row.tools, []);
    assert.ok(row.text.includes(guestPrompt));
    assert.ok(row.text.includes('PRIVATE_FIXTURE_PERSONA'),'Guest shares the same companion persona');
    assert.ok(!row.text.includes('PRIVATE_FIXTURE_USER_MARKER'),'Static owner profile is not directly injected into guest chats');
    if (row.id !== a.id) assert.ok(!row.text.includes('FRIEND_ONLY_FIXTURE'));
    if (row.id !== c.id) assert.ok(!row.text.includes('GROUP_ONLY_FIXTURE'));
    if (row.id !== b.id) assert.ok(!row.text.includes('OTHER_ONLY_FIXTURE'));
  }
  assert.equal(host.workspace.sessionStatus(a.session, ctx.workspaceRegistry),null);
  assert.deepEqual(workspace.sessionIds,[home.id]);
  assert.equal(homes.allowsReply(a.id,group),false);
  const before = calls.length;
  const foreign = createUserMessage({source:{kind:'user',identity:friend},content:[{type:'text',text:'outside receipt'}]});
  home.followup(foreign); await home.whenIdle();
  assert.equal(calls.length,before);
  await assert.rejects(()=>homes.open(identity('friend','friend','private','unpaired')));
  homes.stop();
  assert.equal(host.native.isGuest(a.id),false);
  assert.equal(host.native.sourceTable.admit({sessionId:a.id,message:foreign}).kind,'unclaimed');
  assert.ok(host.native.sourceTable.policyRows().every(({row})=>row!==5&&row!==6));
  a.followup(foreign); await a.whenIdle();
  assert.equal(calls.length,before);
  homes = createChannelHomes(ctx,host,config);
  assert.equal((await send(friend,'after reopen')).id,a.id);
  const qq=createQqHome({ctx,home:id=>homes.open(id),inWorld:session=>homes.owns(session.id),
    replyNudge:(agent,words,nudge)=>homes.replyNudge(agent.id,words,nudge)});
  try {
    const beforeNudges = qqCount();
    for(const who of [owner,friend,group]) {
      let turn=0;program=async function*(){yield* say(turn++===0?'':'QQ_NUDGE_NATIVE_REPLY');};
      const result=await qq.ask('empty reply fixture',{...who,platformMessageId:'nudge-'+crypto.randomUUID()},undefined,'v1');
      assert.equal(result.nudged,true);assert.equal(result.text,'QQ_NUDGE_NATIVE_REPLY');assert.equal(turn,2);
    }
    let turn=0;program=async function*(){turn++;yield* say('');};
    assert.equal((await qq.ask('v2 quiet fixture',{...group,platformMessageId:'v2-'+crypto.randomUUID()},undefined,'v2')).nudged,false);
    assert.equal(turn,1);
    assert.equal(qqCount()-beforeNudges,7);
    assert.equal(host.native.acceptsInput(a.id,createUserMessage({source:{kind:'dsh-world-reply-nudge'},content:[{type:'text',text:'forged nudge'}]})),false);
  }finally{qq.stop();program=undefined;}
  console.log(JSON.stringify({ok:true, paidCalls:0, guests:4, separateGroups:true, guestTools:[],sharedPersona:true,ownerProfilePrivate:true,sessionRecovery:true,
    nativeOwnerGuestV1Nudge:true,v2NoNudge:true,forgedNudgeRejected:true}));
  if(process.argv.includes('--messaging')) {
    homes.stop();
    const {checkMessaging} = await import('../lib/check-messaging.mjs');
    await mount('dsh-host-webserver',{host:'127.0.0.1',port:0,compression:'none'});
    await checkMessaging({ctx,host,workspace,deviceDirectory,home,mockLife,setProgram:value=>{program=value;}});
  }
} finally {
  homes?.stop();
  await ctx.fiber.dispose();
  rmSync(root,{recursive:true,force:true});
}
