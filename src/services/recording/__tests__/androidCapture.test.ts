import { describe, expect, it, vi } from "vitest";
import {
  ANDROID_SPEECH_COMMANDS,
  getAndroidCaptureCapabilities,
  isAndroidCaptureAvailable,
  startAndroidCapture,
} from "../androidCapture";

describe("androidCapture adapter", () => {
  it("detects off-platform when not in Android environment", () => {
    expect(isAndroidCaptureAvailable()).toBe(false);
  });

  it("probes capabilities via plugin recording_status", async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      platform: "android",
      available: true,
      pause: true,
      background: true,
      liveCaptions: false,
      state: "idle",
      acknowledgedMs: 0,
      pendingBytes: 0,
    });

    const caps = await getAndroidCaptureCapabilities(mockInvoke);
    expect(caps.available).toBe(true);
    expect(caps.pause).toBe(true);
    expect(caps.background).toBe(true);
    expect(caps.liveCaptions).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith(ANDROID_SPEECH_COMMANDS.status, {});
  });

  it("handles plugin error when probing capabilities", async () => {
    const mockInvoke = vi.fn().mockRejectedValue(new Error("Plugin not loaded"));
    const caps = await getAndroidCaptureCapabilities(mockInvoke);
    expect(caps.available).toBe(false);
    expect(caps.reason).toContain("Plugin not loaded");
  });

  it("starts recording and manages pause, resume, and finish lifecycle", async () => {
    const invocations: { cmd: string; args: unknown }[] = [];
    const stateChanges: string[] = [];

    const mockInvoke = vi.fn().mockImplementation(async (cmd: string, args: unknown) => {
      invocations.push({ cmd, args });
      if (cmd === ANDROID_SPEECH_COMMANDS.start) {
        return {
          ok: true,
          sessionId: "sess-1",
          assetId: "asset-1",
          writerEpoch: "epoch-1",
        };
      }
      if (cmd === ANDROID_SPEECH_COMMANDS.pause) {
        return { ok: true, state: "paused", acknowledgedMs: 5000 };
      }
      if (cmd === ANDROID_SPEECH_COMMANDS.resume) {
        return { ok: true, state: "recording" };
      }
      if (cmd === ANDROID_SPEECH_COMMANDS.finish) {
        return {
          assetId: "asset-1",
          incomplete: false,
          acknowledgedMs: 12000,
          partsCount: 3,
          totalBytes: 384132,
        };
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const handle = await startAndroidCapture({
      sessionId: "sess-1",
      assetId: "asset-1",
      writerEpoch: "epoch-1",
      sampleRate: 16000,
      channels: 1,
      onStateChange: (state) => stateChanges.push(state),
      invokeFn: mockInvoke,
    });

    expect(handle.sessionId).toBe("sess-1");
    expect(handle.writerEpoch).toBe("epoch-1");
    expect(stateChanges).toEqual(["requesting-permission", "recording"]);

    // Pause
    await handle.pause();
    expect(stateChanges).toContain("paused");
    // Duplicate pause is idempotent
    await handle.pause();

    // Resume
    await handle.resume();
    expect(stateChanges[stateChanges.length - 1]).toBe("recording");

    // Finish
    const finishRes = await handle.finish();
    expect(finishRes.assetId).toBe("asset-1");
    expect(finishRes.incomplete).toBe(false);
    expect(stateChanges[stateChanges.length - 1]).toBe("saved");

    // Duplicate finish returns cached result
    const finishRes2 = await handle.finish();
    expect(finishRes2.assetId).toBe("asset-1");
  });

  it("transitions to failed when start throws an error", async () => {
    const stateChanges: string[] = [];
    const mockInvoke = vi.fn().mockRejectedValue(new Error("Microphone permission denied"));

    await expect(
      startAndroidCapture({
        sessionId: "sess-2",
        writerEpoch: "epoch-2",
        onStateChange: (state) => stateChanges.push(state),
        invokeFn: mockInvoke,
      })
    ).rejects.toThrow("Microphone permission denied");

    expect(stateChanges).toEqual(["requesting-permission", "failed"]);
  });
});
