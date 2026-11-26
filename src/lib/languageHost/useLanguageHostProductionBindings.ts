import { useCallback, useEffect, useMemo, useState } from "react";
import { useLLMProvidersStore } from "../../stores/llmProvidersStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { LanguageProfile } from "../../types/languageProfile";
import type { AiPath } from "../ai/provider";
import { getEffectiveAiPathSync, refreshAiTranslationPath } from "../languageTranslation/aiTranslate";
import type { LanguageHostCapabilityName, LanguageHostCapability, LanguageHostSurface } from "./types";
import {
  createProductionLanguageHostBindings,
  resolveLanguageHostCapabilities,
} from "./capabilities";

export interface LanguageHostProductionBindings {
  resolveCapabilities: (input: { surface: LanguageHostSurface; profile: import("../../types/languageProfile").LanguageProfile }) => Partial<Record<LanguageHostCapabilityName, LanguageHostCapability>>;
  shadowingProviders: ReturnType<typeof createProductionLanguageHostBindings>["shadowingProviders"];
  writingProvider: ReturnType<typeof createProductionLanguageHostBindings>["writingProvider"];
  pronunciationManifest: ReturnType<typeof createProductionLanguageHostBindings>["pronunciationManifest"];
  readingAssistRegistry: ReturnType<typeof createProductionLanguageHostBindings>["readingAssistRegistry"];
}

/** Production wiring for Language Mode host providers and truthful capabilities. */
export function useLanguageHostProductionBindings(surface: LanguageHostSurface): LanguageHostProductionBindings {
  const aiSettings = useSettingsStore((state) => state.settings.ai);
  const languageLearningSettings = useSettingsStore((state) => state.settings.languageLearning);
  const foundryLocal = useSettingsStore((state) => state.settings.foundryLocal);
  const decisionEngine = useSettingsStore((state) => state.settings.daqe?.decisionEngine);
  const features = useSettingsStore((state) => state.settings.features);
  const audioTranscription = useSettingsStore((state) => state.settings.audioTranscription);
  const providers = useLLMProvidersStore((state) => state.providers);

  const [online, setOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));
  const [aiPath, setAiPath] = useState<AiPath>(() => getEffectiveAiPathSync());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAiPath(getEffectiveAiPathSync());
    void refreshAiTranslationPath().then((nextPath) => {
      if (!cancelled) setAiPath(nextPath);
    });
    return () => {
      cancelled = true;
    };
  }, [aiSettings, languageLearningSettings, foundryLocal, decisionEngine, features, providers, online]);

  const bindings = useMemo(
    () => createProductionLanguageHostBindings(aiPath),
    [aiPath, audioTranscription, decisionEngine, features, foundryLocal, providers],
  );
  const resolveCapabilities = useCallback(
    (input: { surface: LanguageHostSurface; profile: LanguageProfile }) =>
      resolveLanguageHostCapabilities({
        surface: input.surface ?? surface,
        profile: input.profile,
        aiPath,
      }),
    [aiPath, audioTranscription, decisionEngine, features, foundryLocal, languageLearningSettings, online, providers, surface],
  );
  return { ...bindings, resolveCapabilities };
}
