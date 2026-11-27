const empty = { writeFailed: 0, unbound: 0, rebound: 0 };
const kind = 'usage-ledger-gaps';
export function readGaps(store, day) {
    return store.get(kind, day) ?? { ...empty };
}
export function recordGap(store, day, reason) {
    store.transaction(() => {
        const gaps = readGaps(store, day);
        gaps[reason]++;
        store.put(kind, day, gaps);
    });
}
//# sourceMappingURL=gaps.js.map