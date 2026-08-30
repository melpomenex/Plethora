//! Suitability classification (requirement #19, "Suitability classification
//! with explanation").
//!
//! Maps a candidate artifact + machine to Plethora's 5-level UX scale, always
//! with a human explanation and (where relevant) an explicit list of what the
//! model requires. Estimates are labeled as estimates — nothing here promises
//! performance. The evaluation uses the artifact the user will actually
//! install (its quantization/size), not the upstream full-precision repo.

use super::adapters::{Artifact, DetectionConfidence, HfRuntime, RunContract};
use super::system_info::SystemInfo;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SuitabilityLevel {
    Recommended,
    ShouldRun,
    MayRunSlowly,
    NotRecommended,
    UnsupportedRuntime,
}

impl SuitabilityLevel {
    pub fn label(self) -> &'static str {
        match self {
            SuitabilityLevel::Recommended => "Recommended",
            SuitabilityLevel::ShouldRun => "Should Run",
            SuitabilityLevel::MayRunSlowly => "May Run Slowly",
            SuitabilityLevel::NotRecommended => "Not Recommended",
            SuitabilityLevel::UnsupportedRuntime => "Unsupported Runtime",
        }
    }

    /// 0 = best … 4 = worst, for UI ordering/badge coloring.
    pub fn rank(self) -> u8 {
        match self {
            SuitabilityLevel::Recommended => 0,
            SuitabilityLevel::ShouldRun => 1,
            SuitabilityLevel::MayRunSlowly => 2,
            SuitabilityLevel::NotRecommended => 3,
            SuitabilityLevel::UnsupportedRuntime => 4,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Suitability {
    pub level: SuitabilityLevel,
    /// Human-readable explanation, e.g. "Requires ~12 GB VRAM; detected GPU has 8 GB."
    pub explanation: String,
    /// Concrete requirements the machine must meet (empty when none apply).
    pub requires: Vec<String>,
    /// Machine capabilities the check observed (for the UI detail panel).
    pub machine: MachineFacts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MachineFacts {
    pub has_gpu: bool,
    pub gpu_vram_bytes: Option<u64>,
    pub total_memory_bytes: u64,
    pub available_memory_bytes: u64,
    pub is_apple_silicon: bool,
    pub disk_free_bytes: Option<u64>,
}

fn gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
}

/// Classify a detected artifact (or absence of one) against the machine.
pub fn classify(system: &SystemInfo, artifact: Option<&Artifact>) -> Suitability {
    let machine = MachineFacts {
        has_gpu: system.gpu.is_some(),
        gpu_vram_bytes: system.gpu.as_ref().and_then(|g| g.vram_bytes),
        total_memory_bytes: system.total_memory_bytes,
        available_memory_bytes: system.available_memory_bytes,
        is_apple_silicon: system.is_apple_silicon,
        disk_free_bytes: system.disk_free_bytes,
    };

    let artifact = match artifact {
        Some(a) => a,
        None => {
            return Suitability {
                level: SuitabilityLevel::UnsupportedRuntime,
                explanation: "This repository contains no artifact runnable by any installed \
                              Plethora speech runtime (whisper.cpp ggml or sherpa-onnx ONNX). \
                              Installation is blocked. Only repos that expose a supported model \
                              file layout can be installed."
                    .to_string(),
                requires: vec![],
                machine,
            };
        }
    };

    // 1. Disk space — hard gate.
    let download = artifact.download_size_bytes;
    if let Some(free) = system.disk_free_bytes {
        if download > free {
            return Suitability {
                level: SuitabilityLevel::NotRecommended,
                explanation: format!(
                    "Estimated download is {} but only {} is free on the model drive. \
                     Free up space or choose a smaller model.",
                    gb(download),
                    gb(free)
                ),
                requires: vec![format!("{} free disk", gb(download))],
                machine,
            };
        }
    }

    // 2. Memory/VRAM sizing on the *actual artifact*.
    let needs = artifact.estimated_memory_bytes;

    // Sherpa-onnx TTS runs CPU-only in Plethora (the bundled onnxruntime is
    // the CPU build; no CUDA/DirectML/CoreML provider is configured for it),
    // so a discrete GPU never gates or improves the verdict — evaluate RAM.
    let cpu_first = artifact.runtime == HfRuntime::SherpaOnnxTts;

    // Apple Silicon: unified memory is the accelerator budget.
    if system.is_apple_silicon {
        let budget = system.available_memory_bytes;
        if needs > budget {
            return Suitability {
                level: SuitabilityLevel::NotRecommended,
                explanation: format!(
                    "This model needs ~{} of unified memory; only ~{} is available. It would swap \
                     and be unusable in practice.",
                    gb(needs),
                    gb(budget)
                ),
                requires: vec![format!("{} unified memory", gb(needs))],
                machine,
            };
        }
        if needs > budget / 2 {
            return Suitability {
                level: SuitabilityLevel::MayRunSlowly,
                explanation: format!(
                    "Compatible with Apple Silicon (unified memory) but requires ~{} of the ~{} \
                     available — expect slow inference and memory pressure.",
                    gb(needs),
                    gb(budget)
                ),
                requires: vec![format!("~{} unified memory", gb(needs))],
                machine,
            };
        }
        let base = if artifact.confidence == DetectionConfidence::Exact {
            SuitabilityLevel::Recommended
        } else {
            SuitabilityLevel::ShouldRun
        };
        return Suitability {
            level: base,
            explanation: format!(
                "Compatible with Apple Silicon via the {} runtime; needs ~{} of {} unified memory.",
                artifact.runtime.label(),
                gb(needs),
                gb(system.total_memory_bytes)
            ),
            requires: vec![],
            machine,
        };
    }

    // Discrete GPU with reported VRAM. Skipped for CPU-first (sherpa TTS)
    // runtimes — a big VRAM number must not turn a CPU verdict into a GPU one.
    if !cpu_first {
        if let Some(vram) = system.gpu.as_ref().and_then(|g| g.vram_bytes) {
        let is_nvidia = system.gpu.as_ref().map(|g| g.vendor == "nvidia").unwrap_or(false);
        let accelerator = if is_nvidia {
            "CUDA"
        } else {
            "GPU"
        };
        if needs > vram {
            // Too big for VRAM. If it also can't fit in RAM → hard no.
            if needs > system.available_memory_bytes {
                return Suitability {
                    level: SuitabilityLevel::NotRecommended,
                    explanation: format!(
                        "Requires ~{} — the detected GPU has {} VRAM and the model also won't fit \
                         in the {} of free RAM. No valid CPU/offload config exists.",
                        gb(needs),
                        gb(vram),
                        gb(system.available_memory_bytes)
                    ),
                    requires: vec![format!("{} {} VRAM", gb(needs), accelerator)],
                    machine,
                };
            }
            return Suitability {
                level: SuitabilityLevel::MayRunSlowly,
                explanation: format!(
                    "Requires ~{} but the detected GPU has {} VRAM. It would run CPU-offloaded \
                     (Requires Offload) — expect much slower inference.",
                    gb(needs),
                    gb(vram)
                ),
                requires: vec![format!("{} {} VRAM (or CPU offload)", gb(needs), accelerator)],
                machine,
            };
        }
        if needs > vram * 3 / 4 {
            return Suitability {
                level: SuitabilityLevel::ShouldRun,
                explanation: format!(
                    "Fits the {} of {} VRAM with limited headroom — should run but may contend \
                     with other GPU workloads.",
                    gb(vram),
                    accelerator
                ),
                requires: vec![],
                machine,
            };
        }
        let base = if artifact.confidence == DetectionConfidence::Exact {
            SuitabilityLevel::Recommended
        } else {
            SuitabilityLevel::ShouldRun
        };
        return Suitability {
            level: base,
            explanation: format!(
                "Fits comfortably in the {} of {} VRAM via the {} runtime.",
                gb(vram),
                accelerator,
                artifact.runtime.label()
            ),
            requires: vec![],
            machine,
        };
    }

    }

    // CPU-only (or GPU without reported VRAM): evaluate for CPU inference.
    let budget = system.available_memory_bytes;
    if needs > budget {
        return Suitability {
            level: SuitabilityLevel::NotRecommended,
            explanation: format!(
                "Compatible with CPU inference but requires ~{} RAM while only {} is available. \
                 It would thrash or fail to load.",
                gb(needs),
                gb(budget)
            ),
            requires: vec![format!("{} RAM", gb(needs))],
            machine,
        };
    }
    if needs > system.total_memory_bytes / 2 {
        return Suitability {
            level: SuitabilityLevel::MayRunSlowly,
            explanation: format!(
                "No GPU accelerator was detected, so this runs on CPU. At ~{} RAM this is a \
                 large model for a CPU-only machine — expect slow transcription.",
                gb(needs)
            ),
            requires: vec![format!("{} RAM", gb(needs))],
            machine,
        };
    }
    let base = if artifact.confidence == DetectionConfidence::Exact {
        SuitabilityLevel::ShouldRun
    } else {
        SuitabilityLevel::MayRunSlowly
    };
    Suitability {
        level: base,
        explanation: format!(
            "No GPU accelerator detected — this will run on CPU via the {} runtime. At ~{} RAM \
             it should run, but CPU inference is slower than GPU.",
            artifact.runtime.label(),
            gb(needs)
        ),
        requires: vec![format!("{} RAM", gb(needs))],
        machine,
    }
}

/// A short "how it runs" note for a TTS artifact, replacing the old
/// "desktop is STT-only" caveat: installed sherpa TTS models are now
/// synthesizable in-process on desktop (bundled sherpa-onnx C API runtime)
/// and natively on Android. CPU-first on every platform.
pub fn tts_runtime_note(artifact: &Artifact) -> String {
    match artifact.runtime {
        HfRuntime::SherpaOnnxTts => {
            let family = artifact
                .run_contract
                .effective_tts_family()
                .map(|f| f.label())
                .unwrap_or("TTS");
            format!(
                "Runs locally on this device via the bundled sherpa-onnx runtime (CPU, offline). \
                 {family} synthesis loads the model once, then streams sentence audio. On Android, \
                 the same model is played through the native sherpa TTS plugin."
            )
        }
        _ => String::new(),
    }
}

/// Hard gate re-checked server-side at install time: an artifact whose
/// download exceeds the free space on the model drive can never be installed —
/// even when the UI offered a "Not Recommended" override. Returns the error
/// message, or `None` when the machine has enough space (or disk could not be
/// measured).
pub fn disk_insufficient(system: &SystemInfo, artifact: &Artifact) -> Option<String> {
    system.disk_free_bytes.and_then(|free| {
        (artifact.download_size_bytes > free).then(|| {
            format!(
                "Not enough free disk space to install this model: it needs ~{} but only ~{} is \
                 free on the model drive.",
                gb(artifact.download_size_bytes),
                gb(free)
            )
        })
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::hf::adapters::{
        Artifact, DetectionConfidence, HfRuntime, RunContract, SherpaSttFamily,
    };

    fn gb(n: f64) -> u64 {
        (n * 1024.0 * 1024.0 * 1024.0) as u64
    }

    fn cpu_system(ram_gb: f64, disk_gb: f64) -> SystemInfo {
        SystemInfo {
            os: "Linux".into(),
            os_version: None,
            arch: "x86_64".into(),
            cpu_brand: Some("Test CPU".into()),
            logical_cores: 8,
            physical_cores: Some(8),
            total_memory_bytes: gb(ram_gb),
            available_memory_bytes: gb(ram_gb * 0.8),
            gpu: None,
            cuda_available: false,
            metal_available: false,
            is_apple_silicon: false,
            disk_free_bytes: Some(gb(disk_gb)),
            disk_total_bytes: Some(gb(disk_gb + 20.0)),
            supported_accelerators: vec!["CPU".into()],
        }
    }

    fn nvidia_system(vram_gb: f64, ram_gb: f64, disk_gb: f64) -> SystemInfo {
        SystemInfo {
            os: "Linux".into(),
            os_version: None,
            arch: "x86_64".into(),
            cpu_brand: Some("Test CPU".into()),
            logical_cores: 16,
            physical_cores: Some(16),
            total_memory_bytes: gb(ram_gb),
            available_memory_bytes: gb(ram_gb * 0.8),
            gpu: Some(crate::models::hf::system_info::GpuInfo {
                name: "NVIDIA RTX Test".into(),
                vram_bytes: Some(gb(vram_gb)),
                vendor: "nvidia".into(),
            }),
            cuda_available: true,
            metal_available: false,
            is_apple_silicon: false,
            disk_free_bytes: Some(gb(disk_gb)),
            disk_total_bytes: Some(gb(disk_gb + 20.0)),
            supported_accelerators: vec!["CUDA".into()],
        }
    }

    fn apple_silicon_system(mem_gb: f64, disk_gb: f64) -> SystemInfo {
        SystemInfo {
            os: "macOS".into(),
            os_version: Some("14.0".into()),
            arch: "aarch64".into(),
            cpu_brand: Some("Apple M2".into()),
            logical_cores: 8,
            physical_cores: Some(8),
            total_memory_bytes: gb(mem_gb),
            available_memory_bytes: gb(mem_gb * 0.8),
            gpu: Some(crate::models::hf::system_info::GpuInfo {
                name: "Apple Silicon (unified memory)".into(),
                vram_bytes: None,
                vendor: "apple".into(),
            }),
            cuda_available: false,
            metal_available: true,
            is_apple_silicon: true,
            disk_free_bytes: Some(gb(disk_gb)),
            disk_total_bytes: Some(gb(disk_gb + 20.0)),
            supported_accelerators: vec!["Metal".into()],
        }
    }

    fn artifact(runtime: HfRuntime, size_bytes: u64, confidence: DetectionConfidence) -> Artifact {
        let contract = match runtime {
            HfRuntime::WhisperCpp => RunContract::Whisper {
                model_file: "ggml-small.bin".into(),
            },
            HfRuntime::SherpaOnnxStt => RunContract::SherpaStt {
                family: SherpaSttFamily::NemoCtc,
                model_file: "model.int8.onnx".into(),
                decoder_file: None,
                joiner_file: None,
                tokens_file: Some("tokens.txt".into()),
                use_itn: false,
            },
            HfRuntime::SherpaOnnxTts => RunContract::SherpaTts {
                family: Some(crate::models::hf::adapters::SherpaTtsFamily::Vits),
                model_file: "model.onnx".into(),
                tokens_file: Some("tokens.txt".into()),
                voices_file: None,
                text_encoder_file: None,
                vector_estimator_file: None,
                vocoder_file: None,
                tts_json_file: None,
                unicode_indexer_file: None,
                voice_bin_file: None,
                data_dir: None,
            },
            HfRuntime::NemotronAsr => RunContract::NemotronAsr {
                encoder: "encoder.int8.onnx".into(),
                decoder: "decoder.int8.onnx".into(),
                joiner: "joiner.int8.onnx".into(),
                tokens: "tokens.txt".into(),
            },
        };
        Artifact {
            runtime,
            kind: "test".into(),
            label: "test artifact".into(),
            files: vec![],
            download_size_bytes: size_bytes,
            run_contract: contract,
            // Estimated inference memory scales with the artifact size.
            estimated_memory_bytes: (size_bytes as f64 * 1.2) as u64,
            confidence,
            metadata: Default::default(),
        }
    }

    // ── 5.1: compatible small models → Recommended / Should Run ────────────
    #[test]
    fn small_whisper_on_gpu_is_recommended() {
        let sys = nvidia_system(8.0, 32.0, 50.0);
        // ~500 MB ggml model → needs ~0.6 GB.
        let a = artifact(HfRuntime::WhisperCpp, 500 * 1024 * 1024, DetectionConfidence::Exact);
        let s = classify(&sys, Some(&a));
        assert_eq!(s.level, SuitabilityLevel::Recommended, "{}", s.explanation);
    }

    #[test]
    fn small_whisper_on_cpu_is_should_run() {
        let sys = cpu_system(16.0, 50.0);
        let a = artifact(HfRuntime::WhisperCpp, 500 * 1024 * 1024, DetectionConfidence::Exact);
        let s = classify(&sys, Some(&a));
        assert_eq!(s.level, SuitabilityLevel::ShouldRun, "{}", s.explanation);
        assert!(s.explanation.to_lowercase().contains("cpu"));
    }

    #[test]
    fn small_sherpa_onnx_on_cpu_is_should_run() {
        let sys = cpu_system(16.0, 50.0);
        let a = artifact(HfRuntime::SherpaOnnxStt, 120 * 1024 * 1024, DetectionConfidence::Exact);
        let s = classify(&sys, Some(&a));
        assert_eq!(s.level, SuitabilityLevel::ShouldRun, "{}", s.explanation);
    }

    // ── 5.2: incompatible architecture → Unsupported Runtime ───────────────
    #[test]
    fn no_artifact_is_unsupported_runtime() {
        let sys = cpu_system(32.0, 100.0);
        let s = classify(&sys, None);
        assert_eq!(s.level, SuitabilityLevel::UnsupportedRuntime);
        assert!(s.explanation.contains("unsupported") || s.explanation.contains("no artifact"));
    }

    // ── 5.3: insufficient VRAM → Not Recommended with explanation ──────────
    #[test]
    fn insufficient_vram_is_not_recommended_with_vram_explanation() {
        let sys = nvidia_system(8.0, 16.0, 100.0);
        // ~12 GB model (weights) → needs ~14.4 GB > 8 GB VRAM AND > 12.8 GB avail RAM.
        let a = artifact(HfRuntime::WhisperCpp, 12 * 1024 * 1024 * 1024, DetectionConfidence::Exact);
        let s = classify(&sys, Some(&a));
        assert_eq!(s.level, SuitabilityLevel::NotRecommended, "{}", s.explanation);
        assert!(s.explanation.contains("VRAM"), "{}", s.explanation);
        assert!(s.explanation.contains("8"), "{}", s.explanation);
    }

    #[test]
    fn oversized_for_vram_but_fits_ram_is_may_run_slowly() {
        let sys = nvidia_system(8.0, 64.0, 100.0);
        // ~10 GB model → needs ~12 GB > 8 GB VRAM but < 51 GB avail RAM.
        let a = artifact(HfRuntime::WhisperCpp, 10 * 1024 * 1024 * 1024, DetectionConfidence::Exact);
        let s = classify(&sys, Some(&a));
        assert_eq!(s.level, SuitabilityLevel::MayRunSlowly, "{}", s.explanation);
        assert!(s.explanation.to_lowercase().contains("offload"), "{}", s.explanation);
    }

    // ── 5.4: CPU-only machine realistic warning ────────────────────────────
    #[test]
    fn cpu_only_large_model_warns_realistically() {
        let sys = cpu_system(8.0, 100.0);
        // ~6 GB model needs ~7.2 GB > 6.4 GB available RAM.
        let a = artifact(HfRuntime::WhisperCpp, 6 * 1024 * 1024 * 1024, DetectionConfidence::Exact);
        let s = classify(&sys, Some(&a));
        assert_eq!(s.level, SuitabilityLevel::NotRecommended, "{}", s.explanation);
        assert!(s.explanation.to_lowercase().contains("ram"), "{}", s.explanation);
    }

    #[test]
    fn cpu_only_medium_model_is_may_run_slowly() {
        let sys = cpu_system(16.0, 100.0);
        // ~8 GB model needs ~9.6 GB: > 8 GB (half of 16 total) but < 12.8 avail.
        let a = artifact(HfRuntime::WhisperCpp, 8 * 1024 * 1024 * 1024, DetectionConfidence::Exact);
        let s = classify(&sys, Some(&a));
        assert_eq!(s.level, SuitabilityLevel::MayRunSlowly, "{}", s.explanation);
    }

    // ── 5.5: Apple Silicon reasoning ────────────────────────────────────────
    #[test]
    fn apple_silicon_small_model_is_recommended() {
        let sys = apple_silicon_system(16.0, 50.0);
        let a = artifact(HfRuntime::WhisperCpp, 500 * 1024 * 1024, DetectionConfidence::Exact);
        let s = classify(&sys, Some(&a));
        assert_eq!(s.level, SuitabilityLevel::Recommended, "{}", s.explanation);
        assert!(s.explanation.contains("Apple Silicon"), "{}", s.explanation);
    }

    #[test]
    fn apple_silicon_large_model_is_may_run_slowly() {
        let sys = apple_silicon_system(8.0, 100.0);
        // ~4 GB model needs ~4.8 GB > 3.2 GB (half of 6.4 avail budget).
        let a = artifact(HfRuntime::WhisperCpp, 4 * 1024 * 1024 * 1024, DetectionConfidence::Exact);
        let s = classify(&sys, Some(&a));
        assert_eq!(s.level, SuitabilityLevel::MayRunSlowly, "{}", s.explanation);
    }

    #[test]
    fn apple_silicon_oversized_model_is_not_recommended() {
        let sys = apple_silicon_system(8.0, 100.0);
        // ~6 GB model needs ~7.2 GB > 6.4 GB available unified memory.
        let a = artifact(HfRuntime::WhisperCpp, 6 * 1024 * 1024 * 1024, DetectionConfidence::Exact);
        let s = classify(&sys, Some(&a));
        assert_eq!(s.level, SuitabilityLevel::NotRecommended, "{}", s.explanation);
    }

    // ── 5.6: insufficient disk → blocked ───────────────────────────────────
    #[test]
    fn insufficient_disk_is_blocked() {
        let sys = cpu_system(32.0, 2.0); // only 2 GB free
        let a = artifact(HfRuntime::WhisperCpp, 3 * 1024 * 1024 * 1024, DetectionConfidence::Exact);
        let s = classify(&sys, Some(&a));
        assert_eq!(s.level, SuitabilityLevel::NotRecommended, "{}", s.explanation);
        assert!(s.explanation.to_lowercase().contains("free"), "{}", s.explanation);
        assert!(s.requires.iter().any(|r| r.contains("3.0 GB")), "{:?}", s.requires);
    }

    // Suitability evaluates the ACTUAL artifact (quantized) not the repo-wide size.
    #[test]
    fn suitability_evaluates_chosen_artifact_not_repo_total() {
        let sys = cpu_system(8.0, 100.0);
        // Small int8 artifact (~120 MB) — even though the repo "download_size"
        // might be huge, classification uses the artifact.
        let a = artifact(HfRuntime::SherpaOnnxStt, 120 * 1024 * 1024, DetectionConfidence::Exact);
        let s = classify(&sys, Some(&a));
        assert_eq!(s.level, SuitabilityLevel::ShouldRun, "{}", s.explanation);
    }

    // ── install-time disk re-check (hard gate) ─────────────────────────────
    #[test]
    fn disk_insufficient_blocks_when_download_exceeds_free_space() {
        let sys = cpu_system(32.0, 2.0); // only 2 GB free
        let a = artifact(HfRuntime::WhisperCpp, 3 * 1024 * 1024 * 1024, DetectionConfidence::Exact);
        let msg = disk_insufficient(&sys, &a).expect("disk gate trips");
        assert!(msg.to_lowercase().contains("free disk space"), "{}", msg);
        assert!(msg.contains("3.0 GB"), "{}", msg);
    }

    #[test]
    fn disk_insufficient_passes_when_space_is_enough() {
        let sys = cpu_system(32.0, 100.0);
        let a = artifact(HfRuntime::WhisperCpp, 3 * 1024 * 1024 * 1024, DetectionConfidence::Exact);
        assert!(disk_insufficient(&sys, &a).is_none());
    }

    #[test]
    fn disk_insufficient_passes_when_disk_is_unknown() {
        let mut sys = cpu_system(32.0, 2.0);
        sys.disk_free_bytes = None;
        let a = artifact(HfRuntime::WhisperCpp, 3 * 1024 * 1024 * 1024, DetectionConfidence::Exact);
        assert!(disk_insufficient(&sys, &a).is_none());
    }
}
