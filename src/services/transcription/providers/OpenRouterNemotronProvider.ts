import { OPENROUTER_ASR_MODELS, TRANSCRIPTION_PROVIDER_IDS } from "../config";
import { createOpenRouterAsrProvider, type OpenRouterAsrProvider } from "./OpenRouterAsrProvider";

export const OPENROUTER_NEMOTRON_MODEL = OPENROUTER_ASR_MODELS.NEMOTRON;

export function createOpenRouterNemotronProvider(): OpenRouterAsrProvider {
  return createOpenRouterAsrProvider({
    id: TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_NEMOTRON,
    label: "OpenRouter Nemotron 3.5 ASR",
    model: OPENROUTER_ASR_MODELS.NEMOTRON,
  });
}

export const openRouterNemotronProvider = createOpenRouterNemotronProvider();
