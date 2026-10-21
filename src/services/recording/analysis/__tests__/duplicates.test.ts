import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectDraftDuplicates,
  resolveDraftDuplicate,
} from "../duplicates";
import * as learningItemsApi from "../../../../api/learning-items";
import * as recordingSessionsApi from "../../../../api/recordingSessions";
import type { PersistedSessionLearningDraft } from "../../../../types/recordingSession";

describe("duplicates.ts (Task 3.6, Design D9)", () => {
  const baseCardDraft: PersistedSessionLearningDraft = {
    id: "draft-card-1",
    sessionId: "sess-1",
    runId: "run-1",
    kind: "card",
    status: "proposed",
    revision: 1,
    payloadJson: JSON.stringify({
      candidate: {
        cardType: "qa",
        concept: "Mitochondria",
        question: "What is the primary function of mitochondria in eukaryotic cells?",
        answer: "ATP generation through cellular respiration and oxidative phosphorylation.",
        evidenceQuote: "Mitochondria generate ATP through oxidative phosphorylation.",
      },
    }),
    evidenceJson: "{}",
    contentHash: "hash-1",
    conceptKey: "mitochondria",
    duplicateJson: null,
    acceptedTargetId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detectDraftDuplicates", () => {
    it("detects exact content duplicate (similarity 1.0, method: exact_content)", async () => {
      vi.spyOn(learningItemsApi, "searchLearningItemsBounded").mockResolvedValue([
        {
          id: "card-exact",
          item_type: "Qa",
          question: "What is the primary function of mitochondria in eukaryotic cells?",
          answer: "ATP generation through cellular respiration and oxidative phosphorylation.",
          difficulty: 0.3,
          interval: 10,
          ease_factor: 2.5,
          due_date: "2026-11-01",
          date_created: "2026-10-01",
          date_modified: "2026-10-01",
          review_count: 5,
          lapses: 0,
          state: "Review",
          is_suspended: false,
          tags: ["biology"],
        },
      ]);
      vi.spyOn(learningItemsApi, "checkSemanticDuplicateCandidates").mockResolvedValue([]);

      const matches = await detectDraftDuplicates(baseCardDraft);

      expect(matches).toHaveLength(1);
      expect(matches[0].cardId).toBe("card-exact");
      expect(matches[0].similarity).toBe(1.0);
      expect(matches[0].method).toBe("exact_content");
    });

    it("detects repeated quote in different source (method: exact_quote)", async () => {
      vi.spyOn(learningItemsApi, "searchLearningItemsBounded").mockResolvedValue([
        {
          id: "card-quote",
          item_type: "Qa",
          question: "Explain the quote: Mitochondria generate ATP through oxidative phosphorylation.",
          answer: "It describes aerobic metabolism.",
          difficulty: 0.3,
          interval: 1,
          ease_factor: 2.5,
          due_date: "2026-10-25",
          date_created: "2026-10-01",
          date_modified: "2026-10-01",
          review_count: 1,
          lapses: 0,
          state: "Learning",
          is_suspended: false,
          tags: [],
        },
      ]);
      vi.spyOn(learningItemsApi, "checkSemanticDuplicateCandidates").mockResolvedValue([]);

      const matches = await detectDraftDuplicates(baseCardDraft);

      expect(matches.length).toBeGreaterThan(0);
      const match = matches.find((m) => m.cardId === "card-quote");
      expect(match).toBeDefined();
      expect(match?.method).toBe("exact_quote");
      expect(match?.similarity).toBeGreaterThanOrEqual(0.9);
    });

    it("detects lexical near-duplicate above 0.75 threshold (method: lexical)", async () => {
      vi.spyOn(learningItemsApi, "searchLearningItemsBounded").mockResolvedValue([
        {
          id: "card-lexical",
          item_type: "Qa",
          question: "What is the main function of mitochondria in eukaryotic cells?",
          answer: "Cellular respiration and ATP generation through oxidative phosphorylation.",
          difficulty: 0.3,
          interval: 4,
          ease_factor: 2.5,
          due_date: "2026-10-28",
          date_created: "2026-10-01",
          date_modified: "2026-10-01",
          review_count: 2,
          lapses: 0,
          state: "Review",
          is_suspended: false,
          tags: [],
        },
      ]);
      vi.spyOn(learningItemsApi, "checkSemanticDuplicateCandidates").mockResolvedValue([]);

      const matches = await detectDraftDuplicates(baseCardDraft);

      expect(matches.length).toBeGreaterThan(0);
      const match = matches.find((m) => m.cardId === "card-lexical");
      expect(match).toBeDefined();
      expect(match?.method).toBe("lexical");
      expect(match?.similarity).toBeGreaterThanOrEqual(0.75);
    });

    it("does not match unrelated card sharing same concept name (avoids false positives)", async () => {
      vi.spyOn(learningItemsApi, "searchLearningItemsBounded").mockResolvedValue([
        {
          id: "card-unrelated",
          item_type: "Qa",
          question: "Where did mitochondria originate according to endosymbiotic theory?",
          answer: "From an engulfed proteobacterium living symbiotically inside a host cell.",
          difficulty: 0.3,
          interval: 10,
          ease_factor: 2.5,
          due_date: "2026-11-01",
          date_created: "2026-10-01",
          date_modified: "2026-10-01",
          review_count: 3,
          lapses: 0,
          state: "Review",
          is_suspended: false,
          tags: [],
        },
      ]);
      vi.spyOn(learningItemsApi, "checkSemanticDuplicateCandidates").mockResolvedValue([]);

      const matches = await detectDraftDuplicates(baseCardDraft);
      expect(matches).toHaveLength(0);
    });
  });

  describe("resolveDraftDuplicate", () => {
    it("decision 'skip': marks draft rejected without touching review tables", async () => {
      const rejectSpy = vi
        .spyOn(recordingSessionsApi, "rejectSessionLearningDrafts")
        .mockResolvedValue(1);

      const res = await resolveDraftDuplicate("sess-1", "draft-card-1", 1, "skip");

      expect(res.success).toBe(true);
      expect(res.decision).toBe("skip");
      expect(rejectSpy).toHaveBeenCalledWith("sess-1", ["draft-card-1"]);
    });

    it("decision 'use_existing': links source association without mutating review count or FSRS state", async () => {
      const acceptSpy = vi
        .spyOn(recordingSessionsApi, "acceptSessionDrafts")
        .mockResolvedValue({
          acceptedCount: 1,
          failedCount: 0,
          results: [
            {
              draftId: "draft-card-1",
              success: true,
              targetId: "existing-card-42",
              targetKind: "card",
            },
          ],
        });

      const res = await resolveDraftDuplicate(
        "sess-1",
        "draft-card-1",
        1,
        "use_existing",
        "existing-card-42"
      );

      expect(res.success).toBe(true);
      expect(res.targetCardId).toBe("existing-card-42");
      expect(acceptSpy).toHaveBeenCalledWith({
        sessionId: "sess-1",
        items: [
          {
            draftId: "draft-card-1",
            expectedRevision: 1,
            duplicateDecision: "update",
            duplicateTargetId: "existing-card-42",
          },
        ],
      });
    });

    it("decision 'keep_both': creates a new independent card", async () => {
      const acceptSpy = vi
        .spyOn(recordingSessionsApi, "acceptSessionDrafts")
        .mockResolvedValue({
          acceptedCount: 1,
          failedCount: 0,
          results: [
            {
              draftId: "draft-card-1",
              success: true,
              targetId: "new-card-99",
              targetKind: "card",
            },
          ],
        });

      const res = await resolveDraftDuplicate(
        "sess-1",
        "draft-card-1",
        1,
        "keep_both"
      );

      expect(res.success).toBe(true);
      expect(res.targetCardId).toBe("new-card-99");
      expect(acceptSpy).toHaveBeenCalledWith({
        sessionId: "sess-1",
        items: [
          {
            draftId: "draft-card-1",
            expectedRevision: 1,
            duplicateDecision: "create",
            duplicateTargetId: undefined,
          },
        ],
      });
    });
  });
});
