import {openAsBlob} from 'node:fs';
import {realpath, stat, readFile} from 'node:fs/promises';
import {extname, join, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import { feelingLabels } from '../living/body/presentation.js';
import { animationAssets, animationStickers, animationRoomAliases } from '../living/body/animation-map.js';

export const roomPrefix = '/chatpet-room';
const root = fileURLToPath(new URL('../../../vendor/feiyu-room-template/public/room/', import.meta.url));
const sharedPlayback = fileURLToPath(new URL('../living/body/playback.js',import.meta.url));
const sharedAnimationMap = fileURLToPath(new URL('../living/body/animation-map.js',import.meta.url));
const localVoice = fileURLToPath(new URL('../../../src/room/voice-client.js', import.meta.url));
const localIdentity = fileURLToPath(new URL('../../../src/room/identity-client.js', import.meta.url));
const sharedVoice = fileURLToPath(new URL('../../../src/desktop/helper/upstream/shared-core.js', import.meta.url));
const desktopMediaRoot = fileURLToPath(new URL('../../../src/desktop/assets/',import.meta.url));
const mappedRoomMedia = new Map<string,string>(Object.entries(animationRoomAliases));
for (const asset of Object.values(animationAssets)) {
  mappedRoomMedia.set('assets/pet/' + asset.roomClip + '.webm', asset.file);
  if (asset.posterFile) mappedRoomMedia.set('assets/pet/' + asset.roomClip + '.png', asset.posterFile);
}
for (const sticker of Object.values(animationStickers)) mappedRoomMedia.set('assets/stickers/' + sticker.file, sticker.file);

const mime: Record<string, string> = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.webm':'video/webm', '.png':'image/png', '.glb':'model/gltf-binary',
  '.jpg':'image/jpeg', '.webp':'image/webp', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.svg':'image/svg+xml'};

/** Preserve the shipped scene; missing expression assets use accurate text. */
export function adaptRoomApp(source:string):string {
  const before="  if (emo && Number.isFinite(emo.mood)) {\n    emoChip.textContent = `心情 · ${emo.label || ''}`;";
  const after=`  const emotionWords = ${JSON.stringify(feelingLabels)};\n  const emotionText = emo?.label || (emo?.feelings || []).map(feeling => emotionWords[feeling] || feeling).join('、');\n  if (emo && (Number.isFinite(emo.mood) || emotionText)) {\n    emoChip.textContent = \`心情 · \${emotionText || ''}\`;`;
  if(source.split(before).length!==2)throw Error('Room mood chip source changed');
  const activity="  $('activityText').textContent = her.activity || '在发呆';";
  if(source.split(activity).length!==2)throw Error('Room activity label source changed');
  return adaptRoomIdentityScript(adaptRoomRefresh(source.replace(before,()=>after).replace(activity,
    "  const expressionText = state.presentation?.action === 'expression' ? state.presentation.expression?.actionLabel : '';\n  const animationNotice = state.playback?.notice || (charMode !== 'webm' && state.playback && !['idle','free','rest','walk','sleep','nap','wake'].includes(state.playback.kind) ? '当前形象的活动动作待补齐' : '');\n  $('activityText').textContent = (her.activity || '在发呆') + (expressionText ? ' · 表情：' + expressionText : '') + (animationNotice ? ' · ' + animationNotice : '');")));
}

/** Adapt shipped template labels, never user text or stable action identifiers. */
export function adaptRoomIdentityScript(source:string):string {
  source = source.replace(/('(?:[^'\\\r\n]|\\.)*'|"(?:[^"\\\r\n]|\\.)*"|`(?:[^`\\\r\n]|\\.)*`)/g, literal => {
    if (!literal.includes('小蓝鱼') && !literal.includes('大肥鱼当前的心情')) return literal;
    // Shipped HTML templates require escaped interpolation; textContent,
    // attributes and canvas keep the original name, including <, > and &.
    const name=/<\/?[a-z][^>]*>/i.test(literal) ? '${companionHtmlLabel()}' : '${companionLabel()}';
    return '`' + literal.slice(1,-1).replaceAll('小蓝鱼',name)
      .replaceAll('大肥鱼当前的心情',name+'当前的心情') + '`';
  });
  return 'const companionLabel = () => window.chatpetCompanionIdentity?.label() || "伙伴";\nconst companionHtmlLabel = () => window.chatpetCompanionIdentity?.htmlLabel() || "伙伴";\n' + source;
}

