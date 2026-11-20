//! OAuth 2.0 + PKCE S256 authorization flow manager for cloud wearable providers.
//!
//! Guarantees:
//! - Single-use 32-byte CSPRNG `state` with 10-minute TTL and strict provider binding
//! - PKCE S256 code verifier / challenge (`OsRng`)
//! - Desktop loopback callback bound strictly to `127.0.0.1:0`
//! - Confidential client secrets NEVER live in client binaries; exchanges run via
//!   configured stateless server broker (`PLETHORA_HEALTH_OAUTH_BROKER_URL`)

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;

use super::models::{HealthDataCategory, HealthProviderError, HealthProviderId};
use super::token_store::HealthOAuthToken;

const STATE_TTL_MS: i64 = 10 * 60 * 1000;

#[derive(Clone)]
pub struct PendingOAuthSession {
    pub state: String,
    pub provider_id: HealthProviderId,
    pub code_verifier: String,
    pub redirect_uri: String,
    pub requested_categories: Vec<HealthDataCategory>,
    pub created_at_ms: i64,
}

impl std::fmt::Debug for PendingOAuthSession {
    fn fmt(&self, output: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        output
            .debug_struct("PendingOAuthSession")
            .field("provider_id", &self.provider_id)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthOAuthStartResult {
    pub provider_id: HealthProviderId,
    pub authorize_url: String,
    pub state: String,
    pub redirect_uri: String,
    pub loopback_port: Option<u16>,
}

#[derive(Default)]
pub struct HealthOAuthManager {
    pending: Mutex<HashMap<String, PendingOAuthSession>>,
}

impl HealthOAuthManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn generate_random_urlsafe(num_bytes: usize) -> String {
        let mut bytes = vec![0u8; num_bytes];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        URL_SAFE_NO_PAD.encode(bytes)
    }

    pub fn pkce_challenge_s256(verifier: &str) -> String {
        let digest = Sha256::digest(verifier.as_bytes());
        URL_SAFE_NO_PAD.encode(digest)
    }

    pub fn create_pending_session(
        &self,
        provider_id: HealthProviderId,
        authorize_base_url: &str,
        client_id: &str,
        scopes: &[&str],
        requested_categories: Vec<HealthDataCategory>,
        redirect_uri: String,
        loopback_port: Option<u16>,
    ) -> Result<HealthOAuthStartResult, HealthProviderError> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let state = Self::generate_random_urlsafe(32);
        let code_verifier = Self::generate_random_urlsafe(32);
        let code_challenge = Self::pkce_challenge_s256(&code_verifier);

        let mut url = url::Url::parse(authorize_base_url).map_err(|e| {
            HealthProviderError::new(
                "invalid_config",
                format!("Invalid authorize URL: {e}"),
                false,
            )
        })?;
        {
            let mut qp = url.query_pairs_mut();
            qp.append_pair("response_type", "code");
            qp.append_pair("client_id", client_id);
            qp.append_pair("redirect_uri", &redirect_uri);
            qp.append_pair("state", &state);
            qp.append_pair("code_challenge", &code_challenge);
            qp.append_pair("code_challenge_method", "S256");
            if provider_id == HealthProviderId::GoogleHealth {
                qp.append_pair("access_type", "offline");
                qp.append_pair("prompt", "consent");
            }
            if !scopes.is_empty() {
                qp.append_pair("scope", &scopes.join(" "));
            }
        }

        let mut map = self.pending.lock().expect("oauth pending mutex poisoned");
        map.retain(|_, v| now_ms - v.created_at_ms <= STATE_TTL_MS);
        map.retain(|_, pending| pending.provider_id != provider_id);
        map.insert(
            state.clone(),
            PendingOAuthSession {
                state: state.clone(),
                provider_id,
                code_verifier,
                redirect_uri: redirect_uri.clone(),
                requested_categories,
                created_at_ms: now_ms,
            },
        );

        Ok(HealthOAuthStartResult {
            provider_id,
            authorize_url: url.to_string(),
            state,
            redirect_uri,
            loopback_port,
        })
    }

