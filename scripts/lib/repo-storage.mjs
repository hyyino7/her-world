// Offline relocation only: retain each module's authority and exact stored bytes.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, cpSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const within = (root, path) => {
  const local = relative(root, path);
  return local && local !== '..' && !local.startsWith('..' + sep) && !isAbsolute(local);
};

/** Copy an offline SQLite database before opening it. SHM is rebuilt privately. */
export function copyDatabase(source, target) {
  const files = ['', '-wal', '-journal'];
  const snapshot = () => files.map(suffix => {
    const stat = lstatSync(source + suffix, { throwIfNoEntry: false, bigint: true });
    if (!stat) return null;
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n, 'Invalid SQLite database or sidecar');
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs];
  });
  const before = snapshot();
  assert.ok(before[0], 'SQLite database is absent');
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  for (const [index, suffix] of files.entries()) {
    if (before[index]) cpSync(source + suffix, target + suffix, { force: false, errorOnExist: true });
  }
  assert.deepEqual(snapshot(), before, 'SQLite source changed during copy; stop its writers and retry');
}

/** Read only the installed Core's identity/binding metadata. A remembered
 * ready flag alone cannot authorize reconstructing a missing workspace. */
export function inspectRepoBinding(config) {
  const file = join(resolve(config.dataDir), 'core.sqlite');
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return { state: 'unavailable', reason: 'Existing Core database is absent' };
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'Inspect the existing Core database before installation');
  // CLI readers can only snapshot a stopped external writer. A synchronous
  // caller in the Core process itself can read committed bytes on this stack.
  const lease = join(dirname(file), 'core.lock'), lock = lstatSync(lease, { throwIfNoEntry: false });
  if (lock) {
    assert.ok(lock.isFile() && lock.nlink === 1, 'Invalid Core owner record');
    if (!readFileSync(lease, 'utf8').startsWith(process.pid + ':')) assertStopped(dirname(file), 'core');
  }
  let prefs, binding, owner, storedId;
  const scratch = mkdtempSync(join(tmpdir(), 'companion-binding-'));
  try {
    const copy = join(scratch, 'core.sqlite');
    copyDatabase(file, copy);
    const db = new DatabaseSync(copy, { readOnly: true });
    try {
      const record = kind => {
        const row = db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind, 'current');
        return row ? JSON.parse(row.value) : null;
      };
      const meta = key => {
        const row = db.prepare('SELECT value FROM meta WHERE key=?').get(key);
        return row ? JSON.parse(row.value) : null;
      };
      const identity = record('identity');
      assert.equal(identity?.companionId, config.companionId, 'Installed Core database belongs to another companion');
      assert.equal(identity?.ownerActorId, config.ownerActorId, 'Installed Core owner does not match its configuration');
      assert.equal(meta('scope'), config.scopeId, 'Installed Core scope does not match its configuration');
      prefs = record('preferences'); binding = record('workspace-binding');
      owner = meta('memory-configured-directory-owner'); storedId = meta('workspace.storage-id');
    } finally { db.close(); }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  const target = prefs?.workspace;
  if (!target) return { state: 'unbound', reason: 'No selected workspace' };
  assert.ok(typeof target.id === 'string' && typeof target.path === 'string' && isAbsolute(target.path), 'Invalid saved workspace binding');
  const result = { target, configuredMemoryOwner: owner, storageId: within(target.path, config.dataDir) ? storedId ?? target.id : target.id };
  if (binding?.phase !== 'ready' || binding.target?.id !== target.id || binding.target?.path !== target.path)
    return { ...result, state: 'pending', reason: 'Selected workspace has not completed initialization' };
  const root = lstatSync(target.path, { throwIfNoEntry: false });
  if (!root) return { ...result, state: 'unavailable', reason: 'Selected workspace directory is absent' };
  assert.ok(root.isDirectory() && !root.isSymbolicLink() && realpathSync(target.path) === target.path, 'Workspace root must remain a local canonical directory');
  const managed = join(target.path, '.chatpet'), managedStat = lstatSync(managed, { throwIfNoEntry: false });
  if (!managedStat) return { ...result, state: 'pending', reason: 'Companion files are absent; initialize explicitly first' };
  assert.ok(managedStat.isDirectory() && !managedStat.isSymbolicLink(), 'Companion directory must not be a symlink');
  if (existsSync(join(managed, '.initialization-pending.json')))
    return { ...result, state: 'pending', reason: 'Workspace initialization is incomplete' };
  const manifestFile = join(managed, 'manifest.json'), manifestStat = lstatSync(manifestFile, { throwIfNoEntry: false });
  if (!manifestStat) return { ...result, state: 'pending', reason: 'Companion manifest is absent; initialize explicitly first' };
  assert.ok(manifestStat.isFile() && !manifestStat.isSymbolicLink() && manifestStat.nlink === 1, 'Invalid companion manifest');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  assert.equal(manifest.companionId, config.companionId, 'Initialized workspace belongs to another companion');
  assert.ok(manifest.schemaVersion === 3 && Array.isArray(manifest.files), 'Unexpected initialized workspace format');
  const required = ['README.md', 'manifest.json', 'SOUL.md', 'USER.md', 'core.json'];
  for (const name of new Set([...required, ...manifest.files])) {
    assert.ok(typeof name === 'string' && name && !isAbsolute(name) && !name.split(/[\\/]/).includes('..'), 'Invalid initialized file declaration');
    let path = managed;
    const parts = name.split('/').filter(Boolean);
    for (let index = 0; index < parts.length; index++) {
      path = join(path, parts[index]);
      const item = lstatSync(path, { throwIfNoEntry: false });
      if (!item) return { ...result, state: 'pending', reason: 'Declared companion structure is incomplete' };
      const directory = index < parts.length - 1 || name.endsWith('/');
      assert.ok(!item.isSymbolicLink() && (directory ? item.isDirectory() : item.isFile() && item.nlink === 1), 'Invalid initialized file type');
    }
  }
  return { ...result, state: 'ready', root: target.path };
}

