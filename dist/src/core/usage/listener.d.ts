import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { PetCoreHost } from '../index.js';
export declare function installUsageListener(ctx: Context, host: PetCoreHost, agentFor: (id: string) => Agent | undefined): () => boolean;
