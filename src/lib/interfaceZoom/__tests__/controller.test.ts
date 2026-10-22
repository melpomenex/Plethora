import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../../../stores/settingsStore";

const mocks = vi.hoisted(() => ({
  supported: true,
  applyNative: vi.fn<(percent: number) => Promise<void>>(),
  bootstrap: vi.fn<() => Promise<{ supported: boolean; appliedPercent: number; error: string | null }>>(),
}));

vi.mock("../native", () => ({
  isDesktopInterfaceZoomSupported: () => mocks.supported,
  applyNativeInterfaceZoom: (percent: number) => mocks.applyNative(percent),
}));

vi.mock("../startup", () => ({
  getBootstrapPromise: () => mocks.bootstrap(),
}));

import {
  __resetInterfaceZoomForTests,
  getInterfaceZoomStatus,
  resetInterfaceZoom,
  setInterfaceZoomPercent,
  startInterfaceZoomSync,
  subscribeInterfaceZoomStatus,
  zoomInterfaceIn,
  zoomInterfaceOut,
} from "../controller";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let rafCallbacks: FrameRequestCallback[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function readStoreZoom(): number {
  return useSettingsStore.getState().settings.interface.interfaceZoom;
}

async function start() {
  startInterfaceZoomSync();
  await settle();
}

beforeEach(() => {
  useSettingsStore.getState().resetSettings();
  mocks.supported = true;
  mocks.applyNative.mockReset();
  mocks.applyNative.mockResolvedValue(undefined);
  mocks.bootstrap.mockReset();
  mocks.bootstrap.mockResolvedValue({ supported: true, appliedPercent: 100, error: null });
  __resetInterfaceZoomForTests();
  rafCallbacks = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  });
});

afterEach(() => {
  __resetInterfaceZoomForTests();
  vi.restoreAllMocks();
});

describe("interface zoom controller", () => {
  it("settles five rapid presses from 100 at 150", async () => {
    await start();
    for (let i = 0; i < 5; i += 1) zoomInterfaceIn();
    await settle();
    await settle();

    expect(readStoreZoom()).toBe(150);
    expect(getInterfaceZoomStatus().appliedPercent).toBe(150);
    expect(mocks.applyNative).toHaveBeenLastCalledWith(150);
  });

  it("steps in exactly ten-point increments", async () => {
    await start();
    zoomInterfaceIn();
    await settle();
    expect(readStoreZoom()).toBe(110);
    zoomInterfaceOut();
    await settle();
    expect(readStoreZoom()).toBe(100);
    setInterfaceZoomPercent(130);
    await settle();
    expect(readStoreZoom()).toBe(130);
    resetInterfaceZoom();
    await settle();
    expect(readStoreZoom()).toBe(100);
  });

  it("applies the newest value after a slow request settles", async () => {
    await start();
    const slow = deferred<void>();
    mocks.applyNative.mockImplementationOnce(() => slow.promise);

    zoomInterfaceIn();
    await settle();
    expect(readStoreZoom()).toBe(110);

    zoomInterfaceIn();
    await settle();
    expect(readStoreZoom()).toBe(120);

    slow.resolve();
    await settle();
    await settle();

    expect(getInterfaceZoomStatus().appliedPercent).toBe(120);
    expect(mocks.applyNative).toHaveBeenLastCalledWith(120);
  });

  it("rolls the preference back when the latest apply fails", async () => {
    await start();
    mocks.applyNative.mockImplementationOnce(() => Promise.reject(new Error("denied")));

    zoomInterfaceIn();
    await settle();
    await settle();

    const status = getInterfaceZoomStatus();
    expect(status.error).toContain("denied");
    expect(status.appliedPercent).toBe(100);
    expect(status.errorNonce).toBe(1);
    expect(readStoreZoom()).toBe(100);
    expect(mocks.applyNative).toHaveBeenNthCalledWith(1, 110);
    // One best-effort native reset to the last applied value.
    expect(mocks.applyNative).toHaveBeenNthCalledWith(2, 100);
  });

  it("does not roll back when a superseded request fails", async () => {
    await start();
    const first = deferred<void>();
    mocks.applyNative.mockImplementationOnce(() => first.promise);

    zoomInterfaceIn();
    await settle();
    zoomInterfaceIn();
    await settle();

    first.reject(new Error("stale failure"));
    await settle();
    await settle();

    const status = getInterfaceZoomStatus();
    expect(status.error).toBeNull();
    expect(status.appliedPercent).toBe(120);
    expect(readStoreZoom()).toBe(120);
  });

  it("dispatches exactly one resize notification per successful apply", async () => {
    const resizes: Event[] = [];
    const onResize = (event: Event) => resizes.push(event);
    window.addEventListener("resize", onResize);

    await start();
    rafCallbacks = [];
    zoomInterfaceIn();
    await settle();
    await settle();

    expect(rafCallbacks).toHaveLength(1);
    rafCallbacks[0](0);
    expect(resizes).toHaveLength(1);

    window.removeEventListener("resize", onResize);
  });

  it("does not write the store on unsupported runtimes", async () => {
    mocks.supported = false;
    __resetInterfaceZoomForTests();
    await start();

    zoomInterfaceIn();
    zoomInterfaceOut();
    resetInterfaceZoom();
    setInterfaceZoomPercent(140);
    await settle();

    expect(readStoreZoom()).toBe(100);
    expect(getInterfaceZoomStatus().supported).toBe(false);
    expect(mocks.applyNative).not.toHaveBeenCalled();
  });

  it("does not re-apply a value startup already applied", async () => {
    useSettingsStore
      .getState()
      .updateSettingsCategory("interface", { interfaceZoom: 130 });
    mocks.bootstrap.mockResolvedValue({ supported: true, appliedPercent: 130, error: null });

    await start();

    expect(mocks.applyNative).not.toHaveBeenCalled();
    expect(getInterfaceZoomStatus().appliedPercent).toBe(130);
    expect(readStoreZoom()).toBe(130);
  });

  it("reconciles a startup failure to 100 and reports one error", async () => {
    useSettingsStore
      .getState()
      .updateSettingsCategory("interface", { interfaceZoom: 130 });
    mocks.bootstrap.mockResolvedValue({
      supported: true,
      appliedPercent: 100,
      error: "startup denied",
    });

    await start();

    expect(readStoreZoom()).toBe(100);
    const status = getInterfaceZoomStatus();
    expect(status.appliedPercent).toBe(100);
    expect(status.error).toContain("startup denied");
    expect(status.errorNonce).toBe(1);
    expect(mocks.applyNative).not.toHaveBeenCalled();
  });

  it("stays inert when startup reports an unsupported route", async () => {
    mocks.bootstrap.mockResolvedValue({
      supported: false,
      appliedPercent: 100,
      error: null,
    });

    await start();
    expect(getInterfaceZoomStatus().supported).toBe(false);

    zoomInterfaceIn();
    await settle();
    expect(readStoreZoom()).toBe(100);
    expect(mocks.applyNative).not.toHaveBeenCalled();
  });

  it("notifies status subscribers", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeInterfaceZoomStatus(listener);
    await start();
    zoomInterfaceIn();
    await settle();
    await settle();
    unsubscribe();
    expect(listener).toHaveBeenCalled();
  });
});
