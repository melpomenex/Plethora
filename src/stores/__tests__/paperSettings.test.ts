import { afterEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "../settingsStore";
import { PAPER_PRESET_ID } from "../../themes/materials";

afterEach(() => useSettingsStore.getState().resetSettings());
describe("persisted paper preferences", () => {
  it("hydrates partial settings without losing explicit false", async () => {
    const family = useSettingsStore.getState().settings.appearance.fontFamily;
    localStorage.setItem(
      "plethora-settings",
      JSON.stringify({
        version: 15,
        state: {
          settings: {
            appearance: { materialPreferences: { [PAPER_PRESET_ID]: { ruling: false } } },
          },
        },
      })
    );
    await useSettingsStore.persist.rehydrate();
    const appearance = useSettingsStore.getState().settings.appearance;
    expect(appearance.materialPreferences[PAPER_PRESET_ID]).toEqual({
      detail: "authentic",
      ruling: false,
      margin: true,
    });
    expect(appearance.fontFamily).toBe(family);
  });
  it("normalizes category updates, preserves unrelated appearance, resets cleanly", () => {
    const store = useSettingsStore.getState();
    store.updateSettingsCategory("appearance", {
      fontSize: 20,
      materialPreferences: {
        [PAPER_PRESET_ID]: { detail: "subtle", ruling: false, margin: false },
      },
    });
    expect(useSettingsStore.getState().settings.appearance.fontSize).toBe(20);
    expect(
      useSettingsStore.getState().settings.appearance.materialPreferences[PAPER_PRESET_ID].detail
    ).toBe("subtle");
    store.resetCategory("appearance");
    expect(useSettingsStore.getState().settings.appearance.materialPreferences).toBeUndefined();
  });
});
