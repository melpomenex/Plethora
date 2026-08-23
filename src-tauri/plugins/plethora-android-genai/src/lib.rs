//! Tauri plugin for on-device generative AI on Android.
//!
//! Bridges ML Kit GenAI (Gemini Nano through the system AICore service) and
//! the EmbeddingGemma embedding backend to the frontend:
//!
//!   - `ondevice_ai_status`    — capability check, never runs inference
//!   - `ondevice_ai_capabilities` — independent feature states and metadata
//!   - `ondevice_ai_summarize` — summarize one chunk of text
//!   - `ondevice_ai_prompt`    — free-form completion
//!   - `ondevice_ai_download`  — user-initiated model download
//!   - `ondevice_ai_ocr_labels` — ML Kit OCR with percent boxes (design D18)
//!   - `ondevice_ai_embed_status` — embedding model state (design D10)
//!   - `ondevice_ai_embed_download` — user-initiated embedding artifact
//!     download (sha256-verified, progress via channel + listener event)
//!   - `ondevice_ai_embed_texts` — batch embedding with EmbeddingGemma
//!
//! The Rust side is a thin shim: it registers the Kotlin plugin and forwards
//! through `PluginHandle::run_mobile_plugin`. All inference, client lifetime,
//! and error classification live in `android/.../AndroidGenAiPlugin.kt`.
//! The semantic index's Rust worker also calls the embedding command
//! directly through [`embed_texts_via_app`] without an IPC hop.
//!
//! On every non-Android target the status commands report `unavailable` with
//! reason `platform_unsupported` and the inference commands return a typed
//! error. Nothing here pulls in an Android or JNI dependency, so desktop builds
//! compile and behave exactly as before.
//!
//! The plugin targets the concrete `tauri::Wry` runtime (the only runtime the
//! Plethora app uses), matching `plethora-android-tts` and
//! `plethora-folder-import`.

use serde::{de::DeserializeOwned, Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
use tauri::{
    plugin::{PluginApi, TauriPlugin},
    AppHandle, Manager, State, Wry,
};

// ──────────────────────────────────────────────────────────────────────────
// Error codes. These strings are the contract shared by the Kotlin plugin
// (`invoke.reject(message, code)`), this crate, and `src/lib/ai/onDeviceAI.ts`.
// ──────────────────────────────────────────────────────────────────────────

/// Reported off Android — desktop, iOS, and the browser build.
pub const PLATFORM_UNSUPPORTED: &str = "platform_unsupported";
/// The native call failed in a way the Kotlin side could not classify.
pub const INFERENCE_FAILED: &str = "inference_failed";
/// On-device embedding model identity, shared with the Kotlin plugin and the
/// semantic index's `ON_DEVICE_MODEL` (embedding-version input).
pub const EMBEDDING_MODEL: &str = "embeddinggemma-300m";

/// Error surfaced to the frontend over IPC.
///
/// Serializes as `{ code, message }` so callers can branch on a stable code
/// instead of matching on prose.
#[derive(Debug, Clone, Serialize)]
pub struct Error {
    pub code: String,
    pub message: String,
}

impl Error {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into() }
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for Error {}

/// Error for the two inference commands on a platform with no bridge.
fn not_android() -> Error {
    Error::new(
        PLATFORM_UNSUPPORTED,
        "On-device AI is only available in the Android build; \
         configure a cloud provider instead.",
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Shared request / response types
// ──────────────────────────────────────────────────────────────────────────

/// Result of the capability check.
///
/// `status` is one of `available`, `downloadable`, `downloading`,
/// `unavailable`. `reason` is a machine-readable code, present whenever the
/// status is not `available`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenAiStatus {
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Independently routable state for one native feature.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeatureState {
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl FeatureState {
    fn unavailable(reason: &str) -> Self {
        Self { status: "unavailable".into(), reason: Some(reason.into()) }
    }
}

/// Typed native capability snapshot. Field names serialize in the camelCase
/// shape used by Kotlin and TypeScript.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnDeviceCapabilitySnapshot {
    pub prompt: FeatureState,
    pub summarization: FeatureState,
    pub image_prompt: FeatureState,
    /// Optional Image Description specialized API. Independent of Prompt.
    /// Older plugin builds omit this field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_description: Option<FeatureState>,
    pub structured_output_compiled: bool,
    pub structured_output: bool,
    pub system_instructions: bool,
    pub prefix_caching: bool,
    pub image_input: bool,
    pub multi_image: bool,
    pub streaming: bool,
    /// ML Kit Text Recognition (bundled) compiled in — on-device OCR for the
    /// image-occlusion flow (design D18). Absent/older snapshots default false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub ocr: bool,
    /// EmbeddingGemma embeddings usable right now (design D10 / task 4.5):
    /// the LiteRT feature is compiled in and the downloaded, size-verified
    /// artifacts exist. Absent/older snapshots default false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub embeddings: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_model_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_limit: Option<u32>,
    pub checked_at: u64,
}

impl OnDeviceCapabilitySnapshot {
    fn unavailable(reason: &str) -> Self {
        let unsupported = FeatureState::unavailable(reason);
        Self {
            prompt: unsupported.clone(),
            summarization: unsupported.clone(),
            image_prompt: unsupported.clone(),
            image_description: Some(unsupported),
            structured_output_compiled: false,
            structured_output: false,
            system_instructions: false,
            prefix_caching: false,
            image_input: false,
            multi_image: false,
            streaming: false,
            ocr: false,
            embeddings: false,
            base_model_name: None,
            token_limit: None,
            checked_at: 0,
        }
    }

    fn platform_unsupported() -> Self {
        Self::unavailable(PLATFORM_UNSUPPORTED)
    }
}

/// Adapter requested by an explicit model download action.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OnDeviceFeature {
    #[default]
    All,
    Prompt,
    Summarization,
    ImagePrompt,
    ImageDescription,
}

impl OnDeviceFeature {
    #[allow(dead_code)]
    fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Prompt => "prompt",
            Self::Summarization => "summarization",
            Self::ImagePrompt => "image-prompt",
            Self::ImageDescription => "image-description",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelDownloadRequest {
    #[serde(default)]
    pub feature: OnDeviceFeature,
}

impl GenAiStatus {
    fn unavailable(reason: &str) -> Self {
        Self { status: "unavailable".into(), reason: Some(reason.into()) }
    }
}

/// Requested summary shape. `Bullets` uses ML Kit's Summarization API;
/// `Paragraph` goes through the Prompt API, because `SummarizerOptions`
/// offers only bullet output types.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SummaryFormat {
    Paragraph,
    Bullets,
}

impl SummaryFormat {
    /// Only reached on Android (and in tests); desktop never builds a payload.
    #[allow(dead_code)]
    fn as_str(self) -> &'static str {
        match self {
            SummaryFormat::Paragraph => "paragraph",
            SummaryFormat::Bullets => "bullets",
        }
    }
}

/// Payload for `ondevice_ai_summarize`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummarizeRequest {
    pub text: String,
    pub format: SummaryFormat,
}