    /// Consume a pending OAuth state exactly once, checking TTL and provider binding.
    pub fn consume_pending_session(
        &self,
        expected_provider: HealthProviderId,
        state: &str,
        now_ms: i64,
    ) -> Result<PendingOAuthSession, HealthProviderError> {
        let mut map = self.pending.lock().expect("oauth pending mutex poisoned");
        let Some(session) = map.remove(state) else {
            return Err(HealthProviderError::new(
                "oauth_state_invalid",
                "OAuth state missing, unknown, or already consumed",
                false,
            ));
        };
        if now_ms - session.created_at_ms > STATE_TTL_MS {
            return Err(HealthProviderError::new(
                "oauth_state_expired",
                "OAuth authorization window expired; please retry connecting",
                true,
            ));
        }
        if session.provider_id != expected_provider {
            return Err(HealthProviderError::new(
                "oauth_provider_mismatch",
                "OAuth callback provider did not match pending authorization",
                false,
            ));
        }
        Ok(session)
    }

    /// Bind an ephemeral desktop callback listener strictly on `127.0.0.1:0`.
    pub fn bind_loopback_listener() -> Result<(TcpListener, u16, String), HealthProviderError> {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| {
            HealthProviderError::new(
                "loopback_bind_failed",
                format!("Failed starting local OAuth callback listener: {e}"),
                true,
            )
        })?;
        let port = listener
            .local_addr()
            .map_err(|e| HealthProviderError::new("loopback_addr_failed", e.to_string(), true))?
            .port();
        let redirect_uri = format!("http://127.0.0.1:{port}/health/oauth/callback");
        Ok((listener, port, redirect_uri))
    }

    pub fn cancel_provider(&self, provider: HealthProviderId) {
        self.pending
            .lock()
            .expect("oauth pending mutex poisoned")
            .retain(|_, pending| pending.provider_id != provider);
    }

    pub fn cancel_all(&self) {
        self.pending
            .lock()
            .expect("oauth pending mutex poisoned")
            .clear();
    }

    pub fn pending_provider(&self, state: &str) -> Option<HealthProviderId> {
        self.pending
            .lock()
            .ok()?
            .get(state)
            .map(|pending| pending.provider_id)
    }

    pub fn accept_loopback_callback(
        listener: TcpListener,
        expected_state: &str,
    ) -> Result<String, HealthProviderError> {
        use std::time::{Duration, Instant};
        listener
            .set_nonblocking(true)
            .map_err(|_| callback_error())?;
        let until = Instant::now() + Duration::from_millis(STATE_TTL_MS as u64);
        while Instant::now() < until {
            let (mut stream, _) = match listener.accept() {
                Ok(pair) => pair,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(100));
                    continue;
                }
                Err(_) => return Err(callback_error()),
            };
            let timeout = Some(Duration::from_secs(3));
            let _ = stream.set_read_timeout(timeout);
            let _ = stream.set_write_timeout(timeout);
            let mut line = String::new();
            let target = BufReader::new((&stream).take(8192))
                .read_line(&mut line)
                .ok()
                .and_then(|_| line.strip_prefix("GET "))
                .and_then(|request| request.split_whitespace().next());
            let result = target
                .filter(|path| path.starts_with("/health/oauth/callback?"))
                .and_then(|path| url::Url::parse(&format!("http://127.0.0.1{path}")).ok())
                .and_then(|url| callback_params(&url).ok())
                .filter(|(_, state)| state == expected_state);
            let response = if result.is_some() {
                "HTTP/1.1 200 OK\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nReturn to Plethora to finish connecting."
            } else {
                "HTTP/1.1 400 Bad Request\r\nCache-Control: no-store\r\nConnection: close\r\n\r\nInvalid authorization callback."
            };
            let _ = stream.write_all(response.as_bytes());
            if let Some((code, _)) = result {
                return Ok(code);
            }
        }
        Err(HealthProviderError::new(
            "oauth_state_expired",
            "Authorization timed out.",
            true,
        ))
    }

    /// Exchange authorization code via configured stateless server OAuth broker.
    pub async fn exchange_via_broker(
        broker_base_url: &str,
        provider_id: HealthProviderId,
        code: &str,
        redirect_uri: &str,
        code_verifier: &str,
    ) -> Result<HealthOAuthToken, HealthProviderError> {
        let body = broker_request(
            broker_base_url,
            Some(provider_id),
            "exchange",
            Some(serde_json::json!({
                "code": code,
                "redirectUri": redirect_uri,
                "codeVerifier": code_verifier,
            })),
        )
        .await?;
        decode_token(body)
    }
}

