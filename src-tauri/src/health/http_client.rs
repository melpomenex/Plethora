//! Rate-limit-aware HTTP client with Retry-After backoff, jitter, and structured provider errors.

use rand::Rng;
use reqwest::StatusCode;
use std::collections::HashSet;
use std::time::Duration;

use super::models::HealthProviderError;

#[derive(Clone)]
pub struct HealthHttpClient {
    client: Option<reqwest::Client>,
    max_retries: usize,
    base_backoff_ms: u64,
    allow_localhost_for_tests: bool,
}

impl Default for HealthHttpClient {
    fn default() -> Self {
        Self::new(false)
    }
}

impl HealthHttpClient {
    pub fn new(allow_localhost_for_tests: bool) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .ok();
        Self {
            client,
            max_retries: 3,
            base_backoff_ms: 250,
            allow_localhost_for_tests,
        }
    }

    pub fn validate_target_url(&self, url: &str) -> Result<(), HealthProviderError> {
        if self.allow_localhost_for_tests {
            return Ok(());
        }
        if !url::Url::parse(url).is_ok_and(|url| {
            url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
        }) {
            return Err(HealthProviderError::new(
                "invalid_config",
                "Provider requests require HTTPS.",
                false,
            ));
        }
        crate::security::validate_url_not_private(url)
            .map_err(|msg| HealthProviderError::new("ssrf_blocked", msg, false))
    }

    pub async fn get_json(
        &self,
        url: &str,
        bearer_token: &str,
        query: &[(&str, &str)],
    ) -> Result<serde_json::Value, HealthProviderError> {
        self.validate_target_url(url)?;

        let client = self.client.as_ref().ok_or_else(|| {
            HealthProviderError::new(
                "invalid_config",
                "Could not initialize the provider HTTP client.",
                false,
            )
        })?;
        let mut attempt = 0usize;
        loop {
            let mut req = client.get(url).bearer_auth(bearer_token);
            if !query.is_empty() {
                req = req.query(query);
            }

            match req.send().await {
                Ok(mut resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        let mut payload = Vec::new();
                        while let Some(chunk) = resp.chunk().await.map_err(|_| json_error())? {
                            if payload.len() + chunk.len() > 8 * 1024 * 1024 {
                                return Err(HealthProviderError::new(
                                    "response_too_large",
                                    "Provider responses are limited to 8 MB per page.",
                                    false,
                                ));
                            }
                            payload.extend_from_slice(&chunk);
                        }
                        return serde_json::from_slice(&payload).map_err(|_| json_error());
                    }

                    if status == StatusCode::UNAUTHORIZED {
                        return Err(HealthProviderError::new(
                            "permission_revoked",
                            "Provider rejected authorization token (401)",
                            false,
                        ));
                    }

                    if status == StatusCode::FORBIDDEN {
                        let mut details = Vec::new();
                        while let Ok(Some(chunk)) = resp.chunk().await {
                            if details.len() + chunk.len() > 64 * 1024 {
                                break;
                            }
                            details.extend_from_slice(&chunk);
                        }
                        let body_text = String::from_utf8_lossy(&details);
                        if body_text.contains("MISSING_OAUTH_SCOPE") {
                            return Err(HealthProviderError::new(
                                "missing_scope",
                                "Provider reported missing OAuth scope for requested category",
                                false,
                            ));
                        }
                        return Err(HealthProviderError::new(
                            "forbidden",
                            "Provider refused access (403); verify active membership or scopes",
                            false,
                        ));
                    }

                    if status == StatusCode::TOO_MANY_REQUESTS {
                        let retry_after = resp
                            .headers()
                            .get("retry-after")
                            .and_then(|v| v.to_str().ok())
                            .and_then(retry_after_seconds);
                        if attempt >= self.max_retries
                            || retry_after.is_some_and(|seconds| seconds > 15)
                        {
                            return Err(HealthProviderError::rate_limited(retry_after));
                        }
                        let delay_ms = retry_after
                            .map(|s| s * 1000 + rand::thread_rng().gen_range(0..=150))
                            .unwrap_or_else(|| self.backoff_with_jitter_ms(attempt));
                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                        attempt += 1;
                        continue;
                    }

                    if status.is_server_error() && attempt < self.max_retries {
                        let delay_ms = self.backoff_with_jitter_ms(attempt);
                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                        attempt += 1;
                        continue;
                    }

                    return Err(HealthProviderError::new(
                        "provider_http_error",
                        format!("Provider returned HTTP {}", status.as_u16()),
                        status.is_server_error(),
                    ));
                }
                Err(_) => {
                    if attempt < self.max_retries {
                        let delay_ms = self.backoff_with_jitter_ms(attempt);
                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                        attempt += 1;
                        continue;
                    }
                    return Err(HealthProviderError::new(
                        "network_unavailable",
                        "Could not reach the wearable provider.",
                        true,
                    ));
                }
            }
        }
    }

    pub(crate) async fn get_pages<T>(
        &self,
        url: &str,
        token: &str,
        query: &[(&str, &str)],
        cursor_parameter: &str,
        decode: impl Fn(serde_json::Value) -> Result<(Vec<T>, Option<String>), HealthProviderError>,
    ) -> Result<Vec<T>, HealthProviderError> {
        let mut rows = Vec::new();
        let mut cursor: Option<String> = None;
        let mut seen = HashSet::new();
        for _ in 0..100 {
            let mut arguments = query.to_vec();
            if let Some(value) = &cursor {
                arguments.push((cursor_parameter, value.as_str()));
            }
            let (items, next) = decode(self.get_json(url, token, &arguments).await?)?;
            if rows.len() + items.len() > 150_000 {
                return Err(HealthProviderError::new(
                    "response_too_large",
                    "Narrow the provider date range.",
                    true,
                ));
            }
            rows.extend(items);
            let Some(next) = next.filter(|value| !value.is_empty()) else {
                return Ok(rows);
            };
            if !seen.insert(next.clone()) {
                return Err(HealthProviderError::new(
                    "pagination_loop",
                    "The provider repeated a page cursor.",
                    true,
                ));
            }
            cursor = Some(next);
        }
        Err(HealthProviderError::new(
            "pagination_limit",
            "The provider returned too many pages.",
            true,
        ))
    }

    fn backoff_with_jitter_ms(&self, attempt: usize) -> u64 {
        let exp = self.base_backoff_ms.saturating_mul(1_u64 << attempt.min(5));
        let jitter: u64 = rand::thread_rng().gen_range(0..=150);
        (exp + jitter).min(10_000)
    }
}

