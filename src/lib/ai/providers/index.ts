/**
 * Provider registry used by the task router (design D1/D3).
 *
 * Ordering encodes preference: when the user prefers on-device (default on
 * Android), the on-device provider is offered first and cloud acts as the
 * explicit fallback — mirroring `provider.ts` `resolveAiPath`.
 */

import { prefersOnDevice } from "../provider";
import { useSettingsStore } from "../../../stores/settingsStore";
import type { AIProvider } from "./types";
import { getCloudProvider } from "./cloudProvider";
import { getOnDeviceProvider, ON_DEVICE_PROVIDER_ID } from "./onDeviceProvider";
import {
  getAppleFoundationProvider,
  APPLE_FOUNDATION_PROVIDER_ID,
} from "./appleFoundationProvider";
import { getAppleCoreAiProvider, APPLE_CORE_AI_PROVIDER_ID } from "./appleCoreAiProvider";

export * from "./types";
export { CloudProvider, getCloudProvider, capabilitiesFromCloudConfig, cloudModelSupportsReasoning, CLOUD_PROVIDER_ID } from "./cloudProvider";
export {
  OnDeviceProvider,
  getOnDeviceProvider,
  capabilitiesFromSnapshot,
  toNativeRequest,
  ON_DEVICE_PROVIDER_ID,
} from "./onDeviceProvider";
export {
  AppleFoundationProvider,
  getAppleFoundationProvider,
  APPLE_FOUNDATION_PROVIDER_ID,
} from "./appleFoundationProvider";
export {
  AppleCoreAiProvider,
  getAppleCoreAiProvider,
  APPLE_CORE_AI_PROVIDER_ID,
} from "./appleCoreAiProvider";

/**
 * Candidate providers in routing-preference order. Returns fresh capability
 * lookups per call so capability changes re-evaluate without an app restart.
 */
export function getRoutingProviders(preferOnDeviceFirst: boolean = prefersOnDevice()): AIProvider[] {
  const nano = getOnDeviceProvider();
  const appleFm = getAppleFoundationProvider();
  const appleCore = getAppleCoreAiProvider();
  const preferred = useSettingsStore.getState().settings.ai.preferredOnDeviceProviderId;
  const onDevice = [nano, appleFm, appleCore];
  if (preferred === APPLE_FOUNDATION_PROVIDER_ID) {
    onDevice.splice(0, onDevice.length, appleFm, nano, appleCore);
  } else if (preferred === APPLE_CORE_AI_PROVIDER_ID) {
    onDevice.splice(0, onDevice.length, appleCore, nano, appleFm);
  } else if (preferred === ON_DEVICE_PROVIDER_ID) {
    onDevice.splice(0, onDevice.length, nano, appleFm, appleCore);
  }
  const cloud = getCloudProvider();
  return preferOnDeviceFirst ? [...onDevice, cloud] : [cloud, ...onDevice];
}
