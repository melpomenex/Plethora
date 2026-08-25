//! OCR provider implementations

use crate::error::{PlethoraError, Result};
use base64::Engine;
use image::ImageFormat;
use lopdf::{dictionary, Document, Object, Stream};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

fn expand_home_path(value: &str) -> PathBuf {
    if let Some(relative) = value.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME")
            .map(PathBuf::from)
            .or_else(dirs::home_dir)
        {
            return home.join(relative);
        }
    }
    PathBuf::from(value)
}

/// GUI apps on macOS do not inherit the interactive shell's PATH. Resolve
/// common user and package-manager bin directories before falling back to the
/// ordinary command name.
fn resolve_local_executable(configured: Option<&str>, binary_name: &str) -> PathBuf {
    if let Some(value) = configured.map(str::trim).filter(|value| !value.is_empty()) {
        let configured_path = expand_home_path(value);
        return if configured_path.is_dir() {
            configured_path.join(binary_name)
        } else {
            configured_path
        };
    }

    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|dir| dir.join(binary_name)));
    }
    if let Some(virtual_env) = std::env::var_os("VIRTUAL_ENV") {
        candidates.push(PathBuf::from(virtual_env).join("bin").join(binary_name));
    }
    if let Some(home) = std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
    {
        candidates.push(home.join(".local/bin").join(binary_name));
        candidates.push(home.join("bin").join(binary_name));
        candidates.push(home.join(".pyenv/shims").join(binary_name));

        let python_root = home.join("Library/Python");
        if let Ok(entries) = std::fs::read_dir(python_root) {
            for entry in entries.flatten() {
                candidates.push(entry.path().join("bin").join(binary_name));
            }
        }
    }
    candidates.push(Path::new("/opt/homebrew/bin").join(binary_name));
    candidates.push(Path::new("/usr/local/bin").join(binary_name));

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| PathBuf::from(binary_name))
}

pub(crate) fn resolve_nougat_executables(configured: Option<&str>) -> Vec<PathBuf> {
    if let Some(value) = configured.map(str::trim).filter(|value| !value.is_empty()) {
        let configured_path = expand_home_path(value);
        if configured_path.is_dir() {
            return ["nougat", "nougat_predict"]
                .into_iter()
                .map(|name| configured_path.join(name))
                .collect();
        }
        return vec![configured_path];
    }

    let mut candidates = Vec::new();
    for name in ["nougat", "nougat_predict"] {
        let candidate = resolve_local_executable(None, name);
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
    candidates
}

pub(crate) fn nougat_executable_is_runnable(command: &Path) -> bool {
    std::process::Command::new(command)
        .arg("--help")
        .output()
        .is_ok_and(|output| output.status.success())
}

/// OCR provider type
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum OCRProviderType {
    #[serde(rename = "tesseract")]
    Tesseract,
    #[serde(rename = "google")]
    GoogleDocumentAI,
    #[serde(rename = "aws")]
    AWSTextract,
    #[serde(rename = "azure")]
    AzureVision,
    #[serde(rename = "marker")]
    Marker,
    #[serde(rename = "nougat")]
    Nougat,
    #[serde(rename = "glm")]
    Glmocr,
    #[serde(rename = "mistral")]
    Mistral,
    #[serde(rename = "windows-system")]
    WindowsSystem,
}

/// OCR result with text and metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OCRResult {
    /// Extracted text
    pub text: String,
    /// Confidence score (0-100)
    pub confidence: f64,
    /// Number of lines detected
    pub line_count: usize,
    /// Number of words detected
    pub word_count: usize,
    /// Processing time in milliseconds
    pub processing_time_ms: u64,
    /// Provider used
    pub provider: OCRProviderType,
    /// Additional metadata
    pub metadata: serde_json::Value,
    /// Detected text lines with PIXEL-coordinate bounding boxes, when the
    /// provider exposes them (design D18). Empty for providers without box
    /// support; the command layer normalizes to percent against the real
    /// image dimensions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lines: Vec<TextLine>,
}

/// Axis-aligned pixel rectangle for a detected text region.
///
/// (left, top, right, bottom) in image pixel coordinates. The previous
/// six-field shape was an unused typo; nothing serialized it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoundingBox {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

impl BoundingBox {
    pub fn width(&self) -> f64 {
        (self.right - self.left).max(0.0)
    }

    pub fn height(&self) -> f64 {
        (self.bottom - self.top).max(0.0)
    }
}

/// Detected text line
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextLine {
    pub text: String,
    pub confidence: f64,
    pub bbox: BoundingBox,
}

/// Normalize a pixel box to `[x, y, width, height]` percent 0–100 of the
/// source image (design D18): clamped to bounds, never negative, never > 100.
/// Degenerate dimensions guard against division by zero.
pub fn pixel_box_to_percent(bbox: &BoundingBox, image_width: u32, image_height: u32) -> [f64; 4] {
    let width = image_width.max(1) as f64;
    let height = image_height.max(1) as f64;

    fn percent(value: f64, total: f64) -> f64 {
        (value / total * 100.0).clamp(0.0, 100.0)
    }

    let x = percent(bbox.left, width);
    let y = percent(bbox.top, height);
    let right = percent(bbox.right, width);
    let bottom = percent(bbox.bottom, height);
    [x, y, (right - x).max(0.0), (bottom - y).max(0.0)]
}

/// One word row of Tesseract's TSV output, grouped later into lines.
struct TsvWord {
    block: u32,
    paragraph: u32,
    line: u32,
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
    confidence: f64,
    text: String,
}

/**
 * Parse Tesseract `tsv` output into (page width, page height, text lines).
 *
 * TSV levels: 1 page, 2 block, 3 paragraph, 4 line, 5 word. Only level-1
 * (page dimensions) and level-5 (word boxes + text + confidence) rows are
 * used; words are grouped into lines by (block, paragraph, line) and each
 * line's box is the union of its word boxes. Returns None when the page row
 * or any usable word is missing — callers then surface no lines rather than
 * fabricated geometry.
 */
