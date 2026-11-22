/**
 * 第三方语音识别的注册表：单槽，后注册的覆盖先注册的。
 *
 * 与合成注册表的差别只有一处：内置来源是宿主的 `speechToText`（可能根本不存在），
 * 不是随包内置的实现，所以保留名是 `dsh` 而不是 `edge`。
 * 模块单例：注册返回 disposer；测试用 {@link resetSpeechProviders} 复位。
 * 只登记与查找：不识别、不排队、不设超时（那些归 hear.ts）。
 * @module dsh-pet/src/host/voice/speech-registry
 */
/** 内置来源的名字：宿主自带的识别能力，第三方不能占用。 */
export const BUILTIN_SPEECH_ID = 'dsh';
/** 当前生效的第三方实现；`null` = 没注册，识别走宿主自带能力。 */
let current = null;
/**
 * 注册一个第三方识别实现，覆盖当前生效的那个。
 *
 * @param def - 实现定义；`id` 不能与内置来源同名（排障时会分不清谁在跑）。
 * @returns 注销函数；只在「当前仍是这一份」时才清空，迟到的注销不会顶掉后来者。
 * @throws {TypeError} 定义非法、`transcribe` 不是函数或 id 与内置来源同名时。
 */
export function registerSpeechProvider(def) {
    if (!def || typeof def !== 'object')
        throw new TypeError('speech provider 定义必须是对象');
    if (typeof def.id !== 'string' || def.id.length === 0)
        throw new TypeError('id 必须是非空字符串');
    if (def.id === BUILTIN_SPEECH_ID)
        throw new TypeError('不能与内置来源同名: ' + BUILTIN_SPEECH_ID);
    if (typeof def.transcribe !== 'function')
        throw new TypeError('transcribe 必须是函数');
    current = def;
    return () => {
        if (current === def)
            current = null;
    };
}
/**
 * 当前该用哪个第三方实现。
 * @returns 已注册的实现；没注册时返回 `null`，调用方据此回落到宿主自带能力。
 */
export function activeSpeechProvider() {
    return current;
}
/**
 * 列出可用实现，用于排障「为什么没走我注册的那个」。
 * @returns `builtin` 恒为宿主自带来源；`external` 是当前生效的第三方 id（没有则为空数组）。
 */
export function listSpeechProviders() {
    return { builtin: [BUILTIN_SPEECH_ID], external: current ? [current.id] : [] };
}
/**
 * 清空注册，供测试隔离用例。
 * @internal
 */
export function resetSpeechProviders() {
    current = null;
}
