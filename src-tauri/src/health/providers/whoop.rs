//! WHOOP Developer API v2 connector (`https://api.prod.whoop.com/developer/v2/*`).

use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::health::http_client::HealthHttpClient;
use crate::health::models::{
    HealthDataCategory, HealthDevice, HealthProviderError, HealthProviderId, HealthProviderInfo,
    HrvMethod, PhysiologicalMetricType, PhysiologicalObservation, ProviderReadinessState,
    RawSleepSession, RecoveryObservation, SleepKind, SleepQualityFlag,
};
use crate::health::provider::{
    CloudHealthConnector, NormalizedIngestionBatch, ProviderConfigContext,
};
use crate::health::providers::catalog::build_provider_catalog;
use crate::health::time::{
    elapsed_minutes, is_plausible_sleep_duration, local_date_string, parse_timestamp_with_offset,
    parse_utc_offset_secs,
};

pub const WHOOP_AUTH_URL: &str = "https://api.prod.whoop.com/oauth/oauth2/auth";
pub const WHOOP_API_BASE: &str = "https://api.prod.whoop.com/developer";

#[derive(Debug, Deserialize)]
struct WhoopPaginated<T> {
    records: Vec<T>,
    next_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WhoopSleepRecord {
    id: String,
    start: String,
    end: String,
    timezone_offset: Option<String>,
    #[serde(default)]
    nap: bool,
    score_state: Option<String>,
    score: Option<WhoopSleepScore>,
}

#[derive(Debug, Deserialize)]
struct WhoopSleepScore {
    stage_summary: Option<WhoopStageSummary>,
    respiratory_rate: Option<f64>,
    sleep_efficiency_percentage: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct WhoopStageSummary {
    total_in_bed_time_milli: Option<f64>,
    total_awake_time_milli: Option<f64>,
    total_light_sleep_time_milli: Option<f64>,
    total_slow_wave_sleep_time_milli: Option<f64>,
    total_rem_sleep_time_milli: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct WhoopRecoveryRecord {
    cycle_id: Option<serde_json::Value>,
    sleep_id: Option<String>,
    created_at: Option<String>,
    score_state: String,
    score: Option<WhoopRecoveryScore>,
}

#[derive(Debug, Deserialize)]
struct WhoopRecoveryScore {
    recovery_score: Option<f64>,
    resting_heart_rate: Option<f64>,
    hrv_rmssd_milli: Option<f64>,
    spo2_percentage: Option<f64>,
    skin_temp_celsius: Option<f64>,
}

pub struct WhoopConnector {
    base_url: String,
    http: HealthHttpClient,
}

impl Default for WhoopConnector {
    fn default() -> Self {
        Self::new(WHOOP_API_BASE.to_string(), HealthHttpClient::default())
    }
}

impl WhoopConnector {
    pub fn new(base_url: String, http: HealthHttpClient) -> Self {
        Self { base_url, http }
    }
}

#[async_trait::async_trait]
impl CloudHealthConnector for WhoopConnector {
    fn provider_id(&self) -> HealthProviderId {
        HealthProviderId::Whoop
    }

    fn provider_info(&self, ctx: &ProviderConfigContext) -> HealthProviderInfo {
        build_provider_catalog(ctx, &[])
            .into_iter()
            .find(|p| p.id == HealthProviderId::Whoop)
            .expect("WHOOP must exist in catalog")
    }

    fn readiness_state(&self, ctx: &ProviderConfigContext) -> ProviderReadinessState {
        self.provider_info(ctx).readiness_state
    }

    fn authorize_endpoint(&self) -> &'static str {
        WHOOP_AUTH_URL
    }

    fn default_scopes(&self) -> &'static [&'static str] {
        &["read:sleep", "read:recovery", "read:cycles", "offline"]
    }

