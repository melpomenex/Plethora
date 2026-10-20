import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionController } from "../SessionController";
import * as recordingSessionsApi from "../../../api/recordingSessions";
import * as documentPrivacyLib from "../../../lib/documentPrivacy";
import type { TranscriptionJobManager } from "../../transcription/jobs/TranscriptionJobManager";
import type { RecordingSession, SessionOrigin } from "../../../types/recordingSession";

vi.mock("../../../api/recordingSessions", () => ({
  createRecordingSession: vi.fn(),
  getRecordingSession: vi.fn(),
  finalizeRecordingSession: vi.fn(),
  stageSessionMedia: vi.fn(),
}));

vi.mock("../../../lib/documentPrivacy", () => ({
  getDocumentPrivacy: vi.fn(),
}));

describe("SessionController (Task 1.1 / OpenSpec D1, D6)", () => {
  let mockJobManager: Partial<TranscriptionJobManager>;
  let controller: SessionController;

  const makeFakeSession = (overrides?: Partial<RecordingSession>): RecordingSession => ({
    id: "sess-1",
    documentId: "doc-1",
    origin: "recorded",
    contentType: "lecture",
    profileJson: "{}",
    captureState: "saved",
    ingestionState: "saved",
    transcriptId: null,
    mediaAssetId: "asset-1",
    transcriptRevision: 0,
    overviewJson: null,
    overviewRevision: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockJobManager = {
      startSessionJob: vi.fn().mockResolvedValue({
        id: "job-stt-1",
        status: "pending",
      } as any),
    };
    controller = new SessionController(mockJobManager as TranscriptionJobManager);

    vi.mocked(documentPrivacyLib.getDocumentPrivacy).mockResolvedValue({
      isLocalOnly: false,
      isAiExcluded: false,
      privacyVersion: 1,
    });
  });

  const origins: SessionOrigin[] = ["recorded", "file", "transcript", "url"];

  describe.each(origins)("Origin-parametrized convergence for '%s'", (origin) => {
    it(`converges after durable save with identical post-save pipeline`, async () => {
      const fakeSession = makeFakeSession({
        id: `sess-${origin}`,
        documentId: `doc-${origin}`,
        origin,
        mediaAssetId: origin === "transcript" ? null : `asset-${origin}`,
      });

      vi.mocked(recordingSessionsApi.createRecordingSession).mockResolvedValue(fakeSession);
      vi.mocked(recordingSessionsApi.getRecordingSession).mockResolvedValue(fakeSession);

      // Create session
      const created = await controller.createSession({
        sessionId: fakeSession.id,
        title: `Test ${origin}`,
        origin,
      });

      expect(created.id).toBe(`sess-${origin}`);
      expect(created.origin).toBe(origin);

      // Finalize ingestion
      const result = await controller.finalizeIngestion({
        sessionId: fakeSession.id,
        processingSelection: {
          transcribe: origin !== "transcript",
          prepareSuggestions: true,
        },
      });

      expect(result.session.id).toBe(`sess-${origin}`);
      expect(result.session.documentId).toBe(`doc-${origin}`);

      if (origin === "transcript") {
        expect(result.stageStates.media).toBe("missing");
        expect(result.stageStates.transcription).toBe("skipped");
      } else {
        expect(result.stageStates.media).toBe("saved");
        expect(result.stageStates.transcription).toBe("queued");
        expect(result.transcriptionJobId).toBe("job-stt-1");
      }

      // Analysis placeholder queued without triggering eager LLM inference
      expect(result.stageStates.analysis).toBe("queued");
    });
  });

  it("provider failure retains the audio asset and marks transcription as failed", async () => {
    const fakeSession = makeFakeSession({
      id: "sess-provider-fail",
      mediaAssetId: "asset-safe",
      ingestionState: "saved",
    });

    vi.mocked(recordingSessionsApi.getRecordingSession).mockResolvedValue(fakeSession);
    (mockJobManager.startSessionJob as any).mockRejectedValue(
      new Error("STT Provider capacity exceeded")
    );

    const result = await controller.finalizeIngestion({
      sessionId: "sess-provider-fail",
      processingSelection: { transcribe: true },
    });

    // The audio asset is preserved as saved!
    expect(result.stageStates.media).toBe("saved");
    expect(result.stageStates.transcription).toBe("failed");
  });

  it("reuses existing or supplied transcript instead of calling startSessionJob", async () => {
    const fakeSession = makeFakeSession({
      id: "sess-has-transcript",
      transcriptRevision: 1,
      transcriptId: 42,
    });

    vi.mocked(recordingSessionsApi.getRecordingSession).mockResolvedValue(fakeSession);

    const result = await controller.finalizeIngestion({
      sessionId: "sess-has-transcript",
    });

    expect(result.stageStates.transcription).toBe("reused");
    expect(mockJobManager.startSessionJob).not.toHaveBeenCalled();
  });

  it("retrying ingestion preserves exact same sessionId and documentId", async () => {
    const fakeSession = makeFakeSession({
      id: "sess-stable-id",
      documentId: "doc-stable-id",
    });

    vi.mocked(recordingSessionsApi.getRecordingSession).mockResolvedValue(fakeSession);

    const result1 = await controller.finalizeIngestion({ sessionId: "sess-stable-id" });
    const result2 = await controller.retryIngestion("sess-stable-id");

    expect(result1.session.id).toBe("sess-stable-id");
    expect(result1.session.documentId).toBe("doc-stable-id");
    expect(result2.session.id).toBe(result1.session.id);
    expect(result2.session.documentId).toBe(result1.session.documentId);
  });
});
