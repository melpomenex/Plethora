import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingStatusStrip } from "../RecordingStatusStrip";
import { useRecordingSessionStore } from "../../../stores/recordingSessionStore";
import { useUIStore } from "../../../stores/uiStore";

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

describe("RecordingStatusStrip (Global Persistent Status Bar)", () => {
  beforeEach(() => {
    useUIStore.setState({ activeRecordingOpen: false });
    useRecordingSessionStore.setState({
      state: "recording",
      health: {
        acknowledgedMs: 14000,
        pendingBytes: 0,
        state: "recording",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders when recording is active and minimized", () => {
    render(<RecordingStatusStrip />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Recording")).toBeInTheDocument();
    expect(screen.getByText(/Saved through 00:14/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open/i })).toBeInTheDocument();
  });

  it("clicking Open sets activeRecordingOpen to true", () => {
    render(<RecordingStatusStrip />);

    const openBtn = screen.getByRole("button", { name: /Open/i });
    fireEvent.click(openBtn);

    expect(useUIStore.getState().activeRecordingOpen).toBe(true);
  });

  it("is hidden when activeRecordingOpen is true or when capture is idle", () => {
    const { rerender } = render(<RecordingStatusStrip />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    // Dialog is opened
    act(() => {
      useUIStore.setState({ activeRecordingOpen: true });
    });
    rerender(<RecordingStatusStrip />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // State becomes idle
    act(() => {
      useUIStore.setState({ activeRecordingOpen: false });
      useRecordingSessionStore.setState({ state: "idle" });
    });
    rerender(<RecordingStatusStrip />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders paused and interrupted states truthfully", () => {
    act(() => {
      useRecordingSessionStore.setState({ state: "paused" });
    });
    const { rerender } = render(<RecordingStatusStrip />);
    expect(screen.getByText("Paused")).toBeInTheDocument();

    act(() => {
      useRecordingSessionStore.setState({ state: "interrupted" });
    });
    rerender(<RecordingStatusStrip />);
    expect(screen.getByText("Interrupted")).toBeInTheDocument();
  });
});
