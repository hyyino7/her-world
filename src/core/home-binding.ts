import type {HomeBinding} from './workspace.js';

export function sameHomeBinding(current: HomeBinding | undefined, captured: HomeBinding | undefined) {
  return current === captured || !!current && !!captured && current.workspaceId === captured.workspaceId &&
    current.path === captured.path && current.storageId === captured.storageId &&
    current.bootId === captured.bootId && current.generation === captured.generation;
}
