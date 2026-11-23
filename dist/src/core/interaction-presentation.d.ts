import type { CompanionFact } from '../contracts/interaction.js';
export declare const INTERACTION_CONTEXT = "chatpet.interactions";
/** Lossless event identity/meaning; numeric before/after and request receipts
 * remain with the original domain record and Life's structured source.facts. */
export declare function presentFact(fact: CompanionFact): {
    operationId?: string | undefined;
    id: string;
    domain: "body" | "economy";
    type: "command" | "pet" | "poke" | "feed" | "water" | "play" | "talk" | "sleep" | "wake" | "lamp" | "visit" | "go" | "place" | "sick" | "heal" | "purchase" | "sale" | "money-grant" | "item-gift" | "reading-import" | import("../contracts/interaction.js").LegacyFactType;
    at: string;
    actor: import("../contracts/interaction.js").CompanionFactActor;
    status: "failed" | "completed" | "unchanged";
    summary: string;
};
export declare function presentFacts(facts: readonly CompanionFact[]): string;
/** Match a named native snapshot's actual text and exact structured projection,
 * never an incidental ID mention elsewhere in a conversation or tool result. */
export declare function contextFactIds(events: readonly {
    type: string;
    data: unknown;
}[], facts: readonly CompanionFact[]): Set<string>;
