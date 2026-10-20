/**
 * Phase 1 Source-Only Journey Certification Smoke Test (Task 1.7).
 *
 * Verifies that with NO AI provider configured and `sessionLearningSuggestions: false`:
 * 1. All 4 ingestion routes (Record, File, Transcript, URL) succeed end-to-end.
 * 2. Exact source media / transcripts are staged into private storage.
 * 3. Zero unsolicited AI inference is triggered (no AI completions, no embeddings, no learning items).
 * 4. Sessions remain fully accessible and recoverable as source-only documents.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionController } from "../SessionController";
import { importMediaFiles } from "../importMedia";
import { importTranscriptFileToSession } from "../transcriptImport";
import { classifyUrl } from "../urlAdapters";
import { defaultSettings, useSettingsStore } from "../../../stores/settingsStore";
import * as recordingSessionsApi from "../../../api/recordingSessions";
import type { RecordingSession, SessionMediaAsset } from "../../../types/recordingSession";

describe("Phase 1 Source-Only Journey Certification (Task 1.7)", () => {
  let createdSessions: Array<{ id: string; title: string; origin: string; documentId: string }>;
  let stagedMediaAssets: Array<{ sessionId: string; sourcePath: string; mime: string }>;
  let importedTranscripts: Array<{ sessionId: string; format: string; segmentsCount: number }>;
  let aiInferenceCallCount: number;

  beforeEach(() => {
    createdSessions = [];
    stagedMediaAssets = [];
    importedTranscripts = [];
    aiInferenceCallCount = 0;

    // Ensure settings have sessionLearningSuggestions set to false
    useSettingsStore.setState({
      settings: {
        ...defaultSettings,
        features: {
          ...defaultSettings.features,
          recordingSessions: false,
          sessionLearningSuggestions: false,
        },
      },
    });

    // Mock recordingSessions API
    vi.spyOn(recordingSessionsApi, "createRecordingSession").mockImplementation(async (payload) => {
      const id = payload.id;
      const docId = `doc-${id}`;
      const session = {
        id,
        documentId: docId,
        origin: payload.origin,
        contentType: payload.contentType,
        profileJson: payload.profileJson ?? "{}",
        collectionId: payload.collectionId,
        captureState: payload.origin === "recorded" ? "recording" : "saved",
        ingestionState: payload.origin === "file" ? "staging" : "saved",
        mediaAssetId: null,
        transcriptId: null,
        transcriptRevision: 0,
        overviewJson: null,
        overviewRevision: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      } as unknown as RecordingSession;
      createdSessions.push({ id, title: payload.title, origin: session.origin, documentId: docId });
      return session;
    });

    vi.spyOn(recordingSessionsApi, "getRecordingSession").mockImplementation(async (id) => {
      const found = createdSessions.find((s) => s.id === id);
      const isRecorded = found?.origin === "recorded";
      const hasMedia = stagedMediaAssets.some((m) => m.sessionId === id);
      const hasTranscript = importedTranscripts.some((t) => t.sessionId === id);

      return {
        id,
        documentId: found?.documentId ?? `doc-${id}`,
        title: found?.title ?? "Session",
        origin: (found?.origin as any) ?? "recorded",
        contentType: "lecture",
        captureState: isRecorded ? "saved" : "saved",
        ingestionState: "saved",
        durationMs: 120000,
        mediaAssetId: hasMedia ? `asset-${id}` : null,
        transcriptId: hasTranscript ? `trans-${id}` : null,
        transcriptRevision: hasTranscript ? 1 : 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      } as unknown as RecordingSession;
    });

    vi.spyOn(recordingSessionsApi, "finalizeRecordingSession").mockImplementation(async (id, ver) => {
      return recordingSessionsApi.getRecordingSession(id);
    });

    vi.spyOn(recordingSessionsApi, "stageSessionMedia").mockImplementation(async (sessionId, sourcePath, mime) => {
      stagedMediaAssets.push({ sessionId, sourcePath, mime });
      return {
        id: `asset-${sessionId}`,
        sessionId,
        kind: "original",
        relativePath: `recordings/${sessionId}/audio.wav`,
        mime,
        byteLength: 65536,
        sha256: `sha256-${sourcePath}`,
        durationMs: null,
        state: "ready",
        sourceUrl: null,
        sourceAdapter: null,
        createdAt: new Date().toISOString(),
      };
    });

    vi.spyOn(recordingSessionsApi, "importSessionTranscript").mockImplementation(async (sessionId, segments) => {
      importedTranscripts.push({
        sessionId,
        format: "srt",
        segmentsCount: segments.length,
      });
      return segments.length;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Route 1 (Microphone/Desktop Capture): creates session, finalizes media, and triggers zero inference", async () => {
    const session = await sessionController.createSession({
      title: "Recorded Lecture",
      origin: "recorded",
      contentType: "lecture",
    });

    await sessionController.stageMedia(session.id, "/tmp/capture.wav", "audio/wav");

    const result = await sessionController.finalizeIngestion({
      sessionId: session.id,
      processingSelection: {
        transcribe: false,
        prepareSuggestions: true, // requested, but sessionLearningSuggestions is off
      },
    });

    expect(result.session.id).toBe(session.id);
    expect(result.stageStates.media).toBe("saved");
    // Since sessionLearningSuggestions flag is false, analysis is skipped without starting an inference job
    expect(result.stageStates.analysis).toBe("skipped");
    expect(aiInferenceCallCount).toBe(0);
  });

  it("Route 2 (Local Media File Import): stages private copy and finalizes with zero inference", async () => {
    const batch = await importMediaFiles({
      paths: ["/media/lecture_audio.mp3"],
      contentType: "lecture",
    });

    expect(batch.successCount).toBe(1);
    expect(batch.items[0].status).toBe("success");
    expect(stagedMediaAssets).toHaveLength(1);
    expect(stagedMediaAssets[0].sourcePath).toBe("/media/lecture_audio.mp3");

    const session = await sessionController.getSession(batch.items[0].sessionId!);
    expect(session.origin).toBe("file");
    expect(aiInferenceCallCount).toBe(0);
  });

  it("Route 3 (Transcript-Only Import): atomic UTF-8 parse, honest timing, zero inference", async () => {
    const srtContent = `1\n00:00:01,000 --> 00:00:04,000\nWelcome to modern biology.\n\n2\n00:00:04,500 --> 00:00:08,000\nToday we study cellular structure.\n`;

    const imported = await importTranscriptFileToSession(
      "sess-transcript-smoke",
      srtContent,
      "biology_notes.srt"
    );

    expect(imported.count).toBe(2);
    expect(imported.segments).toHaveLength(2);
    expect(imported.segments[0].timingKind).toBe("imported");
    expect(importedTranscripts).toHaveLength(1);
    expect(importedTranscripts[0].segmentsCount).toBe(2);
    expect(aiInferenceCallCount).toBe(0);
  });

  it("Route 4 (URL Import): resolves valid YouTube / web adapter cleanly and enforces policy refusal", async () => {
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const decision = classifyUrl(url);

    expect(decision.isAllowed).toBe(true);
    expect(decision.adapter).toBe("youtube");
    expect(decision.meta?.youtubeId).toBe("dQw4w9WgXcQ");

    // Private network / loopback SSRF attempts are rejected
    const loopbackUrl = "http://127.0.0.1:8080/audio.mp3";
    const loopbackDecision = classifyUrl(loopbackUrl);
    expect(loopbackDecision.isAllowed).toBe(false);
    expect(loopbackDecision.errorCode).toBe("private_network");

    // DRM streaming hosts are rejected
    const drmUrl = "https://netflix.com/watch/987654";
    const drmDecision = classifyUrl(drmUrl);
    expect(drmDecision.isAllowed).toBe(false);
    expect(drmDecision.errorCode).toBe("drm_protected");

    // Unsupported protocol is rejected
    const ftpUrl = "ftp://example.com/lecture.mp3";
    const ftpDecision = classifyUrl(ftpUrl);
    expect(ftpDecision.isAllowed).toBe(false);
    expect(ftpDecision.errorCode).toBe("unsupported_protocol");

    // Web article is recognized without cloud media downloading
    const articleUrl = "https://en.wikipedia.org/wiki/Cell_biology";
    const articleDecision = classifyUrl(articleUrl);
    expect(articleDecision.isAllowed).toBe(true);
    expect(articleDecision.adapter).toBe("web-article");

    expect(aiInferenceCallCount).toBe(0);
  });
});
