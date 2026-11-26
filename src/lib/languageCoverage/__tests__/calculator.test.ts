import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageCoverageResultRecord } from "../../../api/languageEcosystem";
import type { LanguageKnowledgeStateSnapshot } from "../../../types/languageKnowledge";
import type { LanguageLexicalEntry } from "../../../types/languageLexicon";
import type { LanguageAnalysisResult, LanguageTag, TokenSpan } from "../../languageProcessing/types";
import {
  calculateCoverage,
  coverageDisplayState,
  coverageReverseIndex,
  coverageSummary,
  CoverageReverseIndex,
  createCoverageVersion,
  DEFAULT_COVERAGE_BANDS,
  DEFAULT_COVERAGE_POLICY,
  getDocumentCoverageProjection,
  invalidateCoverageOnKnowledgeChange,
  reverseInvalidateChunks,
  saveAndComputeDocumentCoverage,
  type CoverageDocumentInput,
  type CoverageTokenInput,
} from "../index";

const baseInput: CoverageDocumentInput = {
  documentId: "doc-1",
  profileId: "profile-1",
  languageTag: "es",
  contentFingerprint: "content-1",
  processorVersion: "processor-1",
  lexiconStateVersion: "state-1",
  policy: DEFAULT_COVERAGE_POLICY,
  chunks: [{
    chunkId: "chunk-1",
    chunkIndex: 0,
    tokens: [
      { id: "known", surface: "hola", normalized: "hola", kind: "word", state: "known" },
      { id: "familiar", surface: "mundo", normalized: "mundo", kind: "word", lemmaState: "familiar", confidence: 1 },
      { id: "punct", surface: ".", normalized: ".", kind: "punctuation" },
      { id: "number", surface: "2", normalized: "2", kind: "number" },
    ],
  }],
};

function makeAnalysisToken(
  id: string,
  surface: string,
  options: { lemma?: string; confidence?: number | null; kind?: TokenSpan["kind"]; start?: number } = {},
): TokenSpan {
  const start = options.start ?? 0;
  return {
    id,
    surface,
    normalized: surface.toLowerCase(),
    lemma: options.lemma,
    kind: options.kind ?? "word",
    start,
    end: start + surface.length,
    isLexical: (options.kind ?? "word") === "word",
    confidence: {
      score: options.confidence === undefined ? 0.95 : options.confidence,
      label: options.confidence === null ? "unknown" : (options.confidence ?? 0.95) < 0.65 ? "low" : "high",
    },
    script: { script: "latin", direction: "ltr" },
  };
}

function makeLexicalEntry(
  id: string,
  normalizedForm: string,
  options: {
    profileId?: string;
    lemma?: string;
    objectKind?: "token" | "phrase";
    knowledgeState?: string;
    ignored?: boolean;
    properNoun?: boolean;
  } = {},
): LanguageLexicalEntry {
  return {
    id,
    profileId: options.profileId ?? "profile-1",
    languageTag: "es",
    objectKind: options.objectKind ?? "token",
    lexicalKey: `${options.objectKind ?? "token"}:${normalizedForm}`,
    normalizedForm,
    canonicalForm: normalizedForm,
    lemma: options.lemma,
    meanings: [],
    translations: [],
    encounterCount: 1,
    documentCount: 1,
    lookupCount: 0,
    activeEvidenceCount: 0,
    passiveEvidenceCount: 0,
    knowledgeState: options.knowledgeState,
    reviewRelationships: {},
    ignored: options.ignored ?? false,
    properNoun: options.properNoun ?? false,
    createdAt: 100,
    updatedAt: 100,
    version: 1,
  };
}

function makeWords(knownCount: number, newCount: number): CoverageTokenInput[] {
  const tokens: CoverageTokenInput[] = [];
  for (let i = 0; i < knownCount; i += 1) {
    tokens.push({
      id: `k-${i}`,
      surface: `known${i}`,
      normalized: `known${i}`,
      kind: "word",
      state: "known",
      confidence: 1,
    });
  }
  for (let i = 0; i < newCount; i += 1) {
    tokens.push({
      id: `n-${i}`,
      surface: `new${i}`,
      normalized: `new${i}`,
      kind: "word",
      state: "new",
      confidence: 1,
    });
  }
  return tokens;
}

