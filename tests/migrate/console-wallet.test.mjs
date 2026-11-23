import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {CONSOLE_WALLET_IMPORT_FILE} from '../../dist/src/core/storage-migration.js';
import {createCore} from '../../dist/src/core/index.js';
import {CompanionEconomy} from '../../dist/src/living/economy/plugin.js';
import {createOfflineBackup} from '../../scripts/lib/offline-backup.mjs';
import {exportWalletSources} from '../../scripts/migrate/browser-wallet.mjs';
import {hash} from '../../scripts/migrate/io.mjs';
import {migrationStatus, runMigration, runWalletBrowserOperation, steps, verifyWalletImport} from '../../scripts/migrate/runner.mjs';
import {sealWalletRollback, walletBinding} from '../../scripts/migrate/wallet-rollback.mjs';
import {cli, mockDsh, planFor, read, refusedCli} from './helpers.mjs';
import {economyPaths, offlineFixture} from './offline-helpers.mjs';

async function legacy(t, adopted) {
  mockDsh(t);
  const f = await offlineFixture(t, false, {withLegacyEconomy:adopted});
  await runMigration({installation:f.installation, backup:join(f.out,'v3-resume')}, steps.slice(0, 3));
  const manifest = join(f.data,'storage-manifest.json');
  assert.equal(read(manifest).modules.living, 3);
  assert.equal(migrationStatus(f.installation).segment, 'settled');
  return {...f, manifest};
}

async function prepare(f, pending) {
  const directory = join(f.out, 'private');
  mkdirSync(directory, {mode:0o700});
  const walletExport = join(directory,'export.json'), walletRollback = join(directory,'rollback.json');
  const plan = planFor(f), binding = walletBinding(plan);
  const sources = [{profile:f.profile, origin:'https://fixture.invalid', key:'chatpet:economy:pending:' + f.target.id}];
  const raw = pending ? JSON.stringify({endpoint:'economyAction', requestId:'original-credit',
    input:{workspaceId:f.target.id, action:{kind:'grant', amount:2}}}) : null;
  await exportWalletSources({file:walletExport, binding, round:randomUUID(), sources,
    acquire:async () => ({assertFrozen:() => true, read:() => raw})});
  const backup = join(f.out,'old-backup');
  createOfflineBackup(plan, backup);
  sealWalletRollback({installation:f.installation, backup, walletExport, output:walletRollback});
  writeFileSync(join(plan.installedPackage,'upgrade-marker.txt'), 'SYNTHETIC_UPGRADE');
  return {installation:f.installation, walletExport, walletRollback};
}

function attestationFixture(f) {
  const plan = planFor(f), directory = join(f.out,'private-attestation');
  mkdirSync(directory,{mode:0o700});
  const metadata = join(plan.installedPackage,'package.json');
  const install = version => writeFileSync(metadata,JSON.stringify({name:'her-world',version}));
  const walletRollback = join(directory,'rollback.json'), oldBackup = join(f.out,'attestation-old');
  const backup = join(f.out,'attestation-resume');
  const cliBase = ['--installation',f.installation], route = ['--wallet-rollback',walletRollback,'--owner-attests-no-pending'];
  install('0.4.0');
  createOfflineBackup(plan,oldBackup);
  return {plan,directory,install,walletRollback,oldBackup,backup,route,cliBase,
    seal:['seal-wallet-rollback',...cliBase,'--backup',oldBackup,'--output',walletRollback,'--owner-attests-no-pending']};
}

