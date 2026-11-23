import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join, basename, dirname} from 'node:path';
import vm from 'node:vm';
import {profileFixture} from '../behavior-list/setup-config.test.mjs';
import {createCore} from '../../dist/src/core/index.js';

const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function fixture(t, {fresh = false, runtime = false} = {}) {
  const f = profileFixture(t), repo = join(f.home, 'repo');
  const config = {companionId: 'fish', scopeId: 'scope', ownerActorId: 'owner', displayName: '', character: '',
    dataDir: join(repo, '.chatpet/data/core')};
  const memory = runtime ? {python: join(f.home, 'python'), dataDir: join(f.home, 'bank')} : undefined;
  const oldConfig = {...config, dataDir: join(f.home, 'codex-pet/core'), ...(runtime ? {memory} : {})};
  const old = {status:'installed', packageInstalled:true, profileDir: f.profileDir, config: oldConfig,
    actualPaths:{coreDataDir: oldConfig.dataDir, memoryDataDir: memory?.dataDir ?? null, memoryPython: memory?.python ?? null}};
  const oldBytes = JSON.stringify(old, null, 2) + '\n';
  const patch = '# retain owner patch\n' + (fresh ? '[]\n' : f.dump([{id: '00-Core', config: oldConfig}]));
  if (!fresh) {
    f.installFixture();
    fs.mkdirSync(f.receiptDir, {recursive: true});
    fs.writeFileSync(f.receiptPath, oldBytes);
  }
  fs.writeFileSync(f.patchPath, patch);
  return {...f, repo, config, oldConfig, oldBytes, patch,
    args: ['--data-dir', config.dataDir, '--no-backup']};
}

function failure(f, options, reason, args = f.args) {
  const result = f.command(['--apply', ...args], options);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stderr.trim().split('\n').at(-1));
  assert.equal(report.reason, reason);
  return report;
}

function attemptStage(f) {
  const stage = fs.readdirSync(f.receiptDir, {withFileTypes: true}).filter(entry => entry.isDirectory() && entry.name.startsWith('prepared-'));
  assert.equal(stage.length, 1);
  return join(f.receiptDir, stage[0].name);
}

