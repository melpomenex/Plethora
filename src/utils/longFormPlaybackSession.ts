/**
 * Shared long-form playback session primitives.
 *
 * When global persistent audio playback is active, ordinary media ownership lives
 * in `GlobalAudioController` / `NativeAudioAdapter`, and `getActive()` serves as
 * a read-only compatibility facade over that owner (yielding to an active speech
 * engine while TTS holds audio focus). Legacy attach/detach remains intact when
 * no owner provider is bound.
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

function isSpeechKind(kind: LongFormPlaybackSourceKind): boolean {
  return kind === "reader_tts" || kind === "generated_audio" || kind === "web_speech" || kind === "native_android_tts";
}

/**
 * One active host per app. When an authoritative owner provider is registered,
 * ordinary audio sessions are projected via compatibility reads rather than
 * view-driven registry mutation.
 */
class LongFormPlaybackSessionRegistry {
  private active: LongFormPlaybackSession | null = null;
  private ownerProvider: (() => LongFormPlaybackSession | null) | null = null;
  private listeners = new Set<() => void>();

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setOwnerSessionProvider(provider: (() => LongFormPlaybackSession | null) | null): void {
    this.ownerProvider = provider;
    if (provider && this.active && !isSpeechKind(this.active.sourceKind)) {
      this.active = null;
    }
    this.notify();
  }

  notifyOwnerChanged(): void {
    this.notify();
  }

  attach(session: LongFormPlaybackSession): LongFormPlaybackSession | null {
    // Ordinary media views never mutate the registry when the global owner is bound.
    if (this.ownerProvider && !isSpeechKind(session.sourceKind)) {
      return this.getActive();
    }
    if (this.active?.sessionId === session.sessionId) {
      this.active = session;
      this.notify();
      return session;
    }
    const previous = this.getActive();
    this.active = session;
    this.notify();
    return previous;
  }

  detach(sessionId: string): void {
    if (this.active?.sessionId === sessionId) {
      this.active = null;
      this.notify();
    }
  }

  getActive(): LongFormPlaybackSession | null {
    const ownerSession = this.ownerProvider?.() ?? null;
    if (this.ownerProvider) {
      if (this.active && isSpeechKind(this.active.sourceKind)) {
        const ownerState = ownerSession?.getSnapshot().state;
        if (!ownerSession || ownerState !== "playing") {
          return this.active;
        }
      }
      return ownerSession;
    }
    return this.active;
  }

  reset(): void {
    this.active = null;
    this.ownerProvider = null;
    this.notify();
  }
}

export const longFormPlaybackSessions = new LongFormPlaybackSessionRegistry();
