import {chmodSync, lstatSync, realpathSync, renameSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {formatLocalTime} from '#dsh-world/timeContext';
import {usageLabels, type UsageEntry} from '../../contracts/usage.js';
import {prepareRecordDirectory} from '../record-paths.js';
import {setSqliteMeta} from '../sqlite.js';

const columns = {
  started_at: 'INTEGER NOT NULL', ended_at: 'INTEGER NOT NULL', day: 'TEXT NOT NULL',
  session_id: 'TEXT', entry: 'TEXT NOT NULL', preset: 'TEXT NOT NULL', purpose: 'TEXT',
  provider: 'TEXT NOT NULL', model: 'TEXT NOT NULL', requested_effort: 'TEXT', outcome: 'TEXT NOT NULL',
  input_miss: 'INTEGER', output: 'INTEGER', cache_read: 'INTEGER', cache_write: 'INTEGER', reasoning: 'INTEGER',
} as const;
export interface UsageRow {
  started_at: number; ended_at: number; day: string; session_id: string | null;
  entry: UsageEntry; preset: string; purpose: string | null; provider: string; model: string;
  requested_effort: string | null; outcome: string; input_miss: number | null; output: number | null;
  cache_read: number | null; cache_write: number | null; reasoning: number | null;
}
const names = Object.keys(columns) as (keyof UsageRow)[];
// The ledger owns exactly these filenames, including during corruption recovery.
const ledgerFiles = ['ledger.sqlite', 'ledger.sqlite-journal', 'ledger.sqlite-wal', 'ledger.sqlite-shm'] as const;
export const usageDay = (at: number) => formatLocalTime(new Date(at), Intl.DateTimeFormat().resolvedOptions().timeZone).slice(0, 10);

function validateRow(row: UsageRow) {
  for (const name of names) {
    const value = row[name], type = columns[name];
    if (value === null && !type.endsWith('NOT NULL')) continue;
    if (type.startsWith('INTEGER') ? !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
      : !(typeof value === 'string' && value.length <= (name === 'session_id' ? 256 : 128)
        && /^[\p{L}\p{N}_.:@/+~%-]+$/u.test(value))) throw Error('INVALID_LEDGER_FIELD');
  }
  if (!Object.hasOwn(usageLabels, row.entry) || row.day !== usageDay(row.ended_at)
    || Object.keys(row).length !== names.length || (row.input_miss === null) !== (row.output === null))
    throw Error('INVALID_LEDGER_ROW');
}

function location(root: string, write: boolean) {
  if (realpathSync(root) !== root) throw Error('INVALID_LEDGER_ROOT');
  let directory = root;
  for (const part of ['.chatpet', 'data', 'usage']) {
    directory = join(directory, part);
    const stat = lstatSync(directory, {throwIfNoEntry: false});
    if (stat && !stat.isDirectory()) throw Error('INVALID_LEDGER_DIRECTORY');
    if (!stat) {
      if (!write) return;
      if (part !== 'usage') throw Error('INVALID_LEDGER_ROOT');
      prepareRecordDirectory(directory);
    }
  }
  const path = join(directory, ledgerFiles[0]);
  for (const file of ledgerFiles) {
    const stat = lstatSync(join(directory, file), {throwIfNoEntry: false});
    if (stat && (!stat.isFile() || stat.nlink !== 1)) throw Error('INVALID_LEDGER_FILE');
  }
  if (write || lstatSync(path, {throwIfNoEntry: false})) return path;
}

function schema(db: DatabaseSync, create: boolean) {
  if (create && !db.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get()) {
    db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.exec('CREATE TABLE calls (' + Object.entries(columns).map(([key, type]) => key + ' ' + type).join(',') + ') STRICT');
    db.exec('CREATE INDEX calls_day ON calls(day)');
    setSqliteMeta(db, 'version', '1');
  }
  const version = db.prepare("SELECT value FROM meta WHERE key='version'").get()?.value;
  if (Number(version) > 1) throw Error('LEDGER_UPGRADE');
  if (version !== '1' || db.prepare('PRAGMA table_xinfo(calls)').all().map(r => r.name).join(',') !== names.join(','))
    throw Error('INVALID_LEDGER_SCHEMA');
}

export function readLedger<T>(root: string, read: (db: DatabaseSync) => T) {
  const path = location(root, false);
  if (!path) return;
  const db = new DatabaseSync(path, {readOnly: true});
  try { db.exec('BEGIN'); schema(db, false); return read(db); }
  finally { db.close(); }
}

function insert(path: string, row: UsageRow, recovery?: string) {
  const db = new DatabaseSync(path);
  try {
    db.exec('BEGIN IMMEDIATE');
    schema(db, true);
    chmodSync(path, 0o600);
    if (recovery) setSqliteMeta(db, 'recovery', JSON.stringify(recovery));
    db.prepare('INSERT INTO calls (' + names.join(',') + ') VALUES (' + names.map(() => '?').join(',') + ')')
      .run(...names.map(name => row[name]));
    db.exec('COMMIT');
  } finally { db.close(); } // Closing rolls back an unfinished transaction.
}

export function appendUsage(root: string, row: UsageRow) {
  validateRow(row);
  const path = location(root, true)!;
  try { insert(path, row); }
  catch (error) {
    // node:sqlite exposes the SQLite result in errcode, including extended codes.
    const code = Number((error as {errcode?: number})?.errcode) & 255;
    if (code !== 11 && code !== 26) throw error;
    const directory = join(root, '.chatpet/data/usage');
    const archived = (file: string) => archive + file.slice(ledgerFiles[0].length);
    let time = Date.now(), archive: string;
    do { archive = join(directory, 'ledger.corrupt-' + time++ + '.sqlite'); }
    while (ledgerFiles.some(file => lstatSync(archived(file), {throwIfNoEntry: false})));
    // Move the main file last so a sidecar failure cannot attach old data to a new DB.
    for (const file of ledgerFiles.slice(1)) {
      const sidecar = join(directory, file);
      if (lstatSync(sidecar, {throwIfNoEntry: false})) renameSync(sidecar, archived(file));
    }
    renameSync(path, archive);
    insert(path, row, String(time - 1));
  }
}
