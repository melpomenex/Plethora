/**
 * Whether any AI path (on-device or cloud) can serve an action right now.
 *
 * AI-assisted controls gate on this so they stay hidden when neither path
 * exists, and appear on an Android device with Gemini Nano even though no cloud
 * provider is configured.
 */

import { useEffect, useState } from "react";
import { useLLMProvidersStore } from "../../stores/llmProvidersStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { hasCloudProvider, resolveAiPath, type AiPath } from "./provider";
import type { OnDeviceRequirement } from "./onDeviceAI";

export interface AiAvailability {
  path: AiPath;
  available: boolean;
  /** True until the first resolution completes. */
  loading: boolean;
}

/**
 * Resolve the active AI path, re-resolving when the provider registry or the
 * on-device preference changes. Starts optimistic about the cloud path so a
 * configured provider's controls do not flicker on mount.
 */
export function useAiAvailability(requirement: OnDeviceRequirement = "prompt"): AiAvailability {
  const providers = useLLMProvidersStore((s) => s.providers);
  const preferOnDevice = useSettingsStore((s) => s.settings.ai.preferOnDevice);
  const appleFoundationModels = useSettingsStore((s) => s.settings.features.appleFoundationModels);

  const [state, setState] = useState<AiAvailability>(() => ({
    path: hasCloudProvider() ? "cloud" : "none",
    available: hasCloudProvider(),
    loading: true,
  }));

  useEffect(() => {
    let cancelled = false;
    void resolveAiPath(requirement).then((path) => {
      if (cancelled) return;
      setState({ path, available: path !== "none", loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [providers, preferOnDevice, appleFoundationModels, requirement]);

  return state;
}
