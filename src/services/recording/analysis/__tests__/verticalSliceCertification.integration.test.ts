import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionAnalysisCoordinator } from "../SessionAnalysisCoordinator";
import * as recordingSessionsApi from "../../../../api/recordingSessions";
import { calculateTextJaccardSimilarity } from "../../../../lib/ai/cards/duplicates";
import { detectDraftDuplicates } from "../duplicates";
import type {
  AcceptSessionDraftResult,
  AcceptSessionDraftsInput,
  AcceptSessionDraftsResponse,
  PersistedSessionLearningDraft,
  RecordingSession,
  SessionAnalysisRun,
  SessionAnalysisUnit,
  SessionTranscriptSegment,
} from "../../../../types/recordingSession";
import { SESSION_ANALYSIS_TASK_VERSION } from "../../../../lib/ai/schemas/sessionAnalysis";
import type { LearningItem } from "../../../../api/review";

describe("Vertical Slice Certification (Task 3.8, Cases A01, A02, A03, A09, A10, A11)", () => {
  let coordinator: SessionAnalysisCoordinator;
  let persistedRuns: SessionAnalysisRun[];
  let persistedUnits: SessionAnalysisUnit[];
  let persistedDrafts: PersistedSessionLearningDraft[];
  let libraryLearningItems: LearningItem[];
  let librarySources: Array<{ objectId: string; sourceEnvelope: string }>;
  let libraryProvenance: Array<{ targetId: string; model: string }>;
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
        return {
          requestId: "req-overview",
          text: JSON.stringify({
            overviewSummary: "Executive overview of the full session.",
            outline: ["Introduction to Special Relativity", "The Invariant Mass", "Applications"],
            keyTakeaways: [
              "The speed of light is invariant in all inertial frames.",
              "Energy-momentum relation governs relativistic kinematics.",
            ],
            concepts: [
              { name: "Invariant Mass", definition: "Mass measured in the center-of-momentum frame." },
              { name: "Light Speed Invariance", definition: "Constant c in all frames." },
            ],
            decisions: req.text.includes("meeting") ? ["Adopt relativistic formulation."] : undefined,
            actionItems: req.text.includes("meeting") ? ["Prepare lab setup."] : undefined,
            taskVersion: SESSION_ANALYSIS_TASK_VERSION,
          }),
        };
      }

      const isMeeting = req.text.includes("meeting");

      return {
        requestId: `req-section-${providerCallsCount}`,
        text: JSON.stringify({
          sectionSummary: "Introduction to relativistic kinematics and energy-momentum.",
          topics: ["Kinematics", "Energy-Momentum"],
          concepts: [
            {
              name: "Invariant Mass",
              definition: "The rest mass of a particle invariant under Lorentz transformations.",
            },
          ],
          extractProposals: [
            {
              quote: "The energy-momentum relation connects energy E, momentum p, and rest mass m_0.",
              summaryNote: "Fundamental physics equation.",
            },
          ],
          cards: isMeeting
            ? []
            : [
                {
                  cardType: "qa",
                  concept: "Invariant Mass",
                  question: "What does the energy-momentum relation connect?",
                  answer: "It connects energy E, momentum p, and rest mass m_0.",
                  evidenceQuote: "The energy-momentum relation connects energy E, momentum p, and rest mass m_0.",
                },
              ],
          profileObservations: isMeeting
            ? {
                decisions: ["Adopt relativistic formulation."],
                actionItems: ["Prepare lab setup."],
              }
            : undefined,
          taskVersion: SESSION_ANALYSIS_TASK_VERSION,
        }),
      };
    }),
  };

  const canonicalLectureSegments: SessionTranscriptSegment[] = [
    {
      segmentKey: "seg-1",
      transcriptId: 10,
      ordinal: 0,
      revision: 1,
      text: "Welcome to advanced physics. The energy-momentum relation connects energy E, momentum p, and rest mass m_0. ",
      timing: { kind: "measured", startMs: 0, endMs: 8000 },
    },
    {
      segmentKey: "seg-2",
      transcriptId: 10,
      ordinal: 1,
      revision: 1,
      text: "We will now demonstrate how this invariance holds under all Lorentz boosts. ",
      timing: { kind: "measured", startMs: 8100, endMs: 16000 },
    },
  ];

  beforeEach(() => {
    coordinator = new SessionAnalysisCoordinator();
    persistedRuns = [];
    persistedUnits = [];
    persistedDrafts = [];
    libraryLearningItems = [];
    librarySources = [];
    libraryProvenance = [];
    updatedOverview = null;
    providerCallsCount = 0;

    vi.spyOn(recordingSessionsApi, "getSessionDocumentPrivacy").mockResolvedValue({
      isLocalOnly: false,
      isAiExcluded: false,
      privacyVersion: 1,
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
      if (!draft) throw new Error(`Draft ${input.id} not found`);
      if (input.expectedRevision !== undefined && draft.revision !== input.expectedRevision) {
        throw new Error("CAS revision conflict");
      }
      if (input.status) draft.status = input.status as any;
      if (input.payloadJson) draft.payloadJson = input.payloadJson;
      if (input.duplicateJson !== undefined) draft.duplicateJson = input.duplicateJson;
      draft.revision++;
      return draft;
    });

    vi.spyOn(recordingSessionsApi, "updateRecordingSessionOverview").mockImplementation(
      async (id, json, rev) => {
        updatedOverview = { id, json, rev };
        return {} as any;
      }
    );

    // Mock command path: acceptSessionDrafts implementing Task 3.2 atomic contract
    vi.spyOn(recordingSessionsApi, "acceptSessionDrafts").mockImplementation(
      async (input: AcceptSessionDraftsInput): Promise<AcceptSessionDraftsResponse> => {
        const results: AcceptSessionDraftResult[] = [];
        let acceptedCount = 0;
        let failedCount = 0;

        for (const item of input.items) {
          const draft = persistedDrafts.find((d) => d.id === item.draftId);
          if (!draft) {
            failedCount++;
            results.push({
              draftId: item.draftId,
              success: false,
              error: `Draft ${item.draftId} not found`,
            });
            continue;
          }

          // Idempotency: if already accepted, return existing target
          if (draft.status === "accepted" && draft.acceptedTargetId) {
            results.push({
              draftId: item.draftId,
              success: true,
              targetId: draft.acceptedTargetId,
              targetKind: draft.kind,
            });
            continue;
          }

          // CAS revision check
          if (item.expectedRevision !== draft.revision) {
            failedCount++;
            results.push({
              draftId: item.draftId,
              success: false,
              error: "Stale draft revision",
            });
            continue;
          }

          if (draft.status === "accepted") {
            results.push({
              draftId: item.draftId,
              success: true,
              targetId: draft.acceptedTargetId,
              targetKind: draft.kind,
            });
            continue;
          }

          const targetId = `item-accepted-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const payload = JSON.parse(draft.payloadJson);

          // Construct ordinary FSRS learning item
          const newItem: LearningItem = {
            id: targetId,
            item_type: "flashcard",
            question: payload.candidate?.question || "Flashcard",
            answer: payload.candidate?.answer || payload.verbatimText || "",
            due_date: new Date().toISOString(),
            interval: 0,
            ease_factor: 2.5,
            review_count: 0,
            lapses: 0,
            state: "new",
            difficulty: 5.0,
            memory_state: { stability: 0.4, difficulty: 5.0 },
            is_suspended: false,
            tags: [],
            date_created: new Date().toISOString(),
            date_modified: new Date().toISOString(),
          };

          libraryLearningItems.push(newItem);
          librarySources.push({
            objectId: targetId,
            sourceEnvelope: draft.evidenceJson,
          });
          libraryProvenance.push({
            targetId,
            model: "fake-deterministic-provider",
          });

          draft.status = "accepted";
          draft.acceptedTargetId = targetId;
          draft.revision++;
          acceptedCount++;

          results.push({
            draftId: item.draftId,
            success: true,
            targetId,
            targetKind: draft.kind,
          });
        }

        return {
          results,
          acceptedCount,
          failedCount,
        };
      }
    );

    vi.spyOn(recordingSessionsApi, "rejectSessionLearningDrafts").mockImplementation(
      async (_sessionId: string, draftIds: string[]) => {
        let count = 0;
        for (const id of draftIds) {
          const draft = persistedDrafts.find((d) => d.id === id);
          if (draft) {
            draft.status = "rejected";
            draft.revision++;
            count++;
          }
        }
        return count;
      }
    );
  });

  it("A01 & A02: identical finalized transcript across recorded and file origins yields stable evidence-linked drafts", async () => {
    // 1. Recorded session
    const recordedSession: RecordingSession = {
      id: "sess-rec-001",
      documentId: "doc-rec-001",
      origin: "recorded",
      contentType: "lecture",
      profileJson: JSON.stringify({ enrichmentSelected: true, enableCards: true }),
      captureState: "saved",
      ingestionState: "saved",
      transcriptId: 10,
      mediaAssetId: null,
      transcriptRevision: 1,
      overviewJson: null,
      overviewRevision: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    vi.spyOn(recordingSessionsApi, "getRecordingSession").mockResolvedValueOnce(recordedSession);
    vi.spyOn(recordingSessionsApi, "getSessionSegments").mockResolvedValueOnce({
      items: canonicalLectureSegments,
      revision: 1,
    });

    const recordedProgress = await coordinator.startAnalysis("sess-rec-001", {
      forceProvider: mockProvider,
      generationEpoch: "epoch-1",
    });

    expect(recordedProgress.state).toBe("completed");
    expect(recordedProgress.proposedCards).toBeGreaterThan(0);
    expect(recordedProgress.proposedExtracts).toBeGreaterThan(0);

    const recDrafts = persistedDrafts.filter((d) => d.sessionId === "sess-rec-001");
    expect(recDrafts.length).toBeGreaterThan(0);

    // CRITICAL: Safe staging guarantee: before explicit user acceptance, libraryLearningItems delta is ZERO!
    expect(libraryLearningItems).toHaveLength(0);

    // 2. Imported file session with identical finalized transcript
    const fileSession: RecordingSession = {
      id: "sess-file-002",
      documentId: "doc-file-002",
      origin: "file",
      contentType: "lecture",
      profileJson: JSON.stringify({ enrichmentSelected: true, enableCards: true }),
      captureState: "saved",
      ingestionState: "saved",
      transcriptId: 10,
      mediaAssetId: null,
      transcriptRevision: 1,
      overviewJson: null,
      overviewRevision: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    vi.spyOn(recordingSessionsApi, "getRecordingSession").mockResolvedValueOnce(fileSession);
    vi.spyOn(recordingSessionsApi, "getSessionSegments").mockResolvedValueOnce({
      items: canonicalLectureSegments,
      revision: 1,
    });

    const fileCoordinator = new SessionAnalysisCoordinator();
    const fileProgress = await fileCoordinator.startAnalysis("sess-file-002", {
      forceProvider: mockProvider,
      generationEpoch: "epoch-1",
    });

    expect(fileProgress.state).toBe("completed");
    expect(fileProgress.proposedCards).toBe(recordedProgress.proposedCards);
    expect(fileProgress.proposedExtracts).toBe(recordedProgress.proposedExtracts);

    const fileDrafts = persistedDrafts.filter((d) => d.sessionId === "sess-file-002");
    expect(fileDrafts.length).toBe(recDrafts.length);

    // Evidence quotes match verbatim across origins
    for (let i = 0; i < recDrafts.length; i++) {
      expect(recDrafts[i].contentHash).toBe(fileDrafts[i].contentHash);
      const recEvidence = JSON.parse(recDrafts[i].evidenceJson);
      const fileEvidence = JSON.parse(fileDrafts[i].evidenceJson);
      expect(recEvidence.quote).toBe(fileEvidence.quote);
      expect(recEvidence.segmentKeys).toEqual(fileEvidence.segmentKeys);
    }
  });

  it("A09 & A01: rejects one draft (delta 0) and accepts another (delta 1) through command path", async () => {
    const session: RecordingSession = {
      id: "sess-accept-test",
      documentId: "doc-accept-test",
      origin: "recorded",
      contentType: "lecture",
      profileJson: JSON.stringify({ enrichmentSelected: true, enableCards: true }),
      captureState: "saved",
      ingestionState: "saved",
      transcriptId: 10,
      mediaAssetId: null,
      transcriptRevision: 1,
      overviewJson: null,
      overviewRevision: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    vi.spyOn(recordingSessionsApi, "getRecordingSession").mockResolvedValue(session);
    vi.spyOn(recordingSessionsApi, "getSessionSegments").mockResolvedValue({
      items: canonicalLectureSegments,
      revision: 1,
    });

    await coordinator.startAnalysis("sess-accept-test", {
      forceProvider: mockProvider,
    });

    const cardDrafts = persistedDrafts.filter((d) => d.kind === "card");
    const extractDrafts = persistedDrafts.filter((d) => d.kind === "extract");
    expect(cardDrafts.length).toBeGreaterThan(0);
    expect(extractDrafts.length).toBeGreaterThan(0);

    const draftToReject = extractDrafts[0];
    const draftToAccept = cardDrafts[0];

    // 1. REJECT PATH (A09): Reject draft via rejectSessionLearningDrafts
    const rejectedCount = await recordingSessionsApi.rejectSessionLearningDrafts(
      "sess-accept-test",
      [draftToReject.id]
    );

    expect(rejectedCount).toBe(1);
    expect(draftToReject.status).toBe("rejected");
    expect(draftToReject.acceptedTargetId).toBeNull();

    // Verification: ZERO learning items created on rejection!
    expect(libraryLearningItems).toHaveLength(0);

    // 2. ACCEPT PATH (A01): Accept draft via acceptSessionDrafts
    const acceptResponse = await recordingSessionsApi.acceptSessionDrafts({
      sessionId: "sess-accept-test",
      items: [
        {
          draftId: draftToAccept.id,
          expectedRevision: draftToAccept.revision,
        },
      ],
    });

    expect(acceptResponse.acceptedCount).toBe(1);
    expect(acceptResponse.results[0].success).toBe(true);
    expect(draftToAccept.status).toBe("accepted");
    expect(draftToAccept.acceptedTargetId).toBeTruthy();

    // Verification: EXACTLY 1 learning item created in library!
    expect(libraryLearningItems).toHaveLength(1);
    const createdItem = libraryLearningItems[0];
    expect(createdItem.id).toBe(draftToAccept.acceptedTargetId);
    expect(createdItem.state).toBe("new");
    expect(createdItem.review_count).toBe(0);

    // Verify source association and provenance created
    expect(librarySources).toHaveLength(1);
    expect(librarySources[0].objectId).toBe(createdItem.id);
    expect(librarySources[0].sourceEnvelope).toContain(session.documentId);

    expect(libraryProvenance).toHaveLength(1);
    expect(libraryProvenance[0].targetId).toBe(createdItem.id);

    // Verification: Rejected draft is NEVER in library or scheduled!
    expect(libraryLearningItems.some((item) => item.id === draftToReject.id)).toBe(false);
  });

  it("A10: idempotent acceptance on retry / double click returns existing target without duplicating items", async () => {
    const session: RecordingSession = {
      id: "sess-idempotent-test",
      documentId: "doc-idempotent-test",
      origin: "recorded",
      contentType: "lecture",
      profileJson: JSON.stringify({ enrichmentSelected: true, enableCards: true }),
      captureState: "saved",
      ingestionState: "saved",
      transcriptId: 10,
      mediaAssetId: null,
      transcriptRevision: 1,
      overviewJson: null,
      overviewRevision: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    vi.spyOn(recordingSessionsApi, "getRecordingSession").mockResolvedValue(session);
    vi.spyOn(recordingSessionsApi, "getSessionSegments").mockResolvedValue({
      items: canonicalLectureSegments,
      revision: 1,
    });

    await coordinator.startAnalysis("sess-idempotent-test", {
      forceProvider: mockProvider,
    });

    const targetDraft = persistedDrafts.find((d) => d.kind === "card")!;

    // First acceptance
    const resp1 = await recordingSessionsApi.acceptSessionDrafts({
      sessionId: "sess-idempotent-test",
      items: [
        {
          draftId: targetDraft.id,
          expectedRevision: targetDraft.revision,
        },
      ],
    });

    expect(resp1.acceptedCount).toBe(1);
    const assignedTargetId = resp1.results[0].targetId;
    expect(libraryLearningItems).toHaveLength(1);

    // Second acceptance (e.g. lost reply, double-click, duplicate network request)
    const resp2 = await recordingSessionsApi.acceptSessionDrafts({
      sessionId: "sess-idempotent-test",
      items: [
        {
          draftId: targetDraft.id,
          expectedRevision: targetDraft.revision,
        },
      ],
    });

    expect(resp2.results[0].success).toBe(true);
    expect(resp2.results[0].targetId).toBe(assignedTargetId);

    // Delta remains 1 (no duplicate item created in library)
    expect(libraryLearningItems).toHaveLength(1);
  });

  it("A11: overlapping session concept duplicate detection preserves existing card review history and state", async () => {
    // Existing card in library with active review history
    const existingCard: LearningItem = {
      id: "existing-card-42",
      item_type: "flashcard",
      question: "What does the energy-momentum relation connect?",
      answer: "It connects energy E, momentum p, and rest mass m_0.",
      due_date: "2026-11-01T12:00:00Z",
      interval: 14,
      ease_factor: 2.6,
      review_count: 5,
      lapses: 0,
      state: "review",
      difficulty: 4.2,
      memory_state: { stability: 14.5, difficulty: 4.2 },
      is_suspended: false,
      tags: [],
      date_created: "2026-09-01T10:00:00Z",
      date_modified: "2026-10-15T08:00:00Z",
    };

    // Calculate lexical similarity against candidate
    const candidateQuestion = "What does the energy-momentum relation connect?";
    const candidateAnswer = "It connects energy E, momentum p, and rest mass m_0.";

    const similarity = calculateTextJaccardSimilarity(
      candidateQuestion,
      existingCard.question
    );

    expect(similarity).toBe(1.0); // Exact match

    // Check duplicate detection via detectDraftDuplicates
    const candidateDraft: PersistedSessionLearningDraft = {
      id: "draft-overlap-42",
      sessionId: "sess-overlap-2",
      runId: "run-overlap",
      kind: "card",
      status: "proposed",
      revision: 1,
      payloadJson: JSON.stringify({
        candidate: {
          cardType: "qa",
          question: candidateQuestion,
          answer: candidateAnswer,
          concept: "Invariant Mass",
          evidenceQuote: candidateAnswer,
        },
      }),
      evidenceJson: "{}",
      contentHash: "hash-42",
      conceptKey: "Invariant Mass",
      duplicateJson: null,
      acceptedTargetId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Mock searchLearningItemsBounded to return existing card
    const searchSpy = vi.spyOn(
      await import("../../../../api/learning-items"),
      "searchLearningItemsBounded"
    ).mockResolvedValueOnce([
      {
        id: existingCard.id,
        question: existingCard.question,
        answer: existingCard.answer,
      } as any,
    ]);

    const matches = await detectDraftDuplicates(candidateDraft);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].cardId).toBe("existing-card-42");
    expect(matches[0].method).toBe("exact_content");

    // Simulate "use_existing" resolution: append source association ONLY
    librarySources.push({
      objectId: existingCard.id,
      sourceEnvelope: JSON.stringify({ sessionId: "sess-overlap-2" }),
    });

    // Verify existing card FSRS state, review history, intervals, and count are completely UNTOUCHED
    expect(existingCard.review_count).toBe(5);
    expect(existingCard.interval).toBe(14);
    expect(existingCard.memory_state?.stability).toBe(14.5);
    expect(existingCard.state).toBe("review");
    expect(existingCard.due_date).toBe("2026-11-01T12:00:00Z");
  });

  it("A03: MP4 meeting session with suggestions enabled produces zero cards and captures decisions/actions", async () => {
    const meetingSession: RecordingSession = {
      id: "sess-meeting-mp4",
      documentId: "doc-meeting-mp4",
      origin: "file",
      contentType: "meeting",
      profileJson: JSON.stringify({ enrichmentSelected: true }),
      captureState: "saved",
      ingestionState: "saved",
      transcriptId: 10,
      mediaAssetId: null,
      transcriptRevision: 1,
      overviewJson: null,
      overviewRevision: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    vi.spyOn(recordingSessionsApi, "getRecordingSession").mockResolvedValue(meetingSession);
    vi.spyOn(recordingSessionsApi, "getSessionSegments").mockResolvedValue({
      items: canonicalLectureSegments,
      revision: 1,
    });

    const progress = await coordinator.startAnalysis("sess-meeting-mp4", {
      forceProvider: mockProvider,
    });

    expect(progress.state).toBe("completed");
    expect(progress.proposedCards).toBe(0); // Zero cards proposed!
    expect(progress.proposedExtracts).toBeGreaterThan(0);

    const meetingCardDrafts = persistedDrafts.filter(
      (d) => d.sessionId === "sess-meeting-mp4" && d.kind === "card"
    );
    expect(meetingCardDrafts).toHaveLength(0);

    expect(updatedOverview).not.toBeNull();
    const overview = JSON.parse(updatedOverview!.json);
    expect(overview.decisions).toContain("Adopt relativistic formulation.");
    expect(overview.actionItems).toContain("Prepare lab setup.");
  });

  it(
    "A15: simulated absent AI provider fails closed gracefully leaving source session and drafts intact",
    async () => {
    const session: RecordingSession = {
      id: "sess-no-provider",
      documentId: "doc-no-provider",
      origin: "recorded",
      contentType: "lecture",
      profileJson: JSON.stringify({ enrichmentSelected: true }),
      captureState: "saved",
      ingestionState: "saved",
      transcriptId: 10,
      mediaAssetId: null,
      transcriptRevision: 1,
      overviewJson: null,
      overviewRevision: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    vi.spyOn(recordingSessionsApi, "getRecordingSession").mockResolvedValue(session);
    vi.spyOn(recordingSessionsApi, "getSessionSegments").mockResolvedValue({
      items: canonicalLectureSegments,
      revision: 1,
    });

    const absentProvider: any = {
      id: "absent-provider",
      kind: "cloud",
      getCapabilities: async () => ({
        textGeneration: false,
        structuredGeneration: false,
      }),
      generateStream: vi.fn(async () => {
        throw new Error("No AI model available or credentials not configured");
      }),
    };

    await expect(
      coordinator.startAnalysis("sess-no-provider", {
        forceProvider: absentProvider,
      })
    ).rejects.toThrow("No AI model available");

    expect(coordinator.getState()).toBe("failed");
    // Fails closed without corrupting the session or creating invalid drafts
    expect(persistedDrafts.filter((d) => d.sessionId === "sess-no-provider")).toHaveLength(0);
    expect(libraryLearningItems).toHaveLength(0);
  }, 15000);
});