/** Match the runtime's Bank selection; a stale external configured path is not
 * the current workspace's Bank. No missing Bank is initialized by the installer. */
export function boundMemoryDirectory(config, binding) {
  const root = binding.root, directory = config.memory?.dataDir;
  if (!directory) return null;
  const owner = binding.configuredMemoryOwner;
  const selected = (!owner || owner.id === binding.storageId) && within(root, directory)
    ? directory : join(root, '.chatpet', 'data', 'memory');
  let path = root;
  for (const part of relative(root, selected).split(sep)) {
    path = join(path, part);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    assert.ok(stat && stat.isDirectory() && !stat.isSymbolicLink(), 'Existing workspace Memory directory is absent or invalid; no new Bank was created');
  }
  const bank = lstatSync(join(selected, 'data', 'memory.db'), { throwIfNoEntry: false });
  assert.ok(bank && bank.isFile() && !bank.isSymbolicLink() && bank.nlink === 1 && bank.size > 0,
    'Existing workspace Memory Bank is absent or invalid; no new Bank was created');
  return selected;
}

export function assertStopped(directory, kind) {
  const file = join(directory, kind === 'core' ? 'core.lock' : kind === 'economy' ? 'economy.lock' : 'runtime/service.json');
  if (!existsSync(file)) return;
  const value = readFileSync(file, 'utf8');
  const pid = kind === 'core' || kind === 'economy' ? Number(value.split(':')[0]) : JSON.parse(value).pid;
  assert.ok(Number.isSafeInteger(pid) && pid > 0, `Invalid ${kind} owner record`);
  try { process.kill(pid, 0); }
  catch (error) { if (error.code === 'ESRCH') return; throw error; }
  throw new Error(`${kind} still has a live writer; quit DSH before relocating data`);
}

function treeSnapshot(directory) {
  const hashes = {};
  const directories = [];
  function visit(path) {
    const stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), `Symlink is not supported during relocation: ${path}`);
    if (stat.isDirectory()) {
      directories.push(relative(directory, path));
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    }
    else {
      assert.ok(stat.isFile(), `Non-regular data file: ${path}`);
      hashes[relative(directory, path)] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  }
  // lstat also detects a dangling symlink instead of treating it as absent.
  const stat = lstatSync(directory, { throwIfNoEntry: false });
  if (stat) visit(directory);
  return { hashes, directories };
}

export function fileHashes(directory) {
  return treeSnapshot(directory).hashes;
}

