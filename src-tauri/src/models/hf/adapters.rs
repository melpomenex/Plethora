//! Per-runtime compatibility adapters (requirement #19, "Runtime-compatibility
//! determination").
//!
//! Each [`RuntimeAdapter`] knows (a) what artifacts a Hugging Face repo must
//! contain to be runnable through a supported Plethora speech runtime, (b) the
//! metadata files the runtime requires, and (c) where to install them. The
//! manager is written against the trait — adding a new runtime means adding a
//! new adapter, not rewriting the manager.
//!
//! Detection is deliberately **conservative**: a repo tagged TTS/STT that
//! matches no supported artifact is reported `unsupported_runtime` rather than
//! being claimed as installable. When an artifact is inferred from heuristics
//! (e.g. "name contains zipformer") rather than an exact known layout, the
//! [`DetectionConfidence`] is `Heuristic` and the UI labels the match as an
//! estimate.

use super::hf_client::{FileIndex, HfRepoInfo, file_name};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// The speech runtimes Plethora can actually run a downloaded model with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HfRuntime {
    /// whisper.cpp sidecar, ggml `.bin` models.
    WhisperCpp,
    /// sherpa-onnx sidecar (STT: `sherpa-onnx-offline`).
    SherpaOnnxStt,
    /// sherpa-onnx TTS (ONNX vits-family models).
    SherpaOnnxTts,
}

impl HfRuntime {
    pub fn label(self) -> &'static str {
        match self {
            HfRuntime::WhisperCpp => "whisper.cpp (ggml)",
            HfRuntime::SherpaOnnxStt => "sherpa-onnx (ONNX STT)",
            HfRuntime::SherpaOnnxTts => "sherpa-onnx (ONNX TTS)",
        }
    }

    pub fn sidecar_name(self) -> &'static str {
        match self {
            HfRuntime::WhisperCpp => "whisper",
            HfRuntime::SherpaOnnxStt | HfRuntime::SherpaOnnxTts => "sherpa-onnx",
        }
    }
}

/// Which sherpa-onnx STT flag set a model needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SherpaSttFamily {    /// NVIDIA Parakeet — `--nemo-ctc-model`.
    NemoCtc,
    /// Alibaba SenseVoice — `--sense-voice-model`.
    SenseVoice,
    /// Zipformer transducer — `--zipformer-model` (+ optional encoder/decoder/joiner).
    Zipformer,
    /// FunASR Paraformer — `--paraformer-model`.
    Paraformer,
}

/// A single repo-relative file that must be downloaded and verified.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactFile {
    pub path: String,
    pub size: Option<u64>,
    pub sha256: Option<String>,
}

/// How the runtime is invoked for an installed model. Paths are repo-relative;
/// after installation they resolve under the adapter's install dir.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum RunContract {
    Whisper {
        model_file: String,
    },
    SherpaStt {
        family: SherpaSttFamily,
        /// Primary model file (combined ONNX, or `encoder.onnx` for split zipformer).
        model_file: String,
        decoder_file: Option<String>,
        joiner_file: Option<String>,
        tokens_file: Option<String>,
        use_itn: bool,
    },
    SherpaTts {
        model_file: String,
        tokens_file: Option<String>,
        voices_file: Option<String>,
    },
}

/// How confident the adapter is that the artifact is genuinely runnable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DetectionConfidence {
    /// An exact known layout was matched (e.g. ggml-*.bin for whisper.cpp).
    Exact,
    /// Matched via naming heuristics — may need runtime verification.
    Heuristic,
}

/// A detected, installable artifact for a repo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artifact {
    pub runtime: HfRuntime,
    /// Machine-readable kind, e.g. "ggml-whisper", "nemo-ctc", "zipformer", "vits".
    pub kind: String,
    /// Human label, e.g. "whisper.cpp ggml model".
    pub label: String,
    pub files: Vec<ArtifactFile>,
    pub download_size_bytes: u64,
    pub run_contract: RunContract,
    pub estimated_memory_bytes: u64,
    pub confidence: DetectionConfidence,
}

