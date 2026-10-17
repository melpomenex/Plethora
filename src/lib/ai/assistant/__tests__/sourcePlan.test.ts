/**
 * Source-planning tests (task 2.7) and transcript-status tests (task 2.8).
 */

import { describe, expect, it, vi } from "vitest";
import { classifySourceIntent, planSourceContext } from "../sourcePlan";
import { planVideoContext, type VideoSegment } from "../videoContextPlanner";

describe("classifySourceIntent", () => {
  it("recognizes page/section/read-so-far/whole-source wording", () => {
    expect(classifySourceIntent("Explain this page", { page: 12 }, "pdf")).toBe("page");
    expect(classifySourceIntent("Explain this chapter", { sectionId: "ch4" }, "epub")).toBe("section");
    expect(classifySourceIntent("Summarize what I have read so far", { readFraction: 0.4 }, "epub")).toBe("read-so-far");
    expect(classifySourceIntent("Summarize the whole document", {}, "pdf")).toBe("whole-source");
  });

  it("falls back to position-aware defaults", () => {
    expect(classifySourceIntent("What is the main claim?", { page: 3 }, "pdf")).toBe("page");
    expect(classifySourceIntent("What is the main claim?", { sectionId: "s1" }, "article")).toBe("section");
    expect(classifySourceIntent("What is the main claim?", {}, "pdf")).toBe("general");
  });
});

describe("planSourceContext (task 2.7)", () => {
  it("binds the current page and reports the covered locator", () => {
    const plan = planSourceContext({
      kind: "pdf",
      question: "Explain this page",
      position: { page: 12 },
      pageText: (page) => (page === 12 ? "Page twelve text" : undefined),
      budgetTokens: 1000,
    });
    expect(plan.intent).toBe("page");
    expect(plan.content).toContain("Page twelve text");
    expect(plan.covered.pages).toEqual([12]);
    expect(plan.derivedContext).toBe(false);
  });

  it("discloses a missing page instead of guessing another", () => {
    const plan = planSourceContext({
      kind: "pdf",
      question: "Explain this page",
      position: { page: 99 },
      pageText: () => undefined,
      budgetTokens: 1000,
    });
    expect(plan.content).toBe("");
    expect(plan.limitations.join(" ")).toContain("page 99");
  });

  it("discloses an unknown reading position", () => {
    const plan = planSourceContext({
      kind: "pdf",
      question: "Explain this page",
      position: {},
      budgetTokens: 1000,
    });
    expect(plan.limitations.join(" ")).toContain("unknown");
  });

  it("plans two requested chapters within one budget", () => {
    const sections = [
      { id: "ch3", title: "Chapter 3", summary: "Summary 3", order: 0 },
      { id: "ch4", title: "Chapter 4", summary: "Summary 4", order: 1 },
    ];
    const plan = planSourceContext({
      kind: "epub",
      question: "How do these chapters connect?",
      requestedSectionIds: ["ch3", "ch4"],
      sections,
      sectionText: (id) => (id === "ch3" ? "Chapter three body" : "Chapter four body"),
      budgetTokens: 1000,
    });
    expect(plan.covered.sectionIds).toEqual(["ch3", "ch4"]);
    expect(plan.content).toContain("Chapter three body");
    expect(plan.content).toContain("Chapter four body");
  });

  it("uses cached summaries for read-so-far and marks them derived", () => {
    const sections = Array.from({ length: 8 }, (_, index) => ({
      id: `s${index}`,
      title: `Section ${index}`,
      summary: `Summary of section ${index}`,
      order: index,
    }));
    const plan = planSourceContext({
      kind: "epub",
      question: "Summarize what I have read so far",
      intent: "read-so-far",
      position: { readFraction: 0.5 },
      sections,
      sectionText: () => undefined,
      budgetTokens: 500,
    });
    expect(plan.intent).toBe("read-so-far");
    expect(plan.derivedContext).toBe(true);
    expect(plan.covered.sectionIds?.length).toBe(4);
    expect(plan.covered.readUpperBound).toBe("Section 3");
    expect(plan.limitations.join(" ")).toContain("derived context");
  });

  it("does not guess a read-so-far bound when the position is unknown", () => {
    const plan = planSourceContext({
      kind: "epub",
      question: "Summarize what I have read so far",
      intent: "read-so-far",
      position: { sectionId: "s2" },
      sections: [{ id: "s2", title: "Section 2", summary: "S2", order: 0 }],
      sectionText: () => "Section two body",
      budgetTokens: 500,
    });
    // Falls back to the visible section and says the position was unknown.
    expect(plan.limitations.join(" ")).toMatch(/unknown|visible/);
    expect(plan.intent).toBe("section");
  });

  it("uses full text for a whole-source summary only when it fits", () => {
    const fits = planSourceContext({
      kind: "article",
      intent: "whole-source",
      wholeSourceText: "Short article",
      budgetTokens: 100,
    });
    expect(fits.derivedContext).toBe(false);
    expect(fits.truncated).toBe(false);

    const overflows = planSourceContext({
      kind: "article",
      intent: "whole-source",
      wholeSourceText: "x".repeat(10_000),
      sections: [{ id: "s", title: "S", summary: "summary", order: 0 }],
      budgetTokens: 100,
    });
    expect(overflows.derivedContext).toBe(true);
    expect(overflows.truncated).toBe(true);
    expect(overflows.limitations.join(" ")).toContain("derived context");
  });

  it("discloses text-only model limitations for equations/figures", () => {
    const plan = planSourceContext({
      kind: "pdf",
      question: "Explain this equation",
      position: { page: 5 },
      pageText: () => "Equation text",
      budgetTokens: 500,
      capabilities: { textOnly: true },
    });
    expect(plan.capabilityNotice).toContain("cannot see page layout");
  });

  it("truncates over-budget content with a notice", () => {
    const plan = planSourceContext({
      kind: "pdf",
      question: "Explain this page",
      position: { page: 1 },
      pageText: () => "y".repeat(100_000),
      budgetTokens: 50,
    });
    expect(plan.truncated).toBe(true);
    expect(plan.content).toContain("truncated");
  });

  it("never extracts anything beyond the requested locators (no keystroke extraction)", () => {
    const pageText = vi.fn((page: number) => `page ${page}`);
    planSourceContext({
      kind: "pdf",
      question: "Explain this page",
      position: { page: 7 },
      pageText,
      budgetTokens: 100,
    });
    expect(pageText).toHaveBeenCalledTimes(1);
    expect(pageText).toHaveBeenCalledWith(7);

    const sectionText = vi.fn((id: string) => `section ${id}`);
    planSourceContext({
      kind: "epub",
      question: "Explain this chapter",
      requestedSectionIds: ["a", "b"],
      sectionText,
      budgetTokens: 100,
    });
    expect(sectionText).toHaveBeenCalledTimes(2);
  });
});

