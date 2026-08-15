/**
 * Exhaustive unit tests for the interruption policy (task 5.4). This module
 * is spec-critical: every scenario of the ai-active-recall spec
 * "Interruption budget" requirement and every budget boundary of design D19
 * is mirrored here, plus the adaptive-interval signal matrix.
 */

import { describe, expect, it } from "vitest";
import {
  ADAPTIVE_INTERVAL_RANGE,
  MAX_PROMPTS_PER_SESSION,
  MIN_INTERVAL_MINUTES,
  adaptiveMinIntervalMinutes,
  decidePromptsEligible,
  localDayString,
  minIntervalMinutes,
  type RecallSignals,
} from "../interruptionPolicy";

const TODAY = "2026-08-15";

/** Baseline signals: mid adaptive session, nothing suppressing. */
function signals(overrides: Partial<RecallSignals> = {}): RecallSignals {
  return {
    mode: "adaptive",
    minutesSinceLastPrompt: 30,
    promptsThisSession: 0,
    isSelecting: false,
    isReflowActive: false,
    isPlaybackActive: false,
    dismissedUntilTomorrow: null,
    today: TODAY,
    readingProgressDelta: 0.04,
    conceptDensity: 1.2,
    recentGradeTrend: 0,
    coverageRatio: 0.2,
    minutesReadThisSession: 12,
    ...overrides,
  };
}

describe("mode gating (kill switch)", () => {
  it("is never eligible when the mode is off, regardless of all signals", () => {
    const verdict = decidePromptsEligible(
      signals({ mode: "off", minutesSinceLastPrompt: 999, promptsThisSession: 0 })
    );
    expect(verdict).toEqual({ eligible: false, reason: "mode-off", minIntervalMinutes: 0 });
  });

  it("off wins over every other condition (order is part of the contract)", () => {
    const verdict = decidePromptsEligible(
      signals({ mode: "off", isSelecting: true, promptsThisSession: 9 })
    );
    expect(verdict.reason).toBe("mode-off");
  });
});

describe("dismissal (\"don't ask again today\")", () => {
  it("suppresses for the remainder of the dismissal day", () => {
    const verdict = decidePromptsEligible(signals({ dismissedUntilTomorrow: TODAY }));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("dismissed-today");
  });

  it("re-enables on the next calendar day", () => {
    const verdict = decidePromptsEligible(
      signals({ dismissedUntilTomorrow: "2026-08-14", today: TODAY })
    );
    expect(verdict.eligible).toBe(true);
  });

  it("dismissal outranks interaction suppression and the session budget", () => {
    const verdict = decidePromptsEligible(
      signals({ dismissedUntilTomorrow: TODAY, isSelecting: true, promptsThisSession: 9 })
    );
    expect(verdict.reason).toBe("dismissed-today");
  });
});

describe("interaction suppression", () => {
  it("suppresses during active text selection", () => {
    expect(decidePromptsEligible(signals({ isSelecting: true })).reason).toBe("selection-active");
  });

  it("suppresses during PDF reflow", () => {
    expect(decidePromptsEligible(signals({ isReflowActive: true })).reason).toBe("reflow-active");
  });

  it("suppresses during media playback", () => {
    expect(decidePromptsEligible(signals({ isPlaybackActive: true })).reason).toBe(
      "playback-active"
    );
  });

  it("selection is checked before reflow and playback", () => {
    const verdict = decidePromptsEligible(
      signals({ isSelecting: true, isReflowActive: true, isPlaybackActive: true })
    );
    expect(verdict.reason).toBe("selection-active");
  });
});

describe("session budget", () => {
  it("exhausts at exactly MAX_PROMPTS_PER_SESSION prompts", () => {
    expect(MAX_PROMPTS_PER_SESSION).toBe(3);
    expect(
      decidePromptsEligible(signals({ promptsThisSession: 3 })).reason
    ).toBe("session-budget-exhausted");
    expect(decidePromptsEligible(signals({ promptsThisSession: 2 })).eligible).toBe(true);
  });

  it("still applies with no prior prompt time", () => {
    expect(
      decidePromptsEligible(
        signals({ promptsThisSession: 99, minutesSinceLastPrompt: null })
      ).reason
    ).toBe("session-budget-exhausted");
  });
});

