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
});
