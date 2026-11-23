export interface MemoryConfig {
    dataDir: string;
    python: string;
    serviceEntry?: string;
    runtimeRoot?: string;
}
export declare function memoryDirectory(config: MemoryConfig, workspacePath: string, useConfiguredDirectory: boolean): string;
export interface MemoryScope {
    companionId: string;
    scopeId: string;
    bankId: string;
}
export interface SourceDependency {
    id: string;
    revision: string;
}
export interface Dependencies {
    sources: SourceDependency[];
    memories: SourceDependency[];
}
export type Decision = 'eligible' | 'ineligible' | 'unknown';
export interface RecalledMemory {
    memory: {
        id: string;
        version: number;
        content: string;
        type?: string;
        status?: string;
        epistemic?: string;
        metadata?: {
            epistemic?: string;
        };
    };
    dependencies: Dependencies;
    conversation?: {
        sourceId: string;
        text: string;
        role?: string;
    }[];
}
/** One selected provider/client artifact, not a replacement REST or process host. */
export declare class MemoryConnection {
    readonly config: MemoryConfig;
    private host;
    private client;
    private scope?;
    private directory?;
    private transition;
    constructor(config: MemoryConfig);
    private connected;
    get lifecycle(): 'ready' | 'stopped' | 'unresolved';
    start({ companionId, scopeId, bankId }: MemoryScope, workspacePath: string, useConfiguredDirectory: boolean): Promise<void>;
    private open;
    call<T>(operation: string, args: Record<string, unknown>, expectedBankId?: string): Promise<T>;
    validate(dependencies: Dependencies, expectedBankId?: string): Promise<Decision>;
    close(): Promise<void>;
    private stop;
}
