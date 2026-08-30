import { OPENROUTER_ASR_MODELS, TRANSCRIPTION_PROVIDER_IDS } from "../config";
import { createOpenRouterAsrProvider, type OpenRouterAsrProvider } from "./OpenRouterAsrProvider";

export const OPENROUTER_QWEN_ASR_0_6B_MODEL = OPENROUTER_ASR_MODELS.QWEN_06;
export const OPENROUTER_QWEN_ASR_1_7B_MODEL = OPENROUTER_ASR_MODELS.QWEN_17;

export type OpenRouterQwenVariant = "0.6b" | "1.7b";

const QWEN_VARIANTS = {
  "0.6b": {
    id: TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_QWEN_06,
    label: "OpenRouter Qwen3 ASR 0.6B",
    model: OPENROUTER_ASR_MODELS.QWEN_06,
  },
  "1.7b": {
    id: TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_QWEN_17,
    label: "OpenRouter Qwen3 ASR 1.7B",
    model: OPENROUTER_ASR_MODELS.QWEN_17,
  },
} as const;

export function createOpenRouterQwenProvider(variant: OpenRouterQwenVariant): OpenRouterAsrProvider {
  return createOpenRouterAsrProvider(QWEN_VARIANTS[variant]);
}

export const openRouterQwenAsr06bProvider = createOpenRouterQwenProvider("0.6b");
export const openRouterQwenAsr17bProvider = createOpenRouterQwenProvider("1.7b");
