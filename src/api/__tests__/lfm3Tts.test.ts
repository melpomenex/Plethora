import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateLfm3Speech, getLfm3Status } from "../lfm3Tts";
import { invokeCommand, isNativeMobile } from "../../lib/tauri";
vi.mock("../../lib/tauri", () => ({ isTauri: () => true, isNativeMobile: vi.fn(() => false), invokeCommand: vi.fn() }));
const options = { text: "A short example.", voice: "female", language: "en", modelId: "installed-model" };
beforeEach(() => vi.clearAllMocks());
describe("LFM3 native bridge cancellation", () => {
  it("cancels the matching native request and rejects a stale successful reply", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(invokeCommand).mockImplementation((command) => command === "lfm3_tts_synthesize" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(undefined));
    const controller = new AbortController();
    const work = generateLfm3Speech({ ...options, signal: controller.signal });
    const request = vi.mocked(invokeCommand).mock.calls[0][1] as { requestId: string };
    controller.abort();
    expect(invokeCommand).toHaveBeenCalledWith("lfm3_tts_cancel", { requestId: request.requestId });
    finish({ audioData: "data:audio/wav;base64,stale", durationSec: 1, backend: "CPU" });
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
  });
  it("never dispatches an already aborted request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(generateLfm3Speech({ ...options, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(invokeCommand).not.toHaveBeenCalled();
  });
  it("reports mobile unavailability without loading a desktop sidecar", async () => {
    vi.mocked(isNativeMobile).mockReturnValueOnce(true);
    expect(await getLfm3Status()).toMatchObject({ available: false, loaded: false });
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});
