import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionMarkers } from "../SessionMarkers";
import * as recordingSessionsApi from "../../../api/recordingSessions";
import type {
  RecordingSession,
  RecordingSessionMarker,
} from "../../../types/recordingSession";

const toasts: Array<{ type: string; title: string; message: string }> = [];
vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("../../common/Toast", () => ({
  ToastType: { Error: "error", Success: "success", Warning: "warning", Info: "info" },
  useToastStore: (select: (s: any) => any) =>
    select({
      addToast: (t: any) => toasts.push(t),
    }),
}));

vi.mock("../../../api/recordingSessions", () => ({
  createSessionMarker: vi.fn(),
  listSessionMarkers: vi.fn(),
  resolveSessionMarkers: vi.fn(),
}));

describe("SessionMarkers Component (Task 2.3)", () => {
  const baseSession: RecordingSession = {
    id: "sess-markers-1",
    version: 1,
    documentId: "doc-1",
    origin: "recorded",
    contentType: "lecture",
    profileJson: "{}",
    mediaAssetId: "asset-1",
    transcriptId: null,
    transcriptRevision: 0,
    overviewJson: null,
    overviewRevision: null,
    ingestionState: "saved",
    captureState: "saved",
    createdAt: "2026-10-20T12:00:00Z",
    updatedAt: "2026-10-20T12:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    toasts.length = 0;
  });

  it("renders empty state when session has no markers", async () => {
    vi.mocked(recordingSessionsApi.listSessionMarkers).mockResolvedValue([]);
    render(<SessionMarkers session={baseSession} currentTimeMs={0} />);

    await waitFor(() => {
      expect(
        screen.getByText(/No moments marked yet. Tap "Confusing" or "Important"/i)
      ).toBeInTheDocument();
    });
  });

  it("displays pending and resolved markers with truthful timestamps and quotes", async () => {
    const markers: RecordingSessionMarker[] = [
      {
        id: "m-1",
        sessionId: baseSession.id,
        kind: "confusing",
        mediaMs: 45000,
        windowMs: 30000,
        partSequence: null,
        note: "What is Byzantine fault tolerance?",
        evidence: null,
        state: "pending",
        createdAt: "2026-10-20T12:00:00Z",
      },
      {
        id: "m-2",
        sessionId: baseSession.id,
        kind: "interesting",
        mediaMs: 120000,
        windowMs: 30000,
        partSequence: null,
        note: null,
        evidence: [
          {
            version: 1,
            documentId: "doc-1",
            sessionId: baseSession.id,
            transcriptId: 1,
            transcriptRevision: 1,
            segmentKeys: ["seg-1"],
            quote: "Consensus is reached when majority agrees on state.",
            ranges: [{ segmentKey: "seg-1", startUtf16: 0, endUtf16: 50 }],
            markerIds: ["m-2"],
            precision: "segment",
            fingerprint: "fp-1",
          },
        ],
        state: "resolved",
        createdAt: "2026-10-20T12:05:00Z",
      },
    ];

    vi.mocked(recordingSessionsApi.listSessionMarkers).mockResolvedValue(markers);
    const onSeek = vi.fn();
    render(<SessionMarkers session={baseSession} onSeek={onSeek} />);

    await waitFor(() => {
      expect(screen.getByTestId("marker-m-1")).toBeInTheDocument();
      expect(screen.getByTestId("marker-m-2")).toBeInTheDocument();
    });

    // Check m-1 (pending)
    expect(screen.getByText("Pending transcription")).toBeInTheDocument();
    expect(screen.getByText(/"What is Byzantine fault tolerance\?"/i)).toBeInTheDocument();

    // Check m-2 (resolved with quote)
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(
      screen.getByText("Consensus is reached when majority agrees on state.")
    ).toBeInTheDocument();

    // Click marker triggers onSeek
    fireEvent.click(screen.getByTestId("marker-m-1"));
    expect(onSeek).toHaveBeenCalledWith(45);
  });

  it("adds a confusing marker on one-tap and handles repeated invoke extension feedback", async () => {
    vi.mocked(recordingSessionsApi.listSessionMarkers).mockResolvedValue([]);
    const createdMarker: RecordingSessionMarker = {
      id: "m-new",
      sessionId: baseSession.id,
      kind: "confusing",
      mediaMs: 30000,
      windowMs: 30000,
      partSequence: null,
      note: null,
      evidence: null,
      state: "pending",
      createdAt: "2026-10-20T12:00:00Z",
    };
    vi.mocked(recordingSessionsApi.createSessionMarker).mockResolvedValueOnce(createdMarker);

    render(<SessionMarkers session={baseSession} currentTimeMs={30000} />);

    // Click "Confusing" button
    const confusingBtn = screen.getByRole("button", { name: /Confusing/i });
    await act(async () => {
      fireEvent.click(confusingBtn);
    });

    expect(recordingSessionsApi.createSessionMarker).toHaveBeenCalledWith({
      sessionId: baseSession.id,
      kind: "confusing",
      mediaMs: 30000,
      windowMs: 30000,
      note: undefined,
    });

    expect(toasts.some((t) => t.title.includes("Confusing Moment Marked"))).toBe(true);

    // Repeated click extends window to 60s
    vi.mocked(recordingSessionsApi.createSessionMarker).mockResolvedValueOnce({
      ...createdMarker,
      windowMs: 60000,
    });

    await act(async () => {
      fireEvent.click(confusingBtn);
    });

    expect(toasts.some((t) => t.title.includes("Window Extended"))).toBe(true);
  });

  it("handles DB failure feedback with an actionable error toast", async () => {
    vi.mocked(recordingSessionsApi.listSessionMarkers).mockResolvedValue([]);
    vi.mocked(recordingSessionsApi.createSessionMarker).mockRejectedValue(
      new Error("Database locked")
    );

    render(<SessionMarkers session={baseSession} currentTimeMs={15000} />);

    const importantBtn = screen.getByRole("button", { name: /Important/i });
    await act(async () => {
      fireEvent.click(importantBtn);
    });

    expect(toasts.some((t) => t.type === "error" && t.message.includes("Database locked"))).toBe(true);
  });

  it("resolves pending markers against finalized transcript upon clicking Resolve", async () => {
    const pendingMarker: RecordingSessionMarker = {
      id: "m-res",
      sessionId: baseSession.id,
      kind: "confusing",
      mediaMs: 40000,
      windowMs: 30000,
      partSequence: null,
      note: null,
      evidence: null,
      state: "pending",
      createdAt: "2026-10-20T12:00:00Z",
    };

    const resolvedMarker: RecordingSessionMarker = {
      ...pendingMarker,
      state: "resolved",
      evidence: [
        {
          version: 1,
          documentId: "doc-1",
          sessionId: baseSession.id,
          transcriptId: 1,
          transcriptRevision: 1,
          segmentKeys: ["seg-1"],
          quote: "Resolved text from transcript",
          ranges: [{ segmentKey: "seg-1", startUtf16: 0, endUtf16: 28 }],
          markerIds: ["m-res"],
          precision: "segment",
          fingerprint: "fp-res",
        },
      ],
    };

    vi.mocked(recordingSessionsApi.listSessionMarkers).mockResolvedValue([pendingMarker]);
    vi.mocked(recordingSessionsApi.resolveSessionMarkers).mockResolvedValue([resolvedMarker]);

    render(<SessionMarkers session={baseSession} />);

    await waitFor(() => {
      expect(screen.getByTestId("marker-m-res")).toBeInTheDocument();
      expect(screen.getByText("Pending transcription")).toBeInTheDocument();
    });

    const resolveBtn = screen.getByRole("button", { name: /Resolve/i });
    await act(async () => {
      fireEvent.click(resolveBtn);
    });

    expect(recordingSessionsApi.resolveSessionMarkers).toHaveBeenCalledWith(baseSession.id);
    await waitFor(() => {
      expect(screen.getByText("Resolved")).toBeInTheDocument();
      expect(screen.getByText("Resolved text from transcript")).toBeInTheDocument();
    });
  });
});
