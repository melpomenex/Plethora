const COMMANDS: &[&str] = &[
    "stt_status",
    "stt_start_job",
    "stt_job_status",
    "stt_cancel_job",
    "stt_prepare_model",
    "stt_list_models",
    "stt_delete_model",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .expect("failed to build tauri-plugin for plethora-android-stt");
}
