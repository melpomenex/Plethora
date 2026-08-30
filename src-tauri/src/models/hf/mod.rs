//! Hugging Face speech-model manager (requirement #19).
//!
//! Lets a user install arbitrary *compatible* Hugging Face TTS/STT models with
//! intelligent hardware-suitability analysis. Models are only installable when
//! they match one of Plethora's supported speech runtimes (whisper.cpp ggml,
//! sherpa-onnx ONNX STT/TTS) via the per-runtime adapters in [`adapters`].
//! Downloaded repositories are treated as untrusted data — see `security.md`
//! in this module for the security model.

pub mod adapters;
pub mod commands;
pub mod downloader;
pub mod hf_client;
pub mod manager;
pub mod suitability;
pub mod system_info;
#[cfg(test)]
pub mod test_support;

pub use adapters::{
    Artifact, HfRuntime, RunContract, RuntimeAdapter, NemotronAsrAdapter, SherpaOnnxSttAdapter,
    SherpaOnnxTtsAdapter, WhisperCppAdapter,
};
pub use hf_client::{
    FileMetadata, HfFile, HfRepoInfo, RepoInput, parse_repo_input,
};
pub use manager::{
    InstalledHfModel, InstalledModelFile, install_pinned_nemotron_asr, is_nemotron_asr_installed,
    is_pinned_nemotron_repo, model_id_for, nemotron_asr_catalog_entry, registry_is_installed,
    registry_list, registry_remove, resolve_pinned_nemotron_install_target,
    NEMOTRON_ASR_ENCODER_FILE, NEMOTRON_ASR_DECODER_FILE, NEMOTRON_ASR_JOINER_FILE,
    NEMOTRON_ASR_TOKENS_FILE, NEMOTRON_ASR_LOGICAL_KEY, NEMOTRON_ASR_REPO_ID,
    PinnedNemotronAsrCatalogEntry,
};
pub use suitability::{Suitability, SuitabilityLevel};
pub use system_info::{GpuInfo, SystemInfo, detect_system_info};
