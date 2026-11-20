//! Garmin Commercial Health API contract connector.
//!
//! IMPORTANT: Garmin Personal API is strictly prohibited for multi-user commercial apps.
//! This connector targets the Garmin Connect Developer Program (OAuth 2.0 + PKCE) and remains
//! gated at `requires_developer_approval` unless `GARMIN_COMMERCIAL_APPROVED=1` / approved config is supplied.

use serde::Deserialize;

use crate::health::http_client::HealthHttpClient;
use crate::health::models::{
    HealthDevice, HealthProviderError, HealthProviderId, HealthProviderInfo, HrvMethod,
    PhysiologicalMetricType, PhysiologicalObservation, ProviderReadinessState, RawSleepSession,
    RecoveryObservation, SleepKind,
};
use crate::health::provider::{
    CloudHealthConnector, NormalizedIngestionBatch, ProviderConfigContext,
};
use crate::health::providers::catalog::build_provider_catalog;

pub const GARMIN_AUTH_URL: &str = "https://connect.garmin.com/oauth2Confirm";
pub const GARMIN_API_BASE: &str = "https://apis.garmin.com/wellness-api/rest";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminSleepSummary {
    pub summary_id: String,
    pub calendar_date: Option<String>,
    pub start_time_in_seconds: i64,
    pub start_time_offset_in_seconds: Option<i32>,
    pub duration_in_seconds: i64,
    pub deep_sleep_duration_in_seconds: Option<f64>,
    pub light_sleep_duration_in_seconds: Option<f64>,
    pub rem_sleep_duration_in_seconds: Option<f64>,
    pub awake_duration_in_seconds: Option<f64>,
    pub overall_sleep_score: Option<GarminScoreValue>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminScoreValue {
    pub value: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GarminHrvSummary {
    pub summary_id: String,
    pub calendar_date: String,
    pub start_time_in_seconds: i64,
    pub last_night_avg: Option<f64>,
}

pub struct GarminConnector {
    base_url: String,
    http: HealthHttpClient,
}

impl Default for GarminConnector {
    fn default() -> Self {
        Self::new(GARMIN_API_BASE.to_string(), HealthHttpClient::default())
    }
}

impl GarminConnector {
    pub fn new(base_url: String, http: HealthHttpClient) -> Self {
        Self { base_url, http }
    }
}

#[async_trait::async_trait]
impl CloudHealthConnector for GarminConnector {
    fn provider_id(&self) -> HealthProviderId {
        HealthProviderId::Garmin
    }

    fn provider_info(&self, ctx: &ProviderConfigContext) -> HealthProviderInfo {
        build_provider_catalog(ctx, &[])
            .into_iter()
            .find(|p| p.id == HealthProviderId::Garmin)
            .expect("Garmin must exist in catalog")
    }

    fn readiness_state(&self, ctx: &ProviderConfigContext) -> ProviderReadinessState {
        self.provider_info(ctx).readiness_state
    }

    fn authorize_endpoint(&self) -> &'static str {
        GARMIN_AUTH_URL
    }

    fn default_scopes(&self) -> &'static [&'static str] {
        &[]
    }

    async fn sync_incremental(
        &self,
        access_token: &str,
        _cursor: Option<&str>,
        start_ms: i64,
        end_ms: i64,
        batch_id: Option<&str>,
    ) -> Result<NormalizedIngestionBatch, HealthProviderError> {
        let start_secs = (start_ms / 1000).to_string();
        let end_secs = (end_ms / 1000).to_string();
        let sleeps_url = format!("{}/sleeps", self.base_url.trim_end_matches('/'));
        let raw_sleeps = self
            .http
            .get_json(
                &sleeps_url,
                access_token,
                &[
                    ("uploadStartTimeInSeconds", &start_secs),
                    ("uploadEndTimeInSeconds", &end_secs),
                ],
            )
            .await?;

        let summaries: Vec<GarminSleepSummary> =
            serde_json::from_value(raw_sleeps).map_err(|e| {
                HealthProviderError::new(
                    "parse_error",
                    format!("Invalid Garmin sleep payload: {e}"),
                    false,
                )
            })?;

        let acq = chrono::Utc::now().timestamp_millis();
        Ok(normalize_garmin_sleep_summaries(
            summaries,
            vec![],
            acq,
            batch_id,
        ))
    }
}

