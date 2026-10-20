import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTranscriptionQueueStore } from "../transcriptionQueueStore";
import * as transcriptionApi from "../../api/transcription";

vi.mock("../../api/transcription", () => ({
  getTranscriptionQueue: vi.fn(),
  cancelTranscriptionJob: vi.fn(),
  retryTranscriptionJob: vi.fn(),
  prioritizeTranscriptionJob: vi.fn(),
  clearTranscriptionQueue: vi.fn(),
  removeTranscriptionEntry: vi.fn(),
}));

describe("TranscriptionQueueStore (Task 0.13 / OpenSpec D6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTranscriptionQueueStore.setState({
      entries: [],
      activeProgress: 0,
      activeSegments: 0,
      activePhase: null,
      sessionProgress: {},
      isLoading: false,
      backendFallbackNotice: null,
    });
  });

  it("updates and retrieves session-specific progress without losing simultaneous session state", () => {
    const store = useTranscriptionQueueStore.getState();

    // Progress for Session A
    store.updateSessionProgress({
      jobId: "job-A",
      sessionId: "session-A",
      transcriptRevision: 1,
      progress: 35,
      processedDurationMs: 35000,
      totalDurationMs: 100000,
      provider: "local",
    });

    // Progress for Session B
    store.updateSessionProgress({
      jobId: "job-B",
      sessionId: "session-B",
      transcriptRevision: 2,
      progress: 70,
      processedDurationMs: 70000,
      totalDurationMs: 100000,
      provider: "groq",
    });

    const progressA = useTranscriptionQueueStore.getState().getSessionProgress("session-A");
    const progressB = useTranscriptionQueueStore.getState().getSessionProgress("session-B");
    const progressByJobA = useTranscriptionQueueStore.getState().getSessionProgress("job-A");

    expect(progressA).toBeDefined();
    expect(progressA?.progress).toBe(35);
    expect(progressA?.provider).toBe("local");

    expect(progressB).toBeDefined();
    expect(progressB?.progress).toBe(70);
    expect(progressB?.provider).toBe("groq");

    expect(progressByJobA).toBeDefined();
    expect(progressByJobA?.sessionId).toBe("session-A");

    // activeProgress reflects the most recent update
    expect(useTranscriptionQueueStore.getState().activeProgress).toBe(70);
  });

  it("cancel calls cancelTranscriptionJob and refreshes the queue", async () => {
    vi.mocked(transcriptionApi.cancelTranscriptionJob).mockResolvedValue(undefined as any);
    vi.mocked(transcriptionApi.getTranscriptionQueue).mockResolvedValue([
      {
        id: "job-1",
        documentId: "doc-1",
        status: "cancelled",
        priority: 0,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        retryCount: 0,
        progress: 0,
        audioPath: "/audio.wav",
        provider: "local",
        documentTitle: "Doc 1",
      } as any,
    ]);

    await useTranscriptionQueueStore.getState().cancel("job-1");

    expect(transcriptionApi.cancelTranscriptionJob).toHaveBeenCalledWith("job-1");
    expect(transcriptionApi.getTranscriptionQueue).toHaveBeenCalled();
    expect(useTranscriptionQueueStore.getState().entries).toHaveLength(1);
    expect(useTranscriptionQueueStore.getState().entries[0].status).toBe("cancelled");
  });

  it("getEntryForDocument locates entry by documentId", () => {
    useTranscriptionQueueStore.setState({
      entries: [
        {
          id: "job-10",
          documentId: "doc-find-me",
          status: "processing",
        } as any,
      ],
    });

    const found = useTranscriptionQueueStore.getState().getEntryForDocument("doc-find-me");
    expect(found).toBeDefined();
    expect(found?.id).toBe("job-10");

    const notFound = useTranscriptionQueueStore.getState().getEntryForDocument("doc-nonexistent");
    expect(notFound).toBeUndefined();
  });
});
