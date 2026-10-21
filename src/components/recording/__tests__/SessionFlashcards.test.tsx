import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionFlashcards } from "../SessionFlashcards";
import type {
  PersistedSessionLearningDraft,
  RecordingSession,
} from "../../../types/recordingSession";
import * as recordingSessionsApi from "../../../api/recordingSessions";

vi.mock("../../../api/recordingSessions", () => ({
  listSessionLearningDrafts: vi.fn(),
  acceptSessionDrafts: vi.fn(),
  rejectSessionLearningDrafts: vi.fn(),
  updateSessionLearningDraft: vi.fn(),
}));

describe("SessionFlashcards Component (Task 4.2)", () => {
  const mockSession: RecordingSession = {
    id: "sess-flashcards-1",
    version: 1,
    documentId: "doc-quantum-456",
    origin: "recorded",
    contentType: "lecture",
    profileJson: "{}",
    mediaAssetId: "asset-1",
    transcriptId: 10,
    transcriptRevision: 2,
    overviewJson: null,
    overviewRevision: null,
    ingestionState: "saved",
    captureState: "saved",
    createdAt: "2026-10-21T01:00:00Z",
    updatedAt: "2026-10-21T01:00:00Z",
  };

  const sampleProposedDraft: PersistedSessionLearningDraft = {
    id: "draft-card-101",
    sessionId: "sess-flashcards-1",
    runId: "run-1",
    kind: "card",
    status: "proposed",
    revision: 1,
    payloadJson: JSON.stringify({
      kind: "card",
      candidate: {
        cardType: "qa",
        question: "What is quantum superposition?",
        answer: "A state in which a physical system exists partly in all possible states simultaneously.",
        concept: "Quantum Superposition",
        evidenceQuote: "Superposition allows a quantum particle to be in a linear combination of states.",
      },
    }),
    evidenceJson: JSON.stringify({
      version: 1,
      documentId: "doc-quantum-456",
      sessionId: "sess-flashcards-1",
      transcriptId: 10,
      transcriptRevision: 2,
      segmentKeys: ["seg_0"],
      quote: "Superposition allows a quantum particle to be in a linear combination of states.",
      ranges: [{ segmentKey: "seg_0", startUtf16: 0, endUtf16: 74 }],
      time: { startMs: 5000, endMs: 9000, kind: "measured" },
      precision: "segment",
      fingerprint: "fp-superposition",
      markerIds: [],
    }),
    contentHash: "hash-superposition",
    conceptKey: "Quantum Superposition",
    duplicateJson: null,
    acceptedTargetId: null,
    createdAt: "2026-10-21T01:10:00Z",
    updatedAt: "2026-10-21T01:10:00Z",
  };

  const sampleAcceptedDraft: PersistedSessionLearningDraft = {
    id: "draft-card-102",
    sessionId: "sess-flashcards-1",
    runId: "run-1",
    kind: "card",
    status: "accepted",
    revision: 2,
    payloadJson: JSON.stringify({
      kind: "card",
      candidate: {
        cardType: "qa",
        question: "What is wave-particle duality?",
        answer: "Matter exhibits properties of both waves and particles.",
        concept: "Duality",
        evidenceQuote: "Light behaves as both a continuous wave and discrete packets of energy.",
      },
    }),
    evidenceJson: JSON.stringify({
      version: 1,
      documentId: "doc-quantum-456",
      sessionId: "sess-flashcards-1",
      transcriptId: 10,
      transcriptRevision: 2,
      segmentKeys: ["seg_1"],
      quote: "Light behaves as both a continuous wave and discrete packets of energy.",
      ranges: [{ segmentKey: "seg_1", startUtf16: 0, endUtf16: 65 }],
      precision: "segment",
      fingerprint: "fp-duality",
      markerIds: [],
    }),
    contentHash: "hash-duality",
    conceptKey: "Duality",
    duplicateJson: null,
    acceptedTargetId: "card-real-item-999",
    createdAt: "2026-10-21T01:12:00Z",
    updatedAt: "2026-10-21T01:12:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(recordingSessionsApi.listSessionLearningDrafts).mockResolvedValue({
      items: [sampleProposedDraft, sampleAcceptedDraft],
      total: 2,
    });
  });

  it("loads and renders proposed draft cards with evidence quotes", async () => {
    render(<SessionFlashcards session={mockSession} />);

    await waitFor(() => {
      expect(recordingSessionsApi.listSessionLearningDrafts).toHaveBeenCalledWith(
        "sess-flashcards-1",
        { kind: "card", limit: 100 }
      );
    });

    // In default 'proposed' tab, proposed draft is visible
    expect(
      screen.getByText("What is quantum superposition?")
    ).toBeInTheDocument();

    // Verbatim evidence quote is rendered
    expect(
      screen.getByText(
        /"Superposition allows a quantum particle to be in a linear combination of states."/
      )
    ).toBeInTheDocument();
  });

  it("switches filter tabs between Proposed, Accepted, and All", async () => {
    render(<SessionFlashcards session={mockSession} />);

    await waitFor(() => {
      expect(
        screen.getByText("What is quantum superposition?")
      ).toBeInTheDocument();
    });

    // Switch to 'Accepted'
    const acceptedFilterBtn = screen.getByRole("button", {
      name: /Accepted \(1\)/i,
    });
    fireEvent.click(acceptedFilterBtn);

    expect(
      screen.getByText("What is wave-particle duality?")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("What is quantum superposition?")
    ).not.toBeInTheDocument();
  });

  it("accepts selected proposed drafts atomically and reloads list", async () => {
    vi.mocked(recordingSessionsApi.acceptSessionDrafts).mockResolvedValue({
      results: [
        {
          draftId: sampleProposedDraft.id,
          success: true,
          targetId: "new-item-42",
        },
      ],
      acceptedCount: 1,
      failedCount: 0,
    });

    render(<SessionFlashcards session={mockSession} />);

    await waitFor(() => {
      expect(
        screen.getByText("What is quantum superposition?")
      ).toBeInTheDocument();
    });

    const acceptBtn = screen.getByRole("button", {
      name: /Accept Selected \(1\)/i,
    });
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(recordingSessionsApi.acceptSessionDrafts).toHaveBeenCalledWith({
        sessionId: "sess-flashcards-1",
        items: [
          {
            draftId: "draft-card-101",
            expectedRevision: 1,
            duplicateDecision: undefined,
            duplicateTargetId: undefined,
          },
        ],
      });
    });

    expect(
      screen.getByText(/Accepted 1 card into your review library/i)
    ).toBeInTheDocument();
  });

  it("rejects draft through rejectSessionLearningDrafts without touching library", async () => {
    vi.mocked(recordingSessionsApi.rejectSessionLearningDrafts).mockResolvedValue(
      1
    );

    render(<SessionFlashcards session={mockSession} />);

    await waitFor(() => {
      expect(
        screen.getByText("What is quantum superposition?")
      ).toBeInTheDocument();
    });

    const deleteBtn = screen.getByTitle("Delete");
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(
        recordingSessionsApi.rejectSessionLearningDrafts
      ).toHaveBeenCalledWith("sess-flashcards-1", ["draft-card-101"]);
    });

    expect(screen.getByText(/Draft rejected/i)).toBeInTheDocument();
  });

  it("handles seek action from evidence timestamp badge", async () => {
    const handleSeek = vi.fn();
    render(<SessionFlashcards session={mockSession} onSeek={handleSeek} />);

    await waitFor(() => {
      expect(screen.getByText(/Seek/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Seek/i));
    expect(handleSeek).toHaveBeenCalledWith(5); // 5000ms -> 5s
  });
});
