// Build script for the android-genai Tauri plugin.
//
// `tauri_plugin::Builder` registers the IPC command names so the Tauri codegen
// can generate the JS<->Rust and Rust<->native-mobile glue, and wires the
// plugin's `android/` directory into the generated Gradle project. The command
// names MUST exactly match the Rust `#[tauri::command]` function names in
// `src/lib.rs` (snake_case). The corresponding Kotlin `@Command` method names
// are the camelCase forms passed to `run_mobile_plugin(...)`.

const COMMANDS: &[&str] = &[
    "ondevice_ai_status",
    "ondevice_ai_capabilities",
    "ondevice_ai_generate",
    "ondevice_ai_count_tokens",
    "ondevice_ai_warm_up",
    "ondevice_ai_summarize",
    "ondevice_ai_prompt",
    "ondevice_ai_download",
    "ondevice_ai_start_prompt_stream",
    "ondevice_ai_cancel_prompt_request",
    "ondevice_ai_cancel",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .expect("failed to build tauri-plugin for android-genai");
}
