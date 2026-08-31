//! Out-of-the-box NVIDIA GPU runtime for local speech-to-text.
//!
//! The sherpa-onnx sidecar bundled with the app is a CPU-only build, so on an
//! NVIDIA machine the engine would pick CUDA, launch the sidecar with
//! `--provider=cuda`, and watch it print "Please compile with
//! -DSHERPA_ONNX_ENABLE_GPU=ON … Fallback to cpu!" — the "GPU unavailable"
//! toast. This module fixes that end to end, with **zero manual steps** for
//! the user:
//!
//! - The NVIDIA driver is detected from `/proc/driver/nvidia/version` (no
//!   `nvidia-smi` dependency) and its major version selects a *flavor*:
//!   ≥ 580 → CUDA 13, ≥ 525 → CUDA 12, older → CPU only with an honest
//!   reason string.
//! - On first use the app provisions the flavor into app data
//!   (`<app_data>/transcription-gpu-runtime/`): the CUDA-enabled k2-fsa
//!   sherpa-onnx release (same v1.13.6 as the CPU pin), the CUDA/cuDNN
//!   shared libraries the CUDA execution provider dynamically links (from
//!   NVIDIA's PyPI wheels — distro-agnostic, no CUDA toolkit install), and
//!   the fp32 export of the Nemotron model that GPU sessions actually run
//!   (the int8 bundle has no CUDA kernels — see FP32_MODEL_FILES). ~4 GB
//!   one-time, downloaded with the resumable/hash-verified downloader the
//!   HF model manager uses, with `gpu-runtime://` progress events and
//!   cancel support.
//! - The engine then spawns the GPU binaries from app data with
//!   `LD_LIBRARY_PATH` pointed at the provisioned `lib/` dir (the Tauri
//!   externalBin mechanism cannot launch runtime-downloaded binaries, hence
//!   the absolute-path spawn path in `engine.rs`).
//!
//! Every artifact is pinned (URL + SHA-256 + size). Release assets and PyPI
//! wheels are immutable, so the pins only ever change deliberately. Digests
//! were recorded on 2026-08-31 against:
//!   - k2-fsa/sherpa-onnx v1.13.6 GPU tarballs (cuda-13.x + cuda-12.x), and
//!   - the NVIDIA PyPI wheels listed in the flavor tables below.
//!
//! Integrity protocol: each archive's SHA-256 is verified *before* extraction
//! (`download_file_with_sink`); the five sherpa files additionally have
//! per-file pinned hashes checked after extraction; a `manifest.json`
//! (path → size [+ hash]) is written at install and re-verified (existence +
//! size, cheap) on every status read so an externally damaged runtime is
//! never reported ready. CPU transcription is never blocked by any of this —
//! before, during, and after provisioning the bundled CPU sidecar keeps
//! working.

use crate::models::hf::commands::ActiveHfDownloads;
use crate::models::hf::downloader::download_file_with_sink;
use crate::models::hf::hf_client::hf_download_client;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;

/// In-flight install id (also the cancel key + progress event correlation).
pub const GPU_RUNTIME_ID: &str = "gpu-runtime";

/// Directory name under app data holding the provisioned runtime.
pub const RUNTIME_DIR_NAME: &str = "transcription-gpu-runtime";
/// Sibling staging dir used while an install is in flight.
const STAGING_DIR_NAME: &str = "transcription-gpu-runtime.staging";

/// Events (payloads below). The settings card listens to all three.
pub const GPU_PROGRESS_EVENT: &str = "gpu-runtime://install-progress";
pub const GPU_FINISHED_EVENT: &str = "gpu-runtime://install-finished";
pub const GPU_STATUS_EVENT: &str = "gpu-runtime://status-changed";

/// Minimum NVIDIA driver branch that can load CUDA 13 user-mode libraries.
const CUDA_13_MIN_DRIVER_MAJOR: u32 = 580;
/// Minimum driver branch for CUDA 12 (the CUDA 12.0 baseline driver).
const CUDA_12_MIN_DRIVER_MAJOR: u32 = 525;

/// Version of the pinned sherpa-onnx release. Must stay in sync with
/// `SHERPA_ONNX_VERSION` in scripts/download-sidecars.js (the CPU bundle).
pub const SHERPA_GPU_VERSION: &str = "v1.13.6";

/// Layout revision of the provisioned runtime. Bump whenever the artifact
/// set changes shape (existing installs re-provision on next use).
/// 1 = binaries + CUDA libs; 2 = + fp32 model (see FP32_MODEL_FILES).
pub const GPU_RUNTIME_SPEC: u32 = 2;

// ─────────────────────────────────────────────────────────────────────────────
// Flavor detection
// ─────────────────────────────────────────────────────────────────────────────

/// A provisionable CUDA flavor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuFlavor {
    Cuda13,
    Cuda12,
}

impl GpuFlavor {
    pub fn tag(self) -> &'static str {
        match self {
            GpuFlavor::Cuda13 => "cuda-13",
            GpuFlavor::Cuda12 => "cuda-12",
        }
    }

    fn from_tag(tag: &str) -> Option<Self> {
        match tag {
            "cuda-13" => Some(GpuFlavor::Cuda13),
            "cuda-12" => Some(GpuFlavor::Cuda12),
            _ => None,
        }
    }

    /// The flavor's artifact set (tarball + wheels), pinned.
    fn artifacts(self) -> Vec<PinnedArtifact> {
        let mut all = vec![match self {
            GpuFlavor::Cuda13 => SHERPA_TARBALL_CUDA_13,
            GpuFlavor::Cuda12 => SHERPA_TARBALL_CUDA_12,
        }];
        all.extend(match self {
            GpuFlavor::Cuda13 => CUDA_13_WHEELS,
            GpuFlavor::Cuda12 => CUDA_12_WHEELS,
        });
        all.extend(FP32_MODEL_FILES);
        all
    }

    /// Total download size of the flavor's artifact set.
    pub fn download_size_bytes(self) -> u64 {
        self.artifacts().iter().map(|a| a.size).sum()
    }

    /// The shared libraries `libonnxruntime_providers_cuda.so` of this flavor
    /// dynamically links (verified via `ldd` against the pinned tarballs).
    /// Presence of every soname is checked after extraction.
    fn required_sonames(self) -> &'static [&'static str] {
        match self {
            GpuFlavor::Cuda13 => &[
                "libcudart.so.13",
                "libcublas.so.13",
                "libcublasLt.so.13",
                "libcurand.so.10",
                "libcufft.so.12",
                "libnvrtc.so.13",
                "libcudnn.so.9",
            ],
            GpuFlavor::Cuda12 => &[
                "libcudart.so.12",
                "libcublas.so.12",
                "libcublasLt.so.12",
                "libcurand.so.10",
                "libcufft.so.11",
                "libnvrtc.so.12",
                "libcudnn.so.9",
            ],
        }
    }

    /// Free-space gate covering staged archives + extracted files + the
    /// transient swap overlap (old runtime + staged new root).
    fn required_free_bytes(self) -> u64 {
        match self {
            // ~4.0 GB download (incl. fp32 model), ~5.2 GB on disk; peak
            // (old runtime + staged root + archives) ≈ 14.5 GB.
            GpuFlavor::Cuda13 => 15_000_000_000,
            // ~4.5 GB download, ~6.5 GB on disk; peak ≈ 17 GB.
            GpuFlavor::Cuda12 => 17_000_000_000,
        }
    }
}

