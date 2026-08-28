use crate::sync::transport::api_base_url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const AUTH_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Deserialize)]
struct ApiErrorEnvelope {
    error: Option<ApiErrorDetail>,
}

#[derive(Debug, Clone, Deserialize)]
struct ApiErrorDetail {
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUserJson {
    pub id: String,
    pub email: String,
    #[serde(default = "default_subscription_tier")]
    pub subscription_tier: String,
}

fn default_subscription_tier() -> String {
    "free".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthTokensJson {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthDeviceJson {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSessionJson {
    pub user: AuthUserJson,
    pub tokens: AuthTokensJson,
    pub device: Option<AuthDeviceJson>,
}

fn parse_api_error(body: &str, status: reqwest::StatusCode) -> String {
    if let Ok(envelope) = serde_json::from_str::<ApiErrorEnvelope>(body) {
        if let Some(message) = envelope.error.and_then(|e| e.message).filter(|m| !m.is_empty()) {
            return message;
        }
    }
    format!("Auth request failed ({status})")
}

async fn post_auth(path: &str, payload: Value) -> Result<AuthSessionJson, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(AUTH_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Auth client build failed: {e}"))?;

    let url = format!(
        "{}/v1/auth/{}",
        api_base_url(),
        path.trim_start_matches('/')
    );

    let response = client
        .post(url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Could not reach Plethora cloud: {e}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Auth response read failed: {e}"))?;

    if !status.is_success() {
        return Err(parse_api_error(&body, status));
    }

    serde_json::from_str(&body).map_err(|e| format!("Auth response parse failed: {e}"))
}

pub async fn register_account(
    email: String,
    password: String,
    device_name: Option<String>,
    platform: Option<String>,
) -> Result<AuthSessionJson, String> {
    post_auth(
        "register",
        json!({
            "email": email,
            "password": password,
            "deviceName": device_name,
            "platform": platform.unwrap_or_else(|| "desktop".to_string()),
        }),
    )
    .await
}

pub async fn login_account(
    email: String,
    password: String,
    device_name: Option<String>,
    platform: Option<String>,
) -> Result<AuthSessionJson, String> {
    post_auth(
        "login",
        json!({
            "email": email,
            "password": password,
            "deviceName": device_name,
            "platform": platform.unwrap_or_else(|| "desktop".to_string()),
        }),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_api_error_extracts_message() {
        let body = r#"{"error":{"code":"invalid_credentials","message":"Invalid email or password"}}"#;
        let msg = parse_api_error(body, reqwest::StatusCode::UNAUTHORIZED);
        assert_eq!(msg, "Invalid email or password");
    }
}
