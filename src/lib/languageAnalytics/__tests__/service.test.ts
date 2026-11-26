import { describe, expect, it, vi } from "vitest";
import type {
  LanguageAnalyticsDailyRecord,
  LanguageCoverageResultRecord,
} from "../../../api/languageEcosystem";
import type {
  LanguageKnowledgeExport,
  LanguageKnowledgeStateSnapshot,
} from "../../../types/languageKnowledge";
import type { LanguageLexicalEntry, LanguageLookupEvent, LexiconPage } from "../../../types/languageLexicon";
import type { PracticeAttempt } from "../../languagePractice/types";
import {
  buildEncounterIdempotencyKey,
  buildLookupIdempotencyKey,
  buildPracticeAttemptIdempotencyKey,
  buildReviewEvidenceIdempotencyKey,
  buildSessionIdempotencyKey,
  buildStateChangeIdempotencyKey,
  emitEncounterAnalyticsEvent,
  emitLanguageAnalyticsEvent,
  emitLookupAnalyticsEvent,
  emitPracticeAttemptAnalyticsEvent,
  emitReviewEvidenceAnalyticsEvent,
  emitStateChangeAnalyticsEvent,
  loadLanguageAnalyticsDashboardData,
  type LanguageAnalyticsLoaders,
} from "../index";

function createInMemoryRecorder() {
  const seenKeys = new Set<string>();
  const events: Array<{
    idempotencyKey: string;
    profileId: string;
    eventKind: string;
    payload?: Record<string, unknown>;
    occurredAt?: number;
  }> = [];
  const dailyMap = new Map<string, LanguageAnalyticsDailyRecord>();

  const recordEvent = async (input: {
    idempotencyKey: string;
    profileId: string;
    eventKind: string;
    payload?: Record<string, unknown>;
    occurredAt?: number;
  }): Promise<boolean> => {
    if (seenKeys.has(input.idempotencyKey)) return false;
    seenKeys.add(input.idempotencyKey);
    const occurredAt = input.occurredAt ?? Math.floor(Date.now() / 1000);
    events.push({ ...input, occurredAt });
    const dayUtc = new Date(occurredAt * 1000).toISOString().slice(0, 10);
    const mapKey = `${input.profileId}:${dayUtc}`;
    const existing = dailyMap.get(mapKey);
    if (existing) {
      existing.metrics[input.eventKind] = (existing.metrics[input.eventKind] ?? 0) + 1;
      existing.eventCursor += 1;
      existing.updatedAt = occurredAt;
    } else {
      dailyMap.set(mapKey, {
        profileId: input.profileId,
        dayUtc,
        metrics: { [input.eventKind]: 1 },
        eventCursor: 1,
        updatedAt: occurredAt,
      });
    }
    return true;
  };

  return { recordEvent, events, dailyMap };
}

function emptyLoaders(overrides: Partial<LanguageAnalyticsLoaders> = {}): LanguageAnalyticsLoaders {
  return {
    listDaily: async () => [],
    exportKnowledge: async () => ({
      schemaVersion: 1,
      profileId: "profile-1",
      exportedAt: 1_700_000_000,
      states: [],
      history: [],
      evidence: [],
      memorizationLinks: [],
    }),
    listKnowledgeStates: async () => ({ items: [], offset: 0, limit: 200, total: 0, hasMore: false }),
    listLexicalEntries: async () => ({ items: [], offset: 0, limit: 200, total: 0, hasMore: false }),
    listLookupEvents: async () => ({ items: [], offset: 0, limit: 200, total: 0, hasMore: false }),
    listPracticeAttempts: async () => [],
    getCoverageResults: async () => [],
    ...overrides,
  };
}

function makeEntry(overrides: Partial<LanguageLexicalEntry> & Pick<LanguageLexicalEntry, "id" | "normalizedForm">): LanguageLexicalEntry {
  return {
    profileId: "profile-1",
    languageTag: "es",
    objectKind: "token",
    lexicalKey: overrides.lemma ?? overrides.normalizedForm,
    canonicalForm: overrides.normalizedForm,
    meanings: [],
    translations: [],
    encounterCount: 1,
    documentCount: 1,
    lookupCount: 0,
    activeEvidenceCount: 0,
    passiveEvidenceCount: 0,
    reviewRelationships: {},
    ignored: false,
    properNoun: false,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
    version: 1,
    ...overrides,
  };
}