pub fn parse_tesseract_tsv(tsv: &str) -> Option<(u32, u32, Vec<TextLine>)> {
    let mut page_width: Option<u32> = None;
    let mut page_height: Option<u32> = None;
    let mut words: Vec<TsvWord> = Vec::new();

    for row in tsv.lines() {
        let columns: Vec<&str> = row.split('\t').collect();
        if columns.len() < 12 {
            continue;
        }
        let level = columns[0].parse::<u32>().ok();
        let numbers = |offset: usize| -> Option<Vec<f64>> {
            columns
                .iter()
                .skip(offset)
                .take(4)
                .map(|v| v.trim().parse::<f64>().ok())
                .collect()
        };
        match level {
            Some(1) => {
                // Page row: left, top, width, height of the full page.
                if let Some(rect) = numbers(6) {
                    page_width = Some(rect[2].max(0.0) as u32);
                    page_height = Some(rect[3].max(0.0) as u32);
                }
            }
            Some(5) => {
                let (Ok(block), Ok(paragraph), Ok(line)) = (
                    columns[2].parse::<u32>(),
                    columns[3].parse::<u32>(),
                    columns[4].parse::<u32>(),
                ) else {
                    continue;
                };
                let Some(rect) = numbers(6) else { continue };
                let text = columns[11].trim();
                if text.is_empty() {
                    continue;
                }
                let confidence = columns[10].trim().parse::<f64>().unwrap_or(0.0);
                words.push(TsvWord {
                    block,
                    paragraph,
                    line,
                    left: rect[0],
                    top: rect[1],
                    right: rect[0] + rect[2],
                    bottom: rect[1] + rect[3],
                    confidence,
                    text: text.to_string(),
                });
            }
            _ => {}
        }
    }

    let width = page_width?;
    let height = page_height?;
    if words.is_empty() {
        return Some((width, height, Vec::new()));
    }

    // Group words into lines preserving first-seen order.
    let mut order: Vec<(u32, u32, u32)> = Vec::new();
    for word in &words {
        let key = (word.block, word.paragraph, word.line);
        if !order.contains(&key) {
            order.push(key);
        }
    }

    let lines = order
        .into_iter()
        .map(|key| {
            let group: Vec<&TsvWord> = words
                .iter()
                .filter(|w| (w.block, w.paragraph, w.line) == key)
                .collect();
            let bbox = group.iter().fold(
                BoundingBox {
                    left: f64::MAX,
                    top: f64::MAX,
                    right: f64::MIN,
                    bottom: f64::MIN,
                },
                |acc, w| BoundingBox {
                    left: acc.left.min(w.left),
                    top: acc.top.min(w.top),
                    right: acc.right.max(w.right),
                    bottom: acc.bottom.max(w.bottom),
                },
            );
            let text = group
                .iter()
                .map(|w| w.text.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            let confidence = group.iter().map(|w| w.confidence).sum::<f64>() / group.len() as f64;
            TextLine {
                text,
                confidence,
                bbox,
            }
        })
        .collect();
    Some((width, height, lines))
}

/// OCR error types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OCRError {
    ProviderUnavailable(String),
    InvalidInput(String),
    ProcessingFailed(String),
    ConfigurationError(String),
    RateLimitExceeded,
    InsufficientCredits,
}

impl std::fmt::Display for OCRError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OCRError::ProviderUnavailable(msg) => write!(f, "OCR provider unavailable: {}", msg),
            OCRError::InvalidInput(msg) => write!(f, "Invalid input: {}", msg),
            OCRError::ProcessingFailed(msg) => write!(f, "OCR processing failed: {}", msg),
            OCRError::ConfigurationError(msg) => write!(f, "OCR configuration error: {}", msg),
            OCRError::RateLimitExceeded => write!(f, "OCR rate limit exceeded"),
            OCRError::InsufficientCredits => write!(f, "Insufficient OCR credits"),
        }
    }
}

impl std::error::Error for OCRError {}

/// Trait for OCR providers
#[async_trait::async_trait]
pub trait OCRProvider: Send + Sync {
    /// Get provider type
    fn provider_type(&self) -> OCRProviderType;

    /// Perform OCR on an image file
    async fn process_image(&self, image_path: &std::path::Path) -> Result<OCRResult>;

    /// Perform OCR on image bytes
    async fn process_image_bytes(&self, image_data: &[u8]) -> Result<OCRResult>;

    /// Check if provider is available
    fn is_available(&self) -> bool;

    /// Actionable installation/configuration guidance for when
    /// `is_available()` is false. `None` falls back to a generic message.
    fn unavailability_guidance(&self) -> Option<String> {
        None
    }

    /// Get provider name for display
    fn provider_name(&self) -> &str;
}

/// Tesseract OCR provider (local)
pub struct TesseractProvider {
    tesseract_path: Option<String>,
    /// Tesseract language code (`-l`); `None` falls back to "eng".
    language: Option<String>,
    client: reqwest::Client,
}

impl TesseractProvider {
    pub fn new(tesseract_path: Option<String>, language: Option<String>) -> Self {
        Self {
            tesseract_path,
            language,
            client: reqwest::Client::new(),
        }
    }

    pub fn language_arg(&self) -> &str {
        self.language.as_deref().unwrap_or("eng")
    }

    /// Resolve the tesseract binary path.
    /// If explicitly configured, use that. Otherwise try common locations:
    /// - bare `tesseract` (works if on PATH)
    /// - Homebrew on Apple Silicon: `/opt/homebrew/bin/tesseract`
    /// - Homebrew on Intel Mac: `/usr/local/bin/tesseract`
    fn resolve_cmd(&self) -> String {
        if let Some(ref path) = self.tesseract_path {
            return path.clone();
        }
        // Try common paths in order; return the first that exists
        let candidates = [
            "tesseract",
            "/opt/homebrew/bin/tesseract",
            "/usr/local/bin/tesseract",
        ];
        for candidate in &candidates {
            if std::path::Path::new(candidate).exists() || *candidate == "tesseract" {
                // For bare "tesseract", try running it — if it works, use it
                if std::process::Command::new(candidate)
                    .arg("--version")
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
                {
                    return candidate.to_string();
                }
            }
        }
        // Fallback to bare name — will produce a clear error in check_installation
        "tesseract".to_string()
    }

    /// Check if Tesseract is installed
    pub fn check_installation(&self) -> Result<()> {
        let cmd = self.resolve_cmd();

        let output = std::process::Command::new(&cmd).arg("--version").output();

        match output {
            Ok(output) if output.status.success() => Ok(()),
            _ => Err(PlethoraError::Internal("Tesseract is not installed. Install it with your package manager:\n  • Arch: sudo pacman -S tesseract\n  • Ubuntu/Debian: sudo apt install tesseract-ocr\n  • macOS: brew install tesseract\n  • Windows: download from https://github.com/UB-Mannheim/tesseract/wiki\n\nOr set the tesseract path in Settings > Documents > OCR.".to_string())),
        }
    }
}

impl std::fmt::Debug for TesseractProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TesseractProvider")
            .field("tesseract_path", &self.tesseract_path)
            .finish()
    }
}

#[async_trait::async_trait]
impl OCRProvider for TesseractProvider {
    fn provider_type(&self) -> OCRProviderType {
        OCRProviderType::Tesseract
    }

    async fn process_image(&self, image_path: &std::path::Path) -> Result<OCRResult> {
        let start = std::time::Instant::now();

        self.check_installation()?;

        let cmd = self.resolve_cmd();

        let output = std::process::Command::new(&cmd)
            .arg(image_path)
            .arg("stdout")
            .arg("-l")
            .arg(self.language_arg())
            .output()
            .map_err(|e| PlethoraError::Internal(format!("Failed to run Tesseract: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(PlethoraError::Internal(format!(
                "Tesseract processing failed: {}",
                stderr
            )));
        }

        let text = String::from_utf8_lossy(&output.stdout).to_string();
        let processing_time_ms = start.elapsed().as_millis() as u64;

        // Count lines and words
        let line_count = text.lines().count();
        let word_count = text.split_whitespace().count();

        // Tesseract doesn't provide confidence in simple mode
        // In production, you'd use the HOCR output format
        let confidence = 75.0; // Default confidence

