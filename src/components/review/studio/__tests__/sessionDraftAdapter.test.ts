import { describe, expect, it } from "vitest";
import type {
  PersistedSessionLearningDraft,
  SessionSourceEvidence,
} from "../../../../types/recordingSession";
import {
  buildAcceptanceInput,
  extractDraftToPersistedUpdate,
  isDraftGrounded,
  persistedDraftToExtractDraft,
  persistedDraftToStudioCard,
  studioCardToPersistedUpdate,
} from "../sessionDraftAdapter";
import type { DraftCard } from "../types";

describe("sessionDraftAdapter", () => {
  const sampleEvidence: SessionSourceEvidence = {
    version: 1,
    documentId: "doc-quantum-1",
    sessionId: "sess-physics-101",
    transcriptId: 4,
    transcriptRevision: 2,
    segmentKeys: ["seg_0", "seg_1"],
    quote: "Entanglement is a physical phenomenon that occurs when a group of particles interact.",
    ranges: [{ segmentKey: "seg_0", startUtf16: 0, endUtf16: 85 }],
    time: { startMs: 12000, endMs: 18500, kind: "measured" },
    precision: "segment",
    fingerprint: "fp-entanglement-001",
    markerIds: [],
  };

  const samplePersistedCardDraft: PersistedSessionLearningDraft = {
    id: "draft-card-quantum-1",
    sessionId: "sess-physics-101",
    runId: "run-analysis-1",
    kind: "card",
    status: "proposed",
    revision: 3,
    payloadJson: JSON.stringify({
      kind: "card",
      candidate: {
        cardType: "qa",
        question: "What is quantum entanglement?",
        answer: "A phenomenon occurring when particles interact such that their quantum states cannot be described independently.",
        concept: "Quantum Entanglement",
        evidenceQuote: sampleEvidence.quote,
      },
    }),
    evidenceJson: JSON.stringify(sampleEvidence),
    contentHash: "hash-quantum-1",
    conceptKey: "Quantum Entanglement",
    duplicateJson: null,
    acceptedTargetId: null,
    createdAt: "2026-10-21T02:00:00Z",
    updatedAt: "2026-10-21T02:00:00Z",
  };

  const samplePersistedExtractDraft: PersistedSessionLearningDraft = {
    id: "draft-ext-quantum-2",
    sessionId: "sess-physics-101",
    runId: "run-analysis-1",
    kind: "extract",
    status: "proposed",
    revision: 1,
    payloadJson: JSON.stringify({
      kind: "extract",
      verbatimText: sampleEvidence.quote,
      summaryNote: "Fundamental definition of particle entanglement.",
    }),
    evidenceJson: JSON.stringify(sampleEvidence),
    contentHash: "hash-quantum-2",
    conceptKey: "Quantum Entanglement",
    duplicateJson: null,
    acceptedTargetId: null,
    createdAt: "2026-10-21T02:00:00Z",
    updatedAt: "2026-10-21T02:00:00Z",
  };

  it("maps persisted card draft to Studio DraftCard accurately", () => {
    const card = persistedDraftToStudioCard(samplePersistedCardDraft);

    expect(card.id).toBe("draft-card-quantum-1");
    expect(card.type).toBe("qa");
    expect(card.question).toBe("What is quantum entanglement?");
    expect(card.answer).toContain("quantum states cannot be described independently");
    expect(card.selected).toBe(true); // Proposed drafts default to selected
    expect(card.tags).toContain("Quantum Entanglement");
    expect(card.durableDraftId).toBe("draft-card-quantum-1");
    expect(card.durableRevision).toBe(3);
    expect(card.alreadyPersisted).toBe(false);
    expect(card.sessionEvidence?.quote).toBe(sampleEvidence.quote);
  });

  it("maps Studio DraftCard edit back to UpdateSessionLearningDraft preserving revision", () => {
    const card = persistedDraftToStudioCard(samplePersistedCardDraft);
    card.question = "What occurs during quantum entanglement?";
    card.answer = "Updated explanation.";

    const updateSpec = studioCardToPersistedUpdate(card);

    expect(updateSpec.id).toBe("draft-card-quantum-1");
    expect(updateSpec.expectedRevision).toBe(3);

    const parsed = JSON.parse(updateSpec.payloadJson!);
    expect(parsed.candidate.question).toBe("What occurs during quantum entanglement?");
    expect(parsed.candidate.answer).toBe("Updated explanation.");
    expect(parsed.candidate.cardType).toBe("qa");
  });

  it("maps persisted extract draft to SessionExtractDraft model", () => {
    const extract = persistedDraftToExtractDraft(samplePersistedExtractDraft);

    expect(extract.id).toBe("draft-ext-quantum-2");
    expect(extract.verbatimText).toBe(sampleEvidence.quote);
    expect(extract.summaryNote).toBe("Fundamental definition of particle entanglement.");
    expect(extract.status).toBe("proposed");
    expect(extract.selected).toBe(true);
    expect(extract.revision).toBe(1);
    expect(extract.evidence?.time?.startMs).toBe(12000);
  });

  it("maps edited extract draft back to UpdateSessionLearningDraft", () => {
    const extract = persistedDraftToExtractDraft(samplePersistedExtractDraft);
    extract.summaryNote = "Refined note on entanglement.";

    const updateSpec = extractDraftToPersistedUpdate(extract);

    expect(updateSpec.id).toBe("draft-ext-quantum-2");
    expect(updateSpec.expectedRevision).toBe(1);

    const parsed = JSON.parse(updateSpec.payloadJson!);
    expect(parsed.summaryNote).toBe("Refined note on entanglement.");
    expect(parsed.verbatimText).toBe(sampleEvidence.quote);
  });

  it("builds atomic acceptance input with specs", () => {
    const input = buildAcceptanceInput("sess-physics-101", [
      { id: "draft-card-1", revision: 2 },
      { id: "draft-card-2", revision: 1, duplicateDecision: "create" },
    ]);

    expect(input.sessionId).toBe("sess-physics-101");
    expect(input.items).toHaveLength(2);
    expect(input.items[0]).toEqual({
      draftId: "draft-card-1",
      expectedRevision: 2,
      duplicateDecision: undefined,
      duplicateTargetId: undefined,
    });
    expect(input.items[1].duplicateDecision).toBe("create");
  });

  it("validates evidence grounding truthfully", () => {
    expect(isDraftGrounded(sampleEvidence)).toBe(true);
    expect(isDraftGrounded(null)).toBe(false);
    expect(isDraftGrounded(undefined)).toBe(false);
    expect(isDraftGrounded({ ...sampleEvidence, quote: "   " })).toBe(false);
  });
});
