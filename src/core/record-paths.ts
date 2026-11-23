import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPhotoStore } from '#dsh-world/life/photos';

export function companionRecordPaths(root: string) {
  const directory = join(root, '.chatpet');
  const data = join(directory, 'data');
  const lifeDirectory = join(data, 'life');
  const photoDirectory = join(data, 'core');
  for (const path of [directory, data, lifeDirectory, photoDirectory]) {
    const stat = lstatSync(path, {throwIfNoEntry:false});
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw Error('Companion record directory is invalid');
  }
  return { directory, selfFile:join(directory, 'self.md'), diaryDir:join(directory, 'diary'),
    historyDir:join(directory, 'self.history'), lifeDirectory, photoDirectory };
}

export function prepareRecordDirectory(directory: string) {
  const stat = lstatSync(directory, {throwIfNoEntry:false});
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw Error('Companion record directory is invalid');
  if (!stat) mkdirSync(directory, {recursive:true, mode:0o700});
}

/** Reuse the upstream schema initializer without a Life service or model turn. */
export function initializeCompanionRecords(root: string) {
  const paths = companionRecordPaths(root);
  for (const directory of [paths.directory, paths.diaryDir, paths.historyDir,
    paths.photoDirectory, join(paths.photoDirectory, 'photos')]) prepareRecordDirectory(directory);
  const self = lstatSync(paths.selfFile, {throwIfNoEntry:false});
  if (self && (!self.isFile() || self.isSymbolicLink() || self.nlink !== 1)) throw Error('Companion self-description is invalid');
  if (!self) writeFileSync(paths.selfFile, '', {flag:'wx', mode:0o600});
  for (const name of COMPANION_ALBUM_FILES) {
    const stat = lstatSync(join(paths.photoDirectory, 'photos', name), {throwIfNoEntry:false});
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) throw Error('Companion album is invalid');
  }
  const album = createPhotoStore(paths.photoDirectory);
  album.close();
  return paths;
}

export const COMPANION_ALBUM_FILES = ['album.sqlite', 'album.sqlite-wal', 'album.sqlite-shm', 'album.sqlite-journal', 'index.json'] as const;
