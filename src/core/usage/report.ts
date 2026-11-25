import type {TokenUsage} from '@deepseek-ai/dsh-llm';
import {localDayStart} from '#dsh-world/memoryStore';
import {usageLabels} from '../../contracts/usage.js';
import {priceCall, stepCost} from '../../world/usage.js';
import type {PetCoreHost} from '../index.js';
import type {HomeBinding} from '../workspace.js';
import {fail} from '../tables/console.js';
import {readGaps} from './gaps.js';
import {readLedger, usageDay, type UsageRow} from './ledger.js';

function total() {
  return {calls: 0, missingUsage: 0, input: 0, output: 0, read: 0, write: 0, missingRead: 0, missingWrite: 0,
    priced: 0, yuan: 0, partial: false};
}
function newGroup({entry, preset, purpose}: UsageRow) {
  return {...total(), entry, preset, purpose, label: usageLabels[entry]};
}
function add(target: ReturnType<typeof total>, usage?: TokenUsage, price?: ReturnType<typeof priceCall>) {
  target.calls++;
  if (!usage || !price) { target.missingUsage++; return; }
  target.input += usage.inputTokens;
  target.output += usage.outputTokens;
  if (usage.cacheReadTokens === undefined) target.missingRead++; else target.read += usage.cacheReadTokens;
  if (usage.cacheWriteTokens === undefined) target.missingWrite++; else target.write += usage.cacheWriteTokens;
  if (price.yuan !== null) { target.priced++; target.yuan += price.yuan; }
  if (price.missing.length) target.partial = true;
}

export function usageReport(host: PetCoreHost, scope: HomeBinding, requested: unknown) {
  const today = usageDay(Date.now());
  // Calendar arithmetic on the day label also works on 23- and 25-hour days.
  const minDay = new Date(Date.parse(today + 'T00:00:00Z') - 30 * 86400000).toISOString().slice(0, 10);
  const day = requested === undefined ? today : requested;
  if (typeof day !== 'string' || day < minDay || day > today
      || !localDayStart(day, Intl.DateTimeFormat().resolvedOptions().timeZone)) fail('INVALID_ARGUMENT');
  const gaps = readGaps(host.workspace.runtime.store, day);
  const groups = new Map<string, ReturnType<typeof newGroup>>(), prices = new Set<string>();
  const summary = total(), channels = {qq: 0, wechat: 0};
  let firstDay: string | null = null, recovery: string | null = null, homeYuan = 0, issue: string | null = null;
  const home = host.workspace.readCompanionHome(scope)?.sessionId;
  try {
    readLedger(scope.path, db => {
      firstDay = db.prepare('SELECT MIN(day) AS first FROM calls').get()!.first as string | null;
      recovery = db.prepare("SELECT value FROM meta WHERE key='recovery'").get()?.value as string ?? null;
      for (const {entry, calls} of db.prepare('SELECT entry, COUNT(*) AS calls FROM calls WHERE purpose IS NULL GROUP BY entry').all()) {
        if (String(entry).startsWith('qq-')) channels.qq += Number(calls);
        if (String(entry).startsWith('wechat-')) channels.wechat += Number(calls);
      }
      for (const raw of db.prepare('SELECT * FROM calls WHERE day=? ORDER BY rowid').iterate(day)) {
        const row = raw as unknown as UsageRow;
        const {entry, preset, purpose} = row, key = JSON.stringify([entry, preset, purpose]);
        const group = groups.get(key) ?? newGroup(row);
        const usage = row.input_miss === null ? undefined : {inputTokens: row.input_miss, outputTokens: row.output!,
          cacheReadTokens: row.cache_read ?? undefined, cacheWriteTokens: row.cache_write ?? undefined};
        const price = usage && priceCall(usage, row.provider, row.model, row.started_at);
        if (price?.missing.length) prices.add(row.provider + ' / ' + row.model + ' · ' + price.missing.join('、'));
        add(group, usage, price);
        add(summary, usage, price);
        groups.set(key, group);
        if (usage && row.session_id === home && !purpose)
          homeYuan += stepCost(usage, row.model, new Date(row.ended_at));
      }
    });
  } catch (error) { issue = error instanceof Error && error.message === 'LEDGER_UPGRADE' ? 'upgrade' : 'unavailable'; }
  return {day, today, minDay, firstDay, gaps, recovery, issue, groups: [...groups.values()], summary,
    prices: [...prices], channels, homeYuan};
}
