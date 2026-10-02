import { describe, expect, it } from "vitest";
import {
  DAQE_DECISION_SCHEMA,
  TIER_COMPLEXITY,
  compositeScore,
  validateDaqeDecision,
} from "../ai/schemas/daqeDecision";
import {
  DAQE_DECISION_TASK_ID,
  buildDaqeDecisionPrompt,
  daqeDecisionTask,
} from "../ai/tasks/definitions/daqeDecisionTasks";
import {
  UNTRUSTED_CONTAINMENT_CLAUSE,
  findUntrustedLeaks,
  hasContainmentClause,
} from "../ai/tasks/containment";
import { getTaskDefinition } from "../ai/tasks/registry";
import {
  MAX_REMOTE_OUTLINE_CHARS,
  MAX_REMOTE_OUTLINE_ENTRIES,
  buildRemoteDecisionPayload,
  isPayloadAllowed,
  isPayloadRefused,
  outlineFromHeadings,
} from "./remotePayload";

/** A fixture carrying every category the payload must never contain. */
const SENSITIVE = {
  bodyText:
    "The transformer encoder stacks six layers of multi-head self-attention over a residual stream, and the feed-forward sublayer widens to four times the model dimension before projecting back.",
  title: "Attention Is All You Need",
  tags: ["deep-learning", "transformers", "nlp"],
  byline: "Ashish Vaswani, Noam Shazeer, Niki Parmar",
  headings: [
    "1 Introduction",
    "2 Model Architecture",
    "2.1 Encoder and Decoder Stacks",
    "2.2 Attention",
    "3 Why Self-Attention",
    "4 Results",
    "5 Conclusion",
    "6 Acknowledgements",
    "7 References",
  ],
};

describe("validateDaqeDecision", () => {
  it("accepts a well-formed envelope", () => {
    const outcome = validateDaqeDecision({
      goalAlignment: 0.8,
      atomicExtractability: 0.6,
      tier: "deep-foundational",
      prerequisitesMet: true,
      staleForPruning: false,
      reason: "Primary source with sustained argument.",
    });
    expect(outcome.ok).toBe(true);
  });

  it("rejects an out-of-range score rather than clamping it", () => {
    const outcome = validateDaqeDecision({
      goalAlignment: 1.7,
      atomicExtractability: 0.5,
      tier: "medium-analysis",
      prerequisitesMet: true,
      staleForPruning: false,
      reason: "x",
    });
    expect(outcome.ok).toBe(false);
  });

  it("rejects an unknown tier", () => {
    const outcome = validateDaqeDecision({
      goalAlignment: 0.5,
      atomicExtractability: 0.5,
      tier: "extremely-hard",
      prerequisitesMet: true,
      staleForPruning: false,
      reason: "x",
    });
    expect(outcome.ok).toBe(false);
  });

  it("rejects a non-boolean gate", () => {
    const outcome = validateDaqeDecision({
      goalAlignment: 0.5,
      atomicExtractability: 0.5,
      tier: "medium-analysis",
      prerequisitesMet: "yes",
      staleForPruning: false,
      reason: "x",
    });
    expect(outcome.ok).toBe(false);
  });

  it("fails closed on a partial object", () => {
    // A half-answer is worse than none: the ranker cannot tell it apart from a
    // real measurement.
    expect(validateDaqeDecision({ goalAlignment: 0.5 }).ok).toBe(false);
    expect(validateDaqeDecision({}).ok).toBe(false);
    expect(validateDaqeDecision(null).ok).toBe(false);
    expect(validateDaqeDecision([]).ok).toBe(false);
    expect(validateDaqeDecision("nope").ok).toBe(false);
  });

  it("composites the two continuous axes", () => {
    expect(
      compositeScore({
        goalAlignment: 0.8,
        atomicExtractability: 0.6,
        tier: "medium-analysis",
        prerequisitesMet: true,
        staleForPruning: false,
        reason: "x",
      })
    ).toBeCloseTo(0.7);
  });

  it("maps every tier onto the shared 1-5 scale", () => {
    expect(TIER_COMPLEXITY["surface-skim"]).toBe(1);
    expect(TIER_COMPLEXITY["medium-analysis"]).toBe(3);
    expect(TIER_COMPLEXITY["deep-foundational"]).toBe(5);
  });
});

describe("daqeDecisionTask", () => {
  it("carries the untrusted-containment clause", () => {
    expect(hasContainmentClause(daqeDecisionTask.systemInstruction)).toBe(true);
    expect(daqeDecisionTask.systemInstruction).toContain(UNTRUSTED_CONTAINMENT_CLAUSE);
  });

  it("is a fast-class structured task with a bounded timeout", () => {
    expect(daqeDecisionTask.id).toBe(DAQE_DECISION_TASK_ID);
    expect(daqeDecisionTask.modelClass).toBe("fast");
    expect(daqeDecisionTask.outputKind).toBe("structured");
    expect(daqeDecisionTask.streaming).toBe(false);
    expect(daqeDecisionTask.timeoutMs).toBeLessThan(15_000);
    expect(daqeDecisionTask.schema?.name).toBe(DAQE_DECISION_SCHEMA.name);
  });

  it("registers itself in the task registry", () => {
    expect(getTaskDefinition(DAQE_DECISION_TASK_ID)).toBeDefined();
  });
});

