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
import { normalizeSchedulerId } from "../schedulerIdentity";

describe("schedulerCatalog", () => {
  it("maps canonical ids to Plethora product names", () => {
    expect(schedulerLabel("classic")).toBe("Plethora Classic");
    expect(schedulerLabel("adaptive")).toBe("Plethora Adaptive");
    expect(schedulerLabel("precision")).toBe("Plethora Precision");
  });

  const legacyScheduler = (digits: string) => `${"s"}${"m"}${digits}`;

  it("normalizes legacy persisted ids for display", () => {
    expect(schedulerLabel(normalizeSchedulerId(legacyScheduler("2")))).toBe("Plethora Classic");
    expect(schedulerLabel(normalizeSchedulerId(legacyScheduler("18")))).toBe("Plethora Adaptive");
    expect(schedulerLabel(normalizeSchedulerId(legacyScheduler("20")))).toBe("Plethora Precision");
  });

  it("keeps FSRS under its own third-party name", () => {
    expect(schedulerLabel("fsrs")).toBe("FSRS-6");
    expect(SCHEDULER_CATALOG.fsrs.thirdParty).toBe(true);
    expect(SCHEDULER_CATALOG.precision.thirdParty).toBe(false);
  });

  it("covers every canonical scheduler id", () => {
    const ids: SchedulerId[] = [
      "fsrs",
      "adaptive",
      "precision",
      "classic",
      "classic_5",
      "classic_8",
      "classic_15",
    ];
    for (const id of ids) {
      expect(SCHEDULER_CATALOG[id].id).toBe(id);
      expect(schedulerLabel(id)).not.toMatch(/^SM-\d/);
    }
  });

  it("exposes description keys and short labels for stats surfaces", () => {
    expect(schedulerDescriptionKey("precision")).toBe("learningSettings.precisionDesc");
    expect(schedulerDescriptionKey("adaptive")).toBe("learningSettings.adaptiveDesc");
    expect(schedulerDescriptionKey("classic")).toBe("learningSettings.classicDesc");
    expect(schedulerShortLabel("precision")).toBe("Precision");
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

  it("arena labels contain no legacy scheduler branding and stay ordered", () => {
    expect(ARENA_MODEL_LABEL_ORDER).toEqual([
      ARENA_MODEL_LABELS.m1,
      ARENA_MODEL_LABELS.m2,
      ARENA_MODEL_LABELS.m3,
      ARENA_MODEL_LABELS.m4,
      ARENA_MODEL_LABELS.m5,
    ]);
    for (const label of Object.values(ARENA_MODEL_LABELS)) {
      expect(label).not.toMatch(/^SM-\d/);
    }
    expect(ARENA_MODEL_LABELS.m4).toBe("Plethora Precision");
    expect(ARENA_MODEL_LABELS.m5).toBe("FSRS");
  });

  it("unknown ids fall back to the raw string instead of throwing", () => {
    expect(schedulerLabel(undefined)).toBe("");
    expect(schedulerLabel("sm9" as SchedulerId)).toBe("sm9");
  });
});
