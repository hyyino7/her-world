import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Push } from '#dsh-world/ecosystem/shared/outlets';
import type { PetCoreHost } from '../core/index.js';
import { messagingPreferences } from './messaging-settings.js';
import { type QQOptions, type QQTransport } from './qq.js';
interface Options {
    deviceDirectory: string;
    dataDirectory: string;
    workspaceId: string;
    storageId: string;
    ownerHome(): Promise<Agent>;
    active(): boolean;
    qqTransport?(opts: QQOptions): QQTransport;
}
export declare function createMessaging(ctx: Context, host: PetCoreHost, options: Options): Promise<{
    cancelVoice(): void;
    qqConnection(): "off" | "online" | "unavailable";
    status(): {
        config: {
            qq: {
                enabled: boolean;
                ownerReach: boolean;
                accountId: string;
                ownerSpeakerId: string;
                allowPrivate: string[];
                allowGroups: string[];
                contextMessages: number;
                wsUrl: string;
                tokenEnv: string;
                autoReply: boolean;
                voiceEnabled: boolean;
                voicePerMinute: number;
                voicePerHour: number;
                groupTrigger: "mention" | "all";
                groupKeywords: string[];
                batchQuietMs: number;
                mutedUntil: string;
            };
            wechat: {
                enabled: boolean;
                ownerReach: boolean;
                accountId: string;
                ownerSpeakerId: string;
                allowPrivate: string[];
                allowGroups: string[];
                contextMessages: number;
                bufferSeconds: number;
            };
        };
        qq: {
            usage: {
                requests: number;
                inputTokens: number;
                outputTokens: number;
                cacheReadTokens: number;
                unreported: number;
            };
            credentialSet: boolean;
            pending?: number | undefined;
            uncertain?: number | undefined;
            connected: boolean;
            state: string;
            error: string | null;
            sent: number;
            failed: number;
            blocked: number;
            voiceReceived: number;
            voiceVerified: number;
            voiceUncertain: number;
            outbox: number;
        };
        wechat: {
            error: string | null;
            path: string | null;
            presence: string | null;
            usage: {
                requests: number;
                inputTokens: number;
                outputTokens: number;
                cacheReadTokens: number;
                unreported: number;
            };
            contextMessages?: number | undefined;
            bufferSeconds?: number | undefined;
            lastContactAt: string | null;
            account: "online" | "offline" | null;
            accountId?: string | null | undefined;
            chats: number;
            pending: number;
            uncertain: number;
        };
    };
    configure(patch: Parameters<typeof messagingPreferences>[1]): Promise<void>;
    reach(push: Push & {
        deliveryId?: string;
    }, homeId?: string): Promise<PromiseSettledResult<string>[]>;
    group: (operation: string, input: Record<string, unknown>) => {
        quota: {
            ok: boolean;
            message?: string;
            todayCount: number;
            remaining: number;
        };
        settings: import("./group-qzone.js").QzoneSettings;
        drafts: import("./group-qzone.js").QzoneDraft[];
        posts: {
            id: string;
            status: "sent" | "pending" | "uncertain";
            at: number;
        }[];
    } | Promise<{
        available: boolean;
        sources: never[];
        message: string;
        settings?: undefined;
        social?: undefined;
        roleSections?: undefined;
        affinity?: undefined;
        impressions?: undefined;
        slang?: undefined;
        stickers?: undefined;
    } | {
        available: boolean;
        sources: {
            url: string;
            title: string;
            snippet: string;
        }[];
        message?: undefined;
        settings?: undefined;
        social?: undefined;
        roleSections?: undefined;
        affinity?: undefined;
        impressions?: undefined;
        slang?: undefined;
        stickers?: undefined;
    } | {
        settings: import("./group-material.js").GroupSettings;
        social: {
            unread: number;
            lastFeedback: string;
            lastWakeReason: string;
            reports: import("./group-social.js").GroupReport[];
        };
        roleSections: {
            heading: string;
            mode: string;
            injected: boolean;
            chars: number;
        }[];
        affinity: {
            name: string;
            userId: string;
            score: number;
            card: string;
        }[];
        impressions: import("./group-material.js").Impression[];
        slang: {
            content: string;
            meaning: string;
            usage: string;
            count: number;
            status: "confirmed" | "candidate" | "rejected";
        }[];
        stickers: {
            id: string;
            label: string;
            desc: string;
            note: string;
            tags: string[];
            usage: string;
            useCount: number;
        }[];
        available?: undefined;
        sources?: undefined;
        message?: undefined;
    }>;
    close(): Promise<void>;
}>;
export {};
