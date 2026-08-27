/**
 * Provider-independent LLM request policy.
 *
 * Mirrors `src-tauri/src/ai/llm_policy.rs` so frontend callers can resolve
 * configured context / prompt budget / max output without conflating them.
 */

export const MIN_PROMPT_HEADROOM = 1024;
export const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
export const CONSERVATIVE_CONTEXT_FALLBACK = 8192;
export const AUTO_CONTEXT_FLOOR = 4096;
export const AUTO_CONTEXT_CEILING = 16384;
export const OLLAMA_MIGRATION_CONTEXT = 8192;

/** Sentinel stored on the provider when the user selects the Auto preset. */
export const AUTO_CONTEXT_PRESET = "auto" as const;

export type ContextWindowPreset =
  | typeof AUTO_CONTEXT_PRESET
  | "4k"
  | "8k"
  | "16k"
  | "32k"
  | "64k"
  | "custom";

export const CONTEXT_WINDOW_PRESET_VALUES: Record<Exclude<ContextWindowPreset, "auto" | "custom">, number> = {
  "4k": 4096,
  "8k": 8192,
  "16k": 16384,
  "32k": 32768,
  "64k": 65536,
};

export interface LlmRequestPolicy {
  configuredContextTokens: number;
  promptBudgetTokens: number;
  outputReserveTokens: number;
  maxOutputTokens: number;
}

export interface PolicyResolutionInput {
  provider?: string;
  model?: string;
  perModelOverride?: number;
  providerContextTokens?: number;
  globalContextTokens?: number;
  discoveredNumCtx?: number;
  providerMaxOutput?: number;
  globalMaxOutput?: number;
  configuredContextOverride?: number;
  maxOutputOverride?: number;
  /** Legacy `contextWindowTokens` — treated as prompt-budget hint only. */
  promptBudgetHint?: number;
  autoPreset?: boolean;
  applyOllamaDefaultGuard?: boolean;
}

function positive(value: number | undefined | null): number | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

export function resolveAutoContext(input: PolicyResolutionInput): number {
  const global = positive(input.globalContextTokens);
  const discovered = positive(input.discoveredNumCtx);
  let resolved = AUTO_CONTEXT_CEILING;
  if (global != null && global > MIN_PROMPT_HEADROOM) {
    resolved = Math.min(resolved, global);
  }
  if (discovered != null) {
    resolved = Math.min(resolved, discovered);
  }
  return Math.min(AUTO_CONTEXT_CEILING, Math.max(AUTO_CONTEXT_FLOOR, resolved));
}

function resolveConfiguredContextTokens(input: PolicyResolutionInput): number {
  if (input.autoPreset) return resolveAutoContext(input);
  return (
    positive(input.configuredContextOverride) ??
    positive(input.perModelOverride) ??
    positive(input.providerContextTokens) ??
    positive(input.globalContextTokens) ??
    positive(input.discoveredNumCtx) ??
    CONSERVATIVE_CONTEXT_FALLBACK
  );
}

function resolveMaxOutput(input: PolicyResolutionInput): number {
  return (
    positive(input.maxOutputOverride) ??
    positive(input.providerMaxOutput) ??
    positive(input.globalMaxOutput) ??
    DEFAULT_MAX_OUTPUT_TOKENS
  );
}

/**
 * Resolve configured runtime context using the same precedence as Rust:
 * per-model → per-provider → global → discovered → 8192 fallback.
 */
export function resolveConfiguredContext(input: PolicyResolutionInput): number {
  return resolveRequestPolicy(input).configuredContextTokens;
}

export function resolveRequestPolicy(input: PolicyResolutionInput): LlmRequestPolicy {
  let configured = resolveConfiguredContextTokens(input);
  let maxOutput = resolveMaxOutput(input);
  const isOllama =
    input.applyOllamaDefaultGuard === true || (input.provider ?? "").toLowerCase() === "ollama";

  if (isOllama && configured < maxOutput + MIN_PROMPT_HEADROOM) {
    configured = Math.max(configured, OLLAMA_MIGRATION_CONTEXT, maxOutput + MIN_PROMPT_HEADROOM);
  }
  if (configured < maxOutput + MIN_PROMPT_HEADROOM) {
    maxOutput = Math.max(1, configured - MIN_PROMPT_HEADROOM);
  }

  const outputReserve = Math.min(maxOutput, Math.max(1, configured - MIN_PROMPT_HEADROOM));
  let promptBudget = Math.max(1, configured - outputReserve);
  const hint = positive(input.promptBudgetHint);
  if (hint != null) {
    promptBudget = Math.max(Math.min(hint, promptBudget), Math.min(MIN_PROMPT_HEADROOM, promptBudget));
  }
  if (promptBudget < MIN_PROMPT_HEADROOM && configured > MIN_PROMPT_HEADROOM) {
    promptBudget = Math.min(MIN_PROMPT_HEADROOM, configured - outputReserve);
  }

  return {
    configuredContextTokens: configured,
    promptBudgetTokens: Math.max(1, promptBudget),
    outputReserveTokens: Math.max(1, outputReserve),
    maxOutputTokens: Math.max(1, Math.min(maxOutput, outputReserve)),
  };
}

export function formatAutoResolvedLabel(resolved: number): string {
  return `Auto → ${resolved}`;
}

export function isContextComboValid(configuredContext: number, maxResponse: number): boolean {
  return maxResponse + MIN_PROMPT_HEADROOM <= configuredContext;
}

export type ProviderLike = {
  provider?: string;
  contextWindowTokens?: number;
  contextWindowPreset?: ContextWindowPreset;
  modelContextWindows?: Record<string, number>;
  maxTokens?: number;
  model?: string;
};

export function resolveConfiguredContextForProvider(
  provider: ProviderLike | undefined,
  model: string | undefined,
  globalContextTokens: number | undefined,
  discoveredNumCtx?: number,
): number {
  const autoPreset = provider?.contextWindowPreset === AUTO_CONTEXT_PRESET;
  const modelId = model ?? provider?.model;
  return resolveConfiguredContext({
    provider: provider?.provider,
    model: modelId,
    perModelOverride: modelId ? provider?.modelContextWindows?.[modelId] : undefined,
    providerContextTokens: provider?.contextWindowTokens,
    globalContextTokens,
    discoveredNumCtx,
    providerMaxOutput: provider?.maxTokens,
    autoPreset,
    applyOllamaDefaultGuard: provider?.provider === "ollama",
  });
}
