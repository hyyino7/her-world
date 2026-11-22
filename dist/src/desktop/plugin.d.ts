import type { Context } from '@deepseek-ai/cordis';
import { type ConsoleOperation } from '../core/tables/console.js';
import { type Desktop } from './index.js';
export declare const name = "30-Desktop";
export declare const inject: string[];
declare module '@deepseek-ai/cordis' {
    interface Context {
        petDesktop: Desktop;
    }
}
export declare function desktopConsoleOperations(desktop: Pick<Desktop, 'start' | 'closeWindow' | 'status'>): {
    operations: {
        desktopOpen: ConsoleOperation;
        desktopClose: ConsoleOperation;
    };
    status: () => {
        running: boolean;
    };
};
export declare function apply(ctx: Context): void;
