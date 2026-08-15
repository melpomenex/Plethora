/**
 * Provider registry used by the task router (design D1/D3).
 *
 * Ordering encodes preference: when the user prefers on-device (default on
 * Android), the on-device provider is offered first and cloud acts as the
 * explicit fallback — mirroring `provider.ts` `resolveAiPath`.
 */

import { prefersOnDevice } from "../provider";
import type { AIProvider } from "./types";
import { getCloudProvider } from "./cloudProvider";
import { getOnDeviceProvider } from "./onDeviceProvider";

export * from "./types";
export { CloudProvider, getCloudProvider, capabilitiesFromCloudConfig, cloudModelSupportsReasoning, CLOUD_PROVIDER_ID } from "./cloudProvider";
export {
  OnDeviceProvider,
  getOnDeviceProvider,
  capabilitiesFromSnapshot,
  toNativeRequest,
  ON_DEVICE_PROVIDER_ID,
} from "./onDeviceProvider";

/**
 * Candidate providers in routing-preference order. Returns fresh capability
 * lookups per call so capability changes re-evaluate without an app restart.
 */
export function getRoutingProviders(preferOnDeviceFirst: boolean = prefersOnDevice()): AIProvider[] {
  const onDevice = getOnDeviceProvider();
  const cloud = getCloudProvider();
  return preferOnDeviceFirst ? [onDevice, cloud] : [cloud, onDevice];
}
