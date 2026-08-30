use std::future::Future;

use crate::error::{PlethoraError, Result};
use crate::plethora_auth::AuthManager;

/// Present a bearer token for cloud calls: refresh proactively when the JWT is
/// near expiry, and on `401 token_expired` rotate once and retry exactly once.
pub async fn with_bearer_retry<T, F, Fut>(auth: &AuthManager, op: F) -> Result<T>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<T>>,
{
    let token = auth
        .ensure_fresh_access_token()
        .await
        .map_err(|e| PlethoraError::Internal(e.to_string()))?;
    match op(token).await {
        Ok(value) => Ok(value),
        Err(PlethoraError::IntegrationAuthError(code)) if code == "token_expired" => {
            auth.force_refresh_tokens()
                .await
                .map_err(|e| {
                    auth.handle_refresh_failure(e.clone());
                    PlethoraError::Internal(e.to_string())
                })?;
            let rotated = auth
                .get_access_token()
                .ok_or_else(|| PlethoraError::Internal("No access token after refresh".into()))?;
            op(rotated).await
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use crate::plethora_auth::{AccountTokens, AuthManager, UserProfile};

    #[tokio::test]
    async fn passes_owned_bearer_to_operation() {
        let auth = AuthManager::new();
        let exp = chrono::Utc::now().timestamp() + 600;
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(format!(r#"{{"exp":{exp}}}"#));
        let fresh = format!("{header}.{payload}.sig");

        auth.set_signed_in(
            UserProfile {
                id: "u-1".to_string(),
                email: "user@example.com".to_string(),
                subscription_tier: "pro".to_string(),
            },
            AccountTokens {
                access_token: fresh,
                refresh_token: "refresh-1".to_string(),
                expires_in: 900,
            },
            Some("dev-1".to_string()),
        );

        let result = with_bearer_retry(&auth, |token| async move { Ok(token) })
            .await
            .unwrap();
        assert!(result.contains('.'));
    }
}
