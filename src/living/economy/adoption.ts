import {closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {durableWrite} from '#dsh-world/life/lifeStore';
import {check, reject, unavailable} from '../../core/storage.js';
import {decodeMigrationJournal, parseMigrationJournal} from '../../core/storage-migration.js';

export const ECONOMY_ADOPTION_FILE = 'data/living/economy-adoption.json';
export const ECONOMY_INITIALIZED = 'economy.initialized';
export interface EconomyIdentity {storageId: string; companionId: string}

function directory(path: string) {
  const stat = lstatSync(path, {throwIfNoEntry:false});
  check(!stat || stat.isDirectory(), 'Invalid economy or Body storage directory');
  return stat;
}

export function economyFile(path: string) {
  const stat = lstatSync(path, {throwIfNoEntry:false});
  check(!stat || stat.isFile() && stat.nlink === 1, 'Invalid economy storage file');
  return stat;
}

export function assertEconomyIdentity(value: unknown, identity: EconomyIdentity) {
  const row = value as Partial<EconomyIdentity> | null;
  check(typeof row?.storageId === 'string' && typeof row.companionId === 'string', 'Invalid economy identity');
  if (row.storageId !== identity.storageId || row.companionId !== identity.companionId)
    reject('STALE_BINDING', 'Economy belongs to a different storage or companion');
}

export function readEconomyFileEvidence(path: string, identity: EconomyIdentity) {
  const managed = join(path, '.chatpet'), data = join(managed, 'data'), wallet = join(data, 'economy');
  for (const part of [managed, data, join(data, 'living'), wallet]) directory(part);
  const marker = (file: string) => {
    if (!economyFile(file)) return false;
    assertEconomyIdentity(JSON.parse(readFileSync(file, 'utf8')), identity);
    return true;
  };
  const database = join(wallet, 'economy.sqlite');
  economyFile(database + '-wal');
  economyFile(database + '-shm');
  economyFile(database + '-journal');
  return {adoption:marker(join(managed, ECONOMY_ADOPTION_FILE)), storage:marker(join(wallet, 'storage.json')),
    database:!!economyFile(database)};
}

export function readEconomyJournalEvidence(path: string, storageId: string): boolean {
  try {
    const file = join(path, '.chatpet', 'data', 'migrations.jsonl');
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.nlink !== 1) return false;
      const bytes = readFileSync(fd), after = fstatSync(fd);
      if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) return false;
      const journal = parseMigrationJournal(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
      const {truncated} = decodeMigrationJournal(journal, storageId);
      // The decoder validates every binding and only permits economyAdopted on headers that include 0003.
      return !truncated && journal.rows.some(value => {
        const row = value as {event?: string; economyAdopted?: boolean};
        return row.event === 'migration' && row.economyAdopted === true;
      });
    } finally { closeSync(fd); }
  } catch { return false; }
}

export function inspectEconomyAdoption(path: string, identity: EconomyIdentity, expectedInitialized = false) {
  const files = readEconomyFileEvidence(path, identity);
  if (!files.database && (files.adoption || files.storage || expectedInitialized
    || readEconomyJournalEvidence(path, identity.storageId) || readBodyEconomyAuthority(path)))
    unavailable('The authoritative economy database is missing; recover it before continuing.'
      + (files.adoption ? economyRecoveryAdvice(economyAdoptionPath(path)) : ''));
  return files;
}

export function bodyCheckpointDirectory(path: string) {
  const managed = join(path, '.chatpet'), data = join(managed, 'data'), life = join(data, 'life');
  for (const part of [managed, data, life]) directory(part);
  if (economyFile(join(life, 'home.json'))) return life;
  const behavior = join(data, 'behavior');
  directory(behavior);
  return behavior;
}

export function readBodyEconomyAuthority(path: string) {
  const file = join(bodyCheckpointDirectory(path), 'home.json'), stat = economyFile(file);
  if (!stat) return false;
  check(stat.size <= 32 * 1024 * 1024, 'Body checkpoint is too large');
  return JSON.parse(readFileSync(file, 'utf8')).economyGardenAuthority === true;
}

export function readEconomyDatabaseMarker(db: DatabaseSync, identity: EconomyIdentity,
  incomplete = 'Economy initialization marker exists without its initialized database') {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name));
  if (!tables.has('meta')) unavailable(incomplete);
  const meta = db.prepare('SELECT value FROM meta WHERE key=?');
  const schema = meta.get('schema');
  if (!schema) unavailable(incomplete);
  if (schema.value !== '"1"') reject('INCOMPATIBLE', 'Unsupported economy schema');
  assertEconomyIdentity(JSON.parse(String(meta.get('identity')?.value)), identity);
  check(['items', 'requests', 'ledger', 'garden_receipts', 'uses', 'readings', 'bookmarks', 'reading_operations', 'interaction_facts']
    .every(table => tables.has(table)), 'Economy database schema is incomplete');
  const row = meta.get(ECONOMY_INITIALIZED);
  if (row) assertEconomyIdentity(JSON.parse(String(row.value)), identity);
  return !!row;
}

export function syncPath(path: string) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function economyAdoptionPath(path: string) {
  return join(path, '.chatpet', ECONOMY_ADOPTION_FILE);
}

export function ensureAdoptionDirectory(file: string) {
  const parent = dirname(file);
  if (!directory(parent)) mkdirSync(parent, {mode:0o700});
  syncPath(dirname(parent));
}

export function writeEconomyFile(file: string, content: string) {
  durableWrite(file, content);
  syncPath(dirname(file));
}

export function economyRecoveryAdvice(file: string, database?: string) {
  if (database) return ` Adoption evidence is at ${file}. If you confirm that this first initialization never succeeded, move ${database} and any associated -wal, -shm and -journal files together to a safe location for safekeeping. Then delete this evidence and retry. Otherwise restore the rollback backup.`;
  return ` Adoption evidence is at ${file}. If this first initialization never succeeded, confirm that before deleting this evidence and retrying. Otherwise restore the rollback backup.`;
}