fn json_error() -> HealthProviderError {
    HealthProviderError::new("parse_error", "The provider returned invalid JSON.", false)
}

fn retry_after_seconds(value: &str) -> Option<u64> {
    value.trim().parse().ok().or_else(|| {
        let date = chrono::DateTime::parse_from_rfc2822(value).ok()?;
        let duration = date.signed_duration_since(chrono::Utc::now());
        Some((duration.num_milliseconds().max(0) as u64).div_ceil(1000))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::StatusCode, routing::get, Json, Router};

    #[tokio::test]
    async fn rejects_unauthorized_malformed_and_repeated_page_cursors() {
        let app = Router::new()
            .route("/revoked", get(|| async { StatusCode::UNAUTHORIZED }))
            .route("/broken", get(|| async { "{" }))
            .route(
                "/repeat",
                get(|| async { Json(serde_json::json!({"next": "repeated"})) }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let client = HealthHttpClient::new(true);
        assert_eq!(
            client
                .get_json(&format!("{base}/revoked"), "fake", &[])
                .await
                .unwrap_err()
                .code,
            "permission_revoked"
        );
        assert_eq!(
            client
                .get_json(&format!("{base}/broken"), "fake", &[])
                .await
                .unwrap_err()
                .code,
            "parse_error"
        );
        let error = client
            .get_pages::<()>(&format!("{base}/repeat"), "fake", &[], "cursor", |page| {
                Ok((
                    Vec::new(),
                    page.get("next")
                        .and_then(|value| value.as_str())
                        .map(str::to_owned),
                ))
            })
            .await
            .unwrap_err();
        assert_eq!(error.code, "pagination_loop");
        assert_eq!(retry_after_seconds("60"), Some(60));
    }
}
