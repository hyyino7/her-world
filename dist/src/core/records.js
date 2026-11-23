import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDiaryReader } from '#dsh-world/life/diary';
import { createPhotoStore } from '#dsh-world/life/photos';
import { durableWrite } from '#dsh-world/life/lifeStore';
import { sameHomeBinding } from './home-binding.js';
import { COMPANION_ALBUM_FILES, companionRecordPaths, prepareRecordDirectory } from './record-paths.js';
import { readCompanionWriting, companionWritingFile } from './companion-writing.js';
import { bytesDigest, check } from './storage.js';
function checked(path, directory = false) {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat && (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)))
        throw Error('Companion archive path is invalid');
}
/** The original diary reader and album store, owned by Core rather than a scheduler. */
export class CompanionRecordLibrary {
    root;
    timeZone;
    photos;
    paths;
    constructor(root, timeZone) {
        this.root = root;
        this.timeZone = timeZone;
        this.paths = companionRecordPaths(root);
    }
    album() {
        if (this.photos)
            return this.photos;
        const dir = join(this.paths.photoDirectory, 'photos');
        prepareRecordDirectory(this.paths.photoDirectory);
        prepareRecordDirectory(dir);
        for (const name of COMPANION_ALBUM_FILES)
            checked(join(dir, name));
        return this.photos = createPhotoStore(this.paths.photoDirectory);
    }
    photoTools = Object.freeze({
        keep: (...args) => this.album().keep(...args),
        list: (...args) => this.album().list(...args),
        forget: (...args) => this.album().forget(...args),
    });
    dates(activityDays = () => []) {
        checked(this.paths.diaryDir, true);
        return [...new Set([...createDiaryReader(this.paths.diaryDir).dates(), ...activityDays()])].sort().reverse();
    }
    journal(day, readActivity = () => []) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
            throw Error('日期无效');
        checked(this.paths.diaryDir, true);
        checked(join(this.paths.diaryDir, day + '.md'));
        return { day, activity: readActivity(day) };
    }
    close() { this.photos?.close(); this.photos = undefined; }
}
export class CoreRecords {
    workspace;
    native;
    closed = false;
    current;
    lookup = () => undefined;
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    constructor(workspace, native) {
        this.workspace = workspace;
        this.native = native;
    }
    connect(lookup) { this.lookup = lookup; }
    getLibrary(workspaceId) {
        const state = this.workspace.status(), target = state.state === 'ready' ? state.target : null;
        if (!target || target.id !== workspaceId)
            throw { code: 'STALE_BINDING' };
        if (this.current?.id !== target.id || this.current.root !== target.path) {
            this.current?.library.close();
            this.current = { id: target.id, root: target.path, library: new CompanionRecordLibrary(target.path, this.timeZone) };
        }
        return this.current.library;
    }
    scope(workspaceId) {
        const library = this.getLibrary(workspaceId), current = this.lookup(workspaceId);
        return { id: workspaceId, directory: library.paths.directory, timeZone: this.timeZone,
            sessionIds: current?.sessionIds ?? [], isHome: () => false };
    }
    async readSelf(workspaceId) {
        const scope = this.scope(workspaceId), file = companionWritingFile({ workspace: this.workspace }, scope, 'self.md');
        const content = await readCompanionWriting({ workspace: this.workspace }, scope, 'self.md');
        companionWritingFile({ workspace: this.workspace }, scope, 'self.md');
        return { text: content ?? '', revision: bytesDigest(Buffer.from(content ?? '')), path: file };
    }
    async saveSelf(workspaceId, expectedRevision, value, validate) {
        const home = this.workspace.homeScope();
        const assertCurrent = () => {
            validate?.();
            if (this.closed || home?.workspaceId !== workspaceId || !sameHomeBinding(this.workspace.homeScope(), home))
                throw { code: 'STALE_BINDING' };
        };
        assertCurrent();
        check(typeof value === 'string' && Buffer.byteLength(value) <= 64 * 1024, 'Invalid self-description');
        const current = await this.readSelf(workspaceId);
        assertCurrent();
        if (current.revision !== expectedRevision)
            throw { code: 'STALE_REVISION' };
        const scope = this.scope(workspaceId), file = companionWritingFile({ workspace: this.workspace }, scope, 'self.md');
        check(file === current.path, 'Companion writing binding changed');
        // readStable verifies the asynchronous snapshot, not a later save. Compare
        // again in the same synchronous boundary as the write so two old forms
        // cannot both succeed after awaiting that snapshot.
        let latest = '', fd;
        try {
            fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        if (fd !== undefined)
            try {
                const stat = fstatSync(fd);
                check(stat.isFile() && stat.nlink === 1, 'Companion self-description is invalid');
                // The prior stable reader accepts at most 2 MiB; a larger replacement is
                // already a stale snapshot and must not be loaded during the final CAS.
                if (stat.size > 2 * 1024 * 1024)
                    throw { code: 'STALE_REVISION' };
                latest = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(fd)).replace(/^\ufeff/, '');
                const after = fstatSync(fd);
                if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
                    throw { code: 'STALE_REVISION' };
            }
            finally {
                closeSync(fd);
            }
        if (bytesDigest(Buffer.from(latest)) !== expectedRevision)
            throw { code: 'STALE_REVISION' };
        assertCurrent();
        durableWrite(file, value);
        return { text: value, revision: bytesDigest(Buffer.from(value)), path: file };
    }
    async library(workspaceId, operation, input) {
        const library = this.getLibrary(workspaceId), current = this.lookup(workspaceId);
        if (!current || current.path !== library.root)
            throw { code: 'STALE_BINDING' };
        const binding = { workspaceId, path: library.root, storageId: this.workspace.storageId() };
        const scope = { id: workspaceId, directory: library.paths.directory,
            timeZone: library.timeZone, sessionIds: current.sessionIds, isHome: () => false };
        const read = (name) => readCompanionWriting({ workspace: this.workspace }, scope, name);
        const verify = () => {
            if (this.getLibrary(workspaceId) !== library || this.lookup(workspaceId)?.path !== binding.path ||
                this.workspace.storageId() !== binding.storageId)
                throw { code: 'STALE_BINDING' };
        };
        const activities = () => this.native.companionPorts.get('activities');
        const dates = () => { verify(); return library.dates(() => activities()?.activityDays(binding) ?? []); };
        if (operation === 'dates')
            return dates();
        if (operation === 'journal' && typeof input === 'string') {
            const entry = library.journal(input, day => activities()?.activity(binding, day) ?? []);
            const diary = await read('diary/' + entry.day + '.md');
            verify();
            return { ...entry, diary: diary ?? null };
        }
        if (operation === 'search') {
            const { query, offset } = input;
            if (typeof query !== 'string' || !query.trim() || query.length > 256 || !Number.isSafeInteger(offset) || offset < 0)
                throw { code: 'INVALID_ARGUMENT' };
            const dialogue = await this.native.memory?.dialogueForDay(workspaceId, current.sessionIds, { query, offset, timeZone: this.timeZone });
            const diaries = [];
            if (offset === 0)
                for (const date of dates()) {
                    const content = await read('diary/' + date + '.md');
                    const at = content?.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase()) ?? -1;
                    if (content && at >= 0)
                        diaries.push({ date, excerpt: content.slice(Math.max(0, at - 50), at + 150) });
                }
            verify();
            return { dialogue, diaries };
        }
        if (operation === 'album' && Number.isSafeInteger(input))
            return library.album().list(12, input);
        if (typeof input !== 'string' || !/^photo-[a-z0-9-]{1,80}$/i.test(input))
            throw { code: 'INVALID_ARGUMENT' };
        if (operation === 'forgetPhoto') {
            library.album().forget(input);
            return { removed: true };
        }
        if (operation !== 'photo')
            throw { code: 'INVALID_ARGUMENT' };
        const image = library.album().image(input);
        if (!image)
            throw { code: 'NOT_FOUND' };
        return { mediaType: image.ref.mediaType, data: Buffer.from(image.data).toString('base64') };
    }
    close() { this.closed = true; this.current?.library.close(); this.current = undefined; }
}
//# sourceMappingURL=records.js.map