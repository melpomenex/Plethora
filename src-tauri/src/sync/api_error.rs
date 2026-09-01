use serde::Deserialize;

use crate::error::PlethoraError;

#[derive(Debug, Clone, Deserialize)]
struct ApiErrorEnvelope {
    error: Option<ApiErrorDetail>,
}

#[derive(Debug, Clone, Deserialize)]
struct ApiErrorDetail {
    code: Option<String>,
}

pub fn api_error_code(body: &str) -> Option<String> {
    serde_json::from_str::<ApiErrorEnvelope>(body)
        .ok()
        .and_then(|envelope| envelope.error)
        .and_then(|error| error.code)
}

const SYNC_AUTH_ERROR_CODES: &[&str] = &[
    "capability_denied",
    "device_identity_required",
    "device_identity_mismatch",
    "device_revoked",
    "device_limit_reached",
    "session_revoked",
    "token_expired",
    "invalid_refresh_token",
];

pub fn map_http_error(status: reqwest::StatusCode, body: &str, context: &str) -> PlethoraError {
    let code = api_error_code(body);
    if status == reqwest::StatusCode::UNAUTHORIZED && code.as_deref() == Some("token_expired") {
        return PlethoraError::IntegrationAuthError("token_expired".to_string());
    }
    if let Some(ref error_code) = code {
        if SYNC_AUTH_ERROR_CODES.contains(&error_code.as_str()) {
            return PlethoraError::IntegrationAuthError(error_code.clone());
        }
    }
    PlethoraError::Internal(format!("{context} ({status}): {body}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_token_expired_to_integration_auth_error() {
        let body = r#"{"error":{"code":"token_expired","message":"Access token has expired","retryable":true}}"#;
        let err = map_http_error(reqwest::StatusCode::UNAUTHORIZED, body, "Sync pull failed");
        assert!(matches!(
            err,
            PlethoraError::IntegrationAuthError(code) if code == "token_expired"
        ));
    }

    #[test]
    fn maps_capability_denied_distinctly() {
        let body = r#"{"error":{"code":"capability_denied","message":"Pro required"}}"#;
        let err = map_http_error(reqwest::StatusCode::FORBIDDEN, body, "Sync push failed");
        assert!(matches!(
            err,
            PlethoraError::IntegrationAuthError(code) if code == "capability_denied"
        ));
    }

    #[test]
    fn maps_device_identity_required_distinctly() {
        let body = r#"{"error":{"code":"device_identity_required","message":"Device required"}}"#;
        let err = map_http_error(reqwest::StatusCode::FORBIDDEN, body, "Sync push failed");
        assert!(matches!(
            err,
            PlethoraError::IntegrationAuthError(code) if code == "device_identity_required"
        ));
    }

    #[test]
    fn keeps_unknown_failures_as_internal_errors() {
        let body = r#"{"error":{"code":"forbidden","message":"Nope"}}"#;
        let err = map_http_error(reqwest::StatusCode::FORBIDDEN, body, "Sync pull failed");
        assert!(matches!(err, PlethoraError::Internal(_)));
    }
}
