// Bind the original released browser and host modules to this companion's DSH lifecycle.
// Preserve the upstream inputs and verify every generated substitution against those inputs.
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {adaptPetHearLifecycle} from '../lib/pet-hear-lifecycle.mjs';
import ts from 'typescript';
import {ROOM_CONSOLE_TIMEOUTS, ROOM_ENDPOINTS} from '../../src/presentation/room-transport.ts';
const root = resolve(import.meta.dirname, '../..');
const vendor = join(root, 'vendor/dsh-pet/platform');
const read = file => readFileSync(file, 'utf8');
const playbackObserver = read(join(root,'src/desktop/platform/playback-observer.js'));
function exportedFunction(file,name) {
  const source=read(join(root,file)),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
  if(!declaration)throw Error('Presentation source changed: '+name);
  return ts.transpileModule(declaration.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}})
    .outputText.replace(/^export\s+/,'');
}
const activitySampler=exportedFunction('src/presentation/playback.ts','sampleActivityPlayback');
const activityController=exportedFunction('src/desktop/platform/activity-playback.js','createActivityPlaybackController');
const activityPlayback=activityController+'\n'+exportedFunction('src/desktop/platform/activity-playback.js','installNativeActivityPlayback');
const distinctiveNames = JSON.parse(read(join(root,'src/desktop/assets/catalog.json'))).actions
  .filter(asset=>asset.group==='expression').map(asset=>asset.label);
const manifest = JSON.parse(read(join(vendor, 'origin.json')));
for (const [file, source] of Object.entries(manifest.files)) {
  const expected = manifest.adaptations?.[file]?.sha256 ?? source.sha256;
  if (createHash('sha256').update(readFileSync(join(vendor, file))).digest('hex') !== expected) throw Error('Pet platform origin changed: '+file);
}
function replaceOnce(source, match, value) {
  if (source.split(match).length !== 2) throw Error('Pet platform entry changed: '+match);
  return source.replace(match, () => value);
}
// Owner feedback retains its actual episode deadline through the original say
// transport. Ordinary upstream say leaves keep their existing duration rules.
function adaptSayExpiry(source) {
  const from=source.indexOf('function readSay(leaf$1) {');
  const to=source.indexOf('\nfunction readWorkStatus(',from);
  if(from<0 || to<from)throw Error('Pinned Pet say reader changed');
  let reader=source.slice(from,to);
  reader=replaceOnce(reader,'\tif (typeof d.text !== "string" || !d.text) return null;',
    `\tif (typeof d.text !== "string" || !d.text) return null;
\tconst remaining = typeof d.expiresAt === "number" && Number.isFinite(d.expiresAt) ? d.expiresAt - Date.now() : void 0;
\tif (remaining !== void 0 && remaining <= 0) return null;
\tconst duration = typeof d.duration === "number" && Number.isFinite(d.duration) && d.duration >= 0 ? d.duration : void 0;`);
  reader=replaceOnce(reader,
    '\t\tduration: typeof d.duration === "number" && Number.isFinite(d.duration) && d.duration >= 0 ? d.duration : void 0,',
    '\t\tduration: remaining === void 0 ? duration : Math.min(duration ?? remaining, remaining),');
  return source.slice(0,from)+reader+source.slice(to);
}
// The approved name map reuses movies and leaves unsupported compositions
// explicit. Retire the independent patrol/drop/score game, including its pump.
function removeBaifanMinigame(source) {
  const start='//#region src/client/baifan/constants.ts';
  const end='//#region src/client/command-faces.ts';
  if(source.split(start).length!==2 || source.split(end).length!==2)throw Error('Pinned Baifan module boundary changed');
  const from=source.indexOf(start),to=source.indexOf(end,from);
  if(to<from)throw Error('Pinned Baifan module order changed');
  source=source.slice(0,from)+source.slice(to);
  return replaceOnce(source,`\t\t\tconst BaifanLayer = makeBaifanLayer({
\t\t\t\th,
\t\t\t\tuseRef,
\t\t\t\tuseEffect
\t\t\t}, (host) => mountBaifan(ctx, host));
\t\t\tctx.slots.inject("shell.overlay", function* () {
\t\t\t\tyield ctx.slots.register({
\t\t\t\t\tname: "shell.overlay",
\t\t\t\t\tid: "baifan",
\t\t\t\t\torder: 1100
\t\t\t\t}, BaifanLayer);
\t\t\t});
`,'');
}
// Retain native input guards and sound; accepted Body state owns the response.
const nativeInputSource=read(join(root,'src/desktop/helper/upstream/sprite/input.js'));
if(createHash('sha256').update(nativeInputSource).digest('hex')!==manifest.files['runtime/electron-helper/sprite/input.js'].sha256)
  throw Error('Pinned original Pet input changed');