        Ok(OCRResult {
            text,
            confidence,
            line_count,
            word_count,
            processing_time_ms,
            provider: OCRProviderType::Tesseract,
            metadata: serde_json::json!({
                "engine": "Tesseract",
                "version": "4.x"
            }),
            lines: Vec::new(),
        })
    }

    async fn process_image_bytes(&self, image_data: &[u8]) -> Result<OCRResult> {
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join(format!("ocr_{}.png", uuid::Uuid::new_v4()));

        tokio::fs::write(&temp_file, image_data)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to write temp file: {}", e)))?;

        let result = self.process_image(&temp_file).await;

        // The bytes path feeds the AI image-occlusion flow (design D18), which
        // needs per-line pixel boxes. One extra `tsv` run attaches them; any
        // failure (older binary, empty page) degrades to zero lines — the
        // text result above stays untouched. File-path consumers keep the
        // single-run cost.
        let mut result = result?;

        let tsv_output = std::process::Command::new(self.resolve_cmd())
            .arg(&temp_file)
            .arg("stdout")
            .arg("-l")
            .arg(self.language_arg())
            .arg("tsv")
            .output();
        if let Ok(output) = tsv_output {
            if output.status.success() {
                let tsv = String::from_utf8_lossy(&output.stdout);
                if let Some((_page_w, _page_h, lines)) = parse_tesseract_tsv(&tsv) {
                    result.lines = lines;
                }
            }
        }

        let _ = tokio::fs::remove_file(&temp_file).await;

        Ok(result)
    }

    fn is_available(&self) -> bool {
        self.check_installation().is_ok()
    }

    fn unavailability_guidance(&self) -> Option<String> {
        self.check_installation().err().map(|e| e.to_string())
    }

    fn provider_name(&self) -> &str {
        "Tesseract"
    }
}

/// Google Document AI provider (cloud)
pub struct GoogleDocumentAIProvider {
    project_id: String,
    location: String,
    processor_id: String,
    credentials: String,
    client: reqwest::Client,
}

impl GoogleDocumentAIProvider {
    pub fn new(config: super::GoogleDocumentAIConfig) -> Self {
        Self {
            project_id: config.project_id,
            location: config.location,
            processor_id: config.processor_id,
            credentials: config.credentials_path,
            client: reqwest::Client::new(),
        }
    }
}

impl std::fmt::Debug for GoogleDocumentAIProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GoogleDocumentAIProvider")
            .field("project_id", &self.project_id)
            .field("location", &self.location)
            .field("processor_id", &self.processor_id)
            .finish()
    }
}

#[async_trait::async_trait]
impl OCRProvider for GoogleDocumentAIProvider {
    fn provider_type(&self) -> OCRProviderType {
        OCRProviderType::GoogleDocumentAI
    }

    async fn process_image(&self, image_path: &std::path::Path) -> Result<OCRResult> {
        let _start = std::time::Instant::now();

        // Read image file
        let image_data = tokio::fs::read(image_path)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to read image: {}", e)))?;

        let mut result = self.process_image_bytes(&image_data).await?;
        result.metadata["image_path"] = serde_json::json!(image_path.to_string_lossy());

        Ok(result)
    }

    async fn process_image_bytes(&self, _image_data: &[u8]) -> Result<OCRResult> {
        // In production, this would use the Google Document AI client library
        // For now, return a placeholder error
        Err(PlethoraError::Internal(
            "Google Document AI integration requires additional dependencies. Please use Tesseract for now.".to_string()
        ))
    }

    fn is_available(&self) -> bool {
        std::path::Path::new(&self.credentials).exists()
    }

    fn provider_name(&self) -> &str {
        "Google Document AI"
    }
}

/// AWS Textract provider (cloud)
pub struct AWSTextractProvider {
    region: String,
    access_key: String,
    secret_key: String,
    client: reqwest::Client,
}

impl AWSTextractProvider {
    pub fn new(config: super::AWSTextractConfig) -> Self {
        Self {
            region: config.region,
            access_key: config.access_key,
            secret_key: config.secret_key,
            client: reqwest::Client::new(),
        }
    }
}

impl std::fmt::Debug for AWSTextractProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AWSTextractProvider")
            .field("region", &self.region)
            .finish()
    }
}

#[async_trait::async_trait]
impl OCRProvider for AWSTextractProvider {
    fn provider_type(&self) -> OCRProviderType {
        OCRProviderType::AWSTextract
    }

    async fn process_image(&self, image_path: &std::path::Path) -> Result<OCRResult> {
        // Read image file
        let image_data = tokio::fs::read(image_path)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to read image: {}", e)))?;

        self.process_image_bytes(&image_data).await
    }

    async fn process_image_bytes(&self, _image_data: &[u8]) -> Result<OCRResult> {
        // In production, this would use the AWS SDK for Rust
        // For now, return a placeholder error
        Err(PlethoraError::Internal(
            "AWS Textract integration requires additional dependencies. Please use Tesseract for now.".to_string()
        ))
    }

    fn is_available(&self) -> bool {
        !self.access_key.is_empty() && !self.secret_key.is_empty()
    }

    fn provider_name(&self) -> &str {
        "AWS Textract"
    }
}

/// Azure Computer Vision provider (cloud)
pub struct AzureVisionProvider {
    endpoint: String,
    api_key: String,
    client: reqwest::Client,
}

impl AzureVisionProvider {
    pub fn new(config: super::AzureVisionConfig) -> Self {
        Self {
            endpoint: config.endpoint,
            api_key: config.api_key,
            client: reqwest::Client::new(),
        }
    }
}

impl std::fmt::Debug for AzureVisionProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AzureVisionProvider")
            .field("endpoint", &self.endpoint)
            .finish()
    }
}

#[async_trait::async_trait]
impl OCRProvider for AzureVisionProvider {
    fn provider_type(&self) -> OCRProviderType {
        OCRProviderType::AzureVision
    }

    async fn process_image(&self, image_path: &std::path::Path) -> Result<OCRResult> {
        // Read image file
        let image_data = tokio::fs::read(image_path)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to read image: {}", e)))?;

        self.process_image_bytes(&image_data).await
    }

    async fn process_image_bytes(&self, _image_data: &[u8]) -> Result<OCRResult> {
        // In production, this would use the Azure SDK for Rust
        // For now, return a placeholder error
        Err(PlethoraError::Internal(
            "Azure Computer Vision integration requires additional dependencies. Please use Tesseract for now.".to_string()
        ))
    }

    fn is_available(&self) -> bool {
        !self.api_key.is_empty() && !self.endpoint.is_empty()
    }

    fn provider_name(&self) -> &str {
        "Azure Computer Vision"
    }
}

/// Marker OCR provider (local PDF to markdown converter)
pub struct MarkerProvider {
    marker_path: Option<String>,
}

impl MarkerProvider {
    pub fn new(marker_path: Option<String>) -> Self {
        Self { marker_path }
    }

    /// Check if Marker is installed
    pub fn check_installation(&self) -> Result<()> {
        let cmd = self
            .marker_path
            .clone()
            .unwrap_or_else(|| "marker".to_string());

        let output = std::process::Command::new(&cmd).arg("--version").output();

        match output {
            Ok(output) if output.status.success() => Ok(()),
            _ => Err(PlethoraError::Internal(
                "Marker not found. Please install it or provide the correct path.".to_string(),
            )),
        }
    }
}

impl std::fmt::Debug for MarkerProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MarkerProvider")
            .field("marker_path", &self.marker_path)
            .finish()
    }
}

#[async_trait::async_trait]
impl OCRProvider for MarkerProvider {
    fn provider_type(&self) -> OCRProviderType {
        OCRProviderType::Marker
    }

    async fn process_image(&self, image_path: &std::path::Path) -> Result<OCRResult> {
        let start = std::time::Instant::now();

        // Marker expects PDFs, for images we can convert first or use Tesseract
        // For now, we'll try running marker and it will handle the conversion
        let cmd = self
            .marker_path
            .clone()
            .unwrap_or_else(|| "marker".to_string());

        let output = std::process::Command::new(&cmd)
            .arg(image_path)
            .arg("--output_format")
            .arg("markdown")
            .output()
            .map_err(|e| PlethoraError::Internal(format!("Failed to run Marker: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(PlethoraError::Internal(format!(
                "Marker processing failed: {}",
                stderr
            )));
        }

