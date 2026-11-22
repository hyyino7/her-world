import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileHashes, inspectRepoBinding } from '../../scripts/lib/repo-storage.mjs';
import { hash } from '../../scripts/migrate/io.mjs';
import { migrationStatus, runMigration, steps } from '../../scripts/migrate/runner.mjs';
import { variants, fixture, mockDsh, read, cli, refusedCli } from './helpers.mjs';
import { economyPaths, offlineFixture } from './offline-helpers.mjs';
import { bootstrapSteps, homeSteps, selectBootstrapCli } from './migration-child.mjs';

const economySteps = steps.slice(0,3);
const child = async (f, backup, point, mode = '', suite = '') => {
  const processChild = spawn(process.execPath,
    ['--import',resolve('tests/migrate/dsh-probe.mjs'),resolve('tests/migrate/migration-child.mjs'),f.installation,backup,point,mode,suite],{stdio:'pipe'});
  let stdout = '', stderr = '';
  processChild.stdout.on('data', bytes => {stdout += bytes;});
  processChild.stderr.on('data', bytes => {stderr += bytes;});
  const [code, signal] = await once(processChild,'close');
  return {code, signal, stdout, stderr};
};
const rows = log => readFileSync(log,'utf8').trimEnd().split('\n').map(JSON.parse);
const header = log => rows(log).findLast(row => row.event === 'migration');

for (const variant of variants) for (const point of ['before','after','partial','complete']) {
  test(`${variant}: SIGKILL ${point} resumes original backup, applying the target once`, {timeout:60000}, async t => {
    const f = await fixture(t,variant), backup = join(f.out,'backup'), log = join(f.data,'migrations.jsonl');
    const interrupted = await child(f,backup,point);
    assert.equal(interrupted.signal,'SIGKILL',interrupted.stderr);
    const original = readFileSync(join(backup,'manifest.json'));
    assert.equal(existsSync(join(f.data,'migration.lock')),true);
    const resumed = await child(f,backup,point,'resume');
    assert.equal(resumed.code,0,resumed.stderr);
    assert.equal(read(join(f.data,'synthetic-step.json')).applications,1);
    assert.equal(existsSync(join(f.data,'migration.lock')),false);
    assert.deepEqual(readFileSync(join(backup,'manifest.json')),original,'No second backup is created on resume');
    assert.ok(rows(log).some(row => row.event === 'lock-takeover'));
    if (point === 'partial') assert.ok(rows(log).some(row => row.event === 'journal-repaired'));
  });
}