const nativeInput=replaceOnce(nativeInputSource,
  '    playClickSound();\n    if (!this.animations.clicks.length) return;',
  `    playClickSound();
    if (this.pet.companionPlayback) {
      this.pendingSquash = false;
      if (!this.frozen) {
        const body = JSON.stringify({requestId:crypto.randomUUID()});
        void S.postAction(BASE + '/native-feature?pet=' + encodeURIComponent(this.pet.id), {path:'/pet',method:'POST',body});
      }
      return;
    }
    if (!this.animations.clicks.length) return;`);
writeFileSync(join(vendor,'runtime/electron-helper/sprite/input.js'),nativeInput);
let helper = replaceOnce(read(join(vendor,'upstream/helper-main.js')),
  "app.setName('dsh-pet-electron-helper');",
  "app.setName('dafeiyu-presentation');\napp.setPath('userData', process.env.CHATPET_PRESENTATION_PROFILE || path.join(app.getPath('appData'), 'dafeiyu-presentation'));");
// Released helpers do not expose the upstream screenshot-and-exit test mode.
// Keep the pinned input in the repository; omit its test module from packages.
helper=replaceOnce(helper,"const { runSmokeCheck } = require('./main/smoke.js');\n",'');
helper=replaceOnce(helper,`  // 冒烟自检（默认关闭）：DSH_PET_SMOKE=1 时延时截图到 DSH_PET_SMOKE_OUT 后退出，
  // 用于验证窗口/渲染/动画链路。
  if (process.env.DSH_PET_SMOKE === '1') {
    runSmokeCheck({
      app,
      windows: petWindows.state.windows,
      windowIgnore: petWindows.state.windowIgnore,
      setPointerFallbackPaused: petWindows.setPointerFallbackPaused,
    });
  }
`,'');
helper=replaceOnce(helper,"  powerMonitor.on('resume', reassertTaskbar);",`  powerMonitor.on('resume', reassertTaskbar);
  let locked=powerMonitor.getSystemIdleState?.(1)==='locked',suspended=false;
  const displayLifetime=()=>petWindows.setPresentationPaused(locked||suspended);
  displayLifetime();
  powerMonitor.on('lock-screen',()=>{locked=true;displayLifetime();});
  powerMonitor.on('unlock-screen',()=>{locked=false;displayLifetime();});
  powerMonitor.on('suspend',()=>{suspended=true;displayLifetime();});
  powerMonitor.on('resume',()=>{suspended=false;displayLifetime();});
  ipcMain.handle('pet:presentation-state',event=>petWindows.presentationState(event.sender));`);
writeFileSync(join(vendor,'runtime/electron-helper/main.js'),helper);
writeFileSync(join(vendor,'runtime/electron-helper/shared-core.js'),
  adaptSayExpiry(adaptPetHearLifecycle(read(join(vendor,'upstream/helper-shared-core.js')))));
const refreshBody = `
async function refreshCompanionPresentation() {
  const presentationTicket = companionPresentation.ticket();
  const next = await loadConfig();
  if (!companionPresentation.accepts(presentationTicket)) return false;
  for (const sprite of sprites) {
    const pet = next.pets.find(pet => pet.id === sprite.pet.id);
    if (!pet) continue;
    sprite.pet = {...sprite.pet, ...pet};
    if (!Object.hasOwn(pet,'companionPlayback')) delete sprite.pet.companionPlayback;
    sprite.animations = pet.animations;
    sprite.weights = pet.animationWeights;
    sprite.applyCompanionPlayback?.();
    if (!pet.workStatusEnabled) {
      sprite.workState = null;
      sprite.prevWorkState = null;
    }
  }
  config = next;
  return true;
}
`;
let helperEvents=read(join(vendor,'upstream/helper-events.js'));
helperEvents=replaceOnce(helperEvents,'async function pollStateOnce() {',refreshBody+'\nasync function pollStateOnce() {');
helperEvents=replaceOnce(helperEvents,'stateBaseline = S.flattenCounters(s);','await refreshCompanionPresentation();\n      stateBaseline = S.flattenCounters(s);');
helperEvents=replaceOnce(helperEvents,"if (change.path === 'sections.balance') applyBalanceLeaf(change.leaf);",
  "if (change.path === 'sections.config') { if (!await refreshCompanionPresentation()) return false; }\n      else if (change.path === 'sections.balance') applyBalanceLeaf(change.leaf);");
helperEvents=replaceOnce(helperEvents,'async function pollStateOnce() {\n  try {',`async function pollStateOnce() {
  if(!companionPresentation.wantsVisible())return false;
  const presentationTicket=companionPresentation.ticket();
  try {`);
