import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { conversationKey, speakerIdentity } from '#dsh-world/ecosystem/shared/identity';
import { durableWrite } from '#dsh-world/life/lifeStore';
import { recordAffinity, loadAffinity, formatAffinityCard } from '#feiyu-room/affinity';
import { buildExtractionPrompt, buildSlangContext, loadSlang, saveSlang, upsertSlangEntry } from '#feiyu-room/slang-learner';
import { selectRoleText, roleSectionReport } from '#feiyu-room/role-card';
import { isSilentMarker } from '#feiyu-room/group-wake';
import { extractForwardIds, formatForwardResponse } from '#feiyu-room/forward';
import { buildStickerContext, loadStickerStore, saveStickerStore, mergeStickerLibrary, formatStickerList, findSticker, applyStickerNote, markStickerUsed } from '#feiyu-room/sticker-lib';
import { privateDeviceDirectory } from './bridge.js';
import { groupTools } from './group-tools.js';
import { defaultWake, GroupSocial, socialOperations, wakeSettings } from './group-social.js';
const defaults = { affinity: true, slang: true, stickers: true, forwards: true, roleCard: '', roleMode: 'v1', wake: defaultWake };
const requireValue = (value, message) => { if (!value)
    throw Error(message); };
function readFile(directory, name) {
    const file = join(directory, name), stat = lstatSync(file, { throwIfNoEntry: false });
    requireValue(!stat || stat.isFile() && stat.nlink === 1 && !stat.isSymbolicLink(), '群资料存储不可用');
    return file;
}
function readJson(file, fallback) {
    if (!lstatSync(file, { throwIfNoEntry: false }))
        return fallback;
    return JSON.parse(readFileSync(file, 'utf8'));
}
function settings(value) {
    const s = value;
    requireValue(s && Object.keys(s).every(k => Object.hasOwn(defaults, k)) && [s.affinity, s.slang, s.stickers, s.forwards].every(v => typeof v === 'boolean')
        && typeof s.roleCard === 'string' && Buffer.byteLength(s.roleCard) <= 64 * 1024 && ['v1', 'v2'].includes(s.roleMode), '群玩法设置无效');
    return { ...s, wake: wakeSettings(s.wake ?? defaultWake) };
}
function publicSticker(s) {
    return { id: s.id, label: s.localNote || s.desc || s.id, desc: s.desc, note: s.localNote, tags: s.tags, usage: s.usage, useCount: s.useCount };
}
export class GroupGameplay {
    options;
    disposed = false;
    bound = new Map();
    rooms = new Map();
    constructor(options) {
        this.options = options;
    }
    available(identity) {
        return !this.disposed && this.options.active() && identity.channel === 'qq' && identity.conversationType === 'group' && this.options.allowed(identity);
    }
    directory(account, group) {
        requireValue(!this.disposed && this.options.active() && /^\d{1,24}$/.test(account) && /^\d{1,24}$/.test(group), '群资料已停用或群号无效');
        const root = this.options.dataDirectory;
        requireValue(root, '群资料需要已绑定的伙伴资料目录');
        const dir = privateDeviceDirectory(root, 'group-material');
        return privateDeviceDirectory(dir, createHash('sha256').update(JSON.stringify([account, group])).digest('hex'));
    }
    files(identity) {
        requireValue(this.available(identity), '当前群已停用');
        return this.filesAt(this.directory(identity.accountId, identity.conversationId));
    }
    filesAt(dir) {
        return { settings: readFile(dir, 'settings.json'), affinity: readFile(dir, 'affinity.json'), slang: readFile(dir, 'slang.json'),
            stickers: readFile(dir, 'stickers.json'), impressions: readFile(dir, 'impressions.json'), corpus: readFile(dir, 'recent.json'), social: readFile(dir, 'social.json') };
    }
    social(file) { let room = this.rooms.get(file); if (!room) {
        room = new GroupSocial(file, this.options.companionName);
        this.rooms.set(file, room);
    } return room; }
    corpus(file) { return readJson(file, { lines: [], forwards: [] }); }
    write(file, data) { durableWrite(file, JSON.stringify(data)); }
    /** Consume structured platform segments only after gateway identity and duplicate checks. */
    receive(identity, msg, flags) {
        if (!this.available(identity) || !identity.platformMessageId)
            return;
        const file = this.files(identity), prefs = settings(readJson(file.settings, defaults));
        const scope = this.corpus(file.corpus);
        if (scope.lines.some(row => row.id === identity.platformMessageId))
            return;
        const segments = msg.segments ?? [];
        const replyId = segments.find(s => s.type === 'reply')?.data?.id;
        const target = replyId == null ? undefined : scope.lines.find(row => row.id === String(replyId));
        const quote = target ? { id: target.id, sender: target.sender, text: target.text.slice(0, 200) } :
            flags.replyToSelf && replyId != null ? { id: String(replyId), sender: '大肥鱼' } : undefined;
        if (prefs.roleMode === 'v2')
            this.social(file.social).observe(identity, msg.text, segments, flags.replyToSelf, prefs.wake);
        const mentioned = segments.some(seg => seg.type === 'at' && String(seg.data?.qq) === identity.accountId);
        if (prefs.affinity && (mentioned || flags.replyToSelf))
            recordAffinity({ groupId: identity.conversationId, userId: identity.speakerId,
                name: identity.speakerName, text: msg.text, quoteTargetIsSelf: flags.replyToSelf, hasMedia: segments.some(s => ['image', 'mface', 'face'].includes(s.type)) }, file.affinity);
        const forwards = prefs.forwards ? extractForwardIds(segments) : [];
        const stickers = prefs.stickers ? segments.filter(s => ['image', 'mface'].includes(s.type)).flatMap(seg => {
            const id = String(seg.data?.emoji_id ?? seg.data?.emojiId ?? '');
            return id && /^[a-zA-Z0-9_-]{1,180}$/.test(id) ? [{ emoji_id: id, desc: String(seg.data?.summary ?? '').slice(0, 100) }] : [];
        }) : [];
        scope.lines.push({ id: identity.platformMessageId, speakerId: identity.speakerId, sender: identity.speakerName ?? identity.speakerId,
            affinityQuery: !!prefs.affinity && (mentioned || flags.replyToSelf) && /查看好感度|查好感度/.test(msg.text),
            text: prefs.slang || prefs.forwards ? msg.text.slice(0, 300) : '', forwards, stickers, quote });
        scope.lines = scope.lines.slice(-100);
        scope.forwards = [...new Set([...scope.forwards, ...forwards])].slice(-1000);
        this.write(file.corpus, scope);
    }
    decision(identity, configuredTrigger = false, recovering = false) {
        if (!this.available(identity))
            return { mode: 'v1', wake: false };
        const file = this.files(identity), prefs = settings(readJson(file.settings, defaults));
        return { mode: prefs.roleMode, wake: prefs.roleMode === 'v2' ? this.social(file.social).wake(identity, configuredTrigger, prefs.wake, recovering) : configuredTrigger };
    }
    response(identity, nativeReply, admittedMode) {
        if (!this.available(identity))
            return '';
        const f = this.files(identity), mode = settings(readJson(f.settings, defaults)).roleMode;
        if (admittedMode && admittedMode !== mode) {
            this.social(f.social).response(identity);
            return '';
        }
        if (mode === 'v2')
            return this.social(f.social).response(identity);
        return isSilentMarker(nativeReply) ? '' : nativeReply;
    }
    quoteTarget(identity) {
        if (!this.available(identity))
            return;
        const file = this.files(identity);
        if (settings(readJson(file.settings, defaults)).roleMode === 'v2')
            return this.social(file.social).quoteTarget(identity);
    }
    material({ identity }) {
        if (!this.available(identity))
            return '';
        const f = this.files(identity), prefs = settings(readJson(f.settings, defaults)), recent = this.corpus(f.corpus);
        const line = recent.lines.find(row => row.id === identity.platformMessageId);
        const records = prefs.affinity && line?.affinityQuery ? loadAffinity(f.affinity) : {};
        const record = records['group:' + identity.conversationId + ':' + identity.speakerId];
        const impression = prefs.affinity && readJson(f.impressions, []).find(row => row.speakerId === identity.speakerId);
        const fresh = recent.lines.slice(recent.lines.findIndex(row => row.id === recent.learnedThrough) + 1).filter(row => row.text);
        const learn = prefs.slang && fresh.length >= 10 ? fresh.slice(0, 20) : [];
        if (learn.length) {
            recent.learnedThrough = learn[learn.length - 1].id;
            this.write(f.corpus, recent);
        }
        return [
            prefs.roleCard && selectRoleText(prefs.roleCard, prefs.roleMode).slice(0, 6000),
            prefs.roleMode === 'v1' && '若决定在这一轮保持安静，只回复 [SILENT]。',
            prefs.roleMode === 'v2' && '当前群启用了二代群聊。先看 qq_get_unread 的群聊资料；若想参与，用 qq_send_message 选择要发给本群的正文；若继续旁观，用 qq_feedback 选择 silent。看过的消息用 qq_mark_read 确认水位。',
            line?.quote && '这条消息实际引用了本群里的另一条消息，所回复的对象和可用原文：' + JSON.stringify(line.quote),
            line && (prefs.stickers || prefs.slang) && '本群消息编号 ' + line.id,
            record && formatAffinityCard(record).replace('【小蓝鱼的好感度】', '【大肥鱼的好感度】'),
            impression && '对当前群友的印象 ' + JSON.stringify({ name: impression.name, traits: impression.traits, interactions: impression.interactionCount }),
            prefs.slang && buildSlangContext(loadSlang(f.slang)),
            prefs.stickers && buildStickerContext(loadStickerStore(f.stickers), 8, { key: identity.conversationId }),
            prefs.forwards && line?.forwards.length && '本条消息包含合并转发 ' + JSON.stringify(line.forwards),
            prefs.stickers && line?.stickers.length && '本条消息可收藏表情 ' + JSON.stringify(line.stickers.map(s => s.emoji_id)),
            learn.length > 0 && '本群待观察的词语可以用 qq_slang_submit 提交候选，messageId 应使用以下编号表中的真实消息编号。' +
                JSON.stringify(learn.map((row, i) => ({ source_id: i + 1, messageId: row.id }))) + '\n' +
                buildExtractionPrompt(learn).split('聊天记录：\n').at(-1).split('\n请只输出 JSON 数组')[0],
        ].filter(Boolean).join('\n\n');
    }
    async manage(account, allowedGroups, operation, input) {
        const group = String(input.groupId ?? '');
        requireValue(allowedGroups.includes(group), '此群不在当前帐号白名单');
        const f = this.filesAt(this.directory(account, group)), prefs = settings(readJson(f.settings, defaults));
        if (operation === 'groupSettings') {
            if (!isDeepStrictEqual(input.expected, prefs))
                throw { code: 'STALE_REVISION' };
            this.write(f.settings, settings(input.next));
        }
        else if (operation === 'groupSlang' || operation === 'groupResearch') {
            requireValue(prefs.slang, '本群黑话学习已关闭');
            const entries = loadSlang(f.slang), term = String(input.content ?? '').trim();
            const current = entries.find(e => e.content === term);
            requireValue(term && term.length <= 50, '无效的群内词条');
            if (operation === 'groupResearch') {
                requireValue(current?.status === 'candidate', '请选择本群尚待审核的候选词');
                if (!this.options.search)
                    return { available: false, sources: [], message: '设备未配置搜索服务' };
                try {
                    const result = await this.options.search(term);
                    requireValue(!this.disposed && this.options.active(), '群已切换');
                    const sources = result.sources.filter(s => /^https?:\/\//i.test(s.url)).slice(0, 5)
                        .map(s => ({ url: s.url, title: (s.title ?? '').slice(0, 200), snippet: (s.snippet ?? s.summary ?? '').slice(0, 600) }));
                    return { available: true, sources };
                }
                catch {
                    return { available: false, sources: [], message: '搜索服务暂不可用或未配置' };
                }
            }
            const { status, meaning, usage } = input;
            const definition = meaning ?? current?.meaning ?? '', usageText = usage ?? current?.usage ?? '';
            requireValue(['confirmed', 'candidate', 'rejected'].includes(String(status)) && typeof definition === 'string' && definition.length <= 300 &&
                (status !== 'confirmed' || definition.trim()) && typeof usageText === 'string' && usageText.length <= 300, '无效的审核内容');
            const patched = upsertSlangEntry(entries, term, { status: status, meaning: String(definition), usage: String(usageText),
                source: 'manual', countIncrement: 0 });
            saveSlang(f.slang, patched.entries);
        }
        else
            requireValue(operation === 'groupState', '未知群操作');
        const saved = settings(readJson(f.settings, defaults));
        return { settings: saved, social: this.social(f.social).view(), roleSections: roleSectionReport(saved.roleCard, saved.roleMode),
            affinity: Object.values(loadAffinity(f.affinity)).map(row => ({ name: row.name, userId: row.userId, score: row.score, card: formatAffinityCard(row).replace('【小蓝鱼的好感度】', '【大肥鱼的好感度】') })),
            impressions: readJson(f.impressions, []),
            slang: loadSlang(f.slang).map(({ content, meaning, usage, count, status }) => ({ content, meaning, usage, count, status })),
            stickers: formatStickerList(loadStickerStore(f.stickers), '', 100).stickers.map(publicSticker) };
    }
    async action(identity, operation, input, transport) {
        const f = this.files(identity), prefs = settings(readJson(f.settings, defaults)), scope = this.corpus(f.corpus);
        if (socialOperations.has(operation)) {
            requireValue(prefs.roleMode === 'v2', '本群未开启二代');
            if (operation === 'qq_reply' || ((operation === 'qq_send_message') && input.replyToMessageId !== undefined)) {
                requireValue(input.replyToMessageId && scope.lines.some(row => row.id === input.replyToMessageId), '只能引用本群已收到的消息');
            }
            return this.social(f.social).act(identity, operation, input);
        }
        if (['qq_memory_append', 'qq_memory_update', 'qq_memory_remove'].includes(operation)) {
            requireValue(prefs.affinity, '本群成员印象已关闭');
            const row = scope.lines.find(r => r.id === input.messageId);
            requireValue(row?.speakerId, '只能使用本群收到的成员消息作为印象来源');
            const rows = readJson(f.impressions, []), index = rows.findIndex(e => e.speakerId === row.speakerId);
            const current = rows[index];
            if (operation === 'qq_memory_remove') {
                if (current)
                    rows.splice(index, 1);
            }
            else {
                const note = String(input.note ?? '').trim().slice(0, 50);
                requireValue(note && (operation === 'qq_memory_append' || current), '需提供简短印象，更新前应已有记录');
                const traits = operation === 'qq_memory_update' ? note.split(/[,，、]/).map(s => s.trim()).filter(Boolean) :
                    [...new Set([...(current?.traits ?? []), note])];
                const entry = { speakerId: row.speakerId, name: row.sender, traits: traits.slice(-10),
                    interactionCount: (current?.interactionCount ?? 0) + (operation === 'qq_memory_append' ? 1 : 0), lastSeenAt: Date.now() };
                if (current)
                    rows.splice(index, 1);
                rows.push(entry);
            }
            this.write(f.impressions, rows.slice(-50));
            return { updated: true };
        }
        if (operation === 'qq_slang_query' || operation === 'qq_slang_submit') {
            requireValue(prefs.slang, '本群黑话学习已关闭');
            const terms = loadSlang(f.slang);
            if (operation === 'qq_slang_query')
                return terms.filter(e => e.status !== 'rejected' && (!input.query || e.content.includes(input.query)))
                    .slice(0, 50).map(({ content, status, meaning }) => ({ content, status, meaning }));
            const term = String(input.term ?? '').trim(), line = scope.lines.find(row => row.id === input.messageId);
            requireValue(term && term.length <= 50 && line?.text.includes(term), '候选词必须出现在本群近期的指定消息中');
            const existing = terms.find(item => item.content === term);
            if (existing && (existing.status !== 'candidate' || existing.evidence.some(e => ('messageId' in e) && e.messageId === line.id)))
                return { status: existing.status };
            const evidence = { sender: line.sender, text: line.text, time: Date.now(), messageId: line.id };
            saveSlang(f.slang, upsertSlangEntry(terms, term, { evidence: [evidence] }).entries);
            return { status: 'candidate' };
        }
        if (operation === 'qq_get_forward_msg') {
            requireValue(prefs.forwards && input.id && scope.forwards.includes(input.id) && transport.forward, '该转发不在本群已接收消息中，或网关不支持');
            const result = formatForwardResponse(await transport.forward(input.id));
            const current = this.files(identity), recent = this.corpus(current.corpus);
            requireValue(settings(readJson(current.settings, defaults)).forwards, '转发读取已关闭');
            recent.forwards = [...new Set([...recent.forwards, ...result.messages.flatMap(m => m.nestedForwardIds)])].slice(-1000);
            this.write(current.corpus, recent);
            return { total: result.total, truncated: result.truncated, messages: result.messages.map(({ sender, text, nestedForwardIds }) => ({ sender, text, nestedForwardIds })) };
        }
        requireValue(prefs.stickers, '本群表情库已关闭');
        const stickers = loadStickerStore(f.stickers);
        if (operation === 'qq_list_stickers')
            return formatStickerList(stickers, input.query, 100).stickers.map(publicSticker);
        if (operation === 'qq_collect_sticker') {
            const seen = scope.lines.find(r => r.id === input.messageId)?.stickers.find(s => s.emoji_id === input.id);
            requireValue(seen, '该消息没有此表情');
            const merged = mergeStickerLibrary(stickers, [seen], { complete: false });
            const result = applyStickerNote(merged, seen.emoji_id, input.note === undefined ? {} : { note: input.note });
            saveStickerStore(f.stickers, result.entries);
            return publicSticker(result.entry);
        }
        const sticker = input.id ? findSticker(stickers, input.id) : null;
        requireValue(sticker, '本群未收藏这个表情');
        if (operation === 'qq_sticker_note') {
            const result = applyStickerNote(stickers, sticker.id, { note: input.note });
            saveStickerStore(f.stickers, result.entries);
            return publicSticker(result.entry);
        }
        requireValue(operation === 'qq_send_sticker' && transport.sendSticker, '网关不能发送该表情');
        await transport.sendSticker(identity, sticker.id);
        const current = this.files(identity), latest = loadStickerStore(current.stickers);
        saveStickerStore(current.stickers, markStickerUsed(latest, sticker.id, identity.conversationId).entries);
        return { sent: true };
    }
    bind(agent, identity, stillAllowed, transport) {
        if (!this.available(identity) || this.bound.has(agent))
            return;
        const valid = (name) => {
            if (!this.available(identity) || !stillAllowed() || agent.session.header.agentPreset !== 'chatpet-channel-guest')
                return false;
            const config = settings(readJson(this.files(identity).settings, defaults));
            if (socialOperations.has(name))
                return config.roleMode === 'v2';
            if (name.startsWith('qq_memory_'))
                return config.affinity;
            if (name.startsWith('qq_slang_'))
                return config.slang;
            if (name === 'qq_get_forward_msg')
                return config.forwards && !!transport.forward;
            return config.stickers && (name !== 'qq_send_sticker' || !!transport.sendSticker);
        };
        const dispose = groupTools(agent, valid, (name, args) => {
            let source;
            for (const event of [...agent.session.snapshotEvents()].reverse()) {
                if (event.type === 'turn/start')
                    break;
                if (event.type === 'user/message' && event.data.source.kind === 'user' && 'identity' in event.data.source) {
                    source = speakerIdentity(event.data.source.identity);
                    break;
                }
            }
            if (!source || conversationKey(source) !== conversationKey(identity) || !this.available(source))
                throw Error('缺少当前群的发言来源');
            return this.action(source, name, args, transport);
        });
        this.bound.set(agent, dispose);
    }
    unbind() { for (const dispose of this.bound.values())
        dispose(); this.bound.clear(); }
    stop() { this.disposed = true; this.unbind(); this.rooms.clear(); }
}
export function createGroupGameplay(options) { return new GroupGameplay(options); }
//# sourceMappingURL=group-material.js.map