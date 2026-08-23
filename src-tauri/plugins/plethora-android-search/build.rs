const COMMANDS: &[&str] = &[
    "search_status",
    "retrieve",
    "upsert_document",
    "delete_document",
    "rebuild_index",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .expect("failed to build tauri-plugin for plethora-android-search");
}