test('声明路线经 CLI 预检并迁移未采用的钱包，结清状态只读取落盘证明', async t => {
  const f = await legacy(t,false);
  const a = attestationFixture(f);
  const invoke = (...args) => {
    const result = cli(f,args);
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(invoke(...a.seal),{sealed:true});
  const anchor = read(a.walletRollback);
  assert.deepEqual(anchor.ownerAttestation,{source:'dsh-app://app',attestedAt:new Date(anchor.ownerAttestation.attestedAt).toISOString(),
    binding:walletBinding(a.plan),round:anchor.round,fromVersion:'0.4.0',toVersion:'0.5.0'});
  a.install('0.5.0');
  assert.deepEqual(invoke('plan',...a.cliBase,...a.route).steps,[{id:'0004-console-wallet',state:'pending'}]);
  assert.equal(existsSync(a.backup),false);
  invoke('run',...a.cliBase,...a.route,'--backup',a.backup);
  const proof = read(join(f.data,CONSOLE_WALLET_IMPORT_FILE));
  assert.equal(proof.wallet,'absent');
  assert.equal(proof.mode,'import');
  assert.equal(proof.sourceCount,1);
  assert.equal(proof.requestCount,0);
  assert.deepEqual(proof.ownerAttestation,anchor.ownerAttestation);
  assert.equal(existsSync(economyPaths(f).database),false);
  rmSync(a.walletRollback);
  const status = invoke('status',...a.cliBase,...a.route);
  assert.equal(status.segment,'settled');
  assert.deepEqual(status.steps.at(-1),{id:'0004-console-wallet',state:'complete'});
  assert.deepEqual(status.walletImport,{requestCount:0,sourceCount:1});
  const marker = join(f.data,CONSOLE_WALLET_IMPORT_FILE);
  writeFileSync(marker,JSON.stringify({...proof,ownerAttestation:{...proof.ownerAttestation,attestedAt:'2026-01-01T00:00:00.000Z'}}));
  const damaged = invoke('status',...a.cliBase,...a.route);
  assert.equal(damaged.steps.at(-1).state,'inconsistent');
  assert.equal(damaged.walletImport,undefined);
});

test('声明路线拒绝版本、绑定和停写异常以及本轮浏览器材料，并保留原件', async t => {
  const f = await legacy(t,false);
  const a = attestationFixture(f);
  const excluded = join(a.directory,'wallet-sources.json'), exported = join(a.directory,'wallet-export.json');
  const journal = join(f.data,'migrations.jsonl'), original = readFileSync(journal);
  const seal = (code,options) => refusedCli(f,a.seal,code,options);
  const run = (code,options,...extra) => refusedCli(f,['run',...a.cliBase,...a.route,'--backup',a.backup,...extra],code,options);
  seal('dsh-running',{running:true});
  const list = JSON.stringify({sources:[{origin:'https://fixture.invalid',pending:[]}]});
  writeFileSync(excluded,list,{mode:0o600});
  seal('wallet-attestation-conflict');
  assert.equal(readFileSync(excluded,'utf8'),list);
  assert.equal(existsSync(a.walletRollback),false);
  rmSync(excluded);
  a.install('0.4.0-rc.1');
  seal('wallet-attestation-version');
  a.install('0.4.0');
  assert.equal(cli(f,a.seal).status,0);
  run('wallet-attestation-version');
  a.install('0.5.0');
  run('dsh-running',{running:true});

  const browserBinding = walletBinding(a.plan);
  await exportWalletSources({file:exported,binding:browserBinding,round:randomUUID(),
    sources:[{profile:f.profile,origin:'https://fixture.invalid',key:'chatpet:economy:pending:' + f.target.id}],
    acquire:async () => ({assertFrozen:() => true,read:() => JSON.stringify({endpoint:'economyAction',requestId:'pending-test',
      input:{workspaceId:f.target.id,action:{kind:'grant',amount:2}}})})});
  const exportBytes = readFileSync(exported);
  run('wallet-attestation-conflict',undefined,'--wallet-export',exported);
  run('wallet-attestation-conflict');
  assert.deepEqual(readFileSync(exported),exportBytes);
  rmSync(exported);

  const anchorBytes = readFileSync(a.walletRollback), reassigned = JSON.parse(anchorBytes);
  reassigned.ownerAttestation.binding.workspaceId = 'different-workspace';
  reassigned.exportDigest = hash(JSON.stringify(reassigned.ownerAttestation));
  writeFileSync(a.walletRollback,JSON.stringify(reassigned));
  run('binding-changed');
  writeFileSync(a.walletRollback,anchorBytes);
  const bank = join(f.data,'retained-bank','runtime');
  mkdirSync(bank,{recursive:true});
  writeFileSync(join(bank,'service.json'),JSON.stringify({pid:process.pid,token_env:'DSH_MEMORY_TOKEN'}));
  run('writer-running');
  rmSync(join(bank,'service.json'));
  assert.deepEqual(readFileSync(a.walletRollback),anchorBytes);
  assert.deepEqual(readFileSync(journal),original);
  assert.equal(read(f.manifest).modules.living,3);
  assert.equal(existsSync(a.backup),false);
});

test('未采用钱包的 v3 缺导出就拒绝，明确空来源留下独立证明且保持无钱包', async t => {
  const f = await legacy(t, false);
  const backup = join(f.out,'resume-v4');
  await assert.rejects(runMigration({installation:f.installation, backup}), {code:'wallet-export-missing'});
  assert.equal(existsSync(backup), false);
  const inputs = await prepare(f, false);
  await runMigration({...inputs, backup});
  assert.equal(verifyWalletImport(inputs), true);
  const marker = join(f.data,CONSOLE_WALLET_IMPORT_FILE);
  assert.equal(read(marker).wallet, 'absent');
  assert.equal(read(marker).requestCount, 0);
  assert.equal(read(marker).sourceCount, 1);
  assert.equal(existsSync(economyPaths(f).database), false);
  assert.equal(read(f.manifest).modules.living, 4);
});

test('未采用钱包的 v3 拒绝有请求的浏览器来源', async t => {
  const f = await legacy(t, false);
  const inputs = await prepare(f, true);
  const backup = join(f.out,'resume-v4');
  await assert.rejects(runMigration({...inputs, backup}), {code:'wallet-not-adopted'});
  assert.equal(existsSync(backup), false);
  assert.equal(existsSync(economyPaths(f).database), false);
  assert.equal(read(f.manifest).modules.living, 3);
});

test('存量钱包的已结清导入在私有导出封窗后仍可查历史证明', async t => {
  const f = await legacy(t, true);
  const inputs = await prepare(f, true);
  await runMigration({...inputs, backup:join(f.out,'resume-v4')});
  assert.equal(verifyWalletImport(inputs), true);
  await assert.rejects(runMigration({installation:f.installation,walletRollback:inputs.walletRollback,
    backup:join(f.out,'wrong-route'),ownerAttestsNoPending:true}),{code:'wallet-attestation-conflict'});
  const host = createCore(f.config), economy = new CompanionEconomy({},host);
  try {
    assert.equal(host.workspace.status().state, 'ready');
    economy.prepare(f.target);
    const id = f.target.id, signal = new AbortController().signal;
    const recover = (rpc, requestId) => economy.consoleRecover(rpc, id, requestId, false, signal, () => {});
    assert.deepEqual(await recover('economyCheck','original-credit'),{state:'no-evidence'});
    assert.deepEqual(await recover('economyRetry','original-credit'),{state:'committed'});
    assert.deepEqual(await recover('economyPending',''),[]);
    assert.equal((await economy.snapshot(id)).ledger.filter(row => row.requestId === 'original-credit').length,1);
  } finally {
    economy.close();
    await host.close();
  }
  assert.throws(() => verifyWalletImport(inputs), {code:'migration-inconsistent'});
  rmSync(inputs.walletExport);
  rmSync(inputs.walletRollback);
  const current = migrationStatus(f.installation);
  assert.equal(current.segment, 'settled');
  assert.deepEqual(current.steps.at(-1), {id:'0004-console-wallet',state:'complete'});
  await runMigration({installation:f.installation, resume:true});
});


test('浏览器离线入口在配置移除后仍拒绝运行中的保留 Memory', async t => {
  const f = await legacy(t,false);
  const retained = join(f.data,'retained-bank','runtime');
  mkdirSync(retained,{recursive:true});
  const owner = join(retained,'service.json');
  writeFileSync(owner,JSON.stringify({pid:process.pid,token_env:'DSH_MEMORY_TOKEN'}));
  const directory = join(f.out,'private-browser');
  mkdirSync(directory,{mode:0o700});
  const walletExport = join(directory,'export.json');
  const input = {installation:f.installation,mode:'export',walletExport,round:randomUUID(),
    sources:[{profile:f.profile,origin:'https://fixture.invalid',key:'chatpet:economy:pending:' + f.target.id}],
    acquire:async () => ({assertFrozen:() => true,read:() => null})};
  await assert.rejects(runWalletBrowserOperation(input),{code:'writer-running'});
  assert.equal(existsSync(walletExport),false);
  rmSync(owner);
  assert.deepEqual(await runWalletBrowserOperation(input),{sourceCount:1,complete:true});
});
