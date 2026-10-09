fn main() {
    tauri_plugin::Builder::new(&["attach", "claim", "acknowledge", "detach"])
        .android_path("android")
        .try_build()
        .expect("failed to build plethora-navigation plugin");
}
