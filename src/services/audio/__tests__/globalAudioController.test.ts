import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioSourceKey, ResolvedAudioItem } from "../../../types/audioEdition";
import type { AudioEngine, AudioEngineEvents } from "../htmlAudioEngine";
import { GlobalAudioController } from "../globalAudioController";
import { AudioPlaybackPersistence } from "../audioPlaybackPersistence";
import { locateAudioPosition, withAudioBoundaries } from "../audioCoordinates";
import { AudioOutputFocus } from "../audioFocus";

const key = (sourceId: string): AudioSourceKey => ({ sourceId, kind: "audiobook", profileKey: "test" });
function item(sourceId: string): ResolvedAudioItem {
  return { sourceKey: key(sourceId), title: sourceId, mediaRevision: "v1", complete: true, parts: withAudioBoundaries([0, 1].map(index => ({ partId: String(index), sourceRevision: "v1", browserUrl: `/test/${sourceId}/${index}.mp3`, durationSec: 60 }))) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
}
function setup(resolve = vi.fn(async (source: AudioSourceKey) => item(source.sourceId)), beforePlay?: () => Promise<{ isCurrent: () => boolean }>, engineOverrides: Partial<AudioEngine> = {}) {
  const sample = { timeInPart: 0, durationSec: 60 as number | null, paused: true, seekable: true };
  const events: AudioEngineEvents[] = [];
  const engine: AudioEngine = {
    sample: () => ({ ...sample }),
    load: vi.fn(async (_part, handlers) => { events.push(handlers); sample.timeInPart = 0; }),
    play: vi.fn(async () => { sample.paused = false; }),
    pause: vi.fn(async () => { sample.paused = true; }),
    seek: vi.fn(seconds => { sample.timeInPart = seconds; }),
    setRate: vi.fn(), setVolume: vi.fn(), unload: vi.fn(), dispose: vi.fn(),
    ...engineOverrides,
  };
  const commit = vi.fn(async () => undefined);
  const createEngine = vi.fn(() => engine);
  let id = 0;
  const controller = new GlobalAudioController({ createEngine, resolve, beforePlay, persistence: new AudioPlaybackPersistence({ commit }), uuid: () => `session-${++id}` });
  return { controller, engine, events, sample, commit, createEngine };
}
afterEach(() => { vi.useRealTimers(); });

describe("global audio authority", () => {
  it("advances an explicit queue once after its final part without any source subscriber", async () => {
    const h = setup();
    await h.controller.load(key("A"), { intent: "play", queue: [key("A"), key("B")] });
    await h.controller.selectChapter(1);
    const ended = h.events.at(-1)!;
    ended.ended(); ended.ended();
    await vi.waitFor(() => expect(h.controller.getSnapshot()).toMatchObject({ sourceKey: key("B"), state: "playing", partIndex: 0 }));
    expect(h.createEngine).toHaveBeenCalledTimes(1);
    expect(h.engine.load).toHaveBeenCalledTimes(3);
    ended.ended();
    await Promise.resolve();
    expect(h.engine.load).toHaveBeenCalledTimes(3);
    expect(h.controller.getSnapshot()?.queue).toEqual([key("A"), key("B")]);
    await h.controller.dispose();
  });

  it("keeps queue skips separate from chapters and preserves paused intent", async () => {
    const h = setup();
    await h.controller.load(key("A"), { intent: "paused", queue: [key("A"), key("B")] });
    await h.controller.selectChapter(1);
    expect(h.controller.getSnapshot()?.sourceKey.sourceId).toBe("A");
    expect(h.controller.getSnapshot()).toMatchObject({ state: "paused", playIntent: false, partIndex: 1 });
    await h.controller.queueNext();
    expect(h.controller.getSnapshot()).toMatchObject({ sourceKey: key("B"), state: "paused", playIntent: false, partIndex: 0 });
    await h.controller.queuePrevious();
    expect(h.controller.getSnapshot()?.sourceKey.sourceId).toBe("A");
    await h.controller.dispose();
  });

  it("retains an owner sleep deadline across a queue transition and blocks advancement at its boundary", async () => {
    vi.useFakeTimers();
    const h = setup();
    await h.controller.load(key("A"), { intent: "play", queue: [key("A"), key("B")] });
    const deadline = Date.now() + 1000;
    h.controller.setSleepTimer(deadline);
    await h.controller.queueNext();
    expect(h.controller.getSnapshot()?.sleepDeadlineMs).toBe(deadline);
    await vi.advanceTimersByTimeAsync(1000);
    h.events.at(-1)!.ended();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.controller.getSnapshot()).toMatchObject({ sourceKey: key("B"), playIntent: false, pauseReason: "sleep" });
    await h.controller.dispose();
  });

  it("rejects foreign or duplicate queues before mutating a playing source", async () => {
    const h = setup();
    await h.controller.load(key("A"), { intent: "play" });
    await expect(h.controller.load(key("B"), { intent: "play", queue: [key("B"), { ...key("C"), profileKey: "foreign" }] })).rejects.toThrow("identity");
    await expect(h.controller.load(key("B"), { intent: "play", queue: [key("B"), key("B")] })).rejects.toThrow("duplicate");
    expect(h.controller.getSnapshot()).toMatchObject({ sourceKey: key("A"), state: "playing" });
    await h.controller.dispose();
  });
  it("retains a paused source when its transition checkpoint cannot be saved and retries before closing", async () => {
    vi.useFakeTimers();
    const h = setup();
    await h.controller.load(key("A"), { intent: "play" });
    h.sample.timeInPart = 12;
    h.events.at(-1)!.sample(h.sample);
    h.commit.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(h.controller.stopAndClose()).rejects.toThrow("unsaved");
    expect(h.engine.unload).not.toHaveBeenCalled();
    expect(h.sample.paused).toBe(true);
    expect(h.controller.getSnapshot()?.sourceKey.sourceId).toBe("A");
    await h.controller.stopAndClose();
    expect(h.controller.getSnapshot()).toBeNull();
    await h.controller.dispose();
  });
  it("creates one decoder on duplicate initialize, reattaches without restoring, and uses fresh incarnations", async () => {
    const { controller, createEngine, engine } = setup();
    controller.initialize(); controller.initialize();
    const unsubscribe = controller.subscribe(vi.fn());
    await controller.load(key("A"), { intent: "play" });
    const first = controller.getSnapshot()!.metadata.sessionId;
    unsubscribe();
    await controller.load(key("A"), { intent: "play" });
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()!.state).toBe("playing");
    await controller.stopAndClose();
    await controller.load(key("A"), { intent: "paused" });
    expect(controller.getSnapshot()!.metadata.sessionId).not.toBe(first);
    await controller.dispose();
  });

  it("keeps explicit Play and Pause idempotent and rejects stale incarnation commands", async () => {
    const { controller, engine } = setup();
    await controller.load(key("A"), { intent: "play" });
    const snapshot = controller.getSnapshot()!;
    await controller.play(); await controller.play();
    expect(engine.play).toHaveBeenCalledTimes(1);
    await controller.pause(); await controller.pause();
    expect(controller.getSnapshot()!.state).toBe("paused");
    const result = await controller.command({ schemaVersion: 1, sessionId: "retired", generation: snapshot.generation, requestId: "stale", action: { command: "play" } });
    expect(result.disposition).toBe("stale");
    await controller.dispose();
  });

  it("discards late B resolution and late A events after A/B/C takeover", async () => {
    const delayedB = deferred<ResolvedAudioItem>();
    const resolver = vi.fn((source: AudioSourceKey) => source.sourceId === "B" ? delayedB.promise : Promise.resolve(item(source.sourceId)));
    const { controller, events, engine, sample, commit } = setup(resolver);
    await controller.load(key("A"), { intent: "play" });
    sample.timeInPart = 29;
    const b = controller.load(key("B"), { intent: "play" });
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledWith(key("B"), expect.any(AbortSignal)));
    await controller.load(key("C"), { intent: "play" });
    delayedB.resolve(item("B"));
    await b;
    events[0].ended(); events[0].sample({ ...sample, timeInPart: 50 });
    await Promise.resolve();
    expect(controller.getSnapshot()!.sourceKey.sourceId).toBe("C");
    expect(controller.getSnapshot()!.positionSec).toBe(0);
    expect(engine.load).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ sourceKey: key("A"), positionSec: 29 }));
    await controller.dispose();
  });

  it("never starts a new source when the old decoder fails to acknowledge pause", async () => {
    const { controller, engine } = setup();
    await controller.load(key("A"), { intent: "play" });
    vi.mocked(engine.pause).mockRejectedValueOnce(new Error("device busy"));
    await expect(controller.load(key("B"), { intent: "play" })).rejects.toThrow("device busy");
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(engine.play).toHaveBeenCalledTimes(1);
    await controller.play();
    expect(controller.getSnapshot()).toMatchObject({ sourceKey: key("A"), state: "playing", generation: 3 });
    expect(engine.load).toHaveBeenCalledTimes(2);
    await controller.dispose();
  });

  it("bounds failed pause acknowledgement and prevents overlap on timeout", async () => {
    vi.useFakeTimers();
    const { controller, engine } = setup();
    await controller.load(key("A"), { intent: "play" });
    vi.mocked(engine.pause).mockImplementationOnce(() => new Promise(() => undefined));
    const takeover = expect(controller.load(key("B"), { intent: "play" })).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(2000);
    await takeover;
    expect(engine.play).toHaveBeenCalledTimes(1);
    await controller.dispose();
  });

  it("seeks across known boundaries while paused, and applies sleep before part advance", async () => {
    vi.useFakeTimers();
    const { controller, sample, events, engine } = setup();
    await controller.load(key("A"), { intent: "paused" });
    await controller.seekTo(50);
    await controller.seekRelative(30);
    expect(controller.getSnapshot()).toMatchObject({ partIndex: 1, timeInPart: 20, positionSec: 80, state: "paused" });
    expect(engine.play).not.toHaveBeenCalled();
    await controller.selectChapter(0);
    await controller.play();
    controller.setSleepTimer(Date.now() + 1000);
    await vi.advanceTimersByTimeAsync(1000);
    sample.timeInPart = 60;
    events.at(-1)!.ended();
    await Promise.resolve();
    expect(controller.getSnapshot()).toMatchObject({ partIndex: 0, state: "paused", pauseReason: "sleep" });
    await controller.dispose();
  });

  it("deduplicates concurrent command receipts while keeping distinct relative seeks", async () => {
    const { controller } = setup();
    await controller.load(key("A"), { intent: "paused" });
    const snapshot = controller.getSnapshot()!;
    const request = { schemaVersion: 1 as const, requestId: "one", sessionId: snapshot.metadata.sessionId, generation: snapshot.generation, action: { command: "seekRelative" as const, value: 10 } };
    const results = await Promise.all([controller.command(request), controller.command(request)]);
    expect(results.map(result => result.disposition)).toEqual(["accepted", "duplicate"]);
    await controller.command({ ...request, requestId: "two" });
    expect(controller.getSnapshot()!.positionSec).toBe(20);
    await controller.dispose();
  });

  it("does not autoplay after Pause during metadata loading or after Stop during resolution", async () => {
    const { controller, engine } = setup();
    const ready = deferred<void>();
    vi.mocked(engine.load).mockImplementationOnce(() => ready.promise);
    const loading = controller.load(key("A"), { intent: "play" });
    await vi.waitFor(() => expect(engine.load).toHaveBeenCalledTimes(1));
    const paused = controller.pause();
    ready.resolve();
    await Promise.all([loading, paused]);
    expect(engine.play).not.toHaveBeenCalled();
    await controller.dispose();
    const resolved = deferred<ResolvedAudioItem>();
    const second = setup(vi.fn(() => resolved.promise));
    const request = second.controller.load(key("A"), { intent: "play" });
    await vi.waitFor(() => expect(second.controller.getSnapshot()?.state).toBe("loading"));
    await second.controller.stopAndClose();
    const release = vi.fn();
    resolved.resolve({ ...item("A"), release });
    await request;
    expect(second.engine.play).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(second.controller.getSnapshot()).toBeNull();
    await second.controller.dispose();
  });

  it("waits for a retired play promise and pause before making the next source audible", async () => {
    const { controller, engine, sample } = setup();
    await controller.load(key("A"), { intent: "paused" });
    const playing = deferred<void>();
    vi.mocked(engine.play).mockImplementationOnce(async () => { await playing.promise; sample.paused = false; });
    const first = controller.play();
    await vi.waitFor(() => expect(engine.play).toHaveBeenCalledTimes(1));
    const next = controller.load(key("B"), { intent: "play" });
    expect(engine.load).toHaveBeenCalledTimes(1);
    playing.resolve();
    await Promise.all([first, next]);
    expect(controller.getSnapshot()).toMatchObject({ sourceKey: key("B"), state: "playing" });
    expect(engine.load).toHaveBeenCalledTimes(2);
    await controller.dispose();
  });

  it("writes at most twelve periodic checkpoints per playing minute and none unchanged paused", async () => {
    vi.useFakeTimers();
    const { controller, sample, commit } = setup();
    await controller.load(key("A"), { intent: "play" });
    for (let index = 1; index <= 12; index++) {
      sample.timeInPart = index * 4;
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(commit).toHaveBeenCalledTimes(12);
    await controller.pause();
    const count = commit.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(commit).toHaveBeenCalledTimes(count);
    await controller.dispose();
  });

  it("retains exact local position after unknown-length parts without fabricating global progress", async () => {
    const { controller, sample, commit } = setup(vi.fn(async source => ({ ...item(source.sourceId), parts: withAudioBoundaries([{ partId: "stream", sourceRevision: "v1", durationSec: null, browserUrl: "/stream" }, { partId: "chapter", sourceRevision: "v1", durationSec: 60, browserUrl: "/chapter" }]) })));
    sample.durationSec = null;
    await controller.load(key("A"), { intent: "paused" });
    await controller.selectChapter(1);
    await controller.seekRelative(20);
    expect(controller.getSnapshot()).toMatchObject({ partIndex: 1, timeInPart: 20, globalPositionSec: null, capabilities: { canSeekAbsolute: false } });
    await expect(controller.seekTo(60)).rejects.toThrow("Absolute seek unavailable");
    expect(commit).toHaveBeenLastCalledWith(expect.objectContaining({ partIndex: 1, timeInPart: 20, positionSec: null }));
    await controller.dispose();
    await controller.dispose();
  });

  it("enables seeking when seekability arrives after metadata without a second restore", async () => {
    const { controller, sample, events, engine } = setup();
    sample.seekable = false;
    await controller.load(key("A"), { intent: "paused", explicitPosition: 30 });
    expect(controller.getSnapshot()!.capabilities.canSeekAbsolute).toBe(false);
    const seeks = vi.mocked(engine.seek).mock.calls.length;
    sample.seekable = true;
    events[0].sample({ ...sample });
    expect(controller.getSnapshot()!.capabilities.canSeekAbsolute).toBe(true);
    expect(engine.seek).toHaveBeenCalledTimes(seeks);
    expect(controller.getSnapshot()!.positionSec).toBe(30);
    await controller.dispose();
  });

  it("keeps rate and volume across same-profile takeover and validates controls", async () => {
    const { controller, engine } = setup();
    await controller.load(key("A"), { intent: "paused" });
    await controller.setRate(1.75);
    await controller.setVolume(0.4);
    await controller.load(key("B"), { intent: "paused" });
    expect(controller.getSnapshot()).toMatchObject({ playbackRate: 1.75, volume: 0.4 });
    expect(engine.setRate).toHaveBeenLastCalledWith(1.75);
    expect(engine.setVolume).toHaveBeenLastCalledWith(0.4);
    await expect(controller.setRate(Infinity)).rejects.toThrow("Invalid playback rate");
    await expect(controller.setVolume(-1)).rejects.toThrow("Invalid playback volume");
    await controller.dispose();
  });

  it("allows speech to revoke media and media to return without focus queue deadlock or automatic resume", async () => {
    const focus = new AudioOutputFocus();
    const data = setup(undefined, () => focus.acquire("media", () => data.controller.pauseForFocus()));
    await data.controller.load(key("A"), { intent: "play" });
    const speech = await focus.acquire("speech", vi.fn());
    expect(data.controller.getSnapshot()).toMatchObject({ state: "paused", pauseReason: "focus" });
    speech.release();
    expect(data.engine.play).toHaveBeenCalledTimes(1);
    await data.controller.play();
    expect(data.controller.getSnapshot()!.state).toBe("playing");
    const pendingSpeech = focus.acquire("speech", vi.fn()).catch(() => null);
    const explicitPlay = data.controller.play();
    await Promise.all([pendingSpeech, explicitPlay]);
    expect(data.controller.getSnapshot()!.state).toBe("playing");
    await data.controller.dispose();
  });

  it("appends newly synthesized Audio Edition sections via refreshManifest without reloading or seeking the active part", async () => {
    const editionKey: AudioSourceKey = { sourceId: "ed-live", kind: "audio_edition", profileKey: "test" };
    let readyCount = 1;
    const resolve = vi.fn(async (): Promise<ResolvedAudioItem> => ({
      sourceKey: editionKey,
      title: "Live Edition",
      editionId: "ed-live",
      mediaRevision: "rev-1",
      complete: readyCount >= 2,
      parts: withAudioBoundaries(
        Array.from({ length: readyCount }, (_, idx) => ({
          partId: `sec-${idx}`,
          sourceRevision: `c-${idx}`,
          browserUrl: `blob:sec-${idx}`,
          durationSec: 40,
        })),
      ),
    }));
    const h = setup(resolve);
    await h.controller.load(editionKey, { intent: "play" });
    h.sample.timeInPart = 19;
    h.events.at(-1)!.sample(h.sample);
    expect(h.controller.getSnapshot()?.capabilities.canNext).toBe(false);
    const loadsBefore = vi.mocked(h.engine.load).mock.calls.length;
    const seeksBefore = vi.mocked(h.engine.seek).mock.calls.length;

    readyCount = 2;
    await h.controller.refreshManifest();

    expect(h.engine.load).toHaveBeenCalledTimes(loadsBefore);
    expect(h.engine.seek).toHaveBeenCalledTimes(seeksBefore);
    expect(h.controller.getSnapshot()).toMatchObject({
      state: "playing",
      partIndex: 0,
      durationSec: 100,
    });
    expect(h.controller.getSnapshot()?.capabilities.canNext).toBe(true);

    // Ending part 0 seamlessly advances into newly appended part 1
    h.events.at(-1)!.ended();
    await vi.waitFor(() => expect(h.controller.getSnapshot()).toMatchObject({ partIndex: 1, state: "playing" }));
    await h.controller.dispose();
  });

  it("ducks engine volume for hands-free feedback without mutating saved volume or overwriting a newer generation", async () => {
    vi.useFakeTimers();
    const h = setup();
    await h.controller.load(key("A"), { intent: "play" });
    await h.controller.setVolume(0.8);
    vi.mocked(h.engine.setVolume).mockClear();

    // Rapid captures must not compound-multiply ducking below 0.8 * 0.25 = 0.2
    h.controller.duckForFeedback(0.25, 700);
    h.controller.duckForFeedback(0.25, 700);
    expect(h.controller.getSnapshot()?.volume).toBe(0.8);
    expect(vi.mocked(h.engine.setVolume).mock.calls.at(-1)?.[0]).toBeCloseTo(0.2, 5);

    // Restores only while the same generation is still playing
    await vi.advanceTimersByTimeAsync(700);
    expect(vi.mocked(h.engine.setVolume).mock.calls.at(-1)?.[0]).toBeCloseTo(0.8, 5);

    // Ducking again and switching source before timer expires must never overwrite the new source's volume
    h.controller.duckForFeedback(0.25, 700);
    await h.controller.load(key("B"), { intent: "play" });
    await h.controller.setVolume(0.6);
    vi.mocked(h.engine.setVolume).mockClear();
    await vi.advanceTimersByTimeAsync(700);
    expect(h.engine.setVolume).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot()?.volume).toBe(0.6);
    await h.controller.dispose();
  });
});

