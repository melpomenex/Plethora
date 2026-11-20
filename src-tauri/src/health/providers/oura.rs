//! Oura Cloud API v2 connector (`https://api.ouraring.com/v2/usercollection/*`).

use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::health::http_client::HealthHttpClient;
use crate::health::models::{
    HealthDataCategory, HealthDevice, HealthProviderError, HealthProviderId, HealthProviderInfo,
    HrvMethod, PhysiologicalMetricType, PhysiologicalObservation, ProviderReadinessState,
    RawSleepSession, RecoveryObservation, SleepKind, SleepQualityFlag, SleepStageInterval,
    SleepStageType,
};
use crate::health::provider::{
    CloudHealthConnector, NormalizedIngestionBatch, ProviderConfigContext,
};
use crate::health::providers::catalog::build_provider_catalog;
use crate::health::time::{
    elapsed_minutes, is_plausible_sleep_duration, parse_timestamp_with_offset,
};

pub const OURA_AUTH_URL: &str = "https://cloud.ouraring.com/oauth/authorize";
pub const OURA_API_BASE: &str = "https://api.ouraring.com";

#[derive(Debug, Deserialize)]
struct OuraListResponse<T> {
    data: Vec<T>,
    next_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OuraSleepDoc {
    id: String,
    day: Option<String>,
    bedtime_start: String,
    bedtime_end: String,
    #[serde(rename = "type")]
    sleep_type: Option<String>,
    sleep_phase_5_min: Option<String>,
    average_hrv: Option<f64>,
    lowest_heart_rate: Option<f64>,
    efficiency: Option<f64>,
    time_in_bed: Option<f64>,
    total_sleep_duration: Option<f64>,
    awake_time: Option<f64>,
    light_sleep_duration: Option<f64>,
    deep_sleep_duration: Option<f64>,
    rem_sleep_duration: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct OuraReadinessDoc {
    id: String,
    day: String,
    score: Option<f64>,
    temperature_deviation: Option<f64>,
    contributors: Option<serde_json::Value>,
    timestamp: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OuraHeartRateDoc {
    bpm: f64,
    source: Option<String>,
    timestamp: String,
}

pub struct OuraConnector {
    base_url: String,
    http: HealthHttpClient,
}

impl Default for OuraConnector {
    fn default() -> Self {
        Self::new(OURA_API_BASE.to_string(), HealthHttpClient::default())
    }
}

impl OuraConnector {
    pub fn new(base_url: String, http: HealthHttpClient) -> Self {
        Self { base_url, http }
    }
}

#[async_trait::async_trait]
impl CloudHealthConnector for OuraConnector {
    fn provider_id(&self) -> HealthProviderId {
        HealthProviderId::Oura
    }

    fn provider_info(&self, ctx: &ProviderConfigContext) -> HealthProviderInfo {
        build_provider_catalog(ctx, &[])
            .into_iter()
            .find(|p| p.id == HealthProviderId::Oura)
            .expect("Oura must exist in catalog")
    }

    fn readiness_state(&self, ctx: &ProviderConfigContext) -> ProviderReadinessState {
        self.provider_info(ctx).readiness_state
    }

    fn authorize_endpoint(&self) -> &'static str {
        OURA_AUTH_URL
    }

    fn default_scopes(&self) -> &'static [&'static str] {
        &["daily", "heartrate", "personal"]
    }

    async fn sync_incremental(
        &self,
        access_token: &str,
        _cursor: Option<&str>,
        start_ms: i64,
        end_ms: i64,
        batch_id: Option<&str>,
    ) -> Result<NormalizedIngestionBatch, HealthProviderError> {
        let start_date = DateTime::<Utc>::from_timestamp_millis(start_ms)
            .unwrap_or_else(Utc::now)
            .format("%Y-%m-%d")
            .to_string();
        let end_date = DateTime::<Utc>::from_timestamp_millis(end_ms)
            .unwrap_or_else(Utc::now)
            .format("%Y-%m-%d")
            .to_string();

        let sleep_docs = self
            .fetch_paginated::<OuraSleepDoc>(
                "/v2/usercollection/sleep",
                access_token,
                &[("start_date", &start_date), ("end_date", &end_date)],
            )
            .await?;

        let mut warnings = Vec::new();
        let readiness_docs = match self
            .fetch_paginated::<OuraReadinessDoc>(
                "/v2/usercollection/daily_readiness",
                access_token,
                &[("start_date", &start_date), ("end_date", &end_date)],
            )
            .await
        {
            Ok(records) => records,
            Err(error) if matches!(error.code.as_str(), "forbidden" | "missing_scope") => {
                warnings.push("Oura readiness data permission was not granted.".into());
                Vec::new()
            }
            Err(error) => return Err(error),
        };

        let start_iso = DateTime::<Utc>::from_timestamp_millis(start_ms)
            .unwrap_or_else(Utc::now)
            .to_rfc3339();
        let end_iso = DateTime::<Utc>::from_timestamp_millis(end_ms)
            .unwrap_or_else(Utc::now)
            .to_rfc3339();
        let hr_docs = match self
            .fetch_paginated::<OuraHeartRateDoc>(
                "/v2/usercollection/heartrate",
                access_token,
                &[("start_datetime", &start_iso), ("end_datetime", &end_iso)],
            )
            .await
        {
            Ok(records) => records,
            Err(error) if matches!(error.code.as_str(), "forbidden" | "missing_scope") => {
                warnings.push("Oura heart rate permission was not granted.".into());
                Vec::new()
            }
            Err(error) => return Err(error),
        };

        let mut batch = normalize_oura_records(
            sleep_docs,
            readiness_docs,
            hr_docs,
            chrono::Utc::now().timestamp_millis(),
            batch_id,
        )?;
        batch.warnings.extend(warnings);
        Ok(batch)
    }
}

impl OuraConnector {
    async fn fetch_paginated<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        token: &str,
        base_query: &[(&str, &str)],
    ) -> Result<Vec<T>, HealthProviderError> {
        let url = format!("{}{}", self.base_url.trim_end_matches('/'), path);
        self.http
            .get_pages(&url, token, base_query, "next_token", |body| {
                let page: OuraListResponse<T> = serde_json::from_value(body).map_err(|_| {
                    HealthProviderError::new("parse_error", "Invalid Oura response.", false)
                })?;
                Ok((page.data, page.next_token))
            })
            .await
    }
}