    async fn sync_incremental(
        &self,
        access_token: &str,
        _cursor: Option<&str>,
        start_ms: i64,
        end_ms: i64,
        batch_id: Option<&str>,
    ) -> Result<NormalizedIngestionBatch, HealthProviderError> {
        let start_iso = DateTime::<Utc>::from_timestamp_millis(start_ms)
            .unwrap_or_else(Utc::now)
            .to_rfc3339();
        let end_iso = DateTime::<Utc>::from_timestamp_millis(end_ms)
            .unwrap_or_else(Utc::now)
            .to_rfc3339();

        let sleep_docs = self
            .fetch_paginated::<WhoopSleepRecord>(
                "/v2/activity/sleep",
                access_token,
                &start_iso,
                &end_iso,
            )
            .await?;
        let recovery_docs = self
            .fetch_paginated::<WhoopRecoveryRecord>(
                "/v2/recovery",
                access_token,
                &start_iso,
                &end_iso,
            )
            .await?;

        normalize_whoop_records(
            sleep_docs,
            recovery_docs,
            chrono::Utc::now().timestamp_millis(),
            batch_id,
        )
    }
}

impl WhoopConnector {
    async fn fetch_paginated<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        token: &str,
        start_iso: &str,
        end_iso: &str,
    ) -> Result<Vec<T>, HealthProviderError> {
        let url = format!("{}{}", self.base_url.trim_end_matches('/'), path);
        self.http
            .get_pages(
                &url,
                token,
                &[("start", start_iso), ("end", end_iso), ("limit", "25")],
                "nextToken",
                |body| {
                    let page: WhoopPaginated<T> = serde_json::from_value(body).map_err(|_| {
                        HealthProviderError::new("parse_error", "Invalid Whoop response.", false)
                    })?;
                    Ok((page.records, page.next_token))
                },
            )
            .await
    }
}

