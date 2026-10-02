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
import {
  getWindowsSystemProvider,
  WINDOWS_SYSTEM_PROVIDER_ID,
} from "./windowsSystemProvider";
import {
  getFoundryLocalProvider,
  FOUNDRY_LOCAL_PROVIDER_ID,
} from "./foundryLocalProvider";
import {
  LocalDecisionEngineProvider,
  LOCAL_DECISION_ENGINE_PROVIDER_ID,
} from "./localModelProvider";
import { isWindowsDesktop } from "../windows/capabilities";

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
export {
  WindowsSystemProvider,
  getWindowsSystemProvider,
  WINDOWS_SYSTEM_PROVIDER_ID,
} from "./windowsSystemProvider";
export {
  FoundryLocalProvider,
  getFoundryLocalProvider,
  FOUNDRY_LOCAL_PROVIDER_ID,
} from "./foundryLocalProvider";
export {
  LocalDecisionEngineProvider,
  LOCAL_DECISION_ENGINE_PROVIDER_ID,
} from "./localModelProvider";

/**
 * The user-installed decision engine, when one is configured.
 *
 * Offered *after* the built-in on-device providers rather than before: a decision
 * engine is an explicitly chosen extra, so it should win only when the built-in
 * options cannot serve the task. Registered here, in the existing registry, so
 * `resolveTaskRoute` finds it with no routing change at all.
 */
export function getLocalDecisionEngineProvider(
  config: { baseUrl: string; model: string; timeoutMs?: number } | null | undefined
): AIProvider | null {
  if (!config?.baseUrl || !config.model) return null;
  return new LocalDecisionEngineProvider(config);
}

/** True when the given provider id is the user's decision engine. */
export function isLocalDecisionEngine(id: string): boolean {
  return id === LOCAL_DECISION_ENGINE_PROVIDER_ID;
}

function buildOnDeviceProviders(): AIProvider[] {
  const nano = getOnDeviceProvider();
  const appleFm = getAppleFoundationProvider();
  const appleCore = getAppleCoreAiProvider();
  const windows = getWindowsSystemProvider();
  const foundryEnabled =
    useSettingsStore.getState().settings.foundryLocal?.enabled === true;
  const foundry = foundryEnabled ? getFoundryLocalProvider() : null;

  if (isWindowsDesktop()) {
    return [
      windows,
      ...(foundry ? [foundry] : []),
      nano,
    ];
  }

  const decisionEngine = getLocalDecisionEngineProvider(
    useSettingsStore.getState().settings.daqe?.decisionEngine
  );

  return [
    nano,
    appleFm,
    appleCore,
    ...(decisionEngine ? [decisionEngine] : []),
  ];
}

function pinPreferredOnDevice(providers: AIProvider[]): AIProvider[] {
  const preferred = useSettingsStore.getState().settings.ai.preferredOnDeviceProviderId;
  if (!preferred) return providers;

  const foundryEnabled =
    useSettingsStore.getState().settings.foundryLocal?.enabled === true;
  const windows = getWindowsSystemProvider();
  const foundry = foundryEnabled ? getFoundryLocalProvider() : null;
  const nano = getOnDeviceProvider();
  const appleFm = getAppleFoundationProvider();
  const appleCore = getAppleCoreAiProvider();

  if (preferred === WINDOWS_SYSTEM_PROVIDER_ID) {
    return [
      windows,
      ...(foundry ? [foundry] : []),
      nano,
      appleFm,
      appleCore,
    ];
  }
  if (preferred === FOUNDRY_LOCAL_PROVIDER_ID && foundry) {
    return [foundry, windows, nano, appleFm, appleCore];
  }
  if (preferred === APPLE_FOUNDATION_PROVIDER_ID) {
    return isWindowsDesktop()
      ? [appleFm, windows, ...(foundry ? [foundry] : []), nano, appleCore]
      : [appleFm, nano, appleCore];
  }
  if (preferred === APPLE_CORE_AI_PROVIDER_ID) {
    return isWindowsDesktop()
      ? [appleCore, windows, ...(foundry ? [foundry] : []), nano, appleFm]
      : [appleCore, nano, appleFm];
  }
  if (preferred === ON_DEVICE_PROVIDER_ID) {
    return isWindowsDesktop()
      ? [nano, windows, ...(foundry ? [foundry] : []), appleFm, appleCore]
      : [nano, appleFm, appleCore];
  }

  return providers;
}

/**
 * Candidate providers in routing-preference order. Returns fresh capability
 * lookups per call so capability changes re-evaluate without an app restart.
 */
export function getRoutingProviders(preferOnDeviceFirst: boolean = prefersOnDevice()): AIProvider[] {
  const onDevice = pinPreferredOnDevice(buildOnDeviceProviders());
  const cloud = getCloudProvider();
  return preferOnDeviceFirst ? [...onDevice, cloud] : [cloud, ...onDevice];
}