/// Pick the flavor a driver major version can run. `None` = too old.
pub fn flavor_for_driver_major(major: u32) -> Option<GpuFlavor> {
    if major >= CUDA_13_MIN_DRIVER_MAJOR {
        Some(GpuFlavor::Cuda13)
    } else if major >= CUDA_12_MIN_DRIVER_MAJOR {
        Some(GpuFlavor::Cuda12)
    } else {
        None
    }
}

/// Parse the major component of an NVRM version string like "595.84".
pub fn driver_version_major(version: &str) -> Option<u32> {
    version.trim().split('.').next()?.parse().ok()
}

/// Detect the NVIDIA driver version from `/proc/driver/nvidia/version`
/// (first line: `NVRM version: NVIDIA UNIX x86_64 Kernel Module  595.84  …`).
/// Reading /proc needs no `nvidia-smi` and works on headless boxes.
pub fn detect_nvidia_driver_version() -> Option<String> {
    let content = std::fs::read_to_string("/proc/driver/nvidia/version").ok()?;
    let first = content.lines().next()?;
    // "Kernel Module" is followed by the version token.
    let after = first.split("Kernel Module").nth(1)?;
    let token = after.split_whitespace().next()?;
    // Sanity: must look like a version number.
    driver_version_major(token)?;
    Some(token.to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// Pinned artifacts (recorded 2026-08-31 — see module doc)
// ─────────────────────────────────────────────────────────────────────────────

/// One downloadable artifact, fully pinned. Archives (tarball/wheels) are
/// extracted; `dest: Some(rel)` marks a plain file staged verbatim into the
/// runtime root (used for the fp32 model weights).
struct PinnedArtifact {
    label: &'static str,
    url: &'static str,
    sha256: &'static str,
    size: u64,
    dest: Option<&'static str>,
}

const SHERPA_TARBALL_CUDA_13: PinnedArtifact = PinnedArtifact {
    label: "sherpa-onnx GPU build (CUDA 13)",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.6/sherpa-onnx-v1.13.6-cuda-13.x-cudnn-9.x-onnxruntime1.27.1-linux-x64-gpu.tar.bz2",
    sha256: "a1b18fab3000752790212c0081bf8fcce65c211414e232cd30955e1699ff3de1",
    size: 229_584_590,
    dest: None,
};

const SHERPA_TARBALL_CUDA_12: PinnedArtifact = PinnedArtifact {
    label: "sherpa-onnx GPU build (CUDA 12)",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.6/sherpa-onnx-v1.13.6-cuda-12.x-cudnn-9.x-onnxruntime1.27.1-linux-x64-gpu.tar.bz2",
    sha256: "0b13ee885cc2f6083ff21b4ca977cf2baf62af0caf33f597d9dc48938d6017c5",
    size: 238_970_704,
    dest: None,
};

/// NVIDIA PyPI wheels for the CUDA 13 flavor (unified package names).
/// Layout inside: `nvidia/cu13/lib/*.so*` (companion libs like
/// `libnvrtc-builtins` ship alongside the primary soname, so extraction
/// copies *every* shared lib from the wheel).
const CUDA_13_WHEELS: [PinnedArtifact; 6] = [
    PinnedArtifact {
        label: "CUDA runtime",
        url: "https://files.pythonhosted.org/packages/97/be/5699b6e642b372f7d24c59c2f41383e2696825e20bab85f7399c7c6a56f7/nvidia_cuda_runtime-13.3.29-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl",
        sha256: "e04420616e72f563167a7733272992d7e6df6dc5cb54b2f94f9f1520ea9e30c1",
        size: 2_339_786,
        dest: None,
    },
    PinnedArtifact {
        label: "cuBLAS",
        url: "https://files.pythonhosted.org/packages/dd/e9/288a93d8234b8f8ea0ccac7b8cc5d7aa4c663d9676c64f4a2eb3a1f9ffc4/nvidia_cublas-13.6.1.10-py3-none-manylinux_2_27_x86_64.whl",
        sha256: "feb2ed8a1e211bc5774413efc0f1a08c4d5269b56f68b4ac6fe5408e57f7dc1c",
        size: 410_475_904,
        dest: None,
    },
    PinnedArtifact {
        label: "CUDA NVRTC",
        url: "https://files.pythonhosted.org/packages/8b/2c/86916c8a34dcdb0c3ddd1c0e30545041bd781184e437b9cb76fcda70560b/nvidia_cuda_nvrtc-13.3.33-py3-none-manylinux2010_x86_64.manylinux_2_12_x86_64.whl",
        sha256: "82530788b8c6164a54d3fd9ae8bcca8893d397c4aeb998861982a03bbe41e204",
        size: 51_110_910,
        dest: None,
    },
    PinnedArtifact {
        label: "cuFFT",
        url: "https://files.pythonhosted.org/packages/e7/00/fab4a29fa1d7eb43bc6b94de4e86312c5e425d5582e58b9641300b9dffc7/nvidia_cufft-12.3.0.29-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl",
        sha256: "edb25c0626bd202ee5acc035b5dd361a3b89ed3b75a81a52df72c89150cb57c2",
        size: 184_730_406,
        dest: None,
    },
    PinnedArtifact {
        label: "cuRAND",
        url: "https://files.pythonhosted.org/packages/ee/49/4ca4ce4a9334c9a1ef68ab85b358f019bf85e8c3f51c2471d4cc257a273d/nvidia_curand-10.4.3.29-py3-none-manylinux_2_27_x86_64.whl",
        sha256: "1859bf37a62754d2c65001393096ca79de399f995971fa7826d0adfd88c3cf7b",
        size: 60_023_614,
        dest: None,
    },
    PinnedArtifact {
        label: "cuDNN 9",
        url: "https://files.pythonhosted.org/packages/f9/df/15839f2ac0074db8a3b77dccfa91fad2e90c480ad5143c25a7733c50870e/nvidia_cudnn_cu13-9.25.1.1-py3-none-manylinux_2_27_x86_64.whl",
        sha256: "195199e8c7f8bca0c366ea675dd2441a406646cf95a98bcda66c999d57dd1f26",
        size: 503_870_572,
        dest: None,
    },
];

/// NVIDIA PyPI wheels for the CUDA 12 flavor (legacy `-cu12` package names,
/// internal layout `nvidia/<component>/lib/*.so*`).
const CUDA_12_WHEELS: [PinnedArtifact; 6] = [
    PinnedArtifact {
        label: "CUDA runtime",
        url: "https://files.pythonhosted.org/packages/bc/46/a92db19b8309581092a3add7e6fceb4c301a3fd233969856a8cbf042cd3c/nvidia_cuda_runtime_cu12-12.9.79-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl",
        sha256: "25bba2dfb01d48a9b59ca474a1ac43c6ebf7011f1b0b8cc44f54eb6ac48a96c3",
        size: 3_493_179,
        dest: None,
    },
    PinnedArtifact {
        label: "cuBLAS",
        url: "https://files.pythonhosted.org/packages/cb/c0/0a517bfe63ccd3b92eb254d264e28fca3c7cab75d07daea315250fb1bf73/nvidia_cublas_cu12-12.9.2.10-py3-none-manylinux_2_27_x86_64.whl",
        sha256: "e4f53a8ca8c5d6e8c492d0d0a3d565ecb59a751b19cfdaa4f6da0ab2104c1702",
        size: 581_240_110,
        dest: None,
    },
    PinnedArtifact {
        label: "CUDA NVRTC",
        url: "https://files.pythonhosted.org/packages/b8/85/e4af82cc9202023862090bfca4ea827d533329e925c758f0cde964cb54b7/nvidia_cuda_nvrtc_cu12-12.9.86-py3-none-manylinux2010_x86_64.manylinux_2_12_x86_64.whl",
        sha256: "210cf05005a447e29214e9ce50851e83fc5f4358df8b453155d5e1918094dcb4",
        size: 89_568_129,
        dest: None,
    },
    PinnedArtifact {
        label: "cuFFT",
        url: "https://files.pythonhosted.org/packages/95/f4/61e6996dd20481ee834f57a8e9dca28b1869366a135e0d42e2aa8493bdd4/nvidia_cufft_cu12-11.4.1.4-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl",
        sha256: "c67884f2a7d276b4b80eb56a79322a95df592ae5e765cf1243693365ccab4e28",
        size: 200_877_592,
        dest: None,
    },
    PinnedArtifact {
        label: "cuRAND",
        url: "https://files.pythonhosted.org/packages/31/44/193a0e171750ca9f8320626e8a1f2381e4077a65e69e2fb9708bd479e34a/nvidia_curand_cu12-10.3.10.19-py3-none-manylinux_2_27_x86_64.whl",
        sha256: "49b274db4780d421bd2ccd362e1415c13887c53c214f0d4b761752b8f9f6aa1e",
        size: 68_295_626,
        dest: None,
    },
    PinnedArtifact {
        label: "cuDNN 9",
        url: "https://files.pythonhosted.org/packages/74/27/450c690b2ed878fd323dce0fcc6ed1746013210bc9c395f30eaf6fb03b09/nvidia_cudnn_cu12-9.25.1.1-py3-none-manylinux_2_27_x86_64.whl",
        sha256: "515df94e4060bb58c88588e46fb39a5df310659d2d98733d1697ed667b4895d1",
        size: 751_246_851,
        dest: None,
    },
];

/// The five files extracted from a sherpa GPU tarball, with their per-file
/// pinned hashes (post-extraction verification; the tarball itself is also
/// hash-verified before extraction). `tar_path` uses upstream's naming:
/// `sherpa-onnx` is the *online/streaming* CLI, `sherpa-onnx-offline` the
/// offline one — the same mapping download-sidecars.js applies.
struct SherpaFilePin {
    tar_path: &'static str,
    dest_path: &'static str,
    sha256: &'static str,
}

const SHERPA_FILES_CUDA_13: [SherpaFilePin; 5] = [
    SherpaFilePin {
        tar_path: "bin/sherpa-onnx",
        dest_path: "bin/sherpa-online",
        sha256: "b6e445c49ae874dc6dfc0e15e25b5172ab9d0fc68bb5dc974209a6549ff6ac26",
    },
    SherpaFilePin {
        tar_path: "bin/sherpa-onnx-offline",
        dest_path: "bin/sherpa-onnx",
        sha256: "a3778f34e5da61898c7acf928e70bc7d3eda6617ad40652dea35c12075e9d75d",
    },
    SherpaFilePin {
        tar_path: "lib/libonnxruntime.so",
        dest_path: "lib/libonnxruntime.so",
        sha256: "bd6591e07bac04657dddd92a4407f4b5aab8268e25b55d901e886648eeb7b8f6",
    },
    SherpaFilePin {
        tar_path: "lib/libonnxruntime_providers_cuda.so",
        dest_path: "lib/libonnxruntime_providers_cuda.so",
        sha256: "2e37efc8c17fb24f3d248b2fba74496e9c30f743492500aad834c618f99dd942",
    },
    SherpaFilePin {
        tar_path: "lib/libonnxruntime_providers_shared.so",
        dest_path: "lib/libonnxruntime_providers_shared.so",
        sha256: "c6a12593396095f5670160e284c35d1700b7708cf3037b7042e2a5200ccae772",
    },
];

const SHERPA_FILES_CUDA_12: [SherpaFilePin; 5] = [
    SherpaFilePin {
        tar_path: "bin/sherpa-onnx",
        dest_path: "bin/sherpa-online",
        sha256: "6f6e45929c3279a9fdaf1830c4b265eb779e2c478cd078d669df120b55173557",
    },
    SherpaFilePin {
        tar_path: "bin/sherpa-onnx-offline",
        dest_path: "bin/sherpa-onnx",
        sha256: "a89391343e8af5926b6d08e0866d594c676e514ed5e52d230fb7e063248a07f9",
    },
    SherpaFilePin {
        tar_path: "lib/libonnxruntime.so",
        dest_path: "lib/libonnxruntime.so",
        // Same onnxruntime build as the CUDA 13 tarball.
        sha256: "bd6591e07bac04657dddd92a4407f4b5aab8268e25b55d901e886648eeb7b8f6",
    },
    SherpaFilePin {
        tar_path: "lib/libonnxruntime_providers_cuda.so",
        dest_path: "lib/libonnxruntime_providers_cuda.so",
        sha256: "cffff5fe3aac14fe50eed1113757ac8318ee12ef307fcb9def35a24398ec0ce3",
    },
    SherpaFilePin {
        tar_path: "lib/libonnxruntime_providers_shared.so",
        dest_path: "lib/libonnxruntime_providers_shared.so",
        sha256: "c6a12593396095f5670160e284c35d1700b7708cf3037b7042e2a5200ccae772",
    },
];

/// The fp32 (unquantized) export of the pinned streaming Nemotron model.
/// GPU sessions run THIS variant, not the int8 bundle: int8 integer ops have
/// no CUDA kernels in onnxruntime and fall back to the (single-CLI-thread)
/// CPU provider, measuring at CPU parity or worse on an RTX 2060 Super —
/// while fp32 runs fully on CUDA at ~3.3× the bundled CPU path (RTF 0.045 vs
/// 0.15, 2026-08-31 benchmark) with no accuracy loss from quantization.
/// encoder.onnx carries its weights in the sidecar encoder.data (ONNX
/// external-data format) — the two must sit in the same directory.
const FP32_MODEL_REPO: &str = "csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-2026-06-11";
const FP32_MODEL_FILES: [PinnedArtifact; 5] = [
    PinnedArtifact {
        label: "Nemotron fp32 encoder",
        url: "https://huggingface.co/csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-2026-06-11/resolve/main/encoder.onnx",
        sha256: "f1e540e03cb2cc57f5c0f6416b893768cfda23e756bfc0a2c4d502a1350325af",
        size: 42_247_484,
        dest: Some("model/encoder.onnx"),
    },
    PinnedArtifact {
        label: "Nemotron fp32 encoder weights",
        url: "https://huggingface.co/csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-2026-06-11/resolve/main/encoder.data",
        sha256: "7584f85df76bc9ae6fbdfa53aa8d97b07a842525d1c501d536d77fd9e4f57ac7",
        size: 2_454_405_120,
        dest: Some("model/encoder.data"),
    },
    PinnedArtifact {
        label: "Nemotron fp32 decoder",
        url: "https://huggingface.co/csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-2026-06-11/resolve/main/decoder.onnx",
        sha256: "f9c59ee6fa130bc2ba349dbcbba7c74a4a960a98d4196295ba4e8e5d6bde6b68",
        size: 59_764_944,
        dest: Some("model/decoder.onnx"),
    },
    PinnedArtifact {
        label: "Nemotron fp32 joiner",
        url: "https://huggingface.co/csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-2026-06-11/resolve/main/joiner.onnx",
        sha256: "a6bd74c0a31cbde0da0368c1e29d171752108c7ad1231630e079a7d97ceee6f0",
        size: 37_824_291,
        dest: Some("model/joiner.onnx"),
    },
    PinnedArtifact {
        label: "Nemotron fp32 tokens",
        url: "https://huggingface.co/csukuangfj2/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-2026-06-11/resolve/main/tokens.txt",
        sha256: "729cc103155bafa785f9cd45746cd41cabe97eab7182fc04d594129587958f8a",
        size: 131_440,
        dest: Some("model/tokens.txt"),
    },
];

fn sherpa_files(flavor: GpuFlavor) -> &'static [SherpaFilePin; 5] {
    match flavor {
        GpuFlavor::Cuda13 => &SHERPA_FILES_CUDA_13,
        GpuFlavor::Cuda12 => &SHERPA_FILES_CUDA_12,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────────────────

/// One fully-evaluated answer to "can we run GPU transcription right now?".
/// Serialized (camelCase) to the frontend via `gpu_runtime_status` and the
/// `gpu-runtime://status-changed` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuRuntimeStatus {
    /// An NVIDIA driver was detected at all.
    pub nvidia_detected: bool,
    pub driver_version: Option<String>,
    /// A flavor exists for this driver (driver new enough + Linux x64).
    pub supported: bool,
    /// "cuda-13" | "cuda-12" when supported.
    pub flavor: Option<&'static str>,
    /// The provisioned runtime is on disk and verified.
    pub installed: bool,
    /// An install is currently in flight.
    pub installing: bool,
    /// Ready to be used by the engine: supported && installed.
    pub ready: bool,
    /// Human-readable explanation when not ready.
    pub reason: Option<String>,
    /// One-time download size for this flavor (for the settings disclosure).
    pub download_size_bytes: u64,
    /// Current size of the provisioned runtime on disk.
    pub on_disk_bytes: u64,
}

/// Manifest written at install time and re-verified on every status read.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuRuntimeManifest {
    pub flavor: String,
    pub sherpa_version: String,
    /// Layout revision this runtime was provisioned with (GPU_RUNTIME_SPEC).
    #[serde(default)]
    pub spec: u32,
    pub created_at: String,
    /// Relative path (forward slashes) → file record.
    pub files: HashMap<String, ManifestFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFile {
    pub size: u64,
    /// Recorded at install; the sherpa five carry their pinned hashes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

/// Where the provisioned runtime lives (independent of install state).
pub fn runtime_root<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let data = app.path().app_data_dir().ok()?;
    Some(data.join(RUNTIME_DIR_NAME))
}

/// Verified runtime root — `None` unless the manifest checks out on disk.
pub fn verified_runtime_root<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let root = runtime_root(app)?;
    verify_manifest(&root).map(|_| root)
}

/// Path of a GPU sidecar binary (`sherpa-online` / `sherpa-onnx`), when the
/// runtime is installed and verified.
pub fn runtime_bin<R: tauri::Runtime>(app: &AppHandle<R>, name: &str) -> Option<PathBuf> {
    verified_runtime_root(app).map(|root| root.join("bin").join(name))
}

/// Path of the GPU runtime's shared-library dir, when verified.
pub fn runtime_lib_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    verified_runtime_root(app).map(|root| root.join("lib"))
}

