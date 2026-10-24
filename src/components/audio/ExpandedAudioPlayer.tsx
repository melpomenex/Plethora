import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, CaretDown, SkipBack, SkipForward, Trash } from "@phosphor-icons/react";
import type { ResolvedAudioItem } from "../../types/audioEdition";
import { Dialog, useDialogFocus } from "../md3/Dialog";
import { IconButton } from "../md3/IconButton";
import { audioSourceId } from "../../services/audio/audioPlaybackPersistence";
import { useI18n } from "../../lib/i18n";
import { useAudioPlaybackStore } from "../../stores/audioPlaybackStore";
import { useListeningQueueStore } from "../../stores/listeningQueueStore";
import { AudioPlayerTitle, AudioTransport } from "./MiniAudioPlayer";
import { audioTime, runAudioAction } from "./audioPlayerActions";

const ExpandedAudioStudy = lazy(() =>
  import("./ExpandedAudioStudy").then(module => ({ default: module.ExpandedAudioStudy })),
);

interface EmbeddedChapter {
  id: string;
  title: string;
  startTime: number;
}

interface SavedBookmarkEntry {
  id: string;
  time: number;
  title: string;
  note?: string;
}

function readEmbeddedChapters(documentId: string | undefined): EmbeddedChapter[] {
  if (!documentId || typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(`audiobook-${documentId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { chapters?: unknown };
    if (!Array.isArray(parsed.chapters)) return [];
    return parsed.chapters
      .filter((entry): entry is { id?: unknown; title?: unknown; startTime: number } =>
        Boolean(entry && typeof entry === "object" && typeof (entry as { startTime?: unknown }).startTime === "number" && Number.isFinite((entry as { startTime: number }).startTime)),
      )
      .map((entry, idx) => ({
        id: typeof entry.id === "string" ? entry.id : `ch-${idx}`,
        title: typeof entry.title === "string" && entry.title.trim() ? entry.title : `Chapter ${idx + 1}`,
        startTime: Math.max(0, entry.startTime),
      }));
  } catch {
    return [];
  }
}

function readLocalBookmarks(storageId: string): SavedBookmarkEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(`audiobook-${storageId}-bookmarks`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is { id: string; time: number; title?: string; note?: string } =>
        Boolean(entry && typeof entry === "object" && typeof (entry as { time?: unknown }).time === "number" && Number.isFinite((entry as { time: number }).time)),
      )
      .map(entry => ({
        id: String(entry.id),
        time: Math.max(0, entry.time),
        title: typeof entry.title === "string" && entry.title.trim() ? entry.title : audioTime(entry.time),
        note: typeof entry.note === "string" ? entry.note : undefined,
      }));
  } catch {
    return [];
  }
}

function AudioExpansionSurface({
  mobile,
  close,
  children,
}: {
  mobile: boolean;
  close: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const panelRef = useDialogFocus(mobile, close, undefined, { global: true, priority: 100 });
  if (!mobile) {
    return (
      <Dialog
        open
        onClose={close}
        title={t("audio.player")}
        closeLabel={t("audio.collapse")}
        className="[&_header_button]:h-12 [&_header_button]:w-12"
      >
        {children}
      </Dialog>
    );
  }
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("audio.player")}
      tabIndex={-1}
      className="audio-expanded-mobile fixed inset-0 z-[var(--md-z-dialog)] flex flex-col bg-surface-container text-on-surface safe-top safe-bottom"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant px-4 py-2">
        <h2 className="text-lg font-medium">{t("audio.player")}</h2>
        <IconButton size="lg" icon={CaretDown} aria-label={t("audio.collapse")} onClick={close} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </div>,
    document.body,
  );
}

export function ExpandedAudioPlayer({ mobile = false }: { mobile?: boolean }) {
  const { t } = useI18n();
  const snapshot = useAudioPlaybackStore(state => state.snapshot);
  const storageError = useAudioPlaybackStore(state => state.storageError);
  const controlError = useAudioPlaybackStore(state => state.controlError);
  const adapterError = useAudioPlaybackStore(state => state.adapterError);
  const [drag, setDrag] = useState<number | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [item, setItem] = useState<ResolvedAudioItem | null>(null);
  const [bookmarkTitle, setBookmarkTitle] = useState("");
  const [bookmarkNote, setBookmarkNote] = useState("");
  const [bookmarkSaved, setBookmarkSaved] = useState(false);
  const [savedBookmarks, setSavedBookmarks] = useState<SavedBookmarkEntry[]>([]);
  const sessionId = snapshot?.metadata.sessionId;
  const sourceKind = snapshot?.sourceKey.kind;
  const sourceId = snapshot?.sourceKey.sourceId;

  const refreshBookmarks = useCallback(
    async (resolved: ResolvedAudioItem | null) => {
      if (!sourceId || !sourceKind) {
        setSavedBookmarks([]);
        return;
      }
      if (sourceKind === "recording") {
        try {
          const api = await import("../../api/recordingSessions");
          const markers = await api.listSessionMarkers(sourceId);
          setSavedBookmarks(
            markers.map(marker => ({
              id: marker.id,
              time: Math.max(0, marker.mediaMs / 1000),
              title: marker.note?.trim() || audioTime(marker.mediaMs / 1000),
            })),
          );
        } catch {
          setSavedBookmarks([]);
        }
        return;
      }
      setSavedBookmarks(readLocalBookmarks(resolved?.documentId || sourceId));
    },
    [sourceId, sourceKind],
  );

  useEffect(() => {
    let active = true;
    void import("../../services/audio/audioRuntime").then(module => {
      if (!active) return;
      const resolved = module.getGlobalAudioController().getItem();
      setItem(resolved);
      void refreshBookmarks(resolved);
    });
    return () => {
      active = false;
    };
  }, [sessionId, refreshBookmarks]);

  const embeddedChapters = useMemo(
    () => (item && item.parts.length <= 1 ? readEmbeddedChapters(item.documentId || sourceId) : []),
    [item, sourceId],
  );
  const listeningQueue = useListeningQueueStore(state => state.items);
  const queueTitles = useMemo(
    () => new Map(listeningQueue.map(entry => [entry.id, entry.title])),
    [listeningQueue],
  );

  const close = () => useAudioPlaybackStore.setState({ expanded: false });
  const position = drag ?? snapshot?.positionSec ?? 0;
  const activeEmbeddedChapterIdx = useMemo(() => {
    if (!embeddedChapters.length) return 0;
    let found = 0;
    for (let idx = 0; idx < embeddedChapters.length; idx++) {
      if (position >= embeddedChapters[idx].startTime - 0.25) found = idx;
    }
    return found;
  }, [embeddedChapters, position]);
  if (!snapshot) return null;

  const duration = snapshot.durationSec;
  const error = controlError || snapshot.error?.message || storageError || adapterError;
  const queue = snapshot.queue ?? [];
  const queueIndex = queue.findIndex(key => audioSourceId(key) === audioSourceId(snapshot.sourceKey));
  const hasKnownDuration = Boolean(duration && duration > 0);
  const canScrub = snapshot.capabilities.canSeekAbsolute && hasKnownDuration;
  const progressValueText = hasKnownDuration
    ? t("audio.elapsedOf", { elapsed: audioTime(position), duration: audioTime(duration ?? 0) })
    : `${audioTime(position)}, ${t("audio.unknownDuration")}`;
  const canOpenSource = Boolean(item?.documentId || snapshot.sourceKey.kind === "podcast");

  return (
    <AudioExpansionSurface mobile={mobile} close={close}>
      <div className="flex flex-col gap-5">
        <div className="flex min-w-0 items-center gap-3">
          <AudioPlayerTitle />
        </div>
        <div className="flex justify-center">
          <AudioTransport mobile />
        </div>
        {queue.length > 1 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3" role="group" aria-label={t("audio.queue")}>
              <IconButton
                size="lg"
                icon={SkipBack}
                aria-label={t("audio.previousItem")}
                disabled={queueIndex <= 0}
                onClick={() => void runAudioAction(owner => owner.queuePrevious())}
              />
              <span className="text-sm tabular-nums">
                {t("audio.queuePosition", { position: queueIndex + 1, total: queue.length })}
              </span>
              <IconButton
                size="lg"
                icon={SkipForward}
                aria-label={t("audio.nextItem")}
                disabled={queueIndex < 0 || queueIndex + 1 >= queue.length}
                onClick={() => void runAudioAction(owner => owner.queueNext())}
              />
            </div>
            <button
              type="button"
              className="md-focus-ring min-h-12 rounded-full border border-outline px-4 text-sm"
              aria-expanded={queueOpen}
              onClick={() => setQueueOpen(open => !open)}
            >
              {t("audio.editQueue")}
            </button>
            {queueOpen && (
              <ul className="flex flex-col gap-1" aria-label={t("audio.queue")}>
                {queue.slice(0, 128).map((key, index) => {
                  const id = audioSourceId(key);
                  const active = index === queueIndex;
                  return (
                    <li
                      key={id}
                      className={`flex items-center gap-2 rounded-md border px-2 py-1 ${active ? "border-primary bg-primary-container/40" : "border-outline-variant"}`}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm" title={queueTitles.get(id) ?? key.sourceId}>
                        {queueTitles.get(id) ?? key.sourceId}
                        {active && <span className="ml-2 text-xs text-on-surface-variant">{t("audio.nowPlaying")}</span>}
                      </span>
                      <IconButton
                        size="md"
                        icon={ArrowUp}
                        aria-label={t("audio.moveUp")}
                        disabled={index === 0}
                        onClick={() => {
                          const next = [...queue];
                          [next[index - 1], next[index]] = [next[index], next[index - 1]];
                          void runAudioAction(owner => owner.updateQueue?.(next) ?? Promise.resolve());
                        }}
                      />
                      <IconButton
                        size="md"
                        icon={ArrowDown}
                        aria-label={t("audio.moveDown")}
                        disabled={index + 1 >= queue.length}
                        onClick={() => {
                          const next = [...queue];
                          [next[index], next[index + 1]] = [next[index + 1], next[index]];
                          void runAudioAction(owner => owner.updateQueue?.(next) ?? Promise.resolve());
                        }}
                      />
                      <IconButton
                        size="md"
                        icon={Trash}
                        aria-label={t("audio.removeItem")}
                        disabled={active}
                        onClick={() => {
                          void runAudioAction(owner =>
                            owner.updateQueue?.(queue.filter((_, entryIndex) => entryIndex !== index)) ?? Promise.resolve(),
                          );
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        <label className="flex flex-col gap-2 text-sm">
          {t("audio.progress")}
          <input
            className="min-h-12 w-full accent-primary"
            type="range"
            min={0}
            max={hasKnownDuration ? duration! : 1}
            step={0.1}
            value={hasKnownDuration ? Math.min(position, duration!) : 0}
            disabled={!canScrub}
            aria-valuetext={progressValueText}
            onChange={event => setDrag(Number(event.target.value))}
            onPointerUp={event => {
              const value = Number(event.currentTarget.value);
              setDrag(null);
              void runAudioAction(owner => owner.seekTo(value));
            }}
            onKeyUp={event => {
              if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
                setDrag(null);
                void runAudioAction(owner => owner.seekTo(Number(event.currentTarget.value)));
              }
            }}
          />
          <span className="flex justify-between tabular-nums text-on-surface-variant">
            <span>{audioTime(position)}</span>
            <span>{hasKnownDuration ? audioTime(duration!) : t("audio.unknownDuration")}</span>
          </span>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          {t("audio.speed")}
          <select
            className="min-h-12 rounded-md border border-outline bg-surface px-3"
            value={snapshot.playbackRate}
            onChange={event => {
              // Read the value synchronously: React restores the controlled select
              // before the deferred controller action resolves.
              const rate = Number(event.target.value);
              void runAudioAction(owner => owner.setRate(rate));
            }}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map(rate => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          {t("audio.volume")}
          <input
            className="min-h-12 w-full accent-primary"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={snapshot.volume}
            aria-valuetext={t("audio.volumePercent", { percent: Math.round(snapshot.volume * 100) })}
            onChange={event => {
              const volume = Number(event.target.value);
              void runAudioAction(owner => owner.setVolume(volume));
            }}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          {t("audio.sleep")}
          <select
            className="min-h-12 rounded-md border border-outline bg-surface px-3"
            value={snapshot.sleepDeadlineMs ? "active" : "off"}
            onChange={event => {
              const minutes = Number(event.target.value);
              void runAudioAction(owner =>
                owner.setSleepTimer(Number.isFinite(minutes) && minutes > 0 ? Date.now() + minutes * 60_000 : null),
              );
            }}
          >
            <option value="off">{t("audio.sleepOff")}</option>
            {snapshot.sleepDeadlineMs && <option value="active">{t("audio.sleepActive")}</option>}
            {[15, 30, 60].map(minutes => (
              <option key={minutes} value={minutes}>
                {t("audio.minutes", { minutes })}
              </option>
            ))}
          </select>
        </label>
        {item && item.parts.length > 1 && (
          <label className="flex flex-col gap-2 text-sm">
            {t("audio.chapter")}
            <select
              className="min-h-12 max-w-full rounded-md border border-outline bg-surface px-3"
              value={snapshot.partIndex}
              onChange={event => {
                const index = Number(event.target.value);
                void runAudioAction(owner => owner.selectChapter(index));
              }}
            >
              {item.parts.map((part, index) => (
                <option key={part.partId} value={index}>
                  {part.title || t("audio.part", { part: index + 1 })}
                </option>
              ))}
            </select>
          </label>
        )}
        {(!item || item.parts.length <= 1) && embeddedChapters.length > 1 && (
          <label className="flex flex-col gap-2 text-sm">
            {t("audio.chapter")}
            <select
              className="min-h-12 max-w-full rounded-md border border-outline bg-surface px-3"
              value={activeEmbeddedChapterIdx}
              onChange={event => {
                const selected = embeddedChapters[Number(event.target.value)];
                if (selected) void runAudioAction(owner => owner.seekTo(selected.startTime));
              }}
            >
              {embeddedChapters.map((chapter, index) => (
                <option key={chapter.id} value={index}>
                  {chapter.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <form
          className="flex flex-col gap-2 border-t border-outline-variant pt-4"
          onSubmit={event => {
            event.preventDefault();
            void runAudioAction(async owner => {
              const current = owner.getSnapshot();
              if (!current || current.metadata.sessionId !== sessionId || current.globalPositionSec === null) {
                throw new Error(t("audio.noMedia"));
              }
              if (current.sourceKey.kind === "recording") {
                const api = await import("../../api/recordingSessions");
                await api.createSessionMarker({
                  sessionId: current.sourceKey.sourceId,
                  kind: "bookmark",
                  mediaMs: Math.round(current.positionSec * 1000),
                  note: bookmarkNote || bookmarkTitle || undefined,
                });
              } else {
                const storageKey = `audiobook-${item?.documentId || current.sourceKey.sourceId}-bookmarks`;
                const old: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
                if (!Array.isArray(old)) throw new Error(t("audio.bookmarkStorageError"));
                localStorage.setItem(
                  storageKey,
                  JSON.stringify([
                    ...old,
                    {
                      id: crypto.randomUUID(),
                      time: current.globalPositionSec,
                      title: bookmarkTitle.trim() || t("audio.bookmarkAt", { time: audioTime(current.globalPositionSec) }),
                      note: bookmarkNote.trim() || undefined,
                      createdAt: new Date().toISOString(),
                    },
                  ]),
                );
              }
              setBookmarkSaved(true);
              setBookmarkTitle("");
              setBookmarkNote("");
              await refreshBookmarks(item);
            });
          }}
        >
          <label className="text-sm">
            {t("audio.bookmarkTitle")}
            <input
              className="mt-1 min-h-12 w-full rounded-md border border-outline bg-surface px-3"
              value={bookmarkTitle}
              onChange={event => {
                setBookmarkSaved(false);
                setBookmarkTitle(event.target.value);
              }}
            />
          </label>
          <label className="text-sm">
            {t("audio.bookmarkNote")}
            <textarea
              className="mt-1 min-h-16 w-full rounded-md border border-outline bg-surface p-3"
              value={bookmarkNote}
              onChange={event => {
                setBookmarkSaved(false);
                setBookmarkNote(event.target.value);
              }}
            />
          </label>
          <button
            type="submit"
            className="md-focus-ring min-h-12 rounded-full border border-outline px-4 disabled:opacity-40"
            disabled={snapshot.globalPositionSec === null}
          >
            {t("audio.addBookmark")}
          </button>
          {bookmarkSaved && (
            <p className="text-sm" role="status">
              {t("audio.bookmarkSaved")}
            </p>
          )}
        </form>
        {savedBookmarks.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-outline-variant pt-4" aria-label={t("audio.bookmarks")}>
            <p className="text-sm font-medium">{t("audio.bookmarks")}</p>
            <ul className="flex flex-col gap-1">
              {savedBookmarks.map(entry => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="md-focus-ring flex min-h-12 w-full items-center justify-between gap-2 rounded-md border border-outline-variant px-3 py-2 text-left text-sm"
                    disabled={!snapshot.capabilities.canSeekAbsolute}
                    onClick={() => void runAudioAction(owner => owner.seekTo(entry.time))}
                  >
                    <span className="truncate">{entry.title}</span>
                    <span className="shrink-0 tabular-nums text-xs text-on-surface-variant">{audioTime(entry.time)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {sourceKind === "recording" && sourceId && (
          <Suspense fallback={null}>
            <ExpandedAudioStudy sessionId={sourceId} />
          </Suspense>
        )}
        {canOpenSource && (
          <button
            type="button"
            className="md-focus-ring min-h-12 rounded-full border border-outline px-4"
            onClick={() =>
              void runAudioAction(async () => {
                if (item?.documentId) {
                  const [{ openDocumentAtLocation }, { useTabsStore }] = await Promise.all([
                    import("../../utils/openDocumentAtLocation"),
                    import("../../stores/tabsStore"),
                  ]);
                  if (!(await openDocumentAtLocation(item.documentId, {}, useTabsStore.getState().addTab))) {
                    throw new Error(t("audio.noMedia"));
                  }
                } else if (snapshot.sourceKey.kind === "podcast") {
                  const [{ useTabsStore }, { PodcastTab }] = await Promise.all([
                    import("../../stores/tabsStore"),
                    import("../tabs/TabRegistry"),
                  ]);
                  const store = useTabsStore.getState();
                  const existing = store.tabs.find(tab => tab.type === "podcast");
                  const pane = existing ? store.findPaneContainingTab(existing.id) : null;
                  if (existing && pane) {
                    store.setActiveTab(pane.id, existing.id);
                  } else {
                    store.addTab({
                      title: t("podcastManager.podcasts"),
                      icon: "🎙️",
                      type: "podcast",
                      content: PodcastTab,
                      closable: true,
                    });
                  }
                }
                close();
              })
            }
          >
            {t("audio.openSource")}
          </button>
        )}
        {error && (
          <div role="status" className="rounded-md border border-error p-3 text-sm text-error">
            <p>{error}</p>
            <button
              type="button"
              className="md-focus-ring mt-2 min-h-12 underline"
              onClick={() =>
                void runAudioAction(async owner => {
                  await owner.flush();
                  if (snapshot.state === "error") await owner.load(snapshot.sourceKey, { intent: "paused" });
                })
              }
            >
              {t("audio.retry")}
            </button>
          </div>
        )}
        <button
          type="button"
          className="md-focus-ring min-h-12 rounded-full border border-outline px-4"
          onClick={() =>
            void runAudioAction(async owner => {
              await owner.stopAndClose();
              close();
            })
          }
        >
          {t("audio.stop")}
        </button>
      </div>
    </AudioExpansionSurface>
  );
}
