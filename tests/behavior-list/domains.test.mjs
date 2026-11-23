import test from 'node:test';
import assert from 'node:assert/strict';
import fs,{readFileSync,renameSync,existsSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {syncBuiltinESMExports} from 'node:module';
import {fixture,until} from './fixture.mjs';
import {cordisFixture} from './entries-lifecycle.test.mjs';
import {CONSOLE_WALLET_IMPORT_FILE,CONSOLE_WALLET_STEP,ECONOMY_STORAGE_STEP,HOME_STORAGE_STEP,INITIAL_STORAGE_STEP}
  from '../../dist/src/core/storage-migration.js';
const meal='food:improved-meal',HOUR=3_600_000;

test('效果落盘后的钱包路径故障保留预留并在重启后只结算一次',async t=>{
  const f=await fixture(t,{life:false});await f.body.setAutonomy('world',true);
  await f.ownerAction({kind:'gift',itemId:meal,quantity:1},'gift');
  const before=(await f.body.snapshot('world')).needs.hunger;
  const homeFile=join(f.repo,'.chatpet/data/life/home.json'),database=join(f.repo,'.chatpet/data/economy/economy.sqlite');
  const originalRename=fs.renameSync;let moved=false;
  // 文件系统提交边界：只有食物效果写入实际 home.json 后才移走数据库。
  fs.renameSync=(from,to)=>{
    const result=originalRename(from,to);
    if(to===homeFile&&!moved){
      const home=JSON.parse(readFileSync(homeFile,'utf8'));
      if(Object.values(home.plannedExecutions??{}).some(row=>row.effectAppliedAt)){
        moved=true;originalRename(database,database+'.held');
      }
    }
    return result;
  };syncBuiltinESMExports();
  const restore=()=>{fs.renameSync=originalRename;syncBuiltinESMExports();if(moved&&existsSync(database+'.held'))originalRename(database+'.held',database);};
  t.after(restore);
  try {
    await f.body.startPlanned('world',{operationId:'consume-once',kind:'economy',activity:'Eat',economy:{type:'consume',itemId:meal,quantity:1}});
    assert.equal(moved,true,'故障必须发生在身体效果落盘之后');
    const saved=JSON.parse(readFileSync(homeFile,'utf8'));
    assert.ok(saved.needs.hunger<before);assert.ok(saved.plannedExecutions['consume-once'].effectAppliedAt);
    assert.equal(saved.plannedExecutions['consume-once'].settlementCompletedAt,undefined);
    await assert.rejects(f.economy.snapshot('world'),/missing|changed|current bound workspace/);
  }finally{restore();}
  const pending=await f.economy.snapshot('world');
  assert.equal(pending.pendingUses.length,1);assert.equal(pending.pendingUses[0].status,'reserved');
  assert.equal(pending.inventory.find(row=>row.itemId===meal).quantity,1);
  assert.equal(pending.ledger.filter(row=>row.kind==='use-consume').length,0);
  const effect=JSON.parse(readFileSync(homeFile,'utf8')).needs.hunger;
  await f.restart();await f.body.setAutonomy('world',true);
  await f.body.startPlanned('world',{operationId:'consume-once',kind:'economy',activity:'Eat',economy:{type:'consume',itemId:meal,quantity:1}});
  const recovered=await f.economy.snapshot('world');
  assert.equal((await f.body.inspectPlanned('world','consume-once')).status,'completed');
  assert.equal((await f.body.snapshot('world')).needs.hunger,effect);
  assert.equal(recovered.inventory.find(row=>row.itemId===meal).quantity,0);
  assert.equal(recovered.pendingUses.length,0);assert.equal(recovered.ledger.filter(row=>row.kind==='use-consume').length,1);
});

test('睡眠中库存投喂不耗物品并保留睡眠终态',async t=>{
  const f=await fixture(t,{life:false});await f.body.setAutonomy('world',true);
  await f.ownerAction({kind:'gift',itemId:meal,quantity:1},'gift');
  await f.body.act('world','sleep','sleep');t.mock.timers.tick(120_000);await f.body.snapshot('world');
  assert.equal(f.body.restState('world').sleeping,true);
  const before=(await f.body.snapshot('world')).needs;
  const response=await f.ownerAction({kind:'feed',itemId:meal},'sleeping-feed');
  assert.equal(response.execution.status,'failed');assert.match(response.execution.reason,/先叫醒/);
  assert.deepEqual((await f.body.snapshot('world')).needs,before);assert.equal(f.body.restState('world').sleeping,true);
  await f.restart();const repeated=await f.ownerAction({kind:'feed',itemId:meal},'sleeping-feed');
  assert.deepEqual(repeated.execution,response.execution);assert.equal(f.body.restState('world').sleeping,true);
  assert.equal(repeated.inventory.find(row=>row.itemId===meal).quantity,1);assert.equal(repeated.pendingUses.length,0);
  assert.equal(repeated.ledger.filter(row=>row.kind==='use-consume').length,0);
});

test('停机后的身体消耗只使用一次配置额度',async t=>{
  const f=await fixture(t,{life:false,economy:false});await f.body.setAutonomy('world',true);
  const before=(await f.body.snapshot('world')).needs;
  // 卸载组件持久化花园时钟的启用状态；重启据此恢复离线额度，72 小时只扣默认 4 小时。
  await f.body.close();t.mock.timers.tick(72*HOUR);await f.restart();
  await f.body.setAutonomy('world',true);const after=(await f.body.snapshot('world')).needs;
  assert.ok(Math.abs(after.thirst-Math.min(.7,before.thirst+.085*4))<1e-9);
  assert.ok(after.hunger<=Math.max(.7,before.hunger));assert.ok(after.energy>=.35);
  await f.restart();await f.body.setAutonomy('world',true);
  assert.deepEqual((await f.body.snapshot('world')).needs,after);
});

test('阅读必须取得真实文字并以原片段回执跨重启确认',async t=>{
  const f=await fixture(t);await f.enable();
  const text='A real synthetic book passage. '.repeat(80);
  const imported=await f.ownerAction({kind:'importReading',title:'Synthetic book',content:text,source:{name:'fixture.txt'}},'import-book');
  const itemId=imported.catalog.find(row=>row.name==='Synthetic book').id;
  await f.ownerAction({kind:'gift',itemId,quantity:1},'gift-book');
  const plan=await f.life.readPlan('world');
  await f.life.updatePlan('world',plan.revision,{goal:'Read',reason:'Actual text',steps:[{id:'read',kind:'read',activity:'Read',reading:{itemId,segment:0}}],nextConsiderAt:null});
  await until(async()=>!!(await f.life.readPlan('world')).plan?.operationId);
  let current=await f.life.readPlan('world');const operation=current.plan.operationId;
  assert.equal((await f.economy.snapshot('world')).bookmarks.length,0);
  const offer=await f.life.readPlannedSegment('world',current.revision,operation);
  assert.equal(offer.text,text.slice(0,1200));assert.equal((await f.economy.snapshot('world')).bookmarks.length,0);
  await f.restart();await until(()=>f.life.running());current=await f.life.readPlan('world');
  const reopened=await f.life.readPlannedSegment('world',current.revision,operation);assert.deepEqual(reopened,offer);
  await assert.rejects(f.life.confirmPlannedReading('world',current.revision,operation,'wrong-token'),/match/);
  await f.life.confirmPlannedReading('world',current.revision,operation,offer.receiptToken);
  const bookmarks=(await f.economy.snapshot('world')).bookmarks;
  assert.equal(bookmarks.length,1);assert.equal(bookmarks[0].offset,offer.endOffset);assert.equal(bookmarks[0].version,offer.version);
});

test('钱包缺库时公开服务拒绝创建空白替代',async t=>{
  const f=await fixture(t,{life:false});await f.ownerAction({kind:'grant',amount:30},'grant');
  f.economy.close();const file=join(f.repo,'.chatpet/data/economy/economy.sqlite');renameSync(file,file+'.held');
  await f.restart();await assert.rejects(f.economy.snapshot('world'),/missing|recover|restore|current bound workspace/i);
  assert.equal(existsSync(file),false,'不能用空白钱包代替丢失的权威库');
});

async function retainedWallet(t, scenario) {
  const f=await cordisFixture(t,{order:['economy']});
  await f.ownerAction({kind:'grant',amount:30},'retained-grant');
  assert.equal(f.fiber('body'),undefined);
  const data=join(f.repo,'.chatpet/data'), database=join(data,'economy/economy.sqlite');
  const adoption=join(data,'living/economy-adoption.json'), garden=join(f.directory,'garden.json');
  if(scenario==='old garden')writeFileSync(garden, JSON.stringify({...JSON.parse(readFileSync(garden,'utf8')),coins:61}));
  const originalGarden=readFileSync(garden), originalProof=readFileSync(adoption);
  let held=database+'.held', retained, moved;
  await f.restart(()=>{
    if(scenario==='directory') {
      renameSync(dirname(database),dirname(database)+'.held');
      held=join(dirname(database)+'.held','economy.sqlite');
    } else if(scenario==='wallet binding') {
      using db=new DatabaseSync(database);
      db.prepare('UPDATE meta SET value=? WHERE key=?').run(JSON.stringify({storageId:'wrong',companionId:'wrong'}),'identity');
    } else if(scenario==='proof binding') {
      writeFileSync(adoption,JSON.stringify({storageId:'wrong',companionId:'wrong'}));
    } else {
      renameSync(database,held);
      if(scenario==='shell')writeFileSync(database,'');
    }
    retained=existsSync(database) ? readFileSync(database) : undefined;
    moved=existsSync(held) ? readFileSync(held) : undefined;
  });
  await assert.rejects(f.economy.snapshot(f.id), /missing|restore|initialized database|current bound workspace|different storage/i);
  assert.equal(existsSync(database),retained!==undefined);
  if(retained)assert.deepEqual(readFileSync(database),retained);
  if(scenario==='directory')assert.equal(existsSync(dirname(database)),false);
  if(moved)assert.deepEqual(readFileSync(held),moved);
  assert.deepEqual(readFileSync(garden),originalGarden);
  if(scenario==='proof binding')assert.deepEqual(JSON.parse(readFileSync(adoption,'utf8')),{storageId:'wrong',companionId:'wrong'});
  else assert.deepEqual(readFileSync(adoption),originalProof);

  if(scenario==='old garden') {
    await f.unload('economy'); await f.load('body');
    assert.equal((await f.body.garden(f.id,'state')).ok,false);
    await f.body.act(f.id,'water','free-water');
    assert.equal((await f.body.pendingFacts(f.id)).at(-1).requestId,'free-water');
    assert.deepEqual(readFileSync(garden),originalGarden);
  }
}

test('仅挂 Economy 交易后缺库拒绝复活旧钱包',t=>retainedWallet(t,'database'));
test('整个钱包目录丢失仍拒绝复活旧钱包',t=>retainedWallet(t,'directory'));
test('空壳钱包库保留原字节并拒绝初始化',t=>retainedWallet(t,'shell'));
test('钱包缺库时保留旧菜园和免费照料',t=>retainedWallet(t,'old garden'));
test('异绑定的钱包库或证据拒绝复活旧钱包',async t=>{
  await t.test('异绑定库',t=>retainedWallet(t,'wallet binding'));
  await t.test('异绑定证据',t=>retainedWallet(t,'proof binding'));
});

async function assertFreeCare(f, tag) {
  for (const action of ['feed','water']) {
    const requestId=`free-${action}-${tag}`;
    await f.body.act(f.id,action,requestId);
    assert.ok((await f.body.pendingFacts(f.id)).some(fact=>fact.requestId===requestId && fact.type===action));
  }
}

test('坏钱包证据只阻断钱包并保留免费照料',async t=>{
  const f=await cordisFixture(t,{order:['economy','body']});
  const wallet=await f.ownerAction({kind:'grant',amount:30},'retained-wallet');
  const wrong=JSON.stringify({storageId:'other-binding',companionId:f.core.workspace.runtime.config.companionId});
  const data=join(f.repo,'.chatpet/data');
  for (const name of ['living/economy-adoption.json','economy/storage.json']) {
    const file=join(data,name), saved=readFileSync(file);
    for (const [label, corrupted] of [['bad-json','{'],['wrong-binding',wrong]]) await t.test(`${name} ${label}`,async()=>{
      writeFileSync(file,corrupted);
      try {
        assert.equal(f.core.workspace.status().state,'ready');
        await assert.rejects(f.economy.snapshot(f.id),/JSON|different storage/);
        assert.equal((await f.body.garden(f.id,'state')).ok,false);
        await assertFreeCare(f,`${label}-${name}`);
        assert.equal(readFileSync(file,'utf8'),corrupted);
      } finally { writeFileSync(file,saved); }
    });
  }
  assert.equal((await f.economy.snapshot(f.id)).balance,wallet.balance);
});

test('0.5.0 完成日志挡住双目录丢失后重建钱包并保留免费照料',async t=>{
  const f=await cordisFixture(t,{order:['economy','body']});
  await f.ownerAction({kind:'grant',amount:30},'retained-grant');
  const data=join(f.repo,'.chatpet/data'), journal=join(data,'migrations.jsonl');
  const garden=join(data,'life/garden.json'), retained='{"coins":61}\n';
  const directories=[join(data,'economy'),join(data,'living')];
  const declared=JSON.parse(readFileSync(join(f.repo,'.chatpet/manifest.json'),'utf8')).files;
  assert.ok(!declared.some(path=>path.startsWith('data/economy/') || path.startsWith('data/living/')));
  const {companionId}=f.core.workspace.runtime.config, storageId=f.core.workspace.storageId();
  const digest='a'.repeat(64), archive=join(dirname(f.repo),'historical-backup');
  const steps=[INITIAL_STORAGE_STEP,HOME_STORAGE_STEP,ECONOMY_STORAGE_STEP,CONSOLE_WALLET_STEP];
  const log=[
    {event:'migration',id:'first-round',backup:archive,manifestHash:digest},
    {event:'done',migrationId:'first-round',step:INITIAL_STORAGE_STEP.id},
    {event:'migration',id:'last-round',schema:2,backup:archive,backupHash:digest,
      binding:{storageId,repoHash:createHash('sha256').update(f.repo).digest('hex')},steps,economyAdopted:true,
      walletImport:{exportFile:archive,rollbackFile:archive,rollbackDigest:digest,codeFingerprint:digest,
        proof:{format:1,mode:'import',binding:{storageId,companionId},wallet:'adopted',round:'fixture',
          sourceCount:1,requestCount:1,sourceDigest:digest,requestDigest:digest,exportDigest:digest}}},
    ...steps.map(step=>({event:step===INITIAL_STORAGE_STEP?'skip':'done',migrationId:'last-round',step:step.id})),
  ].map(row=>JSON.stringify(row)).join('\n')+'\n';
  await f.restart(()=>{
    writeFileSync(garden,retained);
    writeFileSync(journal,log);
    rmSync(join(data,CONSOLE_WALLET_IMPORT_FILE));
    for (const directory of directories) rmSync(directory,{recursive:true});
  },{order:['body']});
  assert.equal(f.core.workspace.status().state,'ready');
  assert.equal((await f.body.garden(f.id,'state')).ok,false);
  await assertFreeCare(f,'wallet-unmounted');
  await f.load('economy');
  await assert.rejects(f.economy.snapshot(f.id),/authoritative economy database is missing/);
  assert.equal((await f.body.garden(f.id,'state')).ok,false);
  await assertFreeCare(f,'wallet-mounted');
  assert.equal(f.core.workspace.status().state,'ready');
  for (const directory of directories) assert.equal(existsSync(directory),false);
  assert.equal(readFileSync(garden,'utf8'),retained);
  assert.equal(readFileSync(journal,'utf8'),log);
});