/// Directory of the fp32 model files GPU sessions prefer (see
/// FP32_MODEL_FILES). `None` unless the whole runtime verifies — the spec
/// check covers the model files, so existence here means usable.
pub fn runtime_fp32_model_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    verified_runtime_root(app).map(|root| root.join("model"))
}

/// Load + verify the manifest at `root`: every recorded file must exist with
/// the exact recorded size. Cheap by design (no hashing) so status reads and
/// spawn-time checks stay fast; corruption is caught by size drift and at
/// install time by full hash verification.
pub fn verify_manifest(root: &Path) -> Option<GpuRuntimeManifest> {
    let manifest_path = root.join("manifest.json");
    let raw = std::fs::read_to_string(manifest_path).ok()?;
    let manifest: GpuRuntimeManifest = serde_json::from_str(&raw).ok()?;
    if manifest.files.is_empty() || manifest.spec != GPU_RUNTIME_SPEC {
        // Wrong/old layout: not usable → caller re-provisions.
        return None;
    }
    for (rel, file) in &manifest.files {
        let path = root.join(rel.replace('\\', "/"));
        let meta = std::fs::metadata(&path).ok()?;
        if !meta.is_file() || meta.len() != file.size {
            return None;
        }
    }
    Some(manifest)
}

fn is_installing<R: tauri::Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<crate::models::hf::commands::ActiveHfDownloads>()
        .map(|state| {
            state
                .map
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .contains_key(GPU_RUNTIME_ID)
        })
        .unwrap_or(false)
}

