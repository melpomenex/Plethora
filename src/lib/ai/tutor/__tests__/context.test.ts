/**
 * Bounded-context builder tests (task 7.2 / design D24): last 6 turns
 * verbatim, capped per turn and in total; capped deterministic summary of
 * older turns; key-term extraction; topic-drift detection; streaming preview
 * extraction.
 */

import { describe, expect, it } from "vitest";
import {
  TUTOR_CONTEXT_CHAR_BUDGET,
  TUTOR_CONTEXT_MAX_TURNS,
  TUTOR_SUMMARY_MAX_CHARS,
  TUTOR_SUMMARY_MAX_TERMS,
  TUTOR_TURN_MAX_CHARS,
  buildTutorContext,
  capText,
  deriveTopicFromMaterial,
  detectTopicDrift,
  distillSummary,
  extractKeyTerms,
  extractStreamingTutorContent,
  topicSignature,
} from "../context";

function turns(count: number): { role: "user" | "tutor"; text: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("tutor" as const),
    text: `turn ${i}`,
  }));
}

describe("capText", () => {
  it("returns short text unchanged", () => {
    expect(capText("short", 10)).toBe("short");
  });

  it("truncates to maxChars with an ellipsis marker", () => {
    expect(capText("abcdefg", 4)).toBe("abc…");
    expect(capText("abcdefg", 4).length).toBeLessThanOrEqual(4);
  });
});

describe("extractKeyTerms", () => {
  it("orders by frequency then first-seen and drops stopwords/short tokens", () => {
    const terms = extractKeyTerms(
      "the paging paging system uses virtual virtual addresses; this system maps pages",
      5
    );
    expect(terms[0]).toBe("paging");
    expect(terms).toContain("system");
    expect(terms).toContain("virtual");
    // Stopwords and sub-4-char tokens never qualify.
    expect(terms.some((t) => ["this", "the", "pages".slice(0, 3)].includes(t))).toBe(false);
  });

  it("respects the limit", () => {
    expect(extractKeyTerms("alpha beta gamma delta epsilon", 2)).toHaveLength(2);
  });

  it("yields no terms for short CJK answers (drift detection safely no-ops)", () => {
    expect(extractKeyTerms("記憶", 3)).toEqual([]);
  });
});

describe("distillSummary (deterministic, no model call)", () => {
  it("returns only the topic when there are no older turns", () => {
    expect(distillSummary("virtual memory", [])).toBe("Topic: virtual memory");
  });

  it("keeps the topic plus top key terms of the older turns", () => {
    const summary = distillSummary("virtual memory", [
      { role: "user", text: "paging paging tables matter" },
      { role: "tutor", text: "consider the paging tables" },
    ]);
    expect(summary).toContain("Topic: virtual memory");
    expect(summary).toContain("paging");
  });

  it("caps the number of terms", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      role: "user" as const,
      text: `concept${i} concept${i}`,
    }));
    const terms = distillSummary("t", many).split(", ");
    expect(terms.length).toBeLessThanOrEqual(TUTOR_SUMMARY_MAX_TERMS);
  });

  it("caps summary growth regardless of transcript size", () => {
    const huge = Array.from({ length: 500 }, () => ({
      role: "user" as const,
      text: `address space paging ${"filler".repeat(50)} table`,
    }));
    expect(distillSummary("virtual memory", huge).length).toBeLessThanOrEqual(
      TUTOR_SUMMARY_MAX_CHARS
    );
  });
});

