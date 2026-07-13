import { describe, expect, it } from "vitest";
import { runStartupBenchmark } from "../sync/startupBenchmark";

describe("sync startup benchmark", () => {
  it("compares sync-enabled and sync-disabled boot without blocking on network", async () => {
    const result = await runStartupBenchmark({
      boot: async () => undefined,
      maxOverheadMs: 100,
    });
    expect(result.longTaskCount).toBe(0);
    expect(result.passes).toBe(true);
  });
});
