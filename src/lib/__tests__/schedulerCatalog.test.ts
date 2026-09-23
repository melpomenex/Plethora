import { describe, expect, it } from "vitest";
import {
  ARENA_MODEL_LABEL_ORDER,
  ARENA_MODEL_LABELS,
  PRODUCTION_SCHEDULER_ID,
  SCHEDULER_CATALOG,
  SCHEDULER_LIFECYCLE,
  SELECTABLE_SCHEDULERS,
  isProductionScheduler,
  normalizeToProductionScheduler,
  schedulerDescriptionKey,
  schedulerLabel,
  schedulerShortLabel,
  type SchedulerId,
} from "../schedulerCatalog";
import { getRatingSchema, SIX_GRADE_RATING_SCHEMA, FOUR_GRADE_RATING_SCHEMA } from "../rating-grades";
import { normalizeSchedulerId } from "../schedulerIdentity";

describe("schedulerCatalog", () => {
  it("maps canonical ids to restored SM algorithm names", () => {
    expect(schedulerLabel("classic")).toBe("SM-2");
    expect(schedulerLabel("adaptive")).toBe("SM-18");
    expect(schedulerLabel("precision")).toBe("SM-20");
    expect(schedulerLabel("fsrs")).toBe("FSRS-7");
  });

  it("normalizes legacy persisted ids for display", () => {
    expect(schedulerLabel(normalizeSchedulerId("sm2"))).toBe("SM-2");
    expect(schedulerLabel(normalizeSchedulerId("sm18"))).toBe("SM-18");
    expect(schedulerLabel(normalizeSchedulerId("sm20"))).toBe("SM-20");
  });

  it("keeps FSRS under its own third-party name", () => {
    expect(schedulerLabel("fsrs")).toBe("FSRS-7");
    expect(SCHEDULER_CATALOG.fsrs.thirdParty).toBe(true);
    expect(SCHEDULER_CATALOG.precision.thirdParty).toBe(false);
  });

  it("covers every canonical scheduler id", () => {
    const ids: SchedulerId[] = [
      "fsrs",
      "precision",
      "adaptive",
      "classic",
      "classic_5",
      "classic_8",
      "classic_15",
    ];
    for (const id of ids) {
      expect(SCHEDULER_CATALOG[id].id).toBe(id);
    }
  });

  it("exposes description keys and short labels for stats surfaces", () => {
    expect(schedulerDescriptionKey("precision")).toBe("learningSettings.precisionDesc");
    expect(schedulerDescriptionKey("adaptive")).toBe("learningSettings.adaptiveDesc");
    expect(schedulerDescriptionKey("classic")).toBe("learningSettings.classicDesc");
    expect(schedulerShortLabel("precision")).toBe("SM-20");
    expect(schedulerShortLabel("adaptive")).toBe("SM-18");
    expect(schedulerShortLabel("classic")).toBe("SM-2");
  });

  it("offers FSRS-7, SM-20, SM-18, SM-2 in the main selector", () => {
    expect(SELECTABLE_SCHEDULERS.map((s) => s.id)).toEqual([
      "fsrs",
      "precision",
      "adaptive",
      "classic",
    ]);
    expect(SELECTABLE_SCHEDULERS.map((s) => s.label)).toEqual([
      "FSRS-7",
      "SM-20",
      "SM-18",
      "SM-2",
    ]);
  });

  it("marks all four user-facing schedulers as production", () => {
    expect(SCHEDULER_LIFECYCLE.fsrs).toBe("production");
    expect(SCHEDULER_LIFECYCLE.precision).toBe("production");
    expect(SCHEDULER_LIFECYCLE.adaptive).toBe("production");
    expect(SCHEDULER_LIFECYCLE.classic).toBe("production");
    expect(isProductionScheduler("fsrs")).toBe(true);
    expect(isProductionScheduler("precision")).toBe(true);
    expect(isProductionScheduler("adaptive")).toBe(true);
    expect(isProductionScheduler("classic")).toBe(true);
    expect(isProductionScheduler("classic_5")).toBe(false);
  });

  it("normalizes legacy aliases to corresponding production schedulers", () => {
    expect(normalizeToProductionScheduler("precision")).toBe("precision");
    expect(normalizeToProductionScheduler("sm20")).toBe("precision");
    expect(normalizeToProductionScheduler("sm18")).toBe("adaptive");
    expect(normalizeToProductionScheduler("sm2")).toBe("classic");
    expect(normalizeToProductionScheduler(undefined)).toBe("fsrs");
  });

  it("keeps rating semantics tied to ids, not labels", () => {
    expect(getRatingSchema("adaptive")).toBe(SIX_GRADE_RATING_SCHEMA);
    expect(getRatingSchema("precision")).toBe(SIX_GRADE_RATING_SCHEMA);
    expect(getRatingSchema("classic")).toBe(FOUR_GRADE_RATING_SCHEMA);
    expect(getRatingSchema("fsrs")).toBe(FOUR_GRADE_RATING_SCHEMA);
  });

  it("arena labels match restored historical algorithm names and stay ordered", () => {
    expect(ARENA_MODEL_LABEL_ORDER).toEqual([
      "SM-2",
      "SM-15",
      "SM-19",
      "SM-20",
      "FSRS",
    ]);
    expect(ARENA_MODEL_LABELS.m1).toBe("SM-2");
    expect(ARENA_MODEL_LABELS.m2).toBe("SM-15");
    expect(ARENA_MODEL_LABELS.m3).toBe("SM-19");
    expect(ARENA_MODEL_LABELS.m4).toBe("SM-20");
    expect(ARENA_MODEL_LABELS.m5).toBe("FSRS");
  });

  it("unknown ids fall back to the raw string instead of throwing", () => {
    expect(schedulerLabel(undefined)).toBe("");
    expect(schedulerLabel("sm9" as SchedulerId)).toBe("sm9");
  });
});