for (const point of ['backup','after','manifest','complete']) {
  test(`second migration: SIGKILL at ${point} preserves the correct boundary`, {timeout:60000}, async t => {
    mockDsh(t);
    const f = await offlineFixture(t, false), oldBackup = join(f.out,'old'), backup = join(f.out,'new');
    const log = join(f.data,'migrations.jsonl'), manifest = join(f.data,'storage-manifest.json'), target = join(f.data,'synthetic-step.json');
    await runMigration({installation:f.installation, backup:oldBackup},bootstrapSteps);
    const [old, ...events] = rows(log);
    const legacy = {event:old.event,id:old.id,backup:old.backup,manifestHash:old.backupHash};
    writeFileSync(log, [legacy,...events].map(JSON.stringify).join('\n') + '\n');
    const oldLog = readFileSync(log,'utf8'), oldManifest = readFileSync(manifest,'utf8');

    const interrupted = await child(f,backup,point);
    assert.equal(interrupted.signal,'SIGKILL',interrupted.stderr);
    const backupManifest = readFileSync(join(backup,'manifest.json'));
    assert.equal(existsSync(join(f.data,'migration.lock')),true);
    assert.equal(existsSync(target),point !== 'backup');
    if (point === 'backup') {
      assert.equal(readFileSync(log,'utf8'),oldLog);
      assert.equal(readFileSync(manifest,'utf8'),oldManifest);
      const status = await child(f,backup,'','status');
      assert.equal(status.code,0,status.stderr);
      const output = JSON.parse(status.stdout);
      assert.deepEqual(output.steps,[{id:'0001-storage-manifest',state:'complete'}]);
      assert.equal(output.segment,'settled');
      const retry = await child(f,join(f.out,'retry'),'');
      assert.equal(retry.code,0,retry.stderr);
      assert.equal(header(log).backup,join(f.out,'retry'));
    } else {
      assert.equal(header(log).backupHash,hash(backupManifest));
      assert.equal(header(log).binding.storageId,f.storageId);
      assert.equal(header(log).binding.repoHash,hash(f.repo));
      assert.deepEqual(header(log).steps[1].from,JSON.parse(oldManifest).modules);
      assert.equal(header(log).steps[1].to.core,2);
      assert.equal(read(manifest).modules.core,point === 'after' ? 1 : 2);
      if (point === 'complete') {
        rmSync(target);
        const status = await child(f,backup,'','status');
        assert.equal(status.code,0,status.stderr);
        assert.equal(JSON.parse(status.stdout).segment,'settled');
        assert.equal(JSON.parse(status.stdout).steps[1].state,'inconsistent');
        const refused = await child(f,join(f.out,'refused'),'');
        assert.equal(JSON.parse(refused.stderr).code,'migration-inconsistent');
        assert.equal(existsSync(join(f.out,'refused')),false);
        return;
      }
      assert.equal(rows(log).at(-1).event,'start');
      if (point === 'manifest') {
        const status = await child(f,backup,'','status');
        assert.equal(status.code,0,status.stderr);
        const output = JSON.parse(status.stdout);
        assert.deepEqual(output.steps.map(step => step.state),['complete','complete']);
        assert.equal(output.segment,'unfinished');
        const refused = await child(f,join(f.out,'refused'),'');
        assert.equal(JSON.parse(refused.stderr).code,'journal-exists');
      }
      const mismatch = await child(f,backup,'','mismatch');
      assert.equal(JSON.parse(mismatch.stderr).code,'journal-step-mismatch');
      const resumed = await child(f,backup,'','resume');
      assert.equal(resumed.code,0,resumed.stderr);
      assert.equal(rows(log).at(-1).event,'skip');
    }
    assert.equal(read(manifest).modules.core,2);
    assert.equal(read(target).applications,1);
    assert.ok(readFileSync(log,'utf8').startsWith(oldLog));
    assert.equal(rows(log).filter(row => row.event === 'migration').length,2);
    assert.ok(rows(log).some(row => row.event === 'lock-takeover'));
    assert.deepEqual(readFileSync(join(backup,'manifest.json')),backupManifest);
    assert.equal(existsSync(join(f.data,'migration.lock')),false);
    const status = await child(f,backup,'','status');
    assert.equal(status.code,0,status.stderr);
    assert.equal(JSON.parse(status.stdout).segment,'settled');
  });
}

test('second migration cannot resume when a settled segment has lost its target', {timeout:60000}, async t => {
  mockDsh(t);
  const f = await offlineFixture(t, false), backup = join(f.out,'new');
  await runMigration({installation:f.installation,backup:join(f.out,'old')},bootstrapSteps);
  const interrupted = await child(f,backup,'header');
  assert.equal(interrupted.signal,'SIGKILL',interrupted.stderr);
  assert.equal(rows(join(f.data,'migrations.jsonl')).at(-1).event,'migration');
  const manifest = join(f.data,'storage-manifest.json');
  rmSync(manifest);
  const before = fileHashes(f.managed);

  const status = await child(f,backup,'','status');
  assert.equal(status.code,0,status.stderr);
  const resumed = await child(f,backup,'','resume');
  assert.equal(resumed.code,1,resumed.stderr);
  assert.equal(JSON.parse(resumed.stderr).code,'migration-inconsistent');
  const output = JSON.parse(status.stdout);
  assert.equal(output.segment,'unfinished');
  assert.equal(output.steps[0].state,'inconsistent');
  assert.deepEqual(fileHashes(f.managed),before);
});

test('resume keeps a completed step recorded when its target is lost mid-segment', async t => {
  mockDsh(t);
  const f = await offlineFixture(t, false), backup = join(f.out, 'backup');
  writeFileSync(join(f.data, 'life/life.json'), '{"version":1,"homeSessionId":"fixture-session"}\n');
  const interrupted = await child(f, backup, 'manifest', '', 'home');
  assert.equal(interrupted.signal, 'SIGKILL', interrupted.stderr);
  const manifest = join(f.data, 'storage-manifest.json'), log = join(f.data, 'migrations.jsonl');
  rmSync(manifest);
  const events = () => rows(log).filter(row => row.step === '0001-storage-manifest');
  const before = events();
  assert.equal(before.at(-1).event, 'done');
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(runMigration({installation:f.installation, resume:true}, homeSteps), {code:'migration-inconsistent'});
    assert.equal(migrationStatus(f.installation, homeSteps).steps[0].state, 'inconsistent');
    assert.deepEqual(events(), before);
    assert.equal(existsSync(manifest), false);
  }
});

