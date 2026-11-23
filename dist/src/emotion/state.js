import { constants, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readRoomMood } from './index.js';
const MAX_DOCUMENT_BYTES = 262144;
const hash = (text) => createHash('sha256').update(text).digest('hex');
const object = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
function strings(value, name) {
    if (!Array.isArray(value) || value.length > 256 || value.some(item => typeof item !== 'string' || !item || item.length > 512))
        throw Error('Invalid emotion ' + name);
    return [...new Set(value)];
}
export function readEmotionState(value) {
    if (!object(value) || typeof value.mood !== 'string' || !value.mood.trim() || value.mood.length > 160 || typeof value.reason !== 'string' || value.reason.length > 4000 || typeof value.at !== 'number' || !Number.isFinite(value.at) || value.at < 0)
        throw Error('Invalid maintained emotion state');
    if (Object.keys(value).some(key => !['mood', 'reason', 'at', 'memories', 'feelings', 'roomMood'].includes(key)))
        throw Error('Unknown emotion content; retained for review');
    const state = { mood: value.mood, reason: value.reason, at: value.at, memories: strings(value.memories, 'memory references') };
    if (value.roomMood !== undefined) {
        const roomMood = readRoomMood(value.roomMood);
        if (!roomMood)
            throw Error('Invalid emotion Room values');
        state.roomMood = roomMood;
    }
    if (value.feelings !== undefined)
        state.feelings = strings(value.feelings, 'feelings');
    return state;
}
export class EmotionFile {
    scope;
    constructor(scope) {
        this.scope = scope;
    }
    /** Prepare the existing canonical store without inventing a first feeling. */
    initialize() {
        const current = this.load();
        const file = this.location();
        if (file && existsSync(file))
            return;
        this.write({ ...current.document, revision: 1 }, { revision: 0, contentHash: hash('absent') });
    }
    location(create = false) {
        if (realpathSync(this.scope.path) !== this.scope.path)
            throw Error('Emotion workspace moved');
        let directory = this.scope.path;
        for (const part of ['.chatpet', 'data', 'emotion']) {
            directory = join(directory, part);
            if (!existsSync(directory)) {
                if (!create)
                    return undefined;
                if (part === '.chatpet')
                    throw Error('Emotion requires an initialized companion Repo');
                mkdirSync(directory, { mode: 0o700 });
            }
            const stat = lstatSync(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink())
                throw Error('Emotion directory must remain inside the bound Repo');
        }
        return join(directory, 'state.json');
    }
    empty() { return { schema: 1, companionId: this.scope.companionId, scopeId: this.scope.scopeId, storageId: this.scope.storageId, revision: 0, current: null }; }
    load() {
        const file = this.location();
        if (!file || !existsSync(file))
            return { document: this.empty(), contentHash: hash('absent') };
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_DOCUMENT_BYTES)
            throw Error('Invalid emotion file; the original has been retained');
        const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        let text;
        try {
            text = readFileSync(fd, 'utf8');
        }
        finally {
            closeSync(fd);
        }
        const raw = JSON.parse(text);
        if (!object(raw) || raw.schema !== 1 || raw.companionId !== this.scope.companionId || raw.scopeId !== this.scope.scopeId || raw.storageId !== this.scope.storageId || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1 || Object.keys(raw).some(key => !['schema', 'companionId', 'scopeId', 'storageId', 'revision', 'current'].includes(key)))
            throw Error('Emotion identity, revision or schema mismatch; the original has been retained');
        const document = { schema: 1, companionId: this.scope.companionId, scopeId: this.scope.scopeId, storageId: this.scope.storageId, revision: Number(raw.revision), current: raw.current === null ? null : readEmotionState(raw.current) };
        return { document, contentHash: hash(text) };
    }
    snapshot(value) {
        return { status: value.document.current ? 'ready' : 'empty', revision: value.document.revision, contentHash: value.contentHash, ...(value.document.current ? { state: structuredClone(value.document.current) } : {}) };
    }
    write(document, expected) {
        // Lists may each be valid while their final UTF-8/escaped JSON exceeds the
        // reader's limit. Reject before creating/replacing any canonical file.
        const text = JSON.stringify(document, null, 2) + '\n';
        if (Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_BYTES)
            throw Error('Emotion document exceeds the readable byte limit; the existing state has been retained');
        const file = this.location(true);
        // No await between the final comparison and rename: stale editors cannot replace a newer revision.
        if (existsSync(file)) {
            const current = this.load();
            if (current.document.revision !== expected.revision || current.contentHash !== expected.contentHash)
                throw Error('Emotion changed; refresh before saving');
        }
        else if (expected.revision !== 0 || expected.contentHash !== hash('absent'))
            throw Error('Emotion file changed; refresh before saving');
        const temp = file + '.' + randomUUID() + '.tmp';
        const fd = openSync(temp, 'wx', 0o600);
        try {
            writeFileSync(fd, text);
            fsyncSync(fd);
        }
        finally {
            closeSync(fd);
        }
        try {
            renameSync(temp, file);
        }
        finally {
            if (existsSync(temp))
                unlinkSync(temp);
        }
    }
    update(input, at = Date.now()) {
        const previous = this.load();
        if (previous.document.revision !== input.expectedRevision || previous.contentHash !== input.expectedHash)
            throw Error('Emotion changed; refresh before saving');
        const state = readEmotionState({ mood: input.mood, reason: input.reason ?? '', at, memories: input.memories ?? [], ...(input.feelings ? { feelings: input.feelings } : {}), ...(input.roomMood ? { roomMood: input.roomMood } : {}) });
        const document = { ...previous.document, revision: previous.document.revision + 1, current: state };
        this.write(document, { revision: input.expectedRevision, contentHash: input.expectedHash });
        return this.snapshot(this.load());
    }
}
//# sourceMappingURL=state.js.map