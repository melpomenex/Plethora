//! Mirage (`mirage.cact`) local inference runtime, lazy model loader,
//! thread-safe inference queue, and RGB image decoding helpers.

use crate::error::{PlethoraError, Result};
use crate::vision::cactus_ffi::CactusLibrary;
use crate::vision::types::{MirageRequestOptions, MirageResponse, MirageStatus};
use image::GenericImageView;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub const MIRAGE_MODEL_FILENAME: &str = "mirage.cact";
pub const DEFAULT_MIRAGE_MODEL_URL: &str =
    "https://huggingface.co/Cactus-Compute/mirage/resolve/main/mirage.cact";

/// Decoded raw RGB24 image buffer.
#[derive(Debug, Clone)]
pub struct RgbImageBuffer {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Decode encoded image bytes (PNG, JPEG, WebP, BMP, etc.) into a packed RGB24 buffer.
pub fn decode_image_to_rgb(bytes: &[u8]) -> Result<RgbImageBuffer> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| PlethoraError::InvalidInput(format!("Failed to decode image bytes: {e}")))?;
    let (width, height) = img.dimensions();
    if width == 0 || height == 0 {
        return Err(PlethoraError::InvalidInput(
            "Image has zero width or height".to_string(),
        ));
    }
    let rgb = img.to_rgb8();
    Ok(RgbImageBuffer {
        data: rgb.into_raw(),
        width,
        height,
    })
}

/// Crop a `0–1000` normalized bounding box `[x1, y1, x2, y2]` from an `RgbImageBuffer`
/// and encode it as PNG bytes.
pub fn crop_rgb_bbox_to_png(
    rgb: &RgbImageBuffer,
    bbox: [f64; 4],
) -> Result<Vec<u8>> {
    let w = rgb.width as f64;
    let h = rgb.height as f64;
    let x1 = ((bbox[0].clamp(0.0, 1000.0) / 1000.0) * w).floor() as u32;
    let y1 = ((bbox[1].clamp(0.0, 1000.0) / 1000.0) * h).floor() as u32;
    let x2 = ((bbox[2].clamp(0.0, 1000.0) / 1000.0) * w).ceil() as u32;
    let y2 = ((bbox[3].clamp(0.0, 1000.0) / 1000.0) * h).ceil() as u32;

    let crop_w = x2.saturating_sub(x1).max(1).min(rgb.width.saturating_sub(x1));
    let crop_h = y2.saturating_sub(y1).max(1).min(rgb.height.saturating_sub(y1));

    let img_buf = image::RgbImage::from_raw(rgb.width, rgb.height, rgb.data.clone())
        .ok_or_else(|| PlethoraError::Internal("Invalid RGB buffer dimensions".to_string()))?;
    let cropped = image::imageops::crop_imm(&img_buf, x1, y1, crop_w, crop_h).to_image();

    let mut out = Vec::new();
    image::DynamicImage::ImageRgb8(cropped)
        .write_to(&mut Cursor::new(&mut out), image::ImageOutputFormat::Png)
        .map_err(|e| PlethoraError::Internal(format!("Failed to encode cropped PNG: {e}")))?;
    Ok(out)
}

/// Abstract backend trait so `MirageEngine` can run against native `libcactus`
/// or deterministic test doubles without requiring the 22 MB `.cact` weights in CI.
pub trait MirageBackend: Send + Sync {
    fn status(&self) -> MirageStatus;
    fn ensure_model_cached(&self, download_url: Option<&str>) -> Result<PathBuf>;
    fn describe_rgb(
        &self,
        rgb: &[u8],
        width: u32,
        height: u32,
        options: &MirageRequestOptions,
    ) -> Result<MirageResponse>;
}

struct LoadedCactusState {
    library: CactusLibrary,
    /// Keep the `.cact` bytes alive for the lifetime of the loaded model in case
    /// `cactus_load` retains a pointer into the caller's buffer.
    _model_bytes: Vec<u8>,
    model_path: PathBuf,
}

// Safety: `LoadedCactusState` is only accessed while holding `CactusMirageBackend::queue_mutex`.
unsafe impl Send for LoadedCactusState {}

/// Production backend backed by `libcactus` (`cactus_load`, `cactus_describe`)
/// with lazy model loading, serialized inference queue, and local weight caching.
pub struct CactusMirageBackend {
    models_dir: PathBuf,
    /// Serializes both model loading and `cactus_describe` inference calls.
    queue_mutex: Mutex<Option<LoadedCactusState>>,
}