pub(crate) fn mobile_callback(url: &url::Url) -> Result<(String, String), HealthProviderError> {
    if url.scheme() != "plethora"
        || url.host_str() != Some("health")
        || url.path() != "/oauth/callback"
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(callback_error());
    }
    callback_params(url)
}

fn callback_params(url: &url::Url) -> Result<(String, String), HealthProviderError> {
    let mut code = None;
    let mut state = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" if code.is_none() && !value.is_empty() && value.len() <= 4096 => {
                code = Some(value.into_owned())
            }
            "state" if state.is_none() && value.len() == 43 => state = Some(value.into_owned()),
            "code" | "state" | "error" => return Err(callback_error()),
            _ => {}
        }
    }
    code.zip(state).ok_or_else(callback_error)
}

fn callback_error() -> HealthProviderError {
    HealthProviderError::new("invalid_callback", "Invalid authorization callback.", false)
}

pub(crate) async fn broker_request(
    base_url: &str,
    provider_id: Option<HealthProviderId>,
    action: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, HealthProviderError> {
    let base = url::Url::parse(base_url).map_err(|_| invalid_broker())?;
    if base.scheme() != "https"
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
        || crate::security::validate_url_not_private(base_url).is_err()
    {
        return Err(invalid_broker());
    }
    let base = base_url.trim_end_matches('/');
    let path = match provider_id {
        Some(provider) => format!("{}/{action}", provider.as_str()),
        None => action.to_owned(),
    };
    let url = format!("{base}/v1/health-oauth/{path}");
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| invalid_broker())?;
    broker_response(&client, &url, body).await
}

