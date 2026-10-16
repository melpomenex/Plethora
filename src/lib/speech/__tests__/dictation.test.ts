import { afterEach, describe, expect, it, vi } from "vitest";
import { createDictationAdapter, DictationCoordinator } from "../dictation";
import { acquireAudioCapture } from "../captureOwner";
import type { DictationAdapter, DictationCapability } from "../contracts";
const cap: DictationCapability = { platform: "android", available: true, locale: "en-US", processing: "on-device", microphonePermission: "prompt" };
const args = { sessionId: "opaque", locale: "en-US", requireOnDevice: false, networkConsent: false };
function adapter(): DictationAdapter { return { status: vi.fn().mockResolvedValue(cap), start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue({ text: "final" }), cancel: vi.fn().mockResolvedValue(undefined) }; }
afterEach(() => { vi.useRealTimers(); });
describe("native-first dictation contract", () => {
  it.each(["android", "ios"])("routes %s only through its native bridge", async platform => {
    const invoke = vi.fn().mockResolvedValue({ ...cap, text: "words" });
    const transport = createDictationAdapter(platform, true, invoke);
    await transport.status("en-US"); await transport.start(args); await transport.stop("opaque"); await transport.cancel("opaque");
    const calls = invoke.mock.calls.map(call => call[0]);
    expect(calls).toHaveLength(4);
    expect(calls.every(command => String(command).startsWith(platform === "android" ? "plugin:plethora-android-speech|" : "plugin:plethora-apple-intelligence|"))).toBe(true);
    expect(JSON.stringify(invoke.mock.calls)).toContain("opaque");
    if (platform === "ios") expect(JSON.stringify(invoke.mock.calls)).toContain("composer-dictation");
  });
  it("does not substitute browser capture on unsupported native platforms or native failure", async () => {
    const unavailable = createDictationAdapter("macos", true);
    expect((await unavailable.status("en-US")).available).toBe(false);
    const invoke = vi.fn().mockRejectedValue(new Error("native unavailable"));
    await expect(createDictationAdapter("android", true, invoke).start(args)).rejects.toThrow("native unavailable");
    expect(invoke).toHaveBeenCalledOnce();
  });
  it("blocks system processing without disclosure or under strict local policy before capture", async () => {
    const coordinator = new DictationCoordinator(); const transport = adapter();
    for (const options of [args, { ...args, requireOnDevice: true, networkConsent: true }]) {
      await expect(coordinator.start(transport, options, { ...cap, processing: "system-service" })).rejects.toThrow("unavailable");
    }
    expect(transport.start).not.toHaveBeenCalled();
  });
  it("respects another composer and lecture owner without displacing either", async () => {
    const coordinator = new DictationCoordinator(); const transport = adapter();
    const lecture = acquireAudioCapture();
    await expect(coordinator.start(transport, args, cap)).rejects.toThrow("busy"); lecture();
    await coordinator.start(transport, args, cap);
    await expect(coordinator.start(transport, { ...args, sessionId: "second" }, cap)).rejects.toThrow("busy");
    expect(transport.start).toHaveBeenCalledOnce(); await coordinator.cancel(args.sessionId);
  });
  it("deduplicates Stop and returns one final result", async () => {
    const coordinator = new DictationCoordinator(); const transport = adapter(); await coordinator.start(transport, args, cap);
    const first = coordinator.stop(args.sessionId); const duplicate = coordinator.stop(args.sessionId);
    expect(first).toBe(duplicate); expect(await first).toEqual({ text: "final" }); expect(transport.stop).toHaveBeenCalledOnce();
  });
  it("bounds initialization and rejects a late native readiness callback", async () => {
    vi.useFakeTimers(); const coordinator = new DictationCoordinator(); const transport = adapter();
    let ready!: () => void; vi.mocked(transport.start).mockReturnValue(new Promise(resolve => { ready = resolve; }));
    const result = coordinator.start(transport, args, cap); const assertion = expect(result).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(10_000); await assertion; ready(); await Promise.resolve(); expect(transport.cancel).toHaveBeenCalledWith(args.sessionId);
  });
  it("bounds finalization and keeps cancelled callbacks from delivering", async () => {
    vi.useFakeTimers(); const coordinator = new DictationCoordinator(); const transport = adapter();
    vi.mocked(transport.stop).mockReturnValue(new Promise(() => {})); await coordinator.start(transport, args, cap);
    const result = coordinator.stop(args.sessionId); const assertion = expect(result).rejects.toThrow("timeout"); await vi.advanceTimersByTimeAsync(5_000); await assertion;
    const next = adapter(); let final!: (value: { text: string }) => void; vi.mocked(next.stop).mockReturnValue(new Promise(resolve => { final = resolve; }));
    await coordinator.start(next, args, cap); const stopped = coordinator.stop(args.sessionId); const cancelled = expect(stopped).rejects.toThrow("cancelled"); await coordinator.cancel(args.sessionId); final({ text: "late" }); await cancelled;
  });
  it("no speech is typed failure and does not retain microphone ownership", async () => {
    const coordinator = new DictationCoordinator(); const transport = adapter(); vi.mocked(transport.stop).mockResolvedValue({ text: " " });
    await coordinator.start(transport, args, cap); await expect(coordinator.stop(args.sessionId)).rejects.toThrow("no-speech");
    const lease = acquireAudioCapture(); lease();
  });
});
