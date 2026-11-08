import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GlobalAudioController } from "../services/audio/globalAudioController";
import { AudioPlaybackPersistence } from "../services/audio/audioPlaybackPersistence";
import type { AudioSourceKey, ResolvedAudioItem } from "../types/audioEdition";
import type { AudioEngine, AudioEngineEvents } from "../services/audio/htmlAudioEngine";
import { withAudioBoundaries } from "../services/audio/audioCoordinates";

const key = (sourceId: string): AudioSourceKey => ({ sourceId, kind: "podcast", profileKey: "test" });

function item(sourceId: string): ResolvedAudioItem {
  return {
    sourceKey: key(sourceId),
    title: sourceId,
    mediaRevision: "v1",
    complete: true,
    parts: withAudioBoundaries([
      { partId: "0", sourceRevision: "v1", browserUrl: `/test/${sourceId}/0.mp3`, durationSec: 600 }
    ]),
  };
}

function setup() {
  const sample = { timeInPart: 0, durationSec: 600 as number | null, paused: true, seekable: true };
  const events: AudioEngineEvents[] = [];
  const engine: AudioEngine = {
    sample: () => ({ ...sample }),
    load: vi.fn(async (_part, handlers) => {
      events.push(handlers);
      sample.timeInPart = 0;
    }),
    play: vi.fn(async () => { sample.paused = false; }),
    pause: vi.fn(async () => { sample.paused = true; }),
    seek: vi.fn(seconds => { sample.timeInPart = seconds; }),
    setRate: vi.fn(),
    setVolume: vi.fn(),
    unload: vi.fn(),
    dispose: vi.fn(),
  };
  const commit = vi.fn(async () => undefined);
  const createEngine = vi.fn(() => engine);
  const resolve = vi.fn(async (source: AudioSourceKey) => item(source.sourceId));
  let id = 0;
  const controller = new GlobalAudioController({
    createEngine,
    resolve,
    persistence: new AudioPlaybackPersistence({ commit }),
    uuid: () => `session-${++id}`,
  });
  return { controller, engine, events, sample, commit, createEngine };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Podcast Ad Playback & Lookahead Integration", () => {
  it("clamps pre-roll ad interval starting at 0:00 to interval end on initial load", async () => {
    const h = setup();
    h.controller.setPolicyIntervals([
      {
        id: "ad-preroll",
        category: "external_ad",
        startSec: 0,
        endSec: 30.0,
      },
    ]);

    await h.controller.load(key("ep-1"), { intent: "play", explicitPosition: 0.0 });

    // Initial seek should be clamped past pre-roll: 30.0 + 0.050s = 30.05
    expect(h.engine.seek).toHaveBeenCalledWith(30.05);
  });

  it("triggers 120ms lookahead skip with volume muting before entering ad interval", async () => {
    const h = setup();
    h.controller.setPolicyIntervals([
      {
        id: "ad-midroll",
        category: "external_ad",
        startSec: 120.0,
        endSec: 180.0,
      },
    ]);

    await h.controller.load(key("ep-1"), { intent: "play", explicitPosition: 100.0 });
    const ev = h.events.at(-1)!;

    // Simulate playhead approaching boundary at 119.900s (within 120ms lookahead)
    ev.sample({ timeInPart: 119.900, durationSec: 600, paused: false, seekable: true });

    // Muting volume during seek
    expect(h.engine.setVolume).toHaveBeenCalledWith(0);
    // Scheduled seek to interval end: 180.0
    await vi.waitFor(() => {
      expect(h.engine.seek).toHaveBeenCalledWith(180);
    });

    // Volume restored post-seek
    await vi.waitFor(() => {
      expect(h.engine.setVolume).toHaveBeenLastCalledWith(1);
    });

    // Policy skip recorded in snapshot
    const snap = h.controller.getSnapshot();
    expect(snap?.policySkip?.id).toBe("ad-midroll");
    expect(snap?.policySkip?.category).toBe("external_ad");
  });

  it("supports undoing a skip via bypassPolicyInterval and seeking back", async () => {
    const h = setup();
    h.controller.setPolicyIntervals([
      {
        id: "ad-midroll",
        category: "external_ad",
        startSec: 120.0,
        endSec: 180.0,
      },
    ]);

    await h.controller.load(key("ep-1"), { intent: "play", explicitPosition: 100.0 });
    const ev = h.events.at(-1)!;

    // Skip happens
    ev.sample({ timeInPart: 119.920, durationSec: 600, paused: false, seekable: true });
    expect(h.controller.getSnapshot()?.policySkip?.id).toBe("ad-midroll");

    // Listener clicks Undo: bypass the interval and seek back to ad start
    h.controller.bypassPolicyInterval("ad-midroll");
    await h.controller.seekTo(120.0);

    expect(h.engine.seek).toHaveBeenCalledWith(120.0);

    // Subsequent playback inside the bypassed ad interval is not re-skipped
    ev.sample({ timeInPart: 125.0, durationSec: 600, paused: false, seekable: true });
    expect(h.engine.seek).not.toHaveBeenCalledWith(180.05);
  });
});
