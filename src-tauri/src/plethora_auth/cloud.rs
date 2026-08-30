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
        if let Some(message) = envelope
            .error
            .and_then(|e| e.message)
            .filter(|m| !m.is_empty())
        {
            return message;
        }
    }
    format!("Auth request failed ({status})")
}

fn auth_request_body(
    email: &str,
    password: &str,
    device_id: Option<String>,
    device_name: Option<String>,
    platform: Option<String>,
) -> Value {
    let mut body = serde_json::Map::new();
    body.insert("email".into(), json!(email));
    body.insert("password".into(), json!(password));
    body.insert(
        "platform".into(),
        json!(platform.unwrap_or_else(|| "desktop".to_string())),
    );
    // Re-login must reuse the account's device row for this install: the
    // server stamps that identity into the access token, and sync traffic is
    // rejected if it does not match. Omitted fields must stay absent —
    // serde_json::json!(None) becomes null, and the API's Zod schemas reject
    // null for optional fields.
    if let Some(id) = device_id.filter(|value| !value.trim().is_empty()) {
        body.insert("deviceId".into(), json!(id));
    }
    if let Some(name) = device_name.filter(|value| !value.trim().is_empty()) {
        body.insert("deviceName".into(), json!(name));
    }
    Value::Object(body)
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
        auth_request_body(&email, &password, None, device_name, platform),
    )
    .await
}

pub async fn login_account(
    email: String,
    password: String,
    device_id: Option<String>,
    device_name: Option<String>,
    platform: Option<String>,
) -> Result<AuthSessionJson, String> {
    post_auth(
        "login",
        auth_request_body(&email, &password, device_id, device_name, platform),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_api_error_extracts_message() {
        let body =
            r#"{"error":{"code":"invalid_credentials","message":"Invalid email or password"}}"#;
        let msg = parse_api_error(body, reqwest::StatusCode::UNAUTHORIZED);
        assert_eq!(msg, "Invalid email or password");
    }

    #[test]
    fn auth_request_body_omits_null_device_name() {
        let body = auth_request_body(
            "user@example.com",
            "password123",
            None,
            None,
            Some("desktop".to_string()),
        );
        let obj = body.as_object().expect("object payload");
        assert!(!obj.contains_key("deviceName"));
        assert!(!obj.contains_key("deviceId"));
        assert_eq!(obj.get("platform").and_then(Value::as_str), Some("desktop"));
    }

    #[test]
    fn auth_request_body_includes_device_name_when_present() {
        let body = auth_request_body(
            "user@example.com",
            "password123",
            None,
            Some("Linux Desktop".to_string()),
            None,
        );
        let obj = body.as_object().expect("object payload");
        assert_eq!(
            obj.get("deviceName").and_then(Value::as_str),
            Some("Linux Desktop")
        );
    }

    #[test]
    fn auth_request_body_reuses_device_id_on_login() {
        let body = auth_request_body(
            "user@example.com",
            "password123",
            Some("11111111-1111-4111-8111-111111111111".to_string()),
            None,
            Some("desktop".to_string()),
        );
        let obj = body.as_object().expect("object payload");
        assert_eq!(
            obj.get("deviceId").and_then(Value::as_str),
            Some("11111111-1111-4111-8111-111111111111")
        );

        let blank = auth_request_body(
            "user@example.com",
            "password123",
            Some("   ".to_string()),
            None,
            None,
        );
        assert!(!blank
            .as_object()
            .expect("object payload")
            .contains_key("deviceId"));
    }
}
