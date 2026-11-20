const COMMANDS: &[&str] = &[
    "healthkit_get_availability",
    "healthkit_request_authorization",
    "healthkit_query_sleep_sessions",
    "healthkit_query_physiological_samples",
    "healthkit_query_anchored_changes",
    "healthkit_enable_background_delivery",
    "healthkit_disable_background_delivery",
    "healthkit_exclude_health_dir_from_backup",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .try_build()
        .expect("failed to build tauri-plugin for plethora-healthkit");
}
