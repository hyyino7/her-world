import type { DatabaseSync } from 'node:sqlite';
import { canonical, check, digest, integer, reject, text } from '../../core/storage.js';
import { object, requiredText } from '../../core/tables/console.js';
import type { PlannedExecution } from '../../contracts/behavior.js';
import type { EconomyConfigurationPatch, ReadingContent } from './types.js';

const actionEndpoint = 'economyAction', settingsEndpoint = 'economySettings';
type WalletFields = {
  amount?: number; itemId?: string; quantity?: number; note?: string;
  title?: string; content?: string; format?: ReadingContent['format']; source?: {name: string};
};
const receipt = {
  grant: (_id: string, {amount, note}: WalletFields) => ({operation:'grant-money', payload:{amount, note}} as const),
  gift: (_id: string, {itemId, quantity, note}: WalletFields) => ({operation:'gift-item', payload:{itemId, quantity, note}} as const),
  buy: (_id: string, {itemId, quantity}: WalletFields) => ({operation:'purchase', payload:{itemId, quantity}} as const),
  sell: (_id: string, {itemId, quantity}: WalletFields) => ({operation:'sell', payload:{itemId, quantity}} as const),
  importReading: (id: string, {title, content, format, source}: WalletFields) => ({operation:'import-reading', payload:{
    itemId: `reading:owner-${digest(id).slice(7,39)}`, title, text:content,
    ...(format === undefined ? {} : {format}), source:{kind:'owner-import', name:source?.name},
  }} as const),
  feed: () => ({operation:'consume'} as const),
};
type WalletAction = WalletFields & {kind: keyof typeof receipt};
export function walletActionReceipt(id: string, action: WalletAction) {
  check(Object.hasOwn(receipt, action.kind), 'Invalid wallet action');
  return receipt[action.kind](id, action);
}
type WalletInput = {workspaceId: string} & (
  {action: WalletAction} | {expectedVersion: string; next: EconomyConfigurationPatch}
);
export type WalletRequest = {
  endpoint: typeof actionEndpoint | typeof settingsEndpoint; input: WalletInput; fingerprint: string;
};
export type WalletEvidence = {
  declined?: boolean; savedSnapshot?: string; execution?: PlannedExecution;
} & ({state:'committed'} | {state:'partial'} | {state:'no-evidence'} | {state:'conflict'});
export type WalletState = WalletEvidence['state'] | 'abandoned';
type Binding = {storageId: string; companionId: string};

function requestIdValid(id: string) {
  text(id, 'wallet request ID', 160);
  check(!/[\x00-\x1f\x7f]/.test(id), 'Invalid wallet request ID');
}

