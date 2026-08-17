/**
 * Settings tests for `ai.activeRecallMode` (task 5.9, design D19): default
 * off (the kill switch), round-trips through the store, defensive
 * rehydration of unknown persisted values, and merge with older persisted
 * slices that predate the field.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { defaultSettings, useSettingsStore } from "../settingsStore";

function cloneDefaults() {
  return JSON.parse(JSON.stringify(defaultSettings)) as typeof defaultSettings;
}

describe("settingsStore ai.activeRecallMode", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: cloneDefaults() });
  });

  it("defaults to off (the kill switch)", () => {
    expect(defaultSettings.ai.activeRecallMode).toBe("off");
    expect(useSettingsStore.getState().settings.ai.activeRecallMode).toBe("off");
  });

  it("round-trips every mode through updateSettingsCategory", () => {
    for (const mode of ["low", "adaptive", "intensive", "off"] as const) {
      useSettingsStore.getState().updateSettingsCategory("ai", { activeRecallMode: mode });
      expect(useSettingsStore.getState().settings.ai.activeRecallMode).toBe(mode);
    }
  });

  it("preserves the rest of the ai category when only the mode changes", () => {
    const before = useSettingsStore.getState().settings.ai;
    useSettingsStore.getState().updateSettingsCategory("ai", { activeRecallMode: "adaptive" });
    const after = useSettingsStore.getState().settings.ai;
    expect(after.preferOnDevice).toBe(before.preferOnDevice);
    expect(after.memoryEnabled).toBe(before.memoryEnabled);
    expect(after.aiControls).toEqual(before.aiControls);
  });

  it("merges as off for persisted slices that predate the field", async () => {
    localStorage.setItem(
      "plethora-settings",
      JSON.stringify({
        state: { settings: { ai: { preferOnDevice: false } } },
        version: 6,
      })
    );
    await useSettingsStore.persist.rehydrate();
    const ai = useSettingsStore.getState().settings.ai;
    expect(ai.activeRecallMode).toBe("off");
    expect(ai.preferOnDevice).toBe(false);
  });

  it("keeps a persisted valid mode on rehydration", async () => {
    localStorage.setItem(
      "plethora-settings",
      JSON.stringify({
        state: { settings: { ai: { activeRecallMode: "intensive" } } },
        version: 6,
      })
    );
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().settings.ai.activeRecallMode).toBe("intensive");
  });

  it("resets an unknown persisted mode to off (defensive)", async () => {
    localStorage.setItem(
      "plethora-settings",
      JSON.stringify({
        state: {
          settings: {
            ai: { activeRecallMode: "ultra" },
          },
        },
        version: 6,
      })
    );
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().settings.ai.activeRecallMode).toBe("off");
  });
});
