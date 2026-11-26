import { beforeEach, describe, expect, it, vi } from "vitest";
import * as languageEcosystemApi from "../../../api/languageEcosystem";
import type { Document } from "../../../types/document";
import { dispatchTopLanguagePracticeRecommendation } from "../../languagePractice";
import {
  collectLibraryRecommendationCandidates,
  dismissCandidate,
  markCandidateImported,
  rankLanguageRecommendations,
  snoozeCandidate,
  type RecommendationCandidate,
} from "../index";

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    title: "Viaje por España",
    filePath: "/docs/viaje.epub",
    fileType: "epub",
    content: "Hola mundo viajar",
    contentHash: "hash-1",
    tags: ["travel"],
    dateAdded: "2026-11-20T00:00:00Z",
    dateModified: "2026-11-25T00:00:00Z",
    extractCount: 0,
    learningItemCount: 0,
    priorityRating: 3,
    prioritySlider: 50,
    priorityScore: 50,
    isArchived: false,
    isFavorite: false,
    metadata: { language: "es" },
    ...overrides,
  };
}

describe("language recommendations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ranks 95% known coverage above 10% known coverage and pending coverage while suppressing duplicates", () => {
    const ranked = rankLanguageRecommendations(
      [
        {
          id: "hard-10",
          profileId: "p",
          sourceType: "rss",
          sourceId: "a",
          sourceFingerprint: "1",
          title: "Dense Legal Brief",
          topics: ["travel"],
          coverageStatus: "fresh",
          coveragePercent: 10,
          qualityScore: 0.9,
          freshnessScore: 1,
          lifecycle: "candidate",
        },
        {
          id: "sweet-spot-95",
          profileId: "p",
          sourceType: "rss",
          sourceId: "b",
          sourceFingerprint: "2",
          title: "Travel Blog",
          topics: ["travel"],
          coverageStatus: "fresh",
          coveragePercent: 95,
          reinforcingLearningCount: 4,
          recentEncounterCount: 3,
          qualityScore: 0.9,
          freshnessScore: 1,
          lifecycle: "analyzed",
        },
        {
          id: "duplicate",
          profileId: "p",
          sourceType: "rss",
          sourceId: "c",
          sourceFingerprint: "2",
          title: "Copy",
          topics: ["travel"],
          coverageStatus: "fresh",
          coveragePercent: 95,
          qualityScore: 1,
          freshnessScore: 1,
          duplicateOf: "sweet-spot-95",
          lifecycle: "recommended",
        },
        {
          id: "pending",
          profileId: "p",
          sourceType: "rss",
          sourceId: "d",
          sourceFingerprint: "3",
          title: "Pending",
          topics: ["travel"],
          coverageStatus: "pending",
          qualityScore: 0.9,
          freshnessScore: 1,
          lifecycle: "candidate",
        },
      ],
      ["travel"],
    );

    expect(ranked.map((item) => item.id)).toEqual(["sweet-spot-95", "hard-10", "pending"]);
    expect(ranked.some((candidate) => candidate.id === "duplicate")).toBe(false);

    const top = ranked[0]!;
    expect(top.vector.coverageFit).toBe(1);
    expect(top.explanation).toContain(
      "Approximately 95% of measured vocabulary is familiar (in your target range)",
    );
    expect(top.explanation).toContain("Reinforces 4 words you are currently learning");
    expect(top.explanation).toContain("Contains 3 words from recent encounters");
    expect(top.explanation).toContain("Matches your interest in travel");

    const hard = ranked[1]!;
    expect(hard.vector.coverageFit).toBe(0);
    expect(hard.explanation).toContain(
      "Approximately 10% familiar — much harder than preferred",
    );

    const pending = ranked[2]!;
    expect(pending.vector.coverageFit).toBe(0);
    expect(pending.explanation).toContain("Coverage pending analysis");
  });

  it("produces accurate explanations for slightly difficult, comfortable reading, and custom target ranges", () => {
    const base: Omit<RecommendationCandidate, "id" | "coveragePercent"> = {
      profileId: "p",
      sourceType: "library",
      sourceId: "s",
      sourceFingerprint: "fp",
      title: "Sample",
      topics: [],
      coverageStatus: "fresh",
      qualityScore: 0.8,
      freshnessScore: 0.8,
      lifecycle: "recommended",
    };

    const ranked = rankLanguageRecommendations(
      [
        { ...base, id: "slightly-hard", sourceId: "s1", coveragePercent: 82 },
        { ...base, id: "easy", sourceId: "s2", coveragePercent: 100 },
      ],
      [],
      Date.now(),
      { targetCoverageMin: 90, targetCoverageMax: 98 },
    );

    const slightlyHard = ranked.find((r) => r.id === "slightly-hard")!;
    expect(slightlyHard.explanation).toContain(
      "Approximately 82% familiar — slightly above your preferred difficulty",
    );
    expect(slightlyHard.vector.coverageFit).toBeCloseTo(1 - 8 / 30, 4);

    const easy = ranked.find((r) => r.id === "easy")!;
    expect(easy.explanation).toContain("Approximately 100% familiar — comfortable reading");
    expect(easy.vector.coverageFit).toBeCloseTo(0.9, 4);

    const customRange = rankLanguageRecommendations(
      [{ ...base, id: "custom", sourceId: "s3", coveragePercent: 82 }],
      [],
      Date.now(),
      { targetCoverageMin: 80, targetCoverageMax: 90 },
    );
    expect(customRange[0]?.vector.coverageFit).toBe(1);
    expect(customRange[0]?.explanation).toContain(
      "Approximately 82% of measured vocabulary is familiar (in your target range)",
    );
  });

  it("filters rankable lifecycles and handles snooze expiration", () => {
    const now = 1_700_000_000_000;
    const base: Omit<RecommendationCandidate, "id" | "lifecycle"> = {
      profileId: "p",
      sourceType: "library",
      sourceId: "doc",
      sourceFingerprint: "fp",
      title: "Doc",
      topics: [],
      coverageStatus: "fresh",
      coveragePercent: 94,
      qualityScore: 0.9,
      freshnessScore: 0.9,
    };

    const candidates: RecommendationCandidate[] = [
      { ...base, id: "c-candidate", sourceId: "1", lifecycle: "candidate" },
      { ...base, id: "c-analyzed", sourceId: "2", lifecycle: "analyzed" },
      { ...base, id: "c-recommended", sourceId: "3", lifecycle: "recommended" },
      { ...base, id: "c-discovered", sourceId: "4", lifecycle: "discovered" },
      { ...base, id: "c-pending-ret", sourceId: "5", lifecycle: "pending_retrieval" },
      { ...base, id: "c-pending-ana", sourceId: "6", lifecycle: "pending_analysis" },
      { ...base, id: "c-accepted", sourceId: "7", lifecycle: "accepted" },
      { ...base, id: "c-imported", sourceId: "8", lifecycle: "imported" },
      { ...base, id: "c-dismissed", sourceId: "9", lifecycle: "dismissed" },
      { ...base, id: "c-failed", sourceId: "10", lifecycle: "failed" },
      { ...base, id: "c-unavailable", sourceId: "11", lifecycle: "unavailable" },
      { ...base, id: "c-snoozed-active", sourceId: "12", lifecycle: "snoozed", snoozedUntil: now + 60_000 },
      { ...base, id: "c-snoozed-expired", sourceId: "13", lifecycle: "snoozed", snoozedUntil: now - 1_000 },
    ];

    const ranked = rankLanguageRecommendations(candidates, [], now);
    expect(ranked.map((r) => r.id).sort()).toEqual([
      "c-analyzed",
      "c-candidate",
      "c-recommended",
      "c-snoozed-expired",
    ]);
  });

  it("collects real corpus candidates without fabricating coverage and deduplicates across sources", () => {
    const now = Date.parse("2026-11-26T00:00:00Z");
    const docs: Document[] = [
      makeDoc({
        id: "doc-analyzed",
        title: "Madrid Travel Guide",
        contentHash: "fp-fresh",
        metadata: { language: "es-ES", url: "https://example.com/madrid?utm_source=rss" },
      }),
      makeDoc({
        id: "doc-unanalyzed",
        title: "Pending Story",
        contentHash: "fp-pending",
        metadata: { language: "es" },
      }),
      makeDoc({
        id: "doc-stale",
        title: "Edited Story",
        contentHash: "fp-new",
        metadata: { language: "es" },
      }),
      makeDoc({
        id: "doc-wrong-lang",
        title: "French Article",
        metadata: { language: "fr" },
      }),
    ];

    const coveragesByDocId: Record<string, languageEcosystemApi.LanguageCoverageResultRecord> = {
      "doc-analyzed": {
        coverageKey: "k1",
        documentId: "doc-analyzed",
        profileId: "prof-1",
        contentFingerprint: "fp-fresh",
        processorVersion: "1",
        lexiconStateVersion: "1",
        policyVersion: "1",
        thresholdVersion: "1",
        method: "lemma-aware",
        freshness: "fresh",
        summary: {
          coveragePercent: 93,
          difficultyScore: 22,
          stateCounts: { known: 90, familiar: 3, learning: 5, new: 7, unresolved: 0 },
        },
        updatedAt: now,
      },
      "doc-stale": {
        coverageKey: "k2",
        documentId: "doc-stale",
        profileId: "prof-1",
        contentFingerprint: "fp-old",
        processorVersion: "1",
        lexiconStateVersion: "1",
        policyVersion: "1",
        thresholdVersion: "1",
        method: "lemma-aware",
        freshness: "fresh",
        summary: { coveragePercent: 96, difficultyScore: 15 },
        updatedAt: now,
      },
    };

    const collected = collectLibraryRecommendationCandidates({
      profileId: "prof-1",
      targetLanguage: "es",
      documents: docs,
      coveragesByDocId,
      interests: ["travel", "cooking"],
      rssItems: [
        {
          id: "rss-dup",
          title: "Madrid Travel Guide",
          description: "Duplicate of already imported doc",
          content: "Madrid text",
          link: "https://example.com/madrid/",
          pubDate: "2026-11-25T10:00:00Z",
          categories: ["travel"],
          read: false,
          favorite: false,
          feedId: "feed-1",
          language: "es",
        },
        {
          id: "rss-fresh",
          title: "Spanish Cooking Basics",
          description: "Paella and tapas",
          content: "Cocina española",
          link: "https://example.com/cooking",
          pubDate: "2026-11-25T10:00:00Z",
          categories: ["cooking"],
          read: false,
          favorite: false,
          feedId: "feed-1",
          language: "es",
        },
      ],
      smartFeedItems: [
        {
          article_id: "sf-1",
          feed_id: "feed-1",
          feed_title: "Culture",
          url: "https://example.com/culture",
          title: "Museo del Prado",
          categories: ["art"],
          is_queued: false,
          is_read: false,
          date_added: "2026-11-25T12:00:00Z",
          summary: "Art in Madrid",
          decision: "INCLUDE",
          relevance_score: 0.88,
          ranking_score: 0.88,
          decision_reason: "Matches",
          matched_evidence: [],
          decision_source: "fast_local",
          evaluation_status: "completed",
          is_user_override: false,
          evaluated_at: "2026-11-25T12:00:00Z",
          also_in_smart_feeds: [],
          cluster_size: 1,
          cluster_members: [],
        },
      ],
      youtubeVideos: [
        {
          id: "yt-1",
          title: "Spanish Listening Practice",
          description: "No captions yet",
          channel: "Canal ES",
          channelId: "ch-1",
          duration: 320,
          viewCount: 100,
          uploadDate: "2026-11-24",
          thumbnail: "",
          publishDate: "2026-11-24",
          tags: ["travel"],
          category: "Education",
          liveContent: false,
          language: "es",
        },
      ],
      podcastEpisodes: [
        {
          id: "pod-1",
          feedId: "pf-1",
          guid: null,
          title: "Historias de viaje",
          description: "Episodio semanal",
          publishedDate: "2026-11-25T00:00:00Z",
          duration: 900,
          audioUrl: "https://example.com/pod1.mp3",
          audioType: "audio/mpeg",
          fileSize: null,
          imageUrl: null,
          link: "https://example.com/pod1",
          played: false,
          playbackPosition: 0,
          dateAdded: "2026-11-25T00:00:00Z",
          transcriptStatus: "completed",
          transcriptText: "Hola bienvenidos",
          language: "es",
        },
      ],
      generatedDocuments: [
        {
          id: "gen-1",
          profileId: "prof-1",
          actionKind: "graded-reader",
          targetCoverage: 95,
          promptSummary: "Story at target level",
          provenance: {},
          createdAt: Math.floor(now / 1000),
        },
      ],
      now,
    });

    expect(collected.some((c) => c.sourceId === "doc-wrong-lang")).toBe(false);

    const analyzed = collected.find((c) => c.sourceId === "doc-analyzed")!;
    expect(analyzed.coverageStatus).toBe("fresh");
    expect(analyzed.coveragePercent).toBe(93);
    expect(analyzed.reinforcingLearningCount).toBe(5);
    expect(analyzed.lifecycle).toBe("analyzed");

    const unanalyzed = collected.find((c) => c.sourceId === "doc-unanalyzed")!;
    expect(unanalyzed.coverageStatus).toBe("pending");
    expect(unanalyzed.coveragePercent).toBeUndefined();

    const stale = collected.find((c) => c.sourceId === "doc-stale")!;
    expect(stale.coverageStatus).toBe("stale");
    expect(stale.coveragePercent).toBeUndefined();

    const generated = collected.find((c) => c.sourceId === "gen-1")!;
    expect(generated.coverageStatus).toBe("pending");
    expect(generated.coveragePercent).toBeUndefined();

    const youtube = collected.find((c) => c.sourceId === "yt-1")!;
    expect(youtube.coverageStatus).toBe("unavailable");
    expect(youtube.coveragePercent).toBeUndefined();

    const podcast = collected.find((c) => c.sourceId === "pod-1")!;
    expect(podcast.coverageStatus).toBe("pending");
    expect(podcast.coveragePercent).toBeUndefined();

    const rssDup = collected.find((c) => c.sourceId === "rss-dup")!;
    expect(rssDup.duplicateOf).toBe(analyzed.id);

    const ranked = rankLanguageRecommendations(collected, ["travel", "cooking"], now);
    expect(ranked[0]?.id).toBe(analyzed.id);
    expect(ranked.some((r) => r.sourceId === "rss-dup")).toBe(false);
  });

  it("persists dismiss, snooze, and imported lifecycle transitions via upsertLanguageRecommendationCandidate", async () => {
    const upsertSpy = vi
      .spyOn(languageEcosystemApi, "upsertLanguageRecommendationCandidate")
      .mockImplementation(async (record) => record);

    const candidate: RecommendationCandidate = {
      id: "rss:art-1",
      profileId: "prof-1",
      sourceType: "rss",
      sourceId: "art-1",
      sourceFingerprint: "fp-1",
      title: "Artículo",
      url: "https://example.com/art-1",
      topics: ["news"],
      coverageStatus: "fresh",
      coveragePercent: 94,
      qualityScore: 0.85,
      freshnessScore: 0.9,
      lifecycle: "candidate",
    };

    const now = 1_700_000_000_000;
    const snoozed = await snoozeCandidate(candidate, 3_600_000, now);
    expect(snoozed.lifecycle).toBe("snoozed");
    expect(snoozed.snoozedUntil).toBe(now + 3_600_000);
    expect(rankLanguageRecommendations([snoozed], ["news"], now + 1_000)).toHaveLength(0);
    expect(
      rankLanguageRecommendations([snoozed], ["news"], now + 3_600_001).map((r) => r.id),
    ).toEqual(["rss:art-1"]);

    const dismissed = await dismissCandidate(candidate, now);
    expect(dismissed.lifecycle).toBe("dismissed");
    expect(rankLanguageRecommendations([dismissed], ["news"], now)).toHaveLength(0);

    const imported = await markCandidateImported(candidate, "doc-imported-1", now);
    expect(imported.lifecycle).toBe("imported");
    expect(imported.importedDocumentId).toBe("doc-imported-1");
    expect(rankLanguageRecommendations([imported], ["news"], now)).toHaveLength(0);

    expect(upsertSpy).toHaveBeenCalledTimes(3);
    expect(upsertSpy.mock.calls[0]?.[0].lifecycle).toBe("snoozed");
    expect(upsertSpy.mock.calls[1]?.[0].lifecycle).toBe("dismissed");
    expect(upsertSpy.mock.calls[2]?.[0].lifecycle).toBe("accepted");
    expect(upsertSpy.mock.calls[2]?.[0].explanation.detailedLifecycle).toBe("imported");
  });

  it("dispatches one explicit practice preview after ranking", () => {
    const dispatch = vi.spyOn(window, "dispatchEvent");
    const selected = dispatchTopLanguagePracticeRecommendation({
      candidates: [
        {
          id: "a",
          profileId: "p",
          sourceType: "rss",
          sourceId: "a",
          sourceFingerprint: "1",
          title: "Travel",
          topics: [],
          coverageStatus: "pending",
          qualityScore: 1,
          freshnessScore: 1,
          lifecycle: "candidate",
        },
      ],
      interests: [],
      detail: {
        hostId: "h",
        source: {
          source: { sourceType: "text", sourceId: "a" },
          contentType: "document",
          contentId: "a",
        },
        sourceAnchor: { sourceType: "text", sourceId: "a" },
        profileId: "p",
        languageTag: "es",
        origin: "reader",
      },
    });
    expect(selected?.id).toBe("a");
    expect(dispatch).toHaveBeenCalledOnce();
    dispatch.mockRestore();
  });
});
