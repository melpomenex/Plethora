const COMMANDS: &[&str] = &[
    "scan_status",
    "scan_document",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .expect("failed to build tauri-plugin for plethora-android-vision");
}