test('an interrupted 0002 still requires the original mirror after the manifest advances', async t => {
  mockDsh(t);
  const f = await offlineFixture(t, false), mirror = join(f.data, 'life/life.json');
  writeFileSync(mirror, '{"version":1,"homeSessionId":"fixture-session"}\n');
  const interrupted = await child(f, join(f.out, 'backup'), 'manifest', '', 'home');
  assert.equal(interrupted.signal, 'SIGKILL', interrupted.stderr);
  writeFileSync(mirror, '{"version":1,"homeSessionId":"stale-session"}\n');
  assert.deepEqual(migrationStatus(f.installation, homeSteps).steps.at(-1), {id:'0002-home-identity', state:'start'});
  await assert.rejects(runMigration({installation:f.installation, resume:true}, homeSteps), {code:'home-identity-conflict'});
});

async function copyAndBind(f, name) {
  const repo = join(f.out,name), data = join(repo,'.chatpet/data');
  const config = {...f.config,dataDir:join(data,'core')};
  const target = {...f.target,id:name,path:repo};
  cpSync(f.repo,repo,{recursive:true});
  const db = new DatabaseSync(join(config.dataDir,'core.sqlite'));
  try {
    const record = db.prepare("SELECT value FROM records WHERE id='current' AND kind=?");
    const save = db.prepare("UPDATE records SET value=? WHERE id='current' AND kind=?");
    db.exec('BEGIN IMMEDIATE');
    for (const [kind,key] of [['preferences','workspace'], ['workspace-binding','target']]) {
      const prior = JSON.parse(record.get(kind).value);
      save.run(JSON.stringify({...prior,revision:prior.revision+1,[key]:target}),kind);
    }
    db.exec('COMMIT');
  } finally { db.close(); }
  const copied = inspectRepoBinding(config);
  assert.equal(copied.state, 'ready');
  assert.equal(copied.storageId, f.storageId);
  const registryFile = join(f.home,'storages/workspace.json'), registry = read(registryFile);
  registry.global.workspaceIds.push(target.id);
  registry.tables.workspaces[target.id] = {path:repo,title:target.title,sessionIds:[]};
  writeFileSync(registryFile,JSON.stringify(registry));
  const installation = join(f.out,name + '.json');
  writeFileSync(installation,JSON.stringify({...read(f.installation),config}));
  return {...f,repo,data,managed:join(repo,'.chatpet'),target,config,installation};
}

test('a relocated Repo retains settled history but cannot resume an unfinished segment at the new path', {timeout:60000}, async t => {
  selectBootstrapCli(t);
  mockDsh(t);
  const f = await offlineFixture(t, false), oldBackup = join(f.out,'old');
  await runMigration({installation:f.installation,backup:oldBackup},bootstrapSteps);
  const moved = await copyAndBind(f,'new-workspace');
  const log = join(moved.data,'migrations.jsonl'), original = readFileSync(log,'utf8');
  for (const command of ['status','plan']) {
    const result = cli(moved,[command,'--installation',moved.installation]);
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).steps,command === 'plan' ? [] : [{id:'0001-storage-manifest',state:'complete'}]);
  }
  rmSync(oldBackup,{recursive:true});
  await runMigration({installation:moved.installation,resume:true},bootstrapSteps);
  assert.equal(readFileSync(log,'utf8'),original);

  const backup = join(f.out,'new');
  const interrupted = await child(moved,backup,'manifest');
  assert.equal(interrupted.signal,'SIGKILL',interrupted.stderr);
  assert.equal(header(log).binding.repoHash,hash(moved.repo));
  const copied = await copyAndBind(moved,'copied-in-progress');
  const status = await child(copied,backup,'','status');
  assert.equal(status.code,0,status.stderr);
  assert.equal(JSON.parse(status.stdout).segment,'unfinished');
  const refused = await child(copied,backup,'','resume');
  assert.equal(refused.code,1,refused.stderr);
  assert.equal(JSON.parse(refused.stderr).code,'binding-changed');
  const resumed = await child(moved,backup,'','resume');
  assert.equal(resumed.code,0,resumed.stderr);
  assert.equal(read(join(moved.data,'synthetic-step.json')).applications,1);
  assert.ok(readFileSync(log,'utf8').startsWith(original));

  const foreign = rows(log);
  foreign[0].binding.storageId = 'foreign-storage';
  writeFileSync(log,foreign.map(JSON.stringify).join('\n')+'\n');
  refusedCli(moved,['status','--installation',moved.installation],'binding-changed');
});

