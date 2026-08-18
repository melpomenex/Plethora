//! OCR Tauri commands
//!
//! Provides Tauri commands for OCR operations

use crate::error::{PlethoraError, Result};
use crate::ocr::processor::OCRProcessor;
use crate::ocr::providers::OCRProviderType;
use crate::ocr::OCRConfig;
use lopdf::Document;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;
use tokio::sync::Mutex as TokioMutex;

/// Global OCR processor
static OCR_PROCESSOR: OnceLock<TokioMutex<Option<OCRProcessor>>> = OnceLock::new();

fn get_processor() -> &'static TokioMutex<Option<OCRProcessor>> {
    OCR_PROCESSOR.get_or_init(|| TokioMutex::new(None))
}

/// OCR request for image file
#[derive(Debug, Deserialize)]
pub struct OCRImageRequest {
    /// Path(s) to the image file(s)
    pub image_path: Vec<PathBuf>,
    /// Optional provider override
    pub provider: Option<String>,
    /// Optional language
    pub language: Option<String>,
}

/// OCR request for image bytes
#[derive(Debug, Deserialize)]
pub struct OCRBytesRequest {
    /// Base64 encoded image data
    pub image_data: String,
    /// Optional provider override
    pub provider: Option<String>,
    /// Optional language
    pub language: Option<String>,
}

/// One detected text line with its box normalized to percent 0–100 of the
/// source image (design D18): `[x, y, width, height]`. `bbox_percent` is None
/// when neither the provider nor the decoded image could supply geometry —
/// the text is still reported, callers just cannot use it for occlusion.
#[derive(Debug, Clone, Serialize)]
pub struct OcrTextLine {
    pub text: String,
    /// Confidence 0–100 (provider-reported; 0 when unknown).
    pub confidence: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bbox_percent: Option<[f64; 4]>,
}

/// OCR response
#[derive(Debug, Serialize)]
pub struct OCRResponse {
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
    pub provider: String,
    /// Output format (text, markdown, html)
    pub format: String,
    /// Success status
    pub success: bool,
    /// Error message if failed
    pub error: Option<String>,
    /// Detected text lines with percent boxes when available (design D18).
    /// Absent (not `[]`) for providers without box support and for every
    /// failure response, so existing consumers see no shape change.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub lines: Vec<OcrTextLine>,
}

impl OCRResponse {
    /// Convert provider pixel lines into percent-normalized response lines
    /// using the real decoded image dimensions. Dims of None (undecodable
    /// bytes) leave `bbox_percent` unset rather than fabricating geometry.
    fn with_percent_lines(
        mut self,
        provider_lines: &[crate::ocr::providers::TextLine],
        image_dims: Option<(u32, u32)>,
    ) -> Self {
        if provider_lines.is_empty() {
            return self;
        }
        self.lines = provider_lines
            .iter()
            .map(|line| OcrTextLine {
                text: line.text.clone(),
                confidence: line.confidence.clamp(0.0, 100.0),
                bbox_percent: image_dims
                    .map(|(w, h)| crate::ocr::providers::pixel_box_to_percent(&line.bbox, w, h)),
            })
            .collect();
        self
    }
}

/// Decode image dimensions from raw bytes without a full decode where the
/// format allows it. Used only to normalize OCR pixel boxes to percent.
fn image_dimensions_of(bytes: &[u8]) -> Option<(u32, u32)> {
    image::io::Reader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()
}

/// OCR request for PDF file
#[derive(Debug, Deserialize)]
pub struct OCRPdfRequest {
    /// Path to the PDF file
    pub pdf_path: PathBuf,
    /// Optional provider override
    pub provider: Option<String>,
    /// Optional language
    pub language: Option<String>,
}

/// OCR PDF page result
#[derive(Debug, Serialize)]
pub struct OCRPdfPage {
    pub page_number: usize,
    pub text: String,
}

/// OCR PDF response
#[derive(Debug, Serialize)]
pub struct OCRPdfResponse {
    pub pages: Vec<OCRPdfPage>,
    pub combined_text: String,
    pub confidence: f64,
    pub line_count: usize,
    pub word_count: usize,
    pub processing_time_ms: u64,
    pub provider: String,
    pub format: String,
    pub page_count: usize,
    pub success: bool,
    pub error: Option<String>,
}

/// Key phrase extraction request
#[derive(Debug, Deserialize)]
pub struct KeyPhraseRequest {
    /// Text to extract key phrases from
    pub text: String,
    /// Maximum number of phrases to return
    pub max_phrases: Option<usize>,
}

/// Key phrase response
#[derive(Debug, Serialize)]
pub struct KeyPhraseResponse {
    /// Extracted key phrases
    pub phrases: Vec<KeyPhrase>,
}

