import { CONTRACT_VERSION } from '../contracts/version.js';
import { unknownEffect } from '../contracts/common.js';
import { sameHomeBinding } from './home-binding.js';
import { CoreAuthority } from './authority.js';
import { conversationOptions } from './options.js';
import { canonical, check, CoreStore, id, reject, Rejection, revision, text, timestamp } from './storage.js';
import { CapabilityTable } from './tables/capabilities.js';
/** Companion configuration and native integration storage. DSH owns execution. */
export class CoreRuntime {
    config;
    store;
    authority;
    owner;
    core;
    bootId = id('boot');
    defaultConversation;
    files;
    workspace;
    fileEffect = false;
    stopped = false;
    onChange = () => { };
    capabilityTable = new CapabilityTable();
    // Core supplies live status for its initial registrations.
    capabilityStatuses = {};
    capabilities = () => this.capabilityTable.list().map(({ id, owner, contractVersion, status }) => ({
        id, owner, contractVersion, ...status(),
    }));
    constructor(config, createWorkspace) {
        this.config = config;
        this.defaultConversation = conversationOptions(config.conversation);
        for (const key of ['companionId', 'scopeId', 'ownerActorId'])
            text(config[key], key);
        this.validateIdentity(config);
        this.store = new CoreStore(config.dataDir);
        this.authority = new CoreAuthority(config.companionId, config.scopeId);
        this.owner = this.authority.client({ module: 'core', actor: { kind: 'owner', id: config.ownerActorId }, operations: ['*'] });
        try {
            this.workspace = this.files = createWorkspace?.(this);
            const identity = this.store.get('identity', 'current');
            if (identity && (identity.companionId !== config.companionId || identity.ownerActorId !== config.ownerActorId || this.store.meta('scope') !== config.scopeId))
                reject('INCOMPATIBLE', 'Stored identity/scope does not match host configuration');
            if (!this.workspace?.migrationReason())
                this.store.transaction(() => {
                    if (!identity) {
                        this.store.put('identity', 'current', this.configuredIdentity());
                        this.store.setMeta('scope', config.scopeId);
                    }
                    if (!this.store.get('policy', 'current'))
                        this.store.put('policy', 'current', { revision: 1, quiet: false });
                    // Retired activity/execution/contact rows remain untouched historical data.
                    // Opening the companion never reconciles, runs or mutates those records.
                });
            this.registerBaseCapabilities();
            this.core = {
                getIdentity: this.call('getIdentity', false, () => this.identity()),
                reviseIdentity: this.call('reviseIdentity', true, input => {
                    check(this.files, 'Workspace binding service is unavailable');
                    this.files.assertEditScope(input.expectedScope);
                    const before = this.identity();
                    revision(before.revision, input.expectedRevision);
                    this.validateIdentity(input);
                    const next = { ...before, revision: before.revision + 1, displayName: input.displayName, character: input.character };
                    this.files?.write('identity', next);
                    this.store.put('identity', 'current', next);
                    return next;
                }, input => this.files?.assertEditScope(input.expectedScope)),
                getPolicy: this.call('getPolicy', false, () => this.policy()),
                listCapabilities: this.call('listCapabilities', false, () => this.capabilities()),
            };
        }
        catch (error) {
            this.store.close();
            throw error;
        }
    }
    validateIdentity(input) {
        check(typeof input.displayName === 'string' && input.displayName.length <= 256 && !/[\r\n]/.test(input.displayName), 'Invalid displayName');
        check(typeof input.character === 'string' && input.character.length <= 32_768, 'Invalid character');
    }
    configuredIdentity() {
        const { companionId, displayName, character, ownerActorId } = this.config;
        return { companionId, revision: 1, displayName, character, ownerActorId };
    }
    identity() {
        return this.store.get('identity', 'current') ?? (this.workspace?.migrationReason()
            ? this.configuredIdentity() : this.store.require('identity', 'current'));
    }
    policy() {
        const saved = this.store.get('policy', 'current') ?? (this.workspace?.migrationReason()
            ? { revision: 1, quiet: false } : this.store.require('policy', 'current'));
        return { revision: saved.revision, quiet: saved.quiet };
    }
    get conversation() {
        return conversationOptions(this.store.get('preferences', 'current')?.conversation ?? this.defaultConversation);
    }
    /** Configuration API authority, compare-and-set and request deduplication. */
    call(name, write, fn, preflight) {
        return async (context, input, options) => {
            this.fileEffect = false;
            try {
                const validate = () => {
                    if (this.stopped)
                        reject('DISABLED', 'Core has stopped');
                    if (options?.signal?.aborted)
                        throw new Rejection({ code: 'CANCELLED', message: 'Call cancelled before admission', effect: 'none', retry: 'never' });
                    if (options?.deadline) {
                        timestamp(options.deadline);
                        if (Date.parse(options.deadline) <= Date.now())
                            throw new Rejection({ code: 'TIMED_OUT', message: 'Call deadline expired', effect: 'none', retry: 'never' });
                    }
                };
                validate();
                const principal = this.authority.owner(context, name, this.config.ownerActorId);
                preflight?.(input);
                if (write)
                    this.workspace?.assertMigrationReady();
                if (name === 'workspace.initialize') {
                    const home = this.workspace?.homeScope(), editor = this.workspace?.editScope();
                    const recovering = !this.store.persisted();
                    await this.store.ensurePersisted();
                    this.fileEffect = false;
                    validate();
                    // Recovery may make the same pending workspace ready. Its editor
                    // revision still has to match, and any previously ready scope must match too.
                    if ((home || !recovering) && !sameHomeBinding(this.workspace?.homeScope(), home))
                        reject('STALE_BINDING', 'Workspace binding changed during initialization');
                    if (editor)
                        this.workspace?.assertEditScope(editor);
                    options?.validateInitialization?.();
                }
                this.files?.synchronize(name);
                this.fileEffect = false;
                canonical(input);
                check(input !== null && typeof input === 'object' && !Array.isArray(input), 'Expected request object');
                if (write)
                    this.workspace?.assertMigrationReady();
                let changed = false;
                const run = () => { const value = fn(input); if (write) {
                    this.store.setMeta('stateRevision', (this.store.meta('stateRevision') ?? 0) + 1);
                    changed = true;
                } return value; };
                const value = write ? this.store.mutate(`${principal.module}:${principal.actor.kind}:${principal.actor.id}`, name, context.requestId, input, run) : run();
                if (write)
                    try {
                        if (changed)
                            this.workspace?.configurationCommitted(name);
                        this.onChange(name, { bootId: this.bootId, revision: this.store.meta('stateRevision') });
                    }
                    catch { /* Committed configuration remains authoritative. */ }
                return { ok: true, value: structuredClone(value) };
            }
            catch (error) {
                return { ok: false, error: this.fileEffect ? unknownEffect('OUTCOME_UNKNOWN', 'Workspace file changed; refresh to reconcile the acknowledged state') : error instanceof Rejection ? error.detail : error instanceof TypeError
                        ? { code: 'INVALID_ARGUMENT', message: 'Malformed request object', effect: 'none', retry: 'never' }
                        : { code: 'INTERNAL', message: 'Core operation failed; inspect local diagnostics', effect: 'none', retry: 'never' } };
            }
        };
    }
    registerBaseCapabilities() {
        const rows = [
            [1, 'core.conversation', 'core'],
            [2, 'memory.lifecycle', 'memory'],
        ];
        for (const [order, id, owner] of rows) {
            this.capabilityTable.register({
                id, owner, contractVersion: CONTRACT_VERSION, order,
                status: () => this.capabilityStatuses[id]?.() ?? { state: 'unavailable', reason: 'Native component is not available', supportedOperations: [] },
            });
        }
    }
    close() { if (this.stopped)
        return; this.stopped = true; this.store.close(); }
}
//# sourceMappingURL=runtime.js.map