describe("lexical coverage", () => {
  beforeEach(() => {
    coverageReverseIndex.clear();
  });

  it("counts states deterministically and excludes punctuation/numbers by policy", () => {
    const result = calculateCoverage(baseInput, { now: () => 123 });
    expect(result.summary.computedAt).toBe(123);
    expect(result.summary.stateCounts.known).toBe(1);
    expect(result.summary.stateCounts.familiar).toBe(1);
    expect(result.summary.excluded.punctuation).toBe(1);
    expect(result.summary.excluded.numbers).toBe(1);
    expect(result.summary.freshness).toBe("fresh");
  });

  it("does not double-count excluded.lowConfidence in exclude or unresolved modes", () => {
    const lowConfTokens: CoverageTokenInput[] = [
      { id: "t1", surface: "duda", normalized: "duda", kind: "word", lemmaState: "known", confidence: 0.2 },
      { id: "t2", surface: "incierto", normalized: "incierto", kind: "word", confidence: null },
      { id: "t3", surface: "claro", normalized: "claro", kind: "word", state: "known", confidence: 0.2 },
      { id: "p1a", surface: "en", normalized: "en", kind: "word", confidence: 1 },
      { id: "p1b", surface: "fin", normalized: "fin", kind: "word", confidence: 1 },
    ];
    const phrases = [
      {
        id: "phrase-low",
        surface: "en fin",
        normalized: "en fin",
        tokenIds: ["p1a", "p1b"],
        confidence: 0.75,
        lemmaState: "known" as const,
      },
    ];

    const excludePolicy = {
      ...DEFAULT_COVERAGE_POLICY,
      lowConfidenceTreatment: "exclude" as const,
      lowConfidenceThreshold: 0.65,
      phraseMinConfidence: 0.8, // phrase candidate rejected at selection; tokens evaluated individually
    };
    const excludeResult = calculateCoverage(
      { ...baseInput, policy: excludePolicy, chunks: [{ chunkId: "c1", chunkIndex: 0, tokens: lowConfTokens, phrases }] },
      { now: () => 1 },
    );
    // t1 and t2 are excluded once each; t3 has an exact-form `state` override so it stays known.
    expect(excludeResult.summary.excluded.lowConfidence).toBe(2);
    expect(excludeResult.summary.stateCounts.unresolved).toBe(0);
    expect(excludeResult.summary.stateCounts.known).toBe(1);

    // Also verify low-confidence phrase selected by phraseMinConfidence <= threshold
    const phraseExcludePolicy = {
      ...DEFAULT_COVERAGE_POLICY,
      lowConfidenceTreatment: "exclude" as const,
      lowConfidenceThreshold: 0.85,
      phraseMinConfidence: 0.7,
    };
    const phraseExcludeResult = calculateCoverage(
      { ...baseInput, policy: phraseExcludePolicy, chunks: [{ chunkId: "c2", chunkIndex: 0, tokens: lowConfTokens, phrases }] },
      { now: () => 2 },
    );
    // phrase-low (0.75 < 0.85) + t1 (0.2 < 0.85) + t2 (null) = 3 excluded.lowConfidence (never 6!)
    expect(phraseExcludeResult.summary.excluded.lowConfidence).toBe(3);
    expect(phraseExcludeResult.summary.stateCounts.unresolved).toBe(0);

    // In "unresolved" mode, low-confidence units go into stateCounts.unresolved and excluded.lowConfidence stays 0!
    const unresolvedPolicy = {
      ...DEFAULT_COVERAGE_POLICY,
      lowConfidenceTreatment: "unresolved" as const,
      lowConfidenceThreshold: 0.85,
      phraseMinConfidence: 0.7,
    };
    const unresolvedResult = calculateCoverage(
      { ...baseInput, policy: unresolvedPolicy, chunks: [{ chunkId: "c3", chunkIndex: 0, tokens: lowConfTokens, phrases }] },
      { now: () => 3 },
    );
    expect(unresolvedResult.summary.excluded.lowConfidence).toBe(0);
    expect(unresolvedResult.summary.stateCounts.unresolved).toBe(3);
    expect(unresolvedResult.summary.unresolvedCount).toBe(3);
  });

  it("distinguishes token coverage from unique vocabulary coverage when a word repeats 100 times", () => {
    const tokens: CoverageTokenInput[] = [];
    // 1 known word repeated 99 times + 1 unknown word repeated 1 time => 99% token coverage, 50% unique coverage
    for (let i = 0; i < 99; i += 1) {
      tokens.push({ id: `hola-${i}`, surface: "hola", normalized: "hola", lemma: "hola", kind: "word", state: "known", confidence: 1 });
    }
    tokens.push({ id: "raro-0", surface: "raro", normalized: "raro", lemma: "raro", kind: "word", state: "new", confidence: 1 });

    const highTokenResult = calculateCoverage(
      { ...baseInput, chunks: [{ chunkId: "c-high", chunkIndex: 0, tokens }] },
      { now: () => 10 },
    );
    expect(highTokenResult.summary.totalCountedTokens).toBe(100);
    expect(highTokenResult.summary.knownCoveragePercent).toBe(99);
    expect(highTokenResult.summary.coveragePercent).toBe(99);
    expect(highTokenResult.summary.uniqueLemmaCount).toBe(2);
    expect(highTokenResult.summary.uniqueSurfaceCount).toBe(2);
    expect(highTokenResult.summary.uniqueKnownCount).toBe(1);
    expect(highTokenResult.summary.uniqueNewCount).toBe(1);
    expect(highTokenResult.summary.uniqueKnownPercent).toBe(50);

    // Conversely, 1 known word repeated 1 time + 1 unknown word repeated 100 times => <1% token coverage vs 50% unique coverage
    const repeatedUnknownTokens: CoverageTokenInput[] = [
      { id: "k-1", surface: "hola", normalized: "hola", lemma: "hola", kind: "word", state: "known", confidence: 1 },
      ...Array.from({ length: 100 }, (_, i) => ({
        id: `u-${i}`,
        surface: "raro",
        normalized: "raro",
        lemma: "raro",
        kind: "word" as const,
        state: "new" as const,
        confidence: 1,
      })),
    ];
    const lowTokenResult = calculateCoverage(
      { ...baseInput, chunks: [{ chunkId: "c-low", chunkIndex: 0, tokens: repeatedUnknownTokens }] },
      { now: () => 11 },
    );
    expect(lowTokenResult.summary.knownCoveragePercent).toBeCloseTo(0.9901, 3);
    expect(lowTokenResult.summary.uniqueKnownPercent).toBe(50);
    expect(lowTokenResult.summary.uniqueKnownCount).toBe(1);
    expect(lowTokenResult.summary.uniqueNewCount).toBe(1);
  });

  it("tracks uniqueSurfaceCount vs uniqueLemmaCount and all unique state breakdowns including ignored", () => {
    const tokens: CoverageTokenInput[] = [
      { id: "t1", surface: "corro", normalized: "corro", lemma: "correr", kind: "word", lemmaState: "known", confidence: 1 },
      { id: "t2", surface: "corres", normalized: "corres", lemma: "correr", kind: "word", lemmaState: "known", confidence: 1 },
      { id: "t3", surface: "casa", normalized: "casa", lemma: "casa", kind: "word", state: "familiar", confidence: 1 },
      { id: "t4", surface: "libro", normalized: "libro", lemma: "libro", kind: "word", state: "learning", confidence: 1 },
      { id: "t5", surface: "nuevo", normalized: "nuevo", lemma: "nuevo", kind: "word", state: "new", confidence: 1 },
      { id: "t6", surface: "duda", normalized: "duda", lemma: "duda", kind: "word", confidence: null },
      { id: "t7", surface: "skip", normalized: "skip", lemma: "skip", kind: "word", ignored: true, confidence: 1 },
      { id: "t8", surface: "skip", normalized: "skip", lemma: "skip", kind: "word", ignored: true, confidence: 1 },
    ];
    const result = calculateCoverage(
      { ...baseInput, chunks: [{ chunkId: "c-detail", chunkIndex: 0, tokens }] },
      { now: () => 20 },
    );
    expect(result.summary.uniqueSurfaceCount).toBe(6); // corro, corres, casa, libro, nuevo, duda (skip is excluded)
    expect(result.summary.uniqueLemmaCount).toBe(5); // correr, casa, libro, nuevo, duda
    expect(result.summary.uniqueKnownCount).toBe(1);
    expect(result.summary.uniqueFamiliarCount).toBe(1);
    expect(result.summary.uniqueLearningCount).toBe(1);
    expect(result.summary.uniqueNewCount).toBe(1);
    expect(result.summary.uniqueUnresolvedCount).toBe(1);
    expect(result.summary.uniqueIgnoredCount).toBe(1);
    expect(result.summary.uniqueKnownPercent).toBe(20);
  });

  it("maps comprehensible-input coverage bands accurately as configurable heuristics", () => {
    expect(DEFAULT_COVERAGE_BANDS.heuristicNote?.toLowerCase()).toContain("never cefr");

    const checkBand = (known: number, totalNew: number, expectedBand: string, expectedLabel: string) => {
      const res = calculateCoverage({
        ...baseInput,
        chunks: [{ chunkId: "band", chunkIndex: 0, tokens: makeWords(known, totalNew) }],
      });
      expect(res.summary.difficultyBand).toBe(expectedBand);
      expect(res.summary.difficultyLabel).toBe(expectedLabel);
    };

    checkBand(79, 21, "overwhelming", "Overwhelming"); // 79% < 80%
    checkBand(80, 20, "challenging", "Challenging"); // 80%
    checkBand(89, 11, "challenging", "Challenging"); // 89%
    checkBand(90, 10, "intensive-learning", "Intensive learning"); // 90%
    checkBand(94, 6, "intensive-learning", "Intensive learning"); // 94%
    checkBand(95, 5, "relatively-comprehensible", "Relatively comprehensible"); // 95%
    checkBand(98, 2, "relatively-comprehensible", "Relatively comprehensible"); // 98%
    checkBand(99, 1, "comfortable-reading", "Comfortable reading"); // 99% > 98%
    checkBand(100, 0, "comfortable-reading", "Comfortable reading"); // 100% > 98%
  });

  it("never represents unavailable, pending, or stale coverage as 0% or 100%", () => {
    const emptyResult = calculateCoverage({
      ...baseInput,
      chunks: [{ chunkId: "empty", chunkIndex: 0, tokens: [{ id: "p", surface: ".", normalized: ".", kind: "punctuation" }] }],
    });
    expect(emptyResult.summary.freshness).toBe("unavailable");
    expect(emptyResult.summary.difficultyBand).toBe("unavailable");
    expect(coverageSummary(emptyResult)).toBeUndefined();

    const version = createCoverageVersion(baseInput);
    for (const freshness of ["unavailable", "pending", "stale"] as const) {
      const display = coverageDisplayState({ freshness, version });
      expect(display.freshness).toBe(freshness);
      expect(display.coveragePercent).toBeUndefined();
      expect(display.uniqueKnownPercent).toBeUndefined();
    }
  });

  it("reverse-invalidates only chunks that reference the changed entry", () => {
    const plan = reverseInvalidateChunks([
      { documentId: "doc-1", profileId: "profile-1", chunkId: "a", chunkIndex: 0, coverageKey: "k", lexicalEntryIds: ["entry-1"] },
      { documentId: "doc-1", profileId: "profile-1", chunkId: "b", chunkIndex: 1, coverageKey: "k", lexicalEntryIds: ["entry-2"] },
    ], "entry-1");
    expect(plan.chunks.map((chunk) => chunk.chunkId)).toEqual(["a"]);
    expect(plan.documentIds).toEqual(["doc-1"]);
  });

  it("bridges saveAndComputeDocumentCoverage, reverse index, and invalidateCoverageOnKnowledgeChange", async () => {
    const tokens: TokenSpan[] = [
      makeAnalysisToken("t1", "Hola", { lemma: "hola", start: 0 }),
      makeAnalysisToken("t2", "Hola", { lemma: "hola", start: 5 }),
      makeAnalysisToken("t3", "mundo", { lemma: "mundo", start: 10 }),
      makeAnalysisToken("t4", ".", { kind: "punctuation", start: 15 }),
    ];
    const analysis: LanguageAnalysisResult = {
      chunkIndex: 0,
      sourceStart: 0,
      sourceEnd: 16,
      text: "Hola Hola mundo.",
      sentences: [],
      tokens,
      phraseCandidates: [],
      version: {
        contractVersion: "1.0.0",
        schemaVersion: 1,
        adapterId: "baseline",
        adapterVersion: "1.0.0",
        providerKind: "bundled",
        languageTag: "es" as LanguageTag,
        contentFingerprint: "fp-1",
        configurationFingerprint: "cfg-1",
        processingKey: "proc-1",
      },
      summary: {
        sentenceCount: 0,
        tokenCount: 4,
        lexicalTokenCount: 3,
        characterCount: 16,
        capabilities: {} as LanguageAnalysisResult["summary"]["capabilities"],
      },
      chunks: [],
    };

    const lexiconEntries: LanguageLexicalEntry[] = [
      makeLexicalEntry("entry-hola", "hola", { lemma: "hola" }),
      makeLexicalEntry("entry-mundo", "mundo", { lemma: "mundo" }),
    ];
    const knowledgeStates: LanguageKnowledgeStateSnapshot[] = [
      { profileId: "profile-1", lexicalEntryId: "entry-hola", state: "known", manualOverride: false, passiveEvidence: 1, activeEvidence: 0, updatedAt: 100, version: 1 },
      { profileId: "profile-1", lexicalEntryId: "entry-mundo", state: "new", manualOverride: false, passiveEvidence: 0, activeEvidence: 0, updatedAt: 100, version: 1 },
    ];

    const persisted: Array<{ record: LanguageCoverageResultRecord; referencedEntryIds: string[] }> = [];
    const customIndex = new CoverageReverseIndex();

    const summary = await saveAndComputeDocumentCoverage({
      documentId: "doc-bridge",
      profileId: "profile-1",
      analysis,
      lexiconEntries,
      knowledgeStates,
      reverseIndex: customIndex,
      now: () => 999,
      persistResult: async (record, referencedEntryIds = []) => {
        persisted.push({ record, referencedEntryIds });
        return record;
      },
    });

    expect(summary.freshness).toBe("fresh");
    expect(summary.totalCountedTokens).toBe(3);
    expect(summary.knownCoveragePercent).toBeCloseTo(66.6667, 3);
    expect(summary.uniqueLemmaCount).toBe(2);
    expect(summary.uniqueKnownPercent).toBe(50);
    expect(summary.difficultyBand).toBe("overwhelming");

    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.record.documentId).toBe("doc-bridge");
    expect(persisted[0]!.record.freshness).toBe("fresh");
    expect(persisted[0]!.record.uniqueVocab).toMatchObject({
      uniqueLemmaCount: 2,
      uniqueKnownPercent: 50,
    });
    expect(persisted[0]!.referencedEntryIds).toEqual(["entry-hola", "entry-mundo"]);

    // Projection adapter reflects persisted freshness cleanly
    const freshProjection = await getDocumentCoverageProjection("profile-1", "doc-bridge", summary.version, {
      fetchResults: async () => [persisted[0]!.record],
    });
    expect(coverageSummary(freshProjection)?.uniqueKnownPercent).toBe(50);

    const missingProjection = await getDocumentCoverageProjection("profile-1", "missing-doc", summary.version, {
      fetchResults: async () => [],
    });
    expect(missingProjection.freshness).toBe("unavailable");
    expect(coverageDisplayState(missingProjection).coveragePercent).toBeUndefined();

    // Incremental invalidation updates both persistence and reverse index
    const invalidateSpy = vi.fn(async () => 1);
    const invalidation = await invalidateCoverageOnKnowledgeChange("profile-1", "entry-mundo", {
      reverseIndex: customIndex,
      invalidatePersisted: invalidateSpy,
    });
    expect(invalidateSpy).toHaveBeenCalledWith("profile-1", "entry-mundo");
    expect(invalidation.invalidatedCount).toBe(1);
    expect(invalidation.plan.documentIds).toEqual(["doc-bridge"]);
    expect(invalidation.plan.coverageKeys).toEqual([summary.version.coverageKey]);
    // Stale chunk references were removed from the in-memory reverse index
    expect(customIndex.invalidate("entry-mundo", "profile-1").chunks).toEqual([]);
  });
});
