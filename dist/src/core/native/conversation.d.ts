import type { Context } from '@deepseek-ai/cordis';
import type { CoreRuntime } from '../runtime.js';
import type { NativeRunResult } from './result.js';
import type { UserMessage, SessionEvent } from '@deepseek-ai/dsh-session';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { NativeMemory } from './memory.js';
import { type CompanionFact } from '../../contracts/interaction.js';
import { type CompanionToolDeclaration, type SourceAdmission } from '../../contracts/tables.js';
import { SourceAdapterTable } from '../tables/sources.js';
import { CompanionToolTable } from '../tables/tools.js';
import { CompanionPorts, type CompanionBinding } from '../tables/companion-ports.js';
import { VoiceTable } from '../tables/voice.js';
export declare const OWNER_LIFE_TOOL_SOURCES: readonly ("life" | "owner" | "review")[];
export interface NativeScope extends CompanionBinding {
    guest: boolean;
}
export declare function matchesNativeScope(current: NativeScope | undefined, expected: NativeScope): boolean;
export interface NativeSourceContext {
    readonly policyKey: string;
    readonly guardDuringTakeover?: boolean;
    fileAccessKey?(): string;
    continueAfterInterrupt?(scope: NativeScope): () => void;
}
export type NativeSourceSelection = Extract<SourceAdmission<NativeSourceContext>, {
    kind: 'accepted';
}>;
type ResolvePlaybackEvidence = (sessionId: string, playbackId: string) => {
    text: string;
    occurredAt: number;
    associated(memoryId: string): void;
} | undefined;
/** Scoped services for the existing DSH Agent; only autonomous inputs have extra allowances. */
export declare class CoreNative {
    readonly runtime: CoreRuntime;
    memory?: NativeMemory;
    private memoryEnabled;
    readonly toolTable: CompanionToolTable;
    readonly sourceTable: SourceAdapterTable<NativeSourceContext>;
    readonly companionPorts: CompanionPorts;
    readonly voiceTable: VoiceTable;
    private readonly playbackProviders;
    private readonly reviewCompaction;
    resolveNativeScope?: (sessionId: string) => NativeScope | undefined;
    attachGuest?: (context: Context) => void;
    private readonly turns;
    private readonly preparedFactInputs;
    nativeScopeFor(sessionId: string): NativeScope | undefined;
    isGuest(sessionId: string): boolean;
    registerPlaybackEvidence(resolve: ResolvePlaybackEvidence): import("../../contracts/tables.js").TableRegistration;
    emotionAllowed(sessionId: string, turn: number, permission: 'footer' | 'tool'): boolean;
    captureEmotionFooter(sessionId: string, turn: number): (() => boolean) | undefined;
    private current;
    acceptsInput(sessionId: string, message: UserMessage): boolean;
    setMemoryEnabledForNewSessions(enabled: boolean): void;
    memoryEnabledForNewSessions(): boolean;
    memoryFor(_sessionId: string): NativeMemory | undefined;
    registerReviewCompaction(request: (sessionId: string) => void, hasPending?: (sessionId: string) => boolean): import("../../contracts/tables.js").TableRegistration;
    hasPendingReviewCompaction(sessionId: string): boolean;
    requestReviewCompaction(sessionId: string): void;
    /** Native DSH owns the turn. Core retains only input references and selected policy metadata. */
    observeInputs(sessionId: string, turn: number, messages: readonly UserMessage[], scope?: NativeScope): string[];
    /** Called only by scoped native input/prompt adapters, never a model tool. */
    clearPreparedFacts(sessionId: string): void;
    observeFacts(sessionId: string, facts: readonly CompanionFact[], scope?: NativeScope): string[];
    finishTurn(sessionId: string, turn: number, result: NativeRunResult): Promise<void>;
    private readonly active;
    private closing;
    constructor(runtime: CoreRuntime);
    manages(sessionId: string): boolean;
    /** Autonomous planning submits durable intent; it must not bypass it with ad-hoc body goals. */
    isAutonomous(sessionId: string): boolean;
    /** Read selected sources through the owning Memory service. This does not
     * enroll a runner or attach dependencies to the whole native conversation. */
    useSources(sessionId: string, sourceIds: string[]): Promise<void>;
    useTranscript(sessionId: string, nodes: readonly number[], events: readonly SessionEvent[]): void;
    begin(sessionId: string, turn: number, messages: readonly UserMessage[], signal: AbortSignal, lifecycle: {
        cancel(): void;
    }): Promise<void>;
    validate(sessionId: string): void;
    guardTool(sessionId: string): void;
    tools(sessionId?: string): (ToolDefinition & Pick<CompanionToolDeclaration, 'sources'>)[];
    context(): {
        identity: string;
        user: string;
    };
    finish(sessionId: string): void;
    end(sessionId: string): Promise<void>;
    close(): Promise<void>;
}
export {};
