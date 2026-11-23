import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { CONSOLE_WALLET_IMPORT_FILE, CONSOLE_WALLET_STEP, ECONOMY_STORAGE_STEP,
  HOME_STORAGE_STEP, INITIAL_STORAGE_STEP } from '../../dist/src/core/storage-migration.js';
import { acquireMigrationMutex } from '../companion-backup.mjs';
import { verifyOfflineBackup } from '../lib/offline-backup.mjs';
import { fileHashes } from '../lib/repo-storage.mjs';
import { assertOffline, assertWalletBrowserOffline, loadInstallation, manifestVersion } from './context.mjs';
import { checked, requireMigration } from './errors.mjs';
import { atomicWrite, hash, inspectTree, json, regular } from './io.mjs';
import { settled, validateJournal } from './journal.mjs';
import { fields, privatePath, readPrivate, readWalletExport, validRound, validateBinding } from './wallet-export.mjs';

const attestationSource = 'dsh-app://app', fromVersion = '0.4.0', toVersion = '0.5.0';
const anchorFields = ['format','binding','round','exportDigest','backup','backupHash','codeFingerprint'];
const walletSteps = [INITIAL_STORAGE_STEP,HOME_STORAGE_STEP,ECONOMY_STORAGE_STEP,CONSOLE_WALLET_STEP];

export function walletBinding({storageId, companionId, workspaceId, repo, profileDir, scopeId, ownerActorId}) {
  return {storageId, companionId, workspaceId, repoHash:hash(repo), profileHash:hash(profileDir), scopeId, ownerActorId};
}

export function assertWalletArtifactExternal(context, file) {
  requireMigration(typeof file === 'string' && isAbsolute(file) && resolve(file) === file, 'wallet-rollback-invalid');
  const protectedPaths = [context.plan.repo,context.plan.profileDir,...context.plan.roots.map(root => root.path)];
  requireMigration(protectedPaths.every(root => {
    const path = relative(root,file);
    return path === '..' || path.startsWith('..' + sep);
  }), 'wallet-rollback-invalid');
}

function assertWalletAttestationPackage(context, version) {
  checked('wallet-attestation-version',() => {
    const file = join(context.plan.installedPackage,'package.json');
    requireMigration(regular(file),'wallet-attestation-version');
    const installed = json(file);
    requireMigration(installed.name === 'her-world' && installed.version === version,
      'wallet-attestation-version');
  });
}

function assertNoBrowserMaterials(file, walletExport) {
  requireMigration(walletExport === undefined && ['wallet-export.json','wallet-sources.json'].every(name =>
    !lstatSync(join(dirname(file),name),{throwIfNoEntry:false})), 'wallet-attestation-conflict');
}

export function assertWalletAttestationReady(context, file, walletExport, expectedDigest) {
  assertWalletBrowserOffline(context);
  assertWalletArtifactExternal(context,file);
  assertNoBrowserMaterials(file,walletExport);
  assertWalletAttestationPackage(context,toVersion);
  if (expectedDigest !== undefined) checked('wallet-attestation-invalid',() => {
    requireMigration(readPrivate(file,'wallet-attestation-invalid').digest === expectedDigest,'wallet-attestation-invalid');
  });
}

export function validateWalletAttestation(context, value, round = value?.round) {
  requireMigration(fields(value,['source','attestedAt','binding','round','fromVersion','toVersion'])
    && value.source === attestationSource && value.fromVersion === fromVersion && value.toVersion === toVersion
    && value.round === round && validRound(round) && typeof value.attestedAt === 'string'
    && Number.isFinite(Date.parse(value.attestedAt)) && new Date(value.attestedAt).toISOString() === value.attestedAt,
    'wallet-attestation-invalid');
  validateBinding(value.binding,walletBinding(context.plan));
  return hash(JSON.stringify(value));
}

function backupManifest(backup) {
  requireMigration(isAbsolute(backup) && resolve(backup) === backup && realpathSync(backup) === backup, 'wallet-rollback-invalid');
  const stat = lstatSync(backup);
  requireMigration(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700, 'wallet-rollback-invalid');
  const file = join(backup,'manifest.json');
  requireMigration(regular(file),'wallet-rollback-invalid');
  const bytes = readFileSync(file);
  return {document:JSON.parse(bytes.toString('utf8')), digest:hash(bytes)};
}

export function sealWalletRollback({installation, backup, walletExport, output, ownerAttestsNoPending = false}) {
  let context = loadInstallation(installation);
  assertOffline(context);
  const repo = context.plan.repo, release = acquireMigrationMutex(repo);
  try {
    context = loadInstallation(installation);
    requireMigration(context.plan.repo === repo,'binding-changed');
    const assertStopped = ownerAttestsNoPending ? assertWalletBrowserOffline : assertOffline;
    assertStopped(context);
    const binding = walletBinding(context.plan);
    assertWalletArtifactExternal(context,output);
    privatePath(output);
    let source;
    if (ownerAttestsNoPending) {
      assertNoBrowserMaterials(output,walletExport);
      assertWalletAttestationPackage(context,fromVersion);
      const {last,truncated} = validateJournal(context);
      requireMigration(!last?.header.walletImport || last.header.walletImport.proof.ownerAttestation,
        'wallet-attestation-conflict');
      requireMigration(!truncated && (!last || settled(last) && !last.header.walletImport)
        && manifestVersion(context,walletSteps) < walletSteps.length,'wallet-attestation-invalid');
    } else {
      assertWalletArtifactExternal(context,walletExport);
      source = readWalletExport(walletExport,binding);
    }
    requireMigration(!regular(output),'wallet-rollback-invalid');
    const anchor = checked('wallet-rollback-invalid',() => {
      const saved = backupManifest(backup);
      const verified = verifyOfflineBackup(backup,context.plan);
      requireMigration(verified.roots.every(root => {
        const stat = lstatSync(root.path,{throwIfNoEntry:false});
        return !!stat === root.present && isDeepStrictEqual(fileHashes(root.path),root.hashes);
      }),'wallet-rollback-invalid');
      requireMigration(isDeepStrictEqual(saved.document,verified),'wallet-rollback-invalid');
      return {format:1,binding,backup,backupHash:saved.digest,codeFingerprint:verified.codeFingerprint};
    });
    assertStopped(context);
    if (ownerAttestsNoPending) {
      assertNoBrowserMaterials(output,walletExport);
      assertWalletAttestationPackage(context,fromVersion);
      const round = randomUUID();
      const ownerAttestation = {source:attestationSource,attestedAt:new Date().toISOString(),binding,round,fromVersion,toVersion};
      Object.assign(anchor,{round,exportDigest:validateWalletAttestation(context,ownerAttestation),ownerAttestation});
    } else Object.assign(anchor,{round:source.round,exportDigest:source.digest});
    atomicWrite(output,JSON.stringify(anchor) + '\n');
    return {sealed:true};
  } finally { release(); }
}

