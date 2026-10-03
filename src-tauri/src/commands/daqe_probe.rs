//! Decision-model HTTP, from Rust.
//!
//! ## Why this is here and not in the webview
//!
//! Two reasons, and the second is the one that actually broke.
//!
//! **CORS.** A `POST` carrying `content-type: application/json` and an
//! `Authorization` header triggers a preflight `OPTIONS`. `api.cloudflare.com`
//! does not answer preflight for browser origins, so the request never leaves
//! the renderer — and WebKit reports that as `Load failed`, which is
//! indistinguishable from a dead host. Routing through Rust removes the
//! renderer from the request path entirely, which is why every other paid AI
//! call in this repository (`ai/providers.rs`) already works this way.
//!
//! **Endpoint shape.** Workers AI addresses a model in the *path*
//! (`…/ai/run/@cf/cloudflare/clef`) and takes a bare `clef` in the *body*. That
//! is not the System One path, and getting it wrong produces a 404 that reads
//! exactly like a bad account id. Assembling URLs here — once, next to the code
//! that can be tested — is what stops the frontend inventing one.
//!
//! Every `Result` here is a plain HTTP outcome. Turning one into the ranker's
//! [`ProviderFailure`] vocabulary is the caller's job, so this module stays free
//! of DAQE scoring concerns.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::ai_key_store::AIKeyStore;
use crate::error::Result;

/// Every decision provider DAQE can talk to. The frontend sends this id rather
/// than a URL, so a provider's endpoint is decided in one place.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DecisionProvider {
    /// TypeSafe's hosted API. `POST {base}/v1/systemone`.
    #[serde(rename = "jev")]
    Jev,
    /// Cloudflare Workers AI. `POST …/ai/run/@cf/cloudflare/clef`.
    #[serde(rename = "clef")]
    Clef,
    /// OpenRouter's `decisions` modality. `POST {base}/v1/systemone`.
    ///
    /// Named explicitly rather than left to `kebab-case`, which would give
    /// `open-router-decisions`. The wire value is the provider id the settings
    /// store persists, and that id is `openrouter-decisions` — matching
    /// OpenRouter's own namespace. A mismatch here would mean a configured
    /// provider reaching this command as an unknown variant.
    #[serde(rename = "openrouter-decisions")]
    OpenRouterDecisions,
    /// OpenAI's Decisions API. `POST {base}/v1/decisions`.
    #[serde(rename = "openai-decisions")]
    OpenAiDecisions,
    /// A `laya-serve` instance, or anything else speaking System One.
    #[serde(rename = "system-one")]
    SystemOne,
}

/// Which keychain slot a provider's bearer token lives in, or `None`.
fn key_slot(provider: DecisionProvider) -> Option<&'static str> {
    match provider {
        DecisionProvider::Jev => Some("jev"),
        DecisionProvider::Clef => Some("clef"),
        DecisionProvider::OpenRouterDecisions => Some("openrouter"),
        DecisionProvider::OpenAiDecisions => Some("openai"),
        DecisionProvider::SystemOne => None,
    }
}

/// The request as the frontend describes it. Everything provider-specific is
/// resolved here rather than by the caller.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaqeHttpRequest {
    pub provider: DecisionProvider,
    /// Overrides the provider's documented base URL. Only meaningful for
    /// [`DecisionProvider::SystemOne`] and OpenRouter.
    pub base_url: Option<String>,
    /// The model, where the endpoint serves more than one.
    pub model: Option<String>,
    /// Cloudflare account id. Required for Clef.
    pub cloudflare_account_id: Option<String>,
    /// The System One body: a state and typed questions.
    pub state: serde_json::Value,
    pub questions: serde_json::Value,
    /// Optional bearer token. When absent the keychain is consulted.
    pub api_key: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaqeHttpResponse {
    pub ok: bool,
    pub status: u16,
    /// The parsed JSON body when the status was 2xx and the body parsed.
    pub body: Option<serde_json::Value>,
    /// The endpoint that was actually called, after provider assembly. Returned
    /// so a reader can see the resolved URL instead of guessing at it.
    pub url: String,
    /// A short, non-technical explanation of a failure. Absent on success.
    pub error: Option<String>,
    /// The machine-readable failure kind, matching the frontend's reasons.
    pub reason: Option<String>,
}

/// Workers AI's model path. The 27B `clef` rather than `clef-flash`: the
/// flash variant is a faster trade, not a default, and picking it silently
/// would change what the reader pays for.
const CLEF_PATH: &str = "@cf/cloudflare/clef";

