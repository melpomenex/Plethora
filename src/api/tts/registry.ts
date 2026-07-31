import { elevenlabsAdapter } from "./providers/elevenlabs";
import { falAdapter } from "./providers/fal";
import { groqAdapter } from "./providers/groq";
import { openrouterAdapter } from "./providers/openrouter";
import { openAICompatibleAdapter } from "./providers/openai-compatible";
import { openaiAdapter } from "./providers/openai";
import { pocketAdapter } from "./providers/pocket";
import { systemAdapter } from "./providers/system";
import { androidAdapter } from "./providers/android";
import type { TTSProviderAdapter, TTSProviderId } from "./types";

export const TTS_ADAPTERS: Readonly<Record<TTSProviderId, TTSProviderAdapter>> = {
  fal: falAdapter,
  groq: groqAdapter,
  pocket: pocketAdapter,
  system: systemAdapter,
  openrouter: openrouterAdapter,
  elevenlabs: elevenlabsAdapter,
  openai: openaiAdapter,
  "openai-compatible": openAICompatibleAdapter,
  android: androidAdapter,
};

export function getAdapter(id: string, notice?: (message: string) => void): TTSProviderAdapter {
  const adapter = TTS_ADAPTERS[id as TTSProviderId];
  if (adapter) return adapter;
  notice?.(`TTS provider “${id}” is unavailable. Falling back to System TTS.`);
  return systemAdapter;
}

export function listAdapters(): TTSProviderAdapter[] {
  return Object.values(TTS_ADAPTERS);
}