describe("buildTutorContext", () => {
  it("keeps only the last 6 turns verbatim", () => {
    const { recentTurns } = buildTutorContext(turns(20), "topic");
    expect(recentTurns).toHaveLength(TUTOR_CONTEXT_MAX_TURNS);
    expect(recentTurns[recentTurns.length - 1].text).toBe("turn 19");
  });

  it("folds every older turn into the summary", () => {
    const conversation = [
      ...turns(8).map((t, i) => ({ ...t, text: `older${i} paging` })),
      ...turns(6),
    ];
    const { summary, recentTurns } = buildTutorContext(conversation, "topic");
    expect(summary).toContain("Topic: topic");
    // The verbatim window holds exactly the last 6 entries.
    expect(recentTurns.map((t) => t.text)).toEqual(["turn 0", "turn 1", "turn 2", "turn 3", "turn 4", "turn 5"]);
    expect(summary).toContain("paging");
  });

  it("caps each turn individually", () => {
    const long = "x".repeat(TUTOR_TURN_MAX_CHARS + 500);
    const { recentTurns } = buildTutorContext([{ role: "user", text: long }], "t");
    expect(recentTurns[0].text.length).toBeLessThanOrEqual(TUTOR_TURN_MAX_CHARS);
  });

  it("drops the oldest turns first when the shared budget is exceeded, keeping the last", () => {
    const big = "paging address space tables ".repeat(50);
    const conversation = [big, big, big, big, big, big, "final answer"].map((text, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("tutor" as const),
      text,
    }));
    const { recentTurns, summary } = buildTutorContext(conversation, "topic");
    expect(recentTurns[recentTurns.length - 1].text).toBe("final answer");
    expect(
      recentTurns.reduce((sum, t) => sum + t.text.length, 0)
    ).toBeLessThanOrEqual(TUTOR_CONTEXT_CHAR_BUDGET + TUTOR_TURN_MAX_CHARS);
    // The dropped entries became summary material instead of vanishing.
    expect(summary).not.toBe("Topic: topic");
  });

  it("always keeps at least the final entry even when one turn blows the budget", () => {
    const conversation: { role: "user" | "tutor"; text: string }[] = [
      { role: "user", text: "z".repeat(TUTOR_TURN_MAX_CHARS) },
      { role: "tutor", text: "z".repeat(TUTOR_TURN_MAX_CHARS) },
    ];
    const { recentTurns } = buildTutorContext(conversation, "t");
    expect(recentTurns.length).toBeGreaterThanOrEqual(1);
    expect(recentTurns[recentTurns.length - 1].role).toBe("tutor");
  });
});

describe("topic signature and drift", () => {
  it("builds a signature from the topic's key terms", () => {
    const signature = topicSignature("virtual memory paging");
    expect(signature.has("virtual")).toBe(true);
    expect(signature.has("memory")).toBe(true);
  });

  it("detects drift when the answer's dominant term is outside the signature", () => {
    const signature = topicSignature("virtual memory paging");
    expect(detectTopicDrift(signature, "actually thrashing is what confuses me")).toBe("thrashing");
    expect(detectTopicDrift(signature, "the paging mechanism")).toBeNull();
  });

  it("returns null when the answer has no dominant key term", () => {
    expect(detectTopicDrift(topicSignature("virtual memory"), "嗯")).toBeNull();
  });
});

describe("deriveTopicFromMaterial", () => {
  it("takes the first sentence of the material", () => {
    expect(deriveTopicFromMaterial("Eigenvectors scale but keep direction. More text follows.")).toBe(
      "Eigenvectors scale but keep direction."
    );
  });

  it("caps long first sentences", () => {
    const topic = deriveTopicFromMaterial(`${"word ".repeat(60)}.rest`);
    expect(topic.length).toBeLessThanOrEqual(80);
  });

  it("falls back for empty material", () => {
    expect(deriveTopicFromMaterial("   ")).toBe("Selected material");
  });
});

describe("extractStreamingTutorContent", () => {
  it("extracts a complete content value", () => {
    expect(
      extractStreamingTutorContent('{"move":"hint","content":"Look at the page table.","hintLevel":1}')
    ).toBe("Look at the page table.");
  });

  it("extracts a PARTIAL content value from a truncated stream", () => {
    expect(extractStreamingTutorContent('{"move":"hint","content":"Look at th')).toBe("Look at th");
  });

  it("unescapes embedded quotes and newlines", () => {
    expect(extractStreamingTutorContent('{"content":"a \\"quoted\\" word\\nnext"}')).toBe(
      'a "quoted" word\nnext'
    );
  });

  it("returns empty before the content key arrives and on a broken escape", () => {
    expect(extractStreamingTutorContent('{"move":"hi')).toBe("");
    expect(extractStreamingTutorContent('{"content":"trailing backslash \\')).toBe("");
  });
});