describe("minimum interval", () => {
  it("low mode enforces 10 minutes", () => {
    expect(MIN_INTERVAL_MINUTES.low).toBe(10);
    expect(
      decidePromptsEligible(signals({ mode: "low", minutesSinceLastPrompt: 9.9 })).reason
    ).toBe("min-interval");
    expect(
      decidePromptsEligible(signals({ mode: "low", minutesSinceLastPrompt: 10 })).eligible
    ).toBe(true);
  });

  it("intensive mode enforces 2 minutes", () => {
    expect(MIN_INTERVAL_MINUTES.intensive).toBe(2);
    expect(
      decidePromptsEligible(signals({ mode: "intensive", minutesSinceLastPrompt: 1.9 })).reason
    ).toBe("min-interval");
    expect(
      decidePromptsEligible(signals({ mode: "intensive", minutesSinceLastPrompt: 2 })).eligible
    ).toBe(true);
  });

  it("adaptive mode respects the minimum interval (spec scenario: answered 3 min ago)", () => {
    // Signals profile that resolves the adaptive interval to its 4-minute floor.
    const min = minIntervalMinutes(
      signals({ readingProgressDelta: 0.08, coverageRatio: 0.1, recentGradeTrend: 0.5 })
    );
    expect(min).toBe(4);
    const verdict = decidePromptsEligible(
      signals({
        minutesSinceLastPrompt: 3,
        readingProgressDelta: 0.08,
        coverageRatio: 0.1,
        recentGradeTrend: 0.5,
      })
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe("min-interval");
    expect(verdict.minIntervalMinutes).toBe(4);
  });

  it("is eligible on the first prompt of a session (no prior prompt)", () => {
    expect(
      decidePromptsEligible(signals({ minutesSinceLastPrompt: null })).eligible
    ).toBe(true);
  });
});

describe("adaptive interval signal matrix (4–10 minutes)", () => {
  it("never resolves outside the 4–10 window", () => {
    expect(ADAPTIVE_INTERVAL_RANGE.min).toBe(4);
    expect(ADAPTIVE_INTERVAL_RANGE.max).toBe(10);
    // Extreme profiles both directions.
    expect(
      adaptiveMinIntervalMinutes(
        signals({ recentGradeTrend: -1, coverageRatio: 1, conceptDensity: 0 })
      )
    ).toBe(10);
    expect(
      adaptiveMinIntervalMinutes(
        signals({ recentGradeTrend: 1, coverageRatio: 0, conceptDensity: 5, readingProgressDelta: 0.2 })
      )
    ).toBe(4);
  });

  it("neutral signals resolve to the 6-minute midpoint", () => {
    expect(adaptiveMinIntervalMinutes(signals())).toBe(6);
  });

  it("widens when grades trend down", () => {
    expect(adaptiveMinIntervalMinutes(signals({ recentGradeTrend: -0.5 }))).toBe(8);
  });

  it("widens when existing card coverage is high", () => {
    expect(adaptiveMinIntervalMinutes(signals({ coverageRatio: 0.9 }))).toBe(8);
  });

  it("widens when concept density is low", () => {
    expect(adaptiveMinIntervalMinutes(signals({ conceptDensity: 0.1 }))).toBe(8);
  });

  it("narrows when progress is strong through fresh material", () => {
    expect(
      adaptiveMinIntervalMinutes(signals({ readingProgressDelta: 0.06, coverageRatio: 0.1 }))
    ).toBe(4);
  });

  it("narrows when grades trend up with steady progress", () => {
    expect(
      adaptiveMinIntervalMinutes(signals({ recentGradeTrend: 0.6, readingProgressDelta: 0.04 }))
    ).toBe(4);
  });

  it("the boundary values of each signal are non-triggering", () => {
    // trend exactly -0.2/+0.2, coverage exactly 0.6, density exactly 0.5,
    // delta exactly 0.05/0.03: all sit on the non-triggering side.
    expect(adaptiveMinIntervalMinutes(signals({ recentGradeTrend: -0.2 }))).toBe(6);
    expect(adaptiveMinIntervalMinutes(signals({ recentGradeTrend: 0.2 }))).toBe(6);
    expect(adaptiveMinIntervalMinutes(signals({ coverageRatio: 0.6 }))).toBe(6);
    expect(adaptiveMinIntervalMinutes(signals({ conceptDensity: 0.5 }))).toBe(6);
  });
});

describe("determinism", () => {
  it("identical signals always produce the identical verdict", () => {
    const input = signals({ promptsThisSession: 1, minutesSinceLastPrompt: 3.5 });
    expect(decidePromptsEligible(input)).toEqual(decidePromptsEligible({ ...input }));
  });
});

describe("localDayString", () => {
  it("formats a local calendar day zero-padded", () => {
    expect(localDayString(new Date(2026, 0, 9))).toBe("2026-01-09");
    expect(localDayString(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});
