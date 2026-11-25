import test from 'node:test';
import assert from 'node:assert/strict';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {createChannelSourceAdapter} from '../../src/channels/sessions.js';
import {channelUsage} from '../../src/channels/usage.js';
import {readLedger} from '../../src/core/usage/ledger.js';

const {fixture, until} = await import(new URL('../../../tests/behavior-list/fixture.mjs',import.meta.url).href);
const {say} = await import(new URL('../../../scripts/checks/lib/native-conversation-scenarios.mjs',import.meta.url).href);
const input = (source: any) => createUserMessage({source,content:[{type:'text',text:'synthetic input'}]});
const route = {provider:'deepseek', model:'deepseek-flash'};

test('假适配器逐笔核对共享 home、桌面、房间、生活、渠道、独立调用及辅助用途', async t => {
  const received: unknown[][] = [];
  let expected = '', preset = 'standard', expectedPreset = preset, f: any;
  function stream(options: any) {
    return (async function* () {
      yield* await f.middleware('llm/stream',[options],async function* () {
        received.push([expected,expectedPreset,options.purpose ?? null,options.model,options.sessionId==='dsh-pet'?null:options.sessionId]);
        if (options.model === 'preferred') throw Error('synthetic route unavailable');
        yield {type:'usage',usage:{inputTokens:2,outputTokens:3}};
        yield* say('synthetic answer');
      });
    })();
  }
  f = await fixture(t,{policy:true,desktop:true,room:true,configure(services: Map<string,any>) {
    services.set('agentPresets',{composedPreset:(scope:unknown) =>
      services.get('agents').get('guest')?.ctx === scope ? 'chatpet-channel-guest' : preset});
    services.set('agentDefaultModel',{currentSelection:()=>route});
    services.set('llm',{stream});
  }});
  const rows = () => readLedger(f.repo,db=>db.prepare('SELECT entry,preset,purpose,model,session_id FROM calls ORDER BY rowid')
    .all().map(row=>Object.values(row))) ?? [];
  async function call(entry: string, id: string, purpose?: string) {
    expected = entry; expectedPreset = id === 'guest' ? 'chatpet-channel-guest' : preset;
    for await (const _ of stream({...route,sessionId:id,purpose})) { /* consume every chunk */ }
  }
  async function end(active: any, kind = 'completed') {
    active.toolSet?.dispose();
    const {agent,turn} = active, session = agent.session;
    await f.emit('session/event',session,session.append('assistant/message',{turn,message:{role:'assistant',content:[{type:'text',text:'Synthetic answer'}]},stream:[]}));
    await f.emit('session/event',session,session.append('turn/end',{turn,reason:{kind}}));
    agent.status = 'idle';
  }
  async function turn(entry: string, id: string, message?: any) {
    const active = await f.begin(id,message);
    await call(entry,id); await end(active);
  }
  const home = (await f.home()).id;
  await turn('dsh','owner-b',input({kind:'user',rpcId:'room-native-rpc'}));
  await turn('dsh',home);
  await f.create('empty');
  preset = 'cordis';
  await turn('dsh','empty');
  preset = 'standard';
  const chat = f.service('petDesktop').chat;
  for (const id of ['owner-b',home]) {
    const {sessionId,workspaceId} = await chat.run('open',{sessionId:id});
    await chat.run('send',{sessionId,workspaceId,text:'synthetic desktop',requestId:'room-desktop-'+id});
    await turn('desktop',id,f.agent(id).inbox.nextTurn[0]);
  }
  for (const tv of [false,true]) {
    const data = tv ? {image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='} : {text:'synthetic room'};
    const pending = f.service('petRoom').request('world',tv?'roomTelevision':'roomChat',data,'synthetic',new AbortController().signal);
    const queued = () => f.agents().find((agent:any)=>agent.id.startsWith('chatpet-room-') && agent.inbox.nextTurn.length);
    await Promise.race([pending,until(queued,'Room 已投递')]);
    const agent = queued();
    await turn(tv?'television':'room',agent.id,agent.inbox.nextTurn[0]); await pending;
  }
  await f.enable();
  const life = () => input({kind:'dsh-world-life'});
  const active = await f.begin(home,life());
  await call('life',home);
  await call('life',home,'compaction');
  await f.step(active,[input({kind:'user'})]); await call('dsh',home); await end(active);
  await call('maintenance',home,'compaction');
  const review = await f.begin(home,input({kind:'dsh-world-life',purpose:'review',reviewDay:'2026-11-14'}));
  await call('review',home); await end(review,'aborted');
  await turn('review',home,life());

  const grants = new Map<string,'owner'|'guest'>();
  const registration = f.host.native.sourceTable.register(createChannelSourceAdapter({
    guest:id=>id==='guest',ownerActorId:()=>'owner',admit:(_id,msg)=>grants.get(msg.id),
  }));
  let original: string | undefined;
  for (const channel of ['qq','wechat']) for (const role of ['owner','guest'] as const) {
    const message = input({kind:'user',identity:{channel,accountId:'fixture',conversationId:'private',speakerId:channel+':'+role}});
    if (channel === 'qq' && role === 'owner') original = message.id;
    grants.set(message.id,role);
    await turn(channel+'-'+role,role==='guest'?'guest':home,message);
  }
  const nudge = input({kind:'dsh-world-reply-nudge',forMessageId:original});
  grants.set(nudge.id,'owner'); await turn('qq-nudge',home,nudge);
  registration.revoke();

  const desktop = f.service('petDesktop');
  desktop.onPresentation(() => {}, () => true);
  for (const dream of [false,true]) {
    expected = dream ? 'chatpet-dream' : 'chatpet-whisper'; expectedPreset = '无会话';
    const result = await desktop.features.whisper(undefined,dream);
    assert.ok(result.ok, JSON.stringify(result));
  }
  const {generateWhisper} = await import(new URL('../../src/desktop/upstream/host/whisper.js',import.meta.url).href);
  expected = 'chatpet-whisper';
  const retry = await generateWhisper({llm:{stream:(opts:object)=>stream({...opts,purpose:expected})},
    agentDefaultModel:{currentSelection:()=>route}}, {system:'fixture',preferred:{...route,model:'preferred'}});
  assert.ok(retry.ok);
  assert.deepEqual(received.slice(-2).map(row=>row[3]),['preferred',route.model]);

  f.host.native.sourceTable.register({id:'fixture-undeclared',order:1,sources:['fixture-input'],
    branches:{ordinary:{turnKind:'foreground',toolSource:'owner',toolPolicy:null}},
    admit:()=>({kind:'accepted',branch:'ordinary',context:{policyKey:'fixture'}})});
  for (let i=0;i<2;i++) await turn('unknown',home,input({kind:'fixture-input'}));
  assert.equal(f.warnings.filter((w:any)=>String(w).includes('用量未归类')).length,1);
  expected = 'unknown'; expectedPreset = '无会话';
  for await (const _ of stream({...route,sessionId:'dsh-pet',purpose:'chatpet-fixture'})) {}
  const before = rows().length;
  await assert.rejects(f.begin(home,input({kind:'not-admitted'})),/准入/);
  const queued = input({kind:'user'}); f.agent(home).followup(queued); f.agent(home).inbox.remove(queued.id);
  assert.equal(received.length,before);
  assert.equal(rows().length,before);
  assert.deepEqual(rows(),received);

  // An unrelated native session can run the adapter, but cannot charge this companion.
  const header = f.agent('owner-b').session.header, cwd = header.cwd;
  try {
    header.cwd = f.root;
    await call('foreign','owner-b');
    assert.equal(rows().length,before);
  } finally { header.cwd = cwd; }
  await f.restart(); await turn('dsh',home);
  assert.equal(rows().length,before+1);
  assert.deepEqual(rows().at(-1),received.at(-1));
});

test('未迭代零调用；消费方提前停止或抛错记 cancelled，内层异常原样传回', async t => {
  const f = await fixture(t,{life:false,economy:false});
  const options = {...route,sessionId:'home'};
  let attempts = 0;
  const error = Error('inner'), consumer = Error('consumer');
  const open = (mode:string) => f.middleware('llm/stream',[options],async function* () {
    attempts++; yield {type:'usage',usage:{inputTokens:1,outputTokens:2}};
    if (mode === 'throw') throw error;
    yield {type:'finish',reason:{kind:mode}};
  });
  await open('unused');
  assert.equal(attempts,0);
  for (const mode of ['break','consumer','throw','error','aborted','tool-calls','completed']) {
    try {
      for await (const _ of await open(mode)) {
        if (mode === 'break') break;
        if (mode === 'consumer') throw consumer;
      }
      assert.notEqual(mode,'throw');
    } catch (err) { assert.equal(err, mode === 'throw' ? error : consumer); }
  }
  const rows = readLedger(f.repo,db=>db.prepare('SELECT outcome FROM calls ORDER BY rowid').all().map(r=>r.outcome));
  assert.deepEqual(rows,['cancelled','cancelled','error','error','aborted','tool-calls','completed']);
  assert.equal(attempts,rows!.length);
});

test('渠道旧事件和账本对同组请求按可比口径对账', async t => {
  const f = await fixture(t,{life:false,economy:false});
  const agent = f.agent('home'), ctx = agent.ctx;
  const legacy = channelUsage(ctx,f.host,'world',()=>true);
  const channel = createChannelSourceAdapter({guest:()=>false,ownerActorId:()=>'owner',admit:()=>'owner'});
  f.host.native.sourceTable.register(channel);
  const identity = {channel:'qq',accountId:'account',conversationId:'private',speakerId:'qq:owner'};
  const active = await f.begin('home',input({kind:'user',identity}));
  const usage = {inputTokens:3,outputTokens:5,cacheReadTokens:1,cacheWriteTokens:2};
  for (const kind of ['assistant/message','assistant/attempt','no-event','auxiliary']) {
    const chunks = kind==='assistant/attempt'?[]:[{type:'usage',usage}];
    const stream = await f.middleware('llm/stream',[{...route,sessionId:'home',purpose:kind==='auxiliary'?'compaction':undefined}],
      async function*(){yield* chunks; yield {type:'finish',reason:{kind:kind==='no-event'?'error':'completed'}};});
    for await (const _ of stream) { /* dispatch only emitted session events below */ }
    if (kind.startsWith('assistant/')) {
      const event = agent.session.append(kind,{turn:active.turn,message:{role:'assistant',content:[]},usage:chunks[0]?.usage,stream:chunks});
      await f.emit('session/event',agent.session,event); await f.emit('session/event',agent.session,event);
    }
  }
  const old = legacy.read('qq','account'); legacy.stop();
  assert.deepEqual(old,{requests:2,inputTokens:3,outputTokens:5,cacheReadTokens:1,unreported:1});
  const counts = readLedger(f.repo,db=>db.prepare("SELECT COUNT(*) AS n, COUNT(input_miss) AS reported, SUM(cache_write) AS writes FROM calls WHERE entry='qq-owner' AND purpose IS NULL").get());
  assert.equal(counts!.n,old.requests+1);
  assert.equal(counts!.reported,Number(counts!.n)-old.unreported);
  assert.equal(counts!.writes,4);
});