helperEvents=replaceOnce(helperEvents,'timeoutMs: STATE_WAIT_MS','timeoutMs: 10000');
helperEvents=replaceOnce(helperEvents,'    if (!s) return false;',
  '    if (!s || !companionPresentation.accepts(presentationTicket)) return false;');
helperEvents=replaceOnce(helperEvents,'await refreshCompanionPresentation();\n      stateBaseline',
  'await refreshCompanionPresentation();\n      if(!companionPresentation.accepts(presentationTicket))return false;\n      stateBaseline');
helperEvents=replaceOnce(helperEvents,'    for (const change of S.takeChanged(s, stateBaseline)) {',
  '    for (const change of S.takeChanged(s, stateBaseline)) {\n      if(!companionPresentation.accepts(presentationTicket))return false;');
helperEvents=replaceOnce(helperEvents,'      return true;\n    }\n    for (const change',`      companionPresentation.ready();
      for(const sprite of sprites)if(!sprite.sleeping)sprite.playIdle();
      return true;
    }
    for (const change`);
helperEvents=replaceOnce(helperEvents,'      companionPresentation.ready();',`      for(const sprite of sprites) {
        const leaf=s.pets?.[sprite.pet.id]?.lock;
        const lock=leaf?S.readLock(leaf):null;
        sprite.setLock(lock ?? {locked:false});
      }
      companionPresentation.ready();`);
helperEvents=replaceOnce(helperEvents,`  const stateLoop = async () => {
    const hit = await pollStateOnce();
    setTimeout(() => void stateLoop(), hit && stateLongPoll ? 0 : 1000);
  };
  void stateLoop();`, `  let stateTimer,inFlight=false;
  const stateLoop = async () => {
    stateTimer=undefined;
    if(!companionPresentation.wantsVisible()||inFlight)return;
    inFlight=true;
    try {
      const hit=await pollStateOnce();
      if(companionPresentation.wantsVisible())stateTimer=setTimeout(()=>void stateLoop(),hit&&stateLongPoll?0:1000);
    } finally {inFlight=false;}
  };
  companionWake=()=>{
    if(stateTimer!==undefined){clearTimeout(stateTimer);stateTimer=undefined;}
    if(companionPresentation.wantsVisible())void stateLoop();
  };
  companionWake();`);
helperEvents += '\n'+read(join(root,'src/desktop/platform/presentation-lifecycle.js')).replaceAll('export function ','function ')+`
let companionWake=()=>{};
const companionFrames=createPresentationFrames({request:window.requestAnimationFrame.bind(window),cancel:window.cancelAnimationFrame.bind(window)});
window.requestAnimationFrame=companionFrames.request;
window.cancelAnimationFrame=companionFrames.cancel;
const companionPresentation=createDesktopPresentationLifecycle({document,sprites:()=>sprites,wake:()=>companionWake(),
  frames:companionFrames,reset:()=>{stateBaseline=null;stateSince=undefined;},subscribe:window.petBridge?.onPresentationVisibility?.bind(window.petBridge)});
const companionIdle=PetSprite.prototype.playIdle;
PetSprite.prototype.playIdle=function(...args){if(companionPresentation.canPresent())return companionIdle.apply(this,args);};
window.addEventListener('pagehide',()=>companionPresentation.dispose(),{once:true});
`;
helperEvents += '\n'+activitySampler+'\n'+activityPlayback+`\ninstallNativeActivityPlayback(PetSprite,{sample:sampleActivityPlayback,lifecycle:companionPresentation});\n`;
// Native playing is emitted only after the video actually starts. Explicit
// requests already carry upstream playback IDs and keep their original reports.
helperEvents += '\n'+playbackObserver+`\nconst observeCompanionRandomPlayback = createCompanionPlaybackObserver(
  receipt => S.postAction(BASE + '/native-playback', receipt), new Set(${JSON.stringify(distinctiveNames)}));
document.addEventListener('playing', event => {
  const video = event.target;
  const sprite = sprites.find(sprite => sprite.videoA === video || sprite.videoB === video);
  if (!sprite || sprite.pet.companionPlayback || sprite.playback || video !== (sprite.front === 0 ? sprite.videoA : sprite.videoB)) return;
  observeCompanionRandomPlayback(video, sprite.anim, sprite.pet.id);
}, true);\n`;
writeFileSync(join(vendor,'runtime/electron-helper/events.js'),helperEvents);
const prefix = '/chatpet-presentation';
let host = read(join(vendor,'upstream/host.mjs')).replaceAll('/dsh-pet-7340', prefix);
host = replaceOnce(host, 'import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";', '');
host = replaceOnce(host, 'import { credentialRef } from "@deepseek-ai/dsh-credentials";', '');
host = replaceOnce(host, 'function createHostSetup(ctx) {\n\tconst dshHome = resolveDshHome();\n\tconst userRoot = join(dshHome, "dsh-pet");', 'function createHostSetup(ctx, userRoot) {');
host = replaceOnce(host, 'const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));', 'const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));');
host = replaceOnce(host,'\t\tstartHelper,\n\t\tstopHelper,\n\t\tstopHelperAndWait,',
  '\t\tstatus: () => ({running:Boolean(helper?.child && helper.child.exitCode === null),starting:Boolean(electronEnsure || startRetryTimer)}),\n\t\tstartHelper,\n\t\tstopHelper,\n\t\tstopHelperAndWait,');
