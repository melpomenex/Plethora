import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioPlaybackSnapshot, AudioSourceKey, ResolvedAudioItem } from "../../../types/audioEdition";
import type { AudioPlaybackOwner } from "../audioPlaybackOwner";
import {
  installListeningQueueProjection,
  listenLaterQueueKeys,
  playListenLaterItem,
  projectListeningQueue,
} from "../listeningQueueProjection";
import { useListeningQueueStore, type ListeningQueueItem } from "../../../stores/listeningQueueStore";
import { useListenLaterStore, type ListenLaterItem } from "../../../stores/listenLaterStore";

const editionKey = (editionId: string): AudioSourceKey => ({
  profileKey: "test",
  kind: "audio_edition",
  sourceId: editionId,
});

const localEditionKey = (editionId: string): AudioSourceKey => ({
  profileKey: "local",
  kind: "audio_edition",
  sourceId: editionId,
});

function snapshot(overrides: Partial<AudioPlaybackSnapshot> = {}): AudioPlaybackSnapshot {
  const sourceKey = overrides.sourceKey ?? editionKey("edition-a");
  return {
    schemaVersion: 1,
    sourceKey,
    generation: 1,
    revision: 1,
    metadata: { sourceId: sourceKey.sourceId, sourceKind: sourceKey.kind, sessionId: "session-1", title: "Alpha" },
    section: { id: "sec-1", index: 0, title: "Opening" },
    state: "playing",
    playIntent: true,
    pauseReason: null,
    positionSec: 12,
    globalPositionSec: 12,
    sleepDeadlineMs: null,
    timeInPart: 12,
    partIndex: 0,
    durationSec: 300,
    playbackRate: 1.25,
    volume: 0.8,
    mediaRevision: "rev-1",
    checkpointSequence: 1,
    updatedAt: 1000,
    queue: [sourceKey],
    capabilities: {
      canPlay: true, canPause: true, canResume: true, canSeekRelative: true,
      canSeekAbsolute: true, precisePosition: true, canNext: false, canPrevious: false,
    },
    ...overrides,
  };
}

function listenLaterItem(id: string, editionId?: string, isSynthesized = false): ListenLaterItem {
  return {
    id,
    documentId: `doc-${id}`,
    title: `Listen ${id}`,
    fileType: "epub",
    characterCount: 100,
    durationSec: 120,
    editionId,
    isSynthesized,
    addedAt: 0,
  };
}

function queueItem(id: string, title = id): ListeningQueueItem {
  return {
    id,
    documentId: `doc-${id}`,
    title,
    currentPositionSeconds: 0,
    durationSeconds: 60,
    status: "queued",
    enqueuedAt: new Date(0).toISOString(),
  };
}

function resolvedItem(sourceKey: AudioSourceKey): ResolvedAudioItem {
  return {
    sourceKey,
    title: "Alpha",
    documentId: "doc-a",
    editionId: sourceKey.sourceId,
    mediaRevision: "rev-1",
    complete: true,
    parts: [{ partId: "p1", sourceRevision: "rev-1", browserUrl: "/a.mp3", durationSec: 300, globalStartSec: 0 }],
  };
}

