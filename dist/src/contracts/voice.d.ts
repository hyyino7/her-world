export declare function isVoiceRoute(rest: string): boolean;
export interface VoiceRequest {
    rest: string;
    method: string;
    body?: string;
    signal?: AbortSignal;
}
export type VoiceResponse = {
    kind: 'json';
    status: number;
    obj: unknown;
} | {
    kind: 'file';
    file: string;
    contentType: string;
};
export interface VoiceAvailability {
    speak: boolean;
    hear: boolean;
}
export interface VoiceProvider {
    availability(): VoiceAvailability;
    handle(input: VoiceRequest): Promise<VoiceResponse>;
}
export interface VoiceCall {
    availability(): VoiceAvailability;
    handle(input: Omit<VoiceRequest, 'signal'>): Promise<VoiceResponse>;
    assertCurrent(): void;
}
