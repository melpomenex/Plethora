import { elevenlabsAdapter } from "./providers/elevenlabs";
import { falAdapter } from "./providers/fal";
import { groqAdapter } from "./providers/groq";
import { openrouterAdapter } from "./providers/openrouter";
import { openAICompatibleAdapter } from "./providers/openai-compatible";
import { openaiAdapter } from "./providers/openai";
import { pocketAdapter } from "./providers/pocket";
import { systemAdapter } from "./providers/system";
import { androidAdapter } from "./providers/android";
import { plethoraAdapter } from "./providers/plethora";
import type { TTSProviderAdapter, TTSProviderId } from "./types";

/** Registered adapters. `scenario-synth` is installed only in harness
 *  sessions (see registerScenarioSynthAdapter), hence Partial. */
export const TTS_ADAPTERS: Readonly<Partial<Record<TTSProviderId, TTSProviderAdapter>>> = {
  fal: falAdapter,
  groq: groqAdapter,
  pocket: pocketAdapter,
  system: systemAdapter,
  openrouter: openrouterAdapter,
  elevenlabs: elevenlabsAdapter,
  openai: openaiAdapter,
  "openai-compatible": openAICompatibleAdapter,
  android: androidAdapter,
  plethora: plethoraAdapter,
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

/**
 * Install the scenario-harness-only synthetic provider (task 4.1). Called
 * exclusively by the memory-scenario host when the harness env is present;
 * an ordinary production session never registers it, so it never appears in
 * provider listings there.
 */
export function registerScenarioSynthAdapter(adapter: TTSProviderAdapter): void {
  (TTS_ADAPTERS as Record<string, TTSProviderAdapter>)["scenario-synth"] = adapter;
}
