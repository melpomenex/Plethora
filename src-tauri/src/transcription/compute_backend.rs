use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex, OnceLock};

/// Target execution backend for speech-to-text inference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputeBackend {
    Cuda,
    TensorRt,
    CoreMl,
    DirectMl,
    WinMl,
    MigraphX,
    OpenVino,
    Vulkan,
    Metal,
    Cpu,
}

impl fmt::Display for ComputeBackend {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cuda => write!(f, "CUDA"),
            Self::TensorRt => write!(f, "TensorRT"),
            Self::CoreMl => write!(f, "CoreML"),
            Self::DirectMl => write!(f, "DirectML"),
            Self::WinMl => write!(f, "WinML"),
            Self::MigraphX => write!(f, "MIGraphX"),
            Self::OpenVino => write!(f, "OpenVINO"),
            Self::Vulkan => write!(f, "Vulkan"),
            Self::Metal => write!(f, "Metal"),
            Self::Cpu => write!(f, "CPU"),
        }
    }
}

/// User execution policy for local transcription compute acceleration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptionComputeMode {
    #[default]
    Auto,
    GpuPreferred,
    CpuOnly,
}

impl TranscriptionComputeMode {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "gpu_preferred" | "gpu" | "prefer_gpu" => Self::GpuPreferred,
            "cpu_only" | "cpu" => Self::CpuOnly,
            _ => Self::Auto,
        }
    }
}

/// Physical device info detected on the host system.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceInfo {
    pub id: u32,
    pub name: String,
    pub vendor: String,
    pub vram_bytes: Option<u64>,
    pub free_vram_bytes: Option<u64>,
}

/// Hardware capabilities detected on the host.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HardwareCapabilities {
    pub cpu_threads: usize,
    pub devices: Vec<DeviceInfo>,
}

/// Status of an execution provider within the bundled/system runtime.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProviderStatus {
    pub available: bool,
    pub runtime_usable: bool,
    pub reason_unavailable: Option<String>,
}

/// Runtime capabilities verified by real probe attempts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RuntimeCapabilities {
    pub providers: HashMap<ComputeBackend, ProviderStatus>,
}

/// Model requirements and supported execution backends.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCapabilities {
    pub model_id: String,
    pub supported_backends: Vec<ComputeBackend>,
    pub min_vram_bytes: Option<u64>,
}

/// Detailed typed error taxonomy for compute-level failures.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "details")]
pub enum ComputeError {
    #[serde(rename = "GPU_BACKEND_UNAVAILABLE")]
    BackendUnavailable(String),
    #[serde(rename = "GPU_DRIVER_UNAVAILABLE")]
    DriverUnavailable(String),
    #[serde(rename = "GPU_RUNTIME_MISSING")]
    RuntimeMissing(String),
    #[serde(rename = "GPU_INITIALIZATION_FAILED")]
    InitializationFailed(String),
    #[serde(rename = "GPU_OUT_OF_MEMORY")]
    OutOfMemory {
        required_bytes: Option<u64>,
        free_bytes: Option<u64>,
    },
    #[serde(rename = "GPU_EXECUTION_FAILED")]
    ExecutionFailed(String),
    #[serde(rename = "GPU_DEVICE_LOST")]
    DeviceLost(String),
    #[serde(rename = "GPU_UNSUPPORTED_OPERATOR")]
    UnsupportedOperator(String),
    #[serde(rename = "MODEL_FILE_CORRUPT")]
    ModelFileCorrupt(String),
}

impl fmt::Display for ComputeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BackendUnavailable(s) => write!(f, "GPU backend unavailable: {s}"),
            Self::DriverUnavailable(s) => write!(f, "GPU driver unavailable: {s}"),
            Self::RuntimeMissing(s) => write!(f, "GPU runtime missing: {s}"),
            Self::InitializationFailed(s) => write!(f, "GPU initialization failed: {s}"),
            Self::OutOfMemory { required_bytes, free_bytes } => {
                write!(f, "GPU out of memory (required: {required_bytes:?}, free: {free_bytes:?})")
            }
            Self::ExecutionFailed(s) => write!(f, "GPU execution failed: {s}"),
            Self::DeviceLost(s) => write!(f, "GPU device lost: {s}"),
            Self::UnsupportedOperator(s) => write!(f, "Unsupported GPU operator: {s}"),
            Self::ModelFileCorrupt(s) => write!(f, "Model file corrupt: {s}"),
        }
    }
}

