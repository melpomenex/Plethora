/**
 * Audio feedback tests (task 11.6): chime volume respected, disabled chime
 * silent, duck restore exactness including pause-during-duck and overlapping
 * captures, manual volume change wins, and the failure earcon is distinct.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  playChime,
  duckAudio,
  unduckAudio,
  resetSharedAudioContextForTests,
  type FeedbackChimeType,
} from "../audioFeedback";
import { useSettingsStore, DEFAULT_HANDS_FREE_STUDY_SETTINGS } from "../../stores/settingsStore";

function setHandsFree(partial: Partial<typeof DEFAULT_HANDS_FREE_STUDY_SETTINGS>) {
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      handsFreeStudy: { ...DEFAULT_HANDS_FREE_STUDY_SETTINGS, ...partial },
    },
  });
}

function makeAudioElement(volume = 0.8): HTMLAudioElement {
  const el = {
    volume,
    paused: false,
    muted: false,
  } as HTMLAudioElement;
  return el;
}

describe("playChime", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setHandsFree({});
  });
  afterEach(() => vi.useRealTimers());

  interface ChimeCall {
    type: OscillatorType;
    freq: number;
    gain: number;
  }

  // The module caches ONE AudioContext, so every fake ctx instance must write
  // into whatever the current test's sink is (read at call time).
  let activeCalls: ChimeCall[] = [];

  class FakeAudioContext {
    currentTime = 0;
    state = "running";
    destination = {};
    createOscillator() {
      const osc = {
        type: "sine" as OscillatorType,
        frequency: {
          setValueAtTime: (freq: number) => activeCalls.push({ type: osc.type, freq, gain: 0 }),
          exponentialRampToValueAtTime: () => {},
          linearRampToValueAtTime: () => {},
        },
        connect: () => {},
        start: () => {},
        stop: () => {},
      };
      return osc;
    }
    createGain() {
      const self = this;
      let lastIdx = -1;
      return {
        gain: {
          setValueAtTime: () => {
            lastIdx = activeCalls.length - 1;
          },
          exponentialRampToValueAtTime: (v: number) => {
            if (lastIdx >= 0 && lastIdx < activeCalls.length) {
              activeCalls[lastIdx].gain = Math.max(activeCalls[lastIdx].gain, v);
            }
          },
          linearRampToValueAtTime: () => {},
        },
        connect: () => {},
        resume() {
          void self;
          return Promise.resolve();
        },
      };
    }
  }

  function freshChimeSpy(): ChimeCall[] {
    activeCalls = [];
    // The module caches one AudioContext across the whole suite; drop it so
    // this test's fake class is the one that gets created.
    resetSharedAudioContextForTests();
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: FakeAudioContext,
    });
    return activeCalls;
  }

  it("produces sound when enabled with the configured volume", () => {
    setHandsFree({ chimeEnabled: true, chimeVolume: 0.5 });
    const calls = freshChimeSpy();
    playChime("extract_captured");
    expect(calls.length).toBeGreaterThan(0);
    // Peak gain ≈ profile gain × configured volume.
    const peak = Math.max(...calls.map((c) => c.gain));
    expect(peak).toBeCloseTo(0.2 * 0.5, 2);
  });

  it("is silent when chimeEnabled is false", () => {
    setHandsFree({ chimeEnabled: false, chimeVolume: 0.9 });
    const calls = freshChimeSpy();
    playChime("extract_captured");
    expect(calls.length).toBe(0);
  });

  it("is silent at zero volume", () => {
    setHandsFree({ chimeEnabled: true, chimeVolume: 0 });
    const calls = freshChimeSpy();
    playChime("bookmark_added");
    expect(calls.length).toBe(0);
  });

  it("the failure earcon uses a harsh square profile distinct from every success earcon", () => {
    const calls = freshChimeSpy();
    playChime("action_failed");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].type).toBe("square");
    const success: FeedbackChimeType[] = [
      "extract_captured",
      "extract_extended",
      "bookmark_added",
      "interesting_marked",
      "confusing_flagged",
      "ask_enqueued",
      "mode_study",
      "mode_normal",
    ];
    for (const type of success) {
      const next = freshChimeSpy();
      playChime(type);
      expect(next[0].type).not.toBe("square");
    }
  });

  it("every earcon type in the set is playable without throwing", () => {
    freshChimeSpy();
    const all: FeedbackChimeType[] = [
      "extract_captured",
      "extract_extended",
      "bookmark_added",
      "interesting_marked",
      "confusing_flagged",
      "ask_enqueued",
      "action_failed",
      "mode_study",
      "mode_normal",
    ];
    for (const type of all) {
      expect(() => playChime(type)).not.toThrow();
    }
  });
});

describe("duckAudio restore semantics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("restores the EXACT prior volume after the duck window", () => {
    const el = makeAudioElement(0.8);
    duckAudio(el, 0.25, 600);
    expect(el.volume).toBeCloseTo(0.2, 5);
    vi.advanceTimersByTime(650);
    expect(el.volume).toBe(0.8);
  });

  it("restores even when playback was paused during the duck (no stranded volume)", () => {
    const el = makeAudioElement(0.7);
    (el as any).paused = true;
    duckAudio(el, 0.5, 500);
    expect(el.volume).toBeCloseTo(0.35, 5);
    vi.advanceTimersByTime(600);
    expect(el.volume).toBe(0.7);
  });

  it("a manual volume change during the duck wins (restore skipped)", () => {
    const el = makeAudioElement(0.9);
    duckAudio(el, 0.25, 500); // ducked to 0.225
    el.volume = 0.6; // user manually changed it mid-duck
    vi.advanceTimersByTime(600);
    expect(el.volume).toBe(0.6);
  });

  it("overlapping captures do not chain ducked volumes or restore stale values", () => {
    const el = makeAudioElement(1.0);
    duckAudio(el, 0.25, 500); // → 0.25
    expect(el.volume).toBeCloseTo(0.25, 5);
    vi.advanceTimersByTime(300);
    duckAudio(el, 0.25, 500); // second capture mid-duck
    // Still ducked to the ORIGINAL target (not 0.25×0.25).
    expect(el.volume).toBeCloseTo(0.25, 5);
    vi.advanceTimersByTime(600);
    expect(el.volume).toBe(1.0);
  });

  it("unduckAudio restores immediately", () => {
    const el = makeAudioElement(0.5);
    duckAudio(el, 0.2, 10_000);
    expect(el.volume).toBeCloseTo(0.1, 5);
    unduckAudio(el);
    expect(el.volume).toBe(0.5);
  });

  it("null element is a no-op", () => {
    expect(() => duckAudio(null, 0.25, 500)).not.toThrow();
  });
});
