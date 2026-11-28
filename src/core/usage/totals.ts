import {lstatSync} from 'node:fs';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {priceCall} from '../../world/usage.js';
import type {HomeBinding} from '../workspace.js';
import {readLedger, type UsageRow} from './ledger.js';

export function total() {
  return {calls: 0, missingUsage: 0, input: 0, output: 0, read: 0, write: 0, missingRead: 0, missingWrite: 0,
    priced: 0, unpriced: 0, yuan: 0, partial: false};
}
type Total = ReturnType<typeof total>;

export function measure(row: UsageRow) {
  if (row.input_miss === null) return;
  const usage = {inputTokens: row.input_miss, outputTokens: row.output!,
    cacheReadTokens: row.cache_read ?? undefined, cacheWriteTokens: row.cache_write ?? undefined};
  return {usage, price: priceCall(usage, row.provider, row.model, row.started_at)};
}

export function add(target: Total, measured: ReturnType<typeof measure>) {
  target.calls++;
  if (!measured) { target.missingUsage++; return; }
  const {usage, price} = measured;
  target.input += usage.inputTokens;
  target.output += usage.outputTokens;
  if (usage.cacheReadTokens === undefined) target.missingRead++; else target.read += usage.cacheReadTokens;
  if (usage.cacheWriteTokens === undefined) target.missingWrite++; else target.write += usage.cacheWriteTokens;
  if (price.yuan === null) target.unpriced++;
  else { target.priced++; target.yuan += price.yuan; }
  if (price.missing.length) target.partial = true;
}

export function ledgerIssue(error: unknown) {
  return error instanceof Error && error.message === 'LEDGER_UPGRADE' ? 'upgrade' : 'unavailable';
}
export function recoveryMarker(db: DatabaseSync) {
  return db.prepare("SELECT value FROM meta WHERE key='recovery'").get()?.value as string | undefined;
}
export function daysBefore(day: string, days: number) {
  // Calendar arithmetic on the day label also works on 23- and 25-hour days.
  return new Date(Date.parse(day + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10);
}

type Issue = ReturnType<typeof ledgerIssue>;
type Status = 'absent' | 'empty' | 'recorded' | 'recovered' | 'unavailable';
function result(counts: Total, exists: boolean, recovery?: string, issue?: Issue) {
  const status: Status = issue ? 'unavailable' : recovery ? 'recovered' : !exists ? 'absent' : counts.calls ? 'recorded' : 'empty';
  return {...counts, status, issue: issue ?? null};
}

// Life has one active home. Keep only its most recent snapshot across calls.
let previous: {key: string; last: number; counts: Total} | undefined;
export function homeSpend(scope: Pick<HomeBinding, 'path'>, sessionId: string | undefined, day: string) {
  try {
    const stat = lstatSync(join(scope.path, '.chatpet/data/usage/ledger.sqlite'), {bigint:true, throwIfNoEntry:false});
    const report = readLedger(scope.path, db => {
      const recovery = recoveryMarker(db);
      const key = JSON.stringify([scope.path, String(stat?.dev), String(stat?.ino), String(stat?.birthtimeNs), day, sessionId, recovery]);
      const last = Number(db.prepare('SELECT MAX(rowid) AS last FROM calls').get()!.last);
      const cached = previous?.key === key && previous.last <= last ? previous : undefined;
      const counts = cached ? {...cached.counts} : total();
      for (const row of db.prepare('SELECT * FROM calls INDEXED BY calls_day WHERE day=? AND rowid>? AND session_id=?')
        .iterate(day, cached?.last ?? 0, sessionId ?? null)) add(counts, measure(row as unknown as UsageRow));
      previous = {key, last, counts};
      return result(counts, true, recovery);
    });
    if (report) return report;
    previous = undefined;
    return result(total(), false);
  } catch (error) {
    previous = undefined;
    return result(total(), false, undefined, ledgerIssue(error));
  }
}

export function channelTotals(scope: Pick<HomeBinding, 'path'>, today: string) {
  const from = daysBefore(today, 29);
  const qq = total(), wechat = total();
  function range(counts: Total, exists: boolean, recovery?: string, issue?: Issue) {
    return {...result(counts, exists, recovery, issue), from, to: today};
  }
  try {
    return readLedger(scope.path, db => {
      const recovery = recoveryMarker(db);
      const rows = db.prepare("SELECT * FROM calls WHERE day BETWEEN ? AND ? AND (entry GLOB 'qq-*' OR entry GLOB 'wechat-*')");
      for (const raw of rows.iterate(from, today)) {
        const row = raw as unknown as UsageRow;
        add(row.entry.startsWith('qq-') ? qq : wechat, measure(row));
      }
      return {qq: range(qq, true, recovery), wechat: range(wechat, true, recovery)};
    }) ?? {qq: range(qq, false), wechat: range(wechat, false)};
  } catch (error) {
    const failed = range(total(), false, undefined, ledgerIssue(error));
    return {qq: failed, wechat: {...failed}};
  }
}
