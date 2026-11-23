import { staleMigrationLock } from '../companion-backup.mjs';
import { MigrationError, requireMigration, checked } from './errors.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseMigrationJournal } from '../../dist/src/core/storage-migration.js';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = file => JSON.parse(readFileSync(file, 'utf8'));
export function regular(file) {
  const stat = lstatSync(file, {throwIfNoEntry:false});
  requireMigration(!stat || stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'symlink-or-hardlink');
  return stat;
}
export function inspectTree(path) {
  const stat = lstatSync(path, {throwIfNoEntry:false});
  if (!stat) return;
  requireMigration(!stat.isSymbolicLink(), 'symlink-or-hardlink');
  if (stat.isDirectory()) for (const name of readdirSync(path)) inspectTree(join(path, name));
  else regular(path);
}
export function readInstallation(file) {
  return checked('receipt-invalid', () => {
    regular(file); const receipt = json(file);
    requireMigration(receipt?.status === 'installed' && receipt.packageInstalled === true &&
      typeof receipt.config?.dataDir === 'string' && receipt.config.dataDir.length > 0 &&
      typeof receipt.profileDir === 'string' && receipt.profileDir.length > 0, 'receipt-invalid');
    return receipt;
  });
}
export function atomicWrite(file, text) {
  regular(file);
  const stage = file + '.' + randomUUID() + '.tmp';
  try {
    const fd = openSync(stage, 'wx', 0o600);
    try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(stage, file);
    const directory = openSync(dirname(file), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { if (lstatSync(stage, {throwIfNoEntry:false})) unlinkSync(stage); }
}
export function readJournal(file) {
  if (!regular(file)) return {rows:[], truncated:false};
  return checked('journal-invalid', () => parseMigrationJournal(readFileSync(file, 'utf8')));
}
export function appendJournal(file, row) {
  const {rows} = readJournal(file);
  atomicWrite(file, [...rows, row].map(value => JSON.stringify(value) + '\n').join(''));
}

/** Called with the Repo's offline mutex held. Backups retain this lease. */
export function acquireLock(file) {
  const token = `${process.pid}:${randomUUID()}`;
  let stale;
  try { stale = staleMigrationLock(file); }
  catch (error) { if (['lock-invalid','lock-held'].includes(error.code)) throw new MigrationError(error.code); throw error; }
  if (stale) unlinkSync(file);
  let fd;
  try { fd = openSync(file, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new MigrationError('lock-held'); throw error; }
  try { writeFileSync(fd, token); fsyncSync(fd); } finally { closeSync(fd); }
  return {stale, release() {
    if (regular(file) && readFileSync(file, 'utf8') === token) unlinkSync(file);
  }};
}
