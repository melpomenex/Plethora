// Registers IPC command names and wires the SwiftPM package on iOS.
// Command names MUST match `#[tauri::command]` functions in src/lib.rs.

const COMMANDS: &[&str] = &[
    "apple_capabilities",
    // B — add-apple-foundation-models-provider
    "apple_fm_availability",
    "apple_fm_generate",
    "apple_fm_generate_stream",
    "apple_fm_cancel",
    "apple_fm_count_tokens",
    "apple_fm_warmup",
    // E — add-apple-speech-transcription
    "apple_speech_status",
    "apple_speech_ensure_assets",
    "apple_speech_transcribe_file",
    "apple_speech_start_live",
    "apple_speech_stop_live",
    "apple_speech_cancel",
    // F — add-apple-vision-document-scan
    "apple_vision_status",
    "apple_vision_present_scanner",
    "apple_vision_recognize_document",
    "apple_vision_cancel",
    // C — add-apple-spotlight-semantic-index
    "apple_spotlight_status",
    "apple_spotlight_donate",
    "apple_spotlight_delete",
    "apple_spotlight_delete_domain",
    "apple_spotlight_query",
    "apple_spotlight_rebuild",
    // G — add-apple-naturallanguage-embeddings
    "apple_nl_status",
    "apple_nl_request_assets",
    "apple_nl_embed_texts",
    // H — add-apple-core-ai-custom-models
    "apple_coreai_status",
    "apple_coreai_catalog",
    "apple_coreai_download_start",
    "apple_coreai_download_cancel",
    "apple_coreai_install_commit",
    "apple_coreai_delete",
    "apple_coreai_set_active",
    "apple_coreai_session_start",
    "apple_coreai_prompt",
    "apple_coreai_cancel",
    "apple_coreai_count_tokens",
    "apple_coreai_warmup",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .try_build()
        .expect("failed to build tauri-plugin for plethora-apple-intelligence");
}
