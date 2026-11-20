//! Rust normalization & sync adapter for native iOS Apple HealthKit payloads.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

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
pub struct HealthKitPayload {
    #[serde(default)]
    pub sleep_samples: Vec<HkSleepSample>,
    #[serde(default)]
    pub physio_samples: Vec<HkPhysioSample>,
    #[serde(default)]
    pub deleted_uuids: Vec<String>,
    pub next_anchor_json: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HkSleepSample {
    pub uuid: String,
    pub start_at_ms: i64,
    pub end_at_ms: i64,
    pub tz_offset_secs: Option<i32>,
    pub stage_type: String,
    pub provider_stage_code: Option<String>,
    pub source_bundle_id: Option<String>,
    pub source_name: Option<String>,
    pub device_manufacturer: Option<String>,
    pub device_model: Option<String>,
    #[serde(default)]
    pub was_user_entered: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HkPhysioSample {
    pub uuid: String,
    pub metric_type: String,
    pub value: f64,
    pub unit: String,
    pub hrv_method: Option<String>,
    pub start_at_ms: i64,
    pub end_at_ms: i64,
    pub tz_offset_secs: Option<i32>,
    pub source_bundle_id: Option<String>,
    pub device_manufacturer: Option<String>,
    pub device_model: Option<String>,
}

pub struct HealthKitAdapter;

impl NativeHealthAdapter for HealthKitAdapter {
    fn provider_id(&self) -> HealthProviderId {
        HealthProviderId::AppleHealthkit
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
        let payload: HealthKitPayload = serde_json::from_value(raw.clone()).map_err(|e| {
            HealthProviderError::new(
                "parse_error",
                format!("Invalid HealthKit payload: {e}"),
                false,
            )
        })?;
        Ok(normalize_healthkit_payload(
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

pub fn normalize_healthkit_payload(
    payload: HealthKitPayload,
    acquisition_at_ms: i64,
    batch_id: Option<&str>,
) -> NormalizedIngestionBatch {
    let mut batch = NormalizedIngestionBatch {
        next_cursor: payload.next_anchor_json,
        deleted_sleep_external_ids: payload.deleted_uuids.clone(),
        deleted_physio_external_ids: payload.deleted_uuids,
        ..Default::default()
    };

    let mut device_map: HashMap<String, HealthDevice> = HashMap::new();
    let mut grouped: HashMap<String, Vec<HkSleepSample>> = HashMap::new();

    for sample in payload.sleep_samples {
        if sample.end_at_ms <= sample.start_at_ms {
            continue;
        }
        let bundle = sample
            .source_bundle_id
            .clone()
            .unwrap_or_else(|| "com.apple.health".to_string());
        register_device(
            &mut device_map,
            &bundle,
            sample.device_manufacturer.clone(),
            sample.device_model.clone(),
        );
        grouped.entry(bundle).or_default().push(sample);
    }

    // Group per source bundle with 45-minute continuity gap into sleep sessions.
    let max_gap_ms: i64 = 45 * 60_000;
    for (bundle, mut samples) in grouped {
        samples.sort_by(|a, b| {
            (a.start_at_ms, a.end_at_ms, &a.uuid).cmp(&(b.start_at_ms, b.end_at_ms, &b.uuid))
        });
        let mut current: Vec<HkSleepSample> = Vec::new();
        for s in samples {
            if let Some(last_end) = current.iter().map(|x| x.end_at_ms).max() {
                if s.start_at_ms - last_end > max_gap_ms {
                    if let Some(sess) =
                        build_hk_session(&bundle, &current, acquisition_at_ms, batch_id)
                    {
                        batch.sleep_sessions.push(sess);
                    }
                    current.clear();
                }
            }
            current.push(s);
        }
        if let Some(sess) = build_hk_session(&bundle, &current, acquisition_at_ms, batch_id) {
            batch.sleep_sessions.push(sess);
        }
    }

    for p in payload.physio_samples {
        if !p.value.is_finite() {
            continue;
        }
        let Some(metric_type) = PhysiologicalMetricType::from_str(&p.metric_type) else {
            continue;
        };
        let bundle = p
            .source_bundle_id
            .clone()
            .unwrap_or_else(|| "com.apple.health".to_string());
        let dev_id = register_device(
            &mut device_map,
            &bundle,
            p.device_manufacturer.clone(),
            p.device_model.clone(),
        );
        let hrv_method = if metric_type == PhysiologicalMetricType::Hrv {
            match p.hrv_method.as_deref() {
                Some(m) => HrvMethod::from_str(Some(m)),
                None => HrvMethod::Sdnn,
            }
        } else {
            HrvMethod::Unknown
        };
        batch.physio_observations.push(PhysiologicalObservation {
            id: format!("hk_{}", p.uuid),
            provider_id: HealthProviderId::AppleHealthkit,
            device_id: Some(dev_id),
            external_record_id: p.uuid,
            metric_type,
            value: p.value,
            unit: p.unit,
            hrv_method,
            measured_at_ms: p.end_at_ms,
            period_start_ms: Some(p.start_at_ms),
            period_end_ms: Some(p.end_at_ms),
            tz_offset_secs: p.tz_offset_secs,
            aggregation_method: None,
            quality_flags: Vec::new(),
            acquisition_at_ms,
            sync_batch_id: batch_id.map(str::to_string),
            is_deleted: false,
            is_synthetic: false,
        });
    }

    batch.devices = device_map.into_values().collect();
    batch
}

fn register_device(
    map: &mut HashMap<String, HealthDevice>,
    bundle: &str,
    manufacturer: Option<String>,
    model: Option<String>,
) -> String {
    let ext_id = format!(
        "{}:{}:{}",
        bundle,
        manufacturer.as_deref().unwrap_or("apple"),
        model.as_deref().unwrap_or("unknown")
    );
    let dev_id = format!("dev_hk_{}", ext_id.replace(':', "_"));
    map.entry(ext_id.clone()).or_insert_with(|| HealthDevice {
        id: dev_id.clone(),
        provider_id: HealthProviderId::AppleHealthkit,
        external_device_id: ext_id,
        manufacturer,
        model,
        source_app_bundle: Some(bundle.to_string()),
        platform_source_id: Some(bundle.to_string()),
        metadata_json: None,
    });
    dev_id
}

fn build_hk_session(
    bundle: &str,
    samples: &[HkSleepSample],
    acquisition_at_ms: i64,
    batch_id: Option<&str>,
) -> Option<RawSleepSession> {
    if samples.is_empty() {
        return None;
    }
    let start_ms = samples.iter().map(|s| s.start_at_ms).min()?;
    let end_ms = samples.iter().map(|s| s.end_at_ms).max()?;
    if end_ms <= start_ms {
        return None;
    }
    let start_off = samples.first()?.tz_offset_secs;
    let end_off = samples.last()?.tz_offset_secs.or(start_off);
    let first_uuid = &samples.first()?.uuid;
    let ext_id = format!("hk_sleep_{}_{}", bundle, start_ms);
    let raw_id = format!("hk_{first_uuid}_{start_ms}");

    let stages = normalize_stage_intervals(
        samples
            .iter()
            .enumerate()
            .map(|(i, s)| SleepStageInterval {
                id: format!("{raw_id}_st_{i}"),
                raw_session_id: raw_id.clone(),
                stage_type: SleepStageType::from_str(&s.stage_type),
                start_at_ms: s.start_at_ms,
                end_at_ms: s.end_at_ms,
                provider_stage_code: s.provider_stage_code.clone(),
            })
            .collect(),
    );

    let asleep_ms: i64 = stages
        .iter()
        .filter(|s| s.stage_type.counts_as_asleep())
        .map(|s| s.end_at_ms - s.start_at_ms)
        .sum();
    let span_mins = (end_ms - start_ms) as f64 / 60_000.0;
    let duration_mins = if asleep_ms > 0 {
        asleep_ms as f64 / 60_000.0
    } else {
        span_mins
    };
    let sleep_kind = SleepKind::Unknown;

    let mut quality_flags = Vec::new();
    if samples.iter().any(|s| s.was_user_entered) {
        quality_flags.push(SleepQualityFlag::UserEntered);
    }
    if !is_plausible_sleep_duration(duration_mins) {
        quality_flags.push(SleepQualityFlag::ImplausibleDuration);
    }

    let first_sample = samples.first()?;
    let dev_key = format!(
        "dev_hk_{}_{}_{}",
        bundle,
        first_sample
            .device_manufacturer
            .as_deref()
            .unwrap_or("apple"),
        first_sample.device_model.as_deref().unwrap_or("unknown")
    );

    Some(RawSleepSession {
        id: raw_id,
        provider_id: HealthProviderId::AppleHealthkit,
        device_id: Some(dev_key),
        external_record_id: ext_id,
        source_app_bundle: Some(bundle.to_string()),
        start_at_ms: start_ms,
        end_at_ms: end_ms,
        start_tz_offset_secs: start_off,
        end_tz_offset_secs: end_off,
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
        quality_score: 0.92,
        notes: None,
        subjective_quality: None,
        acquisition_at_ms,
        sync_batch_id: batch_id.map(str::to_string),
        is_deleted: false,
        is_synthetic: false,
        stages,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_ios16_stages_and_ios15_asleep_without_fabrication() {
        let payload = HealthKitPayload {
            sleep_samples: vec![
                HkSleepSample {
                    uuid: "u1".into(),
                    start_at_ms: 1_763_500_000_000,
                    end_at_ms: 1_763_507_200_000,
                    tz_offset_secs: Some(-18_000),
                    stage_type: "light".into(),
                    provider_stage_code: Some("asleepCore".into()),
                    source_bundle_id: Some("com.apple.health.watch".into()),
                    source_name: Some("Apple Watch".into()),
                    device_manufacturer: Some("Apple Inc.".into()),
                    device_model: Some("Watch7,1".into()),
                    was_user_entered: false,
                },
                HkSleepSample {
                    uuid: "u2".into(),
                    start_at_ms: 1_763_507_200_000,
                    end_at_ms: 1_763_514_400_000,
                    tz_offset_secs: Some(-18_000),
                    stage_type: "deep".into(),
                    provider_stage_code: Some("asleepDeep".into()),
                    source_bundle_id: Some("com.apple.health.watch".into()),
                    source_name: Some("Apple Watch".into()),
                    device_manufacturer: Some("Apple Inc.".into()),
                    device_model: Some("Watch7,1".into()),
                    was_user_entered: false,
                },
                HkSleepSample {
                    uuid: "u3".into(),
                    start_at_ms: 1_763_500_000_000,
                    end_at_ms: 1_763_525_200_000,
                    tz_offset_secs: Some(-18_000),
                    stage_type: "asleep_unknown".into(),
                    provider_stage_code: Some("asleep".into()),
                    source_bundle_id: Some("com.ouraring.oura".into()),
                    source_name: Some("Oura".into()),
                    device_manufacturer: None,
                    device_model: None,
                    was_user_entered: false,
                },
            ],
            physio_samples: vec![HkPhysioSample {
                uuid: "h1".into(),
                metric_type: "hrv".into(),
                value: 44.2,
                unit: "ms".into(),
                hrv_method: None,
                start_at_ms: 1_763_514_000_000,
                end_at_ms: 1_763_514_000_000,
                tz_offset_secs: Some(-18_000),
                source_bundle_id: Some("com.apple.health.watch".into()),
                device_manufacturer: Some("Apple Inc.".into()),
                device_model: Some("Watch7,1".into()),
            }],
            deleted_uuids: vec!["deleted-1".into()],
            next_anchor_json: Some("{\"sleep\":\"abc\"}".into()),
        };

        let batch = normalize_healthkit_payload(payload, 1_763_530_000_000, Some("b1"));
        assert_eq!(batch.sleep_sessions.len(), 2);
        assert_eq!(batch.physio_observations.len(), 1);
        assert_eq!(batch.physio_observations[0].hrv_method, HrvMethod::Sdnn);
        assert_eq!(batch.deleted_sleep_external_ids, vec!["deleted-1"]);
    }
}