function makeAttempt(
  overrides: Partial<PracticeAttempt> & Pick<PracticeAttempt, "id" | "mode">,
): PracticeAttempt {
  return {
    profileId: "profile-1",
    source: { sourceType: "epub", sourceId: "doc-1" },
    promptText: "Hola mundo",
    status: "submitted",
    recordingPolicy: { allowMicrophone: false, persistRecording: false, privacy: "local-only" },
    activeEvidenceAccepted: true,
    createdAt: 1_700_050_000,
    updatedAt: 1_700_050_000,
    ...overrides,
  };
}

describe("languageAnalytics idempotent event tracking", () => {
  it("normalizes ms timestamps to seconds and deduplicates reopened docs and repeated submits", async () => {
    const store = createInMemoryRecorder();
    const occurredMs = Date.UTC(2026, 4, 10, 12, 30, 0);

    const firstEncounter = await emitEncounterAnalyticsEvent({
      profileId: "profile-1",
      entryId: "entry-hablo",
      lemma: "hablar",
      surface: "hablo",
      documentId: "doc-1",
      contentFingerprint: "fp-1",
      sentenceId: "s-1",
      tokenId: "t-4",
      occurredAt: occurredMs,
      recordEvent: store.recordEvent,
    });
    // Reopening the exact same document/token produces the identical deterministic key.
    const duplicateEncounter = await emitEncounterAnalyticsEvent({
      profileId: "profile-1",
      entryId: "entry-hablo",
      lemma: "hablar",
      surface: "hablo",
      documentId: "doc-1",
      contentFingerprint: "fp-1",
      sentenceId: "s-1",
      tokenId: "t-4",
      occurredAt: occurredMs + 60_000,
      recordEvent: store.recordEvent,
    });

    expect(firstEncounter).toBe(true);
    expect(duplicateEncounter).toBe(false);
    expect(store.events).toHaveLength(1);
    expect(store.events[0]?.occurredAt).toBe(Math.floor(occurredMs / 1000));
    expect(store.dailyMap.get("profile-1:2026-05-10")?.metrics["lexicon.encounter"]).toBe(1);

    const attempt = makeAttempt({
      id: "att-1",
      mode: "dictation",
      comparison: {
        exact: false,
        score: 0.75,
        expected: "Hola mundo",
        actual: "Ola mundo",
        normalizedExpected: "hola mundo",
        normalizedActual: "ola mundo",
        errors: [{ kind: "missing", expected: "hola", index: 0 }],
        uncertain: false,
      },
    });
    expect(await emitPracticeAttemptAnalyticsEvent({ attempt, recordEvent: store.recordEvent })).toBe(true);
    expect(await emitPracticeAttemptAnalyticsEvent({ attempt, recordEvent: store.recordEvent })).toBe(false);
  });

  it("never records UI re-renders, cache hits, reopened flags, or cache-render origins", async () => {
    const recorder = vi.fn(async () => true);

    expect(
      await emitLanguageAnalyticsEvent({
        profileId: "profile-1",
        eventKind: "reader.session",
        idempotencyKey: "k-1",
        isRerender: true,
        recordEvent: recorder,
      }),
    ).toBe(false);
    expect(
      await emitLookupAnalyticsEvent({
        profileId: "profile-1",
        surface: "casa",
        isCacheHit: true,
        recordEvent: recorder,
      }),
    ).toBe(false);
    expect(
      await emitEncounterAnalyticsEvent({
        profileId: "profile-1",
        surface: "casa",
        isReopenedDocument: true,
        recordEvent: recorder,
      }),
    ).toBe(false);
    expect(
      await emitStateChangeAnalyticsEvent({
        profileId: "profile-1",
        entryId: "e-1",
        previousState: "new",
        nextState: "learning",
        origin: "cache-render",
        recordEvent: recorder,
      }),
    ).toBe(false);
    expect(recorder).not.toHaveBeenCalled();
  });

  it("never throws on UI paths when persistence rejects", async () => {
    const failingRecorder = vi.fn(async () => {
      throw new Error("sqlite busy");
    });

    await expect(
      emitReviewEvidenceAnalyticsEvent({
        profileId: "profile-1",
        reviewId: "rev-1",
        retained: true,
        recordEvent: failingRecorder,
      }),
    ).resolves.toBe(false);
    expect(failingRecorder).toHaveBeenCalledTimes(1);
  });

  it("builds deterministic keys per event category", () => {
    expect(
      buildEncounterIdempotencyKey({ profileId: "p", occurrenceKey: "occ-1" }),
    ).toBe("encounter:p:occ-1");
    expect(
      buildLookupIdempotencyKey({ profileId: "p", lookupId: "lk-1" }),
    ).toBe("lookup:p:lk-1");
    expect(
      buildStateChangeIdempotencyKey({
        profileId: "p",
        operationId: "op-1",
        entryId: "e-1",
        previousState: "new",
        nextState: "known",
      }),
    ).toBe("state-change:p:op-1");
    expect(
      buildPracticeAttemptIdempotencyKey({ profileId: "p", attemptId: "a-1", mode: "writing" }),
    ).toBe("practice:p:a-1:writing:submitted");
    expect(
      buildReviewEvidenceIdempotencyKey({ profileId: "p", reviewId: "r-1" }),
    ).toBe("srs-review:p:r-1");
    expect(
      buildSessionIdempotencyKey({ profileId: "p", kind: "reader.session", sessionId: "s-1" }),
    ).toBe("session:reader.session:p:s-1");
  });
});

