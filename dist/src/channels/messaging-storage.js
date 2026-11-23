import { lstatSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { durableWrite } from '#dsh-world/life/lifeStore';
import { defaults, isDeviceMessagingField, messagingPreferences } from './messaging-settings.js';
function split(config, connection) {
    return Object.fromEntries(['qq', 'wechat'].map(platform => [platform,
        Object.fromEntries(Object.entries(config[platform]).filter(([key]) => isDeviceMessagingField(platform, key) === connection))]));
}
function read(path, device) {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat)
        return;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
        throw Error('渠道设置文件无效，原文件已保留');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('渠道设置文件无效，原文件已保留');
    for (const [platform, fields] of Object.entries(value)) {
        if ((platform !== 'qq' && platform !== 'wechat') || !fields || typeof fields !== 'object' || Array.isArray(fields))
            throw Error('渠道设置文件无效，原文件已保留');
        if (Object.keys(fields).some(key => isDeviceMessagingField(platform, key) !== device))
            throw Error(device ? '设备渠道配置只接受设备连接及凭证设置' : '工作区渠道策略不能包含设备连接或凭证设置');
    }
    return value;
}
/** Device connections and portable routing policy are saved separately. */
export function messagingStorage(deviceDirectory, dataDirectory) {
    const deviceFile = join(deviceDirectory, 'messaging.json'), policyFile = join(dataDirectory, 'preferences.json');
    const device = read(deviceFile, true), savedPolicy = read(policyFile, false);
    const policy = savedPolicy ?? { qq: {}, wechat: {} };
    const merged = { qq: { ...policy.qq, ...device?.qq }, wechat: { ...policy.wechat, ...device?.wechat } };
    const current = messagingPreferences(defaults, merged);
    if (!savedPolicy)
        durableWrite(policyFile, JSON.stringify(policy, null, 2));
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