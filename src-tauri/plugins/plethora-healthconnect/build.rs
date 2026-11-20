const COMMANDS: &[&str] = &[
    "healthconnect_get_sdk_status",
    "healthconnect_get_granted_permissions",
    "healthconnect_request_permissions",
    "healthconnect_read_sleep_sessions",
    "healthconnect_read_physiological_records",
    "healthconnect_get_changes_token",
    "healthconnect_read_changes",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .expect("failed to build tauri-plugin for plethora-healthconnect");
}