/// Total size of the runtime dir (0 when absent) — reported for the UI.
fn dir_size_bytes(root: &Path) -> u64 {
    let mut total = 0u64;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                total += meta.len();
            }
        }
    }
    total
}

/// Evaluate the full GPU runtime status. Pure read — no side effects.
pub fn evaluate<R: tauri::Runtime>(app: &AppHandle<R>) -> GpuRuntimeStatus {
    let driver = detect_nvidia_driver_version();
    let nvidia_detected = driver.is_some();
    let flavor = driver
        .as_deref()
        .and_then(driver_version_major)
        .and_then(flavor_for_driver_major);

    let installing = is_installing(app);
    let root = runtime_root(app);
    let verified = root.as_deref().and_then(verify_manifest).is_some();
    let on_disk = root.as_deref().map(dir_size_bytes).unwrap_or(0);

    let (supported, flavor_tag, reason) = match (&driver, flavor) {
        (None, _) => (
            false,
            None,
            Some("No NVIDIA GPU driver detected".to_string()),
        ),
        (Some(v), None) => (
            false,
            None,
            Some(format!(
                "NVIDIA driver {v} is too old for CUDA (needs ≥ {CUDA_12_MIN_DRIVER_MAJOR}.x)"
            )),
        ),
        (Some(_), Some(f)) => (true, Some(f.tag()), None),
    };

    let reason = if !supported {
        reason
    } else if verified {
        None
    } else if installing {
        Some("Downloading the GPU runtime…".to_string())
    } else {
        Some("GPU runtime not installed yet — it downloads automatically the first time local GPU transcription runs".to_string())
    };

    GpuRuntimeStatus {
        nvidia_detected,
        driver_version: driver,
        supported,
        flavor: flavor_tag,
        installed: verified,
        installing,
        ready: supported && verified,
        reason,
        download_size_bytes: flavor.map(|f| f.download_size_bytes()).unwrap_or(0),
        on_disk_bytes: on_disk,
    }
}

