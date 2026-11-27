import type { CoreService, WorkspaceEditScope } from '../contracts/core.js';
import type { Result } from '../contracts/common.js';
import {usageReport} from './usage/report.js';
import { sameHomeBinding } from './home-binding.js';
import type { CompanionConfiguration } from './companion-settings.js';
import type { PetCoreHost } from './index.js';
import type { ConversationOptions } from './options.js';
import type { WorkspaceTarget } from './preferences.js';
import type { CoreCallOptions } from './runtime.js';
import { reject, Rejection } from './storage.js';
import { fail, object, requiredText, type ConsoleCall, type ConsoleOperation } from './tables/console.js';

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Rejection(result.error);
  return result.value;
}

type IdentityEdit = Parameters<CoreService['reviseIdentity']>[1];
const identityFields: Record<keyof IdentityEdit, true> = {
  expectedScope: true, expectedRevision: true, displayName: true, character: true,
};

const libraryOperations = {
  lifeDates: ['dates'], lifeJournal: ['journal', 'day'], lifeAlbum: ['album', 'offset'],
  lifePhoto: ['photo', 'id'], lifeForgetPhoto: ['forgetPhoto', 'id'], lifeSearch: ['search', 'query', 'offset'],
} as const;

export function coreConsoleOperations(host: PetCoreHost) {
  const { core, workspace, preferences } = host.services;
  const context = (endpoint: string, call: ConsoleCall) => host.operator.request(`settings:${endpoint}:${call.requestId}`);
  const library: Record<string, ConsoleOperation> = Object.fromEntries(Object.entries(libraryOperations)
    .map(([endpoint, [operation, ...fields]]) => [endpoint, (call: ConsoleCall) => {
      const input = object(call.input, ['workspaceId', ...fields]);
      const id = requiredText(input.workspaceId, 200);
      call.checkBinding(id);
      if (fields.length === 0) return host.records.library(id, operation);
      return host.records.library(id, operation,
        operation === 'search' ? {query: input.query, offset: input.offset} : input[fields[0] ?? '']);
    }]));

  return {operations: {
    ...library,
    usageLedger(call: ConsoleCall) {
      const dated = call.input !== null && typeof call.input === 'object' && Object.hasOwn(call.input, 'day');
      const input = object(call.input, dated ? ['workspaceId', 'day'] : ['workspaceId']);
      call.checkBinding(requiredText(input.workspaceId, 200), true);
      const scope = host.workspace.homeScope();
      if (!scope) fail('STALE_BINDING');
      return usageReport(host, scope, input.day);
    },
    async foundation(call: ConsoleCall) {
      const writing = Boolean(call.input && typeof call.input === 'object' && Object.hasOwn(call.input, 'text'));
      const input = object(call.input, writing ? ['workspaceId', 'expectedRevision', 'text'] : ['workspaceId']);
      call.checkBinding(input.workspaceId);
      const request = context('foundation', call), options = {signal: call.signal};
      return writing ? unwrap(await workspace.saveFoundation(request, {
        workspaceId: requiredText(input.workspaceId, 200),
        expectedRevision: requiredText(input.expectedRevision, 256), text: input.text as string,
      }, options)) : unwrap(await workspace.readFoundation(request, {}, options));
    },
    self(call: ConsoleCall) {
      const writing = Boolean(call.input && typeof call.input === 'object' && Object.hasOwn(call.input, 'text'));
      const input = object(call.input, writing ? ['workspaceId', 'expectedRevision', 'text'] : ['workspaceId']);
      const id = requiredText(input.workspaceId, 200);
      call.checkBinding(id);
      return writing ? host.records.saveSelf(id, requiredText(input.expectedRevision, 256), input.text as string, call.validate)
        : host.records.readSelf(id);
    },
    async companion(call: ConsoleCall) {
      const input = object(call.input, ['workspaceId', 'expectedSettings', 'settings']);
      call.checkBinding(input.workspaceId);
      return unwrap(await workspace.saveCompanion(context('companion', call), {
        workspaceId: input.workspaceId as string, expectedSettings: input.expectedSettings as CompanionConfiguration,
        settings: input.settings as CompanionConfiguration,
      }, {signal: call.signal}));
    },
    async initialize(call: ConsoleCall) {
      const input = object(call.input, ['expectedPreferencesRevision']);
      const request = context('initialize', call), options = {signal: call.signal};
      const home = host.workspace.homeScope(), editor = host.workspace.editScope();
      const validate = () => {
        call.validate();
        if (!sameHomeBinding(host.workspace.homeScope(), home)) fail('STALE_BINDING');
        host.workspace.assertEditScope(editor);
      };
      const prefs = unwrap(await preferences.read(request, {}, options));
      validate();
      const target = prefs.workspace && call.getWorkspaces()?.get(prefs.workspace.id);
      if (!target || target.path !== prefs.workspace?.path) fail('NOT_FOUND');
      const status = await target.status();
      validate();
      if (status !== 'ok') fail('NOT_FOUND');
      const initializeOptions: CoreCallOptions = {...options, validateInitialization: () => {
        try { call.validate(); }
        catch { reject('STALE_BINDING', 'Core provider changed during initialization'); }
        if (call.getWorkspaces()?.get(target.id) !== target)
          reject('STALE_BINDING', 'Workspace registration changed during initialization');
      }};
      return unwrap(await workspace.initialize(request, {expectedPreferencesRevision: input.expectedPreferencesRevision as number}, initializeOptions));
    },
    async profile(call: ConsoleCall) {
      const input = object(call.input, ['expectedScope', 'expectedRevision', 'text']);
      return unwrap(await workspace.saveProfile(context('profile', call), {
        expectedScope: input.expectedScope as WorkspaceEditScope,
        expectedRevision: input.expectedRevision as number, text: input.text as string,
      }, {signal: call.signal}));
    },
    async identity(call: ConsoleCall) {
      const input = object(call.input, Object.keys(identityFields));
      const {revision, displayName, character} = unwrap(await core.reviseIdentity(context('identity', call),
        input as unknown as IdentityEdit,
        {signal: call.signal}));
      return {revision, displayName, character};
    },
    async quiet(call: ConsoleCall) {
      const input = object(call.input, ['expectedRevision', 'quiet']);
      if (typeof input.quiet !== 'boolean') fail('INVALID_ARGUMENT');
      return unwrap(await preferences.setQuiet(context('quiet', call), {
        expectedRevision: input.expectedRevision as number, quiet: input.quiet,
      }, {signal: call.signal}));
    },
    async preferences(call: ConsoleCall) {
      const input = object(call.input, ['expectedRevision', 'workspaceId', 'conversation']);
      if (input.workspaceId !== null && typeof input.workspaceId !== 'string') fail('INVALID_ARGUMENT');
      let target: WorkspaceTarget | null = null;
      if (input.workspaceId !== null) {
        const registered = call.getWorkspaces()?.get(input.workspaceId as string);
        if (!registered || await registered.status() !== 'ok') fail('NOT_FOUND');
        target = {id: registered.id, title: registered.title, path: registered.path};
      }
      object(input.conversation, ['maxContextChars', 'maxSteps', 'maxToolCalls', 'maxDurationMs']);
      call.validate();
      return unwrap(await preferences.save(context('preferences', call), {
        expectedRevision: input.expectedRevision as number, workspace: target,
        conversation: input.conversation as unknown as ConversationOptions,
      }, {signal: call.signal}));
    },
  }};
}
