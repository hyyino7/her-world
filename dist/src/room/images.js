import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PortableImages } from '../presentation/images.js';
function imageFiles({ path }) {
    const directory = join(path, '.chatpet/data/room/images');
    return {
        prepare() {
            for (const part of [join(path, '.chatpet'), join(path, '.chatpet/data'), join(path, '.chatpet/data/room'), directory]) {
                if (!lstatSync(part, { throwIfNoEntry: false }))
                    mkdirSync(part, { mode: 0o700 });
                if (!lstatSync(part).isDirectory())
                    throw Error('图片存储路径无效');
            }
        },
        names: () => readdirSync(directory),
        read(name, maxBytes) {
            const file = join(directory, name), stat = lstatSync(file, { throwIfNoEntry: false });
            if (!stat)
                return;
            if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes)
                return null;
            return readFileSync(file, 'utf8');
        },
        stage: (name, value) => writeFileSync(join(directory, name), value, { mode: 0o600, flag: 'wx' }),
        publish: (staged, name) => renameSync(join(directory, staged), join(directory, name)),
        discard: name => rmSync(join(directory, name), { force: true }),
    };
}
export class RoomImages extends PortableImages {
    constructor(host, attachments) {
        super(() => host.workspace.homeScope(), imageFiles, attachments, maxEncodedSize);
    }
}
const frameLimit = 2.5 * 1024 * 1024;
const maxEncodedSize = Math.ceil(frameLimit / 3) * 4;
export function televisionImage(input) {
    if (typeof input !== 'string' || input.length > maxEncodedSize + 64)
        throw Error('电视截图过大或缺失');
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/]+={0,2})$/.exec(input);
    if (!match || Buffer.byteLength(match[2], 'base64') > frameLimit)
        throw Error('电视截图格式无效');
    return { mediaType: match[1], data: match[2] };
}
//# sourceMappingURL=images.js.map