import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
export function companionChannelDirectory(root) {
    let directory = root;
    for (const part of ['.chatpet', 'data', 'channels']) {
        directory = join(directory, part);
        if (!existsSync(directory))
            mkdirSync(directory, { mode: 0o700 });
        const stat = lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink())
            throw Error('渠道资料必须保存在已绑定工作区内');
    }
    return directory;
}
//# sourceMappingURL=storage.js.map