fn emit_status<R: tauri::Runtime>(app: &AppHandle<R>) {
    let _ = app.emit(GPU_STATUS_EVENT, evaluate(app));
}

// ─────────────────────────────────────────────────────────────────────────────
// Install / cancel / uninstall
// ─────────────────────────────────────────────────────────────────────────────

/// Progress payload for `gpu-runtime://install-progress`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInstallProgress {
    /// "downloading" | "extracting" | "verifying"
    pub stage: &'static str,
    pub label: String,
    pub received: u64,
    pub total: u64,
    pub percent: f32,
}

/// Terminal payload for `gpu-runtime://install-finished`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInstallFinished {
    pub ok: bool,
    pub message: String,
}

/// Fire-and-forget auto-provision: kicks off an install when the machine can
/// run one and doesn't already have it. Called from the engine (when a job
/// would have used the GPU) and after the Nemotron model installs. Safe to
/// call repeatedly — the in-flight guard dedupes.
pub fn ensure_installed<R: tauri::Runtime>(app: &AppHandle<R>) {
    let status = evaluate(app);
    if !status.supported || status.installed || status.installing {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let cancel = CancellationToken::new();
        if let Err(err) = install(&app, cancel).await {
            tracing::warn!(error = %err, "GPU runtime auto-provisioning failed");
        }
    });
}

/// Cancel an in-flight install (idempotent, not an error when none).
pub fn cancel_install<R: tauri::Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<ActiveHfDownloads>()
        .map(|state| state.cancel(GPU_RUNTIME_ID))
        .unwrap_or(false)
}

/// RAII in-flight guard (mirrors hf::commands::ActiveDownloadGuard, kept
/// generic over the runtime so tests can drive it with a mock app).
struct InFlightGuard<R: tauri::Runtime> {
    app: AppHandle<R>,
}

impl<R: tauri::Runtime> Drop for InFlightGuard<R> {
    fn drop(&mut self) {
        if let Some(state) = self.app.try_state::<ActiveHfDownloads>() {
            state.unregister(GPU_RUNTIME_ID);
        }
    }
}

/// Remove the provisioned runtime (and any staging leftovers). Containment:
/// only the two fixed directories under app data are ever deleted.
pub fn uninstall<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<()> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow!("Could not resolve app data dir: {e}"))?;
    let root = data.join(RUNTIME_DIR_NAME);
    let staging = data.join(STAGING_DIR_NAME);
    crate::models::hf::downloader::remove_dir_if_exists(&root)
        .map_err(|e| anyhow!("Failed to remove {}: {e}", root.display()))?;
    crate::models::hf::downloader::remove_dir_if_exists(&staging)
        .map_err(|e| anyhow!("Failed to remove {}: {e}", staging.display()))?;
    emit_status(app);
    Ok(())
}

/// Download + provision the GPU runtime for the detected flavor.
///
/// Emits `gpu-runtime://install-progress` throughout (weighted across the
/// whole artifact set, not per file), `gpu-runtime://install-finished` at the
/// end, and `gpu-runtime://status-changed` on every state transition.
pub async fn install<R: tauri::Runtime>(app: &AppHandle<R>, cancel: CancellationToken) -> Result<()> {
    let status = evaluate(app);
    if !status.supported {
        return Err(anyhow!(
            "{}",
            status.reason.unwrap_or_else(|| "GPU runtime not supported here".into())
        ));
    }
    if status.installed {
        return Ok(());
    }
    let flavor = flavor_for_driver_major(
        driver_version_major(&status.driver_version.expect("supported implies driver")).expect(
            "supported implies a parseable driver version",
        ),
    )
    .expect("supported implies a flavor");

    // In-flight guard: same registry the HF installs use, so the engine's
    // auto-provision and a manual settings install can never run twice.
    let registered = app
        .try_state::<ActiveHfDownloads>()
        .map(|state| state.try_register(GPU_RUNTIME_ID, cancel.clone()))
        .unwrap_or(true);
    if !registered {
        return Err(anyhow!(
            "The GPU runtime is already downloading; wait for it to finish or cancel it first"
        ));
    }
    let _guard = InFlightGuard { app: app.clone() };
    emit_status(app);

    let finish = |ok: bool, message: String| {
        let _ = app.emit(
            GPU_FINISHED_EVENT,
            GpuInstallFinished {
                ok,
                message: message.clone(),
            },
        );
        emit_status(app);
    };

    if let Err(err) = install_inner(app, flavor, &cancel).await {
        finish(false, err.to_string());
        return Err(err);
    }
    finish(true, "GPU runtime installed".to_string());
    Ok(())
}

