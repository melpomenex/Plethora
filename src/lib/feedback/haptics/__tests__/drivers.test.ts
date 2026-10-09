import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserHapticsDriver } from "../browserDriver";
import { NativeHapticsDriver } from "../nativeDriver";
import { NoopHapticsDriver } from "../noopDriver";
import bridgeFixture from "../../../../../src-tauri/plugins/plethora-haptics/fixtures/bridge-contract.json";

describe("haptics drivers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps desktop output a no-op", async () => {
    const driver = new NoopHapticsDriver();
    expect((await driver.getCapabilities()).driver).toBe("none");
    expect(await driver.perform("success", "id", 100)).toEqual({ status: "skipped", reason: "unsupported" });
  });

  it("shares the canonical Rust/Kotlin/Swift JSON fixture", () => {
    expect(bridgeFixture.capabilities.protocolVersion).toBe(1);
    expect(bridgeFixture.request).toMatchObject({
      driverSessionId: bridgeFixture.capabilities.driverSessionId,
      effect: "commit",
      ttlMs: 120,
    });
    expect(bridgeFixture.skipped).toEqual({ status: "skipped", reason: "stale" });
  });

  it("uses one short browser pulse and contains rejection", async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    const driver = new BrowserHapticsDriver();
    expect(await driver.perform("completion", "operation-1", 150)).toEqual({ status: "submitted" });
    expect(vibrate).toHaveBeenCalledExactlyOnceWith(14);
    vibrate.mockImplementation(() => false);
    expect(await driver.perform("error", "operation-2", 150)).toEqual({ status: "skipped", reason: "system-suppressed" });
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it("uses the configured native revision without a capability query per perform", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command.endsWith("get_capabilities")) {
        return {
          protocolVersion: 1,
          driver: "ios-native",
          driverSessionId: "session-a",
          configurationRevision: 0,
          hardware: "available",
          systemPreference: "unknown",
          intensityControl: "effect-style",
        };
      }
      if (command.endsWith("configure")) return { driverSessionId: "session-a", revision: 1 };
      if (command.endsWith("perform")) return { status: "submitted" };
      throw new Error(`unexpected command: ${command} ${String(args)}`);
    });
    const driver = new NativeHapticsDriver(
      "ios-native",
      invoke as unknown as ConstructorParameters<typeof NativeHapticsDriver>[1],
    );
    expect((await driver.getCapabilities()).hardware).toBe("available");
    expect(await driver.configure(true, "subtle")).toBe(true);
    expect(await driver.perform("commit", "review:card:grade", 90)).toEqual({ status: "submitted" });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "plugin:plethora-haptics|get_capabilities",
      "plugin:plethora-haptics|get_capabilities",
      "plugin:plethora-haptics|configure",
      "plugin:plethora-haptics|perform",
    ]);
    const performArgs = invoke.mock.calls[3]?.[1] as { request: { revision: number; ttlMs: number } };
    expect(performArgs.request).toMatchObject({ revision: 1, ttlMs: 90 });
  });
});