/// Payload for `ondevice_ai_prompt`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptRequest {
    pub prompt: String,
}

/// Image placeholder carried by the generic Prompt envelope. Native decoding
/// and bounds are implemented by the image-support tasks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptImagePayload {
    pub mime_type: String,
    pub data: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PromptOutputMode {
    #[default]
    Text,
    Flashcards,
    Tags,
    Occlusions,
    /// Schema-constrained generation via the KSP genai-schema-compiler path;
    /// requires `response_schema` to name a compiled envelope. Without the
    /// compiled/runtime feature, Kotlin degrades to the text path and leaves
    /// `structured` null (TypeScript strict-JSON fallback, design D5).
    Structured,
}

/// Configurable Prompt request shared by generation, counting, and streaming.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePromptRequest {
    pub request_id: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_prefix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<PromptImagePayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_count: Option<u8>,
    #[serde(default)]
    pub output_mode: PromptOutputMode,
    /// Structured-output envelope key (e.g. "learningMaterialProposal").
    /// Validated against the compiled Kotlin schema registry; forwarded
    /// opaquely here so keys can be added without a Rust change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_schema: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_instruction: Option<String>,
    #[serde(default)]
    pub stream: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptCandidate {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePromptResponse {
    pub request_id: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
    pub input_tokens: u32,
    pub token_limit: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_model_name: Option<String>,
    #[serde(default)]
    pub candidates: Vec<PromptCandidate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structured: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTokenCount {
    pub request_id: String,
    pub input_tokens: u32,
    pub token_limit: u32,
    pub requested_output_tokens: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptStartReceipt {
    pub request_id: String,
    pub queued: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelPromptRequest {
    pub request_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptCancelReceipt {
    pub request_id: String,
    pub cancelled: bool,
}

/// Both inference commands resolve to a single generated string.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenAiText {
    pub text: String,
}

// ──────────────────────────────────────────────────────────────────────────
// On-device OCR (ML Kit Text Recognition, design D18 / task 3.2)
// ──────────────────────────────────────────────────────────────────────────

/// Request for `ondevice_ai_ocr_labels`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrLabelsRequest {
    /// Base64-encoded image bytes (no data-url prefix).
    pub base64_image: String,
    /// Optional cap on returned labels; Kotlin clamps into 1..64.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_results: Option<u32>,
}

/// One OCR text label with its box normalized to percent 0–100.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrLabel {
    pub id: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Raw pixel box [left, top, right, bottom] for diagnostics.
    #[serde(default)]
    pub pixel_box: Vec<i32>,
}

/// Result of `ondevice_ai_ocr_labels`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrLabelsResult {
    #[serde(default)]
    pub labels: Vec<OcrLabel>,
    /// Source bitmap dimensions the percents were normalized against.
    pub source_width: u32,
    pub source_height: u32,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DescribeImageRequest {
    pub base64_image: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DescribeImageResult {
    pub text: String,
}

// ──────────────────────────────────────────────────────────────────────────
// On-device embeddings (EmbeddingGemma via LiteRT, design D10 / task 4.5)
// ──────────────────────────────────────────────────────────────────────────

/// Which prompt template the native side applies before tokenizing.
///
/// Documents (indexing) use the `title: none | text:` prefix; queries
/// (retrieval) use `task: search result | query:`. Defaults to document so a
/// legacy caller omitting the field gets the indexing behavior.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EmbeddingKind {
    #[default]
    Document,
    Query,
}

impl EmbeddingKind {
    /// Only reached on Android (and in tests); desktop never builds a payload.
    #[allow(dead_code)]
    fn as_str(self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::Query => "query",
        }
    }
}

/// Request for `ondevice_ai_embed_texts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedTextsRequest {
    pub texts: Vec<String>,
    /// L2-normalize each vector (default true; the semantic index stores
    /// unit vectors and computes plain dot products).
    #[serde(default = "default_true")]
    pub normalize: bool,
    /// Document vs query prompt template (default document).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<EmbeddingKind>,
}