        let text = String::from_utf8_lossy(&output.stdout).to_string();
        let processing_time_ms = start.elapsed().as_millis() as u64;

        let line_count = text.lines().count();
        let word_count = text.split_whitespace().count();

        Ok(OCRResult {
            text,
            confidence: 85.0, // Marker typically has good accuracy
            line_count,
            word_count,
            processing_time_ms,
            provider: OCRProviderType::Marker,
            metadata: serde_json::json!({
                "engine": "Marker",
                "format": "markdown"
            }),
            lines: Vec::new(),
        })
    }

    async fn process_image_bytes(&self, image_data: &[u8]) -> Result<OCRResult> {
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join(format!("ocr_{}.png", uuid::Uuid::new_v4()));

        tokio::fs::write(&temp_file, image_data)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to write temp file: {}", e)))?;

        let result = self.process_image(&temp_file).await;

        let _ = tokio::fs::remove_file(&temp_file).await;

        result
    }

    fn is_available(&self) -> bool {
        self.check_installation().is_ok()
    }

    fn provider_name(&self) -> &str {
        "Marker"
    }
}

/// Nougat OCR provider (scientific documents with math)
pub struct NougatProvider {
    nougat_path: Option<String>,
}

impl NougatProvider {
    pub fn new(nougat_path: Option<String>) -> Self {
        Self { nougat_path }
    }

    /// Check if Nougat is installed
    pub fn check_installation(&self) -> Result<()> {
        let candidates = resolve_nougat_executables(self.nougat_path.as_deref());
        for command in &candidates {
            // The official `nougat-ocr` CLI exposes `--help`, but older
            // releases do not expose a `--version` flag.
            if nougat_executable_is_runnable(command) {
                return Ok(());
            }
        }
        Err(PlethoraError::Internal(format!(
            "Nougat was not runnable at any detected path: {}. Set the executable or bin-directory path in Settings > Documents > OCR.",
            candidates
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )))
    }

    fn prepare_pdf_input(image_path: &Path, working_directory: &Path) -> Result<PathBuf> {
        if image_path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
        {
            return Ok(image_path.to_path_buf());
        }

        // The official Nougat CLI accepts PDFs only. OCR image selections are
        // therefore wrapped in a one-page PDF before being sent to Nougat.
        let image = image::open(image_path).map_err(|error| {
            PlethoraError::Internal(format!("Failed to prepare the image for Nougat: {error}"))
        })?;
        let rgb = image.to_rgb8();
        let (width, height) = rgb.dimensions();
        if width == 0 || height == 0 {
            return Err(PlethoraError::Internal(
                "Failed to prepare an empty image for Nougat".to_string(),
            ));
        }

        let mut document = Document::with_version("1.5");
        let pages_id = document.new_object_id();

        let mut image_stream = Stream::new(
            lopdf::dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => i64::from(width),
                "Height" => i64::from(height),
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
            },
            rgb.into_raw(),
        );
        image_stream.compress().map_err(|error| {
            PlethoraError::Internal(format!(
                "Failed to compress the temporary Nougat PDF: {error}"
            ))
        })?;
        let image_id = document.add_object(image_stream);
        let resources_id = document.add_object(lopdf::dictionary! {
            "XObject" => lopdf::dictionary! {
                "NougatInput" => image_id,
            },
        });
        let content = format!("q\n{} 0 0 {} 0 0 cm\n/NougatInput Do\nQ\n", width, height);
        let content_id =
            document.add_object(Stream::new(lopdf::dictionary! {}, content.into_bytes()));
        let page_id = document.add_object(lopdf::dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Resources" => resources_id,
            "MediaBox" => vec![
                Object::Integer(0),
                Object::Integer(0),
                Object::Integer(i64::from(width)),
                Object::Integer(i64::from(height)),
            ],
            "Contents" => content_id,
        });
        document.objects.insert(
            pages_id,
            Object::Dictionary(lopdf::dictionary! {
                "Type" => "Pages",
                "Kids" => vec![Object::Reference(page_id)],
                "Count" => 1,
            }),
        );
        let catalog_id = document.add_object(lopdf::dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        document.trailer.set("Root", catalog_id);
        document.compress();

        let pdf_path = working_directory.join("nougat-input.pdf");
        document.save(&pdf_path).map_err(|error| {
            PlethoraError::Internal(format!("Failed to save the temporary Nougat PDF: {error}"))
        })?;
        Ok(pdf_path)
    }

    fn read_output(
        output_directory: &Path,
        input_path: &Path,
        stdout: &[u8],
        stderr: &[u8],
    ) -> Result<String> {
        let expected_path = output_directory
            .join(
                input_path
                    .file_stem()
                    .unwrap_or_else(|| std::ffi::OsStr::new("nougat-input")),
            )
            .with_extension("mmd");

        let output_path = if expected_path.is_file() {
            Some(expected_path)
        } else {
            std::fs::read_dir(output_directory)
                .ok()
                .into_iter()
                .flatten()
                .filter_map(|entry| entry.ok().map(|entry| entry.path()))
                .find(|path| {
                    path.extension()
                        .and_then(|extension| extension.to_str())
                        .is_some_and(|extension| extension.eq_ignore_ascii_case("mmd"))
                })
        };

        if let Some(output_path) = output_path {
            return std::fs::read_to_string(&output_path).map_err(|error| {
                PlethoraError::Internal(format!(
                    "Nougat created {} but it could not be read: {error}",
                    output_path.display()
                ))
            });
        }

        // Keep compatibility with alternative/older Nougat launchers that
        // print their Markdown result instead of writing an .mmd file.
        let stdout = String::from_utf8_lossy(stdout).trim().to_string();
        if !stdout.is_empty() {
            return Ok(stdout);
        }

        let stderr = String::from_utf8_lossy(stderr).replace('\r', "");
        if stderr.contains("'PdfDocument' object has no attribute 'render'") {
            return Err(PlethoraError::Internal(
                "Nougat's PDF renderer is incompatible. Open Settings > Documents > OCR and choose Repair installation."
                    .to_string(),
            ));
        }
        let diagnostic = stderr
            .lines()
            .filter(|line| !line.trim().is_empty())
            .rev()
            .take(12)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        Err(PlethoraError::Internal(format!(
            "Nougat completed but did not create an .mmd result in {}{}",
            output_directory.display(),
            if diagnostic.is_empty() {
                String::new()
            } else {
                format!(". Nougat diagnostics:\n{diagnostic}")
            }
        )))
    }
}

impl std::fmt::Debug for NougatProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NougatProvider")
            .field("nougat_path", &self.nougat_path)
            .finish()
    }
}

#[async_trait::async_trait]
impl OCRProvider for NougatProvider {
    fn provider_type(&self) -> OCRProviderType {
        OCRProviderType::Nougat
    }

