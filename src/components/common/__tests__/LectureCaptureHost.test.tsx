import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LectureCaptureHost, LECTURE_CAPTURE_EVENT } from "../LectureCaptureHost";
import { acquireAudioCapture, resetCaptureOwnerForTesting } from "../../../lib/speech/captureOwner";
import * as recordingSessionsApi from "../../../api/recordingSessions";
import * as desktopCaptureService from "../../../services/recording/desktopCapture";

const fixture = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("../../../lib/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../Toast", () => ({
  ToastType: { Error: "error", Success: "success", Warning: "warning" },
  useToastStore: (select: (state: unknown) => unknown) => select({ addToast: fixture.addToast }),
}));
vi.mock("../../../lib/ai/android/lectureCapture", () => ({
  persistLectureRecording: vi.fn(),
  saveLectureDocument: vi.fn(),
}));
vi.mock("../../../lib/ai/android/speechProvider", () => ({ getAndroidSpeechProvider: vi.fn() }));
vi.mock("../../../api/recordingSessions", () => ({
  createRecordingSession: vi.fn(),
  isRecordingPersistenceAvailable: vi.fn(),
}));
vi.mock("../../../services/recording/desktopCapture", () => ({
  startDesktopCapture: vi.fn(),
}));

afterEach(() => {
  resetCaptureOwnerForTesting();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("a rejected second start preserves the pending owner's lease and discard stops late permission results", async () => {
  vi.mocked(recordingSessionsApi.isRecordingPersistenceAvailable).mockReturnValue(false);
  let resolveStream!: (stream: MediaStream) => void;
  const getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => { resolveStream = resolve; }));
  vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia } });
  render(<LectureCaptureHost />);
  fireEvent(window, new Event(LECTURE_CAPTURE_EVENT));
  const start = screen.getByRole("button", { name: "onDeviceAi.lectureStart" });
  fireEvent.click(start);
  fireEvent.click(start);
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(fixture.addToast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("busy:") }));
  expect(() => acquireAudioCapture()).toThrow("busy:");

  fireEvent.click(screen.getByRole("button", { name: "onDeviceAi.cancel" }));
  const nextOwner = acquireAudioCapture();
  const stop = vi.fn();
  await act(async () => { resolveStream({ getTracks: () => [{ stop }] } as unknown as MediaStream); });
  expect(stop).toHaveBeenCalledOnce();
  expect(() => acquireAudioCapture()).toThrow("busy:");
  nextOwner();
});

it("displays actionable warning toast on incomplete lecture save", async () => {
  vi.mocked(recordingSessionsApi.isRecordingPersistenceAvailable).mockReturnValue(true);
  vi.mocked(recordingSessionsApi.createRecordingSession).mockResolvedValue({
    id: "sess-incomplete",
    version: 1,
  } as any);

  const mockHandle = {
    finish: vi.fn().mockResolvedValue({ incomplete: true }),
  };
  vi.mocked(desktopCaptureService.startDesktopCapture).mockResolvedValue(mockHandle as any);

  const stream = { getTracks: () => [{ stop: vi.fn() }] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia } });

  render(<LectureCaptureHost />);
  fireEvent(window, new Event(LECTURE_CAPTURE_EVENT));

  const start = screen.getByRole("button", { name: "onDeviceAi.lectureStart" });
  await act(async () => {
    fireEvent.click(start);
  });

  const stopBtn = screen.getByRole("button", { name: "onDeviceAi.lectureStop" });
  await act(async () => {
    fireEvent.click(stopBtn);
  });

  expect(mockHandle.finish).toHaveBeenCalled();
  expect(fixture.addToast).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "warning",
      message: "onDeviceAi.lectureSavedIncomplete",
    })
  );
});

it("displays actionable error toast when downstream capture finish fails and retains audio", async () => {
  vi.mocked(recordingSessionsApi.isRecordingPersistenceAvailable).mockReturnValue(true);
  vi.mocked(recordingSessionsApi.createRecordingSession).mockResolvedValue({
    id: "sess-err",
    version: 1,
  } as any);

  const mockHandle = {
    finish: vi.fn().mockRejectedValue(new Error("Disk write failed")),
  };
  vi.mocked(desktopCaptureService.startDesktopCapture).mockResolvedValue(mockHandle as any);

  const stream = { getTracks: () => [{ stop: vi.fn() }] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia } });

  render(<LectureCaptureHost />);
  fireEvent(window, new Event(LECTURE_CAPTURE_EVENT));

  const start = screen.getByRole("button", { name: "onDeviceAi.lectureStart" });
  await act(async () => {
    fireEvent.click(start);
  });

  const stopBtn = screen.getByRole("button", { name: "onDeviceAi.lectureStop" });
  await act(async () => {
    fireEvent.click(stopBtn);
  });

  expect(mockHandle.finish).toHaveBeenCalled();
  expect(fixture.addToast).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "error",
      message: expect.stringContaining("Disk write failed"),
    })
  );
});
