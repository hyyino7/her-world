import { fileURLToPath, pathToFileURL } from 'node:url';
import { isAbsolute, join, relative, sep } from 'node:path';
import { existsSync, lstatSync } from 'node:fs';
export function memoryDirectory(config, workspacePath, useConfiguredDirectory) {
    const configured = relative(workspacePath, config.dataDir);
    return useConfiguredDirectory && configured && configured !== '..' && !configured.startsWith('..' + sep) && !isAbsolute(configured)
        ? config.dataDir : join(workspacePath, '.chatpet', 'data', 'memory');
}
/** One selected provider/client artifact, not a replacement REST or process host. */
export class MemoryConnection {
    config;
    host;
    client;
    scope;
    directory;
    transition = Promise.resolve();
    constructor(config) {
        this.config = config;
        if (!isAbsolute(config.dataDir) || !isAbsolute(config.python))
            throw new Error('Memory paths must be explicitly configured absolute paths');
        if (config.serviceEntry && !isAbsolute(config.serviceEntry))
            throw new Error('Memory service entry must be an absolute trusted host path');
    }
    connected() {
        const child = this.host?.child;
        return !!(this.client && this.host?.ready && child && !child.killed
            && child.exitCode === null && child.signalCode === null);
    }
    get lifecycle() {
        return this.connected() ? 'ready' : this.host?.child ? 'unresolved' : 'stopped';
    }
    async start({ companionId, scopeId, bankId }, workspacePath, useConfiguredDirectory) {
        const directory = memoryDirectory(this.config, workspacePath, useConfiguredDirectory);
        let parent = workspacePath;
        for (const part of relative(workspacePath, directory).split(sep)) {
            parent = join(parent, part);
            if (existsSync(parent) && lstatSync(parent).isSymbolicLink())
                throw new Error('Workspace Memory directory contains a symbolic link');
        }
        const snapshot = Object.freeze({ companionId, scopeId, bankId });
        const next = this.transition.then(() => this.open(snapshot, directory));
        this.transition = next.catch(() => { });
        return next;
    }
    async open(scope, directory) {
        if (this.connected() && directory === this.directory && JSON.stringify(scope) === JSON.stringify(this.scope))
            return;
        if (this.host)
            await this.stop();
        const root = fileURLToPath(new URL('../../../', import.meta.url));
        const { MemoryProcessHost } = await import(pathToFileURL(`${root}vendor/mnemosyne/src/memory-process.js`).href);
        const { MemoryClient } = await import(pathToFileURL(`${root}vendor/mnemosyne/src/memory-client.js`).href);
        this.host = new MemoryProcessHost({ serviceRoot: `${root}vendor/mnemosyne/service`, serviceEntry: this.config.serviceEntry ?? `${root}src/memory/main.py`,
            dataDir: directory, python: this.config.python,
            serviceEnv: { CHATPET_MEMORY_SCOPE: JSON.stringify(scope), PYTHONDONTWRITEBYTECODE: '1' } });
        this.scope = scope;
        this.directory = directory;
        this.client = new MemoryClient(await this.host.start({ timeoutMs: 10000 }));
    }
    async call(operation, args, expectedBankId) {
        if (!this.connected() || !this.scope)
            throw new Error('Memory provider unavailable');
        if (expectedBankId !== undefined && this.scope.bankId !== expectedBankId)
            throw Object.assign(new Error('Memory workspace changed'), { code: 'STALE_BINDING' });
        const client = this.client, scope = this.scope;
        try {
            const result = await client.request('POST', `/pet/v1/${operation}`, { ...args, scope });
            // A stopped/replaced connection cannot return a late result as the new
            // Bank, including A→B→A where the logical Bank name is equal again.
            if (!this.connected() || this.client !== client || this.scope !== scope)
                throw Object.assign(new Error('Memory connection changed during request'), { code: 'STALE_BINDING' });
            return result;
        }
        catch (error) {
            const detail = error?.data?.detail;
            if (error instanceof Error && typeof detail === 'string')
                error.message = `Memory ${operation}: ${detail}`;
            throw error;
        }
    }
    async validate(dependencies, expectedBankId) {
        try {
            return (await this.call('validate', { ...dependencies }, expectedBankId)).decision;
        }
        catch {
            return 'unknown';
        }
    }
    async close() {
        const next = this.transition.then(() => this.stop());
        this.transition = next.catch(() => { });
        return next;
    }
    async stop() {
        this.client = undefined;
        if (this.host && (await this.host.stop()).state !== 'stopped')
            throw new Error('Memory owned child remains unresolved');
        this.host = undefined;
    }
}
//# sourceMappingURL=client.js.map