host = replaceOnce(host,'startHelper: spawn$1.startHelper,','status: spawn$1.status,\n\t\tstartHelper: spawn$1.startHelper,');
host = replaceOnce(host, 'export { apply, inject, name };', 'export { createHostSetup, createPetLookup, createHttpRoute, createDesktopHelper, flattenPetList, createSessionNotify, registerSessionWatch, createWorkStatusBridge, pickSleepNames, readAllConfig, readJsonc, topFieldValid, decideAnim, readBody, sendFile, sendJson, sendText };');
host = replaceOnce(host, 'function mergePets(basePets, raw, label, seenIds) {', 'function mergePets(basePets, raw, label, seenIds) {\n\tif (Array.isArray(raw) && raw.length === 0) return [];');
host = replaceOnce(host, '\tif (!arr || !arr.length) return null;', '\tif (!arr) return null;');
// Identity shown by the editor is a Core projection. A cosmetic save must not
// persist that projection (or its anonymous UI label) as another role source.
host = replaceOnce(host, '\t\tconst pet = {\n\t\t\tid,\n\t\t\tname: name$1,\n\t\t\tsize,',
  '\t\tconst pet = {\n\t\t\tid,\n\t\t\tsize,');
host = replaceOnce(host, '\t\tif (persona) pet.whisperPrompt = persona;',
  '\t\tconst legacyIdentity = Array.isArray(existing?.pets) ? existing.pets.find(previous => previous?.id === id) : undefined;\n\t\tfor (const field of ["name", "whisperPrompt"]) if (legacyIdentity && Object.hasOwn(legacyIdentity, field)) pet[field] = legacyIdentity[field];');
writeFileSync(join(vendor,'runtime.mjs'), host);

let client = removeBaifanMinigame(adaptSayExpiry(adaptPetHearLifecycle(read(join(vendor,'upstream/client.js'))))).trim();
// Shared Body owns sleep and ended-cue state; the original machine remains for
// unmanaged packs only. Menus/keyboard and taps read the same actual descriptor.
client=replaceOnce(client,'\t\tconst sleeping = () => sleep$1().sleeping();',
  '\t\tconst sleeping = () => hub.cfg().companionPlayback ? hub.cfg().companionPlayback.kind === "sleep" : sleep$1().sleeping();');
client=replaceOnce(client,'\t\tconst sleepPhase = () => sleep$1().phase();',
  '\t\tconst sleepPhase = () => hub.cfg().companionPlayback ? (hub.cfg().companionPlayback.kind === "sleep" ? "loop" : null) : sleep$1().phase();');
client=replaceOnce(client,'\t\tconst applySleep = (state) => sleep$1().apply(state);',
  '\t\tconst applySleep = (state) => {if (!hub.cfg().companionPlayback) sleep$1().apply(state);};');
for(const start of ['const resumeWorkStatusAnim = () => {','const pickNext = () => {','const applyEndedCue = (cue) => {'])
  client=replaceOnce(client,'\t\t'+start,'\t\t'+start+'\n\t\t\tif (hub.cfg().companionPlayback) return false;');

client = replaceOnce(client, ';(()=>{', 'function makePetPresentation(require, platformFetch, presentationPath) {\nconst fetch = platformFetch;');
client = replaceOnce(client, 'window.__ModuleLoader__.load({\n\tid: "dsh-pet",\n\tfactory: makeFactory()\n});','return makeFactory()(require);');
client = replaceOnce(client, '\n})();', '\n}');
client = client.replaceAll('"/dsh-pet-7340"', 'presentationPath');
client = replaceOnce(client,'function createOwnAnimation(deps) {',activitySampler+'\n'+activityController+'\n'+playbackObserver+`\nconst observeCompanionRandomPlayback = createCompanionPlaybackObserver(
  receipt => postAction(ROUTE_PATH + '/native-playback', receipt), new Set(${JSON.stringify(distinctiveNames)}));\nfunction createOwnAnimation(deps) {`);