async fn install_inner<R: tauri::Runtime>(
    app: &AppHandle<R>,
    flavor: GpuFlavor,
    cancel: &CancellationToken,
) -> Result<()> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow!("Could not resolve app data dir: {e}"))?;
    let final_root = data.join(RUNTIME_DIR_NAME);
    let staging_root = data.join(STAGING_DIR_NAME);

    // Disk gate: staged archives + extracted runtime + slack.
    if let Some((free, _total)) = crate::models::hf::system_info::volume_space(&data) {
        let needed = flavor.required_free_bytes();
        if free < needed {
            return Err(anyhow!(
                "Not enough free disk space for the GPU runtime: it needs ~{} but only ~{} is free.",
                humansize(needed),
                humansize(free)
            ));
        }
    }

    // Staging area: downloads/ (archives — KEPT across failed attempts so a
    // retry resumes instead of re-fetching ~4 GB), extract/ (tarball), root/
    // (the runtime as it will finally appear). Only the derived dirs are
    // cleared; a stale staging dir from an abandoned install is dropped by
    // `uninstall`.
    let downloads = staging_root.join("downloads");
    let extract = staging_root.join("extract");
    let root = staging_root.join("root");
    crate::models::hf::downloader::remove_dir_if_exists(&extract)
        .map_err(|e| anyhow!("Failed to clear the extract dir: {e}"))?;
    crate::models::hf::downloader::remove_dir_if_exists(&root)
        .map_err(|e| anyhow!("Failed to clear the staging root: {e}"))?;
    std::fs::create_dir_all(&downloads)?;
    std::fs::create_dir_all(&extract)?;
    std::fs::create_dir_all(root.join("bin"))?;
    std::fs::create_dir_all(root.join("lib"))?;

    // 1. Download every pinned archive with the resumable, hash-verifying
    //    downloader; overall progress is weighted by artifact size.
    let artifacts = flavor.artifacts();
    let grand_total: u64 = artifacts.iter().map(|a| a.size).sum();
    let mut completed_bytes: u64 = 0;
    let client = hf_download_client();
    for artifact in &artifacts {
        let dest = downloads.join(artifact_file_name(artifact)?);
        // A previous attempt already delivered this artifact verbatim (a
        // hash failure would have deleted it), so skip the re-download.
        if let Ok(meta) = std::fs::metadata(&dest) {
            if meta.len() == artifact.size {
                completed_bytes += artifact.size;
                continue;
            }
        }
        let label = artifact.label.to_string();
        let artifact_size = artifact.size;
        let app_for_sink = app.clone();
        let done_so_far = completed_bytes;
        let sink: Box<dyn FnMut(&crate::models::hf::downloader::InstallProgress) + Send + '_> =
            Box::new(move |p| {
                let received = done_so_far + p.received.min(artifact_size);
                let percent = if grand_total > 0 {
                    (received as f32 / grand_total as f32) * 90.0 // download = first 90%
                } else {
                    0.0
                };
                let _ = app_for_sink.emit(
                    GPU_PROGRESS_EVENT,
                    GpuInstallProgress {
                        stage: "downloading",
                        label: label.clone(),
                        received,
                        total: grand_total,
                        percent,
                    },
                );
            });
        download_file_with_sink(
            &client,
            artifact.url,
            &dest,
            Some(artifact.sha256),
            Some(artifact.size),
            sink,
            GPU_RUNTIME_ID,
            artifact.label,
            Some(cancel),
        )
        .await?;
        completed_bytes += artifact.size;
    }

    // 2. Extract. Tarball via the system `tar` (same approach as the sherpa
    //    model manager); wheels are zips — copy every shared library under
    //    nvidia/*/lib/ into root/lib (covers both the `nvidia/cu13/lib/` and
    //    `nvidia/<component>/lib/` layouts and companion libs like
    //    libnvrtc-builtins / the cuDNN family).
    let tarball = downloads.join(artifact_file_name(&artifacts[0])?);
    emit_stage(app, "extracting", artifacts[0].label, 92.0);
    let tar_output = tokio::process::Command::new("tar")
        .arg("-xjf")
        .arg(&tarball)
        .arg("-C")
        .arg(&extract)
        .output()
        .await
        .map_err(|e| anyhow!("Failed to run tar for the GPU runtime: {e}"))?;
    if !tar_output.status.success() {
        return Err(anyhow!(
            "tar failed to extract the sherpa GPU build: {}",
            String::from_utf8_lossy(&tar_output.stderr).trim()
        ));
    }

    // Locate the extracted top-level directory (sherpa-onnx-<ver>-…-gpu/).
    let tar_top = std::fs::read_dir(&extract)?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.is_dir() && p.join("bin").is_dir())
        .ok_or_else(|| anyhow!("sherpa GPU tarball did not contain a bin/ directory"))?;

    // Copy + rename the five pinned sherpa files, verifying each hash.
    emit_stage(app, "verifying", "sherpa-onnx GPU build", 94.0);
    for pin in sherpa_files(flavor) {
        let src = tar_top.join(pin.tar_path);
        let dest = root.join(pin.dest_path);
        std::fs::copy(&src, &dest)
            .map_err(|e| anyhow!("Failed to stage {}: {e}", pin.dest_path))?;
        let hash = crate::models::hf::downloader::sha256_of_file(&dest)?;
        if !hash.eq_ignore_ascii_case(pin.sha256) {
            return Err(anyhow!(
                "Integrity check failed for {}: the extracted file does not match the pinned build.",
                pin.dest_path
            ));
        }
        if pin.dest_path.starts_with("bin/") {
            set_executable(&dest)?;
        }
    }

    // Wheels → every shared lib under nvidia/*/lib/ into root/lib.
    emit_stage(app, "extracting", "CUDA libraries", 96.0);
    for artifact in artifacts.iter().filter(|a| a.url.ends_with(".whl")) {
        let wheel = downloads.join(artifact_file_name(artifact)?);
        extract_wheel_libs(&wheel, &root.join("lib"))?;
    }

    // Direct-file artifacts (the fp32 model): hash-verified by the
    // downloader already; stage them verbatim into root/model/.
    emit_stage(app, "extracting", "full-precision model", 97.0);
    for artifact in artifacts.iter().filter(|a| a.dest.is_some()) {
        let src = downloads.join(artifact_file_name(artifact)?);
        let dest = root.join(artifact.dest.expect("filtered on dest"));
        std::fs::create_dir_all(dest.parent().expect("dest has a parent"))?;
        std::fs::rename(&src, &dest)
            .map_err(|e| anyhow!("Failed to stage {}: {e}", artifact.label))?;
    }

    // 3. All sonames the CUDA execution provider links must be present.
    emit_stage(app, "verifying", "CUDA libraries", 98.0);
    for soname in flavor.required_sonames() {
        if !root.join("lib").join(soname).is_file() {
            return Err(anyhow!(
                "The GPU runtime is incomplete: {soname} is missing from the CUDA libraries."
            ));
        }
    }

    // 4. Manifest: record every file under root (size always; the sherpa
    //    five keep their pinned hashes for future deep verification).
    let mut manifest = GpuRuntimeManifest {
        flavor: flavor.tag().to_string(),
        sherpa_version: SHERPA_GPU_VERSION.to_string(),
        spec: GPU_RUNTIME_SPEC,
        created_at: chrono::Utc::now().to_rfc3339(),
        files: HashMap::new(),
    };
    record_files(&root, &root, &mut manifest)?;
    for pin in sherpa_files(flavor) {
        if let Some(entry) = manifest.files.get_mut(pin.dest_path) {
            entry.sha256 = Some(pin.sha256.to_string());
        }
    }
    let manifest_json = serde_json::to_string_pretty(&manifest)?;
    std::fs::write(root.join("manifest.json"), manifest_json)?;

    // 5. Atomic-ish swap: move any existing runtime aside, move the staged
    //    root into place, then drop the old copy + staging leftovers.
    emit_stage(app, "verifying", "finalizing", 99.0);
    crate::models::hf::downloader::remove_dir_if_exists(&downloads)?;
    let old = data.join(format!("{RUNTIME_DIR_NAME}.old"));
    crate::models::hf::downloader::remove_dir_if_exists(&old)?;
    if final_root.exists() {
        std::fs::rename(&final_root, &old)?;
    }
    if let Err(err) = std::fs::rename(&root, &final_root) {
        // Put any previous runtime back before failing.
        if old.exists() {
            let _ = std::fs::rename(&old, &final_root);
        }
        return Err(anyhow!("Failed to finalize the GPU runtime: {err}"));
    }
    crate::models::hf::downloader::remove_dir_if_exists(&old)?;
    crate::models::hf::downloader::remove_dir_if_exists(&staging_root)?;
    let _ = app.emit(
        GPU_PROGRESS_EVENT,
        GpuInstallProgress {
            stage: "verifying",
            label: "done".to_string(),
            received: grand_total,
            total: grand_total,
            percent: 100.0,
        },
    );
    Ok(())
}

