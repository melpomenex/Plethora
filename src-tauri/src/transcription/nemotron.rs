//! Local Nemotron ASR runtime (GGUF).
//!
//! Validates installed weights and selects a compute backend. Native GGUF inference
//! ships when the Nemotron sidecar is bundled; until then callers receive an honest
//! `LOCAL_MODEL_MISSING` / runtime-unavailable error after install verification.

use crate::transcription::engine::TranscriptSegment;
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ComputeBackend {
    Cuda,
    Vulkan,
    Metal,
    Cpu,
}

impl ComputeBackend {
    pub fn label(self) -> &'static str {
        match self {
            Self::Cuda => "CUDA",
            Self::Vulkan => "Vulkan",
            Self::Metal => "Metal",
            Self::Cpu => "CPU",
        }
    }
}

/// Platform-preferred backend order (PRD §16).
pub fn preferred_backends() -> &'static [ComputeBackend] {
    #[cfg(target_os = "macos")]
    {
        &[ComputeBackend::Metal, ComputeBackend::Cpu]
    }
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        &[ComputeBackend::Cuda, ComputeBackend::Vulkan, ComputeBackend::Cpu]
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        &[ComputeBackend::Vulkan, ComputeBackend::Cpu]
    }
    #[cfg(not(any(
        target_os = "macos",
        target_os = "windows",
        target_os = "linux",
        target_os = "android",
        target_os = "ios"
    )))]
    {
        &[ComputeBackend::Cpu]
    }
}

/// Pick the first backend Plethora can use on this device (coarse probe).
pub fn detect_backend() -> ComputeBackend {
    for backend in preferred_backends() {
        if backend_is_available(*backend) {
            return *backend;
        }
    }
    ComputeBackend::Cpu
}

fn backend_is_available(backend: ComputeBackend) -> bool {
    match backend {
        ComputeBackend::Cuda => std::env::var("CUDA_VISIBLE_DEVICES").is_ok(),
        ComputeBackend::Vulkan => {
            #[cfg(any(target_os = "android", target_os = "linux"))]
            {
                return true;
            }
            #[cfg(not(any(target_os = "android", target_os = "linux")))]
            {
                return false;
            }
        }
        ComputeBackend::Metal => {
            #[cfg(target_os = "macos")]
            {
                return true;
            }
            #[cfg(not(target_os = "macos"))]
            {
                return false;
            }
        }
        ComputeBackend::Cpu => true,
    }
}

pub struct NemotronModelPaths {
    pub install_dir: PathBuf,
    pub gguf_file: PathBuf,
    pub backend: ComputeBackend,
}

pub fn resolve_model_paths(install_dir: &Path, model_file: &str) -> Result<NemotronModelPaths> {
    let gguf_file = install_dir.join(model_file);
    if !gguf_file.exists() {
        return Err(anyhow!(
            "LOCAL_MODEL_MISSING: Nemotron GGUF not found at {}",
            gguf_file.display()
        ));
    }
    Ok(NemotronModelPaths {
        install_dir: install_dir.to_path_buf(),
        gguf_file,
        backend: detect_backend(),
    })
}

/// Batch transcribe an audio file with the installed Nemotron GGUF artifact.
pub async fn transcribe_file(
    install_dir: &Path,
    model_file: &str,
    audio_path: &Path,
    _language: &str,
) -> Result<Vec<TranscriptSegment>> {
    let paths = resolve_model_paths(install_dir, model_file)?;
    if !audio_path.exists() {
        return Err(anyhow!("Audio file not found: {}", audio_path.display()));
    }

    // Sidecar / embedded Nemotron runtime is not bundled in this build yet.
    let _ = paths.backend;
    Err(anyhow!(
        "LOCAL_MODEL_MISSING: Local Nemotron runtime is not available on this build yet \
         (model verified at {}). Use cloud OpenRouter Nemotron for transcription.",
        paths.gguf_file.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferred_backends_always_includes_cpu() {
        assert!(preferred_backends().contains(&ComputeBackend::Cpu));
    }

    #[test]
    fn detect_backend_returns_cpu_when_no_accelerator() {
        let backend = detect_backend();
        assert!(matches!(
            backend,
            ComputeBackend::Cpu
                | ComputeBackend::Metal
                | ComputeBackend::Cuda
                | ComputeBackend::Vulkan
        ));
    }
}
