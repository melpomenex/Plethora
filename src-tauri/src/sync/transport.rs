use crate::error::{PlethoraError, Result};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};

use super::wire::{
    PullResponseBody, PushRequestBody, PushResponseBody, WireSyncRecord, SYNC_PROTOCOL_VERSION,
};

pub fn api_base_url() -> String {
    std::env::var("PLETHORA_API_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "https://api.useplethora.com".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn auth_headers(access_token: &str) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {access_token}"))
            .map_err(|e| PlethoraError::Internal(format!("Invalid bearer token: {e}")))?,
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        "x-plethora-sync-protocol-version",
        HeaderValue::from_static(SYNC_PROTOCOL_VERSION),
    );
    Ok(headers)
}

pub async fn push_records(
    access_token: &str,
    records: Vec<WireSyncRecord>,
) -> Result<PushResponseBody> {
    if records.is_empty() {
        return Ok(PushResponseBody {
            accepted: 0,
            latest_seq: 0,
            conflicts: Vec::new(),
        });
    }

    let client = reqwest::Client::new();
    let url = format!("{}/v1/sync/push", api_base_url());
    let response = client
        .post(url)
        .headers(auth_headers(access_token)?)
        .json(&PushRequestBody { records })
        .send()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Sync push request failed: {e}")))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Sync pull response read failed: {e}")))?;

    if !status.is_success() {
        return Err(PlethoraError::Internal(format!(
            "Sync push failed ({status}): {body}"
        )));
    }

    serde_json::from_str(&body)
        .map_err(|e| PlethoraError::Internal(format!("Sync push response parse failed: {e}")))
}

pub async fn pull_page(
    access_token: &str,
    device_id: &str,
    cursor: u64,
    limit: usize,
) -> Result<(Vec<(WireSyncRecord, u64)>, u64, bool, u32)> {
    let client = reqwest::Client::new();
    let url = format!(
        "{}/v1/sync/pull?cursor={cursor}&limit={}&deviceId={}",
        api_base_url(),
        limit.min(500),
        urlencoding::encode(device_id)
    );
    let response = client
        .get(url)
        .headers(auth_headers(access_token)?)
        .send()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Sync pull request failed: {e}")))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Sync pull response read failed: {e}")))?;

    if !status.is_success() {
        return Err(PlethoraError::Internal(format!(
            "Sync pull failed ({status}): {body}"
        )));
    }

    let parsed: PullResponseBody = serde_json::from_str(&body)
        .map_err(|e| PlethoraError::Internal(format!("Sync pull response parse failed: {e}")))?;

    let raw: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| PlethoraError::Internal(format!("Sync pull JSON parse failed: {e}")))?;
    let mut records = Vec::new();
    if let Some(items) = raw.get("records").and_then(|v| v.as_array()) {
        for item in items {
            let wire: WireSyncRecord = serde_json::from_value(item.clone()).map_err(|e| {
                PlethoraError::Internal(format!("Sync pull record parse failed: {e}"))
            })?;
            let seq = item
                .get("seqNumber")
                .and_then(|v| v.as_u64())
                .unwrap_or(parsed.cursor);
            records.push((wire, seq));
        }
    }

    Ok((records, parsed.cursor, parsed.has_more, parsed.account_key_epoch))
}

pub async fn increment_sync_epoch(access_token: &str) -> Result<u32> {
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/v1/sync/increment-epoch", api_base_url()))
        .headers(auth_headers(access_token)?)
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Sync increment-epoch failed: {e}")))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Sync increment-epoch read failed: {e}")))?;
    if !status.is_success() {
        return Err(PlethoraError::Internal(format!(
            "Sync increment-epoch failed ({status}): {body}"
        )));
    }
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| PlethoraError::Internal(format!("Sync increment-epoch parse failed: {e}")))?;
    Ok(parsed
        .get("accountKeyEpoch")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as u32)
}

pub async fn revoke_sync_device(access_token: &str, sync_device_id: &str) -> Result<u32> {
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/v1/sync/revoke-device", api_base_url()))
        .headers(auth_headers(access_token)?)
        .json(&serde_json::json!({ "syncDeviceId": sync_device_id }))
        .send()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Sync revoke-device failed: {e}")))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Sync revoke-device read failed: {e}")))?;
    if !status.is_success() {
        return Err(PlethoraError::Internal(format!(
            "Sync revoke-device failed ({status}): {body}"
        )));
    }
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| PlethoraError::Internal(format!("Sync revoke-device parse failed: {e}")))?;
    Ok(parsed
        .get("accountKeyEpoch")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as u32)
}
