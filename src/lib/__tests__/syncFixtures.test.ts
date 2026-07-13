import { describe, expect, it } from "vitest";
import { buildSyncFixture } from "../sync/syncFixtures";

describe("sync fixtures", () => {
  it("is deterministic and scales across room profiles", () => {
    expect(buildSyncFixture("small", 7)).toEqual(buildSyncFixture("small", 7));
    expect(buildSyncFixture("large").records.length).toBeGreaterThan(buildSyncFixture("small").records.length);
    expect(buildSyncFixture("ten-year").records.length).toBeGreaterThan(buildSyncFixture("large").records.length);
  });

  it("models corruption and offline divergence without real user data", () => {
    const corrupt = buildSyncFixture("corrupt");
    expect(corrupt.corruptRecordIds.length).toBeGreaterThan(0);
    const divergent = buildSyncFixture("offline-divergent");
    expect(Object.keys(divergent.deviceMutations)).toEqual(["desktop", "mobile"]);
    expect(divergent.deviceMutations.desktop.length).toBeGreaterThan(0);
  });
});
