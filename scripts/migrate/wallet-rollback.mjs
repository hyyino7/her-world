import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { CONSOLE_WALLET_IMPORT_FILE } from '../../dist/src/core/storage-migration.js';
import { acquireMigrationMutex } from '../companion-backup.mjs';
import { verifyOfflineBackup } from '../lib/offline-backup.mjs';
import { fileHashes } from '../lib/repo-storage.mjs';
import { assertOffline, loadInstallation } from './context.mjs';
import { checked, requireMigration } from './errors.mjs';
import { atomicWrite, hash, inspectTree, regular } from './io.mjs';
import { fields, privatePath, readPrivate, readWalletExport, validateBinding } from './wallet-export.mjs';

export function walletBinding({storageId, companionId, workspaceId, repo, profileDir, scopeId, ownerActorId}) {
  return {storageId, companionId, workspaceId, repoHash:hash(repo), profileHash:hash(profileDir), scopeId, ownerActorId};
}

function external(context, file) {
  requireMigration(typeof file === 'string' && isAbsolute(file) && resolve(file) === file, 'wallet-rollback-invalid');
  const protectedPaths = [context.plan.repo,context.plan.profileDir,...context.plan.roots.map(root => root.path)];
  requireMigration(protectedPaths.every(root => {
    const path = relative(root,file);
    return path === '..' || path.startsWith('..' + sep);
  }), 'wallet-rollback-invalid');
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

export function sealWalletRollback({installation, backup, walletExport, output}) {
  let context = loadInstallation(installation);
  assertOffline(context);
  const repo = context.plan.repo, release = acquireMigrationMutex(repo);
  try {
    context = loadInstallation(installation);
    requireMigration(context.plan.repo === repo,'binding-changed');
    assertOffline(context);
    const binding = walletBinding(context.plan);
    for (const file of [walletExport, output]) external(context,file);
    privatePath(output);
    requireMigration(!regular(output),'wallet-rollback-invalid');
    const exported = readWalletExport(walletExport,binding);
    const anchor = checked('wallet-rollback-invalid',() => {
      const saved = backupManifest(backup);
      const verified = verifyOfflineBackup(backup,context.plan);
      requireMigration(verified.roots.every(root => {
        const stat = lstatSync(root.path,{throwIfNoEntry:false});
        return !!stat === root.present && isDeepStrictEqual(fileHashes(root.path),root.hashes);
      }),'wallet-rollback-invalid');
      requireMigration(isDeepStrictEqual(saved.document,verified),'wallet-rollback-invalid');
      return {format:1,binding,round:exported.round,exportDigest:exported.digest,
        backup,backupHash:saved.digest,codeFingerprint:verified.codeFingerprint};
    });
    assertOffline(context);
    atomicWrite(output,JSON.stringify(anchor) + '\n');
    return {sealed:true};
  } finally { release(); }
}

/** The old package was verified before the switch. Its anchored payload still has to match. */
export function readWalletRollback(context, file, exported) {
  return checked('wallet-rollback-invalid',() => {
    external(context,file);
    const {document:anchor,digest} = readPrivate(file,'wallet-rollback-invalid');
    requireMigration(fields(anchor,['format','binding','round','exportDigest','backup','backupHash','codeFingerprint'])
      && anchor.format === 1 && anchor.round === exported.round && anchor.exportDigest === exported.digest,'wallet-rollback-invalid');
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
export function verifyWalletRollback({installation,walletExport,walletRollback}) {
  const context = loadInstallation(installation);
  assertOffline(context);
  external(context,walletExport);
  const exported = readWalletExport(walletExport,walletBinding(context.plan));
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

export function readWalletMigrationInputs(context, exportFile, rollbackFile) {
  requireMigration(exportFile,'wallet-export-missing');
  requireMigration(rollbackFile,'wallet-rollback-invalid');
  external(context,exportFile);
  const exported = readWalletExport(exportFile,walletBinding(context.plan));
  return {exported, rollback:readWalletRollback(context,rollbackFile,exported)};
}