fn normalize_whoop_records(
    sleep_docs: Vec<WhoopSleepRecord>,
    recovery_docs: Vec<WhoopRecoveryRecord>,
    acquisition_at_ms: i64,
    batch_id: Option<&str>,
) -> Result<NormalizedIngestionBatch, HealthProviderError> {
    let mut batch = NormalizedIngestionBatch {
        next_cursor: Some(acquisition_at_ms.to_string()),
        ..Default::default()
    };

    let dev_id = "dev_whoop_strap".to_string();
    batch.devices.push(HealthDevice {
        id: dev_id.clone(),
        provider_id: HealthProviderId::Whoop,
        external_device_id: "whoop_device".to_string(),
        manufacturer: Some("WHOOP".to_string()),
        model: Some("WHOOP Sensor".to_string()),
        source_app_bundle: Some("com.whoop.whoop".to_string()),
        platform_source_id: Some("whoop_api_v2".to_string()),
        metadata_json: None,
    });

    for doc in sleep_docs {
        let Ok((start_ms, parsed_s_off)) = parse_timestamp_with_offset(&doc.start) else {
            continue;
        };
        let Ok((end_ms, parsed_e_off)) = parse_timestamp_with_offset(&doc.end) else {
            continue;
        };
        let Ok(span_mins) = elapsed_minutes(start_ms, end_ms) else {
            continue;
        };

        let explicit_off = doc
            .timezone_offset
            .as_deref()
            .and_then(parse_utc_offset_secs);
        let tz_off = explicit_off.or(parsed_e_off).or(parsed_s_off);

        let stage_sum = doc.score.as_ref().and_then(|s| s.stage_summary.as_ref());
        let light_mins = stage_sum
            .and_then(|s| s.total_light_sleep_time_milli)
            .map(|m| m / 60_000.0);
        let deep_mins = stage_sum
            .and_then(|s| s.total_slow_wave_sleep_time_milli)
            .map(|m| m / 60_000.0);
        let rem_mins = stage_sum
            .and_then(|s| s.total_rem_sleep_time_milli)
            .map(|m| m / 60_000.0);
        let awake_mins = stage_sum
            .and_then(|s| s.total_awake_time_milli)
            .map(|m| m / 60_000.0);
        let tib_mins = stage_sum
            .and_then(|s| s.total_in_bed_time_milli)
            .map(|m| m / 60_000.0)
            .or(Some(span_mins));

        let total_sleep_mins = match (light_mins, deep_mins, rem_mins) {
            (Some(l), Some(d), Some(r)) if l + d + r > 0.0 => l + d + r,
            _ => span_mins,
        };

        let mut flags = vec![SleepQualityFlag::AggregateStageDurationsOnly];
        if !is_plausible_sleep_duration(total_sleep_mins) {
            flags.push(SleepQualityFlag::ImplausibleDuration);
        }

        batch.sleep_sessions.push(RawSleepSession {
            id: format!("whoop_{}", doc.id),
            provider_id: HealthProviderId::Whoop,
            device_id: Some(dev_id.clone()),
            external_record_id: doc.id.clone(),
            source_app_bundle: Some("com.whoop.whoop".to_string()),
            start_at_ms: start_ms,
            end_at_ms: end_ms,
            start_tz_offset_secs: tz_off,
            end_tz_offset_secs: tz_off,
            duration_mins: total_sleep_mins,
            time_in_bed_mins: tib_mins,
            sleep_efficiency_pct: doc
                .score
                .as_ref()
                .and_then(|s| s.sleep_efficiency_percentage),
            awake_mins,
            light_mins,
            deep_mins,
            rem_mins,
            sleep_kind: if doc.nap {
                SleepKind::Nap
            } else {
                SleepKind::MainSleep
            },
            provider_sleep_kind: Some(if doc.nap { "nap" } else { "sleep" }.to_string()),
            quality_flags: flags,
            quality_score: 0.94,
            notes: None,
            subjective_quality: None,
            acquisition_at_ms,
            sync_batch_id: batch_id.map(str::to_string),
            is_deleted: false,
            is_synthetic: false,
            // WHOOP v2 does not expose timestamped hypnogram intervals — NEVER synthesize fake intervals
            stages: Vec::new(),
        });

        if let Some(rr) = doc
            .score
            .as_ref()
            .and_then(|s| s.respiratory_rate)
            .filter(|v| v.is_finite() && *v > 0.0)
        {
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("whoop_rr_{}", doc.id),
                provider_id: HealthProviderId::Whoop,
                device_id: Some(dev_id.clone()),
                external_record_id: format!("rr_{}", doc.id),
                metric_type: PhysiologicalMetricType::RespiratoryRate,
                value: rr,
                unit: "brpm".to_string(),
                hrv_method: HrvMethod::Unknown,
                measured_at_ms: end_ms,
                period_start_ms: Some(start_ms),
                period_end_ms: Some(end_ms),
                tz_offset_secs: tz_off,
                aggregation_method: Some("sleep_mean".to_string()),
                quality_flags: Vec::new(),
                acquisition_at_ms,
                sync_batch_id: batch_id.map(str::to_string),
                is_deleted: false,
                is_synthetic: false,
            });
        }
    }

    for rec in recovery_docs {
        let rec_id = rec
            .sleep_id
            .clone()
            .or_else(|| rec.cycle_id.as_ref().map(|v| v.to_string()))
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let ts_ms = rec
            .created_at
            .as_deref()
            .and_then(|t| parse_timestamp_with_offset(t).ok().map(|(m, _)| m))
            .unwrap_or(acquisition_at_ms);
        let scored = rec.score_state.eq_ignore_ascii_case("SCORED");
        let score_val = if scored {
            rec.score.as_ref().and_then(|s| s.recovery_score)
        } else {
            None
        };

        batch.recovery_observations.push(RecoveryObservation {
            id: format!("whoop_rec_{rec_id}"),
            provider_id: HealthProviderId::Whoop,
            external_record_id: format!("recovery_{rec_id}"),
            score_name: "WHOOP Recovery Score".to_string(),
            score_value: score_val,
            scale_min: 0.0,
            scale_max: 100.0,
            score_state: rec.score_state.clone(),
            algorithm_id: Some("whoop_v2_recovery".to_string()),
            represented_date: local_date_string(ts_ms, None),
            measured_at_ms: ts_ms,
            underlying_metrics_json: None,
            acquisition_at_ms,
            is_synthetic: false,
        });

        if scored {
            if let Some(score) = rec.score {
                if let Some(hrv) = score
                    .hrv_rmssd_milli
                    .filter(|v| v.is_finite() && *v > 0.0 && *v <= 500.0)
                {
                    batch.physio_observations.push(PhysiologicalObservation {
                        id: format!("whoop_hrv_{rec_id}"),
                        provider_id: HealthProviderId::Whoop,
                        device_id: Some(dev_id.clone()),
                        external_record_id: format!("hrv_{rec_id}"),
                        metric_type: PhysiologicalMetricType::Hrv,
                        value: hrv,
                        unit: "ms".to_string(),
                        hrv_method: HrvMethod::Rmssd,
                        measured_at_ms: ts_ms,
                        period_start_ms: None,
                        period_end_ms: None,
                        tz_offset_secs: None,
                        aggregation_method: Some("recovery_rmssd".to_string()),
                        quality_flags: Vec::new(),
                        acquisition_at_ms,
                        sync_batch_id: batch_id.map(str::to_string),
                        is_deleted: false,
                        is_synthetic: false,
                    });
                }
                if let Some(rhr) = score
                    .resting_heart_rate
                    .filter(|v| v.is_finite() && *v >= 25.0 && *v <= 220.0)
                {
                    batch.physio_observations.push(PhysiologicalObservation {
                        id: format!("whoop_rhr_{rec_id}"),
                        provider_id: HealthProviderId::Whoop,
                        device_id: Some(dev_id.clone()),
                        external_record_id: format!("rhr_{rec_id}"),
                        metric_type: PhysiologicalMetricType::RestingHeartRate,
                        value: rhr,
                        unit: "bpm".to_string(),
                        hrv_method: HrvMethod::Unknown,
                        measured_at_ms: ts_ms,
                        period_start_ms: None,
                        period_end_ms: None,
                        tz_offset_secs: None,
                        aggregation_method: Some("recovery_rhr".to_string()),
                        quality_flags: Vec::new(),
                        acquisition_at_ms,
                        sync_batch_id: batch_id.map(str::to_string),
                        is_deleted: false,
                        is_synthetic: false,
                    });
                }
            }
        }
    }

    Ok(batch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::StatusCode, routing::get, Json, Router};

    #[tokio::test]
    async fn whoop_contract_test_never_synthesizes_intervals_and_respects_unscored() {
        let app = Router::new()
            .route(
                "/v2/activity/sleep",
                get(|| async {
                    Json(serde_json::json!({
                        "records": [{
                            "id": "ecfc6a15-4661-442f-a9a4-f160dd7afae8",
                            "start": "2026-11-18T23:18:00.000Z",
                            "end": "2026-11-19T06:51:00.000Z",
                            "timezone_offset": "-05:00",
                            "nap": false,
                            "score_state": "SCORED",
                            "score": {
                                "stage_summary": {
                                    "total_in_bed_time_milli": 27180000.0,
                                    "total_awake_time_milli": 1380000.0,
                                    "total_light_sleep_time_milli": 13560000.0,
                                    "total_slow_wave_sleep_time_milli": 6120000.0,
                                    "total_rem_sleep_time_milli": 6120000.0
                                },
                                "respiratory_rate": 15.8,
                                "sleep_efficiency_percentage": 94.9
                            }
                        }],
                        "next_token": null
                    }))
                }),
            )
            .route(
                "/v2/recovery",
                get(|| async {
                    Json(serde_json::json!({
                        "records": [
                            {
                                "sleep_id": "ecfc6a15-4661-442f-a9a4-f160dd7afae8",
                                "created_at": "2026-11-19T07:00:00Z",
                                "score_state": "SCORED",
                                "score": {
                                    "recovery_score": 76.0,
                                    "resting_heart_rate": 54.0,
                                    "hrv_rmssd_milli": 48.5
                                }
                            },
                            {
                                "sleep_id": "pending-1",
                                "created_at": "2026-11-20T07:00:00Z",
                                "score_state": "PENDING_SCORE",
                                "score": { "recovery_score": 99.0 }
                            }
                        ]
                    }))
                }),
            );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let conn = WhoopConnector::new(format!("http://{addr}"), HealthHttpClient::new(true));
        let batch = conn
            .sync_incremental("tok", None, 1_763_400_000_000, 1_763_600_000_000, None)
            .await
            .unwrap();
        assert_eq!(batch.sleep_sessions.len(), 1);
        assert!(batch.sleep_sessions[0].stages.is_empty());
        assert!(batch.sleep_sessions[0]
            .quality_flags
            .contains(&SleepQualityFlag::AggregateStageDurationsOnly));
        assert_eq!(batch.recovery_observations.len(), 2);
        assert_eq!(batch.recovery_observations[0].score_value, Some(76.0));
        assert_eq!(batch.recovery_observations[1].score_value, None);

        // Revoked token -> permission_revoked
        let revoked_app = Router::new().route(
            "/v2/activity/sleep",
            get(|| async { StatusCode::UNAUTHORIZED }),
        );
        let l2 = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let a2 = l2.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(l2, revoked_app).await.unwrap() });
        let conn2 = WhoopConnector::new(format!("http://{a2}"), HealthHttpClient::new(true));
        let err = conn2
            .sync_incremental("bad", None, 1_763_400_000_000, 1_763_600_000_000, None)
            .await
            .unwrap_err();
        assert_eq!(err.code, "permission_revoked");
    }
}
