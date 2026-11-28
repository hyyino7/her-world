import {localDayStart} from '#dsh-world/memoryStore';
import {usageLabels} from '../../contracts/usage.js';
import {stepCost} from '../../world/usage.js';
import type {PetCoreHost} from '../index.js';
import type {HomeBinding} from '../workspace.js';
import {fail} from '../tables/console.js';
import {readGaps} from './gaps.js';
import {readLedger, usageDay, type UsageRow} from './ledger.js';

import {total, add, measure, ledgerIssue, daysBefore, recoveryMarker} from './totals.js';

function newGroup({entry, preset, purpose}: UsageRow) {
  return {...total(), entry, preset, purpose, label: usageLabels[entry]};
}
export function usageReport(host: PetCoreHost, scope: HomeBinding, requested: unknown) {
  const today = usageDay(Date.now());
  const minDay = daysBefore(today, 30);
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
      recovery = recoveryMarker(db) ?? null;
      for (const {entry, calls} of db.prepare('SELECT entry, COUNT(*) AS calls FROM calls WHERE purpose IS NULL GROUP BY entry').all()) {
        if (String(entry).startsWith('qq-')) channels.qq += Number(calls);
        if (String(entry).startsWith('wechat-')) channels.wechat += Number(calls);
      }
      for (const raw of db.prepare('SELECT * FROM calls WHERE day=? ORDER BY rowid').iterate(day)) {
        const row = raw as unknown as UsageRow;
        const {entry, preset, purpose} = row, key = JSON.stringify([entry, preset, purpose]);
        const group = groups.get(key) ?? newGroup(row);
        const measured = measure(row);
        if (measured?.price.missing.length) prices.add(row.provider + ' / ' + row.model + ' · ' + measured.price.missing.join('、'));
        add(group, measured);
        add(summary, measured);
        groups.set(key, group);
        if (measured && row.session_id === home && !purpose)
          homeYuan += stepCost(measured.usage, row.model, new Date(row.ended_at));
      }
    });
  } catch (error) { issue = ledgerIssue(error); }
  return {day, today, minDay, firstDay, gaps, recovery, issue, groups: [...groups.values()], summary,
    prices: [...prices], channels, homeYuan};
}
