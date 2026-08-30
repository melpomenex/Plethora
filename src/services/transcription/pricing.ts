import { TRANSCRIPTION_PRICING } from "./config";
import type { TranscriptionProviderId } from "./types";

/**
 * Estimate transcription cost for a given duration and provider.
 * Returns USD for known providers; 0 when pricing is unavailable.
 */
export function estimateCost(
  durationSeconds: number,
  providerId: TranscriptionProviderId,
): number {
  const pricing = TRANSCRIPTION_PRICING[providerId];
  if (!pricing || durationSeconds <= 0) return 0;
  const hours = durationSeconds / 3600;
  return hours * pricing.costPerHour;
}