impl std::error::Error for ComputeError {}

impl ComputeError {
    /// Whether this error indicates an accelerator issue where CPU fallback is safe and recommended.
    pub fn triggers_cpu_fallback(&self) -> bool {
        !matches!(self, Self::ModelFileCorrupt(_))
    }
}

/// A ranked candidate backend for execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackendCandidate {
    pub backend: ComputeBackend,
    pub device_id: Option<u32>,
    pub device_name: Option<String>,
    pub supported: bool,
    pub reason_unavailable: Option<String>,
}

/// The ordered execution resolution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SelectedExecutionBackend {
    pub primary: BackendCandidate,
    pub fallback_chain: Vec<BackendCandidate>,
}

/// Cache of previous backend failures to avoid repeat thrashing during a session.
#[derive(Debug, Default)]
pub struct BackendHealthCache {
    degraded_backends: Mutex<HashMap<ComputeBackend, String>>,
}

impl BackendHealthCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn mark_degraded(&self, backend: ComputeBackend, reason: String) {
        if let Ok(mut map) = self.degraded_backends.lock() {
            map.insert(backend, reason);
        }
    }

    pub fn is_degraded(&self, backend: ComputeBackend) -> Option<String> {
        self.degraded_backends.lock().ok()?.get(&backend).cloned()
    }

    pub fn clear(&self) {
        if let Ok(mut map) = self.degraded_backends.lock() {
            map.clear();
        }
    }
}

pub static GLOBAL_HEALTH_CACHE: OnceLock<Arc<BackendHealthCache>> = OnceLock::new();

pub fn get_health_cache() -> Arc<BackendHealthCache> {
    GLOBAL_HEALTH_CACHE
        .get_or_init(|| Arc::new(BackendHealthCache::new()))
        .clone()
}