    async fn process_image(&self, image_path: &std::path::Path) -> Result<OCRResult> {
        let start = std::time::Instant::now();
        let working_directory = tempfile::tempdir().map_err(|error| {
            PlethoraError::Internal(format!(
                "Failed to create a temporary Nougat directory: {error}"
            ))
        })?;
        let input_path = Self::prepare_pdf_input(image_path, working_directory.path())?;
        let output_directory = working_directory.path().join("output");
        std::fs::create_dir_all(&output_directory).map_err(|error| {
            PlethoraError::Internal(format!(
                "Failed to create the temporary Nougat output directory: {error}"
            ))
        })?;

        let candidates = resolve_nougat_executables(self.nougat_path.as_deref());
        let mut failures = Vec::new();
        let mut successful_output = None;
        for command in &candidates {
            match std::process::Command::new(command)
                .arg(&input_path)
                .arg("-o")
                .arg(&output_directory)
                .output()
            {
                Ok(output) if output.status.success() => {
                    successful_output = Some(output);
                    break;
                }
                Ok(output) => {
                    failures.push(format!(
                        "{}: {}",
                        command.display(),
                        String::from_utf8_lossy(&output.stderr).trim()
                    ));
                }
                Err(error) => failures.push(format!("{}: {}", command.display(), error)),
            }
        }
        let output = successful_output.ok_or_else(|| {
            PlethoraError::Internal(format!(
                "Failed to run Nougat. Tried {}. Set the executable or bin-directory path in Settings > Documents > OCR. {}",
                candidates
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", "),
                failures.join("; ")
            ))
        })?;

        let text = Self::read_output(
            &output_directory,
            &input_path,
            &output.stdout,
            &output.stderr,
        )?;
        let processing_time_ms = start.elapsed().as_millis() as u64;

        let line_count = text.lines().count();
        let word_count = text.split_whitespace().count();

        Ok(OCRResult {
            text,
            confidence: 80.0, // Nougat is good but can struggle with complex layouts
            line_count,
            word_count,
            processing_time_ms,
            provider: OCRProviderType::Nougat,
            metadata: serde_json::json!({
                "engine": "Nougat",
                "math_support": true
            }),
            lines: Vec::new(),
        })
    }

    async fn process_image_bytes(&self, image_data: &[u8]) -> Result<OCRResult> {
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join(format!("ocr_{}.png", uuid::Uuid::new_v4()));

        tokio::fs::write(&temp_file, image_data)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to write temp file: {}", e)))?;

        let result = self.process_image(&temp_file).await;

        let _ = tokio::fs::remove_file(&temp_file).await;

        result
    }

    fn is_available(&self) -> bool {
        self.check_installation().is_ok()
    }

    fn provider_name(&self) -> &str {
        "Nougat"
    }
}

/// GLM-OCR provider (vLLM OpenAI-compatible endpoint)
pub struct GLMOCRProvider {
    endpoint: String,
    model: String,
    api_key: Option<String>,
    client: reqwest::Client,
}

impl GLMOCRProvider {
    pub fn new(config: super::GLMOCRConfig) -> Self {
        Self {
            endpoint: config.endpoint,
            model: config.model,
            api_key: config.api_key,
            client: reqwest::Client::new(),
        }
    }

    fn build_chat_url(&self) -> String {
        let trimmed = self.endpoint.trim_end_matches('/');
        if trimmed.ends_with("/chat/completions") {
            trimmed.to_string()
        } else if trimmed.ends_with("/v1") {
            format!("{}/chat/completions", trimmed)
        } else {
            format!("{}/v1/chat/completions", trimmed)
        }
    }

    fn guess_mime(bytes: &[u8]) -> &'static str {
        if let Ok(format) = image::guess_format(bytes) {
            match format {
                ImageFormat::Png => "image/png",
                ImageFormat::Jpeg => "image/jpeg",
                ImageFormat::Gif => "image/gif",
                ImageFormat::Bmp => "image/bmp",
                ImageFormat::Tiff => "image/tiff",
                ImageFormat::WebP => "image/webp",
                _ => "image/png",
            }
        } else {
            "image/png"
        }
    }

    fn extract_message_text(content: &ChatContent) -> String {
        match content {
            ChatContent::Text(text) => text.clone(),
            ChatContent::Parts(parts) => parts
                .iter()
                .filter_map(|part| part.text.as_ref())
                .cloned()
                .collect::<Vec<String>>()
                .join(""),
        }
    }

    fn is_pdf(bytes: &[u8]) -> bool {
        bytes.starts_with(b"%PDF-")
    }

    fn extract_pdf_page_images(bytes: &[u8]) -> Result<Vec<(Vec<u8>, String)>> {
        let doc = Document::load_mem(bytes)
            .map_err(|e| PlethoraError::Internal(format!("Failed to load PDF: {}", e)))?;

        let pages = doc.get_pages();
        let mut images = Vec::new();

        for (_, page_id) in pages.iter() {
            let page_images = match doc.get_page_images(*page_id) {
                Ok(images) => images,
                Err(_) => continue,
            };

            let mut best_image: Option<(Vec<u8>, String, i64)> = None;
            for image in page_images {
                let filters = image.filters.clone().unwrap_or_default();
                let mime = if filters.iter().any(|f| f.eq_ignore_ascii_case("DCTDecode")) {
                    "image/jpeg"
                } else if filters.iter().any(|f| f.eq_ignore_ascii_case("JPXDecode")) {
                    "image/jp2"
                } else {
                    continue;
                };

                let area = image.width.saturating_mul(image.height);
                if image.content.is_empty() {
                    continue;
                }

                let should_replace = best_image
                    .as_ref()
                    .map(|(_, _, best_area)| area > *best_area)
                    .unwrap_or(true);

                if should_replace {
                    best_image = Some((image.content.to_vec(), mime.to_string(), area));
                }
            }

            if let Some((bytes, mime, _)) = best_image {
                images.push((bytes, mime));
            }
        }

        Ok(images)
    }

    async fn process_image_bytes_with_mime(
        &self,
        image_data: &[u8],
        mime: &str,
    ) -> Result<OCRResult> {
        let start = std::time::Instant::now();

        // Build the data URL into a single pre-sized buffer. This avoids the
        // separate `encoded` String and the `format!` copy, so only one copy of
        // the base64 payload (inside `data_url`) is resident transiently.
        let prefix = "data:";
        let separator = ";base64,";
        let base64_len = (image_data.len() + 2) / 3 * 4;
        let mut data_url =
            String::with_capacity(prefix.len() + mime.len() + separator.len() + base64_len);
        data_url.push_str(prefix);
        data_url.push_str(mime);
        data_url.push_str(separator);
        base64::engine::general_purpose::STANDARD.encode_string(image_data, &mut data_url);

        let request_body = serde_json::json!({
            "model": self.model.as_str(),
            "messages": [
                {
                    "role": "system",
                    "content": "You are an OCR engine. Return only the extracted content as Markdown."
                },
                {
                    "role": "user",
                    "content": [
                        { "type": "text", "text": "Extract all text from this image. Preserve structure using Markdown where helpful." },
                        { "type": "image_url", "image_url": { "url": data_url } }
                    ]
                }
            ],
            "temperature": 0,
            "max_tokens": 4096
        });

        let url = self.build_chat_url();
        let mut request = self.client.post(url).json(&request_body);
        if let Some(api_key) = &self.api_key {
            if !api_key.is_empty() {
                request = request.bearer_auth(api_key);
            }
        }

        let response = request.send().await.map_err(|e| {
            PlethoraError::Internal(format!("Failed to call GLM-OCR endpoint: {}", e))
        })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(PlethoraError::Internal(format!(
                "GLM-OCR request failed ({}): {}",
                status, body
            )));
        }

        let parsed: ChatCompletionResponse = response.json().await.map_err(|e| {
            PlethoraError::Internal(format!("Failed to parse GLM-OCR response: {}", e))
        })?;

        let content = parsed
            .choices
            .first()
            .ok_or_else(|| PlethoraError::Internal("GLM-OCR returned no choices".to_string()))?;

        let text = Self::extract_message_text(&content.message.content);

        if text.trim().is_empty() {
            return Err(PlethoraError::Internal(
                "GLM-OCR returned empty content".to_string(),
            ));
        }

        let processing_time_ms = start.elapsed().as_millis() as u64;
        let line_count = text.lines().count();
        let word_count = text.split_whitespace().count();

        Ok(OCRResult {
            text,
            confidence: 85.0,
            line_count,
            word_count,
            processing_time_ms,
            provider: OCRProviderType::Glmocr,
            metadata: serde_json::json!({
                "engine": "GLM-OCR",
                "format": "markdown",
                "model": self.model.clone()
            }),
            lines: Vec::new(),
        })
    }
}