client = replaceOnce(client,
  '\t\t\tel$1.play().then(() => {\n\t\t\t\tif (cuePlaybackId !== null) deps.report(cuePlaybackId, "playing");',
  '\t\t\tel$1.play().then(() => {\n\t\t\t\tif (!cfg.companionPlayback && cuePlaybackId === null && mounted && gen === swapGen && frontVideo() === el$1) observeCompanionRandomPlayback(el$1, next, cfg.id);\n\t\t\t\tif (cuePlaybackId !== null) deps.report(cuePlaybackId, "playing");');
// The original asset loader and double buffer remain the playback carrier.
// Accepted Body presentation supplies source, phase and common visual offset.
client = replaceOnce(client,'\tconst switchTo = (next, nextOnce, cuePlaybackId) => {',`\tlet companionSample = null, companionTicket, waitingFresh = false, companionReady, companionReleasePending = false;
  const clearCompanionReady=()=>{
    if(companionReady){companionReady.video.removeEventListener("loadeddata",companionReady.listener);companionReady=undefined;}
  };
  const companion = createActivityPlaybackController({sample:sampleActivityPlayback,
    visible:()=>mounted && !document.hidden && !waitingFresh && !frozen,
    present:(element,part)=>{element.style.visibility="";element.style.transform=part.mirror === true ? "scaleX(-1)" : "";},
    invalidate:()=>{clearCompanionReady();loader.abortAll();gen++;pending=null;},
    play:(part,ticket)=>{companionSample=part;companionTicket=ticket;switchUnmanaged(part.desktopClip,part.mode!=='loop',null);},
    failure:()=>{for(const element of [deps.videoA(),deps.videoB()])if(element){element.pause();element.style.visibility='hidden';}}
  });
  const switchUnmanaged = (next, nextOnce, cuePlaybackId) => {
    const managedSample=companionSample, managedTicket=companionTicket;
    companionSample=null;
    clearCompanionReady();
    if(managedSample && pending!==null)loader.abortAll();`);
client = replaceOnce(client,'pending.anim === next && pending.once === nextOnce)',
  'pending.anim === next && pending.once === nextOnce && pending.companionKey === managedSample?.key && pending.companionTicket === managedTicket)');
client = replaceOnce(client,'\t\t\tgen: swapGen\n\t\t};',
  '\t\t\tgen: swapGen, companionKey:managedSample?.key, companionTicket:managedTicket\n\t\t};');
client = replaceOnce(client,'\t\tel$1.onerror = cuePlaybackId === null ? null : () => reportOnce(cuePlaybackId, "failed", REASON_DECODE);',
  '\t\tel$1.onerror = managedSample ? () => companion.fail(managedSample.key,managedTicket) : cuePlaybackId === null ? null : () => reportOnce(cuePlaybackId, "failed", REASON_DECODE);');
client = replaceOnce(client,'\t\tel$1.autoplay = true;', '\t\tel$1.autoplay = !managedSample;');
client = replaceOnce(client,'\t\t\text: thumbExt()', '\t\t\text: managedSample ? ANIMATION_EXT : thumbExt()');
client = replaceOnce(client,'\t\t\t\tpending = null;\n\t\t\t\tif (cuePlaybackId !== null) reportOnce(cuePlaybackId, "failed", REASON_ASSET_LOAD);',
  '\t\t\t\tpending = null;\n\t\t\t\tif(managedSample)companion.fail(managedSample.key,managedTicket);\n\t\t\t\tif (cuePlaybackId !== null) reportOnce(cuePlaybackId, "failed", REASON_ASSET_LOAD);');
client = replaceOnce(client,'\t\t\tif (pending?.gen !== swapGen) return;\n\t\t\tconst outgoing = elementOf(front);',
  '\t\t\tif (pending?.gen !== swapGen) return;\n\t\t\tif(managedSample && !companion.isCurrent(managedSample.key,managedTicket)){el$1.pause();return;}\n\t\t\tconst outgoing = elementOf(front);');
client = replaceOnce(client,'\t\t\tel$1.removeEventListener("loadeddata", onReady);',
  '\t\t\tel$1.removeEventListener("loadeddata", onReady);\n\t\t\tif(companionReady?.listener===onReady)companionReady=undefined;');
client = replaceOnce(client,'\t\tel$1.addEventListener("loadeddata", onReady);',
  '\t\tif(managedSample)companionReady={video:el$1,listener:onReady};\n\t\tel$1.addEventListener("loadeddata", onReady);');
client = replaceOnce(client,'\t\t\tel$1.play().then(() => {',
  '\t\t\tif(managedSample){el$1.onerror=null;companion.ready(el$1,managedSample.key,managedTicket);deps.onFrontReady(el$1);return;}\n\t\t\tel$1.style.visibility="";\n\t\t\tel$1.play().then(() => {');