/// The trait every runtime adapter implements. The manager only talks to this.
pub trait RuntimeAdapter: Send + Sync {
    fn runtime(&self) -> HfRuntime;
    /// Stable adapter id (used in the registry).
    fn id(&self) -> &'static str;
    /// Human label for the UI.
    fn label(&self) -> &'static str;
    /// Metadata file names the runtime requires (e.g. "tokens.txt").
    fn required_metadata(&self) -> Vec<&'static str>;
    /// Directory (under app_data/models) where this runtime's models live.
    fn install_dir(&self, app_data_dir: &Path) -> PathBuf;
    /// Detect a compatible artifact from a repo's file listing. Returns None
    /// when no supported artifact exists (→ `unsupported_runtime`).
    fn detect_artifact(&self, info: &HfRepoInfo, metadata: &FileIndex) -> Option<Artifact>;
}

fn artifact_file(index: &FileIndex, path: String) -> ArtifactFile {
    ArtifactFile {
        size: index.size_of(&path),
        sha256: index.sha_of(&path),
        path,
    }
}

fn total_download_size(files: &[ArtifactFile]) -> u64 {
    files.iter().filter_map(|f| f.size).sum()
}

fn repo_name_lower(info: &HfRepoInfo) -> String {
    info.id.rsplit('/').next().unwrap_or(&info.id).to_lowercase()
}

fn repo_tags_contain(info: &HfRepoInfo, needle: &str) -> bool {
    info.tags.iter().any(|t| t.to_lowercase().contains(needle))
}

/// True when a repo *name* clearly indicates a TTS-family model (vits, kokoro,
/// melotts, …). Used to (a) positively detect sherpa-onnx TTS and (b) exclude
/// TTS repos from the generic sherpa-onnx STT heuristic so a
/// `sherpa-onnx-vits-*` repo is never offered as STT.
fn is_tts_repo_name(name: &str) -> bool {
    let name = name.to_lowercase();
    ["vits", "kokoro", "melotts", "melo-tts", "matcha", "kitten", "tts"]
        .iter()
        .any(|t| name.contains(t))
}

// ─────────────────────────────────────────────────────────────────────────────
// whisper.cpp adapter
// ─────────────────────────────────────────────────────────────────────────────

pub struct WhisperCppAdapter;

