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
    Artifact, HfRuntime, NemotronAsrAdapter, RunContract, RuntimeAdapter, SherpaOnnxSttAdapter,
    SherpaOnnxTtsAdapter, WhisperCppAdapter, WhistleSttAdapter,
};
pub use hf_client::{parse_repo_input, FileMetadata, HfFile, HfRepoInfo, RepoInput};
pub use manager::{
    install_pinned_nemotron_asr, install_pinned_whistle, is_nemotron_asr_installed,
    is_pinned_nemotron_repo, is_pinned_whistle_repo, is_whistle_installed, model_id_for,
    nemotron_asr_catalog_entry, registry_is_installed, registry_list, registry_remove,
    resolve_installed_whistle, resolve_pinned_nemotron_install_target,
    resolve_pinned_whistle_install_target, whistle_catalog_entry, InstalledHfModel,
    InstalledModelFile, PinnedNemotronAsrCatalogEntry, PinnedWhistleCatalogEntry,
    NEMOTRON_ASR_DECODER_FILE, NEMOTRON_ASR_ENCODER_FILE, NEMOTRON_ASR_JOINER_FILE,
    NEMOTRON_ASR_LOGICAL_KEY, NEMOTRON_ASR_REPO_ID, NEMOTRON_ASR_TOKENS_FILE, WHISTLE_LOGICAL_KEY,
    WHISTLE_MODEL_FILE, WHISTLE_REPO_ID, WHISTLE_SHA256, WHISTLE_SIZE_BYTES,
};
pub use suitability::{Suitability, SuitabilityLevel};
pub use system_info::{detect_system_info, GpuInfo, SystemInfo};
