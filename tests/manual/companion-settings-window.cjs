// Run after pnpm run build with the standalone DSH Electron helper. The DSH
// renderer supplies React, and the production settings handler uses a temporary Repo.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const { createServer } = require('node:http');
const { basename } = require('node:path');
const { setTimeout: pause } = require('node:timers/promises');
const root = fs.mkdtempSync(join(tmpdir(), 'chatpet-settings-ui-'));
app.setPath('userData', join(root, 'profile'));
const frontend = join(process.env.DSH_APP || '/Applications/DeepSeek Harness.app',
  'Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets');

function createFixturePage() {
  const chunks = fs.readdirSync(frontend);
  const entry = chunks.find(name => /^index-.*\.js$/.test(name));
  assert.ok(entry, 'Installed DSH web frontend is required');
  for (const name of chunks.filter(name => /^(index|vendor)-.*\.js$/.test(name))) {
    fs.copyFileSync(join(frontend, name), join(root, name));
  }
  fs.copyFileSync(join(__dirname,'../../src/console/client.js'),join(root,'client.js'));
  const native=fs.readFileSync(join(__dirname,'../../src/desktop/platform/client.js'),'utf8').split('// Composed with the released Pet client')[0];
  fs.writeFileSync(join(root,'native.js'),native+'window.fixtureMakePresentation=makePetPresentation;})();');
  fs.writeFileSync(join(root, 'preload.cjs'), `const {contextBridge, ipcRenderer} = require('electron');
    contextBridge.exposeInMainWorld('callSettings',(route,payload)=>ipcRenderer.invoke('fixture:settings',route,payload));
    contextBridge.exposeInMainWorld('callPlatform',(route,method,body)=>ipcRenderer.invoke('fixture:platform',route,method,body));`);
  fs.writeFileSync(join(root, 'fixture.html'), `<!doctype html><meta charset="utf-8">
    ${chunks.filter(name=>/\.css$/.test(name)).map(name=>'<link rel="stylesheet" href="/'+name+'">').join('')}
    <style>body{margin:0;font:14px system-ui,sans-serif;color:#20242a;background:white} #fixture {padding:18px;}</style>
    <div id="root" hidden></div><main id="fixture"></main>
    <script>window.__ModuleLoader__={
      load(entry){window.settingsEntry=entry},
      create({staticModules}){window.hostModules=staticModules; throw Error("Fixture supplied its own settings page")}
    };</script><script src="./native.js"></script><script src="./client.js"></script><script type="module" src="./${entry}"></script>`);
}