/// Key phrase with relevance score
#[derive(Debug, Serialize, Clone)]
pub struct KeyPhrase {
    /// The phrase text
    pub text: String,
    /// Relevance score (0-1)
    pub score: f64,
}

/// Initialize OCR processor with configuration
#[tauri::command]
pub async fn init_ocr(config: OCRConfig) -> Result<()> {
    let processor = OCRProcessor::new(config);
    let mut guard = get_processor().lock().await;
    *guard = Some(processor);
    Ok(())
}

/// Initialize the global OCR processor with default settings. Called once at
/// app startup so no OCR command can fail with "OCR processor not
/// initialized" on a cold start (issue #44 bug 04). The user's persisted
/// settings are pushed over the default via `update_ocr_config` when the
/// settings UI loads or saves.
pub async fn ensure_processor_initialized() {
    let mut guard = get_processor().lock().await;
    if guard.is_none() {
        guard.replace(OCRProcessor::new(OCRConfig::default()));
    }
}

/// Resolve the effective per-request config: the persisted config with any
/// request-level language override applied.
fn effective_config(base: &OCRConfig, language: &Option<String>) -> OCRConfig {
    let mut config = base.clone();
    if let Some(language) = language {
        if !language.trim().is_empty() {
            config.language = Some(language.trim().to_string());
        }
    }
    config
}

/// Preflight the configured provider: when it is unavailable, the actionable
/// guidance (installation instructions for local providers) is returned as an
/// error message instead of letting the OCR run fail opaquely later.
fn provider_preflight_error(provider: &dyn crate::ocr::providers::OCRProvider) -> Option<String> {
    if provider.is_available() {
        return None;
    }
    Some(provider.unavailability_guidance().unwrap_or_else(|| {
        format!(
            "OCR provider {} is not available. Configure it in Settings > Documents > OCR.",
            provider.provider_name()
        )
    }))
}

/// Perform OCR on an image file
#[tauri::command]
pub async fn ocr_image_file(request: OCRImageRequest) -> Result<OCRResponse> {
    let processor = {
        let guard = get_processor().lock().await;
        guard
            .as_ref()
            .ok_or_else(|| PlethoraError::Internal("OCR processor not initialized".to_string()))?
            .clone()
    };

    let provider_type = resolve_provider_type(&request.provider, &processor)?;
    let config = effective_config(processor.get_config(), &request.language);
    let provider = crate::ocr::providers::create_provider(provider_type, &config)?;
    let format = format_for_provider(provider_type);

    if let Some(guidance) = provider_preflight_error(provider.as_ref()) {
        return Ok(OCRResponse {
            text: String::new(),
            confidence: 0.0,
            line_count: 0,
            word_count: 0,
            processing_time_ms: 0,
            provider: format!("{:?}", provider_type),
            format: format.to_string(),
            success: false,
            error: Some(guidance),
            lines: Vec::new(),
        });
    }

    if request.image_path.is_empty() {
        return Ok(OCRResponse {
            text: String::new(),
            confidence: 0.0,
            line_count: 0,
            word_count: 0,
            processing_time_ms: 0,
            provider: "unknown".to_string(),
            format: "text".to_string(),
            success: false,
            error: Some("No image path provided".to_string()),
            lines: Vec::new(),
        });
    }

    let start = std::time::Instant::now();
    let mut combined_text = String::new();
    let mut total_confidence = 0.0;
    let mut total_line_count = 0;
    let mut total_word_count = 0;
    let mut result_provider = provider_type;

    for (index, image_path) in request.image_path.iter().enumerate() {
        let ocr_result = provider.process_image(image_path).await;
        match ocr_result {
            Ok(ocr_result) => {
                if index > 0 && !combined_text.is_empty() {
                    combined_text.push_str("\n\n");
                }
                combined_text.push_str(&ocr_result.text);
                total_confidence += ocr_result.confidence;
                total_line_count += ocr_result.line_count;
                total_word_count += ocr_result.word_count;
                result_provider = ocr_result.provider;
            }
            Err(e) => {
                let processing_time_ms = start.elapsed().as_millis() as u64;
                return Ok(OCRResponse {
                    text: String::new(),
                    confidence: 0.0,
                    line_count: 0,
                    word_count: 0,
                    processing_time_ms,
                    provider: "unknown".to_string(),
                    format: "text".to_string(),
                    success: false,
                    error: Some(e.to_string()),
                    lines: Vec::new(),
                });
            }
        }
    }

    let processing_time_ms = start.elapsed().as_millis() as u64;
    let count = request.image_path.len() as f64;
    let confidence = if count > 0.0 {
        total_confidence / count
    } else {
        0.0
    };

    Ok(OCRResponse {
        text: combined_text,
        confidence,
        line_count: total_line_count,
        word_count: total_word_count,
        processing_time_ms,
        provider: format!("{:?}", result_provider),
        format: format.to_string(),
        success: true,
        error: None,
        lines: Vec::new(),
    })
}

