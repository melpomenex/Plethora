//! Tauri commands for the canonical PDF reflow model (v2) — typed page cache
//! access, source-crop assets, and cache lifecycle. Analysis commands land
//! with phase 2 (`pdf_reflow_analyze_page`).
//!
//! Binary-in goes base64-in-JSON (`image_base64`) because Tauri IPC on
//! Android is JSON-only — raw `tauri::ipc::Request` bodies don't work there
//! (see `commands/document.rs` stage-import note); this matches the
//! `ocr_image_bytes` precedent. Binary-out uses `tauri::ipc::Response`.

use base64::Engine as _;
use tauri::{AppHandle, ipc::Response};

use crate::error::Result;
use crate::pdf::cache::PdfReflowCache;
use crate::pdf::model::PdfCanonicalPage;

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

/// Remove all cached reflow data (v2 canonical and the legacy v1 prototype
/// cache) for one document.
#[tauri::command]
pub async fn pdf_reflow_delete_cache(document_id: String, app: AppHandle) -> Result<()> {
    PdfReflowCache::open(&app)?.delete_document(&document_id).await?;
    super::pdf_reflow_cache::delete_pdf_reflow_cache(document_id, app).await
}
