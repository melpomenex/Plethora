//! Shared native Ollama `/api/chat` adapter.
//!
//! Both Stack A (`commands/llm.rs`) and Stack B (`ai/providers.rs`) must use
//! this builder so `num_ctx` / `num_predict` cannot diverge.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::llm_policy::LlmRequestPolicy;

/// Options sent on every Ollama chat request.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OllamaChatOptions {
    pub temperature: f64,
    pub num_ctx: usize,
    pub num_predict: usize,
}

impl OllamaChatOptions {
    pub fn from_policy(policy: &LlmRequestPolicy, temperature: f64) -> Self {
        Self {
            temperature,
            num_ctx: policy.configured_context_tokens,
            num_predict: policy.max_output_tokens,
        }
    }
}

/// Strip `/v1`, `/api/chat`, and `/chat/completions` so callers can pass either
/// the historical OpenAI-shim URL or the native base.
pub fn normalize_ollama_base_url(url: &str) -> String {
    let mut u = url.trim().trim_end_matches('/').to_string();
    let suffixes = [
        "/v1/chat/completions",
        "/chat/completions",
        "/api/chat",
        "/api/tags",
        "/api/show",
        "/v1",
    ];
    loop {
        let lower = u.to_ascii_lowercase();
        let mut stripped = false;
        for suffix in suffixes {
            if lower.ends_with(suffix) {
                u.truncate(u.len() - suffix.len());
                u = u.trim_end_matches('/').to_string();
                stripped = true;
                break;
            }
        }
        if !stripped {
            break;
        }
    }
    if u.is_empty() {
        "http://localhost:11434".to_string()
    } else {
        u
    }
}

pub fn ollama_chat_url(base_url: &str) -> String {
    format!("{}/api/chat", normalize_ollama_base_url(base_url))
}

pub fn ollama_tags_url(base_url: &str) -> String {
    format!("{}/api/tags", normalize_ollama_base_url(base_url))
}

pub fn ollama_show_url(base_url: &str) -> String {
    format!("{}/api/show", normalize_ollama_base_url(base_url))
}

/// Build the native `/api/chat` JSON body. `messages` is already OpenAI-shaped
/// (`[{role, content}, ...]`).
pub fn build_ollama_chat_body(
    model: &str,
    messages: &Value,
    stream: bool,
    policy: &LlmRequestPolicy,
    temperature: f64,
) -> Value {
    let options = OllamaChatOptions::from_policy(policy, temperature);
    json!({
        "model": model,
        "messages": messages,
        "stream": stream,
        "options": {
            "temperature": options.temperature,
            "num_ctx": options.num_ctx,
            "num_predict": options.num_predict,
        }
    })
}