describe("containment of the decision prompt", () => {
  const prompt = buildDaqeDecisionPrompt({
    itemId: "doc-1",
    itemType: "document",
    lengthChars: 42_000,
    outline: SENSITIVE.headings,
    goal: "understand attention mechanisms",
    rubricVersion: 1,
  });

  it("keeps every heading inside an untrusted block", () => {
    expect(findUntrustedLeaks(prompt, SENSITIVE.headings)).toEqual([]);
  });

  it("keeps the goal inside an untrusted block", () => {
    expect(findUntrustedLeaks(prompt, ["understand attention mechanisms"])).toEqual([]);
  });

  it("never carries the item body, the verbatim title, or tags", () => {
    for (const forbidden of [SENSITIVE.bodyText, SENSITIVE.title, ...SENSITIVE.tags]) {
      expect(prompt).not.toContain(forbidden);
    }
  });

  it("still tells the model what it is judging", () => {
    expect(prompt).toContain("document");
    expect(prompt).toContain("42000 characters");
    expect(prompt).toContain(DAQE_DECISION_SCHEMA.json);
  });
});

describe("remote payload gate", () => {
  it("is unreachable without the opt-in", () => {
    const decision = buildRemoteDecisionPayload({
      allowRemote: false,
      itemType: "document",
      lengthChars: 42_000,
      outline: SENSITIVE.headings,
      rubricVersion: 1,
    });
    expect(decision.ok).toBe(false);
    if (isPayloadRefused(decision)) expect(decision.refusal).toBe("remote-not-opted-in");
  });

  it("carries no body text, verbatim title, tags or byline when opted in", () => {
    const decision = buildRemoteDecisionPayload({
      allowRemote: true,
      itemType: "document",
      lengthChars: 42_000,
      outline: outlineFromHeadings(SENSITIVE.headings),
      rubricVersion: 1,
    });
    expect(decision.ok).toBe(true);
    if (!isPayloadAllowed(decision)) return;

    for (const forbidden of [
      SENSITIVE.bodyText,
      SENSITIVE.title,
      ...SENSITIVE.tags,
      SENSITIVE.byline,
    ]) {
      expect(decision.body).not.toContain(forbidden);
    }
    // What it does carry: the skeleton, the type, and the length.
    expect(decision.body).toContain("2.1 Encoder and Decoder Stacks");
    expect(decision.payload.itemType).toBe("document");
    expect(decision.payload.lengthChars).toBe(42_000);
  });

  it("refuses an outline deep enough to be an exfiltration shape", () => {
    const decision = buildRemoteDecisionPayload({
      allowRemote: true,
      itemType: "document",
      lengthChars: 10,
      outline: Array.from({ length: MAX_REMOTE_OUTLINE_ENTRIES + 1 }, (_, i) => `H${i}`),
      rubricVersion: 1,
    });
    expect(decision.ok).toBe(false);
    if (isPayloadRefused(decision)) expect(decision.refusal).toBe("outline-too-deep");
  });

  it("refuses an outline past the character cap", () => {
    const decision = buildRemoteDecisionPayload({
      allowRemote: true,
      itemType: "document",
      lengthChars: 10,
      outline: ["x".repeat(MAX_REMOTE_OUTLINE_CHARS + 1)],
      rubricVersion: 1,
    });
    expect(decision.ok).toBe(false);
    if (isPayloadRefused(decision)) expect(decision.refusal).toBe("payload-too-large");
  });

  it("strips control characters from headings", () => {
    const decision = buildRemoteDecisionPayload({
      allowRemote: true,
      itemType: "document",
      lengthChars: 10,
      outline: ["Clean heading"],
      rubricVersion: 1,
    });
    expect(decision.ok).toBe(true);
    if (!isPayloadAllowed(decision)) return;
    expect(decision.payload.outline[0]).toBe("Clean heading");
  });

  it("drops empty headings rather than sending blanks", () => {
    expect(outlineFromHeadings(["  ", " Real "])).toEqual(["Real"]);
  });

  it("carries no outline at all when there are no headings", () => {
    const decision = buildRemoteDecisionPayload({
      allowRemote: true,
      itemType: "extract",
      lengthChars: 400,
      rubricVersion: 1,
    });
    expect(decision.ok).toBe(true);
    if (!isPayloadAllowed(decision)) return;
    expect(decision.payload.outline).toEqual([]);
  });
});