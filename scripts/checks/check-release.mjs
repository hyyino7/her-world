// Validate a complete, prebuilt GitHub-installable release. No host startup.
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {parse} from 'yaml';
import semver from 'semver';

export function checkBundleExports(root, manifest) {
  assert.equal(manifest.name, 'her-world');
  const patch = manifest.dsh.bundle.patch;
  assert.ok(patch);
  const rows = parse(readFileSync(resolve(root, patch), 'utf8')).flatMap(patch => patch.insert ?? []);
  const entries = new Map(rows.map(row => [row.id, row]));
  assert.equal(entries.size, rows.length, 'Duplicate bundle entry');
  const require = createRequire(resolve(root, 'package.json'));
  function checkEntry(entry, key) {
    const name = manifest.name + (key === '.' ? '' : key.slice(1));
    assert.equal(entry?.name, name, 'Incorrect or missing bundle entry for ' + name);
    const target = manifest.exports[key];
    assert.equal(typeof target, 'string', 'Missing export for bundle entry ' + name);
    assert.equal(require.resolve(name), resolve(root, target), 'Incorrect export target for ' + name);
  }
  for (const row of rows) {
    if (row.id === 'chatpet-channel-preset') continue;
    checkEntry(row, row.id === 'chatpet-settings' ? '.' : `./${row.id}`);
  }
  for (const key of Object.keys(manifest.exports).filter(key => /^\.\/\d\d-[^/]+$/.test(key))) {
    assert.ok(entries.has(key.slice(2)), 'Missing bundle entry for ' + key);
  }
  const core = entries.get('00-Core');
  assert.ok(core, 'Missing Core bundle entry');
  assert.ok(!Object.hasOwn(core, 'config'), 'Public bundles must not contain device binding');
  assert.ok(entries.has('chatpet-settings'), 'Missing Console bundle entry');
  const preset = entries.get('chatpet-channel-preset');
  assert.equal(preset?.name, '@deepseek-ai/dsh-agent-preset');
  checkEntry(preset.config?.plugins?.find(plugin => plugin.id === 'audience'), './channel-guest');
}

if (import.meta.main) {
  const manifest=JSON.parse(readFileSync('package.json','utf8'));
  assert.ok(semver.valid(manifest.version),'Release version must be exact SemVer');
  assert.notEqual(manifest.private,true);
  for(const hook of ['prepare','preinstall','install','postinstall'])
    assert.ok(!manifest.scripts?.[hook],'GitHub consumers must not need build/install hooks: '+hook);
  assert.equal(manifest.repository.url,'https://github.com/hyyino7/her-world.git');
  for(const path of ['src/core/index.ts','tests/core/core.test.ts','scripts/doctor.mjs','tsconfig.build.json','pnpm-lock.yaml'])
    assert.ok(existsSync(path),'Incomplete source checkout: '+path);
  for(const value of Object.values(manifest.exports)) {
    if(typeof value==='string'&&!value.includes('*')) assert.ok(existsSync(resolve(value)),'Missing exported runtime: '+value);
  }
  checkBundleExports(process.cwd(), manifest);
  console.log('Release metadata, complete source, prebuilt exports and hook-free GitHub install passed.');
}
