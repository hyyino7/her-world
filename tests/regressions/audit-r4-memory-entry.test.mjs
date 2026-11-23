import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareMemoryServiceEntry} from '../../scripts/lib/core-config.mjs';
import {profileFixture} from '../behavior-list/setup-config.test.mjs';

const bundleShim = 'src/memory/main.py';
const installer = fileURLToPath(new URL('../../scripts/install-dsh.mjs', import.meta.url));
const testPython = fileURLToPath(new URL('../../.venv/bin/python', import.meta.url));
const entryOption = entry => ['--memory-service-entry', entry];

function fixture(t) {
  const profile = profileFixture(t);
  const config = {
    dataDir: join(profile.home, 'core'),
    companionId: 'fixture-fish',
    scopeId: 'fixture-scope',
    ownerActorId: 'owner',
    displayName: 'Fixture',
    character: '',
  };
  const memory = {python: join(profile.home, 'source-python'), dataDir: join(profile.home, 'retained-bank')};
  const current = join(profile.home, 'current-bundle');
  const installed = join(profile.profileDir, 'node_modules/her-world');
  const managedRoots = [current, installed];
  const deviceRoot = join(profile.profileDir, 'chatpet-runtime');
  return {...profile, config, memory, current, installed, managedRoots, deviceRoot};
}

function writeShim(root) {
  mkdirSync(join(root, 'src/memory'), {recursive: true});
  const entry = join(root, bundleShim);
  writeFileSync(entry, '# synthetic package shim\n');
  return entry;
}

function prepare(f, args, mode) {
  const result = f.checked(args, mode);
  assert.equal(result.status, 'prepared');
  return JSON.parse(readFileSync(result.attemptReceipt, 'utf8'));
}

function assertRejectedBeforeRuntime(f, args, reason) {
  // An actual probe would leave a marker even if setup later reports another error.
  const probe = join(f.home, 'python-probed');
  writeFileSync(f.memory.python, '#!/bin/sh\ntouch "$(dirname "$0")/python-probed"\nexit 1\n', {mode: 0o700});
  const patch = readFileSync(f.patchPath);
  const manifest = readFileSync(f.manifest);
  const result = f.command(args);
  assert.equal(result.status, 1, result.error?.message ?? result.stderr);
  assert.deepEqual(JSON.parse(result.stderr), {
    status: 'failed', reason, ...(reason === 'invalid-arguments' ? {} : {profileDir: f.profileDir}),
  });
  assert.equal(result.stdout, '');
  assert.equal(existsSync(probe), false);
  assert.equal(existsSync(f.deviceRoot), false);
  assert.equal(existsSync(f.receiptDir), false);
  assert.deepEqual(readFileSync(f.patchPath), patch);
  assert.deepEqual(readFileSync(f.manifest), manifest);
  assert.deepEqual(f.calls(), []);
}

