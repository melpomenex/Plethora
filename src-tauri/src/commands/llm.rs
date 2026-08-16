//! LLM Commands for Tauri with Streaming Support
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::ai::stream_registry::{StreamRequestRegistry, DEFAULT_MAX_STREAM_REQUESTS};

const DEFAULT_MAX_TOKENS: usize = 2000;

// Event names for streaming
const LLM_STREAM_CHUNK: &str = "llm:stream:chunk";
const LLM_STREAM_DONE: &str = "llm:stream:done";
const LLM_STREAM_ERROR: &str = "llm:stream:error";

/// Registry of in-flight `llm_stream_chat` requests so `llm_cancel_stream`
/// can abort them (design D7 cancellation). Entries are removed on every
/// terminal path; bounded to guard against leaks from panicked stream tasks.
static STREAM_REQUESTS: StreamRequestRegistry =
    StreamRequestRegistry::new(DEFAULT_MAX_STREAM_REQUESTS);

#[inline]
fn emit_stream_event(app: &AppHandle, event: &str, payload: impl Serialize + Clone) {
    if let Err(e) = app.emit(event, payload) {
        tracing::debug!(event, error = %e, "failed to emit LLM stream event");
    }
}

// Throttling for streamed token deltas: coalesce deltas before emitting an IPC
// event so we don't flood the frontend with one event per token.
const STREAM_FLUSH_INTERVAL: std::time::Duration = std::time::Duration::from_millis(40);
const STREAM_FLUSH_SIZE: usize = 256;

/// Flush accumulated streamed text to the frontend as a single `llm:stream:chunk`
/// event. Emits nothing (but still resets the flush timer) when the buffer is
/// empty. The payload shape matches the per-token events it replaces:
/// `{ "content": <text>, "done": <bool> }`.
#[inline]
fn flush_stream_chunk(
    app: &AppHandle,
    buf: &mut String,
    last_flush: &mut std::time::Instant,
    done: bool,
) {
    if !buf.is_empty() {
        emit_stream_event(
            app,
            LLM_STREAM_CHUNK,
            serde_json::json!({
                "content": buf.as_str(),
                "done": done,
            }),
        );
        buf.clear();
    }
    *last_flush = std::time::Instant::now();
}

#[derive(Debug, Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    temperature: f64,
    max_tokens: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
}

#[derive(Debug, Serialize)]
struct OpenAIMessage {
    role: String,
    content: OpenAIMessageContent,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum OpenAIMessageContent {
    Text(String),
    Parts(Vec<OpenAIContentPart>),
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum OpenAIContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: OpenAIImageUrl },
}

#[derive(Debug, Serialize)]
struct OpenAIImageUrl {
    url: String,
}

