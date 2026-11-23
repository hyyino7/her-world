import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {accessSync, constants, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {PetPlatform} from '../../dist/src/desktop/platform/plugin.js';
import {Desktop} from '../../dist/src/desktop/index.js';
import {DEFAULT_COMPANION_SETTINGS} from '../../dist/src/core/companion-settings.js';

const lookup = path => fileURLToPath(new URL(path, import.meta.url));
const cli = lookup('../../' + JSON.parse(readFileSync(lookup('../../package.json'))).bin['dafeiyu-standalone']);
const binary = resolve(process.env.DSH_CHATBOT_ELECTRON_PATH ||
  join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'electron/Electron.app/Contents/MacOS/Electron'));
accessSync(binary, constants.X_OK);
const temp = realpathSync(mkdtempSync(join(tmpdir(), 'chatpet-standalone-test-')));
const env = {...process.env, TMPDIR:temp, CHATPET_PROBE_ELECTRON:binary, CHATPET_PROBE_DIR:temp,
  CHATPET_PROBE_SOURCE:lookup('../../tests/desktop/standalone-window-probe.cjs'),
  CHATPET_PRESENTATION_PROFILE:join(temp, 'platform-profile')};
const hostFlags = ['CHATPET_CHAT_ONLY','ELECTRON_RUN_AS_NODE','DSH_PET_APP_MODE','DSH_PET_DPI_PROBE','DSH_PET_IN_PROCESS'];
for (const key of hostFlags) delete env[key];

function runner(mode) {
  const file = join(temp, mode+'.sh');
  writeFileSync(file, `#!/bin/sh
if [ "$DSH_PET_DPI_PROBE" = "1" ]; then
  exec "$CHATPET_PROBE_ELECTRON" "$@"
fi
export CHATPET_PROBE_MODE=${mode}
exec "$CHATPET_PROBE_ELECTRON" "$CHATPET_PROBE_SOURCE" "$@"
`, {mode:0o700});
  return file;
}

async function runCli(args, electron) {
  const child = spawn(process.execPath, [cli, ...args], {
    env:{...env, DSH_CHATBOT_ELECTRON_PATH:electron}, stdio:'inherit',
  });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 60_000);
  const kill = setTimeout(() => child.kill('SIGKILL'), 65_000);
  try {
    const [code, signal] = await once(child, 'exit');
    assert.equal(code, 0, `独立 CLI 已退出（${signal ?? code}）`);
  } finally {
    clearTimeout(timeout); clearTimeout(kill);
  }
}

function readReport(name) {
  const report = join(temp, name+'.json');
  return existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : undefined;
}

async function waitReport(name) {
  const deadline = Date.now()+40_000;
  while (Date.now()<deadline) {
    for (const mode of ['managed','compact']) {
      const failure = readReport(mode+'-error');
      if (failure) throw Error(`${mode}: ${failure.message}`);
    }
    const report = readReport(name);
    if (report) return report;
    await pause(65);
  }
  throw Error('等待 Electron 探针报告超时：'+name);
}

async function offline() {
  await runCli([], runner('offline'));
  const failure = readReport('offline-error');
  if (failure) throw Error(failure.message);
  assert.deepEqual(readReport('offline'), {media:true, sleep:true, wake:true, offlineChat:true},
    '离线 Electron 退出前须完成窗口断言并写出报告');
}