/// Perform OCR on image bytes (base64 encoded)
#[tauri::command]
pub async fn ocr_image_bytes(request: OCRBytesRequest) -> Result<OCRResponse> {
    let processor = {
        let guard = get_processor().lock().await;
        guard
            .as_ref()
            .ok_or_else(|| PlethoraError::Internal("OCR processor not initialized".to_string()))?
            .clone()
    };

    // Decode base64
    let image_data = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        request.image_data.as_bytes(),
    )
    .map_err(|e| PlethoraError::Internal(format!("Failed to decode base64: {}", e)))?;

    let provider_type = resolve_provider_type(&request.provider, &processor)?;
    let config = effective_config(processor.get_config(), &request.language);
    let provider = crate::ocr::providers::create_provider(provider_type, &config)?;
    let format = format_for_provider(provider_type);

    if let Some(guidance) = provider_preflight_error(provider.as_ref()) {
        return Ok(OCRResponse {
            text: String::new(),
            confidence: 0.0,
            line_count: 0,
            word_count: 0,
            processing_time_ms: 0,
            provider: format!("{:?}", provider_type),
            format: format.to_string(),
            success: false,
            error: Some(guidance),
            lines: Vec::new(),
        });
    }

    let start = std::time::Instant::now();

    let result = provider.process_image_bytes(&image_data).await;

    let processing_time_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(ocr_result) => {
            // Pixel boxes from the provider (when it supplies any) are
            // normalized to percent against the decoded image dimensions so
            // the AI occlusion flow gets deterministic geometry (D18).
            let dims = image_dimensions_of(&image_data);
            let response = OCRResponse {
                text: ocr_result.text,
                confidence: ocr_result.confidence,
                line_count: ocr_result.line_count,
                word_count: ocr_result.word_count,
                processing_time_ms,
                provider: format!("{:?}", ocr_result.provider),
                format: format.to_string(),
                success: true,
                error: None,
                lines: Vec::new(),
            };
            Ok(response.with_percent_lines(&ocr_result.lines, dims))
        }
        Err(e) => Ok(OCRResponse {
            text: String::new(),
            confidence: 0.0,
            line_count: 0,
            word_count: 0,
            processing_time_ms,
            provider: "unknown".to_string(),
            format: "text".to_string(),
            success: false,
            error: Some(e.to_string()),
            lines: Vec::new(),
        }),
    }
}

#[derive(Debug)]
struct PdfPageImage {
    page_number: usize,
    bytes: Vec<u8>,
    extension: String,
}

fn extract_pdf_page_image(
    doc: &Document,
    page_number: usize,
    page_id: lopdf::ObjectId,
) -> Option<PdfPageImage> {
    let page_images = doc.get_page_images(page_id).ok()?;

    let mut best_image: Option<(Vec<u8>, String, i64)> = None;
    for image in page_images {
        let filters = image.filters.clone().unwrap_or_default();
        let (extension, area) = if filters.iter().any(|f| f.eq_ignore_ascii_case("DCTDecode")) {
            ("jpg".to_string(), image.width.saturating_mul(image.height))
        } else if filters.iter().any(|f| f.eq_ignore_ascii_case("JPXDecode")) {
            ("jp2".to_string(), image.width.saturating_mul(image.height))
        } else {
            continue;
        };

        if image.content.is_empty() {
            continue;
        }

        let should_replace = best_image
            .as_ref()
            .map(|(_, _, best_area)| area > *best_area)
            .unwrap_or(true);

        if should_replace {
            best_image = Some((image.content.to_vec(), extension, area));
        }
    }

    best_image.map(|(bytes, extension, _)| PdfPageImage {
        page_number,
        bytes,
        extension,
    })
}

async fn write_temp_image(bytes: &[u8], extension: &str) -> Result<PathBuf> {
    let temp_dir = std::env::temp_dir();
    let file_name = format!("ocr_pdf_page_{}.{}", uuid::Uuid::new_v4(), extension);
    let temp_file = temp_dir.join(file_name);

    tokio::fs::write(&temp_file, bytes)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to write temp file: {}", e)))?;

    Ok(temp_file)
}

