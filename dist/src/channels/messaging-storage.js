import { lstatSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { durableWrite } from '#dsh-world/life/lifeStore';
import { defaults, isDeviceMessagingField, messagingPreferences } from './messaging-settings.js';
function split(config, connection) {
    return Object.fromEntries(['qq', 'wechat'].map(platform => [platform,
        Object.fromEntries(Object.entries(config[platform]).filter(([key]) => isDeviceMessagingField(platform, key) === connection))]));
}
function read(path) {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat)
        return;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
        throw Error('渠道设置文件无效，原文件已保留');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('渠道设置文件无效，原文件已保留');
    return value;
}
/** Device connection/account bindings and portable routing policy never share
 * a persisted file. Legacy policy migrates only from this stable scope's file.
 */
export function messagingStorage(deviceDirectory, dataDirectory) {
    const deviceFile = join(deviceDirectory, 'messaging.json'), policyFile = join(dataDirectory, 'preferences.json');
    const device = read(deviceFile), savedPolicy = read(policyFile);
    if (savedPolicy)
        for (const [platform, values] of Object.entries(savedPolicy)) {
            if (!['qq', 'wechat'].includes(platform) || !values || typeof values !== 'object' || Array.isArray(values)
                || Object.keys(values).some(key => isDeviceMessagingField(platform, key)))
                throw Error('工作区渠道策略不能包含设备连接或凭证设置');
        }
    const legacy = messagingPreferences(defaults, device ?? {});
    const hasLegacyPolicy = device && ['qq', 'wechat'].some(platform => Object.keys(device[platform] ?? {}).some(key => !isDeviceMessagingField(platform, key)));
    const policy = savedPolicy ?? (hasLegacyPolicy ? split(legacy, false) : { qq: {}, wechat: {} });
    const connection = split(legacy, true);
    const merged = { qq: { ...policy.qq, ...connection.qq }, wechat: { ...policy.wechat, ...connection.wechat } };
    const current = messagingPreferences(defaults, merged);
    if (!savedPolicy)
        durableWrite(policyFile, JSON.stringify(policy, null, 2));
    // Complete the one-way migration only after its portable half is durable.
    if (device) {
        durableWrite(deviceFile, JSON.stringify(connection, null, 2));
        chmodSync(deviceFile, 0o600);
    }
    return {
        current,
        save(next) {
            durableWrite(policyFile, JSON.stringify(split(next, false), null, 2));
            durableWrite(deviceFile, JSON.stringify(split(next, true), null, 2));
            chmodSync(deviceFile, 0o600);
        },
    };
}
//# sourceMappingURL=messaging-storage.js.map