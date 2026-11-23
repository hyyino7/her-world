#!/usr/bin/env node
// Install the registry bundle through DSH and bind Core in its profile.
import { createRequire, registerHooks } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, cpSync, chmodSync, existsSync, realpathSync, lstatSync, readdirSync, renameSync, rmSync, rmdirSync } from 'node:fs';
import { join, resolve, dirname, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import assert from 'node:assert/strict';
import { assertStopped, prepareRepoStorage, relocateRepoStorage, inspectRepoBinding, boundMemoryDirectory, fileHashes } from './lib/repo-storage.mjs';
import { loadPortableRepo } from './lib/portable-repo.mjs';
import { prepareDeviceRuntime as planDeviceRuntime, applyDeviceRuntime } from './lib/device-runtime.mjs';
import {
  prepareCoreConfiguration, prepareMemoryServiceEntry, SetupError, checkedSetup, requireSetup,
  coreEntry, coreConfiguration, sameCoreBinding, readPatchList, coreDeclaration, profileCoreOverride,
  resolveCoreEntry, patchWithCoreOverride,
} from './lib/core-config.mjs';

const options = process.argv.slice(2);
const migrating = options[0] === 'migrate-core-config';
const shared = ['dsh-app', 'dsh-home', 'profile', 'output-dir'];
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i;
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prepareDeviceRuntime = options => checkedSetup('device-runtime-invalid', () => planDeviceRuntime(options));
let app, home, profile, profileDir, configPath, dir, installedRoot, installedBundle, installedReceipt;
let require, bundleYaml, yamlDocument, entryListSchema, applyEntryPatches, values;
const arg = (key, fallback) => values[key.slice(2)] ?? fallback;

function usage() {
  console.log(`dafeiyu-setup [--apply] [--version <version>] [--offline] [--no-backup]
             [--resume-repo <path>] [--storage-repo <path>] [--data-dir <path>]
             [--memory-python <path>] [--memory-data-dir <path>] [--memory-service-entry <bundled|path>]
             [--device-runtime <path>]
dafeiyu-setup migrate-core-config [--apply]
Both commands accept --dsh-app, --dsh-home, --profile and --output-dir.`);
}

async function main() {
  if (options.includes('--help') || options.includes('-h')) return usage();
  const strings = migrating ? shared : [...shared, 'version', 'data-dir', 'resume-repo', 'storage-repo',
    'memory-python', 'memory-data-dir', 'memory-service-entry', 'device-runtime'];
  const booleans = migrating ? ['apply'] : ['apply', 'offline', 'no-backup'];
  ({values} = checkedSetup('invalid-arguments', () => parseArgs({args: options.slice(migrating ? 1 : 0), options: Object.fromEntries([
    ...strings.map(name => [name, {type: 'string'}]), ...booleans.map(name => [name, {type: 'boolean'}]),
  ])})));
  requireSetup(values.version === undefined || versionPattern.test(values.version), 'invalid-version');
  profile = arg('--profile', 'desktop');
  requireSetup(/^[\w-]+$/.test(profile) && profile !== 'node_modules', 'invalid-profile');
  app = resolve(arg('--dsh-app', '/Applications/DeepSeek Harness.app'));
  if (!process.versions.electron) {
    const result = spawnSync(join(app, 'Contents/MacOS/DeepSeek Harness'), [fileURLToPath(import.meta.url), ...options], {
      env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, stdio: 'inherit',
    });
    requireSetup(!result.error, 'dsh-runtime-unavailable');
    process.exitCode = result.status ?? 1;
    return;
  }
  require = createRequire(join(app, 'Contents/Resources/app.asar/dsh/package.json'));
  const {resolveDshHome} = await import(require.resolve('@deepseek-ai/dsh-home-paths'));
  home = resolveDshHome(arg('--dsh-home'));
  profileDir = join(home, 'profiles', profile);
  configPath = join(profileDir, 'cordis.patch.yml');
  dir = resolve(arg('--output-dir', join(profileDir, 'chatpet-installation')));
  installedRoot = join(profileDir, 'node_modules/her-world');
  installedBundle = join(installedRoot, 'cordis.patch.yml');
  installedReceipt = join(dir, 'installation.json');
  bundleYaml = require('js-yaml');
  yamlDocument = require('yaml');
  ({entryListSchema, applyEntryPatches} = await import(require.resolve('@deepseek-ai/cordis-plugin-include')));
  if (migrating || values.apply) assertDshClosed();
  const lock = join(profileDir, '.her-world-setup.lock');
  if (values.apply) {
    requireSetup(profile !== 'desktop' || existsSync(join(profileDir, 'package.json')), 'profile-uninitialized');
    if (!migrating) mkdirSync(profileDir, {recursive: true, mode: 0o700});
    checkedSetup('profile-busy', () => mkdirSync(lock, {mode: 0o700}));
  } else requireSetup(!existsSync(lock), 'profile-busy');
  try {
    const state = readProfile();
    if (migrating) await migrateCoreConfig(state);
    else await setup(state);
  } finally {
    if (values.apply) rmdirSync(lock);
  }
}

function assertDshClosed() {
  const running = spawnSync('/usr/bin/pgrep', ['-x', 'DeepSeek Harness'], {encoding: 'utf8'});
  requireSetup(!running.error && (running.status === 0 || running.status === 1), 'dsh-process-check-failed');
  requireSetup(!running.stdout.trim().split(/\s+/).filter(Boolean).map(Number).some(pid => pid !== process.pid), 'dsh-running');
}

function readFileState(path) {
  const stat = lstatSync(path, {throwIfNoEntry: false});
  if (!stat) return undefined;
  requireSetup(stat.isFile() && stat.nlink === 1, 'file-not-regular');
  return {bytes: readFileSync(path), mode: stat.mode & 0o777};
}

function readJson(file, reason) {
  return checkedSetup(reason, () => {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    requireSetup(doc && typeof doc === 'object' && !Array.isArray(doc), reason);
    return doc;
  });
}

const patches = text => readPatchList(text, bundleYaml, entryListSchema);

function readBundle(root, name) {
  const manifest = readJson(join(root, 'package.json'), 'bundle-invalid');
  const paths = [manifest.dsh?.bundle?.patch].flat();
  requireSetup((name !== 'her-world' || manifest.name === name) && paths.length && paths.every(path => typeof path === 'string' && path
    && !isAbsolute(path) && !path.split(/[\\/]/).includes('..')), 'bundle-invalid');
  return {version: manifest.version, patches: paths.flatMap(path => patches(readFileSync(join(root, path), 'utf8')))};
}

function readProfile() {
  const manifestPath = join(profileDir, 'package.json');
  const manifest = readFileState(manifestPath) ? readJson(manifestPath, 'profile-invalid') : {};
  const activation = manifest.dsh?.profile?.bundles ?? [];
  requireSetup(Array.isArray(activation) && activation.every(name => typeof name === 'string' && /^(?:@[\w.-]+\/)?[\w-][\w.-]*$/.test(name)), 'profile-invalid');
  requireSetup(new Set(activation).size === activation.length, 'bundle-duplicate');
  const patch = readFileState(configPath), homePatch = readFileState(join(home, 'cordis.patch.yml'));
  const profilePatches = patches(patch?.bytes.toString('utf8')), homePatches = patches(homePatch?.bytes.toString('utf8'));
  const override = profileCoreOverride(profilePatches);
  const enabled = activation.includes('her-world');
  const declared = Boolean(manifest.dependencies?.['her-world']);
  requireSetup(declared === Boolean(lstatSync(installedRoot, {throwIfNoEntry: false})) && (declared || !enabled), 'bundle-installation-conflict');
  const installed = declared ? readBundle(installedRoot, 'her-world') : undefined;
  const declaration = installed ? coreDeclaration(installed.patches) : coreEntry;
  requireSetup(declaration?.id === coreEntry.id && declaration.name === coreEntry.name && !declaration.group, 'core-entry-missing');
  requireSetup(installed || !override, 'bundle-installation-conflict');
  const names = enabled ? activation : [...activation, 'her-world'];
  const bundlePatches = names.flatMap(name => {
    if (name === 'her-world') return installed?.patches ?? [{insert: [coreEntry]}];
    const root = [...require.resolve.paths(name), join(profileDir, 'node_modules')].map(path => join(path, name))
      .find(path => existsSync(join(path, 'package.json')));
    requireSetup(root, 'bundle-invalid');
    return readBundle(root, name).patches;
  });
  const effective = resolveCoreEntry(bundlePatches, profilePatches, homePatches, applyEntryPatches);
  const config = coreConfiguration(effective.config), base = coreConfiguration(declaration.config);
  requireSetup(!base || config && sameCoreBinding(base, config, [packageRoot, installedRoot]), 'core-binding-conflict');
  return {installed, enabled, patch, profilePatches, homePatch, homePatches, override, bundlePatches, config};
}

function readReceipt() {
  const file = readFileState(installedReceipt);
  if (!file) return {};
  const receipt = checkedSetup('receipt-invalid', () => JSON.parse(file.bytes));
  requireSetup(receipt?.status === 'installed' && receipt.packageInstalled === true, 'receipt-incomplete');
  const receiptDir = receipt.profileDir;
  requireSetup(typeof receiptDir === 'string' && isAbsolute(receiptDir) && existsSync(receiptDir)
    && realpathSync(receiptDir) === realpathSync(profileDir), 'receipt-profile-conflict');
  const config = checkedSetup('receipt-invalid', () => coreConfiguration(receipt.config));
  requireSetup(config && (!receipt.actualPaths || isDeepStrictEqual(receipt.actualPaths, paths(config))), 'receipt-binding-conflict');
  return {file, receipt, config};
}

function inspectBinding(config) {
  checkedSetup('binding-writer-running', () => {
    assertStopped(config.dataDir, 'core');
    if (config.memory) assertStopped(config.memory.dataDir, 'memory');
  });
  return checkedSetup('core-binding-conflict', () => inspectRepoBinding(config));
}

const paths = value => ({coreDataDir: value.dataDir,
  memoryDataDir: value.memory?.dataDir ?? null, memoryPython: value.memory?.python ?? null});
const privateJson = value => ({bytes: Buffer.from(JSON.stringify(value, null, 2)), mode: 0o600});

function atomicWrite(path, file) {
  const temporary = join(dirname(path), `.her-world-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, file.bytes, {mode: file.mode, flag: 'wx'});
    renameSync(temporary, path);
  } finally { rmSync(temporary, {force: true}); }
}

function prepareAttempt(installation) {
  mkdirSync(dir, {recursive: true, mode: 0o700});
  chmodSync(dir, 0o700);
  const stage = mkdtempSync(join(dir, 'prepared-'));
  const file = join(stage, 'installation.json');
  const save = () => atomicWrite(file, privateJson(installation));
  save();
  return {stage, file, save, installation};
}

function preparePatch(state, config) {
  const text = state.patch?.bytes.toString('utf8');
  const next = patchWithCoreOverride(text, state.profilePatches, state.override, config, bundleYaml, entryListSchema, yamlDocument);
  const effective = resolveCoreEntry(state.bundlePatches, patches(next), state.homePatches, applyEntryPatches);
  requireSetup(isDeepStrictEqual(coreConfiguration(effective.config), config), 'core-readback-conflict');
  return next === text ? state.patch : {bytes: Buffer.from(next), mode: 0o600};
}

function verifyProfile(before, patch, config) {
  requireSetup(isDeepStrictEqual(readFileState(configPath), patch)
    && isDeepStrictEqual(readFileState(join(home, 'cordis.patch.yml')), before.homePatch), 'profile-patch-changed');
  const actual = readProfile();
  requireSetup(actual.installed && isDeepStrictEqual(actual.config, config), 'core-readback-conflict');
  return actual;
}

function packageState() {
  const manifestFiles = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'node_modules/.pnpm/lock.yaml']
    .map(name => readFileState(join(profileDir, name)));
  if (!lstatSync(installedRoot, {throwIfNoEntry: false})) return {manifestFiles};
  const root = realpathSync(installedRoot);
  const files = readdirSync(root).sort().filter(name => name !== 'node_modules');
  return {manifestFiles, root, hashes: files.map(name => [name, fileHashes(join(root, name))])};
}

async function applyProfileChange(state, previous, patch, attempt, bindingUnchanged, apply, completedReceipt) {
  const {stage, file, save, installation} = attempt;
  const previousPatch = state.patch ? join(stage, 'previous-cordis.patch.yml') : null;
  const previousReceipt = previous.file ? join(stage, 'previous-installation.json') : null;
  const packageBefore = checkedSetup('package-snapshot-failed', packageState);
  if (previousPatch) writeFileSync(previousPatch, state.patch.bytes, {mode: 0o600, flag: 'wx'});
  if (previousReceipt) writeFileSync(previousReceipt, previous.file.bytes, {mode: 0o600, flag: 'wx'});
  assertDshClosed();
  requireSetup(isDeepStrictEqual(readFileState(configPath), state.patch)
    && isDeepStrictEqual(readFileState(join(home, 'cordis.patch.yml')), state.homePatch)
    && isDeepStrictEqual(readFileState(installedReceipt), previous.file), 'profile-changed');
  const marker = privateJson({status: 'applying', profileDir, attemptReceipt: file, previousPatch, previousReceipt});
  checkedSetup('receipt-write-failed', () => atomicWrite(installedReceipt, marker));
  try {
    if (!isDeepStrictEqual(patch, state.patch)) checkedSetup('patch-write-failed', () => atomicWrite(configPath, patch));
    await apply();
    installation.status = 'installed';
    save();
    checkedSetup('receipt-write-failed', () => atomicWrite(installedReceipt, completedReceipt ?? privateJson(installation)));
  } catch (error) {
    let restored = false;
    try {
      const currentPatch = readFileState(configPath);
      if ((isDeepStrictEqual(currentPatch, patch) || isDeepStrictEqual(currentPatch, state.patch))
        && isDeepStrictEqual(readFileState(installedReceipt), marker)
        && isDeepStrictEqual(readFileState(join(home, 'cordis.patch.yml')), state.homePatch)
        && isDeepStrictEqual(packageState(), packageBefore) && bindingUnchanged()) {
        assertDshClosed();
        if (!isDeepStrictEqual(currentPatch, state.patch)) {
          if (state.patch) atomicWrite(configPath, state.patch);
          else rmSync(configPath);
        }
        if (previous.file) atomicWrite(installedReceipt, previous.file);
        else rmSync(installedReceipt);
        restored = true;
      }
    } catch { /* Keep the applying marker and the original snapshots. */ }
    const failure = error instanceof SetupError ? error : new SetupError('setup-failed', {cause: error});
    if (!restored) failure.applying = true;
    throw failure;
  }
}

function installPackage(packageSpec) {
  const env = {...process.env, DSH_HOME: home, npm_config_ignore_scripts: 'true', pnpm_config_ignore_scripts: 'true'};
  if (values.offline) env.npm_config_offline = env.pnpm_config_offline = 'true';
  const result = spawnSync(join(app, 'Contents/Resources/runtime/cli/bin/dsh'),
    ['plugin', '--profile', profile, 'add', packageSpec, '--ignore-scripts', ...(values.offline ? ['--offline'] : [])], {env, stdio: 'ignore'});
  requireSetup(!result.error && result.status === 0, 'package-install-failed');
}

function inspectMigrationBinding(config) {
  const binding = inspectBinding(config);
  if (config.memory && binding.state === 'ready') {
    const memory = checkedSetup('memory-binding-conflict', () => boundMemoryDirectory(config, binding));
    checkedSetup('binding-writer-running', () => assertStopped(memory, 'memory'));
  }
  return binding;
}

async function migrateCoreConfig(state) {
  requireSetup(state.installed && typeof state.installed.version === 'string' && versionPattern.test(state.installed.version), 'bundle-not-installed');
  const previous = readReceipt();
  const source = state.config ?? previous.config;
  requireSetup(source, 'core-config-missing');
  const managedRoots = [packageRoot, installedRoot];
  requireSetup(!previous.config || sameCoreBinding(source, previous.config, managedRoots), 'receipt-binding-conflict');
  const config = source.memory
    ? {...source, memory: prepareMemoryServiceEntry(source.memory, {managedRoots, preserveCustom: true})}
    : source;
  const binding = inspectMigrationBinding(config);
  if (!state.config) {
    const receipt = previous.receipt;
    const savedWorkspace = receipt.binding?.workspace;
    requireSetup(!Object.hasOwn(state.override ?? {}, 'config') && receipt.actualPaths
      && binding.state === 'ready' && binding.storageId
      && (!savedWorkspace || savedWorkspace.id === binding.target.id && savedWorkspace.path === binding.root)
      && (!receipt.storageRepo || receipt.storageRepo === binding.root)
      && (!receipt.initialization?.storageId || receipt.initialization.storageId === binding.storageId)
      && (!receipt.storageInRepo || config.dataDir === join(binding.root, '.chatpet', 'data', 'core')), 'receipt-recovery-unverified');
  }
  const patch = preparePatch(state, config);
  const patchNeeded = !isDeepStrictEqual(patch, state.patch);
  const receiptNeeded = !previous.file || !isDeepStrictEqual(previous.config.memory, config.memory);
  if (!values.apply || !patchNeeded && !receiptNeeded) {
    if (!values.apply) requireSetup(!existsSync(join(profileDir, '.her-world-setup.lock')), 'profile-busy');
    console.log(JSON.stringify({status: patchNeeded || receiptNeeded ? 'migration-required' : 'checked', profileDir,
      ...(patchNeeded ? {patchPath: configPath} : {}), receiptPath: installedReceipt, enabled: state.enabled}));
    return;
  }
  const completedReceipt = receiptNeeded && previous.file
    ? privateJson({...previous.receipt, config: {...previous.receipt.config, memory: config.memory}})
    : previous.file;
  const attempt = prepareAttempt({status: 'prepared', packageInstalled: true, enabled: state.enabled, profileDir, config,
    packageVersion: state.installed.version, actualPaths: paths(config),
    binding: {state: binding.state, workspace: binding.target ?? null}, storageInRepo: binding.state === 'ready'
      && config.dataDir === join(binding.root, '.chatpet', 'data', 'core')});
  const bindingUnchanged = () => isDeepStrictEqual(inspectMigrationBinding(config), binding);
  await applyProfileChange(state, previous, patch, attempt, bindingUnchanged, () => {
    const actual = verifyProfile(state, patch, config);
    requireSetup(actual.enabled === state.enabled && actual.installed.version === state.installed.version
      && bindingUnchanged(), 'migration-readback-conflict');
  }, completedReceipt);
  console.log(JSON.stringify({status: 'migrated', profileDir, patchPath: configPath, receiptPath: installedReceipt, enabled: state.enabled}));
}

async function setup(state) {
  const receipt = readReceipt();
  const installedConfig = state.config;
  requireSetup(!state.installed || installedConfig, 'migrate-core-config-required');
  requireSetup(!receipt.config || installedConfig && sameCoreBinding(receipt.config, installedConfig, [packageRoot, installedRoot]), 'receipt-binding-conflict');
  if (installedConfig) inspectBinding(installedConfig);
  const defaultDataDir = join(home, 'her-world/core');
  const dataDir = arg('--data-dir', installedConfig?.dataDir ?? defaultDataDir);
  requireSetup(isAbsolute(dataDir), 'core-config-invalid');
  const emptyDataDir = path => {
    const stat = lstatSync(path, {throwIfNoEntry: false});
    return !stat || stat.isDirectory() && readdirSync(path).length === 0;
  };
  requireSetup(installedConfig || arg('--resume-repo') || [dataDir, defaultDataDir].every(emptyDataDir), 'migrate-core-config-required');
  const config = installedConfig ? prepareCoreConfiguration(installedConfig) : {
    dataDir, companionId: '', scopeId: '', ownerActorId: '', displayName: '', character: '',
  };
  if (!installedConfig && !arg('--resume-repo')) {
    Object.assign(config, {companionId: randomUUID(), scopeId: randomUUID(), ownerActorId: randomUUID()});
  }
  config.dataDir = dataDir;
  const resumeRepo = arg('--resume-repo');
  const portable = resumeRepo ? checkedSetup('resume-repo-invalid', () => loadPortableRepo(resolve(resumeRepo))) : null;
  if (portable) {
    Object.assign(config,{dataDir:portable.dataDir,companionId:portable.companionId,scopeId:portable.scopeId,ownerActorId:portable.ownerActorId});
    if (portable.memoryDataDir) {
      requireSetup(arg('--memory-python'), 'memory-python-required',
        'Rebind Memory with --memory-python for this device; its existing Bank will be preserved');
      config.memory={python:arg('--memory-python'),dataDir:portable.memoryDataDir};
    } else delete config.memory;
  }
  requireSetup(isAbsolute(config.dataDir), 'core-config-invalid');
  const memoryPython = arg('--memory-python', config.memory?.python), memoryDataDir = arg('--memory-data-dir', config.memory?.dataDir);
  requireSetup(Boolean(memoryPython) === Boolean(memoryDataDir), 'memory-binding-incomplete');
  if (memoryPython) {
    requireSetup(isAbsolute(memoryPython) && isAbsolute(memoryDataDir), 'memory-binding-invalid');
    config.memory = { ...config.memory, python: memoryPython, dataDir: memoryDataDir };
  }
  const configuredBeforeBinding = structuredClone(config);
  const binding = checkedSetup('core-binding-conflict', () => inspectRepoBinding(config));
  const explicitStorageRepo = arg('--storage-repo', resumeRepo);
  const storageRepo = explicitStorageRepo ?? (binding.state === 'ready' ? binding.root : null);
  let memoryTarget;
  if (storageRepo) {
    const root = checkedSetup('storage-repo-invalid', () => realpathSync(resolve(storageRepo)));
    if (!resumeRepo) {
      requireSetup(binding.state === 'ready', 'storage-workspace-not-ready');
      requireSetup(root === binding.root, 'storage-workspace-conflict');
    }
    if (config.memory) {
      if (values['memory-data-dir'] !== undefined || resumeRepo) {
        const directory = resolve(config.memory.dataDir);
        const bank = checkedSetup('memory-bank-invalid', () => lstatSync(join(directory, 'data', 'memory.db'), {throwIfNoEntry: false}));
        requireSetup(bank?.isFile() && bank.nlink === 1 && bank.size > 0, 'memory-bank-invalid');
        const local = relative(root, directory);
        memoryTarget = local && local !== '..' && !local.startsWith('..' + sep) && !isAbsolute(local)
          ? directory : join(root, '.chatpet', 'data', 'memory');
        config.memory.dataDir = directory;
      } else {
        // Match the Bank the current runtime actually selects, not a deleted
        // sibling-workspace path retained in an older installation receipt.
        config.memory.dataDir = checkedSetup('memory-binding-conflict', () => boundMemoryDirectory(config, binding));
        memoryTarget = config.memory.dataDir;
      }
    }
  }
  const sourceConfig = structuredClone(config);
  const relocation = storageRepo ? checkedSetup('storage-relocation-invalid', () => prepareRepoStorage(resolve(storageRepo), sourceConfig, {memoryTarget})) : null;
  if (relocation) {
    config.dataDir = join(relocation.data, 'core');
    if (config.memory) config.memory.dataDir = relocation.entries.find(entry => entry.kind === 'memory').target;
  }
  // Plan the device runtime without creating it during setup preparation.
  const memory = prepareMemoryServiceEntry(config.memory, {
    args: process.argv.slice(2), managedRoots: [packageRoot, dirname(installedBundle)],
  });
  if (memory) config.memory = memory;
  const deviceRuntimePlan = config.memory ? prepareDeviceRuntime({
    python: config.memory.python,
    deviceRoot: resolve(arg('--device-runtime', join(profileDir, 'chatpet-runtime'))),
    sourceRepo: packageRoot,
  }) : null;
  if (deviceRuntimePlan) {
    config.memory.python = deviceRuntimePlan.python;
    config.memory.runtimeRoot = deviceRuntimePlan.deviceRoot;
  }
  const patch = preparePatch(state, config);
  const packageSpec = `her-world@${values.version ?? 'latest'}`;
  const backupRequested = !values['no-backup'];
  const installation = { status: 'prepared', profileDir, packageSpec, config,
    binding: {state: binding.state, workspace: binding.target ?? null, reason: binding.reason ?? null},
    backupPolicy: backupRequested ? 'default' : 'none', plannedPaths: paths(config),
    ...(deviceRuntimePlan ? {deviceRuntime: {status: 'planned', plan: deviceRuntimePlan}} : {}),
    ...(installedConfig ? {installedPathsBefore: paths(installedConfig)} : {}),
    ...(relocation ? { storageRepo: relocation.root, previousConfig: sourceConfig, configuredBeforeBinding,
      migrationRequired: relocation.entries.some(entry => entry.source !== entry.target) } : {}) };
  const attempt = prepareAttempt(installation);
  if (!values.apply) {
    console.log(JSON.stringify({status: 'prepared', profileDir, attemptReceipt: attempt.file, dataDir: config.dataDir}));
    return;
  }
  checkedSetup('binding-writer-running', () => {
    assertStopped(sourceConfig.dataDir, 'core');
    if (sourceConfig.memory) assertStopped(sourceConfig.memory.dataDir, 'memory');
  });
  if (deviceRuntimePlan) {
    const preparedRuntime = checkedSetup('device-runtime-failed', () => applyDeviceRuntime(deviceRuntimePlan));
    requireSetup(preparedRuntime.python === config.memory.python, 'device-runtime-conflict');
    installation.deviceRuntime = {status: 'ready', deviceRoot: preparedRuntime.deviceRoot,
      python: preparedRuntime.python, receipt: preparedRuntime.receipt};
    attempt.save();
  }
  let backupDir = null;
  if (backupRequested) {
    backupDir = join(profileDir, 'backups/her-world', new Date().toISOString().replace(/[:.]/g, '-'));
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    for (const file of ['package.json', 'cordis.patch.yml', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
      if (existsSync(join(profileDir, file))) { copyFileSync(join(profileDir, file), join(backupDir, file)); chmodSync(join(backupDir, file), 0o600); }
    }
    // Optional installation rollback copy, never a substitute for full recovery.
    if (existsSync(sourceConfig.dataDir)) cpSync(sourceConfig.dataDir, join(backupDir, 'core-data'), { recursive: true, dereference: false });
    if (sourceConfig.memory && existsSync(sourceConfig.memory.dataDir))
      cpSync(sourceConfig.memory.dataDir, join(backupDir, 'memory-data'), { recursive: true, dereference: false });
  }
  if (relocation) {
    const copied = checkedSetup('storage-relocation-failed', () => relocateRepoStorage(relocation));
    // This receipt contains file hashes, never credentials or database contents.
    writeFileSync(join(dir, 'storage-migration.json'), JSON.stringify({ at: new Date().toISOString(),
      root: relocation.root, backupDir, copied }, null, 2), { mode: 0o600 });
  }
  const rollbackConfig = installedConfig ?? sourceConfig;
  const previousBinding = inspectBinding(rollbackConfig);
  let initializing = false;
  await applyProfileChange(state, receipt, patch, attempt, () => !initializing
    && isDeepStrictEqual(inspectBinding(rollbackConfig), previousBinding), async () => {
    installPackage(packageSpec);
    const actual = verifyProfile(state, patch, config);
    const version = typeof actual.installed.version === 'string' && versionPattern.exec(actual.installed.version);
    requireSetup(version && (values.version ? actual.installed.version === values.version : !version[1]), 'package-version-conflict');
    requireSetup(actual.enabled === (state.installed ? state.enabled : true), 'bundle-activation-conflict');
    requireSetup(!actual.installed.patches.some(row => row.insert?.some(entry => entry.id === 'preset-chatpet')), 'core-entry-conflict');
    const actualConfig = actual.config;
    Object.assign(installation, {packageInstalled: true, enabled: actual.enabled, packageVersion: actual.installed.version,
      backupDir, actualPaths: paths(actualConfig), migrationRequired: false,
      storageInRepo: Boolean(relocation && actualConfig.dataDir === join(relocation.data, 'core'))});
    initializing = binding.state === 'ready' && relocation?.root === binding.root;
    await finishWorkspace(binding, initializing, actualConfig, installation, attempt.save);
  });
  console.log(JSON.stringify({status: 'installed', profileDir, backupDir, actualPaths: installation.actualPaths}));
}

async function finishWorkspace(binding, initializing, actualConfig, installation, saveAttempt) {
  // This is the owner's explicit setup operation, after offline relocation and
  // package installation, not an application-startup repair of absent documents.
  // Only finish an already recognized, initialized binding. Fresh/unbound or
  // missing managed workspaces remain untouched until explicit initialization.
  if (initializing) {
    installation.initialization = {status: 'pending', workspaceId: binding.target.id};
    try {
      const managed = join(binding.root, '.chatpet'), stat = lstatSync(managed, {throwIfNoEntry:false});
      assert.ok(stat && stat.isDirectory() && !stat.isSymbolicLink(), 'Companion files disappeared; refuse to reconstruct them during setup');
      const currentBinding = inspectRepoBinding(actualConfig);
      assert.equal(currentBinding.state, 'ready', 'Workspace is no longer initialized; explicit initialization is required');
      assert.equal(currentBinding.target.id, binding.target.id, 'Selected workspace changed during setup');
      assert.equal(currentBinding.root, binding.root, 'Selected workspace path changed during setup');
      // DSH supplies SDK peers through its application loader, not the profile's
      // node_modules. Resolve only those declared peers from the trusted app;
      // never borrow a development checkout or install another SDK copy.
      const peers = Object.keys(JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8')).peerDependencies ?? {})
        .filter(name => name.startsWith('@deepseek-ai/'));
      // Resolve before registering the hook so require.resolve cannot recurse
      // through this same hook. All package code still comes from installedRoot.
      const peerUrls = new Map(peers.map(name => [name, pathToFileURL(require.resolve(name)).href]));
      const peerHook = registerHooks({resolve(specifier, context, nextResolve) {
        const url = peerUrls.get(specifier);
        return url ? {url, shortCircuit:true} : nextResolve(specifier, context);
      }});
      let host;
      try {
        const {createCore} = await import(pathToFileURL(join(installedRoot, 'dist/src/core/index.js')).href);
        host = createCore(actualConfig);
        const prefs = await host.services.preferences.read(host.operator.request('setup.preferences:' + randomUUID()), {});
        assert.ok(prefs.ok, 'Installed Core preferences could not be read for explicit initialization');
        assert.equal(prefs.value.workspace?.id, binding.target.id, 'Selected workspace changed before initialization');
        assert.equal(prefs.value.workspace?.path, binding.root, 'Selected workspace directory changed before initialization');
        const result = await host.services.workspace.initialize(host.operator.request('setup.workspace.finish:' + randomUUID()), {
          expectedPreferencesRevision: prefs.value.revision,
        });
        if (!result.ok) throw new Error(`Explicit workspace initialization failed (${result.error.code}): ${result.error.message}`);
        assert.equal(result.value.state, 'ready', 'Explicit workspace initialization did not complete');
        const storage = host.workspace.storageStatus();
        installation.initialization = {status: 'pending', workspaceId: binding.target.id,
          revision: result.value.revision, sourceRevision: result.value.sourceRevision,
          storageId: host.workspace.storageId(), files: result.value.files, storage};
        assert.ok(storage.complete, 'Companion documents are ready but actual storage placement is incomplete');
        installation.initialization.status = 'ready';
      } finally {
        try { if (host) await host.close(); }
        finally { peerHook.deregister(); }
      }
    } catch (error) {
      installation.status = 'needs-initialization';
      installation.initialization = {...installation.initialization, status: 'failed', workspaceId: binding.target.id};
      saveAttempt();
      throw new SetupError('workspace-initialization-failed', {cause: error});
    }
  } else installation.initialization = {status: 'not-requested', reason: 'No existing initialized binding was selected for completion'};
}

try { await main(); }
catch (error) {
  console.error(JSON.stringify({status: error.applying ? 'applying' : 'failed',
    reason: error instanceof SetupError ? error.reason : 'setup-failed', ...(profileDir ? {profileDir} : {})}));
  process.exitCode = 1;
}