client = replaceOnce(client,'\tconst handleEnded = (event) => {',`  const switchTo = (next,nextOnce,cuePlaybackId) => {
    const descriptor=deps.cfg().companionPlayback;
    if(descriptor){
      deps.clearPendingSquash?.();
      if(cuePlaybackId!==null)deps.report(cuePlaybackId,"cancelled","body-activity");
      companion.update(descriptor);return;
    }
    if(companion.active() || companionReleasePending)deps.clearPendingSquash?.();
    companion.update(undefined);
    if(companionReleasePending && (document.hidden || waitingFresh || frozen))return;
    companionReleasePending=false;switchUnmanaged(next,nextOnce,cuePlaybackId);
  };
  const handleEnded = (event) => {
    if(deps.cfg().companionPlayback){companion.update(deps.cfg().companionPlayback,true);return {kind:"ignore"};}`);
client = replaceOnce(client,'\t\tstopLoopingFront: () => {',`    refreshCompanion: () => {
      const force=waitingFresh;waitingFresh=false;
      const cfg=deps.cfg();
      if(cfg.companionPlayback || companion.active() || companionReleasePending)deps.clearPendingSquash?.();
      if(cfg.companionPlayback)companionReleasePending=false;
      else if(companion.active())companionReleasePending=true;
      companion.update(cfg.companionPlayback,force);
      if(companionReleasePending && !frozen && !document.hidden){
        companionReleasePending=false;
        if(cfg.animations.idle?.length)switchUnmanaged(cfg.animations.idle[0],false,null);
      }
    },
    suspendCompanion: () => {waitingFresh=true;companion.suspend();},
    stopLoopingFront: () => {
      if(deps.cfg().companionPlayback)return;`);
client = replaceOnce(client,'\t\t\tmounted = false;\n\t\t\tloader.abortAll();',
  '\t\t\tmounted = false;\n\t\t\tcompanion.dispose();\n\t\t\tclearCompanionReady();\n\t\t\tloader.abortAll();');
client = replaceOnce(client,'\t\t\tfrozen = next;\n\t\t\tif (next) {',
  '\t\t\tfrozen = next;\n\t\t\tif(deps.cfg().companionPlayback){if(next)companion.suspend();else companion.update(deps.cfg().companionPlayback,true);}\n\t\t\tif (next) {');
client = replaceOnce(client,'\t\tconst { anim, cuePlayback, once, seq } = card.state;',`    useEffect(()=>{ownAnim.refreshCompanion();},[cfgRef.current]);
    useEffect(()=>{
      const changed=()=>{ownAnim.suspendCompanion();};
      document.addEventListener("visibilitychange",changed);
      return ()=>document.removeEventListener("visibilitychange",changed);
    },[]);
    const { anim, cuePlayback, once, seq } = card.state;`);
client = replaceOnce(client,'\t\t\t\tconst anim$1 = card.animRef.current;',
  '\t\t\t\tconst anim$1 = cfgRef.current.companionPlayback ? sampleActivityPlayback(cfgRef.current.companionPlayback)?.desktopClip ?? card.animRef.current : card.animRef.current;');
client = replaceOnce(client,'\t\t\tclearCuePlayback: () => input.setCuePlayback(null),',
  '\t\t\tclearCuePlayback: () => input.setCuePlayback(null),\n\t\t\tclearPendingSquash: () => {pendingSquash.current = false;},');
// The existing web drag and score guards admit the same care request. Retain
// the original event only to exclude modified shortcut clicks from care.
client=replaceOnce(client,'\tconst onClick = () => {\n\t\tconst c = card();',
  '\tconst onClick = (event) => {\n\t\tconst c = card();');
client=replaceOnce(client,'\t\tc.playClickSound();\n\t\tc.setOnce(true);',
  '\t\tc.playClickSound();\n\t\tif(c.companionTap?.(event))return;\n\t\tc.setOnce(true);');
client=replaceOnce(client,'\t\t\t\tclickAnims: cfgRef.current.animations.clicks,',`\t\t\t\tclickAnims: cfgRef.current.animations.clicks,
        companionTap: event => {
          const cfg=cfgRef.current;
          if(!cfg.companionPlayback)return false;
          pendingSquash.current=false;
          if(live.current.ownAnim.isFrozen() || event?.ctrlKey || event?.metaKey || event?.altKey)return true;
          const body=JSON.stringify({requestId:crypto.randomUUID()});
          const path=cfg.companionPlayback.kind==='sleep'?'/wake':'/pet';
          void postAction(ROUTE_PATH + '/native-feature?pet=' + encodeURIComponent(cfg.id),{path,method:'POST',body});
          return true;
        },`);
