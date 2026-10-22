import { beforeEach, describe, expect, it, vi } from "vitest";

const setZoom = vi.fn<() => Promise<void>>(() => Promise.resolve());
const getCurrentWebview = vi.fn(() => ({ label: "main", setZoom }));
const osVersion = vi.fn(() => "14.4.1");

const platformState = {
  tauri: true,
  mobile: false,
  mac: false,
};

vi.mock("../../tauri", () => ({
  isTauri: () => platformState.tauri,
  isNativeMobile: () => platformState.mobile,
  isMac: () => platformState.mac,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => getCurrentWebview(),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  version: () => osVersion(),
}));

import {
  applyNativeInterfaceZoom,
  isDesktopInterfaceZoomSupported,
} from "../native";

beforeEach(() => {
  platformState.tauri = true;
  platformState.mobile = false;
  platformState.mac = false;
  getCurrentWebview.mockImplementation(() => ({ label: "main", setZoom }));
  setZoom.mockReset();
  setZoom.mockResolvedValue(undefined);
  osVersion.mockReset();
  osVersion.mockReturnValue("14.4.1");
});

describe("isDesktopInterfaceZoomSupported", () => {
  it("is unsupported in a browser/PWA", () => {
    platformState.tauri = false;
    expect(isDesktopInterfaceZoomSupported()).toBe(false);
  });

  it("is unsupported on native mobile", () => {
    platformState.mobile = true;
    expect(isDesktopInterfaceZoomSupported()).toBe(false);
  });

  it("requires macOS 11 or newer", () => {
    platformState.mac = true;
    osVersion.mockReturnValue("10.15.7");
    expect(isDesktopInterfaceZoomSupported()).toBe(false);
    osVersion.mockReturnValue("11.0.0");
    expect(isDesktopInterfaceZoomSupported()).toBe(true);
    osVersion.mockReturnValue("14.4.1");
    expect(isDesktopInterfaceZoomSupported()).toBe(true);
  });

  it("reports unsupported when the macOS version cannot be read", () => {
    platformState.mac = true;
    osVersion.mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(isDesktopInterfaceZoomSupported()).toBe(false);
  });

  it("is supported on desktop Linux even when a version string is unavailable", () => {
    osVersion.mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(isDesktopInterfaceZoomSupported()).toBe(true);
  });
});

describe("applyNativeInterfaceZoom", () => {
  it("does not touch the native API in a browser/PWA", async () => {
    platformState.tauri = false;
    await applyNativeInterfaceZoom(80);
    expect(getCurrentWebview).not.toHaveBeenCalled();
    expect(setZoom).not.toHaveBeenCalled();
  });

  it("does not touch the native API on native mobile", async () => {
    platformState.mobile = true;
    await applyNativeInterfaceZoom(80);
    expect(setZoom).not.toHaveBeenCalled();
  });

  it("does not touch the native API on old macOS", async () => {
    platformState.mac = true;
    osVersion.mockReturnValue("10.15.7");
    await applyNativeInterfaceZoom(80);
    expect(setZoom).not.toHaveBeenCalled();
  });

  it("applies the percentage to the main webview as a scale factor", async () => {
    await applyNativeInterfaceZoom(80);
    expect(getCurrentWebview).toHaveBeenCalledTimes(1);
    expect(setZoom).toHaveBeenCalledWith(0.8);
  });

  it("passes the internal 125% value through without rounding", async () => {
    await applyNativeInterfaceZoom(125);
    expect(setZoom).toHaveBeenCalledWith(1.25);
  });

  it("is a no-op for a non-main webview label", async () => {
    getCurrentWebview.mockImplementation(() => ({ label: "screenshot-overlay", setZoom }));
    await applyNativeInterfaceZoom(80);
    expect(setZoom).not.toHaveBeenCalled();
  });

  it("propagates a rejected native call", async () => {
    setZoom.mockRejectedValueOnce(new Error("denied"));
    await expect(applyNativeInterfaceZoom(80)).rejects.toThrow("denied");
  });
});
