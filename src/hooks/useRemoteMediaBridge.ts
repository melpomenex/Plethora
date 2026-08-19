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
import type { RemoteMediaCommandEnvelope } from "../types/audioEdition";
import {
  dispatchRemoteMediaCommand,
  executeStudyAction,
  normalizeCommand,
  setMediaCommandAckHandler,
  type RemoteMediaContext,
} from "../utils/remoteMediaDispatcher";
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
}

interface AndroidPendingCommand extends RemoteMediaCommandEnvelope {
  acked?: boolean;
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

  const inTauri = typeof window !== "undefined" && isTauri();
  const isAndroid = inTauri && isNativeMobile();
  const isDesktop = inTauri && !isNativeMobile();

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
    get context() {
      return optionsRef.current.getContext();
    },
  } as Parameters<typeof useMediaSession>[0]);

  // Desktop bridge: receive commands, push metadata.
  useEffect(() => {
    if (!isDesktop) return;

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      // Promise.resolve wrappers keep partially-mocked test environments
      // (where listen/invokeCommand may return undefined) from throwing.
      const listened = await Promise.resolve(
        listen<RemoteMediaCommandEnvelope>("remote-media-command", (event) => {
          dispatchRemoteMediaCommand(event.payload, optionsRef.current.getContext());
        })
      ).catch(() => null);
      unlisten = listened ?? (() => {});
      if (cancelled) unlisten();
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      // Clean OS integration teardown when the player unmounts.
      Promise.resolve(invokeCommand("detach_media_controls")).catch(() => {});
    };
  }, [isDesktop]);

  // Publish metadata / playback state to the desktop bridge whenever it
  // changes (no-op when the bridge module is unavailable on a platform).
  useEffect(() => {
    if (!isDesktop) return;
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
  ]);

  // Android bridge: receive normalized commands from the Media3 session (the
  // plugin dispatches them as window CustomEvents via evaluateJavascript),
  // acknowledge them, keep the native session's position hint fresh, and
  // reconcile the durable queue on resume.
  useEffect(() => {
    if (!isAndroid) return;

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
      dispatchRemoteMediaCommand(envelope, optionsRef.current.getContext());
    };
    window.addEventListener("media://remote-command", listener as EventListener);

    const drainQueue = async () => {
      // WebView resumed: replay unacked commands oldest-first through the
      // same dispatcher. Stale commands (> 10 min) become pending audio
      // bookmarks instead of firing a surprise action hours later.
      try {
        const pending = (await invokePluginSafe(
          "plugin:plethora-android-tts|drain_pending_media_commands"
        )) as AndroidPendingCommand[] | null;
        if (!Array.isArray(pending)) return;
        const now = Date.now();
        for (const raw of pending) {
          if (!raw || raw.acked) continue;
          if (!normalizeCommand(raw.command)) {
            void invokePluginSafe("plugin:plethora-android-tts|ack_media_commands", {
              eventIds: [raw.eventId],
            });
            continue;
          }
          if (
            typeof raw.occurredAt === "number" &&
            now - raw.occurredAt > PENDING_COMMAND_STALENESS_MS
          ) {
            // Position can no longer be trusted: record a pending audio
            // bookmark directly (low confidence ⇒ no fabricated text), never
            // a surprise transport action hours later.
            const ctx = optionsRef.current.getContext();
            if (ctx?.editionId) {
              void executeStudyAction("save_recent_extract", {
                ...ctx,
                currentTimestampSec: raw.positionHintSec ?? ctx.currentTimestampSec,
                captureConfidence: "low",
              });
            }
            void invokePluginSafe("plugin:plethora-android-tts|ack_media_commands", {
              eventIds: [raw.eventId],
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
  }, [isAndroid]);

  // Keep the native session's playback state + position hint fresh so queued
  // envelopes can carry the position actually being heard (Decision 8).
  useEffect(() => {
    if (!isAndroid) return;
    void invokePluginSafe("plugin:plethora-android-tts|update_media_metadata", {
      positionSec: options.currentTime ?? 0,
      isPlaying: options.isPlaying,
    });
  }, [isAndroid, options.isPlaying, options.currentTime]);
}
