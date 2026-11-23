import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
export const MIGRATION_REASON = {
    storageVersionOutdated: 'storage-version-outdated', manifestMismatch: 'manifest-mismatch', migrationIncomplete: 'migration-incomplete',
    journalInvalid: 'journal-invalid', journalStepMismatch: 'journal-step-mismatch', bindingChanged: 'binding-changed',
    bindingNotMigratable: 'binding-not-migratable',
};
// Frozen on-disk contracts for checking 0.5.0 storage and its historical journals.
export const INITIAL_STORAGE_VERSIONS = Object.freeze({
    behavior: 1, channels: 1, core: 1, desktop: 1, economy: 1, emotion: 1, life: 1, memory: 1, room: 1, voice: 1,
});
const { behavior, economy, life, ...sharedVersions } = INITIAL_STORAGE_VERSIONS;
export const HOME_STORAGE_VERSIONS = Object.freeze({ ...sharedVersions, core: 2, living: 2 });
export const INITIAL_STORAGE_STEP = Object.freeze({ id: '0001-storage-manifest', from: null, to: INITIAL_STORAGE_VERSIONS });
export const HOME_STORAGE_STEP = Object.freeze({ id: '0002-home-identity', from: INITIAL_STORAGE_VERSIONS, to: HOME_STORAGE_VERSIONS });
export const ECONOMY_STORAGE_STEP = Object.freeze({ id: '0003-economy-marker', from: HOME_STORAGE_STEP.to,
    to: Object.freeze({ ...HOME_STORAGE_STEP.to, core: 3, living: 3 }) });
export const CONSOLE_WALLET_STEP = Object.freeze({ id: '0004-console-wallet', from: ECONOMY_STORAGE_STEP.to,
    to: Object.freeze({ ...ECONOMY_STORAGE_STEP.to, living: 4 }) });
export const CONSOLE_WALLET_IMPORT_FILE = 'console-wallet-import.json';
export const freshWalletImportProof = (binding) => ({ format: 1, mode: 'fresh', binding });
export function storageManifest(companionId, modules) {
    return { schemaVersion: 1, companionId, modules };
}
export function storageManifestIndex(manifest, companionId, contract) {
    return contract.findIndex(step => isDeepStrictEqual(manifest, storageManifest(companionId, step.to)));
}
function versionMap(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).length > 0 && Object.values(value).every(version => Number.isSafeInteger(version) && version > 0);
}
export function validateMigrationContract(contract) {
    assert.ok(Array.isArray(contract) && contract.length > 0);
    const ids = new Set(), targets = [];
    let previous = null;
    for (const step of contract) {
        assert.ok(step && typeof step.id === 'string' && step.id && !ids.has(step.id));
        assert.deepEqual(step.from, previous);
        const to = step.to;
        assert.ok(versionMap(to) && !targets.some(target => isDeepStrictEqual(target, to)));
        ids.add(step.id);
        targets.push(to);
        previous = to;
    }
}
const stepEvents = new Set(['start', 'skip', 'done', 'failed']);
const otherEvents = new Set(['lock-takeover', 'journal-repaired']);
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function isWalletImportProof(value, storageId) {
    if (!value || typeof value !== 'object')
        return false;
    const proof = value;
    return proof.format === 1 && proof.mode === 'import' && proof.binding?.storageId === storageId
        && typeof proof.binding.companionId === 'string' && !!proof.binding.companionId
        && (proof.wallet === 'adopted' || proof.wallet === 'absent' && proof.requestCount === 0)
        && typeof proof.round === 'string' && !!proof.round
        && Number.isSafeInteger(proof.sourceCount) && proof.sourceCount > 0
        && Number.isSafeInteger(proof.requestCount) && proof.requestCount >= 0 && proof.requestCount <= proof.sourceCount
        && digest(proof.sourceDigest) && digest(proof.requestDigest) && digest(proof.exportDigest);
}
function validWalletImportJournal(row, storageId) {
    return typeof row.exportFile === 'string' && isAbsolute(row.exportFile)
        && typeof row.rollbackFile === 'string' && isAbsolute(row.rollbackFile)
        && digest(row.rollbackDigest) && digest(row.codeFingerprint) && isWalletImportProof(row.proof, storageId);
}
export class MigrationBindingChanged extends Error {
}
export const settled = (segment) => segment.header.steps.every(step => isStepSettled(segment.states.get(step.id)));
export const isStepSettled = (event) => event === 'done' || event === 'skip';
export function parseMigrationJournal(text) {
    const lines = text.split('\n');
    // Only a non-newline-terminated final record may be a torn append.
    const tail = lines.pop();
    return { rows: lines.map((line) => JSON.parse(line)), truncated: tail.length > 0 };
}
export function decodeMigrationJournal(journal, storageId) {
    const ids = new Set();
    let last, settledStepCount = 0;
    for (const value of journal.rows) {
        assert.ok(value && typeof value === 'object' && !Array.isArray(value));
        const row = value;
        if (row.event === 'migration') {
            const { id, backup, schema, steps, binding, backupHash, manifestHash, economyAdopted, walletImport } = row;
            assert.ok(typeof id === 'string' && id && !ids.has(id) && typeof backup === 'string' && isAbsolute(backup));
            let header;
            if (schema === undefined && steps === undefined && binding === undefined && backupHash === undefined) {
                assert.ok(!last && digest(manifestHash) && economyAdopted === undefined && walletImport === undefined);
                header = { ...row, id, backup, steps: [INITIAL_STORAGE_STEP], backupHash: manifestHash };
            }
            else {
                assert.ok(schema === 2 && digest(backupHash) && digest(binding?.repoHash));
                validateMigrationContract(steps);
                assert.ok(economyAdopted === undefined || typeof economyAdopted === 'boolean' && steps.some(step => step.id === ECONOMY_STORAGE_STEP.id));
                if (binding.storageId !== storageId)
                    throw new MigrationBindingChanged();
                const walletStep = steps.some(step => step.id === CONSOLE_WALLET_STEP.id);
                assert.ok(walletStep ? walletImport && validWalletImportJournal(walletImport, storageId) : walletImport === undefined);
                if (last) {
                    const prior = last.header.steps;
                    assert.ok(settled(last) && steps.length > prior.length && isDeepStrictEqual(steps.slice(0, prior.length), prior));
                    settledStepCount = prior.length;
                }
                header = { ...row, id, backup, steps, binding, backupHash };
            }
            last = { header, states: new Map() };
            ids.add(id);
            continue;
        }
        assert.ok(last && row.migrationId === last.header.id && typeof row.event === 'string');
        if (stepEvents.has(row.event)) {
            assert.ok(typeof row.step === 'string' && last.header.steps.some(step => step.id === row.step));
            last.states.set(row.step, row.event);
        }
        else
            assert.ok(otherEvents.has(row.event));
    }
    if (last && settled(last))
        settledStepCount = last.header.steps.length;
    return { last, settledStepCount, truncated: journal.truncated };
}
//# sourceMappingURL=storage-migration.js.map