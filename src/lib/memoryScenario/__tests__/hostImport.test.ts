import { describe, expect, it } from "vitest";

describe("host module graph", () => {
  it("imports and starts inert outside the harness env", async () => {
    const mod = await import("../host");
    expect(typeof mod.startMemoryScenario).toBe("function");
    // Inert in jsdom: the config bridge is unavailable -> returns immediately.
    await expect(mod.startMemoryScenario()).resolves.toBeUndefined();
  });
});