fn emit_stage<R: tauri::Runtime>(app: &AppHandle<R>, stage: &'static str, label: &str, percent: f32) {
    let _ = app.emit(
        GPU_PROGRESS_EVENT,
        GpuInstallProgress {
            stage,
            label: label.to_string(),
            received: 0,
            total: 0,
            percent,
        },
    );
}

/// Last path segment of the artifact URL — its file name in staging.
fn artifact_file_name(artifact: &PinnedArtifact) -> Result<String> {
    artifact
        .url
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("Invalid artifact URL: {}", artifact.url))
}

/// Copy every `nvidia/*/lib/**.so*` entry of a wheel into `dest`.
/// Wheel digests were verified before extraction, so contents are trusted;
/// this is layout adaptation, not integrity enforcement.
fn extract_wheel_libs(wheel: &Path, dest: &Path) -> Result<()> {
    let file = std::fs::File::open(wheel)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| anyhow!("Failed to open wheel {}: {e}", wheel.display()))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| anyhow!("Failed to read wheel {}: {e}", wheel.display()))?;
        let name = entry.name().to_string();
        // Match nvidia/<component>/lib/<file>.so… — both the unified cu13
        // layout (nvidia/cu13/lib/) and the component layout
        // (nvidia/cuda_runtime/lib/).
        let parts: Vec<&str> = name.split('/').collect();
        if parts.len() < 4 || parts[0] != "nvidia" || parts[2] != "lib" {
            continue;
        }
        let file_name = parts[3];
        if !file_name.starts_with("lib") || !file_name.contains(".so") || entry.is_dir() {
            continue;
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| anyhow!("Failed to extract {name}: {e}"))?;
        std::fs::write(dest.join(file_name), &bytes)
            .map_err(|e| anyhow!("Failed to write {file_name}: {e}"))?;
    }
    Ok(())
}

/// Recursively record files under `dir` into the manifest, relative to `root`.
fn record_files(root: &Path, dir: &Path, manifest: &mut GpuRuntimeManifest) -> Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            record_files(root, &path, manifest)?;
            continue;
        }
        let meta = entry.metadata()?;
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        manifest.files.insert(
            rel,
            ManifestFile {
                size: meta.len(),
                sha256: None,
            },
        );
    }
    Ok(())
}

#[cfg(unix)]
fn set_executable(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms)?;
    Ok(())
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) -> Result<()> {
    Ok(())
}

