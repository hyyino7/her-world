import { desktopAppearanceDefaults } from './companion-settings.js';
import { Rejection } from './storage.js';
import { fail, object, requiredText } from './tables/console.js';
export function unwrap(result) {
    if (!result.ok)
        throw new Rejection(result.error);
    return result.value;
}
const identityFields = {
    expectedScope: true, expectedRevision: true, displayName: true, character: true,
};
const libraryOperations = {
    lifeDates: ['dates'], lifeJournal: ['journal', 'day'], lifeAlbum: ['album', 'offset'],
    lifePhoto: ['photo', 'id'], lifeForgetPhoto: ['forgetPhoto', 'id'], lifeSearch: ['search', 'query', 'offset'],
};
export function coreConsoleOperations(host) {
    const { core, workspace, preferences } = host.services;
    const context = (endpoint, call) => host.operator.request(`settings:${endpoint}:${call.requestId}`);
    const library = Object.fromEntries(Object.entries(libraryOperations)
        .map(([endpoint, [operation, ...fields]]) => [endpoint, (call) => {
            const input = object(call.input, ['workspaceId', ...fields]);
            const id = requiredText(input.workspaceId, 200);
            call.checkBinding(id);
            if (fields.length === 0)
                return host.records.library(id, operation);
            return host.records.library(id, operation, operation === 'search' ? { query: input.query, offset: input.offset } : input[fields[0] ?? '']);
        }]));
    return { operations: {
            ...library,
            desktopAppearance(call) {
                object(call.input, []);
                return desktopAppearanceDefaults();
            },
            async foundation(call) {
                const writing = Boolean(call.input && typeof call.input === 'object' && Object.hasOwn(call.input, 'text'));
                const input = object(call.input, writing ? ['workspaceId', 'expectedRevision', 'text'] : ['workspaceId']);
                call.checkBinding(input.workspaceId);
                const request = context('foundation', call), options = { signal: call.signal };
                return writing ? unwrap(await workspace.saveFoundation(request, {
                    workspaceId: requiredText(input.workspaceId, 200),
                    expectedRevision: requiredText(input.expectedRevision, 256), text: input.text,
                }, options)) : unwrap(await workspace.readFoundation(request, {}, options));
            },
            self(call) {
                const writing = Boolean(call.input && typeof call.input === 'object' && Object.hasOwn(call.input, 'text'));
                const input = object(call.input, writing ? ['workspaceId', 'expectedRevision', 'text'] : ['workspaceId']);
                const id = requiredText(input.workspaceId, 200);
                call.checkBinding(id);
                return writing ? host.records.saveSelf(id, requiredText(input.expectedRevision, 256), input.text)
                    : host.records.readSelf(id);
            },
            async companion(call) {
                const input = object(call.input, ['workspaceId', 'expectedSettings', 'settings']);
                call.checkBinding(input.workspaceId);
                return unwrap(await workspace.saveCompanion(context('companion', call), {
                    workspaceId: input.workspaceId, expectedSettings: input.expectedSettings,
                    settings: input.settings,
                }, { signal: call.signal }));
            },
            async initialize(call) {
                const input = object(call.input, ['expectedPreferencesRevision']);
                const request = context('initialize', call), options = { signal: call.signal };
                const prefs = unwrap(await preferences.read(request, {}, options));
                const target = prefs.workspace && call.getWorkspaces()?.get(prefs.workspace.id);
                if (!target || target.path !== prefs.workspace?.path || await target.status() !== 'ok')
                    fail('NOT_FOUND');
                call.validate();
                return unwrap(await workspace.initialize(request, { expectedPreferencesRevision: input.expectedPreferencesRevision }, options));
            },
            async profile(call) {
                const input = object(call.input, ['expectedScope', 'expectedRevision', 'text']);
                return unwrap(await workspace.saveProfile(context('profile', call), {
                    expectedScope: input.expectedScope,
                    expectedRevision: input.expectedRevision, text: input.text,
                }, { signal: call.signal }));
            },
            async identity(call) {
                const input = object(call.input, Object.keys(identityFields));
                const { revision, displayName, character } = unwrap(await core.reviseIdentity(context('identity', call), input, { signal: call.signal }));
                return { revision, displayName, character };
            },
            async quiet(call) {
                const input = object(call.input, ['expectedRevision', 'quiet']);
                if (typeof input.quiet !== 'boolean')
                    fail('INVALID_ARGUMENT');
                return unwrap(await preferences.setQuiet(context('quiet', call), {
                    expectedRevision: input.expectedRevision, quiet: input.quiet,
                }, { signal: call.signal }));
            },
            async preferences(call) {
                const input = object(call.input, ['expectedRevision', 'workspaceId', 'conversation']);
                if (input.workspaceId !== null && typeof input.workspaceId !== 'string')
                    fail('INVALID_ARGUMENT');
                let target = null;
                if (input.workspaceId !== null) {
                    const registered = call.getWorkspaces()?.get(input.workspaceId);
                    if (!registered || await registered.status() !== 'ok')
                        fail('NOT_FOUND');
                    target = { id: registered.id, title: registered.title, path: registered.path };
                }
                object(input.conversation, ['maxContextChars', 'maxSteps', 'maxToolCalls', 'maxDurationMs']);
                call.validate();
                return unwrap(await preferences.save(context('preferences', call), {
                    expectedRevision: input.expectedRevision, workspace: target,
                    conversation: input.conversation,
                }, { signal: call.signal }));
            },
        } };
}
//# sourceMappingURL=console-operations.js.map