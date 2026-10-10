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

    const stored = JSON.parse(localStorage.getItem("plethora-settings") || "{}");
    expect(stored.version).toBe(15);
    expect(stored.state.settings.notifications).toMatchObject({
      enabled: true,
      reminderTime: "07:30",
      feedbackSoundsEnabled: true,
    });
  });

  it("deep-merges a partial persisted notification slice", async () => {
    localStorage.setItem("plethora-settings", JSON.stringify({
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

describe("settingsStore independent haptic settings (v15)", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: cloneDefaults() });
  });

  async function rehydrate(state: unknown, version = 14) {
    localStorage.setItem("plethora-settings", JSON.stringify({ state, version }));
    await useSettingsStore.persist.rehydrate();
    return useSettingsStore.getState().settings;
  }

  it("defaults fresh settings to enabled subtle intensity", () => {
    expect(defaultSettings.haptics).toEqual({ enabled: true, intensity: "subtle" });
  });

  it("defaults haptics on independently of the legacy sound opt-out", async () => {
    const settings = await rehydrate({ settings: { notifications: { feedbackSoundsEnabled: false } } });
    expect(settings.haptics).toEqual({ enabled: true, intensity: "subtle" });
    expect(settings.notifications.feedbackSoundsEnabled).toBe(false);
  });

  it("preserves explicit haptic settings and seeds a root-format legacy opt-in", async () => {
    const explicit = await rehydrate({ settings: { haptics: { enabled: false, intensity: "strong" } } });
    expect(explicit.haptics).toEqual({ enabled: false, intensity: "strong" });
    const legacy = await rehydrate({ notifications: { feedbackSoundsEnabled: true } });
    expect(legacy.haptics).toEqual({ enabled: true, intensity: "subtle" });
  });

  it("uses enabled/subtle for missing or malformed legacy values", async () => {
    expect((await rehydrate({ settings: {} })).haptics).toEqual({ enabled: true, intensity: "subtle" });
    const malformed = await rehydrate({ settings: { notifications: { feedbackSoundsEnabled: "yes" }, haptics: { enabled: 1, intensity: "loud" } } });
    expect(malformed.haptics).toEqual({ enabled: true, intensity: "subtle" });
  });

  it("backfills a same-version partial category without changing audio or visual settings", async () => {
    const settings = await rehydrate({ settings: { haptics: { intensity: "standard" }, appearance: { visualFeedbackEnabled: false }, notifications: { feedbackSoundsEnabled: false } } }, 15);
    expect(settings.haptics).toEqual({ enabled: true, intensity: "standard" });
    expect(settings.appearance.visualFeedbackEnabled).toBe(false);
    expect(settings.notifications.feedbackSoundsEnabled).toBe(false);
  });
});