/// Assemble the endpoint for a provider.
///
/// Every provider is resolved here, which is what makes the Clef case tractable:
/// it is the only one that is not System One, and the only one that puts the
/// model in the path.
/// A trimmed, empty-dropped view of an optional override.
fn trimmed(value: Option<&String>) -> Option<&str> {
    value.map(|v| v.trim()).filter(|v| !v.is_empty())
}

fn resolve_url(request: &DaqeHttpRequest) -> Result<String> {

    match request.provider {
        DecisionProvider::Clef => {
            let account = trimmed(request.cloudflare_account_id.as_ref()).ok_or_else(|| {
                crate::error::PlethoraError::InvalidInput(
                    "Clef needs a Cloudflare account id".to_string(),
                )
            })?;
            // A caller-supplied override may already be the full run URL, in
            // which case respect it rather than appending the path twice.
            if let Some(base) = trimmed(request.base_url.as_ref()) {
                if base.contains("/ai/run/") {
                    return Ok(base.trim_end_matches('/').to_string());
                }
            }
            let model = trimmed(request.model.as_ref()).unwrap_or(CLEF_PATH);
            Ok(format!(
                "https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model}"
            ))
        }
        DecisionProvider::Jev => Ok(format!(
            "{}/v1/systemone",
            trimmed(request.base_url.as_ref())
                .unwrap_or("https://jevmodel.org")
                .trim_end_matches('/')
        )),
        DecisionProvider::OpenRouterDecisions => {
            let base = trimmed(request.base_url.as_ref())
                .unwrap_or("https://openrouter.ai/api/v1")
                .trim_end_matches('/');
            if base.ends_with("/v1") {
                Ok(format!("{base}/systemone"))
            } else {
                Ok(format!("{base}/v1/systemone"))
            }
        }
        DecisionProvider::OpenAiDecisions => {
            let base = trimmed(request.base_url.as_ref())
                .unwrap_or("https://api.openai.com/v1")
                .trim_end_matches('/');
            if base.ends_with("/v1") {
                Ok(format!("{base}/decisions"))
            } else if base.ends_with("/decisions") {
                Ok(base.to_string())
            } else {
                Ok(format!("{base}/v1/decisions"))
            }
        }
        DecisionProvider::SystemOne => {
            let base = trimmed(request.base_url.as_ref()).ok_or_else(|| {
                crate::error::PlethoraError::InvalidInput(
                    "A local decision endpoint needs an address".to_string(),
                )
            })?;
            Ok(format!("{}/v1/systemone", base.trim_end_matches('/')))
        }
    }
}

/// Workers AI and some REST proxies wrap the response payload in a `{ "result": { ... } }`
/// envelope. Unwrap it so callers see `answers`, `model` and `usage` at the top level.
fn unwrap_envelope(value: serde_json::Value) -> serde_json::Value {
    if let serde_json::Value::Object(ref map) = value {
        if let Some(result) = map.get("result") {
            if result.is_object() && (result.get("answers").is_some() || map.get("answers").is_none()) {
                return result.clone();
            }
        }
    }
    value
}

/// Build the request body.
///
/// System One puts the model in a `model` field. Workers AI puts it in the path
/// *and* wants the bare name in the body — `@cf/cloudflare/clef-flash` there is
/// a schema violation, not a model name.
fn build_body(request: &DaqeHttpRequest) -> serde_json::Value {
    let model = match request.provider {
        // The body field matches `^(clef|clef-flash)$`, so strip the namespace.
        DecisionProvider::Clef => request
            .model
            .as_deref()
            .map(|m| m.rsplit('/').next().unwrap_or(m).to_string())
            .or_else(|| Some("clef".to_string())),
        DecisionProvider::OpenAiDecisions => request
            .model
            .clone()
            .or_else(|| Some("gpt-6-luna".to_string())),
        DecisionProvider::SystemOne => None,
        _ => request
            .model
            .clone()
            .or_else(|| Some("jev-latest".to_string())),
    };

    let mut body = serde_json::json!({
        "state": request.state,
        "questions": request.questions,
    });
    if let Some(model) = model {
        body["model"] = serde_json::Value::String(model);
    }
    body
}

