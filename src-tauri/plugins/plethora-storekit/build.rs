// Build script for the StoreKit 2 Tauri plugin.
//
// `tauri_plugin::Builder` registers the IPC command names so the Tauri
// codegen can generate the JS<->Rust (and Rust<->native-mobile) glue, and
// wires the plugin's `ios/` SwiftPM package into the generated Xcode project.
// There is deliberately no Android side: StoreKit 2 is Apple-only and every
// command returns a typed UNSUPPORTED error on other targets (see src/lib.rs).

const COMMANDS: &[&str] = &[
    "storekit_get_products",
    "storekit_purchase",
    "storekit_current_entitlements",
    "storekit_restore",
    "storekit_start_transaction_listener",
    "storekit_manage_subscriptions",
    "storekit_app_account_token",
    "storekit_set_app_account_token",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .try_build()
        .expect("failed to build tauri-plugin for plethora-storekit");
}
