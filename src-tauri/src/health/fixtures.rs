//! Deterministic seeded synthetic demo dataset generator (`is_synthetic = true`).
//!
//! Strictly isolated from real user records and NEVER loaded automatically in production.

use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};

use super::models::{
    HealthDevice, HealthProviderId, HrvMethod, PhysiologicalMetricType, PhysiologicalObservation,
    RawSleepSession, RecoveryObservation, SleepKind, SleepStageInterval, SleepStageType,
};
use super::provider::NormalizedIngestionBatch;
use super::time::local_date_string;

pub fn generate_demo_batch(days: usize, anchor_end_ms: i64, seed: u64) -> NormalizedIngestionBatch {
    let mut rng = StdRng::seed_from_u64(seed);
    let mut batch = NormalizedIngestionBatch::default();

    let device_id = "demo_ring_dev".to_string();
    batch.devices.push(HealthDevice {
        id: device_id.clone(),
        provider_id: HealthProviderId::Oura,
        external_device_id: "demo-oura-gen4".to_string(),
        manufacturer: Some("Oura (Demo)".to_string()),
        model: Some("Synthetic Ring Gen 4".to_string()),
        source_app_bundle: None,
        platform_source_id: Some("synthetic_demo".to_string()),
        metadata_json: None,
    });

    let day_ms: i64 = 86_400_000;
    let base_wake_day_start = anchor_end_ms - (anchor_end_ms.rem_euclid(day_ms));

    for offset in (0..days).rev() {
        let day_start_utc = base_wake_day_start - (offset as i64) * day_ms;
        // Skip occasional days (~6%) so missing-data handling is authentically demonstrable.
        if offset % 17 == 11 {
            continue;
        }

        let is_weekend = (offset % 7 == 0) || (offset % 7 == 6);
        let bedtime_shift_mins: i64 = if is_weekend {
            rng.gen_range(-10..=55)
        } else {
            rng.gen_range(-25..=25)
        };
        let duration_mins: i64 = if offset % 9 == 0 {
            rng.gen_range(310..=370)
        } else {
            rng.gen_range(420..=505)
        };

        // 23:15 UTC baseline start (prior evening) -> wake next morning
        let bed_start_ms = day_start_utc - 45 * 60_000 + bedtime_shift_mins * 60_000;
        let wake_end_ms = bed_start_ms + duration_mins * 60_000;
        let sess_id = format!("demo_sleep_{offset}");

        let stages = build_synthetic_stages(&sess_id, bed_start_ms, wake_end_ms, &mut rng);
        let (mut light_m, mut deep_m, mut rem_m, mut awake_m) = (0.0, 0.0, 0.0, 0.0);
        for st in &stages {
            let mins = (st.end_at_ms - st.start_at_ms) as f64 / 60_000.0;
            match st.stage_type {
                SleepStageType::Light => light_m += mins,
                SleepStageType::Deep => deep_m += mins,
                SleepStageType::Rem => rem_m += mins,
                SleepStageType::Awake => awake_m += mins,
                _ => {}
            }
        }
        let asleep_m = light_m + deep_m + rem_m;
        let efficiency = ((asleep_m / duration_mins as f64) * 100.0).clamp(70.0, 99.0);

        batch.sleep_sessions.push(RawSleepSession {
            id: sess_id.clone(),
            provider_id: HealthProviderId::Oura,
            device_id: Some(device_id.clone()),
            external_record_id: format!("demo-sleep-{offset}"),
            source_app_bundle: None,
            start_at_ms: bed_start_ms,
            end_at_ms: wake_end_ms,
            start_tz_offset_secs: Some(0),
            end_tz_offset_secs: Some(0),
            duration_mins: asleep_m,
            time_in_bed_mins: Some(duration_mins as f64),
            sleep_efficiency_pct: Some((efficiency * 10.0).round() / 10.0),
            awake_mins: Some(awake_m),
            light_mins: Some(light_m),
            deep_mins: Some(deep_m),
            rem_mins: Some(rem_m),
            sleep_kind: SleepKind::MainSleep,
            provider_sleep_kind: Some("long_sleep".to_string()),
            quality_flags: Vec::new(),
            quality_score: 0.95,
            notes: None,
            subjective_quality: None,
            acquisition_at_ms: wake_end_ms + 300_000,
            sync_batch_id: None,
            is_deleted: false,
            is_synthetic: true,
            stages,
        });

        // Periodic daytime naps (~18% of days)
        if offset % 6 == 2 {
            let nap_start = day_start_utc + 14 * 3_600_000 + rng.gen_range(-20..=30) * 60_000;
            let nap_dur = rng.gen_range(22..=48);
            let nap_end = nap_start + nap_dur * 60_000;
            batch.sleep_sessions.push(RawSleepSession {
                id: format!("demo_nap_{offset}"),
                provider_id: HealthProviderId::Oura,
                device_id: Some(device_id.clone()),
                external_record_id: format!("demo-nap-{offset}"),
                source_app_bundle: None,
                start_at_ms: nap_start,
                end_at_ms: nap_end,
                start_tz_offset_secs: Some(0),
                end_tz_offset_secs: Some(0),
                duration_mins: nap_dur as f64,
                time_in_bed_mins: Some(nap_dur as f64),
                sleep_efficiency_pct: Some(92.0),
                awake_mins: Some(2.0),
                light_mins: Some((nap_dur - 2) as f64),
                deep_mins: Some(0.0),
                rem_mins: Some(0.0),
                sleep_kind: SleepKind::Nap,
                provider_sleep_kind: Some("nap".to_string()),
                quality_flags: Vec::new(),
                quality_score: 0.9,
                notes: None,
                subjective_quality: None,
                acquisition_at_ms: nap_end + 120_000,
                sync_batch_id: None,
                is_deleted: false,
                is_synthetic: true,
                stages: Vec::new(),
            });
        }

        // Overnight HRV (RMSSD) and Resting HR
        let hrv_val: f64 = 46.0 + (duration_mins as f64 - 430.0) * 0.08 + rng.gen_range(-6.0..6.0);
        let rhr_val: f64 = 55.0 - (duration_mins as f64 - 430.0) * 0.03 + rng.gen_range(-2.5..2.5);
        batch.physio_observations.push(PhysiologicalObservation {
            id: format!("demo_hrv_{offset}"),
            provider_id: HealthProviderId::Oura,
            device_id: Some(device_id.clone()),
            external_record_id: format!("demo-hrv-{offset}"),
            metric_type: PhysiologicalMetricType::Hrv,
            value: (hrv_val.max(18.0) * 10.0).round() / 10.0,
            unit: "ms".to_string(),
            hrv_method: HrvMethod::Rmssd,
            measured_at_ms: wake_end_ms,
            period_start_ms: Some(bed_start_ms),
            period_end_ms: Some(wake_end_ms),
            tz_offset_secs: Some(0),
            aggregation_method: Some("nightly_mean".to_string()),
            quality_flags: Vec::new(),
            acquisition_at_ms: wake_end_ms + 300_000,
            sync_batch_id: None,
            is_deleted: false,
            is_synthetic: true,
        });
        batch.physio_observations.push(PhysiologicalObservation {
            id: format!("demo_rhr_{offset}"),
            provider_id: HealthProviderId::Oura,
            device_id: Some(device_id.clone()),
            external_record_id: format!("demo-rhr-{offset}"),
            metric_type: PhysiologicalMetricType::RestingHeartRate,
            value: rhr_val.clamp(42.0, 82.0).round(),
            unit: "bpm".to_string(),
            hrv_method: HrvMethod::Unknown,
            measured_at_ms: wake_end_ms,
            period_start_ms: Some(bed_start_ms),
            period_end_ms: Some(wake_end_ms),
            tz_offset_secs: Some(0),
            aggregation_method: Some("nightly_lowest".to_string()),
            quality_flags: Vec::new(),
            acquisition_at_ms: wake_end_ms + 300_000,
            sync_batch_id: None,
            is_deleted: false,
            is_synthetic: true,
        });

        let readiness = (68.0 + (duration_mins as f64 - 420.0) * 0.14 + rng.gen_range(-6.0..6.0))
            .clamp(40.0, 97.0)
            .round();
        batch.recovery_observations.push(RecoveryObservation {
            id: format!("demo_rec_{offset}"),
            provider_id: HealthProviderId::Oura,
            external_record_id: format!("demo-rec-{offset}"),
            score_name: "Readiness Score (Demo)".to_string(),
            score_value: Some(readiness),
            scale_min: 0.0,
            scale_max: 100.0,
            score_state: "SCORED".to_string(),
            algorithm_id: Some("oura_demo_v2".to_string()),
            represented_date: local_date_string(wake_end_ms, Some(0)),
            measured_at_ms: wake_end_ms,
            underlying_metrics_json: None,
            acquisition_at_ms: wake_end_ms + 300_000,
            is_synthetic: true,
        });
    }

    batch
}

