import { backup, DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { ContractError, RejectedCode } from '../contracts/common.js';
import { closeSqliteLease, setSqliteMeta } from './sqlite.js';

export class Rejection extends Error {
  constructor(readonly detail: ContractError) { super(detail.message); }
}
export function reject(code: RejectedCode, message: string): never {
  throw new Rejection({ code, message, effect: 'none', retry: code.startsWith('STALE') ? 'refresh' : 'never' });
}
export function unavailable(message: string): never {
  throw new Rejection({ code: 'UNAVAILABLE', message, effect: 'none', retry: 'same_request' });
}
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) reject('INVALID_ARGUMENT', message);
}
export function text(value: unknown, label: string, max = 32_768): asserts value is string {
  check(typeof value === 'string' && value.length > 0 && value.length <= max, `Invalid ${label}`);
}
export function integer(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): asserts value is number {
  check(Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max, `Invalid ${label}`);
}
export function timestamp(value: unknown): asserts value is string {
  text(value, 'timestamp', 64); check(Number.isFinite(Date.parse(value)), 'Invalid timestamp');
}
export const id = (prefix: string): string => `${prefix}_${randomUUID()}`;
export const now = (): string => new Date().toISOString();

/** JSON is the persistence boundary. Reject prototypes, non-finite values and oversized payloads. */
export function canonical(value: unknown): string {
  const visit = (v: unknown, depth: number): unknown => {
    check(depth < 40, 'Payload too deep');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') { check(Number.isFinite(v), 'Non-finite number'); return v; }
    if (Array.isArray(v)) return v.map(x => visit(x, depth + 1));
    check(typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype, 'Expected plain JSON');
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, visit((v as Record<string, unknown>)[k], depth + 1)]));
  };
  const result = JSON.stringify(visit(value, 0));
  check(Buffer.byteLength(result) <= 4 * 1024 * 1024, 'Payload too large');
  return result;
}
export const digest = (value: unknown): string => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
export const bytesDigest = (value: Uint8Array): string => `sha256:${createHash('sha256').update(value).digest('hex')}`;
export function revision(actual: number, expected: number): void {
  integer(expected, 'expected revision', 1);
  if (actual !== expected) reject('STALE_REVISION', `Expected revision ${expected}; current ${actual}`);
}

