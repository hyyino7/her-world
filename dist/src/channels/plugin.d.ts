import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { bridgeRoute } from '#dsh-world/ecosystem/bridge/route';
import type { Push } from '#dsh-world/ecosystem/shared/outlets';
import type { WorldChanged } from '../contracts/living.js';
import { type ConsoleOperation } from '../core/tables/console.js';
import type { PetCoreHost } from '../core/index.js';
import type { HomeBinding } from '../core/workspace.js';
import { LocalBridge } from './bridge.js';
import { createMessaging } from './messaging.js';
interface Services {
    webServer: {
        getOrigin(): string;
        register(route: ReturnType<typeof bridgeRoute>): () => void;
    };
    profileContext?: {
        dir: string;
    };
    sessionController: {
        resolveAgent(id: string): Promise<{
            agent?: Agent;
        }>;
    };
}
type Binding = HomeBinding & {
    bridge: LocalBridge;
    messaging: Awaited<ReturnType<typeof createMessaging>>;
};
export declare class CompanionChannels {
    private ctx;
    private host;
    private services;
    private profileDir;
    private bound?;
    private closed;
    private queue;
    constructor(ctx: Context, host: PetCoreHost, services: Services, profileDir: string);
    private serial;
    private scope;
    private current;
    private reconcile;
    refresh(change?: WorldChanged): Promise<Binding | undefined>;
    get local(): {
        start: () => void;
        stop: () => void;
        say: (text: string) => Promise<{
            id: string;
        }>;
        checkToken: (value: string | undefined) => boolean;
        faults: () => string[];
    } | undefined;
    qqConnection(): ReturnType<Binding['messaging']['qqConnection']>;
    compact(): "生活会话或记忆整理未启用" | "当前没有待整理的已完成对话" | undefined;
    reach(workspaceId: string, push: Push): Promise<PromiseSettledResult<string>[]>;
    request(id: string, operation: string, input: Record<string, unknown>, validate?: () => void): Promise<{
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
    } | {
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
    } | {
        bridge: {
            preferences: import("./bridge.js").BridgePreferences;
            running: boolean;
            discovery: string | null;
            faults: string[];
        };
        messaging: {
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
            fields: {
                qq: ({
                    label: string;
                    kind: "boolean" | "lines" | "number" | "text";
                    key: string;
                } | {
                    label: string;
                    kind: "select";
                    options: Readonly<Record<string, string>>;
                    key: string;
                })[];
                wechat: ({
                    label: string;
                    kind: "boolean" | "lines" | "number" | "text";
                    key: string;
                } | {
                    label: string;
                    kind: "select";
                    options: Readonly<Record<string, string>>;
                    key: string;
                })[];
            };
            qq: {
                usage: {
                    from: string;
                    to: string;
                    status: "unavailable" | "empty" | "absent" | "recorded" | "recovered";
                    issue: string | null;
                    calls: number;
                    missingUsage: number;
                    input: number;
                    output: number;
                    read: number;
                    write: number;
                    missingRead: number;
                    missingWrite: number;
                    priced: number;
                    unpriced: number;
                    yuan: number;
                    partial: boolean;
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
                    from: string;
                    to: string;
                    status: "unavailable" | "empty" | "absent" | "recorded" | "recovered";
                    issue: string | null;
                    calls: number;
                    missingUsage: number;
                    input: number;
                    output: number;
                    read: number;
                    write: number;
                    missingRead: number;
                    missingWrite: number;
                    priced: number;
                    unpriced: number;
                    yuan: number;
                    partial: boolean;
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
    }>;
    close(): Promise<Binding | undefined>;
}
export declare function channelsConsoleOperations(channels: Pick<CompanionChannels, 'request'>): {
    operations: Record<string, ConsoleOperation>;
};
export declare const name = "60-Channels";
export declare const inject: string[];
export declare function apply(ctx: Context, config?: {
    deviceDirectory?: string;
}): void;
declare module '@deepseek-ai/cordis' {
    interface Context {
        petChannels: CompanionChannels;
    }
}
export {};