/// Native non-streaming `/api/chat` response.
#[derive(Debug, Deserialize)]
pub struct OllamaNativeResponse {
    #[serde(default)]
    pub message: Option<OllamaNativeMessage>,
    #[serde(default)]
    pub prompt_eval_count: Option<usize>,
    #[serde(default)]
    pub eval_count: Option<usize>,
    #[serde(default)]
    pub done: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct OllamaNativeMessage {
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
}

impl OllamaNativeResponse {
    pub fn content(&self) -> String {
        self.message
            .as_ref()
            .and_then(|m| m.content.clone())
            .unwrap_or_default()
    }
}

/// One NDJSON line from streaming `/api/chat`.
#[derive(Debug, Deserialize)]
pub struct OllamaNativeStreamChunk {
    #[serde(default)]
    pub message: Option<OllamaNativeMessage>,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub prompt_eval_count: Option<usize>,
    #[serde(default)]
    pub eval_count: Option<usize>,
}

impl OllamaNativeStreamChunk {
    pub fn delta_content(&self) -> Option<&str> {
        self.message
            .as_ref()
            .and_then(|m| m.content.as_deref())
            .filter(|s| !s.is_empty())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OllamaErrorKind {
    ContextOverflow,
    TransientEof,
    OutOfMemory,
    Other,
}

pub fn classify_ollama_error(error: &str) -> OllamaErrorKind {
    let lowered = error.to_ascii_lowercase();
    if lowered.contains("exceed_context_size")
        || lowered.contains("exceeds the available context size")
        || lowered.contains("exceeds available context")
    {
        return OllamaErrorKind::ContextOverflow;
    }
    if lowered.contains("out of memory")
        || lowered.contains("\"oom\"")
        || (lowered.contains("oom") && lowered.contains("500"))
        || lowered.contains("cuda out of memory")
        || lowered.contains("insufficient memory")
    {
        return OllamaErrorKind::OutOfMemory;
    }
    if lowered.contains("unexpected eof")
        || lowered.contains("connection reset")
        || lowered.contains("error decoding response body")
        || lowered.contains("connection closed")
    {
        return OllamaErrorKind::TransientEof;
    }
    OllamaErrorKind::Other
}

/// User-facing overflow message. Uses assembler estimates, not raw provider JSON.
pub fn context_overflow_user_message(
    configured_context: usize,
    estimated_prompt_tokens: usize,
    output_reserve: usize,
) -> String {
    let prompt_budget = configured_context.saturating_sub(output_reserve);
    format!(
        "This request needs approximately {estimated_prompt_tokens} tokens but your configured context allows {prompt_budget} for prompts (context {configured_context}, output reserve {output_reserve}). Increase the model context window in settings or reduce selected content."
    )
}

pub fn oom_user_message(configured_context: usize) -> String {
    format!(
        "Ollama ran out of memory at a context window of {configured_context} tokens. Lower the configured context in settings or use a smaller model."
    )
}

/// Sanitize a provider error for the frontend / stream events. Raw JSON stays
/// in debug logs only.
pub fn sanitize_ollama_error(
    error: &str,
    policy: Option<&LlmRequestPolicy>,
    estimated_prompt_tokens: Option<usize>,
) -> String {
    match classify_ollama_error(error) {
        OllamaErrorKind::ContextOverflow => {
            let configured = policy.map(|p| p.configured_context_tokens).unwrap_or(0);
            let reserve = policy.map(|p| p.output_reserve_tokens).unwrap_or(0);
            let estimated = estimated_prompt_tokens.unwrap_or(0);
            if configured > 0 {
                context_overflow_user_message(configured, estimated, reserve)
            } else {
                "This request exceeds the model's available context window. Increase the configured context in settings or reduce selected content.".to_string()
            }
        }
        OllamaErrorKind::OutOfMemory => {
            let configured = policy.map(|p| p.configured_context_tokens).unwrap_or(0);
            oom_user_message(configured.max(1))
        }
        OllamaErrorKind::TransientEof => {
            "Ollama connection dropped before the response finished. Please try again.".to_string()
        }
        OllamaErrorKind::Other => {
            if error.len() > 240 || error.contains('{') {
                "Ollama request failed. Check that Ollama is running and the model is loaded."
                    .to_string()
            } else {
                error.to_string()
            }
        }
    }
}

/// Privacy-safe debug log fields for an Ollama send boundary.
pub fn log_ollama_send(provider: &str, model: &str, policy: &LlmRequestPolicy, estimated_prompt: usize) {
    tracing::debug!(
        provider,
        model,
        configured_context = policy.configured_context_tokens,
        prompt_budget = policy.prompt_budget_tokens,
        output_reserve = policy.output_reserve_tokens,
        max_output = policy.max_output_tokens,
        estimated_prompt_tokens = estimated_prompt,
        ollama_num_ctx = policy.configured_context_tokens,
        ollama_num_predict = policy.max_output_tokens,
        "ollama chat send"
    );
}

#[derive(Debug, Clone, Default)]
pub struct OllamaModelDetails {
    pub context_length: Option<usize>,
    pub default_num_ctx: Option<usize>,
}

/// Parse `/api/show` JSON for Modelfile `num_ctx` and model-card context length.
pub fn parse_ollama_show_details(payload: &Value) -> OllamaModelDetails {
    let mut details = OllamaModelDetails::default();

    if let Some(parameters) = payload.get("parameters").and_then(|v| v.as_str()) {
        for line in parameters.lines() {
            let line = line.trim();
            let mut parts = line.split_whitespace();
            if parts.next().map(|k| k.eq_ignore_ascii_case("num_ctx")).unwrap_or(false) {
                if let Some(value) = parts.next().and_then(|v| v.parse::<usize>().ok()) {
                    details.default_num_ctx = Some(value);
                }
            }
        }
    }

    if let Some(info) = payload.get("model_info").and_then(|v| v.as_object()) {
        for (key, value) in info {
            if key.ends_with("context_length") || key.ends_with(".context_length") {
                if let Some(n) = value.as_u64() {
                    details.context_length = Some(n as usize);
                    break;
                }
            }
        }
    }

    if details.context_length.is_none() {
        details.context_length = details.default_num_ctx;
    }

    details
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::llm_policy::{resolve_request_policy, PolicyResolutionInput};

    fn policy_16k_2k() -> LlmRequestPolicy {
        resolve_request_policy(&PolicyResolutionInput {
            provider: "ollama".to_string(),
            configured_context_override: Some(16384),
            max_output_override: Some(2048),
            apply_ollama_default_guard: true,
            ..Default::default()
        })
    }

    fn messages() -> Value {
        json!([{"role": "user", "content": "hello"}])
    }

    #[test]
    fn payload_contains_correct_num_ctx_and_num_predict() {
        // Tests 1, 2
        let body = build_ollama_chat_body("llama3.2", &messages(), false, &policy_16k_2k(), 0.7);
        assert_eq!(body["options"]["num_ctx"], 16384);
        assert_eq!(body["options"]["num_predict"], 2048);
        assert_ne!(body["options"]["num_predict"], 16384);
    }

    #[test]
    fn streaming_and_non_streaming_options_match() {
        // Test 3
        let policy = policy_16k_2k();
        let a = build_ollama_chat_body("llama3.2", &messages(), false, &policy, 0.7);
        let b = build_ollama_chat_body("llama3.2", &messages(), true, &policy, 0.7);
        assert_eq!(a["options"], b["options"]);
        assert_eq!(a["model"], b["model"]);
        assert_eq!(a["messages"], b["messages"]);
        assert_eq!(a["stream"], false);
        assert_eq!(b["stream"], true);
    }

    #[test]
    fn url_normalization_strips_v1() {
        assert_eq!(
            normalize_ollama_base_url("http://localhost:11434/v1"),
            "http://localhost:11434"
        );
        assert_eq!(
            normalize_ollama_base_url("http://localhost:11434"),
            "http://localhost:11434"
        );
        assert_eq!(
            normalize_ollama_base_url("http://127.0.0.1:11434/v1/"),
            "http://127.0.0.1:11434"
        );
        assert_eq!(
            ollama_chat_url("http://localhost:11434/v1"),
            "http://localhost:11434/api/chat"
        );
        assert_eq!(
            ollama_tags_url("http://localhost:11434/v1"),
            "http://localhost:11434/api/tags"
        );
    }

    #[test]
    fn classify_context_overflow_vs_oom() {
        assert_eq!(
            classify_ollama_error("request (8581 tokens) exceeds the available context size (4096 tokens)"),
            OllamaErrorKind::ContextOverflow
        );
        assert_eq!(
            classify_ollama_error("exceed_context_size"),
            OllamaErrorKind::ContextOverflow
        );
        assert_eq!(
            classify_ollama_error("Ollama API error (500): CUDA out of memory"),
            OllamaErrorKind::OutOfMemory
        );
        assert_eq!(
            classify_ollama_error("error decoding response body: unexpected eof"),
            OllamaErrorKind::TransientEof
        );
    }

    #[test]
    fn overflow_does_not_look_like_shrink_retry_trigger() {
        // Test 8: overflow is a distinct kind — callers must not shrink policy.
        let kind = classify_ollama_error(
            "Ollama API error (400): {\"error\":\"request (8581 tokens) exceeds the available context size (4096 tokens)\"}",
        );
        assert_eq!(kind, OllamaErrorKind::ContextOverflow);
        assert_ne!(kind, OllamaErrorKind::TransientEof);
    }

    #[test]
    fn sanitize_overflow_omits_raw_json() {
        let policy = policy_16k_2k();
        let raw = r#"Ollama API error (400): {"error":"request (8581 tokens) exceeds the available context size (4096 tokens)"}"#;
        let msg = sanitize_ollama_error(raw, Some(&policy), Some(8581));
        assert!(!msg.contains('{'));
        assert!(msg.contains("8581"));
        assert!(msg.contains("16384"));
    }

    #[test]
    fn parse_show_modelfile_num_ctx() {
        let payload = json!({
            "parameters": "num_ctx 4096\nstop \"<|eot_id|>\"",
            "model_info": { "llama.context_length": 131072 }
        });
        let details = parse_ollama_show_details(&payload);
        assert_eq!(details.default_num_ctx, Some(4096));
        assert_eq!(details.context_length, Some(131072));
    }
}
