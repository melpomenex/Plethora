import { beforeEach, describe, expect, it } from "vitest";
import { defaultSettings, useSettingsStore } from "../settingsStore";

function cloneDefaults() {
  return JSON.parse(JSON.stringify(defaultSettings)) as typeof defaultSettings;
}

describe("settingsStore notification persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: cloneDefaults() });
  });

  it("persists notification changes without changing the store version", () => {
    useSettingsStore.getState().updateSettingsCategory("notifications", {
      enabled: true,
      reminderTime: "07:30",
      feedbackSoundsEnabled: true,
    });

    const stored = JSON.parse(localStorage.getItem("incrementum-settings") || "{}");
    expect(stored.version).toBe(4);
    expect(stored.state.settings.notifications).toMatchObject({
      enabled: true,
      reminderTime: "07:30",
      feedbackSoundsEnabled: true,
    });
  });

  it("deep-merges a partial persisted notification slice", async () => {
    localStorage.setItem("incrementum-settings", JSON.stringify({
      state: { settings: { notifications: { enabled: true, soundEnabled: false } } },
      version: 4,
    }));

    await useSettingsStore.persist.rehydrate();

    const notifications = useSettingsStore.getState().settings.notifications;
    expect(notifications.enabled).toBe(true);
    expect(notifications.soundEnabled).toBe(false);
    expect(notifications.reminderTime).toBe(defaultSettings.notifications.reminderTime);
    expect(notifications.showBadge).toBe(defaultSettings.notifications.showBadge);
    expect(notifications.feedbackSoundsEnabled).toBe(defaultSettings.notifications.feedbackSoundsEnabled);
  });
});