describe("settingsStore flashcard generation target migration", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: cloneDefaults() });
  });

  it("seeds flashcardFixedCount from a previously persisted cardsPerExtract on migration", async () => {
    localStorage.setItem("plethora-settings", JSON.stringify({
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
    localStorage.setItem("plethora-settings", JSON.stringify({
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
    expect(defaultSettings.learning.arenaReviewMode).toBe("automatic");
  });

  it("round-trips the explicit chooser preference", () => {
    useSettingsStore.getState().updateSettingsCategory("learning", {
      arenaReviewMode: "choose",
    });

    const stored = JSON.parse(localStorage.getItem("plethora-settings") || "{}");
    expect(stored.state.settings.learning.arenaReviewMode).toBe("choose");
  });
});

describe("settingsStore AI learning feature flags", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: cloneDefaults() });
  });

  it("defaults AI learning system flags to enabled", () => {
    expect(defaultSettings.features).toMatchObject({
      aiLearnThis: true,
      aiOcclusionAssist: true,
      aiOcclusionFreeform: false,
      aiSemanticIndex: true,
      aiLibraryRag: true,
      aiActiveRecall: true,
      aiAnswerAssessment: true,
      aiAutoGradeSuggest: false,
      aiPrerequisites: true,
      aiConceptLinks: true,
      aiExtractWorthiness: true,
      aiSocraticTutor: true,
      aiAgent: true,
      androidAppSearchIndex: true,
    });
    // Existing flags keep their defaults.
    expect(defaultSettings.features.appleFoundationModels).toBe(true);
    expect(defaultSettings.features.appleCoreAI).toBe(false);
    expect(defaultSettings.features.notebooklmEnabled).toBe(false);
    expect(defaultSettings.features.fsrsScopedParametersEnabled).toBe(true);
    expect(defaultSettings.features.reviewUndoEnabled).toBe(true);
    expect(defaultSettings.features.cramModeEnabled).toBe(true);
  });

  it("round-trips a toggled AI feature flag", () => {
    useSettingsStore.getState().updateSettingsCategory("features", {
      aiLearnThis: false,
      aiSocraticTutor: false,
    });

    const stored = JSON.parse(localStorage.getItem("plethora-settings") || "{}");
    expect(stored.state.settings.features.aiLearnThis).toBe(false);
    expect(stored.state.settings.features.aiSocraticTutor).toBe(false);
    // Untouched flags keep the default.
    expect(stored.state.settings.features.aiAgent).toBe(true);
  });

  it("merges the new flags for existing users on rehydration", async () => {
    // A pre-AI persist only knows the original four flags; the deep merge in
    // onRehydrateStorage must fill the new ones with defaults while preserving
    // any explicit persisted value.
    localStorage.setItem("plethora-settings", JSON.stringify({
      state: {
        settings: {
          features: {
            notebooklmEnabled: true,
            cramModeEnabled: false,
            aiLibraryRag: false,
          },
        },
      },
      version: 6,
    }));

    await useSettingsStore.persist.rehydrate();

    const features = useSettingsStore.getState().settings.features;
    expect(features.notebooklmEnabled).toBe(true);
    expect(features.cramModeEnabled).toBe(false);
    expect(features.aiLibraryRag).toBe(false);
    expect(features.aiLearnThis).toBe(true);
    expect(features.aiOcclusionAssist).toBe(true);
    expect(features.aiOcclusionFreeform).toBe(false);
    expect(features.aiSemanticIndex).toBe(true);
    expect(features.aiActiveRecall).toBe(true);
    expect(features.aiAnswerAssessment).toBe(true);
    expect(features.aiAutoGradeSuggest).toBe(false);
    expect(features.aiPrerequisites).toBe(true);
    expect(features.aiConceptLinks).toBe(true);
    expect(features.aiExtractWorthiness).toBe(true);
    expect(features.aiSocraticTutor).toBe(true);
    expect(features.aiAgent).toBe(true);
    expect(features.androidAppSearchIndex).toBe(true);
  });

  it("turns Android speech and AppSearch on when migrating from persist v8", async () => {
    localStorage.setItem("plethora-settings", JSON.stringify({
      state: {
        settings: {
          audioTranscription: { preferAndroidSpeech: false },
          features: { androidAppSearchIndex: false },
        },
      },
      version: 8,
    }));

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().settings.audioTranscription.preferAndroidSpeech).toBe(true);
    expect(useSettingsStore.getState().settings.features.androidAppSearchIndex).toBe(true);
    expect(useSettingsStore.getState().settings.ai.allowCloudFallback).toBe(false);
  });

  it("seeds androidOnDevice defaults (capped pacing) when migrating from persist v9", async () => {
    localStorage.setItem("plethora-settings", JSON.stringify({
      state: {
        settings: {
          audioTranscription: { provider: "local", preferAndroidSpeech: true },
        },
      },
      version: 9,
    }));

    await useSettingsStore.persist.rehydrate();

    const audio = useSettingsStore.getState().settings.audioTranscription;
    expect(audio.provider).toBe("local");
    expect(audio.androidOnDevice).toEqual({ modelId: "", pacing: "capped" });
  });

  it("keeps an explicit android-ondevice provider through migration without flipping it", async () => {
    localStorage.setItem("plethora-settings", JSON.stringify({
      state: {
        settings: {
          audioTranscription: {
            provider: "android-ondevice",
            androidOnDevice: { modelId: "parakeet-en-110m-int8", pacing: "full" },
          },
        },
      },
      version: 10,
    }));

    await useSettingsStore.persist.rehydrate();

    const audio = useSettingsStore.getState().settings.audioTranscription;
    expect(audio.provider).toBe("android-ondevice");
    expect(audio.androidOnDevice).toEqual({ modelId: "parakeet-en-110m-int8", pacing: "full" });
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
    localStorage.setItem("plethora-settings", JSON.stringify({
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


describe("settingsStore language learning opt-in migration (v10 → v11)", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: cloneDefaults() });
  });

  it("migrates legacy suggestion defaults to enabled: false (no silent opt-in)", async () => {
    localStorage.setItem("plethora-settings", JSON.stringify({
      state: {
        settings: {
          languageLearning: { suggestionsEnabled: true, showUnavailableProviders: true },
        },
      },
      version: 10,
    }));

    await useSettingsStore.persist.rehydrate();

    const languageLearning = useSettingsStore.getState().settings.languageLearning;
    expect(languageLearning.enabled).toBe(false);
    // Presentation sub-flags survive; only the master opt-in is forced OFF.
    expect(languageLearning.suggestionsEnabled).toBe(true);
    expect(languageLearning.showUnavailableProviders).toBe(true);
  });

  it("preserves an explicit v11 opt-in", async () => {
    localStorage.setItem("plethora-settings", JSON.stringify({
      state: {
        settings: {
          languageLearning: { enabled: true, suggestionsEnabled: false, showUnavailableProviders: true },
        },
      },
      version: 11,
    }));

    await useSettingsStore.persist.rehydrate();

    const languageLearning = useSettingsStore.getState().settings.languageLearning;
    expect(languageLearning.enabled).toBe(true);
    expect(languageLearning.suggestionsEnabled).toBe(false);
  });

  it("defaults language learning to disabled for fresh installs", () => {
    expect(defaultSettings.languageLearning.enabled).toBe(false);
  });

  it("migrates v11 groq provider to fast transcription mode", async () => {
    localStorage.setItem("plethora-settings", JSON.stringify({
      state: {
        settings: {
          audioTranscription: { provider: "groq", preferAndroidSpeech: true },
        },
      },
      version: 11,
    }));

    await useSettingsStore.persist.rehydrate();

    const audio = useSettingsStore.getState().settings.audioTranscription;
    expect(audio.mode).toBe("fast");
    expect(audio.sttProvider).toBe("openrouter");
    expect(audio.sttModel).toBe("automatic");
    expect(audio.preferLocal).toBe(true);
    expect(audio.automaticFallback).toBe(true);
  });

  it("migrates v12 local provider to sttProvider local", async () => {
    localStorage.setItem("plethora-settings", JSON.stringify({
      state: {
        settings: {
          audioTranscription: { provider: "local", mode: "offline" },
        },
      },
      version: 12,
    }));

    await useSettingsStore.persist.rehydrate();

    const audio = useSettingsStore.getState().settings.audioTranscription;
    expect(audio.sttProvider).toBe("local");
    expect(audio.openrouter?.defaultModel).toContain("nemotron");
  });

  it("defaults transcription mode to auto for fresh installs", () => {
    expect(defaultSettings.audioTranscription.mode).toBe("auto");
    expect(defaultSettings.audioTranscription.sttProvider).toBe("automatic");
    expect(defaultSettings.audioTranscription.preferLocal).toBe(true);
  });

  it("persists the master toggle through updateSettings", () => {
    useSettingsStore.getState().updateSettings({
      languageLearning: { enabled: true, suggestionsEnabled: true, showUnavailableProviders: true },
    });

    const stored = JSON.parse(localStorage.getItem("plethora-settings") || "{}");
    expect(stored.state.settings.languageLearning.enabled).toBe(true);
    expect(useSettingsStore.getState().settings.languageLearning.enabled).toBe(true);
  });
});

