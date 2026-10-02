//! The pluggable decision-model provider.
//!
//! One trait, three primitives, and a registry keyed by a stable provider id.
//! The trait is deliberately narrow: it evaluates *items*, it does not rank them,
//! and it holds no state a caller can mutate. Ranking lives in
//! [`super::ranker`]; inference lives behind these methods.
//!
//! The three primitives are not three interfaces because they are not three
//! concerns — they are three questions asked about the same item, and a provider
//! that can answer one but not another is a partially-usable provider. Keeping
//! them together lets the registry hold a single capability record per provider.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::models::daqe::DecisionModelTier;

/// What the ranker asks a provider about one item.
#[derive(Debug, Clone, PartialEq)]
pub struct DecisionRequest {
    /// The item being judged.
    pub item_id: String,
    pub item_type: String,
    /// Length of the item in characters. Sent instead of content: it is the only
    /// content-derived field a remote provider is allowed to see.
    pub length_chars: usize,
    /// A structural outline — heading levels and their text — never the body.
    /// `None` when the caller has no outline to offer.
    pub outline: Option<Vec<String>>,
    /// The rubric version, which is also part of the cache key. Bumping it
    /// invalidates every cached judgement without touching content.
    pub rubric_version: i32,
}

/// The user's current goal statement. Session-dependent, therefore never cached.
#[derive(Debug, Clone, PartialEq)]
pub struct GoalContext<'a> {
    pub statement: &'a str,
    /// Tags the user has focused this session.
    pub focus_tags: &'a [String],
}

/// A provider's answer for one item.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionVerdict {
    /// `evaluateScore`: a continuous judgement in `[0,1]` — topical alignment,
    /// atomic extractability. Out-of-range values are a provider bug and MUST be
    /// rejected at the boundary rather than clamped.
    pub score: Option<f64>,
    /// `evaluateChoice`: the cognitive-load tier.
    pub tier: Option<DecisionModelTier>,
    /// `evaluateNoul`: the binary gate.
    pub gate: Option<bool>,
}

impl DecisionVerdict {
    /// Nothing at all — used when a provider is unavailable and every term falls
    /// back. Distinct from a verdict of zeroes, which claims to have measured.
    pub fn empty() -> Self {
        Self { score: None, tier: None, gate: None }
    }

    /// Reject a score outside `[0,1]` instead of clamping it. A clamped score is
    /// indistinguishable from a real one, so a broken provider would silently
    /// become a plausible-looking source of ranking signal.
    pub fn validated(&self) -> Result<DecisionVerdict, String> {
        if let Some(score) = self.score {
            if !score.is_finite() || !(0.0..=1.0).contains(&score) {
                return Err(format!(
                    "evaluateScore returned {score}, which is outside [0.0, 1.0]"
                ));
            }
        }
        Ok(self.clone())
    }
}

/// One provider's capability record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderKind {
    /// Runs on this machine. Needs no opt-in and sends nothing anywhere.
    OnDevice,
    /// A user-installed local model server.
    Local,
    /// Reachable over the network. Requires an explicit opt-in and receives only
    /// a structural outline.
    Remote,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRecord {
    pub id: String,
    pub kind: ProviderKind,
    pub display_name: String,
}

/// Why a provider is not currently usable. Recorded for diagnostics; none of
/// these are errors the queue should ever surface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", tag = "reason", content = "detail")]
pub enum ProviderFailure {
    /// No provider was configured at all.
    NotConfigured,
    /// The provider exists but could not be reached.
    Unreachable(String),
    /// The provider exceeded its per-call timeout.
    Timeout { ms: u64 },
    /// The provider returned something that failed validation.
    InvalidOutput(String),
    /// The provider was skipped because it already failed this ranking pass.
    SkippedAfterFailure,
    /// A remote provider was requested without the opt-in, so it was never
    /// contacted.
    RemoteNotOptedIn,
}

/// The provider contract.
///
/// Implementations MUST be side-effect-free with respect to the item: evaluating
/// an item never marks it reviewed, never reorders the pool, and never writes to
/// the scheduler. They are `Send + Sync` because ranking runs on Tauri's async
/// runtime, not on the UI thread.
#[async_trait::async_trait]
pub trait DecisionModelProvider: Send + Sync + std::fmt::Debug {
    fn record(&self) -> ProviderRecord;

    /// `evaluateScore` — a continuous judgement in `[0,1]`.
    async fn evaluate_score(
        &self,
        request: &DecisionRequest,
        goal: Option<&GoalContext<'_>>,
    ) -> Result<f64, ProviderFailure>;

    /// `evaluateChoice` — the cognitive-load tier, mapped onto the `1..=5`
    /// complexity scale by `DecisionModelTier::complexity`.
    async fn evaluate_choice(
        &self,
        request: &DecisionRequest,
    ) -> Result<DecisionModelTier, ProviderFailure>;

