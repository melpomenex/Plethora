import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeProfileHash,
  estimateAnalysisScope,
  getDefaultProfile,
  normalizeProfileType,
  parseSessionProfile,
  PROFILE_DEFAULTS,
} from "../profiles";
import { SessionAnalysisCoordinator } from "../SessionAnalysisCoordinator";
import * as recordingSessionsApi from "../../../../api/recordingSessions";
import type {
  PersistedSessionLearningDraft,
  RecordingSession,
  SessionAnalysisRun,
  SessionAnalysisUnit,
  SessionTranscriptSegment,
} from "../../../../types/recordingSession";
import { SESSION_ANALYSIS_TASK_VERSION } from "../../../../lib/ai/schemas/sessionAnalysis";

describe("Session Output Profiles & Explicit Processing Selection (Task 3.7, Design D9)", () => {
  describe("Profile Normalization & Defaults", () => {
    it("normalizes known content types to canonical profile types", () => {
      expect(normalizeProfileType("lecture")).toBe("lecture");
      expect(normalizeProfileType("Lecture")).toBe("lecture");
      expect(normalizeProfileType("meeting")).toBe("meeting");
      expect(normalizeProfileType("Meeting ")).toBe("meeting");
      expect(normalizeProfileType("interview")).toBe("interview");
      expect(normalizeProfileType("seminar")).toBe("seminar");
      expect(normalizeProfileType("presentation")).toBe("seminar");
      expect(normalizeProfileType("podcast")).toBe("podcast");
      expect(normalizeProfileType("voice-note")).toBe("voice-note");
      expect(normalizeProfileType("voicenote")).toBe("voice-note");
      expect(normalizeProfileType("unknown-type")).toBe("other");
      expect(normalizeProfileType(undefined)).toBe("other");
    });

    it("enforces Meeting, Interview, and Seminar default cards to false", () => {
      expect(PROFILE_DEFAULTS.meeting.enableCards).toBe(false);
      expect(PROFILE_DEFAULTS.interview.enableCards).toBe(false);
      expect(PROFILE_DEFAULTS.seminar.enableCards).toBe(false);
      expect(PROFILE_DEFAULTS.podcast.enableCards).toBe(false);
      expect(PROFILE_DEFAULTS["voice-note"].enableCards).toBe(false);
      expect(PROFILE_DEFAULTS.other.enableCards).toBe(false);

      // Meeting enables decisions and action items
      expect(PROFILE_DEFAULTS.meeting.enableDecisionsAndActions).toBe(true);
    });

    it("enforces Lecture defaults cards to true", () => {
      expect(PROFILE_DEFAULTS.lecture.enableCards).toBe(true);
      expect(PROFILE_DEFAULTS.lecture.enableExtracts).toBe(true);
      expect(PROFILE_DEFAULTS.lecture.enableOutline).toBe(true);
      expect(PROFILE_DEFAULTS.lecture.enableConcepts).toBe(true);
      expect(PROFILE_DEFAULTS.lecture.enableDecisionsAndActions).toBe(false);
    });

    it("getDefaultProfile returns enrichmentSelected=false by default", () => {
      const def = getDefaultProfile("lecture");
      expect(def.enrichmentSelected).toBe(false);
      expect(def.enableCards).toBe(true);
      expect(def.profileType).toBe("lecture");
    });
  });

  describe("Profile Parsing & User Overrides", () => {
    it("parses empty or invalid JSON into safe defaults with enrichmentSelected=false", () => {
      const p1 = parseSessionProfile(null, "lecture");
      expect(p1.enrichmentSelected).toBe(false);
      expect(p1.profileType).toBe("lecture");

      const p2 = parseSessionProfile("not json", "meeting");
      expect(p2.enrichmentSelected).toBe(false);
      expect(p2.profileType).toBe("meeting");
      expect(p2.enableCards).toBe(false);
      expect(p2.enableDecisionsAndActions).toBe(true);
    });

    it("parses explicit user opt-in and user overrides correctly", () => {
      const rawJson = JSON.stringify({
        profileType: "meeting",
        enrichmentSelected: true,
        userOverrides: {
          enableCards: true, // User explicitly overrides meeting default to enable cards
          enableDecisionsAndActions: false,
        },
      });

      const parsed = parseSessionProfile(rawJson, "meeting");
      expect(parsed.enrichmentSelected).toBe(true);
      expect(parsed.enableCards).toBe(true);
      expect(parsed.enableDecisionsAndActions).toBe(false);
    });

    it("computes deterministic profileHash that changes when profile configuration changes", () => {
      const p1 = getDefaultProfile("lecture", true);
      const p2 = getDefaultProfile("meeting", true);
      const hash1 = computeProfileHash(p1);
      const hash2 = computeProfileHash(p2);

      expect(hash1).toHaveLength(64);
      expect(hash2).toHaveLength(64);
      expect(hash1).not.toBe(hash2);

      // Mutating toggle changes hash
      const p1Modified = { ...p1, enableCards: false };
      expect(computeProfileHash(p1Modified)).not.toBe(hash1);
    });
  });

  describe("Analysis Scope & Call Estimation", () => {
    it("returns zero calls when enrichment is not selected", () => {
      const profile = getDefaultProfile("lecture", false);
      const scope = estimateAnalysisScope(10000, profile);

      expect(scope.authorized).toBe(false);
      expect(scope.totalCalls).toBe(0);
      expect(scope.maxPotentialCards).toBe(0);
      expect(scope.maxPotentialExtracts).toBe(0);
    });

    it("calculates bounded units and calls when authorized", () => {
      const profile = getDefaultProfile("lecture", true);
      const scope = estimateAnalysisScope(6000, profile);

      expect(scope.authorized).toBe(true);
      expect(scope.estimatedUnits).toBe(3); // 6000 / 2000
      expect(scope.estimatedSectionCalls).toBe(3);
      expect(scope.estimatedOverviewCalls).toBe(1);
      expect(scope.totalCalls).toBe(4);
      expect(scope.maxPotentialCards).toBe(24); // 3 * 8
      expect(scope.maxPotentialExtracts).toBe(9); // 3 * 3
    });

    it("meeting profile estimates 0 cards", () => {
      const meetingProfile = getDefaultProfile("meeting", true);
      const scope = estimateAnalysisScope(6000, meetingProfile);

      expect(scope.authorized).toBe(true);
      expect(scope.maxPotentialCards).toBe(0); // cards OFF by default
      expect(scope.maxPotentialExtracts).toBe(9);
    });
  });

  describe("Integration with SessionAnalysisCoordinator", () => {
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
          return {
            requestId: "req-overview",
            text: JSON.stringify({
              overviewSummary: "Executive overview of meeting.",
              outline: ["Agenda", "Decisions", "Next Steps"],
              keyTakeaways: ["Action plan established."],
              concepts: [{ name: "Project Timeline" }],
              decisions: ["Adopt quarterly release cycle."],
              actionItems: ["Alice to update documentation."],
              taskVersion: SESSION_ANALYSIS_TASK_VERSION,
            }),
          };
        }

        return {
          requestId: `req-section-${providerCallsCount}`,
          text: JSON.stringify({
            sectionSummary: "Team sync discussion on Q4 planning.",
            topics: ["Q4 Planning"],
            concepts: [{ name: "Project Timeline", definition: "Schedule for deliverables." }],
            extractProposals: [
              {
                quote: "The quarterly release cycle will begin on the first of November.",
                summaryNote: "Timeline commitment.",
              },
            ],
            cards: [
              {
                cardType: "qa",
                concept: "Project Timeline",
                question: "When does the quarterly release cycle begin?",
                answer: "On the first of November.",
                evidenceQuote: "The quarterly release cycle will begin on the first of November.",
              },
            ],
            profileObservations: {
              decisions: ["Adopt quarterly release cycle."],
              actionItems: ["Alice to update documentation."],
            },
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
        id: "sess-profile-test",
        documentId: "doc-profile-test",
        origin: "file",
        contentType: "meeting",
        profileJson: JSON.stringify({ enrichmentSelected: false }),
        captureState: "saved",
        ingestionState: "saved",
        transcriptId: 1,
        mediaAssetId: "asset-meeting-mp4",
        transcriptRevision: 1,
        overviewJson: null,
        overviewRevision: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };

      mockSegments = [
        {
          segmentKey: "seg-meet-1",
          transcriptId: 1,
          ordinal: 0,
          revision: 1,
          text: "Welcome everyone to the meeting. The quarterly release cycle will begin on the first of November. ",
          timing: { kind: "measured", startMs: 0, endMs: 5000 },
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

    it("unset selection -> no inference performed", async () => {
      mockSession.profileJson = JSON.stringify({ enrichmentSelected: false });

      await expect(
        coordinator.startAnalysis("sess-profile-test", {
          forceProvider: mockProvider,
        })
      ).rejects.toThrow("Analysis enrichment was not selected");

      expect(coordinator.getState()).toBe("idle");
      expect(providerCallsCount).toBe(0);
      expect(persistedRuns).toHaveLength(0);
      expect(persistedDrafts).toHaveLength(0);
    });

    it("MP4 Meeting -> decisions/actions captured and ZERO card drafts created", async () => {
      // User opted in to meeting analysis
      mockSession.contentType = "meeting";
      mockSession.profileJson = JSON.stringify({ enrichmentSelected: true });

      const progress = await coordinator.startAnalysis("sess-profile-test", {
        forceProvider: mockProvider,
      });

      expect(progress.state).toBe("completed");
      expect(progress.proposedCards).toBe(0); // ZERO cards proposed!
      expect(progress.proposedExtracts).toBeGreaterThan(0);

      // Verify zero card drafts in database
      const cardDrafts = persistedDrafts.filter((d) => d.kind === "card");
      expect(cardDrafts).toHaveLength(0);

      // Verify extract drafts were created
      const extractDrafts = persistedDrafts.filter((d) => d.kind === "extract");
      expect(extractDrafts.length).toBeGreaterThan(0);

      // Verify overview contains meeting decisions and action items
      expect(updatedOverview).not.toBeNull();
      const overview = JSON.parse(updatedOverview!.json);
      expect(overview.decisions).toContain("Adopt quarterly release cycle.");
      expect(overview.actionItems).toContain("Alice to update documentation.");
    });

    it("Lecture selected -> creates cards drafts", async () => {
      mockSession.contentType = "lecture";
      mockSession.profileJson = JSON.stringify({ enrichmentSelected: true });

      const progress = await coordinator.startAnalysis("sess-profile-test", {
        forceProvider: mockProvider,
      });

      expect(progress.state).toBe("completed");
      expect(progress.proposedCards).toBeGreaterThan(0);

      const cardDrafts = persistedDrafts.filter((d) => d.kind === "card");
      expect(cardDrafts.length).toBeGreaterThan(0);
    });

    it.each(["interview", "seminar", "voice-note"])(
      "%s defaults -> zero card drafts even when the provider proposes cards",
      async (contentType) => {
        mockSession.contentType = contentType as RecordingSession["contentType"];
        mockSession.profileJson = JSON.stringify({ enrichmentSelected: true });

        const progress = await coordinator.startAnalysis("sess-profile-test", {
          forceProvider: mockProvider,
        });

        expect(progress.state).toBe("completed");
        expect(progress.proposedCards).toBe(0);
        expect(persistedDrafts.filter((d) => d.kind === "card")).toHaveLength(0);
        expect(persistedDrafts.filter((d) => d.kind === "extract").length).toBeGreaterThan(0);
      }
    );

    it("explicit card override enables card drafts for a seminar", async () => {
      mockSession.contentType = "seminar";
      mockSession.profileJson = JSON.stringify({
        enrichmentSelected: true,
        userOverrides: { enableCards: true },
      });

      const progress = await coordinator.startAnalysis("sess-profile-test", {
        forceProvider: mockProvider,
      });

      expect(progress.state).toBe("completed");
      expect(progress.proposedCards).toBeGreaterThan(0);
      expect(persistedDrafts.filter((d) => d.kind === "card").length).toBeGreaterThan(0);
    });

    it("profile change invalidates only corresponding analysis cache via profileHash", async () => {
      // 1. Run with Meeting profile (cards off)
      mockSession.contentType = "meeting";
      mockSession.profileJson = JSON.stringify({ enrichmentSelected: true });

      await coordinator.startAnalysis("sess-profile-test", {
        forceProvider: mockProvider,
        generationEpoch: "epoch-shared",
      });

      expect(persistedRuns).toHaveLength(1);
      const meetingProfileHash = persistedRuns[0].profileHash;
      const initialProviderCalls = providerCallsCount;

      // 2. Run again with Lecture profile (cards on)
      mockSession.contentType = "lecture";
      mockSession.profileJson = JSON.stringify({ enrichmentSelected: true });

      const secondCoordinator = new SessionAnalysisCoordinator();
      await secondCoordinator.startAnalysis("sess-profile-test", {
        forceProvider: mockProvider,
        generationEpoch: "epoch-shared",
      });

      expect(persistedRuns).toHaveLength(2);
      const lectureProfileHash = persistedRuns[1].profileHash;

      // The profile hash MUST differ, creating a distinct run cache!
      expect(lectureProfileHash).not.toBe(meetingProfileHash);

      // Because the cache was invalidated by the profile change, new inference calls were executed!
      expect(providerCallsCount).toBeGreaterThan(initialProviderCalls);
    });
  });
});
