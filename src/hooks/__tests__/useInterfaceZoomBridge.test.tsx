import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InterfaceZoomStatus } from "../../lib/interfaceZoom/controller";

const ctrl = vi.hoisted(() => {
  let status = {
    supported: true,
    applying: false,
    appliedPercent: 100,
    error: null as string | null,
    errorNonce: 0,
  };
  const listeners = new Set<() => void>();
  return {
    getStatus: (): InterfaceZoomStatus => status,
    setStatus: (patch: Partial<InterfaceZoomStatus>) => {
      status = { ...status, ...patch };
      for (const listener of listeners) listener();
    },
    reset: () => {
      status = {
        supported: true,
        applying: false,
        appliedPercent: 100,
        error: null,
        errorNonce: 0,
      };
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomReset: vi.fn(),
    setPercent: vi.fn(),
  };
});

vi.mock("../../lib/interfaceZoom/controller", () => ({
  getInterfaceZoomStatus: () => ctrl.getStatus(),
  subscribeInterfaceZoomStatus: (listener: () => void) => ctrl.subscribe(listener),
  startInterfaceZoomSync: () => ctrl.start(),
  zoomInterfaceIn: () => ctrl.zoomIn(),
  zoomInterfaceOut: () => ctrl.zoomOut(),
  resetInterfaceZoom: () => ctrl.zoomReset(),
  setInterfaceZoomPercent: (percent: number) => ctrl.setPercent(percent),
}));

import { useInterfaceZoomBridge } from "../useInterfaceZoom";
import { useToastStore } from "../../components/common/Toast";
import { useSettingsStore } from "../../stores/settingsStore";
import { useShortcutStore } from "../../components/common/KeyboardShortcuts";

function Bridge() {
  useInterfaceZoomBridge();
  return null;
}

function dispatchZoomIn() {
  const event = new KeyboardEvent("keydown", {
    key: "=",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  const preventDefault = vi.spyOn(event, "preventDefault");
  const stopImmediatePropagation = vi.spyOn(event, "stopImmediatePropagation");
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, preventDefault, stopImmediatePropagation };
}

beforeEach(() => {
  ctrl.reset();
  ctrl.start.mockReset();
  ctrl.zoomIn.mockReset();
  ctrl.zoomOut.mockReset();
  ctrl.zoomReset.mockReset();
  useToastStore.getState().clearAll();
  useSettingsStore.getState().resetSettings();
  useShortcutStore.getState().resetAll();
});

describe("useInterfaceZoomBridge", () => {
  it("starts sync and installs exactly one capture keydown listener", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const view = render(<Bridge />);

    expect(ctrl.start).toHaveBeenCalledTimes(1);
    const calls = addEventListener.mock.calls as unknown as Array<[string, unknown, unknown]>;
    const captureKeydown = calls.filter(
      ([type, , options]) => type === "keydown" && options === true,
    );
    expect(captureKeydown).toHaveLength(1);
    addEventListener.mockRestore();
    view.unmount();
  });

  it("claims the event once and does not double-fire after remount", () => {
    const first = render(<Bridge />);
    const firstDispatch = dispatchZoomIn();
    expect(ctrl.zoomIn).toHaveBeenCalledTimes(1);
    expect(firstDispatch.preventDefault).toHaveBeenCalledTimes(1);
    expect(firstDispatch.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    first.unmount();

    render(<Bridge />);
    dispatchZoomIn();
    expect(ctrl.zoomIn).toHaveBeenCalledTimes(2);
  });

  it("removes the listener on unmount", () => {
    const view = render(<Bridge />);
    view.unmount();
    dispatchZoomIn();
    expect(ctrl.zoomIn).not.toHaveBeenCalled();
  });

  it("shows exactly one toast per new error nonce", () => {
    render(<Bridge />);

    act(() => ctrl.setStatus({ error: "denied", errorNonce: 1 }));
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].title).toBe(
      "Could not change interface zoom. Your previous setting was restored.",
    );

    // Re-rendering with the same nonce does not repeat the toast.
    act(() => ctrl.setStatus({ applying: true }));
    expect(useToastStore.getState().toasts).toHaveLength(1);

    act(() => ctrl.setStatus({ error: "denied again", errorNonce: 2 }));
    expect(useToastStore.getState().toasts).toHaveLength(2);
  });

  it("shows no toast for an unsupported runtime", () => {
    render(<Bridge />);
    act(() => ctrl.setStatus({ supported: false }));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
