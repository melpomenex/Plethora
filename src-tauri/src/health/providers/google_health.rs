//! Google Health API v4 connector (`https://health.googleapis.com/v4/users/me/dataTypes/{dataType}/dataPoints`).
//!
//! IMPORTANT: Legacy Fitbit Web API endpoints (`api.fitbit.com`) were permanently retired in 2026
//! and are NEVER called here. Requires verified OAuth + annual CASA security assessment (>100 users).

use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::health::http_client::HealthHttpClient;
use crate::health::models::{
    HealthDevice, HealthProviderError, HealthProviderId, HealthProviderInfo, HrvMethod,
    PhysiologicalMetricType, PhysiologicalObservation, ProviderReadinessState, RawSleepSession,
    SleepKind, SleepStageInterval, SleepStageType,
};
use crate::health::provider::{
    CloudHealthConnector, NormalizedIngestionBatch, ProviderConfigContext,
};
use crate::health::providers::catalog::build_provider_catalog;
use crate::health::time::{elapsed_minutes, parse_timestamp_with_offset, parse_utc_offset_secs};

pub const GOOGLE_HEALTH_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const GOOGLE_HEALTH_API_BASE: &str = "https://health.googleapis.com/v4";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleDataPointsResponse {
    #[serde(default)]
    data_points: Vec<GoogleDataPoint>,
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleDataPoint {
    #[serde(alias = "id")]
    name: Option<String>,
    data_source: Option<serde_json::Value>,
    sleep: Option<GoogleSleepPayload>,
    heart_rate: Option<serde_json::Value>,
    daily_resting_heart_rate: Option<serde_json::Value>,
    heart_rate_variability: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleSleepPayload {
    interval: GoogleInterval,
    #[serde(default)]
    stages: Vec<GoogleSleepStage>,
    #[serde(rename = "type")]
    sleep_type: Option<String>,
    metadata: Option<GoogleSleepMetadata>,
    summary: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleInterval {
    start_time: String,
    end_time: String,
    start_utc_offset: Option<String>,
    end_utc_offset: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleSleepStage {
    #[serde(rename = "type")]
    stage_type: String,
    start_time: String,
    end_time: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleSleepMetadata {
    main_sleep: Option<bool>,
}

fn number(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|n: &f64| n.is_finite())
}

fn provider_filter(field: &str, start: &str, end: &str) -> String {
    format!(r#"{field} >= "{start}" AND {field} < "{end}""#)
}

pub struct GoogleHealthConnector {
    base_url: String,
    http: HealthHttpClient,
}

impl Default for GoogleHealthConnector {
    fn default() -> Self {
        Self::new(
            GOOGLE_HEALTH_API_BASE.to_string(),
            HealthHttpClient::default(),
        )
    }
}

impl GoogleHealthConnector {
    pub fn new(base_url: String, http: HealthHttpClient) -> Self {
        Self { base_url, http }
    }
}

#[async_trait::async_trait]
impl CloudHealthConnector for GoogleHealthConnector {
    fn provider_id(&self) -> HealthProviderId {
        HealthProviderId::GoogleHealth
    }

    fn provider_info(&self, ctx: &ProviderConfigContext) -> HealthProviderInfo {
        build_provider_catalog(ctx, &[])
            .into_iter()
            .find(|p| p.id == HealthProviderId::GoogleHealth)
            .expect("GoogleHealth must exist in catalog")
    }

    fn readiness_state(&self, ctx: &ProviderConfigContext) -> ProviderReadinessState {
        self.provider_info(ctx).readiness_state
    }

    fn authorize_endpoint(&self) -> &'static str {
        GOOGLE_HEALTH_AUTH_URL
    }

    fn default_scopes(&self) -> &'static [&'static str] {
        &[
            "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
            "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
        ]
    }

    async fn sync_incremental(
        &self,
        access_token: &str,
        _cursor: Option<&str>,
        start_ms: i64,
        end_ms: i64,
        batch_id: Option<&str>,
    ) -> Result<NormalizedIngestionBatch, HealthProviderError> {
        let mut batch = NormalizedIngestionBatch {
            next_cursor: Some(chrono::Utc::now().timestamp_millis().to_string()),
            ..Default::default()
        };
        let dev_id = "dev_google_health".to_string();
        batch.devices.push(HealthDevice {
            id: dev_id.clone(),
            provider_id: HealthProviderId::GoogleHealth,
            external_device_id: "google_health_v4".to_string(),
            manufacturer: Some("Google / Fitbit".to_string()),
            model: Some("Google Health v4".to_string()),
            source_app_bundle: Some("com.google.android.apps.fitness".to_string()),
            platform_source_id: Some("google_health_v4".to_string()),
            metadata_json: None,
        });

        let start = DateTime::<Utc>::from_timestamp_millis(start_ms).ok_or_else(|| {
            HealthProviderError::new("invalid_range", "Invalid Google Health start time.", false)
        })?;
        let end = DateTime::<Utc>::from_timestamp_millis(end_ms).ok_or_else(|| {
            HealthProviderError::new("invalid_range", "Invalid Google Health end time.", false)
        })?;
        let sleep_url = format!(
            "{}/users/me/dataTypes/sleep/dataPoints",
            self.base_url.trim_end_matches('/')
        );
        let sleep_points = self
            .fetch_all(
                &sleep_url,
                access_token,
                &provider_filter(
                    "sleep.interval.end_time",
                    &start.to_rfc3339(),
                    &end.to_rfc3339(),
                ),
            )
            .await?;
        let acq = chrono::Utc::now().timestamp_millis();

        for dp in sleep_points {
            let Some(sleep) = dp.sleep else { continue };
            let Ok((s_ms, parsed_s_off)) = parse_timestamp_with_offset(&sleep.interval.start_time)
            else {
                continue;
            };
            let Ok((e_ms, parsed_e_off)) = parse_timestamp_with_offset(&sleep.interval.end_time)
            else {
                continue;
            };
            let Ok(dur_mins) = elapsed_minutes(s_ms, e_ms) else {
                continue;
            };
            let s_off = sleep
                .interval
                .start_utc_offset
                .as_deref()
                .and_then(parse_utc_offset_secs)
                .or(parsed_s_off);
            let e_off = sleep
                .interval
                .end_utc_offset
                .as_deref()
                .and_then(parse_utc_offset_secs)
                .or(parsed_e_off);
            let bundle = dp.data_source.as_ref().and_then(source_bundle);
            let ext_id = dp.name.unwrap_or_else(|| {
                format!(
                    "gh_sleep_{s_ms}_{e_ms}_{}",
                    bundle.as_deref().unwrap_or_default()
                )
            });
            let raw_id = format!("gh_{ext_id}");

            let stages: Vec<SleepStageInterval> = sleep
                .stages
                .into_iter()
                .enumerate()
                .filter_map(|(i, st)| {
                    let (st_s, _) = parse_timestamp_with_offset(&st.start_time).ok()?;
                    let (st_e, _) = parse_timestamp_with_offset(&st.end_time).ok()?;
                    Some(SleepStageInterval {
                        id: format!("{raw_id}_st_{i}"),
                        raw_session_id: raw_id.clone(),
                        stage_type: SleepStageType::from_str(&st.stage_type),
                        start_at_ms: st_s,
                        end_at_ms: st_e,
                        provider_stage_code: Some(st.stage_type),
                    })
                })
                .collect();

            batch.sleep_sessions.push(RawSleepSession {
                id: raw_id,
                provider_id: HealthProviderId::GoogleHealth,
                device_id: Some(dev_id.clone()),
                external_record_id: ext_id,
                source_app_bundle: bundle,
                start_at_ms: s_ms,
                end_at_ms: e_ms,
                start_tz_offset_secs: s_off,
                end_tz_offset_secs: e_off,
                duration_mins: sleep
                    .summary
                    .as_ref()
                    .and_then(|summary| summary.get("minutesAsleep"))
                    .and_then(number)
                    .filter(|mins| *mins >= 0.0 && *mins <= dur_mins)
                    .unwrap_or(dur_mins),
                time_in_bed_mins: Some(dur_mins),
                sleep_efficiency_pct: None,
                awake_mins: None,
                light_mins: None,
                deep_mins: None,
                rem_mins: None,
                sleep_kind: match sleep.metadata.and_then(|metadata| metadata.main_sleep) {
                    Some(true) => SleepKind::MainSleep,
                    Some(false) => SleepKind::Nap,
                    None => SleepKind::Unknown,
                },
                provider_sleep_kind: sleep.sleep_type,
                quality_flags: Vec::new(),
                quality_score: 0.9,
                notes: None,
                subjective_quality: None,
                acquisition_at_ms: acq,
                sync_batch_id: batch_id.map(str::to_string),
                is_deleted: false,
                is_synthetic: false,
                stages,
            });
        }

        for (data_type, field, civil) in [
            (
                "daily-resting-heart-rate",
                "daily_resting_heart_rate.date",
                true,
            ),
            (
                "heart-rate-variability",
                "heart_rate_variability.sample_time.physical_time",
                false,
            ),
            ("heart-rate", "heart_rate.sample_time.physical_time", false),
        ] {
            let url = format!(
                "{}/users/me/dataTypes/{data_type}/dataPoints",
                self.base_url.trim_end_matches('/')
            );
            let filter = if civil {
                provider_filter(
                    field,
                    &start.date_naive().to_string(),
                    &end.date_naive()
                        .succ_opt()
                        .unwrap_or(end.date_naive())
                        .to_string(),
                )
            } else {
                provider_filter(field, &start.to_rfc3339(), &end.to_rfc3339())
            };
            let records = match self.fetch_all(&url, access_token, &filter).await {
                Ok(records) => records,
                Err(error) if error.code == "missing_scope" => {
                    batch.warnings.push(format!(
                        "Optional Google Health scope not granted for {data_type}."
                    ));
                    continue;
                }
                Err(error) => return Err(error),
            };
            for record in records {
                batch
                    .physio_observations
                    .extend(physiology(record, &dev_id, acq, batch_id));
            }
        }

        Ok(batch)
    }
}

impl GoogleHealthConnector {
    async fn fetch_all(
        &self,
        url: &str,
        token: &str,
        filter: &str,
    ) -> Result<Vec<GoogleDataPoint>, HealthProviderError> {
        self.http
            .get_pages(url, token, &[("filter", filter)], "pageToken", |body| {
                let parsed: GoogleDataPointsResponse =
                    serde_json::from_value(body).map_err(|_| {
                        HealthProviderError::new(
                            "parse_error",
                            "Invalid Google Health response.",
                            false,
                        )
                    })?;
                Ok((parsed.data_points, parsed.next_page_token))
            })
            .await
    }
}

fn source_bundle(source: &serde_json::Value) -> Option<String> {
    source
        .pointer("/application/packageName")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
}

fn physiology(
    point: GoogleDataPoint,
    device: &str,
    acquired: i64,
    batch_id: Option<&str>,
) -> Vec<PhysiologicalObservation> {
    use PhysiologicalMetricType::{HeartRate, Hrv, RestingHeartRate};
    let mut output = Vec::new();
    for (sample, metric, key, method, unit) in [
        (
            point.heart_rate.as_ref(),
            HeartRate,
            "beatsPerMinute",
            HrvMethod::Unknown,
            "bpm",
        ),
        (
            point.daily_resting_heart_rate.as_ref(),
            RestingHeartRate,
            "beatsPerMinute",
            HrvMethod::Unknown,
            "bpm",
        ),
        (
            point.heart_rate_variability.as_ref(),
            Hrv,
            "rootMeanSquareOfSuccessiveDifferencesMilliseconds",
            HrvMethod::Rmssd,
            "ms",
        ),
        (
            point.heart_rate_variability.as_ref(),
            Hrv,
            "standardDeviationMilliseconds",
            HrvMethod::Sdnn,
            "ms",
        ),
    ] {
        let Some(sample) = sample else {
            continue;
        };
        let Some(value) = sample.get(key).and_then(number) else {
            continue;
        };
        let instant = if metric == RestingHeartRate {
            // A civil-day summary has no measurement instant. Attribute it
            // at the end of the day, after its contributing samples.
            (|| {
                let date = sample.get("date")?;
                let day = chrono::NaiveDate::from_ymd_opt(
                    date.get("year")?.as_i64()?.try_into().ok()?,
                    date.get("month")?.as_u64()?.try_into().ok()?,
                    date.get("day")?.as_u64()?.try_into().ok()?,
                )?;
                Some((
                    day.and_hms_milli_opt(23, 59, 59, 999)?
                        .and_utc()
                        .timestamp_millis(),
                    Some(0),
                ))
            })()
        } else {
            sample
                .pointer("/sampleTime/physicalTime")
                .and_then(|time| time.as_str())
                .and_then(|time| parse_timestamp_with_offset(time).ok())
                .map(|(ms, parsed)| {
                    (
                        ms,
                        sample
                            .pointer("/sampleTime/utcOffset")
                            .and_then(|offset| offset.as_str())
                            .and_then(parse_utc_offset_secs)
                            .or(parsed),
                    )
                })
        };
        let Some((measured_at_ms, tz_offset_secs)) = instant else {
            continue;
        };
        let id = point
            .name
            .clone()
            .unwrap_or_else(|| format!("{}_{measured_at_ms}", metric.as_str()));
        let external_record_id = format!("{id}:{}", method.as_str());
        output.push(PhysiologicalObservation {
            id: format!("gh_{external_record_id}"),
            provider_id: HealthProviderId::GoogleHealth,
            device_id: Some(device.to_owned()),
            external_record_id,
            metric_type: metric,
            value,
            unit: unit.to_owned(),
            hrv_method: method,
            measured_at_ms,
            period_start_ms: None,
            period_end_ms: None,
            tz_offset_secs,
            aggregation_method: (metric == RestingHeartRate).then(|| "civil-day".to_owned()),
            quality_flags: Vec::new(),
            acquisition_at_ms: acquired,
            sync_batch_id: batch_id.map(str::to_owned),
            is_deleted: false,
            is_synthetic: false,
        });
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{http::StatusCode, routing::get, Json, Router};

    #[tokio::test]
    async fn google_health_v4_handles_partial_missing_scope_gracefully() {
        let app = Router::new()
            .route(
                "/users/me/dataTypes/sleep/dataPoints",
                get(|| async {
                    Json(serde_json::json!({
                        "dataPoints": [{
                            "id": "gh-s1",
                            "sleep": {
                                "interval": {
                                    "startTime": "2026-11-18T23:00:00Z",
                                    "startUtcOffset": "-14400s",
                                    "endTime": "2026-11-19T07:00:00Z",
                                    "endUtcOffset": "-14400s"
                                },
                                "stages": []
                            }
                        }]
                    }))
                }),
            )
            .route(
                "/users/me/dataTypes/daily-resting-heart-rate/dataPoints",
                get(|| async {
                    (
                        StatusCode::FORBIDDEN,
                        serde_json::json!({"error":{"status":"PERMISSION_DENIED","message":"MISSING_OAUTH_SCOPE"}}).to_string(),
                    )
                }),
            )
            .route(
                "/users/me/dataTypes/heart-rate-variability/dataPoints",
                get(|| async { Json(serde_json::json!({ "dataPoints": [{
                    "name": "hrv-1",
                    "heartRateVariability": {
                        "sampleTime": {"physicalTime": "2026-11-19T07:00:00Z", "utcOffset": "-14400s"},
                        "rootMeanSquareOfSuccessiveDifferencesMilliseconds": 42.0,
                        "standardDeviationMilliseconds": 59.0
                    }
                }] })) }),
            )
            .route("/users/me/dataTypes/heart-rate/dataPoints", get(|| async {
                Json(serde_json::json!({"dataPoints": []}))
            }));

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let conn =
            GoogleHealthConnector::new(format!("http://{addr}"), HealthHttpClient::new(true));
        let batch = conn
            .sync_incremental("tok", None, 0, 1, None)
            .await
            .unwrap();
        assert_eq!(batch.sleep_sessions.len(), 1);
        assert_eq!(batch.physio_observations.len(), 2);
        assert_eq!(batch.physio_observations[0].hrv_method, HrvMethod::Rmssd);
        assert_eq!(batch.physio_observations[1].hrv_method, HrvMethod::Sdnn);
        assert!(batch
            .warnings
            .iter()
            .any(|w| w.contains("daily-resting-heart-rate")));
    }
}
