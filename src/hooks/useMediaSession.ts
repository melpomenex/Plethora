/**
 * Web MediaSession Adapter (browser/dev only)
 *
 * Synchronizes the browser lock-screen media notification, artwork, playback
 * state, and routes W3C Media Session action events into the single
 * dispatcher as normalized envelopes. Per design Decision 6 this adapter is
 * the ACTIVE adapter only when not running inside the Tauri app — inside
 * Tauri the native bridges (Android Media3 / desktop Rust) own media
 * commands, so this hook never registers handlers there (no double firing).
 */

import { useEffect, useRef } from "react";
import { isTauri } from "../lib/tauri";
import type { RemoteMediaContext } from "../utils/remoteMediaDispatcher";
import type { LongFormPlaybackCapabilities, LongFormPlaybackSection } from "../types/audioEdition";
import {
  dispatchRemoteMediaCommand,
  envelopeForCommand,
} from "../utils/remoteMediaDispatcher";

export interface MediaSessionOptions {
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  isPlaying: boolean;
  duration?: number;
  currentTime?: number;
  playbackRate?: number;
  section?: LongFormPlaybackSection;
  capabilities?: LongFormPlaybackCapabilities;
  enabled?: boolean;
  context: RemoteMediaContext;
}

export function useMediaSession(options: MediaSessionOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Single-adapter rule: inside Tauri the native bridge owns media commands.
  const active = options.enabled !== false && typeof window !== "undefined" && "mediaSession" in navigator && !isTauri();

  useEffect(() => {
    if (!active) {
      return;
    }

    const { title, artist, album, artworkUrl, isPlaying, duration, currentTime } = options;

    // Update metadata
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || "Audio Edition",
        artist: artist || "Plethora",
        album: album || "Library",
        artwork: artworkUrl
          ? [
              { src: artworkUrl, sizes: "96x96", type: "image/png" },
              { src: artworkUrl, sizes: "256x256", type: "image/png" },
              { src: artworkUrl, sizes: "512x512", type: "image/png" },
            ]
          : [],
      });
    } catch {
      // ignore
    }

    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";

    if (
      typeof duration === "number" &&
      duration > 0 &&
      typeof currentTime === "number" &&
      "setPositionState" in navigator.mediaSession
    ) {
      try {
        navigator.mediaSession.setPositionState({
          duration: Math.max(0, duration),
        playbackRate: options.playbackRate ?? 1.0,
          position: Math.min(Math.max(0, currentTime), duration),
        });
      } catch {
        // ignore
      }
    }
  }, [
    active,
    options.title,
    options.artist,
    options.album,
    options.artworkUrl,
    options.isPlaying,
    options.duration,
    options.currentTime,
    options.playbackRate,
    options.section,
    options.enabled,
  ]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const emit = (command: Parameters<typeof envelopeForCommand>[0]) => {
      // Each handler invocation is one physical press → its own envelope.
      dispatchRemoteMediaCommand(
        envelopeForCommand(command, "web", optionsRef.current.context.currentTimestampSec),
        optionsRef.current.context
      );
    };

    const actionHandlers: Array<[MediaSessionAction, (details?: MediaSessionActionDetails) => void]> = [
      ["play", () => emit("Play")],
      ["pause", () => emit("Pause")],
      ["nexttrack", () => emit("Next")],
      ["previoustrack", () => emit("Previous")],
      ["seekforward", () => emit("SeekForward")],
      ["seekbackward", () => emit("SeekBackward")],
      ["seekto", (details) => {
        const seekTime = details?.seekTime;
        if (typeof seekTime === "number" && Number.isFinite(seekTime)) {
          dispatchRemoteMediaCommand(
            {
              ...envelopeForCommand("SeekTo", "web", optionsRef.current.context.currentTimestampSec),
              positionSec: seekTime,
            },
            optionsRef.current.context,
          );
        }
      }],
      ["stop", () => emit("Pause")],
    ];

    actionHandlers.forEach(([action, handler]) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Some actions may not be supported by all browsers
      }
    });

    return () => {
      actionHandlers.forEach(([action]) => {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // ignore
        }
      });
    };
  }, [active]);
}
