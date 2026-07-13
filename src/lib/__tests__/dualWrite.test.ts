import { describe, expect, it } from "vitest";
import { dualWriteWithParity } from "../sync/dualWrite";

describe("dual-write parity", () => {
  it("writes both paths and reports matching projections", async () => {
    const value = { id: "card-1", due: 3 };
    const writeLegacy = async () => undefined;
    const writeShard = async () => undefined;
    const result = await dualWriteWithParity({ value, writeLegacy, writeShard, readLegacy: async () => value, readShard: async () => value });
    expect(result.parity).toBe(true);
  });
});
