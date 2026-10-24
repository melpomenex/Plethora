import { afterEach, expect, it, vi } from "vitest";
import { NativeAudioAdapter } from "../nativeAudioAdapter";
import type { DeferredStudyCapture } from "../deferredStudyCapture";
import type { AudioCommandRequest, AudioPlaybackSnapshot, AudioSourceKey } from "../../../types/audioEdition";

const key = (sourceId: string): AudioSourceKey => ({ profileKey: "test", kind: "audiobook", sourceId });
function snapshot(sourceId = "A", generation = 1, revision = 1, ownerSequence = 1): AudioPlaybackSnapshot {
  return { schemaVersion: 1, sourceKey: key(sourceId), metadata: { sourceId, sourceKind: "audiobook", sessionId: `session-${sourceId}`, title: sourceId }, ownerEpoch: `owner-${ownerSequence}`, ownerSequence, generation, revision, state: "paused", playIntent: false, pauseReason: "user", partIndex: 0, timeInPart: 40, globalPositionSec: 40, positionSec: 40, durationSec: 100, playbackRate: 1, volume: 1, sleepDeadlineMs: null, mediaRevision: "v1", checkpointSequence: 1, updatedAt: 1, capabilities: { canPlay: true, canPause: true, canResume: true, canSeekRelative: true, canSeekAbsolute: true, precisePosition: true, canNext: false, canPrevious: false } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function harness(initial: AudioPlaybackSnapshot | null = null, extra: Partial<ConstructorParameters<typeof NativeAudioAdapter>[0]> = {}) {
  let live = initial;
  let observer: (value: unknown) => void = () => undefined;
  let id = 0;
  const beforePlay = vi.fn(async (): Promise<{ isCurrent: () => boolean }> => ({ isCurrent: () => true }));
  const observed = vi.fn((listener: (value: unknown) => void) => { observer = listener; return vi.fn(); });
  const call = vi.fn(async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (name.endsWith("get_audio_snapshot")) return { schemaVersion: 1, generationFloor: live?.generation ?? 0, snapshot: live };
    if (name === "reconcile_native_audio_journal") return { schemaVersion: 1, snapshot: live, importedCheckpoints: [] };
    if (name === "resolve_native_audio_source") return { schemaVersion: 1, authorizationId: (args.sourceKey as AudioSourceKey).sourceId };
    if (name.endsWith("load_audio")) { live = snapshot(String(args.authorizationId), Number(args.generation)); return { disposition: "accepted", snapshot: live }; }
    if (name.endsWith("audio_command")) {
      const request = args.request as AudioCommandRequest | null;
      if (request?.action.command === "stop") live = null;
      else if (live && request) live = { ...live, revision: live.revision + 1, playIntent: request.action.command === "play" };
      return { disposition: "accepted", snapshot: live };
    }
    throw new Error(`Unexpected command ${name}`);
  });
  const adapter = new NativeAudioAdapter({ isAndroid: () => true, call: call as never, observe: observed, beforePlay, uuid: () => `id-${++id}`, ...extra });
  return { adapter, call, observed, beforePlay, emit: (value: unknown) => observer(value), setLive: (value: AudioPlaybackSnapshot | null) => { live = value; } };
}
afterEach(() => vi.restoreAllMocks());

it("subscribes before reading service state and attaches without load or seek", async () => {
  const h = harness(snapshot("A", 4, 10));
  const original = h.call.getMockImplementation()!;
  h.call.mockImplementation(async (name, args) => {
    if (name.endsWith("get_audio_snapshot")) {
      expect(h.observed).toHaveBeenCalledTimes(1);
      h.emit(snapshot("A", 4, 12));
      return { schemaVersion: 1, generationFloor: 4, snapshot: snapshot("A", 4, 10) };
    }
    return original(name, args);
  });
  await h.adapter.reconnect("test");
  h.adapter.initialize();
  expect(h.adapter.getSnapshot()?.revision).toBe(12);
  expect(h.call.mock.calls.some(([name]) => name.endsWith("load_audio") || name === "resolve_native_audio_source" || name.endsWith("audio_command"))).toBe(false);
  expect(h.observed).toHaveBeenCalledTimes(1);
});

it("native queue progression replaces presentation metadata without another load or decoder URI", async () => {
  const h = harness(snapshot("A", 10));
  await h.adapter.reconnect("test");
  const item = { sourceKey: key("B"), title: "Second book", mediaRevision: "v1", complete: true, parts: [{ partId: "b", sourceRevision: "v1", globalStartSec: 0, durationSec: 100 }] };
  h.emit({ ...snapshot("B", 11, 20, 2), queue: [key("A"), key("B")], item });
  expect(h.adapter.getItem()).toEqual(item);
  expect(h.adapter.getSnapshot()?.sourceKey.sourceId).toBe("B");
  expect(h.adapter.getSnapshot()).not.toHaveProperty("item");
  expect(h.call.mock.calls.some(([name]) => name.endsWith("load_audio") || name === "resolve_native_audio_source")).toBe(false);
});

it("pauses and flushes before resolution and rejects out-of-order source capabilities", async () => {
  const h = harness(snapshot());
  await h.adapter.reconnect("test");
  h.call.mockClear();
  const b = deferred<unknown>();
  const original = h.call.getMockImplementation()!;
  h.call.mockImplementation((name, args) => name === "resolve_native_audio_source" && (args.sourceKey as AudioSourceKey).sourceId === "B" ? b.promise : original(name, args));
  const loadB = h.adapter.load(key("B"), { intent: "play" });
  await vi.waitFor(() => expect(h.call).toHaveBeenCalledWith("resolve_native_audio_source", expect.objectContaining({ sourceKey: key("B") })));
  expect(h.call.mock.calls.slice(0, 3).map(([name]) => name)).toEqual(["plugin:android-tts|audio_command", "reconcile_native_audio_journal", "resolve_native_audio_source"]);
  await h.adapter.load(key("C"), { intent: "paused" });
  b.resolve({ schemaVersion: 1, authorizationId: "B" });
  await loadB;
  const loads = h.call.mock.calls.filter(([name]) => name.endsWith("load_audio"));
  expect(loads.map(([, args]) => args.authorizationId)).toEqual(["C"]);
  expect(h.adapter.getSnapshot()?.sourceKey.sourceId).toBe("C");
  expect(h.beforePlay).not.toHaveBeenCalled();
});

it("Stop invalidates a pending source load and does not let it resurrect the service", async () => {
  const h = harness(snapshot());
  await h.adapter.reconnect("test");
  const resolve = deferred<unknown>();
  const original = h.call.getMockImplementation()!;
  h.call.mockImplementation((name, args) => name === "resolve_native_audio_source" ? resolve.promise : original(name, args));
  const load = h.adapter.load(key("B"), { intent: "play" });
  await vi.waitFor(() => expect(h.call).toHaveBeenCalledWith("resolve_native_audio_source", expect.anything()));
  await h.adapter.stopAndClose();
  resolve.resolve({ schemaVersion: 1, authorizationId: "B" });
  await load;
  expect(h.adapter.getSnapshot()).toBeNull();
  expect(h.call.mock.calls.filter(([name]) => name.endsWith("load_audio"))).toHaveLength(0);
});

it("orders observations by durable owner then generation and revision without transport replay", async () => {
  const h = harness(snapshot());
  await h.adapter.reconnect("test");
  h.emit(snapshot("B", 1, 2, 2));
  h.emit(snapshot("A", 100, 100, 1));
  h.emit(snapshot("B", 1, 1, 2));
  expect(h.adapter.getSnapshot()?.sourceKey.sourceId).toBe("B");
  h.emit({ schemaVersion: 1, ownerEpoch: "owner-2", ownerSequence: 2, generation: 2, revision: 3, snapshot: null });
  h.emit(snapshot("B", 1, 100, 2));
  expect(h.adapter.getSnapshot()).toBeNull();
  expect(h.call.mock.calls.filter(([name]) => name.endsWith("audio_command"))).toHaveLength(0);
});

it("a focus acquisition completing after Pause never sends Play", async () => {
  const h = harness(snapshot());
  await h.adapter.reconnect("test");
  const lease = deferred<{ isCurrent: () => boolean }>();
  h.beforePlay.mockImplementation(() => lease.promise);
  const play = h.adapter.play();
  await h.adapter.pause("focus");
  lease.resolve({ isCurrent: () => true });
  await play;
  const actions = h.call.mock.calls.filter(([name]) => name.endsWith("audio_command")).map(([, args]) => (args.request as AudioCommandRequest).action);
  expect(actions).toEqual([{ command: "pause", reason: "focus" }]);
});

it("refuses non-Android runtimes before observing or invoking native commands", () => {
  const observe = vi.fn();
  const call = vi.fn();
  const adapter = new NativeAudioAdapter({ isAndroid: () => false, observe, call, beforePlay: vi.fn(), uuid: () => "client" });
  expect(() => adapter.initialize()).toThrow("Android-only");
  expect(observe).not.toHaveBeenCalled();
  expect(call).not.toHaveBeenCalled();
});

it("stops a foreign live profile before attaching and never projects its metadata", async () => {
  const h = harness(snapshot());
  const original = h.call.getMockImplementation()!;
  let stopped = false;
  h.call.mockImplementation(async (name, args) => {
    if (name.endsWith("get_audio_snapshot") && args.profileKey === "new-account") {
      if (args.observing) expect(stopped).toBe(true);
      return { schemaVersion: 1, activeProfileKey: stopped ? null : "test", snapshot: null };
    }
    if (name.endsWith("audio_command") && (args.request as AudioCommandRequest | null)?.action.command === "stop") stopped = true;
    return original(name, args);
  });
  const titles: string[] = [];
  h.adapter.subscribe(() => { const title = h.adapter.getSnapshot()?.metadata.title; if (title) titles.push(title); });
  await h.adapter.reconnect("new-account");
  expect(stopped).toBe(true);
  expect(titles).toEqual([]);
  expect(h.adapter.getSnapshot()).toBeNull();
});

it("refuses account attachment after foreign Stop failure without leaking its snapshot", async () => {
  const h = harness(snapshot());
  const original = h.call.getMockImplementation()!;
  h.call.mockImplementation(async (name, args) => {
    if (name.endsWith("get_audio_snapshot") && args.profileKey === "new-account") return { schemaVersion: 1, activeProfileKey: "test", snapshot: null };
    if (name.endsWith("audio_command")) throw new Error("Stop refused");
    return original(name, args);
  });
  await expect(h.adapter.reconnect("new-account")).rejects.toThrow("Stop refused");
  expect(h.adapter.getSnapshot()).toBeNull();
  expect(h.call.mock.calls.filter(([name, args]) => name.endsWith("get_audio_snapshot") && args.profileKey === "new-account" && args.observing)).toHaveLength(0);
});

it("reconnects after suspended-JS native transport and strips appliedTransport metadata without replaying commands", async () => {
  const advanced = { ...snapshot("A", 1, 5, 1), state: "playing" as const, playIntent: true, pauseReason: null, timeInPart: 85, globalPositionSec: 85, positionSec: 85 };
  const h = harness(advanced);
  await h.adapter.reconnect("test");
  expect(h.adapter.getSnapshot()).toMatchObject({ positionSec: 85, playIntent: true, state: "playing" });
  h.emit({
    ...advanced,
    revision: 6,
    timeInPart: 100,
    globalPositionSec: 100,
    positionSec: 100,
    appliedTransport: { eventId: "native-seek-1", command: "SeekForward", transportApplied: true, occurredAt: 10 },
  });
  expect(h.adapter.getSnapshot()?.positionSec).toBe(100);
  expect(h.adapter.getSnapshot()).not.toHaveProperty("appliedTransport");
  expect(h.call.mock.calls.filter(([name]) => name.endsWith("load_audio") || name.endsWith("audio_command"))).toHaveLength(0);
});

it("executes deferred study captures with press-time provenance, acknowledges only after persistence, and never replays duplicates", async () => {
  const capture: DeferredStudyCapture = {
    eventId: "capture-1",
    command: "Next",
    studyAction: "save_recent_extract",
    sourceKey: key("A"),
    sessionId: "session-A",
    generation: 3,
    section: { id: "part-0", index: 0, title: "Chapter one" },
    partIndex: 0,
    positionHintSec: 42.5,
    positionSec: 42.5,
    occurredAt: 1000,
  };
  let databaseDown = true;
  const executed: DeferredStudyCapture[] = [];
  const deferredCapture = vi.fn(async (value: DeferredStudyCapture) => {
    if (databaseDown) throw new Error("database unavailable");
    executed.push(value);
  });
  const h = harness(snapshot("A"), { deferredCapture });
  const original = h.call.getMockImplementation()!;
  h.call.mockImplementation(async (name, args) => {
    if (name === "reconcile_native_audio_journal") {
      return { schemaVersion: 1, snapshot: snapshot("A"), importedCheckpoints: [], journal: { captures: [capture] } };
    }
    return original(name, args);
  });

  await h.adapter.reconnect("test");
  await h.adapter.flush();
  expect(deferredCapture).toHaveBeenCalled();
  expect(h.call.mock.calls.some(([name, args]) => name.endsWith("reconcile_audio_checkpoint") && Array.isArray((args as { acknowledgedCaptures?: unknown }).acknowledgedCaptures))).toBe(false);

  databaseDown = false;
  await h.adapter.flush();
  expect(executed).toEqual([capture]);
  expect(h.call).toHaveBeenCalledWith("plugin:android-tts|reconcile_audio_checkpoint", expect.objectContaining({
    schemaVersion: 1,
    profileKey: "test",
    acknowledgedCaptures: ["capture-1"],
  }));

  // The same journaled receipt after an observer reset is not executed twice.
  await h.adapter.flush();
  expect(executed).toHaveLength(1);
});