/** Reuse the scene's poll/apply functions, with native change wakeups. */
export function adaptRoomRefresh(source:string):string {
  const replace=(before:string,after:string)=>{
    if(source.split(before).length!==2)throw Error('Room refresh source changed: '+before.slice(0,40));
    source=source.replace(before,()=>after);
  };
  replace('let requestInFlight = false;',`let requestInFlight = false;
let companionRefreshPending = false;
let companionExplicitRefreshPending = false;
let companionExpectedVersion = null;
let companionAppliedVersion = null;
function refreshCompanionRoom(change) {
  if (!change || typeof change.bootId !== 'string' || !Number.isSafeInteger(change.revision)) return;
  const forced = change.reason === 'world';
  if (!forced && companionAppliedVersion?.bootId === change.bootId && companionAppliedVersion.revision >= change.revision) return;
  if (companionExpectedVersion?.bootId === change.bootId && companionExpectedVersion.revision > change.revision) return;
  companionExpectedVersion = {bootId:change.bootId,revision:change.revision};
  if (requestInFlight && forced) companionExplicitRefreshPending = true;
  else if (requestInFlight) companionRefreshPending = true;
  else requestViewRefresh();
  gardenController?.changed(forced ? undefined : change);
}`);
  replace('function applyState(next) {\n  if (!next) return;',`function applyState(next) {
  if (!next) return;
  window.chatpetCompanionIdentity?.update(next.identity);
  const version = next.behavior;
  if (version && Number.isSafeInteger(version.revision) && typeof version.bootId === 'string') {
    if (companionExpectedVersion && (version.bootId !== companionExpectedVersion.bootId || version.revision < companionExpectedVersion.revision)) return false;
    if (companionAppliedVersion?.bootId === version.bootId && version.revision < companionAppliedVersion.revision) return false;
    companionAppliedVersion = {bootId:version.bootId,revision:version.revision};
  }`);
  replace('  if (requestInFlight) return;',
    '  if (requestInFlight) { companionExplicitRefreshPending = true; return; }');
  replace('    requestInFlight = false;',`    requestInFlight = false;
    const uncovered = companionRefreshPending && (!companionAppliedVersion || !companionExpectedVersion
      || companionAppliedVersion.bootId !== companionExpectedVersion.bootId
      || companionAppliedVersion.revision < companionExpectedVersion.revision);
    const repeat = companionExplicitRefreshPending || uncovered;
    companionRefreshPending = false; companionExplicitRefreshPending = false;
    if (repeat) requestViewRefresh();`);
  replace('  startPresentation();',`  startPresentation();
  const stopCompanionChanges = window.chatpetRoomBridge?.onChanged?.(refreshCompanionRoom);
  window.addEventListener('pagehide', () => {
    stopCompanionChanges?.();
  }, {once:true});`);
  return source;
}

/** Extend the existing owner RPC transport; no public audio/state HTTP route. */
export function adaptRoomTransport(source:string):string {
  const marker='const endpoints = new Map([';
  if(source.split(marker).length!==2)throw Error('Room transport source changed');
  return source.replace(marker,marker+"\n  ['/api/room/voice','roomVoice'],")
    .replaceAll("['roomTelevision','roomChat'].includes(endpoint)","['roomTelevision','roomChat','roomVoice'].includes(endpoint)");
}

/** The saved garden preference never claims a second autonomous planner. */
export function adaptRoomGarden(source:string):string {
  const replace=(before:string,after:string)=>{
    if(source.split(before).length!==2)throw Error('Room garden presentation source changed: '+before.slice(0,60));
    source=source.replace(before,()=>after);
  };
  replace("'自主照料', () => invoke", "'园艺偏好', () => invoke");
  replace("'小蓝鱼自主照料菜园'", "'小蓝鱼的园艺偏好'");
  replace("'暂停小蓝鱼自主照料；手动操作仍然可用' : '让小蓝鱼自行安排种植、采收和补给'",
    "'关闭园艺偏好；已接受的活动不会取消' : '保存园艺偏好；开启不会自动安排任务'");
  replace("'小蓝鱼 · 自主照料中' : '小蓝鱼 · 自主照料已暂停'", "'小蓝鱼 · 园艺偏好已开启' : '小蓝鱼 · 园艺偏好未开启'");
  replace("'她会在有空时照顾小苗'", "'偏好已保存，等待生活计划或明确指令'");
  replace("'开启自主照料后，小蓝鱼会走到菜园安排翻土、播种、浇水、施肥和采收，也会出售收成、补充种子与堆肥。累了、饿了或睡觉时，她会先照顾自己；你仍然可以随时帮忙。'",
    "'园艺偏好开关仅保存选择，不会自动播种、采收、出售或补给。实际活动由生活计划或明确指令安排；关闭偏好不会取消已经接受的活动。'");
  replace('  function render() {', `  function render() {
    const name = companionLabel();
    panel.setAttribute('aria-label', name + '的菜园');
    heading.querySelector('h2').textContent = name + '的菜园';
    autoToggle.setAttribute('aria-label', name + '的园艺偏好');
    callHer.title = '请' + name + '来菜园';
    startCare.title = '请求' + name + '执行当前可用的菜园照料';
    companionship.querySelector('.garden-grab-hint').textContent = '按住' + name + '可以把她抱起来，松手放到菜园里的田边；开启开放或组合视角后可用 W/A/S/D 和方向键看她。';`);
  return adaptRoomIdentityScript(source);
}

