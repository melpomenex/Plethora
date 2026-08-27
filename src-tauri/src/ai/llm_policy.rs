//! Provider-independent LLM token policy.
//!
//! Separates configured runtime context, prompt budget, output reserve, and
//! maximum output tokens so no single field can mean both context window and
//! generation limit.

use serde::{Deserialize, Serialize};

/// Minimum tokens always reserved for prompt content.
pub const MIN_PROMPT_HEADROOM: usize = 1024;
/// Default max output when the provider setting is unset.
pub const DEFAULT_MAX_OUTPUT_TOKENS: usize = 2048;
/// Conservative configured-context fallback when nothing else is set.
pub const CONSERVATIVE_CONTEXT_FALLBACK: usize = 8192;
/// Stack B (internal QA/summarizer) default when synced config is unset.
pub const STACK_B_CONTEXT_DEFAULT: usize = 4096;
/// Floor for the Auto preset.
pub const AUTO_CONTEXT_FLOOR: usize = 4096;
/// Ceiling for the Auto preset — never a model's theoretical maximum.
pub const AUTO_CONTEXT_CEILING: usize = 16384;
/// Ollama migration bump when persisted defaults are 4096/4096.
pub const OLLAMA_MIGRATION_CONTEXT: usize = 8192;

/// Distinct token budgets for a single LLM request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmRequestPolicy {
    /// Runtime context window (Ollama `num_ctx`).
    pub configured_context_tokens: usize,
    /// Maximum tokens for assembled prompt content.
    pub prompt_budget_tokens: usize,
    /// Tokens reserved for model output inside configured context.
    pub output_reserve_tokens: usize,
    /// Hard cap on generated tokens (Ollama `num_predict` / cloud `max_tokens`).
    pub max_output_tokens: usize,
}

impl LlmRequestPolicy {
    /// Enforce invariants: prompt budget ≥ headroom, output ≤ reserve,
    /// prompt + reserve ≤ configured context.
    pub fn validate(self) -> Result<Self, String> {
        if self.configured_context_tokens == 0 {
            return Err("configured_context_tokens must be greater than 0".to_string());
        }
        if self.prompt_budget_tokens < MIN_PROMPT_HEADROOM
            && self.configured_context_tokens > MIN_PROMPT_HEADROOM
        {
            return Err(format!(
                "prompt_budget_tokens ({}) must be at least {MIN_PROMPT_HEADROOM}",
                self.prompt_budget_tokens
            ));
        }
        if self.max_output_tokens > self.output_reserve_tokens {
            return Err(format!(
                "max_output_tokens ({}) exceeds output_reserve_tokens ({})",
                self.max_output_tokens, self.output_reserve_tokens
            ));
        }
        if self
            .prompt_budget_tokens
            .saturating_add(self.output_reserve_tokens)
            > self.configured_context_tokens
        {
            return Err(format!(
                "prompt_budget ({}) + output_reserve ({}) exceeds configured context ({})",
                self.prompt_budget_tokens,
                self.output_reserve_tokens,
                self.configured_context_tokens
            ));
        }
        Ok(self)
    }

    /// Clamp fields into a valid policy instead of failing.
    pub fn clamped(self) -> Self {
        let configured = self.configured_context_tokens.max(1);
        let max_output = self.max_output_tokens.max(1).min(configured);
        let headroom = MIN_PROMPT_HEADROOM.min(configured.saturating_sub(1));
        let output_reserve = self
            .output_reserve_tokens
            .max(max_output)
            .min(configured.saturating_sub(headroom))
            .max(1);
        let prompt_budget = configured.saturating_sub(output_reserve).max(headroom.min(configured));
        Self {
            configured_context_tokens: configured,
            prompt_budget_tokens: prompt_budget.min(configured.saturating_sub(output_reserve)),
            output_reserve_tokens: output_reserve,
            max_output_tokens: max_output.min(output_reserve),
        }
    }
}

/// Inputs for layered policy resolution.
#[derive(Debug, Clone, Default)]
pub struct PolicyResolutionInput {
    pub provider: String,
    pub model: Option<String>,
    /// Per-model override (`modelContextWindows[modelId]`).
    pub per_model_override: Option<usize>,
    /// Per-provider default (`LLMProviderConfig.contextWindowTokens`).
    pub provider_context_tokens: Option<usize>,
    /// Global `settings.ai.maxTokens`.
    pub global_context_tokens: Option<usize>,
    /// Ollama `/api/show` Modelfile `num_ctx`.
    pub discovered_num_ctx: Option<usize>,
    /// Per-provider max output (`LLMProviderConfig.maxTokens`).
    pub provider_max_output: Option<usize>,
    /// Optional global `aiControls.maxTokensPerRequest`.
    pub global_max_output: Option<usize>,
    /// Explicit request override for configured context.
    pub configured_context_override: Option<usize>,
    /// Explicit request override for max output.
    pub max_output_override: Option<usize>,
    /// Legacy `context_window_tokens` / new `prompt_budget_tokens` hint.
    pub prompt_budget_hint: Option<usize>,
    /// True when the UI Auto preset is selected.
    pub auto_preset: bool,
    /// Apply the Ollama 4096/4096 → 8192 migration bump.
    pub apply_ollama_default_guard: bool,
}

