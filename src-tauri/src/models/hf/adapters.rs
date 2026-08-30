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
use std::collections::BTreeMap;
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
    /// Nemotron ASR (GGUF, embedded runtime — install/check only until sidecar lands).
    NemotronAsr,
}

impl HfRuntime {
    pub fn label(self) -> &'static str {
        match self {
            HfRuntime::WhisperCpp => "whisper.cpp (ggml)",
            HfRuntime::SherpaOnnxStt => "sherpa-onnx (ONNX STT)",
            HfRuntime::SherpaOnnxTts => "sherpa-onnx (ONNX TTS)",
            HfRuntime::NemotronAsr => "Nemotron ASR (GGUF)",
        }
    }

    pub fn sidecar_name(self) -> &'static str {
        match self {
            HfRuntime::WhisperCpp => "whisper",
            HfRuntime::SherpaOnnxStt | HfRuntime::SherpaOnnxTts => "sherpa-onnx",
            HfRuntime::NemotronAsr => "nemotron-asr",
        }
    }
}

/// Which sherpa-onnx STT flag set a model needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SherpaSttFamily {
    /// NVIDIA Parakeet — `--nemo-ctc-model`.
    NemoCtc,
    /// Alibaba SenseVoice — `--sense-voice-model`.
    SenseVoice,
    /// Zipformer transducer — `--zipformer-model` (+ optional encoder/decoder/joiner).
    Zipformer,
    /// FunASR Paraformer — `--paraformer-model`.
    Paraformer,
}

/// Which sherpa-onnx TTS model family a contract drives. Selects the engine
/// config struct (`OfflineTts*ModelConfig`) at synthesis time; installation,
/// verification, and uninstall are family-agnostic (they walk `artifact_files`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SherpaTtsFamily {
    /// model.onnx + tokens.txt (+ optional lexicon/data-dir). Existing behavior.
    Vits,
    /// Kokoro-82M: model.onnx + tokens.txt + voices.bin.
    Kokoro,
    /// KittenTTS: model.onnx + tokens.txt + voices.bin.
    Kitten,
    /// Supertonic 3 multi-model pipeline (4 ONNX + tts.json + indexer + voice).
    Supertonic,
}

impl SherpaTtsFamily {
    pub fn label(self) -> &'static str {
        match self {
            SherpaTtsFamily::Vits => "VITS",
            SherpaTtsFamily::Kokoro => "Kokoro",
            SherpaTtsFamily::Kitten => "KittenTTS",
            SherpaTtsFamily::Supertonic => "Supertonic 3",
        }
    }

    /// The serde kebab-case value (must stay in sync with the derive).
    pub fn serialized(self) -> &'static str {
        match self {
            SherpaTtsFamily::Vits => "vits",
            SherpaTtsFamily::Kokoro => "kokoro",
            SherpaTtsFamily::Kitten => "kitten",
            SherpaTtsFamily::Supertonic => "supertonic",
        }
    }
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
        /// Model family. `None` = legacy row written before families existed;
        /// the family is inferred on read (`effective_tts_family`) and never
        /// guessed at detection time.
        #[serde(default)]
        family: Option<SherpaTtsFamily>,
        /// Family-primary model file (model.onnx for Vits/Kokoro/Kitten;
        /// duration_predictor*.onnx for Supertonic — anchors containment checks).
        model_file: String,
        /// VITS/Kokoro/Kitten token table.
        #[serde(default)]
        tokens_file: Option<String>,
        /// Kokoro/Kitten speaker embeddings.
        #[serde(default)]
        voices_file: Option<String>,
        /// Supertonic pipeline files (repo-relative), all required at run time.
        #[serde(default)]
        text_encoder_file: Option<String>,
        #[serde(default)]
        vector_estimator_file: Option<String>,
        #[serde(default)]
        vocoder_file: Option<String>,
        #[serde(default)]
        tts_json_file: Option<String>,
        #[serde(default)]
        unicode_indexer_file: Option<String>,
        #[serde(default)]
        voice_bin_file: Option<String>,
        /// Optional espeak-ng-data dir (Vits/Kokoro/Kitten), empty = none.
        #[serde(default)]
        data_dir: Option<String>,
    },
    NemotronAsr {
        /// Primary GGUF weights file (repo-relative).
        model_file: String,
    },
}

