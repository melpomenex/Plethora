//! Tauri plugin for Apple on-device intelligence.
//!
//! The Rust side is a thin shim. On iOS, work is delegated to Swift
//! (`ios/Sources/AppleIntelligencePlugin.swift`). On every other target,
//! status-style commands return a typed `platform_unsupported` snapshot or
//! `{ code, message }` error so callers fall back without linking Apple SDKs.
//!
//! Reserved command ownership (do not invent parallel RPCs):
//! - `apple_capabilities` — this crate / OpenSpec A
//! - `apple_fm_*` — B `add-apple-foundation-models-provider`
//! - `apple_speech_*` — E `add-apple-speech-transcription`
//! - `apple_vision_*` — F `add-apple-vision-document-scan`
//! - `apple_spotlight_*` — C `add-apple-spotlight-semantic-index`
//! - `apple_nl_*` — G `add-apple-naturallanguage-embeddings`
//! - `apple_coreai_*` — H `add-apple-core-ai-custom-models`
//!
//! Progress uses events (`apple-fm://…`, `apple-coreai://download`), not extra
//! status-poll commands.

use serde::{de::DeserializeOwned, Deserialize, Serialize};
#[cfg(target_os = "ios")]
use tauri::plugin::PluginHandle;
use tauri::{
    plugin::{PluginApi, TauriPlugin},
    AppHandle, Manager, State, Wry,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_plethora_apple_intelligence);

pub const PLATFORM_UNSUPPORTED: &str = "platform_unsupported";
pub const NOT_IMPLEMENTED: &str = "not_implemented";

#[derive(Debug, Clone, Serialize)]
pub struct Error {
    pub code: String,
    pub message: String,
}