test('R4-2: a default Memory entry stays package-relative while Bank and identity remain the same', t => {
  const f = fixture(t);
  f.installFixture({...f.config, memory: {...f.memory, python: testPython}});
  // Start the CLI with the synthetic DSH modules and let it plan the real test interpreter.
  const electronMarker = 'data:text/javascript,Object.defineProperty(process.versions,"electron",{value:"fixture"})';
  const result = spawnSync(process.execPath, ['--import', electronMarker, installer,
    '--dsh-app', join(f.home, 'Synthetic DSH.app'), '--dsh-home', f.home, '--profile', 'fixture',
  ], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  const {status, attemptReceipt} = JSON.parse(result.stdout);
  assert.equal(status, 'prepared');
  const attempt = JSON.parse(readFileSync(attemptReceipt, 'utf8'));
  assert.deepEqual(attempt.config, {
    ...f.config,
    memory: {...f.memory, python: join(f.deviceRoot, 'venv/bin/python'), runtimeRoot: f.deviceRoot},
  });
  assert.equal(attempt.deviceRuntime.status, 'planned');
  assert.equal(attempt.deviceRuntime.plan.source.python, testPython);
  assert.equal(attempt.deviceRuntime.plan.python, attempt.config.memory.python);
  assert.equal(existsSync(f.deviceRoot), false);
});

test('R4-2: the current bundle and the installed profile bundle both use the bundled entry', t => {
  const f = fixture(t);
  for (const root of f.managedRoots) {
    const inherited = {...f.memory, serviceEntry: writeShim(root)};
    const selected = prepareMemoryServiceEntry(inherited, {managedRoots: f.managedRoots});
    assert.deepEqual(selected, f.memory);
    assert.equal(inherited.serviceEntry, join(root, bundleShim));
  }
});

test('R4-2: the known installed bundle path still selects the bundled entry when its shim is missing', t => {
  const f = fixture(t);
  const entry = writeShim(f.installed);
  rmSync(entry);
  assert.deepEqual(
    prepareMemoryServiceEntry({...f.memory, serviceEntry: entry}, {managedRoots: f.managedRoots}),
    f.memory,
  );
});

test('R4-2: the real package-store path of the installed profile bundle is recognized', t => {
  const f = fixture(t);
  const storeRoot = join(f.home, 'package-store/her-world');
  const entry = writeShim(storeRoot);
  mkdirSync(join(f.profileDir, 'node_modules'));
  symlinkSync(storeRoot, f.installed, 'dir');
  assert.deepEqual(
    prepareMemoryServiceEntry({...f.memory, serviceEntry: entry}, {managedRoots: f.managedRoots}),
    f.memory,
  );
});

test('R4-2: unproven inherited entries fail before probing an interpreter or mutating the profile', t => {
  const f = fixture(t);
  const custom = join(f.home, 'custom.py');
  writeFileSync(custom, '# deliberate custom entry\n');
  const inherited = {...f.memory, serviceEntry: custom};
  assert.throws(
    () => prepareMemoryServiceEntry(inherited, {managedRoots: f.managedRoots}),
    {reason: 'memory-service-entry-unverified', message: /--memory-service-entry/},
  );
  assert.deepEqual(inherited, {...f.memory, serviceEntry: custom});
  f.installFixture({...f.config, memory: inherited});
  assertRejectedBeforeRuntime(f, [], 'memory-service-entry-unverified');
});

test('R4-2: setup honors an explicit bundled or custom choice over an inherited entry', t => {
  const f = fixture(t);
  const custom = join(f.home, 'custom.py');
  writeFileSync(custom, '# deliberate custom entry\n');
  const plannedMemory = {...f.memory, runtimeRoot: f.deviceRoot};
  f.installFixture({...f.config, memory: {...f.memory, serviceEntry: custom}});
  assert.deepEqual(prepare(f, entryOption('bundled'), {runtime: true}).config.memory, plannedMemory);
  assert.deepEqual(
    prepare(f, entryOption(custom), {runtime: true}).config.memory,
    {...plannedMemory, serviceEntry: custom},
  );

  f.installFixture({...f.config, memory: {...f.memory, serviceEntry: writeShim(f.installed)}});
  assert.deepEqual(
    prepare(f, entryOption(custom), {runtime: true}).config.memory,
    {...plannedMemory, serviceEntry: custom},
  );
});

test('R4-2: setup requires an explicit choice for a custom program inside the package and repair preserves it', t => {
  const f = fixture(t);
  const custom = join(f.installed, 'custom.py');
  const config = {...f.config, memory: {...f.memory, serviceEntry: custom}};
  f.installFixture(config);
  writeFileSync(custom, '# intentional custom program\n');
  assertRejectedBeforeRuntime(f, [], 'memory-service-entry-unverified');
  assert.deepEqual(
    prepare(f, entryOption(custom), {runtime: true}).config.memory,
    {...config.memory, runtimeRoot: f.deviceRoot},
  );

  assert.equal(f.checked(['repair-core-config', '--apply']).status, 'repaired');
  assert.deepEqual(f.coreConfig(), config);
  assert.deepEqual(JSON.parse(readFileSync(f.receiptPath, 'utf8')).config, config);
});

test('R4-2: explicit missing, relative or linked custom entries fail before runtime preparation', t => {
  const f = fixture(t);
  const linked = join(f.home, 'linked.py');
  symlinkSync(writeShim(f.current), linked);
  f.installFixture({...f.config, memory: f.memory});
  for (const choice of [join(f.home, 'missing.py'), 'relative.py', linked]) {
    assertRejectedBeforeRuntime(f, entryOption(choice), 'memory-service-entry-choice-invalid');
  }
});

test('R4-2: no-Memory configuration never requires an entry selection or interpreter', t => {
  const f = fixture(t);
  f.installFixture(f.config);
  for (const args of [[], entryOption('bundled')]) {
    const attempt = prepare(f, args);
    assert.deepEqual(attempt.config, f.config);
    assert.equal(Object.hasOwn(attempt, 'deviceRuntime'), false);
    assert.equal(existsSync(f.deviceRoot), false);
  }
});

test('R4-2: a supplied entry flag without its value fails before runtime preparation', t => {
  const f = fixture(t);
  f.installFixture({...f.config, memory: f.memory});
  assertRejectedBeforeRuntime(f, ['--memory-service-entry'], 'invalid-arguments');
});