describe("settingsStore sponsorBlock settings (v14)", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: JSON.parse(JSON.stringify(defaultSettings)) });
  });

  it("defaults to enabled, matching the ungated behaviour that shipped", () => {
    const sb = useSettingsStore.getState().settings.sponsorBlock;
    expect(sb.enabled).toBe(true);
    expect(sb.autoSkip).toBe(true);
    expect(sb.notifications).toBe(true);
    expect(sb.cacheDuration).toBe(48);
  });

  it("defaults only the categories the service is actually asked for", () => {
    const { categories } = useSettingsStore.getState().settings.sponsorBlock;
    expect(Object.keys(categories).sort()).toEqual(
      ["intro", "interaction", "music_offtopic", "outro", "preview", "selfpromo", "sponsor"].sort()
    );
  });

  it("migrates a v13 blob by adding the whole category", async () => {
    localStorage.setItem("plethora-settings", JSON.stringify({
      state: { settings: { general: { language: "en" } } },
      version: 13,
    }));

    await useSettingsStore.persist.rehydrate();

    const sb = useSettingsStore.getState().settings.sponsorBlock;
    expect(sb.enabled).toBe(true);
    expect(sb.categories.sponsor).toBe(true);
    expect(sb.categories.selfpromo).toBe(false);
    // The pre-existing slice survives the migration.
    expect(useSettingsStore.getState().settings.general.language).toBe("en");
  });

  it("backfills individual missing fields on a partial blob", async () => {
    localStorage.setItem("plethora-settings", JSON.stringify({
      state: { settings: { sponsorBlock: { enabled: false } } },
      version: 13,
    }));

    await useSettingsStore.persist.rehydrate();

    const sb = useSettingsStore.getState().settings.sponsorBlock;
    expect(sb.enabled).toBe(false);          // the user's own choice, kept
    expect(sb.autoSkip).toBe(true);          // backfilled
    expect(sb.notifications).toBe(true);     // backfilled
    expect(sb.cacheDuration).toBe(48);       // backfilled
    expect(sb.categories.sponsor).toBe(true); // backfilled
  });

  it("keeps the other six categories intact when one is toggled", () => {
    const { updateSettingsCategory } = useSettingsStore.getState();
    const before = { ...useSettingsStore.getState().settings.sponsorBlock.categories };

    updateSettingsCategory("sponsorBlock", {
      ...useSettingsStore.getState().settings.sponsorBlock,
      categories: { ...before, selfpromo: true },
    });

    const after = useSettingsStore.getState().settings.sponsorBlock.categories;
    expect(after.selfpromo).toBe(true);
    for (const key of Object.keys(before)) {
      if (key === "selfpromo") continue;
      expect(after[key as keyof typeof after]).toBe(before[key as keyof typeof before]);
    }
  });

  it("persists a category change across a rehydrate", async () => {
    const { updateSettingsCategory } = useSettingsStore.getState();
    updateSettingsCategory("sponsorBlock", {
      ...useSettingsStore.getState().settings.sponsorBlock,
      autoSkip: false,
      categories: {
        ...useSettingsStore.getState().settings.sponsorBlock.categories,
        music_offtopic: true,
      },
    });

    await useSettingsStore.persist.rehydrate();

    const sb = useSettingsStore.getState().settings.sponsorBlock;
    expect(sb.autoSkip).toBe(false);
    expect(sb.categories.music_offtopic).toBe(true);
  });
});

