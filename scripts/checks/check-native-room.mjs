// Disposable native workspace, installed DSH services, local fixture model only.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mountFixtureServices} from '../lib/native-fixture-mount.mjs';
import {mountInstalledStandard} from './lib/native-standard-preset.mjs';
import {call, say} from './lib/native-conversation-scenarios.mjs';
const app = '/Applications/DeepSeek Harness.app/Contents';
if (!process.versions.electron) {
  const child = spawnSync(join(app,'MacOS/DeepSeek Harness'),['--expose-internals',fileURLToPath(import.meta.url), ...process.argv.slice(2)],{
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit',timeout:100000});
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}
const root = realpathSync(mkdtempSync(join(tmpdir(),'chatpet-native-room-')));
const require = createRequire(join(app,'Resources/app.asar/dsh/package.json'));
const load = name => import(require.resolve('@deepseek-ai/'+name));
const {Context} = await load('cordis'), {LlmAdapter} = await load('dsh-llm');
const ctx = new Context();
ctx.baseUrl = pathToFileURL(join(app,'Resources/app.asar/dsh/index.js')).href;
const unwrap = r => {assert.ok(r.ok,JSON.stringify(r.error));return r.value;};
const seen = [];
let program;
class Fixture extends LlmAdapter {
  async *stream(options) {
    seen.push(options);
    if (program && (options.sessionId?.startsWith('chatpet-room-') || options.sessionId?.startsWith('photo-test-'))) {yield* program(options);return;}
    yield* say('房间测试回执');
  }
}
try {
  const mount = await mountFixtureServices(ctx,load,root);
  await mountInstalledStandard(ctx,require);
  for(const name of ['dsh-typert-registry','dsh-api-remote-access','dsh-api-gateway','dsh-session-query']) await mount(name);
  await mount('dsh-attachment-local',{dshHome:root});
  await mount('dsh-host-webserver',{host:'127.0.0.1',port:0,compression:'none'});
  await ctx.plugin({apply(scope){scope.provide('fileUploads',{registerAgentResolver:()=>()=>{}});}});
  await mount('dsh-agent-default-model',{provider:'room-fixture',model:'local'});
  await mount('dsh-api-session-controller',{nativeOpen:false});
  ctx.llm.registerAdapter(['room-fixture'],new Fixture());
  await ctx.plugin(await import('../../dist/src/core/plugin.js'),{dataDir:join(root,'.chatpet/data/core'),cwd:root,companionId:'fish',scopeId:'fixture',ownerActorId:'owner',displayName:'大肥鱼',character:'测试房间'});
  const host = ctx.petCore, req = id=>host.operator.request('room-check-'+id);
  const ws = await ctx.workspaceRegistry.create(root,'Disposable Room');
  const prefs = unwrap(await host.services.preferences.read(req('read'),{}));
  const saved = unwrap(await host.services.preferences.save(req('bind'),{expectedRevision:prefs.revision,conversation:prefs.conversation,workspace:{id:ws.id,path:ws.path,title:ws.title}}));
  unwrap(await host.services.workspace.initialize(req('init'),{expectedPreferencesRevision:saved.revision}));
  await ctx.plugin(await import('../../dist/src/living/body/plugin.js'));
  await ctx.plugin(await import('../../dist/src/living/plan/plugin.js'));
  const owner = await ctx.plugin(await import('../../dist/src/room/plugin.js'));
  const roomUrl = new URL('/chatpet-room/',ctx.webServer.getOrigin());
  const page = await fetch(new URL('index.html',roomUrl));
  assert.equal(page.status,200);
  assert.match(await page.text(),/<canvas|type="module"/);
  const model = await fetch(new URL('assets/models/da-feiyu.opt.glb',roomUrl),{headers:{Range:'bytes=0-3'}});
  assert.equal(model.status,206);
  assert.equal(await model.text(),'glTF');
  const endpoint=(name,data={},id=name)=>ctx.petRoom.request(ws.id,name,data,id,new AbortController().signal);
  assert.ok((await endpoint('roomState')).her);
  assert.equal((await endpoint('roomGarden')).garden.plots.length,8);
  assert.deepEqual((await endpoint('roomHistory')).messages,[]);
  assert.equal(seen.length,0);
  await ctx.petLife.control(ws.id,true);
  const lifeSession=(await ctx.petLife.snapshot(ws.id)).life.homeSessionId;
  await ctx.agents.get(lifeSession)?.whenIdle();
  await endpoint('roomAction',{action:'pet'},'pet');
  await endpoint('roomAction',{action:'pet'},'pet');
  assert.equal((await endpoint('roomState')).room.counts.pet,1);
  const garden=await endpoint('roomPlant',{type:'harvest',plotId:0},'pick');
  assert.equal(garden.ok,false,'Fresh empty garden must reject harvest without inventing crops');
  assert.ok((await endpoint('roomCare',{type:'auto',enabled:false},'pause')).ok);
  let step=0;
  program=async function*(options) {
    if (!step++) yield* call('room_action',{action:'water'});
    else yield* say('我已经喝了水。');
  };
  const chat=await endpoint('roomChat',{text:'去喝水吧。'},'hello');
  assert.equal(chat.reply,'我已经喝了水。');
  assert.equal((await endpoint('roomState')).body !== undefined,true);
  assert.equal((await endpoint('roomHistory')).messages.length,2);
  assert.equal((await endpoint('roomState')).env.counts.water,1);
  const n=seen.length;
  assert.deepEqual(await endpoint('roomChat',{text:'去喝水吧。'},'hello'),chat);
  assert.equal(seen.length,n);
  await assert.rejects(()=>endpoint('roomChat',{text:'另一个问题'},'hello'));
  await assert.rejects(()=>endpoint('roomTelevision',{image:'bad-frame'}));
  const png='data:image/png;base64,'+readFileSync(new URL('../../src/desktop/assets/cursor-grab.png',import.meta.url)).toString('base64');
  step=0;
  program=async function*(){if (!step++) yield* call('room_action',{action:'feed'}); else yield* say('电视观后感。');};
  const fed=(await endpoint('roomState')).room.counts.feed;
  const television=await endpoint('roomTelevision',{image:png},'frame');
  assert.equal(television.reply,'电视观后感。');
  const tvInput=ctx.agents.get(ws.sessionIds.find(id=>id.startsWith('chatpet-room-'))).session.snapshotEvents()
    .filter(e=>e.type==='user/message' && e.data.source.kind==='chatpet-room-tv').at(-1);
  assert.ok(tvInput,'TV content remains an attributed native observation, not an owner statement');
  assert.ok(tvInput.data.content.some(x=>x.type==='image'));
  assert.deepEqual((await endpoint('roomHistory')).messages.map(x=>x.text),['去喝水吧。','我已经喝了水。']);
  const roomId=ws.sessionIds.find(id=>id.startsWith('chatpet-room-'));
  assert.ok(roomId && roomId!==lifeSession);
  const events=ctx.agents.get(roomId).session.snapshotEvents();
  assert.ok(events.some(e=>e.type==='tool/result' && !e.data.message.isError));
  assert.ok(events.some(e=>e.type==='tool/result' && e.data.message.isError),'Actual TV tool invocation must be denied');
  assert.equal((await endpoint('roomState')).room.counts.feed,fed);
  assert.ok(events.some(e=>e.type==='user/message' && e.data.source.kind==='chatpet-room-tv' && e.data.content.some(x=>x.type==='image')));
  const frameSource=host.native.sourceTable.classify(tvInput.data);
  assert.equal(frameSource?.branch,'television');
  assert.equal(frameSource.lease.isCurrent(),true);
  assert.equal(host.native.sourceTable.admit({sessionId:roomId,message:tvInput.data}).kind,'rejected');
  await assert.rejects(()=>ctx.petRoom.request('another-workspace','roomState',{},'read',new AbortController().signal));
  if (process.argv.includes('--photo')) {
    step=0;
    program=async function*(){if (!step++) yield* call('room_photo',{view:'eyes',look:'room'});else yield* say('拍好了。');};
    await endpoint('roomChat',{text:'拍张第一视角照片。'},'photo');
    const result=ctx.agents.get(roomId).session.snapshotEvents().filter(e=>e.type==='tool/result').at(-1);
    assert.ok(!result.data.message.isError,JSON.stringify(result.data.message.content).slice(0,900));
    assert.ok(result.data.message.content.some(x=>x.type==='image'));
  }
  const {createUserMessage} = await load('dsh-llm');
  const {DesktopImages} = await import('../../dist/src/desktop/images.js');
  const images = new DesktopImages(host,()=>ctx.attachments);
  const attachment = await images.admit({mediaType:'image/png',data:png.split(',')[1]});
  async function albumTurn(id,name,args,content) {
    const {sessionId}=await ctx.sessionController.create({workspaceId:ws.id,sessionId:'photo-test-'+id});
    const {agent}=await ctx.sessionController.resolveAgent(sessionId);
    let toolCalled=false;
    program=async function*(){if(!toolCalled){toolCalled=true; yield* call(name,args);}else yield* say('相册完成。');};
    agent.followup(createUserMessage({source:{kind:'user'},content}));
    await agent.whenIdle();
    const result=agent.session.snapshotEvents().filter(e=>e.type==='tool/result').at(-1);
    assert.ok(result && !result.data.message.isError,JSON.stringify(result?.data.message.content).slice(0,500));
    return result.data.message.content.find(x=>x.type==='text')?.text;
  }
  const photo=JSON.parse(await albumTurn('a','pet_keep_photo',{description:'跨会话图片'},[{type:'text',text:'保存照片'},...attachment]));
  assert.ok(JSON.parse(await albumTurn('b','pet_list_photos',{},[{type:'text',text:'看相册'}])).photos.some(p=>p.id===photo.id));
  await albumTurn('c','pet_forget_photo',{id:photo.id},[{type:'text',text:'移除这张图片'}]);
  assert.equal((await host.records.library(ws.id,'album',0)).total,0);
  await owner.dispose();
  assert.equal(frameSource.lease.isCurrent(),false);
  assert.equal(host.native.sourceTable.classify(tvInput.data),undefined);
  assert.equal(host.native.sourceTable.admit({sessionId:roomId,message:tvInput.data}).kind,'unclaimed');
  assert.equal(ctx.get('petRoom'),undefined);
  console.log(JSON.stringify({ok:true,roomId,fixtureCalls:seen.length,photo:process.argv.includes('--photo'),crossSessionAlbum:true,paidCalls:0}));
} catch (error) {
  console.error(JSON.stringify(ctx.agents.list().map(a=>({session:a.id,events:a.session.snapshotEvents().filter(e=>e.type==='turn/end'||e.type==='step/error'||e.type==='agent/error').slice(-4)}))));
  throw error;
} finally {await ctx.fiber.dispose();rmSync(root,{recursive:true,force:true});}
