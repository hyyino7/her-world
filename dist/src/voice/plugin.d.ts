import type { Context } from '@deepseek-ai/cordis';
import { type VoiceProvider, type VoiceRequest, type VoiceResponse } from '../contracts/voice.js';
import type { PetCoreHost } from '../core/index.js';
export type { VoiceRequest } from '../contracts/voice.js';
export declare class CompanionVoice implements VoiceProvider {
    private host;
    private directory;
    private recognizer;
    private lifetime;
    private stopped;
    private scope?;
    constructor(host: PetCoreHost, directory: string, recognizer: () => unknown);
    canTranscribe(): boolean;
    availability(): {
        speak: boolean;
        hear: boolean;
    };
    refresh(): void;
    release(): void;
    stop(): void;
    handle(input: VoiceRequest): Promise<VoiceResponse>;
}
export declare const name = "70-Voice";
export declare const inject: string[];
export declare function apply(ctx: Context, config?: {
    deviceDirectory?: string;
}): void;