/// Rough human-readable byte size for error/UI strings ("1.4 GB").
pub fn humansize(bytes: u64) -> String {
    const GB: f64 = 1_000_000_000.0;
    const MB: f64 = 1_000_000.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} GB", b / GB)
    } else if b >= MB {
        format!("{:.0} MB", b / MB)
    } else {
        format!("{bytes} B")
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn driver_major_parses_nvrm_tokens() {
        assert_eq!(driver_version_major("595.84"), Some(595));
        assert_eq!(driver_version_major("525.60.13"), Some(525));
        assert_eq!(driver_version_major(""), None);
        assert_eq!(driver_version_major("abc"), None);
    }

    #[test]
    fn flavor_gates_follow_driver_branches() {
        // CUDA 13 needs the r580+ driver branch.
        assert_eq!(flavor_for_driver_major(595), Some(GpuFlavor::Cuda13));
        assert_eq!(flavor_for_driver_major(580), Some(GpuFlavor::Cuda13));
        // Anything on the CUDA 12 baseline branch range gets CUDA 12.
        assert_eq!(flavor_for_driver_major(579), Some(GpuFlavor::Cuda12));
        assert_eq!(flavor_for_driver_major(525), Some(GpuFlavor::Cuda12));
        // Older branches cannot load either runtime.
        assert_eq!(flavor_for_driver_major(524), None);
        assert_eq!(flavor_for_driver_major(470), None);
    }

    #[test]
    fn nvidia_driver_version_parses_proc_line() {
        let sample = "NVRM version: NVIDIA UNIX x86_64 Kernel Module  595.84  Wed Jun 10 21:13:57 UTC 2026\nGCC version:  gcc version 15.2.0";
        let first = sample.lines().next().unwrap();
        let after = first.split("Kernel Module").nth(1).unwrap();
        let token = after.split_whitespace().next().unwrap();
        assert_eq!(token, "595.84");
        assert_eq!(driver_version_major(token), Some(595));
    }

    #[test]
    fn flavor_tables_are_self_consistent() {
        for flavor in [GpuFlavor::Cuda13, GpuFlavor::Cuda12] {
            let artifacts = flavor.artifacts();
            assert_eq!(artifacts.len(), 12, "tarball + 6 wheels + 5 fp32 model files");
            for artifact in &artifacts {
                assert!(
                    artifact.url.starts_with("https://"),
                    "{} must be https",
                    artifact.label
                );
                assert_eq!(
                    artifact.sha256.len(),
                    64,
                    "{} sha256 must be a full digest",
                    artifact.label
                );
                assert!(artifact.size > 0);
            }
            assert_eq!(
                flavor.download_size_bytes(),
                artifacts.iter().map(|a| a.size).sum::<u64>()
            );
            assert_eq!(sherpa_files(flavor).len(), 5);
            // The online/offline rename mapping must match the CPU bundle
            // convention (download-sidecars.js).
            let dests: Vec<&str> = sherpa_files(flavor)
                .iter()
                .map(|p| p.dest_path)
                .collect();
            assert!(dests.contains(&"bin/sherpa-online"));
            assert!(dests.contains(&"bin/sherpa-onnx"));
        }
        // The two flavors must genuinely differ (different CUDA builds).
        assert_ne!(
            GpuFlavor::Cuda13.download_size_bytes(),
            GpuFlavor::Cuda12.download_size_bytes()
        );
    }

    #[test]
    fn required_sonames_match_provider_linkage() {
        // Recorded via ldd(1) against each pinned tarball's
        // libonnxruntime_providers_cuda.so — see the module doc.
        let cu13 = GpuFlavor::Cuda13.required_sonames();
        assert!(cu13.contains(&"libcufft.so.12"));
        assert!(cu13.contains(&"libcublas.so.13"));
        assert!(cu13.contains(&"libcudnn.so.9"));
        let cu12 = GpuFlavor::Cuda12.required_sonames();
        assert!(cu12.contains(&"libcufft.so.11"));
        assert!(cu12.contains(&"libcublas.so.12"));
        assert!(cu12.contains(&"libcudnn.so.9"));
    }

    #[test]
    fn manifest_verification_rejects_drift_and_gaps() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::write(root.join("bin-file"), b"x").unwrap();

        // Empty dir → no manifest → None.
        assert!(verify_manifest(root).is_none());

        // Manifest referencing a missing file → None.
        let mut m = GpuRuntimeManifest {
            flavor: "cuda-13".into(),
            sherpa_version: SHERPA_GPU_VERSION.into(),
            spec: GPU_RUNTIME_SPEC,
            created_at: "now".into(),
            files: HashMap::new(),
        };
        m.files.insert(
            "bin-file".into(),
            ManifestFile {
                size: 1,
                sha256: None,
            },
        );
        std::fs::write(root.join("manifest.json"), serde_json::to_string(&m).unwrap()).unwrap();
        assert!(verify_manifest(root).is_some());

        // Size drift → None.
        m.files.insert(
            "bin-file".into(),
            ManifestFile {
                size: 2,
                sha256: None,
            },
        );
        std::fs::write(root.join("manifest.json"), serde_json::to_string(&m).unwrap()).unwrap();
        assert!(verify_manifest(root).is_none());

        // Unknown flavor tag still verifies (files rule), but flavor_from_tag
        // rejects it — engine treats unknown tags as not installed via
        // evaluate()'s manifest check only, so keep the round-trip strict.
        assert!(GpuFlavor::from_tag("cuda-14").is_none());
    }

    #[test]
    fn artifact_file_names_resolve() {
        let artifact = &CUDA_13_WHEELS[0];
        assert_eq!(
            artifact_file_name(artifact).unwrap(),
            "nvidia_cuda_runtime-13.3.29-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl"
        );
        assert!(artifact_file_name(&SHERPA_TARBALL_CUDA_13)
            .unwrap()
            .ends_with(".tar.bz2"));
    }

    #[test]
    fn humansize_rounds_for_humans() {
        assert_eq!(humansize(0), "0 B");
        assert_eq!(humansize(500), "500 B");
        assert_eq!(humansize(2_339_786), "2 MB");
        assert_eq!(humansize(1_442_135_782), "1.4 GB");
    }

    /// LIVE end-to-end provisioning + CUDA smoke run. Ignored by default —
    /// it downloads the full ~1.5 GB runtime and writes into the REAL app
    /// data dir (the mock app is built from the repo's tauri.conf.json, so
    /// `app_data_dir` resolves exactly where the shipped app looks).
    ///
    /// Run explicitly on an NVIDIA Linux box:
    ///   cargo test --lib live_provisions_gpu_runtime -- --ignored --nocapture
    #[cfg(target_os = "linux")]
    #[tokio::test]
    #[ignore = "live test: downloads ~1.5 GB into the real app data dir"]
    async fn live_provisions_gpu_runtime_and_runs_cuda_session() {
        let app = tauri::test::mock_builder()
            .build(tauri::generate_context!())
            .expect("mock app from the repo tauri.conf.json");
        app.manage(crate::models::hf::commands::ActiveHfDownloads::default());
        let handle = app.handle().clone();

        let before = evaluate(&handle);
        println!("status before: supported={} flavor={:?}", before.supported, before.flavor);
        if !before.supported {
            println!(
                "SKIPPED: this machine cannot run the GPU runtime ({})",
                before.reason.unwrap_or_default()
            );
            return;
        }
        if before.ready {
            println!("already provisioned — verifying only");
        } else {
            install(&handle, CancellationToken::new())
                .await
                .expect("install");
        }

        let after = evaluate(&handle);
        assert!(after.ready, "runtime must verify after install: {after:?}");
        println!(
            "provisioned {} at {} ({})",
            after.flavor.unwrap_or("?"),
            runtime_root(&handle).unwrap().display(),
            humansize(after.on_disk_bytes)
        );
        let fp32 = runtime_fp32_model_dir(&handle).expect("fp32 model dir");
        assert!(fp32.join("encoder.onnx").is_file() && fp32.join("encoder.data").is_file());

        // CUDA smoke run: the provisioned streaming binary with
        // --provider=cuda against the installed Nemotron model must NOT
        // print the CPU-fallback notice and must exit 0.
        let model_dir = handle
            .path()
            .app_data_dir()
            .unwrap()
            .join("models/nemotron-asr/csukuangfj2_sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11");
        if !model_dir.join("encoder.int8.onnx").exists() {
            println!("SKIPPED: Nemotron model not installed locally; binary-level check only");
            return;
        }

        // 2 s of silence the recognizer can chew through.
        let wav = std::env::temp_dir().join("gpu-runtime-live-test.wav");
        let ff = tokio::process::Command::new("ffmpeg")
            .args(["-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "2"])
            .arg(&wav)
            .output()
            .await
            .expect("ffmpeg");
        assert!(
            ff.status.success(),
            "ffmpeg failed: {}",
            String::from_utf8_lossy(&ff.stderr)
        );

        let bin = runtime_bin(&handle, "sherpa-online").expect("provisioned sherpa-online");
        let lib = runtime_lib_dir(&handle).expect("provisioned lib dir");
        let out = tokio::process::Command::new(&bin)
            .arg("--provider=cuda")
            .arg(format!(
                "--encoder={}",
                model_dir.join("encoder.int8.onnx").display()
            ))
            .arg(format!(
                "--decoder={}",
                model_dir.join("decoder.int8.onnx").display()
            ))
            .arg(format!(
                "--joiner={}",
                model_dir.join("joiner.int8.onnx").display()
            ))
            .arg(format!("--tokens={}", model_dir.join("tokens.txt").display()))
            .arg(&wav)
            .env("LD_LIBRARY_PATH", &lib)
            .output()
            .await
            .expect("run provisioned sherpa-online");
        let stderr = String::from_utf8_lossy(&out.stderr);
        let head = &stderr[..stderr.len().min(2000)];
        println!("exit={:?}\n{}", out.status.code(), head);
        assert!(
            !stderr.contains("Fallback to cpu"),
            "GPU run silently fell back to CPU"
        );
        assert!(
            !stderr.contains("SHERPA_ONNX_ENABLE_GPU"),
            "provisioned binary is not the GPU build"
        );
        assert_eq!(out.status.code(), Some(0), "CUDA session must exit cleanly");
    }
}
