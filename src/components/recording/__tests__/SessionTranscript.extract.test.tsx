import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionTranscript } from "../SessionTranscript";
import * as recordingSessionsApi from "../../../api/recordingSessions";
import * as extractsApi from "../../../api/extracts";
import type {
  RecordingSession,
  SessionTranscriptSegment,
  SessionSegmentPage,
} from "../../../types/recordingSession";

const toasts: Array<{ type: string; title: string; message: string }> = [];

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("../../../api/recordingSessions", () => ({
  getSessionSegments: vi.fn(),
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

describe("SessionTranscript Exact Extracts (Task 2.4)", () => {
  const baseSession: RecordingSession = {
    id: "sess-transcript-1",
    version: 1,
    documentId: "doc-1",
    origin: "recorded",
    contentType: "lecture",
    profileJson: "{}",
    mediaAssetId: "asset-1",
    transcriptId: 1,
    transcriptRevision: 1,
    overviewJson: null,
    overviewRevision: null,
    ingestionState: "saved",
    captureState: "saved",
    createdAt: "2026-10-20T12:00:00Z",
    updatedAt: "2026-10-20T12:00:00Z",
  };

  const sampleSegments: SessionTranscriptSegment[] = [
    {
      segmentKey: "seg-0",
      transcriptId: 1,
      ordinal: 0,
      revision: 1,
      text: "Paxos is a consensus protocol for state machine replication.",
      timing: { kind: "measured", startMs: 10000, endMs: 25000 },
      speakerId: "Professor",
    },
    {
      segmentKey: "seg-1",
      transcriptId: 1,
      ordinal: 1,
      revision: 1,
      text: "Untimed paragraph about Raft comparisons without audio.",
      timing: { kind: "none" },
    },
  ];

  beforeEach(() => {
    toasts.length = 0;
    vi.clearAllMocks();
    vi.mocked(recordingSessionsApi.getSessionSegments).mockResolvedValue({
      items: sampleSegments,
      revision: 1,
    } as SessionSegmentPage);
    vi.mocked(extractsApi.createExtract).mockResolvedValue({
      id: "extract-paxos-1",
      document_id: "doc-1",
      content: "Paxos is a consensus protocol",
      date_created: "2026-10-20T12:00:00Z",
      date_modified: "2026-10-20T12:00:00Z",
    } as any);
  });

  it("opens selection toolbar when text is selected inside a segment", async () => {
    render(<SessionTranscript session={baseSession} />);

    await waitFor(() => {
      expect(screen.getByText(/Paxos is a consensus protocol/i)).toBeInTheDocument();
    });

    // Mock window.getSelection
    const selectedQuote = "Paxos is a consensus protocol";
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      toString: () => selectedQuote,
      removeAllRanges: vi.fn(),
    } as any);

    // Trigger mouseup on the segment
    const segmentElement = screen.getByText(/Paxos is a consensus protocol/i);
    fireEvent.mouseUp(segmentElement);

    // Floating selection toolbar should appear
    expect(screen.getByTestId("transcript-selection-toolbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save Extract/i })).toBeInTheDocument();
  });

  it("opens preview modal and saves exact extract with canonical evidence and note", async () => {
    render(<SessionTranscript session={baseSession} />);

    await waitFor(() => {
      expect(screen.getByText(/Paxos is a consensus protocol/i)).toBeInTheDocument();
    });

    const selectedQuote = "Paxos is a consensus protocol";
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      toString: () => selectedQuote,
      removeAllRanges: vi.fn(),
    } as any);

    const segmentElement = screen.getByText(/Paxos is a consensus protocol/i);
    fireEvent.mouseUp(segmentElement);

    // Click "Save Extract" from the floating toolbar
    const toolbarSaveBtn = screen.getByRole("button", { name: /Save Extract/i });
    fireEvent.click(toolbarSaveBtn);

    // Save Extract modal dialog should be visible
    expect(screen.getByRole("dialog", { name: /Save Extract Preview/i })).toBeInTheDocument();
    expect(screen.getByTestId("extract-exact-quote")).toHaveTextContent(selectedQuote);
    expect(screen.getByText(/Segment: seg-0/i)).toBeInTheDocument();

    // User adds an optional note
    const noteTextarea = screen.getByPlaceholderText(/Add your reflections, context, or summary/i);
    fireEvent.change(noteTextarea, { target: { value: "Exam question hint: consensus protocol" } });

    // Submit modal
    const modalSaveBtn = screen.getAllByRole("button", { name: /Save Extract/i })[0];
    await act(async () => {
      fireEvent.click(modalSaveBtn);
    });

    // Verify createExtract API call parameters
    expect(extractsApi.createExtract).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(extractsApi.createExtract).mock.calls[0][0];
    expect(callArg.document_id).toBe("doc-1");
    expect(callArg.content).toBe(selectedQuote);
    expect(callArg.note).toBe("Exam question hint: consensus protocol");

    // Verify selection context and evidence
    const ctx = callArg.selection_context as any;
    expect(ctx.type).toBe("session_transcript");
    expect(ctx.sessionId).toBe("sess-transcript-1");
    expect(ctx.documentId).toBe("doc-1");
    expect(ctx.segmentKeys).toEqual(["seg-0"]);
    expect(ctx.ranges[0]).toEqual({
      segmentKey: "seg-0",
      startUtf16: 0,
      endUtf16: selectedQuote.length,
    });
    expect(ctx.evidence.quote).toBe(selectedQuote);
    expect(ctx.evidence.time).toEqual({
      startMs: 10000,
      endMs: 25000,
      kind: "measured",
    });

    // Success toast shown
    expect(toasts.some((t) => t.message.includes("Exact transcript quote saved"))).toBe(true);

    // Modal and toolbar closed
    expect(screen.queryByRole("dialog", { name: /Save Extract Preview/i })).toBeNull();
    expect(screen.queryByTestId("transcript-selection-toolbar")).toBeNull();
  });

  it("handles untimed segments honestly without fake timing in evidence", async () => {
    render(<SessionTranscript session={baseSession} />);

    await waitFor(() => {
      expect(screen.getByText(/Untimed paragraph about Raft/i)).toBeInTheDocument();
    });

    const selectedQuote = "Raft comparisons";
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      toString: () => selectedQuote,
      removeAllRanges: vi.fn(),
    } as any);

    const segmentElement = screen.getByText(/Untimed paragraph about Raft/i);
    fireEvent.mouseUp(segmentElement);

    const toolbarSaveBtn = screen.getByRole("button", { name: /Save Extract/i });
    fireEvent.click(toolbarSaveBtn);

    const modalSaveBtn = screen.getAllByRole("button", { name: /Save Extract/i })[0];
    await act(async () => {
      fireEvent.click(modalSaveBtn);
    });

    expect(extractsApi.createExtract).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(extractsApi.createExtract).mock.calls[0][0];
    const ctx = callArg.selection_context as any;
    expect(ctx.segmentKeys).toEqual(["seg-1"]);
    // Untimed text must not have fake timing
    expect(ctx.evidence.time).toBeUndefined();
  });

  it("dismiss button clears the selection toolbar", async () => {
    render(<SessionTranscript session={baseSession} />);

    await waitFor(() => {
      expect(screen.getByText(/Paxos is a consensus protocol/i)).toBeInTheDocument();
    });

    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      toString: () => "Paxos",
      removeAllRanges: vi.fn(),
    } as any);

    const segmentElement = screen.getByText(/Paxos is a consensus protocol/i);
    fireEvent.mouseUp(segmentElement);

    expect(screen.getByTestId("transcript-selection-toolbar")).toBeInTheDocument();

    const dismissBtn = screen.getByTitle("Dismiss");
    fireEvent.click(dismissBtn);

    expect(screen.queryByTestId("transcript-selection-toolbar")).toBeNull();
  });
});