describe("planVideoContext transcript status (task 2.8)", () => {
  const segments: VideoSegment[] = Array.from({ length: 20 }, (_, index) => ({
    start: index * 10,
    duration: 10,
    text: `Segment ${index} about topic ${index}`,
  }));

  it("reports a complete transcript as full", () => {
    const plan = planVideoContext({
      segments,
      query: "summarize the video",
      sourceBudgetTokens: 10_000,
    });
    expect(plan.coverage).toBe("full");
    expect(plan.fullTranscript).toBe(true);
    expect(plan.limitations).toHaveLength(0);
  });

  it("never upgrades a partial transcript to full just because it fits", () => {
    const plan = planVideoContext({
      segments,
      query: "summarize the video",
      sourceBudgetTokens: 10_000,
      acquisition: "partial",
      coveredUntilSeconds: 200,
      retryable: true,
    });
    expect(plan.coverage).toBe("full"); // it *is* all the available text...
    expect(plan.fullTranscript).toBe(false); // ...but not the full video
    expect(plan.limitations.join(" ")).toContain("03:20");
    expect(plan.retryable).toBe(true);
  });

  it("keeps unavailable/loading/failed acquisition honest", () => {
    const unavailable = planVideoContext({
      segments: [],
      query: "what did they say at the end?",
      sourceBudgetTokens: 1000,
      acquisition: "unavailable",
      retryable: true,
    });
    expect(unavailable.mode).toBe("unavailable");
    expect(unavailable.fullTranscript).toBe(false);
    expect(unavailable.retryable).toBe(true);

    const loading = planVideoContext({
      segments,
      query: "what did they say at the end?",
      sourceBudgetTokens: 1000,
      acquisition: "loading",
    });
    expect(loading.fullTranscript).toBe(false);
    expect(loading.limitations.join(" ")).toContain("loading");

    const failed = planVideoContext({
      segments,
      query: "what did they say at the end?",
      sourceBudgetTokens: 1000,
      acquisition: "failed",
    });
    expect(failed.retryable).toBe(true);
    expect(failed.limitations.join(" ")).toContain("failed");
  });

  it("never invents timestamps: content is exactly the available segments", () => {
    const plan = planVideoContext({
      segments,
      query: "Segment 3",
      sourceBudgetTokens: 2000,
      acquisition: "partial",
      coveredUntilSeconds: 120,
    });
    for (const line of plan.content.split("\n\n").filter(Boolean)) {
      expect(line).toMatch(/^\[\d{2}:\d{2}\] Segment \d+/);
    }
    // The covered window is bounded by real segment times.
    expect(plan.timeRangeCovered?.startSeconds).toBeGreaterThanOrEqual(0);
    expect(plan.timeRangeCovered?.endSeconds).toBeLessThanOrEqual(200);
  });

  it("preserves budget overflow behavior with a bounded selection", () => {
    const longSegments: VideoSegment[] = Array.from({ length: 400 }, (_, index) => ({
      start: index,
      duration: 1,
      text: `Long segment ${index} `.repeat(20),
    }));
    const plan = planVideoContext({
      segments: longSegments,
      query: "main arguments",
      sourceBudgetTokens: 800,
    });
    // Plan either selects bounded chunks or defers to map-reduce; never the
    // whole over-budget transcript.
    expect(["retrieval", "map-reduce", "timestamp", "playback"]).toContain(plan.mode);
    if (plan.mode !== "map-reduce") {
      expect(plan.content.length).toBeLessThanOrEqual(800 * 4 + 200);
    }
  });
});
