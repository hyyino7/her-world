import type { Context } from '@deepseek-ai/cordis';
/** Reuse DSH's own filesystem and current-directory resolution before its
 * monotonic guard. No replacement filesystem, assistant runtime or exec policy.
 * The owner RPC writes through the Economy owner and never calls file tools. */
export declare function installEconomyAccessGuard(ctx: Context, protectedPaths: () => readonly string[] | undefined, onCleanup: (stop: () => Promise<void>) => void): void;
