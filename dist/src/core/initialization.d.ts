export declare function inspectCompanionFiles(_root: string): string[];
/** Read-only validation used by readiness checks; it never repairs a bad file. */
export declare function validateCompanionConfiguration(root: string): void;
export declare function initializeCompanionFiles(root: string, identity: {
    companionId: string;
    scopeId: string;
    storageId: string;
}): void;
