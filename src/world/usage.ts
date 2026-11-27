export { stepCost } from '#dsh-world/life/pricing';
export { summarizeCall, summarizeSince } from '#dsh-world/life/activity';
export { createJournal } from '#dsh-world/life/journal';

import {isPeak} from '#dsh-world/life/pricing';
import type {TokenUsage} from '@deepseek-ai/dsh-llm';

// CNY per million tokens, off-peak then peak. vendor/dsh-world/lib/life/pricing.js
// and https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ (2026-11-25).
const flash = {hit: [0.02, 0.04], miss: [1, 2], out: [4, 8]};
const pro = {hit: [0.15, 0.30], miss: [4.5, 9], out: [13.5, 27]};
const tariffs = [{
  from: Date.parse('2026-11-25T00:00:00+08:00'),
  models: new Map([['deepseek-flash', flash], ['deepseek-v4-flash', flash],
    ['deepseek-v4-flash-vision-exp', flash], ['deepseek-v4-pro', pro]]),
}];

export function priceCall(usage: TokenUsage, provider: string, model: string, startedAt: number) {
  const version = tariffs.filter(tariff => tariff.from <= startedAt).at(-1);
  const official = provider === 'deepseek' || provider === 'deepseek-official' || provider === 'deepseek-account';
  const rates = official && version?.models.get(model.toLowerCase());
  if (!rates) return {yuan: null, missing: ['无价格']};
  const slot = isPeak(new Date(startedAt)) ? 1 : 0;
  const yuan = (usage.inputTokens * rates.miss[slot] + (usage.cacheReadTokens ?? 0) * rates.hit[slot]
    + usage.outputTokens * rates.out[slot]) / 1e6;
  return {yuan, missing: usage.cacheWriteTokens ? ['缓存写'] : []};
}
