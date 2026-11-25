import type {CoreStore} from '../storage.js';

const empty = {writeFailed: 0, unbound: 0, rebound: 0};
const kind = 'usage-ledger-gaps';

export function readGaps(store: CoreStore, day: string) {
  return store.get<typeof empty>(kind, day) ?? {...empty};
}

export function recordGap(store: CoreStore, day: string, reason: keyof typeof empty) {
  store.transaction(() => {
    const gaps = readGaps(store, day);
    gaps[reason]++;
    store.put(kind, day, gaps);
  });
}
