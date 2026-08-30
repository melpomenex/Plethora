use serde::Deserialize;

use super::token::access_token_expiring;
use super::AccountTokens;
use crate::sync::transport::api_base_url;

const AUTH_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Deserialize)]
struct ApiErrorEnvelope {
    error: Option<ApiErrorDetail>,
}

#[derive(Debug, Clone, Deserialize)]
struct ApiErrorDetail {
    code: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshTokensResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RefreshError {
    NoRefreshToken,
    SessionRevoked,
    TokenExpired,
    Network(String),
    InvalidResponse(String),
}

impl std::fmt::Display for RefreshError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoRefreshToken => write!(f, "No refresh token available"),
            Self::SessionRevoked => write!(f, "Session revoked"),
            Self::TokenExpired => write!(f, "Refresh token expired"),
            Self::Network(message) => write!(f, "{message}"),
            Self::InvalidResponse(message) => write!(f, "{message}"),
        }
    }
}

fn api_error_code(body: &str) -> Option<String> {
    serde_json::from_str::<ApiErrorEnvelope>(body)
        .ok()
        .and_then(|envelope| envelope.error)
        .and_then(|error| error.code)
}

pub async fn refresh_access_token(refresh_token: &str) -> Result<RefreshTokensResponse, RefreshError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(AUTH_TIMEOUT_SECS))
        .build()
        .map_err(|e| RefreshError::Network(format!("Auth client build failed: {e}")))?;

    let url = format!("{}/v1/auth/token/refresh", api_base_url());
    let response = client
        .post(url)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "refreshToken": refresh_token }))
        .send()
        .await
        .map_err(|e| RefreshError::Network(format!("Could not reach Plethora cloud: {e}")))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| RefreshError::Network(format!("Auth response read failed: {e}")))?;

    if !status.is_success() {
        return Err(match api_error_code(&body).as_deref() {
            Some("session_revoked") | Some("invalid_refresh_token") => RefreshError::SessionRevoked,
            Some("token_expired") => RefreshError::TokenExpired,
            _ => RefreshError::InvalidResponse(format!("Token refresh failed ({status}): {body}")),
        });
    }

    serde_json::from_str(&body)
        .map_err(|e| RefreshError::InvalidResponse(format!("Auth response parse failed: {e}")))
}

pub fn tokens_from_refresh(response: RefreshTokensResponse) -> AccountTokens {
    AccountTokens {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_in: response.expires_in,
    }
}

pub fn should_refresh_access_token(access_token: &str) -> bool {
    access_token_expiring(access_token, 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn serve_one(response: &'static [u8]) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);
            stream.write_all(response).unwrap();
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn refresh_rotates_tokens_on_success() {
        let body = r#"{"accessToken":"access-2","refreshToken":"refresh-2","expiresIn":900}"#;
        let response: &'static [u8] = Box::leak(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .into_boxed_str()
            .into_boxed_bytes(),
        );
        let base = serve_one(response);
        std::env::set_var("PLETHORA_API_URL", base);

        let rotated = refresh_access_token("refresh-1").await.unwrap();
        assert_eq!(rotated.access_token, "access-2");
        assert_eq!(rotated.refresh_token, "refresh-2");
        assert_eq!(rotated.expires_in, 900);
    }

    #[tokio::test]
    async fn refresh_maps_session_revoked_to_typed_error() {
        let body = r#"{"error":{"code":"session_revoked","message":"Session reuse detected."}}"#;
        let response: &'static [u8] = Box::leak(
            format!(
                "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .into_boxed_str()
            .into_boxed_bytes(),
        );
        let base = serve_one(response);
        std::env::set_var("PLETHORA_API_URL", base);

        let err = refresh_access_token("refresh-1").await.unwrap_err();
        assert_eq!(err, RefreshError::SessionRevoked);
    }
}
