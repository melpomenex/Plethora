import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionExtracts } from "../SessionExtracts";
import type {
  PersistedSessionLearningDraft,
  RecordingSession,
} from "../../../types/recordingSession";
import * as extractsApi from "../../../api/extracts";
import * as recordingSessionsApi from "../../../api/recordingSessions";

vi.mock("../../../api/extracts", () => ({
  getExtracts: vi.fn(),
}));

vi.mock("../../../api/recordingSessions", () => ({
  listSessionLearningDrafts: vi.fn(),
  acceptSessionDrafts: vi.fn(),
  rejectSessionLearningDrafts: vi.fn(),
}));

describe("SessionExtracts Component (Task 4.2)", () => {
  const mockSession: RecordingSession = {
    id: "sess-extracts-1",
    version: 1,
    documentId: "doc-456",
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
    createdAt: "2026-10-20T12:00:00Z",
    updatedAt: "2026-10-20T12:00:00Z",
  };

  const sampleExtracts = [
    {
      id: "ext-101",
      document_id: "doc-456",
      content: "Backpropagation computes the gradient of the loss function.",
      notes: "Core optimization concept",
      date_created: "2026-10-20T12:15:00Z",
      date_modified: "2026-10-20T12:15:00Z",
      tags: [],
      progressive_disclosure_level: 0,
      max_disclosure_level: 3,
      review_count: 0,
      reps: 0,
      selection_context: {
        kind: "audio",
        timeSeconds: 95,
      } as any,
    },
  ];

  const sampleProposedExtract: PersistedSessionLearningDraft = {
    id: "draft-ext-201",
    sessionId: "sess-extracts-1",
    runId: "run-1",
    kind: "extract",
    status: "proposed",
    revision: 1,
    payloadJson: JSON.stringify({
      kind: "extract",
      verbatimText: "Gradient descent moves in the direction opposite to the gradient.",
      summaryNote: "Optimization rule of thumb",
    }),
    evidenceJson: JSON.stringify({
      version: 1,
      documentId: "doc-456",
      sessionId: "sess-extracts-1",
      transcriptId: 10,
      transcriptRevision: 2,
      segmentKeys: ["seg_2"],
      quote: "Gradient descent moves in the direction opposite to the gradient.",
      ranges: [{ segmentKey: "seg_2", startUtf16: 0, endUtf16: 66 }],
      time: { startMs: 120000, endMs: 125000, kind: "measured" },
      precision: "segment",
      fingerprint: "fp-grad-descent",
      markerIds: [],
    }),
    contentHash: "hash-grad-descent",
    conceptKey: "Gradient Descent",
    duplicateJson: null,
    acceptedTargetId: null,
    createdAt: "2026-10-20T12:20:00Z",
    updatedAt: "2026-10-20T12:20:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(extractsApi.getExtracts).mockResolvedValue(sampleExtracts);
    vi.mocked(recordingSessionsApi.listSessionLearningDrafts).mockResolvedValue({
      items: [sampleProposedExtract],
      total: 1,
    });
  });

  it("renders saved extracts with notes, timestamps, and play/card actions", async () => {
    const handleSeek = vi.fn();
    const handleOpenTranscript = vi.fn();
    const handleCreateCard = vi.fn();

    render(
      <SessionExtracts
        session={mockSession}
        onSeek={handleSeek}
        onOpenTranscriptAt={handleOpenTranscript}
        onCreateCard={handleCreateCard}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Backpropagation computes the gradient of the loss function/i)
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Core optimization concept")).toBeInTheDocument();
    expect(screen.getByText("1:35")).toBeInTheDocument();

    // Test Play button
    const playBtn = screen.getByRole("button", { name: /Play/i });
    act(() => {
      fireEvent.click(playBtn);
    });
    expect(handleSeek).toHaveBeenCalledWith(95);

    // Test In Transcript button
    const inTranscriptBtn = screen.getByRole("button", { name: /In Transcript/i });
    act(() => {
      fireEvent.click(inTranscriptBtn);
    });
    expect(handleOpenTranscript).toHaveBeenCalledWith(95);

    // Test Create Flashcard handoff
    const makeCardBtn = screen.getByRole("button", { name: /Create Flashcard/i });
    act(() => {
      fireEvent.click(makeCardBtn);
    });
    expect(handleCreateCard).toHaveBeenCalledWith("ext-101", "Backpropagation computes the gradient of the loss function.");
  });

  it("switches to proposed filter, renders durable drafts, and accepts them atomically", async () => {
    vi.mocked(recordingSessionsApi.acceptSessionDrafts).mockResolvedValue({
      results: [{ draftId: "draft-ext-201", success: true, targetId: "ext-real-99" }],
      acceptedCount: 1,
      failedCount: 0,
    });

    render(
      <SessionExtracts
        session={mockSession}
        onCreateCard={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Saved (1)")).toBeInTheDocument();
    });

    const proposedTab = screen.getByRole("button", { name: /Proposed \(1\)/i });
    act(() => {
      fireEvent.click(proposedTab);
    });

    expect(
      screen.getByText(/Gradient descent moves in the direction opposite to the gradient/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Optimization rule of thumb/i)).toBeInTheDocument();

    // Click Accept Selected
    const acceptBtn = screen.getByRole("button", { name: /Accept Selected \(1\)/i });
    act(() => {
      fireEvent.click(acceptBtn);
    });

    await waitFor(() => {
      expect(recordingSessionsApi.acceptSessionDrafts).toHaveBeenCalledWith({
        sessionId: "sess-extracts-1",
        items: [
          {
            draftId: "draft-ext-201",
            expectedRevision: 1,
            duplicateDecision: undefined,
            duplicateTargetId: undefined,
          },
        ],
      });
    });

    expect(screen.getByText(/Accepted 1 extract into library/i)).toBeInTheDocument();
  });

  it("renders empty state when no extracts saved", async () => {
    vi.mocked(extractsApi.getExtracts).mockResolvedValue([]);
    vi.mocked(recordingSessionsApi.listSessionLearningDrafts).mockResolvedValue({
      items: [],
      total: 0,
    });
    const handleOpenTranscript = vi.fn();

    render(
      <SessionExtracts
        session={mockSession}
        onOpenTranscriptAt={handleOpenTranscript}
        onCreateCard={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("No Extracts Saved Yet")).toBeInTheDocument();
    });

    const goTranscriptBtn = screen.getByRole("button", { name: /Go to Transcript/i });
    act(() => {
      fireEvent.click(goTranscriptBtn);
    });
    expect(handleOpenTranscript).toHaveBeenCalledTimes(1);
  });
});
