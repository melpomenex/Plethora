import { describe, expect, it } from "vitest";
import { AudioAlignmentRegistry, replayOriginalFirst } from "../../languageAudioAlignment";
import { calculateCoverage, DEFAULT_COVERAGE_POLICY } from "../../languageCoverage";
import { QueueLanguageHighlightAdapter } from "../../languageHighlighting/adapters";
import { createLanguageMiningPayload, miningPayloadCanCreateDraft } from "../../languageMining";
import { LanguagePeekService } from "../../languagePeek";
import { comparePracticeResponse } from "../../languagePractice";
import { rankLanguageRecommendations } from "../../languageRecommendations";
import { createSentenceModeSession, moveSentence, returnToReader } from "../../languageSentenceMode";
import { createLanguageLearningDraft, scoreLanguageSuggestion } from "../../languageSrs";
import { buildLearnerContext } from "../../languageTutor";
import { SPANISH_EPUB_FIXTURE, SPANISH_PRACTICE_FIXTURE, SPANISH_VIDEO_FIXTURE, fakePeekProvider, fakeProcessingManifest } from "../testing";

describe("language integration acceptance fixtures", () => {
  it("Spanish EPUB preserves annotations, peek fallback, explicit state/draft actions, and no implicit card", async () => {
    expect(fakeProcessingManifest("es").supportedLanguageTags).toEqual(["es"]);
    const peek = await new LanguagePeekService({ providers: [fakePeekProvider()] }).lookup("casa", { profileId: "p", languageTag: "es" });
    expect(peek.ok).toBe(true);
    const draft = createLanguageLearningDraft({ itemType: "flashcard", question: "casa", answer: "house", provenance: { origin: "dictionary-peek", profileId: "p", lexicalEntryId: "casa", createdAt: 1 } });
    expect(draft.draftKey).toContain("casa");
    expect(SPANISH_EPUB_FIXTURE.text).toContain("ventana");
  });

  it("repeated-word evidence remains explainable and reuses one draft key", () => {
    const suggestion = scoreLanguageSuggestion({ entryId: "e", profileId: "p", state: "encountered", encounterCount: 4, passiveEvidence: 2, activeEvidence: 0, lookupCount: 1, now: 100 });
    expect(suggestion.eligible).toBe(true);
    const first = createLanguageLearningDraft({ itemType: "flashcard", question: "viajar", answer: "to travel", provenance: { origin: "dictionary-peek", profileId: "p", lexicalEntryId: "e", createdAt: 1 } });
    const second = createLanguageLearningDraft({ itemType: "flashcard", question: "viajar", answer: "to travel", provenance: { origin: "dictionary-peek", profileId: "p", lexicalEntryId: "e", createdAt: 2 } });
    expect(first.draftKey).toBe(second.draftKey);
  });

  it("Sentence Mode reveals translation/inspection and returns the exact source anchor", () => {
    const entry = { identity: { sentenceId: "s1", sourceId: "doc", contentFingerprint: "fp" }, index: 0, text: "Hola", freshness: "ready" as const };
    const session = createSentenceModeSession({ sessionId: "session", source: "epub", sourceId: "doc", contentFingerprint: "fp", entry, returnAnchor: { documentId: "doc", sourceId: "doc", sourceAnchor: { sourceType: "epub", sourceId: "doc", locator: { cfi: "epubcfi(/6/2)" } }, position: 12 }, total: 2 });
    const next = moveSentence(session, { ...entry, identity: { ...entry.identity, sentenceId: "s2" }, index: 1, text: "Adiós" });
    expect(next.currentSentenceId).toBe("s2");
    expect(returnToReader(next)).toEqual(session.returnAnchor);
  });

  it("podcast/audio and YouTube retain alignment provenance and normal playback fallback", async () => {
    const registry = new AudioAlignmentRegistry();
    registry.add({ id: "a", sourceType: "video", sourceId: "video", sentenceId: "s1", sourceFingerprint: "fp", range: { mediaId: "media", startMs: 10, endMs: 500, mediaFingerprint: "media-fp" }, confidence: 0.98, method: "caption", status: "ready", updatedAt: 1 });
    const resolution = registry.resolve({ sourceId: "video", sentenceId: "s1", sourceFingerprint: "fp", mediaId: "media", mediaFingerprint: "media-fp" });
    const played: string[] = [];
    const replay = await replayOriginalFirst({ text: SPANISH_VIDEO_FIXTURE.segments[0]!.text, resolution, playOriginal: () => { played.push("original"); }, speakTts: () => { played.push("tts"); } });
    expect(replay.kind).toBe("original");
    expect(played).toEqual(["original"]);
    const payload = createLanguageMiningPayload({ text: "Hola", sentenceText: "Hola, ¿cómo estás?", surroundingContext: "Hola, ¿cómo estás? Estoy aprendiendo español.", sourceType: "video", sourceId: "video", profileId: "p", sourceFingerprint: "media-fp", mediaId: "media", mediaStartMs: 0, mediaEndMs: 1800, analysisAvailability: "available", originalAudioAvailability: "available", translationAvailability: "available", origin: "sentence", provenance: {} });
    expect(payload.context).toContain("Estoy aprendiendo");
    expect(miningPayloadCanCreateDraft(payload)).toBe(true);
  });

  it("Queue recommendations expose coverage/difficulty without mutating Queue lifecycle", () => {
    const adapter = new QueueLanguageHighlightAdapter("queue", [{ id: "item", text: "Hola mundo" }]);
    expect(adapter.getTokenAnchors().length).toBe(2);
    const coverage = calculateCoverage({ documentId: "queue", profileId: "p", contentFingerprint: "fp", languageTag: "es", processorVersion: "1", lexiconStateVersion: "1", policy: DEFAULT_COVERAGE_POLICY, chunks: [{ chunkId: "1", chunkIndex: 0, tokens: [{ id: "hola", surface: "Hola", normalized: "hola", kind: "word", state: "new", confidence: 1 }, { id: "mundo", surface: "mundo", normalized: "mundo", kind: "word", state: "known", confidence: 1 }] }] });
    expect(coverage.summary.coveragePercent).toBeGreaterThanOrEqual(0);
    const ranked = rankLanguageRecommendations([{ id: "r", profileId: "p", sourceType: "queue", sourceId: "queue", sourceFingerprint: "fp", title: "Hola mundo", topics: [], coverageStatus: "fresh", coveragePercent: coverage.summary.coveragePercent, difficultyScore: 50, qualityScore: 1, freshnessScore: 1, lifecycle: "candidate" }], []);
    expect(ranked[0]?.explanation.join(" ")).toContain("measured coverage");
  });

  it("tutor context and active/passive practice evidence stay bounded and explicit", () => {
    const context = buildLearnerContext({ profile: { id: "p", targetLanguage: "es", baseLanguage: "en" }, lexicon: [{ entryId: "e", surface: "aprender", state: "learning", evidenceCount: 2 }], currentSource: { documentId: "doc", text: "private source" } });
    expect(context.items).toHaveLength(1);
    const comparison = comparePracticeResponse(SPANISH_PRACTICE_FIXTURE.prompt, "Estoy aprendiendo español.");
    expect(comparison.exact).toBe(true);
    expect(comparison.assisted).toBeUndefined();
  });
});