#[tauri::command]
pub async fn ocr_pdf_file(request: OCRPdfRequest) -> Result<OCRPdfResponse> {
    let processor = {
        let guard = get_processor().lock().await;
        guard
            .as_ref()
            .ok_or_else(|| PlethoraError::Internal("OCR processor not initialized".to_string()))?
            .clone()
    };

    let provider_type = resolve_provider_type(&request.provider, &processor)?;
    let config = effective_config(processor.get_config(), &request.language);
    let provider = crate::ocr::providers::create_provider(provider_type, &config)?;
    let format = format_for_provider(provider_type);

    if let Some(guidance) = provider_preflight_error(provider.as_ref()) {
        return Ok(OCRPdfResponse {
            pages: Vec::new(),
            combined_text: String::new(),
            confidence: 0.0,
            line_count: 0,
            word_count: 0,
            processing_time_ms: 0,
            provider: format!("{:?}", provider_type),
            format: format.to_string(),
            page_count: 0,
            success: false,
            error: Some(guidance),
        });
    }

    if !request.pdf_path.exists() {
        return Ok(OCRPdfResponse {
            pages: Vec::new(),
            combined_text: String::new(),
            confidence: 0.0,
            line_count: 0,
            word_count: 0,
            processing_time_ms: 0,
            provider: "unknown".to_string(),
            format: "text".to_string(),
            page_count: 0,
            success: false,
            error: Some("PDF file not found".to_string()),
        });
    }

    let start = std::time::Instant::now();
    let pdf_bytes = tokio::fs::read(&request.pdf_path)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to read PDF: {}", e)))?;

    let doc = Document::load_mem(&pdf_bytes)
        .map_err(|e| PlethoraError::Internal(format!("Failed to load PDF: {}", e)))?;
    let page_count = doc.get_pages().len();

    let mut pages: Vec<OCRPdfPage> = Vec::new();
    let mut combined_text = String::new();
    let mut total_confidence = 0.0;
    let mut total_line_count = 0;
    let mut total_word_count = 0;

    let use_direct_pdf = matches!(
        provider_type,
        OCRProviderType::Marker
            | OCRProviderType::Nougat
            | OCRProviderType::Glmocr
            | OCRProviderType::Mistral
    );

    if use_direct_pdf {
        match provider.process_image(&request.pdf_path).await {
            Ok(result) => {
                combined_text = result.text;
                total_confidence = result.confidence;
                total_line_count = result.line_count;
                total_word_count = result.word_count;
            }
            Err(e) => {
                return Ok(OCRPdfResponse {
                    pages: Vec::new(),
                    combined_text: String::new(),
                    confidence: 0.0,
                    line_count: 0,
                    word_count: 0,
                    processing_time_ms: start.elapsed().as_millis() as u64,
                    provider: "unknown".to_string(),
                    format: "text".to_string(),
                    page_count,
                    success: false,
                    error: Some(e.to_string()),
                });
            }
        }
    } else {
        // Collect page object ids in document order. The pages map is a
        // BTreeMap keyed by page number, so iterating yields ascending order and
        // the Nth value corresponds to logical page N (1-indexed).
        let ordered_page_ids: Vec<lopdf::ObjectId> = doc.get_pages().values().copied().collect();

        // First real error across pages (and pages with no extractable
        // image): when the whole run yields no text, this becomes the
        // response error instead of a success with blank pages.
        let mut first_error: Option<String> = None;

        // Loop through all pages in the document (1-indexed). We extract each
        // page's best image lazily inside the loop so only one page's image
        // bytes are resident at a time: the Document itself stays loaded, but
        // the extracted image Vec is dropped at the end of each iteration.
        for page_num in 1..=page_count {
            let page_id = ordered_page_ids.get(page_num - 1).copied();
            let page_image = page_id.and_then(|id| extract_pdf_page_image(&doc, page_num, id));

            if let Some(page_image) = page_image {
                let temp_file = write_temp_image(&page_image.bytes, &page_image.extension).await?;
                let result = provider.process_image(&temp_file).await;
                let _ = tokio::fs::remove_file(&temp_file).await;
                // Drop the page image bytes before OCR result handling so peak
                // image memory stays bounded to one page.
                drop(page_image);

                match result {
                    Ok(ocr_result) => {
                        if !combined_text.is_empty() {
                            combined_text.push_str("\n\n");
                        }
                        combined_text.push_str(&ocr_result.text);
                        total_confidence += ocr_result.confidence;
                        total_line_count += ocr_result.line_count;
                        total_word_count += ocr_result.word_count;
                        pages.push(OCRPdfPage {
                            page_number: page_num,
                            text: ocr_result.text,
                        });
                    }
                    Err(e) => {
                        // A single failed page keeps its slot (sequence
                        // preservation) but is remembered; if every page
                        // fails, the run is a failure — never a success full
                        // of blank pages (issue #44 bug 04).
                        tracing::warn!("OCR failed on page {}: {}", page_num, e);
                        if first_error.is_none() {
                            first_error = Some(format!("page {page_num}: {e}"));
                        }
                        pages.push(OCRPdfPage {
                            page_number: page_num,
                            text: String::new(),
                        });
                    }
                }
            } else {
                // No embedded JPEG/JPX image on this page. Pages like this
                // need rasterization (the pdf.js-backed per-page flow);
                // remember it so an all-imageless run reports the real
                // reason instead of empty success.
                if first_error.is_none() {
                    first_error = Some(format!(
                        "page {page_num}: no embedded page image (this PDF needs page rasterization)"
                    ));
                }
                pages.push(OCRPdfPage {
                    page_number: page_num,
                    text: String::new(),
                });
            }
        }

        // All pages failed or nothing extractable: report failure with the
        // first real error rather than success with empty text.
        if combined_text.trim().is_empty() {
            let error = first_error.unwrap_or_else(|| {
                "OCR produced no text for this PDF".to_string()
            });
            return Ok(OCRPdfResponse {
                pages,
                combined_text,
                confidence: 0.0,
                line_count: total_line_count,
                word_count: total_word_count,
                processing_time_ms: start.elapsed().as_millis() as u64,
                provider: format!("{:?}", provider_type),
                format: format.to_string(),
                page_count,
                success: false,
                error: Some(error),
            });
        }
    }

    let processing_time_ms = start.elapsed().as_millis() as u64;
    let count = if pages.is_empty() {
        1.0
    } else {
        pages.len() as f64
    };
    let confidence = if count > 0.0 {
        total_confidence / count
    } else {
        0.0
    };

    Ok(OCRPdfResponse {
        pages,
        combined_text,
        confidence,
        line_count: total_line_count,
        word_count: total_word_count,
        processing_time_ms,
        provider: format!("{:?}", provider_type),
        format: format.to_string(),
        page_count,
        success: true,
        error: None,
    })
}

