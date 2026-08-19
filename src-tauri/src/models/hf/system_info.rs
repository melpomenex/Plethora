//! Hardware/system capability detection used by the HF model suitability
//! analysis (requirement #19, "Hardware detection").
//!
//! Everything here is read-only and best-effort: no elevated privileges, no
//! heavy dependencies. Only the fields needed for suitability are gathered —
//! we never collect identifying info (hostnames, MAC addresses, serials).
//!
//! - OS / arch / core count / RAM / disk via `sysinfo` (already in the dep
//!   graph via burn-train).
//! - GPU + VRAM via `nvidia-smi` (if present) and platform probes.
//! - CUDA availability via `nvidia-smi` presence; Metal via `target_os`.
//! - Apple Silicon via `arch`/CPU brand + OS version.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub name: String,
    /// VRAM in bytes, when the driver reports it.
    pub vram_bytes: Option<u64>,
    /// Detected vendor: "nvidia" | "amd" | "intel" | "apple" | "unknown".
    pub vendor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub os_version: Option<String>,
    pub arch: String,
    pub cpu_brand: Option<String>,
    pub logical_cores: usize,
    pub physical_cores: Option<usize>,
    pub total_memory_bytes: u64,
    pub available_memory_bytes: u64,
    pub gpu: Option<GpuInfo>,
    pub cuda_available: bool,
    pub metal_available: bool,
    pub is_apple_silicon: bool,
    /// Bytes free on the volume that hosts the model directories.
    pub disk_free_bytes: Option<u64>,
    /// Bytes total on that same volume.
    pub disk_total_bytes: Option<u64>,
    /// Human-readable accelerators Plethora could use.
    pub supported_accelerators: Vec<String>,
}

fn os_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macOS"
    } else if cfg!(target_os = "windows") {
        "Windows"
    } else if cfg!(target_os = "linux") {
        "Linux"
    } else if cfg!(target_os = "android") {
        "Android"
    } else if cfg!(target_os = "ios") {
        "iOS"
    } else {
        "Unknown"
    }
}

fn arch_name() -> String {
    std::env::consts::ARCH.to_string()
}

/// Run a command and return trimmed stdout (or None on failure).
fn try_output(cmd: &mut Command) -> Option<String> {
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn run_with_path(cmd: &str, args: &[&str]) -> Option<String> {
    try_output(Command::new(cmd).args(args))
}

fn nvidia_smi() -> Option<GpuInfo> {
    let name = run_with_path("nvidia-smi", &[
        "--query-gpu=name",
        "--format=csv,noheader,nounits",
    ])?;
    let name = name.lines().next().map(|l| l.trim().to_string())?;
    let vram = run_with_path("nvidia-smi", &[
        "--query-gpu=memory.total",
        "--format=csv,noheader,nounits",
    ])
    .and_then(|v| {
        v.lines()
            .next()
            .and_then(|l| l.trim().parse::<f64>().ok())
            .map(|mib| (mib * 1024.0 * 1024.0) as u64)
    });
    Some(GpuInfo {
        name,
        vram_bytes: vram,
        vendor: "nvidia".to_string(),
    })
}

#[cfg(target_os = "linux")]
fn linux_gpu_probe() -> Option<GpuInfo> {
    if let Some(gpu) = nvidia_smi() {
        return Some(gpu);
    }
    // Best-effort: read NVIDIA proc info even without nvidia-smi.
    let gpus_dir = Path::new("/proc/driver/nvidia/gpus");
    if let Ok(entries) = std::fs::read_dir(gpus_dir) {
        for entry in entries.flatten() {
            let info_path = entry.path().join("information");
            if let Ok(text) = std::fs::read_to_string(info_path) {
                let name = text
                    .lines()
                    .find(|l| l.contains("Model:"))
                    .map(|l| l.split(':').nth(1).unwrap_or("").trim().to_string())
                    .filter(|s| !s.is_empty());
                if let Some(name) = name {
                    return Some(GpuInfo {
                        name,
                        vram_bytes: None,
                        vendor: "nvidia".to_string(),
                    });
                }
            }
        }
    }
    // Generic lspci fallback (may require pciutils).
    if let Some(out) = run_with_path("lspci", &[]) {
        let line = out
            .lines()
            .find(|l| {
                l.contains("VGA") || l.contains("3D controller") || l.contains("Display controller")
            })
            .map(|l| l.trim().to_string());
        if let Some(line) = line {
            let vendor = if line.contains("NVIDIA") {
                "nvidia"
            } else if line.contains("AMD") || line.contains("Advanced Micro Devices") {
                "amd"
            } else if line.contains("Intel") {
                "intel"
            } else {
                "unknown"
            };
            let name = line.split(':').nth(1).map(|s| s.trim().to_string()).unwrap_or(line);
            return Some(GpuInfo {
                name,
                vram_bytes: None,
                vendor: vendor.to_string(),
            });
        }
    }
    None
}

#[cfg(not(target_os = "linux"))]
fn linux_gpu_probe() -> Option<GpuInfo> {
    None
}

#[cfg(target_os = "macos")]
fn macos_silicon() -> bool {
    arch_name() == "aarch64"
}

#[cfg(not(target_os = "macos"))]
fn macos_silicon() -> bool {
    false
}

#[cfg(target_os = "macos")]
fn macos_gpu_probe() -> Option<GpuInfo> {
    // Unified memory: treat available system memory as the accelerator budget.
    Some(GpuInfo {
        name: if macos_silicon() {
            "Apple Silicon (unified memory)".to_string()
        } else {
            "Apple (Metal)".to_string()
        },
        vram_bytes: None,
        vendor: "apple".to_string(),
    })
}

#[cfg(not(target_os = "macos"))]
fn macos_gpu_probe() -> Option<GpuInfo> {
    None
}

#[cfg(target_os = "windows")]
fn windows_gpu_probe() -> Option<GpuInfo> {
    nvidia_smi()
}

#[cfg(not(target_os = "windows"))]
fn windows_gpu_probe() -> Option<GpuInfo> {
    None
}

#[cfg(target_os = "macos")]
fn os_version() -> Option<String> {
    let mut cmd = Command::new("sw_vers");
    cmd.arg("-productVersion");
    try_output(&mut cmd)
}

#[cfg(not(target_os = "macos"))]
fn os_version() -> Option<String> {
    None
}

/// Query a disk's free/total space on the volume that contains `dir`, using
/// sysinfo's mounted-disk list. Returns `None` when the volume can't be mapped.
fn volume_space(dir: &Path) -> Option<(u64, u64)> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mount = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    // Pick the disk whose mount point is the longest prefix of the path.
    let best = disks.list().iter().max_by_key(|disk| {
        let mp = disk.mount_point();
        if mount.starts_with(mp) {
            mp.as_os_str().to_string_lossy().len()
        } else {
            0
        }
    })?;
    if mount.starts_with(best.mount_point()) {
        Some((best.available_space(), best.total_space()))
    } else {
        None
    }
}