#[derive(Debug, Deserialize)]
struct OpenAIResponse {
    #[serde(default)]
    choices: Vec<OpenAIChoice>,
    usage: Option<OpenAIUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenAIChoice {
    message: OpenAIResponseMessageContent,
}

/// Tolerant assistant-message content. OpenAI-compatible providers (notably
/// OpenRouter, which fronts many upstream models) may return `content: null`
/// for tool-call-only / refusal / reasoning turns, or a multimodal parts
/// array instead of a plain string. Either way we keep the text.
#[derive(Debug, Deserialize)]
struct OpenAIResponseMessageContent {
    #[serde(default)]
    content: Option<OpenAIResponseContentValue>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum OpenAIResponseContentValue {
    Text(String),
    Parts(Vec<OpenAIResponseContentPart>),
}

#[derive(Debug, Deserialize)]
struct OpenAIResponseContentPart {
    #[serde(default)]
    text: Option<String>,
}

impl OpenAIResponseMessageContent {
    fn text(&self) -> String {
        match &self.content {
            Some(OpenAIResponseContentValue::Text(s)) => s.clone(),
            Some(OpenAIResponseContentValue::Parts(parts)) => parts
                .iter()
                .filter_map(|p| p.text.clone())
                .collect::<Vec<_>>()
                .join(""),
            None => String::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct OpenAIUsage {
    #[serde(default)]
    prompt_tokens: Option<usize>,
    #[serde(default)]
    completion_tokens: Option<usize>,
    #[serde(default)]
    total_tokens: Option<usize>,
    // DeepSeek-specific: present only on DeepSeek responses. Reports how many
    // of `prompt_tokens` were served from DeepSeek's automatic disk-based
    // prompt cache (billed at a steep discount) vs. freshly processed.
    #[serde(default)]
    prompt_cache_hit_tokens: Option<usize>,
    #[serde(default)]
    prompt_cache_miss_tokens: Option<usize>,
}

impl OpenAIUsage {
    fn prompt_tokens(&self) -> usize {
        self.prompt_tokens.unwrap_or(0)
    }
    fn completion_tokens(&self) -> usize {
        self.completion_tokens.unwrap_or(0)
    }
    fn total_tokens(&self) -> usize {
        self.total_tokens.unwrap_or(0)
    }
}

/// Shorten a response body for inclusion in an error message (char-safe).
fn ellipsize_body(body: &str, max_chars: usize) -> String {
    if body.chars().count() <= max_chars {
        body.to_string()
    } else {
        let prefix: String = body.chars().take(max_chars).collect();
        format!("{}…", prefix)
    }
}

#[derive(Debug, Deserialize)]
struct OpenAIStreamChunk {
    id: Option<String>,
    choices: Vec<OpenAIStreamChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAIStreamChoice {
    delta: OpenAIStreamDelta,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAIStreamDelta {
    content: Option<String>,
}

#[derive(Debug, Serialize)]
struct AnthropicRequest {
    model: String,
    messages: Vec<AnthropicMessage>,
    max_tokens: usize,
    temperature: f64,
    anthropic_version: String,
    stream: Option<bool>,
}

#[derive(Debug, Serialize)]
struct AnthropicMessage {
    role: String,
    content: AnthropicMessageContent,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum AnthropicMessageContent {
    Text(String),
    Parts(Vec<AnthropicInputContentPart>),
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum AnthropicInputContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { source: AnthropicImageSource },
}

#[derive(Debug, Serialize)]
struct AnthropicImageSource {
    #[serde(rename = "type")]
    source_type: String,
    media_type: String,
    data: String,
}

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContent>,
    usage: Option<AnthropicUsage>,
}

#[derive(Debug, Deserialize)]
struct AnthropicContent {
    text: String,
    #[serde(rename = "type")]
    content_type: String,
}

#[derive(Debug, Deserialize)]
struct AnthropicUsage {
    input_tokens: usize,
    output_tokens: usize,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamChunk {
    #[serde(rename = "type")]
    chunk_type: String,
    index: Option<usize>,
    delta: Option<AnthropicStreamDelta>,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AnthropicStreamDelta {
    #[serde(rename = "type")]
    delta_type: String,
    text: Option<String>,
}

// Ollama API Types (OpenAI-compatible)
#[derive(Debug, Serialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    stream: bool,
    options: OllamaOptions,
}

#[derive(Debug, Serialize)]
struct OllamaOptions {
    temperature: f64,
    num_predict: usize,
}

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    message: OpenAIResponseMessageContent,
    prompt_eval_count: Option<usize>,
    eval_count: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct OllamaStreamChunk {
    done: bool,
    message: Option<OllamaStreamMessage>,
    prompt_eval_count: Option<usize>,
    eval_count: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct OllamaStreamMessage {
    role: String,
    content: String,
}

// Non-streaming commands
#[tauri::command]
pub async fn llm_chat(
    provider: String,
    model: Option<String>,
    messages: Vec<LLMMessage>,
    temperature: f64,
    max_tokens: usize,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<LLMResponse, String> {
    let client = Client::new();
    let model = normalize_model(model, &provider);
    let max_tokens = if max_tokens == 0 {
        DEFAULT_MAX_TOKENS
    } else {
        max_tokens
    };
    let base_url = normalize_base_url(base_url, &provider);
    let api_key = normalize_api_key(api_key);
    let requires_api_key = provider_requires_api_key(&provider, &base_url);

    if provider != "ollama" {
        validate_base_url_not_private(&base_url)
            .map_err(|e| format!("Base URL not allowed: {}", e))?;
    }

    if api_key.is_none() && requires_api_key {
        return Err("API key is required".to_string());
    }

    let result = match provider.as_str() {
        "openai" | "gemini" | "deepseek" => {
            call_openai_with_key(
                &client,
                &model,
                messages,
                temperature,
                max_tokens,
                api_key.as_deref(),
                &base_url,
            )
            .await?
        }
        "anthropic" => {
            call_anthropic_with_key(
                &client,
                &model,
                messages,
                temperature,
                max_tokens,
                &api_key.expect("anthropic API key required"),
                &base_url,
            )
            .await?
        }
        "ollama" => {
            call_ollama_with_url(
                &client,
                &model,
                messages,
                temperature,
                max_tokens,
                &base_url,
            )
            .await?
        }
        "openrouter" => {
            call_openrouter_with_key(
                &client,
                &model,
                messages,
                temperature,
                max_tokens,
                &api_key.expect("openrouter API key required"),
                &base_url,
            )
            .await?
        }
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    Ok(result)
}

#[tauri::command]
pub async fn llm_chat_with_context(
    app: AppHandle,
    provider: String,
    model: Option<String>,
    messages: Vec<LLMMessage>,
    context: LLMContextRequest,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<LLMResponse, String> {
    use tauri::Manager;
    let latest_user_message = messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .and_then(|message| extract_text_from_message_content(&message.content));

    let requested_max_tokens = context.context_window_tokens.unwrap_or(DEFAULT_MAX_TOKENS);

    let mut context_prompt = build_context_prompt(&context, latest_user_message.as_deref());

    // Inject long-term memory if enabled
    if context.memory_enabled.unwrap_or(false) {
        if let Ok(app_dir) = app.path().app_data_dir() {
            let memory_file = app_dir.join("memories").join("MEMORY.md");
            if memory_file.exists() {
                if let Ok(memory_content) = std::fs::read_to_string(&memory_file) {
                    context_prompt
                        .push_str("\n\n### USER LONG-TERM MEMORY (Facts & Preferences)\n");
                    context_prompt.push_str("The following is your persistent, long-term memory about the user. Use these facts and preferences to personalize your responses and be more helpful, personable, and accurate:\n");
                    context_prompt.push_str(&memory_content);
                    context_prompt.push_str("\n------------------------------------\n");
                }
            }
        }
    }

    let mut initial_messages = vec![LLMMessage {
        role: "system".to_string(),
        content: LLMMessageContent::Text(context_prompt),
    }];
    initial_messages.extend(messages.clone());

    match llm_chat(
        provider.clone(),
        model.clone(),
        initial_messages,
        0.7,
        requested_max_tokens,
        api_key.clone(),
        base_url.clone(),
    )
    .await
    {
        Ok(response) => Ok(response),
        Err(error) if provider == "ollama" && should_retry_ollama_with_smaller_context(&error) => {
            let fallback_context_window =
                reduced_ollama_context_window(context.context_window_tokens);
            let fallback_max_tokens = reduced_ollama_max_tokens(requested_max_tokens);
            let mut reduced_context = context.clone();
            reduced_context.context_window_tokens = Some(fallback_context_window);

            // Re-build context prompt for Ollama retry
            let mut retry_context_prompt =
                build_context_prompt(&reduced_context, latest_user_message.as_deref());
            if context.memory_enabled.unwrap_or(false) {
                if let Ok(app_dir) = app.path().app_data_dir() {
                    let memory_file = app_dir.join("memories").join("MEMORY.md");
                    if memory_file.exists() {
                        if let Ok(memory_content) = std::fs::read_to_string(&memory_file) {
                            retry_context_prompt
                                .push_str("\n\n### USER LONG-TERM MEMORY (Facts & Preferences)\n");
                            retry_context_prompt.push_str("The following is your persistent, long-term memory about the user. Use these facts and preferences to personalize your responses and be more helpful, personable, and accurate:\n");
                            retry_context_prompt.push_str(&memory_content);
                            retry_context_prompt
                                .push_str("\n------------------------------------\n");
                        }
                    }
                }
            }

            let mut retry_messages = vec![LLMMessage {
                role: "system".to_string(),
                content: LLMMessageContent::Text(retry_context_prompt),
            }];
            retry_messages.extend(messages);

            llm_chat(
                provider,
                model,
                retry_messages,
                0.7,
                fallback_max_tokens,
                api_key,
                base_url,
            )
            .await
            .map_err(|retry_error| {
                format!(
                    "{}. Retried Ollama with reduced context/max tokens and it still failed: {}",
                    error, retry_error
                )
            })
        }
        Err(error) => Err(error),
    }
}

// Streaming command - emits events to frontend
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn llm_stream_chat(
    app: AppHandle,
    provider: String,
    model: Option<String>,
    messages: Vec<LLMMessage>,
    temperature: f64,
    max_tokens: usize,
    api_key: Option<String>,
    base_url: Option<String>,
    request_id: Option<String>,
) -> Result<(), String> {
    let client = Client::new();
    let model = normalize_model(model, &provider);
    let max_tokens = if max_tokens == 0 {
        DEFAULT_MAX_TOKENS
    } else {
        max_tokens
    };
    let base_url = normalize_base_url(base_url, &provider);
    let api_key = normalize_api_key(api_key);
    let requires_api_key = provider_requires_api_key(&provider, &base_url);

    if provider != "ollama" {
        validate_base_url_not_private(&base_url).map_err(|e| {
            emit_stream_event(
                &app,
                LLM_STREAM_ERROR,
                serde_json::json!({
                    "error": format!("Base URL not allowed: {}", e)
                }),
            );
            format!("Base URL not allowed: {}", e)
        })?;
    }

    if api_key.is_none() && requires_api_key {
        emit_stream_event(
            &app,
            LLM_STREAM_ERROR,
            serde_json::json!({
                "error": "API key is required"
            }),
        );
        return Err("API key is required".to_string());
    }

    // Cancellation support (design D7): register the stream so
    // `llm_cancel_stream` can abort it. Blank ids stream without
    // cancellation, matching callers that never pass a request id.
    let request_id = request_id.filter(|id| !id.trim().is_empty());
    let cancel_token = request_id
        .as_deref()
        .and_then(|id| STREAM_REQUESTS.register(id));

    let stream_fut = async {
        match provider.as_str() {
            "openai" | "gemini" | "deepseek" => {
                stream_openai(
                    &app,
                    &client,
                    &model,
                    messages,
                    temperature,
                    max_tokens,
                    api_key.as_deref(),
                    &base_url,
                )
                .await
            }
            "anthropic" => {
                stream_anthropic(
                    &app,
                    &client,
                    &model,
                    messages,
                    temperature,
                    max_tokens,
                    &api_key.expect("anthropic API key required"),
                    &base_url,
                )
                .await
            }
            "ollama" => {
                stream_ollama(
                    &app,
                    &client,
                    &model,
                    messages,
                    temperature,
                    max_tokens,
                    &base_url,
                )
                .await
            }
            "openrouter" => {
                stream_openai(
                    &app,
                    &client,
                    &model,
                    messages,
                    temperature,
                    max_tokens,
                    Some(api_key.as_deref().expect("openrouter API key required")),
                    &base_url,
                )
                .await
            }
            _ => {
                emit_stream_event(
                    &app,
                    LLM_STREAM_ERROR,
                    serde_json::json!({
                        "error": format!("Unknown provider: {}", provider)
                    }),
                );
                Err(format!("Unknown provider: {}", provider))
            }
        }
    };

    // Cancellation owns a terminal event: if the cancel signal wins, the
    // stream future is dropped here (aborting the in-flight reqwest call, so
    // no further chunks are emitted) and we emit the single terminal
    // `llm:stream:error` with code "cancelled". `biased` with the stream
    // polled first keeps the guarantee one-sided: a stream that already
    // finished keeps its terminal event and a racing cancel becomes a no-op,
    // so at most one terminal event is ever emitted per request.
    let result = match (cancel_token, request_id.as_deref()) {
        (Some(mut token), Some(id)) => tokio::select! {
            biased;
            result = stream_fut => result,
            () = token.cancelled() => {
                emit_stream_event(
                    &app,
                    LLM_STREAM_ERROR,
                    serde_json::json!({
                        "error": "Stream cancelled",
                        "code": "cancelled",
                        "requestId": id,
                    }),
                );
                Ok(())
            }
        },
        (_, _) => stream_fut.await,
    };

    // Terminal cleanup: no-op when cancel already removed the entry, which
    // prevents a second terminal claim for this request id.
    if let Some(id) = request_id.as_deref() {
        STREAM_REQUESTS.complete(id);
    }

    result
}

/// Cancel an in-flight [`llm_stream_chat`] request (design D7).
///
/// When a live request is cancelled, its reqwest stream is aborted and the
/// stream task emits a single terminal `llm:stream:error` event with
/// `code: "cancelled"` (mirroring the on-device cancel semantics). Returns
/// `true` when a live request was cancelled; `false` means the id is unknown
/// or the stream already finished — a no-op with no event emitted.
#[tauri::command]
pub async fn llm_cancel_stream(request_id: String) -> Result<bool, String> {
    Ok(STREAM_REQUESTS.cancel(&request_id))
}

#[allow(clippy::too_many_arguments)]
async fn stream_openai(
    app: &AppHandle,
    client: &Client,
    model: &str,
    messages: Vec<LLMMessage>,
    temperature: f64,
    max_tokens: usize,
    api_key: Option<&str>,
    base_url: &str,
) -> Result<(), String> {
    let request = OpenAIRequest {
        model: model.to_string(),
        messages: map_openai_messages(messages)?,
        temperature,
        max_tokens,
        stream: Some(true),
    };

    let mut request_builder = client.post(format!("{}/chat/completions", base_url));
    if let Some(api_key) = api_key {
        request_builder = request_builder.header("Authorization", format!("Bearer {}", api_key));
    }

    let response = request_builder.json(&request).send().await.map_err(|e| {
        emit_stream_event(
            app,
            LLM_STREAM_ERROR,
            serde_json::json!({
                "error": format!("OpenAI API request failed: {}", e)
            }),
        );
        format!("OpenAI API request failed: {}", e)
    })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        emit_stream_event(
            app,
            LLM_STREAM_ERROR,
            serde_json::json!({
                "error": format!("OpenAI API error ({}): {}", status, error_text)
            }),
        );
        return Err(format!("OpenAI API error ({}): {}", status, error_text));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();

    // Coalesce token deltas before emitting to avoid one IPC event per token.
    let mut chunk_buf = String::new();
    let mut last_flush = std::time::Instant::now();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| {
            emit_stream_event(
                app,
                LLM_STREAM_ERROR,
                serde_json::json!({
                    "error": format!("Stream error: {}", e)
                }),
            );
            format!("Stream error: {}", e)
        })?;

        buffer.extend_from_slice(&chunk);
        let data = String::from_utf8_lossy(&buffer);

        for line in data.lines() {
            let line = line.trim();
            if line.is_empty() || line == "data: [DONE]" {
                continue;
            }

            if let Some(json_str) = line.strip_prefix("data: ") {
                if let Ok(chunk_data) = serde_json::from_str::<OpenAIStreamChunk>(json_str) {
                    if let Some(choice) = chunk_data.choices.first() {
                        if let Some(content) = &choice.delta.content {
                            chunk_buf.push_str(content);

                            let finished = choice.finish_reason.is_some();
                            if finished
                                || last_flush.elapsed() >= STREAM_FLUSH_INTERVAL
                                || chunk_buf.chars().count() >= STREAM_FLUSH_SIZE
                            {
                                flush_stream_chunk(app, &mut chunk_buf, &mut last_flush, finished);
                            }

                            if finished {
                                emit_stream_event(app, LLM_STREAM_DONE, serde_json::json!({}));
                                return Ok(());
                            }
                        }
                    }
                }
            }
        }

        buffer.clear();
    }

    // Final flush for any remaining buffered text.
    flush_stream_chunk(app, &mut chunk_buf, &mut last_flush, false);
    emit_stream_event(app, LLM_STREAM_DONE, serde_json::json!({}));
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn stream_anthropic(
    app: &AppHandle,
    client: &Client,
    model: &str,
    messages: Vec<LLMMessage>,
    temperature: f64,
    max_tokens: usize,
    api_key: &str,
    base_url: &str,
) -> Result<(), String> {
    // Filter out system messages for Anthropic
    let (system_message, chat_messages): (Vec<_>, Vec<_>) =
        messages.into_iter().partition(|m| m.role == "system");

    let anthropic_messages = map_anthropic_messages(chat_messages)?;

    let request = AnthropicRequest {
        model: model.to_string(),
        messages: anthropic_messages,
        max_tokens,
        temperature,
        anthropic_version: "2023-06-01".to_string(),
        stream: Some(true),
    };

    let response = client
        .post(format!("{}/messages", base_url))
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            emit_stream_event(
                app,
                LLM_STREAM_ERROR,
                serde_json::json!({
                    "error": format!("Anthropic API request failed: {}", e)
                }),
            );
            format!("Anthropic API request failed: {}", e)
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        emit_stream_event(
            app,
            LLM_STREAM_ERROR,
            serde_json::json!({
                "error": format!("Anthropic API error ({}): {}", status, error_text)
            }),
        );
        return Err(format!("Anthropic API error ({}): {}", status, error_text));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();

    // Coalesce token deltas before emitting to avoid one IPC event per token.
    let mut chunk_buf = String::new();
    let mut last_flush = std::time::Instant::now();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| {
            emit_stream_event(
                app,
                LLM_STREAM_ERROR,
                serde_json::json!({
                    "error": format!("Stream error: {}", e)
                }),
            );
            format!("Stream error: {}", e)
        })?;

        buffer.extend_from_slice(&chunk);
        let data = String::from_utf8_lossy(&buffer);

        for line in data.lines() {
            let line = line.trim();
            if line.is_empty() || !line.starts_with("data: ") {
                continue;
            }

            let json_str = &line[6..];
            if let Ok(chunk_data) = serde_json::from_str::<AnthropicStreamChunk>(json_str) {
                match chunk_data.chunk_type.as_str() {
                    "content_block_delta" => {
                        if let Some(delta) = chunk_data.delta {
                            if let Some(text) = delta.text {
                                chunk_buf.push_str(&text);

                                if last_flush.elapsed() >= STREAM_FLUSH_INTERVAL
                                    || chunk_buf.chars().count() >= STREAM_FLUSH_SIZE
                                {
                                    flush_stream_chunk(app, &mut chunk_buf, &mut last_flush, false);
                                }
                            }
                        }
                    }
                    "message_stop" => {
                        // Stream ended: flush any remaining buffered text.
                        flush_stream_chunk(app, &mut chunk_buf, &mut last_flush, false);
                        emit_stream_event(app, LLM_STREAM_DONE, serde_json::json!({}));
                        return Ok(());
                    }
                    "error" => {
                        // Flush any buffered text before surfacing the error.
                        flush_stream_chunk(app, &mut chunk_buf, &mut last_flush, false);
                        emit_stream_event(
                            app,
                            LLM_STREAM_ERROR,
                            serde_json::json!({
                                "error": "Anthropic streaming error"
                            }),
                        );
                        return Err("Anthropic streaming error".to_string());
                    }
                    _ => {}
                }
            }
        }

        buffer.clear();
    }

    // Final flush for any remaining buffered text.
    flush_stream_chunk(app, &mut chunk_buf, &mut last_flush, false);
    emit_stream_event(app, LLM_STREAM_DONE, serde_json::json!({}));
    Ok(())
}

async fn stream_ollama(
    app: &AppHandle,
    client: &Client,
    model: &str,
    messages: Vec<LLMMessage>,
    temperature: f64,
    max_tokens: usize,
    base_url: &str,
) -> Result<(), String> {
    let request = OllamaRequest {
        model: model.to_string(),
        messages: map_openai_messages(messages)?,
        stream: true,
        options: OllamaOptions {
            temperature,
            num_predict: max_tokens,
        },
    };

    let response = client
        .post(format!("{}/chat/completions", base_url))
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            emit_stream_event(
                app,
                LLM_STREAM_ERROR,
                serde_json::json!({
                    "error": format!("Ollama API request failed: {}", e)
                }),
            );
            format!("Ollama API request failed: {}", e)
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        emit_stream_event(
            app,
            LLM_STREAM_ERROR,
            serde_json::json!({
                "error": format!("Ollama API error ({}): {}", status, error_text)
            }),
        );
        return Err(format!("Ollama API error ({}): {}", status, error_text));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();

    // Coalesce token deltas before emitting to avoid one IPC event per token.
    let mut chunk_buf = String::new();
    let mut last_flush = std::time::Instant::now();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| {
            emit_stream_event(
                app,
                LLM_STREAM_ERROR,
                serde_json::json!({
                    "error": format!("Stream error: {}", e)
                }),
            );
            format!("Stream error: {}", e)
        })?;

        buffer.extend_from_slice(&chunk);
        let data = String::from_utf8_lossy(&buffer);

        for line in data.lines() {
            let line = line.trim();
            if line.is_empty() || line == "data: [DONE]" {
                continue;
            }

            if let Some(json_str) = line.strip_prefix("data: ") {
                if let Ok(chunk_data) = serde_json::from_str::<OpenAIStreamChunk>(json_str) {
                    if let Some(choice) = chunk_data.choices.first() {
                        if let Some(content) = &choice.delta.content {
                            chunk_buf.push_str(content);

                            let finished = choice.finish_reason.is_some();
                            if finished
                                || last_flush.elapsed() >= STREAM_FLUSH_INTERVAL
                                || chunk_buf.chars().count() >= STREAM_FLUSH_SIZE
                            {
                                flush_stream_chunk(app, &mut chunk_buf, &mut last_flush, finished);
                            }

                            if finished {
                                emit_stream_event(app, LLM_STREAM_DONE, serde_json::json!({}));
                                return Ok(());
                            }
                        }
                    }
                }
            }
        }

        buffer.clear();
    }

    // Final flush for any remaining buffered text.
    flush_stream_chunk(app, &mut chunk_buf, &mut last_flush, false);
    emit_stream_event(app, LLM_STREAM_DONE, serde_json::json!({}));
    Ok(())
}

#[tauri::command]
pub async fn llm_get_models(
    provider: String,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    match provider.as_str() {
        "gemini" => {
            let api_key =
                normalize_api_key(api_key).ok_or_else(|| "API key is required".to_string())?;
            let client = Client::new();
            let url = normalize_base_url(base_url, "gemini");
            fetch_openai_compatible_models(&client, &url, Some(&api_key)).await
        }
        "deepseek" => {
            let normalized_api_key = normalize_api_key(api_key);
            let client = Client::new();
            let url = normalize_base_url(base_url, "deepseek");
            let fallback_models = || {
                Ok(vec![
                    ModelInfo {
                        id: "deepseek-chat".to_string(),
                        name: "DeepSeek Chat (V3)".to_string(),
                        context_length: Some(64000),
                        pricing: Some(ModelPricing {
                            prompt: Some(0.00027),
                            completion: Some(0.0011),
                            request: None,
                            image: None,
                            web_search: None,
                            cache_read: Some(0.00007),
                            cache_write: None,
                        }),
                    },
                    ModelInfo {
                        id: "deepseek-reasoner".to_string(),
                        name: "DeepSeek Reasoner (R1)".to_string(),
                        context_length: Some(64000),
                        pricing: Some(ModelPricing {
                            prompt: Some(0.00055),
                            completion: Some(0.00219),
                            request: None,
                            image: None,
                            web_search: None,
                            cache_read: Some(0.00014),
                            cache_write: None,
                        }),
                    },
                ])
            };

            match normalized_api_key {
                // With a key present, this is a live "Refresh Models" request: report the
                // real fetch error instead of silently masking it behind the fallback list,
                // which would otherwise look like a successful refresh while actually
                // showing stale, hardcoded model names.
                Some(api_key) => {
                    fetch_openai_compatible_models(&client, &url, Some(&api_key)).await
                }
                None => fallback_models(),
            }
        }
        "openai" => {
            let normalized_api_key = normalize_api_key(api_key.clone());
            if normalized_api_key.is_some()
                || provider_allows_keyless_access(
                    "openai",
                    &normalize_base_url(base_url.clone(), "openai"),
                )
            {
                let client = Client::new();
                let url = normalize_base_url(base_url, "openai");
                match fetch_openai_compatible_models(&client, &url, normalized_api_key.as_deref())
                    .await
                {
                    Ok(models) => Ok(models),
                    Err(_) if normalized_api_key.is_none() => Ok(vec![
                        ModelInfo {
                            id: "gpt-4o".to_string(),
                            name: "GPT-4o".to_string(),
                            context_length: Some(128000),
                            pricing: Some(ModelPricing {
                                prompt: Some(0.0025),
                                completion: Some(0.01),
                                request: None,
                                image: None,
                                web_search: None,
                                cache_read: None,
                                cache_write: None,
                            }),
                        },
                        ModelInfo {
                            id: "gpt-4o-mini".to_string(),
                            name: "GPT-4o Mini".to_string(),
                            context_length: Some(128000),
                            pricing: Some(ModelPricing {
                                prompt: Some(0.00015),
                                completion: Some(0.0006),
                                request: None,
                                image: None,
                                web_search: None,
                                cache_read: None,
                                cache_write: None,
                            }),
                        },
                        ModelInfo {
                            id: "gpt-4-turbo".to_string(),
                            name: "GPT-4 Turbo".to_string(),
                            context_length: Some(128000),
                            pricing: Some(ModelPricing {
                                prompt: Some(0.01),
                                completion: Some(0.03),
                                request: None,
                                image: None,
                                web_search: None,
                                cache_read: None,
                                cache_write: None,
                            }),
                        },
                        ModelInfo {
                            id: "gpt-3.5-turbo".to_string(),
                            name: "GPT-3.5 Turbo".to_string(),
                            context_length: Some(16385),
                            pricing: Some(ModelPricing {
                                prompt: Some(0.0005),
                                completion: Some(0.0015),
                                request: None,
                                image: None,
                                web_search: None,
                                cache_read: None,
                                cache_write: None,
                            }),
                        },
                    ]),
                    Err(error) => Err(error),
                }
            } else {
                Ok(vec![
                    ModelInfo {
                        id: "gpt-4o".to_string(),
                        name: "GPT-4o".to_string(),
                        context_length: Some(128000),
                        pricing: Some(ModelPricing {
                            prompt: Some(0.0025),
                            completion: Some(0.01),
                            request: None,
                            image: None,
                            web_search: None,
                            cache_read: None,
                            cache_write: None,
                        }),
                    },
                    ModelInfo {
                        id: "gpt-4o-mini".to_string(),
                        name: "GPT-4o Mini".to_string(),
                        context_length: Some(128000),
                        pricing: Some(ModelPricing {
                            prompt: Some(0.00015),
                            completion: Some(0.0006),
                            request: None,
                            image: None,
                            web_search: None,
                            cache_read: None,
                            cache_write: None,
                        }),
                    },
                    ModelInfo {
                        id: "gpt-4-turbo".to_string(),
                        name: "GPT-4 Turbo".to_string(),
                        context_length: Some(128000),
                        pricing: Some(ModelPricing {
                            prompt: Some(0.01),
                            completion: Some(0.03),
                            request: None,
                            image: None,
                            web_search: None,
                            cache_read: None,
                            cache_write: None,
                        }),
                    },
                    ModelInfo {
                        id: "gpt-3.5-turbo".to_string(),
                        name: "GPT-3.5 Turbo".to_string(),
                        context_length: Some(16385),
                        pricing: Some(ModelPricing {
                            prompt: Some(0.0005),
                            completion: Some(0.0015),
                            request: None,
                            image: None,
                            web_search: None,
                            cache_read: None,
                            cache_write: None,
                        }),
                    },
                ])
            }
        }
        "anthropic" => {
            let normalized_api_key = normalize_api_key(api_key);
            if let Some(api_key) = normalized_api_key.as_deref() {
                let client = Client::new();
                let url = normalize_base_url(base_url, "anthropic");
                match fetch_anthropic_models(&client, &url, api_key).await {
                    Ok(models) => Ok(models),
                    Err(_) => Ok(vec![
                        ModelInfo {
                            id: "claude-3-5-sonnet-20241022".to_string(),
                            name: "Claude 3.5 Sonnet".to_string(),
                            context_length: Some(200000),
                            pricing: Some(ModelPricing {
                                prompt: Some(0.003),
                                completion: Some(0.015),
                                request: None,
                                image: None,
                                web_search: None,
                                cache_read: Some(0.0003),
                                cache_write: Some(0.00375),
                            }),
                        },
                        ModelInfo {
                            id: "claude-3-5-haiku-20241022".to_string(),
                            name: "Claude 3.5 Haiku".to_string(),
                            context_length: Some(200000),
                            pricing: Some(ModelPricing {
                                prompt: Some(0.0008),
                                completion: Some(0.004),
                                request: None,
                                image: None,
                                web_search: None,
                                cache_read: Some(0.00008),
                                cache_write: Some(0.001),
                            }),
                        },
                        ModelInfo {
                            id: "claude-3-opus-20240229".to_string(),
                            name: "Claude 3 Opus".to_string(),
                            context_length: Some(200000),
                            pricing: Some(ModelPricing {
                                prompt: Some(0.015),
                                completion: Some(0.075),
                                request: None,
                                image: None,
                                web_search: None,
                                cache_read: Some(0.0015),
                                cache_write: Some(0.01875),
                            }),
                        },
                    ]),
                }
            } else {
                Ok(vec![
                    ModelInfo {
                        id: "claude-3-5-sonnet-20241022".to_string(),
                        name: "Claude 3.5 Sonnet".to_string(),
                        context_length: Some(200000),
                        pricing: Some(ModelPricing {
                            prompt: Some(0.003),
                            completion: Some(0.015),
                            request: None,
                            image: None,
                            web_search: None,
                            cache_read: Some(0.0003),
                            cache_write: Some(0.00375),
                        }),
                    },
                    ModelInfo {
                        id: "claude-3-5-haiku-20241022".to_string(),
                        name: "Claude 3.5 Haiku".to_string(),
                        context_length: Some(200000),
                        pricing: Some(ModelPricing {
                            prompt: Some(0.0008),
                            completion: Some(0.004),
                            request: None,
                            image: None,
                            web_search: None,
                            cache_read: Some(0.00008),
                            cache_write: Some(0.001),
                        }),
                    },
                    ModelInfo {
                        id: "claude-3-opus-20240229".to_string(),
                        name: "Claude 3 Opus".to_string(),
                        context_length: Some(200000),
                        pricing: Some(ModelPricing {
                            prompt: Some(0.015),
                            completion: Some(0.075),
                            request: None,
                            image: None,
                            web_search: None,
                            cache_read: Some(0.0015),
                            cache_write: Some(0.01875),
                        }),
                    },
                ])
            }
        }
        "ollama" => {
            let client = Client::new();
            let url = normalize_base_url(base_url, "ollama");
            // /api/tags is the native Ollama endpoint (strip /v1 suffix if present)
            let tags_url = url.replace("/v1", "").replace("/chat/completions", "");
            fetch_ollama_models(&client, &tags_url).await
        }
        "openrouter" => {
            let api_key = normalize_api_key(api_key);
            if let Some(key) = api_key {
                let client = Client::new();
                let url = normalize_base_url(base_url, "openrouter");
                return fetch_openrouter_models(&client, &url, &key).await;
            }
            // Fallback to default list with approximate pricing
            Ok(vec![
                ModelInfo {
                    id: "anthropic/claude-3.5-sonnet".to_string(),
                    name: "Claude 3.5 Sonnet".to_string(),
                    context_length: Some(200000),
                    pricing: Some(ModelPricing {
                        prompt: Some(0.003),
                        completion: Some(0.015),
                        request: None,
                        image: None,
                        web_search: None,
                        cache_read: None,
                        cache_write: None,
                    }),
                },
                ModelInfo {
                    id: "anthropic/claude-3.5-sonnet:beta".to_string(),
                    name: "Claude 3.5 Sonnet (Beta)".to_string(),
                    context_length: Some(200000),
                    pricing: Some(ModelPricing {
                        prompt: Some(0.003),
                        completion: Some(0.015),
                        request: None,
                        image: None,
                        web_search: None,
                        cache_read: None,
                        cache_write: None,
                    }),
                },
                ModelInfo {
                    id: "anthropic/claude-3.5-haiku".to_string(),
                    name: "Claude 3.5 Haiku".to_string(),
                    context_length: Some(200000),
                    pricing: Some(ModelPricing {
                        prompt: Some(0.0008),
                        completion: Some(0.004),
                        request: None,
                        image: None,
                        web_search: None,
                        cache_read: None,
                        cache_write: None,
                    }),
                },
                ModelInfo {
                    id: "anthropic/claude-3-opus".to_string(),
                    name: "Claude 3 Opus".to_string(),
                    context_length: Some(200000),
                    pricing: Some(ModelPricing {
                        prompt: Some(0.015),
                        completion: Some(0.075),
                        request: None,
                        image: None,
                        web_search: None,
                        cache_read: None,
                        cache_write: None,
                    }),
                },
                ModelInfo {
                    id: "openai/gpt-4o".to_string(),
                    name: "GPT-4o".to_string(),
                    context_length: Some(128000),
                    pricing: Some(ModelPricing {
                        prompt: Some(0.0025),
                        completion: Some(0.01),
                        request: None,
                        image: None,
                        web_search: None,
                        cache_read: None,
                        cache_write: None,
                    }),
                },
                ModelInfo {
                    id: "openai/gpt-4o-mini".to_string(),
                    name: "GPT-4o Mini".to_string(),
                    context_length: Some(128000),
                    pricing: Some(ModelPricing {
                        prompt: Some(0.00015),
                        completion: Some(0.0006),
                        request: None,
                        image: None,
                        web_search: None,
                        cache_read: None,
                        cache_write: None,
                    }),
                },
                ModelInfo {
                    id: "openai/gpt-4-turbo".to_string(),
                    name: "GPT-4 Turbo".to_string(),
                    context_length: Some(128000),
                    pricing: Some(ModelPricing {
                        prompt: Some(0.01),
                        completion: Some(0.03),
                        request: None,
                        image: None,
                        web_search: None,
                        cache_read: None,
                        cache_write: None,
                    }),
                },
                ModelInfo {
                    id: "google/gemini-pro-1.5".to_string(),
                    name: "Gemini Pro 1.5".to_string(),
                    context_length: Some(2000000),
                    pricing: Some(ModelPricing {
                        prompt: Some(0.00125),
                        completion: Some(0.005),
                        request: None,
                        image: None,
                        web_search: None,
                        cache_read: None,
                        cache_write: None,
                    }),
                },
                ModelInfo {
                    id: "meta-llama/llama-3.1-405b-instruct".to_string(),
                    name: "Llama 3.1 405B".to_string(),
                    context_length: Some(128000),
                    pricing: Some(ModelPricing {
                        prompt: Some(0.005),
                        completion: Some(0.005),
                        request: None,
                        image: None,
                        web_search: None,
                        cache_read: None,
                        cache_write: None,
                    }),
                },
                ModelInfo {
                    id: "deepseek/deepseek-chat".to_string(),
                    name: "DeepSeek Chat".to_string(),
                    context_length: Some(64000),
                    pricing: Some(ModelPricing {
                        prompt: Some(0.00027),
                        completion: Some(0.0011),
                        request: None,
                        image: None,
                        web_search: None,
                        cache_read: None,
                        cache_write: None,
                    }),
                },
            ])
        }
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

#[tauri::command]
pub async fn llm_test_connection(
    provider: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<bool, String> {
    let client = Client::new();
    let base_url = normalize_base_url(base_url, &provider);
    let api_key = normalize_api_key(Some(api_key)).unwrap_or_default();

    if provider_requires_api_key(&provider, &base_url) && api_key.is_empty() {
        return Err("API key is required".to_string());
    }

    let result = match provider.as_str() {
        "openai" | "gemini" | "deepseek" => {
            test_openai_connection(
                &client,
                &base_url,
                if api_key.is_empty() {
                    None
                } else {
                    Some(api_key.as_str())
                },
            )
            .await?
        }
        "anthropic" => test_anthropic_connection(&client, &base_url, &api_key).await?,
        "ollama" => test_ollama_connection(&client, &base_url).await?,
        "openrouter" => test_openrouter_connection(&client, &base_url, &api_key).await?,
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    Ok(result)
}

// Non-streaming helper functions (kept for compatibility)
async fn call_openai_with_key(
    client: &Client,
    model: &str,
    messages: Vec<LLMMessage>,
    temperature: f64,
    max_tokens: usize,
    api_key: Option<&str>,
    base_url: &str,
) -> Result<LLMResponse, String> {
    let request = OpenAIRequest {
        model: model.to_string(),
        messages: map_openai_messages(messages)?,
        temperature,
        max_tokens,
        stream: None,
    };

    let mut request_builder = client.post(format!("{}/chat/completions", base_url));
    if let Some(api_key) = api_key {
        request_builder = request_builder.header("Authorization", format!("Bearer {}", api_key));
    }

    let response = request_builder
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("OpenAI API request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error ({}): {}", status, error_text));
    }

    let openai_response: OpenAIResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse OpenAI response: {}", e))?;

    let content = openai_response
        .choices
        .first()
        .map(|c| c.message.text())
        .unwrap_or_default();

    Ok(LLMResponse {
        content,
        usage: openai_response.usage.map(|u| LLMUsage {
            prompt_tokens: u.prompt_tokens(),
            completion_tokens: u.completion_tokens(),
            total_tokens: u.total_tokens(),
            prompt_cache_hit_tokens: u.prompt_cache_hit_tokens,
            prompt_cache_miss_tokens: u.prompt_cache_miss_tokens,
        }),
    })
}

async fn call_anthropic_with_key(
    client: &Client,
    model: &str,
    messages: Vec<LLMMessage>,
    temperature: f64,
    max_tokens: usize,
    api_key: &str,
    base_url: &str,
) -> Result<LLMResponse, String> {
    // Filter out system messages for Anthropic
    let (system_message, chat_messages): (Vec<_>, Vec<_>) =
        messages.into_iter().partition(|m| m.role == "system");

    let anthropic_messages = map_anthropic_messages(chat_messages)?;

    let request = AnthropicRequest {
        model: model.to_string(),
        messages: anthropic_messages,
        max_tokens,
        temperature,
        anthropic_version: "2023-06-01".to_string(),
        stream: None,
    };

    let response = client
        .post(format!("{}/messages", base_url))
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Anthropic API request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Anthropic API error ({}): {}", status, error_text));
    }

    let anthropic_response: AnthropicResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;

    let content = anthropic_response
        .content
        .iter()
        .filter(|c| c.content_type == "text")
        .map(|c| c.text.clone())
        .collect::<Vec<_>>()
        .join("\n");

    Ok(LLMResponse {
        content,
        usage: anthropic_response.usage.map(|u| LLMUsage {
            prompt_tokens: u.input_tokens,
            completion_tokens: u.output_tokens,
            total_tokens: u.input_tokens + u.output_tokens,
            prompt_cache_hit_tokens: None,
            prompt_cache_miss_tokens: None,
        }),
    })
}

async fn call_ollama_with_url(
    client: &Client,
    model: &str,
    messages: Vec<LLMMessage>,
    temperature: f64,
    max_tokens: usize,
    base_url: &str,
) -> Result<LLMResponse, String> {
    let request = OllamaRequest {
        model: model.to_string(),
        messages: map_openai_messages(messages)?,
        stream: false,
        options: OllamaOptions {
            temperature,
            num_predict: max_tokens,
        },
    };

    let response = client
        .post(format!("{}/chat/completions", base_url))
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Ollama API request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Ollama API error ({}): {}", status, error_text));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Ollama response: {}", e))?;
    let openai_response: OpenAIResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    let choice = openai_response
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| "Ollama response contained no choices".to_string())?;

    Ok(LLMResponse {
        content: choice.message.text(),
        usage: openai_response.usage.map(|u| LLMUsage {
            prompt_tokens: u.prompt_tokens(),
            completion_tokens: u.completion_tokens(),
            total_tokens: u.total_tokens(),
            prompt_cache_hit_tokens: None,
            prompt_cache_miss_tokens: None,
        }),
    })
}

async fn call_openrouter_with_key(
    client: &Client,
    model: &str,
    messages: Vec<LLMMessage>,
    temperature: f64,
    max_tokens: usize,
    api_key: &str,
    base_url: &str,
) -> Result<LLMResponse, String> {
    // Clamp temperature to valid range for OpenAI-compatible APIs (0-2)
    let temperature = temperature.clamp(0.0, 2.0);

    let request = OpenAIRequest {
        model: model.to_string(),
        messages: map_openai_messages(messages)?,
        temperature,
        max_tokens,
        stream: None,
    };

    let response = client
        .post(format!("{}/chat/completions", base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("HTTP-Referer", "https://incrementum.app")
        .header("X-Title", "Incrementum")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("OpenRouter API request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "OpenRouter API error ({}): {}",
            status,
            ellipsize_body(error_text.trim(), 300)
        ));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read OpenRouter response: {}", e))?;
    let openrouter_response: OpenAIResponse = serde_json::from_str(&body).map_err(|e| {
        // OpenRouter sometimes reports upstream failures as HTTP 200 with an
        // {"error": {...}} body; surface that instead of a decode error.
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) {
            if let Some(message) = value
                .get("error")
                .and_then(|err| err.get("message"))
                .and_then(|m| m.as_str())
            {
                return format!("OpenRouter error: {}", message);
            }
        }
        format!(
            "Failed to parse OpenRouter response: {} — body: {}",
            e,
            ellipsize_body(body.trim(), 300)
        )
    })?;

    let choice = openrouter_response
        .choices
        .first()
        .ok_or_else(|| "OpenRouter response contained no choices".to_string())?;

    Ok(LLMResponse {
        content: choice.message.text(),
        usage: openrouter_response.usage.map(|u| LLMUsage {
            prompt_tokens: u.prompt_tokens(),
            completion_tokens: u.completion_tokens(),
            total_tokens: u.total_tokens(),
            prompt_cache_hit_tokens: None,
            prompt_cache_miss_tokens: None,
        }),
    })
}

async fn test_openai_connection(
    client: &Client,
    base_url: &str,
    api_key: Option<&str>,
) -> Result<bool, String> {
    if api_key.is_none() && !is_local_base_url(base_url) {
        return Err("API key is required".to_string());
    }

    let mut request_builder = client.get(format!("{}/models", base_url));
    if let Some(api_key) = api_key {
        request_builder = request_builder.header("Authorization", format!("Bearer {}", api_key));
    }

    let response = request_builder
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    Ok(response.status().is_success())
}

async fn test_anthropic_connection(
    client: &Client,
    base_url: &str,
    api_key: &str,
) -> Result<bool, String> {
    let response = client
        .get(format!("{}/models", base_url))
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    Ok(response.status().is_success())
}

async fn test_ollama_connection(client: &Client, base_url: &str) -> Result<bool, String> {
    let response = client
        .get(format!("{}/tags", base_url.replace("/v1", "")))
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    Ok(response.status().is_success())
}

async fn test_openrouter_connection(
    client: &Client,
    base_url: &str,
    api_key: &str,
) -> Result<bool, String> {
    // Verify the API key by checking models endpoint (lighter weight and reliable)
    let models_response = client
        .get(format!("{}/models", base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("HTTP-Referer", "https://incrementum.app")
        .header("X-Title", "Incrementum")
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    if !models_response.status().is_success() {
        let status = models_response.status();
        let error_text = models_response.text().await.unwrap_or_default();
        return Err(format!(
            "OpenRouter API key validation failed ({}): {}",
            status, error_text
        ));
    }

    Ok(true)
}

/// Model pricing. All fields are USD per 1,000 tokens, except `request`,
/// `image` and `web_search` which are per-call costs and are NOT scaled. `None`
/// means "not priced / unknown"; `Some(0.0)` means free.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPricing {
    pub prompt: Option<f64>,
    pub completion: Option<f64>,
    pub request: Option<f64>,
    pub image: Option<f64>,
    pub web_search: Option<f64>,
    #[serde(rename = "cache_read")]
    pub cache_read: Option<f64>,
    #[serde(rename = "cache_write")]
    pub cache_write: Option<f64>,
}

// Model information with pricing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub context_length: Option<usize>,
    pub pricing: Option<ModelPricing>,
}

/// Normalize a single OpenRouter pricing value into the app's USD-per-1K-tokens
/// unit. OpenRouter returns prices as USD per single token, string-encoded, and
/// uses `"0"` for genuinely free models and negative values as its "not priced"
/// sentinel. Rules:
/// - unparseable / non-finite → `None`
/// - negative (not priced) → `None`
/// - exactly zero (free) → `Some(0.0)`
/// - positive → `Some(v * 1000.0)` when per-token, else `Some(v)` (per-call, unscaled)
fn normalize_openrouter_price(value: Option<&serde_json::Value>, per_token: bool) -> Option<f64> {
    let raw = value.and_then(|v| {
        if let Some(n) = v.as_f64() {
            Some(n)
        } else if let Some(s) = v.as_str() {
            s.trim().parse::<f64>().ok()
        } else {
            None
        }
    })?;
    if !raw.is_finite() || raw < 0.0 {
        return None;
    }
    if raw == 0.0 {
        return Some(0.0);
    }
    Some(if per_token { raw * 1000.0 } else { raw })
}

/// Build a `ModelPricing` from OpenRouter's `pricing` object.
///
/// `prompt`, `completion` and the cache fields are per-token (scaled ×1000);
/// `request`, `image` and `web_search` are per-call and must NOT be scaled —
/// multiplying those would be a 1000× error in the other direction.
/// OpenRouter's cache keys are `input_cache_read` / `input_cache_write`; the
/// older `cache_read` / `cache_write` keys are kept as a fallback lookup.
fn map_openrouter_pricing(
    pricing_obj: &serde_json::Map<String, serde_json::Value>,
) -> ModelPricing {
    ModelPricing {
        prompt: normalize_openrouter_price(pricing_obj.get("prompt"), true),
        completion: normalize_openrouter_price(pricing_obj.get("completion"), true),
        request: normalize_openrouter_price(pricing_obj.get("request"), false),
        image: normalize_openrouter_price(pricing_obj.get("image"), false),
        web_search: normalize_openrouter_price(pricing_obj.get("web_search"), false),
        cache_read: normalize_openrouter_price(
            pricing_obj
                .get("input_cache_read")
                .or_else(|| pricing_obj.get("cache_read")),
            true,
        ),
        cache_write: normalize_openrouter_price(
            pricing_obj
                .get("input_cache_write")
                .or_else(|| pricing_obj.get("cache_write")),
            true,
        ),
    }
}

async fn fetch_openrouter_models(
    client: &Client,
    base_url: &str,
    api_key: &str,
) -> Result<Vec<ModelInfo>, String> {
    let response = client
        .get(format!("{}/models", base_url))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("HTTP-Referer", "https://incrementum.app")
        .header("X-Title", "Incrementum")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch models from OpenRouter: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "OpenRouter models API error ({}): {}",
            status, error_text
        ));
    }

