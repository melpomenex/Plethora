import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveRecording } from "../ActiveRecording";
import { captureController } from "../../../services/recording/captureController";
import { sessionController } from "../../../services/recording/SessionController";
import { useRecordingSessionStore } from "../../../stores/recordingSessionStore";
import { useUIStore } from "../../../stores/uiStore";

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
  createSessionMarker: vi.fn().mockImplementation(async (params: any) => ({
    id: "marker-1",
    sessionId: params.sessionId,
    kind: params.kind,
    state: "pending",
    mediaMs: params.mediaMs,
    windowMs: params.windowMs,
    resolvedAt: null,
    evidence: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })),
}));

describe("ActiveRecording (Screen 2 Active Capture Surface)", () => {
  beforeEach(() => {
    toasts.length = 0;
    useUIStore.setState({ activeRecordingOpen: true });
    useRecordingSessionStore.setState({
      state: "recording",
      activeSessionId: "sess-active-1",
      health: {
        acknowledgedMs: 12500,
        pendingBytes: 0,
        state: "recording",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("displays elapsed duration, health indicator, and activity status", () => {
    render(<ActiveRecording isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText("Recording")).toBeInTheDocument();
    expect(screen.getByText(/Saved through 00:12/i)).toBeInTheDocument();
    expect(screen.getByText("Audio detected")).toBeInTheDocument();
  });

  it("closing or minimizing preserves recording without stopping capture", () => {
    const finishSpy = vi.spyOn(captureController, "finish");
    const discardSpy = vi.spyOn(captureController, "discard");

    render(<ActiveRecording isOpen={true} />);

    const minimizeBtn = screen.getByRole("button", { name: /Minimize recording/i });
    fireEvent.click(minimizeBtn);

    expect(useUIStore.getState().activeRecordingOpen).toBe(false);
    expect(finishSpy).not.toHaveBeenCalled();
    expect(discardSpy).not.toHaveBeenCalled();
    expect(useRecordingSessionStore.getState().state).toBe("recording");
  });

  it("triggers pause and resume controls", async () => {
    const pauseSpy = vi.spyOn(captureController, "pause").mockResolvedValue();
    const resumeSpy = vi.spyOn(captureController, "resume").mockResolvedValue();

    render(<ActiveRecording isOpen={true} />);

    const pauseBtn = screen.getByRole("button", { name: /Pause/i });
    await act(async () => {
      fireEvent.click(pauseBtn);
    });
    expect(pauseSpy).toHaveBeenCalledTimes(1);

    // Update state to paused
    act(() => {
      useRecordingSessionStore.setState({ state: "paused" });
    });

    const resumeBtn = screen.getByRole("button", { name: /Resume/i });
    await act(async () => {
      fireEvent.click(resumeBtn);
    });
    expect(resumeSpy).toHaveBeenCalledTimes(1);
  });

  it("creates markers with immediate user feedback", async () => {
    render(<ActiveRecording isOpen={true} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Important"));
    });
    expect(toasts.some((t) => t.message.includes("Important moment saved"))).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByText("Confusing"));
    });
    expect(toasts.some((t) => t.message.includes("Confusing moment saved"))).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByText("Save extract"));
    });
    expect(toasts.some((t) => t.message.includes("Audio bookmark saved"))).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByText("Card candidate"));
    });
    expect(toasts.some((t) => t.message.includes("Card candidate saved"))).toBe(true);
  });

  it("explicit finish finalizes session and closes view", async () => {
    const finishSpy = vi
      .spyOn(captureController, "finish")
      .mockResolvedValue({ assetId: "asset-1", incomplete: false });
    const finalizeSpy = vi
      .spyOn(sessionController, "finalizeIngestion")
      .mockResolvedValue({} as any);

    render(<ActiveRecording isOpen={true} />);

    const finishBtn = screen.getByRole("button", { name: /Finish recording/i });
    await act(async () => {
      fireEvent.click(finishBtn);
    });

    expect(finishSpy).toHaveBeenCalledTimes(1);
    expect(finalizeSpy).toHaveBeenCalledWith({ sessionId: "sess-active-1" });
    expect(useUIStore.getState().activeRecordingOpen).toBe(false);
    expect(toasts.some((t) => t.message.includes("Recording saved successfully"))).toBe(true);
  });

  it("discarding requires confirmation dialog before clearing capture", () => {
    const discardSpy = vi.spyOn(captureController, "discard");

    render(<ActiveRecording isOpen={true} />);

    // Open overflow menu
    const menuBtn = screen.getByRole("button", { name: /Recording options/i });
    fireEvent.click(menuBtn);

    // Click discard option
    const discardOption = screen.getByText("Discard recording");
    fireEvent.click(discardOption);

    // Confirmation dialog appears
    expect(screen.getByText("Discard recording?")).toBeInTheDocument();
    expect(discardSpy).not.toHaveBeenCalled();

    // Confirm discard
    const confirmBtn = screen.getByRole("button", { name: "Discard" });
    fireEvent.click(confirmBtn);

    expect(discardSpy).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().activeRecordingOpen).toBe(false);
  });

  it("displays persistent banner and action choices on interrupted recording", () => {
    useRecordingSessionStore.setState({ state: "interrupted" });

    render(<ActiveRecording isOpen={true} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/Recording interrupted/i);
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
  });
});
