import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { UserMessage } from '@deepseek-ai/dsh-session';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';
import type { CapabilityStatus, EvidenceSource } from './common.js';

export interface RegistrationLease {
  readonly generation: symbol;
  isCurrent(): boolean;
  /** Recheck after each await and before a side effect, alongside the workspace binding. */
  assertCurrent(): void;
  guard<Args extends unknown[], Output>(callback: (...args: Args) => Output): (...args: Args) => Output;
}

export interface TableRegistration {
  readonly lease: RegistrationLease;
  /** Each native preset may install the same registration in its own waterfall. */
  attach(scope: Context, install: (scope: Context, lease: RegistrationLease) => () => void): Promise<void>;
  revoke(): Promise<void>;
}

type CapabilityIdentity = Pick<CapabilityStatus, 'id' | 'owner' | 'contractVersion'>;
type StatusDetails<T> = T extends CapabilityIdentity ? Omit<T, keyof CapabilityIdentity> : never;

export interface CapabilityRegistration extends CapabilityIdentity {
  readonly order: number;
  readonly service?: string;
  readonly page?: string;
  status(): StatusDetails<CapabilityStatus>;
}

export type TurnKind = 'foreground' | 'background';
export const COMPANION_TOOL_SOURCES = Object.freeze(['owner', 'life', 'review', 'guest', 'tv'] as const);
/** Modules augment this map and register their tool sources at runtime. */
export interface CompanionToolSourceMap extends Record<typeof COMPANION_TOOL_SOURCES[number], true> {}
export type CompanionToolSource = Extract<keyof CompanionToolSourceMap, string>;
// Native logs also store these model-facing projections as user/message events.
export const NATIVE_HISTORY_CONTEXT_SOURCES = Object.freeze(['runtime-context', 'chatpet-recall', 'compact-checkpoint'] as const);
type BuiltinNativeSourceKind = typeof NATIVE_HISTORY_CONTEXT_SOURCES[number]
  | 'user' | 'dsh-world-life' | 'dsh-world-reply-nudge' | 'chatpet-room-tv';
/** Extension kinds come from the producer's DSH MessageSourceMap declaration. */
export type NativeSourceKind = BuiltinNativeSourceKind | UserMessage['source']['kind'];

export type AdmissionDecision<Accepted> =
  | { kind: 'unclaimed' }
  | { kind: 'rejected'; reason: string }
  | ({ kind: 'accepted' } & Accepted)
  | { kind: 'failed'; error: unknown };

export interface SourceInput {
  readonly sessionId: string;
  readonly message: UserMessage;
}

interface PolicyEvidence {
  readonly description: string;
  readonly behaviorIds: readonly string[];
}

export interface SessionPolicyRow {
  readonly row: number;
  readonly branch: string;
  readonly trustedActor: string;
  readonly selectionKey: string;
  readonly historyScope: string;
  readonly preset: string;
  readonly lifecycle: string;
  readonly bindingCheck: string;
  readonly inherits?: number;
  readonly tools: PolicyEvidence;
  readonly memoryObservation: PolicyEvidence;
  readonly emotionUpdate: { readonly footer: PolicyEvidence; readonly tool: PolicyEvidence };
}

export interface SourceToolPolicy<Selected> {
  /** Install in the Agent's native scope on enqueue. The returned cleanup is safe after revocation. */
  install?(agent: Agent, context: Selected, lease: RegistrationLease): () => void;
  allows?(execution: ToolExecution, context: Selected, lease: RegistrationLease): boolean;
  readonly denial: string;
}

export interface SourceMemoryObservation<Selected> {
  input?(context: Selected): Pick<EvidenceSource, 'origin' | 'actorId'> & {
    sourceKind: string;
    attribution: Record<string, unknown>;
  };
  reply?(context: Selected): { channel: string; sessionId: string };
}

export interface SourceBranch<Selected> {
  readonly usageEntry?: import('./usage.js').UsageEntry | ((input: SourceInput) => import('./usage.js').UsageEntry);
  readonly turnKind: TurnKind;
  readonly toolSource: CompanionToolSource;
  readonly toolPolicy: SourceToolPolicy<Selected> | null;
  fileAccess?(tool: string, path: string, context: Selected, lease: RegistrationLease): void;
  readonly memoryObservation: SourceMemoryObservation<Selected> | null;
  readonly emotionUpdate: { readonly footer: boolean; readonly tool: boolean };
  readonly historyProjection?: { readonly participates: boolean; readonly protectsTurn: boolean };
  readonly policyRow: SessionPolicyRow;
}

export interface SourceAdapter<Selected> {
  readonly id: string;
  readonly sources: readonly NativeSourceKind[];
  readonly order: number;
  readonly branches: Readonly<Record<string, SourceBranch<Selected>>>;
  /** Rows such as shared home and Desktop monologues have no input branch. */
  readonly policyRows?: readonly SessionPolicyRow[];
  /** Select a branch using saved message fields only, without checking or consuming grants. */
  classify?(message: UserMessage): string | undefined;
  /** The adapter owns idempotence and consumes any one-time grant on first acceptance. */
  admit(input: SourceInput): AdmissionDecision<{ branch: string; context: Selected }>;
}

export interface SourceClassification {
  readonly branch: string;
  readonly historyProjection: SourceBranch<unknown>['historyProjection'];
  readonly lease: RegistrationLease;
}

export type SourceClassificationResult = SourceClassification | {
  readonly kind: 'failed';
  readonly adapterId: string;
  readonly historyProjection?: never;
} | undefined;

/** Callbacks are bound to this admission's context and registration generation. */
export interface AdmittedSourceBranch extends Omit<SourceBranch<unknown>, 'toolPolicy' | 'fileAccess' | 'memoryObservation'> {
  readonly toolPolicy: {
    readonly denial: string;
    install?(agent: Agent): () => void;
    allows?(execution: ToolExecution): boolean;
  } | null;
  fileAccess?(tool: string, path: string): void;
  readonly memoryObservation: SourceMemoryObservation<void> | null;
}

export type SourceAdmission<Selected> = AdmissionDecision<{
  branch: AdmittedSourceBranch;
  context: Selected;
  /** The admission lease includes the tool source's generation when present. */
  lease: RegistrationLease;
  toolSourceLease?: RegistrationLease;
}>;

export interface CompanionToolDeclaration {
  readonly name: string;
  readonly sources: readonly CompanionToolSource[];
  /** Synchronously project a tool result for history. */
  historyOverview?(args: unknown, value: unknown): unknown;
}