    // OpenRouter's models payload can contain mixed types (numbers/strings/null).
    // Parse defensively from raw JSON to avoid hard-failing on type drift.
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse OpenRouter models response: {}", e))?;

    let data = payload
        .get("data")
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            "Failed to parse OpenRouter models response: missing `data` array".to_string()
        })?;

    let parse_usize = |value: Option<&serde_json::Value>| -> Option<usize> {
        let value = value?;
        if let Some(n) = value.as_u64() {
            return usize::try_from(n).ok();
        }
        if let Some(s) = value.as_str() {
            return s.trim().parse::<usize>().ok();
        }
        None
    };

    // Convert to ModelInfo and sort by ID
    let mut models: Vec<ModelInfo> = data
        .iter()
        .filter_map(|entry| {
            let obj = entry.as_object()?;
            let id = obj.get("id")?.as_str()?.trim().to_string();
            if id.is_empty() {
                return None;
            }

            let name = obj
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| id.clone());

            let context_length = parse_usize(obj.get("context_length"));

            let pricing = obj
                .get("pricing")
                .and_then(|v| v.as_object())
                .map(map_openrouter_pricing);

            Some(ModelInfo {
                id,
                name,
                context_length,
                pricing,
            })
        })
        .collect();

    models.sort_by(|a, b| a.id.cmp(&b.id));

    if models.is_empty() {
        return Err(
            "OpenRouter models response did not contain any usable model entries".to_string(),
        );
    }

    Ok(models)
}