impl CactusMirageBackend {
    pub fn new(models_dir: PathBuf) -> Self {
        Self {
            models_dir,
            queue_mutex: Mutex::new(None),
        }
    }

    /// Resolve `mirage.cact` path from `PLETHORA_MIRAGE_MODEL` or `models_dir/mirage.cact`.
    pub fn resolve_model_path(&self) -> PathBuf {
        if let Ok(explicit) = std::env::var("PLETHORA_MIRAGE_MODEL") {
            let trimmed = explicit.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed);
            }
        }
        self.models_dir.join(MIRAGE_MODEL_FILENAME)
    }

    fn ensure_loaded<'a>(
        &self,
        guard: &'a mut Option<LoadedCactusState>,
    ) -> Result<&'a LoadedCactusState> {
        if guard.is_none() {
            let model_path = self.resolve_model_path();
            if !model_path.exists() {
                return Err(PlethoraError::NotFound(format!(
                    "Mirage model weights not found at {}. Call mirage_ensure_model or place mirage.cact there.",
                    model_path.display()
                )));
            }
            let library = CactusLibrary::load().map_err(PlethoraError::Internal)?;
            let model_bytes = std::fs::read(&model_path).map_err(|e| {
                PlethoraError::Internal(format!(
                    "Failed to read Mirage model weights {}: {e}",
                    model_path.display()
                ))
            })?;
            library
                .cactus_load_bytes(&model_bytes)
                .map_err(PlethoraError::Internal)?;
            *guard = Some(LoadedCactusState {
                library,
                _model_bytes: model_bytes,
                model_path,
            });
        }
        Ok(guard.as_ref().expect("just initialized"))
    }
}

impl MirageBackend for CactusMirageBackend {
    fn status(&self) -> MirageStatus {
        let model_path = self.resolve_model_path();
        let model_cached = model_path.exists();
        let loaded_guard = self.queue_mutex.lock().ok();
        let model_loaded = loaded_guard.as_ref().is_some_and(|g| g.is_some());
        let library_path = loaded_guard
            .as_ref()
            .and_then(|g| g.as_ref())
            .map(|s| s.library.path.display().to_string());

        if model_loaded {
            return MirageStatus {
                available: true,
                library_loaded: true,
                model_loaded: true,
                model_cached,
                model_path: Some(model_path.display().to_string()),
                library_path,
                reason: None,
            };
        }

        // Probe library availability without keeping it loaded if model isn't cached yet
        match CactusLibrary::load() {
            Ok(lib) => MirageStatus {
                available: model_cached,
                library_loaded: true,
                model_loaded: false,
                model_cached,
                model_path: Some(model_path.display().to_string()),
                library_path: Some(lib.path.display().to_string()),
                reason: if model_cached {
                    None
                } else {
                    Some(format!(
                        "Mirage weights ({}) not cached yet at {}",
                        MIRAGE_MODEL_FILENAME,
                        model_path.display()
                    ))
                },
            },
            Err(reason) => MirageStatus {
                available: false,
                library_loaded: false,
                model_loaded: false,
                model_cached,
                model_path: Some(model_path.display().to_string()),
                library_path: None,
                reason: Some(reason),
            },
        }
    }

