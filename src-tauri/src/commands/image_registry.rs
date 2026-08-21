//! Image registry commands

use base64::{engine::general_purpose, Engine as _};
use futures_util::StreamExt;
use image::GenericImageView;
use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::time::Duration;
use tauri::State;

use crate::database::Repository;
use crate::error::{PlethoraError, Result};

const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const REGISTRY_THUMBNAIL_MAX_DIMENSION: u32 = 256;

#[derive(Debug, serde::Serialize)]
pub struct ImageAssetDto {
    pub id: String,
    pub mime_type: String,
    pub file_name: Option<String>,
    pub byte_size: i64,
    pub sha256: String,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub created_at: String,
    pub reference_count: i64,
    pub is_referenced: bool,
    pub data_url: String,
    /// Bounded JSON metadata (browser capture context, provenance, smart
    /// organization state) for browser-imported images.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, serde::Serialize)]
pub struct DeleteImageAssetResult {
    pub deleted: bool,
    pub reason: Option<String>,
}

#[tauri::command]
pub async fn ingest_image_asset(
    base64_data: String,
    mime_type: Option<String>,
    file_name: Option<String>,
    repo: State<'_, Repository>,
) -> Result<ImageAssetDto> {
    let bytes = general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| {
            PlethoraError::InvalidInput(format!("Invalid base64 image payload: {}", e))
        })?;

    ingest_image_bytes(bytes, mime_type, file_name, repo.inner())
        .await
        .map(|(asset, _)| asset)
}

/// Browser-sync entry point for registry ingestion. It shares the exact same
/// validation, SVG sanitization, dimension checks, and content-addressed
/// deduplication as the frontend command without requiring a Tauri `State`
/// wrapper.
pub async fn ingest_image_asset_from_base64(
    base64_data: &str,
    mime_type: Option<String>,
    file_name: Option<String>,
    repo: &Repository,
) -> Result<ImageAssetDto> {
    ingest_image_asset_from_base64_with_status(base64_data, mime_type, file_name, repo)
        .await
        .map(|(asset, _)| asset)
}

/// Like [`ingest_image_asset_from_base64`], but also reports whether an asset
/// with identical content already existed (`true` = duplicate, no new storage).
pub async fn ingest_image_asset_from_base64_with_status(
    base64_data: &str,
    mime_type: Option<String>,
    file_name: Option<String>,
    repo: &Repository,
) -> Result<(ImageAssetDto, bool)> {
    let bytes = general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| {
            PlethoraError::InvalidInput(format!("Invalid base64 image payload: {}", e))
        })?;

    ingest_image_bytes(bytes, mime_type, file_name, repo).await
}

/// Ingest an image already present on disk (e.g. a downloaded NotebookLM
/// infographic) into the registry. Deduplicates by content hash, so calling
/// this for an image already in the registry is a no-op that returns the
/// existing asset.
#[tauri::command]
pub async fn ingest_image_asset_from_path(
    file_path: String,
    mime_type: Option<String>,
    file_name: Option<String>,
    repo: State<'_, Repository>,
) -> Result<ImageAssetDto> {
    ingest_image_asset_from_path_inner(&file_path, mime_type, file_name, repo.inner()).await
}

/// Non-command variant so other modules can register a local image without
/// constructing a `State` (e.g. the NotebookLM infographic import path).
pub async fn ingest_image_asset_from_path_inner(
    file_path: &str,
    mime_type: Option<String>,
    file_name: Option<String>,
    repo: &Repository,
) -> Result<ImageAssetDto> {
    let bytes = tokio::fs::read(file_path).await.map_err(|e| {
        PlethoraError::NotFound(format!("Failed to read image file {file_path}: {e}"))
    })?;
    if bytes.is_empty() {
        return Err(PlethoraError::InvalidInput(format!(
            "Image file is empty: {file_path}"
        )));
    }
    ingest_image_bytes(bytes, mime_type, file_name, repo)
        .await
        .map(|(asset, _)| asset)
}