fn normalize_oura_records(
    sleep_docs: Vec<OuraSleepDoc>,
    readiness_docs: Vec<OuraReadinessDoc>,
    hr_docs: Vec<OuraHeartRateDoc>,
    acquisition_at_ms: i64,
    batch_id: Option<&str>,
) -> Result<NormalizedIngestionBatch, HealthProviderError> {
    let mut batch = NormalizedIngestionBatch {
        next_cursor: Some(acquisition_at_ms.to_string()),
        ..Default::default()
    };

    let dev_id = "dev_oura_ring".to_string();
    batch.devices.push(HealthDevice {
        id: dev_id.clone(),
        provider_id: HealthProviderId::Oura,
        external_device_id: "oura_ring".to_string(),
        manufacturer: Some("Oura".to_string()),
        model: Some("Oura Ring".to_string()),
        source_app_bundle: Some("com.ouraring.oura".to_string()),
        platform_source_id: Some("oura_cloud_v2".to_string()),
        metadata_json: None,
    });

    for doc in sleep_docs {
        let Ok((start_ms, start_off)) = parse_timestamp_with_offset(&doc.bedtime_start) else {
            continue;
        };
        let Ok((end_ms, end_off)) = parse_timestamp_with_offset(&doc.bedtime_end) else {
            continue;
        };
        let Ok(span_mins) = elapsed_minutes(start_ms, end_ms) else {
            continue;
        };

        let raw_id = format!("oura_{}", doc.id);
        let stages =
            parse_oura_hypnogram(&raw_id, start_ms, end_ms, doc.sleep_phase_5_min.as_deref());

        let sleep_kind = match doc.sleep_type.as_deref() {
            Some("long_sleep") => SleepKind::MainSleep,
            Some("nap") | Some("late_nap") | Some("rest") => SleepKind::Nap,
            _ if span_mins < 180.0 => SleepKind::Nap,
            _ => SleepKind::MainSleep,
        };

        let total_sleep_mins = doc
            .total_sleep_duration
            .map(|s| s / 60.0)
            .filter(|v| *v > 0.0)
            .unwrap_or(span_mins);
        let tib_mins = doc.time_in_bed.map(|s| s / 60.0).or(Some(span_mins));

        let mut flags = Vec::new();
        if !is_plausible_sleep_duration(total_sleep_mins) {
            flags.push(SleepQualityFlag::ImplausibleDuration);
        }

        batch.sleep_sessions.push(RawSleepSession {
            id: raw_id,
            provider_id: HealthProviderId::Oura,
            device_id: Some(dev_id.clone()),
            external_record_id: doc.id.clone(),
            source_app_bundle: Some("com.ouraring.oura".to_string()),
            start_at_ms: start_ms,
            end_at_ms: end_ms,
            start_tz_offset_secs: start_off,
            end_tz_offset_secs: end_off,
            duration_mins: total_sleep_mins,
            time_in_bed_mins: tib_mins,
            sleep_efficiency_pct: doc.efficiency,
            awake_mins: doc.awake_time.map(|s| s / 60.0),
            light_mins: doc.light_sleep_duration.map(|s| s / 60.0),
            deep_mins: doc.deep_sleep_duration.map(|s| s / 60.0),
            rem_mins: doc.rem_sleep_duration.map(|s| s / 60.0),
            sleep_kind,
            provider_sleep_kind: doc.sleep_type,
            quality_flags: flags,
            quality_score: 0.96,
            notes: None,
            subjective_quality: None,
            acquisition_at_ms,
            sync_batch_id: batch_id.map(str::to_string),
            is_deleted: false,
            is_synthetic: false,
            stages,
        });

        if let Some(hrv) = doc
            .average_hrv
            .filter(|v| v.is_finite() && *v > 0.0 && *v <= 500.0)
        {
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("oura_hrv_{}", doc.id),
                provider_id: HealthProviderId::Oura,
                device_id: Some(dev_id.clone()),
                external_record_id: format!("sleep_hrv_{}", doc.id),
                metric_type: PhysiologicalMetricType::Hrv,
                value: hrv,
                unit: "ms".to_string(),
                hrv_method: HrvMethod::Rmssd,
                measured_at_ms: end_ms,
                period_start_ms: Some(start_ms),
                period_end_ms: Some(end_ms),
                tz_offset_secs: end_off,
                aggregation_method: Some("sleep_average".to_string()),
                quality_flags: Vec::new(),
                acquisition_at_ms,
                sync_batch_id: batch_id.map(str::to_string),
                is_deleted: false,
                is_synthetic: false,
            });
        }

        if let Some(rhr) = doc
            .lowest_heart_rate
            .filter(|v| v.is_finite() && *v >= 25.0 && *v <= 220.0)
        {
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("oura_rhr_{}", doc.id),
                provider_id: HealthProviderId::Oura,
                device_id: Some(dev_id.clone()),
                external_record_id: format!("sleep_rhr_{}", doc.id),
                metric_type: PhysiologicalMetricType::RestingHeartRate,
                value: rhr,
                unit: "bpm".to_string(),
                hrv_method: HrvMethod::Unknown,
                measured_at_ms: end_ms,
                period_start_ms: Some(start_ms),
                period_end_ms: Some(end_ms),
                tz_offset_secs: end_off,
                aggregation_method: Some("sleep_lowest".to_string()),
                quality_flags: Vec::new(),
                acquisition_at_ms,
                sync_batch_id: batch_id.map(str::to_string),
                is_deleted: false,
                is_synthetic: false,
            });
        }
    }

    for r in readiness_docs {
        let ts_ms = r
            .timestamp
            .as_deref()
            .and_then(|t| parse_timestamp_with_offset(t).ok().map(|(m, _)| m))
            .unwrap_or(acquisition_at_ms);

        batch.recovery_observations.push(RecoveryObservation {
            id: format!("oura_rec_{}", r.id),
            provider_id: HealthProviderId::Oura,
            external_record_id: r.id.clone(),
            score_name: "Oura Readiness Score".to_string(),
            score_value: r.score,
            scale_min: 0.0,
            scale_max: 100.0,
            score_state: if r.score.is_some() {
                "SCORED".to_string()
            } else {
                "UNSCORED".to_string()
            },
            algorithm_id: Some("oura_v2_daily_readiness".to_string()),
            represented_date: r.day,
            measured_at_ms: ts_ms,
            underlying_metrics_json: r.contributors.map(|c| c.to_string()),
            acquisition_at_ms,
            is_synthetic: false,
        });

        if let Some(temp) = r.temperature_deviation.filter(|v| v.is_finite()) {
            batch.physio_observations.push(PhysiologicalObservation {
                id: format!("oura_temp_{}", r.id),
                provider_id: HealthProviderId::Oura,
                device_id: Some(dev_id.clone()),
                external_record_id: format!("temp_{}", r.id),
                metric_type: PhysiologicalMetricType::SkinTempDeviation,
                value: temp,
                unit: "C".to_string(),
                hrv_method: HrvMethod::Unknown,
                measured_at_ms: ts_ms,
                period_start_ms: None,
                period_end_ms: None,
                tz_offset_secs: None,
                aggregation_method: Some("daily_deviation".to_string()),
                quality_flags: Vec::new(),
                acquisition_at_ms,
                sync_batch_id: batch_id.map(str::to_string),
                is_deleted: false,
                is_synthetic: false,
            });
        }
    }

    for (idx, h) in hr_docs.into_iter().enumerate() {
        if !h.bpm.is_finite() || h.bpm <= 0.0 || h.bpm > 260.0 {
            continue;
        }
        let Ok((ts_ms, tz_off)) = parse_timestamp_with_offset(&h.timestamp) else {
            continue;
        };
        batch.physio_observations.push(PhysiologicalObservation {
            id: format!("oura_hr_{ts_ms}_{idx}"),
            provider_id: HealthProviderId::Oura,
            device_id: Some(dev_id.clone()),
            external_record_id: format!("hr_{ts_ms}"),
            metric_type: PhysiologicalMetricType::HeartRate,
            value: h.bpm,
            unit: "bpm".to_string(),
            hrv_method: HrvMethod::Unknown,
            measured_at_ms: ts_ms,
            period_start_ms: None,
            period_end_ms: None,
            tz_offset_secs: tz_off,
            aggregation_method: h.source,
            quality_flags: Vec::new(),
            acquisition_at_ms,
            sync_batch_id: batch_id.map(str::to_string),
            is_deleted: false,
            is_synthetic: false,
        });
    }

    Ok(batch)
}

