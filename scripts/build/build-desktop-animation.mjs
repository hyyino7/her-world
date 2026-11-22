// Compile the pinned upstream animation modules with the existing TypeScript
// toolchain. Classic scripts also work in Electron's local file pages.
import ts from 'typescript';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { adaptCompactVoice } from '../lib/compact-voice-lifecycle.mjs';
import { verifyLifeMedia } from './build-life-media.mjs';
const root = resolve(import.meta.dirname, '../../vendor/dsh-pet');
const origin = JSON.parse(readFileSync(resolve(root, 'origin.json'), 'utf8'));
const modules = [];
verifyLifeMedia();
for (const [path, hash] of Object.entries(origin.files)) {
  const source = readFileSync(resolve(root, path), 'utf8');
  if (createHash('sha256').update(source).digest('hex') !== hash) throw Error('Upstream source changed: ' + path);
  if (path.startsWith('runtime/electron-helper/')) {
    const target = resolve(import.meta.dirname, '../../src/desktop/helper/upstream', path.slice('runtime/electron-helper/'.length));
    mkdirSync(dirname(target), {recursive:true}); writeFileSync(target, source);
    continue;
  }
  let code = ts.transpileModule(adaptCompactVoice(path,source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  if (path === 'src/shared/voice.ts') {
    // The compact chat persists across hides and can be rebound to another session.
    code += '\nexports.stopManualSpeech = () => { manualSeq++; if (manualAudio) { manualAudio.pause(); URL.revokeObjectURL(manualAudio.src); manualAudio = null; } };';
  }
  code = code.replace(/require\("([^"\n]+)"\)/g, (_, name) => `require(${JSON.stringify(posix.normalize(posix.join(dirname(path), name)))})`);
  modules.push(`${JSON.stringify(path)}: function(exports, require) {\n${code}\n}`);
}
writeFileSync(resolve(import.meta.dirname, '../../src/desktop/helper/upstream/shared-core.js'),
  `// Generated from PC2005-cloud/dsh-pet ${origin.commit} (MIT).\n` +
  `(() => { const modules = {${modules.join(',\n')}}; const cache = {};\n` +
  `function require(id) { if (cache[id]) return cache[id]; const out = cache[id] = {}; modules[id](out, require); return out; }\n` +
  `window.PetShared = { ...require('src/shared/index.ts'), ...require('src/shared/chat/encode.ts'), ...require('src/shared/chat/hear-control.ts') }; })();\n`);

// Keep pinned native inputs unchanged; bind voice cancellation at the original
// route/queue/synthesis boundaries, then adapt their import suffixes.
for (const [path, hash] of Object.entries(origin.nativeFiles ?? {})) {
  const source = readFileSync(resolve(root, path), 'utf8');
  if (createHash('sha256').update(source).digest('hex') !== hash) throw Error('Upstream source changed: ' + path);
  const output = path.replace(/^src\//, '').replace(/\.ts$/, '.js');
  const voice = path.startsWith('src/host/voice/') || path === 'src/host/routes/voice.ts';
  const target = resolve(import.meta.dirname, voice ? '../../dist/src/voice/upstream' : '../../dist/src/desktop/upstream', output);
  mkdirSync(dirname(target), {recursive:true});
  const code = ts.transpileModule(adaptCompactVoice(path,source), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  const compiled = code.replace(/(from\s+['"][^'"]+)\.ts(['"])/g, '$1.js$2');
  writeFileSync(target, compiled);
  if (voice) {
    const legacy = resolve(import.meta.dirname, '../../dist/src/desktop/upstream', output);
    mkdirSync(dirname(legacy), {recursive:true});
    writeFileSync(legacy, `export * from '../../../../voice/upstream/${output}';\n`);
  }
  if (path === 'src/host/routes/result.ts') {
    const voiceResult = resolve(import.meta.dirname, '../../dist/src/voice/upstream', output);
    mkdirSync(dirname(voiceResult), {recursive:true});
    writeFileSync(voiceResult, compiled);
  }
}
for (const item of Object.values(origin.assets ?? {})) {
  const asset = readFileSync(resolve(import.meta.dirname, '../../src/desktop/assets', item.file));
  if (createHash('sha256').update(asset).digest('hex') !== item.sha256) throw Error('Upstream asset changed: ' + item.file);
}

if (origin.interactionTextSource?.outputSha256 && createHash('sha256').update(readFileSync(resolve(import.meta.dirname, '../../src/desktop/assets/interaction.json'))).digest('hex') !== origin.interactionTextSource.outputSha256) throw Error('Upstream interaction text changed');
