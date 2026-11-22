import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CROPS, GARDEN_RULES, createGarden, normalizeGarden, advanceGarden, applyGardenAction, gardenView } from '#feiyu-garden';
import { canonical, check, digest, integer, reject, text, unavailable } from '../../core/storage.js';
import { closeSqliteLease, setSqliteMeta } from '../../core/sqlite.js';
import { effectiveEconomyConfiguration, defaultEconomyConfiguration, economyCatalog, isWritableCatalogKey, ORIGINAL_READINGS } from './catalog.js';
import { isBodyMetric } from '../../contracts/behavior.js';
import { advanceGardenClock } from './garden-clock.js';
import { ECONOMY_INITIALIZED, economyAdoptionPath, economyFile, economyRecoveryAdvice, ensureAdoptionDirectory, inspectEconomyAdoption, readEconomyDatabaseMarker, readEconomyFileEvidence, syncPath, writeEconomyFile } from './adoption.js';
const cropRows = CROPS;
const runningClock = { enabled: true };
const terminal = new Set(['completed', 'failed', 'cancelled']);
const json = (value) => JSON.parse(value);
const clone = (value) => JSON.parse(canonical(value));
const atTime = (value) => { integer(value, 'time'); return value; };
const safeSum = (a, b) => { const value = a + b; integer(value, 'resulting amount'); return value; };
const safeProduct = (a, b) => { const value = a * b; integer(value, 'total amount'); return value; };
function token(value, label) { text(value, label, 160); check(!/[\u0000-\u001f\u007f]/.test(value), `Invalid ${label}`); }
export function projectWallet({ balance, inventory, catalog, bookmarks }) {
    const held = new Set(inventory.filter(item => item.quantity > 0).map(item => item.itemId));
    const reading = catalog.flatMap(item => {
        const version = item.contentVersion;
        if (!version || !held.has(item.id))
            return [];
        const bookmark = bookmarks.find(row => row.itemId === item.id && row.version === version) ?? null;
        return [{ itemId: item.id, version, bookmark }];
    });
    return { balance, inventory, reading };
}
/** One bound SQLite aggregate owns money, every item, garden jobs and their receipts.
 * No CoreStore or assistant is constructed here. The existing Core binding guard
 * and Core JSON/error helpers are reused at this synchronous persistence boundary. */