async function check() {
  const { createCore } = await import('../../dist/src/core/index.js');
  const { settingsHandler } = await import('../../dist/src/console/settings.js');
  const { CompanionEmotion } = await import('../../dist/src/emotion/plugin.js');
  const world = await import('../../dist/src/world/index.js');
  const directory = join(root, '蓝鱼小屋');
  fs.mkdirSync(directory);
  const workspace = { id: 'fixture', title: '蓝鱼小屋', path: fs.realpathSync(directory),
    sessionIds: ['chat-a', 'chat-b', 'chat-c'], status: async () => 'ok' };
  const secondDirectory = join(root, '新小屋');
  fs.mkdirSync(secondDirectory);
  const secondWorkspace = { id: 'second', title: '新小屋', path: fs.realpathSync(secondDirectory),
    sessionIds: [], status: async () => 'ok' };
  const targets = [workspace, secondWorkspace];
  const config = { dataDir: join(root, 'core'), companionId: 'settings-fixture', scopeId: 'fixture',
    ownerActorId: 'owner', displayName: '大肥鱼', character: '一条喜欢听你说话的蓝鱼。',
    memory: { dataDir: join(workspace.path, '.chatpet/data/memory'), python: fs.realpathSync(join(__dirname, '../../.venv/bin/python')) } };
  const host = createCore(config);
  const emotion = new CompanionEmotion(host);
  const searchCalls = [];
  const memoryRows = [
    { id: 'source-a', excerpt: '主人提到了蓝色风铃' },
    { id: 'source-b', excerpt: '这条记录的来源已撤回' },
  ];
  let delayDetail = false;
  let completeDetail;
  host.native.memory.findForOwner = async (workspaceId, query) => {
    searchCalls.push({ workspaceId, query });
    return { items: query === '风铃' && workspaceId === workspace.id ? memoryRows : [], limit: 8 };
  };
  host.native.memory.readForOwner = async (workspaceId, id) => {
    searchCalls.push({ workspaceId, id });
    if (id !== memoryRows[0].id || workspaceId !== workspace.id) throw { code: 'INELIGIBLE' };
    if (delayDetail) await new Promise(resolve => { completeDetail = resolve; });
    return { id, content: '喜欢蓝色风铃。', dialogue: [{ role: 'user', text: '这是应当只在详情里出现的原话。' }] };
  };
  const upstreamHome = await import('../../vendor/feiyu-room-template/home-state.js');
  let lifeEnabled = false, lifeState = upstreamHome.emptyHomeState();
  let schedule = {wake:'09:00',review:'22:00',dailyBudget:null,compactAfterReview:false};
  const life = {
    snapshot: async workspaceId => ({workspaceId, enabled:lifeEnabled, running:lifeEnabled, preferences:schedule,timeZone:'Asia/Saigon', home:upstreamHome.homeView(lifeState), life:{}, activity:[]}),
    control: async (_id, enabled) => ({enabled:lifeEnabled=enabled}),
    settings: async (_id,expected,next) => {assert.deepEqual(expected,schedule);schedule=next;return schedule;},
    library:async(_id,op)=>op==='dates'?['2026-11-11']:op==='journal'?{day:'2026-11-11',diary:'今天在屋后种了菜。',activity:[]}:
      op==='album'?{photos:[],total:0,offset:0,limit:12,hasMore:false}:undefined,
    act: async (_id, action) => {const result=upstreamHome.applyHomeAction(lifeState,{action,at:Date.now()});lifeState=result.state;return result;}
  };
  const {defaults:channelDefaults,editableMessagingFields} = await import('../../dist/src/channels/messaging-settings.js');
  const channels = {request:async(_id,op)=>{
    if (op==='groupState') return {settings:{affinity:true,slang:true,stickers:true,forwards:true,roleCard:'',roleMode:'v2'},slang:[],affinity:[],stickers:[]};
    return {bridge:{preferences:{enabled:false,outlets:[]}},messaging:{fields:editableMessagingFields(),
      config:{...channelDefaults,qq:{...channelDefaults.qq,allowGroups:['123']}}}};
  }};
  let openedRooms=0;const room={open:async workspaceId=>({workspaceId,open:++openedRooms}),status:()=>({running:false})};
  const {PetPlatform}=await import('../../dist/src/desktop/platform/plugin.js');
  let address;
  const nativeCtx={get:()=>undefined,logger:console,connection:{broadcast(){},authenticatedUrl:url=>url},on:()=>()=>{},petDesktop:{chat:{id:'fixture-chat',snapshot:()=>({messages:[],sessionId:'fixture-chat',workspaceId:'fixture',generating:false})}},webServer:{getOrigin:()=>address},petCore:host};
  const platform=new PetPlatform(nativeCtx);
  let desktopStatus={running:false,requested:false,starting:false},desktopCloses=0;
  const desktop={status:()=>({...desktopStatus}),start:async()=>{desktopStatus={running:false,requested:true,starting:true};},
    closeWindow:async()=>{desktopCloses++;desktopStatus={running:false,requested:false,starting:false};}};
  ipcMain.handle('fixture:platform',async(_event,route,method,body)=>{const url=new URL(route,'http://localhost');const result=await platform.handle(url,method,body,new AbortController().signal);return {status:result.status||200,obj:result.obj||{}};});
  const handler = settingsHandler(() => host, () => ({ list: () => targets, get: id => targets.find(target => target.id === id) }),
    () => desktop, () => Object.keys(world), () => emotion, () => life, () => room, () => channels,()=>platform);
  const signal = new AbortController().signal;
  const peer = { principal: { kind: 'owner' }, signal };
  const call = async (endpoint, input = {}) => {
    const result = await handler(endpoint, { requestId: randomUUID(), input }, signal, peer);
    assert.ok(result.ok, JSON.stringify(result.error));
    return result.value;
  };
  let failNextSnapshot = true;
  let failNextInitialize = false;
  let failNextWorld = false;
  const calls = [];
  ipcMain.handle('fixture:settings', (_, route, payload) => {
    assert.match(route, /^chatpetSettings\/[A-Za-z]+$/);
    const endpoint = route.split('/').pop();
    const observed = { endpoint, input: payload.input };
    calls.push(observed);
    if (endpoint === 'snapshot' && failNextSnapshot) {
      failNextSnapshot = false;
      return { ok: false, error: { code: 'UNAVAILABLE', message: '暂时无法读取' } };
    }
    if (endpoint === 'initialize' && failNextInitialize) {
      failNextInitialize = false;
      return { ok: false, error: { code: 'UNAVAILABLE', message: '本次初始化未完成' } };
    }
    if (endpoint === 'worldView' && failNextWorld) {
      failNextWorld = false;
      return { ok: false, error: { code: 'UNAVAILABLE', message: '临时无法读取 World 资料' } };
    }
    return handler(endpoint, payload, signal, peer).then(result => {
      if (endpoint === 'worldView' && result.ok) observed.responseKeys = Object.keys(result.value);
      return result;
    });
  });

  createFixturePage();
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/chatpet-presentation/')) {
      try {req.headers.authorization='Bearer '+platform.ownerAccess('fixture').token;return platform.http(req,res);}
      catch {res.writeHead(503);return res.end();}
    }
    const name=url.pathname==='/'?'fixture.html':basename(url.pathname);
    const file=fs.existsSync(join(root,name))?join(root,name):join(frontend,name);
    if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  address='http://127.0.0.1:'+server.address().port;nativeCtx.webServer.port=server.address().port;
  const win = new BrowserWindow({ width: 800, height: 900, useContentSize: true, show: false,
    webPreferences: { preload: join(root, 'preload.cjs'), backgroundThrottling: false } });
  try {
    const evaluate = (func, ...args) => win.webContents.executeJavaScript(
      '(' + func.toString() + ')(' + args.map(arg => JSON.stringify(arg)).join(',') + ')');
    async function waitFor(func, ...args) {
      for (let index = 0; index < 90; index++) {
        if (await evaluate(func, ...args)) return;
        await pause(50);
      }
      throw Error('Timed out at ' + func + '\n' + await evaluate(() => document.querySelector('#fixture').innerText.slice(0,2000)));
    }
    async function click(label, selector = 'button') {
      await waitFor((label, selector) => {
        const element = Array.from(document.querySelectorAll('#fixture ' + selector))
          .find(element => element.textContent.trim() === label);
        if (!element || element.disabled) return false;
        element.click();
        return true;
      }, label, selector);
      await pause(40);
    }
    async function setField(label, value) {
      await waitFor((label, value) => {
        const field = Array.from(document.querySelectorAll('#fixture label'))
          .find(element => element.textContent.trim().startsWith(label))?.control;
        if (!field || field.disabled) return false;
        const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype
          : field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value);
        field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
        return true;
      }, label, String(value));
    }
    async function fieldValue(label) {
      return evaluate(label => Array.from(document.querySelectorAll('#fixture label'))
        .find(element => element.textContent.trim().startsWith(label))?.control?.value, label);
    }
    const activeTab = () => evaluate(() => document.querySelector('#fixture [role=tab][aria-selected=true]').textContent.trim());
    const panelText = () => evaluate(() => document.querySelector('#fixture [role=tabpanel]').innerText);
    const pageText = () => evaluate(() => document.querySelector('#fixture').innerText);
    const waitForSaved = () => waitFor(() => [...document.querySelectorAll('#fixture [role=status]')]
      .some(element => element.innerText.includes('设置已保存')));
    async function screenshot(name) {
      const destination = process.argv.includes('--screenshots') ? join(__dirname, '../../.cache/settings-redesign') : null;
      if (!destination) return;
      await evaluate(async () => { window.scrollTo(0, 0); await document.fonts.ready; });
      await pause(120);
      const debuggerApi = win.webContents.debugger;
      debuggerApi.attach();
      try {
        const { cssContentSize } = await debuggerApi.sendCommand('Page.getLayoutMetrics');
        const { data } = await debuggerApi.sendCommand('Page.captureScreenshot', {
          captureBeyondViewport: true, format: 'png', clip: { ...cssContentSize, scale: 1 },
        });
        assert.ok(data.length > 1000, 'Could not capture ' + name);
        fs.mkdirSync(destination, { recursive: true });
        fs.writeFileSync(join(destination, name + '.png'), Buffer.from(data, 'base64'));
      } finally {
        debuggerApi.detach();
      }
    }

    await win.loadURL(address);
    await waitFor(() => Boolean(window.hostModules?.react && window.settingsEntry));
    await evaluate(() => {
      const services=new Map(),disposers=[],dicts=new Map();
      const noop=()=>()=>{};
      const ctx = {get:name=>services.get(name),provide:(name,value)=>services.set(name,value),
        locale:{register(namespace,values){dicts.set(namespace,values);return()=>{};},bind:namespace=>(key,values={})=>{const dict=dicts.get(namespace)||{};let text=(dict['zh-CN']||dict.zh||{})[key]||key;return text;}},
        on:noop,effect(fn){const dispose=fn();if(typeof dispose==='function')disposers.push(dispose);},remote:{commands:{}},commandUi:{decorate:noop},
        slots: {
          inject(_,install){const result=install();if(result?.next)for(const _ of result){};},
          register(descriptor, component) {
            if (descriptor.name !== 'settings.section') return;
            window.settingsSlot = { id: descriptor.id, label: descriptor.label };
            const React = window.hostModules.react;
            window.hostModules['react-dom/client'].createRoot(document.querySelector('#fixture'))
              .render(React.createElement(component, descriptor.inject()));
          },
        },
        connection: { rpc: { call(_, route, payload) { return window.callSettings(route, payload); } } },
      };
      const modules=name=>window.hostModules[name];
      window.settingsEntry.factory(modules).apply(ctx);
      setTimeout(()=>window.fixtureMakePresentation(modules,async(route,init={})=>{const result=await window.callPlatform(route,init.method||'GET',typeof init.body==='string'?init.body:undefined);return new Response(JSON.stringify(result.obj),{status:result.status,headers:{'Content-Type':'application/json'}});},'/chatpet-presentation').apply(ctx),250);
      window.stopNative=()=>disposers.reverse().forEach(dispose=>dispose());
    });
    await waitFor(() => document.querySelector('#fixture [role=alert]')?.textContent.includes('暂时无法读取'));
    assert.deepEqual(await evaluate(() => window.settingsSlot), { id: 'her-world', label: '大肥鱼' });
    await click('刷新设置');
    await waitFor(() => !document.querySelector('#fixture [role=alert]') && !!document.querySelector('#fixture [role=tabpanel] h3'));
    let preferences = await call('preferences', {expectedRevision:(await call('snapshot')).preferences.revision,workspaceId:'fixture',conversation:(await call('snapshot')).preferences.conversation});
    await call('initialize',{expectedPreferencesRevision:preferences.revision});
    await click('刷新设置'); await waitFor(() => document.querySelector('#fixture [role=tabpanel]')?.innerText.includes('蓝鱼小屋'));
    platform.ownerAccess('fixture');
    await screenshot(process.env.CP_VISUAL_PHASE||'after');
    {
      for (const label of ['角色','情绪','记忆与档案','桌宠','生活','连接','工作区']) {await click(label,'[role=tab]'); await pause(200); await screenshot('after-' + label);}
      await click('角色','[role=tab]');await waitFor(()=>Boolean(document.querySelector('.cp-foundation')));
      const before=await fieldValue('基础说明内容');await setField('基础说明内容',before+'Fixture saved rule.');
      await click('情绪','[role=tab]');await setField('心情','calm');await setField('原因与想法','Disposable UI check');
      await click('角色','[role=tab]');assert.equal(await fieldValue('基础说明内容'),before+'Fixture saved rule.');await click('保存基础说明');await waitFor(()=>document.querySelector('[role=tabpanel]')?.innerText.includes('基础说明已保存'));
      assert.match((await call('foundation',{workspaceId:'fixture'})).text,/Fixture saved rule/);
      await click('情绪','[role=tab]');assert.equal(await fieldValue('心情'),'calm');await click('保存当前心情');await waitFor(()=>document.querySelector('[role=tabpanel]')?.innerText.includes('当前心情已保存'));
      assert.equal((await call('emotionState',{workspaceId:'fixture'})).state.mood,'calm');
      await click('概览','[role=tab]');await click('打开房间');await pause(150);assert.equal(openedRooms,1);
      await click('桌宠','[role=tab]');await pause(600);
      const nativeInputs=await evaluate(()=>[...document.querySelectorAll('.cp-appearance input')].map(e=>({type:e.type,value:e.value})));assert.ok(nativeInputs.length>5,'Original appearance editor must mount');
      assert.equal(await evaluate(()=>document.querySelectorAll('.cp-appearance .dsh-pet-cfg__persona').length),0,'Independent persona editor must be absent');
      assert.ok(!(await evaluate(()=>document.querySelector('.cp-appearance').innerText)).includes('对话与模型'),'Independent model editor must be absent');
      await click('刷新设置');
      await waitFor(()=>[...document.querySelectorAll('label')].some(e=>e.textContent==='碎碎念间隔（秒）'));
      const nextWhisper=Number(await fieldValue('碎碎念间隔（秒）'))+1;
      await setField('碎碎念间隔（秒）',nextWhisper);await click('保存互动间隔');
      await waitFor(()=>document.querySelector('[role=tabpanel]')?.innerText.includes('定时互动间隔已保存'));
      assert.equal((await call('snapshot')).presentation.timing.whisper,nextWhisper);
      await evaluate(()=>{
        const size=[...document.querySelectorAll('.cp-appearance input')].find(e=>e.type==='number'&&e.value==='232');
        if(!size)throw Error('Original size field missing');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(size,'289');size.dispatchEvent(new Event('input',{bubbles:true}));
      });
      await click('生活','[role=tab]');assert.ok(!(await panelText()).includes('此刻的心情'),'Previous Emotion panel must unmount');await waitFor(()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='喂小鱼干'&&!e.disabled));
      await click('桌宠','[role=tab]');assert.ok(await evaluate(()=>[...document.querySelectorAll('.cp-appearance input')].some(e=>e.type==='number'&&e.value==='289')),'Original appearance draft must survive tab changes');
      await screenshot('after-桌宠');
      await click('角色','[role=tab]');await setField('角色名称','Unsaved fixture name');
      await click('概览','[role=tab]');await click('打开桌宠');
      await waitFor(()=>[...document.querySelectorAll('button')].some(e=>e.textContent==='取消启动'));
      assert.ok(!(await pageText()).includes('桌宠已打开。'),'A launch request is not readiness');
      desktopStatus={running:true,requested:true,starting:false};
      await waitFor(()=>[...document.querySelectorAll('[role=status]')].some(e=>e.textContent==='桌宠已打开。'));
      await click('角色','[role=tab]');assert.equal(await fieldValue('角色名称'),'Unsaved fixture name','Status polling must preserve drafts');
      await click('概览','[role=tab]');await click('关闭桌宠');await click('打开桌宠');await click('取消启动');
      const readsAfterCancel=calls.filter(item=>item.endpoint==='snapshot').length;
      await pause(900);assert.equal(calls.filter(item=>item.endpoint==='snapshot').length,readsAfterCancel,'Cancel must stop status polling');
      await click('打开桌宠');desktopStatus={running:false,requested:false,starting:false};
      await waitFor(()=>[...document.querySelectorAll('[role=alert]')].some(e=>e.textContent.includes('桌宠未能启动')));
      const closesBeforeRetry=desktopCloses;await click('重试打开桌宠');await click('取消启动');
      assert.ok(desktopCloses>=closesBeforeRetry+2,'Retry resets a failed launch and remains cancellable');
      await click('生活','[role=tab]');
      win.setContentSize(460,900);await pause(200);await screenshot('after-narrow');assert.equal(await evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      console.log({foundationSaved:true,emotionSaved:true,roomOpen:openedRooms,nativeEditorInputs:nativeInputs.length,nativePersonaModelHidden:true,canonicalTiming:true,pausedCareEnabled:true,crossPageDrafts:true,appearanceDraftPreserved:true,desktopReadiness:true,desktopCancelRetry:true});
      console.log(await evaluate(() => ({tabs:[...document.querySelectorAll('[role=tab]')].map(e=>e.textContent),iframes:document.querySelectorAll('iframe').length,overflow:document.documentElement.scrollWidth>innerWidth})));
    }
  } finally {ipcMain.removeHandler('fixture:settings');ipcMain.removeHandler('fixture:platform');await win.webContents.executeJavaScript('window.stopNative?.()');platform.close();await host.close();win.destroy();server.closeAllConnections();server.close();}
}
app.on('window-all-closed',()=>{});
app.whenReady().then(check).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)});
app.on('quit',()=>fs.rmSync(root,{recursive:true,force:true}));
