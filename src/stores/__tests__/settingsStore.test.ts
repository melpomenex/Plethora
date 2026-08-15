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

describe("settingsStore scroll queue composition migration", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: cloneDefaults() });
  });

  async function rehydrateWith(scrollQueue: Record<string, unknown>) {
    localStorage.setItem("incrementum-settings", JSON.stringify({
      state: { settings: { scrollQueue } },
      version: 6,
    }));
    await useSettingsStore.persist.rehydrate();
    return useSettingsStore.getState().settings.scrollQueue.composition;
  }

  it("migrates the old default (30%, extracts count as flashcards) close to the new default", async () => {
    const composition = await rehydrateWith({
      flashcardPercentage: 30,
      extractsCountAsFlashcards: true,
    });
    expect(composition).toEqual({ documents: 55, extracts: 15, flashcards: 30 });
  });

  it("maps a 55% flashcard share with the remainder split across documents and extracts", async () => {
    const composition = await rehydrateWith({
      flashcardPercentage: 55,
      extractsCountAsFlashcards: true,
    });
    expect(composition.flashcards).toBe(55);
    expect(composition.documents + composition.extracts).toBe(45);
    expect(composition.documents).toBeGreaterThan(0);
    expect(composition.extracts).toBeGreaterThan(0);
  });

  it("keeps documents with the full remainder when extracts were independent", async () => {
    const composition = await rehydrateWith({
      flashcardPercentage: 40,
      extractsCountAsFlashcards: false,
    });
    expect(composition).toEqual({ documents: 55, extracts: 5, flashcards: 40 });
  });

  it("does not produce an all-zero composition from a saved 0%", async () => {
    const composition = await rehydrateWith({
      flashcardPercentage: 0,
      extractsCountAsFlashcards: true,
    });
    expect(composition).toEqual({ documents: 100, extracts: 0, flashcards: 0 });
  });

  it("leaves an already-migrated composition untouched", async () => {
    const composition = await rehydrateWith({
      composition: { documents: 10, extracts: 10, flashcards: 10 },
      flashcardPercentage: 55,
    });
    expect(composition).toEqual({ documents: 10, extracts: 10, flashcards: 10 });
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

describe("settingsStore AI learning feature flags", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: cloneDefaults() });
  });

  it("defaults every AI learning phase flag to false", () => {
    expect(defaultSettings.features).toMatchObject({
      aiLearnThis: false,
      aiOcclusionAssist: false,
      aiOcclusionFreeform: false,
      aiSemanticIndex: false,
      aiLibraryRag: false,
      aiActiveRecall: false,
      aiAnswerAssessment: false,
      aiAutoGradeSuggest: false,
      aiPrerequisites: false,
      aiConceptLinks: false,
      aiExtractWorthiness: false,
      aiSocraticTutor: false,
      aiAgent: false,
    });
    // Existing flags keep their defaults.
    expect(defaultSettings.features.notebooklmEnabled).toBe(false);
    expect(defaultSettings.features.fsrsScopedParametersEnabled).toBe(true);
    expect(defaultSettings.features.reviewUndoEnabled).toBe(true);
    expect(defaultSettings.features.cramModeEnabled).toBe(true);
  });

  it("round-trips a toggled AI feature flag", () => {
    useSettingsStore.getState().updateSettingsCategory("features", {
      aiLearnThis: true,
      aiSocraticTutor: true,
    });

    const stored = JSON.parse(localStorage.getItem("incrementum-settings") || "{}");
    expect(stored.state.settings.features.aiLearnThis).toBe(true);
    expect(stored.state.settings.features.aiSocraticTutor).toBe(true);
    // Untouched flags keep the default.
    expect(stored.state.settings.features.aiAgent).toBe(false);
  });

  it("merges the new flags as false for existing users on rehydration", async () => {
    // A pre-AI persist only knows the original four flags; the deep merge in
    // onRehydrateStorage must fill the new ones with defaults while preserving
    // any explicit persisted value.
    localStorage.setItem("incrementum-settings", JSON.stringify({
      state: {
        settings: {
          features: {
            notebooklmEnabled: true,
            cramModeEnabled: false,
            aiLibraryRag: true,
          },
        },
      },
      version: 6,
    }));

    await useSettingsStore.persist.rehydrate();

    const features = useSettingsStore.getState().settings.features;
    expect(features.notebooklmEnabled).toBe(true);
    expect(features.cramModeEnabled).toBe(false);
    expect(features.aiLibraryRag).toBe(true);
    expect(features.aiLearnThis).toBe(false);
    expect(features.aiOcclusionAssist).toBe(false);
    expect(features.aiOcclusionFreeform).toBe(false);
    expect(features.aiSemanticIndex).toBe(false);
    expect(features.aiActiveRecall).toBe(false);
    expect(features.aiAnswerAssessment).toBe(false);
    expect(features.aiAutoGradeSuggest).toBe(false);
    expect(features.aiPrerequisites).toBe(false);
    expect(features.aiConceptLinks).toBe(false);
    expect(features.aiExtractWorthiness).toBe(false);
    expect(features.aiSocraticTutor).toBe(false);
    expect(features.aiAgent).toBe(false);
  });
});

describe("settingsStore sessionItemTypes default", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: cloneDefaults() });
  });

  it("defaults all three item types to enabled (matching the composition defaults)", () => {
    expect(defaultSettings.smartQueue.sessionItemTypes).toEqual({
      documents: true,
      extracts: true,
      learningItems: true,
    });
  });

  it("keeps a persisted sessionItemTypes with extracts disabled through rehydration", async () => {
    // A user who deliberately unchecked Extracts (customization flag set)
    // keeps that selection after the all-true default change.
    localStorage.setItem("incrementum-settings", JSON.stringify({
      state: {
        settings: {
          smartQueue: {
            sessionItemTypes: { documents: true, extracts: false, learningItems: true },
            sessionItemTypesCustomized: true,
          },
        },
      },
      version: 6,
    }));

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().settings.smartQueue.sessionItemTypes).toEqual({
      documents: true,
      extracts: false,
      learningItems: true,
    });
  });
});
