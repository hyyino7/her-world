import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import { apply as applyCore } from '../../dist/src/core/plugin.js';

const include = import.meta.resolve('@deepseek-ai/cordis-plugin-include');
const requireInclude = createRequire(include);
const yaml = requireInclude('js-yaml');
const installer = fileURLToPath(new URL('../../scripts/install-dsh.mjs', import.meta.url));
const value = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value; };
const rows = [{ insert: [{ id: '00-Core', name: 'her-world/00-Core' }] }];
const dump = data => yaml.dump(data, { schema: entryListSchema });
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value));

export function profileFixture(t) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'her-world-setup-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const profileDir = join(home, 'profiles/fixture');
  const patchPath = join(profileDir, 'cordis.patch.yml');
  const manifest = join(profileDir, 'package.json');
  const installed = join(profileDir, 'node_modules/her-world');
  const bundlePatch = join(installed, 'cordis.patch.yml');
  const receiptDir = join(profileDir, 'chatpet-installation');
  const receiptPath = join(receiptDir, 'installation.json');
  const log = join(home, 'calls.jsonl');
  const app = join(home, 'Synthetic DSH.app');
  const appModules = join(app, 'Contents/Resources/app.asar/dsh/node_modules');
  mkdirSync(join(appModules, '@deepseek-ai/dsh-home-paths'), { recursive: true });
  writeFileSync(join(appModules, '@deepseek-ai/dsh-home-paths/index.js'), 'exports.resolveDshHome = (path) => path ?? process.env.DSH_HOME;\n');
  symlinkSync(fileURLToPath(new URL('..', include)), join(appModules, '@deepseek-ai/cordis-plugin-include'), 'dir');
  symlinkSync(dirname(requireInclude.resolve('js-yaml/package.json')), join(appModules, 'js-yaml'), 'dir');
  symlinkSync(dirname(createRequire(import.meta.url).resolve('yaml/package.json')), join(appModules, 'yaml'), 'dir');
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(manifest, '{}');
  writeFileSync(patchPath, '[]\n');

  const runtime = join(home, 'runtime.mjs');
  writeFileSync(runtime, `
    import assert from 'node:assert/strict';
    import childProcess from 'node:child_process';
    import fs from 'node:fs';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    const { appendFileSync, mkdirSync, readFileSync, writeFileSync, renameSync } = fs;
    const mode = JSON.parse(process.env.HER_WORLD_SETUP_FIXTURE);
    const record = value => appendFileSync(${JSON.stringify(log)}, JSON.stringify(value) + '\\n');
    const receipt = ${JSON.stringify(receiptPath)}, patch = ${JSON.stringify(patchPath)};
    Object.defineProperty(process.versions, 'electron', { value: 'fixture' });
    if (mode.runtime) registerHooks({ resolve(specifier, context, next) {
      if (specifier === './lib/device-runtime.mjs') return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(\x60
        export function prepareDeviceRuntime({python,deviceRoot}) { return {python,deviceRoot}; }
        export function applyDeviceRuntime() { throw Error('fixture runtime failure'); }
      \x60) };
      return next(specifier, context);
    }});
    const kill = process.kill;
    process.kill = (pid, signal) => {
      if (pid === 999999999) record('writer-check');
      return kill(pid, signal);
    };
    fs.renameSync = (from, to) => {
      if (to === patch && mode.writeFailure || to === receipt && mode.publishFailure && JSON.parse(readFileSync(from)).status === 'installed')
        throw Error('fixture atomic publication failure');
      return renameSync(from, to);
    };
    childProcess.spawnSync = (command, args, options) => {
      if (command === '/usr/bin/pgrep') {
        record('process-check');
        return { status: mode.running ? 0 : 1, stdout: mode.running ? '999999999' : '' };
      }
      assert.equal(command, ${JSON.stringify(join(app, 'Contents/Resources/runtime/cli/bin/dsh'))});
      assert.deepEqual(args.slice(0, 4), ['plugin', '--profile', 'fixture', 'add']);
      assert.equal(options.env.DSH_HOME, ${JSON.stringify(home)});
      assert.equal(options.env.npm_config_ignore_scripts, 'true');
      const offline = args.includes('--offline');
      assert.ok(args.includes('--ignore-scripts'));
      assert.equal(offline, mode.offline);
      if (mode.offline) {
        assert.equal(options.env.npm_config_offline, 'true');
        assert.equal(options.env.pnpm_config_offline, 'true');
        assert.equal(options.env.pnpm_config_ignore_scripts, 'true');
      }
      const status = JSON.parse(readFileSync(receipt)).status;
      record({ args, offline, status });
      if (mode.cliFailure === 'mutated') writeFileSync(${JSON.stringify(join(profileDir, 'pnpm-lock.yaml'))}, 'changed');
      if (mode.cliFailure) return { status: 1 };
      const manifest = ${JSON.stringify(manifest)};
      const before = JSON.parse(readFileSync(manifest));
      const installed = ${JSON.stringify(installed)};
      mkdirSync(installed, { recursive: true });
      const spec = args[4];
      assert.match(spec, /^her-world@/);
      const version = spec === 'her-world@latest' ? '0.2.0' : spec.slice('her-world@'.length);
      const enabled = before.dependencies?.['her-world'] ? before.dsh?.profile?.bundles?.includes('her-world') : true;
      writeFileSync(${JSON.stringify(bundlePatch)}, ${JSON.stringify(dump(rows))});
      writeFileSync(installed + '/package.json', JSON.stringify({name:'her-world',version,dsh:{bundle:{patch:'./cordis.patch.yml'}}}));
      writeFileSync(manifest, JSON.stringify({ ...before,
        dependencies: { ...before.dependencies, 'her-world': version }, dsh: { profile: { bundles: enabled ? ['her-world'] : [] } },
      }));
      if (mode.changedPatch) writeFileSync(patch, 'unexpected patch');
      if (mode.breakWorkspace) fs.rmSync(mode.breakWorkspace);
      return { status: 0 };
    };
    syncBuiltinESMExports();
  `);
  const command = (args, mode = {}) => spawnSync(process.execPath, ['--import', runtime, installer, ...args,
    '--dsh-app', app, '--dsh-home', home, '--profile', 'fixture'], {
    env: { ...process.env, DSH_HOME: join(home, 'unused-environment-home'),
      HER_WORLD_SETUP_FIXTURE: JSON.stringify({ ...mode, offline: args.includes('--offline') }) }, encoding: 'utf8',
  });
  return {
    home, profileDir, patchPath, bundlePatch, receiptDir, receiptPath, manifest, command, dump,
    calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [],
    checked(args, mode) {
      const result = command(args, mode);
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      return JSON.parse(result.stdout);
    },
    installFixture(config, {enabled = true, version = '0.1.8', spec = 'file:legacy.tgz'} = {}) {
      mkdirSync(installed, {recursive: true});
      writeFileSync(bundlePatch, dump([{insert: [{...rows[0].insert[0], ...(config ? {config} : {})}]}]));
      writeJson(join(installed, 'package.json'), {name:'her-world',version,dsh:{bundle:{patch:'./cordis.patch.yml'}}});
      writeJson(manifest, {dependencies:{'her-world':spec},dsh:{profile:{bundles:enabled ? ['her-world'] : []}}});
    },
    coreConfig() {
      const patches = [bundlePatch, patchPath].flatMap(path => yaml.load(readFileSync(path, 'utf8'), { schema: entryListSchema }));
      const composed = applyEntryPatches([], patches, message => assert.fail(message));
      return composed.find(entry => entry.name === 'her-world/00-Core').config ?? {};
    },
  };
}

