import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
/** Keep upload bytes with the portable Repo; native attachment admission owns
 * validation, normalization and all model-facing references on each device. */
export class DesktopImages {
    host;
    attachments;
    component;
    maxEncodedSize;
    restored;
    constructor(host, attachments, component = 'desktop', maxEncodedSize = 1024 * 1024) {
        this.host = host;
        this.attachments = attachments;
        this.component = component;
        this.maxEncodedSize = maxEncodedSize;
    }
    directory() {
        const status = this.host.workspace.status();
        if (status.state !== 'ready' || !status.target)
            throw Error('请先初始化工作区');
        let path = status.target.path;
        for (const part of ['.chatpet', 'data', this.component, 'images']) {
            path = join(path, part);
            if (!existsSync(path))
                mkdirSync(path, { mode: 0o700 });
            if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
                throw Error('图片存储路径无效');
        }
        return path;
    }
    validate(image) {
        if (!image || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.mediaType) || typeof image.data !== 'string' || image.data.length > this.maxEncodedSize
            || !image.data || Buffer.from(image.data, 'base64').toString('base64') !== image.data)
            throw Error('图片无效或过大');
    }
    async admit(image, validateBinding = () => { }) {
        validateBinding();
        this.validate(image);
        const directory = this.directory(), native = this.attachments();
        if (!native)
            throw Error('原生图片附件服务暂不可用');
        const content = await native.admitPromptContent([{ type: 'image', ...image }]);
        validateBinding();
        if (this.directory() !== directory)
            throw Error('工作区已切换');
        const name = createHash('sha256').update(image.mediaType + '\n' + image.data).digest('hex') + '.json', file = join(directory, name);
        const value = { schema: 1, image, content };
        if (existsSync(file)) {
            const stat = lstatSync(file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !isDeepStrictEqual(JSON.parse(readFileSync(file, 'utf8')), value))
                throw Error('已有图片副本冲突');
        }
        else {
            const temp = file + '.' + randomUUID() + '.tmp';
            writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
            renameSync(temp, file);
        }
        return content;
    }
    async restore(validateBinding = () => { }) {
        validateBinding();
        const directory = this.directory();
        if (this.restored === directory)
            return;
        const files = readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
        const native = this.attachments();
        if (files.length && !native)
            throw Error('原生图片附件服务暂不可用');
        for (const name of files) {
            const file = join(directory, name), stat = lstatSync(file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > this.maxEncodedSize + 1024 * 1024)
                throw Error('图片副本无效');
            const value = JSON.parse(readFileSync(file, 'utf8'));
            if (value.schema !== 1)
                throw Error('图片副本格式不支持');
            this.validate(value.image);
            const expected = createHash('sha256').update(value.image.mediaType + '\n' + value.image.data).digest('hex') + '.json';
            if (expected !== name)
                throw Error('图片副本内容已变化');
            const content = await native.admitPromptContent([{ type: 'image', ...value.image }]);
            validateBinding();
            if (!isDeepStrictEqual(content, value.content))
                throw Error('当前原生附件格式与图片副本不一致');
        }
        this.restored = directory;
    }
}
//# sourceMappingURL=images.js.map