async fn fetch_openai_compatible_models(
    client: &Client,
    base_url: &str,
    api_key: Option<&str>,
) -> Result<Vec<ModelInfo>, String> {
    let mut request_builder = client.get(format!("{}/models", base_url));
    if let Some(api_key) = api_key {
        request_builder = request_builder.header("Authorization", format!("Bearer {}", api_key));
    }

    let response = request_builder.send().await.map_err(|e| {
        format!(
            "Failed to fetch models from OpenAI-compatible endpoint: {}",
            e
        )
    })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "OpenAI-compatible models API error ({}): {}",
            status, error_text
        ));
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse OpenAI-compatible models response: {}", e))?;

    let data = payload
        .get("data")
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            "Failed to parse OpenAI-compatible models response: missing `data` array".to_string()
        })?;

    let mut models: Vec<ModelInfo> = data
        .iter()
        .filter_map(|entry| {
            let obj = entry.as_object()?;
            let id = obj.get("id")?.as_str()?.trim().to_string();
            if id.is_empty() {
                return None;
            }

            Some(ModelInfo {
                name: id.clone(),
                id,
                context_length: None,
                pricing: None,
            })
        })
        .collect();

    if models.is_empty() {
        return Err("OpenAI-compatible endpoint did not return any usable models".to_string());
    }

    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