fn default_true() -> bool {
    true
}

/// Result of `ondevice_ai_embed_texts`: one vector per input text, in order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedTextsResult {
    pub vectors: Vec<Vec<f32>>,
    pub dimension: u32,
    pub model: String,
}

/// Status of the on-device embedding model, mirroring the Kotlin
/// `embedTextsStatus` payload. Never an `Err`: unavailable-with-reason is a
/// state, not a failure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingStatus {
    /// available | downloadable | downloading | unavailable
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dimension: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes_downloaded: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    pub checked_at: u64,
}

impl EmbeddingStatus {
    fn unavailable(reason: &str) -> Self {
        Self {
            status: "unavailable".into(),
            reason: Some(reason.into()),
            model: crate::EMBEDDING_MODEL.into(),
            dimension: None,
            bytes_downloaded: None,
            total_bytes: None,
            checked_at: 0,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Mobile registration
// ──────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.plethora.androidgenai";

/// Managed plugin state. Holds the native plugin handle on Android; a
/// zero-sized placeholder everywhere else.
#[allow(dead_code)]
#[derive(Clone)]
pub struct AndroidGenAi {
    #[cfg(target_os = "android")]
    handle: PluginHandle<Wry>,
}

impl AndroidGenAi {
    /// Rust-side entry for the semantic-index worker (task 4.5): embed a
    /// batch of texts without an IPC round trip through the frontend. This is
    /// the same Kotlin `embedTexts` command the IPC shim forwards to; the
    /// indexer calls it directly through the managed state.
    ///
    /// Errors carry the shared plugin error codes (`model_downloadable`,
    /// `model_downloading`, `model_unavailable`, `feature_not_compiled`,
    /// `inference_failed`, ...) — callers degrade to lexical mode on any
    /// failure rather than failing indexing.
    #[cfg(target_os = "android")]
    pub fn embed_texts_direct(
        &self,
        texts: Vec<String>,
        normalize: bool,
        kind: EmbeddingKind,
    ) -> Result<EmbedTextsResult, Error> {
        let payload = serde_json::json!({
            "texts": texts,
            "normalize": normalize,
            "kind": kind.as_str(),
        });
        self.handle
            .run_mobile_plugin::<EmbedTextsResult>("embedTexts", payload)
            .map_err(map_invoke_error)
    }
}

/// Resolve the managed plugin state from an app handle and embed directly
/// (Android only). Returns `Err(platform_unsupported)` off Android so the
/// semantic index's on-device backend can degrade to lexical-only mode.
pub fn embed_texts_via_app(
    app: &AppHandle<Wry>,
    texts: Vec<String>,
    normalize: bool,
    kind: EmbeddingKind,
) -> Result<EmbedTextsResult, Error> {
    #[cfg(target_os = "android")]
    {
        let state: State<'_, AndroidGenAi> = app.state();
        state.embed_texts_direct(texts, normalize, kind)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, texts, normalize, kind);
        Err(not_android())
    }
}

#[allow(unused_variables)]
fn init_mobile<C: DeserializeOwned>(
    app: &AppHandle<Wry>,
    api: PluginApi<Wry, C>,
) -> Result<AndroidGenAi, Error> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        let handle = api
            .register_android_plugin(PLUGIN_IDENTIFIER, "AndroidGenAiPlugin")
            .map_err(|e| Error::new(INFERENCE_FAILED, e.to_string()))?;
        return Ok(AndroidGenAi { handle });
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, api);
        Ok(AndroidGenAi {})
    }
}

