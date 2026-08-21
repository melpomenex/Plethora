import { describe, expect, it, beforeEach } from "vitest";
import {
  createLongFormSessionId,
  isNewerPlaybackSnapshot,
  isSamePlaybackSource,
  longFormPlaybackSessions,
} from "../longFormPlaybackSession";
import type { LongFormPlaybackSession, LongFormPlaybackStateSnapshot } from "../../types/audioEdition";

function snapshot(overrides: Partial<LongFormPlaybackStateSnapshot> = {}): LongFormPlaybackStateSnapshot {
  return {
    metadata: {
      sourceId: "source-a",
      sourceKind: "audio_edition",
      sessionId: createLongFormSessionId("audio_edition", "source-a"),
      title: "A source",
    },
    state: "playing",
    positionSec: 10,
    durationSec: 100,
    playbackRate: 1,
    capabilities: {
      canPlay: true,
      canPause: true,
      canResume: true,
      canSeekRelative: true,
      canSeekAbsolute: true,
      precisePosition: true,
      canNext: true,
      canPrevious: true,
    },
    updatedAt: 10,
    ...overrides,
  };
}

function session(id: string, sourceId = id): LongFormPlaybackSession {
  return {
    sessionId: id,
    sourceId,
    sourceKind: "reader_tts",
    getSnapshot: () => snapshot({ metadata: { ...snapshot().metadata, sessionId: id, sourceId } }),
    play: () => undefined,
    pause: () => undefined,
    toggle: () => undefined,
  };
}

describe("long-form playback session contract", () => {
  beforeEach(() => longFormPlaybackSessions.reset());

  it("uses a stable identity for idempotent remounts", () => {
    expect(createLongFormSessionId("audio_edition", "ed-1")).toBe("audio_edition:ed-1");
    const first = session("reader_tts:doc-1", "doc-1");
    const second = session("reader_tts:doc-1", "doc-1");
    expect(longFormPlaybackSessions.attach(first)).toBeNull();
    expect(longFormPlaybackSessions.attach(second)).toBe(second);
    expect(longFormPlaybackSessions.getActive()).toBe(second);
  });

  it("replaces the active source and never lets an old snapshot win", () => {
    const oldSnapshot = snapshot({ updatedAt: 100 });
    const newSnapshot = snapshot({
      updatedAt: 1,
      metadata: { ...snapshot().metadata, sourceId: "source-b", sessionId: "audio_edition:source-b" },
    });
    expect(isSamePlaybackSource(oldSnapshot, newSnapshot)).toBe(false);
    expect(isNewerPlaybackSnapshot(newSnapshot, oldSnapshot)).toBe(true);
  });

  it("uses monotonic freshness for updates from the active source", () => {
    const current = snapshot({ updatedAt: 20 });
    expect(isNewerPlaybackSnapshot(snapshot({ updatedAt: 19 }), current)).toBe(false);
    expect(isNewerPlaybackSnapshot(snapshot({ updatedAt: 21 }), current)).toBe(true);
  });
});
