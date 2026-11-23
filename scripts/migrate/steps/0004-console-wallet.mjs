import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { CONSOLE_WALLET_IMPORT_FILE, CONSOLE_WALLET_STEP, freshWalletImportProof,
  isWalletImportProof } from '../../../dist/src/core/storage-migration.js';
import { readEconomyDatabaseMarker, readEconomyFileEvidence, syncPath } from '../../../dist/src/living/economy/adoption.js';
import { ConsoleRequests, importConsoleRequests, readConsoleImportProof } from '../../../dist/src/living/economy/console-requests.js';
import { assertOffline, assertWalletBrowserOffline } from '../context.mjs';
import { checked, requireMigration } from '../errors.mjs';
import { atomicWrite, hash, json, regular } from '../io.mjs';
import { validateWalletAttestation } from '../wallet-rollback.mjs';
import { observe, update } from './0003-economy-marker.mjs';

const identity = ({storageId, companionId}) => ({storageId, companionId});
const markerFile = context => join(context.data,CONSOLE_WALLET_IMPORT_FILE);
const walletFile = context => join(context.data,'economy','economy.sqlite');
const walletInvalid = 'economy-database-invalid';

function files(context) {
  return checked(walletInvalid,() => readEconomyFileEvidence(context.plan.repo,identity(context.plan)));
}
function validateWallet(context, db) {
  requireMigration(readEconomyDatabaseMarker(db,identity(context.plan)),walletInvalid);
  const result = db.prepare('PRAGMA quick_check').all();
  requireMigration(result.length === 1 && result[0].quick_check === 'ok',walletInvalid);
}

export function walletImportProof(context, {exported,entries,ownerAttestation}, economyAdopted) {
  requireMigration(economyAdopted || entries.length === 0,'wallet-not-adopted');
  const sources = ownerAttestation ? [ownerAttestation]
    : exported.sources.map(({profile,origin,key,rawDigest}) => [profile,origin,key,rawDigest]);
  const requests = entries.map(({requestId,fingerprint}) => [requestId,fingerprint])
    .sort(([left],[right]) => left < right ? -1 : left > right ? 1 : 0);
  return {format:1,mode:'import',binding:identity(context.plan),wallet:economyAdopted ? 'adopted' : 'absent',
    round:ownerAttestation?.round ?? exported.round,
    sourceCount:sources.length,sourceDigest:hash(JSON.stringify(sources)),
    requestCount:requests.length,requestDigest:hash(JSON.stringify(requests)),
    exportDigest:ownerAttestation ? validateWalletAttestation(context,ownerAttestation) : exported.digest,
    ...(ownerAttestation && {ownerAttestation})};
}

export default {
  ...CONSOLE_WALLET_STEP,
  verifyInFlight:true,
  complete(context, {walletImport, recorded = false} = {}) {
    const expected = walletImport?.proof, binding = identity(context.plan);
    const marker = markerFile(context), hasMarker = regular(marker);
    if (!expected && !hasMarker) return false;
    if (!expected || expected.wallet === 'absent') {
      if (!hasMarker) return false;
      const proof = checked('wallet-import-invalid',() => json(marker));
      if (!expected) return isDeepStrictEqual(proof,freshWalletImportProof(binding));
      if (!recorded || context.walletImport) requireMigration(!files(context).database,'wallet-import-invalid');
      return isWalletImportProof(proof,binding.storageId) && isDeepStrictEqual(proof,expected);
    }
    requireMigration(!hasMarker,'wallet-import-invalid');
    if (!files(context).database) return false;
    return observe(walletFile(context),walletInvalid,db => {
      validateWallet(context,db);
      const proof = checked('wallet-import-invalid',() => readConsoleImportProof(db));
      if (!isWalletImportProof(proof,binding.storageId) || !isDeepStrictEqual(proof,expected)) return false;
      const rows = new ConsoleRequests(db,binding);
      const pending = checked('wallet-import-invalid',() => rows.pending());
      if (!context.walletImport) return true;
      const {entries} = context.walletImport;
      return pending.length === entries.length && entries.every(({requestId,fingerprint}) => {
        const row = checked('wallet-import-invalid',() => rows.get(requestId));
        return row?.state === 'pending' && row.fingerprint === fingerprint;
      });
    });
  },
  apply(context) {
    const {entries, proof} = context.walletImport;
    if (proof.ownerAttestation) assertWalletBrowserOffline(context);
    else assertOffline(context);
    const evidence = files(context);
    if (proof.wallet === 'absent') {
      requireMigration(!evidence.database && !evidence.adoption && !evidence.storage,'wallet-import-invalid');
      const file = markerFile(context);
      requireMigration(!regular(file),'wallet-import-invalid');
      atomicWrite(file,JSON.stringify(proof) + '\n');
      return;
    }
    requireMigration(evidence.database,'economy-database-missing');
    const file = walletFile(context);
    update(file,'economy-database-missing',walletInvalid,db => {
      validateWallet(context,db);
      requireMigration(readConsoleImportProof(db) === undefined,'wallet-import-invalid');
      checked('wallet-import-invalid',() => importConsoleRequests(db,proof.binding,entries,proof));
    });
    syncPath(dirname(file));
  },
};
