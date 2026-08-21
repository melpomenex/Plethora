import { describe, expect, it } from "vitest";
import { validateSmartTaggingOutput } from "../smartTagging";

describe("Smart Tagging Schema Validator", () => {
  it("validates valid smart tagging structured output", () => {
    const output = {
      existingTags: [
        {
          tag: "Operating Systems",
          confidence: 0.95,
          reason: "Discusses Linux CPU scheduler and process priority",
        },
      ],
      proposedNewTags: [
        {
          name: "Kernel Architecture",
          confidence: 0.85,
          reason: "In-depth explanation of monolithic kernel internals",
        },
      ],
    };

    const outcome = validateSmartTaggingOutput(output);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.existingTags).toHaveLength(1);
      expect(outcome.value.proposedNewTags).toHaveLength(1);
      expect(outcome.value.existingTags[0].tag).toBe("Operating Systems");
    }
  });

  it("fails closed on non-object root", () => {
    const outcome = validateSmartTaggingOutput("not an object");
    expect(outcome.ok).toBe(false);
  });

  it("fails closed on invalid confidence range", () => {
    const output = {
      existingTags: [
        {
          tag: "Physics",
          confidence: 1.5, // Invalid > 1
          reason: "Quantum theory",
        },
      ],
      proposedNewTags: [],
    };
    const outcome = validateSmartTaggingOutput(output);
    expect(outcome.ok).toBe(false);
  });

  it("fails closed on missing required fields", () => {
    const output = {
      existingTags: [{ tag: "Physics" }], // Missing confidence and reason
      proposedNewTags: [],
    };
    const outcome = validateSmartTaggingOutput(output);
    expect(outcome.ok).toBe(false);
  });
});
