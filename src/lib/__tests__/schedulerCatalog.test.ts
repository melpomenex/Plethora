import { describe, expect, it } from "vitest";
import {
  ARENA_MODEL_LABEL_ORDER,
  ARENA_MODEL_LABELS,
  SCHEDULER_CATALOG,
  SELECTABLE_SCHEDULERS,
  schedulerDescriptionKey,
  schedulerLabel,
  schedulerShortLabel,
  type SchedulerId,
} from "../schedulerCatalog";
import { getRatingSchema, SIX_GRADE_RATING_SCHEMA, FOUR_GRADE_RATING_SCHEMA } from "../rating-grades";

describe("schedulerCatalog", () => {
  it("maps persisted ids to Plethora product names", () => {
    expect(schedulerLabel("sm2")).toBe("Plethora Classic");
    expect(schedulerLabel("sm18")).toBe("Plethora Adaptive");
    expect(schedulerLabel("sm20")).toBe("Plethora Precision");
  });

  it("keeps FSRS under its own third-party name", () => {
    expect(schedulerLabel("fsrs")).toBe("FSRS-6");
    expect(SCHEDULER_CATALOG.fsrs.thirdParty).toBe(true);
    expect(SCHEDULER_CATALOG.sm20.thirdParty).toBe(false);
  });

  it("covers every persisted scheduler id without renaming ids", () => {
    const ids: SchedulerId[] = ["fsrs", "sm2", "sm5", "sm8", "sm15", "sm18", "sm20"];
    for (const id of ids) {
      expect(SCHEDULER_CATALOG[id].id).toBe(id);
      expect(schedulerLabel(id)).not.toMatch(/^SM-\d/);
    }
  });

  it("exposes description keys and short labels for stats surfaces", () => {
    expect(schedulerDescriptionKey("sm20")).toBe("learningSettings.precisionDesc");
    expect(schedulerDescriptionKey("sm18")).toBe("learningSettings.adaptiveDesc");
    expect(schedulerDescriptionKey("sm2")).toBe("learningSettings.classicDesc");
    expect(schedulerShortLabel("sm20")).toBe("Precision");
  });

  it("offers the main selector set (fsrs/adaptive/precision/classic)", () => {
    expect(SELECTABLE_SCHEDULERS.map((s) => s.id)).toEqual(["fsrs", "adaptive", "precision", "classic"]);
  });

  it("keeps rating semantics tied to ids, not labels", () => {
    expect(getRatingSchema("adaptive")).toBe(SIX_GRADE_RATING_SCHEMA);
    expect(getRatingSchema("precision")).toBe(SIX_GRADE_RATING_SCHEMA);
    expect(getRatingSchema("classic")).toBe(FOUR_GRADE_RATING_SCHEMA);
    expect(getRatingSchema("fsrs")).toBe(FOUR_GRADE_RATING_SCHEMA);
  });

  it("arena labels contain no SuperMemo-derived branding and stay ordered", () => {
    expect(ARENA_MODEL_LABEL_ORDER).toEqual([
      ARENA_MODEL_LABELS.sm2,
      ARENA_MODEL_LABELS.sm15,
      ARENA_MODEL_LABELS.sm19,
      ARENA_MODEL_LABELS.sm20,
      ARENA_MODEL_LABELS.fsrs,
    ]);
    for (const label of Object.values(ARENA_MODEL_LABELS)) {
      expect(label).not.toMatch(/^SM-\d/);
    }
    expect(ARENA_MODEL_LABELS.sm20).toBe("Plethora Precision");
    expect(ARENA_MODEL_LABELS.fsrs).toBe("FSRS");
  });

  it("unknown ids fall back to the raw string instead of throwing", () => {
    expect(schedulerLabel(undefined)).toBe("");
    expect(schedulerLabel("sm9" as SchedulerId)).toBe("sm9");
  });
});
