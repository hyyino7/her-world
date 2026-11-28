import type { PetCoreHost } from '../index.js';
import type { HomeBinding } from '../workspace.js';
export declare function usageReport(host: PetCoreHost, scope: HomeBinding, requested: unknown): {
    day: string;
    today: string;
    minDay: string;
    firstDay: null;
    gaps: {
        writeFailed: number;
        unbound: number;
        rebound: number;
    };
    recovery: null;
    issue: string | null;
    groups: {
        entry: "life" | "desktop" | "unknown" | "review" | "dsh" | "television" | "qq-owner" | "qq-guest" | "qq-nudge" | "wechat-owner" | "wechat-guest" | "chatpet-whisper" | "chatpet-dream" | "maintenance" | "room";
        preset: string;
        purpose: string | null;
        label: "Desktop" | "Room 私聊" | "DSH 原生" | "Room 电视" | "Life 回合" | "回顾" | "QQ 主人" | "QQ 访客" | "QQ 补答" | "微信主人" | "微信访客" | "碎碎念" | "梦话" | "后台整理" | "未归类";
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
    }[];
    summary: {
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
    prices: string[];
    channels: {
        qq: number;
        wechat: number;
    };
    homeYuan: number;
};