async fn fetch_anthropic_models(
    client: &Client,
    base_url: &str,
    api_key: &str,
) -> Result<Vec<ModelInfo>, String> {
    let response = client
        .get(format!("{}/models", base_url))
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch models from Anthropic: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Anthropic models API error ({}): {}",
            status, error_text
        ));
    }

    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Anthropic models response: {}", e))?;

    let data = payload
        .get("data")
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            "Failed to parse Anthropic models response: missing `data` array".to_string()
        })?;

    let mut models: Vec<ModelInfo> = data
        .iter()
        .filter_map(|entry| {
            let obj = entry.as_object()?;
            let id = obj.get("id")?.as_str()?.trim().to_string();
            if id.is_empty() {
                return None;
            }

            let display_name = obj
                .get("display_name")
                .and_then(|v| v.as_str())
                .map(|name| name.trim().to_string())
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| id.clone());

            Some(ModelInfo {
                id,
                name: display_name,
                context_length: None,
                pricing: None,
            })
        })
        .collect();

    if models.is_empty() {
        return Err("Anthropic models response did not contain any usable models".to_string());
    }

    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

async fn fetch_ollama_models(client: &Client, base_url: &str) -> Result<Vec<ModelInfo>, String> {
    let response = client
        .get(format!("{}/api/tags", base_url))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Ollama at {}: {}", base_url, e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Ollama API error ({}): {}", status, error_text));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Ollama response: {}", e))?;
    let payload: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    let empty: Vec<serde_json::Value> = vec![];
    let models = payload
        .get("models")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);

    let format_size = |bytes: Option<&serde_json::Value>| -> Option<String> {
        let b = bytes?.as_u64()?;
        let gb = b as f64 / (1024.0 * 1024.0 * 1024.0);
        if gb >= 1.0 {
            Some(format!("{:.1} GB", gb))
        } else {
            let mb = b as f64 / (1024.0 * 1024.0);
            Some(format!("{:.0} MB", mb))
        }
    };

    let mut result: Vec<ModelInfo> = models
        .iter()
        .filter_map(|m| {
            let name = m.get("name")?.as_str()?.to_string();
            let size = m.get("size").and_then(|v| format_size(Some(v)));
            let family = m
                .get("details")
                .and_then(|d| d.get("family"))
                .and_then(|f| f.as_str())
                .map(|s| s.to_string());

            let display_name = match (&size, &family) {
                (Some(s), Some(f)) => format!("{} ({}, {})", name, f, s),
                (Some(s), None) => format!("{} ({})", name, s),
                (None, Some(f)) => format!("{} ({})", name, f),
                (None, None) => name.clone(),
            };

            Some(ModelInfo {
                id: name,
                name: display_name,
                context_length: None,
                pricing: None,
            })
        })
        .collect();

    if result.is_empty() {
        return Err(
            "No models found in Ollama. Run `ollama pull <model>` to install one.".to_string(),
        );
    }

    result.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(result)
}

