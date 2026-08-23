const COMMANDS: &[&str] = &[
    "speech_status",
    "transcribe_audio",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .expect("failed to build tauri-plugin for plethora-android-speech");
}
