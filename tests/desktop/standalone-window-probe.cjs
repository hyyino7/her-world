// Observe the actual helper launched by the CLI or the isolated host.
const {app, BrowserWindow} = require('electron');
const {setTimeout:pause} = require('node:timers/promises');
const {renameSync, writeFileSync} = require('node:fs');
const {join} = require('node:path');
const {pathToFileURL} = require('node:url');
const assert = require('node:assert/strict');

const mode = process.env.CHATPET_PROBE_MODE;
const helper = process.argv[2];
const report = (name, value) => {
  const file = join(process.env.CHATPET_PROBE_DIR, name+'.json');
  writeFileSync(file+'.tmp', JSON.stringify(value));
  renameSync(file+'.tmp', file);
};

async function until(probe, label, ms = 12_000) {
  const end = Date.now()+ms;
  while (Date.now()<end) {
    const result = await probe();
    if (result) return result;
    await pause(65);
  }
  throw Error('等待窗口状态超时：'+label);
}

function page(name) {
  const url = new URL(name+'.html',pathToFileURL(helper)).href;
  return until(() => BrowserWindow.getAllWindows().find(win =>
    win.webContents.getURL().split('?')[0]===url && !win.webContents.isLoading()), name);
}

async function decoded(win) {
  await until(() => win.isVisible() && win.webContents.executeJavaScript(
    'document.querySelector("video.is-front")?.videoWidth > 0'), '原版桌宠视频解码');
}

async function sleepAndWake(body) {
  await body("sprites[0].postSleepAction('sleep')");
  await until(() => body("sprites[0].sleepPhase==='loop' && sprites[0].sleeping"), '入睡动画');
  await body("sprites[0].postSleepAction('wake')");
  await until(() => body("!sprites[0].sleeping"), '醒来动画');
}

async function offline() {
  const pet = await page('body'), chat = await page('chat');
  const body = code => pet.webContents.executeJavaScript(code);
  const ui = code => chat.webContents.executeJavaScript(code);
  await decoded(pet);
  await sleepAndWake(body);
  await body("window.pet.call('toggle')");
  await until(() => chat.isVisible() && ui("document.querySelector('#notice').textContent.includes('离线陪伴')"), '离线聊天提示');
  assert.equal(await ui("document.querySelector('#send').disabled"), true);
  report(mode,{media:true,sleep:true,wake:true,offlineChat:true});
  app.quit();
}

async function managed() {
  const pet = await page('index');
  const body = code => pet.webContents.executeJavaScript(code);
  await decoded(pet);
  assert.equal(await body('sprites[0].size'),216);
  await sleepAndWake(body);
  report('managed-ready',{media:true,size:216,sleep:true,wake:true});
  await until(() => body("document.querySelector('.pet-bub-row')?.textContent.includes('来自房间的提醒')"), '宿主提醒气泡');
  report(mode,{bubble:true});
}

async function compact() {
  const chat = await page('chat');
  const ui = code => chat.webContents.executeJavaScript(code);
  await until(() => chat.isVisible() && ui("document.querySelector('#history').textContent.includes('绑定伙伴的历史')"), '绑定会话历史');
  await ui("document.querySelector('#fresh').click()");
  await until(() => ui("document.querySelector('#history').textContent.includes('新的原生会话')"), '新建原生会话');
  await ui(`const input = document.querySelector('#input');
    input.value = '临时测试'; input.dispatchEvent(new Event('input'));
    document.querySelector('#composer').requestSubmit();`);
  await until(() => ui("!document.querySelector('#stop').hidden && !document.querySelector('#stop').disabled"), '原生回合可停止');
  await ui("document.querySelector('#stop').click()");
  await until(() => ui("document.querySelector('#status').textContent==='已停止'"), '原生回合停止');
  report('compact-stopped',{stopped:true});
  await until(() => ui("document.querySelector('#history').textContent.includes('宿主随后更新的记录')"), '宿主推送历史更新');
  report(mode,{history:true,newSession:true,send:true,stop:true,hostUpdate:true});
}

async function run() {
  require(helper);
  await app.whenReady();
  await {offline,managed,compact}[mode]();
}
run().catch(error => {
  console.error(error);
  report(mode+'-error',{message:error.message});
  app.exit(1);
});
