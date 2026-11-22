// Isolated archive verification. No installer, app, model or personal data.
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, readdirSync, readFileSync, rmSync, mkdirSync, existsSync, statSync} from 'node:fs';
import {join, resolve, dirname, relative, isAbsolute, extname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {registerHooks, isBuiltin} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';

assert.ok(process.argv[2], 'Usage: node scripts/checks/check-runtime-package.mjs ARCHIVE');
const archive=resolve(process.argv[2]),checkout=resolve('.'),stage=realpathSync(mkdtempSync(join(tmpdir(),'chatpet-package-code-')));
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const sourceOnly=[
  'src/desktop/helper/upstream/index.html',
  'vendor/dsh-pet/platform/runtime/electron-helper/main/smoke.js',
  'vendor/feiyu-room-template/public/room/garden-showcase.html',
  'vendor/mnemosyne/requirements-test.lock','vendor/mnemosyne/service/README.md','vendor/mnemosyne/service/pyproject.toml',
];
const retiredCore=['core','execution','history','dsh-driver','maintenance','resources','workbench','matters','upstream/serial-delivery'];
const retiredContracts=['execution','resources','maintenance','events','services','life','memory','desktop','channels','bilibili','console'];
const omitted=file=>file.startsWith('vendor/feiyu-room-template/public/room/assets/pet/')&&file.endsWith('.webm')||sourceOnly.includes(file)||file.startsWith('vendor/dsh-pet/platform/upstream/')||file.endsWith('.js.map')
  ||retiredCore.some(name=>file===`dist/src/core/${name}.js`||file===`dist/src/core/${name}.d.ts`)
  ||retiredContracts.some(name=>file===`dist/src/contracts/${name}.js`||file===`dist/src/contracts/${name}.d.ts`);
const tar=args=>{const result=spawnSync('/usr/bin/tar',args,{encoding:'utf8',env:{...process.env,COPYFILE_DISABLE:'1'},maxBuffer:32*1024*1024});assert.equal(result.status,0,result.stderr);return result.stdout;};
const walk=root=>readdirSync(root,{withFileTypes:true}).flatMap(row=>row.isDirectory()?walk(join(root,row.name)):row.isFile()?[join(root,row.name)]:[]);
try {
  const members=tar(['-tzf',archive]).trim().split('\n');
  for(const member of members) {
    assert.ok(member.startsWith('package/')&&!member.split('/').includes('..'),'Unsafe archive member: '+member);
    assert.ok(!member.split('/').some(part=>part.startsWith('._')||['__MACOSX','.DS_Store','node_modules','.git','.cache','__pycache__'].includes(part)),'Development/cache member: '+member);
    const file=member.slice('package/'.length);
    assert.ok(!omitted(file)&&!file.startsWith('tests/')&&!file.startsWith('dist/tests/')&&!/\.py[co]$/.test(file),'Source-only member: '+member);
  }
  tar(['--no-xattrs','-xzf',archive,'-C',stage]);
  const root=join(stage,'package'),files=walk(root),manifest=JSON.parse(readFileSync(join(root,'package.json')));
  const runtimeDependencies=new Set([...Object.keys(manifest.dependencies??{}),...Object.keys(manifest.optionalDependencies??{}),...Object.keys(manifest.peerDependencies??{})]);
  let externalImports=0;
  function externalDependency(specifier,from) {
    if(specifier.startsWith('.')||specifier.startsWith('#')||isBuiltin(specifier)||/^[a-z][a-z0-9+.-]*:/i.test(specifier))return;
    const name=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];
    assert.ok(runtimeDependencies.has(name),'Undeclared runtime import '+relative(root,from)+' -> '+specifier);externalImports++;
  }
  const present=(file,label=file)=>assert.ok(existsSync(file),'Missing packaged dependency '+label);
  const within=file=>{const path=relative(root,file);return !isAbsolute(path)&&path!=='..'&&!path.startsWith('../');};
  function target(specifier,from) {
    if(specifier.startsWith('.'))return resolve(dirname(from),decodeURIComponent(specifier.split(/[?#]/)[0]));
    if(specifier.startsWith('#')) {
      for(const[key,value]of Object.entries(manifest.imports)) {
        const [prefix,suffix='']=key.split('*');
        if(key.includes('*')&&specifier.startsWith(prefix)&&specifier.endsWith(suffix))return resolve(root,value.replace('*',specifier.slice(prefix.length,suffix?-suffix.length:undefined)));
        if(key===specifier)return resolve(root,value);
      }
      assert.fail('Unresolved package import '+specifier);
    }
  }
  let references=0,markdownReferences=0,buildFiles=0,firstPartyFiles=0,vendorFiles=0,sourceOnlyOrigins=0;
  const requireTarget=(specifier,from)=>{
    // This local override is served at the Room URL by roomAsset(), alongside
    // native-room.js; browser imports resolve from that URL, not src/room/.
    const servedFrom=relative(root,from)==='src/room/voice-client.js'?join(root,'vendor/feiyu-room-template/public/room/voice-client.js'):from;
    const file=['./activity-playback.js','./animation-map.js'].includes(specifier) && ['vendor/feiyu-room-template/public/room/app.js','vendor/feiyu-room-template/public/room/actor.js'].includes(relative(root,from))
      ? join(root,'dist/src/living/body',specifier==='./activity-playback.js'?'playback.js':'animation-map.js') : target(specifier,servedFrom);if(file){assert.ok(within(file),'Dependency escaped package');present(file,relative(root,from)+' -> '+specifier);references++;}
  };
  for(const file of files) {
    const local=relative(root,file);
    if((local.startsWith('src/')||local.startsWith('scripts/'))&&!local.startsWith('src/desktop/assets/')) {
      assert.equal(digest(file),digest(join(checkout,local)),'Stale packaged source/helper: '+local);firstPartyFiles++;
    }
    if(local.startsWith('dist/src/')) {
      const original=local.replace(/^dist\//,'').replace(/(?:\.d)?\.js$|\.d\.ts$/,'.ts');
      const generatedUpstream=local.startsWith('dist/src/desktop/upstream/') ||
        /^dist\/src\/voice\/upstream\/host\/(voice\/[^/]+|routes\/(voice|result))\.js$/.test(local);
      if(!generatedUpstream)assert.ok(existsSync(join(checkout,original)),'Build output has no current source: '+local);
      assert.equal(digest(file),digest(join(checkout,local)),'Stale packaged build: '+local);buildFiles++;
    }
    // Declaration files remain available for consumers; this pass checks the
    // executable closure, not upstream declaration-internal source references.
    if(/\.(?:js|mjs|cjs)$/.test(file)) {
      const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
      function visit(node) {
        if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)){
          requireTarget(node.moduleSpecifier.text,file);externalDependency(node.moduleSpecifier.text,file);
        }
        if(ts.isCallExpression(node)&&node.arguments.length&&ts.isStringLiteral(node.arguments[0])
          &&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')){
            requireTarget(node.arguments[0].text,file);
            // Browser factories have their own virtual require registry. Real
            // ESM imports, including optional dynamic downloads, need declared deps.
            if(node.expression.kind===ts.SyntaxKind.ImportKeyword)externalDependency(node.arguments[0].text,file);
          }
        if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='URL'&&node.arguments?.length===2
          &&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text.startsWith('.')&&/import\s*\.\s*meta\s*\.\s*url/.test(node.arguments[1].getText(source)))requireTarget(node.arguments[0].text,file);
        ts.forEachChild(node,visit);
      }
      visit(source);
    }
    if(extname(file)==='.html') {
      const html=readFileSync(file,'utf8');
      for(const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/g)) {
        const url=match[1];if(!/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url))requireTarget(url.startsWith('.')?url:'./'+url,file);
      }
      for(const match of html.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/g))for(const specifier of Object.values(JSON.parse(match[1]).imports??{}))if(specifier.startsWith('.'))requireTarget(specifier,file);
    }
    if(extname(file)==='.md') {
      for(const match of readFileSync(file,'utf8').matchAll(/\]\(([^)]+)\)/g)) {
        const url=match[1].split('#')[0];
        if(!url||/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(url))continue;
        const linked=resolve(dirname(file),decodeURIComponent(url));
        assert.ok(within(linked),'Packaged Markdown reference escaped package');present(linked,relative(root,file)+' -> '+url);markdownReferences++;
      }
    }
  }
  for(const value of [...Object.values(manifest.exports),...Object.values(manifest.bin),manifest.types])if(typeof value==='string'&&!value.includes('*'))present(resolve(root,value),value);
  for(const vendor of ['vendor/dsh-world','vendor/feiyu-room-template','vendor/dsh-pet/platform']) {
    const origin=JSON.parse(readFileSync(join(root,vendor,'origin.json')));
    assert.equal(digest(join(root,vendor,'origin.json')),digest(join(checkout,vendor,'origin.json')),'Provenance differs from source');
    for(const[name,value]of Object.entries(origin.files)) {
      const local=vendor+'/'+name;
      if(omitted(local)){assert.ok(!existsSync(join(root,local)));sourceOnlyOrigins++;continue;}
      const adaptation=origin.adaptations?.[name],expected=typeof adaptation==='object'&&adaptation.sha256?adaptation.sha256:typeof value==='string'?value:value.sha256;
      assert.equal(digest(join(root,local)),expected,local);vendorFiles++;
    }
    for(const[name,adaptation]of Object.entries(origin.adaptations??{})) {
      if(name in origin.files || omitted(vendor+'/'+name) || !adaptation?.sha256)continue;
      assert.equal(digest(join(root,vendor,name)),adaptation.sha256,vendor+'/'+name);vendorFiles++;
    }
  }
  for(const file of ['THIRD_PARTY_NOTICES.md','vendor/mnemosyne/LICENSE','vendor/mnemosyne/NOTICE','vendor/mnemosyne/ORIGIN.md','vendor/dsh-pet/LICENSE','vendor/dsh-world/LICENSE','vendor/feiyu-room-template/THIRD_PARTY_NOTICES.md','vendor/mnemosyne/service/src/cognitive_memory/main.py'])present(join(root,file));
  present(join(root,'src/desktop/helper/upstream/package.json'));
  assert.notEqual(JSON.parse(readFileSync(join(root,'src/desktop/helper/upstream/package.json'))).type,'module','The helper must retain its CommonJS boundary');
  const helper=readFileSync(join(root,'vendor/dsh-pet/platform/runtime/electron-helper/main.js'),'utf8');
  assert.ok(!helper.includes('runSmokeCheck')&&!helper.includes("process.env.DSH_PET_SMOKE ==="),'Installed helper still contains screenshot test mode');
  const petClient=readFileSync(join(root,'src/desktop/platform/client.js'),'utf8');
  for(const retired of ['mountBaifan','makeBaifanLayer','chatpet-baifan'])
    assert.ok(!petClient.includes(retired),'Retired independent food minigame still shipped: '+retired);
  const catalog=JSON.parse(readFileSync(join(root,'src/desktop/assets/catalog.json')));
  for(const row of [...catalog.actions,...(catalog.stickers??[])])if(row.file)present(join(root,'src/desktop/assets',row.file),row.file);
  const lifeMedia=JSON.parse(readFileSync(join(root,'src/desktop/assets/life-animations.json')));
  assert.equal(lifeMedia.animations.length,8,'Incomplete supplementary life media');
  for(const row of lifeMedia.animations)for(const item of [{file:row.file,sha256:row.sha256},row.poster]) {
    const file=join(root,'src/desktop/assets',item.file);present(file);assert.equal(digest(file),item.sha256,'Changed life media '+item.file);
  }
  const app=readFileSync(join(root,'vendor/feiyu-room-template/public/room/app.js'),'utf8');
  for(const match of app.matchAll(/['"](\.\/assets\/models\/[^'"]+\.glb)['"]/g))requireTarget(match[1],join(root,'vendor/feiyu-room-template/public/room/app.js'));
  // Exercise relocated domain code without importing the development implementation.
  const hostPeers=new Set(Object.keys(manifest.peerDependencies??{}));
  registerHooks({resolve(specifier,context,next){
    // DSH supplies SDK peers at installation. Bind only those declared peers to
    // the local SDK fixture; never fall back to checkout implementation modules.
    const peer=[...hostPeers].some(name=>specifier===name||specifier.startsWith(name+'/'));
    const result=next(specifier,peer?{...context,parentURL:pathToFileURL(join(checkout,'package.json')).href}:context);
    if(result.url.startsWith('file:')){const file=fileURLToPath(result.url);assert.ok(!['src','dist','vendor'].some(name=>file.startsWith(join(checkout,name)+'/')),'Development implementation import: '+file);}return result;
  }});
  const {CompanionRoom}=await import(pathToFileURL(join(root,'dist/src/living/body/room.js')));
  const {PersistentLifePlan}=await import(pathToFileURL(join(root,'dist/src/living/plan/plan.js')));
  const {EconomyStore}=await import(pathToFileURL(join(root,'dist/src/living/economy/store.js')));
  const {roomAsset}=await import(pathToFileURL(join(root,'dist/src/room/assets.js')));
  const {resolveActivityPlayback,sampleActivityPlayback}=await import(pathToFileURL(join(root,'dist/src/living/body/playback.js')));
  const {animationSlotAllowed}=await import(pathToFileURL(join(root,'dist/src/living/body/animation-slots.js')));
  const sleeping=resolveActivityPlayback({her:{kind:'sleep',asleep:true,spot:'bed'},behavior:{activityId:'sleep-fixture',phase:'sleeping',startedAt:1000}},animationSlotAllowed);
  assert.equal(sampleActivityPlayback(sleeping,1500).roomClip,'sleep_in');
  assert.equal(sampleActivityPlayback(sleeping,15000).roomClip,'sleep_loop');
  const meal=resolveActivityPlayback({her:{kind:'eat'},behavior:{activityId:'meal',phase:'working'}},animationSlotAllowed);
  assert.equal(sampleActivityPlayback(meal,15000).desktopClip,'吃白饭');
  const sharedCode=await roomAsset(new Request('http://localhost/chatpet-room/media-playback.js'));
  assert.equal(sharedCode.status,200);assert.match(await sharedCode.text(),/export function sampleActivityPlayback/);

  const {createCore}=await import(pathToFileURL(join(root,'dist/src/core/index.js')));
  const lifeSettings=await import(pathToFileURL(join(root,'dist/src/living/plan/library.js')));
  assert.equal('LifeLibrary' in lifeSettings,false,'Retired duplicate Life archive must not ship');
  assert.equal('requireLifeSchedule' in lifeSettings,false,'Unused fixed-schedule guard must not ship');
  const {loadPortableRepo}=await import(pathToFileURL(join(root,'scripts/lib/portable-repo.mjs')));
  const value=result=>{assert.equal(result.ok,true,result.error?.message);return result.value;};
  const coreRoot=join(stage,'core-workspace');mkdirSync(coreRoot);
  const core=createCore({dataDir:join(coreRoot,'.chatpet/data/core'),companionId:'fixture-fish',scopeId:'fixture-owner',ownerActorId:'fixture-owner',displayName:'Fixture',character:'Disposable code fixture'});
  try {
    assert.deepEqual(Object.keys(core.services).sort(),['core','preferences','workspace']);
    for(const name of ['chat','drain','idle','connectModule','observeFreshReplies','observeProgress'])assert.ok(!(name in core),'Retired Core host entry '+name);
    const identity=await core.services.core.getIdentity(core.operator.request('package-core'),{});assert.equal(identity.ok,true);
    assert.equal('receiveMessage' in core.services.core,false);assert.equal('admitActivity' in core.services.core,false);
    const prefs=value(await core.services.preferences.read(core.operator.request('package-local-prefs'),{}));
    const saved=value(await core.services.preferences.save(core.operator.request('package-local-bind'),{expectedRevision:prefs.revision,workspace:{id:'local-fixture',path:coreRoot,title:'Fixture'},conversation:prefs.conversation}));
    assert.equal(value(await core.services.workspace.initialize(core.operator.request('package-local-init'),{expectedPreferencesRevision:saved.revision})).state,'ready');
    const oldScope=core.workspace.editScope(),oldProfile=value(await core.services.workspace.readProfile(core.operator.request('package-profile-a'),{}));
    const otherRoot=join(stage,'other-workspace');mkdirSync(otherRoot);
    const beforeBind=value(await core.services.preferences.read(core.operator.request('package-rebind-prefs'),{}));
    const rebound=value(await core.services.preferences.save(core.operator.request('package-rebind'),{expectedRevision:beforeBind.revision,workspace:{id:'other-fixture',path:otherRoot,title:'Other'},conversation:beforeBind.conversation}));
    value(await core.services.workspace.initialize(core.operator.request('package-other-init'),{expectedPreferencesRevision:rebound.revision}));
    const beforeProfile=readFileSync(join(otherRoot,'.chatpet/USER.md'),'utf8');
    const staleProfile=await core.services.workspace.saveProfile(core.operator.request('package-stale-profile'),{expectedScope:oldScope,expectedRevision:oldProfile.revision,text:'Old A draft'});
    assert.equal(staleProfile.ok,false);assert.equal(staleProfile.error.code,'STALE_BINDING');
    const staleIdentity=await core.services.core.reviseIdentity(core.operator.request('package-stale-identity'),{expectedScope:oldScope,expectedRevision:identity.value.revision,displayName:'Old A',character:'Old A draft'});
    assert.equal(staleIdentity.ok,false);assert.equal(staleIdentity.error.code,'STALE_BINDING');
    assert.equal(readFileSync(join(otherRoot,'.chatpet/USER.md'),'utf8'),beforeProfile);
    const profileB=value(await core.services.workspace.readProfile(core.operator.request('package-profile-b'),{}));
    value(await core.services.workspace.saveProfile(core.operator.request('package-current-profile'),{expectedScope:core.workspace.editScope(),expectedRevision:profileB.revision,text:'Current B owner'}));
    assert.equal(readFileSync(join(otherRoot,'.chatpet/USER.md'),'utf8'),'Current B owner');
    const back=value(await core.services.preferences.read(core.operator.request('package-return-prefs'),{}));
    const returned=value(await core.services.preferences.save(core.operator.request('package-return-a'),{expectedRevision:back.revision,workspace:{id:'local-fixture',path:coreRoot,title:'Fixture'},conversation:back.conversation}));
    value(await core.services.workspace.initialize(core.operator.request('package-return-init'),{expectedPreferencesRevision:returned.revision}));
  }finally{await core.close();}
  assert.equal(loadPortableRepo(coreRoot).memoryDataDir,undefined,'An unconfigured Memory container is not an existing Bank');
  const bootstrapRoot=join(stage,'bootstrap-workspace');mkdirSync(bootstrapRoot);
  const bootstrapConfig={dataDir:join(stage,'external-bootstrap-core'),companionId:'bootstrap-fish',scopeId:'bootstrap-owner',ownerActorId:'bootstrap-owner',displayName:'Fixture',character:'Disposable bootstrap'};
  const bootstrap=createCore(bootstrapConfig);
  try {
    const prefs=value(await bootstrap.services.preferences.read(bootstrap.operator.request('package-prefs'),{}));
    const saved=value(await bootstrap.services.preferences.save(bootstrap.operator.request('package-bind'),{expectedRevision:prefs.revision,workspace:{id:'bootstrap',path:bootstrapRoot,title:'Fixture'},conversation:prefs.conversation}));
    const initialized=value(await bootstrap.services.workspace.initialize(bootstrap.operator.request('package-initialize'),{expectedPreferencesRevision:saved.revision}));
    assert.equal(initialized.state,'ready');assert.equal(bootstrap.workspace.storageStatus().complete,false);
    assert.ok(!existsSync(join(bootstrapRoot,'.chatpet/data/core/core.sqlite')));
    assert.throws(()=>createCore({...bootstrapConfig,dataDir:join(bootstrapRoot,'.chatpet/data/core')}),/migrate its existing Core|recover its data/);
  } finally {await bootstrap.close();}
  for(const name of ['index.html','app.js','native-room.js','voice-client.js','identity-client.js','shared-core.js','garden-ui.js','garden-world.js']) {
    const response=await roomAsset(new Request('http://package.invalid/chatpet-room/'+name));
    assert.equal(response.status,200,'Packaged Room route: '+name);assert.ok((await response.text()).length>0);
  }
  for(const row of lifeMedia.animations)for(const name of [row.file,row.poster.file]) {
    const response=await roomAsset(new Request('http://package.invalid/chatpet-room/assets/pet/'+name));
    assert.equal(response.status,200,'Relocated shared life media '+name);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),readFileSync(join(root,'src/desktop/assets',name)));
  }
  const data=join(stage,'fixture');mkdirSync(data);const room=new CompanionRoom(data,()=>undefined);room.setAutonomy(true);
  const plan=new PersistentLifePlan(data,'fixture-fish','fixture-world','UTC'),body={inspectPlanned:async(_workspace,id)=>room.inspectPlanned(id),startPlanned:async(_workspace,input)=>room.startPlanned(input)};
  await plan.commit(0,{goal:'Sustained rest',reason:'Package code fixture',steps:[{id:'rest',kind:'hold',activity:'Resting'}],nextConsiderAt:null});await plan.advance('fixture',body);const operation=plan.read().plan.operationId;
  const interaction={requestId:'package-water',actor:{kind:'owner',id:'fixture-owner',channel:'package-code-test'}};
  room.act({action:'water'},'主人',Date.now(),interaction);const count=room.state.counts.water;room.act({action:'water'},'主人',Date.now(),interaction);assert.equal(room.state.counts.water,count);
  await plan.advance('fixture',body);assert.equal(plan.read().plan.operationId,operation);room.flush();assert.equal(new CompanionRoom(data,()=>undefined).pendingFacts().length,1);
  const wallet=new EconomyStore({workspacePath:data,companionId:'fixture-fish',storageId:'fixture-world'});
  try{wallet.grantMoney('fixture-grant',3,undefined,interaction.actor);wallet.grantMoney('fixture-grant',3,undefined,interaction.actor);assert.equal(wallet.snapshot().balance,3);}finally{wallet.close();}
  // Import the packaged Python provider directly, without a runner or listener.
  // A missing development metadata file must not break actual Bank operations.
  const python=spawnSync(join(checkout,'.venv/bin/python'),['-I','-B','-c',String.raw`
import json, socket, sys
from pathlib import Path
def no_network(*args, **kwargs):
    raise AssertionError('Network/model access is forbidden in the package fixture')
socket.socket.connect = no_network
socket.create_connection = no_network
root, data = sys.argv[1:]
sys.path[:0] = [str(Path(root)/'vendor/mnemosyne/service/src'), str(Path(root)/'src/memory')]
from cognitive_memory.bootstrap import build_context
from cognitive_memory.core.service import NotFoundError
from provider import MemoryPort
ctx = build_context(data_dir=data, token='disposable-package-code')
try:
    port = MemoryPort(ctx.service, companion_id='fixture-fish', scope_id='fixture-owner', workspace_id='fixture-world')
    first = port.observe(port.scope, source_id='package-fact', revision='1', content='Owner supplied water.', actor_id='fixture-owner', source_kind='system')
    again = port.observe(port.scope, source_id='package-fact', revision='1', content='Owner supplied water.', actor_id='fixture-owner', source_kind='system')
    assert first['observationId'] == again['observationId']
    assert port.source_decision('package-fact', '1') == 'eligible'
    before = ctx.db.connect().execute('SELECT COUNT(*) FROM observations').fetchone()[0]
    try:
        port.consolidate_context('missing-conversation-observation')
    except NotFoundError:
        pass
    else:
        raise AssertionError('Missing observation must retain the provider not-found contract')
    assert ctx.db.connect().execute('SELECT COUNT(*) FROM observations').fetchone()[0] == before
    assert port.source_decision('package-fact', '1') == 'eligible'
    print(json.dumps({'packagedMemory': True}))
finally:
    ctx.runtime.stop()
    ctx.db.close()
`,root,join(stage,'memory-fixture')],{cwd:stage,encoding:'utf8',timeout:30000,maxBuffer:1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',DSH_MEMORY_EMOTION:'0',DSH_MEMORY_EMOTION_WRITE:'0'}});
  assert.equal(python.status,0,python.stderr);assert.equal(JSON.parse(python.stdout).packagedMemory,true);
  console.log(JSON.stringify({archive,sha256:digest(archive),archiveBytes:statSync(archive).size,uncompressedBytes:files.reduce((sum,file)=>sum+statSync(file).size,0),archiveMembers:members.length,buildFiles,firstPartyFiles,vendorFiles,sourceOnlyOrigins,localReferences:references,markdownReferences,externalImports,relocatedCode:true,commonTimeline:true,thinCore:true,workspaceEditScope:true,externalBootstrap:true,packagedMemory:true,bodyEffectOnce:true,planRetained:true,walletOnce:true,appsStarted:0,realModelCalls:0,personalDataAccess:false}));
} finally {rmSync(stage,{recursive:true,force:true});}
