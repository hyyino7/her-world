/**
 * 构造失败实体。
 *
 * @param reason - 失败原因，由处理器决定，不接受从状态码反推。
 * @param message - 给人看的说明。
 * @param extra - 附加字段（如 `cause`、`needConfirm`）；不能覆盖 `ok`/`reason`/`message`。
 */
export function failureBody(reason, message, extra) {
    return { ...extra, ok: false, reason, message };
}
/** 成功应答：状态码 200，响应体就是结果本身（不包一层 data）。 */
export function okResult(obj = {}, headers) {
    return { kind: 'json', status: 200, obj, headers };
}
/**
 * 业务失败：请求已进到处理器并给出了结论，一律 200 + 失败实体。
 *
 * @param reason - 失败原因，由处理器决定，不接受从状态码反推。
 * @param message - 给人看的说明。
 * @param extra - 附加字段（如 `cause`、`needConfirm`）；不能覆盖 `ok`/`reason`/`message`。
 */
export function failResult(reason, message, extra) {
    return { kind: 'json', status: 200, obj: failureBody(reason, message, extra) };
}
/** 请求体不是合法 JSON：400。 */
export function invalidJson(message = 'invalid JSON body') {
    return rejected(400, 'invalid-json', message);
}
/** 该路径不接受这个方法：405。 */
export function methodNotAllowed(message = 'method not allowed') {
    return rejected(405, 'method-not-allowed', message);
}
/** 请求体超过上限：413。 */
export function payloadTooLarge(message = 'request body too large') {
    return rejected(413, 'payload-too-large', message);
}
/** 未预期异常：500。文案固定，真实原因只进日志，不外泄路径与内部细节。 */
export function internalError() {
    return rejected(500, 'internal-error', 'dsh-pet: internal error');
}
/** 协议失败：真实状态码 + 与业务失败同一形状的体。 */
function rejected(status, reason, message) {
    return { kind: 'json', status, obj: failureBody(reason, message) };
}
