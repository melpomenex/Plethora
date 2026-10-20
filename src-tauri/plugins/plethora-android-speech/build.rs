const COMMANDS: &[&str] = &[
    "speech_status",
    "dictation_status",
    "start_dictation",
    "stop_dictation",
    "cancel_dictation",

    "recording_status",
    "start_recording",
    "pause_recording",
    "resume_recording",
    "finish_recording",

    "transcribe_audio",
    "download_speech_model",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .expect("failed to build tauri-plugin for plethora-android-speech");
}
