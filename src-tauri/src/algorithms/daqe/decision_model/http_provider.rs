//! The production [`DecisionModelProvider`], speaking the same System One protocol
//! the frontend's `lib/daqe/systemOne.ts` already speaks.
//!
//! This is the layer that makes the goal-relevance term able to be *judged* rather
//! than only derived: `evaluate_score` receives the user's goal statement and the
//! focused tags as a [`GoalContext`], and answers with how well the item serves it.
//!
//! Three properties are load-bearing and are why this is not a thin wrapper over the
//! probe's HTTP code:
//!
//! - **One request per item.** The three primitives share a single round trip and a
//!   per-item memo, because the trait's three methods would otherwise cost three
//!   billable calls for one judgement.
//! - **Bounded, and failed once per pass.** A provider that times out is marked
//!   failed for the rest of the pass, so a 5 000-item pool costs one timeout rather
//!   than twenty.
//! - **Goal-dependent answers are never cached.** The content-hash cache holds the
//!   tier and the complexity, which depend on the item. Goal alignment depends on the
//!   session and is memoised per item id for the lifetime of *this pass only* — which
//!   is a de-duplication of one round trip, not a cache that could outlive the goal.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

use crate::commands::daqe_probe::{DecisionProvider, unwrap_envelope};
use crate::models::daqe::DecisionModelTier;

use super::{
    DecisionModelProvider, DecisionRequest, GoalContext, ProviderFailure, ProviderKind,
    ProviderRecord,
};

/// The number of points on the goal-alignment score scale, so a position on it
/// normalises onto `[0,1]`. Mirrors `COMPLEXITY_LEVELS` in `lib/daqe/systemOne.ts`.
const SCORE_LEVELS: f64 = 5.0;

/// The three primitives for one item, read from a single response.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct ItemDecision {
    /// Goal alignment in `[0,1]`, or `None` when the model did not answer.
    pub goal_alignment: Option<f64>,
    /// Cognitive-load tier, or `None`.
    pub tier: Option<DecisionModelTier>,
    /// Complexity on the shared 1–5 scale, or `None`.
    pub complexity: Option<f64>,
    /// The prerequisite gate, or `None`.
    pub gate: Option<bool>,
}

impl ItemDecision {
    /// Nothing usable came back. Distinct from zeroes, which would claim a measurement.
    pub fn is_empty(&self) -> bool {
        self.goal_alignment.is_none()
            && self.tier.is_none()
            && self.complexity.is_none()
            && self.gate.is_none()
    }
}

/// A decision-model provider reached over HTTP.
///
/// Constructed per ranking pass and dropped at the end of it, which is what keeps
/// the per-item memo honest: it cannot outlive the pass it belongs to.
pub struct HttpDecisionProvider {
    record: ProviderRecord,
    url: String,
    /// The configured model id, in the body form each provider expects. `None` for a
    /// local System One server, which picks its own.
    model: Option<String>,
    /// The bearer token, resolved from the OS keychain by the caller at the start of
    /// the pass. Held in memory for the pass and never persisted, and the frontend
    /// never sees it — settings hold only "a key exists".
    api_key: Option<String>,
    client: reqwest::Client,
    timeout_ms: u64,
    /// Set once a call has failed, so the rest of the pass is skipped rather than
    /// retried per item.
    failed: Arc<AtomicBool>,
    /// Per-pass de-duplication of the three primitives for one item.
    memo: Arc<Mutex<HashMap<String, ItemDecision>>>,
}

impl std::fmt::Debug for HttpDecisionProvider {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HttpDecisionProvider")
            .field("record", &self.record)
            .field("url", &self.url)
            .field("timeout_ms", &self.timeout_ms)
            .finish_non_exhaustive()
    }
}