impl RunContract {
    /// The family a sherpa TTS contract drives, inferring legacy rows.
    ///
    /// Legacy rows (written before `family` existed) carry only
    /// model/tokens/voices: `voices.bin` present ⇒ Kokoro, otherwise VITS.
    /// Inference happens in this one place; it never mutates stored rows.
    pub fn effective_tts_family(&self) -> Option<SherpaTtsFamily> {
        match self {
            RunContract::SherpaTts { family, voices_file, .. } => Some(match family {
                Some(f) => *f,
                None if voices_file.is_some() => SherpaTtsFamily::Kokoro,
                None => SherpaTtsFamily::Vits,
            }),
            _ => None,
        }
    }

    /// Every repo-relative file path referenced by the contract (present
    /// fields only). Used by containment validation and disk verification.
    pub fn contract_files(&self) -> Vec<&str> {
        match self {
            RunContract::Whisper { model_file } => vec![model_file.as_str()],
            RunContract::SherpaStt {
                model_file,
                decoder_file,
                joiner_file,
                tokens_file,
                ..
            } => {
                let mut files = vec![model_file.as_str()];
                for extra in [decoder_file, joiner_file, tokens_file] {
                    if let Some(f) = extra {
                        files.push(f.as_str());
                    }
                }
                files
            }
            RunContract::SherpaTts {
                model_file,
                tokens_file,
                voices_file,
                text_encoder_file,
                vector_estimator_file,
                vocoder_file,
                tts_json_file,
                unicode_indexer_file,
                voice_bin_file,
                data_dir,
                ..
            } => {
                let mut files = vec![model_file.as_str()];
                for extra in [
                    tokens_file,
                    voices_file,
                    text_encoder_file,
                    vector_estimator_file,
                    vocoder_file,
                    tts_json_file,
                    unicode_indexer_file,
                    voice_bin_file,
                    data_dir,
                ] {
                    if let Some(f) = extra {
                        if !f.is_empty() {
                            files.push(f.as_str());
                        }
                    }
                }
                files
            }
            RunContract::NemotronAsr { model_file } => vec![model_file.as_str()],
        }
    }

    /// True when every referenced path is a safe relative path (no traversal,
    /// no absolute prefix, no Windows separators). Defense in depth for rows
    /// loaded from the registry — see `sanitize_install_rel`.
    pub fn paths_contained(&self) -> bool {
        self.contract_files()
            .iter()
            .all(|f| super::manager::sanitize_install_rel(f).is_some())
    }

