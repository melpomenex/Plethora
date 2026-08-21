import { describe, expect, it } from "vitest";
import { findUntrustedLeaks, hasContainmentClause } from "../containment";
import { buildSmartTaggingContext } from "../definitions/smartTaggingContext";
import {
  runSmartTagging,
  smartTaggingTask,
} from "../definitions/smartTaggingTask";

describe("SmartTaggingTask Definition & Prompt Containment", () => {
  it("carries UNTRUSTED_CONTAINMENT_CLAUSE in system instruction", () => {
    expect(hasContainmentClause(smartTaggingTask.systemInstruction)).toBe(true);
  });

  it("wraps document content and title inside <untrusted_source> blocks without leaks", () => {
    const input = {
      title: "Differential Equations and Manifolds",
      author: "Henri Poincare",
      headings: ["Introduction to Manifolds", "Vector Fields"],
      content: "This text contains complex mathematical expressions and definitions.",
      candidateExistingTags: ["Mathematics", "Topology"],
    };

    const built = smartTaggingTask.buildInput(input);
    expect(built.text).toContain("<untrusted_source id=\"document-title\">");
    expect(built.text).toContain("<untrusted_source id=\"author\">");
    expect(built.text).toContain("<untrusted_source id=\"headings\">");
    expect(built.text).toContain("<untrusted_source id=\"intro-excerpt\">");
    expect(built.text).toContain("<untrusted_source id=\"candidate-tags\">");

    // Verify containment: untrusted inputs must not leak outside blocks
    const leaks = findUntrustedLeaks(built.text, [
      input.title,
      input.author,
      input.headings[0],
      input.candidateExistingTags[0],
    ]);
    expect(leaks).toEqual([]);
  });

  it("buildSmartTaggingContext bounds long documents safely", () => {
    const hugeContent = "A".repeat(50_000);
    const context = buildSmartTaggingContext({
      title: "Huge Textbook",
      content: hugeContent,
    });

    expect(context.introExcerpt.length).toBeLessThanOrEqual(1500);
    expect(context.conclusionExcerpt.length).toBeLessThanOrEqual(1000);
  });

  it("falls back gracefully to Tier 1 baseline tags on provider failure", async () => {
    const result = await runSmartTagging({
      title: "Introduction to Differential Equations",
      content: "Solving linear systems with eigenvalues, matrix multiplication, and Fourier transform theorem proofs.",
      existingLibraryTagsList: [{ name: "Mathematics", itemCount: 10 }],
    });

    // In test environment without active mock model, fallback is used
    expect(result.fallbackUsed).toBe(true);
    expect(result.provenance).toBe("smart-local");
    expect(result.tagDetails.some((t) => t.tag === "Mathematics")).toBe(true);
  });
});
