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

#[derive(Debug)]
pub struct NemotronModelPaths {
    pub install_dir: PathBuf,
    pub gguf_file: PathBuf,
    pub backend: ComputeBackend,
}

pub fn resolve_model_paths(install_dir: &Path, model_file: &str) -> Result<NemotronModelPaths> {
    // `install_dir.join(model_file)` is the canonical layout. Some callers
    // (the STT engine router) hand us the already-resolved GGUF *file* path
    // from `resolve_installed_path` — joining the file name onto itself
    // produced `<install>/<gguf>/<gguf>` and a bogus LOCAL_MODEL_MISSING.
    // Accept the file itself when its name matches the contract's model file.
    let joined = install_dir.join(model_file);
    let (install_dir, gguf_file) = if joined.exists() {
        (install_dir.to_path_buf(), joined)
    } else if install_dir.is_file()
        && install_dir.file_name() == Path::new(model_file).file_name()
    {
        (
            install_dir.parent().unwrap_or(install_dir).to_path_buf(),
            install_dir.to_path_buf(),
        )
    } else {
        return Err(anyhow!(
            "LOCAL_MODEL_MISSING: Nemotron GGUF not found at {}",
            joined.display()
        ));
    };
    Ok(NemotronModelPaths {
        install_dir,
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

    // ─────────────────────────────────────────────────────────────────────────
    // Path resolution (doubled-path regression)
    // ─────────────────────────────────────────────────────────────────────────

    fn write_gguf(dir: &Path) -> std::path::PathBuf {
        let gguf = dir.join("nemotron-3.5-asr-streaming-0.6b-Q4_K_M.gguf");
        std::fs::write(&gguf, b"gguf bytes").unwrap();
        gguf
    }

    #[test]
    fn resolves_from_install_dir_and_model_file() {
        let tmp = tempfile::tempdir().unwrap();
        let gguf = write_gguf(tmp.path());
        let paths =
            resolve_model_paths(tmp.path(), "nemotron-3.5-asr-streaming-0.6b-Q4_K_M.gguf")
                .expect("dir + name resolves");
        assert_eq!(paths.gguf_file, gguf);
        assert_eq!(paths.install_dir, tmp.path());
    }

    #[test]
    fn resolves_when_caller_passes_the_gguf_file_itself() {
        // The STT engine router passes the resolved GGUF *file* (from
        // resolve_installed_path) where the install dir was expected; the
        // join used to double the file name into <install>/<gguf>/<gguf>.
        let tmp = tempfile::tempdir().unwrap();
        let gguf = write_gguf(tmp.path());
        let paths =
            resolve_model_paths(&gguf, "nemotron-3.5-asr-streaming-0.6b-Q4_K_M.gguf")
                .expect("file path accepted");
        assert_eq!(paths.gguf_file, gguf);
        assert_eq!(paths.install_dir, tmp.path());
    }

    #[test]
    fn rejects_mismatched_file_name_without_doubling() {
        let tmp = tempfile::tempdir().unwrap();
        let gguf = write_gguf(tmp.path());
        // A passed file whose name does NOT match the contract's model file
        // must fail honestly (not silently accept a foreign file).
        let err = resolve_model_paths(&gguf, "some-other-model.gguf")
            .expect_err("mismatched name rejected");
        assert!(err.to_string().contains("LOCAL_MODEL_MISSING"), "{err}");
        // The reported path is the plain join — no doubled file name.
        assert_eq!(
            err.to_string(),
            format!(
                "LOCAL_MODEL_MISSING: Nemotron GGUF not found at {}",
                gguf.join("some-other-model.gguf").display()
            )
        );
    }

    #[test]
    fn missing_model_reports_single_joined_path() {
        let tmp = tempfile::tempdir().unwrap();
        let err = resolve_model_paths(tmp.path(), "nemotron-3.5-asr-streaming-0.6b-Q4_K_M.gguf")
            .expect_err("missing file rejected");
        assert_eq!(
            err.to_string(),
            format!(
                "LOCAL_MODEL_MISSING: Nemotron GGUF not found at {}",
                tmp.path()
                    .join("nemotron-3.5-asr-streaming-0.6b-Q4_K_M.gguf")
                    .display()
            )
        );
    }
}
