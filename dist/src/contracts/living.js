export function isWorldChangeFor(change, binding) {
    return !!binding && change.workspaceId === binding.workspaceId && change.storageId === binding.storageId &&
        change.bootId === binding.bootId && change.generation === binding.generation;
}
//# sourceMappingURL=living.js.map