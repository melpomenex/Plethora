//! Yjs file-service transport.
//!
//! These commands proxy the `https://sync.readsync.org/files/...` REST API
//! through the native `reqwest` client so that cross-origin requests are not
//! subject to the WebView's CORS enforcement. The webview `fetch()` on a
//! cross-origin URL is blocked by CORS (WebKit reports it as a cryptic
//! "Load failed" / "Fetch API cannot load ... due to access control checks"),
//! whereas `reqwest` runs outside the WebView and is not bound by CORS. This
//! mirrors the existing `fetch_url_content` / `fetch_web_page_preview` commands.
//!
//! The TS wrapper (`src/lib/yjs-file-service.ts`) calls these only when
//! `isTauri()` is true; in browser/PWA mode it falls back to the raw
//! `fetch()` (CORS is handled by the server for that deployment).

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::commands::Result;
use crate::error::IncrementumError;

/// Wire shape mirroring `YjsFileMeta` on the TS side
/// (`src/lib/yjs-file-service.ts`). Kept loose (all fields optional except the
/// ones the server always returns) so evolution of the server payload does not
/// break deserialization.
///
/// The file-service has historically returned both camelCase (`sizeBytes`,
/// `createdAt`, `contentType`) and snake_case (`size_bytes`, `created_at`)
/// depending on deployment / version, so we accept both via `alias` + tolerate
/// missing optionals. `rename_all = camelCase` makes the primary mapping
/// camelCase, which matches the current TS type and the Go server's JSON tags.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YjsFileMeta {
    pub id: String,
    pub room: String,
    #[serde(default)]
    pub filename: Option<String>,
    #[serde(default, alias = "content_type")]
    pub content_type: Option<String>,
    #[serde(alias = "size_bytes", default)]
    pub size_bytes: i64,
    #[serde(alias = "created_at", default)]
    pub created_at: String,
    #[serde(default, alias = "deleted_at")]
    pub deleted_at: Option<String>,
    #[serde(default, alias = "enc_metadata", alias = "encMetadata")]
    pub enc_metadata: Option<String>,
}

fn build_client() -> std::result::Result<reqwest::Client, IncrementumError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .user_agent("Incrementum/1.0 (https://incrementum.app)")
        .build()
        .map_err(|e| IncrementumError::Internal(format!("Failed to create HTTP client: {}", e)))
}

/// Check whether a file already exists in the room's file-service store.
/// Returns `true` on a 2xx response. Network/non-2xx errors return `Ok(false)`
/// (matching the TS `checkRoomFileExists` catch-all) so the caller can decide
/// whether to re-upload.
#[tauri::command]
pub async fn yjs_file_exists(url: String) -> Result<bool> {
    crate::security::validate_url_not_private(&url)
        .map_err(|e| IncrementumError::Internal(format!("URL not allowed: {}", e)))?;

    let client = build_client()?;
    let res = client.head(&url).send().await.map_err(|e| {
        IncrementumError::Internal(format!("yjs_file_exists request failed: {}", e))
    })?;
    Ok(res.status().is_success())
}

/// Upload a file (raw bytes + content type) to the room file-service.
/// `enc_metadata` is forwarded as the `X-Encrypted-Metadata` form field when
/// present (matches the encrypted-upload path on the TS side).
#[tauri::command]
pub async fn yjs_file_upload(
    url: String,
    filename: String,
    content_type: String,
    bytes: Vec<u8>,
    enc_metadata: Option<String>,
) -> Result<YjsFileMeta> {
    crate::security::validate_url_not_private(&url)
        .map_err(|e| IncrementumError::Internal(format!("URL not allowed: {}", e)))?;

    let client = build_client()?;

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(filename)
        .mime_str(&content_type)
        .map_err(|e| IncrementumError::Internal(format!("Invalid content type: {}", e)))?;
    let mut form = reqwest::multipart::Form::new().part("file", part);
    if let Some(meta) = enc_metadata {
        form = form.text("encMetadata", meta);
    }

    let res = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| {
            IncrementumError::Internal(format!("yjs_file_upload request failed: {}", e))
        })?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(IncrementumError::Internal(format!(
            "yjs file upload failed ({status}): {text}"
        )));
    }

    let body_bytes = res.bytes().await.map_err(|e| {
        IncrementumError::Internal(format!("yjs_file_upload body read failed: {}", e))
    })?;

    match serde_json::from_slice::<YjsFileMeta>(&body_bytes) {
        Ok(meta) => Ok(meta),
        Err(e) => {
            let body_preview = String::from_utf8_lossy(&body_bytes);
            let preview = if body_preview.len() > 500 {
                format!(
                    "{}...[truncated {} bytes]",
                    &body_preview[..500],
                    body_bytes.len()
                )
            } else {
                body_preview.to_string()
            };
            Err(IncrementumError::Internal(format!(
                "yjs_file_upload decode failed: {} | body: {}",
                e, preview
            )))
        }
    }
}

/// Download a file from the room file-service. Returns the raw bytes plus any
/// `X-Encrypted-Metadata` header so the TS layer can decrypt (the key lives on
/// the client; the backend only relays opaque ciphertext).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YjsFileDownload {
    pub bytes: Vec<u8>,
    pub encrypted_metadata: Option<String>,
}

#[tauri::command]
pub async fn yjs_file_download(url: String) -> Result<YjsFileDownload> {
    crate::security::validate_url_not_private(&url)
        .map_err(|e| IncrementumError::Internal(format!("URL not allowed: {}", e)))?;

    let client = build_client()?;
    let res = client.get(&url).send().await.map_err(|e| {
        IncrementumError::Internal(format!("yjs_file_download request failed: {}", e))
    })?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(IncrementumError::Internal(format!(
            "yjs file download failed ({status}): {text}"
        )));
    }

    let encrypted_metadata = res
        .headers()
        .get("X-Encrypted-Metadata")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    let bytes = res
        .bytes()
        .await
        .map_err(|e| IncrementumError::Internal(format!("yjs_file_download body failed: {}", e)))?
        .to_vec();

    Ok(YjsFileDownload {
        bytes,
        encrypted_metadata,
    })
}
