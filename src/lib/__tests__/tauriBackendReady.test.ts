import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => mocks);

describe("invokeCommand backend readiness", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invoke.mockReset();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("shares one readiness wait before invoking concurrent repository commands", async () => {
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "wait_for_backend_ready") return ready;
      return Promise.resolve(command);
    });
    const { invokeCommand } = await import("../tauri");

    const dueItems = invokeCommand<string>("get_due_items");
    const analytics = invokeCommand<string>("get_dashboard_stats");
    await vi.waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledTimes(1);
    });
    expect(mocks.invoke).toHaveBeenCalledWith("wait_for_backend_ready");

    releaseReady();
    await expect(Promise.all([dueItems, analytics])).resolves.toEqual([
      "get_due_items",
      "get_dashboard_stats",
    ]);
    expect(
      mocks.invoke.mock.calls.filter(([command]) => command === "wait_for_backend_ready"),
    ).toHaveLength(1);
  });

  it("re-probes readiness after a failed cycle instead of failing forever", async () => {
    vi.useFakeTimers();
    try {
      // Every probe of the first cycle rejects immediately (backend not yet
      // initialized); the cycle exhausts its attempts and the command fails.
      mocks.invoke.mockImplementation((command: string) => {
        if (command === "wait_for_backend_ready") return Promise.reject(new Error("not ready"));
        return Promise.resolve(command);
      });
      const { invokeCommand } = await import("../tauri");

      const first = invokeCommand<string>("get_due_items");
      // Attach the rejection handler up-front: the rejection lands mid-flush
      // and would otherwise sit unhandled across timer turns.
      const firstOutcome = expect(first).rejects.toThrow();
      // Flush the 5 probe attempts plus their backoff sleeps (1+2+4+8s).
      await vi.advanceTimersByTimeAsync(20_000);
      await firstOutcome;

      // The backend finishes initializing: the next command must re-probe
      // (previously the ??= cache kept the rejected promise and every later
      // invoke failed instantly until app restart) and then succeed.
      mocks.invoke.mockImplementation((command: string) => {
        if (command === "wait_for_backend_ready") return Promise.resolve(undefined);
        return Promise.resolve(command);
      });
      await expect(invokeCommand<string>("get_due_items")).resolves.toBe("get_due_items");
      const probes = mocks.invoke.mock.calls.filter(
        ([command]) => command === "wait_for_backend_ready",
      );
      expect(probes.length).toBeGreaterThanOrEqual(6); // 5 failed + 1 recovery
    } finally {
      vi.useRealTimers();
    }
  });
});
