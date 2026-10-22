import { describe, expect, it, vi } from "vitest";
import {
  APPLE_RECORDING_COMMANDS,
  getAppleCaptureCapabilities,
  isAppleCaptureAvailable,
  startAppleCapture,
} from "../appleCapture";

describe("appleCapture adapter", () => {
  it("detects off-platform when not in Apple environment", () => {
    expect(isAppleCaptureAvailable()).toBe(false);
  });

  it("probes capabilities via plugin recording_status", async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      platform: "apple",
      available: true,
      pause: true,
      background: false, // foreground-only per D2
      liveCaptions: false,
      state: "idle",
      acknowledgedMs: 0,
      pendingBytes: 0,
    });

    const caps = await getAppleCaptureCapabilities(mockInvoke);
    expect(caps.available).toBe(true);
    expect(caps.pause).toBe(true);
    expect(caps.background).toBe(false);
    expect(caps.liveCaptions).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith(APPLE_RECORDING_COMMANDS.status, {});
  });

  it("handles plugin error when probing capabilities", async () => {
    const mockInvoke = vi.fn().mockRejectedValue(new Error("Plugin not loaded"));
    const caps = await getAppleCaptureCapabilities(mockInvoke);
    expect(caps.available).toBe(false);
    expect(caps.reason).toContain("Plugin not loaded");
  });

  it("reports a certified background capability only when the native build exposes it", async () => {
    const foregroundOnly = await getAppleCaptureCapabilities(
      vi.fn().mockResolvedValue({
        platform: "ios",
        available: true,
        pause: true,
        background: false,
        liveCaptions: false,
        state: "idle",
        acknowledgedMs: 0,
        pendingBytes: 0,
      })
    );
    expect(foregroundOnly.background).toBe(false);

    // This hypothetical response represents a build that has passed the D12
    // certification gate. The adapter must not hard-code false; it reports
    // exactly what the native bridge proves.
    const certifiedBuild = await getAppleCaptureCapabilities(
      vi.fn().mockResolvedValue({
        platform: "ios",
        available: true,
        pause: true,
        background: true,
        liveCaptions: false,
        state: "idle",
        acknowledgedMs: 0,
        pendingBytes: 0,
      })
    );
    expect(certifiedBuild.background).toBe(true);
  });

  it("starts recording and manages pause, resume, and finish lifecycle", async () => {
    const invocations: { cmd: string; args: unknown }[] = [];
    const stateChanges: string[] = [];

    const mockInvoke = vi.fn().mockImplementation(async (cmd: string, args: unknown) => {
      invocations.push({ cmd, args });
      if (cmd === APPLE_RECORDING_COMMANDS.start) {
        return {
          ok: true,
          sessionId: "sess-apple-1",
          assetId: "asset-apple-1",
          writerEpoch: "epoch-1",
        };
      }
      if (cmd === APPLE_RECORDING_COMMANDS.pause) {
        return { ok: true, state: "paused", acknowledgedMs: 5000 };
      }
      if (cmd === APPLE_RECORDING_COMMANDS.resume) {
        return { ok: true, state: "recording" };
      }
      if (cmd === APPLE_RECORDING_COMMANDS.finish) {
        return {
          assetId: "asset-apple-1",
          incomplete: false,
          acknowledgedMs: 10000,
          partsCount: 2,
          totalBytes: 320088,
        };
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const handle = await startAppleCapture({
      sessionId: "sess-apple-1",
      assetId: "asset-apple-1",
      writerEpoch: "epoch-1",
      sampleRate: 16000,
      channels: 1,
      onStateChange: (state) => stateChanges.push(state),
      invokeFn: mockInvoke,
    });

    expect(handle.sessionId).toBe("sess-apple-1");
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
    expect(finishRes.assetId).toBe("asset-apple-1");
    expect(finishRes.incomplete).toBe(false);
    expect(stateChanges[stateChanges.length - 1]).toBe("saved");
  });

  it("nests recording args under the Rust `payload` envelope", async () => {
    const calls: { cmd: string; args: unknown }[] = [];
    const mockInvoke = vi.fn().mockImplementation(async (cmd: string, args: unknown) => {
      calls.push({ cmd, args });
      if (cmd === APPLE_RECORDING_COMMANDS.start) {
        return { ok: true, sessionId: "sess-1", assetId: "asset-1", writerEpoch: "epoch-1" };
      }
      if (cmd === APPLE_RECORDING_COMMANDS.pause) {
        return { ok: true, state: "paused", acknowledgedMs: 0 };
      }
      if (cmd === APPLE_RECORDING_COMMANDS.resume) {
        return { ok: true, state: "recording" };
      }
      return {
        assetId: "asset-1",
        incomplete: false,
        acknowledgedMs: 0,
        partsCount: 1,
        totalBytes: 1,
      };
    });

    const handle = await startAppleCapture({
      sessionId: "sess-1",
      writerEpoch: "epoch-1",
      invokeFn: mockInvoke,
    });
    await handle.pause();
    await handle.resume();
    await handle.finish();

    expect(calls.map((call) => call.cmd)).toEqual([
      APPLE_RECORDING_COMMANDS.start,
      APPLE_RECORDING_COMMANDS.pause,
      APPLE_RECORDING_COMMANDS.resume,
      APPLE_RECORDING_COMMANDS.finish,
    ]);
    expect(calls[0].args).toEqual({
      payload: {
        sessionId: "sess-1",
        assetId: "",
        writerEpoch: "epoch-1",
        sampleRate: 16000,
        channels: 1,
      },
    });
    for (const call of calls.slice(1)) {
      expect(call.args).toMatchObject({ payload: { sessionId: "sess-1", writerEpoch: "epoch-1" } });
    }
  });

  it("transitions to failed state when start throws", async () => {
    const stateChanges: string[] = [];
    const mockInvoke = vi.fn().mockRejectedValue(new Error("Microphone permission denied"));

    await expect(
      startAppleCapture({
        sessionId: "sess-fail",
        writerEpoch: "epoch-1",
        onStateChange: (s) => stateChanges.push(s),
        invokeFn: mockInvoke,
      })
    ).rejects.toThrow("Microphone permission denied");

    expect(stateChanges).toContain("failed");
  });
});