/** The public route serves only shipped artwork and code. Personal state uses DSH's owner Connection. */
export async function roomAsset(request: Request): Promise<Response> {
  if (!['GET','HEAD'].includes(request.method)) return new Response(null, {status:405});
  const path = new URL(request.url).pathname;
  if (!path.startsWith(roomPrefix + '/')) return new Response(null, {status:404});
  let name: string;
  try { name = decodeURIComponent(path.slice(roomPrefix.length + 1)) || 'index.html'; }
  catch { return new Response(null, {status:400}); }
  if (name.split(/[\\/]/).some(part => !part || part.startsWith('.')) || name.includes('\0')) return new Response(null, {status:404});
  const type = mime[extname(name).toLowerCase()];
  if (!type) return new Response(null, {status:404});
  try {
    let blob:Blob;
    const registered = mappedRoomMedia.get(name);
    if (registered) {
      const dir=await realpath(desktopMediaRoot),file=await realpath(join(dir,registered));
      if(!file.startsWith(dir+sep)||!(await stat(file)).isFile())return new Response(null,{status:404});
      blob=await openAsBlob(file,{type});
    }
    else if(name==='activity-playback.js')blob=await openAsBlob(sharedPlayback,{type});
    else if(name==='animation-map.js')blob=await openAsBlob(sharedAnimationMap,{type});
    else if(name==='voice-client.js'||name==='shared-core.js'||name==='identity-client.js')blob=await openAsBlob(name==='voice-client.js'?localVoice:name==='identity-client.js'?localIdentity:sharedVoice,{type});
    else {
      const dir = await realpath(root), file = await realpath(join(dir, name));
      if (!file.startsWith(dir + sep) || !(await stat(file)).isFile()) return new Response(null, {status:404});
      if(name==='app.js')blob=new Blob([adaptRoomApp(await readFile(file,'utf8'))],{type});
      else if(name==='garden-ui.js') {
        const source=adaptRoomGarden(await readFile(file,'utf8'));
        blob=new Blob([source],{type});
      }
      else if(name==='garden-world.js') {
        let source=adaptRoomIdentityScript(await readFile(file,'utf8'));
        source=source.replace('  function update(view) {',`  let identityTitle = '';
  function update(view) {
    const nextTitle = companionLabel() + '的小菜园';
    if (identityTitle !== nextTitle) {
      identityTitle = nextTitle;
      const ctx = title.ctx;
      ctx.fillStyle='#e9dfc5';ctx.fillRect(0,0,512,128);ctx.strokeStyle='#385344';ctx.lineWidth=3;ctx.strokeRect(9,9,494,110);
      ctx.fillStyle='#385344';ctx.font='bold 50px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(nextTitle,256,66,470);title.tex.needsUpdate=true;
    }`);
        blob=new Blob([source],{type});
      }
      else if(name==='native-room.js')blob=new Blob([adaptRoomTransport(await readFile(file,'utf8'))],{type});
      else if(name==='index.html') {
        const html=await readFile(file,'utf8'),marker='<script type="module" src="./app.js"></script>';
        if(html.split(marker).length!==2)throw Error('Room page source changed');
        blob=new Blob([html.replaceAll('小蓝鱼','__CHATPET_NAME__').replace(marker,'<script src="./identity-client.js"></script>\n<script src="./shared-core.js"></script>\n<script type="module" src="./voice-client.js"></script>\n'+marker)],{type});
      } else blob=await openAsBlob(file,{type});
    }
    const headers = new Headers({'Content-Type':type, 'X-Content-Type-Options':'nosniff', 'Accept-Ranges':'bytes',
      'Cache-Control':'private, no-cache', 'Referrer-Policy':'no-referrer', 'Content-Security-Policy':"frame-ancestors 'self'; object-src 'none'; base-uri 'none'"});
    const range = request.headers.get('range');
    let body = blob;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = match?.[1] ? Number(match[1]) : Math.max(0, blob.size - Number(match?.[2]));
      const end = match?.[1] && match[2] ? Math.min(blob.size - 1, Number(match[2])) : blob.size - 1;
      if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || (!match[1] && !match[2])) {
        headers.set('Content-Range', 'bytes */' + blob.size);
        return new Response(null, {status:416, headers});
      }
      body = blob.slice(start,end + 1,type);
      headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + blob.size);
    }
    headers.set('Content-Length', String(body.size));
    return new Response(request.method === 'HEAD' ? null : body, {headers, status:range ? 206 : 200});
  } catch { return new Response(null, {status:404}); }
}
