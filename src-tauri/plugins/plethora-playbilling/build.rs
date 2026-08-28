// Build script for the Google Play Billing Tauri plugin.
//
// `tauri_plugin::Builder` registers the IPC command names so the Tauri
// codegen can generate the JS<->Rust (and Rust<->native-mobile) glue, and
// wires the plugin's `android/` Gradle module into the generated Android
// project. There is deliberately no iOS side: Play Billing is Android-only
// and every command returns a typed platform_unsupported error on other
// targets (see src/lib.rs).

const COMMANDS: &[&str] = &[
    "playbilling_get_products",
    "playbilling_purchase",
    "playbilling_query_purchases",
    "playbilling_restore",
    "playbilling_start_purchase_listener",
    "playbilling_manage_subscriptions",
    "playbilling_set_obfuscated_account_id",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .expect("failed to build tauri-plugin for plethora-playbilling");
}