#[tauri::command]
pub async fn ingest_remote_image_asset(
    image_url: String,
    file_name: Option<String>,
    referrer_url: Option<String>,
    repo: State<'_, Repository>,
) -> Result<ImageAssetDto> {
    ingest_remote_image_asset_inner(&image_url, file_name, referrer_url, repo.inner()).await
}

/// Non-command variant for browser-sync ingestion, where the repository is
/// already available as shared server state.
pub async fn ingest_remote_image_asset_inner(
    image_url: &str,
    file_name: Option<String>,
    referrer_url: Option<String>,
    repo: &Repository,
) -> Result<ImageAssetDto> {
    let parsed = reqwest::Url::parse(image_url)
        .map_err(|error| PlethoraError::InvalidInput(format!("Invalid image URL: {error}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(PlethoraError::InvalidInput(
            "Remote images must use HTTP or HTTPS".to_string(),
        ));
    }
    crate::security::validate_url_not_private(parsed.as_str()).map_err(|error| {
        PlethoraError::InvalidInput(format!("Image URL is not allowed: {error}"))
    })?;
    let referrer = validated_image_referrer(referrer_url.as_deref(), &parsed)?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
             AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        )
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.stop();
            }
            let target = attempt.url();
            if !matches!(target.scheme(), "http" | "https")
                || crate::security::validate_url_not_private(target.as_str()).is_err()
            {
                return attempt.error("redirect target is not allowed");
            }
            attempt.follow()
        }))
        .build()
        .map_err(|error| {
            PlethoraError::Internal(format!("Failed to create image HTTP client: {error}"))
        })?;

    let response = client
        .get(parsed)
        .header(
            reqwest::header::ACCEPT,
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        )
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9")
        .header(reqwest::header::REFERER, referrer.as_str())
        .send()
        .await
        .map_err(|error| {
            PlethoraError::Internal(format!("Failed to download remote image: {error}"))
        })?;
    if !response.status().is_success() {
        return Err(PlethoraError::Internal(format!(
            "Remote image returned HTTP {}",
            response.status()
        )));
    }
    crate::security::validate_url_not_private(response.url().as_str()).map_err(|error| {
        PlethoraError::InvalidInput(format!("Image redirect is not allowed: {error}"))
    })?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_IMAGE_BYTES as u64)
    {
        return Err(image_too_large_error());
    }

    let mime_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| value.starts_with("image/"))
        .map(str::to_string);
    let response_name = response
        .url()
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            PlethoraError::Internal(format!("Failed while downloading remote image: {error}"))
        })?;
        if bytes.len().saturating_add(chunk.len()) > MAX_IMAGE_BYTES {
            return Err(image_too_large_error());
        }
        bytes.extend_from_slice(&chunk);
    }

    ingest_image_bytes(bytes, mime_type, file_name.or(response_name), repo)
        .await
        .map(|(asset, _)| asset)
}

fn validated_image_referrer(
    requested_referrer: Option<&str>,
    image_url: &reqwest::Url,
) -> Result<reqwest::Url> {
    if let Some(requested) = requested_referrer.filter(|value| !value.trim().is_empty()) {
        let parsed = reqwest::Url::parse(requested).map_err(|error| {
            PlethoraError::InvalidInput(format!("Invalid article referrer URL: {error}"))
        })?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(PlethoraError::InvalidInput(
                "Article referrer must use HTTP or HTTPS".to_string(),
            ));
        }
        crate::security::validate_url_not_private(parsed.as_str()).map_err(|error| {
            PlethoraError::InvalidInput(format!("Article referrer is not allowed: {error}"))
        })?;
        return Ok(parsed);
    }

    let mut origin = image_url.clone();
    origin.set_path("/");
    origin.set_query(None);
    origin.set_fragment(None);
    Ok(origin)
}

pub const MAX_IMAGE_DIMENSION: u32 = 16384;

