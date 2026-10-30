import { describe, expect, it } from "vitest";
import { createIssue6Provider, ISSUE6_CLOCK, ISSUE6_IDS, ISSUE6_SECTIONED_CONTENT } from "./fixtures";

describe("issue #6 workflow fixture", () => {
  it("keeps stable source identities, duplicate sections, and a fixed clock", () => {
    expect(ISSUE6_CLOCK).toBe("2026-10-29T12:00:00Z");
    expect(new Set(ISSUE6_IDS.cards).size).toBe(4);
    expect(ISSUE6_SECTIONED_CONTENT.match(/^## Shared$/gm)).toHaveLength(2);
    expect(ISSUE6_SECTIONED_CONTENT).toContain("Second section body.");
  });

  it("records provider input and returns deterministic cards without a network", async () => {
    const provider = createIssue6Provider();
    const request = { documentId: ISSUE6_IDS.document, sourceContent: "Second section body." };
    const result = await provider.generate(request);
    expect(provider.requests).toEqual([request]);
    expect(result.cards).toEqual([{
      type: "qa",
      question: "What is in the second section?",
      answer: "Second section body.",
    }]);
  });

  it("can model an offline provider failure without losing the captured request", async () => {
    const provider = createIssue6Provider({ error: new Error("fixture provider unavailable") });
    const request = { documentId: ISSUE6_IDS.document, sourceContent: "Second section body." };
    await expect(provider.generate(request)).rejects.toThrow("fixture provider unavailable");
    expect(provider.requests).toEqual([request]);
  });
});
