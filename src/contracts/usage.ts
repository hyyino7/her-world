const senderLabels = { desktop: 'Desktop', room: 'Room 私聊' } as const;
export type SenderEntry = keyof typeof senderLabels;

export const usageLabels = {
  ...senderLabels, dsh: 'DSH 原生', television: 'Room 电视',
  life: 'Life 回合', review: '回顾', 'qq-owner': 'QQ 主人', 'qq-guest': 'QQ 访客',
  'qq-nudge': 'QQ 补答', 'wechat-owner': '微信主人', 'wechat-guest': '微信访客',
  'chatpet-whisper': '碎碎念', 'chatpet-dream': '梦话', maintenance: '后台整理', unknown: '未归类',
} as const;

export type UsageEntry = keyof typeof usageLabels;
