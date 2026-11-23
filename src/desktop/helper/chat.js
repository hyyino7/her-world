'use strict';
// Compact native send, IME composition and reopen behavior adapted from dsh-chatbot (MIT).
const bridge = window.pet, $ = id => document.getElementById(id);
function showIdentity(value) {
    const name = typeof value?.displayName === 'string' && value.displayName ? value.displayName : '伙伴';
    $('companion-name').textContent = name;
    document.title = name + '聊天';
    $('input').setAttribute('aria-label', '给' + name + '发消息');
}
void bridge.call('identity').then(showIdentity).catch(() => {});
let state, pending = false, composition = false, compositionEnded = -Infinity, catalog, draftRequest;
const stickers = new Map();
let image = null, encoding = false;
let reading = 0;
let microphone;
const releaseVoice = () => { microphone?.dispose(); stopReading(); };
function readReply(text, button) {
    const id = ++reading, session = state?.sessionId;
    let remaining = text;
    button.textContent = '停止朗读';
    button.onclick = () => { stopReading(); button.textContent = '朗读'; button.onclick = () => readReply(text,button); };
    function next() {
        if (id !== reading || session !== state?.sessionId || document.hidden) return;
        if (!remaining) { button.textContent = '朗读'; button.onclick = () => readReply(text,button); return; }
        let length = Math.min(remaining.length,500);
        if (remaining.length > length && /[\uD800-\uDBFF]/u.test(remaining[length-1])) length--;
        const part = remaining.slice(0,length); remaining = remaining.slice(length);
        window.PetShared.speakText(part, phase => {
            if (id !== reading) return;
            if (phase === 'idle') return next();
            button.textContent = phase === 'failed' ? '重试朗读' : '停止朗读';
            if (phase === 'failed') { button.onclick = () => readReply(text,button); errors('语音合成失败，请检查语音组件和服务。'); }
        }, fetchVoice);
    }
    next();
}
function stopReading() { reading++; window.PetShared.stopManualSpeech(); }
const setImage = value => {image=value;draftRequest=null;$('attachment').hidden=!value;$('image-preview').src=value?.previewUrl ?? '';controls();};
async function imageFile(file) {if(!file)return;encoding=true;controls();try {setImage(await window.PetShared.encodeImageFile(file));errors('');}catch(e){errors(e.message);}finally{encoding=false;controls();}}
const errors = text => { $('notice').textContent = text; $('notice').hidden = !text; };
function controls() {
    const running = !!state?.generating;
    $('fresh').disabled = pending || running || !state?.sessionId;
    $('send').hidden = running;
    $('send').disabled = pending || !state?.sessionId || (!$('input').value.trim() && !image) || encoding;
    $('stop').hidden = !running;
    $('stop').disabled = pending || state?.turn == null;
    $('status').textContent = running ? '正在回复…' : state?.reason === 'aborted' ? '已停止' : state?.reason === 'error' ? '回复失败' : '';
}
function row(text, cls) { const p = document.createElement('p'); p.className = cls; p.textContent = text; return p; }
function render(next) {
    const history = $('history'), tail = history.scrollHeight - history.scrollTop - history.clientHeight < 48;
    if (next.sessionId !== state?.sessionId || next.workspaceId !== state?.workspaceId) { stickers.clear(); releaseVoice(); }
    state = next;
    const messages = state.messages || [], nodes = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        const message = row(m.text, m.role);
        if (m.role === 'assistant' && m.text) {
            const listen = document.createElement('button');
            listen.type = 'button'; listen.textContent = '朗读'; listen.title = '用桌宠语音朗读这条回复';
            listen.onclick = () => readReply(m.text,listen);
            message.append(listen);
        }
        nodes.push(message);
        const sticker = stickers.get(m.turn);
        if (sticker && m.role === 'assistant' && messages[i + 1]?.turn !== m.turn) {
            const img = new Image();
            img.src = '../assets/' + encodeURIComponent(sticker.file);
            img.alt = sticker.description || sticker.label;
            img.className = 'sticker';
            nodes.push(img);
        }
    }
    if (state.live)
        nodes.push(row(state.live, 'assistant'));
    history.replaceChildren(...nodes);
    if (tail)
        history.scrollTop = history.scrollHeight;
    controls();
}
async function act(action, fields = {}) {
    if (pending)
        return;
    if (action === 'new' || action === 'open' || action === 'send') releaseVoice();
    pending = true;
    controls();
    errors('');
    try {
        const snapshot = await bridge.call(action, { sessionId: state?.sessionId, workspaceId: state?.workspaceId, ...fields });
        render(snapshot);
        if (action === 'send') {
            if ($('input').value.trim() === fields.text)
                $('input').value = '';
            draftRequest = null;
            setImage(null);
        }
        $('input').focus();
    }
    catch (e) {
        errors(e.message.replace(/^.*Error: /, ''));
    }
    finally {
        pending = false;
        controls();
    }
}
bridge.listen((type, value) => {
    if (type === 'identity') {showIdentity(value);return;}
    if (type === 'attachment') {setImage(value);return;}
    if (type === 'open')
        void act('open');
    if (type === 'chat')
        render(value);
    if (type === 'expression' && value.sessionId === state?.sessionId) {
        const asset = catalog?.stickers.find(x => x.id === value.sticker);
        if (asset) {
            stickers.set(value.turn, asset);
            render(state);
        }
    }
});
bridge.call('catalog').then(c => { catalog = c; });
$('input').addEventListener('compositionstart', () => { composition = true; });
$('input').addEventListener('compositionend', () => { composition = false; compositionEnded = performance.now(); controls(); });
$('input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
        if (composition || e.isComposing || e.keyCode === 229)
            return;
        e.preventDefault();
        if (performance.now() - compositionEnded > 40)
            $('composer').requestSubmit();
    }
});
$('composer').addEventListener('submit', e => {
    e.preventDefault();
    const text = $('input').value.trim();
    if ((!text && !image) || encoding || composition || pending || state?.generating)
        return;
    if (draftRequest?.text !== text)
        draftRequest = { text, ...(image?{image:{data:image.base64,mediaType:image.mediaType}}:{}), requestId: crypto.randomUUID() };
    void act('send', draftRequest);
});
$('input').addEventListener('input', controls);
$('stop').onclick = () => act('stop', { turn: state?.turn });
$('fresh').onclick = () => act('new');
$('hide').onclick = () => { releaseVoice(); return bridge.call('hide'); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !composition && !e.isComposing)
    { releaseVoice(); void bridge.call('hide'); } });
