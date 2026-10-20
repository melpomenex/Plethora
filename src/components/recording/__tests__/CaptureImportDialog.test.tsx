import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureImportDialog, LECTURE_CAPTURE_EVENT } from "../CaptureImportDialog";
import { captureController } from "../../../services/recording/captureController";
import { useUIStore } from "../../../stores/uiStore";
import { resetCaptureOwnerForTesting } from "../../../lib/speech/captureOwner";

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("../../../stores/collectionStore", () => ({
  useCollectionStore: (selector: (s: any) => any) =>
    selector({
      collections: [
        { id: "col-default", name: "Default Collection", icon: "📁" },
        { id: "col-history", name: "History 101", icon: "🏛️" },
      ],
      activeCollectionId: "col-default",
    }),
}));

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (s: any) => any) =>
    selector({
      settings: {
        audioTranscription: {
          mode: "On device",
          autoTranscription: false,
        },
      },
    }),
}));

describe("CaptureImportDialog (Screen 1 Entry Surface)", () => {
  beforeEach(() => {
    useUIStore.setState({
      captureImportDialogOpen: false,
      captureImportInitialRoute: undefined,
      activeRecordingOpen: false,
      lectureCaptureRequested: false,
    });
  });

  afterEach(() => {
    resetCaptureOwnerForTesting();
    vi.restoreAllMocks();
  });

  it("renders with 4 unified routes and title input", () => {
    render(<CaptureImportDialog isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText("Capture & Import")).toBeInTheDocument();
    expect(screen.getByText("Record Audio")).toBeInTheDocument();
    expect(screen.getByText("Import Recording")).toBeInTheDocument();
    expect(screen.getByText("Import Transcript")).toBeInTheDocument();
    expect(screen.getByText("Import Supported URL")).toBeInTheDocument();
  });

  it("switches routes and displays corresponding route details", () => {
    render(<CaptureImportDialog isOpen={true} onClose={vi.fn()} />);

    // Switch to Import Transcript
    fireEvent.click(screen.getByText("Import Transcript"));
    expect(
      screen.getByText("You can study a transcript without audio.")
    ).toBeInTheDocument();

    // Switch to Import Supported URL
    fireEvent.click(screen.getByText("Import Supported URL"));
    expect(screen.getByPlaceholderText("https://...")).toBeInTheDocument();

    // Switch to Import Recording
    fireEvent.click(screen.getByText("Import Recording"));
    expect(screen.getByText("Audio or video file")).toBeInTheDocument();
  });

  it("starts recording successfully, closes dialog, and opens active recording surface", async () => {
    const startSpy = vi
      .spyOn(captureController, "start")
      .mockResolvedValue({} as any);

    render(<CaptureImportDialog isOpen={true} onClose={vi.fn()} initialRoute="record" />);

    const startBtn = screen.getByRole("button", { name: /Start Recording/i });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "lecture",
      })
    );
    expect(useUIStore.getState().activeRecordingOpen).toBe(true);
  });

  it("handles permission denial gracefully with an alert and retry action without looping", async () => {
    const startSpy = vi
      .spyOn(captureController, "start")
      .mockRejectedValueOnce(new Error("PermissionDenied: microphone not allowed"));

    render(<CaptureImportDialog isOpen={true} onClose={vi.fn()} initialRoute="record" />);

    const startBtn = screen.getByRole("button", { name: /Start Recording/i });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(startSpy).toHaveBeenCalledTimes(1);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Microphone access was denied/i);

    // Clicking retry attempts start once more
    startSpy.mockResolvedValueOnce({} as any);
    const retryBtn = screen.getByRole("button", { name: /Retry/i });
    await act(async () => {
      fireEvent.click(retryBtn);
    });

    expect(startSpy).toHaveBeenCalledTimes(2);
    expect(useUIStore.getState().activeRecordingOpen).toBe(true);
  });

  it("opens via plethora:record-lecture event into record route without duplicate delivery", () => {
    render(<CaptureImportDialog />);

    expect(useUIStore.getState().captureImportDialogOpen).toBe(false);

    // Dispatch legacy alias event
    act(() => {
      window.dispatchEvent(new CustomEvent(LECTURE_CAPTURE_EVENT));
    });

    expect(useUIStore.getState().captureImportDialogOpen).toBe(true);
    expect(useUIStore.getState().captureImportInitialRoute).toBe("record");
  });

  it("preserves focus restoration to previously focused element upon close", async () => {
    const prevButton = document.createElement("button");
    prevButton.textContent = "Previous Element";
    document.body.appendChild(prevButton);
    prevButton.focus();
    expect(document.activeElement).toBe(prevButton);

    const { unmount } = render(<CaptureImportDialog isOpen={true} onClose={vi.fn()} />);

    unmount();
    await waitFor(() => {
      expect(document.activeElement).toBe(prevButton);
    });
    document.body.removeChild(prevButton);
  });
});