impl std::fmt::Debug for GLMOCRProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GLMOCRProvider")
            .field("endpoint", &self.endpoint)
            .field("model", &self.model)
            .finish()
    }
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: ChatContent,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ChatContent {
    Text(String),
    Parts(Vec<ChatContentPart>),
}

#[derive(Debug, Deserialize)]
struct ChatContentPart {
    #[serde(rename = "type")]
    part_type: String,
    text: Option<String>,
}

#[async_trait::async_trait]
impl OCRProvider for GLMOCRProvider {
    fn provider_type(&self) -> OCRProviderType {
        OCRProviderType::Glmocr
    }

    async fn process_image(&self, image_path: &std::path::Path) -> Result<OCRResult> {
        let image_data = tokio::fs::read(image_path)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to read image: {}", e)))?;

        if Self::is_pdf(&image_data) {
            let page_images = Self::extract_pdf_page_images(&image_data)?;
            if page_images.is_empty() {
                return Err(PlethoraError::Internal(
                    "GLM-OCR could not find images in this PDF. Try a different OCR provider."
                        .to_string(),
                ));
            }

            let start = std::time::Instant::now();
            let mut combined_text = String::new();
            let mut confidence_sum = 0.0;
            let mut page_count = 0;

            for (index, (bytes, mime)) in page_images.iter().enumerate() {
                let result = self.process_image_bytes_with_mime(bytes, mime).await?;
                if index > 0 && !combined_text.is_empty() {
                    combined_text.push_str("\n\n");
                }
                combined_text.push_str(&result.text);
                confidence_sum += result.confidence;
                page_count += 1;
            }

            let processing_time_ms = start.elapsed().as_millis() as u64;
            let line_count = combined_text.lines().count();
            let word_count = combined_text.split_whitespace().count();
            let confidence = if page_count > 0 {
                confidence_sum / page_count as f64
            } else {
                0.0
            };

            return Ok(OCRResult {
                text: combined_text,
                confidence,
                line_count,
                word_count,
                processing_time_ms,
                provider: OCRProviderType::Glmocr,
                metadata: serde_json::json!({
                    "engine": "GLM-OCR",
                    "format": "markdown",
                    "model": self.model.clone(),
                    "pages": page_count
                }),
                lines: Vec::new(),
            });
        }

        let mut result = self.process_image_bytes(&image_data).await?;
        result.metadata["image_path"] = serde_json::json!(image_path.to_string_lossy());
        Ok(result)
    }

    async fn process_image_bytes(&self, image_data: &[u8]) -> Result<OCRResult> {
        let mime = Self::guess_mime(image_data);
        self.process_image_bytes_with_mime(image_data, mime).await
    }

    fn is_available(&self) -> bool {
        !self.endpoint.trim().is_empty() && !self.model.trim().is_empty()
    }

    fn provider_name(&self) -> &str {
        "GLM-OCR"
    }
}

/// Mistral OCR provider (cloud)
pub struct MistralProvider {
    api_key: String,
    model: String,
    client: reqwest::Client,
}

impl MistralProvider {
    pub fn new(config: super::MistralOCRConfig) -> Self {
        let model = config
            .model
            .unwrap_or_else(|| "mistral-ocr-latest".to_string());
        let model = if model.trim().is_empty() {
            "mistral-ocr-latest".to_string()
        } else {
            model
        };
        Self {
            api_key: config.api_key,
            model,
            client: reqwest::Client::new(),
        }
    }

    fn guess_mime(bytes: &[u8]) -> &'static str {
        if let Ok(format) = image::guess_format(bytes) {
            match format {
                ImageFormat::Png => "image/png",
                ImageFormat::Jpeg => "image/jpeg",
                ImageFormat::Gif => "image/gif",
                ImageFormat::Bmp => "image/bmp",
                ImageFormat::Tiff => "image/tiff",
                ImageFormat::WebP => "image/webp",
                _ => "image/png",
            }
        } else {
            "image/png"
        }
    }

    fn is_pdf(bytes: &[u8]) -> bool {
        bytes.starts_with(b"%PDF-")
    }

    fn markdown_to_html(markdown_input: &str) -> String {
        use pulldown_cmark::{html, Options, Parser};
        let mut options = Options::empty();
        options.insert(Options::ENABLE_TABLES);
        options.insert(Options::ENABLE_FOOTNOTES);
        options.insert(Options::ENABLE_STRIKETHROUGH);
        options.insert(Options::ENABLE_TASKLISTS);
        options.insert(Options::ENABLE_HEADING_ATTRIBUTES);

        let parser = Parser::new_ext(markdown_input, options);
        let mut html_output = String::new();
        html::push_html(&mut html_output, parser);

        format!(
            r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: var(--foreground, #333);
      background-color: var(--background, #fff);
      padding: 2rem;
      max-width: 800px;
      margin: 0 auto;
    }}
    table {{
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 1rem;
    }}
    th, td {{
      border: 1px solid var(--border, #ddd);
      padding: 8px;
      text-align: left;
    }}
    th {{
      background-color: var(--muted, #f5f5f5);
    }}
    img {{
      max-width: 100%;
      height: auto;
    }}
  </style>
</head>
<body>
  {}
</body>
</html>"#,
            html_output
        )
    }

    async fn process_image_bytes_internal(&self, image_data: &[u8]) -> Result<OCRResult> {
        let start = std::time::Instant::now();

        if self.api_key.trim().is_empty() {
            return Err(PlethoraError::Internal(
                "Mistral API key is not configured".to_string(),
            ));
        }

        let is_pdf = Self::is_pdf(image_data);
        let (filename, mime) = if is_pdf {
            ("document.pdf", "application/pdf")
        } else {
            ("document.png", Self::guess_mime(image_data))
        };

        // 1. Upload the file
        let part = reqwest::multipart::Part::bytes(image_data.to_vec())
            .file_name(filename)
            .mime_str(mime)
            .map_err(|e| {
                PlethoraError::Internal(format!("Failed to build multipart part: {}", e))
            })?;

        let form = reqwest::multipart::Form::new()
            .text("purpose", "ocr")
            .part("file", part);

        let upload_res = self
            .client
            .post("https://api.mistral.ai/v1/files")
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| {
                PlethoraError::Internal(format!("Failed to upload file to Mistral: {}", e))
            })?;

        if !upload_res.status().is_success() {
            let status = upload_res.status();
            let body = upload_res.text().await.unwrap_or_default();
            return Err(PlethoraError::Internal(format!(
                "Mistral upload request failed ({}): {}",
                status, body
            )));
        }

        #[derive(Deserialize)]
        struct MistralUploadResponse {
            id: String,
        }

        let upload_data: MistralUploadResponse = upload_res.json().await.map_err(|e| {
            PlethoraError::Internal(format!("Failed to parse Mistral upload response: {}", e))
        })?;

        let file_id = upload_data.id;

        // 2. Perform OCR (with automatic cleanup)
        let ocr_url = "https://api.mistral.ai/v1/ocr";
        let ocr_payload = serde_json::json!({
            "model": self.model.as_str(),
            "document": {
                "type": "file_id",
                "file_id": file_id.as_str()
            }
        });

        let ocr_future = self
            .client
            .post(ocr_url)
            .bearer_auth(&self.api_key)
            .json(&ocr_payload)
            .send();

        let ocr_res = ocr_future.await;

        // 3. File Deletion / Cleanup
        let delete_url = format!("https://api.mistral.ai/v1/files/{}", file_id);
        let delete_future = self
            .client
            .delete(&delete_url)
            .bearer_auth(&self.api_key)
            .send();

        if let Err(e) = delete_future.await {
            log::warn!("Failed to delete temporary Mistral file {}: {}", file_id, e);
        }

        let response = ocr_res.map_err(|e| {
            PlethoraError::Internal(format!("Failed to call Mistral OCR endpoint: {}", e))
        })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(PlethoraError::Internal(format!(
                "Mistral OCR request failed ({}): {}",
                status, body
            )));
        }

        #[derive(Deserialize)]
        struct MistralOCRResponse {
            pages: Vec<MistralOCRPage>,
        }

        #[derive(Deserialize)]
        struct MistralOCRPage {
            markdown: String,
        }

        let parsed: MistralOCRResponse = response.json().await.map_err(|e| {
            PlethoraError::Internal(format!("Failed to parse Mistral OCR response: {}", e))
        })?;

        if parsed.pages.is_empty() {
            return Err(PlethoraError::Internal(
                "Mistral OCR returned no pages".to_string(),
            ));
        }

        // Combine markdown content across pages
        let mut combined_markdown = String::new();
        for (idx, page) in parsed.pages.iter().enumerate() {
            if idx > 0 {
                // Add page break visual indicator
                combined_markdown.push_str("\n\n<hr class=\"page-break\" style=\"page-break-after: always; margin: 2rem 0; border: 0; border-top: 1px dashed #ccc;\" />\n\n");
            }
            combined_markdown.push_str(&page.markdown);
        }

        // Convert the final combined markdown to HTML
        let text = Self::markdown_to_html(&combined_markdown);

        let processing_time_ms = start.elapsed().as_millis() as u64;
        let line_count = text.lines().count();
        let word_count = text.split_whitespace().count();

        Ok(OCRResult {
            text,
            confidence: 95.0, // Mistral is high-quality AI-driven OCR
            line_count,
            word_count,
            processing_time_ms,
            provider: OCRProviderType::Mistral,
            metadata: serde_json::json!({
                "engine": "Mistral OCR",
                "format": "html",
                "model": self.model.clone()
            }),
            lines: Vec::new(),
        })
    }
}

