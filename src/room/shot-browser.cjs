'use strict';
// Run the original camera's shot mode in an isolated, read-only Electron
// window. No desktop capture, web service, QQ account or live user data route.
const { app, BrowserWindow, protocol, session } = require('electron');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const profile = mkdtempSync(join(tmpdir(), 'chatpet-room-photo-'));
app.setPath('userData', profile);
app.on('quit', () => { try { rmSync(profile, {force:true, recursive:true}); } catch {} });
protocol.registerSchemesAsPrivileged([{scheme:'pet-photo',privileges:{standard:true, secure:true, supportFetchAPI:true, stream:true, corsEnabled:true}}]);
async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const {view, look, home, garden} = JSON.parse(input);
  if (!home?.her || !garden || !['overview','eyes'].includes(view) || !['forward','room'].includes(look)) throw Error('照片场景无效');
  const {roomAsset, ROOM_PHOTO_ENDPOINTS} = await import('../../dist/src/room/assets.js');
  await app.whenReady();
  const isolated = session.fromPartition('room-photo');
  isolated.setPermissionRequestHandler((_contents,_permission,answer) => answer(false));
  isolated.webRequest.onBeforeRequest((details, done) => done({cancel: !details.url.startsWith('pet-photo://scene/') && !details.url.startsWith('blob:pet-photo://scene/') && !details.url.startsWith('data:')}));
  const parent = '<!doctype html><meta charset="utf-8"><style>* {margin:0;border:0} iframe {width:100vw;height:100vh;display:block}</style>';
  isolated.protocol.handle('pet-photo', req => {
    if (req.url === 'pet-photo://scene/') return new Response(parent, {headers:{'Content-Type':'text/html'}});
    return roomAsset(req);
  });
  const win = new BrowserWindow({width:1536,height:1024,useContentSize:true,show:false,webPreferences:{
    session:isolated, sandbox:true, contextIsolation:true, nodeIntegration:false, backgroundThrottling:false}});
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  await win.loadURL('pet-photo://scene/');
  // Assign structured values through a JSON expression. No snapshot text is HTML.
  await win.webContents.executeJavaScript(`((snapshots, routes, view, look) => {
    const frame = document.createElement('iframe');
    window.addEventListener('message', e => {
      if (e.source !== frame.contentWindow || e.origin !== location.origin || e.data?.kind !== 'chatpet.room' || !e.ports[0]) return;
      const endpoint = e.data.endpoint;
      const value = typeof endpoint === 'string' && Object.hasOwn(routes, endpoint) ? snapshots[routes[endpoint]] : null;
      e.ports[0].postMessage({ok:value !== null,value}); e.ports[0].close();
    });
    frame.src = '/chatpet-room/?shot=1&q=balanced&shotView=' + view + '&shotLook=' + look;
    document.body.append(frame);
  })(${JSON.stringify({home,garden,history:{messages:[]}})},${JSON.stringify(ROOM_PHOTO_ENDPOINTS)},${JSON.stringify(view)},${JSON.stringify(look)})`);
  const deadline = Date.now() + 45000;
  while (true) {
    const ready = await win.webContents.executeJavaScript("document.querySelector('iframe').contentDocument?.title === 'HOME_READY'");
    if (ready) break;
    if (Date.now() >= deadline) throw Error('房间画面未准备好');
    await delay(180);
  }
  await delay(450);
  const image = await win.webContents.capturePage();
  const data = image.toPNG().toString('base64');
  if (image.isEmpty() || data.length < 1024) throw Error('房间图像缺失');
  await new Promise(resolve => process.stdout.write(JSON.stringify({data}), resolve));
  win.destroy();
}
main().then(() => app.exit(0), error => {console.error(error.message); app.exit(1);});
