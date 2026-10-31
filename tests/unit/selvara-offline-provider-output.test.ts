import { describe, expect, it } from "vitest";

import { buildSelvaraOfflineProviderOutput } from "../fixtures/selvara-offline-provider-output";

describe("Selvara offline provider fixture", () => {
  it("contains a valid interpretive-only 40-page provider proposal", () => {
    const output = buildSelvaraOfflineProviderOutput();
    const knowledge = output.structuredKnowledge as Record<string, unknown>;

    expect(knowledge.evidenceCandidates).toHaveLength(46);
    expect(output.structuredKnowledge).not.toHaveProperty("documentInventory");
    expect(output.structuredKnowledge).not.toHaveProperty("sourceQuotes");
  });
});
