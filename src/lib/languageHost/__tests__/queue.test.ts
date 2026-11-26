import { describe, expect, it } from "vitest";
import { queueVideoExtractTutorRequest } from "../queue";

describe("queueVideoExtractTutorRequest", () => {
  const base = {
    extractId: "extract-1",
    documentId: "doc-video-1",
    title: "Subjunctive intro",
    startTime: 12,
    endTime: 21,
    languageTag: "es",
    profileId: "profile-1",
  };

  it("builds a queue-origin tutor action targeting the embedded document host", () => {
    const request = queueVideoExtractTutorRequest(base);
    expect(request).not.toBeNull();
    expect(request!.action).toBe("tutor");
    expect(request!.origin).toBe("queue");
    expect(request!.hostId).toBe("document-reader:doc-video-1");
    expect(request!.source.contentId).toBe("doc-video-1");
    expect(request!.source.contentType).toBe("media");
    expect(request!.selectedText).toBe("Subjunctive intro");
    expect(request!.profileId).toBe("profile-1");
    expect(request!.languageTag).toBe("es");
  });

  it("carries the clip range as both source-anchor locator and practiceSource", () => {
    const request = queueVideoExtractTutorRequest(base)!;
    const locator = request.sourceAnchor.locator as Record<string, unknown>;
    expect(locator.startMs).toBe(12000);
    expect(locator.endMs).toBe(21000);
    expect(locator.segmentId).toBe("extract-1");
    expect(request.sourceAnchor.mediaId).toBe("doc-video-1");
    expect(request.practiceSource).toEqual({ mediaId: "doc-video-1", startMs: 12000, endMs: 21000 });
  });

  it("uses transcript text when provided, clamped to seconds", () => {
    const request = queueVideoExtractTutorRequest({
      ...base,
      transcriptText: "  El subjuntivo se usa…  ",
    })!;
    expect(request.selectedText).toBe("El subjuntivo se usa…");
    const locator = request.sourceAnchor.locator as Record<string, unknown>;
    expect(locator.startMs).toBe(12000);
  });

  it("rejects items without a document or empty text", () => {
    expect(queueVideoExtractTutorRequest({ ...base, documentId: "" })).toBeNull();
    expect(queueVideoExtractTutorRequest({ ...base, title: "   " })).toBeNull();
  });
});
