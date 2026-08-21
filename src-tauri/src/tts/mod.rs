//! Desktop native sherpa-onnx TTS runtime (change:
//! add-supertonic-3-cross-platform-tts).
//!
//! In-process synthesis through the bundled `libsherpa-onnx-c-api` shared
//! library — no Python, no onnxruntime-web, no user-installed packages.
//! Modules:
//! - [`sherpa_ffi`]: pinned-version C API surface, dynamic loading, version guard
//! - [`engine`]: `SherpaTtsEngine` session (load/unload/synthesize/cancel) on a
//!   dedicated worker thread
//! - [`wav`]: 16-bit PCM mono WAV encoding at the engine-reported sample rate
//! - [`commands`]: Tauri commands (`sherpa_tts_*`)
//!
//! Android does not use this module: the native plugin runs sherpa-onnx via
//! JNI behind the same family/contract semantics (design D5/D6).

pub mod commands;
pub mod engine;
pub mod sherpa_ffi;
pub mod wav;

pub use commands::{
    sherpa_tts_cancel, sherpa_tts_load, sherpa_tts_status, sherpa_tts_synthesize,
    sherpa_tts_unload, SherpaTtsState,
};