    /// Validate that the contract's family ↔ required files are consistent.
    /// A half-filled contract must be unusable rather than misleading; run at
    /// detection time and again before engine use.
    pub fn validate(&self) -> Result<(), String> {
        match self {
            RunContract::Whisper { model_file } => {
                if model_file.is_empty() {
                    return Err("whisper contract has an empty model_file".to_string());
                }
                Ok(())
            }
            RunContract::SherpaStt { model_file, .. } => {
                if model_file.is_empty() {
                    return Err("sherpa-stt contract has an empty model_file".to_string());
                }
                Ok(())
            }
            RunContract::SherpaTts {
                family,
                model_file,
                tokens_file,
                voices_file,
                text_encoder_file,
                vector_estimator_file,
                vocoder_file,
                tts_json_file,
                unicode_indexer_file,
                voice_bin_file,
                ..
            } => {
                if model_file.is_empty() {
                    return Err("sherpa-tts contract has an empty model_file".to_string());
                }
                match family.unwrap_or_else(|| {
                    if voices_file.is_some() {
                        SherpaTtsFamily::Kokoro
                    } else {
                        SherpaTtsFamily::Vits
                    }
                }) {
                    SherpaTtsFamily::Vits => Ok(()),
                    SherpaTtsFamily::Kokoro | SherpaTtsFamily::Kitten => {
                        if voices_file.is_none() {
                            return Err(format!(
                                "{} contract requires voices_file",
                                family.map(|f| f.label()).unwrap_or("kokoro")
                            ));
                        }
                        Ok(())
                    }
                    SherpaTtsFamily::Supertonic => {
                        // All seven pipeline files are mandatory in sherpa's
                        // Supertonic Validate(); there is no partial config.
                        let missing: Vec<&str> = [
                            ("text_encoder_file", text_encoder_file),
                            ("vector_estimator_file", vector_estimator_file),
                            ("vocoder_file", vocoder_file),
                            ("tts_json_file", tts_json_file),
                            ("unicode_indexer_file", unicode_indexer_file),
                            ("voice_bin_file", voice_bin_file),
                        ]
                        .iter()
                        .filter(|(_, v)| v.is_none())
                        .map(|(name, _)| *name)
                        .collect();
                        if !missing.is_empty() {
                            return Err(format!(
                                "supertonic contract is missing required files: {}",
                                missing.join(", ")
                            ));
                        }
                        Ok(())
                    }
                }
            }
            RunContract::NemotronAsr { model_file } => {
                if model_file.is_empty() {
                    return Err("nemotron-asr contract has an empty model_file".to_string());
                }
                Ok(())
            }
        }
    }
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
    /// Family-specific extras for the UI: `precision` ("int8"), `family`,
    /// `voice_roster` ("engine-reported") for Supertonic. Absent for older
    /// artifacts (`#[serde(default)]` keeps rows/IPC backward compatible).
    #[serde(default)]
    pub metadata: BTreeMap<String, String>,
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
    [
        "vits",
        "kokoro",
        "melotts",
        "melo-tts",
        "matcha",
        "kitten",
        "supertonic",
        "tts",
    ]
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
            metadata: BTreeMap::new(),
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
            metadata: BTreeMap::new(),
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
                metadata: BTreeMap::new(),
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

/// The Supertonic pipeline's non-ONNX files (all mandatory in sherpa's
/// `Validate()`); the four ONNX files carry a shared precision suffix.
const SUPERTONIC_FIXED_FILES: [&str; 3] = ["tts.json", "unicode_indexer.bin", "voice.bin"];
/// Precision suffixes attempted for the four Supertonic ONNX files, in
/// preference order. Mixed-precision sets are rejected, never guessed.
const SUPERTONIC_SUFFIXES: [&str; 3] = [".int8", ".fp16", ""];

impl SherpaOnnxTtsAdapter {
    /// Try to match the exact 7-file Supertonic sherpa export layout.
    ///
    /// Requires all four ONNX files (`duration_predictor`, `text_encoder`,
    /// `vector_estimator`, `vocoder`) to exist with the **same** precision
    /// suffix, plus `tts.json` + `unicode_indexer.bin` + `voice.bin`. The
    /// fixed trio is unusual enough that arbitrary multi-ONNX repos do not
    /// match. Returns `(suffix_without_dot, paths)` on a match.
    fn detect_supertonic(index: &FileIndex) -> Option<(String, Vec<String>)> {
        for suffix in SUPERTONIC_SUFFIXES {
            let onnx_names = [
                format!("duration_predictor{suffix}.onnx"),
                format!("text_encoder{suffix}.onnx"),
                format!("vector_estimator{suffix}.onnx"),
                format!("vocoder{suffix}.onnx"),
            ];
            let mut paths = Vec::with_capacity(7);
            for name in onnx_names.iter().map(String::as_str).chain(SUPERTONIC_FIXED_FILES) {
                match index.find_file_named(name) {
                    Some(p) => paths.push(p),
                    // Any miss ⇒ not Supertonic for this suffix.
                    None => break,
                }
            }
            if paths.len() == 7 {
                let precision = suffix.trim_start_matches('.').to_string();
                return Some((if precision.is_empty() { "fp32".to_string() } else { precision }, paths));
            }
        }
        None
    }
}

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
        vec![
            "model.onnx",
            "tokens.txt",
            "duration_predictor*.onnx + text_encoder*.onnx + vector_estimator*.onnx + vocoder*.onnx + tts.json + unicode_indexer.bin + voice.bin (supertonic)",
        ]
    }
    fn install_dir(&self, app_data_dir: &Path) -> PathBuf {
        app_data_dir.join("models").join("tts")
    }
    fn detect_artifact(&self, info: &HfRepoInfo, index: &FileIndex) -> Option<Artifact> {
        let name = repo_name_lower(info);
        let is_tts_repo = is_tts_repo_name(&name)
            || repo_tags_contain(info, "text-to-speech")
            || repo_tags_contain(info, "tts");
        if !is_tts_repo {
            return None;
        }

        // Supertonic first: its layout has no model.onnx, and the generic
        // VITS/Kokoro path below must never half-match a multi-model pipeline.
        if let Some((precision, paths)) = Self::detect_supertonic(index) {
            let mut files: Vec<ArtifactFile> = paths
                .iter()
                .map(|p| artifact_file(index, p.clone()))
                .collect();
            files.sort_by(|a, b| a.path.cmp(&b.path));
            let size = total_download_size(&files);
            if size == 0 {
                return None;
            }
            let mut metadata = BTreeMap::new();
            metadata.insert("precision".to_string(), precision);
            metadata.insert("family".to_string(), "supertonic".to_string());
            // The roster is read from the engine at load time (`NumSpeakers()`
            // over voice.bin style rows); detection carries a placeholder so
            // the UI can label it without loading the model.
            metadata.insert("voice_roster".to_string(), "engine-reported".to_string());
            let [duration_predictor, text_encoder, vector_estimator, vocoder, tts_json, unicode_indexer, voice_bin] =
                paths.as_slice()
            else {
                unreachable!("detect_supertonic returns exactly 7 paths");
            };
            return Some(Artifact {
                runtime: HfRuntime::SherpaOnnxTts,
                kind: "supertonic".to_string(),
                label: "Supertonic 3 (sherpa-onnx TTS)".to_string(),
                files,
                download_size_bytes: size,
                run_contract: RunContract::SherpaTts {
                    family: Some(SherpaTtsFamily::Supertonic),
                    model_file: duration_predictor.clone(),
                    tokens_file: None,
                    voices_file: None,
                    text_encoder_file: Some(text_encoder.clone()),
                    vector_estimator_file: Some(vector_estimator.clone()),
                    vocoder_file: Some(vocoder.clone()),
                    tts_json_file: Some(tts_json.clone()),
                    unicode_indexer_file: Some(unicode_indexer.clone()),
                    voice_bin_file: Some(voice_bin.clone()),
                    data_dir: None,
                },
                // INT8 weights + activation headroom at 44.1 kHz (same factor
                // as the sherpa STT estimate).
                estimated_memory_bytes: (size as f64 * 1.15) as u64,
                // The layout itself is an exact known shape; no name heuristics.
                confidence: DetectionConfidence::Exact,
                metadata,
            });
        }

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

        let (kind, family) = if name.contains("kokoro") {
            ("kokoro", SherpaTtsFamily::Kokoro)
        } else if name.contains("kitten") {
            ("kitten", SherpaTtsFamily::Kitten)
        } else {
            ("vits", SherpaTtsFamily::Vits)
        };
        let mut metadata = BTreeMap::new();
        metadata.insert("family".to_string(), family.serialized().to_string());
        Some(Artifact {
            runtime: HfRuntime::SherpaOnnxTts,
            kind: kind.to_string(),
            label: format!("{} (sherpa-onnx ONNX TTS)", kind),
            files,
            download_size_bytes: size,
            run_contract: RunContract::SherpaTts {
                family: Some(family),
                model_file,
                tokens_file,
                voices_file,
                text_encoder_file: None,
                vector_estimator_file: None,
                vocoder_file: None,
                tts_json_file: None,
                unicode_indexer_file: None,
                voice_bin_file: None,
                data_dir: None,
            },
            estimated_memory_bytes: (size as f64 * 1.1) as u64,
            confidence: if name.contains("vits")
                || name.contains("kokoro")
                || name.contains("kitten")
                || name.contains("melotts")
                || name.contains("melo-tts")
            {
                DetectionConfidence::Exact
            } else {
                DetectionConfidence::Heuristic
            },
            metadata,
        })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Nemotron ASR adapter (GGUF)
// ─────────────────────────────────────────────────────────────────────────────

pub struct NemotronAsrAdapter;

impl RuntimeAdapter for NemotronAsrAdapter {
    fn runtime(&self) -> HfRuntime {
        HfRuntime::NemotronAsr
    }
    fn id(&self) -> &'static str {
        "nemotron-asr"
    }
    fn label(&self) -> &'static str {
        "Nemotron ASR (GGUF)"
    }
    fn required_metadata(&self) -> Vec<&'static str> {
        vec!["*.gguf"]
    }
    fn install_dir(&self, app_data_dir: &Path) -> PathBuf {
        app_data_dir.join("models").join("nemotron-asr")
    }
    fn detect_artifact(&self, info: &HfRepoInfo, index: &FileIndex) -> Option<Artifact> {
        let name = repo_name_lower(info);
        if !name.contains("nemotron")
            && !repo_tags_contain(info, "nemotron")
            && !repo_tags_contain(info, "asr")
        {
            return None;
        }
        let gguf_files: Vec<_> = index
            .paths()
            .filter(|p| p.ends_with(".gguf"))
            .collect();
        if gguf_files.is_empty() {
            return None;
        }
        let model_path = gguf_files
            .into_iter()
            .max_by_key(|p| index.size_of(p).unwrap_or(0))
            .map(|p| p.to_string())?;
        let files = vec![artifact_file(index, model_path.clone())];
        let download_size = total_download_size(&files);
        Some(Artifact {
            runtime: HfRuntime::NemotronAsr,
            kind: "nemotron-asr-gguf".to_string(),
            label: "Nemotron ASR GGUF model".to_string(),
            files,
            download_size_bytes: download_size,
            run_contract: RunContract::NemotronAsr {
                model_file: model_path,
            },
            estimated_memory_bytes: download_size.saturating_mul(2),
            confidence: if name.contains("nemotron") {
                DetectionConfidence::Exact
            } else {
                DetectionConfidence::Heuristic
            },
            metadata: BTreeMap::from([
                ("capability".to_string(), "asr".to_string()),
                ("supports_streaming".to_string(), "true".to_string()),
            ]),
        })
    }
}

