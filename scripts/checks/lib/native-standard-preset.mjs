// Test preparation through the installed host's own patch and Loader APIs.
// No copied plugin roster and no activation of the user's third-party bundles.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export async function mountInstalledStandard(ctx, hostRequire) {
  const { resolveDshHome } = await import(hostRequire.resolve('@deepseek-ai/dsh-home-paths'));
  const { loadProfileDirectory, readProfilePatches, composeEntries } = await import(hostRequire.resolve('@deepseek-ai/dsh-app-boot'));
  const home = resolveDshHome(), profileDir = join(home, 'profiles/desktop');
  const installAnchor = fileURLToPath(new URL('./package.json', ctx.baseUrl));
  // Use the same bundle/profile/home composition as boot. Only the selected
  // preset and its missing host seams are mounted; account/UI/plugin bundles
  // are not started. Do not persist or normalize the user's configuration.
  const manifestPath = join(profileDir, 'package.json'), before = readFileSync(manifestPath);
  const profile = loadProfileDirectory('chatpet-check', profileDir, installAnchor);
  assert.deepEqual(readFileSync(manifestPath), before, 'Profile reading must not change its manifest');
  assert.equal(profile.skippedBundles.length, 0, 'Inspect skipped profile layers instead of silently testing a different composition');
  const patches = readProfilePatches('chatpet-check', { name: 'desktop', dir: profileDir, patchPath: profile.patchPath,
    installAnchor, cwd: process.cwd(), home, startedBundles: profile.layers.map(layer => layer.packageName),
    overlays: [], telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED }, profile);
  const warnings = [];
  const rows = composeEntries([patches], warning => warnings.push(warning));
  // Provision missing host seams with their installed base declarations. These
  // are real services, not test doubles. No tool/task is invoked here.
  const dependencies = new Set(['jobs', 'skill', 'goal', 'web', 'subagent', 'subagent-spawn-in-process',
    'subagent-fork-in-process', 'ptc-runtime']);
  for (const row of rows.filter(row => dependencies.has(row.id)))
    await ctx.loader.create(row);
  const path = join(dirname(dirname(hostRequire.resolve('@deepseek-ai/dsh-web-app'))), 'presets/standard.patch.yml');
  const content = readFileSync(path, 'utf8');
  const preset = rows.find(row => row.id === 'preset-standard');
  assert.equal(preset?.config.id, 'standard');
  const id = await ctx.loader.create(preset);
  await ctx.loader.await();
  const actual = await ctx.agentPresets.resolve('standard');
  assert.ok(!actual.broken, actual.broken);
  console.log(JSON.stringify({ check: 'installed-standard-preset', source: path,
    sha256: createHash('sha256').update(content).digest('hex'), profileLayers: profile.layers.map(layer => layer.packageName),
    compositionWarningCount: warnings.length, declaredPlugins: preset.config.plugins.length, status: 'mounted' }));
  return () => ctx.loader.remove(id);
}