async fn broker_response(
    client: &reqwest::Client,
    url: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, HealthProviderError> {
    let request = match body {
        Some(payload) => client.post(url).json(&payload),
        None => client.get(url),
    };
    let response = request.send().await.map_err(|_| {
        HealthProviderError::new(
            "broker_unreachable",
            "The wearable authorization broker is unreachable.",
            true,
        )
    })?;
    let status = response.status();
    if !status.is_success() {
        let code = match status.as_u16() {
            401 => "permission_revoked",
            403 => "provider_not_approved",
            429 => "rate_limited",
            _ => "broker_request_failed",
        };
        return Err(HealthProviderError::new(
            code,
            format!("Wearable broker returned HTTP {status}."),
            status.is_server_error() || status.as_u16() == 429,
        ));
    }
    response.json().await.map_err(|_| {
        HealthProviderError::new("parse_error", "The broker returned invalid JSON.", true)
    })
}

fn invalid_broker() -> HealthProviderError {
    HealthProviderError::new(
        "invalid_config",
        "Configure a public HTTPS wearable authorization broker.",
        false,
    )
}

pub(crate) fn decode_token(
    body: serde_json::Value,
) -> Result<HealthOAuthToken, HealthProviderError> {
    let access_token = body
        .get("accessToken")
        .and_then(|v| v.as_str())
        .ok_or_else(|| HealthProviderError::new("parse_error", "Missing accessToken", false))?
        .to_string();
    let expires_in = body.get("expiresIn").and_then(|v| v.as_i64());
    let expires_at_ms = expires_in.and_then(|secs| {
        chrono::Utc::now()
            .timestamp_millis()
            .checked_add(secs.checked_mul(1000)?)
    });
    Ok(HealthOAuthToken {
        access_token,
        refresh_token: body
            .get("refreshToken")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        expires_at_ms,
        token_type: body
            .get("tokenType")
            .and_then(|v| v.as_str())
            .unwrap_or("Bearer")
            .to_string(),
        scope: body
            .get("scope")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        account_subject_hint: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mobile_callback_requires_exact_route_and_single_state() {
        let state = "a".repeat(43);
        let good = format!("plethora://health/oauth/callback?code=test-code&state={state}");
        assert_eq!(
            mobile_callback(&url::Url::parse(&good).unwrap()).unwrap(),
            ("test-code".into(), state)
        );
        assert!(
            mobile_callback(&url::Url::parse(&format!("{good}&state=another")).unwrap()).is_err()
        );
        assert!(mobile_callback(
            &url::Url::parse(&good.replace("/oauth/callback", "/elsewhere")).unwrap()
        )
        .is_err());
    }

    #[tokio::test]
    async fn broker_refresh_decodes_rotation_and_redacts_revoked_response() {
        use axum::{http::StatusCode, routing::post, Json, Router};
        let app = Router::new()
            .route("/refresh", post(|Json(value): Json<serde_json::Value>| async move {
                assert_eq!(value["refreshToken"], "fake_refresh");
                Json(serde_json::json!({"accessToken": "new", "refreshToken": "rotated", "expiresIn": 3600}))
            }))
            .route("/revoked", post(|| async { (StatusCode::UNAUTHORIZED, "provider private response") }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = reqwest::Client::new();
        let body = Some(serde_json::json!({"refreshToken": "fake_refresh"}));
        let token = decode_token(
            broker_response(&client, &format!("{base}/refresh"), body.clone())
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(token.refresh_token.as_deref(), Some("rotated"));
        let error = broker_response(&client, &format!("{base}/revoked"), body)
            .await
            .unwrap_err();
        assert_eq!(error.code, "permission_revoked");
        assert!(!error.message.contains("private response"));
    }

    #[test]
    fn rejects_replay_expired_and_mismatched_oauth_state() {
        let mgr = HealthOAuthManager::new();
        let start = mgr
            .create_pending_session(
                HealthProviderId::Oura,
                "https://cloud.ouraring.com/oauth/authorize",
                "client-123",
                &["daily"],
                vec![HealthDataCategory::Sleep],
                "http://127.0.0.1:4444/callback".into(),
                Some(4444),
            )
            .unwrap();

        assert!(start.authorize_url.contains("code_challenge_method=S256"));
        // Mismatched provider rejected and consumes or leaves? Look up removed -> check wrong provider error
        let err = mgr
            .consume_pending_session(
                HealthProviderId::Whoop,
                &start.state,
                chrono::Utc::now().timestamp_millis(),
            )
            .unwrap_err();
        assert_eq!(err.code, "oauth_provider_mismatch");

        // Second attempt fails as replayed/missing
        let err2 = mgr
            .consume_pending_session(
                HealthProviderId::Oura,
                &start.state,
                chrono::Utc::now().timestamp_millis(),
            )
            .unwrap_err();
        assert_eq!(err2.code, "oauth_state_invalid");

        // Expired state rejected
        let start2 = mgr
            .create_pending_session(
                HealthProviderId::Oura,
                "https://cloud.ouraring.com/oauth/authorize",
                "client-123",
                &["daily"],
                vec![HealthDataCategory::Sleep],
                "http://127.0.0.1:4444/callback".into(),
                Some(4444),
            )
            .unwrap();
        let expired_err = mgr
            .consume_pending_session(
                HealthProviderId::Oura,
                &start2.state,
                chrono::Utc::now().timestamp_millis() + STATE_TTL_MS + 1000,
            )
            .unwrap_err();
        assert_eq!(expired_err.code, "oauth_state_expired");
    }
}
