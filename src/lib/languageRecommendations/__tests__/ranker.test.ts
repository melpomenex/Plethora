import { describe, expect, it, vi } from "vitest";
import { rankLanguageRecommendations } from "../index";
import { dispatchTopLanguagePracticeRecommendation } from "../../languagePractice";

describe("language recommendations", () => {
  it("ranks measured coverage and interests while suppressing duplicates", () => {
    const ranked = rankLanguageRecommendations([
      { id: "a", profileId: "p", sourceType: "rss", sourceId: "a", sourceFingerprint: "1", title: "Travel", topics: ["travel"], coverageStatus: "fresh", coveragePercent: 10, qualityScore: 0.9, freshnessScore: 1, lifecycle: "candidate" },
      { id: "duplicate", profileId: "p", sourceType: "rss", sourceId: "b", sourceFingerprint: "1", title: "Copy", topics: ["travel"], coverageStatus: "fresh", coveragePercent: 10, qualityScore: 1, freshnessScore: 1, duplicateOf: "a", lifecycle: "candidate" },
      { id: "pending", profileId: "p", sourceType: "rss", sourceId: "c", sourceFingerprint: "1", title: "Pending", topics: ["travel"], coverageStatus: "pending", qualityScore: 0.9, freshnessScore: 1, lifecycle: "candidate" },
    ], ["travel"]);
    expect(ranked[0]?.id).toBe("a");
    expect(ranked.some((candidate) => candidate.id === "duplicate")).toBe(false);
    expect(ranked.find((candidate) => candidate.id === "a")?.explanation).toContain("uses measured coverage");
  });

  it("dispatches one explicit practice preview after ranking", () => {
    const dispatch = vi.spyOn(window, "dispatchEvent");
    const selected = dispatchTopLanguagePracticeRecommendation({
      candidates: [{ id: "a", profileId: "p", sourceType: "rss", sourceId: "a", sourceFingerprint: "1", title: "Travel", topics: [], coverageStatus: "pending", qualityScore: 1, freshnessScore: 1, lifecycle: "candidate" }],
      interests: [],
      detail: { hostId: "h", source: { source: { sourceType: "text", sourceId: "a" }, contentType: "document", contentId: "a" }, sourceAnchor: { sourceType: "text", sourceId: "a" }, profileId: "p", languageTag: "es", origin: "reader" },
    });
    expect(selected?.id).toBe("a");
    expect(dispatch).toHaveBeenCalledOnce();
    dispatch.mockRestore();
  });
});