fn format_for_provider(provider_type: OCRProviderType) -> &'static str {
    match provider_type {
        OCRProviderType::Marker | OCRProviderType::Nougat | OCRProviderType::Glmocr => "markdown",
        OCRProviderType::Mistral => "html",
        _ => "text",
    }
}

/// Extract key phrases from text using RAKE algorithm
#[tauri::command]
pub fn extract_key_phrases(request: KeyPhraseRequest) -> Result<KeyPhraseResponse> {
    let max_phrases = request.max_phrases.unwrap_or(10);
    let phrases = extract_phrases_rake(&request.text, max_phrases);
    Ok(KeyPhraseResponse { phrases })
}

/// Simple RAKE (Rapid Automatic Keyword Extraction) implementation
fn extract_phrases_rake(text: &str, max_phrases: usize) -> Vec<KeyPhrase> {
    let stop_words = vec![
        "a",
        "about",
        "above",
        "after",
        "again",
        "against",
        "all",
        "am",
        "an",
        "and",
        "any",
        "are",
        "aren't",
        "as",
        "at",
        "be",
        "because",
        "been",
        "before",
        "being",
        "below",
        "between",
        "both",
        "but",
        "by",
        "can't",
        "cannot",
        "could",
        "couldn't",
        "did",
        "didn't",
        "do",
        "does",
        "doesn't",
        "doing",
        "don't",
        "down",
        "during",
        "each",
        "few",
        "for",
        "from",
        "further",
        "had",
        "hadn't",
        "has",
        "hasn't",
        "have",
        "haven't",
        "having",
        "he",
        "he'd",
        "he'll",
        "he's",
        "her",
        "here",
        "here's",
        "hers",
        "herself",
        "him",
        "himself",
        "his",
        "how",
        "how's",
        "i",
        "i'd",
        "i'll",
        "i'm",
        "i've",
        "if",
        "in",
        "into",
        "is",
        "isn't",
        "it",
        "it's",
        "its",
        "itself",
        "let's",
        "me",
        "more",
        "most",
        "mustn't",
        "my",
        "myself",
        "no",
        "nor",
        "not",
        "of",
        "off",
        "on",
        "once",
        "only",
        "or",
        "other",
        "ought",
        "our",
        "ours",
        "ourselves",
        "out",
        "over",
        "own",
        "same",
        "shan't",
        "she",
        "she'd",
        "she'll",
        "she's",
        "should",
        "shouldn't",
        "so",
        "some",
        "such",
        "than",
        "that",
        "that's",
        "the",
        "their",
        "theirs",
        "them",
        "themselves",
        "then",
        "there",
        "there's",
        "these",
        "they",
        "they'd",
        "they'll",
        "they're",
        "they've",
        "this",
        "those",
        "through",
        "to",
        "too",
        "under",
        "until",
        "up",
        "very",
        "was",
        "wasn't",
        "we",
        "we'd",
        "we'll",
        "we're",
        "we've",
        "were",
        "weren't",
        "what",
        "what's",
        "when",
        "when's",
        "where",
        "where's",
        "which",
        "while",
        "who",
        "who's",
        "whom",
        "why",
        "why's",
        "with",
        "won't",
        "would",
        "wouldn't",
        "you",
        "you'd",
        "you'll",
        "you're",
        "you've",
        "your",
        "yours",
        "yourself",
        "yourselves",
    ];

    let stop_word_set: std::collections::HashSet<&str> = stop_words.iter().cloned().collect();

    // Split text into sentences
    let sentences: Vec<&str> = text
        .split(&['.', '!', '?', '\n'][..])
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let mut phrases: Vec<String> = Vec::new();
    for sentence in sentences {
        let words: Vec<&str> = sentence.split_whitespace().collect();
        let mut current_phrase = Vec::new();

        for word in words {
            let clean_word = word
                .to_lowercase()
                .chars()
                .filter(|c| c.is_alphabetic() || c.is_whitespace())
                .collect::<String>();

            if stop_word_set.contains(clean_word.as_str()) || clean_word.len() <= 2 {
                if !current_phrase.is_empty() {
                    phrases.push(current_phrase.join(" "));
                    current_phrase.clear();
                }
            } else {
                current_phrase.push(word);
            }
        }

        if !current_phrase.is_empty() {
            phrases.push(current_phrase.join(" "));
        }
    }

    // Score phrases by word frequency and degree
    let mut word_scores: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    let mut phrase_degrees: std::collections::HashMap<String, f64> =
        std::collections::HashMap::new();

    for phrase in &phrases {
        let words: Vec<&str> = phrase.split_whitespace().collect();
        let degree = words.len() as f64 - 1.0;

        for word in &words {
            let word_lower = word.to_lowercase();
            *word_scores.entry(word_lower.clone()).or_insert(0.0) += 1.0;
            *phrase_degrees.entry(phrase.clone()).or_insert(0.0) += degree;
        }
    }

    // Calculate final scores
    let mut scored_phrases: Vec<KeyPhrase> = phrases
        .into_iter()
        .map(|phrase| {
            let words: Vec<&str> = phrase.split_whitespace().collect();
            let word_score_sum: f64 = words
                .iter()
                .map(|w| word_scores.get(&w.to_lowercase()).copied().unwrap_or(0.0))
                .sum();

            let degree = phrase_degrees.get(&phrase).copied().unwrap_or(0.0);
            let score = if word_score_sum > 0.0 {
                degree / word_score_sum
            } else {
                0.0
            };

            KeyPhrase {
                text: phrase,
                score: score.min(1.0),
            }
        })
        .filter(|kp| kp.score > 0.0)
        .collect();

    // Sort by score and limit
    scored_phrases.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    scored_phrases.truncate(max_phrases);

    scored_phrases
}