/** One process owns one Core database. Only trusted host configuration selects storage paths. */
export class CoreStore {
  db: DatabaseSync;
  readonly directory: string;
  private readonly lockPath: string;
  private readonly lockToken = `${process.pid}:${randomUUID()}`;
  private closed = false;
  private recovering = false;
  private databaseFile!: {dev: number; ino: number};
  constructor(directory: string) {
    check(isAbsolute(directory), 'dataDir must be absolute');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    check(!lstatSync(directory).isSymbolicLink(), 'dataDir must not be a symlink');
    this.directory = realpathSync(directory);
    chmodSync(this.directory, 0o700);
    const manifestPath = join(this.directory, '../../manifest.json');
    // An initialized bootstrap Repo also has an identity manifest, before its
    // existing Core is relocated. A missing declaration must never authorize
    // a blank second Core, including a crash before migration's final manifest.
    if (!existsSync(join(this.directory, 'core.sqlite')) && lstatSync(manifestPath, {throwIfNoEntry: false})) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {schemaVersion?: number; companionId?: string; files?: string[]};
      if (manifest.files?.includes('data/core/core.sqlite')
        || typeof manifest.companionId === 'string' && [1, 2, 3].includes(manifest.schemaVersion!))
        unavailable('This workspace has no Core database; migrate its existing Core or recover its data before starting Core');
    }
    this.lockPath = join(this.directory, 'core.lock');
    if (existsSync(this.lockPath)) {
      check(!lstatSync(this.lockPath).isSymbolicLink(), 'Core lock must not be a symlink');
      const pid = Number(readFileSync(this.lockPath, 'utf8').split(':')[0]);
      check(Number.isSafeInteger(pid) && pid > 0, 'Invalid Core lock; inspect it manually');
      try { process.kill(pid, 0); reject('CONFLICT', 'Core dataDir already has a live owner'); }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
        unlinkSync(this.lockPath);
      }
    }
    const lock = openSync(this.lockPath, 'wx', 0o600);
    writeFileSync(lock, this.lockToken); closeSync(lock);
    let database: DatabaseSync | undefined;
    try {
      const path = join(this.directory, 'core.sqlite');
      check(!existsSync(path) || !lstatSync(path).isSymbolicLink(), 'Database must not be a symlink');
      this.db = database = new DatabaseSync(path);
      this.databaseFile = lstatSync(path);
      chmodSync(path, 0o600);
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS records (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, id TEXT NOT NULL,
          value TEXT NOT NULL, UNIQUE(kind,id));
        CREATE TABLE IF NOT EXISTS requests (
          principal TEXT NOT NULL, operation TEXT NOT NULL, request_id TEXT NOT NULL,
          digest TEXT NOT NULL, value TEXT NOT NULL,
          PRIMARY KEY(principal,operation,request_id));`);
      const schema = this.meta<string>('schema');
      if (schema && schema !== '1') reject('INCOMPATIBLE', `Unsupported database schema ${schema}`);
      this.setMeta('schema', '1');
    } catch (error) { database?.close(); unlinkSync(this.lockPath); throw error; }
  }
  /** A live connection alone does not establish that its database is still in the Repo. */
  persisted(): boolean {
    try {
      const stat = lstatSync(join(this.directory, 'core.sqlite'));
      return !this.closed && !this.recovering && stat.isFile() && !stat.isSymbolicLink()
        && stat.dev === this.databaseFile.dev && stat.ino === this.databaseFile.ino
        && readFileSync(this.lockPath, 'utf8') === this.lockToken;
    } catch { return false; }
  }
  /** Explicit initialization may recover this live connection, never another cached identity. */
  async ensurePersisted(): Promise<void> {
    if (this.persisted()) return;
    if (this.closed || this.recovering) unavailable('Core storage recovery is unavailable');
    const path = join(this.directory, 'core.sqlite');
    const ownLease = () => !existsSync(this.lockPath) || !lstatSync(this.lockPath).isSymbolicLink()
      && readFileSync(this.lockPath, 'utf8') === this.lockToken;
    check(ownLease(), 'Core storage acquired another owner');
    if (existsSync(path)) {
      const stat = lstatSync(path);
      check(!stat.isSymbolicLink() && stat.dev === this.databaseFile.dev && stat.ino === this.databaseFile.ino,
        'Core database was replaced; preserve it before initialization');
      writeFileSync(this.lockPath, this.lockToken, {flag: 'wx', mode: 0o600});
      return;
    }
    mkdirSync(this.directory, {recursive: true, mode: 0o700});
    check(realpathSync(this.directory) === this.directory, 'Core storage directory changed');
    const stage = join(this.directory, `.core-recovery-${randomUUID()}.sqlite`);
    this.recovering = true;
    try {
      const fingerprint = (db: DatabaseSync) => JSON.stringify(db.prepare("SELECT name, sql FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(row =>
        [row.name, row.sql, db.prepare(`SELECT * FROM "${String(row.name).replaceAll('"', '""')}" ORDER BY rowid`).all()]));
      await backup(this.db, stage);
      chmodSync(stage, 0o600);
      const saved = new DatabaseSync(stage);
      try {
        check(saved.prepare('PRAGMA integrity_check').get()?.integrity_check === 'ok', 'Core recovery integrity check failed');
        check(fingerprint(saved) === fingerprint(this.db), 'Core changed during recovery; retry initialization');
      } finally { saved.close(); }
      check(!existsSync(path) && ownLease(), 'Core storage acquired another owner');
      this.db.close();
      renameSync(stage, path);
      this.db = new DatabaseSync(path);
      this.databaseFile = lstatSync(path);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000');
      if (!existsSync(this.lockPath)) writeFileSync(this.lockPath, this.lockToken, {flag: 'wx', mode: 0o600});
    } finally {
      this.recovering = false;
      if (existsSync(stage)) unlinkSync(stage);
    }
  }
  meta<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);
    return row ? JSON.parse(row.value as string) as T : undefined;
  }
  setMeta(key: string, value: unknown): void {
    setSqliteMeta(this.db, key, canonical(value));
  }
  get<T>(kind: string, key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind, key);
    return row ? JSON.parse(row.value as string) as T : undefined;
  }
  require<T>(kind: string, key: string): T {
    text(key, `${kind} id`, 256);
    return this.get<T>(kind, key) ?? reject('NOT_FOUND', `${kind} ${key} not found`);
  }
  put(kind: string, key: string, value: unknown): void {
    this.db.prepare('INSERT INTO records(kind,id,value) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value').run(kind, key, canonical(value));
  }
  all<T>(kind: string): T[] {
    return this.db.prepare('SELECT value FROM records WHERE kind=? ORDER BY seq').all(kind).map(r => JSON.parse(r.value as string) as T);
  }
  transaction<T>(fn: () => T): T {
    if (!this.persisted()) unavailable('Core database is absent or moved; initialize the workspace to recover the live state');
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  mutate<T>(principal: string, operation: string, requestId: string, input: unknown, fn: () => T): T {
    return this.transaction(() => {
      const hash = digest(input);
      const previous = this.db.prepare('SELECT digest,value FROM requests WHERE principal=? AND operation=? AND request_id=?').get(principal, operation, requestId);
      if (previous) {
        if (previous.digest !== hash) reject('CONFLICT', 'Request ID reused with different input');
        return JSON.parse(previous.value as string) as T;
      }
      const value = fn();
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?)').run(principal, operation, requestId, hash, canonical(value));
      return value;
    });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    closeSqliteLease(this.db, this.lockPath, this.lockToken);
  }
}
