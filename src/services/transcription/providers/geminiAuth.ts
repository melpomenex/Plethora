import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";

function nonEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Resolve Gemini API key from LLM provider settings (provider id `gemini`). */
export function resolveGeminiApiKey(): string {
  const providers = useLLMProvidersStore.getState().providers;
  const candidates = providers.filter((provider) => provider.provider === "gemini");
  const selected = candidates.find((provider) => provider.enabled && nonEmpty(provider.apiKey))
    || candidates.find((provider) => nonEmpty(provider.apiKey));
  return selected ? nonEmpty(selected.apiKey) : "";
}