pub fn normalize_garmin_sleep_summaries(
    sleeps: Vec<GarminSleepSummary>,
    hrvs: Vec<GarminHrvSummary>,
    acquisition_at_ms: i64,
    batch_id: Option<&str>,
) -> NormalizedIngestionBatch {
    let mut batch = NormalizedIngestionBatch {
        next_cursor: Some(acquisition_at_ms.to_string()),
        ..Default::default()
    };
    let dev_id = "dev_garmin_watch".to_string();
    batch.devices.push(HealthDevice {
        id: dev_id.clone(),
        provider_id: HealthProviderId::Garmin,
        external_device_id: "garmin_connect".to_string(),
        manufacturer: Some("Garmin".to_string()),
        model: Some("Garmin Device".to_string()),
        source_app_bundle: Some("com.garmin.connect.mobile".to_string()),
        platform_source_id: Some("garmin_health_api".to_string()),
        metadata_json: None,
    });

    for s in sleeps {
        if s.duration_in_seconds <= 0 {
            continue;
        }
        let start_ms = s.start_time_in_seconds * 1000;
        let end_ms = start_ms + s.duration_in_seconds * 1000;
        let dur_mins = s.duration_in_seconds as f64 / 60.0;
        let raw_id = format!("garmin_{}", s.summary_id);
        batch.sleep_sessions.push(RawSleepSession {
            id: raw_id,
            provider_id: HealthProviderId::Garmin,
            device_id: Some(dev_id.clone()),
            external_record_id: s.summary_id.clone(),
            source_app_bundle: Some("com.garmin.connect.mobile".to_string()),
            start_at_ms: start_ms,
            end_at_ms: end_ms,
            start_tz_offset_secs: s.start_time_offset_in_seconds,
            end_tz_offset_secs: s.start_time_offset_in_seconds,
            duration_mins: dur_mins,
            time_in_bed_mins: Some(dur_mins),
            sleep_efficiency_pct: None,
            awake_mins: s.awake_duration_in_seconds.map(|v| v / 60.0),
            light_mins: s.light_sleep_duration_in_seconds.map(|v| v / 60.0),
            deep_mins: s.deep_sleep_duration_in_seconds.map(|v| v / 60.0),
            rem_mins: s.rem_sleep_duration_in_seconds.map(|v| v / 60.0),
            sleep_kind: if dur_mins < 180.0 {
                SleepKind::Nap
            } else {
                SleepKind::MainSleep
            },
            provider_sleep_kind: None,
            quality_flags: Vec::new(),
            quality_score: 0.93,
            notes: None,
            subjective_quality: None,
            acquisition_at_ms,
            sync_batch_id: batch_id.map(str::to_string),
            is_deleted: false,
            is_synthetic: false,
            stages: Vec::new(),
        });

        if let Some(score_val) = s.overall_sleep_score.and_then(|o| o.value) {
            batch.recovery_observations.push(RecoveryObservation {
                id: format!("garmin_score_{}", s.summary_id),
                provider_id: HealthProviderId::Garmin,
                external_record_id: format!("sleep_score_{}", s.summary_id),
                score_name: "Garmin Sleep Score".to_string(),
                score_value: Some(score_val),
                scale_min: 0.0,
                scale_max: 100.0,
                score_state: "SCORED".to_string(),
                algorithm_id: Some("garmin_health_sleep_score".to_string()),
                represented_date: s.calendar_date.unwrap_or_default(),
                measured_at_ms: end_ms,
                underlying_metrics_json: None,
                acquisition_at_ms,
                is_synthetic: false,
            });
        }
    }

    for h in hrvs {
        if let Some(avg) = h.last_night_avg.filter(|v| v.is_finite() && *v > 0.0) {
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("garmin_hrv_{}", h.summary_id),
                provider_id: HealthProviderId::Garmin,
                device_id: Some(dev_id.clone()),
                external_record_id: h.summary_id,
                metric_type: PhysiologicalMetricType::Hrv,
                value: avg,
                unit: "ms".to_string(),
                hrv_method: HrvMethod::Rmssd,
                measured_at_ms: h.start_time_in_seconds * 1000,
                period_start_ms: None,
                period_end_ms: None,
                tz_offset_secs: None,
                aggregation_method: Some("last_night_avg".to_string()),
                quality_flags: Vec::new(),
                acquisition_at_ms,
                sync_batch_id: batch_id.map(str::to_string),
                is_deleted: false,
                is_synthetic: false,
            });
        }
    }

    batch
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn garmin_stays_gated_without_commercial_approval() {
        let ctx = ProviderConfigContext {
            platform_os: "linux".into(),
            oauth_broker_url: Some("https://api.useplethora.com".into()),
            broker_configured_providers: vec!["garmin".into()],
            broker_approved_providers: vec![],
            healthkit_entitlement_enabled: false,
        };
        let connector = GarminConnector::default();
        assert_eq!(
            connector.readiness_state(&ctx),
            ProviderReadinessState::RequiresDeveloperApproval
        );
    }
}
