'use strict';
// Compact window positioning, focus/hide and drag anchoring adapted from dsh-chatbot (MIT).
const { app, BrowserWindow, screen, ipcMain, protocol, net, desktopCapturer, systemPreferences, Tray, Menu, nativeImage } = require('electron');
const { createInterface } = require('node:readline');
const { join } = require('node:path');
const { mkdtempSync, rmSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const { tmpdir } = require('node:os');
const catalog = require('../assets/catalog.json');
const chatOnly = process.env.CHATPET_CHAT_ONLY === '1';
const {buildDeskGeometry} = require('./upstream/desktop-geometry.js');
const {decideWindowIgnore, spriteHitRect, pointerZone, leavesBody} = require('./upstream/pointer-target.js');
protocol.registerSchemesAsPrivileged([{scheme:'dsh-pet-bridge',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
let inputBusy = false, inputRegions, margins, ignoringPointer = false;
const geometry = () => buildDeskGeometry(screen.getAllDisplays(),screen.getPrimaryDisplay().id,process.platform);
const {createTray} = require('./upstream/main/tray.js');
const {trayPlatform} = require('./upstream/tray-platform.js');
let tray, trayEnabled = false, desktopVisible = true, trayUpdate = Promise.resolve();
let companionName = '';
function refreshTray(enabled) {
    trayEnabled = enabled;
    trayUpdate = trayUpdate.then(async () => {
        if (quitting || !tray) return;
        if (!trayEnabled) {
            tray.destroy();
            if (!desktopVisible) { desktopVisible = true; body.showInactive(); }
        } else if (tray.exists()) await tray.refresh();
        else await tray.start();
    }).catch(error => console.error('Desktop tray:', error.message));
}
function setDesktopVisible(visible) {
    desktopVisible = visible;
    if (visible) body.showInactive();
    else { chat.hide(); body.hide(); }
    refreshTray(trayEnabled);
}
async function trayRequest(method, path, payload) {
    if (method === 'GET' && path === '/quit') return {body: '{"canQuit":false}'};
    if (method === 'GET' && path === '/config') {
        const pet = {id: 'dafeiyu', name: companionName || '伙伴', display: desktopVisible ? 'desktop' : 'none'};
        return {body: JSON.stringify({main: {pets: [pet], trayEnabled}})};
    }
    if (method === 'POST' && path === '/pet-display') {
        const {id, display} = JSON.parse(payload);
        if (id === 'dafeiyu' && ['desktop', 'none'].includes(display)) setDesktopVisible(display === 'desktop');
        return {body: '{}'};
    }
    throw Error('Unsupported desktop tray action');
}
const profile = mkdtempSync(join(tmpdir(), 'chatpet-window-'));
app.setPath('userData', profile);
let body, chat, sequence = 0, quitting = false, lastChat, loaded = false;
let voiceWindow = new AbortController();
const pending = new Map();
const out = value => process.stdout.write(JSON.stringify(value) + '\n');
function cancelWindowVoice() {
    voiceWindow.abort();
    voiceWindow = new AbortController();
}
function request(action, input, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        const cancel = () => {
            pending.delete(id);
            out({ type: 'voice-cancel', id });
            reject(signal.reason);
        };
        const cleanup = () => signal?.removeEventListener('abort', cancel);
        signal?.addEventListener('abort', cancel, {once:true});
        pending.set(id, {
            resolve(value) { cleanup(); resolve(value); },
            reject(error) { cleanup(); reject(error); },
        });
        out({ type: 'request', id, action, input, ...(signal && {cancellableVoice:true}) });
    });
}
function emit(win, event, value) {
    if (win && !win.isDestroyed())
        win.webContents.send('pet:update', event, value);
}
createInterface({ input: process.stdin }).on('line', line => {
    let message;
    try {
        message = JSON.parse(line);
    }
    catch {
        return;
    }
    const { type, value } = message;
    if (type === 'response') {
        const waiter = pending.get(value.id);
        if (!waiter)
            return;
        pending.delete(value.id);
        value.ok ? waiter.resolve(value.result) : waiter.reject(Error(value.error));
    }
    else if (type === 'identity') {
        companionName = typeof value?.displayName === 'string' ? value.displayName : '';
        body?.setTitle(companionName || '伙伴');chat?.setTitle((companionName || '伙伴') + '聊天');
        emit(body,type,value);emit(chat,type,value);
        if (!chatOnly) refreshTray(trayEnabled);
    }
    else if (type === 'chat') {
        lastChat = value;
        if (chat?.isVisible())
            emit(chat, 'chat', value);
    }
    else if (type === 'show') {
        if (body && chat) setDesktopVisible(true);
    }
    else if (type === 'show-chat' && chat) {
        positionChat(); chat.show(); chat.focus(); emit(chat,'open',null);
    }
    else if (type === 'expression') {
        emit(body, type, value);
        if (value.sessionId === lastChat?.sessionId)
            emit(chat, type, value);
    }
    else if (type === 'preferences') {
        if (!chatOnly) refreshTray(value.desktopTrayEnabled !== false);
        emit(body, type, value);
    }
    else if (['say','sleep','sleep-text','balance','notice'].includes(type)) emit(body, type, value);
    else if (type === 'work')
        emit(body, type, value);
}).on('close', () => app.quit());
process.stdout.on('error', () => app.quit());
const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
function positionChat() {
    if (!chat)
        return;
    if (!body) {
        const a=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
        const w=Math.min(420,a.width),h=Math.min(480,a.height);
        chat.setBounds({width:w,height:h,x:a.x+a.width-w-24,y:a.y+a.height-h-24}); return;
    }
    const bounds = body.getBounds(), hit = spriteHitRect(bounds,margins);
    const b = {x:hit.left,y:hit.top,width:hit.right-hit.left,height:hit.bottom-hit.top};
    const a = screen.getDisplayMatching(bounds).workArea;
    const w = Math.min(386, a.width), h = Math.min(310, a.height);
    const below = b.y + b.height + 4;
    chat.setBounds({ width: w, height: h, x: clamp(Math.round(b.x + (b.width - w) / 2), a.x, a.x + a.width - w),
        y: clamp(below + h <= a.y + a.height ? below : b.y - h - 4, a.y, a.y + a.height - h) }, false);
}
function createWindow(page, options) {
    const win = new BrowserWindow({ show: false, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false,
        webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }, ...options });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    void win.loadFile(join(__dirname, page + '.html'), {query:{bridge:'1',openTarget:'desktop'}});
    return win;
}
function toggleChat() {
    if (chat.isVisible()) {
        chat.hide();
        return;
    }
    positionChat();
    chat.show();
    chat.focus();
    if (loaded)
        emit(chat, 'open', null);
}
ipcMain.handle('pet:command', async (event, action, input) => {
    if (quitting || !chat || chat.isDestroyed()) return;
    if (event.senderFrame !== event.sender.mainFrame)
        throw Error('无效窗口');
    if (action === 'catalog' && [body?.webContents, chat.webContents].includes(event.sender))
        return catalog;
    if (action === 'identity' && [body?.webContents, chat.webContents].includes(event.sender))
        return request(action, input);
    if (event.sender === chat.webContents) {
        if (action === 'hide')
            return chat.hide();
        if (action === 'capture') return requestCapture();
        if (['open', 'new', 'send', 'stop'].includes(action))
            return request(action, input);
    }
    if (!body || event.sender !== body.webContents)
        throw Error('无效请求');
    if (action === 'preferences') {
        const value = await request(action, input);
        refreshTray(value.desktopTrayEnabled !== false);
        return value;
    }
    if (['desktop-preference', 'desktop-api'].includes(action)) return request(action, input);
    if (action === 'capture') return requestCapture();
    if (action === 'attach-image') {
        if (!input || typeof input.base64 !== 'string' || input.base64.length>1024*1024) throw Error('图片无效或过大');
        positionChat();chat.show();chat.focus();emit(chat,'open',null);emit(chat,'attachment',input);return;
    }
    if (action === 'open-session') {
        const snapshot=await request('open-session',input);lastChat=snapshot;positionChat();chat.show();chat.focus();emit(chat,'chat',snapshot);return snapshot;
    }
    if (action === 'reload') return body.reload();
    if (action === 'toggle')
        return toggleChat();
    if (action === 'body-ready') {
        if (desktopVisible) body.showInactive();
        out({ type: 'ready' });
        return;
    }
    if (action === 'report')
        return request('playback', input);
    if (action === 'geometry') return geometry();
    if (action === 'bounds') {
        if (!Array.isArray(input) || input.length !== 12 || !input.every(Number.isFinite)) throw Error('Invalid sprite bounds');
        const [x,y,width,height,,,,,,,l,t] = input;
        if (width < 1 || height < 1 || width > 4096 || height > 4096) throw Error('Invalid sprite size');
        margins = {l,t};
        // Match upstream main/ipc.js: movement coordinates describe content bounds.
        body.setContentBounds({x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height)},false);
    } else if (action === 'input-busy') inputBusy = !!input;
    else if (action === 'input-regions') inputRegions = input;
    else if (action === 'interactive') {
        ignoringPointer = inputBusy ? false : !input;
        body.setIgnoreMouseEvents(ignoringPointer,{forward:true});
    } else if (action === 'focus') body.focus();

});
async function requestCapture() {
        if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') throw Error('请先在系统设置中允许桌宠运行环境录屏');
        const display = screen.getDisplayMatching((body ?? chat).getBounds());
        const sources = await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.min(1600,display.size.width),height:Math.min(1000,display.size.height)}});
        const source = sources.find(s => s.display_id === String(display.id));
        if (!source || source.thumbnail.isEmpty()) throw Error('没有取得当前屏幕画面');
        const bytes = source.thumbnail.toJPEG(80), size=source.thumbnail.getSize();
        return {data:bytes.toString('base64'),mediaType:'image/jpeg',bytes:bytes.length,...size};
    }