fn positive(value: Option<usize>) -> Option<usize> {
    value.filter(|v| *v > 0)
}

/// Resolve Auto preset to a displayed value in `[4096, 16384]`.
pub fn resolve_auto_context(input: &PolicyResolutionInput) -> usize {
    let global = positive(input.global_context_tokens).filter(|v| *v > MIN_PROMPT_HEADROOM);
    let discovered = positive(input.discovered_num_ctx);
    let mut resolved = AUTO_CONTEXT_CEILING;
    if let Some(g) = global {
        resolved = resolved.min(g);
    }
    if let Some(d) = discovered {
        resolved = resolved.min(d);
    }
    resolved.clamp(AUTO_CONTEXT_FLOOR, AUTO_CONTEXT_CEILING)
}

fn resolve_configured_context(input: &PolicyResolutionInput) -> usize {
    if input.auto_preset {
        return resolve_auto_context(input);
    }
    if let Some(v) = positive(input.configured_context_override) {
        return v;
    }
    if let Some(v) = positive(input.per_model_override) {
        return v;
    }
    if let Some(v) = positive(input.provider_context_tokens) {
        return v;
    }
    if let Some(v) = positive(input.global_context_tokens) {
        return v;
    }
    if let Some(v) = positive(input.discovered_num_ctx) {
        return v;
    }
    CONSERVATIVE_CONTEXT_FALLBACK
}

fn resolve_max_output(input: &PolicyResolutionInput) -> usize {
    if let Some(v) = positive(input.max_output_override) {
        return v;
    }
    if let Some(v) = positive(input.provider_max_output) {
        return v;
    }
    if let Some(v) = positive(input.global_max_output) {
        return v;
    }
    DEFAULT_MAX_OUTPUT_TOKENS
}

/// Resolve a validated request policy from layered configuration.
///
/// Typical 4096/4096 installs MUST NOT produce a zero prompt budget. For
/// Ollama (`apply_ollama_default_guard`), configured context is raised to
/// 8192 when it would otherwise leave less than [`MIN_PROMPT_HEADROOM`].
pub fn resolve_request_policy(input: &PolicyResolutionInput) -> LlmRequestPolicy {
    let mut configured = resolve_configured_context(input);
    let mut max_output = resolve_max_output(input);

    let is_ollama = input.apply_ollama_default_guard || input.provider.eq_ignore_ascii_case("ollama");
    if is_ollama && configured < max_output.saturating_add(MIN_PROMPT_HEADROOM) {
        // Prefer raising configured context (migration bump) over clamping output.
        configured = configured
            .max(OLLAMA_MIGRATION_CONTEXT)
            .max(max_output.saturating_add(MIN_PROMPT_HEADROOM));
    }

    if configured < max_output.saturating_add(MIN_PROMPT_HEADROOM) {
        max_output = configured.saturating_sub(MIN_PROMPT_HEADROOM).max(1);
    }

    let output_reserve = max_output.min(configured.saturating_sub(MIN_PROMPT_HEADROOM));
    let prompt_budget = configured.saturating_sub(output_reserve);

    let mut policy = LlmRequestPolicy {
        configured_context_tokens: configured,
        prompt_budget_tokens: prompt_budget.max(1),
        output_reserve_tokens: output_reserve.max(1),
        max_output_tokens: max_output.min(output_reserve.max(1)).max(1),
    }
    .clamped();

    if let Some(hint) = positive(input.prompt_budget_hint) {
        // Legacy `context_window_tokens` is a prompt-budget hint, never max output.
        policy.prompt_budget_tokens = hint
            .min(policy.prompt_budget_tokens)
            .max(MIN_PROMPT_HEADROOM.min(policy.prompt_budget_tokens));
    }

    policy
}

