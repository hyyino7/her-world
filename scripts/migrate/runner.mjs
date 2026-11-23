import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { CONSOLE_WALLET_STEP, isStepSettled } from '../../dist/src/core/storage-migration.js';
import { acquireMigrationMutex } from '../companion-backup.mjs';
import { createOfflineBackup, verifyOfflineBackup } from '../lib/offline-backup.mjs';
import { loadInstallation, manifestVersion, assertOffline, assertWalletBrowserOffline } from './context.mjs';
import { acquireLock, appendJournal, hash, regular } from './io.mjs';
import { checked, MigrationError, requireMigration } from './errors.mjs';
import { contractFor, journalBinding, settled, validateJournal } from './journal.mjs';
import manifestStep, { writeManifest } from './steps/0001-storage-manifest.mjs';
import homeIdentityStep from './steps/0002-home-identity.mjs';
import economyMarkerStep from './steps/0003-economy-marker.mjs';

import consoleWalletStep, { walletImportProof } from './steps/0004-console-wallet.mjs';
import { assertWalletArtifactExternal, readWalletMigrationInputs, verifyWalletRestore, walletBinding } from './wallet-rollback.mjs';
import { exportWalletSources, reconcileWalletSources } from './browser-wallet.mjs';

export const steps = [manifestStep, homeIdentityStep, economyMarkerStep, consoleWalletStep];

function verifySaved(context, header) {
  return checked('backup-invalid', () => {
    const file = resolve(header.backup, 'manifest.json'); regular(file);
    assert.equal(hash(readFileSync(file)), header.backupHash, 'Backup manifest changed; restore a verified pre-migration backup');
    return verifyOfflineBackup(header.backup, context.plan);
  });
}

function targetComplete(step, context, evidence) {
  const complete = step.complete(context, evidence);
  assert.equal(typeof complete, 'boolean', 'Step completion must synchronously observe its persisted target');
  return complete;
}

export function migrationStatus(installation, selected = steps, { plan = false } = {}) {
  const context = loadInstallation(installation), journal = validateJournal(context);
  const contract = contractFor(selected), previous = journal.last;
  const reported = !plan && previous ? previous.header.steps : contract;
  const version = manifestVersion(context, reported);
  const result = {steps:reported.map((step, index) => {
    const event = previous?.states.get(step.id);
    if (!isDeepStrictEqual(step, contract[index])) return { id:step.id, state:'unverified' };
    const recordedComplete = index < journal.settledStepCount || isStepSettled(event);
    const inFlight = event === 'start' || event === 'failed';
    try {
      const complete = (version > index || inFlight && (selected[index].adopted || selected[index].verifyInFlight))
        && targetComplete(selected[index], context, {recorded:recordedComplete, versioned:!inFlight,
          economyAdopted:previous?.header.economyAdopted, walletImport:previous?.header.walletImport});
      const state = complete && version > index ? 'complete' : recordedComplete ? 'inconsistent' : event ?? 'pending';
      return { id:step.id, state };
    } catch (error) {
      if (error instanceof MigrationError && (error.code === 'migration-inconsistent'
        || step.id === CONSOLE_WALLET_STEP.id && recordedComplete)) return {id:step.id, state:'inconsistent'};
      throw error;
    }
  }), truncated:journal.truncated};
  if (plan) return result;
  const segment = previous ? settled(previous) ? 'settled' : 'unfinished' : 'none';
  return {...result, segment};
}

