import type { CoreWorkspace } from './workspace.js';
import type { CoreNative } from './native/conversation.js';
import type { ActivityReader } from './tables/companion-ports.js';
import { companionRecordPaths } from './record-paths.js';
/** The original diary reader and album store, owned by Core rather than a scheduler. */
export declare class CompanionRecordLibrary {
    readonly root: string;
    readonly timeZone: string;
    private photos?;
    readonly paths: ReturnType<typeof companionRecordPaths>;
    constructor(root: string, timeZone: string);
    album(): {
        list(limit?: number, offset?: number): {
            photos: import("#dsh-world/life/photos").PhotoSummary[];
            total: number;
            hasMore: boolean;
            limit: number;
            offset: number;
        };
        keep(image: StoredImageAttachment, description?: string, tags?: readonly string[]): import("#dsh-world/life/photos").PhotoSummary;
        image(id: string): StoredImageAttachment | undefined;
        forget(id: string): void;
        close(): void;
    };
    readonly photoTools: Readonly<{
        keep: (image: StoredImageAttachment, description?: string | undefined, tags?: readonly string[] | undefined) => import("#dsh-world/life/photos").PhotoSummary;
        list: (limit?: number | undefined, offset?: number | undefined) => {
            photos: import("#dsh-world/life/photos").PhotoSummary[];
            total: number;
            hasMore: boolean;
            limit: number;
            offset: number;
        };
        forget: (id: string) => void;
    }>;
    dates(activityDays?: () => readonly string[]): string[];
    journal(day: string, readActivity?: (day: string) => ReturnType<ActivityReader['activity']>): {
        day: string;
        activity: readonly import("../../vendor/dsh-world/lib/life/types.js").ActivityRecord[];
    };
    close(): void;
}
export type RecordOperation = 'dates' | 'journal' | 'album' | 'photo' | 'forgetPhoto' | 'search';
type NativeWorkspace = {
    path: string;
    sessionIds: readonly string[];
};
export declare class CoreRecords {
    private workspace;
    private native;
    private closed;
    private current?;
    private lookup;
    readonly timeZone: string;
    constructor(workspace: CoreWorkspace, native: CoreNative);
    connect(lookup: (id: string) => NativeWorkspace | undefined): void;
    getLibrary(workspaceId: string): CompanionRecordLibrary;
    private scope;
    readSelf(workspaceId: string): Promise<{
        text: string;
        revision: string;
        path: string;
    }>;
    saveSelf(workspaceId: string, expectedRevision: string, value: string, validate?: () => void): Promise<{
        text: string;
        revision: string;
        path: string;
    }>;
    library(workspaceId: string, operation: RecordOperation, input?: unknown): Promise<string[] | {
        photos: import("#dsh-world/life/photos").PhotoSummary[];
        total: number;
        hasMore: boolean;
        limit: number;
        offset: number;
    } | {
        diary: string | null;
        day: string;
        activity: readonly import("../../vendor/dsh-world/lib/life/types.js").ActivityRecord[];
        dialogue?: undefined;
        diaries?: undefined;
        removed?: undefined;
        mediaType?: undefined;
        data?: undefined;
    } | {
        dialogue: {
            items: import("./review-dialogue.js").DialogueLine[];
            nextOffset: number | undefined;
            coverage: "partial" | "eligible";
        } | undefined;
        diaries: {
            date: string;
            excerpt: string;
        }[];
        removed?: undefined;
        mediaType?: undefined;
        data?: undefined;
    } | {
        removed: boolean;
        dialogue?: undefined;
        diaries?: undefined;
        mediaType?: undefined;
        data?: undefined;
    } | {
        mediaType: any;
        data: string;
        dialogue?: undefined;
        diaries?: undefined;
        removed?: undefined;
    }>;
    close(): void;
}
export {};
