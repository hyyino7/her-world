'use strict';
// Run with the Electron executable and no ELECTRON_RUN_AS_NODE.
// The real Compact BrowserWindow uses Chromium's synthetic microphone.
const {app, BrowserWindow} = require('electron');
const assert = require('node:assert/strict');
const {PassThrough} = require('node:stream');
const {setTimeout: delay} = require('node:timers/promises');

process.env.CHATPET_CHAT_ONLY = '1';
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
const inbound = new PassThrough();
Object.defineProperty(process, 'stdin', {value:inbound});
const frames = [], write = process.stdout.write.bind(process.stdout);
const send = (type, value) => inbound.write(JSON.stringify({type, value})+'\n');
const snapshot = sessionId => ({workspaceId:'fixture', sessionId, messages:[{role:'assistant',text:'合成语音测试'}]});
const respond = (id, result) => send('response', {id,ok:true,result});
process.stdout.write = (chunk, ...args) => {
    if (typeof chunk === 'string') {
        let frame;
        try { frame = JSON.parse(chunk); } catch {}
        if (frame?.type) {
            frames.push(frame);
            if (frame.action === 'open') respond(frame.id,snapshot('a'));
            if (frame.action === 'catalog') respond(frame.id,{stickers:[]});
            if (frame.action === 'identity') respond(frame.id,{displayName:'测试伙伴'});
        }
    }
    return write(chunk, ...args);
};
require('../../src/desktop/helper/main.cjs');

async function until(label, check) {
    for (let i=0; i<120; i++) {
        const value = await check();
        if (value) return value;
        await delay(50);
    }
    throw Error(label+' timed out');
}
const voiceRequest = (path, after=0) => frames.slice(after).find(f => f.type==='request' && f.input?.path===path);
const cancelled = id => frames.find(f => f.type==='voice-cancel' && f.id===id);
async function run() {
    await until('Compact ready', () => frames.find(f => f.type==='ready'));
    const [win] = BrowserWindow.getAllWindows();
    assert.ok(win);
    win.webContents.setAudioMuted(true);
    win.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission==='media'));
    const js = source => win.webContents.executeJavaScript(source);
    send('show-chat', true);
    await until('Compact history', () => js("!document.hidden && !!document.querySelector('#history button')"));
    await js("document.querySelector('#history button').click()");
    const speaking = await until('synthesis submitted to host', () => voiceRequest('/voice/speak'));
    assert.equal(speaking.cancellableVoice,true);
    await js("document.querySelector('#history button').click()");
    await until('stop reading cancelled synthesis at host', () => cancelled(speaking.id));
    respond(speaking.id,{audio:'AAAA'}); // A late response must leave the stop state stable.
    assert.equal(await js("document.querySelector('#history button').textContent"),'朗读');

    async function record() {
        const from = frames.length;
        await js("document.querySelector('#mic').dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:1,bubbles:true}))");
        await until('synthetic mic recording', () => js("document.querySelector('#notice').textContent.startsWith('录音中 ')"));
        await delay(1200);
        await js("document.querySelector('#mic').dispatchEvent(new PointerEvent('pointerup',{button:0,pointerId:1,bubbles:true}))");
        return until('transcription submitted to host', () => voiceRequest('/voice/hear',from));
    }

    const hearing = await record();
    assert.equal(hearing.cancellableVoice,true);
    assert.equal(Buffer.from(JSON.parse(hearing.input.body).audio,'base64').subarray(0,4).toString(),'RIFF');
    send('chat',snapshot('b')); // Switch session without hiding the native window.
    await until('session switch cancelled transcription at host', () => cancelled(hearing.id));
    const current = await record();
    assert.notEqual(current.id,hearing.id);
    respond(hearing.id,{ok:true,text:'迟到的旧文字'});
    respond(current.id,{ok:true,text:'新会话转写'});
    await until('new transcript inserted', () => js("document.querySelector('#input').value === '新会话转写'"));

    const from = frames.length;
    await js("document.querySelector('#history button').click()");
    const hiding = await until('second synthesis submitted', () => voiceRequest('/voice/speak',from));
    win.hide();
    await until('native hide cancelled synthesis at host', () => cancelled(hiding.id));
    console.log(JSON.stringify({check:'compact-voice-electron', stopReading:true, sessionSwitch:true, nativeHide:true, syntheticMicrophone:true}));
}
const timeout=setTimeout(()=>app.exit(1),35000);
app.whenReady().then(run).then(()=>app.quit(),error=>{console.error(error.stack);app.exit(1);});
app.on('before-quit',()=>{clearTimeout(timeout);inbound.end();});