impl HttpDecisionProvider {
    /// Build a provider for an already-resolved endpoint.
    ///
    /// Takes the resolved URL rather than the config so the endpoint was decided by
    /// the same code the probe uses — see `daqe_probe::resolve_provider_url`.
    pub fn new(
        provider: DecisionProvider,
        url: String,
        model: Option<String>,
        api_key: Option<String>,
        timeout_ms: u64,
    ) -> Result<Self, ProviderFailure> {
        let (kind, display_name) = match provider {
            DecisionProvider::Clef => (ProviderKind::Remote, "Cloudflare Clef"),
            DecisionProvider::Jev => (ProviderKind::Remote, "Jev"),
            DecisionProvider::OpenRouterDecisions => (ProviderKind::Remote, "OpenRouter Decisions"),
            DecisionProvider::OpenAiDecisions => (ProviderKind::Remote, "OpenAI Decisions"),
            DecisionProvider::SystemOne => (ProviderKind::Local, "System One"),
        };
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(timeout_ms))
            .user_agent("Plethora/3 (daqe-ranking)")
            .build()
            .map_err(|error| ProviderFailure::Unreachable(format!("http client: {error}")))?;
        Ok(Self {
            record: ProviderRecord {
                id: provider.id().to_string(),
                kind,
                display_name: display_name.to_string(),
            },
            url,
            model,
            api_key,
            client,
            timeout_ms,
            failed: Arc::new(AtomicBool::new(false)),
            memo: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// Whether this provider is already known to have failed in this pass.
    pub fn has_failed(&self) -> bool {
        self.failed.load(Ordering::Relaxed)
    }

    /// The request body for one item.
    ///
    /// Carries the goal in the *instructions* and only the item's structure in the
    /// state — heading skeleton, type, length. Body text, title and tags are not
    /// reachable from here because `DecisionRequest` does not carry them, so the
    /// privacy guarantee is structural rather than a rule someone has to remember.
    pub fn request_body(
        request: &DecisionRequest,
        goal: Option<&GoalContext<'_>>,
        model: Option<&str>,
    ) -> Value {
        let goal_clause = goal
            .map(|context| context.statement.trim())
            .filter(|statement| !statement.is_empty())
            .map(|statement| {
                format!(" The learner's stated goal for this session is: \"{statement}\".")
            })
            .unwrap_or_default();

        let mut state = json!({
            "type": request.item_type,
            "lengthChars": request.length_chars,
            "rubricVersion": request.rubric_version,
        });
        if let Some(outline) = &request.outline {
            state["outline"] = json!(outline);
        }

        let mut body = json!({
            "state": state,
            "questions": {
                "load_tier": {
                    "type": "choice",
                    "instructions": format!(
                        "How much reading does this item demand?{goal_clause}"
                    ),
                    "criteria": {
                        "surface-skim": "A light skim: headlines, abstracts, or a short bulleted list.",
                        "medium-analysis": "A considered read of a single section.",
                        "deep-foundational": "Sustained close reading of a primary source.",
                    },
                },
                "goal_alignment": {
                    "type": "score",
                    "instructions": format!(
                        "How well does this item serve the learner's stated goal?{goal_clause}"
                    ),
                    "criteria": ["irrelevant to the goal", "tangential", "related", "on topic", "directly serves the goal"],
                },
                "ready_to_review": {
                    "type": "noul",
                    "instructions": "Is this item self-contained enough to study on its own, with no prior reading required?",
                    "criteria": {
                        "true": "Self-contained, or its prerequisites appear met.",
                        "false": "Appears to depend on material the learner has not covered.",
                    },
                },
            }
        });
        if let Some(model) = model {
            body["model"] = Value::String(model.to_string());
        }
        body
    }

    /// Read a response into the three primitives.
    ///
    /// Mirrors `readItemDecision` in `lib/daqe/systemOne.ts`, including its
    /// preference for the choice's own calibrated probability over the tier itself.
    pub fn read_decision(body: &Value) -> ItemDecision {
        let unwrapped = unwrap_envelope(body.clone());
        let answers = unwrapped.get("answers").cloned().unwrap_or(Value::Null);
        if !answers.is_object() {
            return ItemDecision::default();
        }

        let tier_answer = answers.get("load_tier");
        let tier = tier_answer
            .and_then(|answer| answer.get("choice"))
            .and_then(Value::as_str)
            .and_then(DecisionModelTier::from_str);

        let goal_alignment = answers
            .get("goal_alignment")
            .and_then(|answer| answer.get("score"))
            .and_then(Value::as_f64)
            .map(|score| (score / (SCORE_LEVELS - 1.0)).clamp(0.0, 1.0));

        let gate = answers
            .get("ready_to_review")
            .and_then(|answer| answer.get("noul"))
            .and_then(Value::as_f64)
            .map(|noul| noul >= 0.5);

        ItemDecision { goal_alignment, tier, complexity: None, gate }
    }

    /// Ask the provider about one item, memoised per item id for this pass.
    pub async fn evaluate_item(
        &self,
        request: &DecisionRequest,
        goal: Option<&GoalContext<'_>>,
    ) -> Result<ItemDecision, ProviderFailure> {
        if let Some(hit) = self
            .memo
            .lock()
            .ok()
            .and_then(|memo| memo.get(&request.item_id).copied())
        {
            return Ok(hit);
        }
        if self.has_failed() {
            return Err(ProviderFailure::SkippedAfterFailure);
        }

        let outcome = self.call(request, goal).await;
        match &outcome {
            Ok(decision) if !decision.is_empty() => {
                if let Ok(mut memo) = self.memo.lock() {
                    memo.insert(request.item_id.clone(), *decision);
                }
            }
            // An empty answer is a provider that did not judge, which counts as a
            // failure for the rest of the pass rather than being retried per item.
            _ => {
                self.failed.store(true, Ordering::Relaxed);
            }
        }
        outcome
    }

    /// One HTTP round trip.
    async fn call(
        &self,
        request: &DecisionRequest,
        goal: Option<&GoalContext<'_>>,
    ) -> Result<ItemDecision, ProviderFailure> {
        let body = Self::request_body(request, goal, self.model.as_deref());
        let mut builder = self.client.post(&self.url).json(&body);
        if let Some(key) = &self.api_key {
            builder = builder.bearer_auth(key);
        }

        let response = builder.send().await.map_err(|error| {
            ProviderFailure::Unreachable(describe(&error, self.timeout_ms))
        })?;
        let status = response.status();
        let text = response.text().await.map_err(|error| {
            ProviderFailure::Unreachable(describe(&error, self.timeout_ms))
        })?;
        if !status.is_success() {
            return Err(ProviderFailure::Unreachable(format!(
                "endpoint answered {status}: {}",
                text.chars().take(200).collect::<String>()
            )));
        }
        let parsed: Value = serde_json::from_str(&text)
            .map_err(|error| ProviderFailure::InvalidOutput(error.to_string()))?;
        Ok(Self::read_decision(&parsed))
    }
}

fn describe(error: &reqwest::Error, timeout_ms: u64) -> String {
    if error.is_timeout() {
        format!("timed out after {timeout_ms}ms")
    } else if error.is_connect() {
        "could not connect".to_string()
    } else {
        error.to_string()
    }
}

#[async_trait::async_trait]
impl DecisionModelProvider for HttpDecisionProvider {
    fn record(&self) -> ProviderRecord {
        self.record.clone()
    }

    async fn evaluate_score(
        &self,
        request: &DecisionRequest,
        goal: Option<&GoalContext<'_>>,
    ) -> Result<f64, ProviderFailure> {
        self.evaluate_item(request, goal)
            .await?
            .goal_alignment
            .ok_or_else(|| ProviderFailure::InvalidOutput("no goal alignment answer".to_string()))
    }

    async fn evaluate_choice(
        &self,
        request: &DecisionRequest,
    ) -> Result<DecisionModelTier, ProviderFailure> {
        self.evaluate_item(request, None)
            .await?
            .tier
            .ok_or_else(|| ProviderFailure::InvalidOutput("no load_tier answer".to_string()))
    }

    async fn evaluate_noul(&self, request: &DecisionRequest) -> Result<bool, ProviderFailure> {
        self.evaluate_item(request, None)
            .await?
            .gate
            .ok_or_else(|| ProviderFailure::InvalidOutput("no ready_to_review answer".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::algorithms::daqe::decision_model::{ProviderRegistry, ProviderRecord};

    fn request() -> DecisionRequest {
        DecisionRequest {
            item_id: "item-1".to_string(),
            item_type: "document".to_string(),
            length_chars: 4_200,
            outline: Some(vec!["Introduction".to_string(), "Proof sketch".to_string()]),
            rubric_version: 2,
        }
    }

    fn goal() -> GoalContext<'static> {
        GoalContext { statement: "Exam Review & CS Foundations", focus_tags: &[] }
    }

    fn answers(body: Value) -> Value {
        json!({ "answers": body })
    }

    /* ---------------- reading a response ---------------- */

    #[test]
    fn a_wrapped_response_is_unwrapped_before_reading() {
        // Cloudflare Workers AI and some proxies nest the payload in `result`.
        let decision = HttpDecisionProvider::read_decision(&json!({
            "result": { "answers": {
                "load_tier": { "choice": "deep-foundational" },
                "goal_alignment": { "score": 4.0 },
                "ready_to_review": { "noul": 0.9 },
            }},
            "success": true,
        }));
        assert_eq!(decision.tier, Some(DecisionModelTier::DeepFoundational));
        assert_eq!(decision.goal_alignment, Some(1.0));
        assert_eq!(decision.gate, Some(true));
    }

    #[test]
    fn an_unwrapped_response_reads_identically() {
        let decision = HttpDecisionProvider::read_decision(&answers(json!({
            "load_tier": { "choice": "deep-foundational" },
            "goal_alignment": { "score": 4.0 },
        })));
        assert_eq!(decision.tier, Some(DecisionModelTier::DeepFoundational));
        assert_eq!(decision.goal_alignment, Some(1.0));
    }

    #[test]
    fn a_score_position_normalises_onto_zero_and_one() {
        let zero = HttpDecisionProvider::read_decision(&answers(json!({
            "goal_alignment": { "score": 0.0 } })));
        let full = HttpDecisionProvider::read_decision(&answers(json!({
            "goal_alignment": { "score": 4.0 } })));
        assert_eq!(zero.goal_alignment, Some(0.0));
        assert_eq!(full.goal_alignment, Some(1.0));
    }

    #[test]
    fn a_score_beyond_the_scale_is_clamped_not_rejected() {
        // The protocol's own reading clamps here; the *term* is what rejects an
        // out-of-range verdict, so clamping keeps one bad provider answer from
        // silently becoming an unusable item.
        let decision = HttpDecisionProvider::read_decision(&answers(json!({
            "goal_alignment": { "score": 99.0 } })));
        assert_eq!(decision.goal_alignment, Some(1.0));
    }

    #[test]
    fn a_noul_at_half_counts_as_ready() {
        let decision = HttpDecisionProvider::read_decision(&answers(json!({
            "ready_to_review": { "noul": 0.5 } })));
        assert_eq!(decision.gate, Some(true));
        let below = HttpDecisionProvider::read_decision(&answers(json!({
            "ready_to_review": { "noul": 0.49 } })));
        assert_eq!(below.gate, Some(false));
    }

    #[test]
    fn an_unknown_tier_is_absent_rather_than_guessed() {
        let decision = HttpDecisionProvider::read_decision(&answers(json!({
            "load_tier": { "choice": "some-new-tier" } })));
        assert_eq!(decision.tier, None);
    }

    #[test]
    fn a_response_with_no_answers_is_empty_not_zeroes() {
        let decision = HttpDecisionProvider::read_decision(&json!({}));
        assert!(decision.is_empty(), "nothing came back, so nothing is claimed");
    }

    #[test]
    fn a_partial_response_keeps_what_it_has() {
        let decision = HttpDecisionProvider::read_decision(&answers(json!({
            "goal_alignment": { "score": 3.0 } })));
        assert_eq!(decision.goal_alignment, Some(0.75));
        assert_eq!(decision.tier, None);
        assert!(!decision.is_empty());
    }

    /* ---------------- the request body ---------------- */

    #[test]
    fn the_body_carries_the_goal_in_the_instructions_not_the_state() {
        // Matches the frontend's `buildItemDecision`: a goal is not part of the item,
        // and putting it in `state` would make it look like content.
        let body = HttpDecisionProvider::request_body(&request(), Some(&goal()), None);
        let state = body["state"].to_string();
        assert!(!state.contains("Exam Review"));
        let instructions = body["questions"]["goal_alignment"]["instructions"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(instructions.contains("Exam Review"));
    }

    #[test]
    fn no_goal_produces_no_goal_clause_rather_than_an_empty_quote() {
        let body = HttpDecisionProvider::request_body(&request(), None, None);
        let instructions = body["questions"]["goal_alignment"]["instructions"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(!instructions.contains("stated goal for this session is"));
    }

    #[test]
    fn the_state_carries_only_the_items_structure() {
        let body = HttpDecisionProvider::request_body(&request(), Some(&goal()), None);
        let state = &body["state"];
        assert_eq!(state["lengthChars"], json!(4_200));
        assert_eq!(state["type"], json!("document"));
        assert_eq!(state["outline"], json!(["Introduction", "Proof sketch"]));
        // `DecisionRequest` has no title, body or tags, so the sanitization gate is
        // structural rather than a rule that has to be remembered at the call site.
        for banned in ["title", "body", "tags", "content", "text"] {
            assert!(state.get(banned).is_none(), "{banned} must not be in the state");
        }
    }

    #[test]
    fn an_absent_outline_is_simply_omitted() {
        let mut bare = request();
        bare.outline = None;
        let body = HttpDecisionProvider::request_body(&bare, None, None);
        assert!(body["state"].get("outline").is_none());
    }

    #[test]
    fn the_model_goes_in_the_body_only_when_configured() {
        let with = HttpDecisionProvider::request_body(&request(), None, Some("jev-latest"));
        assert_eq!(with["model"], json!("jev-latest"));
        // A local System One server picks its own model; sending an empty one is a
        // schema violation there, which the probe already handles.
        let without = HttpDecisionProvider::request_body(&request(), None, None);
        assert!(without.get("model").is_none());
    }

    #[test]
    fn the_body_asks_exactly_the_three_primitives() {
        let body = HttpDecisionProvider::request_body(&request(), Some(&goal()), None);
        let questions = body["questions"].as_object().unwrap();
        assert_eq!(questions.len(), 3);
        assert_eq!(questions["load_tier"]["type"], json!("choice"));
        assert_eq!(questions["goal_alignment"]["type"], json!("score"));
        assert_eq!(questions["ready_to_review"]["type"], json!("noul"));
    }

    /* ---------------- failure accounting ---------------- */

    fn provider_with(record: ProviderRecord) -> HttpDecisionProvider {
        HttpDecisionProvider {
            record,
            url: "http://127.0.0.1:1/never-answers".to_string(),
            model: None,
            api_key: None,
            client: reqwest::Client::new(),
            timeout_ms: 40,
            failed: Arc::new(AtomicBool::new(false)),
            memo: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn record() -> ProviderRecord {
        ProviderRecord {
            id: "jev".to_string(),
            kind: ProviderKind::Remote,
            display_name: "Jev".to_string(),
        }
    }

    #[tokio::test]
    async fn an_unreachable_provider_fails_once_and_skips_the_rest_of_the_pass() {
        let provider = Arc::new(provider_with(record()));
        let first = provider.evaluate_item(&request(), None).await;
        assert!(first.is_err(), "nothing is listening on that port");
        assert!(provider.has_failed());

        // A second candidate must not cost a second round trip.
        let mut other = request();
        other.item_id = "item-2".to_string();
        let second = provider.evaluate_item(&other, None).await;
        assert!(matches!(second, Err(ProviderFailure::SkippedAfterFailure)));
    }

    #[tokio::test]
    async fn a_verdict_is_memoised_so_the_three_primitives_cost_one_call() {
        let provider = Arc::new(provider_with(record()));
        provider.memo.lock().unwrap().insert(
            "item-1".to_string(),
            ItemDecision {
                goal_alignment: Some(0.8),
                tier: Some(DecisionModelTier::MediumAnalysis),
                complexity: None,
                gate: Some(true),
            },
        );

        let via_score = provider.evaluate_score(&request(), None).await;
        let via_choice = provider.evaluate_choice(&request()).await;
        let via_noul = provider.evaluate_noul(&request()).await;
        assert_eq!(via_score.unwrap(), 0.8);
        assert_eq!(via_choice.unwrap(), DecisionModelTier::MediumAnalysis);
        assert_eq!(via_noul.unwrap(), true);
        assert!(!provider.has_failed(), "a memo hit is not a failure");
    }

    #[tokio::test]
    async fn a_missing_answer_is_an_invalid_output_not_a_zero() {
        let provider = Arc::new(provider_with(record()));
        provider.memo.lock().unwrap().insert("item-1".to_string(), ItemDecision::default());
        assert!(matches!(
            provider.evaluate_score(&request(), None).await,
            Err(ProviderFailure::InvalidOutput(_))
        ));
    }

    #[test]
    fn the_registry_gates_a_remote_provider_behind_the_opt_in() {
        let mut registry = ProviderRegistry::new();
        registry.register(Arc::new(provider_with(record())));
        assert!(registry.is_contactable("jev", false).is_err(), "never contacted");
        assert!(registry.is_contactable("jev", true).is_ok());
    }
}
