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
    expect(stored.version).toBe(6);
    expect(stored.state.settings.notifications).toMatchObject({
      enabled: true,
      reminderTime: "07:30",
      feedbackSoundsEnabled: true,
    });
  });

  it("deep-merges a partial persisted notification slice", async () => {
    localStorage.setItem("incrementum-settings", JSON.stringify({
      state: { settings: { notifications: { enabled: true, soundEnabled: false } } },
      version: 5,
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

describe("settingsStore flashcard generation target migration", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: cloneDefaults() });
  });

  it("seeds flashcardFixedCount from a previously persisted cardsPerExtract on migration", async () => {
    localStorage.setItem("incrementum-settings", JSON.stringify({
      state: { settings: { ai: { aiControls: { cardsPerExtract: 9 } } } },
      version: 5,
    }));

    await useSettingsStore.persist.rehydrate();

    const aiControls = useSettingsStore.getState().settings.ai.aiControls;
    expect(aiControls.flashcardFixedCount).toBe(9);
  });
});

describe("settingsStore Arena review mode", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: cloneDefaults() });
  });

  it("defaults to automatic Arena scheduling", () => {
    expect(defaultSettings.learning.sm20ArenaReviewMode).toBe("automatic");
  });

  it("round-trips the explicit chooser preference", () => {
    useSettingsStore.getState().updateSettingsCategory("learning", {
      sm20ArenaReviewMode: "choose",
    });

    const stored = JSON.parse(localStorage.getItem("incrementum-settings") || "{}");
    expect(stored.state.settings.learning.sm20ArenaReviewMode).toBe("choose");
  });
});
