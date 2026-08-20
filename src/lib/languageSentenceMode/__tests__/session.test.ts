import { describe, expect, it } from "vitest";
import { createSentenceIndexAdapter, createSentenceModeSession, createTextSentenceSegments, moveSentence, returnToReader } from "../index";

describe("Sentence Mode session", () => {
  it("keeps exact source identity and return anchor while moving", async () => {
    const adapter = createSentenceIndexAdapter("html", "doc-1", "One. Two! Three?");
    const segments = await adapter.getWindow(0, 10);
    const session = createSentenceModeSession({ sessionId: "s1", source: "html", sourceId: "doc-1", contentFingerprint: adapter.contentFingerprint, entry: segments[0]!, returnAnchor: { sourceId: "doc-1", position: 42 }, total: segments.length });
    const moved = moveSentence(session, segments[1]!);
    expect(moved.currentSentenceId).toBe(segments[1]?.identity.sentenceId);
    expect(returnToReader(moved)).toEqual({ sourceId: "doc-1", position: 42 });
  });

  it("marks a changed content fingerprint stale instead of navigating a wrong sentence", () => {
    const segments = createTextSentenceSegments("doc-1", "One. Two!");
    const session = createSentenceModeSession({ sessionId: "s1", source: "text", sourceId: "doc-1", contentFingerprint: segments[0]!.identity.contentFingerprint, entry: segments[0]!, returnAnchor: { sourceId: "doc-1" }, total: segments.length });
    expect(moveSentence(session, { ...segments[1]!, identity: { ...segments[1]!.identity, contentFingerprint: "changed" } }).freshness).toBe("stale");
  });
});
