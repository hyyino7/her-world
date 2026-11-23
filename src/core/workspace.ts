import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { CoreRuntime } from './runtime.js';
import { preferences, type CorePreferences, type WorkspaceTarget } from './preferences.js';
import { EMPTY_COMPANION_CONFIGURATION, parseCompanionConfiguration, resolveCompanionSettings, type CompanionConfiguration, type CompanionSettings } from './companion-settings.js';
import { companionRecordPaths, initializeCompanionRecords } from './record-paths.js';
import { initializeCompanionFiles, inspectCompanionFiles, validateCompanionConfiguration } from './initialization.js';
import { memoryDirectory } from '../memory/client.js';
import { conversationOptions } from './options.js';
import type { CompanionIdentity, AttentionPolicy, WorkspaceEditScope } from '../contracts/core.js';
import type { ServiceCall } from '../contracts/common.js';
import { bytesDigest, canonical, check, reject, Rejection, revision, now } from './storage.js';
import { CONSOLE_WALLET_IMPORT_FILE, CONSOLE_WALLET_STEP, decodeMigrationJournal, ECONOMY_STORAGE_STEP, freshWalletImportProof,
  HOME_STORAGE_STEP, INITIAL_STORAGE_STEP, MIGRATION_REASON, MigrationBindingChanged, parseMigrationJournal, settled, storageManifest,
  storageManifestIndex, type MigrationReason } from './storage-migration.js';
import type { CompanionBinding } from './tables/companion-ports.js';

const BASE_REQUIRED = ['README.md', 'manifest.json', 'SOUL.md', 'USER.md', 'core.json'] as const;
const REQUIRED = [...BASE_REQUIRED, 'COMPANION.md'] as const;
const WORKSPACE_INSTRUCTIONS = `# Companion workspace

The companion documents are under .chatpet/. SOUL.md owns the configured name
and role; USER.md contains owner-provided information; COMPANION.md contains
optional interaction guidance. Blank documents are intentional and supply no
replacement persona. Self-description, its history and diaries belong to Core
and remain available without autonomous Life. Their selected paths are declared
in .chatpet/manifest.json, including compatible existing record locations.

core.json contains saved choices. Module databases and runtime data under data/
are storage, not documents to paste into a prompt. DSH owns native execution,
permissions and original sessions. Use registered memory capabilities for Bank
operations; do not create a parallel MEMORY.md or revive STATE.md. Preserve
existing workspace files and instructions.
`;
const MAX_BYTES = 64 * 1024;
const STORAGE_MANIFEST = 'storage-manifest.json', MIGRATION_JOURNAL = 'migrations.jsonl', INITIALIZING = '.initialization-pending.json';
const READABLE_FILES = new Set<string>([...REQUIRED, STORAGE_MANIFEST, MIGRATION_JOURNAL, CONSOLE_WALLET_IMPORT_FILE, INITIALIZING]);
const STORAGE_STEPS = [INITIAL_STORAGE_STEP, HOME_STORAGE_STEP, ECONOMY_STORAGE_STEP, CONSOLE_WALLET_STEP];
const BOOTSTRAP_FILES = new Set(['core.sqlite', 'core.sqlite-wal', 'core.sqlite-shm', 'core.sqlite-journal', 'core.lock']);
interface MigrationBlock { reason: MigrationReason }
interface Manifest { schemaVersion: 3; companionId: string; files: readonly string[] }
interface FileConfig { schemaVersion: 1; quiet: boolean | null; conversation: CorePreferences['conversation'] | null; companion?: CompanionConfiguration }
interface Binding { revision: number; target: WorkspaceTarget; phase: 'ready' | 'inactive'; hashes: Record<string, string>; initializedAt: string }
interface Documents { identity: Pick<CompanionIdentity, 'displayName' | 'character'>; user: string; config: FileConfig; hashes: Record<string, string> }
type InitializerFiles = readonly string[] | ((target: WorkspaceTarget) => readonly string[]);
export interface WorkspaceStatus {
  state: 'unbound' | 'pending' | 'ready' | 'unavailable' | 'migration-required'; revision: number | null;
  target: WorkspaceTarget | null; files: readonly string[]; error: string | null;
  sourceRevision: string | null;
  migrationReason?: MigrationReason;
}
type NativeSessionScope = { id: string; header: { cwd?: string; parentSession?: unknown; origin?: string; agentPreset?: string } };
type NativeWorkspaceRegistry = { get(id: string): { path: string; sessionIds: readonly string[] } | undefined };
export interface WorkspaceService {
  inspect: ServiceCall<Record<string, never>, WorkspaceStatus>;
  initialize: ServiceCall<{ expectedPreferencesRevision: number }, WorkspaceStatus>;
  readProfile: ServiceCall<Record<string, never>, { revision: number; text: string }>;
  saveCompanion: ServiceCall<{ workspaceId: string; expectedSettings: CompanionConfiguration; settings: CompanionConfiguration }, CompanionConfiguration>;
  saveProfile: ServiceCall<{ expectedScope: WorkspaceEditScope; expectedRevision: number; text: string }, { revision: number; text: string }>;
  readFoundation: ServiceCall<Record<string, never>, CompanionFoundation>;
  saveFoundation: ServiceCall<{ workspaceId: string; expectedRevision: string; text: string }, CompanionFoundation>;
}
export interface CompanionFoundation { text: string; revision: string; source: 'empty' | 'owner'; path: string }
export interface HomeBinding extends CompanionBinding { bootId: string; generation: number }
export interface HomeRecord { sessionId: string; arrivalPending?: true }

