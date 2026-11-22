import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {ECONOMY_STORAGE_STEP} from '../../../dist/src/core/storage-migration.js';
import {setSqliteMeta} from '../../../dist/src/core/sqlite.js';
import {canonical, Rejection} from '../../../dist/src/core/storage.js';
import {ECONOMY_INITIALIZED, economyAdoptionPath, ensureAdoptionDirectory, readBodyEconomyAuthority,
  readEconomyDatabaseMarker, readEconomyFileEvidence, syncPath} from '../../../dist/src/living/economy/adoption.js';
import {copyDatabase} from '../../lib/repo-storage.mjs';
import {assertOffline} from '../context.mjs';
import {checked, MigrationError, requireMigration} from '../errors.mjs';
import {atomicWrite, regular} from '../io.mjs';

const prefix = ECONOMY_INITIALIZED + ':';
const markerInvalid = 'economy-marker-invalid';
const walletInvalid = 'economy-database-invalid';
const coreFile = context => join(context.plan.coreDirectory, 'core.sqlite');
const walletFile = context => join(context.data, 'economy', 'economy.sqlite');
const identity = ({storageId, companionId}) => ({storageId, companionId});

export const legacyEconomyRows = db => db.prepare('SELECT key,value FROM meta WHERE key GLOB ?').all(prefix + '*');
export function legacyEconomyMarkerProblem(row, {storageId, companionId, repo}) {
  let value;
  try { value = JSON.parse(row.value); } catch { return markerInvalid; }
  if (typeof value?.companionId !== 'string' || typeof value.path !== 'string') return markerInvalid;
  if (row.key !== prefix + storageId || value.companionId !== companionId || value.path !== repo)
    return 'economy-marker-binding-mismatch';
}

function source(db) {
  requireMigration(db.prepare('SELECT value FROM meta WHERE key=?').get('schema')?.value === '"1"', markerInvalid);
  return legacyEconomyRows(db);
}

export function observe(file, code, read) {
  return checked(code, () => {
    regular(file + '-shm');
    const scratch = mkdtempSync(join(tmpdir(), 'migration-economy-'));
    try {
      const copy = join(scratch, 'database');
      copyDatabase(file, copy);
      using db = new DatabaseSync(copy, {readOnly:true});
      return read(db);
    } finally { rmSync(scratch, {recursive:true, force:true}); }
  });
}

function bound(code, read) {
  return checked(code, () => {
    try { return read(); }
    catch (error) {
      if (error instanceof Rejection && error.detail.code === 'STALE_BINDING') throw new MigrationError('economy-marker-binding-mismatch');
      throw error;
    }
  });
}

function files(context) {
  return bound(markerInvalid, () => readEconomyFileEvidence(context.plan.repo, identity(context.plan)));
}

function walletMarker(context, db) {
  return bound(walletInvalid, () => readEconomyDatabaseMarker(db, identity(context.plan)));
}

export function update(file, missing, invalid, write) {
  requireMigration(regular(file), missing);
  for (const suffix of ['-wal', '-shm', '-journal']) regular(file + suffix);
  return checked(invalid, () => {
    const url = pathToFileURL(file);
    url.searchParams.set('mode', 'rw');
    using db = new DatabaseSync(url);
    db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
    try { write(db); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  });
}

function targetsPresent(context, evidence) {
  return evidence.adoption && evidence.database && observe(walletFile(context), walletInvalid, db => walletMarker(context, db));
}

export default {
  ...ECONOMY_STORAGE_STEP,
  adopted(context) {
    if (observe(coreFile(context), markerInvalid, source).length) return true;
    const evidence = files(context);
    return evidence.adoption || evidence.storage || checked(markerInvalid, () => readBodyEconomyAuthority(context.plan.repo))
      || evidence.database && observe(walletFile(context), walletInvalid, db => walletMarker(context, db));
  },
  complete(context, {economyAdopted} = {}) {
    if (observe(coreFile(context), markerInvalid, source).length) return false;
    const evidence = files(context);
    if (targetsPresent(context, evidence)) return true;
    requireMigration(!economyAdopted && !evidence.adoption && !evidence.storage && !evidence.database
      && !checked(markerInvalid, () => readBodyEconomyAuthority(context.plan.repo)), 'migration-inconsistent');
    return true;
  },
  apply(context) {
    assertOffline(context);
    const rows = observe(coreFile(context), markerInvalid, source);
    requireMigration(rows.length === 1, rows.length ? 'economy-marker-multiple' : 'migration-inconsistent');
    const row = rows[0], problem = legacyEconomyMarkerProblem(row, context.plan);
    requireMigration(!problem, problem);
    const evidence = files(context), wallet = walletFile(context), adoption = economyAdoptionPath(context.plan.repo);
    const text = canonical(identity(context.plan));
    update(wallet, 'economy-database-missing', walletInvalid, db => {
      if (!walletMarker(context, db)) setSqliteMeta(db, ECONOMY_INITIALIZED, text);
    });
    syncPath(dirname(wallet));
    ensureAdoptionDirectory(adoption);
    if (!evidence.adoption) atomicWrite(adoption, text + '\n');
    else { syncPath(adoption); syncPath(dirname(adoption)); }
    requireMigration(targetsPresent(context, files(context)), 'migration-inconsistent');
    update(coreFile(context), markerInvalid, markerInvalid, db => {
      const current = source(db);
      requireMigration(current.length === 1 && current[0].key === row.key && current[0].value === row.value, 'economy-marker-binding-mismatch');
      requireMigration(db.prepare('DELETE FROM meta WHERE key=? AND value=?').run(row.key, row.value).changes === 1, 'migration-inconsistent');
    });
  },
};