/// Get available OCR providers
#[tauri::command]
pub async fn get_available_ocr_providers() -> Result<Vec<String>> {
    let guard = get_processor().lock().await;
    let processor = guard
        .as_ref()
        .ok_or_else(|| PlethoraError::Internal("OCR processor not initialized".to_string()))?;

    let providers = processor.get_available_providers();
    Ok(providers.into_iter().map(|p| format!("{:?}", p)).collect())
}

/// Check if a specific provider is available
#[tauri::command]
pub async fn is_provider_available(provider: String) -> Result<bool> {
    let guard = get_processor().lock().await;
    let processor = guard
        .as_ref()
        .ok_or_else(|| PlethoraError::Internal("OCR processor not initialized".to_string()))?;

    let provider_type = parse_provider_type(&provider)?;

    Ok(processor.is_provider_available(provider_type))
}

fn resolve_provider_type(
    provider: &Option<String>,
    processor: &OCRProcessor,
) -> Result<OCRProviderType> {
    match provider {
        Some(value) => parse_provider_type(value),
        None => Ok(processor.get_default_provider()),
    }
}

fn parse_provider_type(provider: &str) -> Result<OCRProviderType> {
    let normalized = provider.to_lowercase();
    match normalized.as_str() {
        "tesseract" => Ok(OCRProviderType::Tesseract),
        "google" => Ok(OCRProviderType::GoogleDocumentAI),
        "aws" => Ok(OCRProviderType::AWSTextract),
        "azure" => Ok(OCRProviderType::AzureVision),
        "marker" => Ok(OCRProviderType::Marker),
        "nougat" => Ok(OCRProviderType::Nougat),
        "glm" => Ok(OCRProviderType::Glmocr),
        "mistral" => Ok(OCRProviderType::Mistral),
        _ => Err(PlethoraError::Internal(format!(
            "Unknown provider: {}",
            provider
        ))),
    }
}

/// Get current OCR configuration
#[tauri::command]
pub async fn get_ocr_config() -> Result<OCRConfig> {
    let guard = get_processor().lock().await;
    let processor = guard
        .as_ref()
        .ok_or_else(|| PlethoraError::Internal("OCR processor not initialized".to_string()))?;

    Ok(processor.get_config().clone())
}