function validHome(record: HomeRecord): boolean {
  return typeof record?.sessionId === 'string' && record.sessionId.trim().length > 0 && !record.sessionId.includes('\0')
    && (record.arrivalPending === undefined || record.arrivalPending === true)
    && Object.keys(record).every(key => key === 'sessionId' || key === 'arrivalPending');
}

/** Core-owned repository authority; module runtime data has its own writers. */
export class CoreWorkspace {
  readonly port: WorkspaceService;
  private readonly initializers = new Map<string, {run: (target: WorkspaceTarget) => void; files: InitializerFiles}>();
  private migrationBlocked?: { target: WorkspaceTarget; block: MigrationBlock };
  private homeGeneration = 0;
  private committedTarget: WorkspaceTarget | null;
  constructor(readonly runtime: CoreRuntime) {
    this.committedTarget = preferences(runtime).workspace;
    this.port = {
      inspect: runtime.call('workspace.inspect', false, () => this.status()),
      initialize: runtime.call('workspace.initialize', true, input => {
        const prefs = preferences(runtime); revision(prefs.revision, input.expectedPreferencesRevision);
        check(prefs.workspace !== null, 'Choose a workspace first');
        this.initialize(prefs.workspace); return this.status();
      }),
      saveCompanion: runtime.call('workspace.saveCompanion', true, input => {
        const binding = this.binding();
        if (!binding || binding.target.id !== input.workspaceId) reject('STALE_BINDING', 'Workspace binding changed');
        const settings = parseCompanionConfiguration(input.settings);
        const docs = this.documents(binding.target);
        if (canonical(input.expectedSettings) !== canonical(docs.config.companion ?? EMPTY_COMPANION_CONFIGURATION))
          reject('STALE_REVISION', 'Companion settings changed');
        this.replace(binding, 'core.json', JSON.stringify({ ...docs.config, companion: settings }, null, 2) + '\n');
        return settings;
      }),
      readProfile: runtime.call('workspace.readProfile', false, () => runtime.store.get<{ revision: number; text: string }>('profile', 'current') ?? { revision: 1, text: '' }),
      saveProfile: runtime.call('workspace.saveProfile', true, input => {
        this.assertEditScope(input.expectedScope);
        check(typeof input.text === 'string' && Buffer.byteLength(input.text) <= MAX_BYTES, 'Invalid user profile');
        const current = runtime.store.get<{ revision: number; text: string }>('profile', 'current') ?? { revision: 1, text: '' };
        revision(current.revision, input.expectedRevision);
        const binding = this.binding(); check(binding !== null, 'Initialize the workspace first');
        this.replace(binding, 'USER.md', input.text);
        const value = { revision: current.revision + 1, text: input.text }; runtime.store.put('profile', 'current', value); return value;
      }, input => this.assertEditScope(input.expectedScope)),
      readFoundation: runtime.call('workspace.readFoundation', false, () => this.foundation()),
      saveFoundation: runtime.call('workspace.saveFoundation', true, input => {
        const current = this.foundation(), binding = this.binding();
        if (!binding || binding.target.id !== input.workspaceId) reject('STALE_BINDING', 'Workspace binding changed');
        if (current.revision !== input.expectedRevision) reject('STALE_REVISION', 'Foundation changed; refresh before saving');
        check(typeof input.text === 'string', 'Invalid companion foundation');
        check(Buffer.byteLength(input.text) <= MAX_BYTES, 'Companion foundation is too large');
        this.atomic(this.directory(binding.target), 'COMPANION.md', input.text);
        this.runtime.fileEffect = true;
        return this.foundation();
      }),
    };
  }
  /** Captured by the editor, then checked inside the original synchronous
   * configuration mutation. No new binding generation or durable state. */
  editScope(): WorkspaceEditScope {
    const prefs=preferences(this.runtime);
    return {preferencesRevision:prefs.revision,workspaceId:prefs.workspace?.id??null,
      storageId:prefs.workspace?this.storageId():null};
  }
  assertEditScope(expected: WorkspaceEditScope): void {
    check(expected && typeof expected==='object' && !Array.isArray(expected)
      && Object.keys(expected).length===3 && Number.isSafeInteger(expected.preferencesRevision) && expected.preferencesRevision>0
      && (expected.workspaceId===null || typeof expected.workspaceId==='string' && expected.workspaceId.length>0)
      && (expected.storageId===null || typeof expected.storageId==='string' && expected.storageId.length>0),'Invalid workspace editor scope');
    if(canonical(expected)!==canonical(this.editScope()))reject('STALE_BINDING','Workspace editor binding changed; refresh before saving');
  }
  private binding(): Binding | null {
    const binding = this.runtime.store.get<Binding>('workspace-binding', 'current');
    const target = preferences(this.runtime).workspace;
    return binding?.phase === 'ready' && target?.id === binding.target.id && target.path === binding.target.path ? binding : null;
  }
  configurationCommitted(operation: string): void {
    if (operation !== 'workspace.initialize' && operation !== 'preferences.save') return;
    const target = preferences(this.runtime).workspace, previous = this.committedTarget;
    if (operation === 'workspace.initialize' || target?.id !== previous?.id || target?.path !== previous?.path)
      this.homeGeneration++;
    this.committedTarget = target;
  }
  homeScope(): HomeBinding | undefined {
    const {state,target} = this.status();
    if (state === 'ready' && target) return {workspaceId:target.id,path:target.path,storageId:this.storageId(),
      bootId:this.runtime.bootId,generation:this.homeGeneration};
  }
  readCompanionHome(scope: HomeBinding): Readonly<HomeRecord> | undefined {
    const current = this.homeScope();
    if (!current || !isDeepStrictEqual(scope,current)) reject('STALE_BINDING', 'Companion home binding changed');
    const record = this.runtime.store.get<HomeRecord>('companion-home', scope.storageId);
    check(record === undefined || validHome(record), 'Companion home record is invalid');
    return record;
  }
  writeCompanionHome(scope: HomeBinding, expected: HomeRecord | undefined, next: HomeRecord): void {
    this.runtime.store.transaction(() => {
      if (!isDeepStrictEqual(this.readCompanionHome(scope), expected)) reject('CONFLICT', 'Companion home changed');
      check(validHome(next), 'Companion home record is invalid');
      this.runtime.store.put('companion-home', scope.storageId, next);
    });
  }
  private directory(target: WorkspaceTarget): string {
    check(realpathSync(target.path) === target.path && lstatSync(target.path).isDirectory(), 'Workspace root changed');
    const directory = join(target.path, '.chatpet');
    const stat = lstatSync(directory, {throwIfNoEntry: false});
    if (stat) check(stat.isDirectory() && !stat.isSymbolicLink(), 'Managed directory must not be a symlink');
    return directory;
  }
  private read(directory: string, name: string, offlineManifest = false): string {
    check(READABLE_FILES.has(name), 'Unknown managed file');
    const fd = openSync(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd);
      check(before.isFile() && before.nlink === 1 && (offlineManifest || name === MIGRATION_JOURNAL || before.size <= MAX_BYTES), 'Managed file is not a regular file of the expected size');
      const bytes = readFileSync(fd); const after = fstatSync(fd);
      check(before.size === after.size && before.mtimeMs === after.mtimeMs && bytes.length === after.size, 'Managed file changed while reading');
      return offlineManifest ? bytes.toString('utf8') : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } finally { closeSync(fd); }
  }
  private initializationMarker(workspaceId: string) {
    const {companionId, scopeId} = this.runtime.config;
    return {companionId, scopeId, workspaceId, modules:CONSOLE_WALLET_STEP.to};
  }
  private retainedFiles(directory: string): boolean {
    return readdirSync(directory, {withFileTypes:true}).some(entry => {
      if (directory === this.runtime.store.directory && entry.isFile() && BOOTSTRAP_FILES.has(entry.name)) return false;
      return !entry.isDirectory() || this.retainedFiles(join(directory, entry.name));
    });
  }
  private inspectMigration(target: WorkspaceTarget, storageId: string, initialized: boolean): MigrationBlock | undefined {
    const {companionId} = this.runtime.config;
    let data: string, version = -1, directory: string;
    try {
      if (!lstatSync(target.path, {throwIfNoEntry:false})) return;
      directory = this.directory(target);
      data = join(directory, 'data');
      const stat = lstatSync(data, {throwIfNoEntry:false});
      if (stat && !stat.isDirectory()) return {reason:MIGRATION_REASON.manifestMismatch};
      if (stat && lstatSync(join(data, STORAGE_MANIFEST), {throwIfNoEntry:false})) {
        version = storageManifestIndex(JSON.parse(this.read(data, STORAGE_MANIFEST)), companionId, STORAGE_STEPS);
        if (version < 0) return {reason:MIGRATION_REASON.manifestMismatch};
      }
    } catch { return {reason:MIGRATION_REASON.manifestMismatch}; }
    let imported = false;
    try {
      if (lstatSync(join(data, MIGRATION_JOURNAL), {throwIfNoEntry:false})) {
        const {last, truncated} = decodeMigrationJournal(parseMigrationJournal(this.read(data, MIGRATION_JOURNAL)), storageId);
        if (!last && truncated) return {reason:MIGRATION_REASON.journalInvalid};
        if (last && !isDeepStrictEqual(last.header.steps, STORAGE_STEPS.slice(0, last.header.steps.length)))
          return {reason:MIGRATION_REASON.journalStepMismatch};
        if (last && !settled(last)) {
          if (last.header.binding && last.header.binding.repoHash !== bytesDigest(Buffer.from(target.path)).slice(7)) return {reason:MIGRATION_REASON.bindingChanged};
          return {reason:MIGRATION_REASON.migrationIncomplete};
        }
        const importProof = last?.header.walletImport?.proof;
        if (importProof && importProof.binding.companionId !== companionId) return {reason:MIGRATION_REASON.bindingChanged};
        if (importProof && truncated) return {reason:MIGRATION_REASON.journalInvalid};
        imported = !!importProof;
      }
    } catch (error) { return {reason:error instanceof MigrationBindingChanged ? MIGRATION_REASON.bindingChanged : MIGRATION_REASON.journalInvalid}; }
    if (version === STORAGE_STEPS.length - 1) {
      if (imported) return;
      try {
        const proof: unknown = JSON.parse(this.read(data, CONSOLE_WALLET_IMPORT_FILE));
        if (isDeepStrictEqual(proof, freshWalletImportProof({companionId, storageId}))) return;
      } catch { /* A current manifest without its initialization proof is incomplete. */ }
      return {reason:MIGRATION_REASON.migrationIncomplete};
    }
    if (version >= 0) return {reason:MIGRATION_REASON.storageVersionOutdated};
    try {
      if (lstatSync(join(directory, INITIALIZING), {throwIfNoEntry:false})) {
        const marker: unknown = JSON.parse(this.read(directory, INITIALIZING));
        if (isDeepStrictEqual(marker, this.initializationMarker(target.id))) return;
        return {reason:MIGRATION_REASON.storageVersionOutdated};
      }
      if ((initialized && existsSync(directory)) || [...REQUIRED, 'STATE.md', 'self.md', 'diary', 'self.history', 'data'].some(name => {
        const path = join(directory, name), stat = lstatSync(path, {throwIfNoEntry:false});
        return stat && (!stat.isDirectory() || this.retainedFiles(path));
      })) return {reason:MIGRATION_REASON.storageVersionOutdated};
    } catch { return {reason:MIGRATION_REASON.manifestMismatch}; }
  }
  /** Match the binding and declared inventory accepted by inspectRepoBinding. */
  private offlineBindingReady(target: WorkspaceTarget): boolean {
    const binding = this.binding(), {config, store} = this.runtime;
    if (binding?.target.id !== target.id || binding.target.path !== target.path || !store.persisted()) return false;
    const identity = store.get<CompanionIdentity>('identity', 'current');
    if (identity?.companionId !== config.companionId || identity.ownerActorId !== config.ownerActorId || store.meta('scope') !== config.scopeId) return false;
    try {
      for (const name of ['core.sqlite', 'core.sqlite-wal', 'core.sqlite-journal', 'core.lock']) {
        const stat = lstatSync(join(store.directory, name), {throwIfNoEntry:false});
        if (stat && (!stat.isFile() || stat.nlink !== 1)) return false;
      }
      const directory = this.directory(target);
      if (existsSync(join(directory, INITIALIZING))) return false;
      const manifest = JSON.parse(this.read(directory, 'manifest.json', true)) as Manifest;
      if (manifest.companionId !== config.companionId || manifest.schemaVersion !== 3 || !Array.isArray(manifest.files)) return false;
      this.verifyDeclaredFiles(directory, [...new Set([...BASE_REQUIRED, ...manifest.files])]);
      return true;
    } catch { return false; }
  }
  private migrationBlockFor(target: WorkspaceTarget, initialized = false, remember = false): MigrationBlock | undefined {
    const block = this.inspectMigration(target, this.storageIdFor(target), initialized);
    if (!block) return;
    if (remember) this.migrationBlocked = {target, block};
    return this.offlineBindingReady(target) ? block : {reason:MIGRATION_REASON.bindingNotMigratable};
  }
  private migrationBlock(): MigrationBlock | undefined {
    const blocked = this.migrationBlocked;
    // Keep the process gate until restart while the recorded binding is available.
    if (blocked && this.offlineBindingReady(blocked.target)) return blocked.block;
    const store = this.runtime.store, saved = store.get<Binding>('workspace-binding', 'current');
    const selected = preferences(this.runtime).workspace, portable = dirname(dirname(dirname(store.directory)));
    let prior = saved?.target;
    if (store.directory === join(portable, '.chatpet', 'data', 'core') && (!prior ||
      existsSync(join(portable, '.chatpet/manifest.json')) &&
      (!existsSync(join(prior.path, '.chatpet')) || existsSync(join(prior.path, '.chatpet/data/core/core.sqlite')))))
      prior = {id:prior?.id ?? selected?.id ?? '', path:portable, title:''};
    return prior && this.migrationBlockFor(prior, saved?.phase === 'ready', true)
      || selected && selected.path !== prior?.path && selected.path !== saved?.target.path
        && this.migrationBlockFor(selected, false, true) || undefined;
  }
  migrationReason(): MigrationReason | undefined { return this.migrationBlock()?.reason; }
  assertMigrationReady(target?: WorkspaceTarget | null): void {
    const reason = this.migrationReason() || (target && this.migrationBlockFor(target)?.reason);
    if (reason) throw new Rejection({code:'migration-required', reason, message:'migration-required', effect:'none', retry:'never'});
  }
  retainedWritesAllowed(workspaceId: string, path: string, storageId: string): boolean {
    return !this.migrationReason() && existsSync(join(path, '.chatpet')) && !this.inspectMigration({id:workspaceId,path,title:''}, storageId, true);
  }
  private atomic(directory: string, name: string, value: string): void {
    check(Buffer.byteLength(value) <= MAX_BYTES, 'Managed file exceeds size limit');
    const file = join(directory, name);
    if (existsSync(file)) check(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Refusing to replace a non-regular managed file');
    const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
    try { renameSync(temporary, file); const dir = openSync(directory, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); } }
    finally { if (existsSync(temporary)) rmSync(temporary); }
  }
  private soul(identity: Pick<CompanionIdentity, 'displayName' | 'character'>): string {
    check(typeof identity.displayName === 'string' && identity.displayName.length <= 256 && !/[\r\n]/.test(identity.displayName), 'Role name must be one line');
    check(typeof identity.character === 'string' && identity.character.length <= MAX_BYTES - 1024, 'Invalid role text');
    return `# ${identity.displayName}\n\n${identity.character}`;
  }
  private documents(target: WorkspaceTarget): Documents {
    const directory = this.directory(target);
    const manifestText = this.read(directory, 'manifest.json');
    const manifest = JSON.parse(manifestText) as Manifest;
    check(manifest.companionId === this.runtime.config.companionId, 'Workspace belongs to a different companion');
    check(manifest.schemaVersion === 3 && Array.isArray(manifest.files) && REQUIRED.every(name => manifest.files.includes(name))
      && manifest.files.every(name => typeof name === 'string' && name.length > 0 && !isAbsolute(name) && !name.split(/[\\/]/).includes('..')),
      'Unexpected managed format or file declaration');
    const soul = this.read(directory, 'SOUL.md'); const match = soul.trim() === '' ? ['', '', ''] : /^# ([^\r\n]*)\r?\n\r?\n([\s\S]*)$/.exec(soul);
    check(match, 'SOUL.md requires a role heading, a blank line and character text');
    const identity = { displayName: match![1], character: match![2] }; this.soul(identity);
    const user = this.read(directory, 'USER.md');
    const configText = this.read(directory, 'core.json'); const raw = JSON.parse(configText) as FileConfig;
    check(raw.schemaVersion === 1 && (raw.quiet === null || typeof raw.quiet === 'boolean') && Object.keys(raw).every(key => ['conversation', 'quiet', 'schemaVersion', 'companion'].includes(key)), 'Invalid core.json');
    const conversation = raw.conversation === null ? null : conversationOptions(raw.conversation);
    check(raw.conversation === null || raw.conversation && canonical(Object.keys(raw.conversation).filter(key=>key!=='maxHistoryMessages').sort()) === canonical(Object.keys(conversation!).sort()), 'Invalid conversation configuration');
    return { identity, user, config: { schemaVersion: 1, quiet: raw.quiet, conversation, ...(Object.hasOwn(raw, 'companion') ? { companion: parseCompanionConfiguration(raw.companion) } : {}) }, hashes: {
      'manifest.json': bytesDigest(Buffer.from(manifestText)), 'SOUL.md': bytesDigest(Buffer.from(soul)),
      'USER.md': bytesDigest(Buffer.from(user)), 'core.json': bytesDigest(Buffer.from(configText)),
    } };
  }
  storageId(): string {
    const target=preferences(this.runtime).workspace;
    check(target,'A bound workspace is required');
    return this.storageIdFor(target);
  }
  private storageIdFor(target: WorkspaceTarget): string {
    const local=relative(target.path,this.runtime.store.directory);
    const owns=!isAbsolute(local) && local!=='..' && !local.startsWith('..'+sep);
    return owns ? this.runtime.store.meta<string>('workspace.storage-id') ?? target.id : target.id;
  }
  /** Module-owned synchronous schema preparation, never a service start. */
  registerInitializer(id: string, run: (target: WorkspaceTarget) => void, files: InitializerFiles = []): () => void {
    check(!this.initializers.has(id), 'Workspace initializer already registered');
    if (typeof files !== 'function') this.validateInventory(files);
    this.initializers.set(id, {run, files});
    return () => { this.initializers.delete(id); };
  }
  private validateInventory(files: readonly string[]) {
    check(Array.isArray(files) && files.every(name => typeof name === 'string' && name.length > 0 && !isAbsolute(name)
      && !name.split(/[\\/]/).includes('..')), 'Invalid initializer inventory');
  }
  private inventory(target: WorkspaceTarget): string[] {
    const root = this.directory(target), paths = companionRecordPaths(target.path);
    const local = (path: string) => relative(root, path).split(sep).join('/');
    const manifest = JSON.parse(this.read(root, 'manifest.json')) as Manifest;
    // Document readiness permits the one existing bootstrap Core to remain
    // outside the Repo until stopped/offline relocation. Never advertise a
    // second database, or forget a previously declared portable authority.
    const core = this.runtime.store.directory === join(root, 'data', 'core') || manifest.files.includes('data/core/core.sqlite');
    return [...new Set([...REQUIRED, local(paths.selfFile), local(paths.diaryDir) + '/', local(paths.historyDir) + '/',
      local(join(paths.photoDirectory, 'photos', 'album.sqlite')), ...inspectCompanionFiles(target.path),
      ...(core ? ['data/core/core.sqlite'] : []),
      ...[...this.initializers.values()].flatMap(entry => {
        const files = typeof entry.files === 'function' ? entry.files(target) : entry.files;
        this.validateInventory(files); return [...files];
      })])];
  }
  private verifyInventory(target: WorkspaceTarget): string[] {
    const directory = this.directory(target);
    const manifest = JSON.parse(this.read(directory, 'manifest.json')) as Manifest;
    const files = [...new Set([...manifest.files, ...this.inventory(target)])];
    this.verifyDeclaredFiles(directory, files, true);
    validateCompanionConfiguration(target.path);
    return files;
  }
  private verifyDeclaredFiles(directory: string, files: readonly string[], requireDatabaseSchema = false): void {
    this.validateInventory(files);
    const inspected = new Set<string>();
    for (const name of files) {
      const components = name.split('/').filter(Boolean); let path = directory;
      for (let index = 0; index < components.length; index++) {
        path = join(path, components[index]);
        const folder = index < components.length - 1 || name.endsWith('/');
        const key = folder ? path + '/' : path;
        if (inspected.has(key)) continue;
        const stat = lstatSync(path, {throwIfNoEntry: false});
        check(stat && !stat.isSymbolicLink() && (folder ? stat.isDirectory() : stat.isFile() && stat.nlink === 1), 'Managed workspace is incomplete');
        if (requireDatabaseSchema && !folder && /\.(?:sqlite|db)$/.test(name)) check(stat.size > 0, 'Managed database has no schema');
        inspected.add(key);
      }
    }
  }
  private initialize(target: WorkspaceTarget): void {
    this.assertMigrationReady(target);
    const directory = this.directory(target), store = this.runtime.store;
    const identity = store.require<CompanionIdentity>('identity', 'current');
    const previous = store.get<Binding>('workspace-binding', 'current');
    const config: FileConfig = {schemaVersion: 1, quiet: null, conversation: null, companion: {...EMPTY_COMPANION_CONFIGURATION}};
    if (!existsSync(directory)) { mkdirSync(directory, {mode: 0o700}); this.runtime.fileEffect = true; }
    const manifestExists = existsSync(join(directory, 'manifest.json'));
    if (manifestExists) {
      const manifest = JSON.parse(this.read(directory, 'manifest.json')) as Manifest;
      check(manifest.companionId === identity.companionId, 'Workspace belongs to a different companion');
      check(manifest.schemaVersion === 3, 'Unexpected managed format');
    }
    // Files survive a database rollback. Record this version and binding
    // before creating any companion data, so only this initialization can retry.
    const pending = join(directory, INITIALIZING), marker = this.initializationMarker(target.id);
    if (existsSync(pending)) {
      const previousMarker: unknown = JSON.parse(this.read(directory, INITIALIZING));
      check(isDeepStrictEqual(previousMarker, marker), 'Initialization scope changed');
    } else this.atomic(directory, INITIALIZING, JSON.stringify(marker) + '\n');
    this.runtime.fileEffect = true;
    if (!manifestExists) {
      const known = previous?.target.id === target.id && previous.target.path === target.path;
      check(known || !BASE_REQUIRED.some(name => name !== 'manifest.json' && existsSync(join(directory, name))),
        'Managed documents have no identity manifest; preserve and reconcile them before initialization');
      this.atomic(directory, 'manifest.json', JSON.stringify({schemaVersion: 3, companionId: identity.companionId, files: REQUIRED}, null, 2) + '\n');
      this.runtime.fileEffect = true;
    }
    const initialDocuments = {
      'README.md': '# Companion workspace\n\nSOUL.md contains the configured role, USER.md the owner profile, and COMPANION.md optional guidance.\nCore owns self-description and diaries; their canonical paths are listed in manifest.json.\ncore.json preserves saved choices; null means unconfigured. Module-owned storage lives under data/.\nDSH owns accounts, permissions and original sessions; portable full log copies live in data/core/native-sessions/.\nEmpty personal content is valid. Initialization never creates experiences or starts autonomous Life.\n',
      'SOUL.md': this.soul(identity), 'USER.md': store.get<{text: string}>('profile', 'current')?.text ?? '',
      'COMPANION.md': '', 'core.json': JSON.stringify(config, null, 2) + '\n',
    };
    for (const [name, value] of Object.entries(initialDocuments)) if (!existsSync(join(directory, name))) {
      this.atomic(directory, name, value); this.runtime.fileEffect = true;
    }
    // Validate saved content before any module schema or compatibility work.
    let docs = this.documents(target);
    const local = relative(target.path, this.runtime.store.directory);
    if (!isAbsolute(local) && local !== '..' && !local.startsWith('..' + sep) && !store.meta('workspace.storage-id')) {
      const owner = store.meta<{id: string}>('memory-configured-directory-owner');
      store.setMeta('workspace.storage-id', owner?.id ?? previous?.target.id ?? target.id);
    }
    const binding: Binding = {revision: (previous?.revision ?? 0) + 1, target, phase: 'ready', hashes: docs.hashes,
      initializedAt: previous?.initializedAt ?? now()};
    store.put('workspace-binding', 'current', binding);
    try {
      initializeCompanionFiles(target.path, {companionId: identity.companionId, scopeId: this.runtime.config.scopeId,
        storageId: this.storageId()});
      initializeCompanionRecords(target.path);
      for (const entry of this.initializers.values()) entry.run(target);
      const manifest: Manifest = {schemaVersion: 3, companionId: identity.companionId, files: this.inventory(target)};
      const content = JSON.stringify(manifest, null, 2) + '\n';
      if (this.read(directory, 'manifest.json') !== content) { this.atomic(directory, 'manifest.json', content); this.runtime.fileEffect = true; }
      // Existing root instructions are retained; fresh ones are minimal navigation.
      let instructions: number | undefined;
      try { instructions = openSync(join(target.path, 'AGENTS.md'), 'wx', 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      if (instructions !== undefined) {
        try { writeFileSync(instructions, WORKSPACE_INSTRUCTIONS); fsyncSync(instructions); }
        finally { closeSync(instructions); }
        this.runtime.fileEffect = true;
      }
      docs = this.documents(target); binding.hashes = docs.hashes;
      this.verifyInventory(target);
      const data = join(directory, 'data');
      if (!existsSync(join(data, STORAGE_MANIFEST))) {
        const proof = freshWalletImportProof({companionId:identity.companionId, storageId:this.storageId()});
        if (existsSync(join(data, CONSOLE_WALLET_IMPORT_FILE)))
          check(isDeepStrictEqual(JSON.parse(this.read(data, CONSOLE_WALLET_IMPORT_FILE)), proof), 'Wallet initialization proof changed');
        else this.atomic(data, CONSOLE_WALLET_IMPORT_FILE, JSON.stringify(proof) + '\n');
        this.atomic(data, STORAGE_MANIFEST, JSON.stringify(storageManifest(identity.companionId, CONSOLE_WALLET_STEP.to)) + '\n');
      }
      store.put('workspace-binding', 'current', binding); this.adopt(docs);
      rmSync(pending);
    } catch (error) {
      // Files are not transactional. A retry fills the same inventory, never resets it.
      store.put('workspace-binding', 'current', {...binding, phase: 'inactive'});
      throw error;
    }
  }
  private adopt(docs: Documents): void {
    const store = this.runtime.store, identity = store.require<CompanionIdentity>('identity', 'current');
    if (identity.displayName !== docs.identity.displayName || identity.character !== docs.identity.character)
      store.put('identity', 'current', { ...identity, ...docs.identity, revision: identity.revision + 1 });
    const policy = this.runtime.policy();
    if (docs.config.quiet !== null && policy.quiet !== docs.config.quiet) store.put('policy', 'current', { ...policy, quiet: docs.config.quiet, revision: policy.revision + 1 });
    const prefs = preferences(this.runtime);
    if (docs.config.conversation !== null && canonical(prefs.conversation) !== canonical(docs.config.conversation))
      store.put('preferences', 'current', { ...prefs, conversation: docs.config.conversation, revision: prefs.revision + 1 });
    const user = store.get<{ revision: number; text: string }>('profile', 'current');
    if (user?.text !== docs.user) store.put('profile', 'current', { revision: (user?.revision ?? 0) + 1, text: docs.user });
  }
  synchronize(operation: string): void {
    if (['workspace.initialize', 'workspace.inspect'].includes(operation) || this.migrationReason()) return;
    if (operation === 'reviseIdentity') {
      const target = preferences(this.runtime).workspace;
      // An absent managed directory permits local role setup. An existing but
      // invalid directory/document must still fail instead of pretending to save.
      if (target && !lstatSync(this.directory(target), {throwIfNoEntry: false})) return;
    }
    // The control plane must stay available when the Repo or its managed
    // documents disappear. Cached identity/policy are configuration metadata,
    // not permission to inject context or recreate the missing files.
    if (['preferences.read', 'preferences.save', 'getIdentity', 'getPolicy', 'listCapabilities', 'workspace.readProfile'].includes(operation)
      && this.status().state !== 'ready') return;
    const binding = this.binding(); if (!binding) return;
    const docs = this.documents(binding.target);
    if (canonical(docs.hashes) !== canonical(binding.hashes)) this.runtime.store.transaction(() => {
      this.adopt(docs); this.runtime.store.put('workspace-binding', 'current', { ...binding, revision: binding.revision + 1, hashes: docs.hashes });
    });
  }
  private replace(binding: Binding, name: string, value: string): void {
    const directory = this.directory(binding.target), docs = this.documents(binding.target);
    if (canonical(docs.hashes) !== canonical(binding.hashes)) reject('STALE_REVISION', 'Workspace files changed; refresh settings');
    this.atomic(directory, name, value); this.runtime.fileEffect = true;
    binding.hashes = { ...binding.hashes, [name]: bytesDigest(Buffer.from(value)) }; binding.revision++;
    this.runtime.store.put('workspace-binding', 'current', binding);
  }
  write(kind: 'identity' | 'policy' | 'preferences', value: CompanionIdentity | AttentionPolicy | CorePreferences): void {
    this.assertMigrationReady(kind === 'preferences' ? (value as CorePreferences).workspace : undefined);
    const binding = this.binding(); if (!binding) return;
    if (kind === 'identity') {
      if (!lstatSync(this.directory(binding.target), {throwIfNoEntry: false})) return;
      this.replace(binding, 'SOUL.md', this.soul(value as CompanionIdentity)); return;
    }
    if (kind === 'preferences' && ((value as CorePreferences).workspace?.id !== binding.target.id || (value as CorePreferences).workspace?.path !== binding.target.path)) return;
    // Saving/rebinding host preferences is still possible before explicit
    // initialization; it must not restore a missing Repo as a side effect.
    if (kind === 'preferences' && this.status().state !== 'ready') return;
    const docs = this.documents(binding.target);
    const config = { ...docs.config, ...(kind === 'policy' ? { quiet: (value as AttentionPolicy).quiet } : { conversation: (value as CorePreferences).conversation }) };
    this.replace(binding, 'core.json', JSON.stringify(config, null, 2) + '\n');
  }
  /** One workspace membership check shared by native Core, Memory, Emotion and Desktop. */
  sessionStatus(session: NativeSessionScope, registry: NativeWorkspaceRegistry | undefined): WorkspaceStatus | null {
    if (session.header.parentSession || session.header.origin === 'subagent' || session.header.agentPreset === 'chatpet-channel-guest') return null;
    const target = preferences(this.runtime).workspace;
    if (!target || (session.header.cwd && session.header.cwd !== target.path)) return null;
    const native = registry?.get(target.id);
    if (native?.path !== target.path || !native.sessionIds.includes(session.id)) return null;
    return this.status();
  }
  companionConfiguration(): CompanionConfiguration {
    const binding = this.binding();
    check(binding, 'Initialize the workspace first');
    return this.documents(binding.target).config.companion ?? {...EMPTY_COMPANION_CONFIGURATION};
  }
  companionSettings(): CompanionSettings {
    return resolveCompanionSettings(this.companionConfiguration());
  }
  /** Inspect actual storage, independently of document/binding readiness. Never
   * move a live database or make a configured fallback look already migrated. */
  storageStatus() {
    const target = preferences(this.runtime).workspace;
    const expectedCore = target ? join(target.path, '.chatpet', 'data', 'core') : null;
    const core = {current:this.runtime.store.directory, expected:expectedCore,
      ready:Boolean(expectedCore && this.runtime.store.directory === expectedCore && this.runtime.store.persisted())};
    const config = this.runtime.config.memory;
    const owner = this.runtime.store.meta<{id:string}>('memory-configured-directory-owner');
    const currentMemory = config && target ? memoryDirectory(config, target.path, !owner || owner.id === this.storageId()) : null;
    const expectedMemory = target ? join(target.path, '.chatpet', 'data', 'memory') : null;
    const memoryLocal = currentMemory && target ? relative(target.path, currentMemory) : null;
    const memory = config ? {configured:config.dataDir, current:currentMemory, expected:expectedMemory,
      ready:Boolean(currentMemory && memoryLocal && !isAbsolute(memoryLocal) && memoryLocal !== '..' && !memoryLocal.startsWith('..' + sep)
        && config.dataDir === currentMemory && existsSync(join(currentMemory, 'data', 'memory.db')))} : null;
    const configuredCwd = (this.runtime.config as typeof this.runtime.config & {cwd?:string}).cwd ?? null;
    const workingDirectory = {configured:configuredCwd, expected:target?.path ?? null,
      ready:Boolean(target && (!configuredCwd || configuredCwd === target.path))};
    const runtime = config ? {python:config.python, directory:config.runtimeRoot ?? null, ready:false} : null;
    if (runtime?.directory) {
      try {
        const root = realpathSync(runtime.directory), python = realpathSync(runtime.python), local = relative(root, python);
        const receipt = JSON.parse(readFileSync(join(root, 'runtime.json'), 'utf8')) as {state?:string; python?:string};
        const inRepo = target ? relative(target.path, root) : null;
        runtime.ready = receipt.state === 'ready' && receipt.python === runtime.python && Boolean(local)
          && !isAbsolute(local) && local !== '..' && !local.startsWith('..' + sep)
          && Boolean(!target || inRepo && (isAbsolute(inRepo) || inRepo === '..' || inRepo.startsWith('..' + sep)));
      } catch { /* Device setup remains incomplete; settings must still open. */ }
    }
    return {complete:core.ready && (!memory || memory.ready) && (!runtime || runtime.ready) && workingDirectory.ready,
      core, memory, workingDirectory, runtime};
  }
  /** Reading never creates files or substitutes a bundled personality. */
  foundation(): CompanionFoundation {
    const binding = this.binding(); check(binding && this.status().state === 'ready', 'Initialize the workspace first');
    const path = join(this.directory(binding.target), 'COMPANION.md');
    const stat = lstatSync(path, {throwIfNoEntry: false});
    if (!stat) return {text: '', revision: bytesDigest(Buffer.from('')), source:'empty', path};
    check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= MAX_BYTES, 'Companion foundation is not a bounded regular file');
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(fd), data = readFileSync(fd), after = fstatSync(fd);
      check(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && data.length <= MAX_BYTES, 'Companion foundation changed while reading');
      const value = new TextDecoder('utf-8', {fatal:true}).decode(data);
      return {text:value, revision:bytesDigest(data), source:value.trim() ? 'owner' : 'empty', path};
    } finally {closeSync(fd);}
  }
  status(): WorkspaceStatus {
    const target = preferences(this.runtime).workspace, binding = this.binding();
    const block = this.migrationBlock();
    if (block) return {state:'migration-required', revision:binding?.revision ?? null, target, files:[],
      error:'migration-required', migrationReason:block.reason, sourceRevision:null};
    if (!target) return { state: 'unbound', revision: null, target: null, files: [], error: null, sourceRevision: null };
    if (!binding) return { state: 'pending', revision: null, target, files: [], error: null, sourceRevision: null };
    try {
      const directory = this.directory(target);
      if (!this.runtime.store.persisted())
        return {state: 'pending', revision: binding.revision, target, files: [], error: 'Core database is absent or moved; initialize explicitly to persist the current companion', sourceRevision: null};
      if (!existsSync(directory))
        return {state: 'pending', revision: binding.revision, target, files: [], error: 'Managed companion files are absent; initialize explicitly to prepare this workspace', sourceRevision: null};
      if (existsSync(join(directory, INITIALIZING)))
        return {state: 'pending', revision: binding.revision, target, files: [], error: 'Initialization is incomplete; retry to prepare the same workspace', sourceRevision: null};
      const docs = this.documents(target);
      const files = this.verifyInventory(target);
      return { state: 'ready', revision: binding.revision, target, files, error: null, sourceRevision: bytesDigest(Buffer.from(canonical(docs.hashes))) };
    } catch { return { state: 'unavailable', revision: binding.revision, target, files: REQUIRED, error: 'Managed workspace files cannot be loaded; inspect the files and binding', sourceRevision: null }; }
  }
}
