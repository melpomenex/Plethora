import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionOverview } from "../SessionOverview";
import type { RecordingSession, SessionMediaAsset } from "../../../types/recordingSession";
import * as extractsApi from "../../../api/extracts";
import * as recordingSessionsApi from "../../../api/recordingSessions";
import { useTranscriptionQueueStore } from "../../../stores/transcriptionQueueStore";

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("../../../api/extracts", () => ({
  getExtracts: vi.fn(),
}));

vi.mock("../../../api/recordingSessions", () => ({
  exportPartialRecording: vi.fn(),
  listSessionMarkers: vi.fn().mockResolvedValue([]),
  listSessionRelatedDocuments: vi.fn().mockResolvedValue([]),
  associateSessionDocument: vi.fn(),
  disassociateSessionDocument: vi.fn(),
  deleteSessionMedia: vi.fn(),
  deleteRecordingSession: vi.fn(),
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  isNativeMobile: () => false,
  listen: vi.fn().mockResolvedValue(() => {}),
}));

describe("SessionOverview Component", () => {
  const mockSession: RecordingSession = {
    id: "sess-overview-1",
    version: 1,
    documentId: "doc-123",
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

  const mockMediaAsset: SessionMediaAsset = {
    id: "asset-1",
    sessionId: "sess-overview-1",
    kind: "capture",
    relativePath: "sessions/sess-overview-1/audio.wav",
    mime: "audio/wav",
    byteLength: 1024 * 1024,
    sha256: "abc123hash",
    durationMs: 120000,
    state: "ready",
    sourceUrl: null,
    sourceAdapter: null,
    createdAt: "2026-10-20T12:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(extractsApi.getExtracts).mockResolvedValue([
      {
        id: "ext-1",
        document_id: "doc-123",
        content: "Transformers revolutionize language understanding.",
        date_created: "2026-10-20T12:30:00Z",
        date_modified: "2026-10-20T12:30:00Z",
        tags: [],
        progressive_disclosure_level: 0,
        max_disclosure_level: 3,
        review_count: 0,
        reps: 0,
        selection_context: {
          kind: "audio",
          timeSeconds: 45,
        } as any,
      },
    ]);
  });

  it("renders overview stats, stages, and saved extracts", async () => {
    render(
      <SessionOverview
        session={mockSession}
        mediaAsset={mockMediaAsset}
        privacy={{ isLocalOnly: true, isAiExcluded: false, privacyVersion: 1 }}
        onOpenTranscript={vi.fn()}
        onOpenExtracts={vi.fn()}
        onOpenFlashcards={vi.fn()}
        onCreateManualCard={vi.fn()}
      />
    );

    expect(screen.getByText("Session Overview")).toBeInTheDocument();
    expect(screen.getByTestId("processing-stages")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Saved Extracts (1)")).toBeInTheDocument();
      expect(screen.getByText(/Transformers revolutionize language understanding/i)).toBeInTheDocument();
    });
  });

  it("triggers manual card creation from overview action and extract action", async () => {
    const handleCreateCard = vi.fn();
    render(
      <SessionOverview
        session={mockSession}
        mediaAsset={mockMediaAsset}
        privacy={{ isLocalOnly: true, isAiExcluded: false, privacyVersion: 1 }}
        onOpenTranscript={vi.fn()}
        onOpenExtracts={vi.fn()}
        onOpenFlashcards={vi.fn()}
        onCreateManualCard={handleCreateCard}
      />
    );

    // Click "Create Flashcard" button in available actions
    const createBtn = screen.getByRole("button", { name: /Create Flashcard/i });
    act(() => {
      fireEvent.click(createBtn);
    });
    expect(handleCreateCard).toHaveBeenCalledTimes(1);

    // Wait for extract to appear and click "Make Card" on extract
    await waitFor(() => {
      expect(screen.getByText(/Make Card/i)).toBeInTheDocument();
    });

    const makeCardBtn = screen.getByText(/Make Card/i);
    act(() => {
      fireEvent.click(makeCardBtn);
    });
    expect(handleCreateCard).toHaveBeenCalledWith("ext-1", "Transformers revolutionize language understanding.");
  });

  it("exports partial recording when Export Audio is clicked", async () => {
    vi.mocked(recordingSessionsApi.exportPartialRecording).mockResolvedValue(3);

    render(
      <SessionOverview
        session={mockSession}
        mediaAsset={mockMediaAsset}
        privacy={{ isLocalOnly: true, isAiExcluded: false, privacyVersion: 1 }}
        onOpenTranscript={vi.fn()}
        onOpenExtracts={vi.fn()}
        onOpenFlashcards={vi.fn()}
        onCreateManualCard={vi.fn()}
      />
    );

    const exportBtn = screen.getByRole("button", { name: "Export audio" });
    act(() => {
      fireEvent.click(exportBtn);
    });

    await waitFor(() => {
      expect(recordingSessionsApi.exportPartialRecording).toHaveBeenCalledWith(
        "sess-overview-1",
        "session-sess-ove.wav"
      );
      expect(screen.getByText(/Exported 3 parts/i)).toBeInTheDocument();
    });
  });

  it("renders synthesized overview, outline, takeaways, concepts, and meeting outcomes", async () => {
    const overviewData = {
      overviewSummary: "Executive summary: Detailed analysis of distributed systems and consensus.",
      outline: ["1. Introduction to Consensus", "2. Paxos and Raft", "3. Practical Tradeoffs"],
      keyTakeaways: ["Raft provides strong consistency with comprehensible leader election."],
      concepts: [
        { name: "Consensus", definition: "Reaching agreement on a single data value among distributed processes." },
      ],
      decisions: ["Adopt Raft for the consensus engine."],
      actionItems: ["Benchmark leader election latency under network partition."],
      taskVersion: "1.0.0",
    };

    const sessionWithOverview: RecordingSession = {
      ...mockSession,
      contentType: "meeting",
      overviewJson: JSON.stringify(overviewData),
      overviewRevision: 2,
      transcriptRevision: 2,
    };

    render(
      <SessionOverview
        session={sessionWithOverview}
        mediaAsset={mockMediaAsset}
        privacy={{ isLocalOnly: true, isAiExcluded: false, privacyVersion: 1 }}
        onOpenTranscript={vi.fn()}
        onOpenExtracts={vi.fn()}
        onOpenFlashcards={vi.fn()}
        onCreateManualCard={vi.fn()}
      />
    );

    expect(screen.getByTestId("session-overview-synthesis")).toBeInTheDocument();
    expect(screen.getByText("AI Executive Summary")).toBeInTheDocument();
    expect(screen.getByText(/Detailed analysis of distributed systems/i)).toBeInTheDocument();
    expect(screen.getByText("Section Outline")).toBeInTheDocument();
    expect(screen.getByText("1. Introduction to Consensus")).toBeInTheDocument();
    expect(screen.getByText("Key Takeaways")).toBeInTheDocument();
    expect(screen.getByText(/Raft provides strong consistency/i)).toBeInTheDocument();
    expect(screen.getByText("Key Concepts")).toBeInTheDocument();
    expect(screen.getByText("Consensus")).toBeInTheDocument();
    expect(screen.getByText("Meeting Outcomes")).toBeInTheDocument();
    expect(screen.getByText("Adopt Raft for the consensus engine.")).toBeInTheDocument();
    expect(screen.getByText("Benchmark leader election latency under network partition.")).toBeInTheDocument();

    // Meeting profile says "Off for meetings · Enable suggestions"
    expect(screen.getByText("Off for meetings · Enable suggestions")).toBeInTheDocument();
  });

  it("displays stale warning when transcriptRevision is greater than overviewRevision", async () => {
    const sessionStale: RecordingSession = {
      ...mockSession,
      overviewJson: JSON.stringify({
        overviewSummary: "Old summary",
        outline: [],
        keyTakeaways: [],
        concepts: [],
        taskVersion: "1.0.0",
      }),
      overviewRevision: 1,
      transcriptRevision: 3, // Transcript updated!
    };

    render(
      <SessionOverview
        session={sessionStale}
        mediaAsset={mockMediaAsset}
        privacy={{ isLocalOnly: true, isAiExcluded: false, privacyVersion: 1 }}
        onOpenTranscript={vi.fn()}
        onOpenExtracts={vi.fn()}
        onOpenFlashcards={vi.fn()}
        onCreateManualCard={vi.fn()}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Transcript changed; refresh summary.");
  });

  it("handles audio-only deletion with confirmation and retains transcript/cards", async () => {
    const onSessionUpdated = vi.fn();
    vi.mocked(recordingSessionsApi.deleteSessionMedia).mockResolvedValue({
      sessionId: "sess-overview-1",
      version: 2,
      deletedAssetsCount: 1,
      transcriptPreserved: true,
      cardsPreserved: true,
    });

    render(
      <SessionOverview
        session={mockSession}
        mediaAsset={mockMediaAsset}
        privacy={{ isLocalOnly: true, isAiExcluded: false, privacyVersion: 1 }}
        onOpenTranscript={vi.fn()}
        onOpenExtracts={vi.fn()}
        onOpenFlashcards={vi.fn()}
        onCreateManualCard={vi.fn()}
        onSessionUpdated={onSessionUpdated}
      />
    );

    // Click "Delete Audio Only (Keep Transcript)"
    const deleteAudioBtn = screen.getByRole("button", { name: "Delete audio only" });
    fireEvent.click(deleteAudioBtn);

    // Modal opens
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Delete Audio Recording?")).toBeInTheDocument();
    expect(
      screen.getByText(/Your transcript, summary, extracts, and cards will be preserved/i)
    ).toBeInTheDocument();

    // Confirm deletion
    const confirmBtn = screen.getByRole("button", { name: "Confirm Delete Audio" });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(recordingSessionsApi.deleteSessionMedia).toHaveBeenCalledWith(
      "sess-overview-1",
      1
    );
    expect(onSessionUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sess-overview-1",
        version: 2,
        mediaAssetId: null,
      })
    );
  });

  it("handles full session deletion with confirmation and invokes onSessionDeleted", async () => {
    const onSessionDeleted = vi.fn();
    vi.mocked(recordingSessionsApi.deleteRecordingSession).mockResolvedValue({
      sessionId: "sess-overview-1",
      deleted: true,
      acceptedCardsRetained: true,
    });

    render(
      <SessionOverview
        session={mockSession}
        mediaAsset={mockMediaAsset}
        privacy={{ isLocalOnly: true, isAiExcluded: false, privacyVersion: 1 }}
        onOpenTranscript={vi.fn()}
        onOpenExtracts={vi.fn()}
        onOpenFlashcards={vi.fn()}
        onCreateManualCard={vi.fn()}
        onSessionDeleted={onSessionDeleted}
      />
    );

    // Click "Delete Session"
    const deleteSessionBtn = screen.getByRole("button", { name: "Delete session" });
    fireEvent.click(deleteSessionBtn);

    // Modal opens
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Delete Recording Session?")).toBeInTheDocument();
    expect(
      screen.getByText(/Any cards and extracts saved to your library will NOT be deleted/i)
    ).toBeInTheDocument();

    // Confirm deletion
    const confirmBtn = screen.getByRole("button", { name: "Confirm Delete Session" });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(recordingSessionsApi.deleteRecordingSession).toHaveBeenCalledWith(
      "sess-overview-1",
      1,
      true
    );
    expect(onSessionDeleted).toHaveBeenCalled();
  });
});
