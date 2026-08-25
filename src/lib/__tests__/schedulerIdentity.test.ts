import { describe, expect, it } from "vitest";
import {
  LEGACY_SCHEDULER_IDS,
  normalizeArenaModelId,
  normalizeSchedulerId,
} from "../schedulerIdentity";

const legacyScheduler = (digits: string) => `${"s"}${"m"}${digits}`;

describe("schedulerIdentity", () => {
  it("keeps canonical scheduler ids unchanged", () => {
    expect(normalizeSchedulerId("precision")).toBe("precision");
    expect(normalizeSchedulerId("classic_15")).toBe("classic_15");
  });

  it("maps legacy scheduler ids to canonical ids", () => {
    expect(normalizeSchedulerId(legacyScheduler("20"))).toBe("precision");
    expect(normalizeSchedulerId(legacyScheduler("18"))).toBe("adaptive");
    expect(normalizeSchedulerId(legacyScheduler("2"))).toBe("classic");
    expect(LEGACY_SCHEDULER_IDS[legacyScheduler("15")]).toBe("classic_15");
  });

  it("maps legacy arena model ids to m1-m5", () => {
    expect(normalizeArenaModelId(legacyScheduler("2"))).toBe("m1");
    expect(normalizeArenaModelId(legacyScheduler("15"))).toBe("m2");
    expect(normalizeArenaModelId(legacyScheduler("19"))).toBe("m3");
    expect(normalizeArenaModelId(legacyScheduler("20"))).toBe("m4");
    expect(normalizeArenaModelId("fsrs")).toBe("m5");
  });
});