// Helper functions
fn get_default_model(provider: &str) -> String {
    match provider {
        "openai" => "gpt-4o".to_string(),
        "anthropic" => "claude-3-5-sonnet-20241022".to_string(),
        "gemini" => "gemini-3.5-flash".to_string(),
        "ollama" => "llama3.2".to_string(),
        // Use a free model that's actually available on OpenRouter
        "openrouter" => "google/gemma-2-9b-it:free".to_string(),
        _ => "default".to_string(),
    }
}

fn normalize_api_key(api_key: Option<String>) -> Option<String> {
    api_key
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty())
}

fn normalize_model(model: Option<String>, provider: &str) -> String {
    model
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| get_default_model(provider))
}

fn provider_allows_keyless_access(provider: &str, base_url: &str) -> bool {
    provider == "ollama" || (provider == "openai" && is_local_base_url(base_url))
}

fn provider_requires_api_key(provider: &str, base_url: &str) -> bool {
    !provider_allows_keyless_access(provider, base_url)
}

fn is_local_base_url(base_url: &str) -> bool {
    let trimmed = base_url.trim().to_ascii_lowercase();
    let without_scheme = trimmed
        .strip_prefix("http://")
        .or_else(|| trimmed.strip_prefix("https://"))
        .unwrap_or(trimmed.as_str());
    let host_port = without_scheme.split('/').next().unwrap_or("");
    let host = if host_port.starts_with('[') {
        host_port
            .split(']')
            .next()
            .unwrap_or(host_port)
            .trim_start_matches('[')
    } else {
        host_port.split(':').next().unwrap_or(host_port)
    };

    matches!(
        host,
        "localhost" | "127.0.0.1" | "0.0.0.0" | "::1" | "host.docker.internal"
    ) || host.ends_with(".local")
}

