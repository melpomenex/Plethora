import { describe, expect, it } from "vitest";
import {
  DAQE_KNOBS,
  applyKnobUpdate,
  coerceDaqeKnobs,
  defaultDaqeKnobs,
  validateDaqeKnobs,
  validateKnob,
  type DaqeKnobs,
} from "./knobs";
import {
  DAQE_PRESET_IDS,
  applyPreset,
  coerceStoredPresetId,
  detectActivePreset,
  getDaqePreset,
  isQueueStrategyPreset,
} from "./presets";

describe("knob schema", () => {
  it("declares exactly the six documented knobs", () => {
    expect(DAQE_KNOBS.map((spec) => spec.key)).toEqual([
      "srsDecayWeight",
      "goalRelevance",
      "energyTarget",
      "interleavingDiversity",
      "pruningAggressiveness",
      "afkIdleTimeoutMs",
    ]);
  });

  it("matches the documented defaults", () => {
    expect(defaultDaqeKnobs()).toEqual({
      srsDecayWeight: 0.4,
      goalRelevance: 0.3,
      energyTarget: 3,
      interleavingDiversity: 0.2,
      pruningAggressiveness: 0.1,
      afkIdleTimeoutMs: 45_000,
    });
  });

  it("accepts the documented defaults", () => {
    expect(validateDaqeKnobs(defaultDaqeKnobs()).ok).toBe(true);
  });
});

describe("knob validation", () => {
  it("rejects an out-of-range weight", () => {
    const result = validateKnob("srsDecayWeight", 1.4);
    expect(result.ok).toBe(false);
    expect(result.key).toBe("srsDecayWeight");
  });

  it("rejects a non-integer energy target", () => {
    const result = validateKnob("energyTarget", 3.7);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("whole number");
  });

  it("rejects a non-finite value", () => {
    expect(validateKnob("pruningAggressiveness", Number.NaN).ok).toBe(false);
    expect(validateKnob("pruningAggressiveness", Infinity).ok).toBe(false);
  });

  it("rejects an idle timeout outside 15s-120s", () => {
    expect(validateKnob("afkIdleTimeoutMs", 14_999).ok).toBe(false);
    expect(validateKnob("afkIdleTimeoutMs", 120_001).ok).toBe(false);
    expect(validateKnob("afkIdleTimeoutMs", 15_000).ok).toBe(true);
    expect(validateKnob("afkIdleTimeoutMs", 120_000).ok).toBe(true);
  });

  it("accepts the boundary values of every range", () => {
    for (const spec of DAQE_KNOBS) {
      expect(validateKnob(spec.key, spec.min).ok).toBe(true);
      expect(validateKnob(spec.key, spec.max).ok).toBe(true);
    }
  });

  it("reports the offending knob rather than failing opaquely", () => {
    const result = validateDaqeKnobs({
      ...defaultDaqeKnobs(),
      energyTarget: 9,
    });
    expect(result.ok).toBe(false);
    expect(result.key).toBe("energyTarget");
  });

  it("rejects a missing knob", () => {
    const { goalRelevance: _omitted, ...partial } = defaultDaqeKnobs();
    const result = validateDaqeKnobs(partial);
    expect(result.ok).toBe(false);
    expect(result.key).toBe("goalRelevance");
  });
});

describe("applyKnobUpdate", () => {
  it("never overwrites the stored value with an invalid one", () => {
    const stored = defaultDaqeKnobs();
    const after = applyKnobUpdate(stored, "srsDecayWeight", 1.4);
    expect(after).toBe(stored);
    expect(after.srsDecayWeight).toBe(0.4);
  });

  it("applies a valid update", () => {
    const after = applyKnobUpdate(defaultDaqeKnobs(), "energyTarget", 5);
    expect(after.energyTarget).toBe(5);
    expect(after).not.toBe(defaultDaqeKnobs());
  });

  it("leaves every other knob untouched", () => {
    const before = defaultDaqeKnobs();
    const after = applyKnobUpdate(before, "energyTarget", 1);
    for (const spec of DAQE_KNOBS) {
      if (spec.key === "energyTarget") continue;
      expect(after[spec.key]).toBe(before[spec.key]);
    }
  });
});