/// Oura `sleep_phase_5_min`: `1`=Awake, `2`=Light, `3`=Deep, `4`=REM.
pub fn parse_oura_hypnogram(
    raw_session_id: &str,
    bedtime_start_ms: i64,
    bedtime_end_ms: i64,
    phase_str: Option<&str>,
) -> Vec<SleepStageInterval> {
    let Some(s) = phase_str.map(str::trim).filter(|v| !v.is_empty()) else {
        return Vec::new();
    };
    let epoch_ms = 5 * 60_000_i64;
    let mut intervals = Vec::new();
    for (idx, ch) in s.chars().enumerate() {
        let start = bedtime_start_ms + (idx as i64) * epoch_ms;
        if start >= bedtime_end_ms {
            break;
        }
        let end = (start + epoch_ms).min(bedtime_end_ms);
        let stage = match ch {
            '1' => SleepStageType::Awake,
            '2' => SleepStageType::Light,
            '3' => SleepStageType::Deep,
            '4' => SleepStageType::Rem,
            _ => SleepStageType::Unknown,
        };
        intervals.push(SleepStageInterval {
            id: format!("{raw_session_id}_p5_{idx}"),
            raw_session_id: raw_session_id.to_string(),
            stage_type: stage,
            start_at_ms: start,
            end_at_ms: end,
            provider_stage_code: Some(ch.to_string()),
        });
    }
    intervals
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::Query, http::StatusCode, routing::get, Json, Router};
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    #[tokio::test]
    async fn oura_contract_test_pagination_rate_limit_and_hypnogram() {
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_sleep = calls.clone();

        let app = Router::new()
            .route(
                "/v2/usercollection/sleep",
                get(
                    move |Query(params): Query<std::collections::HashMap<String, String>>| {
                        let count = calls_sleep.fetch_add(1, Ordering::SeqCst);
                        async move {
                            if count == 0 {
                                return (
                                    StatusCode::TOO_MANY_REQUESTS,
                                    [("retry-after", "0")],
                                    Json(serde_json::json!({ "error": "rate_limited" })),
                                )
                                    .into_response();
                            }
                            if params.get("next_token").map(String::as_str) == Some("page2") {
                                return Json(serde_json::json!({
                                    "data": [{
                                        "id": "oura-nap-1",
                                        "bedtime_start": "2026-11-19T14:00:00Z",
                                        "bedtime_end": "2026-11-19T14:30:00Z",
                                        "type": "nap",
                                        "total_sleep_duration": 1800
                                    }],
                                    "next_token": null
                                }))
                                .into_response();
                            }
                            Json(serde_json::json!({
                                "data": [{
                                    "id": "oura-night-1",
                                    "bedtime_start": "2026-11-18T23:00:00-05:00",
                                    "bedtime_end": "2026-11-19T07:00:00-05:00",
                                    "type": "long_sleep",
                                    "sleep_phase_5_min": "1223344",
                                    "average_hrv": 49.0,
                                    "lowest_heart_rate": 51.0,
                                    "efficiency": 92.0
                                }],
                                "next_token": "page2"
                            }))
                            .into_response()
                        }
                    },
                ),
            )
            .route(
                "/v2/usercollection/daily_readiness",
                get(|| async {
                    Json(serde_json::json!({
                        "data": [{
                            "id": "r-1",
                            "day": "2026-11-19",
                            "score": 84.0,
                            "temperature_deviation": 0.12
                        }],
                        "next_token": null
                    }))
                }),
            )
            .route(
                "/v2/usercollection/heartrate",
                get(|| async { Json(serde_json::json!({ "data": [], "next_token": null })) }),
            );

        use axum::response::IntoResponse;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let conn = OuraConnector::new(format!("http://{addr}"), HealthHttpClient::new(true));
        let batch = conn
            .sync_incremental("tok", None, 1_763_400_000_000, 1_763_600_000_000, None)
            .await
            .unwrap();
        assert_eq!(batch.sleep_sessions.len(), 2);
        assert_eq!(batch.sleep_sessions[0].stages.len(), 7);
        assert_eq!(
            batch.sleep_sessions[0].stages[3].stage_type,
            SleepStageType::Deep
        );
        assert_eq!(batch.sleep_sessions[1].sleep_kind, SleepKind::Nap);
        assert_eq!(batch.recovery_observations.len(), 1);
    }
}