client=replaceOnce(client,'\t\t\tonClick: () => {\n\t\t\t\tif (drag.justDragged() || drag.isActive()) return;',
  '\t\t\tonClick: event => {\n\t\t\t\tif (drag.justDragged() || drag.isActive()) return;');
client=replaceOnce(client,'\t\t\t\tdrag.onClick();','\t\t\t\tdrag.onClick(event);');
client=replaceOnce(client,'\t\t\t\tconst phase = liveRef.current.flow?.sleepPhase() ?? null;',
  '\t\t\t\tif (cfgRef.current.companionPlayback) { drag.onClick(event); return; }\n\t\t\t\tconst phase = liveRef.current.flow?.sleepPhase() ?? null;');
// Only the body renderer consumes activity overrides. The editor reads the saved configuration.
client = replaceOnce(client,
  'const loadMerged = async () => {\n\t\t\t\tconst r = await fetch(ROUTE_PATH + "/config", { cache: "no-store" });',
  'const loadMerged = async (signal) => {\n\t\t\t\tconst r = await fetch(ROUTE_PATH + "/config-live", { cache: "no-store", signal });');
const configTailStart='\t\t\t(async () => {\n\t\t\t\ttry {\n\t\t\t\t\tconst merged = await loadMerged();';
const configTailEnd='\t\t\treturn () => {\n\t\t\t\talive = false;\n\t\t\t\tpetBridge.reload = () => {};\n\t\t\t};';
if(client.split(configTailStart).length!==2 || client.split(configTailEnd).length!==2)throw Error('Pet config lifetime source changed');
const configFrom=client.indexOf(configTailStart),configTo=client.indexOf(configTailEnd,configFrom)+configTailEnd.length;
client=client.slice(0,configFrom)+`      let configGeneration=0,configPending=false,configInFlight=false,configAbort,retryTimer,retryDelay=1000;
      const clearRetry=()=>{if(retryTimer!==undefined){window.clearTimeout(retryTimer);retryTimer=undefined;}};
      const canReload=()=>alive && !document.hidden;
      const drainCompanionConfig=async()=>{
        if(!canReload() || configInFlight || !configPending)return;
        configPending=false;configInFlight=true;
        const generation=configGeneration,request=new AbortController();configAbort=request;let failed=false;
        try {
          const next=await loadMerged(request.signal);
          if(!canReload() || generation!==configGeneration)return;
          applyMerged(next);setReady(true);retryDelay=1000;
        } catch(error) {
          if(canReload() && generation===configGeneration){failed=true;console.error("[dsh-pet] 配置加载失败，稍后重新读取",error);}
        } finally {
          if(configAbort===request)configAbort=undefined;
          configInFlight=false;
          if(canReload() && configPending)void drainCompanionConfig();
          else if(canReload() && failed){
            const wait=retryDelay;retryDelay=Math.min(30000,retryDelay*2);
            retryTimer=window.setTimeout(()=>{retryTimer=undefined;configPending=true;void drainCompanionConfig();},wait);
          }
        }
      };
      const requestCompanionConfig=()=>{configGeneration++;configPending=true;clearRetry();void drainCompanionConfig();};
      const configVisibility=()=>{
        configGeneration++;configPending=true;clearRetry();
        if(document.hidden)configAbort?.abort();else void drainCompanionConfig();
      };
      petBridge.reload=requestCompanionConfig;
      document.addEventListener("visibilitychange",configVisibility);
      requestCompanionConfig();
      return ()=>{
        alive=false;configGeneration++;configPending=false;clearRetry();configAbort?.abort();
        document.removeEventListener("visibilitychange",configVisibility);petBridge.reload=()=>{};
      };`+client.slice(configTo);
client = replaceOnce(client,'\t\t\t\t\tfor (const [petId, entry] of Object.entries(s.pets)) {\n\t\t\t\t\t\tconst hit = entry?.sleep?.data == null ? null : readSleep(entry.sleep);',
  '\t\t\t\t\tfor (const [petId, entry] of Object.entries(s.pets)) {\n\t\t\t\t\t\tconst locked=entry?.lock?.data == null ? null : readLock(entry.lock);\n\t\t\t\t\t\tif(locked)lockRef.current[petId]=locked;\n\t\t\t\t\t\tconst hit = entry?.sleep?.data == null ? null : readSleep(entry.sleep);');
client = replaceOnce(client,'\t\t\t\t\tsetSleepTick((t) => t + 1);\n\t\t\t\t\treturn;',
  '\t\t\t\t\tsetLockTick((t) => t + 1);\n\t\t\t\t\tsetSleepTick((t) => t + 1);\n\t\t\t\t\t// Close the config-snapshot / first-state race once, through the existing guarded reload.\n\t\t\t\t\tpetBridge.reload();\n\t\t\t\t\treturn;');