/// True when `legacy_context_window` matches provider max output — the
/// historical conflation pattern. Still treat the value as prompt budget only.
pub fn legacy_field_equals_provider_max_output(
    legacy_context_window: Option<usize>,
    provider_max_output: Option<usize>,
) -> bool {
    match (positive(legacy_context_window), positive(provider_max_output)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ollama_input() -> PolicyResolutionInput {
        PolicyResolutionInput {
            provider: "ollama".to_string(),
            apply_ollama_default_guard: true,
            ..Default::default()
        }
    }

    #[test]
    fn policy_fields_are_independent() {
        let policy = resolve_request_policy(&PolicyResolutionInput {
            configured_context_override: Some(16384),
            max_output_override: Some(2048),
            ..ollama_input()
        });
        assert_eq!(policy.configured_context_tokens, 16384);
        assert_eq!(policy.max_output_tokens, 2048);
        assert!(policy.prompt_budget_tokens <= 14336);
        assert_eq!(
            policy.prompt_budget_tokens + policy.output_reserve_tokens,
            policy.configured_context_tokens
        );
    }

    #[test]
    fn context_window_does_not_set_output_limit() {
        let policy = resolve_request_policy(&PolicyResolutionInput {
            configured_context_override: Some(16384),
            ..ollama_input()
        });
        assert_eq!(policy.configured_context_tokens, 16384);
        assert_eq!(policy.max_output_tokens, DEFAULT_MAX_OUTPUT_TOKENS);
        assert_ne!(policy.max_output_tokens, 16384);
    }

    #[test]
    fn per_model_override_wins() {
        let policy = resolve_request_policy(&PolicyResolutionInput {
            global_context_tokens: Some(4096),
            provider_context_tokens: Some(16384),
            per_model_override: Some(32768),
            provider_max_output: Some(2048),
            ..ollama_input()
        });
        assert_eq!(policy.configured_context_tokens, 32768);
    }

    #[test]
    fn missing_settings_use_conservative_fallback() {
        let policy = resolve_request_policy(&PolicyResolutionInput {
            provider: "ollama".to_string(),
            apply_ollama_default_guard: true,
            ..Default::default()
        });
        assert_eq!(policy.configured_context_tokens, CONSERVATIVE_CONTEXT_FALLBACK);
    }

    #[test]
    fn default_4096_4096_produces_usable_prompt_budget() {
        // Test 9: typical persisted defaults must not yield zero prompt budget.
        let policy = resolve_request_policy(&PolicyResolutionInput {
            global_context_tokens: Some(4096),
            provider_max_output: Some(4096),
            apply_ollama_default_guard: true,
            provider: "ollama".to_string(),
            ..Default::default()
        });
        assert!(
            policy.prompt_budget_tokens >= MIN_PROMPT_HEADROOM,
            "prompt budget was {}",
            policy.prompt_budget_tokens
        );
        assert!(policy.configured_context_tokens >= OLLAMA_MIGRATION_CONTEXT);
        assert_ne!(policy.prompt_budget_tokens, 0);
    }

    #[test]
    fn auto_preset_resolves_within_band() {
        // Test 10
        let resolved = resolve_auto_context(&PolicyResolutionInput {
            global_context_tokens: Some(8192),
            discovered_num_ctx: Some(4096),
            auto_preset: true,
            ..ollama_input()
        });
        assert!(resolved >= AUTO_CONTEXT_FLOOR && resolved <= AUTO_CONTEXT_CEILING);
        assert_eq!(resolved, 4096);

        let huge = resolve_auto_context(&PolicyResolutionInput {
            global_context_tokens: Some(131072),
            discovered_num_ctx: Some(131072),
            auto_preset: true,
            ..ollama_input()
        });
        assert_eq!(huge, AUTO_CONTEXT_CEILING);
    }

    #[test]
    fn auto_never_uses_theoretical_model_max() {
        let policy = resolve_request_policy(&PolicyResolutionInput {
            auto_preset: true,
            global_context_tokens: Some(131072),
            discovered_num_ctx: Some(131072),
            ..ollama_input()
        });
        assert!(policy.configured_context_tokens <= AUTO_CONTEXT_CEILING);
        assert_ne!(policy.configured_context_tokens, 131072);
    }

    #[test]
    fn legacy_context_window_maps_to_prompt_budget_only() {
        // Test 7 — shim: context_window_tokens is a prompt-budget hint.
        let policy = resolve_request_policy(&PolicyResolutionInput {
            prompt_budget_hint: Some(8192),
            provider_max_output: Some(2048),
            configured_context_override: Some(16384),
            ..ollama_input()
        });
        assert_eq!(policy.max_output_tokens, 2048);
        assert_ne!(policy.max_output_tokens, 8192);
        assert!(policy.prompt_budget_tokens <= 8192);
    }

    #[test]
    fn legacy_field_equal_to_provider_max_still_prompt_budget() {
        assert!(legacy_field_equals_provider_max_output(Some(4096), Some(4096)));
        let policy = resolve_request_policy(&PolicyResolutionInput {
            prompt_budget_hint: Some(4096),
            provider_max_output: Some(4096),
            global_context_tokens: Some(4096),
            apply_ollama_default_guard: true,
            provider: "ollama".to_string(),
            ..Default::default()
        });
        assert_eq!(policy.max_output_tokens.min(policy.configured_context_tokens), policy.max_output_tokens);
        assert!(policy.prompt_budget_tokens >= MIN_PROMPT_HEADROOM);
        // Max output still comes from provider settings (possibly clamped), not
        // from treating the legacy field as generation length alone.
        assert!(policy.max_output_tokens > 0);
    }

    #[test]
    fn validate_rejects_zero_prompt_budget_when_context_allows_headroom() {
        let err = LlmRequestPolicy {
            configured_context_tokens: 8192,
            prompt_budget_tokens: 0,
            output_reserve_tokens: 2048,
            max_output_tokens: 2048,
        }
        .validate()
        .expect_err("should reject");
        assert!(err.contains("prompt_budget_tokens"));
    }
}
