import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectMediaKind,
  getMediaMimeType,
  importMediaFiles,
  isSupportedMediaExtension,
} from "../importMedia";
import { sessionController } from "../SessionController";
import type { RecordingSession, SessionMediaAsset } from "../../../types/recordingSession";

describe("importMedia (Task 1.3 Owned Media Ingestion)", () => {
  let createdSessions: Array<{ id: string; title: string; origin: string; documentId: string }> = [];
  let stagedAssets: Array<{ sessionId: string; sourcePath: string; mime: string; assetId: string }> = [];
  let finalizedSessions: string[] = [];

  beforeEach(() => {
    createdSessions = [];
    stagedAssets = [];
    finalizedSessions = [];

    vi.spyOn(sessionController, "createSession").mockImplementation(async (opts) => {
      const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const docId = `doc-${id}`;
      const session = {
        id,
        documentId: docId,
        title: opts.title || "Untitled",
        origin: opts.origin,
        contentType: opts.contentType || "lecture",
        collectionId: opts.collectionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      } as unknown as RecordingSession;
      createdSessions.push({ id, title: opts.title || "Untitled", origin: opts.origin || "file", documentId: docId });
      return session;
    });

    vi.spyOn(sessionController, "stageMedia").mockImplementation(async (sessionId, sourcePath, mime) => {
      const assetId = `asset-${Math.random().toString(36).slice(2, 8)}`;
      stagedAssets.push({ sessionId, sourcePath, mime, assetId });
      return {
        id: assetId,
        sessionId,
        kind: "original",
        relativePath: `recordings/${sessionId}/asset_${assetId.slice(0, 6)}.${sourcePath.split(".").pop()}`,
        mime,
        byteLength: 1048576,
        sha256: "fake-sha-256",
        state: "ready",
        createdAt: new Date().toISOString(),
      } as unknown as SessionMediaAsset;
    });

    vi.spyOn(sessionController, "finalizeIngestion").mockImplementation(async (input) => {
      finalizedSessions.push(input.sessionId);
      return {} as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Extension and format matrix", () => {
    const formats = [
      { ext: "mp3", mime: "audio/mpeg", kind: "audio" },
      { ext: "m4a", mime: "audio/mp4", kind: "audio" },
      { ext: "wav", mime: "audio/wav", kind: "audio" },
      { ext: "flac", mime: "audio/flac", kind: "audio" },
      { ext: "ogg", mime: "audio/ogg", kind: "audio" },
      { ext: "webm", mime: "video/webm", kind: "video" },
      { ext: "mp4", mime: "video/mp4", kind: "video" },
      { ext: "mov", mime: "video/quicktime", kind: "video" },
    ];

    for (const fmt of formats) {
      it(`recognizes and imports .${fmt.ext} format with correct kind and mime`, async () => {
        const testPath = `/storage/media/test_lecture.${fmt.ext}`;
        expect(isSupportedMediaExtension(testPath)).toBe(true);
        expect(detectMediaKind(testPath)).toBe(fmt.kind);
        expect(getMediaMimeType(testPath)).toBe(fmt.mime);

        const res = await importMediaFiles({
          paths: [testPath],
          contentType: "lecture",
        });

        expect(res.successCount).toBe(1);
        expect(res.failedCount).toBe(0);
        expect(res.items[0].status).toBe("success");
        expect(res.items[0].mediaAsset?.mime).toBe(fmt.mime);
        expect(createdSessions).toHaveLength(1);
        expect(createdSessions[0].origin).toBe("file");
        expect(finalizedSessions).toContain(createdSessions[0].id);
      });
    }

    it("rejects unsupported extensions gracefully", async () => {
      const unsupported = ["/path/test.exe", "/path/book.pdf", "/path/notes.txt"];
      const res = await importMediaFiles({ paths: unsupported });

      expect(res.successCount).toBe(0);
      expect(res.failedCount).toBe(3);
      expect(createdSessions).toHaveLength(0);
      expect(res.items[0].error).toContain("Unsupported media format");
    });
  });

  describe("Extension vs codec vs player capability detection", () => {
    it("distinguishes supported extension from unsupported codec and keeps original asset", async () => {
      const fakeProbe = vi.fn().mockResolvedValue({
        canPlay: false,
        supported: false,
        error: "Hardware codec HEVC not decodable on current platform",
      });

      const res = await importMediaFiles({
        paths: ["/videos/sample.mov"],
        probeOverride: fakeProbe,
      });

      expect(res.successCount).toBe(1);
      expect(res.items[0].status).toBe("success");
      expect(res.items[0].error).toContain("Hardware codec HEVC");
      // Media asset is still retained and finalized in the session
      expect(res.items[0].assetId).toBeDefined();
      expect(finalizedSessions).toHaveLength(1);
    });

    it("retains original asset on probe exception / decode failure", async () => {
      const failingProbe = vi.fn().mockRejectedValue(new Error("Probe timeout"));

      const res = await importMediaFiles({
        paths: ["/audio/lecture.flac"],
        probeOverride: failingProbe,
      });

      expect(res.successCount).toBe(1);
      expect(res.items[0].assetId).toBeDefined();
      expect(finalizedSessions).toHaveLength(1);
    });
  });

  describe("Collision and IO safety", () => {
    it("colliding basenames in different folders produce independent sessions without overwriting", async () => {
      const paths = ["/folderA/lecture.mp3", "/folderB/lecture.mp3"];

      const res = await importMediaFiles({ paths });

      expect(res.successCount).toBe(2);
      expect(createdSessions).toHaveLength(2);
      expect(createdSessions[0].id).not.toBe(createdSessions[1].id);
      expect(stagedAssets[0].assetId).not.toBe(stagedAssets[1].assetId);
    });

    it("IO failure or permission denied does not abort remaining batch items", async () => {
      vi.spyOn(sessionController, "stageMedia")
        .mockRejectedValueOnce(new Error("PermissionDenied: read access denied to /restricted/file.mp3"))
        .mockImplementationOnce(async (sessionId, sourcePath, mime) => ({
          id: "asset-ok",
          sessionId,
          kind: "original",
          relativePath: `recordings/${sessionId}/asset_ok.mp3`,
          mime,
          byteLength: 500,
          sha256: "sha-ok",
          state: "ready",
          createdAt: new Date().toISOString(),
        } as unknown as SessionMediaAsset));

      const res = await importMediaFiles({
        paths: ["/restricted/file.mp3", "/valid/file.mp3"],
      });

      expect(res.failedCount).toBe(1);
      expect(res.successCount).toBe(1);
      expect(res.items[0].status).toBe("failed");
      expect(res.items[0].error).toContain("PermissionDenied");
      expect(res.items[1].status).toBe("success");
    });
  });

  describe("Progress and streaming guarantees", () => {
    it("reports progress for each item in batch", async () => {
      const progressCalls: Array<{ current: number; total: number; path: string }> = [];

      await importMediaFiles({
        paths: ["/media/1.mp3", "/media/2.m4a", "/media/3.wav"],
        onProgress: (current, total, path) => progressCalls.push({ current, total, path }),
      });

      expect(progressCalls).toHaveLength(3);
      expect(progressCalls[0]).toEqual({ current: 1, total: 3, path: "/media/1.mp3" });
      expect(progressCalls[2]).toEqual({ current: 3, total: 3, path: "/media/3.wav" });
    });
  });
});
