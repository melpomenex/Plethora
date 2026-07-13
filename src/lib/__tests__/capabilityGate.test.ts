import { describe, expect, it } from "vitest";
import { canStopLegacyWrites } from "../sync/capabilityGate";

describe("sync capability gate", () => {
  it("keeps legacy writes while an older device remains active", () => {
    const devices = [
      { deviceId: "a", schemaVersion: 2, supportsShards: true, lastSeenAt: "now" },
      { deviceId: "b", schemaVersion: 1, supportsShards: false, lastSeenAt: "now" },
    ];
    expect(canStopLegacyWrites(devices, 2)).toBe(false);
    expect(canStopLegacyWrites([devices[0]], 2)).toBe(true);
  });
});
