/**
 * Discover on-device AI providers for surfaces that maintain their own
 * provider picker (Flashcard Studio, etc.) outside the cloud LLM registry.
 */

import { useSettingsStore } from "../../stores/settingsStore";
import { isOnDeviceAiAvailable } from "./onDeviceAI";
import {
  APPLE_FOUNDATION_PROVIDER_ID,
  getAppleFoundationProvider,
} from "./providers/appleFoundationProvider";
import { ON_DEVICE_PROVIDER_ID } from "./providers/onDeviceProvider";

export interface OnDeviceProviderOption {
  id: string;
  label: string;
}

export function isCatalogOnDeviceProviderId(id: string | null | undefined): boolean {
  return id === ON_DEVICE_PROVIDER_ID || id === APPLE_FOUNDATION_PROVIDER_ID;
}

/** Resolve a user-visible label for a catalog on-device provider id. */
export function labelForOnDeviceProviderId(id: string): string {
  if (id === APPLE_FOUNDATION_PROVIDER_ID) return "Apple Intelligence";
  return "On-device (Nano)";
}

/**
 * List on-device providers that can serve text generation right now, respecting
 * the Apple Foundation Models feature flag.
 */
export async function listAvailableOnDeviceProviders(): Promise<OnDeviceProviderOption[]> {
  const options: OnDeviceProviderOption[] = [];

  const nano = await isOnDeviceAiAvailable();
  if (nano.status === "available") {
    options.push({
      id: ON_DEVICE_PROVIDER_ID,
      label: labelForOnDeviceProviderId(ON_DEVICE_PROVIDER_ID),
    });
  }

  const flags = useSettingsStore.getState().settings.features;
  if (flags.appleFoundationModels !== false) {
    try {
      const caps = await getAppleFoundationProvider().getCapabilities();
      if (caps.textGeneration) {
        options.push({
          id: APPLE_FOUNDATION_PROVIDER_ID,
          label: labelForOnDeviceProviderId(APPLE_FOUNDATION_PROVIDER_ID),
        });
      }
    } catch {
      // FM unavailable — omit from the picker.
    }
  }

  return options;
}
