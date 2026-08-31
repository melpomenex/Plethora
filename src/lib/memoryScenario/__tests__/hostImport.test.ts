import { describe, expect, it } from "vitest";

describe("host module graph", () => {
  // Importing the host pulls the whole store/Tauri module graph, which is slow
  // on its own and slower under a parallel full-suite run; the default 5s
  // timeout is not enough. The assertion itself is instant once loaded.
  it("imports and starts inert outside the harness env", async () => {
    const mod = await import("../host");
    expect(typeof mod.startMemoryScenario).toBe("function");
    // Inert in jsdom: the config bridge is unavailable -> returns immediately.
    await expect(mod.startMemoryScenario()).resolves.toBeUndefined();
  }, 20_000);
});
