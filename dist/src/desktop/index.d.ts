import { DesktopFeatures } from './features.js';
import type { Context } from '@deepseek-ai/cordis';
import type { PetCoreHost } from '../core/index.js';
import type { PlaybackReceipt } from '../emotion/index.js';
import { Conversation, type NativeDesktopHost, type NativeEvent, type NativeSession, type StreamFrame } from './conversation.js';
type HostServices = NativeDesktopHost & {
    getPresentation?(): {
        show(): Promise<unknown>;
        hide(validate?: () => void): Promise<unknown>;
        bodyStatus(): {
            running: boolean;
        };
        savePreference?(key: string, value: boolean): Promise<unknown>;
    } | undefined;
    getEmotion(): import('../emotion/plugin.js').CompanionEmotion | undefined;
    isLifeHome?(id: string): boolean;
    on(name: string, handler: (data: {
        agent: {
            session: NativeSession;
        };
        frame: StreamFrame;
    }) => void, options: {
        global: boolean;
    }): () => void;
};
export declare function desktopFor(host: PetCoreHost): Desktop;
export declare class Desktop {
    private native;
    private host;
    private child?;
    private ready?;
    private readyReject?;
    private tick?;
    private clock?;
    private work?;
    private bodyBinding?;
    private readonly chatVoice;
    readonly chat: Conversation;
    features?: DesktopFeatures;
    constructor(native: HostServices, host: PetCoreHost);
    private target;
    private bodyCurrent;
    private readonly surfaces;
    onPresentation(receive: (type: string, value: unknown) => void, available: () => boolean): () => void;
    presentationAvailable(): boolean;
    private push;
    presentLife(text: string, sticker?: string): void;
    private changed;
    private belongs;
    event(session: NativeSession, event: NativeEvent): void;
    private workUpdate;
    expression(value: {
        workspaceId: string;
        sessionId: string;
        turn: number;
        action?: string;
        sticker?: string;
    }): void;
    settingsChanged(): void;
    savePreference(data: Record<string, unknown>): Promise<unknown>;
    recordPlayback(data: PlaybackReceipt): void;
    status(): {
        running: boolean;
    };
    start(): Promise<void>;
    openChat(): Promise<void>;
    private handle;
    closeWindow(validate?: () => void): Promise<void>;
    closeChat(): void;
}
export declare function registerDesktop(ctx: Context, host: PetCoreHost): void;
export {};
