import { afterEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "../settingsStore";

afterEach(() => useSettingsStore.getState().resetSettings());

function persistSettings(settings: Record<string, unknown>) {
  localStorage.setItem(
    "plethora-settings",
    JSON.stringify({ version: 15, state: { settings } }),
  );
}

describe("interface zoom preference", () => {
  it("defaults to 100%", () => {
    expect(useSettingsStore.getState().settings.interface.interfaceZoom).toBe(100);
  });

  it("keeps a persisted supported value", async () => {
    persistSettings({ interface: { interfaceZoom: 80 } });
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().settings.interface.interfaceZoom).toBe(80);
  });

  it("normalizes a persisted below-range value to the minimum", async () => {
    persistSettings({ interface: { interfaceZoom: 20 } });
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().settings.interface.interfaceZoom).toBe(70);
  });

  it("normalizes a persisted above-range value to the maximum", async () => {
    persistSettings({ interface: { interfaceZoom: 999 } });
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().settings.interface.interfaceZoom).toBe(150);
  });

  it("normalizes an off-step persisted value", async () => {
    persistSettings({ interface: { interfaceZoom: 125 } });
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().settings.interface.interfaceZoom).toBe(130);
  });

  it("defaults a legacy settings object and preserves unrelated values", async () => {
    persistSettings({
      appearance: { theme: "dark", fontSize: 18 },
      learning: { newCardsPerDay: 7 },
      interface: { sidebarWidth: 220 },
    });
    await useSettingsStore.persist.rehydrate();
    const settings = useSettingsStore.getState().settings;
    expect(settings.interface.interfaceZoom).toBe(100);
    expect(settings.interface.sidebarWidth).toBe(220);
    expect(settings.appearance.theme).toBe("dark");
    expect(settings.appearance.fontSize).toBe(18);
    expect(settings.learning.newCardsPerDay).toBe(7);
  });

  it("clamps direct category updates so no caller can write out of range", () => {
    useSettingsStore.getState().updateSettingsCategory("interface", { interfaceZoom: 999 });
    expect(useSettingsStore.getState().settings.interface.interfaceZoom).toBe(150);
    useSettingsStore.getState().updateSettingsCategory("interface", { interfaceZoom: 130 });
    expect(useSettingsStore.getState().settings.interface.interfaceZoom).toBe(130);
  });
});
