import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../tauri", () => ({ isNativeMobile: () => true }));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("@tauri-apps/plugin-log", () => log);

describe("console forwarding with a stalled bridge", () => {
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  afterEach(() => { Object.assign(console, saved); vi.restoreAllMocks(); });

  it("preserves console, deduplicates installation, and keeps one bounded native request", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    log.info.mockImplementation(() => new Promise(() => {}));
    const { installConsoleLogcatBridge } = await import("../consoleLogcatBridge");
    await Promise.all([installConsoleLogcatBridge(), installConsoleLogcatBridge()]);
    for (let i = 0; i < 10000; i++) console.warn("Couldn't find callback id");
    console.info('[startup:android] {"phase":"recovery-visible"}');
    expect(warn).toHaveBeenCalledTimes(10000);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
    expect(await installConsoleLogcatBridge()).toBe(false);
  });
});
