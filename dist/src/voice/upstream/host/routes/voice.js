import { failResult, invalidJson, methodNotAllowed, okResult } from './result.js';
/** 语音领域：未命中返回 undefined，命中返回应答。 */
export async function handleVoiceRoutes(deps, input) {
    const { body, method, rest, signal } = input;
    if (rest === 'voice/voices') {
        if (method !== 'GET')
            return methodNotAllowed();
        return okResult({ ok: true, voices: deps.voice.listVoices() });
    }
    if (rest === 'voice/speak') {
        if (method !== 'POST')
            return methodNotAllowed();
        let parsed;
        try {
            parsed = JSON.parse(body ?? 'null');
        }
        catch {
            return invalidJson();
        }
        const result = await deps.voice.speak(parsed, signal);
        if (!result.ok)
            return failResult(result.reason, result.message);
        return { kind: 'file', file: result.file, contentType: 'audio/mpeg' };
    }
    // 与 /voice/speak 反向：音频进、文字出。格式由宿主 provider 校验，这里只转发结论。
    if (rest === 'voice/hear') {
        if (method !== 'POST')
            return methodNotAllowed();
        let parsed;
        try {
            parsed = JSON.parse(body ?? 'null');
        }
        catch {
            return invalidJson();
        }
        const result = await deps.speech.hear(parsed, signal);
        if (!result.ok)
            return failResult(result.reason, result.message);
        return okResult({ ok: true, text: result.text });
    }
    return undefined;
}
