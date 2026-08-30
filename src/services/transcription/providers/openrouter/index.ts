import { createOpenRouterNemotronProvider } from "../OpenRouterNemotronProvider";
import { createOpenRouterQwenProvider } from "../OpenRouterQwenProvider";
import type { OpenRouterAsrProvider } from "../OpenRouterAsrProvider";

export function createOpenRouterProviders(): OpenRouterAsrProvider[] {
  return [
    createOpenRouterNemotronProvider(),
    createOpenRouterQwenProvider("0.6b"),
    createOpenRouterQwenProvider("1.7b"),
  ];
}

export {
  OPENROUTER_TRANSCRIPTIONS_URL,
  createNemotronProvider,
  createOpenRouterAsrProvider,
  normalizeOpenRouterResponse,
} from "../OpenRouterAsrProvider";
export type { OpenRouterAsrProvider, OpenRouterTranscribeRequest } from "../OpenRouterAsrProvider";
export {
  OPENROUTER_NEMOTRON_MODEL,
  createOpenRouterNemotronProvider,
  openRouterNemotronProvider,
} from "../OpenRouterNemotronProvider";
export {
  OPENROUTER_QWEN_ASR_0_6B_MODEL,
  OPENROUTER_QWEN_ASR_1_7B_MODEL,
  createOpenRouterQwenProvider,
  openRouterQwenAsr06bProvider,
  openRouterQwenAsr17bProvider,
} from "../OpenRouterQwenProvider";
