import type { AudioPlaybackSnapshot, AudioSourceKey, ResolvedAudioItem } from "../../types/audioEdition";
import type { AudioPlaybackOwner } from "./audioPlaybackOwner";
import { audioSourceId } from "./audioPlaybackPersistence";
import { useListeningQueueStore, type ListeningQueueItem } from "../../stores/listeningQueueStore";
import { useListenLaterStore, type ListenLaterItem } from "../../stores/listenLaterStore";
import { useAccountStore } from "../../stores/accountStore";

const MAX_QUEUE_ITEMS = 128;

/** Account identifiers stay out of display copy; the namespace keys every persisted identity. */
export function currentAudioProfileKey(): string {
  const userId = useAccountStore.getState().user?.id;
  return userId ? `account:${userId}` : "local";
}

/** Listen Later items become edition identities only once synthesis created a stable edition. */
export function listenLaterSourceKey(
  item: Pick<ListenLaterItem, "editionId">,
  profileKey: string,
): AudioSourceKey | null {
  if (!item.editionId) return null;
  return { profileKey, kind: "audio_edition", sourceId: item.editionId };
}

/** Ordered queue identities for Listen Later items from `fromIndex` onward. */
export function listenLaterQueueKeys(
  items: readonly ListenLaterItem[],
  fromIndex: number,
  profileKey: string,
): AudioSourceKey[] {
  const keys: AudioSourceKey[] = [];
  const seen = new Set<string>();
  for (let index = Math.max(0, fromIndex); index < items.length && keys.length < MAX_QUEUE_ITEMS; index += 1) {
    const key = listenLaterSourceKey(items[index], profileKey);
    if (!key) continue;
    const id = audioSourceId(key);
    if (seen.has(id)) continue;
    seen.add(id);
    keys.push(key);
  }
  return keys;
}

export interface ListeningQueueProjection {
  items: ListeningQueueItem[];
  currentItemId: string | null;
  playbackSpeed: number;
}

/**
 * The controller owns queue identity/order; this only reuses the persisted
 * ListeningQueueItem shape for presentation and legacy read-through. Position is
 * projected on transitions only so a playing tick never serializes storage.
 */
export function projectListeningQueue(
  snapshot: AudioPlaybackSnapshot | null,
  item: ResolvedAudioItem | null,
  previousItems: readonly ListeningQueueItem[],
): ListeningQueueProjection | null {
  if (!snapshot) return null;
  const queue = snapshot.queue?.length ? snapshot.queue : [snapshot.sourceKey];
  const previousById = new Map(previousItems.map(entry => [entry.id, entry]));
  const listenLater = useListenLaterStore.getState().queue;
  const ended = snapshot.state === "ended";
  const activeId = audioSourceId(snapshot.sourceKey);

  const items = queue.slice(0, MAX_QUEUE_ITEMS).map((key, index) => {
    const id = audioSourceId(key);
    const existing = previousById.get(id);
    const active = id === activeId;
    const edition = key.kind === "audio_edition"
      ? listenLater.find(entry => entry.editionId === key.sourceId)
      : undefined;
    const position = active
      ? (snapshot.state === "playing" ? (existing?.currentPositionSeconds ?? 0) : snapshot.positionSec)
      : (existing?.currentPositionSeconds ?? 0);
    const duration = active
      ? (snapshot.durationSec ?? existing?.durationSeconds ?? 0)
      : (existing?.durationSeconds ?? 0);
    const completed = ended ? active : existing?.status === "completed";
    return {
      id,
      documentId: (active ? item?.documentId : undefined) ?? existing?.documentId ?? edition?.documentId ?? key.sourceId,
      title: active
        ? snapshot.metadata.title || item?.title || existing?.title || key.sourceId
        : existing?.title || edition?.title || key.sourceId,
      chapterTitle: active ? snapshot.section?.title : existing?.chapterTitle,
      chapterIndex: active ? snapshot.section?.index : existing?.chapterIndex,
      currentPositionSeconds: Math.max(0, position),
      durationSeconds: Math.max(0, duration),
      status: active ? (completed ? "completed" : "playing") : existing?.status === "completed" ? "completed" : "queued",
      enqueuedAt: existing?.enqueuedAt ?? new Date(index === 0 ? 0 : index).toISOString(),
    } satisfies ListeningQueueItem;
  });

  return {
    items,
    currentItemId: items.some(entry => entry.id === activeId) ? activeId : null,
    playbackSpeed: snapshot.playbackRate,
  };
}

