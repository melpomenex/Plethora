/**
 * Platform Remote-Media Bridge (design Decision 6)
 *
 * Mounts exactly ONE active media-command adapter per platform and routes all
 * commands through the single dispatcher:
 * - Pure browser/dev (not Tauri): the W3C MediaSession adapter
 *   (`useMediaSession`), which also owns lock-screen metadata.
 * - Desktop Tauri: listens for normalized `remote-media-command` Tauri events
 *   from the Rust media-control bridge and pushes metadata/playback state to
 *   it via `update_media_metadata`.
 * - Android Tauri: listens for normalized `media://remote-command` events from
 *   the Media3 plugin, acknowledges accepted envelopes, and drains the native
 *   durable pending-command queue on resume (Decision 8).
 */

import { useEffect, useRef } from "react";
import { invokeCommand, isNativeMobile, isTauri, listen } from "../lib/tauri";
import type {
  LongFormPlaybackCapabilities,
  LongFormPlaybackSection,
  LongFormPlaybackSourceKind,
  LongFormPlaybackState,
  LongFormPlaybackStateSnapshot,
  RemoteMediaCommandEnvelope,
} from "../types/audioEdition";
import {
  dispatchRemoteMediaCommand,
  normalizeCommand,
  setMediaCommandAckHandler,
  type RemoteMediaContext,
} from "../utils/remoteMediaDispatcher";
import {
  createLongFormSessionId,
  longFormPlaybackSessions,
} from "../utils/longFormPlaybackSession";
import { useMediaSession } from "./useMediaSession";

/** Commands older than this are dropped during reconcile (Decision 8). */
export const PENDING_COMMAND_STALENESS_MS = 10 * 60 * 1000;

export interface RemoteMediaBridgeOptions {
  /** Ref-style getter so the dispatcher always sees the latest context. */
  getContext: () => RemoteMediaContext;
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  isPlaying: boolean;
  duration?: number;
  currentTime?: number;
  /** Full snapshot override for speech/chunked adapters. */
  session?: LongFormPlaybackStateSnapshot;
  sourceId?: string;
  sessionId?: string;
  sourceKind?: LongFormPlaybackSourceKind;
  section?: LongFormPlaybackSection;
  playbackRate?: number;
  capabilities?: LongFormPlaybackCapabilities;
  enabled?: boolean;
}

interface AndroidPendingCommand extends RemoteMediaCommandEnvelope {
  acked?: boolean;
}

interface AndroidPendingCommandResponse {
  commands?: AndroidPendingCommand[];
}

/**
 * Normalize the plugin's durable-queue response at the adapter boundary.
 * Older plugin builds returned the array directly; current builds wrap it so
 * the response can grow without changing the command record shape.
 */
export function normalizePendingMediaCommands(value: unknown): AndroidPendingCommand[] {
  if (Array.isArray(value)) return value as AndroidPendingCommand[];
  if (!value || typeof value !== "object") return [];
  const commands = (value as AndroidPendingCommandResponse).commands;
  return Array.isArray(commands) ? commands : [];
}

const DEFAULT_CAPABILITIES: LongFormPlaybackCapabilities = {
  canPlay: true,
  canPause: true,
  canResume: true,
  canSeekRelative: true,
  canSeekAbsolute: true,
  precisePosition: true,
  canNext: true,
  canPrevious: true,
};

function snapshotFor(options: RemoteMediaBridgeOptions): LongFormPlaybackStateSnapshot {
  if (options.session) return options.session;
  const context = options.getContext();
  const sourceKind = options.sourceKind ?? "audiobook";
  const sourceId = options.sourceId ?? context.sourceId ?? context.editionId ?? context.documentId;
  const sessionId = options.sessionId ?? createLongFormSessionId(sourceKind, sourceId);
  const state: LongFormPlaybackState = options.isPlaying ? "playing" : "paused";
  return {
    metadata: {
      sourceId,
      sourceKind,
      sessionId,
      title: options.title,
      artist: options.artist,
      album: options.album,
      artworkUrl: options.artworkUrl,
      section: options.section,
    },
    state,
    positionSec: Math.max(0, options.currentTime ?? 0),
    durationSec: typeof options.duration === "number" && options.duration > 0 ? options.duration : null,
    playbackRate: options.playbackRate ?? 1,
    capabilities: options.capabilities ?? DEFAULT_CAPABILITIES,
    section: options.section,
    updatedAt: Date.now(),
  };
}

async function invokePluginSafe(command: string, args?: Record<string, unknown>): Promise<unknown> {
  try {
    return await invokeCommand<unknown>(command, args);
  } catch {
    return null;
  }
}

