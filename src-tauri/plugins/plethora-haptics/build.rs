fn main() {
    tauri_plugin::Builder::new(&["get_capabilities", "configure", "perform"])
        .android_path("android")
        .ios_path("ios")
        .try_build()
        .expect("failed to build plethora-haptics plugin");
}