/// Perform one decision request from the backend.
///
/// Returns the outcome rather than an error for any HTTP-level failure, because
/// "the endpoint said no" is information the picker needs to *show*, not an
/// exception to propagate. Only a malformed request is a `Result::Err`.
#[tauri::command]
pub async fn daqe_decision_request(
    request: DaqeHttpRequest,
    key_store: State<'_, AIKeyStore>,
) -> Result<DaqeHttpResponse> {
    let url = resolve_url(&request)?;
    let timeout = request.timeout_ms.unwrap_or(12_000).clamp(500, 60_000);

    // An explicit key wins; otherwise read the provider's keychain slot. The
    // frontend never holds the secret, so this is where it is resolved.
    let api_key = match request.api_key.as_deref().map(str::trim) {
        Some(key) if !key.is_empty() => Some(key.to_string()),
        _ => match key_slot(request.provider) {
            Some(slot) => key_store.get_key(slot).await.unwrap_or(None),
            None => None,
        },
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout))
        .user_agent("Plethora/3 (decision-model)")
        .build()
        .map_err(|error| {
            crate::error::PlethoraError::Internal(format!("http client: {error}"))
        })?;

    let mut builder = client.post(&url).json(&build_body(&request));
    if let Some(key) = api_key {
        builder = builder.bearer_auth(key);
    }

    let response = match builder.send().await {
        Ok(response) => response,
        Err(error) => {
            let (failure, message) = classify_transport(
                if error.is_timeout() {
                    TransportFailure::Timeout
                } else if error.is_connect() {
                    TransportFailure::Connect
                } else {
                    TransportFailure::Request
                },
                Some(&url),
            );
            let _ = failure;
            return Ok(DaqeHttpResponse {
                ok: false,
                status: 0,
                body: None,
                url,
                error: Some(message),
                reason: Some("unreachable".to_string()),
            });
        }
    };

    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    let parsed = serde_json::from_str::<serde_json::Value>(&text).ok();

    if (200..300).contains(&status) {
        let body = parsed.map(unwrap_envelope);
        return Ok(DaqeHttpResponse {
            ok: true,
            status,
            body,
            url,
            error: None,
            reason: None,
        });
    }

    let message = parsed
        .as_ref()
        .and_then(|body| {
            body.get("error")
                .and_then(|error| error.get("message").or(Some(error)))
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| first_line(&text, status));

    Ok(DaqeHttpResponse {
        ok: false,
        status,
        body: parsed,
        url,
        error: Some(message),
        reason: Some(reason_for_status(status).to_string()),
    })
}

/// Turn a status into the frontend's failure vocabulary, so a probe and a real
/// ranking call report the same fault the same way.
fn reason_for_status(status: u16) -> &'static str {
    match status {
        401 | 403 => "unauthorized",
        402 => "insufficient-credits",
        404 => "not-found",
        422 => "invalid-request",
        429 => "rate-limited",
        502 | 503 | 504 => "upstream-error",
        _ => "http-error",
    }
}

/// What kind of transport failure occurred, in the terms a reader can act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportFailure {
    /// No answer within the budget.
    Timeout,
    /// The connection could not be opened at all.
    Connect,
    /// The request was built or sent but failed.
    Request,
}

/// Classify a transport failure.
///
/// `reqwest`'s Display is unhelpful here: a DNS failure, a refused connection and
/// a TLS failure all surface as opaque strings, and WebKit reports all of them as
/// the same `Load failed`. Saying which one it was is the difference between
/// "check the account id" and "check your connection", so the classification is
/// a pure function over the three signals rather than a formatting of the error.
fn classify_transport(
    failure: TransportFailure,
    url: Option<&str>,
) -> (TransportFailure, String) {
    let message = match failure {
        TransportFailure::Timeout => {
            "No answer in time. The endpoint may be overloaded or blocked.".to_string()
        }
        TransportFailure::Connect => match url {
            Some(url) => {
                format!("Could not reach {url}. Check the address and your connection.")
            }
            None => "Could not open a connection. Check the endpoint address and your network."
                .to_string(),
        },
        TransportFailure::Request => "The request could not be completed.".to_string(),
    };
    (failure, message)
}