describe("media coordinates", () => {
  it("supports over 24 hours, boundary equality, and unknown duration without invented offsets", () => {
    const parts = withAudioBoundaries([{ partId: "1", sourceRevision: "v1", durationSec: 90_000 }, { partId: "2", sourceRevision: "v1", durationSec: null }, { partId: "3", sourceRevision: "v1", durationSec: 60 }]);
    expect(locateAudioPosition(parts, 90_000)).toEqual({ partIndex: 1, timeInPart: 0 });
    expect(parts[2].globalStartSec).toBeNull();
    expect(() => locateAudioPosition(parts, NaN)).toThrow();
    expect(() => locateAudioPosition(parts, Infinity)).toThrow();
  });
});

describe("owner-lifetime processing and source policy", () => {
  afterEach(() => vi.useRealTimers());

  it("applies sponsor policy intervals in original global coordinates once", async () => {
    const h = setup();
    await h.controller.load(key("A"), { intent: "play" });
    h.controller.setPolicyIntervals?.([
      { id: "sponsor-1", category: "sponsor", startSec: 30, endSec: 45 },
      { id: "invalid", category: "sponsor", startSec: 70, endSec: 60 },
    ]);
    const events = h.events.at(-1)!;
    events.sample({ timeInPart: 31, durationSec: 60, paused: false, seekable: true });
    await vi.waitFor(() => expect(h.controller.getSnapshot()?.policySkip).toMatchObject({ id: "sponsor-1", fromSec: 30, toSec: 45 }));
    await vi.waitFor(() => expect(h.sample.timeInPart).toBe(45));
    const published = h.controller.getSnapshot()!.revision;

    // Replaying the same interval never jumps twice.
    events.sample({ timeInPart: 31, durationSec: 60, paused: false, seekable: true });
    await Promise.resolve();
    expect(h.controller.getSnapshot()!.revision).toBe(published);
    // A different source clears the source policy.
    await h.controller.load(key("B"), { intent: "paused" });
    events.sample({ timeInPart: 31, durationSec: 60, paused: false, seekable: true });
    expect(h.controller.getSnapshot()?.sourceKey.sourceId).toBe("B");
    expect(h.controller.getSnapshot()?.policySkip).toBeUndefined();
    await h.controller.dispose();
  });

  it("reports truthful volume-boost and silence-skip capability from the engine", async () => {
    const setVolumeBoost = vi.fn(() => true);
    const sampleAmplitude = vi.fn(() => 0);
    const h = setup(undefined, undefined, { setVolumeBoost, sampleAmplitude });
    await h.controller.load(key("A"), { intent: "paused" });
    expect(h.controller.getSnapshot()?.capabilities).toMatchObject({ canBoostVolume: true, canSkipSilence: true });
    expect(await h.controller.setVolumeBoost?.(true)).toBe(true);
    expect(setVolumeBoost).toHaveBeenCalledWith(true);

    const unsupported = setup();
    await unsupported.controller.load(key("A"), { intent: "paused" });
    expect(unsupported.controller.getSnapshot()?.capabilities.canBoostVolume).toBe(false);
    expect(await unsupported.controller.setVolumeBoost?.(true)).toBe(false);
    await unsupported.controller.dispose();
    await h.controller.dispose();
  });

  it("skips sustained silence only while playing and the monitor is enabled", async () => {
    vi.useFakeTimers();
    const sampleAmplitude = vi.fn(() => 0);
    const h = setup(undefined, undefined, { sampleAmplitude });
    await h.controller.load(key("A"), { intent: "play" });
    expect(await h.controller.setSilenceSkip?.(true)).toBe(true);
    await vi.advanceTimersByTimeAsync(700);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(h.engine.seek)).toHaveBeenCalled();
    const seekCount = vi.mocked(h.engine.seek).mock.calls.length;
    await h.controller.pause("user");
    await vi.advanceTimersByTimeAsync(1200);
    expect(vi.mocked(h.engine.seek).mock.calls.length).toBe(seekCount);
    await h.controller.dispose();
  });
});
