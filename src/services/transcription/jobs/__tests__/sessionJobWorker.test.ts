import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionJobWorker } from "../sessionJobWorker";
import * as transcriptionApi from "../../../../api/transcription";
import * as docPrivacy from "../../../../lib/documentPrivacy";
import * as transcriptionIndex from "../../index";
import * as persistModule from "../../persist";
import type { TranscriptionQueueEntry } from "../../../../api/transcription";

vi.mock("../../../../lib/documentPrivacy", () => ({
  getDocumentPrivacy: vi.fn(),
}));

vi.mock("../../index", () => ({
  getTranscriptionService: vi.fn(),
}));

describe("SessionJobWorker (Task 0.11 / OpenSpec D6)", () => {
  const fakeJob: TranscriptionQueueEntry = {
    id: "job-1",
    documentId: "doc-1",
    chapterId: null,
    audioPath: "/path/to/audio.wav",
    provider: "local",
    modelId: "whisper-base",
    language: "en",
    status: "processing",
    errorMessage: null,
    priority: 0,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    retryCount: 0,
    progress: 0,
    sessionId: "sess-1",
    transcriptRevision: 1,
    executor: "frontend-service",
    planJson: JSON.stringify({
      sessionId: "sess-1",
      transcriptRevision: 1,
      provider: "local",
      modelId: "whisper-base",
      modelLabel: "Whisper Base",
      language: "en",
      executor: "frontend-service",
      isLocal: true,
      sourceRevision: 1,
      privacyCategory: "local-only",
      frozenAt: new Date().toISOString(),
    }),
    cancelEpoch: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it("Two workers racing -> only one claims the job", async () => {
    const claimSpy = vi.spyOn(transcriptionApi, "claimTranscriptionJob");
    const completeSpy = vi.spyOn(transcriptionApi, "completeTranscriptionJobWithLease").mockResolvedValue(true);
    vi.spyOn(transcriptionApi, "renewTranscriptionLease").mockResolvedValue(true);
    vi.spyOn(docPrivacy, "getDocumentPrivacy").mockResolvedValue({
      isLocalOnly: false,
      isAiExcluded: false,
      privacyVersion: 1,
    });

    const mockTranscribe = vi.fn().mockResolvedValue({
      text: "hello world",
      segments: [],
      providerId: "local",
    });
    vi.spyOn(transcriptionIndex, "getTranscriptionService").mockReturnValue({
      transcribe: mockTranscribe,
    } as any);

    // Worker A succeeds in claiming, Worker B gets null
    claimSpy
      .mockResolvedValueOnce({ ...fakeJob, leaseOwner: "worker-A" })
      .mockResolvedValueOnce(null);

    const workerA = new SessionJobWorker({ workerId: "worker-A" });
    const workerB = new SessionJobWorker({ workerId: "worker-B" });

    const [handledA, handledB] = await Promise.all([workerA.tick(), workerB.tick()]);

    expect(handledA).toBe(true);
    expect(handledB).toBe(false);
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    expect(completeSpy).toHaveBeenCalledWith("job-1", "worker-A", 0);
  });

  it("Expired lease resumes -> second worker successfully claims job", async () => {
    const claimSpy = vi.spyOn(transcriptionApi, "claimTranscriptionJob");
    vi.spyOn(transcriptionApi, "completeTranscriptionJobWithLease").mockResolvedValue(true);
    vi.spyOn(transcriptionApi, "renewTranscriptionLease").mockResolvedValue(true);
    vi.spyOn(docPrivacy, "getDocumentPrivacy").mockResolvedValue({
      isLocalOnly: false,
      isAiExcluded: false,
      privacyVersion: 1,
    });

    const mockTranscribe = vi.fn().mockResolvedValue({
      text: "recovered transcript",
      segments: [],
      providerId: "local",
    });
    vi.spyOn(transcriptionIndex, "getTranscriptionService").mockReturnValue({
      transcribe: mockTranscribe,
    } as any);

    // Worker B claims expired job originally held by Worker A
    claimSpy.mockResolvedValueOnce({
      ...fakeJob,
      leaseOwner: "worker-B",
      retryCount: 1,
    });

    const workerB = new SessionJobWorker({ workerId: "worker-B" });
    const handled = await workerB.tick();

    expect(handled).toBe(true);
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
  });

  it("Refuses cloud transcription for local-only document", async () => {
    vi.spyOn(transcriptionApi, "claimTranscriptionJob").mockResolvedValue({
      ...fakeJob,
      provider: "groq",
      planJson: JSON.stringify({
        sessionId: "sess-1",
        transcriptRevision: 1,
        provider: "groq",
        isLocal: false,
      }),
    });
    const failSpy = vi.spyOn(transcriptionApi, "failTranscriptionJobWithLease").mockResolvedValue(true);
    vi.spyOn(docPrivacy, "getDocumentPrivacy").mockResolvedValue({
      isLocalOnly: true,
      isAiExcluded: false,
      privacyVersion: 1,
    });

    const mockTranscribe = vi.fn();
    vi.spyOn(transcriptionIndex, "getTranscriptionService").mockReturnValue({
      transcribe: mockTranscribe,
    } as any);

    const worker = new SessionJobWorker({ workerId: "worker-test" });
    await worker.tick();

    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(failSpy).toHaveBeenCalledWith(
      "job-1",
      "worker-test",
      expect.stringContaining("Local-only document policy forbids cloud transcription"),
      0,
    );
  });

  it("Refuses cloud transcription for AI-excluded document", async () => {
    vi.spyOn(transcriptionApi, "claimTranscriptionJob").mockResolvedValue({
      ...fakeJob,
      provider: "openrouter",
      planJson: JSON.stringify({
        sessionId: "sess-1",
        transcriptRevision: 1,
        provider: "openrouter",
        isLocal: false,
      }),
    });
    const failSpy = vi.spyOn(transcriptionApi, "failTranscriptionJobWithLease").mockResolvedValue(true);
    vi.spyOn(docPrivacy, "getDocumentPrivacy").mockResolvedValue({
      isLocalOnly: false,
      isAiExcluded: true,
      privacyVersion: 1,
    });

    const mockTranscribe = vi.fn();
    vi.spyOn(transcriptionIndex, "getTranscriptionService").mockReturnValue({
      transcribe: mockTranscribe,
    } as any);

    const worker = new SessionJobWorker({ workerId: "worker-test" });
    await worker.tick();

    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(failSpy).toHaveBeenCalledWith(
      "job-1",
      "worker-test",
      expect.stringContaining("AI-excluded document policy forbids cloud transcription"),
      0,
    );
  });

  it("Blocks cloud execution when consent is missing or declined", async () => {
    vi.spyOn(transcriptionApi, "claimTranscriptionJob").mockResolvedValue({
      ...fakeJob,
      provider: "groq",
      authorizationJson: JSON.stringify({
        sessionId: "sess-1",
        providerClass: "plethora-hosted",
        provider: "groq",
        endpoint: "https://api.groq.com",
        sourceKind: "recording",
        sourceRevision: 1,
        userConsented: false,
        authorizedAt: new Date().toISOString(),
      }),
    });
    const failSpy = vi.spyOn(transcriptionApi, "failTranscriptionJobWithLease").mockResolvedValue(true);
    vi.spyOn(docPrivacy, "getDocumentPrivacy").mockResolvedValue({
      isLocalOnly: false,
      isAiExcluded: false,
      privacyVersion: 1,
    });

    const mockTranscribe = vi.fn();
    vi.spyOn(transcriptionIndex, "getTranscriptionService").mockReturnValue({
      transcribe: mockTranscribe,
    } as any);

    const worker = new SessionJobWorker({ workerId: "worker-test" });
    await worker.tick();

    expect(mockTranscribe).not.toHaveBeenCalled();
    expect(failSpy).toHaveBeenCalledWith(
      "job-1",
      "worker-test",
      expect.stringContaining("Consent required for cloud session transcription"),
      0,
    );
  });

  it("Heartbeat lease renewal failure aborts transcription", async () => {
    vi.spyOn(transcriptionApi, "claimTranscriptionJob").mockResolvedValue({
      ...fakeJob,
      leaseOwner: "worker-heartbeat",
    });
    // First renew returns false (lease lost / cancelled)
    const renewSpy = vi
      .spyOn(transcriptionApi, "renewTranscriptionLease")
      .mockResolvedValue(false);
    vi.spyOn(docPrivacy, "getDocumentPrivacy").mockResolvedValue({
      isLocalOnly: false,
      isAiExcluded: false,
      privacyVersion: 1,
    });

    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(transcriptionIndex, "getTranscriptionService").mockReturnValue({
      transcribe: vi.fn().mockImplementation((_input, opts) => {
        capturedSignal = opts?.signal;
        return new Promise((_resolve, reject) => {
          if (opts?.signal?.aborted) {
            reject(new Error("Aborted"));
            return;
          }
          opts?.signal?.addEventListener("abort", () => {
            reject(new Error("Aborted"));
          });
        });
      }),
    } as any);

    const worker = new SessionJobWorker({
      workerId: "worker-heartbeat",
      heartbeatIntervalMs: 10_000,
    });

    const tickPromise = worker.tick();

    // Advance 10s to trigger the heartbeat
    await vi.advanceTimersByTimeAsync(10_000);

    expect(renewSpy).toHaveBeenCalled();
    expect(capturedSignal?.aborted).toBe(true);

    await tickPromise;
  });

  it("Persists session unit with words, speaker, confidence, and atomic checkpoint", async () => {
    vi.spyOn(transcriptionApi, "claimTranscriptionJob").mockResolvedValue({
      ...fakeJob,
      leaseOwner: "worker-persist",
    });
    vi.spyOn(transcriptionApi, "renewTranscriptionLease").mockResolvedValue(true);
    vi.spyOn(transcriptionApi, "completeTranscriptionJobWithLease").mockResolvedValue(true);
    vi.spyOn(docPrivacy, "getDocumentPrivacy").mockResolvedValue({
      isLocalOnly: false,
      isAiExcluded: false,
      privacyVersion: 1,
    });

    const persistSpy = vi
      .spyOn(persistModule, "persistSessionTranscriptionUnit")
      .mockResolvedValue(2);

    const mockResult = {
      text: "hello hello world",
      segments: [
        {
          startMs: 0,
          endMs: 2000,
          text: "hello hello world",
          confidence: 0.95,
          speakerId: "spk-1",
          words: [
            { word: "hello", startMs: 0, endMs: 900 },
            { word: "hello", startMs: 1000, endMs: 1900 },
          ],
        },
      ],
      providerId: "local",
      durationMs: 2000,
    };

    vi.spyOn(transcriptionIndex, "getTranscriptionService").mockReturnValue({
      transcribe: vi.fn().mockResolvedValue(mockResult),
    } as any);

    const worker = new SessionJobWorker({ workerId: "worker-persist" });
    await worker.tick();

    expect(persistSpy).toHaveBeenCalledWith(
      mockResult,
      expect.objectContaining({
        jobId: "job-1",
        sessionId: "sess-1",
        leaseOwner: "worker-persist",
        processedDurationMs: 2000,
      }),
    );
  });

  it("transcriptionResultToSessionSegments preserves untimed segments without synthetic timing", () => {
    const untimedResult = {
      text: "Untimed passage text",
      segments: [],
      providerId: "local",
    };

    const segments = persistModule.transcriptionResultToSessionSegments(untimedResult, {
      unitKey: "unit-1",
      timingKind: "none",
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].timingKind).toBe("none");
    expect(segments[0].startMs).toBeNull();
    expect(segments[0].endMs).toBeNull();
    expect(segments[0].text).toBe("Untimed passage text");
  });

  it("transcriptionResultToSessionSegments keeps repeated spoken words distinct", () => {
    const timedResult = {
      text: "never never give up",
      segments: [
        {
          startMs: 100,
          endMs: 3000,
          text: "never never give up",
          confidence: 0.9,
          words: [
            { word: "never", startMs: 100, endMs: 600 },
            { word: "never", startMs: 700, endMs: 1200 },
            { word: "give", startMs: 1300, endMs: 2000 },
            { word: "up", startMs: 2100, endMs: 2800 },
          ],
        },
      ],
      providerId: "local",
    };

    const segments = persistModule.transcriptionResultToSessionSegments(timedResult, {
      unitKey: "unit-rep",
      timeOffsetMs: 5000,
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].startMs).toBe(5100);
    expect(segments[0].endMs).toBe(8000);
    const parsedWords = JSON.parse(segments[0].wordsJson!);
    expect(parsedWords).toHaveLength(4);
    expect(parsedWords[0].text).toBe("never");
    expect(parsedWords[0].startMs).toBe(5100);
    expect(parsedWords[1].text).toBe("never");
    expect(parsedWords[1].startMs).toBe(5700);
  });
});
