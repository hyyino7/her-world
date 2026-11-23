export function sameHomeBinding(current, captured) {
    return current === captured || !!current && !!captured && current.workspaceId === captured.workspaceId &&
        current.path === captured.path && current.storageId === captured.storageId &&
        current.bootId === captured.bootId && current.generation === captured.generation;
}
//# sourceMappingURL=home-binding.js.map