for (const point of ['backup','after','manifest','complete']) test(`0002 survives SIGKILL at ${point}`, {timeout:60000}, async t => {
  mockDsh(t);
  const f = await offlineFixture(t, false), backup = join(f.out, 'home-backup');
  const log = join(f.data, 'migrations.jsonl'), manifest = join(f.data, 'storage-manifest.json');
  const life = join(f.data, 'life/life.json'), dbFile = join(f.config.dataDir, 'core.sqlite');
  writeFileSync(life, '{"version":1,"homeSessionId":"fixture-session"}\n');
  const lifeHash = hash(readFileSync(life));
  await runMigration({installation:f.installation, backup:join(f.out, 'old')}, bootstrapSteps);
  const originalLog = readFileSync(log, 'utf8');
  const interrupted = await child(f, backup, point, '', 'home');
  assert.equal(interrupted.signal, 'SIGKILL', interrupted.stderr);
  const backupHash = hash(readFileSync(join(backup, 'manifest.json')));
  assert.equal(existsSync(join(f.data, 'migration.lock')), true);
  assert.equal(hash(readFileSync(life)), lifeHash);
  const status = migrationStatus(f.installation, homeSteps);
  const during = readFileSync(log, 'utf8');
  if (point === 'backup') {
    assert.equal(during, originalLog);
    assert.equal(read(manifest).modules.core, 1);
    assert.equal(status.segment, 'settled');
    const next = join(f.out, 'new-backup');
    await runMigration({installation:f.installation, backup:next}, homeSteps);
    assert.equal(header(log).backup, next);
  } else {
    assert.equal(header(log).backupHash, backupHash);
    assert.equal(read(manifest).modules.core, point === 'after' ? 1 : 2);
    assert.equal(status.segment, point === 'complete' ? 'settled' : 'unfinished');
    const resumed = await child(f, backup, '', 'resume', 'home');
    assert.equal(resumed.code, 0, resumed.stderr);
    if (point === 'complete') assert.ok(readFileSync(log, 'utf8').startsWith(during));
    else assert.equal(rows(log).at(-1).event, 'skip');
    assert.equal(rows(log).filter(row => row.event === 'migration').length, 2);
  }
  assert.equal(hash(readFileSync(join(backup, 'manifest.json'))), backupHash);
  assert.equal(hash(readFileSync(life)), lifeHash);
  assert.equal(existsSync(join(f.data, 'migration.lock')), false);
  assert.deepEqual(migrationStatus(f.installation, homeSteps).steps.at(-1), {id:'0002-home-identity', state:'complete'});
  const db = new DatabaseSync(dbFile);
  try {
    assert.equal(db.prepare("SELECT count(*) AS n FROM records WHERE kind='companion-home'").get().n, 1);
    if (point === 'complete') db.prepare("DELETE FROM records WHERE kind='companion-home' AND id=?").run(f.storageId);
  } finally { db.close(); }
  if (point === 'complete') {
    assert.deepEqual(migrationStatus(f.installation, homeSteps).steps.at(-1), {id:'0002-home-identity', state:'inconsistent'});
    await assert.rejects(runMigration({installation:f.installation, resume:true}, homeSteps), {code:'migration-inconsistent'});
    await assert.rejects(runMigration({installation:f.installation, backup:join(f.out, 'refused')}, homeSteps), {code:'migration-inconsistent'});
    assert.equal(existsSync(join(f.out, 'refused')), false);
  }
});

