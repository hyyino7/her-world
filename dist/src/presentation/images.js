import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
const oneMiB = 1024 * 1024;
const recordName = (image) => createHash('sha256')
    .update(image.mediaType + '\n' + image.data).digest('hex') + '.json';
/** Share the admission and atomic copy protocol. Each caller opens its own
 * bound directory and implements the filesystem operations. */
export class PortableImages {
    binding;
    files;
    attachments;
    maxEncodedSize;
    restored;
    constructor(binding, files, attachments, maxEncodedSize = oneMiB) {
        this.binding = binding;
        this.files = files;
        this.attachments = attachments;
        this.maxEncodedSize = maxEncodedSize;
    }
    imageScope(caller) {
        caller();
        const binding = this.binding();
        if (!binding)
            throw Error('请先初始化工作区');
        const validate = () => {
            caller();
            if (!isDeepStrictEqual(this.binding(), binding))
                throw Error('工作区已切换');
        };
        return { binding, validate, files: this.files(binding) };
    }
    validateImage(image) {
        if (!image || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.mediaType)
            || typeof image.data !== 'string' || !image.data || image.data.length > this.maxEncodedSize
            || Buffer.from(image.data, 'base64').toString('base64') !== image.data)
            throw Error('图片无效或过大');
    }
    async admit(image, caller = () => { }) {
        const { validate, files } = this.imageScope(caller);
        this.validateImage(image);
        files.prepare();
        const native = this.attachments();
        if (!native)
            throw Error('原生图片附件服务暂不可用');
        const content = await native.admitPromptContent([{ type: 'image', ...image }]);
        validate();
        files.prepare();
        const name = recordName(image), value = { schema: 1, image, content };
        const prior = files.read(name, Infinity);
        if (prior !== undefined) {
            if (prior === null || !isDeepStrictEqual(JSON.parse(prior), value))
                throw Error('已有图片副本冲突');
        }
        else {
            const staged = name + '.' + randomUUID() + '.tmp';
            files.stage(staged, JSON.stringify(value));
            try {
                files.publish(staged, name);
            }
            catch (error) {
                files.discard(staged);
                throw error;
            }
        }
        return content;
    }
    async restore(caller = () => { }) {
        const { binding, validate, files } = this.imageScope(caller);
        files.prepare();
        if (isDeepStrictEqual(this.restored, binding))
            return;
        const names = files.names().filter(name => /^[a-f0-9]{64}\.json$/.test(name));
        const native = this.attachments();
        if (names.length && !native)
            throw Error('原生图片附件服务暂不可用');
        for (const name of names) {
            const record = files.read(name, this.maxEncodedSize + oneMiB);
            if (!record)
                throw Error('图片副本无效');
            const value = JSON.parse(record);
            if (value.schema !== 1)
                throw Error('图片副本格式不支持');
            this.validateImage(value.image);
            if (recordName(value.image) !== name)
                throw Error('图片副本内容已变化');
            const content = await native.admitPromptContent([{ type: 'image', ...value.image }]);
            validate();
            files.prepare();
            if (!isDeepStrictEqual(content, value.content))
                throw Error('当前原生附件格式与图片副本不一致');
        }
        this.restored = binding;
    }
}
//# sourceMappingURL=images.js.map