async function withCore(config, check) {
  const disposers = [];
  const noop = () => {};
  const registration = () => noop;
  const ctx = {
    provide(name, service) { this[name] = service; },
    get(name) { return this[name]; },
    effect(register) { const dispose = register(); if (typeof dispose === 'function') disposers.push(dispose); },
    logger: () => ({ warn: noop }), on: registration, emit: noop,
    tools: { register: registration, guard: registration },
  };
  try {
    await applyCore(ctx, config);
    await check(ctx.petCore);
  } finally {
    for (const dispose of disposers.reverse()) await dispose();
  }
}

if (import.meta.main) test('换包后 Core 配置仍在', async t => {
  const f = profileFixture(t);
  f.checked(['--apply', '--no-backup', '--version', '0.2.0']);
  assert.deepEqual(f.calls().find(call => call.args)?.args, ['plugin', '--profile', 'fixture', 'add', 'her-world@0.2.0', '--ignore-scripts']);
  assert.equal(yaml.load(readFileSync(f.bundlePatch, 'utf8'), {schema: entryListSchema})[0].insert[0].config, undefined);
  const initial = f.coreConfig();
  const workspace = { id: 'setup-test', path: join(f.home, 'workspace'), title: 'Synthetic workspace' };
  mkdirSync(workspace.path);
  let identity;
  await withCore(initial, async host => {
    identity = value(await host.services.core.getIdentity(host.operator.request('identity-before'), {}));
    const prefs = value(await host.services.preferences.read(host.operator.request('preferences-before'), {}));
    const saved = value(await host.services.preferences.save(host.operator.request('bind'), {
      expectedRevision: prefs.revision, workspace, conversation: prefs.conversation,
    }));
    const initialized = value(await host.services.workspace.initialize(host.operator.request('initialize'), {
      expectedPreferencesRevision: saved.revision,
    }));
    assert.equal(initialized.state, 'ready');
  });
  assert.ok(existsSync(join(initial.dataDir, 'core.sqlite')));

  f.installFixture(undefined, {version: '0.2.1', spec: '0.2.1'});
  const switched = f.coreConfig();
  await withCore(switched, async host => {
    assert.deepEqual(value(await host.services.core.getIdentity(host.operator.request('identity-after'), {})), identity);
    assert.equal(switched.scopeId, initial.scopeId);
    assert.equal(switched.dataDir, initial.dataDir);
    const status = value(await host.services.workspace.inspect(host.operator.request('workspace-after'), {}));
    assert.equal(status.state, 'ready');
    assert.deepEqual(status.target, workspace);
  });

  writeFileSync(f.patchPath, '[]\n');
  await assert.rejects(withCore(f.coreConfig(), () => assert.fail('Core started without its binding')), /Invalid companionId/);
});