function assertCompatibleDestination(entry, source, destination) {
  if (entry.source === entry.target || destination.directories.length === 0) return;
  assert.equal(entry.kind, 'core', `Destination already exists; inspect it instead of merging: ${entry.target}`);
  // A destination-only journal/WAL must never be attached to the incoming DB.
  for (const name of ['core.sqlite', 'core.sqlite-wal', 'core.sqlite-shm', 'core.sqlite-journal'])
    if (Object.hasOwn(destination.hashes, name)) assert.ok(Object.hasOwn(source.hashes, name),
      `Destination has another Core database or sidecar; refuse to combine it: ${join(entry.target, name)}`);
  const folders = new Set(destination.directories);
  for (const folder of source.directories)
    assert.ok(!Object.hasOwn(destination.hashes, folder), `Destination file conflicts with source directory: ${join(entry.target, folder)}`);
  for (const [name, hash] of Object.entries(source.hashes)) {
    assert.ok(!folders.has(name), `Destination directory conflicts with source file: ${join(entry.target, name)}`);
    if (Object.hasOwn(destination.hashes, name)) assert.equal(destination.hashes[name], hash,
      name === 'core.sqlite' ? 'Destination has a different Core database; refuse to replace its identity'
        : `Destination has different stored bytes; refuse to overwrite: ${join(entry.target, name)}`);
  }
}

function checkedDestination(entry) {
  const stat = lstatSync(entry.target, { throwIfNoEntry: false });
  if (stat) assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `Destination is not a regular directory: ${entry.target}`);
  return treeSnapshot(entry.target);
}