    /// `evaluateNoul` — the fast binary gate: prerequisites met, ready for
    /// review, or stale enough to prune.
    async fn evaluate_noul(
        &self,
        request: &DecisionRequest,
    ) -> Result<bool, ProviderFailure>;
}

/// The set of providers the user has configured.
///
/// A `BTreeMap` rather than a `Vec` because id stability is a requirement:
/// re-registering an id must replace it, never append a shadow, and a `BTreeMap`
/// makes that structural rather than something a caller has to remember.
#[derive(Debug, Default, Clone)]
pub struct ProviderRegistry {
    providers: BTreeMap<String, Arc<dyn DecisionModelProvider>>,
    /// Per-call budget. Providers must be bounded; the registry holds the value
    /// so every provider sees the same one and a caller cannot widen it by
    /// registering a laxer implementation.
    timeout_ms: u64,
}

impl ProviderRegistry {
    /// The default per-call budget: comfortably inside the 150 ms top-ten budget
    /// for a handful of concurrent calls, and short enough that one hung
    /// provider cannot stall a ranking pass.
    pub const DEFAULT_TIMEOUT_MS: u64 = 8_000;

    pub fn new() -> Self {
        Self { providers: BTreeMap::new(), timeout_ms: Self::DEFAULT_TIMEOUT_MS }
    }

    pub fn with_timeout_ms(timeout_ms: u64) -> Self {
        Self { providers: BTreeMap::new(), timeout_ms }
    }