app.whenReady().then(() => {
    protocol.handle('dsh-pet-bridge', async req => {
        const url=new URL(req.url), path=url.pathname.replace(/^\/dsh-pet-7340/, '');
        if (url.hostname !== 'dsh-pet') return new Response('Invalid host',{status:403});
        if (path === '/sound/click-duck.wav' && req.method === 'GET') return net.fetch(pathToFileURL(join(__dirname,'../assets/sound/click-duck.wav')).href);
        if (!/^\/(todos(?:\/[A-Za-z0-9_-]+)?|voice\/(hear|speak|voices)|whisper|balance|sleep|wake)$/.test(path)) return new Response('Unsupported operation',{status:404});
        try {
            const signal = path.startsWith('/voice/') ? AbortSignal.any([req.signal, voiceWindow.signal]) : undefined;
            const bodyText = ['POST','PATCH'].includes(req.method) ? await req.text() : undefined;
            if (bodyText && Buffer.byteLength(bodyText) > (path === '/voice/hear' ? 1048576 : 16384)) return new Response('Too large',{status:413});
            const result=await request('desktop-api',{path:path+url.search,method:req.method,body:bodyText},signal);
            if (path === '/voice/speak' && result?.audio) return new Response(Buffer.from(result.audio, 'base64'), {
                headers:{'Content-Type':'audio/mpeg','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
            return Response.json(result,{headers:{'Access-Control-Allow-Origin':'*'}});
        } catch(error) {return Response.json({ok:false,message:error.message},{status:400,headers:{'Access-Control-Allow-Origin':'*'}});}
    });
    app.dock?.hide();
    const a = screen.getPrimaryDisplay().workArea;
    if (chatOnly) {
        chat=createWindow('chat',{frame:true,alwaysOnTop:false,skipTaskbar:false,resizable:true,width:420,height:480,backgroundColor:'#f6f8f8',title:'伙伴聊天'});
        chat.on('hide',cancelWindowVoice);
        chat.webContents.once('did-finish-load',()=>{loaded=true;out({type:'ready'});});
        chat.on('close',e=>{if(!quitting){e.preventDefault();chat.hide();}});
        return;
    }
    // Upstream main/windows.js permits bubble/menu margins above the menu bar.
    body = createWindow('body', { hasShadow: false, useContentSize: true, enableLargerThanScreen: true, transparent: true, width: 146, height: 132, x: a.x + a.width - 195, y: a.y + a.height - 195, title: '伙伴' });
    body.webContents.setBackgroundThrottling(false);
    chat = createWindow('chat', { width: 386, height: 310, backgroundColor: '#f6f8f8', title: '伙伴聊天' });
    chat.on('hide',cancelWindowVoice);
    tray = createTray({
        app, Tray, Menu, nativeImage, hostRequest: trayRequest, callbackUrl: () => true,
        isBridge: true, appMode: false, petRoute: '', platform: trayPlatform(process.platform),
        helperDir: join(__dirname, 'upstream'),
    });
    body.on('move', () => { if (chat.isVisible())
        positionChat(); });
    chat.webContents.on('did-finish-load', () => { loaded = true; if (chat.isVisible())
        emit(chat, 'open', null); });
    chat.on('close', e => { if (!quitting) {
        e.preventDefault();
        chat.hide();
    } });
    let offBodyMs = 0, previousZone;
    const pointerPump = setInterval(() => {
        if (body.isDestroyed()) return;
        const cursor = screen.getCursorScreenPoint(), bounds = body.getBounds();
        const zone = pointerZone(bounds, cursor, margins);
        if (!inputBusy && leavesBody(previousZone, zone)) body.webContents.send('pet:pointer-left');
        previousZone = zone;
        offBodyMs = !inputBusy && zone === 'margin' ? offBodyMs + 60 : 0;
        const next = decideWindowIgnore(bounds,cursor,ignoringPointer,inputBusy,offBodyMs,inputRegions,margins);
        if (next !== ignoringPointer) { ignoringPointer = next; body.setIgnoreMouseEvents(next,{forward:true}); }
    },60);
    pointerPump.unref();
    body.on('closed',()=>clearInterval(pointerPump));
    const refresh = () => emit(body,'geometry',geometry());
    screen.on('display-added',refresh); screen.on('display-removed',refresh); screen.on('display-metrics-changed',refresh);

});
app.on('before-quit', () => {
    quitting = true;
    void trayUpdate.then(() => tray?.destroy());
    for (const waiter of pending.values()) waiter.reject(Error('桌宠正在关闭'));
    pending.clear();
    for (const win of [body,chat]) if (win && !win.isDestroyed()) win.destroy();
});
app.on('quit', () => { rmSync(profile, { recursive: true, force: true }); });
