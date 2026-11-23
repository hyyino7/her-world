import type { Context } from '@deepseek-ai/cordis';
import type { CompanionWritingScope } from '../../core/companion-writing.js';
import type { PetCoreHost } from '../../core/index.js';
import type { InFlight } from '../index.js';
export declare const REVIEW_ALARM_FILE: string;
export declare function installLifeReview(ctx: Context, host: PetCoreHost, getScope: () => CompanionWritingScope | undefined, inFlight: InFlight): void;
