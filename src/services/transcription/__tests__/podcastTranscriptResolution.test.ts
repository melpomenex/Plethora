import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPodcastTranscript } from "../../../api/podcast";
import { podcastTranscriptState, startPodcastTranscriptionOnce } from "../podcastTranscriptResolution";

const backend = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../../lib/tauri", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/tauri")>(),
  isTauri: () => true,
  invokeCommand: backend.invoke,
}));

const missing = { text: "", status: "none", segments: [] };
const saved = {
  text: "Saved words", status: "done", segments: [{
    start_ms: 1200, end_ms: 2400, text: "Saved words",
    word_timings_json: '[{"word":"Saved","start_ms":1200,"end_ms":1800}]',
  }],
};

describe("podcast transcript resolution and guarded starts", () => {
  beforeEach(() => backend.invoke.mockReset().mockResolvedValue(missing));

  it("preserves saved segment and word timings through the actual API", async () => {
    backend.invoke.mockResolvedValue(saved);
    const result = await getPodcastTranscript("saved");
    expect(podcastTranscriptState(result)).toBe("ready");
    expect(result.segments[0]).toEqual({
      start: 1.2, end: 2.4, text: "Saved words",
      wordTimings: [{ word: "Saved", start_ms: 1200, end_ms: 1800 }],
    });
    const start = vi.fn();
    await startPodcastTranscriptionOnce("saved", start, () => true);
    expect(start).not.toHaveBeenCalled();
  });

  it("serializes two viewers and a remount until a provider run finishes", async () => {
    let finish: () => void;
    const provider = new Promise<void>((resolve) => { finish = resolve; });
    const start = vi.fn(() => provider);
    const first = startPodcastTranscriptionOnce("concurrent", start, () => true);
    const second = startPodcastTranscriptionOnce("concurrent", start, () => true);
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    const remounted = startPodcastTranscriptionOnce("concurrent", start, () => true);
    expect(first).toBe(second);
    expect(remounted).toBe(first);
    backend.invoke.mockResolvedValue(saved);
    finish!();
    await first;
    await startPodcastTranscriptionOnce("concurrent", start, () => true);
    expect(start).toHaveBeenCalledOnce();
  });

  it.each(["pending", "transcribing", "downloading", "processing", "unavailable", "done", "error"])(
    "does not automatically start when persisted state is %s", async (status) => {
      backend.invoke.mockResolvedValue({ ...missing, status, progress: 49 });
      const start = vi.fn();
      await startPodcastTranscriptionOnce(`state-${status}`, start, () => true);
      expect(start).not.toHaveBeenCalled();
      expect((await getPodcastTranscript("episode")).progress).toBe(49);
    },
  );

  it("does not mistake a rejected lookup for an absent transcript", async () => {
    backend.invoke.mockRejectedValueOnce(new Error("Storage unavailable"));
    const start = vi.fn();
    await expect(startPodcastTranscriptionOnce("failure", start, () => true)).rejects.toThrow("Storage unavailable");
    expect(start).not.toHaveBeenCalled();
  });

  it("drops a start when navigation changes the media identity during lookup", async () => {
    let resolveLookup: (value: typeof missing) => void;
    backend.invoke.mockReturnValue(new Promise((resolve) => { resolveLookup = resolve; }));
    let current = true;
    const start = vi.fn();
    const pending = startPodcastTranscriptionOnce("old-item", start, () => current);
    current = false;
    resolveLookup!(missing);
    await pending;
    expect(start).not.toHaveBeenCalled();
  });

  it("rechecks completion at the start boundary", async () => {
    expect(podcastTranscriptState(await getPodcastTranscript("race"))).toBe("missing");
    backend.invoke.mockResolvedValue(saved);
    const start = vi.fn();
    await startPodcastTranscriptionOnce("race", start, () => true);
    expect(start).not.toHaveBeenCalled();
  });

  it("lets a remounted viewer finish a lookup abandoned by the first viewer", async () => {
    let finishLookup: (value: typeof missing) => void;
    backend.invoke.mockReturnValueOnce(new Promise((resolve) => { finishLookup = resolve; }));
    let mounted = true;
    const oldStart = vi.fn();
    const currentStart = vi.fn(async () => {});
    const first = startPodcastTranscriptionOnce("remount-during-lookup", oldStart, () => mounted);
    mounted = false;
    const second = startPodcastTranscriptionOnce("remount-during-lookup", currentStart, () => true);
    finishLookup!(missing);
    await Promise.all([first, second]);
    expect(oldStart).not.toHaveBeenCalled();
    expect(currentStart).toHaveBeenCalledOnce();
  });
});
