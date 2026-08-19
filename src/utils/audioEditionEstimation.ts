/**
 * Pre-Flight Audio Edition Cost & Duration Estimation Calculator
 * 
 * Provides transparent cost, duration, character, and token estimates
 * before triggering local or cloud TTS synthesis.
 */

import type { AudioEditionEstimation } from "../types/audioEdition";

export interface PricingRule {
  costPer1kCharsUsd?: number;
  costPerMillionCharsUsd?: number;
  isFree?: boolean;
}

export const PROVIDER_PRICING_DEFAULTS: Record<string, Record<string, PricingRule> | PricingRule> = {
  pocket: { isFree: true },
  system: { isFree: true },
  android: { isFree: true },
  plethora: { isFree: true },
  openai: {
    "tts-1": { costPerMillionCharsUsd: 15.0 },
    "tts-1-hd": { costPerMillionCharsUsd: 30.0 },
    default: { costPerMillionCharsUsd: 15.0 },
  },
  elevenlabs: {
    "eleven_multilingual_v2": { costPer1kCharsUsd: 0.30 },
    "eleven_turbo_v2_5": { costPer1kCharsUsd: 0.15 },
    "eleven_flash_v2_5": { costPer1kCharsUsd: 0.075 },
    default: { costPer1kCharsUsd: 0.30 },
  },
  fal: {
    "fal-ai/playht/tts/v3": { costPer1kCharsUsd: 0.02 },
    "fal-ai/minimax/speech-01": { costPer1kCharsUsd: 0.02 },
    default: { costPer1kCharsUsd: 0.02 },
  },
  groq: {
    "playht-tts": { costPer1kCharsUsd: 0.015 },
    default: { costPer1kCharsUsd: 0.015 },
  },
  openrouter: {
    "openai/tts-1": { costPerMillionCharsUsd: 15.0 },
    "openai/tts-1-hd": { costPerMillionCharsUsd: 30.0 },
    "elevenlabs/eleven-multilingual-v2": { costPer1kCharsUsd: 0.30 },
    "hexgrad/kokoro": { isFree: true },
    default: { costPerMillionCharsUsd: 15.0 },
  },
};

/**
 * Calculate estimated duration, characters, words, and monetary cost.
 */
export function estimateAudioEditionCost(options: {
  characterCount: number;
  provider: string;
  model?: string;
  speed?: number;
}): AudioEditionEstimation {
  const { characterCount, provider, model = "default", speed = 1.0 } = options;
  const wordCount = Math.ceil(characterCount / 5);

  // Average speaking pace ~150 words/min = 900 chars/min = 15 chars/sec
  const adjustedSpeed = Math.max(0.5, Math.min(3.0, speed));
  const estimatedDurationSec = Math.ceil((characterCount / 15) / adjustedSpeed);

  const providerRule = PROVIDER_PRICING_DEFAULTS[provider.toLowerCase()];
  let pricing: PricingRule = { isFree: false };

  if (providerRule) {
    if ("isFree" in providerRule || "costPer1kCharsUsd" in providerRule || "costPerMillionCharsUsd" in providerRule) {
      pricing = providerRule as PricingRule;
    } else {
      const modelMap = providerRule as Record<string, PricingRule>;
      pricing = modelMap[model] || modelMap.default || { isFree: false, costPerMillionCharsUsd: 15.0 };
    }
  }

  let estimatedCostUsd = 0;
  const isFreeTier = Boolean(pricing.isFree);

  if (!isFreeTier) {
    if (pricing.costPerMillionCharsUsd) {
      estimatedCostUsd = (characterCount / 1_000_000) * pricing.costPerMillionCharsUsd;
    } else if (pricing.costPer1kCharsUsd) {
      estimatedCostUsd = (characterCount / 1_000) * pricing.costPer1kCharsUsd;
    }
  }

  // Round to 4 decimal places for display accuracy
  estimatedCostUsd = Math.round(estimatedCostUsd * 10000) / 10000;

  return {
    characterCount,
    wordCount,
    estimatedDurationSec,
    estimatedCostUsd,
    isFreeTier,
    provider,
    model,
  };
}

/**
 * Format duration into human-readable string (e.g. "1 hr 15 min" or "4 min 30 sec")
 */
export function formatAudioDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours} hr ${minutes} min`;
  }
  if (minutes > 0) {
    return `${minutes} min ${seconds > 0 ? `${seconds} sec` : ""}`.trim();
  }
  return `${seconds} sec`;
}
