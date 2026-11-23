import { fileURLToPath, pathToFileURL } from 'node:url';
import { isAbsolute, join, relative, sep } from 'node:path';
import { existsSync, lstatSync } from 'node:fs';

export interface MemoryConfig { dataDir: string; python: string; serviceEntry?: string; runtimeRoot?: string }
export function memoryDirectory(config: MemoryConfig, workspacePath: string, useConfiguredDirectory: boolean): string {
  const configured = relative(workspacePath, config.dataDir);
  return useConfiguredDirectory && configured && configured !== '..' && !configured.startsWith('..' + sep) && !isAbsolute(configured)
    ? config.dataDir : join(workspacePath, '.chatpet', 'data', 'memory');
}
export interface MemoryScope { companionId: string; scopeId: string; bankId: string }
export interface SourceDependency { id: string; revision: string }
export interface Dependencies { sources: SourceDependency[]; memories: SourceDependency[] }
export type Decision = 'eligible' | 'ineligible' | 'unknown';
export interface RecalledMemory { memory: { id: string; version: number; content: string;
  type?: string; status?: string; epistemic?: string; metadata?: { epistemic?: string } }; dependencies: Dependencies;
  conversation?: { sourceId: string; text: string; role?: string }[] }

/** One selected provider/client artifact, not a replacement REST or process host. */
export class MemoryConnection {
  private host: any;
  private client: any;
  private scope?: Readonly<MemoryScope>;
  private directory?: string;
  private transition: Promise<void> = Promise.resolve();
  constructor(readonly config: MemoryConfig) {
    if (!isAbsolute(config.dataDir) || !isAbsolute(config.python)) throw new Error('Memory paths must be explicitly configured absolute paths');
    if (config.serviceEntry && !isAbsolute(config.serviceEntry)) throw new Error('Memory service entry must be an absolute trusted host path');
  }
  private connected(): boolean {
    const child = this.host?.child;
    return !!(this.client && this.host?.ready && child && !child.killed
      && child.exitCode === null && child.signalCode === null);
  }
  get lifecycle(): 'ready' | 'stopped' | 'unresolved' {
    return this.connected() ? 'ready' : this.host?.child ? 'unresolved' : 'stopped';
  }
  async start({ companionId, scopeId, bankId }: MemoryScope, workspacePath: string, useConfiguredDirectory: boolean): Promise<void> {
    const directory = memoryDirectory(this.config, workspacePath, useConfiguredDirectory);
    let parent = workspacePath;
    for (const part of relative(workspacePath, directory).split(sep)) {
      parent = join(parent, part);
      if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw new Error('Workspace Memory directory contains a symbolic link');
    }
    const snapshot = Object.freeze({ companionId, scopeId, bankId });
    const next = this.transition.then(() => this.open(snapshot, directory));
    this.transition = next.catch(() => {});
    return next;
  }
  private async open(scope: Readonly<MemoryScope>, directory: string): Promise<void> {
    if (this.connected() && directory === this.directory && JSON.stringify(scope) === JSON.stringify(this.scope)) return;
    if (this.host) await this.stop();
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
  async call<T>(operation: string, args: Record<string, unknown>, expectedBankId?: string): Promise<T> {
    if (!this.connected() || !this.scope) throw new Error('Memory provider unavailable');
    if (expectedBankId !== undefined && this.scope.bankId !== expectedBankId)
      throw Object.assign(new Error('Memory workspace changed'), { code: 'STALE_BINDING' });
    const client=this.client,scope=this.scope;
    try {
      const result=await client.request('POST', `/pet/v1/${operation}`, { ...args, scope });
      // A stopped/replaced connection cannot return a late result as the new
      // Bank, including A→B→A where the logical Bank name is equal again.
      if(!this.connected() || this.client!==client || this.scope!==scope)
        throw Object.assign(new Error('Memory connection changed during request'),{code:'STALE_BINDING'});
      return result;
    }
    catch (error) {
      const detail = (error as { data?: { detail?: unknown } })?.data?.detail;
      if (error instanceof Error && typeof detail === 'string') error.message = `Memory ${operation}: ${detail}`;
      throw error;
    }
  }
  async validate(dependencies: Dependencies, expectedBankId?: string): Promise<Decision> {
    try { return (await this.call<{ decision: Decision }>('validate', { ...dependencies }, expectedBankId)).decision; }
    catch { return 'unknown'; }
  }
  async close(): Promise<void> {
    const next = this.transition.then(() => this.stop());
    this.transition = next.catch(() => {});
    return next;
  }
  private async stop(): Promise<void> {
    this.client = undefined;
    if (this.host && (await this.host.stop()).state !== 'stopped') throw new Error('Memory owned child remains unresolved');
    this.host = undefined;
  }
}
