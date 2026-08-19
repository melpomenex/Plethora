import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultSettings,
  useSettingsStore,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_DEFAULT,
  clampSidebarWidth,
} from "../settingsStore";

function cloneDefaults() {
  return JSON.parse(JSON.stringify(defaultSettings)) as typeof defaultSettings;
}

describe("sidebar width setting", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: cloneDefaults() });
  });

  it("has a sane default matching current Plethora behavior (11.5rem = 184px)", () => {
    expect(SIDEBAR_WIDTH_DEFAULT).toBe(184);
    expect(useSettingsStore.getState().settings.interface.sidebarWidth).toBe(184);
  });

  it("enforces the configured min/max bounds when clamping", () => {
    expect(SIDEBAR_WIDTH_MIN).toBe(128);
    expect(SIDEBAR_WIDTH_MAX).toBe(320);
    expect(clampSidebarWidth(64)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(0)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(2000)).toBe(SIDEBAR_WIDTH_MAX);
    expect(clampSidebarWidth(256)).toBe(256);
  });

  it("falls back to the default for non-numeric or non-finite values", () => {
    expect(clampSidebarWidth(undefined)).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(clampSidebarWidth(null)).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(clampSidebarWidth("200")).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT);
  });

  it("persists a user-chosen width and round-trips it through the store", () => {
    useSettingsStore.getState().updateSettingsCategory("interface", { sidebarWidth: 240 });

    const stored = JSON.parse(localStorage.getItem("plethora-settings") || "{}");
    expect(stored.state.settings.interface.sidebarWidth).toBe(240);
    expect(useSettingsStore.getState().settings.interface.sidebarWidth).toBe(240);
  });

  it("clamps out-of-range writes through updateSettingsCategory", () => {
    useSettingsStore.getState().updateSettingsCategory("interface", { sidebarWidth: 4096 });
    expect(useSettingsStore.getState().settings.interface.sidebarWidth).toBe(SIDEBAR_WIDTH_MAX);

    useSettingsStore.getState().updateSettingsCategory("interface", { sidebarWidth: 0 });
    expect(useSettingsStore.getState().settings.interface.sidebarWidth).toBe(SIDEBAR_WIDTH_MIN);
  });
});