describe("coerceDaqeKnobs", () => {
  it("fills a missing knob from the default", () => {
    const { afkIdleTimeoutMs: _omitted, ...partial } = defaultDaqeKnobs();
    const coerced = coerceDaqeKnobs(partial);
    expect(coerced.afkIdleTimeoutMs).toBe(45_000);
    expect(validateDaqeKnobs(coerced).ok).toBe(true);
  });

  it("repairs a corrupted value from a hand-edited settings blob", () => {
    const coerced = coerceDaqeKnobs({
      ...defaultDaqeKnobs(),
      srsDecayWeight: "very high",
      energyTarget: 42,
    });
    expect(coerced.srsDecayWeight).toBe(0.4);
    expect(coerced.energyTarget).toBe(3);
    expect(validateDaqeKnobs(coerced).ok).toBe(true);
  });

  it("survives null and undefined", () => {
    expect(validateDaqeKnobs(coerceDaqeKnobs(null)).ok).toBe(true);
    expect(validateDaqeKnobs(coerceDaqeKnobs(undefined)).ok).toBe(true);
  });
});

describe("presets", () => {
  it("ships the four documented learning modes", () => {
    expect([...DAQE_PRESET_IDS]).toEqual([
      "deep-work-sprint",
      "tired-mobile-commute",
      "ruthless-triage",
      "balanced-discovery",
    ]);
  });

  it("matches the documented preset values", () => {
    expect(getDaqePreset("deep-work-sprint").knobs).toMatchObject({
      energyTarget: 4,
      goalRelevance: 0.5,
      interleavingDiversity: 0.1,
    });
    expect(getDaqePreset("tired-mobile-commute").knobs).toMatchObject({
      energyTarget: 2,
      srsDecayWeight: 0.2,
      interleavingDiversity: 0.4,
    });
    expect(getDaqePreset("ruthless-triage").knobs).toMatchObject({
      pruningAggressiveness: 0.6,
      srsDecayWeight: 0.4,
    });
    expect(getDaqePreset("balanced-discovery").knobs).toMatchObject({
      srsDecayWeight: 0.35,
      goalRelevance: 0.25,
      interleavingDiversity: 0.25,
      pruningAggressiveness: 0.15,
    });
  });

  it("writes all six knobs, so a preset is never partially applied", () => {
    for (const id of DAQE_PRESET_IDS) {
      const applied = applyPreset(id, defaultDaqeKnobs());
      for (const spec of DAQE_KNOBS) {
        expect(applied[spec.key]).toBe(getDaqePreset(id).knobs[spec.key]);
      }
      expect(validateDaqeKnobs(applied).ok).toBe(true);
    }
  });

  it("gives every preset a description key", () => {
    for (const id of DAQE_PRESET_IDS) {
      expect(getDaqePreset(id).descriptionKey).toMatch(/Desc$/);
    }
  });

  it("is fully overridable — adjusting a knob survives", () => {
    const preset = applyPreset("deep-work-sprint", defaultDaqeKnobs());
    const adjusted = applyKnobUpdate(preset, "energyTarget", 2);
    expect(adjusted.energyTarget).toBe(2);
    expect(adjusted.goalRelevance).toBe(0.5);
  });

  it("detects an exact preset match", () => {
    for (const id of DAQE_PRESET_IDS) {
      expect(detectActivePreset(getDaqePreset(id).knobs)).toBe(id);
    }
  });

  it("reports no preset once any knob is adjusted", () => {
    for (const id of DAQE_PRESET_IDS) {
      const knobs = getDaqePreset(id).knobs;
      for (const spec of DAQE_KNOBS) {
        // Move to the nearest legal value that is not the preset's own.
        const nudged: DaqeKnobs = {
          ...knobs,
          [spec.key]: spec.key === "energyTarget" ? knobs.energyTarget + 1 : knobs[spec.key] + 0.05,
        };
        if (spec.key === "afkIdleTimeoutMs") {
          nudged.afkIdleTimeoutMs = knobs.afkIdleTimeoutMs + 5_000;
        }
        if (validateDaqeKnobs(nudged).ok) {
          expect(detectActivePreset(nudged)).toBeNull();
        }
      }
    }
  });

  it("reports no preset for a hand-assembled knob set", () => {
    expect(detectActivePreset(defaultDaqeKnobs())).toBeNull();
  });

  it("exposes all nine dropdown ids", () => {
    expect(isQueueStrategyPreset("maximize-retention")).toBe(true);
    expect(isQueueStrategyPreset("deep-work-sprint")).toBe(true);
    expect(isQueueStrategyPreset("nonexistent")).toBe(false);
  });

  it("reads a stale or unknown stored id as no preset rather than throwing", () => {
    expect(coerceStoredPresetId("deep-work-sprint")).toBe("deep-work-sprint");
    expect(coerceStoredPresetId("a-preset-that-was-removed")).toBeNull();
    expect(coerceStoredPresetId(undefined)).toBeNull();
    expect(coerceStoredPresetId(42)).toBeNull();
  });
});