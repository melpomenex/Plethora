import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "../settingsStore";

/**
 * Settings ▸ Default View rendered a `<select>` whose only handler flipped an
 * unsaved-changes flag. The chosen value was stored nowhere and read nowhere,
 * so the app always opened on Queue no matter what the user picked.
 */
describe("default startup view preference", () => {
  beforeEach(() => {
    useSettingsStore.getState().updateSettingsCategory("general", { defaultView: "queue" });
  });

  it("defaults to the queue", () => {
    expect(useSettingsStore.getState().settings.general.defaultView).toBe("queue");
  });

  it("persists a chosen view", () => {
    useSettingsStore.getState().updateSettingsCategory("general", { defaultView: "documents" });

    expect(useSettingsStore.getState().settings.general.defaultView).toBe("documents");
  });

  it("round-trips every offered view", () => {
    for (const view of ["queue", "review", "documents", "analytics"] as const) {
      useSettingsStore.getState().updateSettingsCategory("general", { defaultView: view });
      expect(useSettingsStore.getState().settings.general.defaultView).toBe(view);
    }
  });

  it("does not disturb the other general settings", () => {
    const before = useSettingsStore.getState().settings.general.restoreSession;

    useSettingsStore.getState().updateSettingsCategory("general", { defaultView: "analytics" });

    expect(useSettingsStore.getState().settings.general.restoreSession).toBe(before);
  });
});