impl std::fmt::Debug for MistralProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MistralProvider")
            .field("model", &self.model)
            .finish()
    }
}

#[async_trait::async_trait]
impl OCRProvider for MistralProvider {
    fn provider_type(&self) -> OCRProviderType {
        OCRProviderType::Mistral
    }

    async fn process_image(&self, image_path: &std::path::Path) -> Result<OCRResult> {
        let image_data = tokio::fs::read(image_path)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to read image: {}", e)))?;

        self.process_image_bytes(&image_data).await
    }

    async fn process_image_bytes(&self, image_data: &[u8]) -> Result<OCRResult> {
        self.process_image_bytes_internal(image_data).await
    }

    fn is_available(&self) -> bool {
        !self.api_key.trim().is_empty()
    }

    fn provider_name(&self) -> &str {
        "Mistral OCR"
    }
}

/// Windows System OCR via WinRT TextRecognizer (Windows 11 24H2+, NPU-class hardware).
pub struct WindowsSystemOCRProvider;

impl WindowsSystemOCRProvider {
    pub fn new() -> Self {
        Self
    }
}

impl std::fmt::Debug for WindowsSystemOCRProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WindowsSystemOCRProvider").finish()
    }
}

#[async_trait::async_trait]
impl OCRProvider for WindowsSystemOCRProvider {
    fn provider_type(&self) -> OCRProviderType {
        OCRProviderType::WindowsSystem
    }

    async fn process_image(&self, image_path: &std::path::Path) -> Result<OCRResult> {
        let image_data = tokio::fs::read(image_path)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to read image: {}", e)))?;
        self.process_image_bytes(&image_data).await
    }

    async fn process_image_bytes(&self, image_data: &[u8]) -> Result<OCRResult> {
        let start = std::time::Instant::now();
        let recognized = plethora_windows_intelligence::recognize_text_from_image_bytes(image_data)
            .map_err(|e| PlethoraError::Internal(format!("{e}")))?;

        let lines: Vec<TextLine> = recognized
            .lines
            .iter()
            .map(|line| TextLine {
                text: line.text.clone(),
                confidence: line.confidence,
                bbox: BoundingBox {
                    left: line.left,
                    top: line.top,
                    right: line.right,
                    bottom: line.bottom,
                },
            })
            .collect();

        let line_count = if lines.is_empty() {
            recognized.text.lines().count()
        } else {
            lines.len()
        };
        let word_count = recognized.text.split_whitespace().count();
        let processing_time_ms = start.elapsed().as_millis() as u64;

        Ok(OCRResult {
            text: recognized.text,
            confidence: recognized.confidence,
            line_count,
            word_count,
            processing_time_ms,
            provider: OCRProviderType::WindowsSystem,
            metadata: serde_json::json!({
                "engine": "Windows System OCR",
                "winrt": "Microsoft.Windows.AI.Imaging.TextRecognizer"
            }),
            lines,
        })
    }

    fn is_available(&self) -> bool {
        plethora_windows_intelligence::ocr_is_available()
    }

    fn unavailability_guidance(&self) -> Option<String> {
        if self.is_available() {
            return None;
        }
        Some(
            "Windows System OCR requires Windows 11 24H2+, package identity, and compatible on-device AI hardware. \
             Check Settings > AI > On-device or run Windows AI diagnostics."
                .to_string(),
        )
    }

    fn provider_name(&self) -> &str {
        "Windows System OCR"
    }
}

