/**
 * Upgrade/rehydration semantics for AI Learning feature preferences (F3.1).
 *
 * A persisted explicit `false` is a user decision and must survive. An absent
 * key takes the current default. A corrupted value is repaired to the default
 * instead of becoming truthy. No readiness value is persisted.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { defaultSettings, useSettingsStore } from "../settingsStore";

describe("AI Learning feature preference reconciliation", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      settings: JSON.parse(JSON.stringify(defaultSettings)) as typeof defaultSettings,
    });
  });

  it("preserves an explicit false while applying defaults only to absent keys", async () => {
    localStorage.setItem(
      "plethora-settings",
      JSON.stringify({
        state: {
          settings: {
            features: {
              aiLearnThis: false,
              aiAgent: false,
              // Every other AI feature key is absent.
            },
          },
        },
        version: 15,
      })
    );
    await useSettingsStore.persist.rehydrate();
    const features = useSettingsStore.getState().settings.features;
    expect(features.aiLearnThis).toBe(false);
    expect(features.aiAgent).toBe(false);
    expect(features.aiLibraryRag).toBe(defaultSettings.features.aiLibraryRag);
    expect(features.aiOcclusionFreeform).toBe(false);
    expect(features.recordingSessions).toBe(false);
    expect(features.sessionLearningSuggestions).toBe(false);
  });

  it("repairs a corrupted persisted value instead of treating it as enabled", async () => {
    localStorage.setItem(
      "plethora-settings",
      JSON.stringify({
        state: {
          settings: {
            features: {
              aiAgent: "false",
              aiPrerequisites: 1,
              aiConceptLinks: null,
              sessionLearningSuggestions: "invalid-boolean",
            },
          },
        },
        version: 15,
      })
    );
    await useSettingsStore.persist.rehydrate();
    const features = useSettingsStore.getState().settings.features;
    expect(features.aiAgent).toBe(defaultSettings.features.aiAgent);
    expect(features.aiPrerequisites).toBe(defaultSettings.features.aiPrerequisites);
    expect(features.aiConceptLinks).toBe(defaultSettings.features.aiConceptLinks);
    expect(features.sessionLearningSuggestions).toBe(false);
  });

  it("does not hydrate any computed readiness state", async () => {
    localStorage.setItem(
      "plethora-settings",
      JSON.stringify({
        state: {
          settings: {
            features: { aiLearnThis: false },
            featureReadiness: [{ featureId: "learn-this", status: "ready" }],
          },
        },
        version: 15,
      })
    );
    await useSettingsStore.persist.rehydrate();
    const settings = useSettingsStore.getState().settings as unknown as Record<string, unknown>;
    expect(settings.featureReadiness).toBeUndefined();
    expect(useSettingsStore.getState().settings.features.aiLearnThis).toBe(false);
  });
});