impl RuntimeAdapter for WhisperCppAdapter {
    fn runtime(&self) -> HfRuntime {
        HfRuntime::WhisperCpp
    }
    fn id(&self) -> &'static str {
        "whisper-cpp"
    }
    fn label(&self) -> &'static str {
        "whisper.cpp (ggml)"
    }
    fn required_metadata(&self) -> Vec<&'static str> {
        vec!["ggml-*.bin"]
    }
    fn install_dir(&self, app_data_dir: &Path) -> PathBuf {
        app_data_dir.join("models").join("whisper")
    }
    fn detect_artifact(&self, _info: &HfRepoInfo, index: &FileIndex) -> Option<Artifact> {
        let model = index.find_file(|name| {
            name.to_lowercase().starts_with("ggml-") && name.to_lowercase().ends_with(".bin")
        })?;
        let files = vec![artifact_file(index, model.clone())];
        let size = total_download_size(&files);
        if size == 0 {
            return None;
        }
        // Weights are loaded into RAM/VRAM at inference; allow ~1.2x for
        // activation buffers and compute graph overhead.
        let estimated_memory_bytes = (size as f64 * 1.2) as u64;
        Some(Artifact {
            runtime: HfRuntime::WhisperCpp,
            kind: "ggml-whisper".to_string(),
            label: "whisper.cpp ggml model".to_string(),
            files,
            download_size_bytes: size,
            run_contract: RunContract::Whisper {
                model_file: model,
            },
            estimated_memory_bytes,
            confidence: DetectionConfidence::Exact,
        })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// sherpa-onnx STT adapter
// ─────────────────────────────────────────────────────────────────────────────

pub struct SherpaOnnxSttAdapter;

impl SherpaOnnxSttAdapter {
    fn onnx_candidates(&self, index: &FileIndex) -> Vec<String> {
        index
            .paths()
            .into_iter()
            .filter(|p| {
                let n = file_name(p).to_lowercase();
                n.ends_with(".onnx")
                    && !p.contains("/test")
                    && !p.contains("test_wavs")
                    && !p.starts_with("test")
            })
            .collect()
    }

    fn tokens_file(&self, index: &FileIndex) -> Option<String> {
        index
            .find_file_named("tokens.txt")
            .or_else(|| index.find_file_named("tokens.json"))
    }

    fn preferred_model(&self, index: &FileIndex, names: &[&str]) -> Option<String> {
        names
            .iter()
            .filter_map(|n| index.find_file_named(n))
            .next()
    }

    fn build_artifact(
        &self,
        kind: &str,
        label: &str,
        family: SherpaSttFamily,
        model_file: String,
        decoder_file: Option<String>,
        joiner_file: Option<String>,
        tokens_file: Option<String>,
        use_itn: bool,
        index: &FileIndex,
    ) -> Artifact {
        let mut files = vec![artifact_file(index, model_file.clone())];
        for extra in [&decoder_file, &joiner_file, &tokens_file] {
            if let Some(t) = extra {
                files.push(artifact_file(index, t.clone()));
            }
        }
        let size = total_download_size(&files);
        let estimated_memory_bytes = (size as f64 * 1.15) as u64;
        Artifact {
            runtime: HfRuntime::SherpaOnnxStt,
            kind: kind.to_string(),
            label: label.to_string(),
            files,
            download_size_bytes: size,
            run_contract: RunContract::SherpaStt {
                family,
                model_file,
                decoder_file,
                joiner_file,
                tokens_file,
                use_itn,
            },
            estimated_memory_bytes,
            confidence: DetectionConfidence::Exact,
        }
    }
}

impl RuntimeAdapter for SherpaOnnxSttAdapter {
    fn runtime(&self) -> HfRuntime {
        HfRuntime::SherpaOnnxStt
    }
    fn id(&self) -> &'static str {
        "sherpa-onnx-stt"
    }
    fn label(&self) -> &'static str {
        "sherpa-onnx (ONNX STT)"
    }
    fn required_metadata(&self) -> Vec<&'static str> {
        vec!["model.onnx | model.int8.onnx", "tokens.txt | tokens.json"]
    }
    fn install_dir(&self, app_data_dir: &Path) -> PathBuf {
        app_data_dir.join("models").join("parakeet")
    }
    fn detect_artifact(&self, info: &HfRepoInfo, index: &FileIndex) -> Option<Artifact> {
        let onnx = self.onnx_candidates(index);
        if onnx.is_empty() {
            return None;
        }
        let tokens = self.tokens_file(index);
        let name = repo_name_lower(info);
        let int8 = self.preferred_model(index, &["model.int8.onnx", "model.onnx"]);
        let fp16 = self.preferred_model(index, &["model.fp16.onnx"]);
        let model = int8.or(fp16).or(self.preferred_model(index, &["model.onnx"]));

        // SenseVoice: name contains "sense" + int8/onnx model + tokens.
        if let Some(m) = model.clone() {
            if name.contains("sense") && tokens.is_some() {
                return Some(self.build_artifact(
                    "sense-voice",
                    "SenseVoice (sherpa-onnx STT)",
                    SherpaSttFamily::SenseVoice,
                    m,
                    None,
                    None,
                    tokens,
                    true,
                    index,
                ));
            }
            // NVIDIA Parakeet / NeMo CTC.
            if (name.contains("parakeet") || name.contains("nemo"))
                && (tokens.is_some() || index.find_file_named("tokens.txt").is_some())
            {
                return Some(self.build_artifact(
                    "nemo-ctc",
                    "NeMo/Parakeet CTC (sherpa-onnx STT)",
                    SherpaSttFamily::NemoCtc,
                    m,
                    None,
                    None,
                    tokens,
                    false,
                    index,
                ));
            }
        }

        // Zipformer transducer: explicit encoder/decoder/joiner split, or a
        // combined model.onnx + tokens when the name says zipformer/transducer.
        let has_split = ["encoder.onnx", "decoder.onnx", "joiner.onnx"]
            .iter()
            .all(|n| index.find_file_named(n).is_some());
        if has_split {
            let enc = index.find_file_named("encoder.onnx")?;
            let dec = index.find_file_named("decoder.onnx")?;
            let join = index.find_file_named("joiner.onnx")?;
            let mut files = vec![
                artifact_file(index, enc.clone()),
                artifact_file(index, dec.clone()),
                artifact_file(index, join.clone()),
            ];
            if let Some(t) = tokens.as_ref() {
                files.push(artifact_file(index, t.clone()));
            }
            let size = total_download_size(&files);
            return Some(Artifact {
                runtime: HfRuntime::SherpaOnnxStt,
                kind: "zipformer".to_string(),
                label: "Zipformer transducer (sherpa-onnx STT)".to_string(),
                files,
                download_size_bytes: size,
                run_contract: RunContract::SherpaStt {
                    family: SherpaSttFamily::Zipformer,
                    model_file: enc,
                    decoder_file: Some(dec),
                    joiner_file: Some(join),
                    tokens_file: tokens,
                    use_itn: false,
                },
                estimated_memory_bytes: (size as f64 * 1.15) as u64,
                confidence: DetectionConfidence::Exact,
            });
        }

        if let Some(m) = model {
            // Paraformer has a distinct model format — check before the generic
            // "sherpa" heuristic (repo ids often contain "sherpa-onnx-").
            if name.contains("paraformer") && tokens.is_some() {
                return Some(self.build_artifact(
                    "paraformer",
                    "Paraformer (sherpa-onnx STT)",
                    SherpaSttFamily::Paraformer,
                    m,
                    None,
                    None,
                    tokens,
                    false,
                    index,
                ));
            }
            if tokens.is_some()
                && !is_tts_repo_name(&name)
                && (name.contains("zipformer")
                    || name.contains("transducer")
                    || repo_tags_contain(info, "sherpa")
                    || name.contains("sherpa"))
            {
                let mut artifact = self.build_artifact(
                    "zipformer",
                    "Zipformer transducer (sherpa-onnx STT, inferred)",
                    SherpaSttFamily::Zipformer,
                    m,
                    None,
                    None,
                    tokens,
                    false,
                    index,
                );
                artifact.confidence = DetectionConfidence::Heuristic;
                return Some(artifact);
            }
        }

        None
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// sherpa-onnx TTS adapter
// ─────────────────────────────────────────────────────────────────────────────

pub struct SherpaOnnxTtsAdapter;

impl RuntimeAdapter for SherpaOnnxTtsAdapter {
    fn runtime(&self) -> HfRuntime {
        HfRuntime::SherpaOnnxTts
    }
    fn id(&self) -> &'static str {
        "sherpa-onnx-tts"
    }
    fn label(&self) -> &'static str {
        "sherpa-onnx (ONNX TTS)"
    }
    fn required_metadata(&self) -> Vec<&'static str> {
        vec!["model.onnx", "tokens.txt"]
    }
    fn install_dir(&self, app_data_dir: &Path) -> PathBuf {
        app_data_dir.join("models").join("tts")
    }
    fn detect_artifact(&self, info: &HfRepoInfo, index: &FileIndex) -> Option<Artifact> {
        let name = repo_name_lower(info);
        let is_tts_repo = is_tts_repo_name(&name)
            || repo_tags_contain(info, "text-to-speech")
            || repo_tags_contain(info, "tts");

        let model = ["model.onnx", "model.fp16.onnx", "model.int8.onnx"]
            .iter()
            .filter_map(|n| index.find_file_named(n))
            .next();

        let (model_file, tokens_file, voices_file) = match model {
            Some(m) => {
                let tokens = index
                    .find_file_named("tokens.txt")
                    .or_else(|| index.find_file_named("lexicon.txt"))
                    .or_else(|| index.find_file_named("tokens.json"));
                let voices = index.find_file_named("voices.bin");
                (m, tokens, voices)
            }
            None => return None,
        };

        if !is_tts_repo {
            return None;
        }

        let mut files = vec![artifact_file(index, model_file.clone())];
        if let Some(t) = tokens_file.as_ref() {
            files.push(artifact_file(index, t.clone()));
        }
        if let Some(v) = voices_file.as_ref() {
            files.push(artifact_file(index, v.clone()));
        }
        let size = total_download_size(&files);
        if size == 0 {
            return None;
        }

        let kind = if name.contains("kokoro") {
            "kokoro"
        } else {
            "vits"
        };
        Some(Artifact {
            runtime: HfRuntime::SherpaOnnxTts,
            kind: kind.to_string(),
            label: format!("{} (sherpa-onnx ONNX TTS)", kind),
            files,
            download_size_bytes: size,
            run_contract: RunContract::SherpaTts {
                model_file,
                tokens_file,
                voices_file,
            },
            estimated_memory_bytes: (size as f64 * 1.1) as u64,
            confidence: if name.contains("vits")
                || name.contains("kokoro")
                || name.contains("melotts")
                || name.contains("melo-tts")
            {
                DetectionConfidence::Exact
            } else {
                DetectionConfidence::Heuristic
            },
        })
    }
}