/// Create OCR provider from type and config
pub fn create_provider(
    provider_type: OCRProviderType,
    config: &super::OCRConfig,
) -> Result<Box<dyn OCRProvider>> {
    match provider_type {
        OCRProviderType::Tesseract => Ok(Box::new(TesseractProvider::new(
            config.tesseract_path.clone(),
            config.language.clone(),
        ))),
        OCRProviderType::GoogleDocumentAI => {
            let google_config = config.google_document_ai.as_ref().ok_or_else(|| {
                PlethoraError::Internal("Google Document AI config not set".to_string())
            })?;
            Ok(Box::new(GoogleDocumentAIProvider::new(
                google_config.clone(),
            )))
        }
        OCRProviderType::AWSTextract => {
            let aws_config = config.aws_textract.as_ref().ok_or_else(|| {
                PlethoraError::Internal("AWS Textract config not set".to_string())
            })?;
            Ok(Box::new(AWSTextractProvider::new(aws_config.clone())))
        }
        OCRProviderType::AzureVision => {
            let azure_config = config.azure_vision.as_ref().ok_or_else(|| {
                PlethoraError::Internal("Azure Vision config not set".to_string())
            })?;
            Ok(Box::new(AzureVisionProvider::new(azure_config.clone())))
        }
        OCRProviderType::Marker => Ok(Box::new(MarkerProvider::new(config.marker_path.clone()))),
        OCRProviderType::Nougat => Ok(Box::new(NougatProvider::new(config.nougat_path.clone()))),
        OCRProviderType::Glmocr => {
            let glm_config = config
                .glm_ocr
                .as_ref()
                .ok_or_else(|| PlethoraError::Internal("GLM-OCR config not set".to_string()))?;
            Ok(Box::new(GLMOCRProvider::new(glm_config.clone())))
        }
        OCRProviderType::Mistral => {
            let mistral_config = config.mistral_ocr.as_ref().ok_or_else(|| {
                PlethoraError::Internal("Mistral OCR config not set".to_string())
            })?;
            Ok(Box::new(MistralProvider::new(mistral_config.clone())))
        }
        OCRProviderType::WindowsSystem => Ok(Box::new(WindowsSystemOCRProvider::new())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ocr_result_serialization() {
        let result = OCRResult {
            text: "Test text".to_string(),
            confidence: 95.0,
            line_count: 1,
            word_count: 2,
            processing_time_ms: 100,
            provider: OCRProviderType::Tesseract,
            metadata: serde_json::json!({}),
            lines: Vec::new(),
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("Test text"));
    }

    #[test]
    fn configured_nougat_directory_resolves_to_binary_inside_it() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(
            resolve_local_executable(directory.path().to_str(), "nougat"),
            directory.path().join("nougat")
        );
        assert_eq!(
            resolve_nougat_executables(directory.path().to_str()),
            vec![
                directory.path().join("nougat"),
                directory.path().join("nougat_predict"),
            ]
        );
    }

    #[test]
    fn configured_nougat_executable_path_is_used_verbatim() {
        let path = "/custom/python/bin/nougat";
        assert_eq!(
            resolve_local_executable(Some(path), "nougat"),
            PathBuf::from(path)
        );
    }

    #[test]
    fn nougat_reads_the_mmd_file_written_by_the_official_cli() {
        let directory = tempfile::tempdir().unwrap();
        let output_directory = directory.path().join("output");
        std::fs::create_dir_all(&output_directory).unwrap();
        std::fs::write(output_directory.join("paper.mmd"), "# Parsed paper").unwrap();

        let text = NougatProvider::read_output(
            &output_directory,
            Path::new("/documents/paper.pdf"),
            b"",
            b"",
        )
        .unwrap();

        assert_eq!(text, "# Parsed paper");
    }

    #[test]
    fn nougat_explains_incompatible_pdfium_instead_of_reporting_missing_output() {
        let directory = tempfile::tempdir().unwrap();
        let error = NougatProvider::read_output(
            directory.path(),
            Path::new("/documents/paper.pdf"),
            b"",
            b"ERROR:root:'PdfDocument' object has no attribute 'render'",
        )
        .unwrap_err();

        assert!(error.to_string().contains("Repair installation"));
    }

    #[test]
    fn nougat_wraps_image_inputs_in_a_valid_single_page_pdf() {
        let directory = tempfile::tempdir().unwrap();
        let source_path = directory.path().join("formula.png");
        image::RgbImage::from_pixel(16, 8, image::Rgb([255, 255, 255]))
            .save(&source_path)
            .unwrap();

        let pdf_path = NougatProvider::prepare_pdf_input(&source_path, directory.path()).unwrap();
        let pdf = Document::load(&pdf_path).unwrap();

        assert_eq!(pdf.get_pages().len(), 1);
    }
    // ── OCR line boxes (design D18 / task 3.3) ──────────────────────────────

    use super::{parse_tesseract_tsv, pixel_box_to_percent, BoundingBox, OCRResult, TextLine};

    fn result_with_lines(lines: Vec<TextLine>) -> OCRResult {
        OCRResult {
            text: "t".into(),
            confidence: 1.0,
            line_count: 1,
            word_count: 1,
            processing_time_ms: 0,
            provider: super::OCRProviderType::Tesseract,
            metadata: serde_json::json!({}),
            lines,
        }
    }

    #[test]
    fn ocr_result_omits_empty_lines_and_keeps_them_when_present() {
        let json = serde_json::to_string(&result_with_lines(vec![])).unwrap();
        assert!(!json.contains("lines"), "unexpected lines: {json}");

        let line = TextLine {
            text: "A".into(),
            confidence: 90.0,
            bbox: BoundingBox {
                left: 0.0,
                top: 0.0,
                right: 10.0,
                bottom: 10.0,
            },
        };
        let json = serde_json::to_string(&result_with_lines(vec![line])).unwrap();
        assert!(json.contains("lines"), "lines missing: {json}");
        assert!(json.contains("\"left\":0.0"), "pixel box missing: {json}");
    }

    #[test]
    fn tsv_parser_extracts_page_dims_and_groups_words_into_lines() {
        let tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n\
1\t1\t0\t0\t0\t0\t0\t0\t1000\t500\t-1\t\n\
5\t1\t1\t1\t1\t1\t100\t50\t80\t20\t91.5\tCell\n\
5\t1\t1\t1\t1\t2\t200\t55\t90\t18\t88.0\tmembrane\n\
5\t1\t1\t1\t2\t1\t400\t300\t60\t20\t95.0\tNucleus\n";
        let (width, height, lines) = parse_tesseract_tsv(tsv).unwrap();
        assert_eq!((width, height), (1000, 500));
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].text, "Cell membrane");
        // Union box: left=100 top=50 right=290 bottom=73.
        assert_eq!(lines[0].bbox.left, 100.0);
        assert_eq!(lines[0].bbox.top, 50.0);
        assert_eq!(lines[0].bbox.right, 290.0);
        assert_eq!(lines[0].bbox.bottom, 73.0);
        // Mean confidence of the two words.
        assert!((lines[0].confidence - 89.75).abs() < 1e-9);
        assert_eq!(lines[1].text, "Nucleus");
    }

    #[test]
    fn tsv_parser_returns_none_without_page_row() {
        let tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n\
5\t1\t1\t1\t1\t1\t10\t10\t50\t20\t90\tword\n";
        assert!(parse_tesseract_tsv(tsv).is_none());
    }

    #[test]
    fn tsv_parser_skips_rows_without_text() {
        let tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n\
1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t\n\
5\t1\t1\t1\t1\t1\t10\t10\t50\t20\t90\t\n";
        let (width, height, lines) = parse_tesseract_tsv(tsv).unwrap();
        assert_eq!((width, height), (100, 100));
        assert!(lines.is_empty());
    }

    #[test]
    fn pixel_box_to_percent_is_clamped_and_scale_free() {
        // The same RELATIVE box (a quarter in from each edge) yields the same
        // percents regardless of image size.
        let quarter_small = BoundingBox {
            left: 250.0,
            top: 125.0,
            right: 750.0,
            bottom: 375.0,
        };
        let quarter_large = BoundingBox {
            left: 500.0,
            top: 250.0,
            right: 1500.0,
            bottom: 750.0,
        };
        assert_eq!(
            pixel_box_to_percent(&quarter_small, 1000, 500),
            pixel_box_to_percent(&quarter_large, 2000, 1000)
        );
        assert_eq!(
            pixel_box_to_percent(&quarter_small, 1000, 500),
            [25.0, 25.0, 50.0, 50.0]
        );

        let outside = BoundingBox {
            left: -10.0,
            top: -10.0,
            right: 5000.0,
            bottom: 5000.0,
        };
        assert_eq!(
            pixel_box_to_percent(&outside, 1000, 1000),
            [0.0, 0.0, 100.0, 100.0]
        );
    }
}
