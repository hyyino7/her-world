import { canonical, check, digest, integer, reject, text } from '../../core/storage.js';
import { object, requiredText } from '../../core/tables/console.js';
const actionEndpoint = 'economyAction', settingsEndpoint = 'economySettings';
const receipt = {
    grant: (_id, { amount, note }) => ({ operation: 'grant-money', payload: { amount, note } }),
    gift: (_id, { itemId, quantity, note }) => ({ operation: 'gift-item', payload: { itemId, quantity, note } }),
    buy: (_id, { itemId, quantity }) => ({ operation: 'purchase', payload: { itemId, quantity } }),
    sell: (_id, { itemId, quantity }) => ({ operation: 'sale', payload: { itemId, quantity } }),
    importReading: (id, { title, content, format, source }) => ({ operation: 'import-reading', payload: {
            itemId: `reading:owner-${digest(id).slice(7, 39)}`, title, text: content,
            ...(format === undefined ? {} : { format }), source: { kind: 'owner-import', name: source?.name },
        } }),
    feed: () => ({ operation: 'consume' }),
};
export function walletActionReceipt(id, action) {
    check(Object.hasOwn(receipt, action.kind), 'Invalid wallet action');
    return receipt[action.kind](id, action);
}
function requestIdValid(id) {
    text(id, 'wallet request ID', 160);
    check(!/[\x00-\x1f\x7f]/.test(id), 'Invalid wallet request ID');
}
export function normalizeWalletRequest(endpoint, raw) {
    check(endpoint === actionEndpoint || endpoint === settingsEndpoint, 'Invalid wallet endpoint');
    const input = object(raw, endpoint === actionEndpoint
        ? ['workspaceId', 'action'] : ['workspaceId', 'expectedVersion', 'next']);
    const workspaceId = requiredText(input.workspaceId, 200);
    let normalized;
    if (endpoint === settingsEndpoint) {
        text(input.expectedVersion, 'configuration version', 256);
        const version = Number(input.expectedVersion);
        integer(version, 'configuration version', 1);
        const next = input.next;
        check(next && Object.getPrototypeOf(next) === Object.prototype, 'Invalid economy configuration');
        const { version: _schema, revision: _revision, ...patch } = next;
        normalized = { workspaceId, expectedVersion: String(version), next: patch };
    }
    else {
        const rawAction = input.action;
        check(rawAction && Object.getPrototypeOf(rawAction) === Object.prototype
            && Object.hasOwn(receipt, rawAction.kind), 'Invalid wallet action');
        const { kind } = rawAction;
        const action = { kind };
        if (kind === 'grant') {
            integer(rawAction.amount, 'grant amount', 1);
            action.amount = rawAction.amount;
        }
        else if (kind === 'importReading') {
            text(rawAction.title, 'reading title', 200);
            text(rawAction.content, 'reading content', 1_000_000);
            text(rawAction.source?.name, 'reading source', 200);
            action.title = rawAction.title;
            action.content = rawAction.content;
            action.source = { name: rawAction.source.name };
            if (rawAction.format !== undefined) {
                check(rawAction.format === 'article' || rawAction.format === 'book', 'Invalid reading format');
                action.format = rawAction.format;
            }
        }
        else {
            text(rawAction.itemId, 'wallet item ID', 160);
            action.itemId = rawAction.itemId;
            action.quantity = rawAction.quantity ?? 1;
            integer(action.quantity, 'wallet quantity', 1, kind === 'feed' ? 1 : Number.MAX_SAFE_INTEGER);
        }
        if (kind === 'grant' || kind === 'gift') {
            action.note = typeof rawAction.note === 'string' && rawAction.note.trim() ? rawAction.note
                : kind === 'grant' ? 'Owner money grant' : 'Owner item gift';
            text(action.note, 'wallet note', 2000);
        }
        normalized = { workspaceId, action };
    }
    return { endpoint, input: normalized, fingerprint: digest({ endpoint, input: normalized }) };
}
export const consoleFoodOperationId = (requestId) => `owner-food:${digest(requestId).slice(7, 55)}`;
export function legacyWalletDigest(requestId, { input }) {
    if (!('action' in input))
        return digest({ operation: 'configure', payload: { patch: input.next, expectedVersion: Number(input.expectedVersion) } });
    const original = walletActionReceipt(requestId, input.action);
    return 'payload' in original ? digest(original) : undefined;
}
const proofKey = 'console.wallet-import';
export function installConsoleRequests(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS console_wallet_requests (
    id TEXT PRIMARY KEY, storage_id TEXT NOT NULL, companion_id TEXT NOT NULL,
    endpoint TEXT NOT NULL, fingerprint TEXT NOT NULL, input TEXT, food_operation_id TEXT,
    state TEXT NOT NULL CHECK(state IN ('pending','committed','declined','abandoned')),
    CHECK((state='pending')=(input IS NOT NULL)));
    CREATE INDEX IF NOT EXISTS console_wallet_pending_food ON console_wallet_requests(food_operation_id) WHERE state='pending';`);
}
export function readConsoleImportProof(db) {
    const row = db.prepare('SELECT value FROM meta WHERE key=?').get(proofKey);
    return row ? JSON.parse(String(row.value)) : undefined;
}
export class ConsoleRequests {
    db;
    binding;
    constructor(db, binding) {
        this.db = db;
        this.binding = binding;
    }
    get(id) {
        requestIdValid(id);
        const row = this.db.prepare('SELECT * FROM console_wallet_requests WHERE id=?').get(id);
        if (!row)
            return;
        check(row.storage_id === this.binding.storageId && row.companion_id === this.binding.companionId, 'Wallet request belongs to a different binding');
        const request = row.input === null ? undefined : normalizeWalletRequest(String(row.endpoint), JSON.parse(String(row.input)));
        check(!request || request.fingerprint === row.fingerprint, 'Wallet request fingerprint changed');
        return { state: row.state, fingerprint: String(row.fingerprint), request };
    }
    pending() {
        return this.db.prepare("SELECT id AS requestId, endpoint FROM console_wallet_requests WHERE state='pending' AND storage_id=? AND companion_id=? ORDER BY id")
            .all(this.binding.storageId, this.binding.companionId);
    }
    waitsForRetry(operationId) {
        return Boolean(this.db.prepare("SELECT 1 FROM console_wallet_requests WHERE food_operation_id=? AND state='pending' AND storage_id=? AND companion_id=?")
            .get(operationId, this.binding.storageId, this.binding.companionId));
    }
    add(id, request) {
        requestIdValid(id);
        const foodOperation = 'action' in request.input && request.input.action.kind === 'feed' ? consoleFoodOperationId(id) : null;
        this.db.prepare("INSERT INTO console_wallet_requests VALUES (?,?,?,?,?,?,?,'pending')").run(id, this.binding.storageId, this.binding.companionId, request.endpoint, request.fingerprint, canonical(request.input), foodOperation);
    }
    finish(id, fingerprint, state) {
        const update = this.db.prepare("UPDATE console_wallet_requests SET state=?, input=NULL WHERE id=? AND fingerprint=? AND storage_id=? AND companion_id=? AND state='pending'")
            .run(state, id, fingerprint, this.binding.storageId, this.binding.companionId);
        if (update.changes !== 1)
            reject('CONFLICT', 'Wallet request changed during reconciliation');
    }
}
/** The offline step owns the transaction containing schema, rows and proof. */
export function importConsoleRequests(db, binding, requests, proof) {
    installConsoleRequests(db);
    const rows = new ConsoleRequests(db, binding);
    for (const request of requests) {
        const normalized = normalizeWalletRequest(request.endpoint, request.input);
        check(normalized.fingerprint === request.fingerprint, 'Wallet import fingerprint changed');
        rows.add(request.requestId, normalized);
    }
    db.prepare('INSERT INTO meta VALUES (?,?)').run(proofKey, canonical(proof));
}
//# sourceMappingURL=console-requests.js.map