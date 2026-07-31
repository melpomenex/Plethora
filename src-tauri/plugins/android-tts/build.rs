// Build script for the android-tts Tauri plugin.
//
// `tauri_plugin::Builder` registers the IPC command names so the Tauri codegen
// can generate the JS<->Rust and Rust<->native-mobile glue, and wires the
// plugin's `android/` directory into the generated Gradle project. The command
// names MUST exactly match the Rust `#[tauri::command]` function names in
// `src/lib.rs` (snake_case). The corresponding Kotlin `@Command` method names
// are the camelCase forms passed to `run_mobile_plugin(...)`.

const COMMANDS: &[&str] = &[
    "initialize",
    "download_model",
    "cancel_download",
    "list_models",
    "list_voices",
    "speak",
    "pause",
    "resume",
    "stop",
    "delete_model",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .try_build()
        .expect("failed to build tauri-plugin for android-tts");
}
