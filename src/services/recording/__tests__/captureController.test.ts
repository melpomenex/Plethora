import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireAudioCapture,
  getCurrentCaptureOwner,
  resetCaptureOwnerForTesting,
} from "../../../lib/speech/captureOwner";
import { useRecordingSessionStore } from "../../../stores/recordingSessionStore";
import { CaptureController } from "../captureController";

// Mock adapters
const mockDesktopHandle = {
  sessionId: "test-sess",
  writerEpoch: "ep-1",
  pause: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
  finish: vi.fn().mockResolvedValue({ assetId: "asset-1", incomplete: false }),
};

vi.mock("../desktopCapture", () => ({
  isDesktopCaptureAvailable: () => true,
  getDesktopCaptureCapabilities: async () => ({
    available: true,
    pause: true,
    background: true,
    liveCaptions: false,
  }),
  startDesktopCapture: vi.fn().mockImplementation(async (opts) => {
    return {
      ...mockDesktopHandle,
      sessionId: opts.sessionId,
      writerEpoch: opts.writerEpoch,
    };
  }),
}));

vi.mock("../androidCapture", () => ({
  isAndroidCaptureAvailable: () => false,
  getAndroidCaptureCapabilities: async () => ({
    available: false,
    pause: false,
    background: false,
    liveCaptions: false,
  }),
  startAndroidCapture: vi.fn(),
}));

vi.mock("../appleCapture", () => ({
  isAppleCaptureAvailable: () => false,
  getAppleCaptureCapabilities: async () => ({
    available: false,
    pause: false,
    background: false,
    liveCaptions: false,
  }),
  startAppleCapture: vi.fn(),
}));

vi.mock("../../../api/recordingSessions", () => ({
  isRecordingPersistenceAvailable: () => true,
  createRecordingSession: vi.fn().mockResolvedValue({ id: "test-sess", version: 1 }),
  finalizeRecordingSession: vi.fn().mockResolvedValue({ id: "test-sess", version: 2 }),
  recoverRecordingSession: vi.fn().mockResolvedValue({
    sessionId: "test-sess",
    verifiedParts: [{ sequence: 0, byteLength: 160000 }],
    totalDurationMs: 10000,
  }),
}));

describe("CaptureController", () => {
  let controller: CaptureController;

  beforeEach(() => {
    resetCaptureOwnerForTesting();
    useRecordingSessionStore.getState().reset();
    vi.clearAllMocks();
    controller = new CaptureController();
  });

  it("starts recording and acquires microphone lease", async () => {
    const handle = await controller.start({ sessionId: "sess-1" });
    expect(handle).toBeDefined();
    expect(controller.state).toBe("recording");
    expect(controller.activeSessionId).toBe("sess-1");

    // Microphone owner should be recorded as "recording"
    const owner = getCurrentCaptureOwner();
    expect(owner).not.toBeNull();
    expect(owner?.owner).toBe("recording");
    expect(owner?.sessionId).toBe("sess-1");
  });

  it("handles double-start idempotently without restarting capture", async () => {
    const firstHandle = await controller.start({ sessionId: "sess-double" });
    const secondHandle = await controller.start({ sessionId: "sess-double" });

    // Should return the exact same handle
    expect(secondHandle).toBe(firstHandle);
    expect(controller.state).toBe("recording");
  });

  it("fails when composer or another owner holds the microphone lease", async () => {
    // Composer acquires microphone first
    const composerRelease = acquireAudioCapture({ owner: "composer" });

    // Starting recording should fail with busy and transition to failed
    await expect(controller.start({ sessionId: "sess-busy" })).rejects.toThrow("busy:");
    expect(controller.state).toBe("failed");
    expect(useRecordingSessionStore.getState().error?.code).toBe("CaptureBusy");

    // Existing composer owner should NOT be displaced
    expect(getCurrentCaptureOwner()?.owner).toBe("composer");
    composerRelease();
  });

  it("deduplicates concurrent finish calls to drain exactly once", async () => {
    await controller.start({ sessionId: "sess-finish" });
    expect(controller.state).toBe("recording");

    const finish1 = controller.finish();
    const finish2 = controller.finish();

    expect(finish1).toBe(finish2); // Same promise
    const result = await finish1;
    expect(result.assetId).toBe("asset-1");
    expect(controller.state).toBe("saved");

    // Microphone lease should be released
    expect(getCurrentCaptureOwner()).toBeNull();
  });

  it("handles external interruption safely without discarding audio", async () => {
    await controller.start({ sessionId: "sess-interrupt" });
    expect(controller.state).toBe("recording");

    // Incoming phone call / audio interruption occurs
    controller.handleInterruption("incoming_call");
    expect(controller.state).toBe("interrupted");

    // Microphone lease is released so incoming call can proceed
    expect(getCurrentCaptureOwner()).toBeNull();

    // Now resume / continue recording creates a new part
    const newHandle = await controller.continueCapture();
    expect(newHandle).toBeDefined();
    expect(controller.state).toBe("recording");
    expect(getCurrentCaptureOwner()?.owner).toBe("recording");
  });

  it("ignores stale native callbacks from prior epochs", async () => {
    const { startDesktopCapture } = await import("../desktopCapture");
    let onHealthCallback!: (health: any) => void;
    vi.mocked(startDesktopCapture).mockImplementationOnce(async (opts: any) => {
      onHealthCallback = opts.onHealthChange;
      return {
        ...mockDesktopHandle,
        sessionId: opts.sessionId,
        writerEpoch: opts.writerEpoch,
      };
    });

    await controller.start({ sessionId: "sess-stale" });

    // Valid callback updates health
    onHealthCallback({ acknowledgedMs: 5000, pendingBytes: 0 });
    expect(useRecordingSessionStore.getState().health.acknowledgedMs).toBe(5000);

    // Stop and restart with new epoch
    await controller.finish();
    await controller.start({ sessionId: "sess-stale-2" });

    // Calling the old callback should be dropped
    onHealthCallback({ acknowledgedMs: 999999, pendingBytes: 0 });
    expect(useRecordingSessionStore.getState().health.acknowledgedMs).toBe(0);
  });

  it("rehydrates recoverable sessions on restart", async () => {
    useRecordingSessionStore.getState().setActiveSession("test-sess");
    useRecordingSessionStore.getState().setState("idle");

    await controller.rehydrate();
    expect(useRecordingSessionStore.getState().state).toBe("recoverable");
    expect(useRecordingSessionStore.getState().health.acknowledgedMs).toBe(10000);
  });
});
