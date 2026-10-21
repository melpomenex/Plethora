import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveCardSource, locatorFromSelectionContext } from "../cardSourceNavigation";
import { openAudioCaptureInSource } from "../audioCaptureNavigation";
import * as recordingSessionsApi from "../../api/recordingSessions";
import * as extractsApi from "../../api/extracts";
import type { LearningObjectSource, SessionSourceEvidence } from "../../types/recordingSession";
import type { Document } from "../../types/document";
import { useDocumentStore } from "../../stores/documentStore";

vi.mock("../../api/recordingSessions", () => ({
  getLearningObjectSources: vi.fn(),
}));

vi.mock("../../api/extracts", () => ({
  getExtract: vi.fn(),
}));

describe("Shared Source Resolution for Session Evidence (Task 2.6)", () => {
  let documentsStore: Document[] = [];

  const baseEvidence: SessionSourceEvidence = {
    version: 1,
    documentId: "doc-session-1",
    sessionId: "sess-1",
    assetId: "asset-1",
    transcriptId: 10,
    transcriptRevision: 2,
    segmentKeys: ["seg-1"],
    quote: "Quantum decoherence occurs due to environmental interaction.",
    ranges: [{ segmentKey: "seg-1", startUtf16: 0, endUtf16: 58 }],
    time: { startMs: 15000, endMs: 25000, kind: "measured" },
    speakerId: "Prof",
    markerIds: [],
    precision: "segment",
    fingerprint: "Quantum decoherence occurs due to environmental interaction.",
  };

  const sampleSource: LearningObjectSource = {
    id: "source-1",
    targetKind: "card",
    targetId: "card-1",
    sessionId: "sess-1",
    documentId: "doc-session-1",
    evidenceJson: JSON.stringify(baseEvidence),
    evidenceHash: "hash-1",
    createdAt: "2026-10-20T12:00:00Z",
  };

  const sessionDoc: Document = {
    id: "doc-session-1",
    title: "Quantum Mechanics Lecture 1",
    fileType: "audio",
    filePath: "recordings/sess-1/audio.mp3",
    content: "Welcome everyone. Quantum decoherence occurs due to environmental interaction. That concludes today.",
    createdAt: "2026-10-20T10:00:00Z",
    updatedAt: "2026-10-20T12:00:00Z",
    isAiExcluded: false,
    isLocalOnly: true,
  } as unknown as Document;

  beforeEach(() => {
    vi.clearAllMocks();
    documentsStore = [sessionDoc];
    vi.spyOn(useDocumentStore, "getState").mockReturnValue({
      documents: documentsStore,
      loadDocuments: async () => {},
    } as any);
  });

  it("resolves card exactly via rich LearningObjectSource association", async () => {
    vi.mocked(recordingSessionsApi.getLearningObjectSources).mockResolvedValue([sampleSource]);

    const resolution = await resolveCardSource({
      id: "card-1",
      document_id: "doc-session-1",
    });

    expect(resolution.status).toBe("ready");
    if (resolution.status === "ready") {
      expect(resolution.confidence).toBe("exact");
      expect(resolution.documentId).toBe("doc-session-1");
      expect(resolution.location.kind).toBe("audio");
      if (resolution.location.kind === "audio") {
        expect(resolution.location.timeSeconds).toBe(15);
        expect(resolution.location.textQuote).toBe(baseEvidence.quote);
      }
      expect(resolution.highlightQuery).toBe(baseEvidence.quote);
    }
  });

  it("resolves untimed session source honestly with timing.kind none and markdown locator", async () => {
    const untimedEvidence: SessionSourceEvidence = {
      ...baseEvidence,
      time: undefined,
    };
    const untimedSource: LearningObjectSource = {
      ...sampleSource,
      evidenceJson: JSON.stringify(untimedEvidence),
    };
    vi.mocked(recordingSessionsApi.getLearningObjectSources).mockResolvedValue([untimedSource]);

    const resolution = await resolveCardSource({
      id: "card-1",
      document_id: "doc-session-1",
    });

    expect(resolution.status).toBe("ready");
    if (resolution.status === "ready") {
      expect(resolution.location.kind).toBe("markdown");
      expect(resolution.location.textQuote).toBe(baseEvidence.quote);
    }
  });

  it("degrades to stale when source transcript was corrected and no longer matches", async () => {
    vi.mocked(recordingSessionsApi.getLearningObjectSources).mockResolvedValue([sampleSource]);

    // Update document content so original canonical quote is missing (simulating a correction)
    documentsStore = [
      {
        ...sessionDoc,
        content: "Welcome everyone. Quantum entanglement occurs due to Bell state prep. That concludes today.",
      },
    ];
    vi.spyOn(useDocumentStore, "getState").mockReturnValue({
      documents: documentsStore,
      loadDocuments: async () => {},
    } as any);

    const resolution = await resolveCardSource({
      id: "card-1",
      document_id: "doc-session-1",
    });

    expect(resolution.status).toBe("coarse");
    if (resolution.status === "coarse") {
      expect(resolution.reason).toBe("stale");
      expect(resolution.location).toBeDefined();
      if (resolution.location?.kind === "audio") {
        expect(resolution.location.timeSeconds).toBe(15); // Preserves audio timestamp
        expect(resolution.location.textQuote).toBeUndefined(); // Does not claim stale text
      }
    }
  });

  it("degrades to ambiguous when canonical quote appears multiple times in document", async () => {
    vi.mocked(recordingSessionsApi.getLearningObjectSources).mockResolvedValue([sampleSource]);

    // Document contains quote twice
    documentsStore = [
      {
        ...sessionDoc,
        content:
          "Part 1: Quantum decoherence occurs due to environmental interaction. Part 2: As noted, Quantum decoherence occurs due to environmental interaction.",
      },
    ];
    vi.spyOn(useDocumentStore, "getState").mockReturnValue({
      documents: documentsStore,
      loadDocuments: async () => {},
    } as any);

    const resolution = await resolveCardSource({
      id: "card-1",
      document_id: "doc-session-1",
    });

    expect(resolution.status).toBe("coarse");
    if (resolution.status === "coarse") {
      expect(resolution.reason).toBe("ambiguous");
      if (resolution.location?.kind === "audio") {
        expect(resolution.location.timeSeconds).toBe(15);
      }
    }
  });

  it("degrades to document-missing when session backing document is deleted", async () => {
    vi.mocked(recordingSessionsApi.getLearningObjectSources).mockResolvedValue([sampleSource]);

    documentsStore = [];
    vi.spyOn(useDocumentStore, "getState").mockReturnValue({
      documents: documentsStore,
      loadDocuments: async () => {},
    } as any);

    const resolution = await resolveCardSource({
      id: "card-1",
      document_id: "doc-session-1",
    });

    expect(resolution.status).toBe("unavailable");
    if (resolution.status === "unavailable") {
      expect(resolution.reason).toBe("document-missing");
      expect(resolution.excerpt).toBe(baseEvidence.quote);
    }
  });

  it("maps session_transcript selection context through locatorFromSelectionContext", () => {
    const timedCtx = {
      type: "session_transcript",
      documentId: "doc-session-1",
      sessionId: "sess-1",
      evidence: baseEvidence,
      selectedText: "Quantum decoherence occurs due to environmental interaction.",
    };

    const timedLoc = locatorFromSelectionContext(timedCtx);
    expect(timedLoc).toEqual({
      kind: "audio",
      timeSeconds: 15,
      textQuote: "Quantum decoherence occurs due to environmental interaction.",
    });

    const untimedCtx = {
      type: "session_transcript",
      documentId: "doc-session-1",
      sessionId: "sess-1",
      evidence: {
        ...baseEvidence,
        time: { kind: "none" },
      },
      selectedText: "Untimed passage.",
    };

    const untimedLoc = locatorFromSelectionContext(untimedCtx);
    expect(untimedLoc).toEqual({
      kind: "markdown",
      textQuote: "Untimed passage.",
    });
  });

  it("opens audio capture in source for session_transcript without fabricating 0:00", () => {
    const addTab = vi.fn();
    const navigated = openAudioCaptureInSource(
      {
        provider: "transcript",
        documentId: "doc-session-1",
        audioTimestampSec: 15.5,
      } as any,
      "Quantum decoherence occurs",
      addTab
    );

    expect(navigated).toBe(true);
    expect(addTab).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "document-viewer",
        data: expect.objectContaining({
          documentId: "doc-session-1",
          initialJump: expect.objectContaining({
            kind: "audio",
            timeSeconds: 15.5,
          }),
        }),
      })
    );
  });
});