for (const point of ['backup','wallet','proof','after','manifest','complete']) test(`0003 survives SIGKILL at ${point}`, {timeout:60000}, async t => {
  mockDsh(t);
  const f = await offlineFixture(t, false, {withLegacyEconomy:true}), backup = join(f.out, 'backup-0003');
  const {core,database,adoption} = economyPaths(f), log = join(f.data,'migrations.jsonl'), manifest = join(f.data,'storage-manifest.json');
  const state = () => {
    using source = new DatabaseSync(core,{readOnly:true});
    using wallet = new DatabaseSync(database,{readOnly:true});
    return {source:source.prepare("SELECT count(*) AS n FROM meta WHERE key GLOB 'economy.initialized:*'").get().n,
      marker:wallet.prepare("SELECT value FROM meta WHERE key='economy.initialized'").get()?.value,
      ledger:wallet.prepare('SELECT * FROM ledger ORDER BY sequence').all()};
  };
  const identity = {companionId:f.config.companionId,storageId:f.storageId}, before = state();
  assert.equal(before.source,1);
  await runMigration({installation:f.installation,backup:join(f.out,'backup-0002')}, homeSteps);
  const previous = readFileSync(log,'utf8');
  const interrupted = await child(f,backup,point,'','economy');
  assert.equal(interrupted.signal,'SIGKILL',interrupted.stderr);
  assert.equal(existsSync(join(f.data,'migration.lock')),true);
  const backupManifest = join(backup,'manifest.json'), backupHash = hash(readFileSync(backupManifest));
  const halfway = state();
  assert.deepEqual(halfway.ledger,before.ledger);
  assert.equal(halfway.source,['backup','wallet','proof'].includes(point) ? 1 : 0);
  assert.deepEqual(halfway.marker && JSON.parse(halfway.marker),point === 'backup' ? undefined : identity);
  assert.equal(existsSync(adoption),!['backup','wallet'].includes(point));
  const version = ['manifest','complete'].includes(point) ? 3 : 2;
  assert.equal(read(manifest).modules.core,version);
  assert.equal(read(manifest).modules.living,version);
  if (point === 'backup') {
    assert.equal(readFileSync(log,'utf8'), previous);
    await runMigration({installation:f.installation,backup:join(f.out,'backup-retry')},economySteps);
  } else {
    assert.equal(header(log).economyAdopted,true);
    assert.equal(header(log).backupHash,backupHash);
    const during = readFileSync(log,'utf8');
    const resumed = await child(f,backup,'','resume','economy');
    assert.equal(resumed.code,0,resumed.stderr);
    assert.ok(readFileSync(log,'utf8').startsWith(during));
  }
  assert.equal(hash(readFileSync(backupManifest)),backupHash);
  assert.ok(readFileSync(log,'utf8').startsWith(previous));
  assert.equal(existsSync(join(f.data,'migration.lock')),false);
  assert.deepEqual(state(),{source:0,marker:JSON.stringify(identity),ledger:before.ledger});
  assert.deepEqual(read(adoption),identity);
  assert.deepEqual(migrationStatus(f.installation).steps.at(-1),{id:'0003-economy-marker',state:'complete'});
  if (point === 'complete') {
    const settled = readFileSync(log);
    rmSync(dirname(database),{recursive:true}); rmSync(adoption);
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.deepEqual(migrationStatus(f.installation).steps.at(-1),{id:'0003-economy-marker',state:'inconsistent'});
      await assert.rejects(runMigration({installation:f.installation,resume:true},economySteps),{code:'migration-inconsistent'});
      await assert.rejects(runMigration({installation:f.installation,backup:join(f.out,'refused')},economySteps),{code:'migration-inconsistent'});
      assert.deepEqual(readFileSync(log),settled);
      assert.equal(existsSync(database) || existsSync(adoption) || existsSync(join(f.out,'refused')),false);
    }
  }
});

test('offline commands refuse a migrated Repo that lost its declared wallet and adoption evidence', async t => {
  mockDsh(t);
  const f = await offlineFixture(t, false, {withLegacyEconomy:true});
  const manifestFile = join(f.managed, 'manifest.json'), manifest = read(manifestFile);
  manifest.files.push('data/economy/', 'data/economy/economy.sqlite', 'data/economy/storage.json');
  writeFileSync(manifestFile, JSON.stringify(manifest));
  await runMigration({installation:f.installation, backup:join(f.out, 'backup')},economySteps);
  assert.deepEqual(migrationStatus(f.installation).steps.at(-1), {id:'0003-economy-marker', state:'complete'});

  const {database, adoption} = economyPaths(f), log = join(f.data, 'migrations.jsonl');
  const settled = readFileSync(log), refusedBackup = join(f.out, 'refused');
  rmSync(dirname(database), {recursive:true});
  rmSync(adoption);
  for (let attempt = 0; attempt < 2; attempt++) {
    const args = ['--installation', f.installation];
    refusedCli(f, ['status', ...args], 'binding-changed');
    refusedCli(f, ['run', ...args, '--resume'], 'binding-changed');
    refusedCli(f, ['run', ...args, '--backup', refusedBackup], 'binding-changed');
    assert.deepEqual(readFileSync(log), settled);
    assert.equal(existsSync(dirname(database)) || existsSync(adoption) || existsSync(refusedBackup), false);
  }
});
