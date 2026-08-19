/**
 * Listening Session Lifecycle Service (design Decision 10)
 *
 * Single shared registry for the "current" listening session so the audio
 * player and the hands-free dispatcher agree on one session per edition:
 * create/resume within the 15-minute window, touch on activity, close on
 * inactivity (2 min), content change, or player close — without spawning
 * micro-sessions on brief pauses.
 */

import {
  createListeningSession,
  endListeningSession,
  getActiveListeningSession,
} from "../api/listeningSessions";
import type { ListeningSession } from "../types/audioEdition";

/** Resume an earlier session whose last activity is younger than this. */
export const SESSION_RESUME_WINDOW_MS = 15 * 60 * 1000;
/** Close the session after playback has been paused this long. */
export const SESSION_INACTIVITY_CLOSE_MS = 2 * 60 * 1000;

interface ActiveSessionEntry {
  session: ListeningSession;
  lastActivityAt: number;
}

/** editionId → active session entry (module-scoped: one player per app). */
const activeSessions = new Map<string, ActiveSessionEntry>();

function pruneStaleEntries(): void {
  const now = Date.now();
  for (const [editionId, entry] of activeSessions) {
    if (
      entry.session.endedAt ||
      now - entry.lastActivityAt > SESSION_RESUME_WINDOW_MS
    ) {
      activeSessions.delete(editionId);
    }
  }
}

/**
 * Return the current listening session for an edition, resuming a recent one
 * (within `SESSION_RESUME_WINDOW_MS` of its last activity) or creating a new
 * one. All hands-free captures append to this session.
 */
export async function ensureListeningSession(
  editionId: string
): Promise<ListeningSession | null> {
  try {
    pruneStaleEntries();

    const cached = activeSessions.get(editionId);
    if (cached && !cached.session.endedAt) {
      cached.lastActivityAt = Date.now();
      return cached.session;
    }

    // Resume the most recent open session for this edition when it is still
    // inside the resume window (its startedAt is the activity proxy — the
    // backend stores no per-item activity heartbeat).
    const open = await getActiveListeningSession(editionId);
    if (open && !open.endedAt && Date.now() - open.startedAt <= SESSION_RESUME_WINDOW_MS) {
      const entry = { session: open, lastActivityAt: Date.now() };
      activeSessions.set(editionId, entry);
      return open;
    }

    const created = await createListeningSession({ editionId });
    activeSessions.set(editionId, { session: created, lastActivityAt: Date.now() });
    return created;
  } catch (err) {
    console.warn("[listeningSession] failed to ensure session:", err);
    return null;
  }
}

/** Mark activity on a session so it survives the resume-window prune. */
export function touchListeningSession(editionId: string, sessionId?: string): void {
  const cached = activeSessions.get(editionId);
  if (cached && (!sessionId || cached.session.id === sessionId)) {
    cached.lastActivityAt = Date.now();
  }
}

/**
 * Close the active session for an edition (player unmount, content change,
 * explicit end, or inactivity timeout). Safe to call repeatedly.
 */
export async function closeListeningSession(editionId: string): Promise<void> {
  const cached = activeSessions.get(editionId);
  activeSessions.delete(editionId);
  if (!cached || cached.session.endedAt) return;

  const durationSeconds = Math.max(
    0,
    Math.round((Date.now() - cached.session.startedAt) / 1000)
  );
  try {
    await endListeningSession(
      cached.session.id,
      Date.now(),
      durationSeconds,
      cached.session.extractCount
    );
  } catch (err) {
    console.warn("[listeningSession] failed to end session:", err);
  }
}

/** The currently active session for an edition, if any (no I/O). */
export function getActiveSession(editionId: string): ListeningSession | null {
  const cached = activeSessions.get(editionId);
  return cached && !cached.session.endedAt ? cached.session : null;
}