test('R5: preparation preserves the completed receipt byte-for-byte and records its own planned binding',t=>{
  const f=fixture(t);
  const {attemptReceipt} = f.checked(f.args);
  assert.equal(fs.readFileSync(f.receiptPath,'utf8'),f.oldBytes);
  const attempt=json(attemptReceipt);
  assert.equal(attempt.status,'prepared');assert.equal(attempt.config.dataDir,f.config.dataDir);
  assert.deepEqual(f.calls(),[]);
});
test('R5: fresh preparation creates no installed receipt',t=>{
  const f=fixture(t,{fresh:true}), {attemptReceipt} = f.checked(f.args);
  assert.equal(fs.existsSync(f.receiptPath),false);assert.equal(json(attemptReceipt).status,'prepared');
});
for(const [options,reason] of [[{running:true},'dsh-running'],[{runtime:true},'device-runtime-failed']]) {
  test('R5: failed pre-install gate retains the last completed receipt: '+reason,t=>{
    const f=fixture(t,options);
    failure(f, options, reason);
    assert.equal(fs.readFileSync(f.receiptPath,'utf8'),f.oldBytes);
    assert.equal(f.calls().some(call=>call.args),false);
  });
}
for(const [options,reason] of [[{cliFailure:'mutated'},'package-install-failed'],[{changedPatch:true},'profile-patch-changed'],[{initializationFailure:true},'workspace-initialization-failed']]) {
  test('R5: uncertain apply refuses to advertise a completed binding and retains the previous receipt: '+reason,async t=>{
    const f=fixture(t);
    const mode = {...options}, args = [...f.args];
    if (options.initializationFailure) {
      fs.mkdirSync(f.repo);
      const host = createCore(f.oldConfig);
      try {
        const prefs = await host.services.preferences.read(host.operator.request('receipt-read'), {});
        assert.equal(prefs.ok, true);
        const saved = await host.services.preferences.save(host.operator.request('receipt-bind'), {expectedRevision: prefs.value.revision,
          workspace: {id: 'workspace', path: f.repo, title:'Workspace'}, conversation: prefs.value.conversation});
        assert.equal(saved.ok, true);
        assert.equal((await host.services.workspace.initialize(host.operator.request('receipt-initialize'), {expectedPreferencesRevision: saved.value.revision})).ok, true);
      } finally { await host.close(); }
      mode.breakWorkspace = join(f.repo, '.chatpet/manifest.json');
      args[1] = f.oldConfig.dataDir;
    }
    assert.equal(failure(f, mode, reason, args).status, 'applying');
    const current=json(f.receiptPath);
    assert.equal(current.status,'applying');assert.equal(current.packageInstalled,undefined);
    assert.equal(fs.readFileSync(current.previousReceipt,'utf8'),f.oldBytes);
    assert.equal(current.attemptReceipt,join(attemptStage(f),'installation.json'));
    assert.equal(fs.readFileSync(current.previousPatch,'utf8'),f.patch);
    if(options.initializationFailure)assert.equal(json(current.attemptReceipt).status,'needs-initialization');
  });
}
test('R5: verified apply publishes only the actual completed binding after native boundaries succeed',t=>{
  const f=fixture(t);
  fs.mkdirSync(f.config.dataDir,{recursive:true});
  fs.writeFileSync(join(f.config.dataDir,'core.lock'),'999999999:fixture');
  f.checked([...f.args, '--apply']);
  const installed=json(f.receiptPath);
  assert.equal(installed.status,'installed');assert.equal(installed.packageInstalled,true);
  assert.equal(installed.enabled,true);assert.equal(installed.config.dataDir,f.config.dataDir);
  assert.equal(installed.actualPaths.coreDataDir,f.config.dataDir);
  const files = fs.readdirSync(f.receiptDir).sort(), stage = attemptStage(f);
  assert.equal(fs.readFileSync(join(stage,'previous-installation.json'),'utf8'),f.oldBytes);
  assert.deepEqual(installed,json(join(stage,'installation.json')));
  assert.deepEqual(files,['installation.json',basename(stage)]);
  const calls = f.calls(), packageCall = calls.find(call=>call.args);
  assert.ok(calls.includes('writer-check') && calls.indexOf('writer-check')<calls.indexOf(packageCall));
  assert.equal(packageCall.status, 'applying');
  assert.equal(packageCall.args[4], 'her-world@latest');
  assert.deepEqual(f.coreConfig(), installed.config);
});
test('R5: failed final receipt publication retains a non-completed marker, previous bytes and no partial temporary file',t=>{
  const f=fixture(t);
  failure(f, {publishFailure:true}, 'receipt-write-failed');
  const current=json(f.receiptPath);assert.equal(current.status,'applying');
  assert.equal(fs.readFileSync(current.previousReceipt,'utf8'),f.oldBytes);
  assert.equal(json(current.attemptReceipt).status,'installed');
  assert.deepEqual(fs.readdirSync(f.receiptDir).sort(), ['installation.json',basename(attemptStage(f))]);
});

test('R5: untouched offline install failure restores prior profile patch and receipt even with --no-backup', t => {
  const f = fixture(t), bundle = fs.readFileSync(f.bundlePatch), manifest = fs.readFileSync(f.manifest);
  assert.equal(failure(f, {cliFailure: 'untouched'}, 'package-install-failed', [...f.args, '--offline']).status, 'failed');
  assert.equal(fs.readFileSync(f.patchPath, 'utf8'), f.patch);
  assert.equal(fs.readFileSync(f.receiptPath, 'utf8'), f.oldBytes);
  assert.deepEqual(fs.readFileSync(f.bundlePatch), bundle);
  assert.deepEqual(fs.readFileSync(f.manifest), manifest);
  assert.equal(f.calls().find(call => call.args).offline, true);
  const stage = attemptStage(f);
  assert.equal(fs.readFileSync(join(stage, 'previous-cordis.patch.yml'), 'utf8'), f.patch);
  assert.equal(fs.readFileSync(join(stage, 'previous-installation.json'), 'utf8'), f.oldBytes);
});