fn build_synthetic_stages(
    session_id: &str,
    start_ms: i64,
    end_ms: i64,
    rng: &mut StdRng,
) -> Vec<SleepStageInterval> {
    let mut intervals = Vec::new();
    let step_ms = 15 * 60_000;
    let mut cursor = start_ms;
    let mut idx = 0usize;
    let total = (end_ms - start_ms).max(1) as f64;

    while cursor < end_ms {
        let next = (cursor + step_ms).min(end_ms);
        let frac = (cursor - start_ms) as f64 / total;
        let stage = if idx == 0 || (frac > 0.35 && frac < 0.72 && rng.gen_bool(0.08)) {
            SleepStageType::Awake
        } else if frac < 0.40 && idx % 3 == 1 {
            SleepStageType::Deep
        } else if frac > 0.30 && idx % 4 == 3 {
            SleepStageType::Rem
        } else {
            SleepStageType::Light
        };
        intervals.push(SleepStageInterval {
            id: format!("{session_id}_st_{idx}"),
            raw_session_id: session_id.to_string(),
            stage_type: stage,
            start_at_ms: cursor,
            end_at_ms: next,
            provider_stage_code: Some(format!("demo_{}", stage.as_str())),
        });
        cursor = next;
        idx += 1;
    }
    intervals
}