/// Turn a `run_mobile_plugin` failure into a typed error, preserving the code
/// the Kotlin side passed to `invoke.reject(message, code)`.
#[cfg(target_os = "android")]
fn map_invoke_error(e: tauri::plugin::mobile::PluginInvokeError) -> Error {
    use tauri::plugin::mobile::PluginInvokeError;
    match e {
        PluginInvokeError::InvokeRejected(response) => Error::new(
            response.code.as_deref().unwrap_or(INFERENCE_FAILED),
            response.message.unwrap_or_else(|| "on-device inference failed".into()),
        ),
        other => Error::new(INFERENCE_FAILED, other.to_string()),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// IPC commands. Each forwards to the Kotlin plugin on Android and degrades to
// a "no on-device AI here" answer elsewhere. They live in their own module so
// `generate_handler!` can reference them via a qualified path.
// ──────────────────────────────────────────────────────────────────────────

mod commands {
    use super::*;

    /// Report on-device GenAI status. Never runs inference, never starts a
    /// download, and never returns `Err` — an unreachable bridge is a status,
    /// not a failure.
    #[tauri::command]
    pub async fn ondevice_ai_status(state: State<'_, AndroidGenAi>) -> Result<GenAiStatus, Error> {
        #[cfg(target_os = "android")]
        {
            match state
                .handle
                .run_mobile_plugin::<GenAiStatus>("checkStatus", serde_json::json!({}))
            {
                Ok(status) => Ok(status),
                // The Kotlin side already swallows its own failures; anything
                // arriving here is a broken bridge, which is still just
                // "no on-device AI right now" to the caller.
                Err(e) => {
                    log_bridge_failure(&e);
                    Ok(GenAiStatus::unavailable(INFERENCE_FAILED))
                }
            }
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = state;
            Ok(GenAiStatus::unavailable(PLATFORM_UNSUPPORTED))
        }
    }

    /// Return independent Prompt, Summarization, and image-Prompt states plus
    /// optional Prompt runtime features. A failed native bridge becomes a fully
    /// unavailable snapshot rather than a rejected status call.
    #[tauri::command]
    pub async fn ondevice_ai_capabilities(
        state: State<'_, AndroidGenAi>,
    ) -> Result<OnDeviceCapabilitySnapshot, Error> {
        #[cfg(target_os = "android")]
        {
            match state.handle.run_mobile_plugin::<OnDeviceCapabilitySnapshot>(
                "getCapabilities",
                serde_json::json!({}),
            ) {
                Ok(snapshot) => Ok(snapshot),
                Err(e) => {
                    log_bridge_failure(&e);
                    Ok(OnDeviceCapabilitySnapshot::unavailable(INFERENCE_FAILED))
                }
            }
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = state;
            Ok(OnDeviceCapabilitySnapshot::platform_unsupported())
        }
    }

    /// Summarize one chunk of text. The caller is responsible for keeping the
    /// input inside the model's context budget.
    #[tauri::command]
    pub async fn ondevice_ai_summarize(
        state: State<'_, AndroidGenAi>,
        request: SummarizeRequest,
    ) -> Result<String, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = serde_json::json!({
                "text": request.text,
                "format": request.format.as_str(),
            });
            let res = state
                .handle
                .run_mobile_plugin::<GenAiText>("summarizeText", payload)
                .map_err(map_invoke_error)?;
            Ok(res.text)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    /// Execute one configured non-streaming request with native preflight token
    /// measurement and finish metadata.
    #[tauri::command]
    pub async fn ondevice_ai_generate(
        state: State<'_, AndroidGenAi>,
        request: NativePromptRequest,
    ) -> Result<NativePromptResponse, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = serde_json::to_value(request)
                .map_err(|e| Error::new(INFERENCE_FAILED, e.to_string()))?;
            state
                .handle
                .run_mobile_plugin::<NativePromptResponse>("generateConfiguredPrompt", payload)
                .map_err(map_invoke_error)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    /// Count the complete native request without performing inference.
    #[tauri::command]
    pub async fn ondevice_ai_count_tokens(
        state: State<'_, AndroidGenAi>,
        request: NativePromptRequest,
    ) -> Result<PromptTokenCount, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = serde_json::to_value(request)
                .map_err(|e| Error::new(INFERENCE_FAILED, e.to_string()))?;
            state
                .handle
                .run_mobile_plugin::<PromptTokenCount>("countPromptTokens", payload)
                .map_err(map_invoke_error)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    /// Warm Prompt in the foreground without producing output.
    #[tauri::command]
    pub async fn ondevice_ai_warm_up(state: State<'_, AndroidGenAi>) -> Result<(), Error> {
        #[cfg(target_os = "android")]
        {
            state
                .handle
                .run_mobile_plugin::<()>("warmUpPrompt", serde_json::json!({}))
                .map_err(map_invoke_error)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = state;
            Err(not_android())
        }
    }

    /// Run a free-form prompt and return the completion.
    #[tauri::command]
    pub async fn ondevice_ai_prompt(
        state: State<'_, AndroidGenAi>,
        request: PromptRequest,
    ) -> Result<String, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = serde_json::json!({ "prompt": request.prompt });
            let res = state
                .handle
                .run_mobile_plugin::<GenAiText>("generatePrompt", payload)
                .map_err(map_invoke_error)?;
            Ok(res.text)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    /// Download the on-device model. Only called from an explicit user action;
    /// the capability check never triggers it.
    #[tauri::command]
    pub async fn ondevice_ai_download(
        state: State<'_, AndroidGenAi>,
        request: Option<ModelDownloadRequest>,
    ) -> Result<(), Error> {
        #[cfg(target_os = "android")]
        {
            let feature = request.unwrap_or_default().feature.as_str();
            state
                .handle
                .run_mobile_plugin::<()>(
                    "downloadModel",
                    serde_json::json!({ "feature": feature }),
                )
                .map_err(map_invoke_error)?;
            Ok(())
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    /// Enqueue one request-scoped streaming Prompt request.
    #[tauri::command]
    pub async fn ondevice_ai_start_prompt_stream(
        state: State<'_, AndroidGenAi>,
        request: NativePromptRequest,
        on_event: tauri::ipc::Channel<serde_json::Value>,
    ) -> Result<PromptStartReceipt, Error> {
        #[cfg(target_os = "android")]
        {
            let mut payload = serde_json::to_value(&request)
                .map_err(|e| Error::new(INFERENCE_FAILED, e.to_string()))?;
            if let serde_json::Value::Object(ref mut map) = payload {
                map.insert("onEvent".to_string(), serde_json::to_value(&on_event).unwrap_or(serde_json::Value::Null));
            }
            state
                .handle
                .run_mobile_plugin::<PromptStartReceipt>("startPromptStream", payload)
                .map_err(map_invoke_error)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request, on_event);
            Err(not_android())
        }
    }

    /// Cancel queued work or active ML Kit future for a prompt request.
    #[tauri::command]
    pub async fn ondevice_ai_cancel_prompt_request(
        state: State<'_, AndroidGenAi>,
        request: CancelPromptRequest,
    ) -> Result<PromptCancelReceipt, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = serde_json::to_value(request)
                .map_err(|e| Error::new(INFERENCE_FAILED, e.to_string()))?;
            state
                .handle
                .run_mobile_plugin::<PromptCancelReceipt>("cancelPromptRequest", payload)
                .map_err(map_invoke_error)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = state;
            Ok(PromptCancelReceipt {
                request_id: request.request_id,
                cancelled: false,
            })
        }
    }

    /// Alias for ondevice_ai_cancel_prompt_request.
    #[tauri::command]
    pub async fn ondevice_ai_cancel(
        state: State<'_, AndroidGenAi>,
        request: CancelPromptRequest,
    ) -> Result<PromptCancelReceipt, Error> {
        ondevice_ai_cancel_prompt_request(state, request).await
    }

    /// Run deterministic on-device OCR (ML Kit Text Recognition) over one
    /// base64 image and return text labels with percent-normalized boxes
    /// (design D18). Non-Android targets get a typed error so the caller can
    /// fall back to the Rust OCR provider chain.
    #[tauri::command]
    pub async fn ondevice_ai_ocr_labels(
        state: State<'_, AndroidGenAi>,
        request: OcrLabelsRequest,
    ) -> Result<OcrLabelsResult, Error> {
        #[cfg(target_os = "android")]
        {
            let mut payload = serde_json::json!({ "base64Image": request.base64_image });
            if let Some(max_results) = request.max_results {
                payload["maxResults"] = serde_json::json!(max_results);
            }
            state
                .handle
                .run_mobile_plugin::<OcrLabelsResult>("ocrImageLabels", payload)
                .map_err(map_invoke_error)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    /// Short English alt text via ML Kit Image Description. Not used for study cards.
    #[tauri::command]
    pub async fn ondevice_ai_describe_image(
        state: State<'_, AndroidGenAi>,
        request: DescribeImageRequest,
    ) -> Result<DescribeImageResult, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = serde_json::json!({ "base64Image": request.base64_image });
            state
                .handle
                .run_mobile_plugin::<DescribeImageResult>("describeImage", payload)
                .map_err(map_invoke_error)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    /// Report the on-device embedding model state (design D10 / task 4.5).
    /// Never starts a download and never returns `Err` — an unreachable
    /// bridge is an `unavailable` status with a reason, like
    /// `ondevice_ai_status`.
    #[tauri::command]
    pub async fn ondevice_ai_embed_status(
        state: State<'_, AndroidGenAi>,
    ) -> Result<EmbeddingStatus, Error> {
        #[cfg(target_os = "android")]
        {
            match state
                .handle
                .run_mobile_plugin::<EmbeddingStatus>("embedTextsStatus", serde_json::json!({}))
            {
                Ok(status) => Ok(status),
                Err(e) => {
                    log_bridge_failure(&e);
                    Ok(EmbeddingStatus::unavailable(INFERENCE_FAILED))
                }
            }
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = state;
            Ok(EmbeddingStatus::unavailable(PLATFORM_UNSUPPORTED))
        }
    }

    /// Download + sha256-verify the embedding artifacts. Only called from an
    /// explicit user action — a ~184 MB download is never auto-triggered.
    /// Progress is streamed on the `on_event` channel and mirrored on the
    /// `ondevice-genai://embed-download-progress` listener event; the command
    /// resolves with the final status once both artifacts are verified.
    #[tauri::command]
    pub async fn ondevice_ai_embed_download(
        state: State<'_, AndroidGenAi>,
        on_event: tauri::ipc::Channel<serde_json::Value>,
    ) -> Result<EmbeddingStatus, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = serde_json::json!({
                "onEvent": serde_json::to_value(&on_event).unwrap_or(serde_json::Value::Null)
            });
            state
                .handle
                .run_mobile_plugin::<EmbeddingStatus>("embedTextsDownload", payload)
                .map_err(map_invoke_error)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, on_event);
            Err(not_android())
        }
    }

    /// Embed a batch of texts with EmbeddingGemma. Non-Android targets get a
    /// typed `platform_unsupported` error so the semantic index falls back to
    /// the configured provider or lexical-only mode.
    #[tauri::command]
    pub async fn ondevice_ai_embed_texts(
        state: State<'_, AndroidGenAi>,
        request: EmbedTextsRequest,
    ) -> Result<EmbedTextsResult, Error> {
        #[cfg(target_os = "android")]
        {
            let payload = serde_json::json!({
                "texts": request.texts,
                "normalize": request.normalize,
                "kind": request.kind.unwrap_or_default().as_str(),
            });
            state
                .handle
                .run_mobile_plugin::<EmbedTextsResult>("embedTexts", payload)
                .map_err(map_invoke_error)
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (state, request);
            Err(not_android())
        }
    }

    #[cfg(target_os = "android")]
    fn log_bridge_failure(e: &tauri::plugin::mobile::PluginInvokeError) {
        eprintln!("[android-genai] status bridge call failed: {e}");
    }
}