/// Validate that a user-supplied base_url is not a private/internal address.
/// Returns Err if the URL resolves to a private IP or localhost (for non-Ollama providers).
fn validate_base_url_not_private(base_url: &str) -> Result<(), String> {
    let trimmed = base_url.trim().to_ascii_lowercase();
    // Allow localhost/127.0.0.1 for Ollama which runs locally
    let without_scheme = trimmed
        .strip_prefix("http://")
        .or_else(|| trimmed.strip_prefix("https://"))
        .unwrap_or(trimmed.as_str());
    let host_port = without_scheme.split('/').next().unwrap_or("");
    let host = if host_port.starts_with('[') {
        host_port
            .split(']')
            .next()
            .unwrap_or(host_port)
            .trim_start_matches('[')
    } else {
        host_port.split(':').next().unwrap_or(host_port)
    };

    // Skip validation for known local-only hosts (Ollama use case)
    if matches!(
        host,
        "localhost" | "127.0.0.1" | "0.0.0.0" | "::1" | "host.docker.internal"
    ) || host.ends_with(".local")
    {
        return Ok(());
    }

    crate::security::validate_url_not_private(base_url)
}

fn normalize_base_url(base_url: Option<String>, provider: &str) -> String {
    let fallback = get_default_base_url(provider);
    let url = base_url.unwrap_or(fallback.clone());
    if url.trim().is_empty() {
        return fallback;
    }
    url.trim_end_matches('/').to_string()
}

fn get_default_base_url(provider: &str) -> String {
    match provider {
        "openai" => "https://api.openai.com/v1".to_string(),
        "anthropic" => "https://api.anthropic.com/v1".to_string(),
        "gemini" => "https://generativelanguage.googleapis.com/v1beta/openai".to_string(),
        "deepseek" => "https://api.deepseek.com/v1".to_string(),
        "ollama" => "http://localhost:11434/v1".to_string(),
        "openrouter" => "https://openrouter.ai/api/v1".to_string(),
        _ => "".to_string(),
    }
}

fn build_context_prompt(context: &LLMContextRequest, latest_user_message: Option<&str>) -> String {
    let mut instructions = String::from(
        "Use the provided context to answer the user's request. \
If the user asks for a summary, summarize the relevant context. \
If the answer is not in the provided context, say so.",
    );

    instructions.push('\n');

    match context.r#type.as_str() {
        "document" => {
            let mut prompt = format!(
                "The user is viewing a document{}.",
                context
                    .document_id
                    .as_ref()
                    .map(|id| format!(" (ID: {})", id))
                    .unwrap_or_default()
            );

            if let Some(selection) = context.selection.as_ref() {
                if !selection.trim().is_empty() {
                    prompt.push_str(&format!("\nSelected text: \"{}\"", selection));
                }
            }

            if let Some(content) = context.content.as_ref() {
                let excerpt = select_relevant_excerpt(
                    content,
                    context.context_window_tokens,
                    latest_user_message,
                );
                if !excerpt.trim().is_empty() {
                    prompt.push_str("\nDocument content (excerpt):\n");
                    prompt.push_str(&excerpt);
                }
            }

            instructions.push_str(&prompt);
            instructions
        }
        "web" => {
            let mut prompt = format!(
                "The user is browsing the web page: {}.",
                context.url.as_deref().unwrap_or("Unknown")
            );

            if let Some(selection) = context.selection.as_ref() {
                if !selection.trim().is_empty() {
                    prompt.push_str(&format!("\nSelected text: \"{}\"", selection));
                }
            }

            if let Some(content) = context.content.as_ref() {
                let excerpt = select_relevant_excerpt(
                    content,
                    context.context_window_tokens,
                    latest_user_message,
                );
                if !excerpt.trim().is_empty() {
                    prompt.push_str("\nPage content (excerpt):\n");
                    prompt.push_str(&excerpt);
                }
            }

            instructions.push_str(&prompt);
            instructions
        }
        "video" => {
            let mut prompt = String::from("The user is watching a video.");

            if let Some(selection) = context.selection.as_ref() {
                if !selection.trim().is_empty() {
                    prompt.push_str(&format!("\nSelected text: \"{}\"", selection));
                }
            }

            if let Some(content) = context.content.as_ref() {
                let excerpt = select_relevant_excerpt(
                    content,
                    context.context_window_tokens,
                    latest_user_message,
                );
                if !excerpt.trim().is_empty() {
                    prompt.push_str("\nTranscript (excerpt):\n");
                    prompt.push_str(&excerpt);
                }
            }

            instructions.push_str(&prompt);
            instructions
        }
        _ => {
            instructions.push_str("You are a helpful assistant.");
            instructions
        }
    }
}

fn prepend_context_message(
    messages: Vec<LLMMessage>,
    context: &LLMContextRequest,
    latest_user_message: Option<&str>,
) -> Vec<LLMMessage> {
    let context_prompt = build_context_prompt(context, latest_user_message);
    let mut messages_with_context = vec![LLMMessage {
        role: "system".to_string(),
        content: LLMMessageContent::Text(context_prompt),
    }];
    messages_with_context.extend(messages);
    messages_with_context
}

