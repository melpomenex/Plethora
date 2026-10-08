import { describe, expect, it, vi } from "vitest";
import {
  buildDocFirstExpansionInstruction,
  fetchBraveSearchWithTimeout,
  formatBraveContext,
  formatSourceLabeledAnswer,
  shouldExpandBeyondDocument,
} from "../assistantExpansion";

describe("shouldExpandBeyondDocument", () => {
  it("triggers on explicit lookup phrasing", () => {
    expect(shouldExpandBeyondDocument("What else can you tell me about this? Look it up")).toBe(true);
    expect(shouldExpandBeyondDocument("Tell me more about this paragraph")).toBe(true);
    expect(shouldExpandBeyondDocument("Find more about photosynthesis beyond this document")).toBe(true);
  });

  it("stays document-confined without trigger", () => {
    expect(shouldExpandBeyondDocument("What does this paragraph say?")).toBe(false);
    expect(shouldExpandBeyondDocument("Summarize this excerpt")).toBe(false);
    expect(shouldExpandBeyondDocument("")).toBe(false);
  });

  it("honors the explicit lookup toggle", () => {
    expect(shouldExpandBeyondDocument("What does this say?", true)).toBe(true);
    expect(shouldExpandBeyondDocument("What does this say?", false)).toBe(false);
  });

  it("builds a doc-first instruction", () => {
    const instruction = buildDocFirstExpansionInstruction();
    expect(instruction).toContain("document context first");
    expect(instruction).toContain("separate");
  });
});

describe("formatBraveContext", () => {
  it("formats cited web results", () => {
    const context = formatBraveContext([
      { title: "Photosynthesis", url: "https://example.com/a", snippet: "Converts light" },
    ]);
    expect(context).toContain("[1]");
    expect(context).toContain("Photosynthesis");
    expect(context).toContain("https://example.com/a");
  });

  it("returns empty for no results", () => {
    expect(formatBraveContext([])).toBe("");
  });
});

describe("formatSourceLabeledAnswer", () => {
  it("labels document vs external sources", () => {
    const answer = formatSourceLabeledAnswer({
      documentPart: "The doc says X.",
      knowledgePart: "Generally, Y.",
      webResults: [{ title: "T", url: "https://example.com", snippet: "S" }],
    });
    expect(answer).toContain("From your document");
    expect(answer).toContain("Broader background");
    expect(answer).toContain("From the web");
    expect(answer).toContain("[1]");
  });

  it("discloses when live lookup was unavailable", () => {
    const answer = formatSourceLabeledAnswer({
      documentPart: "Doc part.",
      knowledgePart: "Knowledge part.",
      liveLookupUnavailable: true,
    });
    expect(answer).toContain("live web lookup was unavailable");
  });
});

describe("fetchBraveSearchWithTimeout", () => {
  it("returns results when the command succeeds", async () => {
    const invokeFn = vi.fn(async () => [{ title: "T", url: "https://example.com", snippet: "S" }]);
    const { results, timedOut } = await fetchBraveSearchWithTimeout("photosynthesis", invokeFn, 1000);
    expect(timedOut).toBe(false);
    expect(results).toHaveLength(1);
    expect(invokeFn).toHaveBeenCalledWith("brave_web_search", { query: "photosynthesis" });
  });

  it("degrades gracefully when search fails", async () => {
    const invokeFn = vi.fn(async () => {
      throw new Error("no key");
    });
    const { results } = await fetchBraveSearchWithTimeout("query", invokeFn, 1000);
    expect(results).toEqual([]);
  });

  it("returns empty for blank query without invoking", async () => {
    const invokeFn = vi.fn(async () => []);
    const { results } = await fetchBraveSearchWithTimeout("   ", invokeFn, 1000);
    expect(results).toEqual([]);
    expect(invokeFn).not.toHaveBeenCalled();
  });
});