function installExclusive(stage, target, source, previous) {
  // Never rename/remove an existing destination root. Each hard link installs
  // one fully copied file atomically and fails if another writer got there first.
  // Stage is a sibling on the same filesystem; cleanup leaves one target link.
  const existed = previous.directories.length > 0;
  if (!existed) mkdirSync(target, { mode: 0o700 });
  for (const name of source.directories) {
    if (!name) continue;
    const folder = join(target, name), stat = lstatSync(folder, { throwIfNoEntry: false });
    if (stat) assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `Destination directory changed: ${folder}`);
    else mkdirSync(folder, { mode: 0o700 });
  }
  let addedFiles = 0, identicalFiles = 0;
  for (const [name, hash] of Object.entries(source.hashes)) {
    const file = join(target, name), stat = lstatSync(file, { throwIfNoEntry: false });
    if (stat) {
      assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Destination file changed: ${file}`);
      assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), hash,
        `Destination changed; refuse to overwrite: ${file}`);
      identicalFiles++;
    } else {
      linkSync(join(stage, name), file);
      addedFiles++;
    }
  }
  assert.deepEqual(fileHashes(target), { ...previous.hashes, ...source.hashes }, 'Destination changed during relocation; existing files were retained');
  return { mode: existed ? 'merged' : 'copied', addedFiles, identicalFiles, preservedFiles: Object.keys(previous.hashes).length };
}

export function prepareRepoStorage(workspace, config, options = {}) {
  const root = realpathSync(workspace), managed = join(root, '.chatpet');
  assert.ok(lstatSync(managed).isDirectory() && !lstatSync(managed).isSymbolicLink(), 'Initialize the companion Repo first');
  const manifest = JSON.parse(readFileSync(join(managed, 'manifest.json'), 'utf8'));
  assert.equal(manifest.companionId, config.companionId, 'Storage Repo belongs to another companion');
  const data = join(managed, 'data');
  if (existsSync(data)) assert.ok(lstatSync(data).isDirectory() && !lstatSync(data).isSymbolicLink());
  const entries = [{ kind: 'core', source: resolve(config.dataDir), target: join(data, 'core') }];
  if (config.memory) {
    const target = options.memoryTarget ? resolve(options.memoryTarget) : join(data, 'memory');
    assert.ok(within(root, target), 'Memory destination must remain inside the initialized Repo');
    entries.push({ kind: 'memory', source: resolve(config.memory.dataDir), target });
  }
  for (const entry of entries) {
    const { source, target } = entry;
    assert.ok(existsSync(source), `Missing existing ${entry.kind} data; refuse to silently create a new identity/Bank`);
    assert.equal(realpathSync(source), source, 'Resolve source symlinks before migration');
    assert.ok(source === target || (!target.startsWith(source + sep) && !source.startsWith(target + sep)), 'Overlapping data directories');
    assert.ok(lstatSync(source).isDirectory(), `Existing ${entry.kind} source is not a directory`);
    const snapshot = treeSnapshot(source);
    if (entry.kind === 'core') assert.ok(Object.hasOwn(snapshot.hashes, 'core.sqlite'), 'Missing existing Core database; refuse to create a new identity');
    if (source !== target) assertCompatibleDestination(entry, snapshot, checkedDestination(entry));
  }
  return { root, data, entries };
}

export function relocateRepoStorage(plan) {
  // All writers and conflicts are checked before any copy. Source bytes and
  // destination-owned records remain intact; no deletion, replay or Bank reset.
  const snapshots = new Map();
  const destinations = new Map();
  for (const entry of plan.entries) {
    assert.ok(existsSync(entry.source), `Missing existing ${entry.kind} data; refuse to silently create a new identity/Bank`);
    assertStopped(entry.source, entry.kind);
    const source = treeSnapshot(entry.source);
    if (entry.kind === 'core') assert.ok(Object.hasOwn(source.hashes, 'core.sqlite'), 'Missing existing Core database; refuse to create a new identity');
    snapshots.set(entry.source, source);
    if (entry.source !== entry.target) {
      const destination = checkedDestination(entry);
      if (destination.directories.length) assertStopped(entry.target, entry.kind);
      assertCompatibleDestination(entry, source, destination);
      destinations.set(entry.target, destination);
    }
  }
  const ignore = join(plan.root, '.chatpet', '.gitignore');
  if (existsSync(ignore)) assert.ok(lstatSync(ignore).isFile() && !lstatSync(ignore).isSymbolicLink());
  const oldIgnore = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
  if (!oldIgnore.split(/\r?\n/).includes('/data/'))
    writeFileSync(ignore, oldIgnore + (oldIgnore && !oldIgnore.endsWith('\n') ? '\n' : '') + '/data/\n', { mode: 0o600 });
  mkdirSync(plan.data, { recursive: true, mode: 0o700 });
  const copied = [];
  for (const entry of plan.entries) {
    if (entry.source === entry.target) continue;
    const before = snapshots.get(entry.source), previous = destinations.get(entry.target);
    const stage = join(dirname(entry.target), `.relocate-${entry.kind}-${randomUUID()}`);
    try {
      cpSync(entry.source, stage, { recursive: true, dereference: false, errorOnExist: true, force: false });
      assert.deepEqual(treeSnapshot(stage), before, 'Copied bytes do not match source');
      assert.deepEqual(treeSnapshot(entry.source), before, 'Source changed during migration');
      assertStopped(entry.source, entry.kind);
      if (previous.directories.length) assertStopped(entry.target, entry.kind);
      assert.deepEqual(checkedDestination(entry), previous, 'Destination changed before relocation; existing files were retained');
      const receipt = installExclusive(stage, entry.target, before, previous);
      assert.deepEqual(treeSnapshot(entry.source), before, 'Source changed during migration');
      copied.push({ ...entry, ...receipt, files: Object.keys(before.hashes).length, hashes: before.hashes });
    } finally { if (existsSync(stage)) rmSync(stage, { recursive: true }); }
  }
  // Only a successful copy may add the portable Core declaration. Retrying
  // relocation also completes this step if the previous write was interrupted.
  // CoreStore refuses a missing DB whenever this Repo's manifest exists, so a
  // crash before this declaration cannot authorize a new empty Core either.
  const manifestFile = join(plan.root, '.chatpet', 'manifest.json');
  const manifestStat = lstatSync(manifestFile);
  assert.ok(manifestStat.isFile() && !manifestStat.isSymbolicLink() && manifestStat.nlink === 1, 'Invalid companion manifest');
  const previousManifest = readFileSync(manifestFile, 'utf8'), manifest = JSON.parse(previousManifest);
  if (manifest.schemaVersion === 3 && !manifest.files.includes('data/core/core.sqlite')) {
    const database = lstatSync(join(plan.data, 'core', 'core.sqlite'));
    assert.ok(database.isFile() && !database.isSymbolicLink() && database.nlink === 1 && database.size > 0,
      'Existing Core must be copied before declaring portable storage');
    manifest.files.push('data/core/core.sqlite');
    const temporary = join(dirname(manifestFile), `.manifest-relocate-${randomUUID()}.tmp`);
    try {
      const fd = openSync(temporary, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify(manifest, null, 2) + '\n'); fsyncSync(fd); }
      finally { closeSync(fd); }
      assert.equal(readFileSync(manifestFile, 'utf8'), previousManifest, 'Manifest changed during migration');
      renameSync(temporary, manifestFile);
      const directory = openSync(dirname(manifestFile), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } finally { if (existsSync(temporary)) rmSync(temporary); }
  }
  return copied;
}
