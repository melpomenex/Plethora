/**
 * Companion engine + policy tests (spec: companion-runtime).
 * Deterministic: inject the clock and settings explicitly.
 */
import { describe, expect, it } from "vitest";
import { createCompanionEngine, ambientReaction } from "../engine";
import { cooldownMs, decideSpeech, eventAllowedBySettings, sessionBudget } from "../policy";
import { DEFAULT_COMPANION_SETTINGS, type CompanionContext } from "../types";

function ctx(overrides: Partial<CompanionContext> = {}): CompanionContext {
  return {
    now: 1_000_000,
    settings: { ...DEFAULT_COMPANION_SETTINGS },
    msSinceLastSpeech: Infinity,
    sessionSpeechCount: 0,
    recentSpeechKeys: [],
    typingActive: false,
    reviewDecisionActive: false,
    modalOrFocusActive: false,
    ...overrides,
  };
}

describe("companion policy", () => {
  it("suppresses speech while typing, deciding a review, or in a modal", () => {
    for (const override of [
      { typingActive: true },
      { reviewDecisionActive: true },
      { modalOrFocusActive: true },
    ]) {
      const decision = decideSpeech(ctx(override), "companion.welcomeBack");
      expect(decision.allow, String(override)).toBe(false);
      expect(decision.reason).toBe("suppressed-context");
    }
  });

  it("enforces the cooldown between unsolicited bubbles", () => {
    const decision = decideSpeech(
      ctx({ msSinceLastSpeech: cooldownMs("normal") - 1 }),
      "companion.welcomeBack"
    );
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("cooldown");
    expect(decideSpeech(ctx({ msSinceLastSpeech: cooldownMs("normal") }), "x").allow).toBe(true);
  });

  it("budgets speech per session, scaled by frequency", () => {
    expect(sessionBudget("quiet")).toBeLessThan(sessionBudget("chatty"));
    const exhausted = decideSpeech(
      ctx({ sessionSpeechCount: sessionBudget("normal") }),
      "companion.welcomeBack"
    );
    expect(exhausted.allow).toBe(false);
    expect(exhausted.budgetExhausted).toBe(true);
  });

  it("does not repeat recent lines", () => {
    const decision = decideSpeech(
      ctx({ recentSpeechKeys: ["a", "companion.welcomeBack"] }),
      "companion.welcomeBack"
    );
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("no-repeat");
  });

  it("gates event categories by user preference", () => {
    const off = { contextualComments: false, encouragement: false };
    expect(eventAllowedBySettings({ type: "highlight_created" }, off)).toBe(false);
    expect(eventAllowedBySettings({ type: "review_correct" }, off)).toBe(false);
    expect(eventAllowedBySettings({ type: "app_launched" }, off)).toBe(true);
  });
});

describe("companion engine", () => {
  it("launch produces a welcome talk with speech", () => {
    const engine = createCompanionEngine();
    const reaction = engine.react({ type: "app_launched" }, ctx());
    expect(reaction?.state).toBe("talk");
    expect(reaction?.speechKey).toBe("companion.welcomeBack");
  });

  it("streaks of 5+ celebrate with a line; plain correct answers animate only", () => {
    const engine = createCompanionEngine();
    const streak = engine.react({ type: "review_correct", streak: 6 }, ctx());
    expect(streak?.state).toBe("celebrate");
    expect(streak?.speechKey).toBe("companion.streak");

    const plain = engine.react({ type: "review_correct", streak: 1 }, ctx({ now: 2_000_000 }));
    expect(plain?.state).toBe("celebrate");
    expect(plain?.speechKey).toBeUndefined();
  });

  it("drops speech but keeps animation when the policy vetoes the bubble", () => {
    const engine = createCompanionEngine();
    const reaction = engine.react(
      { type: "highlight_created" },
      ctx({ msSinceLastSpeech: 1000 })
    );
    expect(reaction?.state).toBe("curious");
    expect(reaction?.speechKey).toBeUndefined();
  });

  it("debounces repeated events of the same type", () => {
    const engine = createCompanionEngine();
    expect(engine.react({ type: "card_created" }, ctx())).toBeTruthy();
    const soon = engine.react({ type: "card_created" }, ctx({ now: ctx().now + 1000 }));
    // Animation may still play; the speech is dropped.
    expect(soon?.speechKey ?? undefined).toBeUndefined();
    const later = engine.react(
      { type: "card_created" },
      ctx({ now: ctx().now + 60_000, msSinceLastSpeech: Infinity })
    );
    expect(later?.speechKey).toBe("companion.cardCreated");
  });

  it("honors category preferences (encouragement off silences review events)", () => {
    const engine = createCompanionEngine();
    const reaction = engine.react(
      { type: "review_session_completed", count: 12 },
      ctx({ settings: { ...DEFAULT_COMPANION_SETTINGS, encouragement: false } })
    );
    expect(reaction).toBeNull();
  });

  it("ambient behavior is deterministic and sleeps after long inactivity", () => {
    const sleepy = ambientReaction(0.1, ctx({ msSinceLastSpeech: 45 * 60_000 }));
    expect(sleepy.state).toBe("sleep");
    expect(ambientReaction(0.1, ctx({ msSinceLastSpeech: 45 * 60_000 })).state).toBe("sleep");
    const active = ctx({ msSinceLastSpeech: 60_000 });
    expect(ambientReaction(0.4, active).state).toBe("look");
    expect(ambientReaction(0.9, active).state).toBe("idle");
  });
});
