// Registers IPC command names and wires Swift on iOS (mobile plugin) and macOS (C ABI).
// Command names MUST match `#[tauri::command]` functions in src/lib.rs.

const COMMANDS: &[&str] = &[
    "apple_capabilities",
    "apple_fm_availability",
    "apple_fm_generate",
    "apple_fm_generate_stream",
    "apple_fm_cancel",
    "apple_fm_count_tokens",
    "apple_fm_warmup",
    "apple_speech_status",
    "apple_speech_ensure_assets",
    "apple_speech_transcribe_file",
    "apple_speech_start_live",
    "apple_speech_stop_live",
    "apple_speech_cancel",
    "apple_vision_status",
    "apple_vision_present_scanner",
    "apple_vision_recognize_document",
    "apple_vision_cancel",
    "apple_spotlight_status",
    "apple_spotlight_donate",
    "apple_spotlight_delete",
    "apple_spotlight_delete_domain",
    "apple_spotlight_query",
    "apple_spotlight_rebuild",
    "apple_nl_status",
    "apple_nl_request_assets",
    "apple_nl_embed_texts",
    "apple_coreai_status",
    "apple_coreai_catalog",
    "apple_coreai_download_start",
    "apple_coreai_download_cancel",
    "apple_coreai_install_commit",
    "apple_coreai_delete",
    "apple_coreai_set_active",
    "apple_coreai_session_start",
    "apple_coreai_prompt",
    "apple_coreai_cancel",
    "apple_coreai_count_tokens",
    "apple_coreai_warmup",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .try_build()
        .expect("failed to build tauri-plugin for plethora-apple-intelligence");

    #[cfg(target_os = "macos")]
    build_macos_swift();
}

#[cfg(target_os = "macos")]
fn build_macos_swift() {
    use std::env;
    use std::path::PathBuf;
    use std::process::Command;

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let lib_path = out_dir.join("libplethora_apple_fm.a");

    let sdk = Command::new("xcrun")
        .args(["--show-sdk-path", "--sdk", "macosx"])
        .output()
        .expect("xcrun sdk path")
        .stdout;
    let sdk = String::from_utf8(sdk).expect("sdk utf8").trim().to_string();

    let sources = [
        manifest_dir.join("shared/FmBridgeCore.swift"),
        manifest_dir.join("shared/FmGenerables.swift"),
        manifest_dir.join("macos/Sources/MacFoundationBridge.swift"),
    ];

    for src in &sources {
        println!("cargo:rerun-if-changed={}", src.display());
    }

    let mut cmd = Command::new("xcrun");
    cmd.args([
        "swiftc",
        "-emit-library",
        "-static",
        "-o",
        lib_path.to_str().expect("lib path"),
        "-sdk",
        &sdk,
        "-target",
        "arm64-apple-macos26.0",
        "-swift-version",
        "5",
        "-O",
        "-module-name",
        "plethora_apple_fm_macos",
    ]);
    for src in &sources {
        cmd.arg(src);
    }
    cmd.args(["-Xlinker", "-weak_framework", "-Xlinker", "FoundationModels"]);

    let status = cmd.status().expect("swiftc failed to start");
    if !status.success() {
        panic!("swiftc build for plethora_apple_fm failed");
    }

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=plethora_apple_fm");
    println!("cargo:rustc-link-arg=-Wl,-weak_framework,FoundationModels");
}