test('R5: a patch write failure leaves the old binding and never invokes package installation', t => {
  const f = fixture(t);
  assert.equal(failure(f, {writeFailure: true}, 'patch-write-failed').status, 'failed');
  assert.equal(fs.readFileSync(f.patchPath, 'utf8'), f.patch);
  assert.equal(fs.readFileSync(f.receiptPath, 'utf8'), f.oldBytes);
  assert.equal(f.calls().some(call => call.args), false);
});

test('R5: a fresh offline cache miss removes the new patch and applying receipt, allowing a retry', t => {
  const f = fixture(t, {fresh: true});
  fs.rmSync(f.patchPath);
  assert.equal(failure(f, {cliFailure: 'untouched'}, 'package-install-failed', [...f.args, '--offline']).status, 'failed');
  assert.equal(fs.existsSync(f.patchPath), false);
  assert.equal(fs.existsSync(f.receiptPath), false);
  assert.equal(f.checked([...f.args, '--apply']).status, 'installed');
  assert.ok(f.coreConfig().companionId);
});

test('R5: offline npm setup keeps the configured Core path and backs it up in the Her World directory', async t => {
  const f = fixture(t), host = createCore(f.oldConfig);
  await host.close();
  const coreFile = join(f.oldConfig.dataDir, 'core.sqlite');
  const original = fs.readFileSync(coreFile);
  const result = f.checked(['--apply', '--offline']);
  assert.equal(result.status, 'installed');
  assert.deepEqual(f.calls().filter(call => call.args), [
    {args: ['plugin', '--profile', 'fixture', 'add', 'her-world@latest', '--ignore-scripts', '--offline'], offline: true, status: 'applying'},
  ]);
  assert.equal(result.actualPaths.coreDataDir, f.oldConfig.dataDir);
  assert.equal(f.coreConfig().dataDir, f.oldConfig.dataDir);
  assert.equal(json(f.receiptPath).actualPaths.coreDataDir, f.oldConfig.dataDir);
  assert.equal(dirname(result.backupDir), join(f.profileDir, 'backups/her-world'));
  assert.deepEqual(fs.readFileSync(join(result.backupDir, 'core-data', 'core.sqlite')), original);
  assert.deepEqual(fs.readFileSync(coreFile), original);
  assert.equal(fs.existsSync(join(f.home, 'her-world/core')), false);
});

// Invalid receipts must be rejected by the actual backup CLI before Core,
// process/lock probes or planning. No real CLI/app is launched by this fixture.
function backupAdmission(receipt,command='plan') {
  const source=fs.readFileSync(new URL('../../scripts/companion-backup.mjs',import.meta.url),'utf8');
  const start=source.indexOf('const args ='),stops=['const db =','const binding ='].map(marker=>source.indexOf(marker)).filter(index=>index>start);
  assert.ok(start>=0 && stops.length>0,'Backup admission fixture markers changed');
  const prefix=source.slice(start,Math.min(...stops));let probed=false;
  const context=vm.createContext({assert,process:{argv:['node','companion-backup.mjs',command,'--installation','/inert/receipt.json']},
    resolve:path=>path,readFileSync:()=>JSON.stringify(receipt),console:{log(){}},assertDshStopped(){probed=true;}});
  return {run:()=>new vm.Script(prefix).runInContext(context),probed:()=>probed};
}
for(const [status,packageInstalled] of [['prepared',false],['applying',false],['needs-initialization',true],[undefined,true],['installed',false]]) {
  test(`R5: backup rejects non-completed receipt ${status}/${packageInstalled} before probing any live state`,()=>{
    const f=backupAdmission({status,packageInstalled,config:{dataDir:'/inert/core'},profileDir:'/inert/profile'},'create');
    assert.throws(f.run,/completed installed receipt/);assert.equal(f.probed(),false);
  });
}
test('R5: installed but disabled remains eligible for offline backup planning',()=>{
  const f=backupAdmission({status:'installed',packageInstalled:true,enabled:false,config:{dataDir:'/inert/core'},profileDir:'/inert/profile'});
  f.run();assert.equal(f.probed(),false);
});