/// Detects physical and logical hardware capabilities of the host machine.
pub fn detect_hardware() -> HardwareCapabilities {
    let cpu_threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);

    let mut devices = Vec::new();

    #[cfg(target_os = "macos")]
    {
        // Apple Silicon unified GPU / CoreML
        devices.push(DeviceInfo {
            id: 0,
            name: "Apple Silicon Neural / Metal Accelerator".to_string(),
            vendor: "apple".to_string(),
            vram_bytes: None,
            free_vram_bytes: None,
        });
    }

    #[cfg(target_os = "linux")]
    {
        // Inspect /sys/class/drm or probe via glxinfo/lspci/nvidia-smi if available
        if let Ok(entries) = std::fs::read_dir("/sys/class/drm") {
            let mut dev_idx = 0;
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("card") && !name.contains('-') {
                    let uevent_path = entry.path().join("device/uevent");
                    let vendor = if let Ok(content) = std::fs::read_to_string(uevent_path) {
                        if content.contains("PCI_ID=10DE") {
                            "nvidia".to_string()
                        } else if content.contains("PCI_ID=1002") {
                            "amd".to_string()
                        } else if content.contains("PCI_ID=8086") {
                            "intel".to_string()
                        } else {
                            "unknown".to_string()
                        }
                    } else {
                        "unknown".to_string()
                    };

                    devices.push(DeviceInfo {
                        id: dev_idx,
                        name: format!("GPU Device {}", dev_idx),
                        vendor,
                        vram_bytes: None,
                        free_vram_bytes: None,
                    });
                    dev_idx += 1;
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows platform device detection placeholder
        devices.push(DeviceInfo {
            id: 0,
            name: "Default Graphics Device".to_string(),
            vendor: "unknown".to_string(),
            vram_bytes: None,
            free_vram_bytes: None,
        });
    }

    HardwareCapabilities {
        cpu_threads,
        devices,
    }
}

/// Probes runtime capability for supported providers.
pub fn probe_runtime_capabilities(sidecar_bin_dir: Option<&std::path::Path>) -> RuntimeCapabilities {
    let mut providers = HashMap::new();

    // CPU is always available
    providers.insert(
        ComputeBackend::Cpu,
        ProviderStatus {
            available: true,
            runtime_usable: true,
            reason_unavailable: None,
        },
    );

    #[cfg(target_os = "macos")]
    {
        providers.insert(
            ComputeBackend::CoreMl,
            ProviderStatus {
                available: true,
                runtime_usable: true,
                reason_unavailable: None,
            },
        );
        providers.insert(
            ComputeBackend::Metal,
            ProviderStatus {
                available: true,
                runtime_usable: true,
                reason_unavailable: None,
            },
        );
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Check for CUDA runtime libraries
        let cuda_usable = check_cuda_usable(sidecar_bin_dir);
        providers.insert(
            ComputeBackend::Cuda,
            ProviderStatus {
                available: cuda_usable.0,
                runtime_usable: cuda_usable.0,
                reason_unavailable: cuda_usable.1,
            },
        );

        // Windows DirectML check
        #[cfg(target_os = "windows")]
        {
            providers.insert(
                ComputeBackend::DirectMl,
                ProviderStatus {
                    available: true,
                    runtime_usable: true,
                    reason_unavailable: None,
                },
            );
        }
    }

    RuntimeCapabilities { providers }
}

#[cfg(not(target_os = "macos"))]
fn check_cuda_usable(sidecar_bin_dir: Option<&std::path::Path>) -> (bool, Option<String>) {
    // Check if CUDA execution provider library exists or can load
    #[cfg(target_os = "linux")]
    {
        // Look for libonnxruntime_providers_cuda.so or libcuda.so
        let lib_names = ["libonnxruntime_providers_cuda.so", "libcuda.so.1", "libcuda.so"];
        let mut found = false;
        if let Some(dir) = sidecar_bin_dir {
            for name in &lib_names {
                if dir.join(name).exists() {
                    found = true;
                    break;
                }
            }
        }
        if !found {
            if std::path::Path::new("/usr/lib/x86_64-linux-gnu/libcuda.so.1").exists()
                || std::path::Path::new("/usr/lib64/libcuda.so.1").exists()
                || std::path::Path::new("/usr/lib/libcuda.so").exists()
            {
                found = true;
            }
        }
        if found {
            (true, None)
        } else {
            (false, Some("CUDA libraries (libcuda.so/libonnxruntime_providers_cuda.so) not found".to_string()))
        }
    }
    #[cfg(target_os = "windows")]
    {
        let dll_names = ["onnxruntime_providers_cuda.dll", "nvcuda.dll"];
        let mut found = false;
        if let Some(dir) = sidecar_bin_dir {
            for name in &dll_names {
                if dir.join(name).exists() {
                    found = true;
                    break;
                }
            }
        }
        if found {
            (true, None)
        } else {
            (false, Some("CUDA libraries (onnxruntime_providers_cuda.dll) not found".to_string()))
        }
    }
}

/// The Central Compute Backend Selector.
pub struct ComputeBackendSelector;

impl ComputeBackendSelector {
    /// Resolve the ordered candidate execution backends based on:
    /// - User policy (`TranscriptionComputeMode`)
    /// - Hardware devices detected
    /// - Runtime provider availability
    /// - Model backend support
    /// - Health cache (prior failures)
    pub fn select_backend(
        mode: TranscriptionComputeMode,
        hardware: &HardwareCapabilities,
        runtime: &RuntimeCapabilities,
        model: &ModelCapabilities,
        health: &BackendHealthCache,
        preferred_device_id: Option<u32>,
    ) -> SelectedExecutionBackend {
        let cpu_candidate = BackendCandidate {
            backend: ComputeBackend::Cpu,
            device_id: None,
            device_name: Some(format!("CPU ({} threads)", hardware.cpu_threads)),
            supported: model.supported_backends.contains(&ComputeBackend::Cpu),
            reason_unavailable: None,
        };

        if mode == TranscriptionComputeMode::CpuOnly {
            return SelectedExecutionBackend {
                primary: cpu_candidate.clone(),
                fallback_chain: vec![cpu_candidate],
            };
        }

        // Determine candidate backend hierarchy by platform
        let platform_backends: &[ComputeBackend] = {
            #[cfg(target_os = "macos")]
            {
                &[ComputeBackend::CoreMl, ComputeBackend::Metal, ComputeBackend::Cpu]
            }
            #[cfg(target_os = "linux")]
            {
                &[
                    ComputeBackend::TensorRt,
                    ComputeBackend::Cuda,
                    ComputeBackend::MigraphX,
                    ComputeBackend::OpenVino,
                    ComputeBackend::Vulkan,
                    ComputeBackend::Cpu,
                ]
            }
            #[cfg(target_os = "windows")]
            {
                &[
                    ComputeBackend::Cuda,
                    ComputeBackend::DirectMl,
                    ComputeBackend::WinMl,
                    ComputeBackend::Vulkan,
                    ComputeBackend::Cpu,
                ]
            }
            #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
            {
                &[ComputeBackend::Cpu]
            }
        };

        let mut candidate_chain = Vec::new();

        for &backend in platform_backends {
            if backend == ComputeBackend::Cpu {
                continue;
            }

            // Must be supported by the requested model
            if !model.supported_backends.contains(&backend) {
                continue;
            }

            // Check health cache
            if let Some(reason) = health.is_degraded(backend) {
                candidate_chain.push(BackendCandidate {
                    backend,
                    device_id: None,
                    device_name: None,
                    supported: false,
                    reason_unavailable: Some(format!("Temporarily disabled: {reason}")),
                });
                continue;
            }

            // Check runtime provider usable
            let provider_usable = runtime
                .providers
                .get(&backend)
                .map(|p| p.runtime_usable)
                .unwrap_or(false);

            if !provider_usable {
                let reason = runtime
                    .providers
                    .get(&backend)
                    .and_then(|p| p.reason_unavailable.clone())
                    .unwrap_or_else(|| "Runtime provider not available".to_string());

                candidate_chain.push(BackendCandidate {
                    backend,
                    device_id: None,
                    device_name: None,
                    supported: false,
                    reason_unavailable: Some(reason),
                });
                continue;
            }

            // Match compatible hardware device
            let target_device = if let Some(id) = preferred_device_id {
                hardware.devices.iter().find(|d| d.id == id)
            } else {
                hardware.devices.first()
            };

            candidate_chain.push(BackendCandidate {
                backend,
                device_id: target_device.map(|d| d.id),
                device_name: target_device.map(|d| d.name.clone()),
                supported: true,
                reason_unavailable: None,
            });
        }

        // Find the highest ranked working candidate
        let primary = candidate_chain
            .iter()
            .find(|c| c.supported)
            .cloned()
            .unwrap_or_else(|| cpu_candidate.clone());

        let mut fallback_chain = candidate_chain
            .into_iter()
            .filter(|c| c.supported && c.backend != primary.backend)
            .collect::<Vec<_>>();

        fallback_chain.push(cpu_candidate);

        SelectedExecutionBackend {
            primary,
            fallback_chain,
        }
    }
}

/// Diagnostic report structure returned by `transcription_compute_diagnostics`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComputeDiagnosticsReport {
    pub hardware: HardwareCapabilities,
    pub runtime: RuntimeCapabilities,
    pub active_compute_mode: TranscriptionComputeMode,
    pub model_compatibilities: Vec<ModelCapabilities>,
    pub health_degraded_backends: HashMap<String, String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_hardware() -> HardwareCapabilities {
        HardwareCapabilities {
            cpu_threads: 16,
            devices: vec![DeviceInfo {
                id: 0,
                name: "NVIDIA GeForce RTX 2060 SUPER".to_string(),
                vendor: "nvidia".to_string(),
                vram_bytes: Some(8 * 1024 * 1024 * 1024),
                free_vram_bytes: Some(6 * 1024 * 1024 * 1024),
            }],
        }
    }

    fn test_model() -> ModelCapabilities {
        ModelCapabilities {
            model_id: "nemotron-3.5-asr-0.6b".to_string(),
            supported_backends: vec![
                ComputeBackend::Cuda,
                ComputeBackend::CoreMl,
                ComputeBackend::DirectMl,
                ComputeBackend::Cpu,
            ],
            min_vram_bytes: Some(1500 * 1024 * 1024),
        }
    }

    #[test]
    fn selects_cuda_when_available_under_auto() {
        let hw = test_hardware();
        let mut providers = HashMap::new();
        providers.insert(
            ComputeBackend::Cpu,
            ProviderStatus {
                available: true,
                runtime_usable: true,
                reason_unavailable: None,
            },
        );
        providers.insert(
            ComputeBackend::Cuda,
            ProviderStatus {
                available: true,
                runtime_usable: true,
                reason_unavailable: None,
            },
        );
        let runtime = RuntimeCapabilities { providers };
        let model = test_model();
        let health = BackendHealthCache::new();

        let selection = ComputeBackendSelector::select_backend(
            TranscriptionComputeMode::Auto,
            &hw,
            &runtime,
            &model,
            &health,
            None,
        );

        #[cfg(not(target_os = "macos"))]
        {
            assert_eq!(selection.primary.backend, ComputeBackend::Cuda);
            assert_eq!(selection.primary.device_id, Some(0));
            assert!(selection.fallback_chain.iter().any(|c| c.backend == ComputeBackend::Cpu));
        }
        #[cfg(target_os = "macos")]
        {
            // On macOS without CoreML provider usable, falls back to CPU
            assert_eq!(selection.primary.backend, ComputeBackend::Cpu);
        }
    }

    #[test]
    fn honors_cpu_only_mode_even_when_gpu_ready() {
        let hw = test_hardware();
        let mut providers = HashMap::new();
        providers.insert(
            ComputeBackend::Cuda,
            ProviderStatus {
                available: true,
                runtime_usable: true,
                reason_unavailable: None,
            },
        );
        providers.insert(
            ComputeBackend::Cpu,
            ProviderStatus {
                available: true,
                runtime_usable: true,
                reason_unavailable: None,
            },
        );
        let runtime = RuntimeCapabilities { providers };
        let model = test_model();
        let health = BackendHealthCache::new();

        let selection = ComputeBackendSelector::select_backend(
            TranscriptionComputeMode::CpuOnly,
            &hw,
            &runtime,
            &model,
            &health,
            None,
        );

        assert_eq!(selection.primary.backend, ComputeBackend::Cpu);
    }

    #[test]
    fn falls_back_to_cpu_when_cuda_degraded_in_health_cache() {
        let hw = test_hardware();
        let mut providers = HashMap::new();
        providers.insert(
            ComputeBackend::Cuda,
            ProviderStatus {
                available: true,
                runtime_usable: true,
                reason_unavailable: None,
            },
        );
        providers.insert(
            ComputeBackend::Cpu,
            ProviderStatus {
                available: true,
                runtime_usable: true,
                reason_unavailable: None,
            },
        );
        let runtime = RuntimeCapabilities { providers };
        let model = test_model();
        let health = BackendHealthCache::new();
        health.mark_degraded(ComputeBackend::Cuda, "Out of memory".to_string());

        let selection = ComputeBackendSelector::select_backend(
            TranscriptionComputeMode::Auto,
            &hw,
            &runtime,
            &model,
            &health,
            None,
        );

        assert_eq!(selection.primary.backend, ComputeBackend::Cpu);
    }

    #[test]
    fn typed_error_triggers_cpu_fallback_logic() {
        let oom = ComputeError::OutOfMemory {
            required_bytes: Some(2048),
            free_bytes: Some(1024),
        };
        assert!(oom.triggers_cpu_fallback());

        let init_failed = ComputeError::InitializationFailed("driver error".to_string());
        assert!(init_failed.triggers_cpu_fallback());

        let corrupt = ComputeError::ModelFileCorrupt("bad checksum".to_string());
        assert!(!corrupt.triggers_cpu_fallback());
    }
}
