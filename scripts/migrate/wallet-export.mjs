import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { normalizeWalletRequest } from '../../dist/src/living/economy/console-requests.js';
import { checked, requireMigration } from './errors.mjs';
import { hash, regular } from './io.mjs';

const bindingKeys = ['storageId', 'companionId', 'workspaceId', 'repoHash', 'profileHash', 'scopeId', 'ownerActorId'];
export const sourceKeys = ['profile', 'origin', 'key'];
const validDigest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export const validRound = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const nonempty = value => typeof value === 'string' && value.length > 0;
export const fields = (row, keys) => row && typeof row === 'object' && !Array.isArray(row) &&
  Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row,key));
export const select = (row, keys) => Object.fromEntries(keys.map(key => [key,row[key]]));
export const sourceId = source => JSON.stringify(sourceKeys.map(key => source[key]));
export const sourceDigest = raw => raw === null ? null : hash(Buffer.from(raw,'utf16le'));

export function validateBinding(binding, expected) {
  requireMigration(fields(binding,bindingKeys) && bindingKeys.every(key => nonempty(binding[key])) &&
    validDigest(binding.repoHash) && validDigest(binding.profileHash) && isDeepStrictEqual(binding,expected), 'binding-changed');
}

export function locations(sources, binding) {
  requireMigration(Array.isArray(sources) && sources.length > 0, 'wallet-source-missing');
  const unique = new Map();
  for (const source of sources) {
    const origin = typeof source?.origin === 'string' && URL.canParse(source.origin) && new URL(source.origin);
    requireMigration(typeof source?.profile === 'string' && isAbsolute(source.profile) && resolve(source.profile) === source.profile &&
      origin && origin.origin !== 'null' && origin.origin === source.origin &&
      source.key === 'chatpet:economy:pending:' + binding.workspaceId, 'wallet-source-conflict');
    const id = sourceId(source);
    requireMigration(!unique.has(id), 'wallet-source-conflict');
    unique.set(id,select(source,sourceKeys));
  }
  return [...unique.keys()].sort().map(id => unique.get(id));
}

export function privatePath(file) {
  requireMigration(typeof file === 'string' && isAbsolute(file) && resolve(file) === file, 'wallet-export-invalid');
  const directory = dirname(file), stat = lstatSync(directory,{throwIfNoEntry:false});
  requireMigration(stat?.isDirectory() && (stat.mode & 0o777) === 0o700 &&
    stat.uid === process.getuid() && realpathSync(directory) === directory, 'wallet-export-invalid');
  regular(file);
}

export function readPrivate(file, missingCode) {
  privatePath(file);
  requireMigration(regular(file),missingCode);
  const fd = openSync(file,constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    requireMigration(stat.isFile() && stat.nlink === 1 && (stat.mode & 0o777) === 0o600 &&
      stat.uid === process.getuid(), 'wallet-export-invalid');
    const bytes = readFileSync(fd);
    return {document:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)), digest:hash(bytes)};
  } finally { closeSync(fd); }
}

export function decodeExport(document, binding) {
  requireMigration(fields(document,['format','binding','round','sources']) &&
    document.format === 1 && validRound(document.round), 'wallet-export-invalid');
  validateBinding(document.binding,binding);
  const locationsInOrder = locations(document.sources,binding);
  const entries = new Map();
  for (const [index, source] of document.sources.entries()) {
    requireMigration(fields(source,[...sourceKeys,'raw','rawDigest']) &&
      isDeepStrictEqual(select(source,sourceKeys),locationsInOrder[index]) &&
      (source.raw === null || typeof source.raw === 'string') &&
      source.rawDigest === sourceDigest(source.raw), 'wallet-export-invalid');
    if (source.raw === null) continue;
    const request = checked('wallet-export-invalid',() => JSON.parse(source.raw));
    requireMigration(fields(request,['requestId','endpoint','input']) &&
      nonempty(request.requestId) && request.requestId.length <= 160 && !/[\x00-\x1f\x7f]/.test(request.requestId) &&
      request.input?.workspaceId === binding.workspaceId, 'wallet-export-invalid');
    const normalized = checked('wallet-export-invalid',() => normalizeWalletRequest(request.endpoint,request.input));
    const previous = entries.get(request.requestId);
    requireMigration(!previous || previous.fingerprint === normalized.fingerprint, 'wallet-source-conflict');
    if (!previous) entries.set(request.requestId,{requestId:request.requestId,...normalized});
  }
  return {...document,entries:[...entries.values()]};
}

export function readWalletExport(file, binding) {
  return checked('wallet-export-invalid',() => {
    const {document,digest} = readPrivate(file,'wallet-export-missing');
    return {...decodeExport(document,binding),digest};
  });
}
