import { describe, expect, it } from "vitest";
import { assertSyncPolicyCoverage, getSyncPolicy, listSyncPolicies } from "../sync/coverageRegistry";

describe("sync coverage registry", () => {
  it("declares the UX-critical domains and privacy exclusions", () => {
    assertSyncPolicyCoverage([
      "collections", "documents", "extracts", "learningItems", "reviews",
      "rssFeeds", "rssArticlesState", "podcastFeeds", "podcastEpisodes",
      "conversations", "fileManifest", "safePreferences", "derivedIndexes",
      "secrets", "devicePreferences", "fileAvailabilityIntent",
    ]);
    expect(getSyncPolicy("reviews")?.conflict).toBe("append-only");
    expect(getSyncPolicy("secrets")?.classification).toBe("secret");
  });

  it("requires every descriptor to state lane, conflict, deletion, and rationale", () => {
    expect(listSyncPolicies().every((policy) =>
      policy.lane && policy.conflict && policy.deletion && policy.rationale && policy.schemaVersion > 0 &&
      policy.hooks.exportLocal && policy.hooks.applyRemote && policy.hooks.audit,
    )).toBe(true);
  });
});