/// Update OCR configuration
#[tauri::command]
pub async fn update_ocr_config(config: OCRConfig) -> Result<()> {
    let mut guard = get_processor().lock().await;
    *guard = Some(OCRProcessor::new(config));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tesseract_language_arg_defaults_to_eng_and_honors_override() {
        let default = crate::ocr::providers::TesseractProvider::new(None, None);
        assert_eq!(default.language_arg(), "eng");
        let german = crate::ocr::providers::TesseractProvider::new(None, Some("deu".to_string()));
        assert_eq!(german.language_arg(), "deu");
    }

    #[test]
    fn tesseract_preflight_returns_install_guidance_when_missing() {
        // A bogus binary path makes check_installation fail; the preflight
        // must surface its actionable install message, not a bare "failed".
        let provider = crate::ocr::providers::TesseractProvider::new(
            Some("/nonexistent/tesseract-binary".to_string()),
            None,
        );
        let guidance = provider_preflight_error(&provider);
        assert!(guidance.is_some(), "missing Tesseract must produce guidance");
        let message = guidance.unwrap();
        assert!(
            message.contains("Tesseract is not installed"),
            "guidance should carry the install message, got: {message}"
        );
        assert!(message.contains("brew install tesseract") || message.contains("apt install"));
    }

    #[tokio::test]
    async fn pdf_without_embedded_images_reports_failure_not_blank_success() {
        // A text PDF has no embedded JPEG/JPX page images. With a provider
        // that passes preflight (cloud config with an existing credentials
        // file), the run must report failure naming the real reason —
        // previously this returned success with one blank page per page.
        let tmp = tempfile::tempdir().expect("tempdir");
        let credentials = tmp.path().join("credentials.json");
        std::fs::write(&credentials, "{}").expect("credentials file");

        let config = OCRConfig {
            google_document_ai: Some(crate::ocr::GoogleDocumentAIConfig {
                project_id: "p".to_string(),
                location: "us".to_string(),
                processor_id: "x".to_string(),
                credentials_path: credentials.to_string_lossy().to_string(),
            }),
            ..OCRConfig::default()
        };
        init_ocr(config).await.expect("init processor");

        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/pdf-baseline/simple-text.pdf");
        let response = ocr_pdf_file(OCRPdfRequest {
            pdf_path: fixture,
            provider: Some("google".to_string()),
            language: None,
        })
        .await
        .expect("command completes");

        assert!(!response.success, "no-image PDF must not report success");
        let error = response.error.expect("failure carries an error");
        assert!(
            error.contains("no embedded page image"),
            "error should name the missing-image reason, got: {error}"
        );

        // Restore a neutral processor for any test that runs after this one.
        init_ocr(OCRConfig::default()).await.expect("reset processor");
    }

    #[test]
    fn test_extract_key_phrases() {
        let text = "Optical character recognition (OCR) is technology that converts different types of \
                    documents, such as scanned paper documents, PDF files or images captured by a digital \
                    camera into editable and searchable data.";

        let request = KeyPhraseRequest {
            text: text.to_string(),
            max_phrases: Some(5),
        };

        let response = extract_key_phrases(request).unwrap();
        assert!(!response.phrases.is_empty());
        assert!(response.phrases.len() <= 5);

        for i in 1..response.phrases.len() {
            assert!(response.phrases[i - 1].score >= response.phrases[i].score);
        }
    }

    #[test]
    fn test_extract_key_phrases_filters_stop_words() {
        let text = "The quick brown fox jumps over the lazy dog. The fox is very quick.";

        let request = KeyPhraseRequest {
            text: text.to_string(),
            max_phrases: Some(10),
        };

        let response = extract_key_phrases(request).unwrap();

        for phrase in &response.phrases {
            assert!(!["the", "is", "over", "very"].contains(&phrase.text.to_lowercase().as_str()));
        }
    }

    #[test]
    fn test_extract_key_phrases_with_empty_text() {
        let request = KeyPhraseRequest {
            text: String::new(),
            max_phrases: Some(5),
        };

        let response = extract_key_phrases(request).unwrap();
        assert_eq!(response.phrases.len(), 0);
    }

    #[test]
    fn test_extract_key_phrases_with_repeated_words() {
        let text = "Machine learning machine learning algorithms algorithms algorithms.";

        let request = KeyPhraseRequest {
            text: text.to_string(),
            max_phrases: Some(3),
        };

        let response = extract_key_phrases(request).unwrap();
        assert!(!response.phrases.is_empty());

        // "Machine learning" or "algorithms" should be top phrases
        let top_phrase = &response.phrases[0];
        assert!(top_phrase.text.contains("Machine") || top_phrase.text.contains("algorithms"));
    }

    #[test]
    fn test_extract_key_phrases_score_range() {
        let text = "Rust programming language memory safety performance concurrency.";

        let request = KeyPhraseRequest {
            text: text.to_string(),
            max_phrases: Some(10),
        };

        let response = extract_key_phrases(request).unwrap();

        for phrase in &response.phrases {
            assert!(phrase.score >= 0.0);
            assert!(phrase.score <= 1.0);
        }
    }

    // ── OCRResponse.lines (design D18 / task 3.3) ───────────────────────────

    fn base_response() -> OCRResponse {
        OCRResponse {
            text: "hello".to_string(),
            confidence: 80.0,
            line_count: 1,
            word_count: 1,
            processing_time_ms: 5,
            provider: "Tesseract".to_string(),
            format: "text".to_string(),
            success: true,
            error: None,
            lines: Vec::new(),
        }
    }

    #[test]
    fn response_omits_lines_when_empty() {
        let json = serde_json::to_string(&base_response()).unwrap();
        assert!(!json.contains("lines"), "unexpected lines in: {json}");
    }

    #[test]
    fn response_serializes_percent_lines() {
        let response = base_response().with_percent_lines(
            &[crate::ocr::providers::TextLine {
                text: "Mitochondria".to_string(),
                confidence: 91.5,
                bbox: crate::ocr::providers::BoundingBox {
                    left: 100.0,
                    top: 200.0,
                    right: 300.0,
                    bottom: 250.0,
                },
            }],
            Some((1000, 500)),
        );
        assert_eq!(response.lines.len(), 1);
        let line = &response.lines[0];
        assert_eq!(line.text, "Mitochondria");
        // x=100/1000=10%, y=200/500=40%, w=200/1000=20%, h=50/500=10%.
        let bbox = line.bbox_percent.unwrap();
        assert!((bbox[0] - 10.0).abs() < 1e-9);
        assert!((bbox[1] - 40.0).abs() < 1e-9);
        assert!((bbox[2] - 20.0).abs() < 1e-9);
        assert!((bbox[3] - 10.0).abs() < 1e-9);

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"lines\""), "lines missing: {json}");
        assert!(json.contains("\"bbox_percent\""), "bbox missing: {json}");
    }

    #[test]
    fn undecodable_dimensions_leave_bbox_unset() {
        let response = base_response().with_percent_lines(
            &[crate::ocr::providers::TextLine {
                text: "word".to_string(),
                confidence: 90.0,
                bbox: crate::ocr::providers::BoundingBox {
                    left: 0.0,
                    top: 0.0,
                    right: 10.0,
                    bottom: 10.0,
                },
            }],
            None,
        );
        assert_eq!(response.lines.len(), 1);
        assert!(response.lines[0].bbox_percent.is_none());
        let json = serde_json::to_string(&response).unwrap();
        assert!(!json.contains("bbox_percent"), "unexpected bbox: {json}");
    }

    #[test]
    fn empty_provider_lines_produce_no_lines_field() {
        let response = base_response().with_percent_lines(&[], Some((100, 100)));
        assert!(response.lines.is_empty());
        let json = serde_json::to_string(&response).unwrap();
        assert!(!json.contains("lines"), "unexpected lines in: {json}");
    }

    #[test]
    fn percent_conversion_clamps_and_scales() {
        use crate::ocr::providers::{pixel_box_to_percent, BoundingBox};
        // Full-image box → 0,0,100,100.
        let full = BoundingBox {
            left: 0.0,
            top: 0.0,
            right: 1000.0,
            bottom: 500.0,
        };
        assert_eq!(
            pixel_box_to_percent(&full, 1000, 500),
            [0.0, 0.0, 100.0, 100.0]
        );
        // Boxes outside the frame clamp.
        let outside = BoundingBox {
            left: -500.0,
            top: -100.0,
            right: 100.0,
            bottom: 100.0,
        };
        let [x, y, w, h] = pixel_box_to_percent(&outside, 1000, 1000);
        assert_eq!((x, y, w, h), (0.0, 0.0, 10.0, 10.0));
        // Degenerate image dims never divide by zero.
        let zero = BoundingBox {
            left: 0.0,
            top: 0.0,
            right: 0.0,
            bottom: 0.0,
        };
        assert_eq!(pixel_box_to_percent(&zero, 0, 0), [0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn image_dimensions_decode_png_header() {
        // Encode a real 2x3 PNG with the image crate, then read its dims back
        // from raw bytes (header-only path).
        let mut buffer = Vec::new();
        {
            let mut encoder = image::codecs::png::PngEncoder::new(&mut buffer);
            let pixels: Vec<u8> = vec![
                0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
            ];
            encoder
                .encode(&pixels, 2, 3, image::ColorType::Rgba8)
                .unwrap();
        }
        assert_eq!(image_dimensions_of(&buffer), Some((2, 3)));
        assert_eq!(image_dimensions_of(b"not an image"), None);
    }
}
