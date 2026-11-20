//! Rust normalization & sync adapter for native Android Health Connect payloads.

use std::collections::HashMap;

use serde::Deserialize;

use super::models::{
    HealthDataCategory, HealthDevice, HealthProviderError, HealthProviderId, HrvMethod,
    PhysiologicalMetricType, PhysiologicalObservation, RawSleepSession, SleepKind,
    SleepQualityFlag, SleepStageInterval, SleepStageType,
};
use super::provider::{NativeHealthAdapter, NormalizedIngestionBatch};
use super::reconciliation::normalize_stage_intervals;
use super::time::is_plausible_sleep_duration;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthConnectPayload {
    #[serde(default)]
    pub sleep_sessions: Vec<HcSleepRecord>,
    #[serde(default)]
    pub physio_records: Vec<HcPhysioRecord>,
    #[serde(default)]
    pub deleted_ids: Vec<String>,
    pub next_changes_token: Option<String>,
    #[serde(default)]
    pub changes_token_expired: bool,
    #[serde(default)]
    pub has_history_permission: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HcSleepRecord {
    pub id: String,
    pub data_origin_package: Option<String>,
    pub device_manufacturer: Option<String>,
    pub device_model: Option<String>,
    pub start_at_ms: i64,
    pub end_at_ms: i64,
    pub start_zone_offset_secs: Option<i32>,
    pub end_zone_offset_secs: Option<i32>,
    pub notes: Option<String>,
    #[serde(default)]
    pub stages: Vec<HcStage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HcStage {
    pub stage_type: String,
    pub provider_stage_code: Option<String>,
    pub start_at_ms: i64,
    pub end_at_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HcPhysioRecord {
    pub id: String,
    pub data_origin_package: Option<String>,
    pub device_manufacturer: Option<String>,
    pub device_model: Option<String>,
    pub metric_type: String,
    pub value: f64,
    pub unit: String,
    pub hrv_method: Option<String>,
    pub measured_at_ms: i64,
    pub period_start_ms: Option<i64>,
    pub period_end_ms: Option<i64>,
    pub tz_offset_secs: Option<i32>,
}

pub struct HealthConnectAdapter;

impl NativeHealthAdapter for HealthConnectAdapter {
    fn provider_id(&self) -> HealthProviderId {
        HealthProviderId::AndroidHealthConnect
    }

    fn supported_categories(&self) -> &'static [HealthDataCategory] {
        &[
            HealthDataCategory::Sleep,
            HealthDataCategory::SleepStages,
            HealthDataCategory::HeartRate,
            HealthDataCategory::RestingHeartRate,
            HealthDataCategory::Hrv,
            HealthDataCategory::Activity,
        ]
    }

    fn normalize_sleep_payload(
        &self,
        raw: &serde_json::Value,
        acquisition_at_ms: i64,
        batch_id: Option<&str>,
    ) -> Result<NormalizedIngestionBatch, HealthProviderError> {
        let payload: HealthConnectPayload = serde_json::from_value(raw.clone()).map_err(|e| {
            HealthProviderError::new(
                "parse_error",
                format!("Invalid Health Connect payload: {e}"),
                false,
            )
        })?;
        Ok(normalize_healthconnect_payload(
            payload,
            acquisition_at_ms,
            batch_id,
        ))
    }

    fn normalize_physio_payload(
        &self,
        raw: &serde_json::Value,
        acquisition_at_ms: i64,
        batch_id: Option<&str>,
    ) -> Result<NormalizedIngestionBatch, HealthProviderError> {
        self.normalize_sleep_payload(raw, acquisition_at_ms, batch_id)
    }
}

pub fn normalize_healthconnect_payload(
    payload: HealthConnectPayload,
    acquisition_at_ms: i64,
    batch_id: Option<&str>,
) -> NormalizedIngestionBatch {
    let mut batch = NormalizedIngestionBatch {
        next_cursor: if payload.changes_token_expired {
            None
        } else {
            payload.next_changes_token
        },
        deleted_sleep_external_ids: payload.deleted_ids.clone(),
        deleted_physio_external_ids: payload.deleted_ids,
        history_limit_days: if payload.has_history_permission {
            None
        } else {
            Some(30)
        },
        ..Default::default()
    };

    if payload.changes_token_expired {
        batch.warnings.push(
            "Health Connect changes token expired; incremental cursor cleared for bounded re-sync"
                .to_string(),
        );
    }
    if !payload.has_history_permission {
        batch.warnings.push(
            "READ_HEALTH_DATA_HISTORY not granted; Health Connect access is limited to the last 30 days"
                .to_string(),
        );
    }

    let mut devices: HashMap<String, HealthDevice> = HashMap::new();

    for rec in payload.sleep_sessions {
        if rec.end_at_ms <= rec.start_at_ms {
            continue;
        }
        let pkg = rec
            .data_origin_package
            .clone()
            .unwrap_or_else(|| "android.healthconnect".to_string());
        let dev_id = register_hc_device(
            &mut devices,
            &pkg,
            rec.device_manufacturer.clone(),
            rec.device_model.clone(),
        );

        let raw_id = format!("hc_{}", rec.id);
        let stages = normalize_stage_intervals(
            rec.stages
                .into_iter()
                .enumerate()
                .map(|(i, s)| SleepStageInterval {
                    id: format!("{raw_id}_st_{i}"),
                    raw_session_id: raw_id.clone(),
                    stage_type: SleepStageType::from_str(&s.stage_type),
                    start_at_ms: s.start_at_ms,
                    end_at_ms: s.end_at_ms,
                    provider_stage_code: s.provider_stage_code,
                })
                .collect(),
        );

        let span_mins = (rec.end_at_ms - rec.start_at_ms) as f64 / 60_000.0;
        let asleep_ms: i64 = stages
            .iter()
            .filter(|s| s.stage_type.counts_as_asleep())
            .map(|s| s.end_at_ms - s.start_at_ms)
            .sum();
        let duration_mins = if asleep_ms > 0 {
            asleep_ms as f64 / 60_000.0
        } else {
            span_mins
        };
        let sleep_kind = SleepKind::Unknown;
        let mut quality_flags = Vec::new();
        if !is_plausible_sleep_duration(duration_mins) {
            quality_flags.push(SleepQualityFlag::ImplausibleDuration);
        }

        batch.sleep_sessions.push(RawSleepSession {
            id: raw_id,
            provider_id: HealthProviderId::AndroidHealthConnect,
            device_id: Some(dev_id),
            external_record_id: rec.id,
            source_app_bundle: Some(pkg),
            start_at_ms: rec.start_at_ms,
            end_at_ms: rec.end_at_ms,
            start_tz_offset_secs: rec.start_zone_offset_secs,
            end_tz_offset_secs: rec.end_zone_offset_secs,
            duration_mins,
            time_in_bed_mins: Some(span_mins),
            sleep_efficiency_pct: Some(((duration_mins / span_mins) * 100.0).clamp(0.0, 100.0)),
            awake_mins: None,
            light_mins: None,
            deep_mins: None,
            rem_mins: None,
            sleep_kind,
            provider_sleep_kind: None,
            quality_flags,
            quality_score: 0.9,
            notes: rec.notes,
            subjective_quality: None,
            acquisition_at_ms,
            sync_batch_id: batch_id.map(str::to_string),
            is_deleted: false,
            is_synthetic: false,
            stages,
        });
    }

    for p in payload.physio_records {
        if !p.value.is_finite() {
            continue;
        }
        let Some(metric_type) = PhysiologicalMetricType::from_str(&p.metric_type) else {
            continue;
        };
        let pkg = p
            .data_origin_package
            .clone()
            .unwrap_or_else(|| "android.healthconnect".to_string());
        let dev_id = register_hc_device(
            &mut devices,
            &pkg,
            p.device_manufacturer.clone(),
            p.device_model.clone(),
        );
        let hrv_method = if metric_type == PhysiologicalMetricType::Hrv {
            match p.hrv_method.as_deref() {
                Some(m) => HrvMethod::from_str(Some(m)),
                None => HrvMethod::Rmssd,
            }
        } else {
            HrvMethod::Unknown
        };
        batch.physio_observations.push(PhysiologicalObservation {
            id: format!("hc_{}", p.id),
            provider_id: HealthProviderId::AndroidHealthConnect,
            device_id: Some(dev_id),
            external_record_id: p.id,
            metric_type,
            value: p.value,
            unit: p.unit,
            hrv_method,
            measured_at_ms: p.measured_at_ms,
            period_start_ms: p.period_start_ms,
            period_end_ms: p.period_end_ms,
            tz_offset_secs: p.tz_offset_secs,
            aggregation_method: None,
            quality_flags: Vec::new(),
            acquisition_at_ms,
            sync_batch_id: batch_id.map(str::to_string),
            is_deleted: false,
            is_synthetic: false,
        });
    }

    batch.devices = devices.into_values().collect();
    batch
}

fn register_hc_device(
    devices: &mut HashMap<String, HealthDevice>,
    pkg: &str,
    manufacturer: Option<String>,
    model: Option<String>,
) -> String {
    let ext_id = format!(
        "{}:{}:{}",
        pkg,
        manufacturer.as_deref().unwrap_or("android"),
        model.as_deref().unwrap_or("unknown")
    );
    let dev_id = format!("dev_hc_{}", ext_id.replace([':', '.'], "_"));
    devices
        .entry(ext_id.clone())
        .or_insert_with(|| HealthDevice {
            id: dev_id.clone(),
            provider_id: HealthProviderId::AndroidHealthConnect,
            external_device_id: ext_id,
            manufacturer,
            model,
            source_app_bundle: Some(pkg.to_string()),
            platform_source_id: Some(pkg.to_string()),
            metadata_json: None,
        });
    dev_id
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_health_connect_sleep_rmssd_and_30_day_history_warning() {
        let payload = HealthConnectPayload {
            sleep_sessions: vec![HcSleepRecord {
                id: "hc-rec-1".into(),
                data_origin_package: Some("com.ouraring.oura".into()),
                device_manufacturer: Some("Oura".into()),
                device_model: Some("Gen3".into()),
                start_at_ms: 1_763_500_000_000,
                end_at_ms: 1_763_526_000_000,
                start_zone_offset_secs: Some(3600),
                end_zone_offset_secs: Some(3600),
                notes: None,
                stages: vec![
                    HcStage {
                        stage_type: "light".into(),
                        provider_stage_code: Some("STAGE_TYPE_LIGHT".into()),
                        start_at_ms: 1_763_500_000_000,
                        end_at_ms: 1_763_515_000_000,
                    },
                    HcStage {
                        stage_type: "rem".into(),
                        provider_stage_code: Some("STAGE_TYPE_REM".into()),
                        start_at_ms: 1_763_515_000_000,
                        end_at_ms: 1_763_526_000_000,
                    },
                ],
            }],
            physio_records: vec![HcPhysioRecord {
                id: "hc-hrv-1".into(),
                data_origin_package: Some("com.google.android.apps.fitness".into()),
                device_manufacturer: Some("Google".into()),
                device_model: Some("Pixel Watch 3".into()),
                metric_type: "hrv".into(),
                value: 52.3,
                unit: "ms".into(),
                hrv_method: None,
                measured_at_ms: 1_763_525_000_000,
                period_start_ms: None,
                period_end_ms: None,
                tz_offset_secs: Some(3600),
            }],
            deleted_ids: vec![],
            next_changes_token: Some("tok-next".into()),
            changes_token_expired: false,
            has_history_permission: false,
        };

        let batch = normalize_healthconnect_payload(payload, 1_763_530_000_000, Some("b1"));
        assert_eq!(batch.sleep_sessions.len(), 1);
        assert_eq!(batch.history_limit_days, Some(30));
        assert_eq!(batch.physio_observations[0].hrv_method, HrvMethod::Rmssd);
        assert_eq!(batch.next_cursor.as_deref(), Some("tok-next"));
    }

    #[test]
    fn expired_changes_token_clears_cursor() {
        let payload = HealthConnectPayload {
            sleep_sessions: vec![],
            physio_records: vec![],
            deleted_ids: vec![],
            next_changes_token: Some("stale".into()),
            changes_token_expired: true,
            has_history_permission: true,
        };
        let batch = normalize_healthconnect_payload(payload, 1_763_530_000_000, None);
        assert!(batch.next_cursor.is_none());
        assert!(batch.history_limit_days.is_none());
        assert!(batch.warnings.iter().any(|w| w.contains("expired")));
    }
}
