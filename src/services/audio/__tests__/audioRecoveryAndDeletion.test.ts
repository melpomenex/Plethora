import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioSourceKey, ResolvedAudioItem } from "../../../types/audioEdition";
import type { AudioEngine, AudioEngineEvents } from "../htmlAudioEngine";
import { GlobalAudioController } from "../globalAudioController";
import { AudioPlaybackPersistence } from "../audioPlaybackPersistence";
import { withAudioBoundaries } from "../audioCoordinates";
import { AudioPlaybackException } from "../audioErrors";
import { resetAudioRuntimeForTests, retireAudioForDeletedSource } from "../audioRuntime";
import { useAudioPlaybackStore } from "../../../stores/audioPlaybackStore";
import * as tauriLib from "../../../lib/tauri";

const makeKey = (
  sourceId: string,
  kind: AudioSourceKey["kind"] = "audiobook",
  profileKey = "test",
): AudioSourceKey => ({ sourceId, kind, profileKey });

function makeItem(
  sourceKey: AudioSourceKey,
  overrides: Partial<ResolvedAudioItem> = {},
): ResolvedAudioItem {
  return {
    sourceKey,
    title: `Title ${sourceKey.sourceId}`,
    mediaRevision: `rev-${sourceKey.sourceId}`,
    complete: true,
    parts: withAudioBoundaries([
      {
        partId: `${sourceKey.sourceId}-0`,
        sourceRevision: `rev-${sourceKey.sourceId}`,
        browserUrl: `https://cdn.example.test/${sourceKey.sourceId}.mp3`,
        durationSec: 120,
      },
    ]),
    ...overrides,
  };
}

function createHarness(
  resolveImpl?: (key: AudioSourceKey, signal: AbortSignal) => Promise<ResolvedAudioItem>,
) {
  const sample = { timeInPart: 0, durationSec: 120 as number | null, paused: true, seekable: true };
  const events: AudioEngineEvents[] = [];
  let nowMs = 1_000;
  const engine: AudioEngine = {
    sample: () => ({ ...sample }),
    load: vi.fn(async (_part, handlers) => {
      events.push(handlers);
    }),
    play: vi.fn(async () => {
      sample.paused = false;
    }),
    pause: vi.fn(async () => {
      sample.paused = true;
    }),
    seek: vi.fn(seconds => {
      sample.timeInPart = seconds;
    }),
    setRate: vi.fn(),
    setVolume: vi.fn(),
    unload: vi.fn(),
    dispose: vi.fn(),
  };
  const commit = vi.fn(async () => undefined);
  const resolve = vi.fn(resolveImpl ?? (async (key: AudioSourceKey) => makeItem(key)));
  let seq = 0;
  const controller = new GlobalAudioController({
    createEngine: () => engine,
    resolve,
    persistence: new AudioPlaybackPersistence({ commit }),
    now: () => nowMs,
    uuid: () => `session-${++seq}`,
  });
  return {
    controller,
    engine,
    events,
    sample,
    commit,
    resolve,
    advanceClock: (ms: number) => {
      nowMs += ms;
    },
  };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await resetAudioRuntimeForTests(null);
});

