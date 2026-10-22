import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createRecordingSession,
  getRecordingSession,
  listRecordingSessions,
  updateRecordingSessionProfile,
  getSessionSegments,
  getSessionDocumentPrivacy,
  appendRecordingPart,
  finalizeRecordingSession,
  recoverRecordingSession,
  stageSessionMedia,
  exportPartialRecording,
  getRecordingMediaPath,
  isRecordingPersistenceAvailable,
  RecordingSessionApiError,
  isSessionOperationError,
  toSessionOperationError,
} from "../recordingSessions";
import * as tauriLib from "../../lib/tauri";
import { browserInvoke } from "../../lib/browser-backend";
import type {
  CreateRecordingSession,
  RecordingPart,
  RecordingSession,
  RecoveryReport,
  SessionMediaAsset,
} from "../../types/recordingSession";

vi.mock("../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/tauri")>();
  return {
    ...actual,
    isTauri: vi.fn(),
    invokeCommand: vi.fn(),
  };
});

describe("recordingSessions API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("off-platform (browser/nonnative)", () => {
    beforeEach(() => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(false);
    });

    it("reports persistence unavailable off-platform", () => {
      expect(isRecordingPersistenceAvailable()).toBe(false);
    });

    it("rejects createRecordingSession with typed SourceUnavailable", async () => {
      const request: CreateRecordingSession = {
        id: "sess-1",
        title: "Test Session",
        origin: "recorded",
        contentType: "lecture",
        profileJson: "{}",
      };
      await expect(createRecordingSession(request)).rejects.toMatchObject({
        name: "RecordingSessionApiError",
        code: "SourceUnavailable",
        stage: "ingestion",
        retryable: false,
        messageKey: "recording.sourceUnavailable",
      });
      expect(tauriLib.invokeCommand).not.toHaveBeenCalled();
    });

    it("rejects getRecordingSession with typed SourceUnavailable", async () => {
      await expect(getRecordingSession("sess-1")).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "ingestion",
        sessionId: "sess-1",
      });
    });

    it("rejects listRecordingSessions with typed SourceUnavailable", async () => {
      await expect(listRecordingSessions()).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "ingestion",
      });
    });

    it("rejects updateRecordingSessionProfile with typed SourceUnavailable", async () => {
      await expect(
        updateRecordingSessionProfile("sess-1", 1, "lecture", "{}"),
      ).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "ingestion",
        sessionId: "sess-1",
      });
    });

    it("rejects getSessionSegments with typed SourceUnavailable", async () => {
      await expect(getSessionSegments("sess-1")).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "transcription",
        sessionId: "sess-1",
      });
    });

    it("rejects getSessionDocumentPrivacy with typed SourceUnavailable", async () => {
      await expect(getSessionDocumentPrivacy("sess-1")).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "ingestion",
        sessionId: "sess-1",
      });
    });

    it("rejects appendRecordingPart with typed SourceUnavailable", async () => {
      await expect(
        appendRecordingPart({
          sessionId: "sess-1",
          writerEpoch: "epoch-1",
          sequence: 0,
          startMs: 0,
          durationMs: 1000,
          formatJson: "{}",
          bytes: new Uint8Array([1, 2, 3]),
        }),
      ).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "capture",
        sessionId: "sess-1",
      });
    });

    it("rejects finalizeRecordingSession with typed SourceUnavailable", async () => {
      await expect(finalizeRecordingSession("sess-1", 1)).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "ingestion",
        sessionId: "sess-1",
      });
    });

    it("rejects getRecordingMediaPath with typed SourceUnavailable", async () => {
      await expect(getRecordingMediaPath("sess-1")).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "ingestion",
        sessionId: "sess-1",
      });
    });

    it("rejects recoverRecordingSession with typed SourceUnavailable", async () => {
      await expect(recoverRecordingSession("sess-1")).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "ingestion",
        sessionId: "sess-1",
      });
    });

    it("rejects stageSessionMedia with typed SourceUnavailable", async () => {
      await expect(stageSessionMedia("sess-1", "/path/to/media.wav", "audio/wav")).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "ingestion",
        sessionId: "sess-1",
      });
    });

    it("rejects exportPartialRecording with typed SourceUnavailable", async () => {
      await expect(exportPartialRecording("sess-1", "/path/to/out.wav")).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "ingestion",
        sessionId: "sess-1",
      });
    });

    it("browserInvoke commandHandlers reject session commands with SourceUnavailable", async () => {
      await expect(browserInvoke("create_recording_session", {})).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "ingestion",
      });
      await expect(browserInvoke("get_session_segments", {})).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "transcription",
      });
      await expect(browserInvoke("append_recording_part", {})).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "capture",
      });
      await expect(browserInvoke("finalize_recording_session", {})).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "ingestion",
      });
      await expect(browserInvoke("recover_recording_session", {})).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "ingestion",
      });
      await expect(browserInvoke("stage_session_media", {})).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "ingestion",
      });
      await expect(browserInvoke("export_partial_recording", {})).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "ingestion",
      });
    });
  });

  describe("on-platform (Tauri)", () => {
    beforeEach(() => {
      vi.mocked(tauriLib.isTauri).mockReturnValue(true);
    });

    it("reports persistence available", () => {
      expect(isRecordingPersistenceAvailable()).toBe(true);
    });

    it("creates a recording session through invokeCommand", async () => {
      const mockSession: RecordingSession = {
        id: "sess-123",
        documentId: "doc-123",
        origin: "recorded",
        contentType: "lecture",
        profileJson: "{}",
        captureState: "idle",
        ingestionState: "staging",
        transcriptId: null,
        mediaAssetId: null,
        transcriptRevision: 0,
        overviewJson: null,
        overviewRevision: null,
        createdAt: "2026-10-20T00:00:00Z",
        updatedAt: "2026-10-20T00:00:00Z",
        version: 1,
      };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(mockSession);

      const request: CreateRecordingSession = {
        id: "sess-123",
        title: "Lecture",
        origin: "recorded",
        contentType: "lecture",
        profileJson: "{}",
      };
      const res = await createRecordingSession(request);
      expect(res).toEqual(mockSession);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith("create_recording_session", {
        request,
      });
    });

    it("lists recording sessions with paging parameters", async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce({
        items: [],
        nextCursor: "cursor-abc",
      });

      const res = await listRecordingSessions({
        collectionId: "col-1",
        cursor: "prev-cursor",
        limit: 25,
      });
      expect(res.nextCursor).toBe("cursor-abc");
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith("list_recording_sessions", {
        collectionId: "col-1",
        cursor: "prev-cursor",
        limit: 25,
      });
    });

    it("updates recording session profile CAS", async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce({
        id: "sess-1",
        version: 2,
      });

      await updateRecordingSessionProfile("sess-1", 1, "seminar", '{"notes":true}');
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith("update_recording_session_profile", {
        id: "sess-1",
        expectedVersion: 1,
        contentType: "seminar",
        profileJson: '{"notes":true}',
      });
    });

    it("maps StaleRevision error correctly on CAS mismatch", async () => {
      vi.mocked(tauriLib.invokeCommand).mockRejectedValueOnce({
        code: "StaleRevision",
        stage: "ingestion",
        sessionId: "sess-1",
        retryable: true,
        messageKey: "recording.staleRevision",
      });

      await expect(
        updateRecordingSessionProfile("sess-1", 1, "seminar", "{}"),
      ).rejects.toMatchObject({
        name: "RecordingSessionApiError",
        code: "StaleRevision",
        stage: "ingestion",
        retryable: true,
      });
    });

    it("maps structured error embedded in Error message string", async () => {
      const err = new Error(
        'Tauri command "get_recording_session" failed: {"code":"SourceUnavailable","stage":"ingestion","sessionId":"sess-999","retryable":false,"messageKey":"recording.sourceUnavailable"}',
      );
      vi.mocked(tauriLib.invokeCommand).mockRejectedValueOnce(err);

      await expect(getRecordingSession("sess-999")).rejects.toMatchObject({
        code: "SourceUnavailable",
        stage: "ingestion",
        sessionId: "sess-999",
      });
    });

    it("retrieves session segments with cursor paging", async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce({
        items: [],
        revision: 1,
        nextCursor: "next-seg-cursor",
      });

      const res = await getSessionSegments("sess-1", { cursor: "prev-seg", limit: 50 });
      expect(res.revision).toBe(1);
      expect(res.nextCursor).toBe("next-seg-cursor");
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith("get_session_segments", {
        id: "sess-1",
        cursor: "prev-seg",
        limit: 50,
      });
    });

    it("retrieves session document privacy", async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce({
        isLocalOnly: true,
        isAiExcluded: false,
        privacyVersion: 2,
      });

      const privacy = await getSessionDocumentPrivacy("sess-1");
      expect(privacy.isLocalOnly).toBe(true);
      expect(privacy.privacyVersion).toBe(2);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith("get_session_document_privacy", {
        id: "sess-1",
      });
    });

    it("appends recording part with Uint8Array converted to number array", async () => {
      const mockPart: RecordingPart = {
        assetId: "asset-1",
        writerEpoch: "epoch-1",
        sequence: 0,
        relativePath: "parts/part_000000.bin",
        byteLength: 4,
        sha256: "abcd",
        startMs: 0,
        durationMs: 1000,
        formatJson: "{}",
        committedAt: "2026-10-20T00:00:00Z",
      };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(mockPart);

      const part = await appendRecordingPart({
        sessionId: "sess-1",
        writerEpoch: "epoch-1",
        sequence: 0,
        startMs: 0,
        durationMs: 1000,
        formatJson: "{}",
        bytes: new Uint8Array([10, 20, 30, 40]),
      });

      expect(part.sequence).toBe(0);
      expect(part.sha256).toBe("abcd");
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith("append_recording_part", {
        sessionId: "sess-1",
        writerEpoch: "epoch-1",
        sequence: 0,
        startMs: 0,
        durationMs: 1000,
        formatJson: "{}",
        bytes: [10, 20, 30, 40],
      });
    });

    it("finalizes recording session", async () => {
      const mockSession: RecordingSession = {
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
        createdAt: "2026-10-20T00:00:00Z",
        updatedAt: "2026-10-20T00:00:00Z",
        version: 2,
      };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(mockSession);

      const res = await finalizeRecordingSession("sess-1", 1);
      expect(res.captureState).toBe("saved");
      expect(res.version).toBe(2);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith("finalize_recording_session", {
        id: "sess-1",
        expectedVersion: 1,
      });
    });

    it("recovers recording session", async () => {
      const mockReport: RecoveryReport = {
        sessionId: "sess-1",
        assetId: "asset-1",
        verifiedParts: 5,
        corruptParts: 0,
        missingGaps: 0,
        acknowledgedDurationMs: 25000,
        acknowledgedBytes: 100000,
        state: "saved",
      };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(mockReport);

      const report = await recoverRecordingSession("sess-1");
      expect(report.verifiedParts).toBe(5);
      expect(report.state).toBe("saved");
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith("recover_recording_session", {
        id: "sess-1",
      });
    });

    it("stages session media", async () => {
      const mockAsset: SessionMediaAsset = {
        id: "asset-1",
        sessionId: "sess-1",
        kind: "original",
        relativePath: "asset_1.mp3",
        mime: "audio/mpeg",
        byteLength: 50000,
        sha256: "deadbeef",
        durationMs: null,
        state: "ready",
        sourceUrl: null,
        sourceAdapter: null,
        createdAt: "2026-10-20T00:00:00Z",
      };
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(mockAsset);

      const asset = await stageSessionMedia("sess-1", "/path/to/source.mp3", "audio/mpeg");
      expect(asset.id).toBe("asset-1");
      expect(asset.kind).toBe("original");
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith("stage_session_media", {
        sessionId: "sess-1",
        sourcePath: "/path/to/source.mp3",
        mime: "audio/mpeg",
      });
    });

    it("exports partial recording", async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(123456);

      const bytes = await exportPartialRecording("sess-1", "/path/to/out.wav");
      expect(bytes).toBe(123456);
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith("export_partial_recording", {
        sessionId: "sess-1",
        outputPath: "/path/to/out.wav",
      });
    });

    it("resolves the session's absolute media path", async () => {
      vi.mocked(tauriLib.invokeCommand).mockResolvedValueOnce(
        "/data/recordings/sess-1/audio.wav"
      );

      const path = await getRecordingMediaPath("sess-1");
      expect(path).toBe("/data/recordings/sess-1/audio.wav");
      expect(tauriLib.invokeCommand).toHaveBeenCalledWith("get_recording_media_path", {
        sessionId: "sess-1",
      });
    });
  });

  describe("error utilities", () => {
    it("isSessionOperationError validates error shape", () => {
      expect(
        isSessionOperationError({
          code: "SourceUnavailable",
          stage: "ingestion",
          retryable: false,
          messageKey: "recording.sourceUnavailable",
        }),
      ).toBe(true);

      expect(isSessionOperationError({ code: "Invalid" })).toBe(false);
      expect(isSessionOperationError(null)).toBe(false);
    });

    it("toSessionOperationError preserves existing RecordingSessionApiError", () => {
      const original = new RecordingSessionApiError({
        code: "StorageFull",
        stage: "ingestion",
        sessionId: "sess-1",
        retryable: true,
        messageKey: "recording.storageFull",
      });
      const converted = toSessionOperationError(original);
      expect(converted.code).toBe("StorageFull");
      expect(converted.retryable).toBe(true);
    });
  });
});
