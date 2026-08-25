// Registers IPC command names for the Windows intelligence plugin.
// Command names MUST match `#[tauri::command]` functions in src/lib.rs.

const COMMANDS: &[&str] = &[
    "windows_capabilities",
    "windows_lm_generate",
    "windows_lm_generate_stream",
    "windows_lm_cancel",
    "windows_lm_warmup",
    "windows_lm_ensure_ready",
    "windows_ocr_status",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .try_build()
        .expect("failed to build tauri-plugin for plethora-windows-intelligence");
}