export function normalizeWalletRequest(endpoint: string, raw: unknown): WalletRequest {
  check(endpoint === actionEndpoint || endpoint === settingsEndpoint, 'Invalid wallet endpoint');
  const input = object(raw, endpoint === actionEndpoint
    ? ['workspaceId', 'action'] : ['workspaceId', 'expectedVersion', 'next']);
  const workspaceId = requiredText(input.workspaceId, 200);
  let normalized: WalletInput;
  if (endpoint === settingsEndpoint) {
    text(input.expectedVersion, 'configuration version', 256);
    const version = Number(input.expectedVersion);
    integer(version, 'configuration version', 1);
    const next = input.next as EconomyConfigurationPatch & {version?: number; revision?: number};
    check(next && Object.getPrototypeOf(next) === Object.prototype, 'Invalid economy configuration');
    const {version: _schema, revision: _revision, ...patch} = next;
    normalized = {workspaceId, expectedVersion: String(version), next: patch};
  } else {
    const rawAction = input.action as WalletAction;
    check(rawAction && Object.getPrototypeOf(rawAction) === Object.prototype
      && Object.hasOwn(receipt, rawAction.kind), 'Invalid wallet action');
    const {kind} = rawAction;
    const action: WalletAction = {kind};
    if (kind === 'grant') {
      integer(rawAction.amount, 'grant amount', 1);
      action.amount = rawAction.amount;
    } else if (kind === 'importReading') {
      text(rawAction.title, 'reading title', 200);
      text(rawAction.content, 'reading content', 1_000_000);
      text(rawAction.source?.name, 'reading source', 200);
      action.title = rawAction.title;
      action.content = rawAction.content;
      action.source = {name: rawAction.source!.name};
      if (rawAction.format !== undefined) {
        check(rawAction.format === 'article' || rawAction.format === 'book', 'Invalid reading format');
        action.format = rawAction.format;
      }
    } else {
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
    normalized = {workspaceId, action};
  }
  return {endpoint, input: normalized, fingerprint: digest({endpoint, input: normalized})};
}

export const consoleFoodOperationId = (requestId: string) => `owner-food:${digest(requestId).slice(7,55)}`;

export function legacyWalletDigest(requestId: string, {input}: WalletRequest) {
  if (!('action' in input)) return digest({operation: 'configure', payload: {patch: input.next, expectedVersion: Number(input.expectedVersion)}});
  const original = walletActionReceipt(requestId, input.action);
  return 'payload' in original ? digest(original) : undefined;
}

export function installConsoleRequests(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS console_wallet_requests (
    id TEXT PRIMARY KEY, storage_id TEXT NOT NULL, companion_id TEXT NOT NULL,
    endpoint TEXT NOT NULL, fingerprint TEXT NOT NULL, input TEXT, food_operation_id TEXT,
    state TEXT NOT NULL CHECK(state IN ('pending','committed','declined','abandoned')),
    CHECK((state='pending')=(input IS NOT NULL)));
    CREATE INDEX IF NOT EXISTS console_wallet_pending_food ON console_wallet_requests(food_operation_id) WHERE state='pending';`);
}

export class ConsoleRequests {
  constructor(private readonly db: DatabaseSync, private readonly binding: Binding) {}

  get(id: string) {
    requestIdValid(id);
    const row = this.db.prepare('SELECT * FROM console_wallet_requests WHERE id=?').get(id);
    if (!row) return;
    check(row.storage_id === this.binding.storageId && row.companion_id === this.binding.companionId,
      'Wallet request belongs to a different binding');
    const request = row.input === null ? undefined : normalizeWalletRequest(String(row.endpoint), JSON.parse(String(row.input)));
    check(!request || request.fingerprint === row.fingerprint, 'Wallet request fingerprint changed');
    return {state: row.state as 'pending' | 'committed' | 'declined' | 'abandoned', fingerprint: String(row.fingerprint), request};
  }

  pending() {
    return this.db.prepare("SELECT id AS requestId, endpoint FROM console_wallet_requests WHERE state='pending' AND storage_id=? AND companion_id=? ORDER BY id")
      .all(this.binding.storageId, this.binding.companionId);
  }

  recentCommitted() {
    return this.db.prepare("SELECT id AS requestId, endpoint FROM console_wallet_requests WHERE state='committed' AND storage_id=? AND companion_id=? ORDER BY rowid DESC LIMIT 20")
      .all(this.binding.storageId, this.binding.companionId);
  }

  waitsForRetry(operationId: string) {
    return Boolean(this.db.prepare("SELECT 1 FROM console_wallet_requests WHERE food_operation_id=? AND state='pending' AND storage_id=? AND companion_id=?")
      .get(operationId, this.binding.storageId, this.binding.companionId));
  }

  add(id: string, request: WalletRequest) {
    requestIdValid(id);
    const foodOperation = 'action' in request.input && request.input.action.kind === 'feed' ? consoleFoodOperationId(id) : null;
    this.db.prepare("INSERT INTO console_wallet_requests VALUES (?,?,?,?,?,?,?,'pending')").run(
      id, this.binding.storageId, this.binding.companionId, request.endpoint, request.fingerprint, canonical(request.input), foodOperation);
  }

  finish(id: string, fingerprint: string, state: 'committed' | 'declined' | 'abandoned') {
    const update = this.db.prepare("UPDATE console_wallet_requests SET state=?, input=NULL WHERE id=? AND fingerprint=? AND storage_id=? AND companion_id=? AND state='pending'")
      .run(state, id, fingerprint, this.binding.storageId, this.binding.companionId);
    if (update.changes !== 1) reject('CONFLICT', 'Wallet request changed during reconciliation');
  }
}