fn extract_text_from_message_content(content: &LLMMessageContent) -> Option<String> {
    match content {
        LLMMessageContent::Text(text) => Some(text.clone()),
        LLMMessageContent::Parts(parts) => {
            let text = parts
                .iter()
                .filter_map(|part| match part {
                    LLMMessageContentPart::Text { text } => Some(text.trim()),
                    LLMMessageContentPart::ImageUrl { .. } => None,
                })
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join("\n");

            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
    }
}

fn map_openai_messages(messages: Vec<LLMMessage>) -> Result<Vec<OpenAIMessage>, String> {
    messages
        .into_iter()
        .map(|message| {
            Ok(OpenAIMessage {
                role: message.role,
                content: map_openai_message_content(message.content),
            })
        })
        .collect()
}

fn map_openai_message_content(content: LLMMessageContent) -> OpenAIMessageContent {
    match content {
        LLMMessageContent::Text(text) => OpenAIMessageContent::Text(text),
        LLMMessageContent::Parts(parts) => {
            OpenAIMessageContent::Parts(parts.into_iter().map(map_openai_content_part).collect())
        }
    }
}

fn map_openai_content_part(part: LLMMessageContentPart) -> OpenAIContentPart {
    match part {
        LLMMessageContentPart::Text { text } => OpenAIContentPart::Text { text },
        LLMMessageContentPart::ImageUrl { image_url } => OpenAIContentPart::ImageUrl {
            image_url: OpenAIImageUrl { url: image_url },
        },
    }
}

fn map_anthropic_messages(messages: Vec<LLMMessage>) -> Result<Vec<AnthropicMessage>, String> {
    messages
        .into_iter()
        .map(|message| {
            Ok(AnthropicMessage {
                role: message.role,
                content: map_anthropic_message_content(message.content)?,
            })
        })
        .collect()
}

fn map_anthropic_message_content(
    content: LLMMessageContent,
) -> Result<AnthropicMessageContent, String> {
    match content {
        LLMMessageContent::Text(text) => Ok(AnthropicMessageContent::Text(text)),
        LLMMessageContent::Parts(parts) => Ok(AnthropicMessageContent::Parts(
            parts
                .into_iter()
                .map(map_anthropic_content_part)
                .collect::<Result<Vec<_>, _>>()?,
        )),
    }
}

fn map_anthropic_content_part(
    part: LLMMessageContentPart,
) -> Result<AnthropicInputContentPart, String> {
    match part {
        LLMMessageContentPart::Text { text } => Ok(AnthropicInputContentPart::Text { text }),
        LLMMessageContentPart::ImageUrl { image_url } => {
            let (media_type, data) = parse_data_url(&image_url).ok_or_else(|| {
                "Anthropic image inputs must be provided as data URLs".to_string()
            })?;
            Ok(AnthropicInputContentPart::Image {
                source: AnthropicImageSource {
                    source_type: "base64".to_string(),
                    media_type,
                    data,
                },
            })
        }
    }
}

fn parse_data_url(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim();
    let rest = trimmed.strip_prefix("data:")?;
    let (meta, data) = rest.split_once(',')?;
    if !meta.contains(";base64") {
        return None;
    }
    let media_type = meta.split(';').next()?.trim();
    if media_type.is_empty() || data.trim().is_empty() {
        return None;
    }
    Some((media_type.to_string(), data.trim().to_string()))
}

fn should_retry_ollama_with_smaller_context(error: &str) -> bool {
    let lowered = error.to_ascii_lowercase();
    lowered.contains("unexpected eof")
        || (lowered.contains("ollama api error (500") && lowered.contains("api_error"))
}

fn reduced_ollama_context_window(context_window_tokens: Option<usize>) -> usize {
    let current = context_window_tokens.unwrap_or(DEFAULT_MAX_TOKENS);
    current.min(512).max(256)
}

fn reduced_ollama_max_tokens(max_tokens: usize) -> usize {
    max_tokens.min(512).max(256)
}

fn select_relevant_excerpt(
    content: &str,
    context_window_tokens: Option<usize>,
    user_query: Option<&str>,
) -> String {
    let max_chars = estimate_context_chars(context_window_tokens);
    let mut char_indices: Vec<usize> = content.char_indices().map(|(i, _)| i).collect();
    char_indices.push(content.len());
    let total_chars = char_indices.len().saturating_sub(1);

    if total_chars <= max_chars {
        return content.to_string();
    }

    let query_terms = user_query.map(extract_query_terms).unwrap_or_default();

    if query_terms.is_empty() {
        return content.chars().take(max_chars).collect();
    }

    let mut best_chunks: Vec<(usize, usize, usize)> = Vec::new(); // (score, start, end)
    let chunk_len = max_chars.clamp(400, 1200).min(total_chars);
    let overlap = 200.min(chunk_len / 3);
    let mut start_char = 0;

    while start_char < total_chars {
        let end_char = (start_char + chunk_len).min(total_chars);
        let start = char_indices[start_char];
        let end = char_indices[end_char];
        let chunk = &content[start..end];
        let score = score_chunk(chunk, &query_terms);
        best_chunks.push((score, start, end));

        if end_char == total_chars {
            break;
        }
        start_char = end_char.saturating_sub(overlap);
    }

    best_chunks.sort_by(|a, b| b.0.cmp(&a.0));
    let mut selected = String::new();

    for (score, start, end) in best_chunks {
        if score == 0 && !selected.is_empty() {
            break;
        }
        let chunk = &content[start..end];
        let selected_chars = selected.chars().count();
        let chunk_chars = chunk.chars().count();
        if selected_chars + chunk_chars + 12 > max_chars {
            break;
        }
        if !selected.is_empty() {
            selected.push_str("\n\n[...]\n\n");
        }
        selected.push_str(chunk);
        if selected.chars().count() >= max_chars {
            break;
        }
    }

    if selected.is_empty() {
        content.chars().take(max_chars).collect()
    } else {
        selected
    }
}

fn estimate_context_chars(context_window_tokens: Option<usize>) -> usize {
    let tokens = context_window_tokens.unwrap_or(DEFAULT_MAX_TOKENS);
    tokens.saturating_mul(4)
}

fn extract_query_terms(query: &str) -> Vec<String> {
    let stop_words = [
        "the",
        "and",
        "or",
        "of",
        "to",
        "in",
        "a",
        "an",
        "is",
        "are",
        "was",
        "were",
        "what",
        "how",
        "why",
        "when",
        "where",
        "which",
        "who",
        "summarize",
        "summary",
        "chapter",
        "page",
        "book",
        "document",
        "this",
        "that",
    ];

    let mut terms: Vec<String> = query
        .to_lowercase()
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|term| term.len() >= 4)
        .filter(|term| !stop_words.contains(term))
        .map(|term| term.to_string())
        .collect();

    let chars: Vec<(usize, char)> = query.char_indices().collect();
    let mut index = 0;
    while index < chars.len() {
        if !chars[index].1.is_ascii_digit() {
            index += 1;
            continue;
        }

        let start = chars[index].0;
        let mut end = query.len();
        let mut cursor = index;
        while cursor < chars.len() && (chars[cursor].1.is_ascii_digit() || chars[cursor].1 == '.') {
            cursor += 1;
        }
        if cursor < chars.len() {
            end = chars[cursor].0;
        }

        let candidate = query[start..end].trim();
        if candidate.contains('.') && candidate.len() >= 3 {
            terms.push(candidate.to_lowercase());
        }
        index = cursor;
    }

    terms.sort();
    terms.dedup();
    terms
}

fn score_chunk(chunk: &str, terms: &[String]) -> usize {
    let chunk_lower = chunk.to_lowercase();
    terms
        .iter()
        .map(|term| chunk_lower.matches(term).count())
        .sum()
}

// Types for Tauri commands

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LLMMessage {
    pub role: String,
    pub content: LLMMessageContent,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum LLMMessageContent {
    Text(String),
    Parts(Vec<LLMMessageContentPart>),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
pub enum LLMMessageContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl {
        #[serde(rename = "imageUrl", alias = "image_url")]
        image_url: String,
    },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LLMResponse {
    pub content: String,
    pub usage: Option<LLMUsage>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LLMUsage {
    pub prompt_tokens: usize,
    pub completion_tokens: usize,
    pub total_tokens: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_cache_hit_tokens: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_cache_miss_tokens: Option<usize>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LLMContextRequest {
    #[serde(rename = "type")]
    pub r#type: String,
    pub document_id: Option<String>,
    pub url: Option<String>,
    pub selection: Option<String>,
    pub content: Option<String>,
    pub context_window_tokens: Option<usize>,
    pub memory_enabled: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_price(actual: Option<f64>, expected: f64) {
        let actual = actual.unwrap_or_else(|| panic!("expected price {expected}, got None"));
        assert!(
            (actual - expected).abs() < 1e-12,
            "expected price {expected}, got {actual}"
        );
    }

    #[test]
    fn openrouter_pricing_is_normalized_to_per_1k() {
        let payload: serde_json::Value = serde_json::from_str(
            r#"{
              "data": [
                {
                  "id": "anthropic/claude-3.5-sonnet",
                  "name": "Claude 3.5 Sonnet",
                  "context_length": 200000,
                  "pricing": {
                    "prompt": "0.000003",
                    "completion": "0.000015",
                    "input_cache_read": "0.0000003",
                    "input_cache_write": "0.00000375",
                    "request": "0.0000001",
                    "image": "0.01",
                    "web_search": "0.000002"
                  }
                },
                {
                  "id": "free-model",
                  "pricing": { "prompt": "0", "completion": 0 }
                },
                {
                  "id": "unpriced-model",
                  "pricing": { "prompt": "-1", "completion": "abc", "web_search": null }
                },
                {
                  "id": "no-pricing"
                },
                {
                  "id": "legacy-keys",
                  "pricing": { "cache_read": "0.000001", "cache_write": "0.000002" }
                }
              ]
            }"#,
        )
        .unwrap();

        let data = payload.get("data").and_then(|v| v.as_array()).unwrap();
        let pricing_of = |id: &str| {
            data.iter()
                .find(|e| e.get("id").and_then(|v| v.as_str()) == Some(id))
                .and_then(|e| e.get("pricing"))
                .and_then(|v| v.as_object())
                .map(map_openrouter_pricing)
        };

        // String prices on per-token fields are scaled ×1000; per-call fields
        // (request/image/web_search) are passed through unscaled.
        let sonnet = pricing_of("anthropic/claude-3.5-sonnet").expect("sonnet pricing");
        assert_price(sonnet.prompt, 0.003);
        assert_price(sonnet.completion, 0.015);
        assert_price(sonnet.cache_read, 0.0003);
        assert_price(sonnet.cache_write, 0.00375);
        assert_price(sonnet.request, 0.0000001);
        assert_price(sonnet.image, 0.01);
        assert_price(sonnet.web_search, 0.000002);

        // "0" (string or number) means genuinely free.
        let free = pricing_of("free-model").expect("free-model pricing");
        assert_eq!(free.prompt, Some(0.0));
        assert_eq!(free.completion, Some(0.0));

        // Negative sentinel, unparseable strings and null all mean unknown.
        let unpriced = pricing_of("unpriced-model").expect("unpriced-model pricing");
        assert_eq!(unpriced.prompt, None);
        assert_eq!(unpriced.completion, None);
        assert_eq!(unpriced.web_search, None);

        // Missing pricing object → None rather than a zero default.
        assert!(pricing_of("no-pricing").is_none());

        // Legacy cache keys still work as a fallback if OpenRouter renames.
        let legacy = pricing_of("legacy-keys").expect("legacy-keys pricing");
        assert_price(legacy.cache_read, 0.001);
        assert_price(legacy.cache_write, 0.002);
    }
}
