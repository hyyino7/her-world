import { ROOM_MOOD_DIMENSIONS } from '../contracts/emotion.js';
/** The same strict threshold applies on a timer, after dragging and after an animation ends. */
export function workAnimationEligible(startedAt, now, delaySeconds) {
    return startedAt !== null && Number.isFinite(startedAt) && now - startedAt > delaySeconds * 1000;
}
/** Shared semantic vocabulary; optional Room scores remain a separate legacy representation. */
export { COMPANION_FEELINGS } from '../contracts/emotion.js';
export function readRoomMood(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return;
    const raw = value;
    const score = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
    if (!score(raw.mood))
        return;
    const dims = {};
    if (raw.dims !== undefined) {
        if (!raw.dims || typeof raw.dims !== 'object' || Array.isArray(raw.dims))
            return;
        for (const key of ROOM_MOOD_DIMENSIONS) {
            const dimension = raw.dims[key];
            if (dimension === undefined)
                continue;
            if (!score(dimension))
                return;
            dims[key] = dimension;
        }
    }
    return { mood: raw.mood, dims };
}
export function decideExpression(intent, catalog, settings, random = Math.random) {
    const decision = {};
    if (catalog.actions.some(item => item.name === intent.action))
        decision.action = intent.action;
    if (intent.mood)
        decision.mood = intent.mood;
    if (intent.feelings)
        decision.feelings = [...intent.feelings];
    if (catalog.stickers.some(item => item.name === intent.sticker)) {
        const p = settings.stickerProbabilityPercent;
        if (p === 100 || (p > 0 && random() * 100 < p))
            decision.sticker = intent.sticker;
    }
    return decision;
}
// A final line, following visible reply text, carries optional expression. The single
// footer makes the two selections share a turn and keeps metadata out of native history.
const FOOTER = '\n<pet-expression>';
const MAX_FOOTER = 1600;
function parseFooter(raw) {
    if (raw.length > MAX_FOOTER)
        return;
    const json = raw.trim().replace(/<\/pet-expression>$/, '').trim();
    try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return;
        const small = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max ? s.trim() : undefined;
        const intent = {};
        for (const key of ['action', 'sticker', 'mood', 'reason']) {
            const value = small(parsed[key], key === 'mood' ? 48 : 160);
            if (value)
                intent[key] = value;
        }
        const roomMood = readRoomMood(parsed.roomMood);
        if (intent.mood && roomMood)
            intent.roomMood = roomMood;
        if (Array.isArray(parsed.feelings) && parsed.feelings.length <= 16 && parsed.feelings.every((item) => typeof item === 'string' && item.trim() && item.length <= 48))
            intent.feelings = [...new Set(parsed.feelings)];
        const playbackId = small(parsed.feedback?.playbackId, 160), quote = small(parsed.feedback?.quote, 240);
        if (playbackId && quote)
            intent.feedback = { playbackId, quote };
        return intent;
    }
    catch {
        return;
    }
}
export async function* expressionStream(stream, collect) {
    const parts = new Map();
    let decision;
    let tool = false;
    for await (const chunk of stream) {
        if (chunk.type === 'tool-call-delta' || (chunk.type === 'block-start' && chunk.blockType === 'tool-call'))
            tool = true;
        if (chunk.type === 'text-delta') {
            let part = parts.get(chunk.index);
            if (!part) {
                part = { pending: '', inFooter: false, overflow: false, raw: '', hasVisible: false };
                parts.set(chunk.index, part);
            }
            let text = part.pending + chunk.text;
            part.pending = '';
            if (!part.inFooter) {
                const pos = text.indexOf(FOOTER);
                if (pos < 0) {
                    let keep = Math.min(FOOTER.length - 1, text.length);
                    while (keep > 0 && !text.endsWith(FOOTER.slice(0, keep)))
                        keep--;
                    part.pending = text.slice(text.length - keep);
                    text = text.slice(0, text.length - keep);
                    if (text) {
                        part.hasVisible ||= Boolean(text.trim());
                        yield { ...chunk, text };
                    }
                    continue;
                }
                const before = text.slice(0, pos);
                if (before) {
                    part.hasVisible ||= Boolean(before.trim());
                    yield { ...chunk, text: before };
                }
                part.inFooter = true;
                text = text.slice(pos + FOOTER.length);
            }
            if (part.raw.length + text.length > MAX_FOOTER)
                part.overflow = true;
            if (!part.overflow)
                part.raw += text;
            continue;
        }
        if (chunk.type === 'block-end' && chunk.block.type === 'text') {
            const part = parts.get(chunk.index);
            const pos = chunk.block.text.indexOf(FOOTER);
            const visible = pos < 0 ? chunk.block.text : chunk.block.text.slice(0, pos);
            if (!part?.inFooter && part?.pending)
                yield { type: 'text-delta', index: chunk.index, text: part.pending };
            if (pos >= 0 && visible.trim())
                decision = parseFooter(chunk.block.text.slice(pos + FOOTER.length));
            else if (part?.inFooter && part.hasVisible && !part.overflow)
                decision = parseFooter(part.raw);
            parts.delete(chunk.index);
            yield pos < 0 ? chunk : { ...chunk, block: { ...chunk.block, text: visible } };
            continue;
        }
        if (chunk.type === 'finish') {
            for (const [index, part] of parts) {
                if (part.pending)
                    yield { type: 'text-delta', index, text: part.pending };
                if (part.inFooter && part.hasVisible && !part.overflow)
                    decision = parseFooter(part.raw);
            }
            if (decision && !tool && chunk.reason.kind === 'stop')
                collect(decision);
        }
        yield chunk;
    }
}
//# sourceMappingURL=index.js.map