/// All adapters, in the order they are evaluated.
pub fn all_adapters() -> Vec<Box<dyn RuntimeAdapter>> {
    vec![
        Box::new(WhisperCppAdapter),
        Box::new(SherpaOnnxSttAdapter),
        Box::new(SherpaOnnxTtsAdapter),
        Box::new(NemotronAsrAdapter),
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

    // ── Supertonic detection (change: add-supertonic-3-cross-platform-tts) ─

    /// The canonical sherpa export layout (all 7 files, int8).
    fn supertonic_files() -> Vec<HfFile> {
        vec![
            file("duration_predictor.int8.onnx", 3_700_147),
            file("text_encoder.int8.onnx", 36_416_150),
            file("vector_estimator.int8.onnx", 78_400_833),
            file("vocoder.int8.onnx", 25_991_073),
            file("tts.json", 8_253),
            file("unicode_indexer.bin", 262_144),
            file("voice.bin", 517_168),
        ]
    }

    #[test]
    fn detects_supertonic_seven_file_layout() {
        let info = repo(
            "csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11",
            &["text-to-speech"],
        );
        let idx = index(&supertonic_files());
        let artifact = SherpaOnnxTtsAdapter.detect_artifact(&info, &idx).expect("artifact");
        assert_eq!(artifact.runtime, HfRuntime::SherpaOnnxTts);
        assert_eq!(artifact.kind, "supertonic");
        assert_eq!(artifact.label, "Supertonic 3 (sherpa-onnx TTS)");
        assert_eq!(artifact.confidence, DetectionConfidence::Exact);
        assert_eq!(artifact.files.len(), 7);
        assert_eq!(
            artifact.download_size_bytes,
            145_295_768,
            "size is the sum of all seven assets"
        );
        // Memory estimate ×1.15 (same factor as sherpa STT).
        assert_eq!(
            artifact.estimated_memory_bytes,
            (145_295_768u64 as f64 * 1.15) as u64
        );
        assert_eq!(artifact.metadata.get("precision").map(String::as_str), Some("int8"));
        assert_eq!(artifact.metadata.get("family").map(String::as_str), Some("supertonic"));
        match &artifact.run_contract {
            RunContract::SherpaTts {
                family: Some(SherpaTtsFamily::Supertonic),
                model_file,
                text_encoder_file,
                vector_estimator_file,
                vocoder_file,
                tts_json_file,
                unicode_indexer_file,
                voice_bin_file,
                tokens_file,
                voices_file,
                ..
            } => {
                assert_eq!(model_file, "duration_predictor.int8.onnx");
                assert_eq!(text_encoder_file.as_deref(), Some("text_encoder.int8.onnx"));
                assert_eq!(
                    vector_estimator_file.as_deref(),
                    Some("vector_estimator.int8.onnx")
                );
                assert_eq!(vocoder_file.as_deref(), Some("vocoder.int8.onnx"));
                assert_eq!(tts_json_file.as_deref(), Some("tts.json"));
                assert_eq!(unicode_indexer_file.as_deref(), Some("unicode_indexer.bin"));
                assert_eq!(voice_bin_file.as_deref(), Some("voice.bin"));
                assert!(tokens_file.is_none() && voices_file.is_none());
            }
            other => panic!("expected supertonic contract, got {:?}", other),
        }
        // The contract must validate and be contained.
        assert!(artifact.run_contract.validate().is_ok());
        assert!(artifact.run_contract.paths_contained());
    }

    #[test]
    fn supertonic_each_missing_file_is_rejected() {
        let info = repo(
            "csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11",
            &["text-to-speech"],
        );
        let all = supertonic_files();
        for dropped in [
            "duration_predictor.int8.onnx",
            "text_encoder.int8.onnx",
            "vector_estimator.int8.onnx",
            "vocoder.int8.onnx",
            "tts.json",
            "unicode_indexer.bin",
            "voice.bin",
        ] {
            let files: Vec<HfFile> = all.iter().filter(|f| f.rfilename != dropped).cloned().collect();
            let idx = index(&files);
            assert!(
                SherpaOnnxTtsAdapter.detect_artifact(&info, &idx).is_none(),
                "missing {dropped} must reject the whole layout"
            );
        }
    }

    #[test]
    fn supertonic_mixed_precision_is_rejected() {
        let info = repo("somebody/supertonic-tts", &["text-to-speech"]);
        let mut files = supertonic_files();
        // Swap the vocoder to fp16 while the rest are int8 → no shared suffix.
        files[3] = file("vocoder.fp16.onnx", 51_982_146);
        let idx = index(&files);
        assert!(
            SherpaOnnxTtsAdapter.detect_artifact(&info, &idx).is_none(),
            "mixed-precision sets are rejected, not guessed"
        );
    }

    #[test]
    fn supertonic_arbitrary_multi_onnx_repo_is_not_misclassified() {
        // A split ASR-style encoder/decoder set plus a json/bin file or two
        // must never satisfy the Supertonic layout (it may legitimately match
        // the zipformer STT layout — that is a different adapter).
        let info = repo("somebody/split-asr-pipeline", &["automatic-speech-recognition"]);
        let idx = index(&[
            file("encoder.onnx", 100_000_000),
            file("decoder.onnx", 20_000_000),
            file("joiner.onnx", 1_000_000),
            file("tts.json", 8_253),
            file("unicode_indexer.bin", 262_144),
            file("voice.bin", 517_168),
        ]);
        let detected = detect_all(&info, &idx);
        assert!(
            detected.iter().all(|a| a.kind != "supertonic"),
            "arbitrary multi-ONNX repos must not be claimed as Supertonic"
        );
        // A TTS-tagged repo with an incomplete Supertonic layout must not
        // match anything: two of the four ONNX files missing ⇒ rejected.
        let info = repo("somebody/supertonic-tts", &["text-to-speech"]);
        let idx = index(&[
            file("duration_predictor.int8.onnx", 3_700_147),
            file("tts.json", 8_253),
            file("unicode_indexer.bin", 262_144),
            file("voice.bin", 517_168),
        ]);
        let detected = detect_all(&info, &idx);
        assert!(detected.is_empty(), "no supertonic/vits match for a near-miss repo");
    }

    #[test]
    fn upstream_supertone_fp32_layout_stays_blocked() {
        // The raw Supertone/supertonic-3 repo (fp32 under onnx/,
        // unicode_indexer.json, voice_styles/*.json) is not sherpa-loadable.
        let info = repo("Supertone/supertonic-3", &["text-to-speech"]);
        let idx = index(&[
            file("onnx/duration_predictor.onnx", 14_800_589),
            file("onnx/text_encoder.onnx", 145_664_601),
            file("onnx/vector_estimator.onnx", 313_603_341),
            file("onnx/vocoder.onnx", 103_964_297),
            file("unicode_indexer.json", 431_259),
            file("voice_styles/default.json", 2_048),
        ]);
        assert!(
            detect_all(&info, &idx).is_empty(),
            "upstream fp32 layout matches nothing"
        );
    }

    #[test]
    fn supertonic_repo_is_never_detected_as_stt() {
        let info = repo(
            "csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11",
            &["text-to-speech"],
        );
        let idx = index(&supertonic_files());
        assert!(SherpaOnnxSttAdapter.detect_artifact(&info, &idx).is_none());
        let detected = detect_all(&info, &idx);
        assert_eq!(detected.len(), 1);
        assert_eq!(detected[0].kind, "supertonic");
    }

    // ── contract serialization backward compatibility ──────────────────────

    #[test]
    fn legacy_sherpa_tts_rows_deserialize_and_infer_family() {
        // Rows written before families existed carry only these fields.
        let legacy_vits: RunContract = serde_json::from_str(
            r#"{"type":"sherpa-tts","model_file":"model.onnx","tokens_file":"tokens.txt"}"#,
        )
        .expect("legacy vits row deserializes");
        assert_eq!(legacy_vits.effective_tts_family(), Some(SherpaTtsFamily::Vits));

        let legacy_kokoro: RunContract = serde_json::from_str(
            r#"{"type":"sherpa-tts","model_file":"model.onnx","tokens_file":"tokens.txt","voices_file":"voices.bin"}"#,
        )
        .expect("legacy kokoro row deserializes");
        assert_eq!(legacy_kokoro.effective_tts_family(), Some(SherpaTtsFamily::Kokoro));
    }

    #[test]
    fn supertonic_contract_round_trips_with_family() {
        let original = RunContract::SherpaTts {
            family: Some(SherpaTtsFamily::Supertonic),
            model_file: "duration_predictor.int8.onnx".to_string(),
            tokens_file: None,
            voices_file: None,
            text_encoder_file: Some("text_encoder.int8.onnx".to_string()),
            vector_estimator_file: Some("vector_estimator.int8.onnx".to_string()),
            vocoder_file: Some("vocoder.int8.onnx".to_string()),
            tts_json_file: Some("tts.json".to_string()),
            unicode_indexer_file: Some("unicode_indexer.bin".to_string()),
            voice_bin_file: Some("voice.bin".to_string()),
            data_dir: None,
        };
        let json = serde_json::to_string(&original).unwrap();
        assert!(json.contains("\"family\":\"supertonic\""), "{json}");
        assert!(json.contains("\"type\":\"sherpa-tts\""), "{json}");
        let back: RunContract = serde_json::from_str(&json).unwrap();
        assert_eq!(back, original);
        assert_eq!(back.effective_tts_family(), Some(SherpaTtsFamily::Supertonic));
    }

    #[test]
    fn family_serde_matches_serialized_helper() {
        for family in [
            SherpaTtsFamily::Vits,
            SherpaTtsFamily::Kokoro,
            SherpaTtsFamily::Kitten,
            SherpaTtsFamily::Supertonic,
        ] {
            let value = serde_json::to_value(family).unwrap();
            assert_eq!(value.as_str(), Some(family.serialized()));
        }
    }

    #[test]
    fn contract_validation_rejects_half_filled_supertonic() {
        let incomplete = RunContract::SherpaTts {
            family: Some(SherpaTtsFamily::Supertonic),
            model_file: "duration_predictor.int8.onnx".to_string(),
            tokens_file: None,
            voices_file: None,
            text_encoder_file: None,
            vector_estimator_file: None,
            vocoder_file: None,
            tts_json_file: None,
            unicode_indexer_file: None,
            voice_bin_file: None,
            data_dir: None,
        };
        assert!(incomplete.validate().is_err());
        // Kokoro without voices is also invalid.
        let kokoro_no_voices = RunContract::SherpaTts {
            family: Some(SherpaTtsFamily::Kokoro),
            model_file: "model.onnx".to_string(),
            tokens_file: Some("tokens.txt".to_string()),
            voices_file: None,
            text_encoder_file: None,
            vector_estimator_file: None,
            vocoder_file: None,
            tts_json_file: None,
            unicode_indexer_file: None,
            voice_bin_file: None,
            data_dir: None,
        };
        assert!(kokoro_no_voices.validate().is_err());
    }

    #[test]
    fn containment_validation_rejects_traversal_in_every_new_field() {
        let fields: [&str; 8] = [
            "model_file",
            "tokens_file",
            "voices_file",
            "text_encoder_file",
            "vector_estimator_file",
            "vocoder_file",
            "tts_json_file",
            "unicode_indexer_file",
        ];
        for field in fields {
            let contract = RunContract::SherpaTts {
                family: Some(SherpaTtsFamily::Supertonic),
                model_file: if field == "model_file" {
                    "../evil.onnx".to_string()
                } else {
                    "duration_predictor.int8.onnx".to_string()
                },
                tokens_file: Some(if field == "tokens_file" {
                    "../evil.txt".to_string()
                } else {
                    "tokens.txt".to_string()
                }),
                voices_file: Some(if field == "voices_file" {
                    "../evil.bin".to_string()
                } else {
                    "voices.bin".to_string()
                }),
                text_encoder_file: Some(if field == "text_encoder_file" {
                    "../evil.onnx".to_string()
                } else {
                    "text_encoder.int8.onnx".to_string()
                }),
                vector_estimator_file: Some(if field == "vector_estimator_file" {
                    "../evil.onnx".to_string()
                } else {
                    "vector_estimator.int8.onnx".to_string()
                }),
                vocoder_file: Some(if field == "vocoder_file" {
                    "../evil.onnx".to_string()
                } else {
                    "vocoder.int8.onnx".to_string()
                }),
                tts_json_file: Some(if field == "tts_json_file" {
                    "../evil.json".to_string()
                } else {
                    "tts.json".to_string()
                }),
                unicode_indexer_file: Some(if field == "unicode_indexer_file" {
                    "../evil.bin".to_string()
                } else {
                    "unicode_indexer.bin".to_string()
                }),
                voice_bin_file: Some("../evil.bin".to_string()),
                data_dir: None,
            };
            assert!(
                !contract.paths_contained(),
                "traversal in {field} must fail containment"
            );
        }
    }
}