pub fn is_svg(bytes: &[u8], mime_type: Option<&str>) -> bool {
    if let Some(mime) = mime_type {
        if mime.trim().to_lowercase().starts_with("image/svg") {
            return true;
        }
        if mime.trim().to_lowercase().starts_with("image/") {
            return false;
        }
    }
    let trimmed = match std::str::from_utf8(bytes) {
        Ok(s) => s.trim_start_matches('\u{feff}').trim_start(),
        Err(_) => return false,
    };
    trimmed.starts_with("<svg")
        || (trimmed.starts_with("<?xml") && trimmed.contains("<svg"))
        || (trimmed.starts_with("<!DOCTYPE") && trimmed.contains("<svg"))
}

pub fn sanitize_svg(input: &[u8]) -> Result<Vec<u8>> {
    let svg_str = std::str::from_utf8(input)
        .map_err(|e| PlethoraError::InvalidInput(format!("Invalid UTF-8 in SVG: {}", e)))?;

    // Strip <!DOCTYPE ...> and <!ENTITY ...> to prevent XXE & entity expansion attacks
    let doctype_re = regex::Regex::new(r#"(?is)<!DOCTYPE\s+[^>]*(\[[^]]*\])?>"#)
        .map_err(|e| PlethoraError::Internal(e.to_string()))?;
    let entity_re = regex::Regex::new(r#"(?is)<!ENTITY\s+[^>]*>"#)
        .map_err(|e| PlethoraError::Internal(e.to_string()))?;
    let mut cleaned = doctype_re.replace_all(svg_str, "").to_string();
    cleaned = entity_re.replace_all(&cleaned, "").to_string();

    // Strip <script...>...</script> and <script.../>
    let script_re = regex::Regex::new(r#"(?is)<script\b[^>]*>.*?</script\s*>"#)
        .map_err(|e| PlethoraError::Internal(e.to_string()))?;
    let script_self_closing_re = regex::Regex::new(r#"(?is)<script\b[^>]*/>"#)
        .map_err(|e| PlethoraError::Internal(e.to_string()))?;
    cleaned = script_re.replace_all(&cleaned, "").to_string();
    cleaned = script_self_closing_re.replace_all(&cleaned, "").to_string();

    // Strip inline event handlers: on*="..." or on*='...' or on*=value
    let event_handler_re = regex::Regex::new(r#"(?is)\s+on[a-z0-9_-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#)
        .map_err(|e| PlethoraError::Internal(e.to_string()))?;
    cleaned = event_handler_re.replace_all(&cleaned, "").to_string();

    // Strip javascript: and data: in href / xlink:href
    let js_href_re = regex::Regex::new(r#"(?is)\s+(?:xlink:)?href\s*=\s*["']\s*(?:javascript|data):[^"']*["']"#)
        .map_err(|e| PlethoraError::Internal(e.to_string()))?;
    cleaned = js_href_re.replace_all(&cleaned, "").to_string();

    // Strip <foreignObject...>...</foreignObject> to prevent embedded HTML/XSS injection
    let foreign_obj_re = regex::Regex::new(r#"(?is)<foreignObject\b[^>]*>.*?</foreignObject\s*>"#)
        .map_err(|e| PlethoraError::Internal(e.to_string()))?;
    let foreign_obj_self_closing_re = regex::Regex::new(r#"(?is)<foreignObject\b[^>]*/>"#)
        .map_err(|e| PlethoraError::Internal(e.to_string()))?;
    cleaned = foreign_obj_re.replace_all(&cleaned, "").to_string();
    cleaned = foreign_obj_self_closing_re.replace_all(&cleaned, "").to_string();

    if cleaned.trim().is_empty() {
        return Err(PlethoraError::InvalidInput(
            "SVG content is empty after sanitization".to_string(),
        ));
    }

    Ok(cleaned.into_bytes())
}

pub fn parse_svg_dimensions(svg_bytes: &[u8]) -> (Option<i32>, Option<i32>) {
    let Ok(svg_str) = std::str::from_utf8(svg_bytes) else {
        return (None, None);
    };
    let width_re = regex::Regex::new(r#"(?is)<svg\b[^>]*\bwidth\s*=\s*["'](\d+(?:\.\d+)?)(?:px)?["']"#).ok();
    let height_re = regex::Regex::new(r#"(?is)<svg\b[^>]*\bheight\s*=\s*["'](\d+(?:\.\d+)?)(?:px)?["']"#).ok();

    let width = width_re.as_ref().and_then(|re| re.captures(svg_str)).and_then(|c| c.get(1)).and_then(|m| m.as_str().parse::<f64>().ok()).map(|v| v as i32);
    let height = height_re.as_ref().and_then(|re| re.captures(svg_str)).and_then(|c| c.get(1)).and_then(|m| m.as_str().parse::<f64>().ok()).map(|v| v as i32);

    if width.is_some() && height.is_some() {
        return (width, height);
    }

    let viewbox_re = regex::Regex::new(r#"(?is)<svg\b[^>]*\bviewBox\s*=\s*["'][^"']*?\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*["']"#).ok();
    if let Some(captures) = viewbox_re.as_ref().and_then(|re| re.captures(svg_str)) {
        let vb_w = captures.get(1).and_then(|m| m.as_str().parse::<f64>().ok()).map(|v| v as i32);
        let vb_h = captures.get(2).and_then(|m| m.as_str().parse::<f64>().ok()).map(|v| v as i32);
        return (width.or(vb_w), height.or(vb_h));
    }

    (width, height)
}

async fn ingest_image_bytes(
    bytes: Vec<u8>,
    mime_type: Option<String>,
    file_name: Option<String>,
    repo: &Repository,
) -> Result<(ImageAssetDto, bool)> {
    if bytes.is_empty() {
        return Err(PlethoraError::InvalidInput(
            "Image payload is empty".to_string(),
        ));
    }

    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(image_too_large_error());
    }

    if is_svg(&bytes, mime_type.as_deref()) {
        let sanitized = sanitize_svg(&bytes)?;
        let (width, height) = parse_svg_dimensions(&sanitized);
        let sha256 = hex_sha256(&sanitized);
        let existed = repo.get_image_asset_by_sha256(&sha256).await?.is_some();
        let asset = repo
            .create_or_get_image_asset(
                "image/svg+xml",
                file_name.as_deref(),
                &sanitized,
                &sha256,
                width,
                height,
            )
            .await?;
        return Ok((to_dto(asset), existed));
    }

    let guessed = image::guess_format(&bytes)
        .map_err(|_| PlethoraError::InvalidInput("Unsupported image format".to_string()))?;
    let normalized_mime = normalize_mime(mime_type.as_deref(), guessed)?;

    let dimensions = image::load_from_memory(&bytes)
        .map_err(|e| {
            PlethoraError::InvalidInput(format!("Unable to decode image dimensions: {}", e))
        })?
        .dimensions();

    if dimensions.0 > MAX_IMAGE_DIMENSION || dimensions.1 > MAX_IMAGE_DIMENSION {
        return Err(PlethoraError::InvalidInput(format!(
            "Image dimensions ({}x{}) exceed max allowed {}x{}",
            dimensions.0, dimensions.1, MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION
        )));
    }

    let sha256 = hex_sha256(&bytes);
    let existed = repo.get_image_asset_by_sha256(&sha256).await?.is_some();
    let asset = repo
        .create_or_get_image_asset(
            &normalized_mime,
            file_name.as_deref(),
            &bytes,
            &sha256,
            i32::try_from(dimensions.0).ok(),
            i32::try_from(dimensions.1).ok(),
        )
        .await?;

    Ok((to_dto(asset), existed))
}

fn image_too_large_error() -> PlethoraError {
    PlethoraError::InvalidInput(format!(
        "Image exceeds max size of {} bytes",
        MAX_IMAGE_BYTES
    ))
}

#[tauri::command]
pub async fn list_image_assets(repo: State<'_, Repository>) -> Result<Vec<ImageAssetDto>> {
    let assets = repo.list_image_assets_with_usage().await?;
    Ok(assets
        .into_iter()
        .map(|asset| to_registry_list_dto(asset.asset, asset.reference_count))
        .collect())
}

#[tauri::command]
pub async fn get_image_asset(
    asset_id: String,
    repo: State<'_, Repository>,
) -> Result<Option<ImageAssetDto>> {
    let asset = repo.get_image_asset(&asset_id).await?;
    Ok(asset.map(|asset| to_dto_with_usage(asset, 0)))
}

/// Rename an image asset. The name is a display label; cards and extracts
/// reference the asset by id, so renaming never breaks them.
#[tauri::command]
pub async fn rename_image_asset(
    asset_id: String,
    file_name: String,
    repo: State<'_, Repository>,
) -> Result<ImageAssetDto> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return Err(crate::error::PlethoraError::Internal(
            "Image name cannot be empty".to_string(),
        ));
    }
    if trimmed.chars().count() > 200 {
        return Err(crate::error::PlethoraError::Internal(
            "Image name is too long (max 200 characters)".to_string(),
        ));
    }

    if !repo.rename_image_asset(&asset_id, trimmed).await? {
        return Err(crate::error::PlethoraError::NotFound(format!(
            "Image asset {}",
            asset_id
        )));
    }

    let asset = repo.get_image_asset(&asset_id).await?.ok_or_else(|| {
        crate::error::PlethoraError::NotFound(format!("Image asset {}", asset_id))
    })?;
    Ok(to_dto(asset))
}

/// Persist bounded browser metadata (capture context, provenance, smart
/// organization state) on an image asset. Returns the updated asset DTO.
#[tauri::command]
pub async fn update_image_asset_metadata(
    asset_id: String,
    metadata: serde_json::Value,
    repo: State<'_, Repository>,
) -> Result<ImageAssetDto> {
    if !metadata.is_object() {
        return Err(crate::error::PlethoraError::InvalidInput(
            "Image asset metadata must be a JSON object".to_string(),
        ));
    }
    let serialized = serde_json::to_string(&metadata)
        .map_err(|e| PlethoraError::Internal(format!("Failed to serialize metadata: {}", e)))?;
    if serialized.len() > 64 * 1024 {
        return Err(PlethoraError::InvalidInput(
            "Image asset metadata exceeds the 64 KB limit".to_string(),
        ));
    }

    if !repo.update_image_asset_metadata(&asset_id, &serialized).await? {
        return Err(crate::error::PlethoraError::NotFound(format!(
            "Image asset {}",
            asset_id
        )));
    }

    let asset = repo.get_image_asset(&asset_id).await?.ok_or_else(|| {
        crate::error::PlethoraError::NotFound(format!("Image asset {}", asset_id))
    })?;
    Ok(to_dto(asset))
}

#[tauri::command]
pub async fn delete_image_asset(
    asset_id: String,
    repo: State<'_, Repository>,
) -> Result<DeleteImageAssetResult> {
    let deleted = repo.delete_image_asset_if_unreferenced(&asset_id).await?;
    if deleted {
        return Ok(DeleteImageAssetResult {
            deleted: true,
            reason: None,
        });
    }

    Ok(DeleteImageAssetResult {
        deleted: false,
        reason: Some("Image is still referenced by one or more flashcards".to_string()),
    })
}

fn to_dto(asset: crate::models::ImageAsset) -> ImageAssetDto {
    to_dto_with_usage(asset, 0)
}

fn to_dto_with_usage(asset: crate::models::ImageAsset, reference_count: i64) -> ImageAssetDto {
    let data_url = encode_data_url(&asset.mime_type, &asset.content);
    ImageAssetDto {
        id: asset.id,
        mime_type: asset.mime_type.clone(),
        file_name: asset.file_name,
        byte_size: asset.byte_size,
        sha256: asset.sha256,
        width: asset.width,
        height: asset.height,
        created_at: asset.created_at.to_rfc3339(),
        reference_count,
        is_referenced: reference_count > 0,
        data_url,
        metadata: asset
            .metadata
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok()),
    }
}

fn to_registry_list_dto(asset: crate::models::ImageAsset, reference_count: i64) -> ImageAssetDto {
    let mime_type = asset.mime_type.clone();
    let data_url = thumbnail_data_url(&asset.content)
        .unwrap_or_else(|| encode_data_url(&mime_type, &asset.content));
    ImageAssetDto {
        id: asset.id,
        mime_type,
        file_name: asset.file_name,
        byte_size: asset.byte_size,
        sha256: asset.sha256,
        width: asset.width,
        height: asset.height,
        created_at: asset.created_at.to_rfc3339(),
        reference_count,
        is_referenced: reference_count > 0,
        data_url,
        metadata: asset
            .metadata
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok()),
    }
}

fn encode_data_url(mime_type: &str, bytes: &[u8]) -> String {
    let base64_data = general_purpose::STANDARD.encode(bytes);
    format!("data:{};base64,{}", mime_type, base64_data)
}

fn thumbnail_data_url(bytes: &[u8]) -> Option<String> {
    let image = image::load_from_memory(bytes).ok()?;
    let thumbnail = image.thumbnail(
        REGISTRY_THUMBNAIL_MAX_DIMENSION,
        REGISTRY_THUMBNAIL_MAX_DIMENSION,
    );

    let mut buffer = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut buffer, image::ImageFormat::Png)
        .ok()?;
    Some(encode_data_url("image/png", &buffer.into_inner()))
}

fn hex_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn normalize_mime(requested: Option<&str>, guessed: image::ImageFormat) -> Result<String> {
    let guessed_mime = match guessed {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::Gif => "image/gif",
        image::ImageFormat::WebP => "image/webp",
        _ => {
            return Err(PlethoraError::InvalidInput(
                "Unsupported image format".to_string(),
            ))
        }
    };

    if let Some(requested) = requested {
        let normalized = requested.trim().to_lowercase();
        if normalized.starts_with("image/") {
            return Ok(normalized);
        }
    }

    Ok(guessed_mime.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_svg_strips_scripts_handlers_and_entities() {
        let input = br#"<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" width="10" height="10">
  <script>alert('xss')</script>
  <script src="https://evil.example/x.js"/>
  <foreignObject><iframe src="https://evil.example"></iframe></foreignObject>
  <a xlink:href="javascript:alert(1)"><text>label</text></a>
  <circle cx="5" cy="5" r="4" onmouseover="steal()"/>
</svg>"#;

        let cleaned = sanitize_svg(input).expect("sanitize should succeed");
        let cleaned_str = String::from_utf8(cleaned).expect("utf8");
        assert!(!cleaned_str.contains("<script"), "script tags stripped");
        assert!(!cleaned_str.contains("onload"), "inline handlers stripped");
        assert!(!cleaned_str.contains("onmouseover"), "inline handlers stripped");
        assert!(!cleaned_str.contains("DOCTYPE"), "DOCTYPE stripped");
        assert!(!cleaned_str.contains("ENTITY"), "entity declarations stripped");
        assert!(!cleaned_str.contains("foreignObject"), "foreignObject stripped");
        assert!(!cleaned_str.contains("javascript:"), "javascript href stripped");
        assert!(cleaned_str.contains("<svg"), "svg element retained");
        assert!(cleaned_str.contains("<circle"), "benign content retained");
        assert!(cleaned_str.contains(">label<"), "text content retained");
    }

    #[test]
    fn sanitize_svg_rejects_empty_result() {
        let err = sanitize_svg(b"<script>alert(1)</script>").unwrap_err();
        assert!(matches!(err, PlethoraError::InvalidInput(_)));
    }

    #[test]
    fn sanitize_svg_rejects_invalid_utf8() {
        let err = sanitize_svg(&[0xff, 0xfe, 0x00, 0x01]).unwrap_err();
        assert!(matches!(err, PlethoraError::InvalidInput(_)));
    }

    #[test]
    fn is_svg_detects_mime_and_markup() {
        assert!(is_svg(b"<svg></svg>", None));
        assert!(is_svg(b"<?xml version=\"1.0\"?><svg/>", None));
        assert!(is_svg(b"<!DOCTYPE svg PUBLIC \"x\"><svg/>", None));
        assert!(is_svg(b"<svg/>", Some("image/svg+xml")));
        assert!(!is_svg(b"<svg></svg>", Some("image/png")));
        assert!(!is_svg(b"\x89PNG\r\n\x1a\n", None));
        assert!(!is_svg(b"not svg at all", Some("image/png")));
    }

    #[test]
    fn parse_svg_dimensions_reads_attributes_and_viewbox() {
        let attrs = parse_svg_dimensions(br#"<svg width="640" height="480">"#);
        assert_eq!(attrs, (Some(640), Some(480)));

        let px = parse_svg_dimensions(br#"<svg width="100px" height="50px">"#);
        assert_eq!(px, (Some(100), Some(50)));

        let viewbox = parse_svg_dimensions(br#"<svg viewBox="0 0 200 100">"#);
        assert_eq!(viewbox, (Some(200), Some(100)));

        let none = parse_svg_dimensions(br#"<svg></svg>"#);
        assert_eq!(none, (None, None));
    }

    #[test]
    fn dimension_limit_constant_matches_spec() {
        assert_eq!(MAX_IMAGE_DIMENSION, 16_384);
    }

    #[tokio::test]
    async fn ingest_base64_rejects_invalid_encoding() {
        let repo_pool = crate::database::connection::Database::new(std::path::PathBuf::from(":memory:"))
            .await
            .expect("in-memory db");
        repo_pool.migrate().await.expect("migrate");
        let repo = Repository::new(repo_pool.pool().clone());
        let err = ingest_image_asset_from_base64(
            "%%%not-base64%%%",
            None,
            None,
            &repo,
        )
        .await
        .unwrap_err();
        assert!(matches!(err, PlethoraError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn ingest_image_asset_deduplicates_by_sha256() {
        let repo_pool = crate::database::connection::Database::new(std::path::PathBuf::from(":memory:"))
            .await
            .expect("in-memory db");
        repo_pool.migrate().await.expect("migrate");
        let repo = Repository::new(repo_pool.pool().clone());
        // 1x1 red PNG
        let png = base64::engine::general_purpose::STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
            .expect("valid png base64");
        let base64_data = general_purpose::STANDARD.encode(&png);
        let first = ingest_image_asset_from_base64(
            &base64_data,
            Some("image/png".to_string()),
            Some("diagram.png".to_string()),
            &repo,
        )
        .await
        .expect("first ingest succeeds");
        let second = ingest_image_asset_from_base64(
            &base64_data,
            Some("image/png".to_string()),
            Some("duplicate.png".to_string()),
            &repo,
        )
        .await
        .expect("duplicate ingest succeeds");
        assert_eq!(first.id, second.id, "identical content reuses the asset");
        assert_eq!(first.sha256, second.sha256);
    }

    #[tokio::test]
    async fn ingest_image_asset_rejects_non_image_payload() {
        let repo_pool = crate::database::connection::Database::new(std::path::PathBuf::from(":memory:"))
            .await
            .expect("in-memory db");
        repo_pool.migrate().await.expect("migrate");
        let repo = Repository::new(repo_pool.pool().clone());
        let base64_data = general_purpose::STANDARD.encode(b"this is definitely not an image");
        let err = ingest_image_asset_from_base64(
            &base64_data,
            Some("image/png".to_string()),
            None,
            &repo,
        )
        .await
        .unwrap_err();
        assert!(matches!(err, PlethoraError::InvalidInput(_)));
    }
}
