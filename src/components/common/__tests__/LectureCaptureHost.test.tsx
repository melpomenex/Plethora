import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LectureCaptureHost, LECTURE_CAPTURE_EVENT } from "../LectureCaptureHost";
import { acquireAudioCapture } from "../../../lib/speech/captureOwner";

const fixture = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("../../../lib/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../Toast", () => ({ ToastType: { Error: "error", Success: "success" }, useToastStore: (select: (state: unknown) => unknown) => select({ addToast: fixture.addToast }) }));
vi.mock("../../../lib/ai/android/lectureCapture", () => ({ persistLectureRecording: vi.fn(), saveLectureDocument: vi.fn() }));
vi.mock("../../../lib/ai/android/speechProvider", () => ({ getAndroidSpeechProvider: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("a rejected second start preserves the pending owner's lease and discard stops late permission results", async () => {
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
