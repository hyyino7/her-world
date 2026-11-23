import {lstatSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {checked, requireInventory} from './errors.mjs';

export const json = file => JSON.parse(readFileSync(file, 'utf8'));
export function regular(file) {
  const stat = lstatSync(file, {throwIfNoEntry:false});
  requireInventory(!stat || stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'symlink-or-hardlink');
  return stat;
}
export function inspectTree(path) {
  const stat = lstatSync(path, {throwIfNoEntry:false});
  if (!stat) return;
  requireInventory(!stat.isSymbolicLink(), 'symlink-or-hardlink');
  if (stat.isDirectory()) for (const name of readdirSync(path)) inspectTree(join(path, name));
  else regular(path);
}
export function readInstallation(file) {
  return checked('receipt-invalid', () => {
    regular(file); const receipt = json(file);
    requireInventory(receipt?.status === 'installed' && receipt.packageInstalled === true &&
      typeof receipt.config?.dataDir === 'string' && receipt.config.dataDir.length > 0 &&
      typeof receipt.profileDir === 'string' && receipt.profileDir.length > 0, 'receipt-invalid');
    return receipt;
  });
}
