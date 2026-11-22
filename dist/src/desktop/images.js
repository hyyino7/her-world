import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PortableImages } from '../presentation/images.js';
function imageFiles({ path }) {
    const directory = join(path, '.chatpet/data/desktop/images');
    return {
        prepare() {
            for (const part of [join(path, '.chatpet'), join(path, '.chatpet/data'), join(path, '.chatpet/data/desktop'), directory]) {
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
export class DesktopImages extends PortableImages {
    constructor(host, attachments) {
        super(() => host.workspace.homeScope(), imageFiles, attachments);
    }
}
//# sourceMappingURL=images.js.map