impl Error {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for Error {}

fn not_apple(command: &str) -> Error {
    Error::new(
        PLATFORM_UNSUPPORTED,
        format!("{command} is only available on Apple OS builds"),
    )
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeatureState {
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl FeatureState {
    fn unavailable(reason: &str) -> Self {
        Self {
            status: "unavailable".into(),
            reason: Some(reason.into()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleIntelligenceSnapshot {
    pub apple_os: bool,
    pub foundation_models: FeatureState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub foundation_reason: Option<String>,
    pub speech: FeatureState,
    pub vision_documents: FeatureState,
    pub spotlight_semantic: FeatureState,
    pub natural_language_embeddings: FeatureState,
    pub core_ai: FeatureState,
    pub checked_at: u64,
}

impl AppleIntelligenceSnapshot {
    fn platform_unsupported() -> Self {
        let unsupported = FeatureState::unavailable(PLATFORM_UNSUPPORTED);
        Self {
            apple_os: false,
            foundation_models: unsupported.clone(),
            foundation_reason: Some(PLATFORM_UNSUPPORTED.into()),
            speech: unsupported.clone(),
            vision_documents: unsupported.clone(),
            spotlight_semantic: unsupported.clone(),
            natural_language_embeddings: unsupported.clone(),
            core_ai: unsupported,
            checked_at: 0,
        }
    }
}

struct AppleIntelligence {
    #[cfg(target_os = "ios")]
    handle: PluginHandle<Wry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleSpeechSegment {
    pub text: String,
    #[serde(default)]
    pub start_ms: i64,
    #[serde(default)]
    pub end_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleSpeechResult {
    pub text: String,
    #[serde(default)]
    pub segments: Vec<AppleSpeechSegment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleEmbedResult {
    #[serde(default)]
    pub vectors: Vec<Vec<f64>>,
    #[serde(default)]
    pub dimension: u32,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub revision: Option<String>,
}

pub fn speech_cancel_via_app(app: &AppHandle<Wry>) -> Result<serde_json::Value, Error> {
    #[cfg(target_os = "ios")]
    {
        let state: State<'_, AppleIntelligence> = app.state();
        call_mobile(state.inner(), "speechCancel", serde_json::json!({}))
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Err(not_apple("apple_speech_cancel"))
    }
}

pub fn transcribe_file_via_app(
    app: &AppHandle<Wry>,
    path: &str,
    locale: &str,
) -> Result<AppleSpeechResult, Error> {
    #[cfg(target_os = "ios")]
    {
        let state: State<'_, AppleIntelligence> = app.state();
        call_mobile(
            state.inner(),
            "speechTranscribeFile",
            serde_json::json!({ "path": path, "locale": locale }),
        )
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, path, locale);
        Err(not_apple("apple_speech_transcribe_file"))
    }
}

pub fn embed_texts_via_app(
    app: &AppHandle<Wry>,
    texts: Vec<String>,
    language: Option<String>,
) -> Result<AppleEmbedResult, Error> {
    #[cfg(target_os = "ios")]
    {
        let state: State<'_, AppleIntelligence> = app.state();
        call_mobile(
            state.inner(),
            "nlEmbedTexts",
            serde_json::json!({ "texts": texts, "language": language }),
        )
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, texts, language);
        Err(not_apple("apple_nl_embed_texts"))
    }
}

pub fn spotlight_donate_via_app(
    app: &AppHandle<Wry>,
    items: serde_json::Value,
) -> Result<serde_json::Value, Error> {
    #[cfg(target_os = "ios")]
    {
        let state: State<'_, AppleIntelligence> = app.state();
        call_mobile(state.inner(), "spotlightDonate", serde_json::json!({ "items": items }))
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, items);
        Err(not_apple("apple_spotlight_donate"))
    }
}

pub fn spotlight_delete_via_app(
    app: &AppHandle<Wry>,
    identifiers: Vec<String>,
) -> Result<serde_json::Value, Error> {
    #[cfg(target_os = "ios")]
    {
        let state: State<'_, AppleIntelligence> = app.state();
        call_mobile(
            state.inner(),
            "spotlightDelete",
            serde_json::json!({ "identifiers": identifiers }),
        )
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, identifiers);
        Err(not_apple("apple_spotlight_delete"))
    }
}

fn init_mobile<C: DeserializeOwned>(
    app: &AppHandle<Wry>,
    api: PluginApi<Wry, C>,
) -> Result<AppleIntelligence, Error> {
    #[cfg(target_os = "ios")]
    {
        let _ = app;
        let handle = api
            .register_ios_plugin(init_plugin_plethora_apple_intelligence)
            .map_err(|e| Error::new("inference_failed", e.to_string()))?;
        return Ok(AppleIntelligence { handle });
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, api);
        Ok(AppleIntelligence {})
    }
}

#[cfg(target_os = "ios")]
fn call_mobile<T: DeserializeOwned>(
    state: &AppleIntelligence,
    method: &str,
    payload: serde_json::Value,
) -> Result<T, Error> {
    state
        .handle
        .run_mobile_plugin::<T>(method, payload)
        .map_err(|e| Error::new("inference_failed", e.to_string()))
}

#[cfg(target_os = "macos")]
mod macos_bridge;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

mod commands {
    use super::*;
    #[cfg(target_os = "macos")]
    use tauri::Manager;

    #[tauri::command]
    pub async fn apple_capabilities(
        app: AppHandle<Wry>,
        state: State<'_, AppleIntelligence>,
    ) -> Result<AppleIntelligenceSnapshot, Error> {
        #[cfg(target_os = "ios")]
        {
            let _ = app;
            call_mobile(state.inner(), "capabilities", serde_json::json!({}))
        }
        #[cfg(target_os = "macos")]
        {
            let _ = state;
            macos_bridge::fm_capabilities_snapshot()
        }
        #[cfg(not(any(target_os = "ios", target_os = "macos")))]
        {
            let _ = (app, state);
            let mut snap = AppleIntelligenceSnapshot::platform_unsupported();
            snap.checked_at = now_ms();
            Ok(snap)
        }
    }

    macro_rules! fm_cmd {
        ($fn:ident, $ios_method:literal, $macos_fn:ident) => {
            #[tauri::command]
            pub async fn $fn(
                app: AppHandle<Wry>,
                state: State<'_, AppleIntelligence>,
                payload: Option<serde_json::Value>,
            ) -> Result<serde_json::Value, Error> {
                let body = payload.unwrap_or_else(|| serde_json::json!({}));
                #[cfg(target_os = "ios")]
                {
                    let _ = app;
                    call_mobile(state.inner(), $ios_method, body)
                }
                #[cfg(target_os = "macos")]
                {
                    let _ = state;
                    macos_bridge::$macos_fn(body)
                }
                #[cfg(not(any(target_os = "ios", target_os = "macos")))]
                {
                    let _ = (app, state, body);
                    Err(not_apple(stringify!($fn)))
                }
            }
        };
    }

    macro_rules! fm_stream_cmd {
        ($fn:ident, $ios_method:literal) => {
            #[tauri::command]
            pub async fn $fn(
                app: AppHandle<Wry>,
                state: State<'_, AppleIntelligence>,
                payload: Option<serde_json::Value>,
            ) -> Result<serde_json::Value, Error> {
                let body = payload.unwrap_or_else(|| serde_json::json!({}));
                #[cfg(target_os = "ios")]
                {
                    call_mobile(state.inner(), $ios_method, body)
                }
                #[cfg(target_os = "macos")]
                {
                    let _ = state;
                    macos_bridge::fm_generate_stream(app, body)
                }
                #[cfg(not(any(target_os = "ios", target_os = "macos")))]
                {
                    let _ = (app, state, body);
                    Err(not_apple(stringify!($fn)))
                }
            }
        };
    }

    fm_cmd!(apple_fm_availability, "fmAvailability", fm_availability_with_payload);
    fm_cmd!(apple_fm_generate, "fmGenerate", fm_generate);
    fm_stream_cmd!(apple_fm_generate_stream, "fmGenerateStream");
    fm_cmd!(apple_fm_cancel, "fmCancel", fm_cancel);
    fm_cmd!(apple_fm_count_tokens, "fmCountTokens", fm_count_tokens);
    fm_cmd!(apple_fm_warmup, "fmWarmup", fm_warmup_with_payload);

    macro_rules! stub_cmd {
        ($fn:ident, $method:literal) => {
            #[tauri::command]
            pub async fn $fn(
                state: State<'_, AppleIntelligence>,
                payload: Option<serde_json::Value>,
            ) -> Result<serde_json::Value, Error> {
                #[cfg(target_os = "ios")]
                {
                    call_mobile(
                        state.inner(),
                        $method,
                        payload.unwrap_or_else(|| serde_json::json!({})),
                    )
                }
                #[cfg(not(target_os = "ios"))]
                {
                    let _ = (state, payload);
                    Err(not_apple(stringify!($fn)))
                }
            }
        };
    }

    stub_cmd!(apple_speech_status, "speechStatus");
    stub_cmd!(apple_speech_ensure_assets, "speechEnsureAssets");
    stub_cmd!(apple_speech_transcribe_file, "speechTranscribeFile");
    stub_cmd!(apple_speech_start_live, "speechStartLive");
    stub_cmd!(apple_speech_stop_live, "speechStopLive");
    stub_cmd!(apple_speech_cancel, "speechCancel");
    stub_cmd!(apple_vision_status, "visionStatus");
    stub_cmd!(apple_vision_present_scanner, "visionPresentScanner");
    stub_cmd!(apple_vision_recognize_document, "visionRecognizeDocument");
    stub_cmd!(apple_vision_cancel, "visionCancel");
    stub_cmd!(apple_spotlight_status, "spotlightStatus");
    stub_cmd!(apple_spotlight_donate, "spotlightDonate");
    stub_cmd!(apple_spotlight_delete, "spotlightDelete");
    stub_cmd!(apple_spotlight_delete_domain, "spotlightDeleteDomain");
    stub_cmd!(apple_spotlight_query, "spotlightQuery");
    stub_cmd!(apple_spotlight_rebuild, "spotlightRebuild");
    stub_cmd!(apple_nl_status, "nlStatus");
    stub_cmd!(apple_nl_request_assets, "nlRequestAssets");
    stub_cmd!(apple_nl_embed_texts, "nlEmbedTexts");
    stub_cmd!(apple_coreai_status, "coreaiStatus");
    stub_cmd!(apple_coreai_catalog, "coreaiCatalog");
    stub_cmd!(apple_coreai_download_start, "coreaiDownloadStart");
    stub_cmd!(apple_coreai_download_cancel, "coreaiDownloadCancel");
    stub_cmd!(apple_coreai_install_commit, "coreaiInstallCommit");
    stub_cmd!(apple_coreai_delete, "coreaiDelete");
    stub_cmd!(apple_coreai_set_active, "coreaiSetActive");
    stub_cmd!(apple_coreai_session_start, "coreaiSessionStart");
    stub_cmd!(apple_coreai_prompt, "coreaiPrompt");
    stub_cmd!(apple_coreai_cancel, "coreaiCancel");
    stub_cmd!(apple_coreai_count_tokens, "coreaiCountTokens");
    stub_cmd!(apple_coreai_warmup, "coreaiWarmup");

    #[tauri::command]
    pub async fn apple_translate_sentence(
        app: AppHandle<Wry>,
        state: State<'_, AppleIntelligence>,
        payload: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, Error> {
        let body = payload.unwrap_or_else(|| serde_json::json!({}));
        #[cfg(target_os = "ios")]
        {
            let _ = app;
            call_mobile(state.inner(), "translateSentence", body)
        }
        #[cfg(target_os = "macos")]
        {
            let _ = state;
            macos_bridge::translate_sentence(body)
        }
        #[cfg(not(any(target_os = "ios", target_os = "macos")))]
        {
            let _ = (app, state, body);
            Err(not_apple("apple_translate_sentence"))
        }
    }
}

pub fn init() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::<Wry>::new("plethora-apple-intelligence")
        .invoke_handler(tauri::generate_handler![
            commands::apple_capabilities,
            commands::apple_fm_availability,
            commands::apple_fm_generate,
            commands::apple_fm_generate_stream,
            commands::apple_fm_cancel,
            commands::apple_fm_count_tokens,
            commands::apple_fm_warmup,
            commands::apple_speech_status,
            commands::apple_speech_ensure_assets,
            commands::apple_speech_transcribe_file,
            commands::apple_speech_start_live,
            commands::apple_speech_stop_live,
            commands::apple_speech_cancel,
            commands::apple_vision_status,
            commands::apple_vision_present_scanner,
            commands::apple_vision_recognize_document,
            commands::apple_vision_cancel,
            commands::apple_spotlight_status,
            commands::apple_spotlight_donate,
            commands::apple_spotlight_delete,
            commands::apple_spotlight_delete_domain,
            commands::apple_spotlight_query,
            commands::apple_spotlight_rebuild,
            commands::apple_nl_status,
            commands::apple_nl_request_assets,
            commands::apple_nl_embed_texts,
            commands::apple_coreai_status,
            commands::apple_coreai_catalog,
            commands::apple_coreai_download_start,
            commands::apple_coreai_download_cancel,
            commands::apple_coreai_install_commit,
            commands::apple_coreai_delete,
            commands::apple_coreai_set_active,
            commands::apple_coreai_session_start,
            commands::apple_coreai_prompt,
            commands::apple_coreai_cancel,
            commands::apple_coreai_count_tokens,
            commands::apple_coreai_warmup,
            commands::apple_translate_sentence,
        ])
        .setup(|app, api| {
            let plugin = init_mobile(app.app_handle(), api)?;
            app.manage(plugin);
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_serializes_with_code_and_message() {
        let json = serde_json::to_string(&not_apple("apple_fm_generate")).expect("serialize");
        assert!(json.contains(PLATFORM_UNSUPPORTED));
        assert!(json.contains("apple_fm_generate"));
    }

    #[test]
    fn desktop_snapshot_is_platform_unsupported() {
        let snap = AppleIntelligenceSnapshot::platform_unsupported();
        assert!(!snap.apple_os);
        assert_eq!(
            snap.foundation_models.reason.as_deref(),
            Some(PLATFORM_UNSUPPORTED)
        );
        assert_eq!(snap.speech.reason.as_deref(), Some(PLATFORM_UNSUPPORTED));
        let json = serde_json::to_string(&snap).expect("serialize");
        assert!(json.contains(r#""appleOs":false"#));
        assert!(json.contains(r#""foundationModels""#));
        assert!(json.contains(r#""visionDocuments""#));
        assert!(json.contains(r#""naturalLanguageEmbeddings""#));
        assert!(json.contains(r#""coreAi""#));
    }
}