function checkAdmission(context, journal, selected, contract, { resume, backup }) {
  const previous = journal.last;
  if (resume) {
    requireMigration(previous, 'resume-journal-missing');
    requireMigration(isDeepStrictEqual(previous.header.steps, contract), 'journal-step-mismatch');
    const version = manifestVersion(context, contract);
    assertPreviousTargets(context, selected, journal.settledStepCount, version, previous.header);
    if (!settled(previous)) {
      const binding = previous.header.binding;
      if (binding) requireMigration(binding.repoHash === journalBinding(context).repoHash, 'binding-changed');
      const saved = verifySaved(context, previous.header);
      if (previous.header.walletImport) recheckWalletInputs(context,previous.header,saved);
    }
    return version;
  }
  requireMigration(!journal.truncated, 'journal-invalid');
  const version = manifestVersion(context, contract);
  if (previous) {
    requireMigration(settled(previous), 'journal-exists');
    const prior = previous.header.steps;
    requireMigration(isDeepStrictEqual(prior, contract.slice(0, prior.length)), 'journal-step-mismatch');
    assertPreviousTargets(context, selected, prior.length, version, previous.header);
    requireMigration(contract.length > prior.length, 'journal-exists');
  }
  requireMigration(backup, 'usage');
  return version;
}

function recheckWalletInputs(context, header, saved, exportDigest) {
  const wallet = header.walletImport;
  const inputs = readWalletMigrationInputs(context,wallet.exportFile,wallet.rollbackFile);
  requireMigration(exportDigest === undefined || inputs.exported.digest === exportDigest,'wallet-source-conflict');
  const proof = walletImportProof(context,inputs.exported,header.economyAdopted);
  requireMigration(wallet.codeFingerprint === saved.codeFingerprint
    && wallet.rollbackDigest === inputs.rollback.digest && isDeepStrictEqual(wallet.proof,proof),'wallet-import-invalid');
  context.walletImport = {...inputs,proof};
}

export function verifyWalletImport({installation,walletExport,walletRollback,exportDigest}) {
  const context = loadInstallation(installation);
  assertOffline(context);
  const {last,truncated} = validateJournal(context);
  const header = last?.header, wallet = header?.walletImport, contract = contractFor(steps);
  requireMigration(wallet && !truncated && settled(last) && isDeepStrictEqual(header.steps,contract)
    && wallet.exportFile === walletExport && wallet.rollbackFile === walletRollback,'wallet-import-invalid');
  recheckWalletInputs(context,header,verifySaved(context,header),exportDigest);
  assertPreviousTargets(context,steps,steps.length,manifestVersion(context,contract),header);
  assertOffline(context);
  return true;
}

function assertPreviousTargets(context, selected, count, version, header) {
  const {economyAdopted,walletImport} = header;
  requireMigration(version >= count && selected.slice(0, count).every(step =>
    targetComplete(step, context, {recorded:true, economyAdopted, walletImport})), 'migration-inconsistent');
}

function acquireMutex(repo) {
  try { return acquireMigrationMutex(repo); }
  catch (error) { if (['lock-invalid','lock-held'].includes(error.code)) throw new MigrationError(error.code); throw error; }
}

/** The owner confirms old-runtime shutdown. Each browser operation rechecks the current offline state. */
export async function runWalletBrowserOperation({installation,mode,walletExport,walletRollback,journal,round,sources,acquire}) {
  requireMigration(['export','clear','restore'].includes(mode),'usage');
  requireMigration(typeof acquire === 'function','wallet-freeze-unverified');
  const repo = loadInstallation(installation).plan.repo;
  const release = acquireMutex(repo);
  try {
    const context = loadInstallation(installation);
    requireMigration(context.plan.repo === repo,'binding-changed');
    assertWalletBrowserOffline(context);
    assertWalletArtifactExternal(context,walletExport);
    const binding = walletBinding(context.plan);
    const acquireOffline = async input => {
      const lease = await acquire(input);
      return {
        async assertFrozen() { assertWalletBrowserOffline(context); return lease.assertFrozen(); },
        read: source => lease.read(source),
        compareAndSet: (source,expected,next) => lease.compareAndSet(source,expected,next),
        release: () => lease?.release?.(),
      };
    };
    const input = {file:walletExport,binding,sources,acquire:acquireOffline};
    if (mode === 'export') {
      const exported = await exportWalletSources({...input,round});
      return {sourceCount:exported.sources.length,complete:true};
    }
    assertWalletArtifactExternal(context,journal);
    const verify = mode === 'clear' ? verifyWalletImport : verifyWalletRestore;
    const result = await reconcileWalletSources({...input,journal,mode,verify:({wallet}) => verify({installation,walletExport,walletRollback,exportDigest:wallet.digest})});
    return {sourceCount:result.sourceCount,complete:result.complete};
  } finally { release(); }
}

