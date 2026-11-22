import { check, integer } from '../core/storage.js';
const messagingFields = {
    enabled: { label: '启用渠道', kind: 'boolean', device: true },
    wsUrl: { label: '本机 OneBot 地址', kind: 'text', device: true },
    tokenEnv: { label: '本机凭据环境变量名', kind: 'text', device: true },
    accountId: { label: '接入的账号 ID', kind: 'text', device: true },
    ownerSpeakerId: { label: '主人的账号 ID', kind: 'text' },
    ownerReach: { label: '允许生活会话主动联系主人私聊', kind: 'boolean' },
    allowPrivate: { label: '允许的私聊账号（每行一个）', kind: 'lines' },
    allowGroups: { label: '允许的群（每行一个）', kind: 'lines' },
    autoReply: { label: '自动回复', kind: 'boolean' },
    voiceEnabled: { label: 'QQ 语音收发', kind: 'boolean' },
    voicePerMinute: { label: '每分钟最多语音条数（0 不限制）', kind: 'number' },
    voicePerHour: { label: '每小时最多语音条数（0 不限制）', kind: 'number' },
    groupTrigger: { label: '群聊触发方式', kind: 'select', options: { mention: '提到我或使用唤醒词', all: '所有群消息' } },
    groupKeywords: { label: '群聊唤醒词（每行一个）', kind: 'lines' },
    batchQuietMs: { label: '合并消息等待（毫秒）', kind: 'number' },
    contextMessages: { label: '近期消息条数', kind: 'number' },
    bufferSeconds: { label: '媒体等待秒数', kind: 'number' },
    mutedUntil: { label: '静默到（带时区的时间，可留空）', kind: 'text' },
};
export const defaults = {
    qq: { enabled: false, ownerReach: false, accountId: '', ownerSpeakerId: '', allowPrivate: [], allowGroups: [], contextMessages: 5,
        wsUrl: 'ws://127.0.0.1:3001', tokenEnv: '', autoReply: true, voiceEnabled: false, voicePerMinute: 2, voicePerHour: 10, groupTrigger: 'mention', groupKeywords: [], batchQuietMs: 0, mutedUntil: '' },
    wechat: { enabled: false, ownerReach: false, accountId: '', ownerSpeakerId: '', allowPrivate: [], allowGroups: [], contextMessages: 5, bufferSeconds: 3 },
};
export function editableMessagingFields() {
    const fields = (platform) => Object.entries(messagingFields)
        .filter(([key]) => Object.hasOwn(defaults[platform], key)).map(([key, { device, ...field }]) => ({ key, ...field }));
    return { qq: fields('qq'), wechat: fields('wechat') };
}
export function isDeviceMessagingField(platform, key) {
    return Object.hasOwn(defaults[platform], key) && 'device' in messagingFields[key];
}
const identifier = (value, max = 160) => typeof value === 'string' && value.length <= max && value === value.trim() && !/[\u0000-\u001F]/.test(value);
function listed(values) { return Array.isArray(values) && values.length <= 1000 && values.every(v => identifier(v) && v !== '') && new Set(values).size === values.length; }
export function messagingPreferences(before, patch) {
    check(patch && typeof patch === 'object' && !Array.isArray(patch) && Object.keys(patch).every(k => k === 'qq' || k === 'wechat'), 'Invalid messaging preferences');
    for (const platform of ['qq', 'wechat']) {
        const value = patch[platform];
        if (value !== undefined)
            check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => Object.hasOwn(defaults[platform], k)), 'Unknown channel preference');
    }
    const qq = { ...before.qq, ...patch.qq }, wechat = { ...before.wechat, ...patch.wechat };
    for (const [platform, config] of [['qq', qq], ['wechat', wechat]]) {
        check(typeof config.enabled === 'boolean' && typeof config.ownerReach === 'boolean' && identifier(config.accountId) && identifier(config.ownerSpeakerId) && listed(config.allowPrivate) && listed(config.allowGroups), 'Invalid channel account or allowlist');
        if (config.enabled)
            check(!!config.accountId, 'Select the adapter account before enabling the channel');
        if (platform === 'qq')
            check([config.accountId, config.ownerSpeakerId, ...config.allowPrivate, ...config.allowGroups].every(id => !id || /^\d{1,24}$/.test(id)), 'QQ account IDs must be numeric');
        if (platform === 'wechat')
            check(config.allowGroups.every(id => id.endsWith('@chatroom')) && config.allowPrivate.every(id => !id.endsWith('@chatroom')), 'Invalid WeChat chat type');
        integer(config.contextMessages, 'contextMessages', 0, 20);
    }
    check(typeof qq.wsUrl === 'string', 'QQ requires a local OneBot WebSocket URL');
    const url = new URL(qq.wsUrl);
    check(['ws:', 'wss:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        && !url.username && !url.password && !url.search && !url.hash, 'QQ requires a local OneBot WebSocket URL');
    check(typeof qq.tokenEnv === 'string' && (qq.tokenEnv === '' || /^CHATPET_QQ_[A-Z][A-Z0-9_]{0,80}$/.test(qq.tokenEnv)), 'QQ token must refer to a CHATPET_QQ_ environment variable');
    check(typeof qq.voiceEnabled === 'boolean' && typeof qq.autoReply === 'boolean' && (qq.groupTrigger === 'mention' || qq.groupTrigger === 'all') && listed(qq.groupKeywords)
        && (qq.mutedUntil === '' || typeof qq.mutedUntil === 'string' && Number.isFinite(Date.parse(qq.mutedUntil))), 'Invalid QQ reply settings');
    integer(qq.voicePerMinute, 'voicePerMinute', 0, 60);
    integer(qq.voicePerHour, 'voicePerHour', 0, 3600);
    integer(qq.batchQuietMs, 'batchQuietMs', 0, 30_000);
    integer(wechat.bufferSeconds, 'bufferSeconds', 0, 60);
    return { qq, wechat };
}
export function allowedIdentity(config, id) {
    if (id.channel !== 'qq' && id.channel !== 'wechat')
        return false;
    const line = config[id.channel];
    if (!line.enabled || line.accountId !== id.accountId || !id.speakerId.startsWith(id.channel + ':') || id.speakerId === id.channel + ':' + id.accountId)
        return false;
    if (id.conversationType === 'group')
        return line.allowGroups.includes(id.conversationId);
    return id.conversationType === 'private' && id.speakerId === id.channel + ':' + id.conversationId && line.allowPrivate.includes(id.conversationId);
}
export function ownerIdentity(config, id) {
    return allowedIdentity(config, id) && (id.channel === 'qq' || id.channel === 'wechat') && id.conversationType === 'private'
        && id.speakerId === id.channel + ':' + config[id.channel].ownerSpeakerId;
}
//# sourceMappingURL=messaging-settings.js.map