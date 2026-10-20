import { describe, expect, it } from "vitest";
import { sha256Hex } from "../hash";
import {
  boundPassageText,
  computePassageDigest,
  isExtractWorthinessEligible,
  normalizePassageText,
  splitPassageText,
  toPlainReason,
} from "../identity";
import { PASSAGE_WORTHINESS_THRESHOLD } from "../types";
import type { PassageClassification } from "../../../../lib/ai/schemas/passageClassification";

const policy = {
  classifierVersion: "classifier-a",
  servingRevision: "provider-a\u0000model-a",
};

function classification(
  overrides: Partial<PassageClassification> = {}
): PassageClassification {
  return {
    type: "definition",
    extractWorthiness: 0.76,
    reason: "Defines the central term.",
    suggestedLearningAction: "extract",
    ...overrides,
  };
}

describe("sha256Hex", () => {
  it("matches the standard SHA-256 vector and UTF-8 input", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    // Deterministic across calls and distinct for distinct input.
    expect(sha256Hex("naïve — 定義")).toBe(sha256Hex("naïve — 定義"));
    expect(sha256Hex("naïve — 定義")).not.toBe(sha256Hex("naive - definition"));
  });
});

describe("passage digest identity", () => {
  it("is stable for reflow-only whitespace and changes for real edits", () => {
    const a = computePassageDigest({
      text: "A core claim\n  with   wrapped lines.",
      policy,
    });
    const b = computePassageDigest({
      text: "A core claim with wrapped lines.",
      policy,
    });
    expect(a).toBe(b);
    expect(
      computePassageDigest({ text: "A changed claim with wrapped lines.", policy })
    ).not.toBe(a);
  });

  it("treats the same 96-character prefix with a different suffix as a new key", () => {
    const prefix = "x".repeat(96);
    const digestA = computePassageDigest({ text: `${prefix}-alpha`, policy });
    const digestB = computePassageDigest({ text: `${prefix}-beta`, policy });
    expect(digestA).not.toBe(digestB);
  });

  it("changes when the classifier or serving model revision changes", () => {
    const text = "A definition worth keeping because it is precise.";
    const base = computePassageDigest({ text, policy });
    expect(
      computePassageDigest({ text, policy: { ...policy, classifierVersion: "classifier-b" } })
    ).not.toBe(base);
    expect(
      computePassageDigest({ text, policy: { ...policy, servingRevision: "provider-a\u0000model-b" } })
    ).not.toBe(base);
    expect(
      computePassageDigest({
        text,
        policy,
        normalizationVersion: "passage-normalization-v2",
      })
    ).not.toBe(base);
  });

  it("keeps duplicate text at different anchors distinct via source locators", () => {
    // Identity helper is text-based; anchor identity is verified in adapter
    // tests. Here we pin the duplicate-text digest equality contract so the
    // controller must combine it with passageId/source identity.
    const text = "Repeated boilerplate sentence that appears twice.";
    expect(computePassageDigest({ text, policy })).toBe(
      computePassageDigest({ text, policy })
    );
  });
});

describe("passage text bounds and splitting", () => {
  it("normalizes Unicode/whitespace and rejects short fragments", () => {
    expect(normalizePassageText("  A\u00a0  B \n\n\n C ")).toBe("A B C");
    expect(boundPassageText("too short")).toBeNull();
    const long = "A".repeat(2_000);
    expect(boundPassageText(long)?.truncated).toBe(false);
    const tooLong = `${"A".repeat(2_400)}. Tail that must be cut.`;
    const bounded = boundPassageText(tooLong);
    expect(bounded?.truncated).toBe(true);
    expect((bounded?.text.length ?? 0) <= 2_400).toBe(true);
  });

  it("splits long blocks deterministically while preserving offsets", () => {
    const sentences = Array.from(
      { length: 40 },
      (_, index) => `Sentence ${index} explains a distinct step in the process.`
    );
    const text = sentences.join(" ");
    const parts = splitPassageText(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((part) => part.text).join("")).toBe(text);
    for (let index = 1; index < parts.length; index += 1) {
      expect(parts[index].start).toBe(parts[index - 1].end);
    }
    for (const part of parts) expect(part.end - part.start).toBe(part.text.length);
    expect(splitPassageText(text)).toEqual(parts);
  });
});

describe("indicator eligibility", () => {
  it("uses the strict > 0.75 boundary", () => {
    expect(PASSAGE_WORTHINESS_THRESHOLD).toBe(0.75);
    expect(isExtractWorthinessEligible(classification({ extractWorthiness: 0.75 }))).toBe(false);
    expect(isExtractWorthinessEligible(classification({ extractWorthiness: 0.7500001 }))).toBe(true);
    expect(isExtractWorthinessEligible(classification({ extractWorthiness: 1 }))).toBe(true);
  });

  it("keeps bibliography, transition, low-value and no-action quiet", () => {
    for (const type of ["bibliography", "transition", "low-value"] as const) {
      expect(
        isExtractWorthinessEligible(classification({ type, extractWorthiness: 0.99 }))
      ).toBe(false);
    }
    expect(
      isExtractWorthinessEligible(
        classification({ suggestedLearningAction: "none", extractWorthiness: 0.99 })
      )
    ).toBe(false);
  });

  it("returns plain reason text, never markup", () => {
    expect(toPlainReason("<b>Definition</b> of  the term")).toBe("Definition of the term");
    expect(toPlainReason("line\nbreak")).toBe("line break");
    expect(toPlainReason(undefined)).toBe("");
  });
});
