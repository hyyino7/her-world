import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { InFlight, settleCleanup } from '../index.js';
const directFiles = new Set(['read', 'write', 'edit', 'read_image']);
const knownFiles = new Set([...directFiles, 'str_replace_editor', 'apply_patch']);
/** Only inspect native path fields. File contents and command strings are never
 * searched as a substitute for capability isolation. */
function requestedPaths(exec) {
    if (!exec.arguments || typeof exec.arguments !== 'object')
        return [];
    const args = exec.arguments;
    if (directFiles.has(exec.name))
        return typeof args.file_path === 'string' ? [args.file_path] : [];
    if (exec.name === 'str_replace_editor')
        return typeof args.path === 'string' ? [args.path] : [];
    if (exec.name !== 'apply_patch' || typeof args.input !== 'string')
        return [];
    // These are the pinned native patch header spellings, including move targets.
    // The native parser still validates syntax and owns all patch execution.
    return args.input.split(/\r?\n/u).flatMap(line => {
        const header = line.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
        const matched = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.*)$/u.exec(header);
        return matched ? [matched[1]] : [];
    });
}
function canonicalCandidate(path) {
    let parent = resolve(path);
    const missing = [];
    for (;;) {
        try {
            return resolve(realpathSync.native(parent), ...missing.reverse());
        }
        catch (error) {
            const code = error.code;
            if (code !== 'ENOENT' && code !== 'ENOTDIR')
                throw error;
            const next = dirname(parent);
            if (next === parent)
                throw error;
            missing.push(parent.slice(next.length).replace(/^[/\\]/u, ''));
            parent = next;
        }
    }
}
const within = (directory, path) => {
    const tail = relative(directory, path);
    return tail === '' || (tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail));
};
/** Reuse DSH's own filesystem and current-directory resolution before its
 * monotonic guard. No replacement filesystem, assistant runtime or exec policy.
 * The owner RPC writes through the Economy owner and never calls file tools. */
export function installEconomyAccessGuard(ctx, protectedPaths, onCleanup) {
    const native = ctx;
    const prepared = new Map();
    const abort = new AbortController(), inFlight = new InFlight();
    const stops = [];
    onCleanup(async () => {
        abort.abort();
        prepared.clear();
        await settleCleanup(...stops.splice(0), () => inFlight.settled());
    });
    stops.push(ctx.on('tools/pre-execute', async (exec, next) => {
        if (!knownFiles.has(exec.name))
            return next();
        if (abort.signal.aborted)
            return { kind: 'cancel' };
        const paths = protectedPaths();
        if (!paths)
            return next();
        const entry = { paths };
        prepared.set(exec.token, entry);
        const signal = AbortSignal.any([exec.signal, abort.signal]);
        await inFlight.run(async () => {
            try {
                const fs = native.get('fs');
                if (!fs)
                    throw Error('Native filesystem is unavailable');
                const working = native.get('workingDirectory');
                if (exec.agent && !working)
                    throw Error('Native working directory is unavailable');
                const cwd = exec.agent ? await working.ensure(exec.agent, signal) : undefined;
                abort.signal.throwIfAborted();
                const protectedFiles = paths.map(canonicalCandidate);
                for (const path of requestedPaths(exec)) {
                    const target = await fs.resolve(path, { ...(cwd === undefined ? {} : { cwd }), signal });
                    abort.signal.throwIfAborted();
                    const resolvedPath = canonicalCandidate(fs.processPath(target));
                    const mutating = ['write', 'edit', 'apply_patch'].includes(exec.name)
                        || (exec.name === 'str_replace_editor' && exec.arguments.command !== 'view');
                    if (protectedFiles.some(file => within(file, resolvedPath) || mutating && within(resolvedPath, file))) {
                        entry.denial = '经济账本由程序结算，请使用经济查询、商店和库存接口。';
                        break;
                    }
                }
            }
            catch {
                entry.denial = '经济账本路径暂时无法核对，请等待原生文件服务就绪后重试。';
            }
        });
        if (abort.signal.aborted)
            return { kind: 'cancel' };
        return next();
    }));
    stops.push(ctx.tools.guard(exec => {
        if (!knownFiles.has(exec.name))
            return;
        const current = protectedPaths(), saved = prepared.get(exec.token);
        if (!current && !saved)
            return;
        if (!saved || !isDeepStrictEqual(current, saved.paths))
            return '经济工作区已改变，请重新发起文件操作。';
        return saved.denial;
    }));
    stops.push(ctx.on('tools/result', exec => { prepared.delete(exec.token); }));
}
//# sourceMappingURL=access.js.map