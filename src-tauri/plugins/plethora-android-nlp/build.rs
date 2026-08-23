const COMMANDS: &[&str] = &[
    "language_id_status",
    "identify_language",
    "translate_sentence",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .expect("failed to build tauri-plugin for plethora-android-nlp");
}
