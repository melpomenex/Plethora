/**
 * Provider-neutral platform-ML capability surface.
 *
 * Generative routing stays on `AIProvider` / `runTask`. These descriptors
 * describe speech, vision, language ID, search, and translation so React
 * never imports ML Kit or Gemini types.
 */

export const PLATFORM_CAPABILITY_IDS = [
  "speech.transcribe",
  "vision.scan",
  "language.identify",
  "search.semantic",
  "translate.sentence",
] as const;

export type PlatformCapabilityId = (typeof PLATFORM_CAPABILITY_IDS)[number];

export type PlatformPrivacy = "on-device" | "may-leave-device";

export interface PlatformCapabilityDescriptor {
  id: PlatformCapabilityId;
  available: boolean;
  ready: boolean;
  requiresDownload: boolean;
  downloadSizeBytes?: number;
  onDevice: boolean;
  networkRequired: boolean;
  foregroundOnly: boolean;
  supportsStreaming: boolean;
  supportsImages: boolean;
  supportsStructuredOutput: boolean;
  supportedLanguages: string[];
  modelName?: string;
  modelVersion?: string;
  privacy: PlatformPrivacy;
  reason?: string;
}

export function unavailableDescriptor(
  id: PlatformCapabilityId,
  reason = "platform_unsupported"
): PlatformCapabilityDescriptor {
  return {
    id,
    available: false,
    ready: false,
    requiresDownload: false,
    onDevice: false,
    networkRequired: false,
    foregroundOnly: false,
    supportsStreaming: false,
    supportsImages: false,
    supportsStructuredOutput: false,
    supportedLanguages: [],
    privacy: "on-device",
    reason,
  };
}