/** Complete observes the actual target. Apply makes it durable before its manifest advances. */
export async function runMigration(options, selected = steps) {
  const {installation, resume = false, walletExport, walletRollback} = options, contract = contractFor(selected);
  const walletStep = selected.find(step => step.id === CONSOLE_WALLET_STEP.id);
  const economy = selected.find(step => step.adopted);
  const complete = () => ({steps:selected.map(step => ({id:step.id, state:'complete'}))});
  let context = loadInstallation(installation);
  assertOffline(context);
  const repo = context.plan.repo, release = acquireMutex(repo);
  try {
    context = loadInstallation(installation);
    requireMigration(context.plan.repo === repo, 'binding-changed');
    assertOffline(context);
    const journal = validateJournal(context);
    const initialVersion = checkAdmission(context, journal, selected, contract, options);
    const headerBefore = journal.last?.header;
    const economyAdopted = resume ? headerBefore?.economyAdopted : economy?.adopted(context);
    if (!resume && walletStep) {
      if (!headerBefore && initialVersion === selected.length) {
        requireMigration(targetComplete(walletStep,context),'wallet-import-invalid');
        return complete();
      }
      const inputs = readWalletMigrationInputs(context,walletExport,walletRollback);
      context.walletImport = {...inputs,proof:walletImportProof(context,inputs.exported,economyAdopted)};
    }
    const lease = acquireLock(context.lockFile);
    try {
      let header = headerBefore;
      if (!resume) {
        const backup = resolve(options.backup);
        const saved = checked('backup-invalid', () => {
          createOfflineBackup(context.plan, backup);
          return verifyOfflineBackup(backup, context.plan);
        });
        header = {event:'migration', schema:2, id:randomUUID(), steps:contract, binding:journalBinding(context),
          backup, backupHash:hash(readFileSync(resolve(backup, 'manifest.json')))};
        if (economy) header.economyAdopted = economyAdopted;
        if (walletStep) {
          const {proof,rollback} = context.walletImport;
          requireMigration(saved.codeFingerprint !== rollback.codeFingerprint,'wallet-rollback-invalid');
          header.walletImport = {exportFile:walletExport,rollbackFile:walletRollback,rollbackDigest:rollback.digest,
            codeFingerprint:saved.codeFingerprint,proof};
        }
        appendJournal(context.journalFile, header);
      }
      const record = row => appendJournal(context.journalFile, {migrationId:header.id, ...row});
      if (journal.truncated) record({event:'journal-repaired'});
      if (lease.stale) record({event:'lock-takeover'});
      const alreadySettled = resume && journal.settledStepCount === selected.length;
      for (const [index, step] of (alreadySettled ? [] : selected).entries()) {
        const event = resume ? journal.last?.states.get(step.id) : undefined;
        const recorded = isStepSettled(event), {economyAdopted,walletImport} = header;
        if (recorded && index >= journal.settledStepCount)
          requireMigration(targetComplete(step, context, {recorded:true, economyAdopted, walletImport}), 'migration-inconsistent');
        try {
          const complete = recorded || index < journal.settledStepCount
            || targetComplete(step, context, {versioned:!event && initialVersion > index, economyAdopted, walletImport});
          if (!complete) {
            record({event:'start', step:step.id});
            await step.apply(context);
            assert.ok(targetComplete(step, context, {economyAdopted, walletImport}), 'Step target is incomplete');
          }
          const version = manifestVersion(context, contract);
          if (version <= index) {
            assert.equal(version, index, 'Migration must advance its manifest one step at a time');
            writeManifest(context, step.to);
          }
          record({event:complete ? 'skip' : 'done', step:step.id});
        } catch (error) { record({event:'failed', step:step.id}); throw error; }
      }
      return complete();
    } finally { lease.release(); }
  } finally { release(); }
}
