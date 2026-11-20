//! Shared connector abstraction families (`NativeHealthAdapter` vs `CloudHealthConnector`)
//! and normalized ingestion batch outputs.

use super::models::{
    HealthDataCategory, HealthDevice, HealthProviderError, HealthProviderId, HealthProviderInfo,
    PhysiologicalObservation, ProviderReadinessState, RawSleepSession, RecoveryObservation,
};

#[derive(Debug, Clone, Default)]
pub struct NormalizedIngestionBatch {
    pub devices: Vec<HealthDevice>,
    pub sleep_sessions: Vec<RawSleepSession>,
    pub deleted_sleep_external_ids: Vec<String>,
    pub physio_observations: Vec<PhysiologicalObservation>,
    pub deleted_physio_external_ids: Vec<String>,
    pub recovery_observations: Vec<RecoveryObservation>,
    pub next_cursor: Option<String>,
    pub warnings: Vec<String>,
    pub history_limit_days: Option<i32>,
}

#[derive(Debug, Clone, Default)]
pub struct ProviderConfigContext {
    pub platform_os: String,
    pub oauth_broker_url: Option<String>,
    pub broker_configured_providers: Vec<String>,
    pub broker_approved_providers: Vec<String>,
    pub healthkit_entitlement_enabled: bool,
}

impl ProviderConfigContext {
    pub fn from_env() -> Self {
        let platform_os = std::env::consts::OS.to_string();
        let oauth_broker_url = std::env::var("PLETHORA_HEALTH_OAUTH_BROKER_URL")
            .ok()
            .filter(|v| !v.trim().is_empty());
        let broker_configured_providers = std::env::var("PLETHORA_HEALTH_CONFIGURED_PROVIDERS")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty())
            .collect();
        let broker_approved_providers = std::env::var("PLETHORA_HEALTH_APPROVED_PROVIDERS")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty())
            .collect();
        let healthkit_entitlement_enabled = healthkit_enabled();
        Self {
            platform_os,
            oauth_broker_url,
            broker_configured_providers,
            broker_approved_providers,
            healthkit_entitlement_enabled,
        }
    }
}

/// Native mobile health bridge abstraction (iOS HealthKit, Android Health Connect).
pub trait NativeHealthAdapter: Send + Sync {
    fn provider_id(&self) -> HealthProviderId;
    fn supported_categories(&self) -> &'static [HealthDataCategory];
    fn normalize_sleep_payload(
        &self,
        raw: &serde_json::Value,
        acquisition_at_ms: i64,
        batch_id: Option<&str>,
    ) -> Result<NormalizedIngestionBatch, HealthProviderError>;
    fn normalize_physio_payload(
        &self,
        raw: &serde_json::Value,
        acquisition_at_ms: i64,
        batch_id: Option<&str>,
    ) -> Result<NormalizedIngestionBatch, HealthProviderError>;
}

/// Direct OAuth cloud wearable connector abstraction.
#[async_trait::async_trait]
pub trait CloudHealthConnector: Send + Sync {
    fn provider_id(&self) -> HealthProviderId;
    fn provider_info(&self, ctx: &ProviderConfigContext) -> HealthProviderInfo;
    fn readiness_state(&self, ctx: &ProviderConfigContext) -> ProviderReadinessState;
    fn authorize_endpoint(&self) -> &'static str;
    fn default_scopes(&self) -> &'static [&'static str];
    async fn sync_incremental(
        &self,
        access_token: &str,
        cursor: Option<&str>,
        start_ms: i64,
        end_ms: i64,
        batch_id: Option<&str>,
    ) -> Result<NormalizedIngestionBatch, HealthProviderError>;
}

pub(crate) fn healthkit_enabled() -> bool {
    serde_json::from_str::<serde_json::Value>(include_str!(
        "../../../scripts/ios-overrides/healthkit.entitlements.json"
    ))
    .ok()
    .and_then(|settings| settings.get("enabled").and_then(|value| value.as_bool()))
    .unwrap_or(false)
}
