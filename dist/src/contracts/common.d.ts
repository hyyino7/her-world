/** Shared runtime contracts. Native DSH owns execution and permissions. */
export type ContractVersion = typeof import('./version.js').CONTRACT_VERSION;
export type Timestamp = string;
export type Revision = number;
export type ModuleId = 'core' | 'emotion' | 'memory' | 'life' | 'desktop' | 'qq' | 'bilibili' | 'voice' | 'console';
export type CapabilityId = 'core.conversation' | 'memory.lifecycle' | 'life.pursuits' | 'life.economy' | 'emotion.expression' | 'desktop.presentation' | 'desktop.body' | 'desktop.room' | 'channel.qq' | 'content.bilibili' | 'voice.speech' | 'console.operations';
export interface RequestContext {
    contractVersion: ContractVersion;
    requestId: string;
    companionId: string;
    scopeId: string;
    actor: {
        kind: 'owner' | 'companion' | 'system' | 'external';
        id: string;
    };
}
export interface CallOptions {
    signal?: AbortSignal;
    deadline?: Timestamp;
}
export type RejectedCode = 'INVALID_ARGUMENT' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'NOT_IMPLEMENTED' | 'DISABLED' | 'INCOMPATIBLE' | 'CONFLICT' | 'STALE_REVISION' | 'STALE_BINDING' | 'INELIGIBLE' | 'LIMIT_REACHED';
export type ContractError = {
    message: string;
    operationId?: string;
} & ({
    code: RejectedCode;
    effect: 'none';
    retry: 'never' | 'refresh';
} | {
    code: 'migration-required';
    reason: string;
    effect: 'none';
    retry: 'never';
} | {
    code: 'UNAVAILABLE' | 'TIMED_OUT' | 'CANCELLED' | 'INTERNAL';
    effect: 'none';
    retry: 'never' | 'same_request';
} | {
    code: 'UNAVAILABLE' | 'TIMED_OUT' | 'CANCELLED' | 'INTERNAL';
    effect: 'partial';
    retry: 'never' | 'reconcile';
} | {
    code: 'OUTCOME_UNKNOWN' | 'UNAVAILABLE' | 'TIMED_OUT' | 'CANCELLED' | 'INTERNAL';
    effect: 'unknown';
    retry: 'reconcile';
});
type UnknownEffect = Extract<ContractError, {
    effect: 'unknown';
}>;
export declare function unknownEffect(code: UnknownEffect['code'], message: string): UnknownEffect;
export type Result<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: ContractError;
};
export type ServiceCall<Input, Output> = (context: RequestContext, input: Input, options?: CallOptions) => Promise<Result<Output>>;
export type CapabilityState = 'not_implemented' | 'disabled' | 'initializing' | 'ready' | 'degraded' | 'unavailable' | 'incompatible' | 'stopping';
export type CapabilityStatus = {
    id: CapabilityId;
    owner: ModuleId;
    contractVersion: ContractVersion;
} & ({
    state: 'not_implemented';
    reason: string;
    supportedOperations: readonly [];
} | {
    state: Exclude<CapabilityState, 'not_implemented'>;
    reason: string | null;
    supportedOperations: readonly string[];
});
/** Core's attributed observation for the existing Memory Bank. */
export interface EvidenceSource {
    sourceId: string;
    origin: 'owner_statement' | 'external_content' | 'model_interpretation' | 'virtual_action' | 'external_action';
    recordedAt: Timestamp;
    eventTime?: {
        from?: Timestamp;
        to?: Timestamp;
        precision: 'exact' | 'approximate' | 'unknown';
    };
    actorId: string;
    locator?: string;
    rootSourceIds: readonly string[];
    text: string;
}
export {};
