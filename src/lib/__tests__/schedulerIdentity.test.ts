import { describe, expect, it } from "vitest";
import {
  isProductionScheduler,
  LEGACY_SCHEDULER_IDS,
  normalizeArenaModelId,
  normalizeSchedulerId,
  normalizeToProductionScheduler,
  PRODUCTION_SCHEDULER_IDS,
} from "../schedulerIdentity";

describe("schedulerIdentity", () => {
  it("keeps canonical scheduler ids unchanged", () => {
    expect(normalizeSchedulerId("precision")).toBe("precision");
    expect(normalizeSchedulerId("adaptive")).toBe("adaptive");
    expect(normalizeSchedulerId("classic")).toBe("classic");
    expect(normalizeSchedulerId("fsrs")).toBe("fsrs");
    expect(normalizeSchedulerId("classic_15")).toBe("classic_15");
  });

  it("maps legacy scheduler ids to canonical ids", () => {
    expect(normalizeSchedulerId("sm20")).toBe("precision");
    expect(normalizeSchedulerId("sm18")).toBe("adaptive");
    expect(normalizeSchedulerId("sm2")).toBe("classic");
    expect(LEGACY_SCHEDULER_IDS["sm15"]).toBe("classic_15");
  });

  it("identifies all four user-facing schedulers as production", () => {
    expect(PRODUCTION_SCHEDULER_IDS).toEqual(["fsrs", "precision", "adaptive", "classic"]);
    expect(isProductionScheduler("fsrs")).toBe(true);
    expect(isProductionScheduler("precision")).toBe(true);
    expect(isProductionScheduler("adaptive")).toBe(true);
    expect(isProductionScheduler("classic")).toBe(true);
    expect(isProductionScheduler("sm20")).toBe(true);
    expect(isProductionScheduler("classic_5")).toBe(false);
  });

  it("normalizes to production scheduler without erasing user choice", () => {
    expect(normalizeToProductionScheduler("precision")).toBe("precision");
    expect(normalizeToProductionScheduler("sm20")).toBe("precision");
    expect(normalizeToProductionScheduler("adaptive")).toBe("adaptive");
    expect(normalizeToProductionScheduler("sm18")).toBe("adaptive");
    expect(normalizeToProductionScheduler("classic")).toBe("classic");
    expect(normalizeToProductionScheduler("sm2")).toBe("classic");
    expect(normalizeToProductionScheduler("fsrs")).toBe("fsrs");
    expect(normalizeToProductionScheduler("unknown_algo")).toBe("fsrs");
  });

  it("maps legacy arena model ids to m1-m5", () => {
    expect(normalizeArenaModelId("sm2")).toBe("m1");
    expect(normalizeArenaModelId("sm15")).toBe("m2");
    expect(normalizeArenaModelId("sm19")).toBe("m3");
    expect(normalizeArenaModelId("sm20")).toBe("m4");
    expect(normalizeArenaModelId("fsrs")).toBe("m5");
  });
});