pub use commands::{
    ondevice_ai_cancel, ondevice_ai_cancel_prompt_request, ondevice_ai_capabilities,
    ondevice_ai_count_tokens, ondevice_ai_download, ondevice_ai_embed_download,
    ondevice_ai_embed_status, ondevice_ai_describe_image, ondevice_ai_embed_texts, ondevice_ai_generate, ondevice_ai_ocr_labels,
    ondevice_ai_prompt, ondevice_ai_start_prompt_stream, ondevice_ai_status,
    ondevice_ai_summarize, ondevice_ai_warm_up,
};

/// Initializes the plugin.
pub fn init() -> TauriPlugin<Wry> {
    // NOTE: the builder name MUST match the crate name (`plethora-android-genai`),
    // because tauri-plugin's ACL manifest codegen keys the plugin's permissions
    // under the crate name. A mismatch makes every command fail with
    // "not allowed by ACL" even when the capability grants it.
    tauri::plugin::Builder::<Wry>::new("plethora-android-genai")
        .invoke_handler(tauri::generate_handler![
            commands::ondevice_ai_status,
            commands::ondevice_ai_capabilities,
            commands::ondevice_ai_generate,
            commands::ondevice_ai_count_tokens,
            commands::ondevice_ai_warm_up,
            commands::ondevice_ai_summarize,
            commands::ondevice_ai_prompt,
            commands::ondevice_ai_download,
            commands::ondevice_ai_start_prompt_stream,
            commands::ondevice_ai_cancel_prompt_request,
            commands::ondevice_ai_cancel,
            commands::ondevice_ai_ocr_labels,
            commands::ondevice_ai_describe_image,
            commands::ondevice_ai_embed_status,
            commands::ondevice_ai_embed_download,
            commands::ondevice_ai_embed_texts
        ])
        .setup(|app, api| {
            let genai = init_mobile(app.app_handle(), api)?;
            app.manage(genai);
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_serializes_with_code_and_message() {
        let json = serde_json::to_string(&not_android()).expect("serialize");
        assert!(json.contains(PLATFORM_UNSUPPORTED), "code missing: {json}");
        assert!(json.contains("Android"), "message missing: {json}");
    }

    #[test]
    fn status_omits_reason_when_available() {
        let status = GenAiStatus { status: "available".into(), reason: None };
        let json = serde_json::to_string(&status).expect("serialize");
        assert_eq!(json, r#"{"status":"available"}"#);
    }

    #[test]
    fn unavailable_status_carries_reason() {
        let json = serde_json::to_string(&GenAiStatus::unavailable(PLATFORM_UNSUPPORTED))
            .expect("serialize");
        assert!(json.contains(PLATFORM_UNSUPPORTED), "reason missing: {json}");
    }

    #[test]
    fn non_android_capabilities_are_feature_scoped_and_unsupported() {
        let snapshot = OnDeviceCapabilitySnapshot::platform_unsupported();
        assert_eq!(snapshot.prompt.reason.as_deref(), Some(PLATFORM_UNSUPPORTED));
        assert_eq!(snapshot.summarization.reason.as_deref(), Some(PLATFORM_UNSUPPORTED));
        assert_eq!(snapshot.image_prompt.reason.as_deref(), Some(PLATFORM_UNSUPPORTED));
        assert!(!snapshot.structured_output);
        assert!(!snapshot.streaming);
    }

    #[test]
    fn partial_capability_snapshot_serializes_camel_case() {
        let snapshot = OnDeviceCapabilitySnapshot {
            prompt: FeatureState { status: "available".into(), reason: None },
            summarization: FeatureState::unavailable("model_unavailable"),
            image_prompt: FeatureState { status: "available".into(), reason: None },
            image_description: Some(FeatureState { status: "available".into(), reason: None }),
            structured_output_compiled: true,
            structured_output: false,
            system_instructions: true,
            prefix_caching: false,
            image_input: true,
            multi_image: true,
            streaming: true,
            ocr: true,
            embeddings: true,
            base_model_name: Some("gemini-nano".into()),
            token_limit: Some(4096),
            checked_at: 42,
        };
        let json = serde_json::to_string(&snapshot).expect("serialize");
        assert!(json.contains(r#""imagePrompt":{"status":"available"}"#));
        assert!(json.contains(r#""structuredOutputCompiled":true"#));
        assert!(json.contains(r#""ocr":true"#));
        assert!(json.contains(r#""embeddings":true"#));
        assert!(json.contains(r#""baseModelName":"gemini-nano""#));
        assert!(json.contains(r#""tokenLimit":4096"#));
    }

    #[test]
    fn embeddings_flag_defaults_false_for_older_snapshots() {
        // A Kotlin plugin older than the embedding feature never sends
        // "embeddings"; deserialization must default it to false.
        let json = r#"{
            "prompt": {"status": "available"},
            "summarization": {"status": "available"},
            "imagePrompt": {"status": "available"},
            "structuredOutputCompiled": true,
            "structuredOutput": false,
            "systemInstructions": true,
            "prefixCaching": false,
            "imageInput": true,
            "multiImage": false,
            "streaming": true,
            "ocr": true,
            "checkedAt": 1
        }"#;
        let snapshot: OnDeviceCapabilitySnapshot =
            serde_json::from_str(json).expect("deserialize");
        assert!(snapshot.ocr);
        assert!(!snapshot.embeddings);
    }

    #[test]
    fn ocr_flag_defaults_false_for_older_snapshots() {
        // A Kotlin plugin older than the OCR feature never sends "ocr";
        // deserialization must default it to false rather than fail.
        let json = r#"{
            "prompt": {"status": "available"},
            "summarization": {"status": "available"},
            "imagePrompt": {"status": "available"},
            "structuredOutputCompiled": true,
            "structuredOutput": false,
            "systemInstructions": true,
            "prefixCaching": false,
            "imageInput": true,
            "multiImage": false,
            "streaming": true,
            "checkedAt": 1
        }"#;
        let snapshot: OnDeviceCapabilitySnapshot =
            serde_json::from_str(json).expect("deserialize");
        assert!(!snapshot.ocr);
    }

    #[test]
    fn ocr_labels_result_round_trips_camel_case() {
        let result = OcrLabelsResult {
            labels: vec![OcrLabel {
                id: "ocr-0-abc".into(),
                text: "Mitochondria".into(),
                confidence: Some(0.9),
                x: 10.0,
                y: 20.0,
                width: 5.0,
                height: 2.5,
                pixel_box: vec![100, 200, 150, 250],
            }],
            source_width: 1000,
            source_height: 1000,
            truncated: false,
        };
        let json = serde_json::to_string(&result).expect("serialize");
        assert!(json.contains(r#""sourceWidth":1000"#), "unexpected json: {json}");
        assert!(json.contains(r#""sourceHeight":1000"#), "unexpected json: {json}");
        // `truncated: false` is skipped to keep the payload minimal.
        assert!(!json.contains("truncated"), "unexpected json: {json}");
        let back: OcrLabelsResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.labels.len(), 1);
        assert_eq!(back.labels[0].id, "ocr-0-abc");
        assert_eq!(back.labels[0].confidence, Some(0.9));
        assert_eq!(back.source_width, 1000);
    }

    #[test]
    fn ocr_labels_request_serializes_camel_case() {
        let request = OcrLabelsRequest {
            base64_image: "aGk=".into(),
            max_results: Some(12),
        };
        let json = serde_json::to_string(&request).expect("serialize");
        assert!(json.contains(r#""base64Image":"aGk=""#), "unexpected json: {json}");
        assert!(json.contains(r#""maxResults":12"#), "unexpected json: {json}");
    }

    #[test]
    fn scoped_download_feature_serializes_for_kotlin() {
        let json = serde_json::to_string(&ModelDownloadRequest {
            feature: OnDeviceFeature::ImagePrompt,
        })
        .expect("serialize");
        assert_eq!(json, r#"{"feature":"image-prompt"}"#);
    }

    #[test]
    fn configured_prompt_request_serializes_camel_case_and_options() {
        let request = NativePromptRequest {
            request_id: "req-1".into(),
            text: "hello".into(),
            prompt_prefix: Some("context".into()),
            image: None,
            temperature: Some(0.25),
            seed: Some(7),
            max_output_tokens: Some(128),
            candidate_count: Some(2),
            output_mode: PromptOutputMode::Tags,
            response_schema: None,
            system_instruction: Some("be concise".into()),
            stream: false,
        };
        let json = serde_json::to_string(&request).expect("serialize");
        assert!(json.contains(r#""requestId":"req-1""#));
        assert!(json.contains(r#""promptPrefix":"context""#));
        assert!(json.contains(r#""maxOutputTokens":128"#));
        assert!(json.contains(r#""candidateCount":2"#));
        assert!(json.contains(r#""outputMode":"tags""#));
        assert!(json.contains(r#""systemInstruction":"be concise""#));
    }

    #[test]
    fn prompt_response_forwards_measured_tokens_and_finish_reasons() {
        let response = NativePromptResponse {
            request_id: "req-2".into(),
            text: "answer".into(),
            finish_reason: Some("max_tokens".into()),
            input_tokens: 120,
            token_limit: 4096,
            base_model_name: Some("nano-v4".into()),
            candidates: vec![PromptCandidate {
                text: "answer".into(),
                finish_reason: Some("max_tokens".into()),
            }],
            structured: None,
        };
        let json = serde_json::to_string(&response).expect("serialize");
        let round_trip: NativePromptResponse = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(round_trip.input_tokens, 120);
        assert_eq!(round_trip.token_limit, 4096);
        assert_eq!(round_trip.finish_reason.as_deref(), Some("max_tokens"));
        assert_eq!(round_trip.candidates[0].finish_reason.as_deref(), Some("max_tokens"));
    }

    #[test]
    fn summary_format_round_trips_as_lowercase() {
        let req = SummarizeRequest { text: "hi".into(), format: SummaryFormat::Bullets };
        let json = serde_json::to_string(&req).expect("serialize");
        assert!(json.contains(r#""format":"bullets""#), "unexpected json: {json}");
        let back: SummarizeRequest = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.format.as_str(), "bullets");
    }

    #[test]
    fn structured_mode_forwards_response_schema_camel_case() {
        let request = NativePromptRequest {
            request_id: "req-s".into(),
            text: "hello".into(),
            prompt_prefix: None,
            image: None,
            temperature: None,
            seed: None,
            max_output_tokens: Some(512),
            candidate_count: None,
            output_mode: PromptOutputMode::Structured,
            response_schema: Some("tutorTurn".into()),
            system_instruction: None,
            stream: false,
        };
        let json = serde_json::to_string(&request).expect("serialize");
        assert!(json.contains(r#""outputMode":"structured""#), "unexpected json: {json}");
        assert!(json.contains(r#""responseSchema":"tutorTurn""#), "unexpected json: {json}");
        let back: NativePromptRequest = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.output_mode, PromptOutputMode::Structured);
        assert_eq!(back.response_schema.as_deref(), Some("tutorTurn"));
    }

    #[test]
    fn legacy_prompt_request_still_deserializes_without_schema_fields() {
        // Exactly the payload shape the TypeScript layer sends today: no
        // responseSchema, text mode. It must keep round-tripping unchanged.
        let json = r#"{
            "requestId": "req-legacy",
            "text": "hello",
            "outputMode": "text",
            "stream": false
        }"#;
        let request: NativePromptRequest = serde_json::from_str(json).expect("deserialize");
        assert_eq!(request.output_mode, PromptOutputMode::Text);
        assert_eq!(request.response_schema, None);
        let out = serde_json::to_string(&request).expect("serialize");
        assert!(!out.contains("responseSchema"), "unexpected schema field: {out}");
        assert!(!out.contains("structured"), "unexpected mode in legacy payload: {out}");
    }

    #[test]
    fn unknown_output_mode_is_rejected_at_the_boundary() {
        let json = r#"{ "requestId": "r", "text": "t", "outputMode": "yaml" }"#;
        assert!(serde_json::from_str::<NativePromptRequest>(json).is_err());
    }

    #[test]
    fn embed_texts_request_round_trips_camel_case_with_defaults() {
        let request = EmbedTextsRequest {
            texts: vec!["chunk one".into(), "chunk two".into()],
            normalize: true,
            kind: Some(EmbeddingKind::Query),
        };
        let json = serde_json::to_string(&request).expect("serialize");
        assert!(json.contains(r#""texts":["chunk one","chunk two"]"#), "unexpected: {json}");
        assert!(json.contains(r#""kind":"query""#));
        let back: EmbedTextsRequest = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.kind, Some(EmbeddingKind::Query));
        assert!(back.normalize);
    }

    #[test]
    fn embed_texts_request_legacy_payload_defaults_normalize_and_kind() {
        // The indexer's direct path and older callers send only texts.
        let json = r#"{ "texts": ["hello"] }"#;
        let request: EmbedTextsRequest = serde_json::from_str(json).expect("deserialize");
        assert!(request.normalize, "normalize defaults to true");
        assert_eq!(request.kind, None, "kind defaults to absent (document)");
        let out = serde_json::to_string(&request).expect("serialize");
        assert!(out.contains(r#""normalize":true"#), "explicit default: {out}");
        assert!(!out.contains("kind"));
    }

    #[test]
    fn embed_texts_result_round_trips_vectors_and_model() {
        let result = EmbedTextsResult {
            vectors: vec![vec![0.5, -0.5], vec![1.0]],
            dimension: 768,
            model: EMBEDDING_MODEL.into(),
        };
        let json = serde_json::to_string(&result).expect("serialize");
        assert!(json.contains(r#""dimension":768"#));
        assert!(json.contains(r#""model":"embeddinggemma-300m""#));
        let back: EmbedTextsResult = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.vectors.len(), 2);
        assert_eq!(back.vectors[0].len(), 2);
    }

    #[test]
    fn embedding_status_carries_progress_and_reasons() {
        let downloading: EmbeddingStatus = serde_json::from_str(
            r#"{
                "status": "downloading",
                "reason": "model_downloading",
                "model": "embeddinggemma-300m",
                "bytesDownloaded": 1000,
                "totalBytes": 179132472,
                "checkedAt": 7
            }"#,
        )
        .expect("deserialize");
        assert_eq!(downloading.status, "downloading");
        assert_eq!(downloading.bytes_downloaded, Some(1000));
        assert_eq!(downloading.total_bytes, Some(179_132_472));

        let unavailable = EmbeddingStatus::unavailable(PLATFORM_UNSUPPORTED);
        assert_eq!(unavailable.status, "unavailable");
        assert_eq!(unavailable.reason.as_deref(), Some(PLATFORM_UNSUPPORTED));
        assert_eq!(unavailable.model, EMBEDDING_MODEL);
        assert_eq!(unavailable.dimension, None);
    }

    #[test]
    fn embedding_kind_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&EmbeddingKind::Document).unwrap(), r#""document""#);
        assert_eq!(serde_json::to_string(&EmbeddingKind::Query).unwrap(), r#""query""#);
        let kind: EmbeddingKind = serde_json::from_str(r#""query""#).unwrap();
        assert_eq!(kind, EmbeddingKind::Query);
    }
}