async function online() {
  const repo = join(temp, 'binding');
  mkdirSync(repo);
  const target = {id:'test', path:repo, sessionIds:['original']};
  const settings = {...DEFAULT_COMPANION_SETTINGS, desktopSize:216, desktopTrayEnabled:false, desktopReplyBubble:true};
  let saved = 'original', platform, sequence = 0;
  const archivedSessionIds = [], agents = new Map(), actions = [], bodyActions = [];
  const append = (session, type, data) => {
    const event = {seq:++sequence, time:Date.now(), type, data};
    session.snapshotEvents().push(event);
    desktop.event(session, event);
  };
  const assistant = (session,text) => append(session, 'assistant/message', {message:{content:[{type:'text',text}]}});
  const native = {
    getPresentation:() => platform,
    getEmotion:() => undefined,
    workspaceRegistry:{
      get:id => id===target.id ? target : undefined, archivedSessionIds,
      archiveSession(id) { assert.equal(id,'original'); archivedSessionIds.push(id); },
    },
    agents:{get:id => agents.get(id)},
    sessions:{flush:async session => { assert.equal(session.id,'original'); }},
    sessionController:{
      async create({workspaceId}) {
        assert.equal(workspaceId,target.id);
        actions.push('new');
        target.sessionIds.push('new');
        assistant(addSession('new'), '新的原生会话');
        return {sessionId:'new'};
      },
      async resolveAgent(id) { return {agent:agents.get(id)}; },
      cancel({sessionId}) {
        assert.equal(sessionId,'new');
        actions.push('stop');
        const agent = agents.get(sessionId);
        agent.status = 'idle';
        append(agent.session,'turn/end',{turn:1,reason:{kind:'aborted'}});
        return {accepted:true};
      },
    },
  };
  const workspace = {
    status:() => ({state:'ready',target}), storageId:() => 'fixture-storage', companionSettings:() => settings,
    sessionStatus:() => ({state:'ready',target}),
    runtime:{
      store:{get:() => saved, put:(_kind,_key,id) => { saved=id; }},
      identity:() => ({displayName:'绑定伙伴',character:''}),
      policy:() => ({quiet:false}),
    },
  };
  const host = {workspace};
  const desktop = new Desktop(native, host);
  // Script the Body boundary while keeping the renderer's real command and presentation channels.
  desktop.features = {
    restore(){}, refresh(){}, pause(){},
    request({path,method}) {
      assert.equal(method,'POST');
      assert.ok(path==='/sleep' || path==='/wake');
      bodyActions.push(path);
      desktop.push('sleep',{sleeping:path==='/sleep',pending:false});
      return {ok:true};
    },
  };
  function addSession(id) {
    const events = [], session = {id,header:{cwd:repo},snapshotEvents:() => events};
    const agent = {session,status:'idle',followup(message) {
      assert.equal(id,'new');
      assert.equal(message.content[0].text,'临时测试');
      actions.push('send');
      agent.status = 'running';
      append(session,'user/message',message);
      append(session,'turn/start',{turn:1});
    }};
    agents.set(id,agent);
    return session;
  }
  assistant(addSession('original'),'绑定伙伴的历史');

  const server = createServer((req,res) => platform.http(req,res));
  const webServer = {getOrigin:() => 'http://127.0.0.1:'+webServer.port};
  try {
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    webServer.port = server.address().port;
    for (const key of hostFlags) delete process.env[key];
    Object.assign(process.env, env, {DSH_CHATBOT_ELECTRON_PATH:runner('compact'), DSH_PET_ELECTRON_PATH:runner('managed')});
    platform = new PetPlatform({get:() => undefined, on:() => () => {}, logger:console,
      connection:{broadcast(){}, authenticatedUrl:url => url}, webServer, petCore:host, petDesktop:desktop});
    const config = new URL('/chatpet-presentation/config',webServer.getOrigin());
    const dispatch = (method, input) => platform.handle(config, method, input, new AbortController().signal);
    const {bodyTemplate} = (await dispatch('GET')).obj.main;
    const put = await dispatch('PUT', JSON.stringify({pets:[{...bodyTemplate,display:'none',size:216}],trayEnabled:false}));
    assert.ok(put.status<400 && put.obj?.ok!==false);
    assert.deepEqual(platform.status().pets.map(pet => pet.display), ['none']);

    const {file} = platform.standaloneAccess(target.id);
    await runCli(['--connection',file], join(temp,'no-cli-electron'));
    assert.deepEqual(platform.status().pets.map(pet => pet.display), ['desktop']);
    const managed = async () => {
      assert.deepEqual(await waitReport('managed-ready'), {media:true,size:216,sleep:true,wake:true});
      desktop.presentLife('来自房间的提醒');
      assert.deepEqual(await waitReport('managed'), {bubble:true});
    };
    const compact = async () => {
      await waitReport('compact-stopped');
      assistant(agents.get('new').session,'宿主随后更新的记录');
      assert.deepEqual(await waitReport('compact'), {history:true, newSession:true, send:true, stop:true, hostUpdate:true});
    };
    const windows = await Promise.allSettled([managed(),compact()]);
    const errors = windows.filter(result => result.status==='rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors,'连接模式窗口检查失败');
    assert.deepEqual(actions,['new','send','stop']);
    assert.deepEqual(bodyActions,['/sleep','/wake']);
    assert.deepEqual(archivedSessionIds,['original']);
    assert.equal(saved,'new');
  } finally {
    desktop.closeChat(); platform?.close(); server.closeAllConnections(); server.close();
  }
}

try {
  const failures = [];
  for (const check of [offline, online]) {
    try { await check(); }
    catch (error) { failures.push(error); console.error(`[${check.name}]`, error); }
  }
  if (failures.length) process.exitCode = 1;
  else console.log(JSON.stringify({status:'passed', entry:'dafeiyu-standalone',
    offlineBody:true, offlineSleep:true, managedDesktop:true, managedSleep:true, compactChat:true, sharedRoomBubble:true, externalModels:0}));
} finally {
  rmSync(temp,{recursive:true,force:true});
}