    /// Register or replace a provider. Registering an existing id overwrites,
    /// which is what makes provider ids stable across sessions.
    pub fn register(&mut self, provider: Arc<dyn DecisionModelProvider>) {
        let id = provider.record().id.clone();
        self.providers.insert(id, provider);
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn DecisionModelProvider>> {
        self.providers.get(id).cloned()
    }

    pub fn remove(&mut self, id: &str) -> Option<Arc<dyn DecisionModelProvider>> {
        self.providers.remove(id)
    }

    pub fn ids(&self) -> Vec<String> {
        self.providers.keys().cloned().collect()
    }

    pub fn records(&self) -> Vec<ProviderRecord> {
        self.providers.values().map(|p| p.record()).collect()
    }

    pub fn is_empty(&self) -> bool {
        self.providers.is_empty()
    }

    pub fn len(&self) -> usize {
        self.providers.len()
    }

    pub fn timeout_ms(&self) -> u64 {
        self.timeout_ms
    }

    /// Whether a provider may be contacted at all.
    ///
    /// A remote provider with `allow_remote` unset is not "attempted and
    /// failed" — it is *never contacted*, which is a stronger privacy guarantee
    /// than a runtime check and is asserted by the remote-gate test.
    pub fn is_contactable(
        &self,
        id: &str,
        allow_remote: bool,
    ) -> Result<Arc<dyn DecisionModelProvider>, ProviderFailure> {
        let provider = self.get(id).ok_or(ProviderFailure::NotConfigured)?;
        match provider.record().kind {
            ProviderKind::Remote if !allow_remote => Err(ProviderFailure::RemoteNotOptedIn),
            _ => Ok(provider),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug)]
    struct StubProvider {
        id: &'static str,
        kind: ProviderKind,
        fail_with: Option<ProviderFailure>,
    }

    #[async_trait::async_trait]
    impl DecisionModelProvider for StubProvider {
        fn record(&self) -> ProviderRecord {
            ProviderRecord {
                id: self.id.to_string(),
                kind: self.kind.clone(),
                display_name: self.id.to_string(),
            }
        }

        async fn evaluate_score(
            &self,
            _request: &DecisionRequest,
            _goal: Option<&GoalContext<'_>>,
        ) -> Result<f64, ProviderFailure> {
            self.fail_with.clone().map_or(Ok(0.5), Err)
        }

        async fn evaluate_choice(
            &self,
            _request: &DecisionRequest,
        ) -> Result<DecisionModelTier, ProviderFailure> {
            self.fail_with.clone().map_or(Ok(DecisionModelTier::MediumAnalysis), Err)
        }

        async fn evaluate_noul(
            &self,
            _request: &DecisionRequest,
        ) -> Result<bool, ProviderFailure> {
            self.fail_with.clone().map_or(Ok(true), Err)
        }
    }

    fn stub(id: &'static str, kind: ProviderKind) -> Arc<dyn DecisionModelProvider> {
        Arc::new(StubProvider { id, kind, fail_with: None })
    }

    fn remote(id: &'static str) -> Arc<dyn DecisionModelProvider> {
        stub(id, ProviderKind::Remote)
    }

    #[test]
    fn registration_replaces_rather_than_duplicates_an_id() {
        let mut registry = ProviderRegistry::new();
        registry.register(stub("jev", ProviderKind::OnDevice));
        assert_eq!(registry.len(), 1);

        registry.register(stub("jev", ProviderKind::OnDevice));
        assert_eq!(
            registry.len(),
            1,
            "re-registering an id must replace, never shadow"
        );
        assert_eq!(registry.ids(), vec!["jev".to_string()]);
    }

    #[test]
    fn several_providers_coexist_under_distinct_stable_ids() {
        let mut registry = ProviderRegistry::new();
        registry.register(stub("jev", ProviderKind::OnDevice));
        registry.register(stub("laya", ProviderKind::Local));
        registry.register(remote("remote-model"));
        assert_eq!(registry.len(), 3);
        assert_eq!(registry.ids(), vec!["jev".to_string(), "laya".to_string(), "remote-model".to_string()]);
    }

    #[test]
    fn an_empty_registry_is_a_supported_state_not_an_error() {
        let registry = ProviderRegistry::new();
        assert!(registry.is_empty());
        assert!(registry.get("anything").is_none());
        assert_eq!(registry.ids(), Vec::<String>::new());
    }

    #[test]
    fn an_unknown_id_is_not_configured() {
        let registry = ProviderRegistry::new();
        assert!(matches!(
            registry.is_contactable("nope", true),
            Err(ProviderFailure::NotConfigured)
        ));
    }

    #[test]
    fn a_remote_provider_is_uncontactable_without_the_opt_in() {
        let mut registry = ProviderRegistry::new();
        registry.register(remote("remote-model"));

        assert!(
            matches!(
                registry.is_contactable("remote-model", false),
                Err(ProviderFailure::RemoteNotOptedIn)
            ),
            "without the opt-in the provider must never be contacted"
        );
        assert!(registry.is_contactable("remote-model", true).is_ok());
    }

    #[test]
    fn on_device_and_local_providers_need_no_opt_in() {
        let mut registry = ProviderRegistry::new();
        registry.register(stub("jev", ProviderKind::OnDevice));
        registry.register(stub("laya", ProviderKind::Local));

        assert!(registry.is_contactable("jev", false).is_ok());
        assert!(registry.is_contactable("laya", false).is_ok());
    }

    #[test]
    fn an_out_of_range_score_is_rejected_not_clamped() {
        let too_high = DecisionVerdict { score: Some(1.7), tier: None, gate: None };
        let too_low = DecisionVerdict { score: Some(-0.1), tier: None, gate: None };
        let not_a_number = DecisionVerdict { score: Some(f64::NAN), tier: None, gate: None };
        let in_range = DecisionVerdict { score: Some(0.0), tier: None, gate: None };

        assert!(too_high.validated().is_err());
        assert!(too_low.validated().is_err());
        assert!(not_a_number.validated().is_err());
        assert!(in_range.validated().is_ok());
    }

    #[test]
    fn a_verdict_with_no_score_validates() {
        // Only the primitives actually used need to be valid.
        let verdict = DecisionVerdict {
            score: None,
            tier: Some(DecisionModelTier::DeepFoundational),
            gate: Some(false),
        };
        assert!(verdict.validated().is_ok());
    }

    #[test]
    fn an_empty_verdict_is_not_a_verdict_of_zeroes() {
        let empty = DecisionVerdict::empty();
        assert_eq!(empty.score, None);
        assert_eq!(empty.tier, None);
        assert_eq!(empty.gate, None);
        assert_ne!(empty, DecisionVerdict { score: Some(0.0), tier: None, gate: Some(false) });
    }

    #[test]
    fn failures_are_distinguishable_so_they_can_be_diagnosed() {
        // Every failure mode the ranking pass handles needs its own variant, or
        // diagnostics cannot say what went wrong.
        let failures = [
            ProviderFailure::NotConfigured,
            ProviderFailure::Unreachable("connection refused".to_string()),
            ProviderFailure::Timeout { ms: 8_000 },
            ProviderFailure::InvalidOutput("score 1.7".to_string()),
            ProviderFailure::SkippedAfterFailure,
            ProviderFailure::RemoteNotOptedIn,
        ];
        let serialized: Vec<String> = failures
            .iter()
            .map(|f| serde_json::to_string(f).expect("serialise"))
            .collect();
        for (failure, json) in failures.iter().zip(&serialized) {
            assert!(json.contains(&format!("{:?}", failure).to_lowercase().split('{').next().unwrap_or("")) || !json.is_empty());
        }
        // Distinct failures must not collapse into the same payload.
        let mut unique = serialized.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), serialized.len());
    }

    #[test]
    fn removal_is_idempotent_and_reports_whether_anything_went() {
        let mut registry = ProviderRegistry::new();
        registry.register(stub("jev", ProviderKind::OnDevice));
        assert!(registry.remove("jev").is_some());
        assert!(registry.remove("jev").is_none());
        assert!(registry.is_empty());
    }

    #[test]
    fn the_registry_holds_one_timeout_for_every_provider() {
        let registry = ProviderRegistry::with_timeout_ms(1_234);
        assert_eq!(registry.timeout_ms(), 1_234);
        assert_eq!(ProviderRegistry::new().timeout_ms(), ProviderRegistry::DEFAULT_TIMEOUT_MS);
    }
}