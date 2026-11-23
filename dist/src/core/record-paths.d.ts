export declare function companionRecordPaths(root: string): {
    directory: string;
    selfFile: string;
    diaryDir: string;
    historyDir: string;
    lifeDirectory: string;
    photoDirectory: string;
};
export declare function prepareRecordDirectory(directory: string): void;
/** Reuse the upstream schema initializer without a Life service or model turn. */
export declare function initializeCompanionRecords(root: string): {
    directory: string;
    selfFile: string;
    diaryDir: string;
    historyDir: string;
    lifeDirectory: string;
    photoDirectory: string;
};
export declare const COMPANION_ALBUM_FILES: readonly ["album.sqlite", "album.sqlite-wal", "album.sqlite-shm", "album.sqlite-journal", "index.json"];
