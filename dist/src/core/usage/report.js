import { localDayStart } from '#dsh-world/memoryStore';
import { usageLabels } from '../../contracts/usage.js';
import { fail } from '../tables/console.js';
import { readGaps } from './gaps.js';
import { readLedger, usageDay } from './ledger.js';
import { total, add, measure, ledgerIssue, daysBefore, recoveryMarker } from './totals.js';
function newGroup({ entry, preset, purpose }) {
    return { ...total(), entry, preset, purpose, label: usageLabels[entry] };
}
export function usageReport(host, scope, requested) {
    const today = usageDay(Date.now());
    const minDay = daysBefore(today, 30);
    const day = requested === undefined ? today : requested;
    if (typeof day !== 'string' || day < minDay || day > today
        || !localDayStart(day, Intl.DateTimeFormat().resolvedOptions().timeZone))
        fail('INVALID_ARGUMENT');
    const gaps = readGaps(host.workspace.runtime.store, day);
    const groups = new Map(), prices = new Set();
    const summary = total();
    let firstDay = null, recovery = null, issue = null;
    try {
        readLedger(scope.path, db => {
            firstDay = db.prepare('SELECT MIN(day) AS first FROM calls').get().first;
            recovery = recoveryMarker(db) ?? null;
            for (const raw of db.prepare('SELECT * FROM calls WHERE day=? ORDER BY rowid').iterate(day)) {
                const row = raw;
                const { entry, preset, purpose } = row, key = JSON.stringify([entry, preset, purpose]);
                const group = groups.get(key) ?? newGroup(row);
                const measured = measure(row);
                if (measured?.price.missing.length)
                    prices.add(row.provider + ' / ' + row.model + ' · ' + measured.price.missing.join('、'));
                add(group, measured);
                add(summary, measured);
                groups.set(key, group);
            }
        });
    }
    catch (error) {
        issue = ledgerIssue(error);
    }
    return { day, today, minDay, firstDay, gaps, recovery, issue, groups: [...groups.values()], summary,
        prices: [...prices] };
}
//# sourceMappingURL=report.js.map