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

pub fn map_http_error(status: reqwest::StatusCode, body: &str, context: &str) -> PlethoraError {
    if status == reqwest::StatusCode::UNAUTHORIZED
        && api_error_code(body).as_deref() == Some("token_expired")
    {
        return PlethoraError::IntegrationAuthError("token_expired".to_string());
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
    fn keeps_other_failures_as_internal_errors() {
        let body = r#"{"error":{"code":"forbidden","message":"Nope"}}"#;
        let err = map_http_error(reqwest::StatusCode::FORBIDDEN, body, "Sync pull failed");
        assert!(matches!(err, PlethoraError::Internal(_)));
    }
}
