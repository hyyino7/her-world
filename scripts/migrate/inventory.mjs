#!/usr/bin/env node
import { checked, requireInventory, diagnostic } from './errors.mjs';
import { lstatSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative, matchesGlob, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { json } from './io.mjs';
import { assertStopped, copyDatabase } from '../lib/repo-storage.mjs';
import { inventoryPlan } from './inventory-plan.mjs';

export const storage = json(new URL('../../arch/storage.json', import.meta.url));

const quote = name => '"' + name.replaceAll('"', '""') + '"';
function sqliteMetadata(file, core) {
  // Even read-only SQLite can create SHM files. Only open a disposable copy,
  // including WAL, so inventory never checkpoints or changes the source tree.
  const scratch = mkdtempSync(join(tmpdir(), 'companion-inventory-'));
  try {
    const copy = join(scratch, 'database');
    copyDatabase(file, copy);
    const db = new DatabaseSync(copy, {readOnly:true});
    try {
      const names = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(row => row.name);
      const result = {tables:names.map(name => ({name, rows:db.prepare(`SELECT count(*) AS n FROM ${quote(name)}`).get().n}))};
      if (core) {
        const kinds = storage.entries.flatMap(row => row.selector?.kind ? [row.selector.kind] : []);
        result.kinds = kinds.map(kind => ({kind, rows:db.prepare('SELECT count(*) AS n FROM records WHERE kind=?').get(kind).n}));
        result.unknownKinds = db.prepare(`SELECT count(DISTINCT kind) AS n FROM records WHERE kind NOT IN (${kinds.map(() => '?').join(',')})`).get(...kinds).n;
      }
      return result;
    } finally { db.close(); }
  } finally { rmSync(scratch, {recursive:true, force:true}); }
}
function logicalPath(context, root, path) {
  const memory = context.plan.memoryDirectory;
  if (memory && (path === memory || path.startsWith(memory + sep)))
    return '.chatpet/data/memory/' + relative(memory,path);
  if (root.id === 'companion') return '.chatpet/' + relative(root.path, path);
  if (root.id === 'channels') return 'profile:chatpet-channels/' + relative(root.path, path);
  if (root.id === 'voice') return 'profile:chatpet-voice/' + relative(root.path, path);
  if (root.id === 'core') return '.chatpet/data/core/' + relative(root.path, path);
  if (root.id === 'memory') return '.chatpet/data/memory/' + relative(root.path, path);
  return undefined;
}
export function inventory(installation) {
  const context = inventoryPlan(installation), files = [], directories = [], logical = new Map();
  checked('writer-running', () => {
    assertStopped(context.plan.coreDirectory, 'core');
    assertStopped(join(context.plan.repo, '.chatpet/data/economy'), 'economy');
    if (context.plan.memoryDirectory) assertStopped(context.plan.memoryDirectory, 'memory');
  });
  const counts = new Map();
  const roots = context.plan.roots.map(root => {
    const base = root.id.startsWith('sessions-') ? 'sessions' : root.id.startsWith('cache-') ? 'cache' : root.id;
    const count = (counts.get(base) ?? 0) + 1; counts.set(base,count);
    return {...root, outputId:['sessions','cache'].includes(base) ? `${base}-${count}` : base};
  });
  function visit(root, path) {
    const stat = lstatSync(path, {throwIfNoEntry:false}); if (!stat) return;
    const name = root.outputId + (relative(root.path, path) ? '/' + relative(root.path, path) : '');
    const declared = logicalPath(context, root, path);
    if (declared) logical.set(name, declared);
    if (stat.isDirectory()) {
      directories.push(name);
      for (const child of readdirSync(path).sort()) visit(root, join(path, child));
    } else {
      const core = path === join(context.plan.coreDirectory, 'core.sqlite');
      const metadata = /\.(?:sqlite|db)$/.test(path) ? sqliteMetadata(path, core) : {};
      files.push({path:name, bytes:stat.size, ...metadata});
    }
  }
  for (const root of roots) visit(root, root.path);
  const metadataByPath = new Map(files.map(file => [file.path, file]));
  const coverage = storage.entries.map(entry => {
    if (entry.paths.every(path => path.startsWith('localStorage:'))) return {id:entry.id, state:'browser-check-required'};
    const matches = [...logical].filter(([,path]) => entry.paths.some(pattern => path === pattern.replace(/\/\*\*$/, '') || matchesGlob(path, pattern)));
    const paths = matches.map(([path]) => path);
    const containers = (entry.locations ?? [entry]).map(location => location.container.split('#')[0]).filter(path => !/[*?[\]{}()]/.test(path));
    if (entry.lazy && !matches.some(([,path]) => containers.includes(path)))
      return {id:entry.id, state:'not-created', paths};
    const present = containers.length
      ? matches.some(([file,path]) => metadataByPath.has(file) && containers.includes(path))
      : matches.length > 0;
    const tables = [...new Set(matches.flatMap(([path]) => metadataByPath.get(path)?.tables?.map(table => table.name) ?? []))];
    const missingTables = (entry.tables ?? (entry.selector?.table ? [entry.selector.table] : [])).filter(table => !tables.includes(table));
    return {id:entry.id, state:present && !missingTables.length ? 'present' : 'missing',
      paths, ...(missingTables.length ? {missingTables} : {})};
  });
  const operational = ['.chatpet/README.md','.chatpet/data/storage-manifest.json','.chatpet/data/migrations.jsonl','.chatpet/data/migration.lock'];
  const extra = files.filter(file => {
    const path = logical.get(file.path)?.replace(/-(?:wal|shm|journal)$/, '');
    return path && !operational.includes(path) && !storage.entries.some(entry => entry.paths.some(pattern => matchesGlob(path, pattern)));
  }).map(file => file.path);
  return {roots:roots.map(root => ({id:root.outputId, present:Boolean(lstatSync(root.path, {throwIfNoEntry:false}))})),
    directories, files, coverage, differences:{extra, missing:coverage.filter(row => row.state === 'missing').map(row => row.id)}};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    requireInventory(process.argv.length === 4 && process.argv[2] === '--installation', 'usage');
    console.log(JSON.stringify(inventory(process.argv[3]), null, 2));
  } catch (error) {
    console.error(diagnostic(error));
    process.exitCode = 1;
  }
}