describe("settingsStore DAQE session goal", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: cloneDefaults() });
  });

  it("defaults to no goal and no history", () => {
    const daqe = useSettingsStore.getState().settings.daqe;
    expect(daqe.sessionGoal).toBe("");
    expect(daqe.recentGoals).toEqual([]);
  });

  it("reads a pre-existing blob written before the fields existed as empty", async () => {
    // A blob with a daqe slice but neither field: the case the spread alone would
    // hand back as `undefined`, and the reason the hydration coerces them.
    localStorage.setItem("plethora-settings", JSON.stringify({
      state: { settings: { daqe: { rankingEnabled: true } } },
      version: 14,
    }));

    await useSettingsStore.persist.rehydrate();

    const daqe = useSettingsStore.getState().settings.daqe;
    expect(daqe.sessionGoal).toBe("");
    expect(daqe.recentGoals).toEqual([]);
    expect(daqe.rankingEnabled).toBe(true);
  });

  it("repairs a hand-edited goal and history rather than storing them raw", async () => {
    localStorage.setItem("plethora-settings", JSON.stringify({
      state: {
        settings: {
          daqe: {
            sessionGoal: "   ",
            recentGoals: ["Exam Review", "", null, "exam review"],
          },
        },
      },
      version: 14,
    }));

    await useSettingsStore.persist.rehydrate();

    const daqe = useSettingsStore.getState().settings.daqe;
    expect(daqe.sessionGoal).toBe("");
    expect(daqe.recentGoals).toEqual(["Exam Review"]);
  });

  it("round-trips a committed goal and its history across a rehydrate", async () => {
    useSettingsStore.getState().updateSettingsCategory("daqe", {
      sessionGoal: "Exam Review & CS Foundations",
      recentGoals: ["Exam Review & CS Foundations", "Linear Algebra"],
    });

    await useSettingsStore.persist.rehydrate();

    const daqe = useSettingsStore.getState().settings.daqe;
    expect(daqe.sessionGoal).toBe("Exam Review & CS Foundations");
    expect(daqe.recentGoals).toEqual([
      "Exam Review & CS Foundations",
      "Linear Algebra",
    ]);
  });

  it("never persists an API key alongside the goal", () => {
    useSettingsStore.getState().updateSettingsCategory("daqe", {
      sessionGoal: "Exam Review",
    });

    const stored = JSON.parse(localStorage.getItem("plethora-settings") || "{}");
    expect(JSON.stringify(stored)).not.toMatch(/apiKey"\s*:\s*"[^"]/);
    expect(stored.state.settings.daqe.decisionApiKeySet).toBe(false);
  });
});
