import { isDeepStrictEqual } from 'node:util';
import { checked, MigrationError, requireMigration } from './errors.mjs';
import { atomicWrite, hash, regular } from './io.mjs';
import {
  decodeExport, fields, locations, privatePath, readPrivate, readWalletExport,
  select, sourceDigest, sourceId, sourceKeys, validRound, validateBinding,
} from './wallet-export.mjs';

export { readWalletExport } from './wallet-export.mjs';

async function requireFrozen(lease) {
  try {
    requireMigration(await lease.assertFrozen() === true, 'wallet-freeze-unverified');
  } catch { throw new MigrationError('wallet-freeze-unverified'); }
}

async function readSource(lease, source) {
  await requireFrozen(lease);
  try {
    const value = await lease.read(select(source,sourceKeys));
    requireMigration(value === null || typeof value === 'string','wallet-source-unreadable');
    return value;
  } catch { throw new MigrationError('wallet-source-unreadable'); }
}

async function withFrozenSources(acquire, input, operation) {
  let lease;
  try { lease = await acquire(input); }
  catch { throw new MigrationError('wallet-freeze-unverified'); }
  try { await requireFrozen(lease); return await operation(lease); }
  finally { await lease?.release?.(); }
}

function matchSources(sources, wallet, binding) {
  const authorized = locations(sources,binding);
  requireMigration(isDeepStrictEqual(authorized,wallet.sources.map(row => select(row,sourceKeys))), 'wallet-source-conflict');
  return authorized;
}

/**
 * The adapter must hold exclusive access to the authorized profile/origin and
 * attest admission has closed and all wallet/Body activity has settled.
 * A successful read of null is a verified missing key. Unknown sources throw.
 */
export async function exportWalletSources({file,binding,round,sources,acquire}) {
  checked('wallet-export-invalid',() => privatePath(file));
  validateBinding(binding,binding);
  requireMigration(validRound(round),'wallet-export-invalid');
  const authorized = locations(sources,binding);
  return withFrozenSources(acquire,{binding,round,sources:authorized},async lease => {
    const rows = [];
    for (const source of authorized) {
      const raw = await readSource(lease,source);
      rows.push({...source,raw,rawDigest:sourceDigest(raw)});
    }
    const document = {format:1,binding,round,sources:rows};
    decodeExport(document,binding);
    if (regular(file)) {
      const present = readWalletExport(file,binding);
      requireMigration(present.round === round && isDeepStrictEqual(present.sources,rows),'wallet-source-conflict');
      return present;
    }
    await requireFrozen(lease);
    checked('wallet-export-invalid',() => atomicWrite(file,JSON.stringify(document) + '\n'));
    return readWalletExport(file,binding);
  });
}

function readIntent(journal, wallet, mode) {
  return checked('wallet-export-invalid',() => {
    privatePath(journal);
    const basis = {format:1,round:wallet.round,exportDigest:wallet.digest,mode};
    if (!regular(journal)) return {...basis,rows:{}};
    const {document} = readPrivate(journal,'wallet-export-invalid');
    const locations = new Set(wallet.sources.map(source => hash(sourceId(source))));
    requireMigration(fields(document,[...Object.keys(basis),'rows']) &&
      isDeepStrictEqual(select(document,Object.keys(basis)),basis) &&
      document.rows && typeof document.rows === 'object' && !Array.isArray(document.rows) &&
      Object.entries(document.rows).every(([id,state]) => locations.has(id) && ['intent','done'].includes(state)),
    'wallet-export-invalid');
    return document;
  });
}

function acceptable(state, actual, from, to, mode) {
  if (state === 'done') return actual === to;
  if (state === 'intent' || mode === 'restore') return actual === from || actual === to;
  return actual === from;
}

/** The supplied verifier checks the matching settled import or completed restore. */
export async function reconcileWalletSources({file,journal,binding,sources,acquire,mode,verify}) {
  requireMigration(['clear','restore'].includes(mode) && file !== journal,'wallet-export-invalid');
  const wallet = readWalletExport(file,binding);
  const authorized = matchSources(sources,wallet,binding);
  return withFrozenSources(acquire,{binding,round:wallet.round,sources:authorized},async lease => {
    requireMigration(typeof verify === 'function' && await verify({wallet,mode}) === true,
      mode === 'clear' ? 'wallet-import-invalid' : 'wallet-rollback-invalid');
    const intent = readIntent(journal,wallet,mode);
    const record = (id,state) => {
      intent.rows[id] = state;
      checked('wallet-export-invalid',() => atomicWrite(journal,JSON.stringify(intent) + '\n'));
    };
    const operations = [];
    for (const source of wallet.sources) {
      const id = hash(sourceId(source));
      const clearing = mode === 'clear';
      const from = clearing ? source.raw : null, to = clearing ? null : source.raw;
      const actual = await readSource(lease,source);
      requireMigration(acceptable(intent.rows[id],actual,from,to,mode),'wallet-source-conflict');
      operations.push({source,id,actual,to});
    }
    for (const {source,id,actual,to} of operations) {
      if (intent.rows[id] === 'done') continue;
      await requireFrozen(lease);
      if (intent.rows[id] !== 'intent') record(id,'intent');
      if (actual !== to)
        requireMigration(await lease.compareAndSet(select(source,sourceKeys),actual,to) === true,'wallet-source-conflict');
      requireMigration(await readSource(lease,source) === to,'wallet-source-conflict');
      record(id,'done');
    }
    return {round:wallet.round,sourceCount:operations.length,complete:true};
  });
}
