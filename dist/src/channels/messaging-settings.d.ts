import type { SpeakerIdentity } from '#dsh-world/ecosystem/shared/identity';
type Account = {
    enabled: boolean;
    ownerReach: boolean;
    accountId: string;
    ownerSpeakerId: string;
    allowPrivate: string[];
    allowGroups: string[];
    contextMessages: number;
};
export type QQSettings = Account & {
    wsUrl: string;
    tokenEnv: string;
    autoReply: boolean;
    voiceEnabled: boolean;
    voicePerMinute: number;
    voicePerHour: number;
    groupTrigger: 'mention' | 'all';
    groupKeywords: string[];
    batchQuietMs: number;
    mutedUntil: string;
};
export type WechatSettings = Account & {
    bufferSeconds: number;
};
export interface MessagingSettings {
    qq: QQSettings;
    wechat: WechatSettings;
}
export declare const defaults: MessagingSettings;
export declare function editableMessagingFields(): {
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
export declare function isDeviceMessagingField(platform: keyof MessagingSettings, key: string): boolean;
type Patch = {
    qq?: Partial<QQSettings>;
    wechat?: Partial<WechatSettings>;
};
export declare function messagingPreferences(before: MessagingSettings, patch: Patch): {
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
export declare function allowedIdentity(config: MessagingSettings, id: SpeakerIdentity): boolean;
export declare function ownerIdentity(config: MessagingSettings, id: SpeakerIdentity): boolean;
export {};