/** The old package was verified before the switch. Its anchored payload still has to match. */
export function readWalletRollback(context, file, exported) {
  return checked('wallet-rollback-invalid',() => {
    assertWalletArtifactExternal(context,file);
    const {document:anchor,digest} = readPrivate(file,'wallet-rollback-invalid');
    requireMigration(anchor?.format === 1,'wallet-rollback-invalid');
    if (exported) {
      requireMigration(fields(anchor,anchorFields) && anchor.round === exported.round && anchor.exportDigest === exported.digest,
        'wallet-rollback-invalid');
    } else {
      requireMigration(fields(anchor,[...anchorFields,'ownerAttestation']) && validRound(anchor.round)
        && anchor.exportDigest === validateWalletAttestation(context,anchor.ownerAttestation,anchor.round), 'wallet-attestation-invalid');
    }
    validateBinding(anchor.binding,walletBinding(context.plan));
    const saved = backupManifest(anchor.backup);
    requireMigration(anchor.backupHash === saved.digest && anchor.codeFingerprint === saved.document.codeFingerprint,'wallet-rollback-invalid');
    const {repo,workspaceId,profileDir,dshHome,companionId,scopeId,ownerActorId} = context.plan;
    const oldBinding = {repo,workspaceId,profileDir,dshHome,companionId,scopeId,ownerActorId};
    requireMigration(Object.entries(oldBinding).every(([key,value]) => saved.document[key] === value),'binding-changed');
    inspectTree(join(anchor.backup,'data'));
    for (const root of saved.document.roots) {
      requireMigration(typeof root.id === 'string' && /^[A-Za-z0-9._-]+$/.test(root.id)
        && root.id !== '.' && root.id !== '..','wallet-rollback-invalid');
      const payload = join(anchor.backup,'data',root.id,'payload');
      const stat = lstatSync(payload,{throwIfNoEntry:false});
      requireMigration(!!stat === root.present && (!stat || root.kind === (stat.isDirectory() ? 'directory' : 'file'))
        && isDeepStrictEqual(fileHashes(payload),root.hashes),'wallet-rollback-invalid');
    }
    return {...anchor,digest};
  });
}

/** Re-check the matching installed package before the existing offline restore. */
export function verifyWalletRollback({installation,walletExport,walletRollback,exportDigest}) {
  const context = loadInstallation(installation);
  let exported;
  if (walletExport === undefined) {
    assertWalletBrowserOffline(context);
    assertWalletAttestationPackage(context,fromVersion);
  } else {
    assertOffline(context);
    assertWalletArtifactExternal(context,walletExport);
    exported = readWalletExport(walletExport,walletBinding(context.plan));
  }
  requireMigration(exportDigest === undefined || exported?.digest === exportDigest,'wallet-source-conflict');
  const anchor = readWalletRollback(context,walletRollback,exported);
  const saved = checked('wallet-rollback-invalid',() => verifyOfflineBackup(anchor.backup,context.plan));
  requireMigration(saved.codeFingerprint === anchor.codeFingerprint,'wallet-rollback-invalid');
  return {backup:anchor.backup};
}

/** Check the original wallet and Body bytes after the old backup was restored. */
export function verifyWalletRestore(options) {
  const {backup} = verifyWalletRollback(options);
  const {data} = loadInstallation(options.installation);
  const original = join(backup,'data','companion','payload','data');
  checked('wallet-rollback-invalid',() => {
    for (const path of ['storage-manifest.json','migrations.jsonl',CONSOLE_WALLET_IMPORT_FILE,'economy','living/economy-adoption.json',
      'life/home.json','behavior/home.json']) {
      const actual = join(data,path), saved = join(original,path);
      requireMigration(isDeepStrictEqual(fileHashes(actual),fileHashes(saved)),'wallet-rollback-invalid');
    }
  });
  return true;
}

export function readWalletMigrationInputs(context, exportFile, rollbackFile, ownerAttestsNoPending = false) {
  if (ownerAttestsNoPending) {
    assertWalletAttestationReady(context,rollbackFile,exportFile);
    const rollback = readWalletRollback(context,rollbackFile);
    return {rollback,ownerAttestation:rollback.ownerAttestation,entries:[]};
  }
  requireMigration(exportFile,'wallet-export-missing');
  requireMigration(rollbackFile,'wallet-rollback-invalid');
  assertWalletArtifactExternal(context,exportFile);
  const exported = readWalletExport(exportFile,walletBinding(context.plan));
  return {exported, rollback:readWalletRollback(context,rollbackFile,exported),entries:exported.entries};
}
