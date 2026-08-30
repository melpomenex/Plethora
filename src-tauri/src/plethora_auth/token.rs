use base64::Engine;

/// Decode a JWT's `exp` (seconds since epoch) without verification — an expiry
/// hint only; authentication stays server-side. Malformed tokens are treated
/// as expiring so the caller refreshes.
pub fn access_token_exp(token: &str) -> Option<i64> {
    let payload = token.split('.').nth(1)?;
    let padded = match payload.len() % 4 {
        0 => payload.to_string(),
        n => format!("{}{}", payload, "=".repeat(4 - n)),
    };
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(padded.as_bytes())
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(padded.as_bytes()))
        .ok()?;
    let json: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    json.get("exp").and_then(|value| value.as_i64())
}

/// True when the access token is missing, undecodable, or expiring within
/// `within_secs` (default 60s).
pub fn access_token_expiring(token: &str, within_secs: u64) -> bool {
    let Some(exp) = access_token_exp(token) else {
        return true;
    };
    let now = chrono::Utc::now().timestamp();
    exp - now <= within_secs as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jwt_with_exp(exp: i64) -> String {
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(format!(r#"{{"exp":{exp}}}"#));
        format!("{header}.{payload}.sig")
    }

    #[test]
    fn decodes_exp_from_jwt_payload() {
        let exp = chrono::Utc::now().timestamp() + 600;
        let token = jwt_with_exp(exp);
        assert_eq!(access_token_exp(&token), Some(exp));
        assert!(!access_token_expiring(&token, 60));
    }

    #[test]
    fn treats_malformed_tokens_as_expiring() {
        assert!(access_token_expiring("not-a-jwt", 60));
        assert!(access_token_expiring("", 60));
    }

    #[test]
    fn flags_tokens_near_expiry() {
        let exp = chrono::Utc::now().timestamp() + 30;
        let token = jwt_with_exp(exp);
        assert!(access_token_expiring(&token, 60));
    }
}