    fn ensure_model_cached(&self, download_url: Option<&str>) -> Result<PathBuf> {
        let model_path = self.resolve_model_path();
        if model_path.exists() {
            return Ok(model_path);
        }
        if let Some(parent) = model_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                PlethoraError::Internal(format!(
                    "Failed to create Mirage models directory {}: {e}",
                    parent.display()
                ))
            })?;
        }
        let url = download_url
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_MIRAGE_MODEL_URL);

        let resp = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| PlethoraError::Internal(format!("HTTP client init failed: {e}")))?
            .get(url)
            .send()
            .map_err(|e| PlethoraError::Internal(format!("Failed to download mirage.cact: {e}")))?;

        if !resp.status().is_success() {
            return Err(PlethoraError::Internal(format!(
                "Failed to download mirage.cact from {}: HTTP {}",
                url,
                resp.status()
            )));
        }

        let bytes = resp
            .bytes()
            .map_err(|e| PlethoraError::Internal(format!("Failed reading mirage.cact body: {e}")))?;
        let tmp_path = model_path.with_extension("cact.tmp");
        std::fs::write(&tmp_path, &bytes).map_err(|e| {
            PlethoraError::Internal(format!("Failed writing {}: {e}", tmp_path.display()))
        })?;
        std::fs::rename(&tmp_path, &model_path).map_err(|e| {
            PlethoraError::Internal(format!("Failed finalizing {}: {e}", model_path.display()))
        })?;
        Ok(model_path)
    }

    fn describe_rgb(
        &self,
        rgb: &[u8],
        width: u32,
        height: u32,
        options: &MirageRequestOptions,
    ) -> Result<MirageResponse> {
        let started = Instant::now();
        let options_json = serde_json::json!({
            "sections": options.sections.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            "conf": options.conf,
            "text_conf": options.text_conf,
            "mask_format": options.mask_format,
        })
        .to_string();

        let mut guard = self
            .queue_mutex
            .lock()
            .map_err(|_| PlethoraError::Internal("Mirage inference mutex poisoned".to_string()))?;
        let state = self.ensure_loaded(&mut guard)?;
        let raw_json = state
            .library
            .cactus_describe(rgb, width, height, &options_json)
            .map_err(PlethoraError::Internal)?;

        let mut parsed: MirageResponse = serde_json::from_str(&raw_json).map_err(|e| {
            PlethoraError::Internal(format!("Failed to parse Mirage JSON output: {e}"))
        })?;
        if parsed.inference_ms == 0 {
            parsed.inference_ms = started.elapsed().as_millis() as u64;
        }
        parsed.image_width = width;
        parsed.image_height = height;
        Ok(parsed)
    }
}

/// Thread-safe Mirage engine facade managed by Tauri state and background workers.
#[derive(Clone)]
pub struct MirageEngine {
    backend: Arc<dyn MirageBackend>,
}

impl MirageEngine {
    pub fn with_models_dir(models_dir: PathBuf) -> Self {
        Self {
            backend: Arc::new(CactusMirageBackend::new(models_dir)),
        }
    }

    pub fn with_backend(backend: Arc<dyn MirageBackend>) -> Self {
        Self { backend }
    }

    pub fn status(&self) -> MirageStatus {
        self.backend.status()
    }

    pub async fn ensure_model_cached(&self, download_url: Option<String>) -> Result<PathBuf> {
        let backend = Arc::clone(&self.backend);
        tokio::task::spawn_blocking(move || {
            backend.ensure_model_cached(download_url.as_deref())
        })
        .await
        .map_err(|e| PlethoraError::Internal(format!("Mirage model cache task panicked: {e}")))?
    }

    pub async fn describe_rgb(
        &self,
        rgb: Vec<u8>,
        width: u32,
        height: u32,
        options: MirageRequestOptions,
    ) -> Result<MirageResponse> {
        let backend = Arc::clone(&self.backend);
        tokio::task::spawn_blocking(move || backend.describe_rgb(&rgb, width, height, &options))
            .await
            .map_err(|e| PlethoraError::Internal(format!("Mirage inference task panicked: {e}")))?
    }

    pub async fn describe_image_bytes(
        &self,
        bytes: Vec<u8>,
        options: MirageRequestOptions,
    ) -> Result<(MirageResponse, RgbImageBuffer)> {
        let rgb_buf = tokio::task::spawn_blocking(move || decode_image_to_rgb(&bytes))
            .await
            .map_err(|e| PlethoraError::Internal(format!("Image decode task panicked: {e}")))??;
        let response = self
            .describe_rgb(rgb_buf.data.clone(), rgb_buf.width, rgb_buf.height, options)
            .await?;
        Ok((response, rgb_buf))
    }
}

/// Deterministic mock backend for unit & integration tests.
pub struct MockMirageBackend {
    pub response: MirageResponse,
}

impl MirageBackend for MockMirageBackend {
    fn status(&self) -> MirageStatus {
        MirageStatus {
            available: true,
            library_loaded: true,
            model_loaded: true,
            model_cached: true,
            model_path: Some("mock://mirage.cact".to_string()),
            library_path: Some("mock://libcactus.so".to_string()),
            reason: None,
        }
    }

    fn ensure_model_cached(&self, _download_url: Option<&str>) -> Result<PathBuf> {
        Ok(PathBuf::from("mock://mirage.cact"))
    }

    fn describe_rgb(
        &self,
        _rgb: &[u8],
        width: u32,
        height: u32,
        _options: &MirageRequestOptions,
    ) -> Result<MirageResponse> {
        let mut resp = self.response.clone();
        resp.image_width = width;
        resp.image_height = height;
        if resp.inference_ms == 0 {
            resp.inference_ms = 82;
        }
        Ok(resp)
    }
}