// All bodies share Core identity and the existing DSH native model/session.
// Retain legacy values on disk while removing editors with no connected consumer.
const personaStart='field(t("personaLabel"), h("div", {';
const personaEnd='}), t("personaHint"))';
if(client.split(personaStart).length!==2 || client.split(personaEnd).length!==2)throw Error('Pet persona editor changed');
const personaAt=client.indexOf(personaStart),personaTo=client.indexOf(personaEnd,personaAt)+personaEnd.length;
client=client.slice(0,personaAt)+'null'+client.slice(personaTo);
const nameStart='field(t("nameLabel"), h("input", {';
const nameEnd='}), t("nameHint"))';
if(client.split(nameStart).length!==2 || client.split(nameEnd).length!==2)throw Error('Pet name editor changed');
const nameAt=client.indexOf(nameStart),nameTo=client.indexOf(nameEnd,nameAt)+nameEnd.length;
client=client.slice(0,nameAt)+'null'+client.slice(nameTo);
// The upstream add path needs a first body as a template. Empty companions keep
// the technical template as metadata; only an explicit Add action instantiates it.
client=replaceOnce(client,'\t\t\tkind: key === "main" ? "main" : "pack",',
  '\t\t\tkind: key === "main" ? "main" : "pack",\n\t\t\tbodyTemplate: conf?.bodyTemplate,');
client=replaceOnce(client,'\t\tconst template = group[0];',
  '\t\tconst template = group[0] ?? loadedRef.current.find(entry => entry.key === kind)?.bodyTemplate;');
client=replaceOnce(client,'\t\tname: id,\n\t\tsize: template.size,',
  '\t\tname: template.name || "伙伴",\n\t\tsize: template.size,');
const modelStart='\t\t\t\th(ModelCard, {';
const modelEnd='\t\t\t\th(PhysicsCard, {';
if(client.split(modelStart).length!==2 || client.split(modelEnd).length!==2)throw Error('Pet model editor changed');
const modelAt=client.indexOf(modelStart),modelTo=client.indexOf(modelEnd,modelAt);
client=client.slice(0,modelAt)+client.slice(modelTo);
client = replaceOnce(client,
  '\t\t\tctx.slots.inject("settings.section", function* () {\n\t\t\t\tyield ctx.slots.register({\n\t\t\t\t\tname: "settings.section",\n\t\t\t\t\tid: "pet-config",\n\t\t\t\t\torder: 30,\n\t\t\t\t\tlabel: () => t("nav"),\n\t\t\t\t\tinject: () => ({ t })\n\t\t\t\t}, PetConfigSection);\n\t\t\t});',
  '\t\t\tctx.provide("chatpetAppearanceEditor", () => h(PetConfigSection, {t}));');
client = replaceOnce(client,
  '\t\tif (leaf$1.action === "chat") {\n\t\t\tdeps.openChat();\n\t\t\treturn;\n\t\t}',
  '\t\tif (leaf$1.action === "chat") {\n\t\t\tfireAction(ROUTE_PATH + "/native-chat-window", "原生聊天");\n\t\t\treturn;\n\t\t}');
client = client.replaceAll('petApi7340','chatpetPresentation').replaceAll('"pet.config"','"chatpet.presentation.config"').replaceAll('"pet.chat"','"chatpet.presentation.chat"');
for (const id of ['pet','pet-config']) client = client.replaceAll('id: "'+id+'",','id: "chatpet-'+id+'",');
// Embed data in the shipped scripts, including the sandboxed preload (no local require).
function inlineRoomTransport(file, value) {
  const path = join(root, file);
  const source = read(path), marker = /(\/\* room transport \*\/ )[^\n]*;$/gm;
  if ([...source.matchAll(marker)].length!==1) throw Error('Room transport marker changed: '+file);
  const output = source.replace(marker,(_line,prefix)=>prefix+JSON.stringify(value)+';');
  if (output!==source) writeFileSync(path,output);
  return output;
}
const roomEndpoints = Object.fromEntries(ROOM_ENDPOINTS.map(endpoint=>[endpoint,true]));
inlineRoomTransport('src/room/window-main.cjs', roomEndpoints);
inlineRoomTransport('src/room/window-preload.cjs', roomEndpoints);
const settings = replaceOnce(inlineRoomTransport('src/console/client.js', ROOM_CONSOLE_TIMEOUTS), 'window.__ModuleLoader__.load({', 'registerCompanion({');
writeFileSync(join(root,'src/desktop/platform/client.js'), '(()=>{\n'+client+'\n'+read(join(root,'src/desktop/platform/browser-entry.js'))+'\n'+settings+'\n})();\n');
