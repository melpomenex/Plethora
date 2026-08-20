import { describe, expect, it } from "vitest";
import { rankLanguageRecommendations } from "../index";

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
});