function syncListenLaterCurrent(snapshot: AudioPlaybackSnapshot | null): void {
  const state = useListenLaterStore.getState();
  const index = snapshot?.sourceKey.kind === "audio_edition"
    ? state.queue.findIndex(entry => entry.editionId === snapshot.sourceKey.sourceId)
    : -1;
  if (index < 0) {
    if (state.isPlaying) useListenLaterStore.setState({ isPlaying: false });
    return;
  }
  const nextPlaying = snapshot!.playIntent;
  // Listen Later has no position field of its own; the owner checkpoint is the
  // position authority. Only identity/status are projected, so playing ticks
  // never serialize the persisted store.
  const shouldUpdate =
    state.currentIndex !== index ||
    state.isPlaying !== nextPlaying;
  if (!shouldUpdate) return;
  useListenLaterStore.setState({
    currentIndex: index,
    isPlaying: nextPlaying,
  });
}

/**
 * Prefetch/synthesis and queue editing add or remove edition identities while
 * the owner is already playing. The owner remains the queue authority; this
 * only forwards the ordered identities it does not know yet.
 */
function syncListenLaterOwnerQueue(owner: AudioPlaybackOwner, snapshot: AudioPlaybackSnapshot | null): void {
  if (!snapshot || snapshot.sourceKey.kind !== "audio_edition") return;
  const state = useListenLaterStore.getState();
  const index = state.queue.findIndex(entry => entry.editionId === snapshot.sourceKey.sourceId);
  if (index < 0) return;
  const keys = listenLaterQueueKeys(state.queue, index, snapshot.sourceKey.profileKey);
  if (!keys.length) return;
  const current = snapshot.queue ?? [];
  if (
    current.length === keys.length &&
    current.every((key, entryIndex) => audioSourceId(key) === audioSourceId(keys[entryIndex]))
  ) {
    return;
  }
  void owner.updateQueue?.(keys).catch(() => undefined);
}

/** Owner-lifetime projection: one subscription feeds both queue presentations. */
export function installListeningQueueProjection(owner: AudioPlaybackOwner): () => void {
  const sync = () => {
    const snapshot = owner.getSnapshot();
    if (!snapshot) return;
    const projection = projectListeningQueue(
      snapshot,
      owner.getItem(),
      useListeningQueueStore.getState().items,
    );
    if (projection) {
      useListeningQueueStore
        .getState()
        .replaceProjection(projection.items, projection.currentItemId, projection.playbackSpeed);
    }
    syncListenLaterCurrent(snapshot);
    syncListenLaterOwnerQueue(owner, snapshot);
  };

  const unsubscribeOwner = owner.subscribe(sync);
  let lastQueue = useListenLaterStore.getState().queue;
  let lastIndex = useListenLaterStore.getState().currentIndex;
  const unsubscribeListenLater = useListenLaterStore.subscribe(state => {
    if (state.queue === lastQueue && state.currentIndex === lastIndex) return;
    lastQueue = state.queue;
    lastIndex = state.currentIndex;
    syncListenLaterCurrent(owner.getSnapshot());
    syncListenLaterOwnerQueue(owner, owner.getSnapshot());
  });
  sync();
  return () => {
    unsubscribeOwner();
    unsubscribeListenLater();
  };
}

/**
 * Start a ready Listen Later item through the one owner. Unsynthesized items
 * keep their existing document-viewer synthesis path in the caller.
 */
export async function playListenLaterItem(item: ListenLaterItem, owner?: AudioPlaybackOwner): Promise<boolean> {
  if (!item.isSynthesized || !item.editionId) return false;
  const profileKey = currentAudioProfileKey();
  const state = useListenLaterStore.getState();
  const index = state.queue.findIndex(entry => entry.id === item.id);
  if (index < 0) return false;
  useListenLaterStore.setState({ currentIndex: index });
  const queue = listenLaterQueueKeys(state.queue, index, profileKey);
  const { getGlobalAudioController } = await import("./audioRuntime");
  await (owner ?? getGlobalAudioController()).load(
    { profileKey, kind: "audio_edition", sourceId: item.editionId },
    { intent: "play", queue },
  );
  return true;
}
