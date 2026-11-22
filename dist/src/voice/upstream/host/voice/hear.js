/**
 * 语音识别服务：把一段 WAV 交给宿主的 `speechToText`，把结论收敛成「文字或失败原因」。
 *
 * 音频格式（16kHz/单声道/PCM16 WAV）由宿主 provider 校验：同一规则不在两处各写一份，
 * 否则改一边就会和另一边对不上。这里只挡明显不合法的输入，避免白跑一次推理。
 * 不负责录音与传输——进来的是已经解码的整段音频字节。
 * @module dsh-pet/src/host/voice/hear
 */
import { activeSpeechProvider } from './speech-registry.js';
/** 单次识别的音频上限（字节）：音频经 base64 塞进 1MiB 请求体，解码后约 786KiB。 */
export const MAX_AUDIO_BYTES = 768 * 1024;
/** 识别超时（毫秒）：本地 CPU 推理，一句话远低于此；超出即放弃，不无限等。 */
export const TRANSCRIBE_TIMEOUT_MS = 30_000;
/** base64 字面量：`Buffer.from` 解码很宽松，先按字母表与补齐规则挡掉脏数据。 */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
/**
 * 校验请求体；只认 `audio` 与 `language` 两个字段，其余忽略。
 *
 * @param raw - 已解析的请求体。
 * @returns 已解码的音频字节；任何字段不合法时给出可直接回给调用方的说明。
 */
function parseHearInput(raw) {
    const body = raw && typeof raw === 'object' ? raw : {};
    const encoded = typeof body.audio === 'string' ? body.audio.trim() : '';
    if (encoded === '')
        return { ok: false, message: 'audio is required' };
    if (!BASE64_PATTERN.test(encoded) || encoded.replace(/=+$/, '').length % 4 === 1) {
        return { ok: false, message: 'audio must be base64' };
    }
    const audio = new Uint8Array(Buffer.from(encoded, 'base64'));
    if (audio.byteLength === 0)
        return { ok: false, message: 'audio is empty' };
    if (audio.byteLength > MAX_AUDIO_BYTES) {
        return { ok: false, message: `audio too large (max ${MAX_AUDIO_BYTES} bytes)` };
    }
    const language = body.language;
    if (language !== undefined && (typeof language !== 'string' || language.trim() === '')) {
        return { ok: false, message: 'language must be a non-empty string' };
    }
    return {
        ok: true,
        value: { audio, ...(language === undefined ? {} : { language: language.trim() }) },
    };
}
/**
 * 给一次识别套上超时与调用方中止，把结论收敛成「值或一句说明」。
 *
 * 两个来源（第三方、宿主）都只认一个 signal，所以在这里合并，调用方不必各写一遍。
 *
 * @param signal - 调用方中止信号（连接断开）。
 * @param timeoutMs - 超时上限。
 * @param task - 真正执行识别的函数。
 * @returns 成功给任务的值；超时或抛错给原始错误说明。
 */
async function withDeadline(signal, timeoutMs, task) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
        return { ok: true, value: await task(controller.signal) };
    }
    catch (error) {
        // 实现抛错多为音频不合它意（格式/时长）：归一成 generate-error，原文给调用方。
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}
/**
 * 造识别服务。
 *
 * @param options.speechToText - 惰性取宿主服务；没启用语音输入插件时它返回 undefined。
 * @param options.timeoutMs - 单次识别超时；缺省 {@link TRANSCRIBE_TIMEOUT_MS}，测试用小值。
 * @returns 只暴露 `hear` 的服务。
 */
export function createHearService(options) {
    const timeoutMs = options.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS;
    return {
        async hear(raw, signal) {
            const parsed = parseHearInput(raw);
            if (!parsed.ok)
                return { ok: false, reason: 'bad-request', message: parsed.message };
            // 第三方优先：注册了就只走它，不再看宿主（与合成的「不回落」同一语义）。
            const provider = activeSpeechProvider();
            if (provider !== null) {
                const run = await withDeadline(signal, timeoutMs, (inner) => provider.transcribe(parsed.value, inner));
                if (!run.ok)
                    return { ok: false, reason: 'generate-error', message: run.message };
                // 第三方返回值不可信：不是字符串就当失败，避免把对象塞进 text 字段发出去。
                if (typeof run.value !== 'string') {
                    return { ok: false, reason: 'generate-error', message: 'invalid transcript from provider' };
                }
                return { ok: true, text: run.value };
            }
            const speech = options.speechToText();
            if (speech === undefined || typeof speech.transcribe !== 'function') {
                return { ok: false, reason: 'unsupported', message: 'host has no speech-to-text service' };
            }
            // 空登记表 = 插件没启用或 provider 没起来：转写必失败，提前给明确原因而不是等它抛错。
            if (speech.listProviders().length === 0) {
                return { ok: false, reason: 'unsupported', message: 'host has no speech provider enabled' };
            }
            // 宿主返回的是成品对象（文字 + 时长），这里只取文字，时长留给需要的人自己再调一次。
            const run = await withDeadline(signal, timeoutMs, async (inner) => (await speech.transcribe(speech.resolve(parsed.value), inner)).text);
            if (!run.ok)
                return { ok: false, reason: 'generate-error', message: run.message };
            return { ok: true, text: run.value };
        },
    };
}
