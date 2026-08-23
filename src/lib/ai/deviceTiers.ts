/**
 * Hardware tiers for optional Plethora-managed models (OpenSpec H).
 * Low-end devices must never be offered a multi-GB generative pack.
 */

export type DeviceAiTier = "none" | "embed" | "gen";

export interface DeviceInfo {
  totalRamMb: number;
  availableRamMb?: number;
  hasAccelerator?: boolean;
}

const EMBED_RAM_MB = 3072;
const GEN_RAM_MB = 6144;

export function classifyDeviceAiTier(info: DeviceInfo): DeviceAiTier {
  if (!Number.isFinite(info.totalRamMb) || info.totalRamMb < EMBED_RAM_MB) {
    return "none";
  }
  if (info.totalRamMb >= GEN_RAM_MB && info.hasAccelerator) {
    return "gen";
  }
  return "embed";
}

export function mayOfferGenerativeAiPack(tier: DeviceAiTier): boolean {
  return tier === "gen";
}