export class EconomyStore {
    options;
    directory;
    databasePath;
    lockPath;
    markerPath;
    lockToken = `${process.pid}:${randomUUID()}`;
    db;
    databaseFile;
    closed = false;
    walletDirty = false;
    constructor(options) {
        this.options = options;
        check(isAbsolute(options.workspacePath), 'Economy workspace path must be absolute');
        token(options.storageId, 'storage identity');
        token(options.companionId, 'companion identity');
        options.guard?.();
        const root = realpathSync(options.workspacePath), expected = { storageId: options.storageId, companionId: options.companionId };
        const adoption = economyAdoptionPath(root);
        const evidence = () => inspectEconomyAdoption(root, expected, options.expectedInitialized);
        evidence();
        let directory = root;
        for (const part of ['.chatpet', 'data', 'economy']) {
            directory = join(directory, part);
            if (!existsSync(directory)) {
                mkdirSync(directory, { mode: 0o700 });
                syncPath(dirname(directory));
            }
            const stat = lstatSync(directory);
            check(stat.isDirectory() && !stat.isSymbolicLink(), 'Invalid economy directory');
        }
        this.directory = realpathSync(directory);
        chmodSync(this.directory, 0o700);
        this.databasePath = join(this.directory, 'economy.sqlite');
        this.lockPath = join(this.directory, 'economy.lock');
        this.markerPath = join(this.directory, 'storage.json');
        // This lease follows CoreStore's live-pid/token pattern. A missing/moved
        // database is rejected during normal use, even if SQLite still holds it open.
        if (existsSync(this.lockPath)) {
            this.safeFile(this.lockPath);
            const pid = Number(readFileSync(this.lockPath, 'utf8').split(':')[0]);
            integer(pid, 'economy owner pid', 1);
            try {
                process.kill(pid, 0);
                reject('CONFLICT', 'Economy storage already has a live owner');
            }
            catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
                    throw error;
                unlinkSync(this.lockPath);
            }
        }
        const lock = openSync(this.lockPath, 'wx', 0o600);
        try {
            writeFileSync(lock, this.lockToken);
        }
        finally {
            closeSync(lock);
        }
        let opened;
        try {
            options.guard?.();
            const files = evidence(), database = pathToFileURL(this.databasePath);
            const legacy = files.database ? undefined : options.legacyGarden ?? options.loadLegacyGarden?.();
            if (legacy) {
                text(legacy.sourcePath, 'legacy source path', 4096);
                check(/^sha256:[a-f0-9]{64}$/.test(legacy.sourceHash), 'Invalid legacy garden digest');
                this.validateGardenResources(legacy.state);
            }
            if (files.database)
                database.searchParams.set('mode', 'rw');
            else {
                ensureAdoptionDirectory(adoption);
                writeEconomyFile(adoption, canonical(expected) + '\n');
            }
            this.db = opened = new DatabaseSync(database);
            this.databaseFile = lstatSync(this.databasePath);
            if (files.database) {
                const incomplete = 'Economy initialization marker exists without its initialized database.'
                    + (files.adoption ? economyRecoveryAdvice(adoption, this.databasePath) : '');
                if (!readEconomyDatabaseMarker(this.db, expected, incomplete))
                    unavailable(incomplete);
            }
            chmodSync(this.databasePath, 0o600);
            this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000');
            if (!files.database)
                this.transaction(() => {
                    this.db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY,quantity INTEGER NOT NULL CHECK(quantity>=0));
        CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY,digest TEXT NOT NULL,result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ledger (sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,request_id TEXT NOT NULL,kind TEXT NOT NULL,at INTEGER NOT NULL,money_delta INTEGER NOT NULL,balance INTEGER NOT NULL,item_deltas TEXT NOT NULL,note TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS garden_receipts (request_id TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS uses (id TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS readings (id TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS bookmarks (id TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS reading_operations (id TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS interaction_facts (sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,request_id TEXT NOT NULL UNIQUE,value TEXT NOT NULL,acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(acknowledged IN (0,1)));`);
                    const now = Date.now();
                    this.setMeta('configuration', defaultEconomyConfiguration());
                    const imported = legacy ? clone(legacy.state) : undefined;
                    if (imported)
                        imported.economyRevision = 1;
                    // Keep the physical rules for crops planted before the import.
                    for (const plot of imported?.plots ?? []) {
                        const crop = cropRows.find(row => row.id === plot?.cropId);
                        if (crop && !plot.cropProfile)
                            plot.cropProfile = { growMs: crop.growMs, yield: crop.yield, waterDurationFactor: GARDEN_RULES.waterDurationFactor, fertilizerGrowth: GARDEN_RULES.fertilizerGrowth, fertilizerYield: GARDEN_RULES.fertilizerYield };
                    }
                    const garden = legacy ? this.normalize(imported, now) : createGarden(now);
                    this.setMeta('schema', '1');
                    this.setMeta('identity', expected);
                    this.setMeta('revision', 1);
                    this.setMeta('migration', legacy ? { kind: 'legacy-garden', sourcePath: legacy.sourcePath, sourceHash: legacy.sourceHash, importedAt: now } : { kind: 'new', importedAt: now });
                    this.setMeta('balance', garden.coins);
                    this.saveGardenRow(garden);
                    this.importGardenItems(garden);
                    for (const content of ORIGINAL_READINGS)
                        this.putReading(content);
                    if (legacy)
                        this.recordLedger('migration:legacy-garden', 'legacy-import', garden.coins, this.resourceDeltas({}, this.gardenResources(garden)), 'Imported the retained garden once; legacy files were not changed', now);
                    this.setMeta(ECONOMY_INITIALIZED, expected);
                });
            syncPath(this.directory);
            this.writeStorageMarker();
        }
        catch (error) {
            opened?.close();
            if (existsSync(this.lockPath) && readFileSync(this.lockPath, 'utf8') === this.lockToken)
                unlinkSync(this.lockPath);
            throw error;
        }
    }
    safeFile(path) { const stat = lstatSync(path); check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'Invalid economy storage file'); }
    writeStorageMarker() {
        const { storageId, companionId } = this.options;
        if (!economyFile(this.markerPath))
            writeEconomyFile(this.markerPath, canonical({ storageId, companionId, schema: 1, database: 'economy.sqlite', migration: this.meta('migration') }));
    }
    /** Validate wallet admission, including retained evidence, when reusing the open Store. */
    validate(initializing = false) {
        this.ensure();
        const { workspacePath, storageId, companionId } = this.options;
        readEconomyFileEvidence(workspacePath, { storageId, companionId });
        if (initializing)
            this.writeStorageMarker();
    }
    ensure() {
        if (this.closed)
            unavailable('Economy is closed');
        this.options.guard?.();
        try {
            const stat = lstatSync(this.databasePath);
            check(stat.isFile() && !stat.isSymbolicLink() && stat.dev === this.databaseFile.dev && stat.ino === this.databaseFile.ino && readFileSync(this.lockPath, 'utf8') === this.lockToken, 'Economy database or lease changed');
        }
        catch (error) {
            unavailable(`Economy storage is missing or changed; recover it before continuing (${String(error)})`);
        }
    }
    factWritten = false;
    transaction(fn) {
        this.ensure();
        this.db.exec('BEGIN IMMEDIATE');
        this.walletDirty = false;
        this.factWritten = false;
        let result;
        try {
            result = fn();
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
        if (this.walletDirty)
            try {
                this.options.walletChanged?.();
            }
            catch { /* The wallet has committed. */ }
        if (this.factWritten)
            try {
                this.options.factsCommitted?.();
            }
            catch { /* The fact has committed. */ }
        return result;
    }
    meta(key) { const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key); return row ? json(row.value) : undefined; }
    requiredMeta(key) { const value = this.meta(key); if (value === undefined)
        unavailable(`Economy metadata ${key} is missing`); return value; }
    setMeta(key, value) { setSqliteMeta(this.db, key, canonical(value)); }
    revision() { return this.requiredMeta('revision'); }
    bump() { this.setMeta('revision', safeSum(this.revision(), 1)); }
    configuration() { return effectiveEconomyConfiguration(this.requiredMeta('configuration')); }
    balance() { const amount = this.requiredMeta('balance'); integer(amount, 'balance'); return amount; }
    quantity(itemId) { const row = this.db.prepare('SELECT quantity FROM items WHERE id=?').get(itemId); const amount = row ? Number(row.quantity) : 0; integer(amount, 'inventory quantity'); return amount; }
    setQuantity(itemId, quantity) { integer(quantity, 'inventory quantity'); this.db.prepare('INSERT INTO items VALUES(?,?) ON CONFLICT(id) DO UPDATE SET quantity=excluded.quantity').run(itemId, quantity); }
    allUses() { return this.db.prepare('SELECT value FROM uses').all().map(row => json(row.value)); }
    reserved(itemId) { return this.allUses().filter(row => row.itemId === itemId && row.status === 'reserved').reduce((sum, row) => safeSum(sum, row.quantity), 0); }
    available(itemId) { const amount = this.quantity(itemId) - this.reserved(itemId); integer(amount, 'available inventory'); return amount; }
    readings() { return this.db.prepare('SELECT value FROM readings ORDER BY id').all().map(row => json(row.value)); }
    readingVersion(itemId) {
        return this.db.prepare("SELECT json_extract(value,'$.version') AS version FROM readings WHERE id=?").get(itemId)?.version;
    }
    putReading(content) {
        if (this.options.walletChanged && !this.walletDirty) {
            const version = this.readingVersion(content.itemId);
            this.walletDirty = version === undefined || version !== content.version && this.quantity(content.itemId) > 0;
        }
        this.db.prepare('INSERT INTO readings VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(content.itemId, canonical(content));
    }
    catalogRows() { return economyCatalog(this.configuration(), this.readings()); }
    item(itemId) { token(itemId, 'item id'); return this.catalogRows().find(row => row.id === itemId) ?? reject('NOT_FOUND', 'Item does not exist'); }
    allBookmarks() { return this.db.prepare('SELECT value FROM bookmarks ORDER BY id').all().map(row => json(row.value)); }
    mutate(requestId, operation, payload, fn) {
        token(requestId, 'request id');
        const hash = digest({ operation, payload });
        return this.transaction(() => {
            const prior = this.db.prepare('SELECT digest,result FROM requests WHERE id=?').get(requestId);
            if (prior) {
                if (prior.digest !== hash)
                    reject('CONFLICT', 'Request ID reused with different input');
                return json(prior.result);
            }
            const result = fn();
            this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId, hash, canonical(result));
            return result;
        });
    }
    recordLedger(requestId, kind, moneyDelta, itemDeltas, note, now = Date.now()) {
        check(Number.isSafeInteger(moneyDelta), 'Invalid money change');
        atTime(now);
        text(note, 'ledger note', 2000);
        for (const delta of Object.values(itemDeltas))
            check(Number.isSafeInteger(delta), 'Invalid inventory change');
        this.db.prepare('INSERT INTO ledger(id,request_id,kind,at,money_delta,balance,item_deltas,note) VALUES(?,?,?,?,?,?,?,?)')
            .run(`entry_${randomUUID()}`, requestId, kind, now, moneyDelta, this.balance(), canonical(itemDeltas), note);
        this.walletDirty ||= moneyDelta !== 0 || Object.values(itemDeltas).some(delta => delta !== 0);
    }
    /** Called only inside the existing request transaction, beside its actual result.
     * Historical requests are not replayed or turned into new experiences. */
    recordFact(requestId, type, actor, summary, before, after) {
        if (!actor)
            return;
        check(actor.kind === 'owner', 'Economic owner facts require an owner actor');
        token(actor.id, 'fact actor');
        text(actor.channel, 'fact channel', 160);
        if (actor.sessionId !== undefined)
            token(actor.sessionId, 'fact session');
        canonical(actor);
        const fact = { version: 1, id: `economy:${digest(requestId).slice(7)}`, requestId, domain: 'economy', type,
            occurredAt: new Date().toISOString(), actor: clone(actor), result: { status: 'completed', summary, before, after }, operationId: requestId };
        this.db.prepare('INSERT INTO interaction_facts(id,request_id,value) VALUES(?,?,?)').run(fact.id, requestId, canonical(fact));
        this.factWritten = true;
    }
    pendingFacts() {
        this.ensure();
        return this.db.prepare('SELECT value FROM interaction_facts WHERE acknowledged=0 ORDER BY sequence').all().map(row => json(row.value));
    }
    /** Delivery acknowledgements do not erase the original committed facts. */
    readFacts(ids) {
        this.ensure();
        check(Array.isArray(ids), 'Fact identifiers must be an array');
        const read = this.db.prepare('SELECT value FROM interaction_facts WHERE id=?');
        return ids.map(id => {
            token(id, 'fact id');
            const row = read.get(id);
            if (!row)
                reject('NOT_FOUND', 'The original economic interaction fact is unavailable');
            return json(row.value);
        });
    }
    acknowledgeFacts(ids) {
        check(Array.isArray(ids), 'Fact acknowledgements must be an array');
        for (const id of ids)
            token(id, 'fact id');
        this.transaction(() => { const acknowledge = this.db.prepare('UPDATE interaction_facts SET acknowledged=1 WHERE id=?'); for (const id of new Set(ids))
            acknowledge.run(id); });
    }
    snapshotRow() {
        const inventory = this.catalogRows().map(item => { const quantity = this.quantity(item.id), reserved = this.reserved(item.id); return { itemId: item.id, quantity, reserved, available: quantity - reserved }; });
        return { storageId: this.options.storageId, companionId: this.options.companionId, revision: this.revision(), balance: this.balance(), inventory,
            catalog: this.catalogRows(), configuration: this.configuration(), bookmarks: this.allBookmarks(), pendingUses: this.allUses().filter(row => row.status === 'reserved'), migration: this.requiredMeta('migration') };
    }
    snapshot(_now = Date.now()) {
        this.ensure();
        const snapshot = this.snapshotRow();
        const catalogKeys = snapshot.catalog.map(item => item.id).filter(isWritableCatalogKey);
        // 保留旧配置中已经能编辑的键。这里只补读取视图，SQLite 的请求回执仍使用 snapshotRow()。
        const writableKeys = {
            itemPrices: [...new Set([...catalogKeys, ...Object.keys(snapshot.configuration.itemPrices)])],
            catalogEnabled: [...new Set([...catalogKeys, ...Object.keys(snapshot.configuration.catalogEnabled)])],
        };
        return { ...snapshot, writableKeys };
    }
    catalog() { this.ensure(); return this.catalogRows(); }
    ledger(input = {}) {
        this.ensure();
        const limit = input.limit ?? 50;
        integer(limit, 'ledger page size', 1, 200);
        if (input.before !== undefined)
            integer(input.before, 'ledger cursor', 1);
        const rows = this.db.prepare('SELECT * FROM ledger WHERE sequence<? ORDER BY sequence DESC LIMIT ?').all(input.before ?? Number.MAX_SAFE_INTEGER, limit + 1);
        const entries = rows.slice(0, limit).map(row => ({ sequence: Number(row.sequence), id: String(row.id), requestId: String(row.request_id), kind: String(row.kind), at: Number(row.at), moneyDelta: Number(row.money_delta), balance: Number(row.balance), itemDeltas: json(row.item_deltas), note: String(row.note) }));
        return { items: entries, nextBefore: rows.length > limit ? entries.at(-1).sequence : null };
    }
    purchase(requestId, itemId, quantity = 1, actor) {
        integer(quantity, 'purchase quantity', 1);
        return this.mutate(requestId, 'purchase', { itemId, quantity }, () => {
            const item = this.item(itemId);
            if (!item.enabled || item.purchasePrice === null)
                reject('INELIGIBLE', 'Item is not for sale');
            if (item.kind === 'reading' && (quantity !== 1 || this.quantity(itemId) !== 0))
                reject('CONFLICT', 'Reading ownership is permanent and can be purchased only once');
            const cost = safeProduct(item.purchasePrice, quantity);
            if (this.balance() < cost)
                reject('INELIGIBLE', 'Insufficient money');
            const before = { balance: this.balance(), [`inventory:${itemId}`]: this.quantity(itemId) };
            this.setMeta('balance', this.balance() - cost);
            this.setQuantity(itemId, safeSum(this.quantity(itemId), quantity));
            this.bump();
            this.recordLedger(requestId, 'purchase', -cost, { [itemId]: quantity }, `Purchased ${item.name}`);
            this.recordFact(requestId, 'purchase', actor, `主人为你购买了${quantity}份${item.name}，花费${cost}金币，物品已到账。`, before, { balance: this.balance(), [`inventory:${itemId}`]: this.quantity(itemId) });
            return this.snapshotRow();
        });
    }
    sell(requestId, itemId, quantity = 1, actor) {
        integer(quantity, 'sale quantity', 1);
        return this.mutate(requestId, 'sell', { itemId, quantity }, () => {
            const item = this.item(itemId);
            if (item.kind === 'reading' || !item.enabled || item.sellPrice === null)
                reject('INELIGIBLE', 'Item cannot be sold');
            if (this.available(itemId) < quantity)
                reject('INELIGIBLE', 'Insufficient available inventory');
            const before = { balance: this.balance(), [`inventory:${itemId}`]: this.quantity(itemId) };
            const income = safeProduct(item.sellPrice, quantity);
            this.setMeta('balance', safeSum(this.balance(), income));
            this.setQuantity(itemId, this.quantity(itemId) - quantity);
            this.bump();
            this.recordLedger(requestId, 'sale', income, { [itemId]: -quantity }, `Sold ${item.name}`);
            this.recordFact(requestId, 'sale', actor, `主人售出了${quantity}份${item.name}，${income}金币已到账。`, before, { balance: this.balance(), [`inventory:${itemId}`]: this.quantity(itemId) });
            return this.snapshotRow();
        });
    }
    grantMoney(requestId, amount, note = 'Owner money grant', actor) {
        integer(amount, 'grant amount', 1);
        text(note, 'grant note', 2000);
        return this.mutate(requestId, 'grant-money', { amount, note }, () => {
            const before = { balance: this.balance() };
            this.setMeta('balance', safeSum(this.balance(), amount));
            this.bump();
            this.recordLedger(requestId, 'owner-grant', amount, {}, note);
            this.recordFact(requestId, 'money-grant', actor, `主人刚送给你${amount}金币，已到账，当前余额${this.balance()}金币。`, before, { balance: this.balance() });
            return this.snapshotRow();
        });
    }
    giftItem(requestId, itemId, quantity = 1, note = 'Owner item gift', actor) {
        integer(quantity, 'gift quantity', 1);
        text(note, 'gift note', 2000);
        return this.mutate(requestId, 'gift-item', { itemId, quantity, note }, () => {
            const item = this.item(itemId);
            if (item.kind === 'reading' && (quantity !== 1 || this.quantity(itemId) !== 0))
                reject('CONFLICT', 'Reading ownership is permanent and cannot be duplicated');
            const before = { [`inventory:${itemId}`]: this.quantity(itemId) };
            this.setQuantity(itemId, safeSum(this.quantity(itemId), quantity));
            this.bump();
            this.recordLedger(requestId, 'owner-gift', 0, { [itemId]: quantity }, note);
            this.recordFact(requestId, 'item-gift', actor, `主人刚送给你${quantity}份${item.name}，物品已到账。`, before, { [`inventory:${itemId}`]: this.quantity(itemId) });
            return this.snapshotRow();
        });
    }
    configure(requestId, patch, expectedVersion, clock = runningClock) {
        canonical(patch);
        if (expectedVersion !== undefined)
            integer(expectedVersion, 'expected configuration revision', 1);
        return this.mutate(requestId, 'configure', { patch, ...(expectedVersion === undefined ? {} : { expectedVersion }) }, () => {
            check(patch && typeof patch === 'object' && !Array.isArray(patch), 'Invalid economy configuration');
            const config = this.configuration();
            if (expectedVersion !== undefined && expectedVersion !== config.revision)
                reject('STALE_REVISION', 'Economy configuration changed; refresh before saving');
            const integral = ['articlePrice', 'bookPrice', 'improvedMealPrice', 'compostCost'];
            const decimal = ['waterDurationFactor', 'fertilizerGrowth'];
            for (const key of Object.keys(patch))
                check([...integral, ...decimal, 'crops', 'itemPrices', 'catalogEnabled', 'foodEffects'].includes(key), 'Unknown economy setting');
            for (const key of integral)
                if (patch[key] !== undefined) {
                    integer(patch[key], key);
                    config[key] = patch[key];
                }
            for (const key of decimal)
                if (patch[key] !== undefined) {
                    check(typeof patch[key] === 'number' && Number.isFinite(patch[key]) && patch[key] > 0 && patch[key] <= 100, `Invalid ${key}`);
                    config[key] = patch[key];
                }
            if (patch.crops !== undefined) {
                check(patch.crops && typeof patch.crops === 'object' && !Array.isArray(patch.crops), 'Invalid crop settings');
                for (const [cropId, change] of Object.entries(patch.crops)) {
                    check(Object.hasOwn(config.crops, cropId), 'Unknown crop');
                    check(change && typeof change === 'object' && !Array.isArray(change), 'Invalid crop settings');
                    for (const [key, value] of Object.entries(change)) {
                        check(['growMs', 'seedCost'].includes(key), 'Unknown crop setting');
                        integer(value, key, key === 'growMs' ? 1 : 0);
                        config.crops[cropId][key] = value;
                    }
                }
            }
            if (patch.itemPrices !== undefined) {
                check(patch.itemPrices && typeof patch.itemPrices === 'object' && !Array.isArray(patch.itemPrices), 'Invalid item prices');
                for (const [itemId, prices] of Object.entries(patch.itemPrices)) {
                    const item = this.item(itemId);
                    check(item.kind !== 'harvest', 'Crop buyback prices are game-owned');
                    check(prices && typeof prices === 'object' && !Array.isArray(prices), 'Invalid item prices');
                    // Garden commodities share crop/rule prices, so either route changes
                    // the same authority rather than allowing arbitrage via a second UI.
                    for (const key of Object.keys(prices))
                        check(['purchasePrice', 'sellPrice'].includes(key), 'Unknown price field');
                    for (const key of ['purchasePrice', 'sellPrice'])
                        if (prices[key] !== null)
                            integer(prices[key], key);
                    if (item.kind === 'seed') {
                        check(prices.purchasePrice !== null && prices.sellPrice === null, 'Seeds require a purchase price only');
                        config.crops[item.cropId].seedCost = prices.purchasePrice;
                    }
                    else if (item.kind === 'compost') {
                        check(prices.purchasePrice !== null && prices.sellPrice === null, 'Compost requires a purchase price only');
                        config.compostCost = prices.purchasePrice;
                    }
                    else {
                        check(prices.sellPrice === null, 'Shop customization cannot create resale prices');
                        config.itemPrices[itemId] = prices;
                    }
                }
            }
            if (patch.catalogEnabled !== undefined) {
                check(patch.catalogEnabled && typeof patch.catalogEnabled === 'object' && !Array.isArray(patch.catalogEnabled), 'Invalid catalog switches');
                for (const [itemId, enabled] of Object.entries(patch.catalogEnabled)) {
                    check(this.item(itemId).kind !== 'harvest', 'Only shop products have owner-editable availability');
                    check(typeof enabled === 'boolean', 'Catalog enabled must be a boolean');
                    config.catalogEnabled[itemId] = enabled;
                }
            }
            if (patch.foodEffects !== undefined) {
                check(patch.foodEffects && typeof patch.foodEffects === 'object' && !Array.isArray(patch.foodEffects), 'Invalid food effects');
                for (const [itemId, effects] of Object.entries(patch.foodEffects)) {
                    check(this.item(itemId).kind === 'food', 'Effects require a food item');
                    check(effects && typeof effects === 'object' && !Array.isArray(effects), 'Invalid food effect');
                    for (const [need, delta] of Object.entries(effects)) {
                        check(isBodyMetric(need), 'Unknown body need');
                        check(typeof delta === 'number' && Number.isFinite(delta) && delta >= -1 && delta <= 1, 'Body need delta must be between -1 and 1');
                    }
                    config.foodEffects[itemId] = effects;
                }
            }
            // Settle old growth using old rules before changing the rates.
            this.saveGardenRow(this.readGarden(Date.now(), clock));
            config.revision = safeSum(config.revision, 1);
            this.setMeta('configuration', config);
            this.bump();
            this.recordLedger(requestId, 'owner-configure', 0, {}, 'Owner updated economy configuration');
            return this.snapshotRow();
        });
    }
    importBook(requestId, input, actor) {
        token(input.itemId, 'reading item id');
        check(/^reading:[a-zA-Z0-9:_-]+$/.test(input.itemId), 'Reading id must use the reading: namespace');
        text(input.title, 'reading title', 200);
        text(input.text, 'reading content', 1_000_000);
        if (input.author !== undefined)
            text(input.author, 'reading author/source', 200);
        check(input.title.trim().length > 0 && input.text.trim().length > 0, 'Reading title and actual content must not be blank');
        check(input.format === undefined || input.format === 'article' || input.format === 'book', 'Invalid reading format');
        if (input.source !== undefined) {
            check(input.source.kind === 'owner-import', 'Imported source must be owner-import');
            text(input.source.name, 'reading source name', 200);
        }
        check(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.text), 'Reading content must be plain text');
        return this.mutate(requestId, 'import-reading', input, () => {
            check(!ORIGINAL_READINGS.some(row => row.itemId === input.itemId), 'Original catalog content cannot be replaced');
            const content = { itemId: input.itemId, title: input.title, text: input.text, version: digest(input.text), format: input.format ?? 'article', source: input.source ?? { kind: 'owner-import', name: input.author ?? '主人导入的纯文本' } };
            this.putReading(content);
            this.bump();
            this.recordLedger(requestId, 'owner-import-reading', 0, {}, `Imported ${input.title}`);
            this.recordFact(requestId, 'reading-import', actor, `主人已将《${input.title}》的实际内容放入读物目录，尚未表示你拥有或读过它。`, {}, {});
            return this.snapshotRow();
        });
    }
    ownedReading(itemId) {
        token(itemId, 'reading item id');
        if (this.quantity(itemId) < 1)
            reject('INELIGIBLE', 'Purchase or receive this reading before opening it');
        const row = this.db.prepare('SELECT value FROM readings WHERE id=?').get(itemId);
        return row ? json(row.value) : reject('NOT_FOUND', 'Reading text is unavailable');
    }
    readSegment(itemId, input = {}) {
        this.ensure();
        const reading = this.ownedReading(itemId), size = input.maxCharacters ?? 1200;
        integer(size, 'reading segment size', 100, 4000);
        const segment = input.segment ?? 0;
        integer(segment, 'reading segment');
        const totalSegments = Math.max(1, Math.ceil(reading.text.length / size));
        check(segment < totalSegments, 'Reading segment does not exist');
        const startOffset = segment * size, endOffset = Math.min(startOffset + size, reading.text.length);
        return { itemId, title: reading.title, version: reading.version, segment, totalSegments, text: reading.text.slice(startOffset, endOffset), startOffset, endOffset, nextSegment: segment + 1 < totalSegments ? segment + 1 : null, source: reading.source, bookmark: this.allBookmarks().find(row => row.itemId === itemId && row.version === reading.version) ?? null };
    }
    putBookmark(bookmark) {
        const { itemId, version } = bookmark;
        const saved = this.db.prepare('INSERT INTO bookmarks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value WHERE value<>excluded.value')
            .run(`${itemId}:${version}`, canonical(bookmark));
        if (this.options.walletChanged && saved.changes && this.readingVersion(itemId) === version)
            this.walletDirty = true;
    }
    readingOperation(operationId) {
        const row = this.db.prepare('SELECT value FROM reading_operations WHERE id=?').get(operationId);
        return row ? json(row.value) : undefined;
    }
    /** Offers and confirmations are durable actual content-delivery receipts;
     * room movement or an animation never advances a reading bookmark. */
    readOffer(operationId, input) {
        token(operationId, 'reading operation');
        token(input.itemId, 'reading item');
        integer(input.segment, 'reading segment');
        return this.transaction(() => {
            const previous = this.readingOperation(operationId);
            if (previous) {
                if (canonical(previous.input) !== canonical(input))
                    reject('CONFLICT', 'Reading operation ID reused with different content');
                return previous.offer;
            }
            const offer = { ...this.readSegment(input.itemId, { segment: input.segment }), receiptToken: `read_${randomUUID()}` };
            this.db.prepare('INSERT INTO reading_operations VALUES(?,?)').run(operationId, canonical({ input, offer, status: 'offered' }));
            this.bump();
            return offer;
        });
    }
    confirmReading(operationId, receiptToken) {
        token(operationId, 'reading operation');
        token(receiptToken, 'reading receipt token');
        return this.transaction(() => {
            const row = this.readingOperation(operationId);
            if (!row)
                reject('NOT_FOUND', 'Reading content was not offered');
            if (row.offer.receiptToken !== receiptToken)
                reject('CONFLICT', 'Reading receipt token does not match the offered content');
            if (row.status !== 'confirmed') {
                // Preserve the original version's position even if an owner has since
                // replaced the content. It cannot move the replacement's bookmark.
                const key = `${row.offer.itemId}:${row.offer.version}`;
                const old = this.db.prepare('SELECT value FROM bookmarks WHERE id=?').get(key);
                const offset = Math.max(old ? json(old.value).offset : 0, row.offer.endOffset);
                const bookmark = { itemId: row.offer.itemId, version: row.offer.version, offset, updatedAt: Date.now() };
                this.putBookmark(bookmark);
                row.status = 'confirmed';
                this.db.prepare('UPDATE reading_operations SET value=? WHERE id=?').run(canonical(row), operationId);
                this.bump();
            }
            return { status: 'confirmed', ...row.input };
        });
    }
    readingStatus(operationId, input) {
        this.ensure();
        token(operationId, 'reading operation');
        token(input.itemId, 'reading item');
        integer(input.segment, 'reading segment');
        const row = this.readingOperation(operationId);
        if (!row)
            return { status: 'unread', ...input };
        if (canonical(row.input) !== canonical(input))
            reject('CONFLICT', 'Reading operation ID reused with different content');
        return { status: row.status, ...row.input };
    }
    beginUse(requestId, itemId) {
        return this.mutate(requestId, 'begin-use', { itemId }, () => {
            const item = this.item(itemId);
            if (item.kind !== 'food' || item.bodyAction !== 'feed')
                reject('INELIGIBLE', 'This item has no consumable body effect');
            if (this.available(itemId) < 1)
                reject('INELIGIBLE', 'No available food item');
            const now = Date.now();
            const use = { opId: requestId, requestId, itemId, quantity: 1, status: 'reserved', createdAt: now, updatedAt: now, effects: clone(item.effects ?? {}) };
            this.walletDirty = true;
            this.db.prepare('INSERT INTO uses VALUES(?,?)').run(use.opId, canonical(use));
            this.bump();
            this.recordLedger(requestId, 'use-reserve', 0, {}, `Reserved ${item.name} for its body operation`);
            return use;
        });
    }
    finishUseInternal(opId, proof, applied) {
        token(opId, 'item use operation');
        token(proof.operationId, 'body operation');
        token(proof.bodyReceiptId, 'body receipt');
        check(proof.operationId === opId && proof.applied === applied, 'Body proof does not match the item use');
        return this.transaction(() => {
            const row = this.db.prepare('SELECT value FROM uses WHERE id=?').get(opId);
            if (!row)
                reject('NOT_FOUND', 'Item use does not exist');
            const use = json(row.value);
            const next = applied ? 'consumed' : 'cancelled';
            if (use.status !== 'reserved') {
                check(use.status === next && use.bodyReceiptId === proof.bodyReceiptId, 'Item use already resolved with a different body proof');
                return use;
            }
            if (applied) {
                check(this.quantity(use.itemId) >= 1, 'Reserved food item is missing');
                this.setQuantity(use.itemId, this.quantity(use.itemId) - 1);
            }
            use.status = next;
            use.updatedAt = Date.now();
            use.bodyReceiptId = proof.bodyReceiptId;
            this.db.prepare('UPDATE uses SET value=? WHERE id=?').run(canonical(use), opId);
            this.bump();
            this.walletDirty = true;
            this.recordLedger(use.requestId, applied ? 'use-consume' : 'use-cancel', 0, applied ? { [use.itemId]: -1 } : {}, applied ? 'Body effect receipt verified; reserved food consumed' : 'Body receipt proves no effect; reservation released');
            return use;
        });
    }
    finishUse(opId, bodyAppliedProof) { return this.finishUseInternal(opId, bodyAppliedProof, true); }
    /** Unknown or absent Body outcome is intentionally not a cancellation proof. */
    cancelUse(opId, bodyNotAppliedProof) { return this.finishUseInternal(opId, bodyNotAppliedProof, false); }
    itemUse(opId) { this.ensure(); const row = this.db.prepare('SELECT value FROM uses WHERE id=?').get(opId); return row ? json(row.value) : undefined; }
    gardenOptions() { const config = this.configuration(); return { crops: cropRows.map(row => ({ ...row, ...config.crops[row.id] })), rules: { ...GARDEN_RULES, compostCost: config.compostCost, waterDurationFactor: config.waterDurationFactor, fertilizerGrowth: config.fertilizerGrowth, fertilizerYield: config.fertilizerYield, catalogEnabled: config.catalogEnabled } }; }
    normalize(state, now) { return normalizeGarden(state, now, this.gardenOptions()); }
    advance(state, now) { return advanceGarden(state, now, this.gardenOptions()); }
    gardenResources(state) {
        return Object.fromEntries([['$money', state.coins], ['compost', state.compost], ...cropRows.flatMap(crop => [[`seed:${crop.id}`, state.seeds[crop.id]], [`harvest:${crop.id}`, state.inventory[crop.id]]])]);
    }
    validateGardenResources(raw) {
        check(raw && typeof raw === 'object' && !Array.isArray(raw), 'Invalid garden aggregate');
        const state = raw;
        if (state.version !== undefined) {
            integer(state.version, 'garden version', 1);
            check(state.version <= GARDEN_RULES.version, 'Garden save requires a newer application');
        }
        integer(state.coins === undefined ? 0 : state.coins, 'garden money');
        integer(state.compost === undefined ? 0 : state.compost, 'garden compost');
        const cropIds = new Set(cropRows.map(crop => crop.id));
        for (const key of ['seeds', 'inventory'])
            if (state[key] !== undefined) {
                check(state[key] && typeof state[key] === 'object' && !Array.isArray(state[key]), `Invalid garden ${key}`);
                for (const [cropId, quantity] of Object.entries(state[key])) {
                    integer(quantity, `garden ${key} quantity`);
                    check(cropIds.has(cropId) || quantity === 0, `Unknown stocked garden crop ${cropId}; retain and inspect the original save`);
                }
            }
        if (state.plots !== undefined) {
            check(Array.isArray(state.plots), 'Invalid garden plots');
            const plantedIds = new Set();
            for (const plot of state.plots) {
                check(plot && typeof plot === 'object' && !Array.isArray(plot), 'Invalid garden plot');
                if (plot.cropId === null || plot.cropId === undefined)
                    continue;
                check(cropIds.has(plot.cropId), 'Unknown planted crop; retain and inspect the original save');
                integer(plot.id, 'planted plot id', 0, 7);
                check(!plantedIds.has(plot.id), 'Duplicate planted plot; retain and inspect the original save');
                plantedIds.add(plot.id);
                check(state.plots.find((candidate) => candidate?.id === plot.id) === plot, 'A planted duplicate plot would be discarded; retain and inspect the original save');
            }
        }
    }
    resourceDeltas(before, after) { return Object.fromEntries(Object.entries(after).filter(([key, value]) => key !== '$money' && value !== (before[key] ?? 0)).map(([key, value]) => [key, value - (before[key] ?? 0)])); }
    importGardenItems(state) { for (const [itemId, quantity] of Object.entries(this.gardenResources(state)))
        if (itemId !== '$money')
            this.setQuantity(itemId, quantity); }
    archiveReceipts(receipts) {
        for (const receipt of receipts) {
            if (typeof receipt?.requestId !== 'string' || !receipt.requestId)
                continue;
            const previous = this.db.prepare('SELECT value FROM garden_receipts WHERE request_id=?').get(receipt.requestId);
            if (previous) {
                const old = json(previous.value);
                check(old.fingerprint === receipt.fingerprint && old.jobId === receipt.jobId, 'Garden request ID reused for another operation');
                if (terminal.has(old.status)) {
                    check(old.status === receipt.status, 'A completed garden receipt cannot be reopened');
                    continue;
                }
            }
            this.db.prepare('INSERT INTO garden_receipts VALUES(?,?) ON CONFLICT(request_id) DO UPDATE SET value=excluded.value').run(receipt.requestId, canonical(receipt));
        }
    }
    saveGardenRow(state) {
        // The unbounded request archive is stored as rows, never in one capped JSON
        // field. Loading reconstructs the existing pure caretaker's receipt view.
        this.archiveReceipts(state.care?.receipts ?? []);
        const raw = clone({ ...state, care: { ...state.care, receipts: [] } });
        delete raw.economyRevision;
        delete raw.economyConfig;
        this.setMeta('garden', raw);
    }
    projectGarden() {
        const state = this.requiredMeta('garden');
        state.coins = this.balance();
        state.compost = this.quantity('compost');
        for (const crop of cropRows) {
            state.seeds[crop.id] = this.quantity(`seed:${crop.id}`);
            state.inventory[crop.id] = this.quantity(`harvest:${crop.id}`);
        }
        state.care.receipts = this.db.prepare('SELECT value FROM garden_receipts ORDER BY rowid').all().map(row => json(row.value));
        state.economyRevision = this.revision();
        state.economyConfig = this.gardenOptions();
        return state;
    }
    committedGardenAt() {
        this.ensure();
        return atTime(this.projectGarden().updatedAt);
    }
    /** Natural growth is projected without spending or committing another wallet.
     * The returned revision is the CAS token for the caretaker's next checkpoint. */
    readGarden(now = Date.now(), clock = runningClock) {
        this.ensure();
        atTime(now);
        check(typeof clock.enabled === 'boolean', 'Invalid garden clock admission');
        const raw = this.projectGarden();
        const state = advanceGardenClock(raw, now, clock, (garden, at) => this.advance(garden, at));
        state.economyRevision = raw.economyRevision;
        state.economyConfig = raw.economyConfig;
        state.care.receipts = raw.care.receipts;
        return state;
    }
    commitGarden(state, expectedRevision, requestId, kind, now) {
        integer(expectedRevision, 'garden expected revision', 1);
        if (expectedRevision !== this.revision())
            reject('STALE_REVISION', 'Garden snapshot is stale; reload it before committing');
        this.validateGardenResources(state);
        const previous = this.projectGarden(), before = this.gardenResources(previous), normalized = this.normalize(state, now), after = this.gardenResources(normalized);
        check(normalized.updatedAt >= previous.updatedAt, 'Garden checkpoint would rewind its clock');
        for (const plot of normalized.plots) {
            const old = previous.plots.find((row) => row.id === plot.id);
            if (plot.cropId && old?.cropId === plot.cropId && old.plantedAt === plot.plantedAt)
                check(plot.progress >= old.progress, 'Garden checkpoint would rewind an existing crop');
        }
        // Legacy normalization must never round/clamp money or inventory.
        check(canonical(after) === canonical(this.gardenResources(state)), 'Garden normalization changed money or inventory');
        for (const [itemId, quantity] of Object.entries(after)) {
            integer(quantity, 'garden resource');
            if (itemId !== '$money')
                check(quantity >= this.reserved(itemId), 'Garden attempted to spend reserved inventory');
        }
        this.setMeta('balance', after.$money);
        this.importGardenItems(normalized);
        this.saveGardenRow(normalized);
        this.bump();
        const moneyDelta = after.$money - before.$money, deltas = this.resourceDeltas(before, after);
        const changed = moneyDelta !== 0 || Object.keys(deltas).length !== 0;
        if (changed)
            this.recordLedger(requestId, kind, moneyDelta, deltas, 'Garden resource change and care receipt committed together', now);
        return this.projectGarden();
    }
    writeGarden(state, expectedRevision = state?.economyRevision) {
        const now = atTime(state?.updatedAt ?? Date.now());
        return this.transaction(() => this.commitGarden(state, expectedRevision, `garden-checkpoint:${randomUUID()}`, 'garden', now));
    }
    applyGarden(action, requestId, now = Date.now(), clock = runningClock) {
        atTime(now);
        const result = this.mutate(requestId, 'garden-action', action, () => {
            const current = this.readGarden(now, clock), result = applyGardenAction(current, action, now, this.gardenOptions());
            if (!result.ok)
                return { ok: false, message: result.message };
            this.commitGarden(result.state, current.economyRevision, requestId, 'garden-action', now);
            return { ok: true, message: result.message };
        });
        return { ...result, garden: this.gardenView(now, clock) };
    }
    gardenView(now = Date.now(), clock = runningClock) { return gardenView(this.readGarden(now, clock), now, this.gardenOptions()); }
    close() { if (this.closed)
        return; this.closed = true; closeSqliteLease(this.db, this.lockPath, this.lockToken); }
}
//# sourceMappingURL=store.js.map