function fakeOwner(initial: AudioPlaybackSnapshot | null, item: ResolvedAudioItem | null) {
  let current = initial;
  const listeners = new Set<() => void>();
  const owner: AudioPlaybackOwner = {
    initialize: vi.fn(),
    getSnapshot: () => current,
    getIntentVersion: () => 1,
    getItem: () => item,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: vi.fn(async (key, options) => {
      current = snapshot({ sourceKey: key, queue: options.queue ? [...options.queue] : [key], playIntent: options.intent === "play" });
      listeners.forEach(listener => listener());
    }),
    play: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    pauseForFocus: vi.fn(async () => undefined),
    toggle: vi.fn(async () => undefined),
    seekTo: vi.fn(async () => undefined),
    seekRelative: vi.fn(async () => undefined),
    selectChapter: vi.fn(async () => undefined),
    queueNext: vi.fn(async () => undefined),
    queuePrevious: vi.fn(async () => undefined),
    setRate: vi.fn(async () => undefined),
    setVolume: vi.fn(async () => undefined),
    setSleepTimer: vi.fn(),
    updateQueue: vi.fn(async queue => {
      if (current) current = { ...current, queue: [...queue], revision: current.revision + 1 };
    }),
    flush: vi.fn(async () => undefined),
    stopAndClose: vi.fn(async () => undefined),
    command: vi.fn(async () => ({ disposition: "accepted" as const, snapshot: current })),
    dispose: vi.fn(async () => undefined),
  };
  return {
    owner,
    emit: (next: AudioPlaybackSnapshot | null) => {
      current = next;
      listeners.forEach(listener => listener());
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  useListeningQueueStore.setState({ items: [], currentItemId: null, playbackSpeed: 1 });
  useListenLaterStore.setState({ queue: [], currentIndex: 0, isPlaying: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  useListeningQueueStore.setState({ items: [], currentItemId: null, playbackSpeed: 1 });
  useListenLaterStore.setState({ queue: [], currentIndex: 0, isPlaying: false });
});

describe("task 8.1 — listening queue is a controller projection", () => {
  it("reuses the persisted item/order shape without becoming a second status authority", () => {
    const keys = [editionKey("edition-a"), editionKey("edition-b")];
    const previous = [queueItem(JSON.stringify(["test", "audio_edition", "edition-a"]), "Old title")];
    const projection = projectListeningQueue(
      snapshot({ queue: keys, state: "paused", playIntent: false, positionSec: 42 }),
      resolvedItem(keys[0]),
      previous,
    );

    expect(projection?.items.map(entry => entry.id)).toEqual(keys.map(key => JSON.stringify([key.profileKey, key.kind, key.sourceId])));
    expect(projection?.currentItemId).toBe(JSON.stringify(["test", "audio_edition", "edition-a"]));
    expect(projection?.playbackSpeed).toBe(1.25);
    // Active metadata wins; the previous item keeps its own title.
    expect(projection?.items[0]).toMatchObject({ title: "Alpha", chapterTitle: "Opening", status: "playing", currentPositionSeconds: 42 });
    expect(projection?.items[1]).toMatchObject({ title: "edition-b", status: "queued" });
  });

  it("does not serialize a playing tick into the listening queue store", () => {
    const { owner, emit } = fakeOwner(snapshot(), resolvedItem(editionKey("edition-a")));
    const dispose = installListeningQueueProjection(owner);
    const first = useListeningQueueStore.getState().items;
    expect(first).toHaveLength(1);

    emit(snapshot({ positionSec: 13 }));
    emit(snapshot({ positionSec: 14 }));
    expect(useListeningQueueStore.getState().items).toBe(first);

    // Paused transitions do project the exact owner position.
    emit(snapshot({ positionSec: 40, state: "paused", playIntent: false }));
    expect(useListeningQueueStore.getState().items[0].currentPositionSeconds).toBe(40);
    dispose();
  });

  it("projects Listen Later current item and prefetch order back into the owner queue", async () => {
    const itemA = resolvedItem(editionKey("edition-a"));
    const { owner, emit } = fakeOwner(snapshot({ queue: [editionKey("edition-a")] }), itemA);
    const dispose = installListeningQueueProjection(owner);

    useListenLaterStore.setState({
      queue: [listenLaterItem("a", "edition-a", true), listenLaterItem("b", "edition-b", true)],
      currentIndex: 0,
      isPlaying: false,
    });
    await vi.waitFor(() =>
      expect(owner.updateQueue).toHaveBeenLastCalledWith([editionKey("edition-a"), editionKey("edition-b")]),
    );
    await vi.waitFor(() => expect(useListenLaterStore.getState().currentIndex).toBe(0));
    expect(useListenLaterStore.getState().isPlaying).toBe(true);

    // Removing a queued item is forwarded as pruned identity order.
    useListenLaterStore.setState({ queue: [listenLaterItem("a", "edition-a", true)] });
    await vi.waitFor(() => expect(owner.updateQueue).toHaveBeenLastCalledWith([editionKey("edition-a")]));

    emit(snapshot({ queue: [editionKey("edition-a"), editionKey("edition-b")] }));
    dispose();
  });

  it("starts a ready Listen Later item with its ordered queue and refuses unsynthesized ones", async () => {
    const { owner } = fakeOwner(null, null);
    useListenLaterStore.setState({
      queue: [listenLaterItem("a", "edition-a", true), listenLaterItem("b", "edition-b", true), listenLaterItem("c")],
      currentIndex: 0,
    });

    expect(await playListenLaterItem(listenLaterItem("c"), owner)).toBe(false);
    expect(owner.load).not.toHaveBeenCalled();

    expect(await playListenLaterItem(useListenLaterStore.getState().queue[0], owner)).toBe(true);
    expect(owner.load).toHaveBeenCalledWith(
      localEditionKey("edition-a"),
      expect.objectContaining({ intent: "play", queue: [localEditionKey("edition-a"), localEditionKey("edition-b")] }),
    );
  });

  it("builds queue keys only from synthesized edition identities", () => {
    expect(
      listenLaterQueueKeys(
        [listenLaterItem("a", "edition-a"), listenLaterItem("b"), listenLaterItem("c", "edition-c"), listenLaterItem("d", "edition-c")],
        0,
        "test",
      ),
    ).toEqual([editionKey("edition-a"), editionKey("edition-c")]);
  });
});
