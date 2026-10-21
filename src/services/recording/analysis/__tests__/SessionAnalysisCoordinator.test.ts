import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SessionAnalysisCoordinator,
} from "../SessionAnalysisCoordinator";
import * as recordingSessionsApi from "../../../../api/recordingSessions";
import type {
  PersistedSessionLearningDraft,
  RecordingSession,
  SessionAnalysisRun,
  SessionAnalysisUnit,
  SessionSegmentPage,
  SessionTranscriptSegment,
} from "../../../../types/recordingSession";
import { SESSION_ANALYSIS_TASK_VERSION } from "../../../../lib/ai/schemas/sessionAnalysis";

describe("SessionAnalysisCoordinator (Task 3.5, Design D8)", () => {
  let coordinator: SessionAnalysisCoordinator;
  let mockSession: RecordingSession;
  let mockSegments: SessionTranscriptSegment[];
  let persistedRuns: SessionAnalysisRun[];
  let persistedUnits: SessionAnalysisUnit[];
  let persistedDrafts: PersistedSessionLearningDraft[];
  let updatedOverview: { id: string; json: string; rev: number } | null = null;
  let providerCallsCount: number;

  const mockProvider: any = {
    id: "fake-deterministic-provider",
    kind: "cloud",
    getCapabilities: async () => ({
      textGeneration: true,
      structuredGeneration: true,
      vision: false,
      multiImage: false,
      systemInstructions: true,
      toolCalling: false,
      reasoning: false,
      embeddings: false,
      contextTokens: 8192,
      streaming: false,
      prefixCaching: false,
      offlineAvailable: true,
      downloadState: "downloaded",
    }),
    generateStream: vi.fn(async (req) => {
      providerCallsCount++;
      if (req.text.includes("Section summaries to synthesize")) {
        // Overview task response
        return {
          requestId: "req-overview",
          text: JSON.stringify({
            overviewSummary: "Executive overview of the full session.",
            outline: ["Introduction", "Core Principles", "Conclusion"],
            keyTakeaways: ["Principle 1 is key", "Principle 2 is essential"],
            concepts: [{ name: "Principle 1" }],
            taskVersion: SESSION_ANALYSIS_TASK_VERSION,
          }),
        };
      }

      // Section task response
      return {
        requestId: `req-section-${providerCallsCount}`,
        text: JSON.stringify({
          sectionSummary: "Section summary covering basic fundamentals.",
          topics: ["Fundamentals"],
          concepts: [{ name: "Fundamental Concept", definition: "A basic building block." }],
          extractProposals: [
            {
              quote: "The energy-momentum relation connects energy E, momentum p, and rest mass m_0.",
              summaryNote: "Key physics equation.",
            },
          ],
          cards: [
            {
              cardType: "qa",
              concept: "Fundamental Concept",
              question: "What does the energy-momentum relation connect?",
              answer: "It connects energy E, momentum p, and rest mass m_0.",
              evidenceQuote: "The energy-momentum relation connects energy E, momentum p, and rest mass m_0.",
            },
          ],
          taskVersion: SESSION_ANALYSIS_TASK_VERSION,
        }),
      };
    }),
  };

  beforeEach(() => {
    coordinator = new SessionAnalysisCoordinator();
    persistedRuns = [];
    persistedUnits = [];
    persistedDrafts = [];
    updatedOverview = null;
    providerCallsCount = 0;

    mockSession = {
      id: "sess-100",
      documentId: "doc-100",
      origin: "recorded",
      contentType: "lecture",
      profileJson: JSON.stringify({ enrichmentSelected: true, enableCards: true }),
      captureState: "saved",
      ingestionState: "saved",
      transcriptId: 1,
      mediaAssetId: "asset-1",
      transcriptRevision: 1,
      overviewJson: null,
      overviewRevision: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    mockSegments = [
      {
        segmentKey: "seg-1",
        transcriptId: 1,
        ordinal: 0,
        revision: 1,
        text: "Welcome to this physics lecture. The energy-momentum relation connects energy E, momentum p, and rest mass m_0. ",
        timing: { kind: "measured", startMs: 0, endMs: 8000 },
      },
      {
        segmentKey: "seg-2",
        transcriptId: 1,
        ordinal: 1,
        revision: 1,
        text: "We will now analyze invariant mass in relativistic collisions. ",
        timing: { kind: "measured", startMs: 8100, endMs: 15000 },
      },
    ];

    vi.spyOn(recordingSessionsApi, "getSessionDocumentPrivacy").mockResolvedValue({
      isLocalOnly: false,
      isAiExcluded: false,
      privacyVersion: 1,
    });

    vi.spyOn(recordingSessionsApi, "getRecordingSession").mockResolvedValue(mockSession);

    vi.spyOn(recordingSessionsApi, "getSessionSegments").mockResolvedValue({
      items: mockSegments,
      revision: 1,
    });

    vi.spyOn(recordingSessionsApi, "createSessionAnalysisRun").mockImplementation(async (input) => {
      const run: SessionAnalysisRun = {
        id: input.id,
        sessionId: input.sessionId,
        transcriptRevision: input.transcriptRevision,
        profileHash: input.profileHash,
        taskVersion: input.taskVersion,
        generationEpoch: input.generationEpoch,
        status: "running",
        completedUnits: 0,
        totalUnits: input.totalUnits,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      persistedRuns.push(run);
      return run;
    });

    vi.spyOn(recordingSessionsApi, "listSessionAnalysisUnits").mockImplementation(async (runId) => {
      return persistedUnits.filter((u) => u.runId === runId);
    });

    vi.spyOn(recordingSessionsApi, "upsertSessionAnalysisUnit").mockImplementation(async (input) => {
      const idx = persistedUnits.findIndex((u) => u.unitKey === input.unitKey && u.runId === input.runId);
      const unit: SessionAnalysisUnit = {
        runId: input.runId,
        unitKey: input.unitKey,
        inputHash: input.inputHash,
        segmentKeysJson: input.segmentKeysJson,
        status: input.status,
        resultJson: input.resultJson,
        attempts: 1,
        errorCode: input.errorCode,
      };
      if (idx !== -1) {
        persistedUnits[idx] = unit;
      } else {
        persistedUnits.push(unit);
      }
      return unit;
    });

    vi.spyOn(recordingSessionsApi, "createSessionLearningDraft").mockImplementation(async (input) => {
      const draft: PersistedSessionLearningDraft = {
        id: input.id,
        sessionId: input.sessionId,
        runId: input.runId ?? null,
        kind: input.kind,
        status: (input.status as any) || "proposed",
        revision: 1,
        payloadJson: input.payloadJson,
        evidenceJson: input.evidenceJson,
        contentHash: input.contentHash,
        conceptKey: input.conceptKey ?? null,
        duplicateJson: null,
        acceptedTargetId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      persistedDrafts.push(draft);
      return draft;
    });

    vi.spyOn(recordingSessionsApi, "listSessionLearningDrafts").mockImplementation(async () => {
      return { items: [...persistedDrafts], total: persistedDrafts.length };
    });

    vi.spyOn(recordingSessionsApi, "updateSessionLearningDraft").mockImplementation(async (input) => {
      const draft = persistedDrafts.find((d) => d.id === input.id);
      if (draft && input.status) {
        draft.status = input.status as any;
      }
      return draft!;
    });

    vi.spyOn(recordingSessionsApi, "updateRecordingSessionOverview").mockImplementation(
      async (id, json, rev) => {
        updatedOverview = { id, json, rev };
        mockSession.overviewJson = json;
        mockSession.overviewRevision = rev;
        return mockSession;
      }
    );
  });

  it("gating: fails closed when session document is AI-excluded", async () => {
    vi.spyOn(recordingSessionsApi, "getSessionDocumentPrivacy").mockResolvedValue({
      isLocalOnly: true,
      isAiExcluded: true,
      privacyVersion: 1,
    });

    await expect(
      coordinator.startAnalysis("sess-100", { forceProvider: mockProvider })
    ).rejects.toThrow("excluded from AI processing");

    expect(coordinator.getState()).toBe("failed");
    expect(persistedRuns).toHaveLength(0);
    expect(persistedUnits).toHaveLength(0);
    expect(persistedDrafts).toHaveLength(0);
  });

  it("gating: refuses execution when model context tokens are insufficient (< 512 available)", async () => {
    await expect(
      coordinator.startAnalysis("sess-100", {
        contextTokens: 1000,
        systemTokens: 600,
        forceProvider: mockProvider,
      })
    ).rejects.toThrow("Insufficient context window");

    expect(coordinator.getState()).toBe("failed");
    expect(persistedRuns).toHaveLength(0);
  });

  it("completes full deterministic run (A01 / A02 / A10) and creates safe drafts with zero active learning items", async () => {
    const progress = await coordinator.startAnalysis("sess-100", {
      forceProvider: mockProvider,
    });

    expect(progress.state).toBe("completed");
    expect(progress.completedUnits).toBeGreaterThan(0);
    expect(progress.proposedCards).toBeGreaterThan(0);
    expect(progress.proposedExtracts).toBeGreaterThan(0);

    // Verify run created
    expect(persistedRuns).toHaveLength(1);
    expect(persistedRuns[0].sessionId).toBe("sess-100");

    // Verify units checkpointed
    expect(persistedUnits.length).toBeGreaterThan(0);
    expect(persistedUnits.every((u) => u.status === "completed")).toBe(true);

    // Verify drafts persisted to safe staging (session_learning_drafts table)
    expect(persistedDrafts.length).toBeGreaterThan(0);
    for (const d of persistedDrafts) {
      expect(d.sessionId).toBe("sess-100");
      expect(d.status).toBe("proposed");
      expect(d.acceptedTargetId).toBeNull(); // ZERO active learning items created!
    }

    // Verify overview persisted to recording session row
    expect(updatedOverview).not.toBeNull();
    expect(updatedOverview?.id).toBe("sess-100");
    expect(updatedOverview?.json).toContain("Executive overview");
  });

  it("idempotency: re-running does not re-invoke AI inference for committed units with identical inputHash", async () => {
    // First run
    await coordinator.startAnalysis("sess-100", {
      forceProvider: mockProvider,
      generationEpoch: "epoch-fixed",
    });

    const initialProviderCalls = providerCallsCount;
    expect(initialProviderCalls).toBeGreaterThan(0);

    // Second run with identical session and segments
    const secondCoordinator = new SessionAnalysisCoordinator();
    await secondCoordinator.startAnalysis("sess-100", {
      forceProvider: mockProvider,
      generationEpoch: "epoch-fixed",
    });

    // Provider should NOT be called for already-completed section units!
    // (Only overview might be synthesized if not cached on unit level)
    expect(providerCallsCount).toBe(initialProviderCalls);
  });

  it("regenerate: marks unaccepted predecessor drafts as superseded upon new epoch success", async () => {
    // Run epoch 1
    await coordinator.startAnalysis("sess-100", {
      forceProvider: mockProvider,
      generationEpoch: "epoch-1",
    });

    const epoch1Drafts = [...persistedDrafts];
    expect(epoch1Drafts.length).toBeGreaterThan(0);
    expect(epoch1Drafts.every((d) => d.status === "proposed")).toBe(true);

    // Run epoch 2
    const nextCoordinator = new SessionAnalysisCoordinator();
    await nextCoordinator.startAnalysis("sess-100", {
      forceProvider: mockProvider,
      generationEpoch: "epoch-2",
    });

    // Predecessor drafts from epoch 1 should now be marked superseded!
    const updatedEpoch1Drafts = persistedDrafts.filter((d) => d.runId?.includes("epoch-1"));
    expect(updatedEpoch1Drafts.length).toBeGreaterThan(0);
    expect(updatedEpoch1Drafts.every((d) => d.status === "superseded")).toBe(true);
  });

  it("pause and cancel controls", async () => {
    const pauseCoordinator = new SessionAnalysisCoordinator();
    pauseCoordinator.pause();
    // When idle, pause doesn't mutate
    expect(pauseCoordinator.getState()).toBe("idle");

    pauseCoordinator.cancel();
    expect(pauseCoordinator.getState()).toBe("cancelled");
  });
});
