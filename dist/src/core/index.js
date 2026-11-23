import { CoreNative } from './native/conversation.js';
import { NativeMemory } from './native/memory.js';
import { CoreWorkspace } from './workspace.js';
import { createPreferences } from './preferences.js';
import { CoreRuntime } from './runtime.js';
import { CoreRecords } from './records.js';
import { coreConsoleOperations } from './console-operations.js';
import { initializeMemoryStorage } from '../memory/initialization.js';
import { initializeRecentStorage } from '../emotion/recent.js';
import { memoryDirectory } from '../memory/client.js';
import { join, relative, sep } from 'node:path';
/** One companion's configuration, records and hooks into the native DSH runtime. */
export function createCore(config) {
    const runtime = new CoreRuntime(Object.freeze({ ...config }), runtime => new CoreWorkspace(runtime));
    const workspace = runtime.files;
    const native = new CoreNative(runtime), records = new CoreRecords(workspace, native);
    if (config.memory)
        native.memory = new NativeMemory(runtime, config.memory);
    workspace.registerInitializer('recent-experience', target => initializeRecentStorage(target.path), ['data/memory/recent-interactions.sqlite']);
    if (config.memory) {
        const useConfiguredDirectory = () => {
            const owner = runtime.store.meta('memory-configured-directory-owner');
            return !owner || owner.id === workspace.storageId();
        };
        workspace.registerInitializer('memory-bank', target => initializeMemoryStorage(config.memory, target, useConfiguredDirectory()), target => [relative(join(target.path, '.chatpet'), join(memoryDirectory(config.memory, target.path, useConfiguredDirectory()), 'data', 'memory.db')).split(sep).join('/')]);
    }
    runtime.capabilityStatuses['memory.lifecycle'] = () => {
        const memory = native.memory;
        if (!memory)
            return;
        const lifecycle = memory.connection.lifecycle;
        const ready = lifecycle === 'ready';
        return { state: !native.memoryEnabledForNewSessions() ? 'disabled' : ready ? 'ready' : 'degraded',
            reason: !native.memoryEnabledForNewSessions() ? 'Memory is disabled for subsequent turns; native chat remains available' : ready ? 'Shared Bank available for native observation and recall' : `Memory provider ${lifecycle}; chat continues without recall on failure`,
            supportedOperations: ready ? ['observe', 'recall', 'correct', 'withdraw', 'validate'] : [] };
    };
    const host = {
        services: { core: Object.freeze(runtime.core), preferences: createPreferences(runtime), workspace: workspace.port },
        operator: { request: runtime.owner.request },
        observe: (observer) => { runtime.onChange = observer; },
        workspace, native, records,
        close: async () => {
            try {
                await native.close();
            }
            finally {
                try {
                    records.close();
                    await native.memory?.close();
                }
                finally {
                    runtime.close();
                }
            }
        },
    };
    native.consoleOperations.register('core', coreConsoleOperations(host));
    return host;
}
//# sourceMappingURL=index.js.map