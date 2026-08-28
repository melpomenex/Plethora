use crate::error::{PlethoraError, Result};
use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::transport::api_base_url;
use super::wire::SYNC_PROTOCOL_VERSION;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobCheckResponse {
    pub existing: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobUploadUrlResponse {
    pub upload_url: String,
    pub expires_at: Option<String>,
    #[serde(default)]
    pub already_exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobDownloadUrlResponse {
    pub download_url: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsageResponse {
    pub used_bytes: u64,
    pub limit_bytes: u64,
}

pub fn sha256_reference(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("sha256:{}", hex::encode(digest))
}

fn auth_headers(access_token: &str) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {access_token}"))
            .map_err(|e| PlethoraError::Internal(format!("Invalid bearer token: {e}")))?,
    );
    headers.insert(
        "x-plethora-sync-protocol-version",
        HeaderValue::from_static(SYNC_PROTOCOL_VERSION),
    );
    Ok(headers)
}

pub async fn check_hashes(access_token: &str, hashes: &[String]) -> Result<BlobCheckResponse> {
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/v1/blobs/check", api_base_url()))
        .headers(auth_headers(access_token)?)
        .json(&serde_json::json!({ "hashes": hashes }))
        .send()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Blob check failed: {e}")))?;
    parse_json(response).await
}

pub async fn request_upload_url(
    access_token: &str,
    hash: &str,
    size_bytes: u64,
    content_type: &str,
) -> Result<BlobUploadUrlResponse> {
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/v1/blobs/upload-url", api_base_url()))
        .headers(auth_headers(access_token)?)
        .json(&serde_json::json!({
            "hash": hash,
            "sizeBytes": size_bytes,
            "contentType": content_type,
        }))
        .send()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Blob upload-url failed: {e}")))?;
    parse_json(response).await
}

pub async fn upload_bytes(upload_url: &str, bytes: &[u8], content_type: &str) -> Result<()> {
    let client = reqwest::Client::new();
    let response = client
        .put(upload_url)
        .header("Content-Type", content_type)
        .body(bytes.to_vec())
        .send()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Blob upload failed: {e}")))?;
    if !response.status().is_success() {
        return Err(PlethoraError::Internal(format!(
            "Blob upload failed ({})",
            response.status()
        )));
    }
    Ok(())
}

pub async fn request_download_url(
    access_token: &str,
    hash: &str,
) -> Result<BlobDownloadUrlResponse> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/v1/blobs/{}/download-url", api_base_url(), hash))
        .headers(auth_headers(access_token)?)
        .send()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Blob download-url failed: {e}")))?;
    parse_json(response).await
}

pub async fn download_and_verify(download_url: &str, expected_hash: &str) -> Result<Vec<u8>> {
    let client = reqwest::Client::new();
    let response = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Blob download failed: {e}")))?;
    if !response.status().is_success() {
        return Err(PlethoraError::Internal(format!(
            "Blob download failed ({})",
            response.status()
        )));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Blob body read failed: {e}")))?
        .to_vec();
    if sha256_reference(&bytes) != expected_hash {
        return Err(PlethoraError::Internal(
            "Downloaded blob failed integrity check".into(),
        ));
    }
    Ok(bytes)
}

pub async fn fetch_storage_usage(access_token: &str) -> Result<StorageUsageResponse> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/v1/blobs/usage", api_base_url()))
        .headers(auth_headers(access_token)?)
        .send()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Storage usage failed: {e}")))?;
    parse_json(response).await
}

pub async fn complete_blob_upload(
    access_token: &str,
    hash: &str,
    size_bytes: u64,
    content_type: &str,
) -> Result<()> {
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/v1/blobs/complete", api_base_url()))
        .headers(auth_headers(access_token)?)
        .json(&serde_json::json!({
            "hash": hash,
            "sizeBytes": size_bytes,
            "contentType": content_type,
        }))
        .send()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Blob complete failed: {e}")))?;
    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(PlethoraError::Internal(format!(
            "Blob complete failed: {body}"
        )));
    }
    Ok(())
}

pub async fn upload_blob_if_missing(
    access_token: &str,
    bytes: &[u8],
    content_type: &str,
) -> Result<String> {
    let hash = sha256_reference(bytes);
    let check = check_hashes(access_token, &[hash.clone()]).await?;
    if check.existing.iter().any(|item| item == &hash) {
        return Ok(hash);
    }
    let upload = request_upload_url(access_token, &hash, bytes.len() as u64, content_type).await?;
    if upload.already_exists {
        return Ok(hash);
    }
    upload_bytes(&upload.upload_url, bytes, content_type).await?;
    complete_blob_upload(access_token, &hash, bytes.len() as u64, content_type).await?;
    Ok(hash)
}

async fn parse_json<T: for<'de> Deserialize<'de>>(response: reqwest::Response) -> Result<T> {
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Blob response read failed: {e}")))?;
    if !status.is_success() {
        return Err(PlethoraError::Internal(format!(
            "Blob request failed ({status}): {body}"
        )));
    }
    serde_json::from_str(&body)
        .map_err(|e| PlethoraError::Internal(format!("Blob response parse failed: {e}")))
}
