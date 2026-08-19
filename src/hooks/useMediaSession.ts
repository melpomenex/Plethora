/**
 * Web MediaSession & OS Media Key Integration Hook
 * 
 * Synchronizes lock screen media notification, artwork, playback state,
 * and routes remote media key events into dispatchRemoteMediaCommand.
 */

import { useEffect, useRef } from "react";
import type { RemoteMediaContext } from "../utils/remoteMediaDispatcher";
import { dispatchRemoteMediaCommand } from "../utils/remoteMediaDispatcher";

export interface MediaSessionOptions {
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  isPlaying: boolean;
  duration?: number;
  currentTime?: number;
  context: RemoteMediaContext;
}

export function useMediaSession(options: MediaSessionOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) {
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
          playbackRate: 1.0,
          position: Math.min(Math.max(0, currentTime), duration),
        });
      } catch {
        // ignore
      }
    }
  }, [
    options.title,
    options.artist,
    options.album,
    options.artworkUrl,
    options.isPlaying,
    options.duration,
    options.currentTime,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    const actionHandlers: Array<[MediaSessionAction, (details: MediaSessionActionDetails) => void]> = [
      ["play", () => dispatchRemoteMediaCommand("Play", optionsRef.current.context)],
      ["pause", () => dispatchRemoteMediaCommand("Pause", optionsRef.current.context)],
      ["nexttrack", () => dispatchRemoteMediaCommand("Next", optionsRef.current.context)],
      ["previoustrack", () => dispatchRemoteMediaCommand("Previous", optionsRef.current.context)],
      ["seekforward", () => dispatchRemoteMediaCommand("SeekForward", optionsRef.current.context)],
      ["seekbackward", () => dispatchRemoteMediaCommand("SeekBackward", optionsRef.current.context)],
      ["stop", () => dispatchRemoteMediaCommand("Pause", optionsRef.current.context)],
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
  }, []);
}
