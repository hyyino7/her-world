import type { Agent } from '@deepseek-ai/dsh-agent';
import { type SpeakerIdentity } from '#dsh-world/ecosystem/shared/identity';
import { type GroupArguments, type GroupTransport } from './group-tools.js';
import { type WakeSettings } from './group-social.js';
export interface GroupSettings {
    affinity: boolean;
    slang: boolean;
    stickers: boolean;
    forwards: boolean;
    roleCard: string;
    roleMode: 'v1' | 'v2';
    wake: WakeSettings;
}
export interface Impression {
    speakerId: string;
    name: string;
    traits: string[];
    interactionCount: number;
    lastSeenAt: number;
}
type Source = {
    url: string;
    title?: string;
    snippet?: string;
    summary?: string;
};
interface Options {
    dataDirectory: string;
    active(): boolean;
    allowed(identity: SpeakerIdentity): boolean;
    companionName?(): string;
    search?(query: string): Promise<{
        sources: readonly Source[];
    }>;
}
type Incoming = {
    text: string;
    segments?: readonly {
        type: string;
        data?: Record<string, unknown>;
    }[];
};
export declare class GroupGameplay {
    private options;
    private disposed;
    private bound;
    private rooms;
    constructor(options: Options);
    private available;
    private directory;
    private files;
    private filesAt;
    private social;
    private corpus;
    private write;
    /** Consume structured platform segments only after gateway identity and duplicate checks. */
    receive(identity: SpeakerIdentity, msg: Incoming, flags: {
        replyToSelf: boolean;
    }): void;
    decision(identity: SpeakerIdentity, configuredTrigger?: boolean, recovering?: boolean): {
        readonly mode: "v1";
        readonly wake: false;
    } | {
        mode: "v1" | "v2";
        wake: boolean;
    };
    response(identity: SpeakerIdentity, nativeReply: string, admittedMode?: GroupSettings['roleMode']): string;
    quoteTarget(identity: SpeakerIdentity): string | undefined;
    material({ identity }: {
        identity: SpeakerIdentity;
        text: string;
        sessionId: string;
    }): string;
    manage(account: string, allowedGroups: readonly string[], operation: string, input: Record<string, unknown>): Promise<{
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
        settings: GroupSettings;
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
        impressions: Impression[];
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
    action(identity: SpeakerIdentity, operation: string, input: GroupArguments, transport: GroupTransport): Promise<import("./group-social.js").GroupReport | {
        id: string;
        label: string;
        desc: string;
        note: string;
        tags: string[];
        usage: string;
        useCount: number;
    } | {
        id: string;
        label: string;
        desc: string;
        note: string;
        tags: string[];
        usage: string;
        useCount: number;
    }[] | {
        messages: {
            seq: number;
            messageId: string;
            sender: string;
            speakerId: string;
            text: string;
        }[];
        readThroughSeq: number;
    } | {
        count: number;
        throughSeq: number;
    } | {
        queued: boolean;
        note: string;
        feedback?: undefined;
    } | {
        feedback: string;
        queued?: undefined;
        note?: undefined;
    } | {
        content: string;
        status: "confirmed" | "candidate" | "rejected";
        meaning: string;
    }[] | {
        updated: boolean;
        status?: undefined;
        total?: undefined;
        truncated?: undefined;
        messages?: undefined;
        sent?: undefined;
    } | {
        status: string;
        updated?: undefined;
        total?: undefined;
        truncated?: undefined;
        messages?: undefined;
        sent?: undefined;
    } | {
        total: number;
        truncated: boolean;
        messages: {
            sender: string;
            text: string;
            nestedForwardIds: string[];
        }[];
        updated?: undefined;
        status?: undefined;
        sent?: undefined;
    } | {
        sent: boolean;
        updated?: undefined;
        status?: undefined;
        total?: undefined;
        truncated?: undefined;
        messages?: undefined;
    }>;
    bind(agent: Agent, identity: SpeakerIdentity, stillAllowed: () => boolean, transport: GroupTransport): void;
    unbind(): void;
    stop(): void;
}
export declare function createGroupGameplay(options: Options): GroupGameplay;
export {};
