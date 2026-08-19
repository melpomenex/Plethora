/**
 * Listening Session Lifecycle Hook (design Decision 10)
 *
 * Wired into the audio player: a session starts/resumes (15-min window) when
 * playback begins, every capture appends to it, and it closes on player
 * unmount, content change, or a pause longer than the inactivity horizon —
 * without spawning micro-sessions on brief pauses.
 */

import { useEffect, useRef, useState } from "react";
import type { ListeningSession } from "../types/audioEdition";
import {
  SESSION_INACTIVITY_CLOSE_MS,
  closeListeningSession,
  ensureListeningSession,
  getActiveSession,
  touchListeningSession,
} from "../utils/listeningSessionService";

export interface ListeningSessionTrackerOptions {
  editionId?: string;
  isPlaying: boolean;
}

export function useListeningSessionTracker({
  editionId,
  isPlaying,
}: ListeningSessionTrackerOptions): ListeningSession | null {
  const [session, setSession] = useState<ListeningSession | null>(null);
  const sessionRef = useRef<ListeningSession | null>(null);
  const pausedAtRef = useRef<number | null>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start/resume when playback begins (or the edition changes mid-play).
  useEffect(() => {
    if (!editionId) {
      setSession(null);
      sessionRef.current = null;
      return;
    }

    let cancelled = false;
    void (async () => {
      const active = getActiveSession(editionId) ?? (await ensureListeningSession(editionId));
      if (cancelled) return;
      sessionRef.current = active;
      setSession(active);
    })();

    return () => {
      cancelled = true;
    };
  }, [editionId]);

  // Touch on activity so the session survives the resume-window prune.
  useEffect(() => {
    if (!editionId || !isPlaying) return;

    touchListeningSession(editionId, sessionRef.current?.id);
    pausedAtRef.current = null;
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    const interval = setInterval(() => {
      touchListeningSession(editionId, sessionRef.current?.id);
    }, 30_000);
    return () => clearInterval(interval);
  }, [editionId, isPlaying]);

  // Close after a sustained pause (inactivity horizon).
  useEffect(() => {
    if (!editionId || isPlaying) return;

    pausedAtRef.current = Date.now();
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(() => {
      if (pausedAtRef.current && Date.now() - pausedAtRef.current >= SESSION_INACTIVITY_CLOSE_MS) {
        void closeListeningSession(editionId);
        sessionRef.current = null;
        setSession(null);
      }
    }, SESSION_INACTIVITY_CLOSE_MS + 500);

    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
  }, [editionId, isPlaying]);

  // Close on unmount or content change.
  useEffect(() => {
    const previousEditionId = editionId;
    return () => {
      if (previousEditionId) void closeListeningSession(previousEditionId);
    };
  }, [editionId]);

  return session;
}