/// All adapters, in the order they are evaluated.
pub fn all_adapters() -> Vec<Box<dyn RuntimeAdapter>> {
    vec![
        Box::new(WhisperCppAdapter),
        Box::new(SherpaOnnxSttAdapter),
        Box::new(SherpaOnnxTtsAdapter),
    ]
}

/// Evaluate every adapter against a repo's file index.
pub fn detect_all(info: &HfRepoInfo, index: &FileIndex) -> Vec<Artifact> {
    all_adapters()
        .iter()
        .filter_map(|a| a.detect_artifact(info, index))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::hf::hf_client::{FileMetadata, HfFile, HfLfsInfo};

    fn file(path: &str, size: u64) -> HfFile {
        HfFile {
            rfilename: path.to_string(),
            size: Some(size),
            lfs: Some(HfLfsInfo {
                sha256: Some(format!("sha{}", path.len())),
                size: Some(size),
            }),
        }
    }

    fn repo(id: &str, tags: &[&str]) -> HfRepoInfo {
        HfRepoInfo {
            id: id.to_string(),
            author: None,
            sha: None,
            last_modified: None,
            private: false,
            pipeline_tag: Some("automatic-speech-recognition".to_string()),
            library_name: None,
            license: Some("apache-2.0".to_string()),
            tags: tags.iter().map(|s| s.to_string()).collect(),
            siblings: vec![],
            safetensors: None,
            card_data: None,
        }
    }

    fn index(files: &[HfFile]) -> FileIndex {
        let metadata = files
            .iter()
            .map(|f| {
                (
                    f.rfilename.clone(),
                    FileMetadata {
                        size: f.size,
                        sha256: f.lfs.as_ref().and_then(|l| l.sha256.clone()),
                    },
                )
            })
            .collect();
        FileIndex {
            files: files.to_vec(),
            metadata,
        }
    }

    // ── 5.1: compatible whisper ggml ───────────────────────────────────────
    #[test]
    fn detects_whisper_ggml_artifact() {
        let info = repo("ggerganov/whisper.cpp", &["whisper", "automatic-speech-recognition"]);
        let idx = index(&[file("ggml-small.bin", 500_000_000)]);
        let artifact = WhisperCppAdapter.detect_artifact(&info, &idx).expect("artifact");
        assert_eq!(artifact.runtime, HfRuntime::WhisperCpp);
        assert_eq!(artifact.kind, "ggml-whisper");
        assert_eq!(artifact.confidence, DetectionConfidence::Exact);
        assert_eq!(artifact.files.len(), 1);
        assert_eq!(artifact.files[0].sha256.as_deref(), Some("sha14"));
    }

    #[test]
    fn whisper_ggml_can_live_in_subdirectory() {
        let info = repo("somebody/whisper-model", &["whisper"]);
        let idx = index(&[file("ggml/ggml-base.en.bin", 150_000_000)]);
        let artifact = WhisperCppAdapter.detect_artifact(&info, &idx).expect("artifact");
        assert_eq!(artifact.run_contract, RunContract::Whisper {
            model_file: "ggml/ggml-base.en.bin".to_string(),
        });
    }

    // ── compatible sherpa ONNX (sense-voice / nemo / zipformer / paraformer)
    #[test]
    fn detects_sense_voice_onnx() {
        let info = repo("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue", &["automatic-speech-recognition"]);
        let idx = index(&[file("model.int8.onnx", 160_000_000), file("tokens.txt", 100_000)]);
        let artifact = SherpaOnnxSttAdapter.detect_artifact(&info, &idx).expect("artifact");
        assert_eq!(artifact.runtime, HfRuntime::SherpaOnnxStt);
        assert_eq!(artifact.kind, "sense-voice");
        match &artifact.run_contract {
            RunContract::SherpaStt { family: SherpaSttFamily::SenseVoice, use_itn, .. } => {
                assert!(*use_itn);
            }
            other => panic!("expected sense-voice contract, got {:?}", other),
        }
    }

    #[test]
    fn detects_nemo_parakeet_onnx() {
        let info = repo("nvidia/parakeet-tdt-0.6b-v2", &["automatic-speech-recognition"]);
        let idx = index(&[file("model.int8.onnx", 200_000_000), file("tokens.txt", 50_000)]);
        let artifact = SherpaOnnxSttAdapter.detect_artifact(&info, &idx).expect("artifact");
        assert_eq!(artifact.kind, "nemo-ctc");
        match &artifact.run_contract {
            RunContract::SherpaStt { family: SherpaSttFamily::NemoCtc, .. } => {}
            other => panic!("expected nemo-ctc contract, got {:?}", other),
        }
    }

    #[test]
    fn detects_zipformer_split_encoder_decoder_joiner() {
        let info = repo("csukuangfj/sherpa-onnx-zipformer-en-2023-06-26", &["automatic-speech-recognition"]);
        let idx = index(&[
            file("encoder.onnx", 100_000_000),
            file("decoder.onnx", 20_000_000),
            file("joiner.onnx", 1_000_000),
            file("tokens.txt", 50_000),
        ]);
        let artifact = SherpaOnnxSttAdapter.detect_artifact(&info, &idx).expect("artifact");
        assert_eq!(artifact.kind, "zipformer");
        match &artifact.run_contract {
            RunContract::SherpaStt { family: SherpaSttFamily::Zipformer, decoder_file, joiner_file, .. } => {
                assert_eq!(decoder_file.as_deref(), Some("decoder.onnx"));
                assert_eq!(joiner_file.as_deref(), Some("joiner.onnx"));
            }
            other => panic!("expected zipformer contract, got {:?}", other),
        }
    }

    #[test]
    fn detects_zipformer_combined_model() {
        let info = repo("csukuangfj/sherpa-onnx-zipformer-en-2023-06-26", &["automatic-speech-recognition"]);
        let idx = index(&[file("model.onnx", 300_000_000), file("tokens.txt", 50_000)]);
        let artifact = SherpaOnnxSttAdapter.detect_artifact(&info, &idx).expect("artifact");
        assert_eq!(artifact.kind, "zipformer");
    }

    #[test]
    fn detects_paraformer_onnx() {
        let info = repo("csukuangfj/sherpa-onnx-paraformer-zh-2023-09-14", &["automatic-speech-recognition"]);
        let idx = index(&[file("model.onnx", 400_000_000), file("tokens.txt", 50_000)]);
        let artifact = SherpaOnnxSttAdapter.detect_artifact(&info, &idx).expect("artifact");
        assert_eq!(artifact.kind, "paraformer");
    }

    // ── compatible sherpa TTS ──────────────────────────────────────────────
    #[test]
    fn detects_vits_tts_onnx() {
        let info = repo("csukuangfj/vits-ljs", &["text-to-speech"]);
        let idx = index(&[file("model.onnx", 90_000_000), file("tokens.txt", 10_000)]);
        let artifact = SherpaOnnxTtsAdapter.detect_artifact(&info, &idx).expect("artifact");
        assert_eq!(artifact.runtime, HfRuntime::SherpaOnnxTts);
        assert_eq!(artifact.kind, "vits");
    }

    #[test]
    fn detects_kokoro_tts_onnx() {
        let info = repo("hexgrad/kokoro-82m", &["text-to-speech"]);
        let idx = index(&[
            file("model.onnx", 90_000_000),
            file("voices.bin", 5_000_000),
            file("tokens.txt", 10_000),
        ]);
        let artifact = SherpaOnnxTtsAdapter.detect_artifact(&info, &idx).expect("artifact");
        assert_eq!(artifact.kind, "kokoro");
        match &artifact.run_contract {
            RunContract::SherpaTts { voices_file, .. } => {
                assert_eq!(voices_file.as_deref(), Some("voices.bin"));
            }
            other => panic!("expected sherpa-tts contract, got {:?}", other),
        }
    }

    // ── TTS-family repos are never offered as STT ──────────────────────────
    #[test]
    fn sherpa_vits_repo_is_not_detected_as_stt() {
        // A `sherpa-onnx-vits-*` repo has model.onnx + tokens.txt and its name
        // contains "sherpa" — it must NOT be claimed as a zipformer STT model.
        let info = repo("csukuangfj/sherpa-onnx-vits-zh-ll", &["text-to-speech"]);
        let idx = index(&[file("model.onnx", 90_000_000), file("tokens.txt", 10_000)]);
        assert!(
            SherpaOnnxSttAdapter.detect_artifact(&info, &idx).is_none(),
            "vits repo must not be detected as STT"
        );
        // …but IS detected as TTS, so detect_all yields only the TTS artifact.
        let detected = detect_all(&info, &idx);
        assert_eq!(detected.len(), 1, "only the TTS artifact is detected");
        assert_eq!(detected[0].runtime, HfRuntime::SherpaOnnxTts);
        assert_eq!(detected[0].kind, "vits");
    }

    #[test]
    fn melotts_repo_is_not_detected_as_stt() {
        let info = repo("csukuangfj/sherpa-onnx-melotts-zh_en", &["text-to-speech"]);
        let idx = index(&[file("model.onnx", 90_000_000), file("tokens.txt", 10_000)]);
        assert!(SherpaOnnxSttAdapter.detect_artifact(&info, &idx).is_none());
        assert_eq!(detect_all(&info, &idx)[0].runtime, HfRuntime::SherpaOnnxTts);
    }

    #[test]
    fn generic_sherpa_stt_repo_still_detected_as_stt() {
        // Non-TTS sherpa repo names must still hit the generic heuristic.
        let info = repo("csukuangfj/sherpa-onnx-zipformer-small-en", &["automatic-speech-recognition"]);
        let idx = index(&[file("model.onnx", 300_000_000), file("tokens.txt", 50_000)]);
        let artifact = SherpaOnnxSttAdapter.detect_artifact(&info, &idx).expect("artifact");
        assert_eq!(artifact.kind, "zipformer");
    }

    // ── 5.2: incompatible repo → None (unsupported runtime) ────────────────
    #[test]
    fn pytorch_only_repo_is_not_detected() {
        let info = repo("openai/whisper-large-v3", &["automatic-speech-recognition", "whisper"]);
        // Only pytorch/safetensors checkpoints — no ggml / ONNX.
        let idx = index(&[
            file("pytorch_model.bin", 3_000_000_000),
            file("config.json", 5_000),
            file("tokenizer.json", 50_000),
        ]);
        assert!(detect_all(&info, &idx).is_empty());
    }

    #[test]
    fn safetensors_only_repo_is_not_detected() {
        let info = repo("somebody/asr-model", &["automatic-speech-recognition"]);
        let idx = index(&[file("model.safetensors", 2_000_000_000)]);
        assert!(detect_all(&info, &idx).is_empty());
    }

    #[test]
    fn onnx_without_tokens_is_not_detected_as_stt() {
        let info = repo("somebody/asr-model", &["automatic-speech-recognition"]);
        // ONNX model but no tokens + no family name → not conservatively claimed.
        let idx = index(&[file("model.onnx", 100_000_000)]);
        assert!(SherpaOnnxSttAdapter.detect_artifact(&info, &idx).is_none());
    }

    // ── 5.11: "any HF model" is not treated as installable ────────────────
    #[test]
    fn arbitrary_pipeline_repo_without_supported_artifact_is_unsupported() {
        // A non-speech repo with no supported artifact must not be claimed.
        let info = repo("google-bert/bert-base-uncased", &["fill-mask", "bert"]);
        let idx = index(&[file("model.safetensors", 400_000_000)]);
        assert!(detect_all(&info, &idx).is_empty());
    }
}
