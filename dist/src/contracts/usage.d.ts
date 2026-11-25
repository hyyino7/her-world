declare const senderLabels: {
    readonly desktop: "Desktop";
    readonly room: "Room 私聊";
};
export type SenderEntry = keyof typeof senderLabels;
export declare const usageLabels: {
    readonly dsh: "DSH 原生";
    readonly television: "Room 电视";
    readonly life: "Life 回合";
    readonly review: "回顾";
    readonly 'qq-owner': "QQ 主人";
    readonly 'qq-guest': "QQ 访客";
    readonly 'qq-nudge': "QQ 补答";
    readonly 'wechat-owner': "微信主人";
    readonly 'wechat-guest': "微信访客";
    readonly 'chatpet-whisper': "碎碎念";
    readonly 'chatpet-dream': "梦话";
    readonly maintenance: "后台整理";
    readonly unknown: "未归类";
    readonly desktop: "Desktop";
    readonly room: "Room 私聊";
};
export type UsageEntry = keyof typeof usageLabels;
export {};