describe("loadLanguageAnalyticsDashboardData", () => {
  it("distinguishes lemma counts from exact-form counts and respects ignored entries", async () => {
    const from = Date.UTC(2026, 4, 1);
    const to = Date.UTC(2026, 4, 15);
    const inRangeSec = Math.floor(Date.UTC(2026, 4, 5) / 1000);

    const entries: LanguageLexicalEntry[] = [
      // Three exact forms of lemma "hablar" -> 1 lemma ("known") vs 3 exact forms!
      makeEntry({ id: "e1", normalizedForm: "hablo", lemma: "hablar", knowledgeState: "known", encounterCount: 6, firstEncounteredAt: inRangeSec, lastEncounteredAt: inRangeSec }),
      makeEntry({ id: "e2", normalizedForm: "hablas", lemma: "hablar", knowledgeState: "familiar", encounterCount: 2, firstEncounteredAt: inRangeSec, lastEncounteredAt: inRangeSec }),
      makeEntry({ id: "e3", normalizedForm: "hablando", lemma: "hablar", knowledgeState: "learning", encounterCount: 1, firstEncounteredAt: inRangeSec, lastEncounteredAt: inRangeSec }),
      // Two forms of "comer" -> 1 lemma ("learning") vs 2 exact forms
      makeEntry({ id: "e4", normalizedForm: "como", lemma: "comer", knowledgeState: "learning", encounterCount: 3, lookupCount: 2, firstEncounteredAt: inRangeSec, lastEncounteredAt: inRangeSec }),
      makeEntry({ id: "e5", normalizedForm: "comiendo", lemma: "comer", knowledgeState: "encountered", encounterCount: 1, firstEncounteredAt: inRangeSec, lastEncounteredAt: inRangeSec }),
      // One "new" form + one "ignored" form
      makeEntry({ id: "e6", normalizedForm: "ventana", lemma: "ventana", knowledgeState: "new", encounterCount: 1, lookupCount: 3, firstEncounteredAt: inRangeSec, lastEncounteredAt: inRangeSec }),
      makeEntry({ id: "e7", normalizedForm: "xyz", lemma: "xyz", knowledgeState: "new", ignored: true, encounterCount: 1, firstEncounteredAt: inRangeSec, lastEncounteredAt: inRangeSec }),
    ];

    const data = await loadLanguageAnalyticsDashboardData(
      "profile-1",
      { from, to, timeZone: "UTC" },
      {
        now: inRangeSec * 1000 + 60_000,
        loaders: emptyLoaders({
          listLexicalEntries: async (_pid, opts) => {
            const offset = opts?.offset ?? 0;
            const page1 = entries.slice(0, 4);
            const page2 = entries.slice(4);
            if (offset === 0) {
              return { items: page1, offset: 0, limit: 4, total: entries.length, hasMore: true };
            }
            return { items: page2, offset: 4, limit: 4, total: entries.length, hasMore: false };
          },
          exportKnowledge: async () => ({
            schemaVersion: 1,
            profileId: "profile-1",
            exportedAt: inRangeSec,
            states: [
              { profileId: "profile-1", lexicalEntryId: "e1", state: "known", manualOverride: false, passiveEvidence: 4, activeEvidence: 2, updatedAt: inRangeSec, version: 1 },
            ] satisfies LanguageKnowledgeStateSnapshot[],
            history: [],
            evidence: [],
            memorizationLinks: [],
          }),
        }),
      },
    );

    expect(data.vocabulary.exactForms).toEqual({
      known: 1,
      familiar: 1,
      learning: 2,
      new: 1,
      encountered: 1,
      ignored: 1,
      totalActive: 6,
      total: 7,
    });
    expect(data.vocabulary.lemmas).toEqual({
      known: 1, // hablar (max of known/familiar/learning)
      familiar: 0,
      learning: 1, // comer (max of learning/encountered)
      new: 1, // ventana
      encountered: 0,
      ignored: 1, // xyz
      totalActive: 3,
      total: 4,
    });
    expect(data.metrics["vocabulary.known_lemmas"]?.value).toBe(1);
    expect(data.metrics["vocabulary.learning_lemmas"]?.value).toBe(1);
    expect(data.metrics["vocabulary.new_lemmas"]?.value).toBe(1);
  });

  it("applies date-range filtering across daily rollups, history, lookups, practice, and coverage", async () => {
    const from = Date.UTC(2026, 4, 5);
    const to = Date.UTC(2026, 4, 10);
    const outBeforeSec = Math.floor(Date.UTC(2026, 4, 2) / 1000);
    const day6Sec = Math.floor(Date.UTC(2026, 4, 6, 10) / 1000);
    const day8Sec = Math.floor(Date.UTC(2026, 4, 8, 14) / 1000);
    const outAfterSec = Math.floor(Date.UTC(2026, 4, 12) / 1000);

    const entries: LanguageLexicalEntry[] = [
      makeEntry({ id: "e1", normalizedForm: "viajar", lemma: "viajar", knowledgeState: "known", encounterCount: 5, lookupCount: 3, firstEncounteredAt: day6Sec, lastEncounteredAt: day8Sec }),
      makeEntry({ id: "e2", normalizedForm: "antiguo", lemma: "antiguo", knowledgeState: "known", encounterCount: 4, lookupCount: 2, firstEncounteredAt: outBeforeSec, lastEncounteredAt: outBeforeSec }),
    ];

    const knowledgeExport: LanguageKnowledgeExport = {
      schemaVersion: 1,
      profileId: "profile-1",
      exportedAt: day8Sec,
      states: [],
      history: [
        { id: "h0", profileId: "profile-1", lexicalEntryId: "e2", previousState: "learning", newState: "known", source: "manual", operationId: "op0", changedAt: outBeforeSec },
        { id: "h1", profileId: "profile-1", lexicalEntryId: "e1", previousState: "learning", newState: "known", source: "manual", operationId: "op1", changedAt: day8Sec },
        { id: "h2", profileId: "profile-1", lexicalEntryId: "e1", previousState: "known", newState: "familiar", source: "undo", operationId: "op2", changedAt: outAfterSec },
      ],
      evidence: [
        { id: "ev0", profileId: "profile-1", lexicalEntryId: "e2", kind: "recognition", confidence: 0.9, metadata: {}, occurredAt: outBeforeSec },
        { id: "ev1", profileId: "profile-1", lexicalEntryId: "e1", kind: "recognition", confidence: 0.8, metadata: {}, occurredAt: day6Sec },
        { id: "ev2", profileId: "profile-1", lexicalEntryId: "e1", kind: "production", confidence: 0.95, metadata: {}, occurredAt: day8Sec },
      ],
      memorizationLinks: [],
    };

    const lookupEvents: LanguageLookupEvent[] = [
      { id: "lk0", profileId: "profile-1", lexicalEntryId: "e2", surface: "antiguo", normalized: "antiguo", documentId: "doc-0", lookedUpAt: outBeforeSec },
      { id: "lk1", profileId: "profile-1", lexicalEntryId: "e1", surface: "viajar", normalized: "viajar", documentId: "doc-1", lookedUpAt: day6Sec },
      { id: "lk2", profileId: "profile-1", lexicalEntryId: "e1", surface: "viajar", normalized: "viajar", documentId: "doc-1", lookedUpAt: day8Sec },
    ];

    const daily: LanguageAnalyticsDailyRecord[] = [
      { profileId: "profile-1", dayUtc: "2026-05-02", metrics: { "lexicon.encounter": 99, "reader.session": 5 }, eventCursor: 104, updatedAt: outBeforeSec },
      { profileId: "profile-1", dayUtc: "2026-05-06", metrics: { "lexicon.encounter": 4, "lexicon.lookup": 1, "reader.session": 1, "reader.duration_seconds": 600, "reader.tokens": 500 }, eventCursor: 6, updatedAt: day6Sec },
      { profileId: "profile-1", dayUtc: "2026-05-08", metrics: { "lexicon.encounter": 6, "lexicon.lookup": 1, "knowledge.state-change": 1, "listening.session": 2, "listening.duration_seconds": 300, "listening.sentences": 12, "srs.review": 4, "srs.retained": 3 }, eventCursor: 9, updatedAt: day8Sec },
      { profileId: "profile-1", dayUtc: "2026-05-12", metrics: { "lexicon.encounter": 50 }, eventCursor: 50, updatedAt: outAfterSec },
    ];

    const attempts: PracticeAttempt[] = [
      makeAttempt({
        id: "att-out",
        mode: "writing",
        createdAt: outBeforeSec,
        updatedAt: outBeforeSec,
        comparison: { exact: false, score: 0.2, expected: "a", actual: "b", normalizedExpected: "a", normalizedActual: "b", errors: [{ kind: "substitution", index: 0 }], uncertain: false },
      }),
      makeAttempt({
        id: "att-dict",
        mode: "dictation",
        createdAt: day6Sec,
        updatedAt: day6Sec,
        comparison: {
          exact: false,
          score: 0.5,
          expected: "él viajó",
          actual: "el viajo",
          normalizedExpected: "él viajó",
          normalizedActual: "el viajo",
          errors: [
            { kind: "diacritic", expected: "él", actual: "el", index: 0 },
            { kind: "missing", expected: "hoy", index: 2 },
          ],
          uncertain: false,
        },
      }),
      makeAttempt({
        id: "att-write",
        mode: "writing",
        createdAt: day8Sec,
        updatedAt: day8Sec,
        comparison: {
          exact: true,
          score: 1,
          expected: "Quiero viajar",
          actual: "Quiero viajar",
          normalizedExpected: "quiero viajar",
          normalizedActual: "quiero viajar",
          errors: [],
          uncertain: false,
        },
      }),
      makeAttempt({
        id: "att-pron",
        mode: "pronunciation",
        createdAt: day8Sec,
        updatedAt: day8Sec,
        activeEvidenceAccepted: false,
        comparison: {
          exact: false,
          score: 0.8,
          expected: "buenos días",
          actual: "bueno días",
          normalizedExpected: "buenos días",
          normalizedActual: "bueno días",
          errors: [{ kind: "substitution", expected: "buenos", actual: "bueno", index: 0 }],
          uncertain: false,
        },
      }),
      makeAttempt({
        id: "att-cancelled",
        mode: "writing",
        status: "cancelled",
        createdAt: day8Sec,
        updatedAt: day8Sec,
      }),
    ];

    const coverage: LanguageCoverageResultRecord[] = [
      {
        coverageKey: "cov-out",
        documentId: "doc-0",
        profileId: "profile-1",
        contentFingerprint: "fp0",
        processorVersion: "1",
        lexiconStateVersion: "1",
        policyVersion: "1",
        thresholdVersion: "1",
        method: "phrase-aware",
        freshness: "fresh",
        summary: { totalCountedTokens: 100, stateCounts: { known: 10, new: 90, unresolved: 0 }, coveragePercent: 10, difficultyScore: 80 },
        computedAt: outBeforeSec,
        updatedAt: outBeforeSec,
      },
      {
        coverageKey: "cov-1",
        documentId: "doc-1",
        profileId: "profile-1",
        contentFingerprint: "fp1",
        processorVersion: "1",
        lexiconStateVersion: "1",
        policyVersion: "1",
        thresholdVersion: "1",
        method: "phrase-aware",
        freshness: "fresh",
        summary: { totalCountedTokens: 200, stateCounts: { known: 120, new: 50, unresolved: 10 }, coveragePercent: 70, knownCoveragePercent: 60, unknownPercent: 30, difficultyScore: 35, difficultyBand: "productive-challenge" },
        computedAt: day6Sec,
        updatedAt: day6Sec,
      },
      {
        coverageKey: "cov-2",
        documentId: "doc-2",
        profileId: "profile-1",
        contentFingerprint: "fp2",
        processorVersion: "1",
        lexiconStateVersion: "1",
        policyVersion: "1",
        thresholdVersion: "1",
        method: "phrase-aware",
        freshness: "pending",
        summary: { totalCountedTokens: 500, stateCounts: { known: 0, new: 500, unresolved: 0 }, coveragePercent: 0, difficultyScore: 99 },
        computedAt: day8Sec,
        updatedAt: day8Sec,
      },
    ];

    const data = await loadLanguageAnalyticsDashboardData(
      "profile-1",
      { from, to, timeZone: "UTC" },
      {
        now: day8Sec * 1000 + 60_000,
        loaders: emptyLoaders({
          listDaily: async () => daily,
          exportKnowledge: async () => knowledgeExport,
          listLexicalEntries: async () => ({ items: entries, offset: 0, limit: 200, total: entries.length, hasMore: false }),
          listLookupEvents: async () => ({ items: lookupEvents, offset: 0, limit: 200, total: lookupEvents.length, hasMore: false }),
          listPracticeAttempts: async () => attempts,
          getCoverageResults: async () => coverage,
        }),
      },
    );

    // Date-filtered daily series (2026-05-02 and 2026-05-12 excluded).
    expect(data.vocabGrowthByDay.map((d) => d.dayUtc)).toEqual(["2026-05-06", "2026-05-08"]);
    expect(data.vocabGrowthByDay[0]).toMatchObject({
      dayUtc: "2026-05-06",
      encounters: 4,
      lookups: 1,
      newLemmas: 1,
      newExactForms: 1,
      readingSessions: 1,
      cumulativeKnownLemmas: 1, // baseline e2 known before range
    });
    expect(data.vocabGrowthByDay[1]).toMatchObject({
      dayUtc: "2026-05-08",
      encounters: 6,
      knownTransitions: 1,
      cumulativeKnownLemmas: 2, // e2 + newly known e1
      listeningSessions: 2,
      srsReviews: 4,
    });

    // Lookups & repetition in range.
    expect(data.lookups.totalLookupsInRange).toBe(2);
    expect(data.lookups.lookupsPer1000Words).toBeCloseTo(4, 5); // 2 / 500 * 1000
    expect(data.lookups.uniqueEntriesLookedUp).toBe(1);
    expect(data.lookups.repeatedLookupEntries).toBe(1);
    expect(data.lookups.repetitionRate).toBe(1);
    expect(data.lookups.topRepeatedLookups[0]?.entryId).toBe("e1");

    // Reading & listening.
    expect(data.activity.reading).toEqual({
      status: "ready",
      sessions: 1,
      minutes: 10,
      tokens: 500,
    });
    expect(data.activity.listening).toEqual({
      status: "ready",
      sessions: 2,
      minutes: 5,
      sentences: 12,
    });

    // Practice modes & error category breakdowns (cancelled and out-of-range excluded).
    expect(data.activity.practice.submittedAttempts).toBe(3);
    expect(data.activity.practice.acceptedActiveAttempts).toBe(2);
    expect(data.activity.practice.totalErrors).toBe(3);
    expect(data.activity.practice.errorsByCategory).toEqual({
      missing: 1,
      extra: 0,
      substitution: 1,
      punctuation: 0,
      diacritic: 1,
      order: 0,
      script: 0,
    });
    expect(data.activity.practice.byMode.dictation.errorsByCategory.diacritic).toBe(1);
    expect(data.activity.practice.byMode.dictation.errorsByCategory.missing).toBe(1);
    expect(data.activity.practice.byMode.writing.exactCount).toBe(1);
    expect(data.activity.practice.byMode.pronunciation.errorsByCategory.substitution).toBe(1);

    // Active vs passive separation.
    expect(data.evidence.passive.count).toBe(12); // 1 recognition + 1 unaccepted pron + 10 daily encounters
    expect(data.evidence.active.count).toBe(7); // 1 production + 2 accepted practice + 4 srs
    expect(data.evidence.srs.retentionRate).toBeCloseTo(0.75, 5);

    // Coverage excludes pending document from ratio/difficulty averages!
    expect(data.coverage.readyDocuments).toBe(1);
    expect(data.coverage.pendingDocuments).toBe(1);
    expect(data.coverage.averageCoverageRatio).toBeCloseTo(0.6, 5); // 120 / 200
    expect(data.coverage.averageDifficultyScore).toBe(35);
    expect(data.coverage.progression).toHaveLength(2);
    expect(data.coverage.progression[1]?.freshness).toBe("pending");
    expect(data.coverage.progression[1]?.coverageRatio).toBeNull();
  });

  it("reports honest insufficient-evidence and unavailable states without inventing CEFR or zeros", async () => {
    const from = Date.UTC(2026, 4, 1);
    const to = Date.UTC(2026, 4, 10);

    const empty = await loadLanguageAnalyticsDashboardData(
      "profile-empty",
      { from, to, timeZone: "UTC" },
      { now: to, loaders: emptyLoaders() },
    );

    expect(empty.vocabulary.status).toBe("insufficient-evidence");
    expect(empty.evidence.status).toBe("insufficient-evidence");
    expect(empty.evidence.passive.averageConfidence).toBeNull();
    expect(empty.evidence.active.averageConfidence).toBeNull();
    expect(empty.evidence.srs.retentionRate).toBeNull();
    expect(empty.lookups.status).toBe("insufficient-evidence");
    expect(empty.lookups.lookupsPer1000Words).toBeNull();
    expect(empty.lookups.repetitionRate).toBeNull();
    expect(empty.activity.reading.status).toBe("insufficient-evidence");
    expect(empty.activity.reading.minutes).toBeNull();
    expect(empty.activity.listening.status).toBe("insufficient-evidence");
    expect(empty.activity.practice.status).toBe("insufficient-evidence");
    expect(empty.activity.practice.averageScore).toBeNull();
    expect(empty.activity.practice.byMode.pronunciation.status).toBe("unavailable");
    expect(empty.coverage.status).toBe("insufficient-evidence");
    expect(empty.coverage.averageCoverageRatio).toBeNull();
    expect(empty.coverage.averageDifficultyScore).toBeNull();
    expect(empty.metrics["vocabulary.known_lemmas"]?.value).toBeNull();
    expect(empty.metrics["coverage.ratio"]?.value).toBeNull();
    expect(empty.metrics["srs.retention"]?.value).toBeNull();
    expect(empty.proficiency).toEqual({
      status: "unavailable",
      cefrLevel: null,
      proficiencyScore: null,
      reason: "cefr_certification_not_measured",
    });

    // SRS reviews present without retention outcomes must stay unavailable (not 0%).
    const srsWithoutOutcome = await loadLanguageAnalyticsDashboardData(
      "profile-1",
      { from, to, timeZone: "UTC" },
      {
        now: to,
        minimumSampleSize: 5,
        loaders: emptyLoaders({
          listDaily: async () => [
            {
              profileId: "profile-1",
              dayUtc: "2026-05-05",
              metrics: { "srs.review": 3 },
              eventCursor: 3,
              updatedAt: Math.floor(Date.UTC(2026, 4, 5) / 1000),
            },
          ],
          getCoverageResults: async () => [
            {
              coverageKey: "cov-stale",
              documentId: "doc-stale",
              profileId: "profile-1",
              contentFingerprint: "fp",
              processorVersion: "1",
              lexiconStateVersion: "1",
              policyVersion: "1",
              thresholdVersion: "1",
              method: "phrase-aware",
              freshness: "stale",
              computedAt: Math.floor(Date.UTC(2026, 4, 5) / 1000),
              updatedAt: Math.floor(Date.UTC(2026, 4, 5) / 1000),
            },
          ],
        }),
      },
    );

    expect(srsWithoutOutcome.evidence.srs.reviews).toBe(3);
    expect(srsWithoutOutcome.evidence.srs.retentionRate).toBeNull();
    expect(srsWithoutOutcome.evidence.srs.status).toBe("unavailable");
    expect(srsWithoutOutcome.evidence.srs.reason).toBe("retention_outcome_not_recorded");
    expect(srsWithoutOutcome.coverage.status).toBe("stale");
    expect(srsWithoutOutcome.coverage.averageCoverageRatio).toBeNull();
    // Minimum sample size (5) enforces insufficient-evidence when only 3 active samples exist.
    expect(srsWithoutOutcome.evidence.active.count).toBe(3);
    expect(srsWithoutOutcome.evidence.active.status).toBe("insufficient-evidence");
  });

  it("rejects invalid date ranges via filters.ts validation", async () => {
    await expect(
      loadLanguageAnalyticsDashboardData(
        "profile-1",
        { from: 2000, to: 1000, timeZone: "UTC" },
        { loaders: emptyLoaders() },
      ),
    ).rejects.toThrow(RangeError);
  });
});
