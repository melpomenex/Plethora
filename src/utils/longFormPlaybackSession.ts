/**
 * Shared long-form playback session primitives.
 *
 * The registry is intentionally small: it is a coordination point for the
 * browser/native adapters, not a second audio engine. Playback hosts still own
 * their audio element or speech engine; this module gives every host the same
 * identity, snapshot, and lifecycle semantics.
 */

import type {
  LongFormPlaybackSession,
  LongFormPlaybackSourceKind,
  LongFormPlaybackStateSnapshot,
} from "../types/audioEdition";

export function createLongFormSessionId(sourceKind: LongFormPlaybackSourceKind, sourceId: string): string {
  return `${sourceKind}:${sourceId}`;
}

export function isSamePlaybackSource(
  left: Pick<LongFormPlaybackStateSnapshot, "metadata"> | null | undefined,
  right: Pick<LongFormPlaybackStateSnapshot, "metadata"> | null | undefined,
): boolean {
  return Boolean(
    left &&
      right &&
      left.metadata.sourceId === right.metadata.sourceId &&
      left.metadata.sessionId === right.metadata.sessionId,
  );
}

export function isNewerPlaybackSnapshot(
  incoming: LongFormPlaybackStateSnapshot,
  current: LongFormPlaybackStateSnapshot | null | undefined,
): boolean {
  if (!current) return true;
  if (!isSamePlaybackSource(incoming, current)) return true;
  return incoming.updatedAt >= current.updatedAt;
}

/**
 * One active host per app. Re-registering the same session is idempotent;
 * registering a new source replaces the old host atomically.
 */
class LongFormPlaybackSessionRegistry {
  private active: LongFormPlaybackSession | null = null;

  attach(session: LongFormPlaybackSession): LongFormPlaybackSession | null {
    if (this.active?.sessionId === session.sessionId) {
      this.active = session;
      return session;
    }
    const previous = this.active;
    this.active = session;
    return previous;
  }

  detach(sessionId: string): void {
    if (this.active?.sessionId === sessionId) this.active = null;
  }

  getActive(): LongFormPlaybackSession | null {
    return this.active;
  }

  reset(): void {
    this.active = null;
  }
}

export const longFormPlaybackSessions = new LongFormPlaybackSessionRegistry();
