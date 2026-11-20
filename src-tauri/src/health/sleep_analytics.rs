//! Sleep architecture, circular timing, Sleep Regularity Index (SRI) proxy,
//! and exploratory Borbély Two-Process alertness model.
//!
//! Scientific conservatism:
//! - Consumer wearables are not polysomnography (PSG) or DLMO assays.
//! - Stage percentages return `None` whenever `stage_coverage_ratio < 0.70`.
//! - HRV RMSSD and SDNN are strictly segregated and never pooled.
//! - Exploratory Borbély alertness curves carry explicit uncertainty bands and
//!   `isClinical: false`.

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{Datelike, Duration as ChronoDuration, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};

use super::models::{
    CanonicalSleepEpisode, HrvMethod, PhysiologicalMetricType, PhysiologicalObservation,
    RecoveryObservation, SleepKind,
};
use super::time::{local_date_string, local_minutes_of_day, parse_naive_date, to_local_datetime};

pub const MIN_STAGE_COVERAGE_RATIO: f64 = 0.70;
pub const MIN_SRI_CONSECUTIVE_PAIRS: usize = 7;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CircularTimeStats {
    pub mean_mins: f64,
    pub sd_mins: f64,
    pub mean_resultant_length: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyOverlayPoint {
    pub session_id: String,
    pub started_at_ms: i64,
    pub ended_at_ms: i64,
    pub review_count: usize,
    pub mean_residual: Option<f64>,
    pub activity_kind: String,
    pub plan_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SleepDaySummary {
    pub local_date: String,
    pub main_sleep_id: Option<String>,
    pub main_sleep_start_ms: Option<i64>,
    pub main_sleep_end_ms: Option<i64>,
    pub main_sleep_mins: Option<f64>,
    pub nap_count: usize,
    pub total_nap_mins: f64,
    pub total_sleep_all_episodes_mins: f64,
    pub time_in_bed_mins: Option<f64>,
    pub efficiency_pct: Option<f64>,
    pub waso_mins: Option<f64>,
    pub awakenings_count: usize,
    pub stage_coverage_ratio: f64,
    pub awake_pct: Option<f64>,
    pub light_pct: Option<f64>,
    pub deep_pct: Option<f64>,
    pub rem_pct: Option<f64>,
    pub sleep_onset_local_mins: Option<f64>,
    pub wake_local_mins: Option<f64>,
    pub sleep_midpoint_local_mins: Option<f64>,
    pub overnight_rmssd_ms: Option<f64>,
    pub overnight_sdnn_ms: Option<f64>,
    pub resting_hr_bpm: Option<f64>,
    pub recovery_score: Option<f64>,
    pub recovery_scale_max: Option<f64>,
    pub recovery_score_name: Option<String>,
    pub has_source_conflict: bool,
    pub missing_data: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollingSleepMetrics {
    pub window_days: usize,
    pub nights_tracked: usize,
    pub missing_nights: usize,
    pub coverage_ratio: f64,
    pub mean_total_sleep_mins: Option<f64>,
    pub sd_total_sleep_mins: Option<f64>,
    pub mean_time_in_bed_mins: Option<f64>,
    pub mean_efficiency_pct: Option<f64>,
    pub mean_waso_mins: Option<f64>,
    pub circular_bedtime_mean_mins: Option<f64>,
    pub circular_bedtime_sd_mins: Option<f64>,
    pub circular_wake_mean_mins: Option<f64>,
    pub circular_wake_sd_mins: Option<f64>,
    pub circular_midpoint_mean_mins: Option<f64>,
    pub social_jetlag_mins: Option<f64>,
    pub sri_proxy: Option<f64>,
    pub sri_day_pairs: usize,
    pub sri_status: SleepRegularityStatus,
    pub total_naps: usize,
    pub mean_overnight_rmssd_ms: Option<f64>,
    pub mean_overnight_sdnn_ms: Option<f64>,
    pub mean_resting_hr_bpm: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SleepRegularityStatus {
    Available,
    InsufficientConsecutiveDays,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimingHistogramBin {
    pub label: String,
    pub start_minute: f64,
    pub end_minute: f64,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DurationHistogramBin {
    pub label: String,
    pub min_hours: f64,
    pub max_hours: f64,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BorbelyAlertnessPoint {
    pub timestamp_ms: i64,
    pub local_label: String,
    pub alertness: f64,
    pub uncertainty_half_width: f64,
    pub process_s: f64,
    pub process_c: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BorbelyCurveSummary {
    pub is_clinical: bool,
    pub model_label: String,
    pub methodology_note: String,
    pub inferred_circadian_midpoint_mins: Option<f64>,
    pub estimated_nadir_mins: Option<f64>,
    pub schedule_sd_mins: Option<f64>,
    pub points: Vec<BorbelyAlertnessPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SleepChartData {
    pub start_ms: i64,
    pub end_ms: i64,
    pub episodes: Vec<CanonicalSleepEpisode>,
    pub day_summaries: Vec<SleepDaySummary>,
    pub rolling_7d: RollingSleepMetrics,
    pub rolling_14d: RollingSleepMetrics,
    pub rolling_30d: RollingSleepMetrics,
    pub rolling_90d: RollingSleepMetrics,
    pub bedtime_distribution: Vec<TimingHistogramBin>,
    pub wake_distribution: Vec<TimingHistogramBin>,
    pub duration_distribution: Vec<DurationHistogramBin>,
    pub study_overlays: Vec<StudyOverlayPoint>,
    pub alertness_curve: BorbelyCurveSummary,
    pub warnings: Vec<String>,
}

/// Apply the nap classification hierarchy:
/// 1. Explicit user override (`user_sleep_kind_override`)
/// 2. Explicit provider classification (`MainSleep` or `Nap`)
/// 3. Duration and circadian proximity heuristic against sibling episodes
pub fn classify_sleep_kind(
    episode: &CanonicalSleepEpisode,
    all_episodes: &[CanonicalSleepEpisode],
) -> SleepKind {
    if let Some(override_kind) = episode.user_sleep_kind_override {
        return override_kind;
    }
    if matches!(episode.sleep_kind, SleepKind::MainSleep | SleepKind::Nap) {
        return episode.sleep_kind;
    }

    let tz = episode.start_tz_offset_secs.or(episode.end_tz_offset_secs);
    let local_start_mins = local_minutes_of_day(episode.start_at_ms, tz);
    let has_longer_same_day = all_episodes.iter().any(|other| {
        other.id != episode.id
            && other.anchor_local_date == episode.anchor_local_date
            && other.total_sleep_mins >= episode.total_sleep_mins + 30.0
    });

    if (episode.total_sleep_mins < 180.0 && has_longer_same_day)
        || (episode.total_sleep_mins < 210.0 && (540.0..=1140.0).contains(&local_start_mins))
    {
        SleepKind::Nap
    } else {
        SleepKind::MainSleep
    }
}

/// Circular mean and circular standard deviation for timestamps mapped to
/// minutes-of-day `[0, 1440)`.
pub fn compute_circular_minutes_stats(minutes: &[f64]) -> Option<CircularTimeStats> {
    if minutes.is_empty() {
        return None;
    }
    let scale = std::f64::consts::TAU / 1440.0;
    let mut sum_cos = 0.0;
    let mut sum_sin = 0.0;
    let mut count = 0usize;
    for &m in minutes {
        if !m.is_finite() {
            continue;
        }
        let wrapped = m.rem_euclid(1440.0);
        let theta = wrapped * scale;
        sum_cos += theta.cos();
        sum_sin += theta.sin();
        count += 1;
    }
    if count == 0 {
        return None;
    }
    let mean_cos = sum_cos / count as f64;
    let mean_sin = sum_sin / count as f64;
    let r = (mean_cos * mean_cos + mean_sin * mean_sin).sqrt();
    let mean_angle = mean_sin.atan2(mean_cos).rem_euclid(std::f64::consts::TAU);
    let mean_mins = (mean_angle / scale).rem_euclid(1440.0);
    let clamped_r = r.clamp(1e-6, 1.0);
    let sd_rad = (-2.0 * clamped_r.ln()).max(0.0).sqrt();
    let sd_mins = sd_rad / scale;
    Some(CircularTimeStats {
        mean_mins,
        sd_mins,
        mean_resultant_length: r,
    })
}

/// Signed circular difference `(a - b)` wrapped to `[-720, +720]` minutes.
pub fn signed_circular_diff_mins(a_mins: f64, b_mins: f64) -> f64 {
    let mut diff = (a_mins - b_mins).rem_euclid(1440.0);
    if diff > 720.0 {
        diff -= 1440.0;
    }
    diff
}

/// Phillips et al. (2017) Sleep Regularity Index proxy across consecutive
/// tracked non-missing days using 96 × 15-minute daily epochs.
/// Returns `(Option<sri>, valid_consecutive_day_pairs)`.
pub fn compute_sri_proxy(
    episodes: &[CanonicalSleepEpisode],
    tracked_dates: &HashSet<String>,
) -> (Option<f64>, usize) {
    if tracked_dates.len() < 2 {
        return (None, 0);
    }

    let mut day_grids: HashMap<NaiveDate, [bool; 96]> = HashMap::new();
    for d_str in tracked_dates {
        if let Some(d) = parse_naive_date(d_str) {
            day_grids.insert(d, [false; 96]);
        }
    }

    let step_ms: i64 = 15 * 60 * 1000;
    for ep in episodes {
        let tz = ep.end_tz_offset_secs.or(ep.start_tz_offset_secs);
        let mut cursor = ep.start_at_ms;
        while cursor < ep.end_at_ms {
            let probe = cursor + step_ms / 2;
            let local_dt = to_local_datetime(probe.min(ep.end_at_ms), tz);
            let date = local_dt.date_naive();
            if let Some(grid) = day_grids.get_mut(&date) {
                let slot = ((local_minutes_of_day(probe.min(ep.end_at_ms), tz) / 15.0).floor()
                    as usize)
                    .min(95);
                grid[slot] = true;
            }
            cursor += step_ms;
        }
    }

    let mut sorted_dates: Vec<NaiveDate> = day_grids.keys().copied().collect();
    sorted_dates.sort();

    let mut pairs = 0usize;
    let mut consecutive_pairs = 0usize;
    let mut longest_run = 0usize;
    let mut matching_epochs = 0usize;
    for d in &sorted_dates {
        let next_d = *d + ChronoDuration::days(1);
        if let (Some(g1), Some(g2)) = (day_grids.get(d), day_grids.get(&next_d)) {
            pairs += 1;
            consecutive_pairs += 1;
            longest_run = longest_run.max(consecutive_pairs);
            for idx in 0..96 {
                if g1[idx] == g2[idx] {
                    matching_epochs += 1;
                }
            }
        } else {
            consecutive_pairs = 0;
        }
    }

    if longest_run < MIN_SRI_CONSECUTIVE_PAIRS {
        return (None, pairs);
    }

    let match_rate = matching_epochs as f64 / (pairs * 96) as f64;
    let sri = (200.0 * (match_rate - 0.5)).clamp(-100.0, 100.0);
    (Some(sri), pairs)
}

fn mean(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    Some(values.iter().sum::<f64>() / values.len() as f64)
}

fn std_dev(values: &[f64]) -> Option<f64> {
    if values.len() < 2 {
        return None;
    }
    let m = mean(values)?;
    let var = values.iter().map(|v| (v - m).powi(2)).sum::<f64>() / (values.len() - 1) as f64;
    Some(var.sqrt())
}

fn episode_stage_pcts(
    ep: &CanonicalSleepEpisode,
) -> (Option<f64>, Option<f64>, Option<f64>, Option<f64>) {
    if ep.stage_coverage_ratio < MIN_STAGE_COVERAGE_RATIO || ep.total_sleep_mins <= 0.0 {
        return (None, None, None, None);
    }
    let denom = ep.total_sleep_mins;
    let light_pct = ep.light_mins.map(|v| (v / denom * 100.0).clamp(0.0, 100.0));
    let deep_pct = ep.deep_mins.map(|v| (v / denom * 100.0).clamp(0.0, 100.0));
    let rem_pct = ep.rem_mins.map(|v| (v / denom * 100.0).clamp(0.0, 100.0));
    let awake_pct = ep.awake_mins.and_then(|v| {
        let tib = ep.time_in_bed_mins.unwrap_or(ep.total_sleep_mins + v);
        if tib > 0.0 {
            Some((v / tib * 100.0).clamp(0.0, 100.0))
        } else {
            None
        }
    });
    (awake_pct, light_pct, deep_pct, rem_pct)
}

fn build_day_summaries(
    episodes: &[CanonicalSleepEpisode],
    physio: &[PhysiologicalObservation],
    recovery: &[RecoveryObservation],
    start_ms: i64,
    end_ms: i64,
    tz_offset_secs: Option<i32>,
) -> Vec<SleepDaySummary> {
    let mut start_date = parse_naive_date(&local_date_string(start_ms, tz_offset_secs))
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(2026, 1, 1).unwrap());
    let end_date =
        parse_naive_date(&local_date_string(end_ms, tz_offset_secs)).unwrap_or(start_date);
    if start_date > end_date {
        start_date = end_date;
    }

    let mut ep_by_date: BTreeMap<String, Vec<&CanonicalSleepEpisode>> = BTreeMap::new();
    for ep in episodes {
        ep_by_date
            .entry(ep.anchor_local_date.clone())
            .or_default()
            .push(ep);
    }

    // Group daily physiology (keeping RMSSD and SDNN strictly separated!)
    let mut rmssd_by_date: HashMap<String, Vec<f64>> = HashMap::new();
    let mut sdnn_by_date: HashMap<String, Vec<f64>> = HashMap::new();
    let mut rhr_by_date: HashMap<String, Vec<f64>> = HashMap::new();

    for obs in physio {
        if obs.is_deleted || !obs.value.is_finite() {
            continue;
        }
        let date_str = local_date_string(obs.measured_at_ms, obs.tz_offset_secs.or(tz_offset_secs));
        match obs.metric_type {
            PhysiologicalMetricType::Hrv => match obs.hrv_method {
                HrvMethod::Rmssd => rmssd_by_date.entry(date_str).or_default().push(obs.value),
                HrvMethod::Sdnn => sdnn_by_date.entry(date_str).or_default().push(obs.value),
                HrvMethod::Unknown => {}
            },
            PhysiologicalMetricType::RestingHeartRate => {
                rhr_by_date.entry(date_str).or_default().push(obs.value);
            }
            _ => {}
        }
    }

    let mut recovery_by_date: HashMap<String, &RecoveryObservation> = HashMap::new();
    for rec in recovery {
        if rec.score_value.is_some() {
            recovery_by_date
                .entry(rec.represented_date.clone())
                .or_insert(rec);
        }
    }

    let mut summaries = Vec::new();
    let mut cursor_date = start_date;
    let max_days = 1_098;
    while cursor_date <= end_date && summaries.len() < max_days {
        let date_str = cursor_date.format("%Y-%m-%d").to_string();
        let day_eps = ep_by_date.get(&date_str).cloned().unwrap_or_default();

        let mut classified: Vec<(&CanonicalSleepEpisode, SleepKind)> = day_eps
            .iter()
            .map(|ep| (*ep, classify_sleep_kind(ep, episodes)))
            .collect();
        classified.sort_by(|a, b| {
            b.0.total_sleep_mins
                .partial_cmp(&a.0.total_sleep_mins)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let main_ep = classified
            .iter()
            .find(|(_, kind)| *kind == SleepKind::MainSleep)
            .map(|(ep, _)| *ep);

        let naps: Vec<&CanonicalSleepEpisode> = classified
            .iter()
            .filter(|(_, kind)| *kind == SleepKind::Nap)
            .map(|(ep, _)| *ep)
            .collect();

        let total_nap_mins = naps.iter().map(|n| n.total_sleep_mins).sum::<f64>();
        let total_all = day_eps.iter().map(|e| e.total_sleep_mins).sum::<f64>();
        let has_conflict = day_eps.iter().any(|e| e.has_source_conflict);

        let (
            main_sleep_id,
            main_sleep_start_ms,
            main_sleep_end_ms,
            main_sleep_mins,
            time_in_bed_mins,
            efficiency_pct,
            waso_mins,
            awakenings_count,
            stage_coverage_ratio,
            awake_pct,
            light_pct,
            deep_pct,
            rem_pct,
            sleep_onset_local_mins,
            wake_local_mins,
            sleep_midpoint_local_mins,
        ) = if let Some(main) = main_ep {
            let (awake_p, light_p, deep_p, rem_p) = episode_stage_pcts(main);
            let onset_tz = main.start_tz_offset_secs.or(tz_offset_secs);
            let wake_tz = main.end_tz_offset_secs.or(tz_offset_secs);
            let onset_mins = local_minutes_of_day(main.start_at_ms, onset_tz);
            let wake_mins = local_minutes_of_day(main.end_at_ms, wake_tz);
            let midpoint_ms = main.start_at_ms + (main.end_at_ms - main.start_at_ms) / 2;
            let mid_mins = local_minutes_of_day(midpoint_ms, wake_tz);
            let awakenings = main
                .stages
                .iter()
                .filter(|s| s.stage_type == super::models::SleepStageType::Awake)
                .count();
            (
                Some(main.id.clone()),
                Some(main.start_at_ms),
                Some(main.end_at_ms),
                Some(main.total_sleep_mins),
                main.time_in_bed_mins,
                main.sleep_efficiency_pct,
                main.waso_mins,
                awakenings,
                main.stage_coverage_ratio,
                awake_p,
                light_p,
                deep_p,
                rem_p,
                Some(onset_mins),
                Some(wake_mins),
                Some(mid_mins),
            )
        } else {
            (
                None, None, None, None, None, None, None, 0, 0.0, None, None, None, None, None,
                None, None,
            )
        };

        let rec = recovery_by_date.get(&date_str).copied();
        summaries.push(SleepDaySummary {
            local_date: date_str.clone(),
            main_sleep_id,
            main_sleep_start_ms,
            main_sleep_end_ms,
            main_sleep_mins,
            nap_count: naps.len(),
            total_nap_mins,
            total_sleep_all_episodes_mins: total_all,
            time_in_bed_mins,
            efficiency_pct,
            waso_mins,
            awakenings_count,
            stage_coverage_ratio,
            awake_pct,
            light_pct,
            deep_pct,
            rem_pct,
            sleep_onset_local_mins,
            wake_local_mins,
            sleep_midpoint_local_mins,
            overnight_rmssd_ms: rmssd_by_date.get(&date_str).and_then(|v| mean(v)),
            overnight_sdnn_ms: sdnn_by_date.get(&date_str).and_then(|v| mean(v)),
            resting_hr_bpm: rhr_by_date.get(&date_str).and_then(|v| mean(v)),
            recovery_score: rec.and_then(|r| r.score_value),
            recovery_scale_max: rec.map(|r| r.scale_max),
            recovery_score_name: rec.map(|r| r.score_name.clone()),
            has_source_conflict: has_conflict,
            missing_data: day_eps.is_empty(),
        });

        cursor_date += ChronoDuration::days(1);
    }

    summaries
}

pub fn compute_rolling_metrics(
    window_days: usize,
    day_summaries: &[SleepDaySummary],
    episodes: &[CanonicalSleepEpisode],
) -> RollingSleepMetrics {
    let slice_start = day_summaries.len().saturating_sub(window_days);
    let slice = &day_summaries[slice_start..];
    let tracked: Vec<&SleepDaySummary> = slice.iter().filter(|d| !d.missing_data).collect();
    let nights_tracked = tracked.len();
    let missing_nights = slice.len().saturating_sub(nights_tracked);
    let coverage_ratio = if slice.is_empty() {
        0.0
    } else {
        nights_tracked as f64 / slice.len() as f64
    };

    let durations: Vec<f64> = tracked.iter().filter_map(|d| d.main_sleep_mins).collect();
    let tibs: Vec<f64> = tracked.iter().filter_map(|d| d.time_in_bed_mins).collect();
    let effs: Vec<f64> = tracked.iter().filter_map(|d| d.efficiency_pct).collect();
    let wasos: Vec<f64> = tracked.iter().filter_map(|d| d.waso_mins).collect();
    let bedtimes: Vec<f64> = tracked
        .iter()
        .filter_map(|d| d.sleep_onset_local_mins)
        .collect();
    let wakes: Vec<f64> = tracked.iter().filter_map(|d| d.wake_local_mins).collect();
    let midpoints: Vec<f64> = tracked
        .iter()
        .filter_map(|d| d.sleep_midpoint_local_mins)
        .collect();
    let rmssds: Vec<f64> = tracked
        .iter()
        .filter_map(|d| d.overnight_rmssd_ms)
        .collect();
    let sdnns: Vec<f64> = tracked.iter().filter_map(|d| d.overnight_sdnn_ms).collect();
    let rhrs: Vec<f64> = tracked.iter().filter_map(|d| d.resting_hr_bpm).collect();

    let bed_circ = compute_circular_minutes_stats(&bedtimes);
    let wake_circ = compute_circular_minutes_stats(&wakes);
    let mid_circ = compute_circular_minutes_stats(&midpoints);

    // Social jetlag proxy: circular midpoint weekend (Sat/Sun) minus weekday (Mon-Fri)
    let mut weekday_mids = Vec::new();
    let mut weekend_mids = Vec::new();
    for d in &tracked {
        if let (Some(date), Some(mid)) =
            (parse_naive_date(&d.local_date), d.sleep_midpoint_local_mins)
        {
            match date.weekday() {
                Weekday::Sat | Weekday::Sun => weekend_mids.push(mid),
                _ => weekday_mids.push(mid),
            }
        }
    }
    let social_jetlag_mins = if weekday_mids.len() >= 2 && weekend_mids.len() >= 2 {
        match (
            compute_circular_minutes_stats(&weekend_mids),
            compute_circular_minutes_stats(&weekday_mids),
        ) {
            (Some(wknd), Some(wkdy)) => {
                Some(signed_circular_diff_mins(wknd.mean_mins, wkdy.mean_mins))
            }
            _ => None,
        }
    } else {
        None
    };

    let tracked_dates: HashSet<String> = tracked.iter().map(|d| d.local_date.clone()).collect();
    let filtered_eps: Vec<CanonicalSleepEpisode> = episodes
        .iter()
        .filter(|e| tracked_dates.contains(&e.anchor_local_date))
        .cloned()
        .collect();
    let (sri_proxy, sri_day_pairs) = compute_sri_proxy(&filtered_eps, &tracked_dates);

    RollingSleepMetrics {
        window_days,
        nights_tracked,
        missing_nights,
        coverage_ratio,
        mean_total_sleep_mins: mean(&durations),
        sd_total_sleep_mins: std_dev(&durations),
        mean_time_in_bed_mins: mean(&tibs),
        mean_efficiency_pct: mean(&effs),
        mean_waso_mins: mean(&wasos),
        circular_bedtime_mean_mins: bed_circ.as_ref().map(|c| c.mean_mins),
        circular_bedtime_sd_mins: bed_circ.as_ref().map(|c| c.sd_mins),
        circular_wake_mean_mins: wake_circ.as_ref().map(|c| c.mean_mins),
        circular_wake_sd_mins: wake_circ.as_ref().map(|c| c.sd_mins),
        circular_midpoint_mean_mins: mid_circ.as_ref().map(|c| c.mean_mins),
        social_jetlag_mins,
        sri_proxy,
        sri_day_pairs,
        sri_status: if sri_proxy.is_some() {
            SleepRegularityStatus::Available
        } else {
            SleepRegularityStatus::InsufficientConsecutiveDays
        },
        total_naps: tracked.iter().map(|d| d.nap_count).sum(),
        mean_overnight_rmssd_ms: mean(&rmssds),
        mean_overnight_sdnn_ms: mean(&sdnns),
        mean_resting_hr_bpm: mean(&rhrs),
    }
}

fn build_timing_histogram(minutes: &[f64]) -> Vec<TimingHistogramBin> {
    let mut bins: Vec<TimingHistogramBin> = (0..12)
        .map(|idx| {
            let start = (idx * 120) as f64;
            let end = ((idx + 1) * 120) as f64;
            TimingHistogramBin {
                label: format!("{:02}:00–{:02}:00", idx * 2, ((idx + 1) * 2) % 24),
                start_minute: start,
                end_minute: end,
                count: 0,
            }
        })
        .collect();

    for &m in minutes {
        if !m.is_finite() {
            continue;
        }
        let wrapped = m.rem_euclid(1440.0);
        let idx = ((wrapped / 120.0).floor() as usize).min(11);
        bins[idx].count += 1;
    }
    bins
}

fn build_duration_histogram(durations_mins: &[f64]) -> Vec<DurationHistogramBin> {
    let specs = [
        ("< 5h", 0.0, 5.0),
        ("5–6h", 5.0, 6.0),
        ("6–7h", 6.0, 7.0),
        ("7–8h", 7.0, 8.0),
        ("8–9h", 8.0, 9.0),
        ("9h+", 9.0, 24.0),
    ];
    let mut bins: Vec<DurationHistogramBin> = specs
        .iter()
        .map(|(label, min_h, max_h)| DurationHistogramBin {
            label: (*label).to_string(),
            min_hours: *min_h,
            max_hours: *max_h,
            count: 0,
        })
        .collect();

    for &mins in durations_mins {
        let hrs = mins / 60.0;
        for bin in &mut bins {
            if hrs >= bin.min_hours && hrs < bin.max_hours {
                bin.count += 1;
                break;
            }
        }
    }
    bins
}

/// Compute exploratory Borbély Two-Process alertness proxy over `[start_ms, end_ms]`.
/// Process S: tau_i = 18.2 h during wake, tau_d = 4.2 h during sleep/nap.
/// Process C: two-harmonic cosine curve anchored to circular sleep midpoint + 30 min.
pub fn compute_alertness_curve(
    episodes: &[CanonicalSleepEpisode],
    day_summaries: &[SleepDaySummary],
    start_ms: i64,
    end_ms: i64,
    tz_offset_secs: Option<i32>,
) -> BorbelyCurveSummary {
    let model_label = "Exploratory Borbély Two-Process Proxy (Non-Clinical)".to_string();
    let base_note = "Descriptive alertness proxy using two-process dynamics (τ_i = 18.2h wake buildup, τ_d = 4.2h sleep decay) anchored to personal sleep midpoint + 30m. This is NOT a clinical circadian phase or DLMO measurement.".to_string();

    let midpoints: Vec<f64> = day_summaries
        .iter()
        .filter_map(|d| d.sleep_midpoint_local_mins)
        .collect();
    let mid_stats = compute_circular_minutes_stats(&midpoints);
    if midpoints.len() < 3 || mid_stats.is_none() || end_ms <= start_ms {
        return BorbelyCurveSummary {
            is_clinical: false,
            model_label,
            methodology_note: format!(
                "{base_note} At least 3 main sleep episodes are required to estimate an exploratory curve."
            ),
            inferred_circadian_midpoint_mins: mid_stats.as_ref().map(|m| m.mean_mins),
            estimated_nadir_mins: mid_stats
                .as_ref()
                .map(|m| (m.mean_mins + 30.0).rem_euclid(1440.0)),
            schedule_sd_mins: mid_stats.as_ref().map(|m| m.sd_mins),
            points: Vec::new(),
        };
    }

    let stats = mid_stats.unwrap();
    let nadir_mins = (stats.mean_mins + 30.0).rem_euclid(1440.0);
    let peak_mins = (nadir_mins + 720.0).rem_euclid(1440.0);

    let tracked_days = day_summaries.iter().filter(|d| !d.missing_data).count();
    let missing_ratio = if day_summaries.is_empty() {
        1.0
    } else {
        1.0 - (tracked_days as f64 / day_summaries.len() as f64)
    };
    let tracked_dates: HashSet<&str> = day_summaries
        .iter()
        .filter(|d| !d.missing_data)
        .map(|d| d.local_date.as_str())
        .collect();

    // Limit output density cleanly (e.g., 30 min steps for short ranges, up to 2h for multi-month ranges)
    let span_hours = (end_ms - start_ms) as f64 / 3_600_000.0;
    let step_mins: i64 = if span_hours <= 48.0 {
        30
    } else if span_hours <= 24.0 * 14.0 {
        60
    } else if span_hours <= 24.0 * 45.0 {
        180
    } else {
        360
    };
    let step_ms = step_mins * 60_000;
    let sim_step_ms: i64 = 15 * 60_000;
    let sim_start_ms = start_ms - 48 * 3_600_000;

    let mut sorted_eps: Vec<&CanonicalSleepEpisode> = episodes.iter().collect();
    sorted_eps.sort_by_key(|e| e.start_at_ms);

    let tau_i_hours = 18.2_f64;
    let tau_d_hours = 4.2_f64;
    let dt_hours = sim_step_ms as f64 / 3_600_000.0;
    let wake_decay = (-dt_hours / tau_i_hours).exp();
    let sleep_decay = (-dt_hours / tau_d_hours).exp();

    let mut process_s = 0.25_f64;
    let mut t = sim_start_ms;
    let mut next_emit = start_ms;
    let mut points = Vec::new();
    let mut ep_idx = 0usize;

    while t <= end_ms {
        while ep_idx < sorted_eps.len() && sorted_eps[ep_idx].end_at_ms <= t {
            ep_idx += 1;
        }
        let is_asleep = sorted_eps[ep_idx..]
            .iter()
            .take_while(|e| e.start_at_ms <= t)
            .any(|e| t >= e.start_at_ms && t < e.end_at_ms);

        if t >= next_emit {
            let local_dt = to_local_datetime(t, tz_offset_secs);
            let local_date = local_dt.date_naive().format("%Y-%m-%d").to_string();
            let local_m = local_minutes_of_day(t, tz_offset_secs);
            let phase_diff = (local_m - peak_mins) * std::f64::consts::TAU / 1440.0;
            let raw_c = 0.5 + 0.35 * phase_diff.cos() + 0.12 * (2.0 * phase_diff).cos();
            let process_c = ((raw_c - 0.27) / (0.97 - 0.27)).clamp(0.0, 1.0);
            let alertness = (0.52 + 0.48 * process_c - 0.45 * process_s).clamp(0.0, 1.0);

            let in_missing_gap = !tracked_dates.contains(local_date.as_str());
            let sd_contrib = 0.12 * (stats.sd_mins / 120.0).min(1.0);
            let gap_contrib = if in_missing_gap { 0.16 } else { 0.0 };
            let uncertainty =
                (0.10 + sd_contrib + 0.14 * missing_ratio + gap_contrib).clamp(0.10, 0.45);

            points.push(BorbelyAlertnessPoint {
                timestamp_ms: t,
                local_label: local_dt.format("%Y-%m-%d %H:%M").to_string(),
                alertness,
                uncertainty_half_width: uncertainty,
                process_s,
                process_c,
            });
            next_emit += step_ms;
        }

        if is_asleep {
            process_s *= sleep_decay;
        } else {
            process_s = 1.0 - (1.0 - process_s) * wake_decay;
        }
        process_s = process_s.clamp(0.0, 1.0);
        t += sim_step_ms;
    }

    BorbelyCurveSummary {
        is_clinical: false,
        model_label,
        methodology_note: base_note,
        inferred_circadian_midpoint_mins: Some(stats.mean_mins),
        estimated_nadir_mins: Some(nadir_mins),
        schedule_sd_mins: Some(stats.sd_mins),
        points,
    }
}

pub fn build_sleep_chart_data(
    episodes: Vec<CanonicalSleepEpisode>,
    physio: &[PhysiologicalObservation],
    recovery: &[RecoveryObservation],
    study_overlays: Vec<StudyOverlayPoint>,
    start_ms: i64,
    end_ms: i64,
    tz_offset_secs: Option<i32>,
) -> SleepChartData {
    let day_summaries = build_day_summaries(
        &episodes,
        physio,
        recovery,
        start_ms,
        end_ms,
        tz_offset_secs,
    );
    let rolling_7d = compute_rolling_metrics(7, &day_summaries, &episodes);
    let rolling_14d = compute_rolling_metrics(14, &day_summaries, &episodes);
    let rolling_30d = compute_rolling_metrics(30, &day_summaries, &episodes);
    let rolling_90d = compute_rolling_metrics(90, &day_summaries, &episodes);

    let tracked_beds: Vec<f64> = day_summaries
        .iter()
        .filter_map(|d| d.sleep_onset_local_mins)
        .collect();
    let tracked_wakes: Vec<f64> = day_summaries
        .iter()
        .filter_map(|d| d.wake_local_mins)
        .collect();
    let tracked_durs: Vec<f64> = day_summaries
        .iter()
        .filter_map(|d| d.main_sleep_mins)
        .collect();

    let bedtime_distribution = build_timing_histogram(&tracked_beds);
    let wake_distribution = build_timing_histogram(&tracked_wakes);
    let duration_distribution = build_duration_histogram(&tracked_durs);
    let alertness_curve =
        compute_alertness_curve(&episodes, &day_summaries, start_ms, end_ms, tz_offset_secs);

    let mut warnings = Vec::new();
    let tracked_days = day_summaries.iter().filter(|d| !d.missing_data).count();
    if tracked_days == 0 {
        warnings.push("No sleep data recorded in the selected date range.".to_string());
    } else if day_summaries.iter().any(|d| d.missing_data) {
        warnings.push(format!(
            "{} of {} days in range have no recorded sleep data; missing days are excluded from regularity and rolling averages.",
            day_summaries.len().saturating_sub(tracked_days),
            day_summaries.len()
        ));
    }
    if episodes
        .iter()
        .any(|e| e.stage_coverage_ratio < MIN_STAGE_COVERAGE_RATIO)
    {
        warnings.push(
            "One or more sleep episodes lack >= 70% stage interval coverage; sleep stage percentages are omitted rather than inferred."
                .to_string(),
        );
    }
    if !day_summaries.is_empty()
        && day_summaries.iter().any(|d| d.overnight_rmssd_ms.is_some())
        && day_summaries.iter().any(|d| d.overnight_sdnn_ms.is_some())
    {
        warnings.push(
            "Both RMSSD and SDNN HRV records are present across connected sources and are kept strictly separate because their scales are not interchangeable."
                .to_string(),
        );
    }

    SleepChartData {
        start_ms,
        end_ms,
        episodes,
        day_summaries,
        rolling_7d,
        rolling_14d,
        rolling_30d,
        rolling_90d,
        bedtime_distribution,
        wake_distribution,
        duration_distribution,
        study_overlays,
        alertness_curve,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::health::models::{HealthProviderId, SleepStageInterval, SleepStageType};
    use crate::health::time::parse_timestamp_with_offset;

    fn make_episode(
        id: &str,
        start_iso: &str,
        end_iso: &str,
        kind: SleepKind,
        override_kind: Option<SleepKind>,
        stage_cov: f64,
    ) -> CanonicalSleepEpisode {
        let (s, s_off) = parse_timestamp_with_offset(start_iso).unwrap();
        let (e, e_off) = parse_timestamp_with_offset(end_iso).unwrap();
        let mins = (e - s) as f64 / 60_000.0;
        let has_stages = stage_cov >= 0.70;
        CanonicalSleepEpisode {
            id: id.to_string(),
            primary_raw_session_id: format!("raw-{id}"),
            primary_provider_id: HealthProviderId::Oura,
            start_at_ms: s,
            end_at_ms: e,
            start_tz_offset_secs: s_off,
            end_tz_offset_secs: e_off,
            anchor_local_date: crate::health::time::compute_anchor_local_date(
                s, e, s_off, e_off, kind,
            ),
            sleep_kind: kind,
            user_sleep_kind_override: override_kind,
            total_sleep_mins: mins,
            time_in_bed_mins: Some(mins + 20.0),
            sleep_efficiency_pct: Some(mins / (mins + 20.0) * 100.0),
            waso_mins: if has_stages { Some(12.0) } else { None },
            stage_coverage_ratio: stage_cov,
            awake_mins: if has_stages { Some(12.0) } else { None },
            light_mins: if has_stages { Some(mins * 0.55) } else { None },
            deep_mins: if has_stages { Some(mins * 0.22) } else { None },
            rem_mins: if has_stages { Some(mins * 0.23) } else { None },
            has_source_conflict: false,
            conflict_duration_diff_mins: None,
            quality_flags: vec![],
            is_synthetic: true,
            stages: if has_stages {
                vec![SleepStageInterval {
                    id: format!("st-{id}"),
                    raw_session_id: format!("raw-{id}"),
                    stage_type: SleepStageType::Light,
                    start_at_ms: s,
                    end_at_ms: e,
                    provider_stage_code: None,
                }]
            } else {
                vec![]
            },
            members: vec![],
        }
    }

    #[test]
    fn chart_uses_elapsed_sleep_on_the_spring_dst_night() {
        let episode = make_episode(
            "dst",
            "2026-03-07T23:00:00-05:00",
            "2026-03-08T07:00:00-04:00",
            SleepKind::MainSleep,
            None,
            0.0,
        );
        let start = episode.start_at_ms;
        let end = episode.end_at_ms;
        let chart =
            build_sleep_chart_data(vec![episode], &[], &[], vec![], start, end, Some(-14400));
        let day = chart
            .day_summaries
            .iter()
            .find(|day| day.local_date == "2026-03-08")
            .unwrap();
        assert_eq!(day.main_sleep_mins, Some(420.0));
        assert_eq!(day.wake_local_mins, Some(420.0));
        assert_eq!(
            chart.rolling_14d.sri_status,
            SleepRegularityStatus::InsufficientConsecutiveDays
        );
    }

    #[test]
    fn circular_mean_wraps_across_midnight() {
        let stats = compute_circular_minutes_stats(&[23.0 * 60.0 + 50.0, 10.0]).unwrap();
        // Mean of 23:50 (1430) and 00:10 (10) is midnight (0.0 or ~1440.0).
        assert!(
            stats.mean_mins < 1.0 || stats.mean_mins > 1439.0,
            "got {}",
            stats.mean_mins
        );
        assert!(stats.sd_mins > 5.0 && stats.sd_mins < 20.0);
    }

    #[test]
    fn unstaged_sleep_does_not_fabricate_stage_percentages() {
        let ep = make_episode(
            "ep1",
            "2026-11-19T23:00:00Z",
            "2026-11-20T07:00:00Z",
            SleepKind::MainSleep,
            None,
            0.0,
        );
        let chart = build_sleep_chart_data(
            vec![ep],
            &[],
            &[],
            vec![],
            parse_timestamp_with_offset("2026-11-20T00:00:00Z")
                .unwrap()
                .0,
            parse_timestamp_with_offset("2026-11-20T23:59:59Z")
                .unwrap()
                .0,
            Some(0),
        );
        let day = &chart.day_summaries[0];
        assert_eq!(day.stage_coverage_ratio, 0.0);
        assert!(day.deep_pct.is_none());
        assert!(day.rem_pct.is_none());
        assert!(day.light_pct.is_none());
    }

    #[test]
    fn sparse_sleep_omits_sri_proxy() {
        let eps = vec![
            make_episode(
                "1",
                "2026-11-01T23:00:00Z",
                "2026-11-02T07:00:00Z",
                SleepKind::MainSleep,
                None,
                0.9,
            ),
            make_episode(
                "2",
                "2026-11-02T23:00:00Z",
                "2026-11-03T07:00:00Z",
                SleepKind::MainSleep,
                None,
                0.9,
            ),
            make_episode(
                "3",
                "2026-11-05T23:00:00Z",
                "2026-11-06T07:00:00Z",
                SleepKind::MainSleep,
                None,
                0.9,
            ),
        ];
        let tracked: HashSet<String> = eps.iter().map(|e| e.anchor_local_date.clone()).collect();
        let (sri, pairs) = compute_sri_proxy(&eps, &tracked);
        assert_eq!(pairs, 1);
        assert!(sri.is_none());
    }

    #[test]
    fn regular_8_consecutive_nights_produce_high_sri_and_borbely_curve() {
        let mut eps = Vec::new();
        for d in 1..=9 {
            let s = format!("2026-11-{:02}T23:00:00Z", d);
            let e = format!("2026-11-{:02}T07:00:00Z", d + 1);
            eps.push(make_episode(
                &format!("n{d}"),
                &s,
                &e,
                SleepKind::MainSleep,
                None,
                0.95,
            ));
        }
        let chart = build_sleep_chart_data(
            eps,
            &[],
            &[],
            vec![],
            parse_timestamp_with_offset("2026-11-02T00:00:00Z")
                .unwrap()
                .0,
            parse_timestamp_with_offset("2026-11-10T23:59:59Z")
                .unwrap()
                .0,
            Some(0),
        );
        assert!(chart.rolling_14d.sri_proxy.unwrap() > 80.0);
        assert!(!chart.alertness_curve.is_clinical);
        assert!(!chart.alertness_curve.points.is_empty());

        // Process S shortly after waking (08:00) should be lower than late evening (22:00)
        let morning = chart
            .alertness_curve
            .points
            .iter()
            .find(|p| p.local_label.ends_with("2026-11-10 08:00"))
            .unwrap();
        let night = chart
            .alertness_curve
            .points
            .iter()
            .find(|p| p.local_label.ends_with("2026-11-10 22:00"))
            .unwrap();
        assert!(morning.process_s < night.process_s);
    }

    #[test]
    fn nap_classification_respects_user_override_before_heuristic() {
        let main = make_episode(
            "m",
            "2026-11-19T23:00:00Z",
            "2026-11-20T07:00:00Z",
            SleepKind::MainSleep,
            None,
            0.9,
        );
        let unknown_short = make_episode(
            "n",
            "2026-11-20T14:00:00Z",
            "2026-11-20T14:35:00Z",
            SleepKind::Unknown,
            None,
            0.0,
        );
        let forced_main = make_episode(
            "f",
            "2026-11-20T14:00:00Z",
            "2026-11-20T14:35:00Z",
            SleepKind::Nap,
            Some(SleepKind::MainSleep),
            0.0,
        );
        let all = vec![main, unknown_short.clone(), forced_main.clone()];
        assert_eq!(classify_sleep_kind(&unknown_short, &all), SleepKind::Nap);
        assert_eq!(
            classify_sleep_kind(&forced_main, &all),
            SleepKind::MainSleep
        );
    }

    #[test]
    fn hrv_rmssd_and_sdnn_stay_segregated() {
        let t = parse_timestamp_with_offset("2026-11-20T06:00:00Z")
            .unwrap()
            .0;
        let ep = make_episode(
            "e",
            "2026-11-19T23:00:00Z",
            "2026-11-20T07:00:00Z",
            SleepKind::MainSleep,
            None,
            0.9,
        );
        let physio = vec![
            PhysiologicalObservation {
                id: "p1".into(),
                provider_id: HealthProviderId::Oura,
                device_id: None,
                external_record_id: "r1".into(),
                metric_type: PhysiologicalMetricType::Hrv,
                value: 62.0,
                unit: "ms".into(),
                hrv_method: HrvMethod::Rmssd,
                measured_at_ms: t,
                period_start_ms: None,
                period_end_ms: None,
                tz_offset_secs: Some(0),
                aggregation_method: None,
                quality_flags: vec![],
                acquisition_at_ms: t,
                sync_batch_id: None,
                is_deleted: false,
                is_synthetic: true,
            },
            PhysiologicalObservation {
                id: "p2".into(),
                provider_id: HealthProviderId::AppleHealthkit,
                device_id: None,
                external_record_id: "r2".into(),
                metric_type: PhysiologicalMetricType::Hrv,
                value: 44.0,
                unit: "ms".into(),
                hrv_method: HrvMethod::Sdnn,
                measured_at_ms: t,
                period_start_ms: None,
                period_end_ms: None,
                tz_offset_secs: Some(0),
                aggregation_method: None,
                quality_flags: vec![],
                acquisition_at_ms: t,
                sync_batch_id: None,
                is_deleted: false,
                is_synthetic: true,
            },
        ];
        let chart =
            build_sleep_chart_data(vec![ep], &physio, &[], vec![], t - 1000, t + 1000, Some(0));
        let day = &chart.day_summaries[0];
        assert_eq!(day.overnight_rmssd_ms, Some(62.0));
        assert_eq!(day.overnight_sdnn_ms, Some(44.0));
    }
}
