import type { AIProviderKind } from "./providers/types";
import type { AITaskFallbackPath } from "./tasks/types";

export type OnDeviceRunLabel = "On-device" | null;

/**
 * Single-run privacy chip. Never badge every generated sentence.
 * Cloud fallback must not claim on-device processing.
 */
export function onDeviceRunLabel(
  providerKind: AIProviderKind | "retrieval-only",
  fallbackPath: AITaskFallbackPath = "none"
): OnDeviceRunLabel {
  if (fallbackPath === "cloud-fallback") return null;
  if (
    providerKind === "ondevice" ||
    providerKind === "local-model" ||
    providerKind === "retrieval-only"
  ) {
    return "On-device";
  }
  return null;
}
