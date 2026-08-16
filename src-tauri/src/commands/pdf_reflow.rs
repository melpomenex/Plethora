//! Tauri commands for the canonical PDF reflow model (v2) — typed page cache
//! access, source-crop assets, and cache lifecycle. Analysis commands land
//! with phase 2 (`pdf_reflow_analyze_page`).
//!
//! Binary-in goes base64-in-JSON (`image_base64`) because Tauri IPC on
//! Android is JSON-only — raw `tauri::ipc::Request` bodies don't work there
//! (see `commands/document.rs` stage-import note); this matches the
//! `ocr_image_bytes` precedent. Binary-out uses `tauri::ipc::Response`.

use base64::Engine as _;
use serde::Deserialize;
use tauri::{ipc::Response, AppHandle};

use crate::error::{IncrementumError, Result};
use crate::pdf::analysis::{self, PageAnalysisRequest, TextItemInput};
use crate::pdf::cache::PdfReflowCache;
use crate::pdf::model::PdfCanonicalPage;

/// One page analyzes at a time (design D10) — the TS scheduler already
/// serializes requests; this bounds any parallel callers.
static ANALYZE_PERMIT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

const ANALYZE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfReflowAnalyzeInput {
    pub page_number: u32,
    pub page_width: f64,
    pub page_height: f64,
    #[serde(default)]
    pub rotation: u16,
    #[serde(default)]
    pub raster_png_base64: Option<String>,
    #[serde(default)]
    pub raster_scale: f64,
    pub text_items: Vec<TextItemInput>,
    /// Marginal texts from already-analyzed neighbor pages (header/footer
    /// recurrence evidence, task 5.3).
    #[serde(default)]
    pub marginal_context: Vec<String>,
}

/// Analyze one page on the blocking pool under the worker bound. Analysis is
/// pure; this command does not touch the cache (the scheduler writes results
/// explicitly so failed analyses are never cached).
#[tauri::command]
pub async fn pdf_reflow_analyze_page(input: PdfReflowAnalyzeInput) -> Result<PdfCanonicalPage> {
    let raster_png = match input.raster_png_base64.as_deref() {
        None => None,
        Some(encoded) => Some(
            base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .map_err(|error| {
                    IncrementumError::InvalidInput(format!(
                        "Analysis raster is not valid base64: {error}"
                    ))
                })?,
        ),
    };
    let request = PageAnalysisRequest {
        page_number: input.page_number,
        page_width: input.page_width,
        page_height: input.page_height,
        rotation: input.rotation,
        raster_png,
        raster_scale: input.raster_scale,
        text_items: input.text_items,
        marginal_context: input.marginal_context,
    };
    let _permit = ANALYZE_PERMIT
        .acquire()
        .await
        .map_err(|error| IncrementumError::Internal(format!("Analysis worker closed: {error}")))?;
    let result = tokio::time::timeout(
        ANALYZE_TIMEOUT,
        tokio::task::spawn_blocking(move || analysis::analyze_page(&request)),
    )
    .await
    .map_err(|_| IncrementumError::Internal("PDF page analysis timed out".into()))?
    .map_err(|error| IncrementumError::Internal(format!("Analysis task failed: {error}")))??;
    drop(_permit);
    Ok(result)
}

#[tauri::command]
pub async fn pdf_reflow_get_page(
    document_id: String,
    source_identity: String,
    schema_version: u32,
    engine_version: String,
    page_number: u32,
    app: AppHandle,
) -> Result<Option<PdfCanonicalPage>> {
    PdfReflowCache::open(&app)?
        .get_page(
            &document_id,
            &source_identity,
            schema_version,
            &engine_version,
            page_number,
        )
        .await
}

#[tauri::command]
pub async fn pdf_reflow_put_page(
    document_id: String,
    source_identity: String,
    schema_version: u32,
    engine_version: String,
    page: PdfCanonicalPage,
    app: AppHandle,
) -> Result<()> {
    PdfReflowCache::open(&app)?
        .put_page(
            &document_id,
            &source_identity,
            schema_version,
            &engine_version,
            &page,
        )
        .await
}

/// Store a source-crop PNG (base64) and return its content-hash asset id.
#[tauri::command]
pub async fn pdf_reflow_put_asset(
    document_id: String,
    source_identity: String,
    schema_version: u32,
    engine_version: String,
    image_base64: String,
    app: AppHandle,
) -> Result<String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(image_base64.as_bytes())
        .map_err(|error| {
            crate::error::IncrementumError::InvalidInput(format!(
                "PDF reflow asset is not valid base64: {error}"
            ))
        })?;
    PdfReflowCache::open(&app)?
        .put_asset(
            &document_id,
            &source_identity,
            schema_version,
            &engine_version,
            &bytes,
        )
        .await
}