describe("Task 6.5 — expired URL refresh, bounded network retry, and source deletion retirement", () => {
  it("refreshes an expired podcast URL once at the exact coordinate and rejects unrelated feed items", async () => {
    let resolveCount = 0;
    const podcastKey = makeKey("ep-1", "podcast");
    const h = createHarness(async key => {
      resolveCount += 1;
      return makeItem(key, {
        mediaRevision: "guid-ep-1",
        parts: withAudioBoundaries([
          {
            partId: "ep-1",
            sourceRevision: "guid-ep-1",
            browserUrl:
              resolveCount === 1
                ? "https://cdn.example.test/ep-1.mp3?sig=expired"
                : "https://cdn.example.test/ep-1.mp3?sig=fresh",
            durationSec: 180,
          },
        ]),
      });
    });

    await h.controller.load(podcastKey, { intent: "play" });
    h.sample.timeInPart = 47;
    h.advanceClock(2_000);
    h.events.at(-1)!.sample(h.sample);

    // Mid-stream 403/expired URL fails once, then succeeds with refreshed URL at 47s.
    vi.mocked(h.engine.load).mockImplementationOnce(async (part, handlers) => {
      h.events.push(handlers);
      expect(part.browserUrl).toContain("sig=fresh");
    });
    h.events.at(-1)!.error(new AudioPlaybackException("expired_url", "HTTP 403 Forbidden"));

    await vi.waitFor(() => {
      expect(h.controller.getSnapshot()).toMatchObject({
        state: "playing",
        playIntent: true,
        positionSec: 47,
      });
    });
    expect(resolveCount).toBe(2);

    // A second expiry on the same generation does NOT loop infinitely; surfaces Episode unavailable.
    h.events.at(-1)!.error(new AudioPlaybackException("expired_url", "HTTP 403 Forbidden again"));
    await vi.waitFor(() => {
      expect(h.controller.getSnapshot()).toMatchObject({
        state: "error",
        playIntent: false,
        error: { code: "expired_url", message: "Episode unavailable" },
      });
    });
    expect(resolveCount).toBe(2);
    await h.controller.dispose();
  });

  it("refuses to overwrite an expired podcast URL when re-resolution returns a mismatched mediaRevision", async () => {
    const podcastKey = makeKey("ep-mismatch", "podcast");
    let calls = 0;
    const h = createHarness(async key => {
      calls += 1;
      return makeItem(key, {
        mediaRevision: calls === 1 ? "guid-original" : "guid-different-feed-item",
      });
    });
    vi.mocked(h.engine.load).mockRejectedValueOnce(
      new AudioPlaybackException("expired_url", "Signed URL expired"),
    );

    await expect(h.controller.load(podcastKey, { intent: "play" })).rejects.toMatchObject({
      code: "expired_url",
      message: "Episode unavailable",
    });
    expect(calls).toBe(2);
    expect(h.controller.getSnapshot()).toMatchObject({
      state: "error",
      playIntent: false,
      error: { code: "expired_url", message: "Episode unavailable" },
    });
    await h.controller.dispose();
  });

  it("retries network interruptions at 1/2/4/8/15s while playIntent holds and cancels immediately on pause", async () => {
    vi.useFakeTimers();
    const h = createHarness();
    await h.controller.load(makeKey("stream-1", "podcast"), { intent: "play" });
    h.sample.timeInPart = 33;
    h.advanceClock(2_000);
    h.events.at(-1)!.sample(h.sample);

    // Fail first two retries (1s, 2s), succeed on third retry (4s).
    vi.mocked(h.engine.load)
      .mockRejectedValueOnce(new AudioPlaybackException("network", "offline 1"))
      .mockRejectedValueOnce(new AudioPlaybackException("network", "offline 2"))
      .mockImplementationOnce(async (_part, handlers) => {
        h.events.push(handlers);
      });

    h.events.at(-1)!.error(new AudioPlaybackException("network", "connection dropped"));
    expect(h.controller.getSnapshot()).toMatchObject({
      state: "buffering",
      playIntent: true,
      error: { code: "network" },
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.engine.load).toHaveBeenCalledTimes(2);
    expect(h.controller.getSnapshot()?.state).toBe("buffering");

    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.engine.load).toHaveBeenCalledTimes(3);
    expect(h.controller.getSnapshot()?.state).toBe("buffering");

    await vi.advanceTimersByTimeAsync(4_000);
    expect(h.engine.load).toHaveBeenCalledTimes(4);
    expect(h.controller.getSnapshot()).toMatchObject({
      state: "playing",
      playIntent: true,
      positionSec: 33,
    });
    expect(h.controller.getSnapshot()?.error).toBeUndefined();

    // Now drop network again, then user pauses before 1s retry fires -> retry must cancel!
    vi.mocked(h.engine.load).mockClear();
    h.events.at(-1)!.error(new AudioPlaybackException("network", "dropped again"));
    expect(h.controller.getSnapshot()?.state).toBe("buffering");

    await h.controller.pause("user");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.engine.load).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot()).toMatchObject({
      state: "paused",
      playIntent: false,
      pauseReason: "user",
    });

    await h.controller.dispose();
  });

  it("stops retrying after exhausting 1/2/4/8/15s network backoff and transitions to recoverable error", async () => {
    vi.useFakeTimers();
    const h = createHarness();
    await h.controller.load(makeKey("stream-2", "podcast"), { intent: "play" });

    vi.mocked(h.engine.load).mockRejectedValue(new AudioPlaybackException("network", "still offline"));
    h.events.at(-1)!.error(new AudioPlaybackException("network", "dropped"));

    for (const delay of [1_000, 2_000, 4_000, 8_000, 15_000]) {
      expect(h.controller.getSnapshot()?.state).toBe("buffering");
      await vi.advanceTimersByTimeAsync(delay);
    }

    expect(h.controller.getSnapshot()).toMatchObject({
      state: "error",
      playIntent: false,
      error: { code: "network", message: "still offline" },
    });
    await h.controller.dispose();
  });

  it("releases file handles before document/recording deletion, prunes queue without autoplay, and surfaces Audio removed", async () => {
    const order: string[] = [];
    const releaseActive = vi.fn(() => {
      order.push("release-active-handle");
    });
    const keyA = makeKey("doc-a", "audiobook");
    const keyB = makeKey("doc-b", "audiobook");
    const h = createHarness(async key =>
      makeItem(key, {
        documentId: key.sourceId,
        release: key.sourceId === "doc-a" ? releaseActive : undefined,
      }),
    );

    await resetAudioRuntimeForTests(h.controller);
    await h.controller.load(keyA, { intent: "play", queue: [keyA, keyB] });

    // 1. Deleting queued item B prunes queue without interrupting playing item A.
    const prunedOutcome = await retireAudioForDeletedSource(key => key.sourceId === "doc-b");
    expect(prunedOutcome).toBe("queue_pruned");
    expect(h.controller.getSnapshot()).toMatchObject({
      sourceKey: keyA,
      state: "playing",
      playIntent: true,
      queue: [keyA],
    });
    expect(useAudioPlaybackStore.getState().controlError).toBe("Audio removed");

    // Reload with [A, B] and delete active document A via documents.deleteDocument API.
    await h.controller.load(keyA, { intent: "play", queue: [keyA, keyB] });
    vi.spyOn(tauriLib, "isTauri").mockReturnValue(true);
    vi.spyOn(tauriLib, "invokeCommand").mockImplementation((async (cmd: string) => {
      if (cmd === "delete_document") order.push("invoke-delete-document");
      return undefined;
    }) as typeof tauriLib.invokeCommand);

    const { deleteDocument } = await import("../../../api/documents");
    await deleteDocument("doc-a");

    expect(order).toEqual(["release-active-handle", "invoke-delete-document"]);
    expect(h.engine.unload).toHaveBeenCalled();
    // Active item retired and next item B did NOT auto-play!
    expect(h.controller.getSnapshot()).toBeNull();
    expect(useAudioPlaybackStore.getState().controlError).toBe("Audio removed");
  });
});
