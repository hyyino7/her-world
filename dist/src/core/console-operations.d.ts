import type { Result } from '../contracts/common.js';
import { type CompanionConfiguration } from './companion-settings.js';
import type { PetCoreHost } from './index.js';
import { type ConsoleCall } from './tables/console.js';
export declare function unwrap<T>(result: Result<T>): T;
export declare function coreConsoleOperations(host: PetCoreHost): {
    operations: {
        desktopAppearance(call: ConsoleCall): {
            [x: string]: unknown;
        };
        foundation(call: ConsoleCall): Promise<import("./workspace.js").CompanionFoundation>;
        self(call: ConsoleCall): Promise<{
            text: string;
            revision: string;
            path: string;
        }>;
        companion(call: ConsoleCall): Promise<CompanionConfiguration>;
        initialize(call: ConsoleCall): Promise<import("./workspace.js").WorkspaceStatus>;
        profile(call: ConsoleCall): Promise<{
            revision: number;
            text: string;
        }>;
        identity(call: ConsoleCall): Promise<{
            revision: number;
            displayName: string;
            character: string;
        }>;
        quiet(call: ConsoleCall): Promise<import("../contracts/core.js").AttentionPolicy>;
        preferences(call: ConsoleCall): Promise<import("./preferences.js").CorePreferences>;
    };
};
