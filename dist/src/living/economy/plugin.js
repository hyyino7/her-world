import { fail, object, requiredText } from '../../core/tables/console.js';
import { economyOverview, economyPage } from './tool-context.js';
import { InFlight, LivingView, mountLivingArea, settleCleanup, withLivingCaller } from '../index.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bytesDigest, canonical, check, digest, integer, reject, Rejection, unavailable } from '../../core/storage.js';
import { unknownEffect } from '../../contracts/common.js';
import { registerWorldContext } from '../../core/native/prompt.js';
import { OWNER_LIFE_TOOL_SOURCES } from '../../core/native/conversation.js';
import { isHistoryObject } from '../../core/native/history-maintenance.js';
import { CONTRACT_VERSION } from '../../contracts/version.js';
import { EconomyStore, projectWallet } from './store.js';
import { consoleFoodOperationId, legacyWalletDigest, normalizeWalletRequest, walletActionReceipt } from './console-requests.js';
import { installEconomyAccessGuard } from './access.js';
import { readLifeControl } from '../plan/control-file.js';
import { bodyCheckpointDirectory, ECONOMY_ADOPTION_FILE, economyAdoptionPath, economyFile, inspectEconomyAdoption } from './adoption.js';
const inventoryFiles = ['data/economy/', 'data/economy/economy.sqlite', 'data/economy/storage.json', ECONOMY_ADOPTION_FILE];
const access = { mode: 'bounded', detail: '余额与物品由程序结算。原生文件工具防误改；同一系统账户的命令和其他插件仍可访问文件。' };
export const economyStateToolDeclaration = {
    name: 'pet_economy_state', sources: OWNER_LIFE_TOOL_SOURCES,
    historyOverview(_args, value) {
        if (isHistoryObject(value) && isHistoryObject(value.configuration) && Array.isArray(value.inventory)
            && Array.isArray(value.ledger) && Array.isArray(value.catalog))
            return economyOverview(value);
    },
};
/** One synchronous ledger per active Core binding. Body owns effect receipts;
 * this service owns money/items and never creates another assistant runtime. */
