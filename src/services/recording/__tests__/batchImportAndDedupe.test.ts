import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importMediaFiles, retryFailedImports } from "../importMedia";
import { sessionController } from "../SessionController";
import * as recordingSessionsApi from "../../../api/recordingSessions";
import type { RecordingSession, SessionMediaAsset } from "../../../types/recordingSession";

describe("Batch Import and Exact-Source Deduplication (Task 1.6)", () => {
  let createdSessions: Array<{ id: string; title: string; collectionId?: string }>;
  let stagedAssets: Array<{ sessionId: string; sourcePath: string; mime: string }>;
  let finalizedSessions: string[];

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
      createdSessions.push({ id, title: opts.title || "Untitled", collectionId: opts.collectionId });
      return session;
    });

    vi.spyOn(sessionController, "stageMedia").mockImplementation(async (sessionId, sourcePath, mime) => {
      const assetId = `asset-${Math.random().toString(36).slice(2, 8)}`;
      stagedAssets.push({ sessionId, sourcePath, mime });
      // Use the file name as a predictable mock sha256
      const sha256 = sourcePath.includes("dup") ? "sha256-duplicate-hash" : `sha256-${sourcePath}`;
      return {
        id: assetId,
        sessionId,
        kind: "original",
        relativePath: `recordings/${sessionId}/asset.${sourcePath.split(".").pop()}`,
        mime,
        byteLength: 2048,
        sha256,
        durationMs: null,
        sourceUrl: null,
        sourceAdapter: null,
        state: "ready",
        createdAt: new Date().toISOString(),
      } as SessionMediaAsset;
    });

    vi.spyOn(sessionController, "finalizeIngestion").mockImplementation(async (input) => {
      finalizedSessions.push(input.sessionId);
      return {} as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects exact-source duplicate by sha256 and defaults to reuse without finalizing duplicate session", async () => {
    const existingSession = {
      id: "sess-existing-123",
      documentId: "doc-existing-123",
      origin: "file",
      collectionId: "col-1",
    } as unknown as RecordingSession;

    vi.spyOn(recordingSessionsApi, "findSessionByMediaHash").mockImplementation(async (hash, colId) => {
      if (hash === "sha256-duplicate-hash") {
        return existingSession;
      }
      return null;
    });

    const res = await importMediaFiles({
      paths: ["/media/dup_lecture.mp3"],
      collectionId: "col-1",
    });

    expect(res.duplicateCount).toBe(1);
    expect(res.successCount).toBe(0);
    expect(res.failedCount).toBe(0);
    expect(res.items[0].status).toBe("duplicate");
    expect(res.items[0].sessionId).toBe("sess-existing-123");
    expect(res.items[0].documentId).toBe("doc-existing-123");
    expect(res.items[0].duplicateSession?.id).toBe("sess-existing-123");
    // Duplicate was not finalized as a new session
    expect(finalizedSessions).not.toContain("sess-existing-123");
  });

  it("creates a separate session when duplicateAction is explicitly 'create-separate'", async () => {
    const existingSession = {
      id: "sess-existing-456",
      documentId: "doc-existing-456",
    } as unknown as RecordingSession;

    vi.spyOn(recordingSessionsApi, "findSessionByMediaHash").mockResolvedValue(existingSession);

    const res = await importMediaFiles({
      paths: ["/media/dup_lecture.mp3"],
      duplicateAction: "create-separate",
    });

    expect(res.duplicateCount).toBe(0);
    expect(res.successCount).toBe(1);
    expect(res.items[0].status).toBe("success");
    expect(res.items[0].sessionId).not.toBe("sess-existing-456");
    expect(finalizedSessions).toHaveLength(1);
  });

  it("propagates collection assignment correctly to each created session in batch", async () => {
    vi.spyOn(recordingSessionsApi, "findSessionByMediaHash").mockResolvedValue(null);

    const res = await importMediaFiles({
      paths: ["/media/part1.mp3", "/media/part2.mp3"],
      collectionId: "history-101",
    });

    expect(res.successCount).toBe(2);
    expect(createdSessions).toHaveLength(2);
    expect(createdSessions[0].collectionId).toBe("history-101");
    expect(createdSessions[1].collectionId).toBe("history-101");
  });

  it("retryFailedImports retries only failed items without repeating successful or duplicate items", async () => {
    vi.spyOn(recordingSessionsApi, "findSessionByMediaHash").mockImplementation(async (hash) => {
      if (hash === "sha256-duplicate-hash") {
        return { id: "existing-sess" } as RecordingSession;
      }
      return null;
    });

    // Make stageMedia fail for corrupt.mp3
    vi.spyOn(sessionController, "stageMedia").mockImplementation(async (sessionId, sourcePath, mime) => {
      if (sourcePath.includes("corrupt")) {
        throw new Error("Disk read error: corrupted block");
      }
      return {
        id: `asset-${sessionId}`,
        sessionId,
        kind: "original",
        relativePath: `recordings/${sessionId}/asset.mp3`,
        mime,
        byteLength: 100,
        sha256: sourcePath.includes("dup") ? "sha256-duplicate-hash" : `sha256-${sourcePath}`,
        state: "ready",
        createdAt: new Date().toISOString(),
      } as SessionMediaAsset;
    });

    const initialBatch = await importMediaFiles({
      paths: ["/media/ok.mp3", "/media/corrupt.mp3", "/media/dup.mp3"],
    });

    expect(initialBatch.successCount).toBe(1);
    expect(initialBatch.failedCount).toBe(1);
    expect(initialBatch.duplicateCount).toBe(1);

    // Fix the error for the retry
    vi.spyOn(sessionController, "stageMedia").mockImplementation(async (sessionId, sourcePath, mime) => {
      return {
        id: `asset-retried-${sessionId}`,
        sessionId,
        kind: "original",
        relativePath: `recordings/${sessionId}/asset.mp3`,
        mime,
        byteLength: 100,
        sha256: `sha256-${sourcePath}`,
        state: "ready",
        createdAt: new Date().toISOString(),
      } as SessionMediaAsset;
    });

    const sessionsBeforeRetry = createdSessions.length;

    const retriedBatch = await retryFailedImports(initialBatch, {
      contentType: "lecture",
    });

    // Retry only ran for corrupt.mp3 (1 additional session created)
    expect(createdSessions.length).toBe(sessionsBeforeRetry + 1);

    // The merged batch reflects the resolution of the failed item
    expect(retriedBatch.items).toHaveLength(3);
    const retriedCorrupt = retriedBatch.items.find((i) => i.filePath === "/media/corrupt.mp3");
    expect(retriedCorrupt?.status).toBe("success");
    expect(retriedBatch.successCount).toBe(2);
    expect(retriedBatch.failedCount).toBe(0);
    expect(retriedBatch.duplicateCount).toBe(1);
  });
});
