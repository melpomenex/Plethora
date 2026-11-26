import { describe, expect, it } from "vitest";
import { createLanguageMiningPayload, miningPayloadCanCreateDraft } from "../index";

describe("language mining payload", () => {
  it("bounds context and preserves source/media provenance", () => {
    const payload = createLanguageMiningPayload({ profileId: "p1", sourceType: "video", sourceId: "video-1", text: "selected", sentenceText: "sentence", selectedText: "selected", mediaId: "audio-1", mediaStartMs: 10, mediaEndMs: 20, frameTimestampMs: 12, sourceFingerprint: "v1", frameAvailable: true, originalAudioAvailability: "available", translationAvailability: "available", analysisAvailability: "available", origin: "mining", surroundingContext: "  context  " }, 1);
    expect(payload.payloadVersion).toBe(1);
    expect(payload.context).toBe("context");
    expect(payload.mediaStartMs).toBe(10);
    expect(payload.frameAvailable).toBe(true);
    expect(miningPayloadCanCreateDraft(payload)).toBe(true);
  });

  it("preserves lexical, sentence, reading/pos/lemma, translation, and frameDataUrl fields cleanly", () => {
    const payload = createLanguageMiningPayload({
      profileId: "p1",
      lexicalEntryId: "lex-1",
      phraseId: "phr-1",
      sentenceId: "sent-1",
      languageTag: "ja",
      sourceType: "video",
      sourceId: "video-1",
      text: "食べる",
      sentenceText: "りんごを食べる。",
      translatedSentence: "I eat an apple.",
      reading: "たべる",
      pos: "verb",
      lemma: "食べる",
      frameDataUrl: "data:image/png;base64,AAAA",
      mediaStartMs: 1200,
      mediaEndMs: 2800,
      originalAudioAvailability: "available",
      translationAvailability: "available",
      analysisAvailability: "available",
      origin: "mining",
    }, 42);

    expect(payload.profileId).toBe("p1");
    expect(payload.lexicalEntryId).toBe("lex-1");
    expect(payload.phraseId).toBe("phr-1");
    expect(payload.sentenceId).toBe("sent-1");
    expect(payload.languageTag).toBe("ja");
    expect(payload.translatedSentence).toBe("I eat an apple.");
    expect(payload.reading).toBe("たべる");
    expect(payload.pos).toBe("verb");
    expect(payload.lemma).toBe("食べる");
    expect(payload.frameDataUrl).toBe("data:image/png;base64,AAAA");
    expect(payload.frameAvailable).toBe(true);
    expect(payload.mediaStartMs).toBe(1200);
    expect(payload.mediaEndMs).toBe(2800);
    expect(payload.originalAudioAvailability).toBe("available");
    expect(payload.translationAvailability).toBe("available");
    expect(payload.analysisAvailability).toBe("available");
  });

  it("does not fabricate a draft for stale/failed analysis", () => {
    const payload = createLanguageMiningPayload({ sourceType: "text", sourceId: "doc", text: "word", originalAudioAvailability: "missing", translationAvailability: "missing", analysisAvailability: "stale", origin: "sentence" });
    expect(miningPayloadCanCreateDraft(payload)).toBe(false);
  });
});