/// Detect the machine capabilities. `models_dir` is the parent dir Plethora
/// stores speech models under; its volume's free space is what matters.
pub fn detect_system_info(models_dir: &Path) -> SystemInfo {
    let mut sys = sysinfo::System::new();
    sys.refresh_cpu_all();
    sys.refresh_memory();

    let total_memory = sys.total_memory();
    let available_memory = sys.available_memory();
    let logical_cores = sys.cpus().len();
    let physical_cores = sys.physical_core_count();
    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|b| !b.is_empty());

    let is_apple_silicon = macos_silicon();
    let metal_available = cfg!(target_os = "macos");

    let mut gpu = nvidia_smi().or_else(|| {
        if cfg!(target_os = "linux") {
            linux_gpu_probe()
        } else if cfg!(target_os = "macos") {
            macos_gpu_probe()
        } else if cfg!(target_os = "windows") {
            windows_gpu_probe()
        } else {
            None
        }
    });

    // On Apple Silicon there is always a unified-memory accelerator even when
    // no discrete GPU was reported.
    if gpu.is_none() && is_apple_silicon {
        gpu = macos_gpu_probe();
    }

    let cuda_available = gpu
        .as_ref()
        .map(|g| g.vendor == "nvidia")
        .unwrap_or(false);

    let volume = volume_space(models_dir);
    let disk_free_bytes = volume.map(|(free, _)| free);
    let disk_total_bytes = volume.map(|(_, total)| total);

    let mut supported_accelerators: Vec<String> = Vec::new();
    if cuda_available {
        supported_accelerators.push("CUDA".to_string());
    }
    if metal_available {
        supported_accelerators.push("Metal".to_string());
    }
    // whisper.cpp ships a Vulkan backend on Linux when libggml-vulkan.so is
    // present; probing the actual sidecar dir happens in the engine, so here we
    // only note the capability when a GPU was detected.
    if cfg!(target_os = "linux") && gpu.is_some() {
        supported_accelerators.push("Vulkan".to_string());
    }
    if supported_accelerators.is_empty() {
        supported_accelerators.push("CPU".to_string());
    }

    SystemInfo {
        os: os_name().to_string(),
        os_version: os_version(),
        arch: arch_name(),
        cpu_brand,
        logical_cores,
        physical_cores,
        total_memory_bytes: total_memory,
        available_memory_bytes: available_memory,
        gpu,
        cuda_available,
        metal_available,
        is_apple_silicon,
        disk_free_bytes,
        disk_total_bytes,
        supported_accelerators,
    }
}

/// Resolve the parent dir used for disk-space checks (where models are stored).
pub fn models_root_dir(app_dir: &std::path::Path) -> PathBuf {
    app_dir.join("models")
}