controls();

const voiceBase = 'dsh-pet-bridge://dsh-pet/dsh-pet-7340';
async function fetchVoice(url, {body, signal}) {
    signal.throwIfAborted();
    const id = crypto.randomUUID(), path = url.slice(voiceBase.length);
    const cancel = () => { void bridge.call('voice-cancel', {id}).catch(() => {}); };
    signal.addEventListener('abort', cancel, {once:true});
    try {
        const result = await bridge.call('voice-start', {id, path, body});
        signal.throwIfAborted();
        if (path === '/voice/speak') {
            if (!result?.audio) return Response.json(result ?? null, {status:422});
            return new Response(Uint8Array.from(atob(result.audio), byte => byte.charCodeAt(0)), {headers:{'content-type':'audio/mpeg'}});
        }
        return Response.json(result ?? null);
    } finally {
        signal.removeEventListener('abort', cancel);
    }
}
window.PetShared.setVoiceBase(voiceBase);
microphone = window.PetShared.createHearControl({micBtn:$('mic'), input:$('input'), hearUrl:voiceBase + '/voice/hear',
    fetchVoice, active:() => !document.hidden && !!state?.sessionId && !pending,
    hint:{show:errors, flash:errors, hide:() => errors('')}, resizeInput:controls});
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseVoice(); });
window.addEventListener('pagehide', releaseVoice, {once:true});
$('pick-image').onclick=()=>{if(!state?.generating)$('image-file').click();};
$('image-file').onchange=()=>{void imageFile($('image-file').files[0]);$('image-file').value='';};
$('remove-image').onclick=()=>setImage(null);
$('capture').onclick=async()=>{try {const shot=await bridge.call('capture');setImage({base64:shot.data,mediaType:shot.mediaType,previewUrl:'data:'+shot.mediaType+';base64,'+shot.data});}catch(e){errors(e.message);}};
document.addEventListener('paste',event=>{const file=window.PetShared.firstImageFromClipboard(event.clipboardData);if(file){event.preventDefault();void imageFile(file);}});
document.addEventListener('dragover',event=>{if(window.PetShared.dragHasFiles(event))event.preventDefault();});
document.addEventListener('drop',event=>{event.preventDefault();void imageFile(window.PetShared.firstImageFile(event.dataTransfer));});