export function useRemoteMediaBridge(options: RemoteMediaBridgeOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const snapshotRef = useRef<LongFormPlaybackStateSnapshot>(snapshotFor(options));
  snapshotRef.current = snapshotFor(options);
  const playbackSessionId = snapshotRef.current.metadata.sessionId;
  const sessionIdRef = useRef(playbackSessionId);

  const inTauri = typeof window !== "undefined" && isTauri();
  const isAndroid = inTauri && isNativeMobile();
  const isDesktop = inTauri && !isNativeMobile();

  // Register the host once per playback identity. The command handlers below
  // use this registry as a last line of defence when a reader remount leaves a
  // stale bridge effect alive for one React turn.
  useEffect(() => {
    if (options.enabled === false) return;
    sessionIdRef.current = playbackSessionId;
    const context = optionsRef.current.getContext();
    const session = {
      sessionId: playbackSessionId,
      sourceId: snapshotRef.current.metadata.sourceId,
      sourceKind: snapshotRef.current.metadata.sourceKind,
      getSnapshot: () => snapshotRef.current,
      play: () => context.onPlayPause?.(),
      pause: () => context.onPlayPause?.(),
      toggle: () => context.onPlayPause?.(),
      next: () => context.onNextChapter?.(),
      previous: () => context.onPrevChapter?.(),
      seekRelative: (deltaSec: number) => context.onSeekRelative?.(deltaSec),
      seekTo: (positionSec: number) => context.onSeekAbsolute?.(positionSec),
    };
    longFormPlaybackSessions.attach(session);
    return () => longFormPlaybackSessions.detach(playbackSessionId);
  }, [options.enabled, playbackSessionId]);

  // Web adapter (browser/dev only — useMediaSession no-ops inside Tauri): it
  // owns both metadata and command routing in the pure-browser environment.
  useMediaSession({
    title: options.title,
    artist: options.artist,
    album: options.album,
    artworkUrl: options.artworkUrl,
    isPlaying: options.isPlaying,
    duration: options.duration,
    currentTime: options.currentTime,
    playbackRate: options.playbackRate,
    section: options.section,
    capabilities: options.capabilities,
    enabled: options.enabled,
    get context() {
      return optionsRef.current.getContext();
    },
  } as Parameters<typeof useMediaSession>[0]);

  // Desktop bridge: receive commands, push metadata.
  useEffect(() => {
    if (!isDesktop || options.enabled === false) return;

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      // Promise.resolve wrappers keep partially-mocked test environments
      // (where listen/invokeCommand may return undefined) from throwing.
      const listened = await Promise.resolve(
        listen<RemoteMediaCommandEnvelope>("remote-media-command", (event) => {
          if (longFormPlaybackSessions.getActive()?.sessionId !== sessionIdRef.current) return;
          dispatchRemoteMediaCommand(event.payload, optionsRef.current.getContext());
        })
      ).catch(() => null);
      unlisten = typeof listened === "function" ? listened : () => {};
      if (cancelled) unlisten();
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      // Clean OS integration teardown when the player unmounts.
      Promise.resolve(invokeCommand("detach_media_controls")).catch(() => {});
    };
  }, [isDesktop, options.enabled]);

  // Publish metadata / playback state to the desktop bridge whenever it
  // changes (no-op when the bridge module is unavailable on a platform).
  useEffect(() => {
    if (!isDesktop || options.enabled === false) return;
    // Promise.resolve wrapper: partially-mocked test environments may have
    // invokeCommand returning undefined for unmocked commands.
    Promise.resolve(
      invokeCommand("update_media_metadata", {
        title: options.title,
        artist: options.artist ?? "Plethora",
        album: options.album ?? "Library",
        durationSec: options.duration ?? 0,
        positionSec: options.currentTime ?? 0,
        isPlaying: options.isPlaying,
        sourceId: snapshotRef.current.metadata.sourceId,
        sessionId: snapshotRef.current.metadata.sessionId,
        sourceKind: snapshotRef.current.metadata.sourceKind,
        artworkUrl: snapshotRef.current.metadata.artworkUrl,
        sectionId: snapshotRef.current.section?.id,
        sectionTitle: snapshotRef.current.section?.title,
        sectionIndex: snapshotRef.current.section?.index,
        sectionAnchor: snapshotRef.current.section?.anchor,
        playbackRate: snapshotRef.current.playbackRate,
        state: snapshotRef.current.state,
        updatedAt: snapshotRef.current.updatedAt,
      })
    ).catch(() => {
      // bridge not implemented on this platform build — in-app controls still work
    });
  }, [
    isDesktop,
    options.title,
    options.artist,
    options.album,
    options.duration,
    options.currentTime,
    options.isPlaying,
    options.section,
    options.playbackRate,
    options.capabilities,
    playbackSessionId,
    options.enabled,
  ]);

  // Android bridge: receive normalized commands from the Media3 session (the
  // plugin dispatches them as window CustomEvents via evaluateJavascript),
  // acknowledge them, keep the native session's position hint fresh, and
  // reconcile the durable queue on resume.
  useEffect(() => {
    if (!isAndroid || options.enabled === false) return;

    // Start the native Media3 session service with player playback; it is
    // stopped again on unmount (clean session lifecycle).
    void invokePluginSafe("plugin:plethora-android-tts|start_media_session");

    // Ack accepted envelopes to the plugin's durable queue.
    setMediaCommandAckHandler((eventIds) => {
      void invokePluginSafe("plugin:plethora-android-tts|ack_media_commands", { eventIds });
    });

    const listener = (e: Event) => {
      const envelope = (e as CustomEvent<RemoteMediaCommandEnvelope>).detail;
      if (!envelope || typeof envelope !== "object") return;
      if (longFormPlaybackSessions.getActive()?.sessionId !== sessionIdRef.current) return;
      dispatchRemoteMediaCommand(envelope, optionsRef.current.getContext());
    };
    window.addEventListener("media://remote-command", listener as EventListener);

    const drainQueue = async () => {
      // WebView resumed: replay unacked commands oldest-first through the
      // same dispatcher. Stale commands (> 10 min) become pending audio
      // bookmarks instead of firing a surprise action hours later.
      try {
        const rawResponse = (await invokePluginSafe(
          "plugin:plethora-android-tts|drain_pending_media_commands"
        )) as AndroidPendingCommandResponse | AndroidPendingCommand[] | null;
        const pending = normalizePendingMediaCommands(rawResponse);
        const now = Date.now();
        for (const raw of pending) {
          if (!raw || raw.acked) continue;
          if (!normalizeCommand(raw.command)) {
            void invokePluginSafe("plugin:plethora-android-tts|discard_media_commands", {
              eventIds: [raw.eventId],
              reason: "unknown_command",
            });
            continue;
          }
          if (
            (raw.sessionId && raw.sessionId !== snapshotRef.current.metadata.sessionId) ||
            (raw.sourceId && raw.sourceId !== snapshotRef.current.metadata.sourceId)
          ) {
            console.warn("[media] discarded command for inactive source", raw.eventId);
            void invokePluginSafe("plugin:plethora-android-tts|discard_media_commands", {
              eventIds: [raw.eventId],
              reason: "source_mismatch",
            });
            continue;
          }
          if (
            typeof raw.occurredAt === "number" &&
            now - raw.occurredAt > PENDING_COMMAND_STALENESS_MS
          ) {
            console.warn("[media] expired queued command", raw.eventId);
            void invokePluginSafe("plugin:plethora-android-tts|discard_media_commands", {
              eventIds: [raw.eventId],
              reason: "expired",
            });
            continue;
          }
          dispatchRemoteMediaCommand(raw, optionsRef.current.getContext());
        }
      } catch {
        // queue drain is best-effort
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void drainQueue();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void drainQueue();

    return () => {
      window.removeEventListener("media://remote-command", listener as EventListener);
      document.removeEventListener("visibilitychange", onVisibility);
      setMediaCommandAckHandler(null);
      void invokePluginSafe("plugin:plethora-android-tts|stop_media_session");
    };
  }, [isAndroid, options.enabled]);

  // Keep the native session's playback state + position hint fresh so queued
  // envelopes can carry the position actually being heard (Decision 8).
  useEffect(() => {
    if (!isAndroid || options.enabled === false) return;
    void invokePluginSafe("plugin:plethora-android-tts|update_media_metadata", {
      payload: {
        sourceId: snapshotRef.current.metadata.sourceId,
        sessionId: snapshotRef.current.metadata.sessionId,
        sourceKind: snapshotRef.current.metadata.sourceKind,
        title: snapshotRef.current.metadata.title,
        artist: snapshotRef.current.metadata.artist,
        album: snapshotRef.current.metadata.album,
        artworkUrl: snapshotRef.current.metadata.artworkUrl,
        sectionId: snapshotRef.current.section?.id,
        sectionTitle: snapshotRef.current.section?.title,
        sectionIndex: snapshotRef.current.section?.index,
        sectionAnchor: snapshotRef.current.section?.anchor,
        positionSec: options.currentTime ?? snapshotRef.current.positionSec,
        durationSec: snapshotRef.current.durationSec ?? 0,
        playbackRate: snapshotRef.current.playbackRate,
        canSeekRelative: snapshotRef.current.capabilities.canSeekRelative,
        canSeekAbsolute: snapshotRef.current.capabilities.canSeekAbsolute,
        canNext: snapshotRef.current.capabilities.canNext,
        canPrevious: snapshotRef.current.capabilities.canPrevious,
        precisePosition: snapshotRef.current.capabilities.precisePosition,
        state: snapshotRef.current.state,
        isPlaying: options.isPlaying,
        updatedAt: snapshotRef.current.updatedAt,
      },
    });
  }, [isAndroid, options.enabled, options.isPlaying, options.currentTime, playbackSessionId, options.session]);
}