export class CompanionEconomy {
    ctx;
    host;
    current;
    preparationFailure;
    closed = false;
    living;
    inFlight = new InFlight();
    walletInFlight = new Set();
    constructor(ctx, host, ports = {}) {
        this.ctx = ctx;
        this.host = host;
        this.living = ports instanceof LivingView ? ports : new LivingView(ports);
    }
    assertOpen() { check(!this.closed && this.living.isCurrent(), 'Economy is stopped'); }
    protectedDirectory() {
        const status = this.host.workspace.status();
        return status.target ? join(status.target.path, '.chatpet', 'data', 'economy') : undefined;
    }
    initializationFiles(target) {
        const root = join(target.path, '.chatpet'), data = join(root, 'data');
        try {
            if ([root, data, join(data, 'economy'), join(data, 'living')].every(path => lstatSync(path, { throwIfNoEntry: false })?.isDirectory())
                && inventoryFiles.slice(1).every(path => economyFile(join(root, path))))
                return inventoryFiles;
        }
        catch { /* Wallet admission reports invalid wallet files. */ }
        return [];
    }
    retainedGarden(target, file) {
        const sourcePath = join(bodyCheckpointDirectory(target.path), 'garden.json');
        if (file)
            check(resolve(file) === sourcePath, 'Garden authority path does not match the current Body owner');
        const old = economyFile(sourcePath);
        if (!old)
            return;
        check(old.size <= 32 * 1024 * 1024, 'Retained garden file is too large');
        const bytes = readFileSync(sourcePath);
        return { state: JSON.parse(bytes.toString('utf8')), sourcePath, sourceHash: bytesDigest(bytes) };
    }
    /** Initialization is schema preparation only: no allowance, gifts or goals. */
    prepare(target, legacyFile, initializing = false) {
        this.assertOpen();
        const status = this.host.workspace.status();
        check(status.state !== 'migration-required', 'migration-required');
        check(initializing || status.state === 'ready' && status.target?.id === target.id && status.target.path === target.path, 'Economy requires the current bound workspace');
        const storageId = this.host.workspace.storageId(), companionId = this.host.workspace.runtime.config.companionId;
        const key = canonical({ path: target.path, storageId, companionId });
        const scope = this.host.workspace.homeScope?.();
        this.preparationFailure = undefined;
        if (this.current?.key === key) {
            this.current.store.validate(initializing);
            this.current.binding.target = target;
            this.current.binding.scope = scope;
            return this.current.store;
        }
        this.current?.store.close();
        this.current = undefined;
        const metadata = this.host.workspace.runtime.store;
        const binding = { target, scope };
        try {
            const store = new EconomyStore({ workspacePath: target.path, storageId, companionId,
                loadLegacyGarden: () => this.retainedGarden(target, legacyFile),
                walletChanged: () => {
                    if (binding.scope)
                        this.living.changed(binding.scope);
                },
                factsCommitted: () => {
                    if (binding.scope)
                        this.notifyFacts(binding.scope);
                },
                guard: () => {
                    this.assertOpen();
                    check(this.host.workspace.status().state !== 'migration-required', 'migration-required');
                    check(metadata.persisted(), 'Core database is absent or moved');
                    check(this.host.workspace.storageId() === storageId, 'Economy binding changed');
                } });
            this.current = { key, binding, store };
            return store;
        }
        catch (error) {
            this.preparationFailure = { key, error };
            throw error;
        }
    }
    capabilityStatus() {
        const { state, target } = this.host.workspace.status();
        if (!target || state === 'migration-required')
            return { state: 'unavailable', reason: null, supportedOperations: [] };
        try {
            const storageId = this.host.workspace.storageId(), companionId = this.host.workspace.runtime.config.companionId;
            const key = canonical({ path: target.path, storageId, companionId });
            if (state === 'ready' && this.current?.key === key) {
                this.current.store.validate();
                return { state: 'ready', reason: null, supportedOperations: ['snapshot', 'ownerAction', 'settings'] };
            }
            const evidence = inspectEconomyAdoption(target.path, { storageId, companionId });
            if (evidence.database && this.preparationFailure?.key === key)
                throw this.preparationFailure.error;
            return { state: 'initializing', reason: null, supportedOperations: [] };
        }
        catch (error) {
            return { state: 'unavailable', reason: error instanceof Rejection ? error.message : 'Economy storage could not be verified',
                supportedOperations: [] };
        }
    }
    bound(workspaceId) {
        this.assertOpen();
        const status = this.host.workspace.status();
        check(status.state === 'ready' && status.target?.id === workspaceId, 'Economy requires the current bound workspace');
        return this.prepare(status.target);
    }
    use(store, row) {
        const item = store.catalog().find(item => item.id === row.itemId);
        const saved = row;
        return { ...row, effects: saved.effects ?? item?.effects ?? {}, label: saved.label ?? item?.name ?? row.itemId, ...(item?.presentationSlot ? { presentationSlot: item.presentationSlot } : {}) };
    }
    gardenClock(workspaceId) {
        const live = this.living.get('plan')?.bodyClockState?.(workspaceId);
        if (live)
            return live;
        const status = this.host.workspace.status();
        if (status.state === 'ready' && status.target?.id === workspaceId) {
            const saved = readLifeControl(status.target.path);
            if (saved?.pauses !== undefined)
                return saved;
        }
        const enabled = this.living.get('body')?.gardenClockState?.(workspaceId);
        return enabled === undefined ? undefined : { enabled };
    }
    committedGardenAt(workspaceId) {
        const status = this.host.workspace.status(), current = this.current;
        if (!this.closed && this.living.isCurrent() && status.state === 'ready' && status.target?.id === workspaceId
            && current?.binding.target.id === workspaceId && current.binding.target.path === status.target.path)
            return current.store.committedGardenAt();
    }
    gardenPort(workspaceId, legacyFile, recordReadingEffect) {
        const store = this.bound(workspaceId);
        if (legacyFile) {
            const root = join(this.current.binding.target.path, '.chatpet', 'data');
            check([join(root, 'life', 'garden.json'), join(root, 'behavior', 'garden.json')].includes(resolve(legacyFile)), 'Garden authority path is outside the bound Body');
        }
        const checked = () => { check(this.bound(workspaceId) === store, 'Economy binding changed'); return store; };
        return {
            loadGarden: (now, clock) => checked().readGarden(now, clock ?? this.gardenClock(workspaceId)),
            saveGarden: (state, _now) => checked().writeGarden(state, state.economyRevision),
            actGarden: (input, now, clock) => checked().applyGarden(input, typeof input.requestId === 'string' ? input.requestId : `owner-garden:${randomUUID()}`, now, clock ?? this.gardenClock(workspaceId)),
            gardenRules: () => checked().readGarden().economyConfig,
            transaction: (operationId, input) => {
                const s = checked();
                // A deterministic refusal is an intent failure, not an unknown payment.
                try {
                    if (input.type === 'buy')
                        s.purchase(operationId, input.itemId, input.quantity);
                    else
                        s.sell(operationId, input.itemId, input.quantity);
                    return { status: 'completed' };
                }
                catch (error) {
                    const detail = error?.detail;
                    if (detail && ['INVALID_ARGUMENT', 'NOT_FOUND', 'INELIGIBLE', 'LIMIT_REACHED', 'CONFLICT', 'DISABLED'].includes(detail.code ?? ''))
                        return { status: 'failed', message: error.message };
                    throw error;
                }
            },
            preflightFood: itemId => {
                const s = checked(), item = s.catalog().find(row => row.id === itemId);
                check(item?.kind === 'food' && item.effects, 'The selected item is not usable food');
                check(s.snapshot().inventory.some(row => row.itemId === itemId && row.available >= 1), 'No available food remains in inventory');
            },
            consoleFoodPending: operationId => checked().consoleRequests.waitsForRetry(operationId),
            foodPresentation: itemId => { const item = checked().catalog().find(row => row.id === itemId); return item?.kind === 'food' ? item.presentationSlot : undefined; },
            reserveFood: (operationId, itemId) => this.use(checked(), checked().beginUse(operationId, itemId)),
            finishFood: (operationId, proof) => this.use(checked(), checked().finishUse(operationId, proof)),
            inspectUse: operationId => { const s = checked(), row = s.itemUse(operationId); return row && this.use(s, row); },
            // A missing Body result is never proof of no effect. Body supplies explicit
            // cancellation proof through its own no-effect receipt, not this shortcut.
            cancelUse: (operationId, proof) => { const s = checked(), row = s.itemUse(operationId); return row && this.use(s, s.cancelUse(operationId, proof)); },
            readSegment: (operationId, input) => checked().readOffer(operationId, input),
            confirmRead: (operationId, token) => {
                const current = checked();
                recordReadingEffect?.('unknown', operationId);
                try {
                    const receipt = current.confirmReading(operationId, token);
                    recordReadingEffect?.('partial');
                    return receipt;
                }
                catch (error) {
                    // The Store rejects missing offers and mismatched tokens before writing a bookmark.
                    if (error instanceof Rejection && (error.detail.code === 'NOT_FOUND' || error.detail.code === 'CONFLICT'))
                        recordReadingEffect?.('none');
                    throw error;
                }
            },
            readingStatus: (operationId, input) => checked().readingStatus(operationId, input),
        };
    }
    async snapshot(workspaceId, validate = () => { }, options = {}) {
        validate();
        const store = this.bound(workspaceId), { writableKeys, ...snapshot } = store.snapshot();
        validate();
        return { ...this.walletSnapshot(store, workspaceId, snapshot),
            ...(options.includeWritableKeys ? { writableKeys, recentRequests: store.consoleRequests.recentCommitted() } : {}) };
    }
    walletSnapshot(store, workspaceId, snapshot) {
        const { writableKeys: _keys, ...current } = snapshot ? { ...snapshot, writableKeys: undefined } : store.snapshot();
        return { ...current, workspaceId, ledger: store.ledger({ limit: 80 }).items,
            configurationVersion: String(current.configuration.revision), access };
    }
    walletView(workspaceId) { return projectWallet(this.bound(workspaceId).snapshot()); }
    worldSnapshot(workspaceId) { return this.living.worldSnapshot(this.host, workspaceId); }
    worldCommands = {
        buy: (input, options) => this.worldTrade('buy', input, options),
        sell: (input, options) => this.worldTrade('sell', input, options),
    };
    worldTrade(kind, { itemId, quantity, ...request }, options) {
        const signal = options?.signal ?? new AbortController().signal;
        return this.living.command(this.host, request, options, async ({ validate, effect }) => projectWallet(await this.ownerAction(request.workspaceId, { kind, itemId, quantity }, request.requestId, signal, validate, undefined, effect)));
    }
    async pendingFacts(workspaceId) { return this.bound(workspaceId).pendingFacts(); }
    async readFacts(workspaceId, ids) {
        const store = this.bound(workspaceId), facts = store.readFacts(ids);
        check(this.bound(workspaceId) === store, 'Economy binding changed');
        return facts;
    }
    async acknowledgeFacts(workspaceId, ids) {
        const store = this.bound(workspaceId);
        store.acknowledgeFacts(ids);
        check(this.bound(workspaceId) === store, 'Economy binding changed');
    }
    notifyFacts(scope) {
        // Publication is a hint. A committed fact remains available to Life after
        // listener failure, unload or restart; notification cannot undo settlement.
        try {
            const plan = this.living.lookup('plan');
            if (plan)
                plan.value.noticeDomainChange(scope, () => !this.closed && this.living.isCurrent() && plan.isCurrent());
        }
        catch (error) {
            try {
                this.ctx.logger('chatpet-economy').warn('Committed economic facts await delivery', error);
            }
            catch { }
        }
    }
    openWallet(workspaceId) {
        const status = this.host.workspace.status(), current = this.current;
        if (this.closed || !this.living.isCurrent() || status.state !== 'ready' || status.target?.id !== workspaceId
            || current?.binding.target.id !== workspaceId || current.binding.target.path !== status.target.path)
            unavailable('The bound wallet is not open');
        current.store.validate();
        return current.store;
    }
    walletEvidence(store, id, request) {
        const original = store.originalRequest(id);
        const legacy = legacyWalletDigest(id, request);
        if (legacy) {
            if (!original)
                return { state: 'no-evidence' };
            return original.digest === legacy ? { state: 'committed', savedSnapshot: String(original.result) } : { state: 'conflict' };
        }
        if (original || !('action' in request.input))
            return { state: 'conflict' };
        const body = this.living.lookup('body');
        if (!body?.isCurrent())
            unavailable('The original Body owner is not open');
        const operationId = consoleFoodOperationId(id), use = store.itemUse(operationId);
        let receipt;
        try {
            receipt = body.value.originalFood(this.current.binding.target.id, operationId);
        }
        catch {
            unavailable('The original Body checkpoint is not available');
        }
        if (use && !receipt || receipt?.applied && !use)
            unavailable('The original food settlement evidence is incomplete');
        const itemId = request.input.action.itemId;
        if (receipt && (receipt.operationId !== operationId || receipt.itemId !== itemId || receipt.requestId !== id
            || receipt.actor?.kind !== 'owner' || receipt.actor.id !== this.host.workspace.runtime.config.ownerActorId || receipt.actor.channel !== 'settings')
            || use && (use.opId !== operationId || use.itemId !== itemId || use.quantity !== 1
                || use.status !== 'reserved' && use.bodyReceiptId !== operationId))
            return { state: 'conflict' };
        if (receipt?.applied && receipt.settled && use?.status === 'consumed')
            return { state: 'committed', execution: receipt.execution };
        if (receipt?.declined && !receipt.applied && (!use || use.status === 'cancelled'))
            return { state: 'no-evidence', declined: true, execution: receipt.execution };
        return { state: receipt || use ? 'partial' : 'no-evidence' };
    }
    walletUnknown() {
        throw new Rejection(unknownEffect('OUTCOME_UNKNOWN', 'Check the original wallet request before retrying'));
    }
    async consoleWrite(endpoint, input, id, signal, validate) {
        validate();
        const request = normalizeWalletRequest(endpoint, input);
        const store = this.bound(request.input.workspaceId);
        let dispatch = false;
        validate();
        const original = store.withConsoleRequests(rows => {
            const prior = rows.get(id);
            if (prior && prior.fingerprint !== request.fingerprint)
                reject('CONFLICT', 'Wallet request ID reused with different input');
            if (prior?.state === 'abandoned')
                reject('CONFLICT', 'Wallet request was abandoned');
            if (this.walletInFlight.has(id))
                return this.walletUnknown();
            const evidence = this.walletEvidence(store, id, request);
            if (evidence.state === 'conflict')
                reject('CONFLICT', 'Wallet receipt belongs to different input');
            if (!prior && rows.pending().length)
                reject('CONFLICT', 'Resolve the pending wallet requests before starting another');
            if (!prior)
                rows.add(id, request);
            if (!prior || prior.state === 'pending')
                this.finishWallet(rows, id, request, evidence);
            dispatch = !prior && evidence.state === 'no-evidence' && !evidence.declined;
            return evidence;
        });
        if (dispatch)
            return this.dispatchWallet(store, request, id, signal, validate);
        if (original.state === 'committed' || original.declined) {
            const saved = original.savedSnapshot === undefined ? undefined : JSON.parse(original.savedSnapshot);
            return { ...this.walletSnapshot(store, request.input.workspaceId, saved), ...(original.execution ? { execution: original.execution } : {}) };
        }
        return this.walletUnknown();
    }
    async consoleRecover(endpoint, workspaceId, id, acceptNoEvidence, signal, validate) {
        validate();
        const store = this.openWallet(workspaceId);
        if (endpoint === 'economyPending')
            return store.consoleRequests.pending();
        const observe = () => {
            const row = store.consoleRequests.get(id);
            if (!row) {
                if (store.originalRequest(id) || store.itemUse(consoleFoodOperationId(id)))
                    unavailable('No registered fingerprint for this wallet request');
                return { state: 'no-evidence' };
            }
            if (!row.request)
                return { state: row.state === 'declined' ? 'no-evidence' : row.state === 'committed' ? 'committed' : 'abandoned' };
            return this.walletEvidence(store, id, row.request);
        };
        if (endpoint === 'economyCheck')
            return { state: observe().state };
        validate();
        const request = store.withConsoleRequests(rows => {
            if (this.walletInFlight.has(id))
                reject('CONFLICT', 'Wallet request is still running');
            const row = rows.get(id);
            if (!row)
                reject('NOT_FOUND', 'Original wallet request does not exist');
            const outcome = observe();
            if (!row.request)
                return { state: outcome.state };
            if (outcome.state === 'conflict')
                reject('CONFLICT', 'Wallet receipt belongs to different input');
            if (endpoint === 'economyAbandon') {
                if (outcome.state !== 'no-evidence' || !outcome.declined && !acceptNoEvidence)
                    reject('CONFLICT', 'Original wallet request cannot be abandoned');
                rows.finish(id, row.fingerprint, 'abandoned');
                return { state: 'abandoned' };
            }
            if (outcome.state === 'committed' || outcome.declined) {
                this.finishWallet(rows, id, row.request, outcome);
                return { state: outcome.state };
            }
            return row.request;
        });
        if ('state' in request)
            return request;
        await this.dispatchWallet(store, request, id, signal, validate, workspaceId);
        validate();
        return { state: observe().state };
    }
    consoleOperations() {
        const registeredScope = async (call, id) => {
            call.checkBinding(id, true);
            const binding = this.host.workspace.status(), registered = call.getWorkspaces()?.get(id);
            if (!registered || binding.target?.path !== registered.path)
                fail('STALE_BINDING');
            const validate = () => {
                call.validate();
                const current = this.host.workspace.status();
                if (call.getWorkspaces()?.get(id) !== registered || current.revision !== binding.revision
                    || current.sourceRevision !== binding.sourceRevision)
                    fail('STALE_BINDING');
            };
            const available = await registered.status();
            validate();
            if (available !== 'ok')
                fail('NOT_FOUND');
            return validate;
        };
        const recovery = (endpoint, keys) => async (call) => {
            const { workspaceId, requestId = '', acceptNoEvidence = false } = object(call.input, ['workspaceId', ...keys]);
            const id = requiredText(workspaceId, 200);
            if (typeof requestId !== 'string' || requestId.length > 160 || typeof acceptNoEvidence !== 'boolean')
                fail('INVALID_ARGUMENT');
            const validate = await registeredScope(call, id);
            validate();
            const value = await this.consoleRecover(endpoint, id, requestId, acceptNoEvidence, call.signal, validate);
            validate();
            return value;
        };
        return { operations: {
                economyPending: recovery('economyPending', []),
                economyCheck: recovery('economyCheck', ['requestId']),
                economyRetry: recovery('economyRetry', ['requestId']),
                economyAbandon: recovery('economyAbandon', ['requestId', 'acceptNoEvidence']),
                economyView: async (call) => {
                    const id = requiredText(object(call.input, ['workspaceId']).workspaceId, 200);
                    const validate = await registeredScope(call, id);
                    validate();
                    const value = await this.snapshot(id, validate, { includeWritableKeys: true });
                    validate();
                    return value;
                },
            } };
    }
    finishWallet(rows, id, request, evidence) {
        if (evidence.state === 'committed' || evidence.declined)
            rows.finish(id, request.fingerprint, evidence.declined ? 'declined' : 'committed');
    }
    dispatchWallet(store, request, id, signal, validate, workspaceId = request.input.workspaceId) {
        this.walletInFlight.add(id);
        return this.inFlight.run(async () => {
            const outcome = { effect: 'none' };
            const recordEffect = effect => { outcome.effect = effect; };
            try {
                const { input } = request;
                const value = 'action' in input ? await this.ownerAction(workspaceId, input.action, id, signal, validate, undefined, recordEffect)
                    : await this.settings(workspaceId, input.expectedVersion, input.next, id, signal, validate, recordEffect);
                validate();
                const evidence = this.walletEvidence(store, id, request);
                if (evidence.state === 'committed' || evidence.declined)
                    store.withConsoleRequests(rows => this.finishWallet(rows, id, request, evidence));
                return value;
            }
            catch (error) {
                if (outcome.effect !== 'none')
                    throw new Rejection(unknownEffect(signal.aborted ? 'CANCELLED' : 'OUTCOME_UNKNOWN', 'Check the original wallet request before retrying'));
                const atomic = !('action' in request.input) || request.input.action.kind !== 'feed';
                if (atomic && error instanceof Rejection && error.detail.effect === 'none'
                    && error.detail.retry !== 'same_request' && !signal.aborted) {
                    validate();
                    if (this.walletEvidence(store, id, request).state === 'no-evidence')
                        store.withConsoleRequests(rows => this.finishWallet(rows, id, request, { state: 'no-evidence', declined: true }));
                }
                throw error;
            }
            finally {
                this.walletInFlight.delete(id);
            }
        });
    }
    async ownerAction(workspaceId, action, requestId, signal, validate = () => { }, trustedActor, recordEffect) {
        const guard = () => { this.assertOpen(); signal.throwIfAborted(); validate(); };
        guard();
        const store = this.bound(workspaceId);
        check(action && typeof action === 'object' && !Array.isArray(action), 'Invalid economic action');
        const actor = trustedActor ?? { kind: 'owner', id: this.host.workspace.runtime.config.ownerActorId, channel: 'settings' };
        check(actor.kind === 'owner' && actor.id === this.host.workspace.runtime.config.ownerActorId, 'Economic owner actions require the trusted owner');
        const quantity = action.quantity ?? 1;
        const finish = async (execution) => {
            guard();
            check(this.bound(workspaceId) === store, 'Economy binding changed');
            const snapshot = await this.snapshot(workspaceId, guard);
            return { ...snapshot, ...(execution ? { execution } : {}) };
        };
        switch (walletActionReceipt(requestId, action).operation) {
            case 'grant-money':
                store.grantMoney(requestId, action.amount, typeof action.note === 'string' && action.note.trim() ? action.note : undefined, actor);
                break;
            case 'gift-item':
                store.giftItem(requestId, action.itemId, quantity, typeof action.note === 'string' && action.note.trim() ? action.note : undefined, actor);
                break;
            case 'purchase':
            case 'sell': {
                recordEffect?.('unknown');
                try {
                    if (action.kind === 'buy')
                        store.purchase(requestId, action.itemId, quantity, actor);
                    else
                        store.sell(requestId, action.itemId, quantity, actor);
                }
                catch (error) {
                    if (error instanceof Rejection)
                        recordEffect?.('none');
                    throw error;
                }
                break;
            }
            case 'import-reading': {
                const sourceName = action.source?.name;
                check(typeof sourceName === 'string' && sourceName.length > 0 && sourceName.length <= 200, 'Invalid reading source');
                store.importBook(requestId, { itemId: `reading:owner-${digest(requestId).slice(7, 39)}`, title: action.title, text: action.content, ...(action.format === undefined ? {} : { format: action.format }), source: { kind: 'owner-import', name: sourceName } }, actor);
                break;
            }
            case 'consume': {
                integer(quantity, 'food quantity', 1, 1);
                const body = this.living.lookup('body');
                check(body, 'The shared Body is unavailable');
                const admit = () => { guard(); check(body.isCurrent(), 'The shared Body changed'); };
                return this.inFlight.run(async () => {
                    const execution = await withLivingCaller(admit, () => body.value.consumeFood(workspaceId, { operationId: consoleFoodOperationId(requestId), itemId: action.itemId, interaction: { requestId, actor } }, guard));
                    recordEffect?.('partial');
                    admit();
                    return finish(execution);
                });
            }
            default: throw Error('Unknown economic action');
        }
        recordEffect?.('partial');
        return finish();
    }
    async settings(workspaceId, expectedVersion, next, requestId, signal, validate = () => { }, recordEffect) {
        signal.throwIfAborted();
        validate();
        const store = this.bound(workspaceId);
        const version = Number(expectedVersion);
        integer(version, 'configuration version', 1);
        // UI may send the complete edited configuration. Schema/revision are CAS
        // metadata rather than user-editable economic values.
        const { version: _schema, revision: _revision, ...patch } = next;
        // Serialize Body work first, then use saved clock intent. An unavailable
        // executor is not evidence that the owner paused natural crop time.
        const body = this.living.lookup('body');
        const admit = () => {
            this.assertOpen();
            signal.throwIfAborted();
            validate();
            if (body)
                check(body.isCurrent(), 'The shared Body changed');
        };
        return this.inFlight.run(async () => {
            if (body)
                await withLivingCaller(admit, () => body.value.snapshot(workspaceId));
            admit();
            check(this.bound(workspaceId) === store, 'Economy binding changed');
            store.configure(requestId, patch, version, this.gardenClock(workspaceId));
            recordEffect?.('partial');
            admit();
            return this.snapshot(workspaceId, validate);
        });
    }
    stopAdmission() { this.closed = true; }
    settled() { return this.inFlight.settled(); }
    close() { this.stopAdmission(); const current = this.current; this.current = undefined; current?.store.close(); }
}
export const name = '22-Economy';
export const inject = ['petCore', 'petWorld', 'tools', 'systemPrompt', 'agents'];
export function apply(ctx) {
    const host = ctx.petCore;
    let stopInitializer, stopAccess;
    const stateParameters = { view: { type: 'string', enum: ['overview', 'full'], description: 'Autonomous turns default to overview. full retains the original snapshot.' },
        factIds: { type: 'array', items: { type: 'string' }, description: 'Read 1–16 original committed economic interaction receipts by exact fact IDs.' },
        section: { type: 'string', enum: ['catalog', 'ledger'], description: 'Optional paged catalog or recent ledger (up to 80 original recent entries).' },
        offset: { type: 'integer' }, limit: { type: 'integer' } };
    return mountLivingArea(ctx, host, 'economy', view => new CompanionEconomy(ctx, host, view), service => {
        // Adopt an existing ready workspace before registering required schema paths.
        // Failed adoption leaves the original JSON and all unrelated records intact.
        const status = host.workspace.status();
        if (status.state === 'ready' && status.target)
            try {
                service.prepare(status.target);
            }
            catch (error) {
                ctx.logger('chatpet-economy').warn('Economy is unavailable; retained files were not replaced', error);
            }
        stopInitializer = host.workspace.registerInitializer('economy', target => { service.prepare(target, undefined, true); }, target => service.initializationFiles(target));
        ctx.effect(() => host.workspace.runtime.capabilityTable.register({
            id: 'life.economy', owner: 'life', contractVersion: CONTRACT_VERSION, order: 11,
            status: () => service.capabilityStatus(),
        }).revoke);
        ctx.provide('petEconomy', service);
        ctx.effect(() => host.native.consoleOperations.register('economy', service.consoleOperations(), ctx).revoke);
        installEconomyAccessGuard(ctx, () => {
            const directory = service.protectedDirectory();
            return directory ? [directory, economyAdoptionPath(resolve(directory, '../../..'))] : undefined;
        }, stop => { stopAccess = stop; });
        const scope = (agent) => {
            if (!agent || agent.session.header.agentPreset === 'chatpet-channel-guest' || host.native.isGuest(agent.id) || !host.native.manages(agent.id))
                return;
            const bound = ctx.petWorld.sessionStatus(agent.session), current = host.workspace.status();
            if (bound?.state !== 'ready' || current.state !== 'ready' || !current.target || bound.target?.id !== current.target.id)
                return;
            return current.target.id;
        };
        const output = { schema: { type: 'string' }, render: (_, value) => [{ type: 'text', text: value }] };
        const stateTool = defineTool({ name: economyStateToolDeclaration.name, description: '读取同一伙伴的真实钱包、库存、商店目录、读物与书签、待确认消费及近期流水。基础餐食和饮水免费。种植、收获、出售和消费由你明确选择并写入持久生活计划，不会自动派工、发工资或凭文字增加物品。', parameters: stateParameters, output,
            execute: async (args, exec) => {
                const id = scope(exec.agent);
                check(id, 'Economy requires an admitted owner conversation');
                const validate = () => { exec.signal.throwIfAborted(); check(scope(exec.agent) === id, 'Economy conversation admission changed'); host.native.validate(exec.agent.id); };
                if (args.factIds) {
                    check(args.factIds.length >= 1 && args.factIds.length <= 16, 'Expected 1–16 fact IDs');
                    validate();
                    const facts = await service.readFacts(id, args.factIds);
                    validate();
                    return JSON.stringify({ facts });
                }
                const state = await service.snapshot(id, validate);
                return JSON.stringify(args.section ? economyPage(state, args.section, args.offset, args.limit) :
                    (args.view ?? (host.native.isAutonomous(exec.agent.id) ? 'overview' : 'full')) === 'overview' ? economyOverview(state) : state);
            } });
        ctx.tools.register(stateTool, { when: ({ agent }) => !!scope(agent) });
        ctx.effect(() => host.native.toolTable.register(economyStateToolDeclaration).revoke);
        registerWorldContext(ctx, 'chatpet.economy', 35, agent => {
            const id = scope(agent);
            if (!id)
                return '';
            try {
                const snapshot = service.gardenPort(id).loadGarden(Date.now());
                return `生活经济：基础餐食、饮水免费，额外食物、读物与园艺用品使用游戏金币。收菜、出售、补种与消费由你决定，用生活计划明确安排，成熟和动画结束不会自动执行。钱物以程序流水为准；买到读物不等于读过，实际片段返回并确认后才保存书签。用 pet_economy_state 查询目录、库存与价格。当前金币 ${snapshot.coins}。这是持续的同一份钱包，换对话不重置。`;
            }
            catch {
                return '生活经济暂不可用。保留现有计划与未决操作，勿假设交易成功或另建钱包；基础餐食与饮水仍免费。';
            }
        });
    }, async (service) => {
        service.stopAdmission();
        try {
            await settleCleanup(() => stopAccess?.(), () => stopInitializer?.(), () => service.settled());
        }
        finally {
            service.close();
        }
    });
}
//# sourceMappingURL=plugin.js.map