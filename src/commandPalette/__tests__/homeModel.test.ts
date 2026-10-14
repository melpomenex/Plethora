import { describe, expect, it } from "vitest";
import {
  buildResumeItem,
  deriveExpandedExamples,
  deriveResumeTopic,
  deriveSuggestions,
  formatFileTypeLabel,
  formatRelativeTime,
  formatResumeLocation,
  isEligibleDocument,
  isUnfinishedProgress,
  normalizeProgressPercent,
  selectRecentCandidate,
  selectResumeCandidate,
  type PaletteDocumentLike,
  type TranslateFn,
} from "../homeModel";
import type { RecentOpenEntry } from "../recentOpens";
import type { StartupProgressItem } from "../../types/startup";

/** Echo translator so assertions name the exact keys used. */
const t: TranslateFn = (key, vars) =>
  vars ? `${key}(${Object.values(vars).join(",")})` : key;

function doc(overrides: Partial<PaletteDocumentLike>): PaletteDocumentLike {
  return {
    id: "doc-1",
    title: "The-Doctrine-of-Fascism",
    fileType: "pdf",
    collectionId: "col-a",
    isArchived: false,
    isDismissed: false,
    progressPercent: 40,
    dateModified: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

function progressItem(overrides: Partial<StartupProgressItem> = {}): StartupProgressItem {
  return {
    id: "doc-1",
    progress: 40,
    title: "The-Doctrine-of-Fascism",
    date_modified: Date.parse("2026-10-01T10:00:00.000Z"),
    date_added: Date.parse("2026-09-01T10:00:00.000Z"),
    ...overrides,
  };
}

describe("homeModel progress normalization", () => {
  it("clamps to the shared 0–100 range and rejects unknown values", () => {
    expect(normalizeProgressPercent(40)).toBe(40);
    expect(normalizeProgressPercent(-5)).toBe(0);
    expect(normalizeProgressPercent(140)).toBe(100);
    expect(normalizeProgressPercent(Number.NaN)).toBeNull();
    expect(normalizeProgressPercent("40")).toBeNull();
    expect(normalizeProgressPercent(null)).toBeNull();
  });

  it("treats only strictly between 0 and 100 as unfinished", () => {
    expect(isUnfinishedProgress(1)).toBe(true);
    expect(isUnfinishedProgress(99)).toBe(true);
    expect(isUnfinishedProgress(0)).toBe(false);
    expect(isUnfinishedProgress(100)).toBe(false);
    expect(isUnfinishedProgress(null)).toBe(false);
  });

  it("excludes archived and dismissed documents", () => {
    expect(isEligibleDocument(doc({}))).toBe(true);
    expect(isEligibleDocument(doc({ isArchived: true }))).toBe(false);
    expect(isEligibleDocument(doc({ isDismissed: true }))).toBe(false);
    expect(isEligibleDocument(null)).toBe(false);
  });
});

describe("selectResumeCandidate", () => {
  it("prefers the active reader with a persisted position over startup progress", () => {
    const candidate = selectResumeCandidate({
      continueReading: [progressItem({ id: "newer", date_modified: Date.parse("2026-10-09T10:00:00.000Z") })],
      documents: [
        doc({ id: "reader", currentPage: 137 }),
        doc({ id: "newer" }),
      ],
      activeCollectionId: "col-a",
      activeReaderDocumentId: "reader",
    });
    expect(candidate?.documentId).toBe("reader");
    expect(candidate?.source).toBe("active-reader");
  });

  it("ignores an active reader with no persisted position and falls back to progress", () => {
    const candidate = selectResumeCandidate({
      continueReading: [progressItem({ id: "doc-2" })],
      documents: [
        doc({ id: "reader", progressPercent: 0, currentPage: null, currentScrollPercent: null, currentCfi: null, positionJson: null }),
        doc({ id: "doc-2" }),
      ],
      activeCollectionId: "col-a",
      activeReaderDocumentId: "reader",
    });
    expect(candidate?.documentId).toBe("doc-2");
    expect(candidate?.source).toBe("continue-reading");
  });

  it("rejects completed, archived, dismissed, and foreign-collection candidates", () => {
    expect(
      selectResumeCandidate({
        continueReading: [],
        documents: [doc({ id: "done", progressPercent: 100 })],
        activeCollectionId: "col-a",
        activeReaderDocumentId: "done",
      })
    ).toBeNull();

    expect(
      selectResumeCandidate({
        continueReading: [progressItem({ id: "archived" })],
        documents: [doc({ id: "archived", isArchived: true })],
        activeCollectionId: "col-a",
      })
    ).toBeNull();

    expect(
      selectResumeCandidate({
        continueReading: [progressItem({ id: "dismissed" })],
        documents: [doc({ id: "dismissed", isDismissed: true })],
        activeCollectionId: "col-a",
      })
    ).toBeNull();

    expect(
      selectResumeCandidate({
        continueReading: [progressItem({ id: "other-collection" })],
        documents: [doc({ id: "other-collection", collectionId: "col-z" })],
        activeCollectionId: "col-a",
      })
    ).toBeNull();
  });

  it("orders startup-progress candidates by modification time and normalizes progress", () => {
    const candidate = selectResumeCandidate({
      continueReading: [
        progressItem({ id: "old", progress: 20, date_modified: Date.parse("2026-09-01T00:00:00.000Z") }),
        progressItem({ id: "new", progress: 140, date_modified: Date.parse("2026-10-05T00:00:00.000Z") }),
      ],
      documents: [doc({ id: "old" }), doc({ id: "new" })],
      activeCollectionId: "col-a",
    });
    // 140 clamps to 100, which counts as completed and is excluded, leaving
    // the still-unfinished older item.
    expect(candidate?.documentId).toBe("old");
    expect(candidate?.progressPercent).toBe(20);
  });

  it("uses the cached-document fallback when the startup projection is empty", () => {
    const candidate = selectResumeCandidate({
      continueReading: null,
      documents: [
        doc({ id: "stale", progressPercent: 10, dateModified: "2026-01-01T00:00:00.000Z" }),
        doc({ id: "fresh", progressPercent: 55, dateModified: "2026-10-01T00:00:00.000Z" }),
      ],
      activeCollectionId: "col-a",
    });
    expect(candidate?.documentId).toBe("fresh");
    expect(candidate?.progressPercent).toBe(55);
  });
});

describe("selectRecentCandidate", () => {
  it("prefers the most recently opened eligible document", () => {
    const recentOpens: RecentOpenEntry[] = [
      { documentId: "opened", openedAt: 500 },
      { documentId: "older", openedAt: 100 },
    ];
    const candidate = selectRecentCandidate({
      documents: [
        doc({ id: "opened", dateModified: "2026-01-01T00:00:00.000Z" }),
        doc({ id: "edited", dateModified: "2026-10-10T00:00:00.000Z" }),
      ],
      activeCollectionId: "col-a",
      recentOpens,
    });
    expect(candidate?.documentId).toBe("opened");
    expect(candidate?.source).toBe("opened");
  });

  it("skips an ineligible recorded open and falls back to modification order with honest wording", () => {
    const candidate = selectRecentCandidate({
      documents: [
        doc({ id: "archived", isArchived: true }),
        doc({ id: "edited", dateModified: "2026-10-10T00:00:00.000Z" }),
      ],
      activeCollectionId: "col-a",
      recentOpens: [{ documentId: "archived", openedAt: 900 }],
    });
    expect(candidate?.documentId).toBe("edited");
    expect(candidate?.source).toBe("modified");
    expect(candidate?.openedAt).toBeNull();
  });

  it("returns null for an empty library", () => {
    expect(
      selectRecentCandidate({ documents: [], activeCollectionId: "col-a", recentOpens: [] })
    ).toBeNull();
  });

  it("keeps a recorded open whose summary left the bounded cache", () => {
    const candidate = selectRecentCandidate({
      documents: [],
      activeCollectionId: "col-a",
      recentOpens: [{ documentId: "not-cached", openedAt: 42, title: "Cached title", fileType: "epub" }],
    });
    expect(candidate).toMatchObject({
      documentId: "not-cached",
      title: "Cached title",
      source: "opened",
    });
  });
});

describe("buildResumeItem / formatting", () => {
  it("uses real metadata and never fabricates a reading timestamp", () => {
    const candidate = {
      documentId: "doc-1",
      title: "The-Doctrine-of-Fascism",
      fileType: "pdf" as const,
      progressPercent: 40,
      dateModifiedMs: Date.parse("2026-10-01T10:00:00.000Z"),
      source: "continue-reading" as const,
    };
    const item = buildResumeItem({
      candidate,
      document: doc({ currentPage: 137, totalPages: 342, coverImageUrl: null }),
      translate: t,
      now: Date.parse("2026-10-01T14:00:00.000Z"),
    });
    expect(item.progressPercent).toBe(40);
    expect(item.pageCount).toBe(342);
    expect(item.coverUrl).toBeNull();
    expect(item.passage).toBeNull();
    // A modification time is labeled as such, never as reading activity.
    expect(item.timestampKind).toBe("modified");
    expect(item.timestampLeadKey).toBe("lastUpdated");
    expect(item.timestampLabel).toContain("palette.time.hoursAgo");
    expect(item.locationLabel).toBe("palette.locationPage(137)");
  });

  it("formats media positions from persisted time, not percentages", () => {
    const item = buildResumeItem({
      candidate: {
        documentId: "a",
        title: "Audio",
        fileType: "audio",
        progressPercent: 30,
        dateModifiedMs: null,
        source: "progress",
      },
      document: doc({
        id: "a",
        fileType: "audio",
        positionJson: JSON.stringify({ currentTime: 728 }),
      }),
      translate: t,
    });
    expect(item.locationLabel).toBe("12:08");
    expect(item.timestampLabel).toBeNull();
    expect(item.timestampKind).toBeNull();
  });

  it("returns null location/labels when nothing real is persisted", () => {
    const item = buildResumeItem({
      candidate: {
        documentId: "a",
        title: "Unknown",
        fileType: "epub",
        progressPercent: null,
        dateModifiedMs: null,
        source: "progress",
      },
      document: doc({ id: "a", fileType: "epub", progressPercent: null, currentPage: null, currentScrollPercent: null }),
      translate: t,
    });
    expect(item.locationLabel).toBeNull();
    expect(item.progressPercent).toBeNull();
    expect(item.pageCount).toBeNull();
    expect(item.formatLabel).toBe("palette.fileType.epub");
  });

  it("never derives an EPUB page from a percentage", () => {
    const location = formatResumeLocation(
      doc({ fileType: "epub", currentPage: null, currentScrollPercent: 62 }),
      t
    );
    expect(location).toBe("62%");
  });

  it("labels relative times with translated units", () => {
    const now = Date.parse("2026-10-01T12:00:00.000Z");
    expect(formatRelativeTime(now - 10_000, t, now)).toBe("palette.time.justNow");
    expect(formatRelativeTime(now - 5 * 60_000, t, now)).toBe("palette.time.minutesAgo(5)");
    expect(formatRelativeTime(now - 4 * 3_600_000, t, now)).toBe("palette.time.hoursAgo(4)");
    expect(formatRelativeTime(now - 3 * 86_400_000, t, now)).toBe("palette.time.daysAgo(3)");
  });

  it("labels file types and rejects unknown ones with the generic label", () => {
    expect(formatFileTypeLabel("pdf", t)).toBe("palette.fileType.pdf");
    expect(formatFileTypeLabel(null, t)).toBeNull();
    expect(
      formatFileTypeLabel("weird" as PaletteDocumentLike["fileType"], t)
    ).toBe("palette.fileType.other");
  });
});

describe("suggestions", () => {
  it("produces the four reference roles in order with honest fallbacks", () => {
    const suggestions = deriveSuggestions({
      resume: null,
      topic: null,
      translate: t,
    });
    expect(suggestions.map((s) => s.role)).toEqual(["themes", "summary", "related", "review"]);
    expect(suggestions[1].label).toBe("palette.suggest.summaryGeneric");
    expect(suggestions[1].personalized).toBe(false);
    expect(suggestions[1].documentId).toBeUndefined();
    expect(suggestions[2].label).toBe("palette.suggest.relatedGeneric");
    expect(suggestions[2].query).toBe("");
  });

  it("personalizes the summary and related prompts from real data", () => {
    const suggestions = deriveSuggestions({
      resume: {
        documentId: "doc-1",
        title: "The-Doctrine-of-Fascism",
        fileType: "pdf",
        progressPercent: 40,
        coverUrl: null,
        pageCount: 342,
        formatLabel: null,
        locationLabel: null,
        timestampLabel: null,
        timestampKind: null,
        passage: null,
        timestampLeadKey: null,
        sourceUrl: null,
      },
      topic: "totalitarianism",
      translate: t,
    });
    expect(suggestions[1].label).toBe("palette.suggest.summaryDoc(The-Doctrine-of-Fascism)");
    expect(suggestions[1].documentId).toBe("doc-1");
    expect(suggestions[2].label).toBe("palette.suggest.relatedTopic(totalitarianism)");
    expect(suggestions[2].query).toBe("totalitarianism");
  });

  it("derives the topic from tag, then category, then subject", () => {
    expect(deriveResumeTopic(doc({ tags: ["history"], category: "politics" }))).toBe("history");
    expect(deriveResumeTopic(doc({ tags: [], category: "politics" }))).toBe("politics");
    expect(
      deriveResumeTopic(doc({ tags: [], category: null, metadata: { subject: "Political theory" } }))
    ).toBe("Political theory");
    expect(deriveResumeTopic(doc({ tags: [], category: null, metadata: null }))).toBeNull();
    expect(deriveResumeTopic(null)).toBeNull();
  });

  it("expanded examples are bounded, generic, and route to real outcomes", () => {
    const examples = deriveExpandedExamples(t);
    expect(examples.length).toBeGreaterThan(0);
    expect(examples.length).toBeLessThanOrEqual(6);
    for (const example of examples) {
      expect(example.personalized).toBe(false);
      expect(example.documentId).toBeUndefined();
      expect(example.label.startsWith("palette.example.")).toBe(true);
    }
    // Related examples carry a real query; review examples route to review.
    expect(examples.some((e) => e.role === "related" && e.query)).toBe(true);
    expect(examples.some((e) => e.role === "review")).toBe(true);
  });
});
