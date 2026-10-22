import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  supported: true,
  applyNative: vi.fn<(percent: number) => Promise<void>>(),
}));

vi.mock("../native", () => ({
  isDesktopInterfaceZoomSupported: () => mocks.supported,
  applyNativeInterfaceZoom: (percent: number) => mocks.applyNative(percent),
}));

async function loadStartup() {
  return await import("../startup");
}

function persistSettings(value: unknown) {
  localStorage.setItem(
    "plethora-settings",
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  mocks.supported = true;
  mocks.applyNative.mockReset();
  mocks.applyNative.mockResolvedValue(undefined);
});

describe("interface zoom startup bootstrap", () => {
  it("applies the persisted percentage before React loads", async () => {
    persistSettings({ state: { settings: { interface: { interfaceZoom: 130 } } } });
    const { bootstrapInterfaceZoom } = await loadStartup();

    const result = await bootstrapInterfaceZoom();

    expect(mocks.applyNative).toHaveBeenCalledWith(130);
    expect(result).toEqual({ supported: true, appliedPercent: 130, error: null });
  });

  it("reads the legacy top-level fallback shapes", async () => {
    persistSettings({ settings: { interface: { interfaceZoom: 80 } } });
    const { bootstrapInterfaceZoom } = await loadStartup();
    await bootstrapInterfaceZoom();
    expect(mocks.applyNative).toHaveBeenCalledWith(80);
  });

  it("applies 100 even when no preference was ever stored", async () => {
    const { bootstrapInterfaceZoom } = await loadStartup();
    const result = await bootstrapInterfaceZoom();
    expect(mocks.applyNative).toHaveBeenCalledWith(100);
    expect(result.appliedPercent).toBe(100);
  });

  it("falls back to 100 for malformed storage", async () => {
    persistSettings("{ this is not json");
    const { bootstrapInterfaceZoom } = await loadStartup();
    const result = await bootstrapInterfaceZoom();
    expect(mocks.applyNative).toHaveBeenCalledWith(100);
    expect(result).toEqual({ supported: true, appliedPercent: 100, error: null });
  });

  it("falls back to 100 when storage is blocked", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { bootstrapInterfaceZoom } = await loadStartup();
    const result = await bootstrapInterfaceZoom();
    spy.mockRestore();
    expect(mocks.applyNative).toHaveBeenCalledWith(100);
    expect(result.appliedPercent).toBe(100);
  });

  it("reports a failed apply as applied 100 with the error", async () => {
    persistSettings({ state: { settings: { interface: { interfaceZoom: 130 } } } });
    mocks.applyNative.mockImplementationOnce(() => Promise.reject(new Error("denied")));
    const { bootstrapInterfaceZoom } = await loadStartup();

    const result = await bootstrapInterfaceZoom();

    expect(mocks.applyNative).toHaveBeenNthCalledWith(1, 130);
    expect(mocks.applyNative).toHaveBeenNthCalledWith(2, 100);
    expect(result).toEqual({ supported: true, appliedPercent: 100, error: "denied" });
  });

  it("is unsupported in a browser/PWA and makes no native call", async () => {
    persistSettings({ state: { settings: { interface: { interfaceZoom: 130 } } } });
    mocks.supported = false;
    const { bootstrapInterfaceZoom } = await loadStartup();

    const result = await bootstrapInterfaceZoom();

    expect(result).toEqual({ supported: false, appliedPercent: 100, error: null });
    expect(mocks.applyNative).not.toHaveBeenCalled();
  });

  it("is unsupported on native mobile and makes no native call", async () => {
    mocks.supported = false;
    const { bootstrapInterfaceZoom } = await loadStartup();
    await bootstrapInterfaceZoom();
    expect(mocks.applyNative).not.toHaveBeenCalled();
  });

  it("never zooms the screenshot overlay route", async () => {
    persistSettings({ state: { settings: { interface: { interfaceZoom: 130 } } } });
    window.history.replaceState(null, "", "#/screenshot-overlay");
    const { bootstrapInterfaceZoom } = await loadStartup();

    const result = await bootstrapInterfaceZoom();

    expect(mocks.applyNative).not.toHaveBeenCalled();
    expect(result).toEqual({ supported: false, appliedPercent: 100, error: null });
  });

  it("memoizes one native call and exposes the shared result", async () => {
    persistSettings({ state: { settings: { interface: { interfaceZoom: 120 } } } });
    const { bootstrapInterfaceZoom, getBootstrapPromise, getBootstrapResult } =
      await loadStartup();

    const [first, second] = await Promise.all([
      bootstrapInterfaceZoom(),
      bootstrapInterfaceZoom(),
    ]);
    const shared = await getBootstrapPromise();

    expect(first).toBe(second);
    expect(shared).toBe(first);
    expect(getBootstrapResult()).toEqual(first);
    expect(mocks.applyNative).toHaveBeenCalledTimes(1);
  });

  it("resolves without a native call when the bootstrap was never started", async () => {
    const { getBootstrapPromise, getBootstrapResult } = await loadStartup();
    const result = await getBootstrapPromise();
    expect(result).toEqual({ supported: true, appliedPercent: 100, error: null });
    expect(getBootstrapResult()).toBeNull();
    expect(mocks.applyNative).not.toHaveBeenCalled();
  });
});