/// Fetch a source-crop asset as raw bytes. An empty body means "not cached"
/// — assets are never legitimately empty, so no error round-trip is needed.
#[tauri::command]
pub async fn pdf_reflow_get_asset(
    document_id: String,
    source_identity: String,
    schema_version: u32,
    engine_version: String,
    asset_id: String,
    app: AppHandle,
) -> Result<Response> {
    let bytes = PdfReflowCache::open(&app)?
        .get_asset(
            &document_id,
            &source_identity,
            schema_version,
            &engine_version,
            &asset_id,
        )
        .await?;
    Ok(Response::new(bytes.unwrap_or_default()))
}

/// Turn OCR results (words with normalized boxes + confidence) into a
/// canonical page and cache it (task 7.4). Engines run host-side; this is
/// the single ingestion point.
#[tauri::command]
pub async fn pdf_reflow_apply_ocr_page(
    document_id: String,
    source_identity: String,
    schema_version: u32,
    engine_version: String,
    page_number: u32,
    page_width: f64,
    page_height: f64,
    rotation: u16,
    words: Vec<crate::pdf::ocr::OcrWordInput>,
    app: AppHandle,
) -> Result<PdfCanonicalPage> {
    let page = crate::pdf::ocr::build_page_from_ocr_args(
        page_number,
        page_width,
        page_height,
        rotation,
        &words,
    )?;
    let cache = PdfReflowCache::open(&app)?;
    cache
        .put_page(
            &document_id,
            &source_identity,
            schema_version,
            &engine_version,
            &page,
        )
        .await?;
    Ok(page)
}

/// Build a graphical bitmap-fallback page from the analysis raster (task
/// 7.5): one source-crop block per ink line, cached like any other page.
#[tauri::command]
pub async fn pdf_reflow_build_graphical_fallback(
    document_id: String,
    source_identity: String,
    schema_version: u32,
    engine_version: String,
    page_number: u32,
    page_width: f64,
    page_height: f64,
    rotation: u16,
    raster_png_base64: String,
    raster_scale: f64,
    app: AppHandle,
) -> Result<PdfCanonicalPage> {
    let png = base64::engine::general_purpose::STANDARD
        .decode(raster_png_base64.as_bytes())
        .map_err(|error| {
            IncrementumError::InvalidInput(format!("Fallback raster is not valid base64: {error}"))
        })?;
    let raster = crate::pdf::analysis::raster::PageRaster::from_png(
        &png,
        raster_scale,
        rotation,
        page_width,
        page_height,
    )?;
    let page = crate::pdf::fallback::graphical::build_graphical_fallback_page(
        page_number,
        page_width,
        page_height,
        rotation,
        Some(&raster),
    )?;
    let cache = PdfReflowCache::open(&app)?;
    cache
        .put_page(
            &document_id,
            &source_identity,
            schema_version,
            &engine_version,
            &page,
        )
        .await?;
    Ok(page)
}

/// Resolve a selection (PDF-space rects on one analyzed page) against the
/// cached canonical model — word-level snapping, exact text, per-line source
/// regions. `None` ⇒ page not analyzed or nothing hit; callers fall back to
/// legacy text-layer behavior (spec: pdf-exact-selection).
#[tauri::command]
pub async fn pdf_reflow_resolve_selection(
    document_id: String,
    source_identity: String,
    schema_version: u32,
    engine_version: String,
    page_number: u32,
    rects: Vec<(f64, f64, f64, f64)>,
    app: AppHandle,
) -> Result<Option<crate::pdf::selection::CanonicalSelection>> {
    let cache = PdfReflowCache::open(&app)?;
    let Some(page) = cache
        .get_page(
            &document_id,
            &source_identity,
            schema_version,
            &engine_version,
            page_number,
        )
        .await?
    else {
        return Ok(None);
    };
    let rects: Vec<_> = rects
        .into_iter()
        .map(|(x0, y0, x1, y1)| crate::pdf::coordinates::PdfRect::new(x0, y0, x1, y1))
        .collect();
    Ok(crate::pdf::selection::resolve_selection(&page, &rects))
}

/// Reconstruct per-line highlight rects for a stored word-ID range — the
/// painting input for highlights/extracts created in either view.
#[tauri::command]
pub async fn pdf_reflow_selection_rects(
    document_id: String,
    source_identity: String,
    schema_version: u32,
    engine_version: String,
    page_number: u32,
    start_word_id: String,
    end_word_id: String,
    app: AppHandle,
) -> Result<Option<Vec<crate::pdf::model::PdfSourceRegion>>> {
    let cache = PdfReflowCache::open(&app)?;
    let Some(page) = cache
        .get_page(
            &document_id,
            &source_identity,
            schema_version,
            &engine_version,
            page_number,
        )
        .await?
    else {
        return Ok(None);
    };
    Ok(crate::pdf::selection::selection_rects(
        &page,
        &start_word_id,
        &end_word_id,
    ))
}

/// Remove all cached reflow data (v2 canonical and the legacy v1 prototype
/// cache) for one document.
#[tauri::command]
pub async fn pdf_reflow_delete_cache(document_id: String, app: AppHandle) -> Result<()> {
    PdfReflowCache::open(&app)?
        .delete_document(&document_id)
        .await?;
    super::pdf_reflow_cache::delete_pdf_reflow_cache(document_id, app).await
}
