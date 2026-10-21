import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionTranscript } from "../SessionTranscript";
import * as recordingSessionsApi from "../../../api/recordingSessions";
import type {
  RecordingSession,
  SessionTranscriptSegment,
  SessionSegmentPage,
} from "../../../types/recordingSession";

const toasts: Array<{ type: string; title?: string; message: string }> = [];

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("../../../api/recordingSessions", () => ({
  getSessionSegments: vi.fn(),
  correctSessionSegment: vi.fn(),
  updateSessionSpeaker: vi.fn(),
}));

vi.mock("../../../api/extracts", () => ({
  createExtract: vi.fn(),
}));

vi.mock("../../common/Toast", () => ({
  ToastType: { Error: "error", Success: "success", Warning: "warning", Info: "info" },
  useToastStore: (select: (s: any) => any) =>
    select({
      addToast: (t: any) => toasts.push(t),
    }),
}));

describe("SessionTranscript Segment Corrections (Task 2.5)", () => {
  const baseSession: RecordingSession = {
    id: "sess-correct-1",
    version: 1,
    documentId: "doc-1",
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

  const sampleSegments: SessionTranscriptSegment[] = [
    {
      segmentKey: "seg-quantum-1",
      transcriptId: 10,
      ordinal: 0,
      text: "Initial technical term: quantum decoherence.",
      confidence: 0.98,
      words: null,
      speakerId: "Prof",
      timing: { kind: "measured", startMs: 1000, endMs: 4000 },
      revision: 2,
    },
    {
      segmentKey: "seg-quantum-2",
      transcriptId: 10,
      ordinal: 1,
      text: "And here is the second observation.",
      confidence: 0.95,
      words: null,
      speakerId: "Prof",
      timing: { kind: "measured", startMs: 4000, endMs: 8000 },
      revision: 2,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    toasts.length = 0;
    vi.mocked(recordingSessionsApi.getSessionSegments).mockResolvedValue({
      items: sampleSegments,
      revision: 2,
      nextCursor: undefined,
    });
  });

  it("renders segment and allows entering inline edit mode", async () => {
    render(<SessionTranscript session={baseSession} />);

    await waitFor(() => {
      expect(screen.getByText("Initial technical term: quantum decoherence.")).toBeInTheDocument();
    });

    const editBtn = screen.getByLabelText("Edit segment seg-quantum-1");
    expect(editBtn).toBeInTheDocument();

    fireEvent.click(editBtn);

    expect(screen.getByTestId("edit-form-seg-quantum-1")).toBeInTheDocument();
    const textarea = screen.getByTestId("edit-form-seg-quantum-1").querySelector("textarea")!;
    expect(textarea).toHaveValue("Initial technical term: quantum decoherence.");
  });

  it("cancels edit mode without persisting", async () => {
    render(<SessionTranscript session={baseSession} />);

    await waitFor(() => {
      expect(screen.getByText("Initial technical term: quantum decoherence.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Edit segment seg-quantum-1"));
    expect(screen.getByTestId("edit-form-seg-quantum-1")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("edit-form-seg-quantum-1")).not.toBeInTheDocument();
    expect(recordingSessionsApi.correctSessionSegment).not.toHaveBeenCalled();
  });

  it("submits correction with technical terms, emoji, and math notation", async () => {
    vi.mocked(recordingSessionsApi.correctSessionSegment).mockResolvedValue(3);

    render(<SessionTranscript session={baseSession} />);

    await waitFor(() => {
      expect(screen.getByText("Initial technical term: quantum decoherence.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Edit segment seg-quantum-1"));

    const textarea = screen.getByTestId("edit-form-seg-quantum-1").querySelector("textarea")!;
    const updatedText = "Initial technical term: quantum entanglement 🔬 with math $\\psi = \\alpha |0\\rangle + \\beta |1\\rangle$.";
    fireEvent.change(textarea, { target: { value: updatedText } });

    fireEvent.click(screen.getByText("Save correction"));

    await waitFor(() => {
      expect(recordingSessionsApi.correctSessionSegment).toHaveBeenCalledWith(
        "sess-correct-1",
        "seg-quantum-1",
        2, // expectedRevision from baseSession.transcriptRevision
        updatedText
      );
    });

    // Segment text and revision display update
    await waitFor(() => {
      expect(screen.getByText(updatedText)).toBeInTheDocument();
      expect(screen.getByText(/Revision 3/)).toBeInTheDocument();
    });
  });

  it("handles concurrent conflict with StaleRevision and reloads latest transcript", async () => {
    vi.mocked(recordingSessionsApi.correctSessionSegment).mockRejectedValue({
      code: "StaleRevision",
      message: "Transcript revision is stale",
    });

    render(<SessionTranscript session={baseSession} />);

    await waitFor(() => {
      expect(screen.getByText("Initial technical term: quantum decoherence.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Edit segment seg-quantum-1"));

    const textarea = screen.getByTestId("edit-form-seg-quantum-1").querySelector("textarea")!;
    fireEvent.change(textarea, { target: { value: "Conflicting change" } });

    fireEvent.click(screen.getByText("Save correction"));

    await waitFor(() => {
      expect(recordingSessionsApi.correctSessionSegment).toHaveBeenCalled();
    });

    // Verifies conflict toast and reload triggered
    await waitFor(() => {
      expect(toasts.some((t) => t.message.includes("Conflict"))).toBe(true);
      // Reloaded page
      expect(recordingSessionsApi.getSessionSegments).toHaveBeenCalledTimes(2);
    });
  });

  it("renames speaker label across session and updates rendered badge", async () => {
    vi.mocked(recordingSessionsApi.updateSessionSpeaker).mockResolvedValue(1);

    render(<SessionTranscript session={baseSession} />);

    await waitFor(() => {
      expect(screen.getAllByLabelText("Edit speaker Prof")[0]).toBeInTheDocument();
    });

    // Click speaker badge
    fireEvent.click(screen.getAllByLabelText("Edit speaker Prof")[0]);

    // Modal dialog opens
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Rename or Merge Speaker")).toBeInTheDocument();

    const input = screen.getByLabelText("Speaker Name");
    fireEvent.change(input, { target: { value: "Prof. Feynman" } });

    fireEvent.click(screen.getByRole("button", { name: "Save Speaker" }));

    await waitFor(() => {
      expect(recordingSessionsApi.updateSessionSpeaker).toHaveBeenCalledWith(
        "sess-correct-1",
        "Prof",
        "Prof. Feynman"
      );
    });

    await waitFor(() => {
      expect(screen.getAllByText("Prof. Feynman").length).toBeGreaterThan(0);
    });
  });
});