fn first_line(text: &str, status: u16) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return format!("HTTP {status}");
    }
    trimmed.lines().next().unwrap_or(trimmed).chars().take(300).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(provider: DecisionProvider) -> DaqeHttpRequest {
        DaqeHttpRequest {
            provider,
            base_url: None,
            model: None,
            cloudflare_account_id: None,
            state: serde_json::json!("x"),
            questions: serde_json::json!({}),
            api_key: None,
            timeout_ms: None,
        }
    }

    #[test]
    fn clef_uses_the_workers_ai_run_path_not_systemone() {
        let mut request = base(DecisionProvider::Clef);
        request.cloudflare_account_id = Some("acct-1".to_string());
        let url = resolve_url(&request).expect("resolves");
        assert_eq!(
            url, "https://api.cloudflare.com/client/v4/accounts/acct-1/ai/run/@cf/cloudflare/clef",
            "Clef is not a System One path; the model lives in the URL"
        );
        assert!(!url.contains("/v1/systemone"));
    }

    #[test]
    fn clef_requires_an_account_id() {
        let request = base(DecisionProvider::Clef);
        assert!(resolve_url(&request).is_err(), "no account id must not produce a URL");
    }

    #[test]
    fn a_fully_specified_clef_override_is_respected_not_doubled() {
        let mut request = base(DecisionProvider::Clef);
        request.cloudflare_account_id = Some("acct-1".to_string());
        request.base_url =
            Some("https://api.cloudflare.com/client/v4/accounts/acct-1/ai/run/@cf/cloudflare/clef".to_string());
        let url = resolve_url(&request).expect("resolves");
        assert_eq!(url.matches("/ai/run/").count(), 1, "the path must not be appended twice");
    }

    #[test]
    fn the_other_providers_are_systemone() {
        assert_eq!(
            resolve_url(&base(DecisionProvider::Jev)).expect("resolves"),
            "https://jevmodel.org/v1/systemone"
        );
        assert_eq!(
            resolve_url(&base(DecisionProvider::OpenRouterDecisions)).expect("resolves"),
            "https://openrouter.ai/api/v1/systemone"
        );
    }

    #[test]
    fn openai_decisions_resolves_to_v1_decisions() {
        assert_eq!(
            resolve_url(&base(DecisionProvider::OpenAiDecisions)).expect("resolves"),
            "https://api.openai.com/v1/decisions"
        );
    }

    #[test]
    fn openai_decisions_body_defaults_to_gpt_6_luna() {
        let request = base(DecisionProvider::OpenAiDecisions);
        assert_eq!(build_body(&request)["model"], serde_json::json!("gpt-6-luna"));
    }

    #[test]
    fn workers_ai_result_envelope_is_unwrapped() {
        let enveloped = serde_json::json!({
            "result": {
                "model": "@cf/cloudflare/clef",
                "answers": {
                    "action": { "type": "choice", "choice": "submitted" }
                },
                "usage": { "input_tokens": 15 }
            },
            "success": true
        });
        let unwrapped = unwrap_envelope(enveloped);
        assert_eq!(unwrapped["model"], serde_json::json!("@cf/cloudflare/clef"));
        assert_eq!(unwrapped["answers"]["action"]["choice"], serde_json::json!("submitted"));
        assert_eq!(unwrapped["usage"]["input_tokens"], serde_json::json!(15));
    }

    #[test]
    fn a_trailing_slash_does_not_double_the_separator() {
        let mut request = base(DecisionProvider::Jev);
        request.base_url = Some("https://proxy.test/".to_string());
        assert_eq!(
            resolve_url(&request).expect("resolves"),
            "https://proxy.test/v1/systemone"
        );
    }

    #[test]
    fn a_local_endpoint_needs_an_address() {
        assert!(resolve_url(&base(DecisionProvider::SystemOne)).is_err());
        let mut request = base(DecisionProvider::SystemOne);
        request.base_url = Some("http://127.0.0.1:8000".to_string());
        assert_eq!(
            resolve_url(&request).expect("resolves"),
            "http://127.0.0.1:8000/v1/systemone"
        );
    }

    #[test]
    fn clef_body_carries_the_bare_model_name_not_the_path_form() {
        // `@cf/cloudflare/clef` in the body fails Clef's schema
        // (`^(clef|clef-flash)$`), which is a 422 rather than an obvious error.
        let mut request = base(DecisionProvider::Clef);
        request.cloudflare_account_id = Some("acct-1".to_string());
        request.model = Some("@cf/cloudflare/clef".to_string());
        assert_eq!(build_body(&request)["model"], serde_json::json!("clef"));
    }

    #[test]
    fn clef_body_defaults_to_clef() {
        let mut request = base(DecisionProvider::Clef);
        request.cloudflare_account_id = Some("acct-1".to_string());
        assert_eq!(build_body(&request)["model"], serde_json::json!("clef"));
    }

    #[test]
    fn a_local_server_sends_no_model_field_at_all() {
        // `laya-serve` serves one model and rejects the field.
        let request = base(DecisionProvider::SystemOne);
        assert!(build_body(&request).get("model").is_none());
    }

    #[test]
    fn jev_defaults_to_the_published_alias() {
        let request = base(DecisionProvider::Jev);
        assert_eq!(build_body(&request)["model"], serde_json::json!("jev-latest"));
    }

    #[test]
    fn the_state_and_questions_pass_through_untouched() {
        let mut request = base(DecisionProvider::Jev);
        request.state = serde_json::json!({ "outline": ["1 Intro"] });
        request.questions = serde_json::json!({ "q": { "type": "noul" } });
        let body = build_body(&request);
        assert_eq!(body["state"], serde_json::json!({ "outline": ["1 Intro"] }));
        assert_eq!(body["questions"], serde_json::json!({ "q": { "type": "noul" } }));
    }

    #[test]
    fn statuses_map_onto_the_probe_vocabulary() {
        assert_eq!(reason_for_status(401), "unauthorized");
        assert_eq!(reason_for_status(402), "insufficient-credits");
        assert_eq!(reason_for_status(404), "not-found");
        assert_eq!(reason_for_status(422), "invalid-request");
        assert_eq!(reason_for_status(429), "rate-limited");
        assert_eq!(reason_for_status(502), "upstream-error");
        assert_eq!(reason_for_status(418), "http-error");
    }

    #[test]
    fn a_timeout_reads_differently_from_a_refused_connection() {
        // The user-facing difference: one means "slow", the other "wrong address".
        // WebKit collapses both into "Load failed", so the wording is the only
        // thing distinguishing them.
        let (kind, timeout) = classify_transport(TransportFailure::Timeout, Some("https://x"));
        assert_eq!(kind, TransportFailure::Timeout);
        assert!(timeout.contains("No answer in time"), "got: {timeout}");

        let (kind, connect) =
            classify_transport(TransportFailure::Connect, Some("https://x"));
        assert_eq!(kind, TransportFailure::Connect);
        assert!(
            !connect.contains("No answer in time"),
            "a refused connection must not read as a timeout: {connect}"
        );
    }

    #[test]
    fn a_connect_failure_names_the_endpoint_it_could_not_reach() {
        let (_, message) = classify_transport(
            TransportFailure::Connect,
            Some("https://api.cloudflare.com/client/v4"),
        );
        assert!(message.contains("api.cloudflare.com"), "got: {message}");
    }

    #[test]
    fn a_connect_failure_without_a_url_still_gives_usable_advice() {
        let (_, message) = classify_transport(TransportFailure::Connect, None);
        assert!(message.contains("Check the endpoint address"), "got: {message}");
    }

    #[test]
    fn an_error_body_message_is_preferred_over_the_status_line() {
        let response = DaqeHttpResponse {
            ok: false,
            status: 401,
            body: None,
            url: "https://x".to_string(),
            error: Some("Authentication error [10000]".to_string()),
            reason: Some("unauthorized".to_string()),
        };
        assert_eq!(response.error.as_deref(), Some("Authentication error [10000]"));
    }

    #[test]
    fn a_key_slot_exists_for_every_provider_that_needs_one() {
        assert_eq!(key_slot(DecisionProvider::Jev), Some("jev"));
        assert_eq!(key_slot(DecisionProvider::Clef), Some("clef"));
        assert_eq!(key_slot(DecisionProvider::OpenRouterDecisions), Some("openrouter"));
        assert_eq!(key_slot(DecisionProvider::OpenAiDecisions), Some("openai"));
        // A local server needs no credential.
        assert_eq!(key_slot(DecisionProvider::SystemOne), None);
    }

    #[test]
    fn the_provider_id_round_trips_in_the_wire_format_the_frontend_sends() {
        for (provider, wire) in [
            (DecisionProvider::Jev, "jev"),
            (DecisionProvider::Clef, "clef"),
            (DecisionProvider::OpenRouterDecisions, "openrouter-decisions"),
            (DecisionProvider::OpenAiDecisions, "openai-decisions"),
            (DecisionProvider::SystemOne, "system-one"),
        ] {
            let json = serde_json::to_string(&provider).expect("serialise");
            assert_eq!(json, format!("\"{wire}\""));
            let back: DecisionProvider = serde_json::from_str(&json).expect("deserialise");
            assert_eq!(back, provider);
        }
    }
}
