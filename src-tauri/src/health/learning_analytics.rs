//! Within-person health-to-learning correlation engine, conservative
//! statistical guardrails, temporal held-out predictive validation for Learning
//! Windows, explainable Personal Insights, and all 15 synthetic statistical tests.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use super::models::{CanonicalSleepEpisode, PhysiologicalObservation, RecoveryObservation};
use super::statistics::{
    apply_bh_fdr, bootstrap_day_clustered_slope, compare_matched_nap_sessions, fit_weighted_ols,
    pearson_correlation, two_sided_student_t_p, NapComparisonResult, RegressionObservation,
};
use super::telemetry::{
    align_assessments_with_sleep, build_comparable_sessions, replay_reviews_fsrs7,
    ComparableStudySession, FinalizedAssessmentRecord, LearningTelemetrySnapshot, ReplayedReview,
    StudyPlanRef,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticalGuardrails {
    pub min_paired_reviews: usize,
    pub min_sessions: usize,
    pub min_distinct_days: usize,
    pub min_assessment_attempts: usize,
    pub min_sleep_sd_hours: f64,
    pub min_coverage_ratio: f64,
    pub min_bucket_sessions: usize,
    pub min_bucket_reviews: usize,
    pub fdr_alpha: f64,
}

impl Default for StatisticalGuardrails {
    fn default() -> Self {
        Self {
            min_paired_reviews: 60,
            min_sessions: 12,
            min_distinct_days: 10,
            min_assessment_attempts: 8,
            min_sleep_sd_hours: 0.5,
            min_coverage_ratio: 0.50,
            min_bucket_sessions: 5,
            min_bucket_reviews: 20,
            fdr_alpha: 0.05,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSufficiencySummary {
    pub total_reviews: usize,
    pub fsrs_replay_reviews: usize,
    pub paired_fsrs_reviews: usize,
    pub total_sessions: usize,
    pub paired_sessions: usize,
    pub distinct_days: usize,
    pub sleep_coverage_ratio: f64,
    pub sleep_duration_sd_hours: Option<f64>,
    pub finalized_assessments: usize,
    pub meets_core_guardrails: bool,
    pub blocking_reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceBucketPoint {
    pub label: String,
    pub sessions: usize,
    pub reviews: usize,
    pub mean_raw_recall: Option<f64>,
    pub mean_fsrs_residual: Option<f64>,
    pub ci_low: Option<f64>,
    pub ci_high: Option<f64>,
    pub median_latency_secs: Option<f64>,
    pub mean_log_latency: Option<f64>,
    pub sufficient: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentModeBreakdown {
    pub mode: String,
    pub attempts: usize,
    pub distinct_days: usize,
    pub sleep_paired_attempts: usize,
    pub mean_score_pct: Option<f64>,
    pub short_sleep_mean_pct: Option<f64>,
    pub adequate_sleep_mean_pct: Option<f64>,
    pub pearson_r_sleep_duration: Option<f64>,
    pub pearson_r_regularity: Option<f64>,
    pub p_value: Option<f64>,
    pub sufficient: bool,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningWindowBucket {
    pub label: String,
    pub hour_start: u8,
    pub hour_end: u8,
    pub sessions: usize,
    pub reviews: usize,
    pub mean_fsrs_residual: Option<f64>,
    pub median_latency_secs: Option<f64>,
    pub sufficient: bool,
    pub is_favorable_window: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelComparisonRow {
    pub model_id: String,
    pub label: String,
    pub evaluated: bool,
    pub held_out_rmse: Option<f64>,
    pub skip_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningWindowsAnalysis {
    pub validation_status: String, // "validated_predictive" | "descriptive_only" | "insufficient_data"
    pub train_sessions: usize,
    pub test_sessions: usize,
    pub best_model_id: Option<String>,
    pub rmse_baseline_m0: Option<f64>,
    pub rmse_best_model: Option<f64>,
    pub recommended_window_label: Option<String>,
    pub explanation: String,
    pub windows: Vec<LearningWindowBucket>,
    pub models: Vec<ModelComparisonRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightEvidenceDetails {
    pub sample_reviews: usize,
    pub sample_sessions: usize,
    pub distinct_days: usize,
    pub coverage_ratio: f64,
    pub effect_size_label: String,
    pub effect_size: Option<f64>,
    pub partial_r: Option<f64>,
    pub ci_low: Option<f64>,
    pub ci_high: Option<f64>,
    pub p_value: Option<f64>,
    pub q_value: Option<f64>,
    pub confounders_controlled: Vec<String>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalInsight {
    pub id: String,
    pub metric_key: String,
    pub status: String, // "supported" | "no_clear_pattern" | "exploratory" | "insufficient_data"
    pub direction: String, // "positive" | "negative" | "neutral" | "unknown"
    pub title: String,
    pub summary: String,
    pub evidence: InsightEvidenceDetails,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningInsightsReport {
    pub scope_plan_id: Option<String>,
    pub is_synthetic_demo: bool,
    pub guardrails: StatisticalGuardrails,
    pub sufficiency: DataSufficiencySummary,
    pub study_plans: Vec<StudyPlanRef>,
    pub sleep_duration_buckets: Vec<PerformanceBucketPoint>,
    pub awake_duration_buckets: Vec<PerformanceBucketPoint>,
    pub time_of_day_buckets: Vec<PerformanceBucketPoint>,
    pub hrv_rmssd_buckets: Vec<PerformanceBucketPoint>,
    pub hrv_sdnn_buckets: Vec<PerformanceBucketPoint>,
    pub resting_hr_buckets: Vec<PerformanceBucketPoint>,
    pub nap_comparison: NapComparisonResult,
    pub assessment_breakdowns: Vec<AssessmentModeBreakdown>,
    pub learning_windows: LearningWindowsAnalysis,
    pub insights: Vec<PersonalInsight>,
}

pub const PROHIBITED_OVERCLAIM_SUBSTRINGS: &[&str] = &[
    "proves ",
    "proved ",
    "causes ",
    "caused ",
    "diagnoses ",
    "diagnosed ",
    "sleep apnea",
    "insomnia disorder",
    "will improve",
    "guarantees ",
    "prescribes ",
];

pub fn contains_overclaim_language(text: &str) -> Option<&'static str> {
    let lower = text.to_ascii_lowercase();
    for &phrase in PROHIBITED_OVERCLAIM_SUBSTRINGS {
        if lower.contains(phrase) {
            return Some(phrase);
        }
    }
    None
}

fn bucket_points(
    specs: &[(&str, fn(&ComparableStudySession) -> bool)],
    sessions: &[&ComparableStudySession],
    guardrails: &StatisticalGuardrails,
) -> Vec<PerformanceBucketPoint> {
    specs
        .iter()
        .map(|(label, pred)| {
            let matched: Vec<&ComparableStudySession> =
                sessions.iter().copied().filter(|s| pred(s)).collect();
            let sess_count = matched.len();
            let rev_count: usize = matched.iter().map(|s| s.fsrs_residual_reviews).sum();
            let sufficient = sess_count >= guardrails.min_bucket_sessions
                && rev_count >= guardrails.min_bucket_reviews;

            if matched.is_empty() {
                return PerformanceBucketPoint {
                    label: (*label).to_string(),
                    sessions: 0,
                    reviews: 0,
                    mean_raw_recall: None,
                    mean_fsrs_residual: None,
                    ci_low: None,
                    ci_high: None,
                    median_latency_secs: None,
                    mean_log_latency: None,
                    sufficient: false,
                };
            }

            let raw_sum: f64 = matched
                .iter()
                .map(|s| s.mean_raw_recall * s.total_reviews.max(1) as f64)
                .sum();
            let raw_w: usize = matched.iter().map(|s| s.total_reviews.max(1)).sum();
            let mean_raw = Some(raw_sum / raw_w.max(1) as f64);

            let res_pairs: Vec<(f64, f64)> = matched
                .iter()
                .filter_map(|s| {
                    s.mean_fsrs_residual
                        .map(|r| (r, s.fsrs_residual_reviews.max(1) as f64))
                })
                .collect();
            let (mean_res, ci_low, ci_high) = if !res_pairs.is_empty() {
                let w_sum: f64 = res_pairs.iter().map(|(_, w)| *w).sum();
                let m = res_pairs.iter().map(|(r, w)| r * w).sum::<f64>() / w_sum;
                if res_pairs.len() >= 3 {
                    let unweighted_sd = {
                        let um =
                            res_pairs.iter().map(|(r, _)| *r).sum::<f64>() / res_pairs.len() as f64;
                        let var = res_pairs.iter().map(|(r, _)| (r - um).powi(2)).sum::<f64>()
                            / (res_pairs.len() - 1) as f64;
                        var.sqrt()
                    };
                    let se = unweighted_sd / (res_pairs.len() as f64).sqrt();
                    (Some(m), Some(m - 1.96 * se), Some(m + 1.96 * se))
                } else {
                    (Some(m), None, None)
                }
            } else {
                (None, None, None)
            };

            let mut lats: Vec<f64> = matched.iter().map(|s| s.median_latency_secs).collect();
            lats.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let med_lat = Some(lats[lats.len() / 2]);
            let mean_log_lat = Some(
                matched.iter().map(|s| s.mean_log_latency).sum::<f64>() / matched.len() as f64,
            );

            PerformanceBucketPoint {
                label: (*label).to_string(),
                sessions: sess_count,
                reviews: rev_count,
                mean_raw_recall: mean_raw,
                mean_fsrs_residual: mean_res,
                ci_low,
                ci_high,
                median_latency_secs: med_lat,
                mean_log_latency: mean_log_lat,
                sufficient,
            }
        })
        .collect()
}

fn tod_bucket_label(hour: f64) -> (&'static str, u8, u8) {
    if (5.0..9.0).contains(&hour) {
        ("Early Morning (05–09)", 5, 9)
    } else if (9.0..12.0).contains(&hour) {
        ("Late Morning (09–12)", 9, 12)
    } else if (12.0..16.0).contains(&hour) {
        ("Early Afternoon (12–16)", 12, 16)
    } else if (16.0..20.0).contains(&hour) {
        ("Late Afternoon (16–20)", 16, 20)
    } else {
        ("Evening / Night (20–05)", 20, 5)
    }
}

fn rmse(preds: &[f64], actuals: &[f64]) -> Option<f64> {
    if preds.is_empty() || preds.len() != actuals.len() {
        return None;
    }
    let mse = preds
        .iter()
        .zip(actuals.iter())
        .map(|(p, a)| (p - a).powi(2))
        .sum::<f64>()
        / preds.len() as f64;
    Some(mse.sqrt())
}

fn held_out_improvement(
    predictions: &[f64],
    actuals: &[f64],
    sessions: &[&ComparableStudySession],
    baseline: f64,
) -> Option<f64> {
    let mut day_losses: BTreeMap<&str, (f64, usize)> = BTreeMap::new();
    for ((&prediction, &actual), session) in predictions.iter().zip(actuals).zip(sessions) {
        let (total, count) = day_losses.entry(&session.local_date).or_default();
        *total += (baseline - actual).powi(2) - (prediction - actual).powi(2);
        *count += 1;
    }
    if day_losses.len() < 6 {
        return None;
    }
    let improvements: Vec<f64> = day_losses
        .into_values()
        .map(|(loss, count)| loss / count as f64)
        .collect();
    let n = improvements.len() as f64;
    let mean = improvements.iter().sum::<f64>() / n;
    let variance = improvements
        .iter()
        .map(|loss| (loss - mean).powi(2))
        .sum::<f64>()
        / (n - 1.0);
    if mean <= 0.0 || !variance.is_finite() {
        return None;
    }
    let p = if variance == 0.0 {
        0.0
    } else {
        two_sided_student_t_p(mean / (variance / n).sqrt(), n - 1.0)
    };
    p.is_finite().then_some(p)
}

fn predict_ols(beta: &[f64], x: &[f64]) -> f64 {
    beta.iter().zip(x.iter()).map(|(b, v)| b * v).sum()
}

fn evaluate_learning_windows(
    sessions: &[ComparableStudySession],
    guardrails: &StatisticalGuardrails,
) -> LearningWindowsAnalysis {
    let mut valid_sessions: Vec<&ComparableStudySession> = sessions
        .iter()
        .filter(|s| s.mean_fsrs_residual.is_some() && s.fsrs_residual_reviews > 0)
        .collect();

    valid_sessions.sort_by_key(|session| session.started_at_ms);

    let bucket_defs: [(&str, u8, u8); 5] = [
        ("Early Morning (05–09)", 5, 9),
        ("Late Morning (09–12)", 9, 12),
        ("Early Afternoon (12–16)", 12, 16),
        ("Late Afternoon (16–20)", 16, 20),
        ("Evening / Night (20–05)", 20, 5),
    ];

    let mut windows: Vec<LearningWindowBucket> = bucket_defs
        .iter()
        .map(|&(label, h_start, h_end)| {
            let in_bucket: Vec<&ComparableStudySession> = valid_sessions
                .iter()
                .copied()
                .filter(|s| tod_bucket_label(s.local_start_hour).0 == label)
                .collect();
            let sess_count = in_bucket.len();
            let rev_count: usize = in_bucket.iter().map(|s| s.fsrs_residual_reviews).sum();
            let sufficient = sess_count >= guardrails.min_bucket_sessions
                && rev_count >= guardrails.min_bucket_reviews;
            let mean_res = if !in_bucket.is_empty() {
                let w_sum: f64 = in_bucket
                    .iter()
                    .map(|s| s.fsrs_residual_reviews as f64)
                    .sum();
                Some(
                    in_bucket
                        .iter()
                        .map(|s| s.mean_fsrs_residual.unwrap() * s.fsrs_residual_reviews as f64)
                        .sum::<f64>()
                        / w_sum.max(1.0),
                )
            } else {
                None
            };
            let mut lats: Vec<f64> = in_bucket.iter().map(|s| s.median_latency_secs).collect();
            lats.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let med_lat = if lats.is_empty() {
                None
            } else {
                Some(lats[lats.len() / 2])
            };
            LearningWindowBucket {
                label: label.to_string(),
                hour_start: h_start,
                hour_end: h_end,
                sessions: sess_count,
                reviews: rev_count,
                mean_fsrs_residual: mean_res,
                median_latency_secs: med_lat,
                sufficient,
                is_favorable_window: false,
            }
        })
        .collect();

    let populated_buckets = windows.iter().filter(|w| w.sufficient).count();
    let distinct_days: HashSet<&str> = valid_sessions
        .iter()
        .map(|s| s.local_date.as_str())
        .collect();
    let total_valid_reviews: usize = valid_sessions.iter().map(|s| s.fsrs_residual_reviews).sum();

    if populated_buckets < 2
        || valid_sessions.len() < guardrails.min_sessions
        || total_valid_reviews < guardrails.min_paired_reviews
        || distinct_days.len() < guardrails.min_distinct_days
    {
        return LearningWindowsAnalysis {
            validation_status: "insufficient_data".to_string(),
            train_sessions: 0,
            test_sessions: 0,
            best_model_id: None,
            rmse_baseline_m0: None,
            rmse_best_model: None,
            recommended_window_label: None,
            explanation: format!(
                "Learning Window evaluation requires at least {} sessions, {} FSRS-paired reviews, {} distinct days, and 2 populated time-of-day windows (>= {} sessions & {} reviews each).",
                guardrails.min_sessions,
                guardrails.min_paired_reviews,
                guardrails.min_distinct_days,
                guardrails.min_bucket_sessions,
                guardrails.min_bucket_reviews,
            ),
            windows,
            models: vec![],
        };
    }

    let split_idx = ((valid_sessions.len() as f64) * 0.70).floor() as usize;
    let train = &valid_sessions[..split_idx];
    let test = &valid_sessions[split_idx..];

    if train.len() < 8 || test.len() < 6 {
        return LearningWindowsAnalysis {
            validation_status: "descriptive_only".to_string(),
            train_sessions: train.len(),
            test_sessions: test.len(),
            best_model_id: None,
            rmse_baseline_m0: None,
            rmse_best_model: None,
            recommended_window_label: windows
                .iter()
                .filter(|w| w.sufficient)
                .max_by(|a, b| {
                    a.mean_fsrs_residual
                        .unwrap_or(-9.0)
                        .partial_cmp(&b.mean_fsrs_residual.unwrap_or(-9.0))
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|w| w.label.clone()),
            explanation: "Held-out temporal split has fewer than 6 recent test sessions; windows are labeled descriptive-only.".to_string(),
            windows,
            models: vec![],
        };
    }

    let train_mean = train
        .iter()
        .map(|s| s.mean_fsrs_residual.unwrap())
        .sum::<f64>()
        / train.len() as f64;
    let test_actuals: Vec<f64> = test.iter().map(|s| s.mean_fsrs_residual.unwrap()).collect();

    // M0: Constant individual baseline
    let preds_m0 = vec![train_mean; test.len()];
    let rmse_m0 = rmse(&preds_m0, &test_actuals).unwrap_or(1.0);

    // M2: Recent 7-day rolling mean fitted on train tail
    let last_train_ms = train.last().unwrap().started_at_ms;
    let recent_7d: Vec<f64> = train
        .iter()
        .filter(|s| last_train_ms - s.started_at_ms <= 7 * 86_400_000)
        .filter_map(|s| s.mean_fsrs_residual)
        .collect();
    let m2_val = if recent_7d.len() >= 3 {
        recent_7d.iter().sum::<f64>() / recent_7d.len() as f64
    } else {
        train_mean
    };
    let rmse_m2 = rmse(&vec![m2_val; test.len()], &test_actuals);

    let mut supported_models = HashSet::new();
    let mut evaluate_model = |id, predictions: &[f64]| {
        if held_out_improvement(predictions, &test_actuals, test, train_mean)
            .is_some_and(|p| p <= guardrails.fdr_alpha / 4.0)
        {
            supported_models.insert(id);
        }
        rmse(predictions, &test_actuals)
    };

    // Helper for harmonic features
    let tod_feats = |s: &ComparableStudySession| {
        let theta = s.local_start_hour * std::f64::consts::TAU / 24.0;
        (theta.sin(), theta.cos())
    };

    // M1: Time-of-day harmonic OLS
    let m1_train_obs: Vec<RegressionObservation> = train
        .iter()
        .map(|s| {
            let (st, ct) = tod_feats(s);
            RegressionObservation {
                day_key: s.local_date.clone(),
                weight: s.fsrs_residual_reviews as f64,
                y: s.mean_fsrs_residual.unwrap(),
                x: vec![1.0, st, ct],
            }
        })
        .collect();
    let m1_fit = fit_weighted_ols(&m1_train_obs);
    let rmse_m1 = m1_fit.as_ref().and_then(|fit| {
        let preds: Vec<f64> = test
            .iter()
            .map(|s| {
                let (st, ct) = tod_feats(s);
                predict_ols(&fit.coefficients, &[1.0, st, ct])
            })
            .collect();
        evaluate_model("M1", &preds)
    });

    // M3: Time-of-day + prior main sleep duration
    let train_sleep_vals: Vec<f64> = train
        .iter()
        .filter_map(|s| s.preceding_main_sleep_hours)
        .collect();
    let test_sleep_count = test
        .iter()
        .filter(|s| s.preceding_main_sleep_hours.is_some())
        .count();
    let rmse_m3 = if train_sleep_vals.len() >= 6 && test_sleep_count >= 4 {
        let obs: Vec<RegressionObservation> = train
            .iter()
            .filter_map(|s| {
                let sh = s.preceding_main_sleep_hours?;
                let (st, ct) = tod_feats(s);
                Some(RegressionObservation {
                    day_key: s.local_date.clone(),
                    weight: s.fsrs_residual_reviews as f64,
                    y: s.mean_fsrs_residual.unwrap(),
                    x: vec![1.0, sh, st, ct],
                })
            })
            .collect();
        let mean_sh = train_sleep_vals.iter().sum::<f64>() / train_sleep_vals.len() as f64;
        fit_weighted_ols(&obs).and_then(|fit| {
            let preds: Vec<f64> = test
                .iter()
                .map(|s| {
                    let sh = s.preceding_main_sleep_hours.unwrap_or(mean_sh);
                    let (st, ct) = tod_feats(s);
                    predict_ols(&fit.coefficients, &[1.0, sh, st, ct])
                })
                .collect();
            evaluate_model("M3", &preds)
        })
    } else {
        None
    };

    // M4: Time-of-day + prior sleep + time since awakening
    let train_m4_count = train
        .iter()
        .filter(|s| {
            s.preceding_main_sleep_hours.is_some() && s.elapsed_since_awakening_hours.is_some()
        })
        .count();
    let rmse_m4 = if train_m4_count >= 8 && test_sleep_count >= 4 {
        let obs: Vec<RegressionObservation> = train
            .iter()
            .filter_map(|s| {
                let sh = s.preceding_main_sleep_hours?;
                let aw = s.elapsed_since_awakening_hours?;
                let (st, ct) = tod_feats(s);
                Some(RegressionObservation {
                    day_key: s.local_date.clone(),
                    weight: s.fsrs_residual_reviews as f64,
                    y: s.mean_fsrs_residual.unwrap(),
                    x: vec![1.0, sh, aw, st, ct],
                })
            })
            .collect();
        let mean_sh = obs.iter().map(|o| o.x[1]).sum::<f64>() / obs.len() as f64;
        let mean_aw = obs.iter().map(|o| o.x[2]).sum::<f64>() / obs.len() as f64;
        fit_weighted_ols(&obs).and_then(|fit| {
            let preds: Vec<f64> = test
                .iter()
                .map(|s| {
                    let sh = s.preceding_main_sleep_hours.unwrap_or(mean_sh);
                    let aw = s.elapsed_since_awakening_hours.unwrap_or(mean_aw);
                    let (st, ct) = tod_feats(s);
                    predict_ols(&fit.coefficients, &[1.0, sh, aw, st, ct])
                })
                .collect();
            evaluate_model("M4", &preds)
        })
    } else {
        None
    };

    // M5: M4 + overnight RMSSD z-score (only when HRV RMSSD coverage >= 70%)
    let rmssd_train_cov = train
        .iter()
        .filter(|s| s.overnight_rmssd_z.is_some())
        .count() as f64
        / train.len().max(1) as f64;
    let rmssd_test_cov = test
        .iter()
        .filter(|s| s.overnight_rmssd_z.is_some())
        .count() as f64
        / test.len().max(1) as f64;
    let rmse_m5 = if rmssd_train_cov >= 0.70 && rmssd_test_cov >= 0.70 {
        let obs: Vec<RegressionObservation> = train
            .iter()
            .filter_map(|s| {
                let sh = s.preceding_main_sleep_hours?;
                let aw = s.elapsed_since_awakening_hours?;
                let hz = s.overnight_rmssd_z?;
                let (st, ct) = tod_feats(s);
                Some(RegressionObservation {
                    day_key: s.local_date.clone(),
                    weight: s.fsrs_residual_reviews as f64,
                    y: s.mean_fsrs_residual.unwrap(),
                    x: vec![1.0, sh, aw, hz, st, ct],
                })
            })
            .collect();
        fit_weighted_ols(&obs).and_then(|fit| {
            let preds: Vec<f64> = test
                .iter()
                .map(|s| {
                    let sh = s.preceding_main_sleep_hours.unwrap_or(7.0);
                    let aw = s.elapsed_since_awakening_hours.unwrap_or(6.0);
                    let hz = s.overnight_rmssd_z.unwrap_or(0.0);
                    let (st, ct) = tod_feats(s);
                    predict_ols(&fit.coefficients, &[1.0, sh, aw, hz, st, ct])
                })
                .collect();
            evaluate_model("M5", &preds)
        })
    } else {
        None
    };

    let models = vec![
        ModelComparisonRow {
            model_id: "M0".into(),
            label: "Constant individual baseline".into(),
            evaluated: true,
            held_out_rmse: Some(rmse_m0),
            skip_reason: None,
        },
        ModelComparisonRow {
            model_id: "M1".into(),
            label: "Time-of-day circadian harmonics".into(),
            evaluated: rmse_m1.is_some(),
            held_out_rmse: rmse_m1,
            skip_reason: rmse_m1
                .is_none()
                .then(|| "Singular time-of-day distribution".into()),
        },
        ModelComparisonRow {
            model_id: "M2".into(),
            label: "Recent 7-day rolling baseline".into(),
            evaluated: rmse_m2.is_some(),
            held_out_rmse: rmse_m2,
            skip_reason: None,
        },
        ModelComparisonRow {
            model_id: "M3".into(),
            label: "Time-of-day + prior main sleep duration".into(),
            evaluated: rmse_m3.is_some(),
            held_out_rmse: rmse_m3,
            skip_reason: rmse_m3
                .is_none()
                .then(|| "Insufficient sleep-paired sessions in split".into()),
        },
        ModelComparisonRow {
            model_id: "M4".into(),
            label: "Time-of-day + sleep duration + time awake".into(),
            evaluated: rmse_m4.is_some(),
            held_out_rmse: rmse_m4,
            skip_reason: rmse_m4
                .is_none()
                .then(|| "Insufficient sleep/awakening pairs in split".into()),
        },
        ModelComparisonRow {
            model_id: "M5".into(),
            label: "M4 + overnight RMSSD z-score".into(),
            evaluated: rmse_m5.is_some(),
            held_out_rmse: rmse_m5,
            skip_reason: rmse_m5
                .is_none()
                .then(|| "Requires >= 70% overnight HRV (RMSSD) coverage".into()),
        },
    ];

    let candidates: Vec<(&str, f64)> = [
        ("M1", rmse_m1),
        ("M3", rmse_m3),
        ("M4", rmse_m4),
        ("M5", rmse_m5),
    ]
    .into_iter()
    .filter_map(|(id, r)| r.map(|v| (id, v)))
    .collect();

    let passes = |id: &str, score: f64| {
        let beats_time_of_day = id == "M1" || rmse_m1.is_some_and(|baseline| score < baseline);
        score <= rmse_m0 - 0.002 && beats_time_of_day && supported_models.contains(id)
    };
    let best = candidates.iter().copied().min_by(|a, b| {
        passes(b.0, b.1)
            .cmp(&passes(a.0, a.1))
            .then_with(|| a.1.total_cmp(&b.1))
    });
    let validated = best.is_some_and(|(id, score)| passes(id, score));
    let best_id = best.map(|(id, _)| id.to_owned());
    let best_rmse = best.map(|(_, score)| score);

    let top_window = windows
        .iter()
        .filter(|w| w.sufficient && w.mean_fsrs_residual.is_some())
        .max_by(|a, b| {
            a.mean_fsrs_residual
                .unwrap()
                .partial_cmp(&b.mean_fsrs_residual.unwrap())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|w| w.label.clone());

    if validated {
        if let Some(ref lbl) = top_window {
            for w in &mut windows {
                if &w.label == lbl {
                    w.is_favorable_window = true;
                }
            }
        }
    }

    let validation_status = if validated {
        "validated_predictive".to_string()
    } else {
        "descriptive_only".to_string()
    };

    let explanation = if validated {
        format!(
            "Model {} achieved lower held-out FSRS-residual RMSE ({:.4}) than the constant individual baseline M0 ({:.4}) on the newest {} sessions. Historical patterns are observational and do not guarantee future performance.",
            best_id.as_deref().unwrap_or("M1"),
            best_rmse.unwrap_or(rmse_m0),
            rmse_m0,
            test.len()
        )
    } else {
        format!(
            "No candidate met the held-out baseline and reliability requirements on {} recent sessions. Baseline M0 RMSE was {:.4}. Window differences describe past observations.",
            test.len(),
            rmse_m0
        )
    };

    LearningWindowsAnalysis {
        validation_status,
        train_sessions: train.len(),
        test_sessions: test.len(),
        best_model_id: best_id,
        rmse_baseline_m0: Some(rmse_m0),
        rmse_best_model: best_rmse,
        recommended_window_label: top_window.filter(|_| validated),
        explanation,
        windows,
        models,
    }
}

fn build_assessment_breakdowns(
    assessments: &[FinalizedAssessmentRecord],
    guardrails: &StatisticalGuardrails,
) -> Vec<AssessmentModeBreakdown> {
    let mut out = Vec::new();
    for mode in ["exam", "practice", "diagnostic"] {
        let items: Vec<&FinalizedAssessmentRecord> =
            assessments.iter().filter(|a| a.mode == mode).collect();
        if items.is_empty() {
            continue;
        }
        let paired: Vec<&FinalizedAssessmentRecord> = items
            .iter()
            .copied()
            .filter(|a| a.preceding_main_sleep_hours.is_some())
            .collect();
        let mean_score =
            Some(items.iter().map(|a| a.score_ratio * 100.0).sum::<f64>() / items.len() as f64);
        let short_scores: Vec<f64> = paired
            .iter()
            .filter(|a| a.preceding_main_sleep_hours.unwrap() < 7.0)
            .map(|a| a.score_ratio * 100.0)
            .collect();
        let adequate_scores: Vec<f64> = paired
            .iter()
            .filter(|a| a.preceding_main_sleep_hours.unwrap() >= 7.0)
            .map(|a| a.score_ratio * 100.0)
            .collect();

        let short_mean = (!short_scores.is_empty())
            .then(|| short_scores.iter().sum::<f64>() / short_scores.len() as f64);
        let adequate_mean = (!adequate_scores.is_empty())
            .then(|| adequate_scores.iter().sum::<f64>() / adequate_scores.len() as f64);

        let xs_sleep: Vec<f64> = paired
            .iter()
            .filter_map(|a| a.preceding_main_sleep_hours)
            .collect();
        let ys_score: Vec<f64> = paired.iter().map(|a| a.score_ratio * 100.0).collect();
        let r_sleep = pearson_correlation(&xs_sleep, &ys_score);
        let p_val = r_sleep.and_then(|r| {
            let n = xs_sleep.len();
            if n < 4 || r.abs() >= 0.9999 {
                None
            } else {
                let df = (n - 2) as f64;
                let t = r.abs() * (df / (1.0 - r * r)).sqrt();
                Some(two_sided_student_t_p(t, df))
            }
        });

        let reg_pairs: Vec<(f64, f64)> = items
            .iter()
            .filter_map(|a| {
                a.sleep_regularity_bedtime_sd_mins
                    .map(|sd| (sd, a.score_ratio * 100.0))
            })
            .collect();
        let r_reg = if reg_pairs.len() >= 4 {
            let rx: Vec<f64> = reg_pairs.iter().map(|(x, _)| *x).collect();
            let ry: Vec<f64> = reg_pairs.iter().map(|(_, y)| *y).collect();
            pearson_correlation(&rx, &ry)
        } else {
            None
        };

        let distinct_days = items
            .iter()
            .map(|a| super::time::local_date_string(a.started_at_ms, None))
            .collect::<HashSet<_>>()
            .len();

        let sufficient = paired.len() >= guardrails.min_assessment_attempts;
        let note = if sufficient {
            format!(
                "Mode '{mode}' kept strictly separate from other assessment modes (n = {} finalized attempts).",
                paired.len()
            )
        } else {
            format!(
                "Insufficient sleep-paired finalized '{mode}' attempts ({} / {} required).",
                paired.len(),
                guardrails.min_assessment_attempts
            )
        };

        out.push(AssessmentModeBreakdown {
            mode: mode.to_string(),
            attempts: items.len(),
            distinct_days,
            sleep_paired_attempts: paired.len(),
            mean_score_pct: mean_score,
            short_sleep_mean_pct: short_mean,
            adequate_sleep_mean_pct: adequate_mean,
            pearson_r_sleep_duration: r_sleep,
            pearson_r_regularity: r_reg,
            p_value: p_val,
            sufficient,
            note,
        });
    }
    out
}

/// Core computation orchestrating FSRS-7 replay, session clustering, statistical
/// guardrails, confounder-controlled regressions, BH-FDR, Learning Windows, and
/// explainable Personal Insights.
pub fn compute_learning_insights(
    telemetry: &LearningTelemetrySnapshot,
    episodes: &[CanonicalSleepEpisode],
    physio: &[PhysiologicalObservation],
    recovery: &[RecoveryObservation],
    start_ms: Option<i64>,
    end_ms: Option<i64>,
    plan_filter: Option<&str>,
    tz_offset_secs: Option<i32>,
    is_synthetic_demo: bool,
) -> Result<LearningInsightsReport, String> {
    let guardrails = StatisticalGuardrails::default();
    let replayed = replay_reviews_fsrs7(&telemetry.reviews)?;
    let sessions = build_comparable_sessions(
        &replayed,
        episodes,
        physio,
        recovery,
        start_ms,
        end_ms,
        plan_filter,
        tz_offset_secs,
    );

    let assessments_filtered: Vec<FinalizedAssessmentRecord> = telemetry
        .assessments
        .iter()
        .filter(|a| {
            plan_filter
                .map(|pf| a.plan_id.as_deref() == Some(pf))
                .unwrap_or(true)
        })
        .cloned()
        .collect();
    let aligned_assessments =
        align_assessments_with_sleep(assessments_filtered, episodes, tz_offset_secs);
    let assessment_breakdowns = build_assessment_breakdowns(&aligned_assessments, &guardrails);

    let session_refs: Vec<&ComparableStudySession> = sessions.iter().collect();
    let fsrs_sessions: Vec<&ComparableStudySession> = sessions
        .iter()
        .filter(|s| s.mean_fsrs_residual.is_some() && s.fsrs_residual_reviews > 0)
        .collect();
    let paired_fsrs_sessions: Vec<&ComparableStudySession> = fsrs_sessions
        .iter()
        .copied()
        .filter(|s| s.preceding_main_sleep_hours.is_some())
        .collect();

    let total_reviews: usize = sessions.iter().map(|s| s.total_reviews).sum();
    let fsrs_replay_reviews: usize = fsrs_sessions.iter().map(|s| s.fsrs_residual_reviews).sum();
    let paired_fsrs_reviews: usize = paired_fsrs_sessions
        .iter()
        .map(|s| s.fsrs_residual_reviews)
        .sum();
    let distinct_days = fsrs_sessions
        .iter()
        .map(|s| s.local_date.as_str())
        .collect::<HashSet<_>>()
        .len();
    let coverage_ratio = if fsrs_sessions.is_empty() {
        0.0
    } else {
        paired_fsrs_sessions.len() as f64 / fsrs_sessions.len() as f64
    };

    let sleep_hours: Vec<f64> = paired_fsrs_sessions
        .iter()
        .filter_map(|s| s.preceding_main_sleep_hours)
        .collect();
    let sleep_sd_hours = if sleep_hours.len() >= 2 {
        let m = sleep_hours.iter().sum::<f64>() / sleep_hours.len() as f64;
        let var = sleep_hours.iter().map(|v| (v - m).powi(2)).sum::<f64>()
            / (sleep_hours.len() - 1) as f64;
        Some(var.sqrt())
    } else {
        None
    };

    let mut blocking_reasons = Vec::new();
    if paired_fsrs_reviews < guardrails.min_paired_reviews {
        blocking_reasons.push(format!(
            "Need at least {} FSRS-replayed paired reviews (currently {}).",
            guardrails.min_paired_reviews, paired_fsrs_reviews
        ));
    }
    if paired_fsrs_sessions.len() < guardrails.min_sessions {
        blocking_reasons.push(format!(
            "Need at least {} sleep-paired study sessions (currently {}).",
            guardrails.min_sessions,
            paired_fsrs_sessions.len()
        ));
    }
    if distinct_days < guardrails.min_distinct_days {
        blocking_reasons.push(format!(
            "Need observations spanning at least {} distinct days (currently {}).",
            guardrails.min_distinct_days, distinct_days
        ));
    }
    if coverage_ratio < guardrails.min_coverage_ratio && !fsrs_sessions.is_empty() {
        blocking_reasons.push(format!(
            "Sleep coverage across study sessions is {:.0}% (minimum {:.0}% required).",
            coverage_ratio * 100.0,
            guardrails.min_coverage_ratio * 100.0
        ));
    }
    if let Some(sd) = sleep_sd_hours {
        if sd < guardrails.min_sleep_sd_hours {
            blocking_reasons.push(format!(
                "Sleep duration variability is {:.2}h SD (minimum {:.2}h required for slope estimation).",
                sd, guardrails.min_sleep_sd_hours
            ));
        }
    }

    let meets_core_guardrails = blocking_reasons.is_empty();
    let sufficiency = DataSufficiencySummary {
        total_reviews,
        fsrs_replay_reviews,
        paired_fsrs_reviews,
        total_sessions: sessions.len(),
        paired_sessions: paired_fsrs_sessions.len(),
        distinct_days,
        sleep_coverage_ratio: coverage_ratio,
        sleep_duration_sd_hours: sleep_sd_hours,
        finalized_assessments: aligned_assessments.len(),
        meets_core_guardrails,
        blocking_reasons: blocking_reasons.clone(),
    };

    // Bucketed visualizations
    let sleep_duration_buckets = bucket_points(
        &[
            (
                "< 6h",
                |s: &ComparableStudySession| matches!(s.preceding_main_sleep_hours, Some(h) if h < 6.0),
            ),
            (
                "6–7h",
                |s: &ComparableStudySession| matches!(s.preceding_main_sleep_hours, Some(h) if (6.0..7.0).contains(&h)),
            ),
            (
                "7–8h",
                |s: &ComparableStudySession| matches!(s.preceding_main_sleep_hours, Some(h) if (7.0..8.0).contains(&h)),
            ),
            (
                "8h+",
                |s: &ComparableStudySession| matches!(s.preceding_main_sleep_hours, Some(h) if h >= 8.0),
            ),
        ],
        &fsrs_sessions,
        &guardrails,
    );

    let awake_duration_buckets = bucket_points(
        &[
            (
                "< 2h awake",
                |s: &ComparableStudySession| matches!(s.elapsed_since_awakening_hours, Some(h) if h < 2.0),
            ),
            (
                "2–6h awake",
                |s: &ComparableStudySession| matches!(s.elapsed_since_awakening_hours, Some(h) if (2.0..6.0).contains(&h)),
            ),
            (
                "6–10h awake",
                |s: &ComparableStudySession| matches!(s.elapsed_since_awakening_hours, Some(h) if (6.0..10.0).contains(&h)),
            ),
            (
                "10–14h awake",
                |s: &ComparableStudySession| matches!(s.elapsed_since_awakening_hours, Some(h) if (10.0..14.0).contains(&h)),
            ),
            (
                "14h+ awake",
                |s: &ComparableStudySession| matches!(s.elapsed_since_awakening_hours, Some(h) if h >= 14.0),
            ),
        ],
        &fsrs_sessions,
        &guardrails,
    );

    let time_of_day_buckets = bucket_points(
        &[
            ("Early Morning (05–09)", |s: &ComparableStudySession| {
                (5.0..9.0).contains(&s.local_start_hour)
            }),
            ("Late Morning (09–12)", |s: &ComparableStudySession| {
                (9.0..12.0).contains(&s.local_start_hour)
            }),
            ("Early Afternoon (12–16)", |s: &ComparableStudySession| {
                (12.0..16.0).contains(&s.local_start_hour)
            }),
            ("Late Afternoon (16–20)", |s: &ComparableStudySession| {
                (16.0..20.0).contains(&s.local_start_hour)
            }),
            ("Evening / Night (20–05)", |s: &ComparableStudySession| {
                !(5.0..20.0).contains(&s.local_start_hour)
            }),
        ],
        &session_refs,
        &guardrails,
    );

    let hrv_rmssd_buckets = bucket_points(
        &[
            (
                "Low RMSSD (z < -0.5)",
                |s: &ComparableStudySession| matches!(s.overnight_rmssd_z, Some(z) if z < -0.5),
            ),
            (
                "Typical RMSSD",
                |s: &ComparableStudySession| matches!(s.overnight_rmssd_z, Some(z) if (-0.5..=0.5).contains(&z)),
            ),
            (
                "Elevated RMSSD (z > +0.5)",
                |s: &ComparableStudySession| matches!(s.overnight_rmssd_z, Some(z) if z > 0.5),
            ),
        ],
        &fsrs_sessions,
        &guardrails,
    );

    let hrv_sdnn_buckets = bucket_points(
        &[
            (
                "Low SDNN (z < -0.5)",
                |s: &ComparableStudySession| matches!(s.overnight_sdnn_z, Some(z) if z < -0.5),
            ),
            (
                "Typical SDNN",
                |s: &ComparableStudySession| matches!(s.overnight_sdnn_z, Some(z) if (-0.5..=0.5).contains(&z)),
            ),
            (
                "Elevated SDNN (z > +0.5)",
                |s: &ComparableStudySession| matches!(s.overnight_sdnn_z, Some(z) if z > 0.5),
            ),
        ],
        &fsrs_sessions,
        &guardrails,
    );

    let resting_hr_buckets = bucket_points(
        &[
            (
                "< 55 bpm",
                |s: &ComparableStudySession| matches!(s.resting_hr_bpm, Some(h) if h < 55.0),
            ),
            (
                "55–65 bpm",
                |s: &ComparableStudySession| matches!(s.resting_hr_bpm, Some(h) if (55.0..65.0).contains(&h)),
            ),
            (
                "65+ bpm",
                |s: &ComparableStudySession| matches!(s.resting_hr_bpm, Some(h) if h >= 65.0),
            ),
        ],
        &fsrs_sessions,
        &guardrails,
    );

    let nap_comparison = compare_matched_nap_sessions(&sessions, 42);
    let learning_windows = evaluate_learning_windows(&sessions, &guardrails);

    // Hypothesis testing with confounder-adjusted OLS + day-clustered bootstrap + BH-FDR
    let insights = evaluate_insights(
        &fsrs_sessions,
        &nap_comparison,
        &assessment_breakdowns,
        &guardrails,
        coverage_ratio,
        &blocking_reasons,
    );

    Ok(LearningInsightsReport {
        scope_plan_id: plan_filter.map(str::to_string),
        is_synthetic_demo,
        guardrails,
        sufficiency,
        study_plans: telemetry.study_plans.clone(),
        sleep_duration_buckets,
        awake_duration_buckets,
        time_of_day_buckets,
        hrv_rmssd_buckets,
        hrv_sdnn_buckets,
        resting_hr_buckets,
        nap_comparison,
        assessment_breakdowns,
        learning_windows,
        insights,
    })
}

struct CandidateTest {
    id: &'static str,
    metric_key: &'static str,
    title: &'static str,
    effect_label: &'static str,
    positive_phrase: &'static str,
    negative_phrase: &'static str,
    neutral_phrase: &'static str,
    extra_limitation: &'static str,
    raw_p: Option<f64>,
    effect_size: Option<f64>,
    partial_r: Option<f64>,
    ci_low: Option<f64>,
    ci_high: Option<f64>,
    sample_reviews: usize,
    sample_sessions: usize,
    distinct_days: usize,
    coverage: f64,
    eligible: bool,
    ineligible_reason: Option<String>,
}

fn build_regression_candidate<F>(
    id: &'static str,
    metric_key: &'static str,
    title: &'static str,
    effect_label: &'static str,
    positive_phrase: &'static str,
    negative_phrase: &'static str,
    neutral_phrase: &'static str,
    extra_limitation: &'static str,
    sessions: &[&ComparableStudySession],
    guardrails: &StatisticalGuardrails,
    min_predictor_sd: f64,
    seed: u64,
    extractor: F,
) -> CandidateTest
where
    F: Fn(&ComparableStudySession) -> Option<f64>,
{
    let obs: Vec<RegressionObservation> = sessions
        .iter()
        .filter_map(|s| {
            let y = s.mean_fsrs_residual?;
            let x1 = extractor(s)?;
            if !x1.is_finite() {
                return None;
            }
            let theta = s.local_start_hour * std::f64::consts::TAU / 24.0;
            Some(RegressionObservation {
                day_key: s.local_date.clone(),
                weight: s.fsrs_residual_reviews.max(1) as f64,
                y,
                x: vec![
                    1.0,
                    x1,
                    theta.sin(),
                    theta.cos(),
                    s.mean_item_difficulty,
                    (s.prior_workload_24h as f64) / 100.0,
                ],
            })
        })
        .collect();

    let sample_sessions = obs.len();
    let sample_reviews: usize = sessions
        .iter()
        .filter(|s| s.mean_fsrs_residual.is_some() && extractor(s).is_some())
        .map(|s| s.fsrs_residual_reviews)
        .sum();
    let distinct_days = obs
        .iter()
        .map(|o| o.day_key.as_str())
        .collect::<HashSet<_>>()
        .len();
    let coverage = if sessions.is_empty() {
        0.0
    } else {
        sample_sessions as f64 / sessions.len() as f64
    };

    let xs: Vec<f64> = obs.iter().map(|o| o.x[1]).collect();
    let sd_x = if xs.len() >= 2 {
        let m = xs.iter().sum::<f64>() / xs.len() as f64;
        (xs.iter().map(|v| (v - m).powi(2)).sum::<f64>() / (xs.len() - 1) as f64).sqrt()
    } else {
        0.0
    };

    let mut ineligible_reason = None;
    if sample_reviews < guardrails.min_paired_reviews
        || sample_sessions < guardrails.min_sessions
        || distinct_days < guardrails.min_distinct_days
    {
        ineligible_reason = Some(format!(
            "Observed {} reviews across {} sessions ({} days); minimum required: {} reviews, {} sessions, {} distinct days.",
            sample_reviews,
            sample_sessions,
            distinct_days,
            guardrails.min_paired_reviews,
            guardrails.min_sessions,
            guardrails.min_distinct_days
        ));
    } else if coverage < guardrails.min_coverage_ratio {
        ineligible_reason = Some(format!(
            "Sensor coverage is {:.0}%, below the {:.0}% minimum threshold.",
            coverage * 100.0,
            guardrails.min_coverage_ratio * 100.0
        ));
    } else if sd_x < min_predictor_sd {
        ineligible_reason = Some(format!(
            "Predictor variation ({:.2} SD) is too narrow (< {:.2}) to avoid unstable slope estimation.",
            sd_x, min_predictor_sd
        ));
    }

    if ineligible_reason.is_some() {
        return CandidateTest {
            id,
            metric_key,
            title,
            effect_label,
            positive_phrase,
            negative_phrase,
            neutral_phrase,
            extra_limitation,
            raw_p: None,
            effect_size: None,
            partial_r: None,
            ci_low: None,
            ci_high: None,
            sample_reviews,
            sample_sessions,
            distinct_days,
            coverage,
            eligible: false,
            ineligible_reason,
        };
    }

    let fit = fit_weighted_ols(&obs);
    let boot = bootstrap_day_clustered_slope(&obs, 500, seed);
    let (effect_size, partial_r, raw_p, ci_low, ci_high) = match (fit, boot) {
        (Some(f), Some(((blo, bhi), _))) => {
            // Use the wider of OLS SE p-value and bootstrap sign consistency by keeping OLS p when CI & OLS agree
            let mut p = f.p_values[1];
            let ci_crosses_zero = blo <= 0.0 && bhi >= 0.0;
            if ci_crosses_zero && p < 0.05 {
                // Cluster bootstrap indicates autocorrelation widens interval over 0 -> conserve p >= 0.06
                p = p.max(0.08);
            }
            (
                Some(f.coefficients[1]),
                Some(f.partial_r_col1),
                Some(p),
                Some(blo),
                Some(bhi),
            )
        }
        (Some(f), None) => (
            Some(f.coefficients[1]),
            Some(f.partial_r_col1),
            Some(f.p_values[1]),
            Some(f.coefficients[1] - 1.96 * f.std_errors[1]),
            Some(f.coefficients[1] + 1.96 * f.std_errors[1]),
        ),
        _ => (None, None, None, None, None),
    };

    CandidateTest {
        id,
        metric_key,
        title,
        effect_label,
        positive_phrase,
        negative_phrase,
        neutral_phrase,
        extra_limitation,
        raw_p,
        effect_size,
        partial_r,
        ci_low,
        ci_high,
        sample_reviews,
        sample_sessions,
        distinct_days,
        coverage,
        eligible: raw_p.is_some(),
        ineligible_reason: raw_p
            .is_none()
            .then(|| "Model design matrix was near-singular.".into()),
    }
}

fn evaluate_insights(
    fsrs_sessions: &[&ComparableStudySession],
    nap_cmp: &NapComparisonResult,
    assessments: &[AssessmentModeBreakdown],
    guardrails: &StatisticalGuardrails,
    _global_coverage: f64,
    _blocking_reasons: &[String],
) -> Vec<PersonalInsight> {
    let mut candidates = vec![
        build_regression_candidate(
            "ins-sleep-duration",
            "sleep_duration",
            "Prior Main Sleep Duration & Recall Residual",
            "Δ FSRS residual per +1h sleep",
            "Longer preceding main sleep was associated with higher difficulty-adjusted FSRS recall residuals",
            "Longer preceding main sleep was associated with lower difficulty-adjusted FSRS recall residuals",
            "No consistent association was observed between prior main sleep duration and difficulty-adjusted FSRS recall across your sessions",
            "Wearable sleep duration estimates reflect motion/heart-rate staging rather than polysomnography.",
            fsrs_sessions,
            guardrails,
            guardrails.min_sleep_sd_hours,
            101,
            |s| s.preceding_main_sleep_hours,
        ),
        build_regression_candidate(
            "ins-time-awake",
            "time_awake",
            "Elapsed Time Since Awakening & Recall",
            "Δ FSRS residual per +1h awake",
            "Longer time elapsed since awakening was associated with higher FSRS recall residuals",
            "Recall residuals tended to drift slightly downward as hours since awakening increased",
            "Time elapsed since awakening showed no clear consistent association with recall residuals after controlling for time-of-day and item difficulty",
            "Elapsed waking hours correlate partially with local time-of-day unless wake times vary.",
            fsrs_sessions,
            guardrails,
            1.0,
            202,
            |s| s.elapsed_since_awakening_hours,
        ),
        build_regression_candidate(
            "ins-sleep-regularity",
            "sleep_regularity",
            "7-Day Sleep Schedule Regularity & Recall",
            "Δ FSRS residual per +1m bedtime SD",
            "Higher bedtime variability coincided with slightly higher FSRS recall residuals",
            "More irregular prior 7-day bedtimes (higher bedtime SD) were associated with lower FSRS recall residuals",
            "No clear relationship emerged between trailing 7-day bedtime irregularity and FSRS recall residuals",
            "Circadian regularity is approximated from wearable sleep onset timestamps rather than melatonin assays.",
            fsrs_sessions,
            guardrails,
            10.0,
            303,
            |s| s.trailing_7d_bedtime_sd_mins,
        ),
        build_regression_candidate(
            "ins-hrv-rmssd",
            "hrv_rmssd",
            "Overnight HRV (RMSSD) & Recall Residual",
            "Δ FSRS residual per +1 SD RMSSD",
            "Higher within-person overnight HRV (RMSSD) coincided with slightly higher FSRS recall residuals",
            "Higher within-person overnight HRV (RMSSD) coincided with slightly lower FSRS recall residuals",
            "Within-person overnight HRV (RMSSD) variations did not show a clear association with FSRS recall residuals",
            "RMSSD values are kept strictly separate from Apple Watch SDNN observations and normalized relative to your personal baseline.",
            fsrs_sessions,
            guardrails,
            0.25,
            404,
            |s| s.overnight_rmssd_z,
        ),
    ];

    // Add matched nap candidate
    let nap_eligible = nap_cmp.sufficient_matches && nap_cmp.p_value.is_some();
    candidates.push(CandidateTest {
        id: "ins-nap",
        metric_key: "nap_matched_delta",
        title: "Daytime Nap Comparison (Matched Within-Person)",
        effect_label: "Δ FSRS residual (Nap - Matched Non-Nap)",
        positive_phrase: "Study sessions following a nap showed higher FSRS recall residuals than time-of-day and sleep-matched non-nap sessions",
        negative_phrase: "Study sessions shortly after a nap showed lower FSRS recall residuals than matched non-nap sessions (possibly reflecting sleep inertia or fatigue)",
        neutral_phrase: "Sessions following naps performed similarly to time-of-day and sleep-matched non-nap sessions",
        extra_limitation: "Naps cannot be randomly assigned by historical logs; residual self-selection (taking naps on busier or more tired days) remains possible.",
        raw_p: nap_eligible.then(|| nap_cmp.p_value).flatten(),
        effect_size: nap_cmp.residual_delta,
        partial_r: nap_cmp.hedges_g,
        ci_low: nap_cmp.ci_low,
        ci_high: nap_cmp.ci_high,
        sample_reviews: 0,
        sample_sessions: nap_cmp.matched_pairs,
        distinct_days: nap_cmp.matched_pairs,
        coverage: if nap_cmp.nap_sessions == 0 { 0.0 } else { 1.0 },
        eligible: nap_eligible,
        ineligible_reason: (!nap_eligible).then(|| format!(
            "Need at least 5 matched nap/non-nap session pairs (currently {} matched pairs from {} nap sessions).",
            nap_cmp.matched_pairs, nap_cmp.nap_sessions
        )),
    });

    // Add exam-mode assessment candidate if present
    if let Some(exam) = assessments.iter().find(|a| a.mode == "exam") {
        let ok = exam.sufficient && exam.p_value.is_some();
        candidates.push(CandidateTest {
            id: "ins-exam-sleep",
            metric_key: "assessment_sleep_exam",
            title: "Finalized Exam Scores & Prior Sleep",
            effect_label: "Pearson r (Sleep hours vs Exam %)",
            positive_phrase: "Finalized exam scores tended to be higher following longer preceding main sleep",
            negative_phrase: "Finalized exam scores tended to be slightly lower following longer preceding main sleep",
            neutral_phrase: "No consistent linear correlation was observed between prior main sleep duration and finalized exam scores",
            extra_limitation: "Exam topics, difficulty, and preparation time across blueprints cannot be fully controlled in small attempt counts.",
            raw_p: ok.then(|| exam.p_value).flatten(),
            effect_size: exam.pearson_r_sleep_duration,
            partial_r: exam.pearson_r_sleep_duration,
            ci_low: None,
            ci_high: None,
            sample_reviews: exam.sleep_paired_attempts,
            sample_sessions: exam.sleep_paired_attempts,
            distinct_days: exam.distinct_days,
            coverage: if exam.attempts == 0 { 0.0 } else { exam.sleep_paired_attempts as f64 / exam.attempts as f64 },
            eligible: ok,
            ineligible_reason: (!ok).then(|| exam.note.clone()),
        });
    }

    let raw_ps: Vec<Option<f64>> = candidates
        .iter()
        .map(|c| if c.eligible { c.raw_p } else { None })
        .collect();
    let q_vals = apply_bh_fdr(&raw_ps);

    candidates
        .into_iter()
        .zip(q_vals.into_iter())
        .map(|(c, q)| {
            let (status, direction, summary) = if !c.eligible {
                (
                    "insufficient_data".to_string(),
                    "unknown".to_string(),
                    c.ineligible_reason
                        .clone()
                        .unwrap_or_else(|| "Insufficient observations for statistical analysis.".to_string()),
                )
            } else {
                let qv = q.unwrap_or(1.0);
                let eff = c.effect_size.unwrap_or(0.0);
                let ci_excludes_zero = match (c.ci_low, c.ci_high) {
                    (Some(lo), Some(hi)) => lo > 0.0 || hi < 0.0,
                    _ => true,
                };
                if qv <= guardrails.fdr_alpha && ci_excludes_zero {
                    if eff > 0.0 {
                        (
                            "supported".to_string(),
                            "positive".to_string(),
                            format!(
                                "{} (slope = {:+.4}, partial r = {:+.2}, FDR q = {:.3}). This is an observed correlation, not proof of causation.",
                                c.positive_phrase,
                                eff,
                                c.partial_r.unwrap_or(0.0),
                                qv
                            ),
                        )
                    } else {
                        (
                            "supported".to_string(),
                            "negative".to_string(),
                            format!(
                                "{} (slope = {:+.4}, partial r = {:+.2}, FDR q = {:.3}). This is an observed correlation, not proof of causation.",
                                c.negative_phrase,
                                eff,
                                c.partial_r.unwrap_or(0.0),
                                qv
                            ),
                        )
                    }
                } else if c.raw_p.unwrap_or(1.0) < 0.15 {
                    let dir = if eff > 0.0 { "positive" } else { "negative" };
                    (
                        "exploratory".to_string(),
                        dir.to_string(),
                        format!(
                            "Tentative observational trend (slope = {:+.4}, FDR q = {:.3}, 95% day-clustered CI includes modest or null effect). Additional days are needed before drawing firm conclusions.",
                            eff, qv
                        ),
                    )
                } else {
                    (
                        "no_clear_pattern".to_string(),
                        "neutral".to_string(),
                        format!(
                            "{} (slope = {:+.4}, FDR q = {:.3}).",
                            c.neutral_phrase, eff, qv
                        ),
                    )
                }
            };

            PersonalInsight {
                id: c.id.to_string(),
                metric_key: c.metric_key.to_string(),
                status,
                direction,
                title: c.title.to_string(),
                summary,
                evidence: InsightEvidenceDetails {
                    sample_reviews: c.sample_reviews,
                    sample_sessions: c.sample_sessions,
                    distinct_days: c.distinct_days,
                    coverage_ratio: c.coverage,
                    effect_size_label: c.effect_label.to_string(),
                    effect_size: c.effect_size,
                    partial_r: c.partial_r,
                    ci_low: c.ci_low,
                    ci_high: c.ci_high,
                    p_value: c.raw_p,
                    q_value: q,
                    confounders_controlled: vec![
                        "Time-of-day circadian harmonics (sin/cos)".to_string(),
                        "FSRS-7 item difficulty & memory state".to_string(),
                        "Prior 24-hour review workload".to_string(),
                        "Within-day clustering (500-resample day-block bootstrap)".to_string(),
                    ],
                    limitations: vec![
                        "Observational within-person analysis; unmeasured lifestyle/stress confounders remain possible.".to_string(),
                        c.extra_limitation.to_string(),
                    ],
                },
            }
        })
        .collect()
}

/// Filter insights and study sessions to a specific Study Plan ID while preserving
/// full sleep history for physiological context alignment.
pub fn compute_study_plan_insights(
    plan_id: &str,
    telemetry: &LearningTelemetrySnapshot,
    episodes: &[CanonicalSleepEpisode],
    physio: &[PhysiologicalObservation],
    recovery: &[RecoveryObservation],
    start_ms: Option<i64>,
    end_ms: Option<i64>,
    tz_offset_secs: Option<i32>,
    is_synthetic_demo: bool,
) -> Result<LearningInsightsReport, String> {
    compute_learning_insights(
        telemetry,
        episodes,
        physio,
        recovery,
        start_ms,
        end_ms,
        Some(plan_id),
        tz_offset_secs,
        is_synthetic_demo,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::health::models::{HealthProviderId, SleepKind};
    use crate::health::reconciliation::reconcile_sleep_sessions;
    use crate::health::telemetry::RawReviewEvent;
    use crate::health::time::{compute_anchor_local_date, parse_timestamp_with_offset};
    use rand::rngs::StdRng;
    use rand::{Rng, SeedableRng};
    use std::collections::HashMap;

    fn mk_sleep(
        id: &str,
        provider: HealthProviderId,
        start_ms: i64,
        duration_hours: f64,
    ) -> crate::health::models::RawSleepSession {
        let end_ms = start_ms + (duration_hours * 3_600_000.0) as i64;
        crate::health::models::RawSleepSession {
            id: id.to_string(),
            provider_id: provider,
            device_id: None,
            external_record_id: id.to_string(),
            source_app_bundle: Some("com.ouraring.oura".into()),
            start_at_ms: start_ms,
            end_at_ms: end_ms,
            start_tz_offset_secs: Some(0),
            end_tz_offset_secs: Some(0),
            duration_mins: duration_hours * 60.0,
            time_in_bed_mins: Some(duration_hours * 60.0 + 15.0),
            sleep_efficiency_pct: Some(95.0),
            awake_mins: Some(15.0),
            light_mins: None,
            deep_mins: None,
            rem_mins: None,
            sleep_kind: SleepKind::MainSleep,
            provider_sleep_kind: None,
            quality_flags: vec![],
            quality_score: 0.9,
            notes: None,
            subjective_quality: None,
            acquisition_at_ms: end_ms,
            sync_batch_id: None,
            is_deleted: false,
            is_synthetic: true,
            stages: vec![],
        }
    }

    /// Build deterministic multi-day sleep + FSRS review history with controllable true slope,
    /// item difficulty confounding, or time-of-day confounding.
    fn simulate_dataset(
        days: usize,
        sessions_per_day: usize,
        reviews_per_session: usize,
        seed: u64,
        sleep_effect: f64,
        tod_effect: f64,
        difficulty_confound: bool,
        constant_sleep: bool,
        missing_sleep_mod: Option<usize>,
    ) -> (Vec<CanonicalSleepEpisode>, LearningTelemetrySnapshot) {
        let mut rng = StdRng::seed_from_u64(seed);
        let base_ms = parse_timestamp_with_offset("2026-09-01T00:00:00Z")
            .unwrap()
            .0;
        let mut raw_sleeps = Vec::new();
        let mut reviews = Vec::new();
        let mut rev_counter = 0usize;

        // First seed initial exposure for 40 items 2 days before measurement window
        // so all measured reviews have prior FSRS-7 memory state!
        let num_items = 40usize;
        for i in 0..num_items {
            reviews.push(RawReviewEvent {
                id: format!("init-{i}"),
                item_id: format!("item-{}", i % num_items),
                rating: 3,
                time_taken_secs: 4,
                reviewed_at_ms: base_ms - 2 * 86_400_000 + (i as i64) * 60_000,
                base_difficulty: if i % 2 == 0 { 8.0 } else { 2.0 },
                document_id: None,
                tags: vec![],
                plan_ids: vec![if i % 2 == 0 {
                    "plan-hard".into()
                } else {
                    "plan-easy".into()
                }],
            });
        }

        for d in 0..days {
            let day_start = base_ms + (d as i64) * 86_400_000;
            let sleep_hours = if constant_sleep {
                7.5
            } else {
                // Alternates systematically between ~5.5h and ~9.0h
                if d % 2 == 0 {
                    5.4 + rng.gen_range(-0.3..0.3)
                } else {
                    8.9 + rng.gen_range(-0.3..0.3)
                }
            };
            if missing_sleep_mod.map(|m| d % m != 0).unwrap_or(true) {
                // End wake at 07:00 UTC + small jitter
                let wake_ms = day_start + 7 * 3_600_000 + rng.gen_range(-1_200_000..1_200_000);
                let sleep_start_ms = wake_ms - (sleep_hours * 3_600_000.0) as i64;
                raw_sleeps.push(mk_sleep(
                    &format!("sl-{d}"),
                    HealthProviderId::Oura,
                    sleep_start_ms,
                    sleep_hours,
                ));
            }

            for s_idx in 0..sessions_per_day {
                let hour = if tod_effect.abs() > 0.0 {
                    // Correlate time-of-day intentionally with sleep_hours when testing tod confound:
                    if d % 2 == 0 {
                        22
                    } else {
                        9
                    }
                } else {
                    if s_idx % 2 == 0 {
                        10
                    } else {
                        18
                    }
                };
                let sess_start = day_start + hour * 3_600_000 + (s_idx as i64) * 180_000;
                for r_idx in 0..reviews_per_session {
                    rev_counter += 1;
                    // Difficulty confound: hard items (even) studied on short sleep days
                    let item_idx = if difficulty_confound {
                        let base_even = (r_idx * 2) % num_items;
                        if sleep_hours < 7.0 {
                            base_even
                        } else {
                            (base_even + 1) % num_items
                        }
                    } else {
                        (rev_counter + d) % num_items
                    };
                    // Item base recall penalty for hard items (raw accuracy drops on hard items!)
                    let hard_item_offset = if item_idx % 2 == 0 { -0.22 } else { 0.12 };
                    let theta = (hour as f64) * std::f64::consts::TAU / 24.0;
                    let prob = (0.78
                        + sleep_effect * (sleep_hours - 7.15)
                        + tod_effect * theta.sin()
                        + if difficulty_confound {
                            hard_item_offset
                        } else {
                            0.0
                        })
                    .clamp(0.05, 0.98);
                    let recalled = rng.gen_bool(prob);
                    let rating = if recalled { 3 } else { 1 };
                    let plan = if item_idx % 2 == 0 {
                        "plan-hard"
                    } else {
                        "plan-easy"
                    };
                    reviews.push(RawReviewEvent {
                        id: format!("rv-{rev_counter}"),
                        item_id: format!("item-{item_idx}"),
                        rating,
                        time_taken_secs: rng.gen_range(2..12),
                        reviewed_at_ms: sess_start + (r_idx as i64) * 8_000,
                        base_difficulty: if item_idx % 2 == 0 { 8.0 } else { 2.0 },
                        document_id: None,
                        tags: vec![],
                        plan_ids: vec![plan.to_string()],
                    });
                }
            }
        }

        let episodes = reconcile_sleep_sessions(&raw_sleeps, &[], &HashMap::new());
        let snap = LearningTelemetrySnapshot {
            reviews,
            assessments: vec![],
            study_plans: vec![
                StudyPlanRef {
                    id: "plan-hard".into(),
                    title: "Hard Plan".into(),
                    status: "active".into(),
                },
                StudyPlanRef {
                    id: "plan-easy".into(),
                    title: "Easy Plan".into(),
                    status: "active".into(),
                },
            ],
            reading_sessions: vec![],
        };
        (episodes, snap)
    }

    fn run_insights(
        episodes: &[CanonicalSleepEpisode],
        snap: &LearningTelemetrySnapshot,
    ) -> LearningInsightsReport {
        let start_ms = parse_timestamp_with_offset("2026-09-01T00:00:00Z")
            .unwrap()
            .0;
        let end_ms = parse_timestamp_with_offset("2026-11-30T00:00:00Z")
            .unwrap()
            .0;
        compute_learning_insights(
            snap,
            episodes,
            &[],
            &[],
            Some(start_ms),
            Some(end_ms),
            None,
            Some(0),
            true,
        )
        .unwrap()
    }

    // Check prohibited overclaim phrasing across any generated report
    fn assert_report_language_clean(report: &LearningInsightsReport) {
        assert!(contains_overclaim_language(&report.learning_windows.explanation).is_none());
        for ins in &report.insights {
            assert!(
                contains_overclaim_language(&ins.summary).is_none(),
                "Overclaim in insight {}: {}",
                ins.id,
                ins.summary
            );
            assert!(contains_overclaim_language(&ins.title).is_none());
        }
    }

    #[test]
    fn test_01_no_true_correlation_produces_no_false_positive() {
        let (eps, snap) = simulate_dataset(24, 1, 8, 1001, 0.0, 0.0, false, false, None);
        let report = run_insights(&eps, &snap);
        assert_report_language_clean(&report);
        let sleep_ins = report
            .insights
            .iter()
            .find(|i| i.metric_key == "sleep_duration")
            .unwrap();
        assert_ne!(
            sleep_ins.status, "supported",
            "Unexpected false positive: {:?}",
            sleep_ins
        );
    }

    #[test]
    fn test_02_positive_sleep_association_detected() {
        let (eps, snap) = simulate_dataset(30, 1, 10, 2002, 0.14, 0.0, false, false, None);
        let report = run_insights(&eps, &snap);
        assert_report_language_clean(&report);
        let sleep_ins = report
            .insights
            .iter()
            .find(|i| i.metric_key == "sleep_duration")
            .unwrap();
        assert_eq!(
            sleep_ins.status, "supported",
            "Expected supported: {:?}",
            sleep_ins
        );
        assert_eq!(sleep_ins.direction, "positive");
        assert!(sleep_ins.evidence.ci_low.unwrap() > 0.0);
    }

    #[test]
    fn test_03_negative_sleep_association_detected() {
        let (eps, snap) = simulate_dataset(30, 1, 10, 3003, -0.14, 0.0, false, false, None);
        let report = run_insights(&eps, &snap);
        assert_report_language_clean(&report);
        let sleep_ins = report
            .insights
            .iter()
            .find(|i| i.metric_key == "sleep_duration")
            .unwrap();
        assert_eq!(
            sleep_ins.status, "supported",
            "Expected supported: {:?}",
            sleep_ins
        );
        assert_eq!(sleep_ins.direction, "negative");
        assert!(sleep_ins.evidence.ci_high.unwrap() < 0.0);
    }

    #[test]
    fn test_04_strong_item_difficulty_confounding_removed_by_fsrs_and_ols() {
        // Hard cards only studied on short sleep; easy cards on long sleep, ZERO intrinsic sleep effect!
        // Note: initial review assigns identical starting difficulty in stock FSRS before hard/easy rating diverges,
        // and our simulator tracks base_difficulty + repeated reviews. Plus OLS adjusts `mean_item_difficulty`.
        let (eps, mut snap) = simulate_dataset(26, 1, 8, 4004, 0.0, 0.0, true, false, None);
        // Prime items with prior failures for hard items so FSRS state.difficulty clearly reflects difficulty >= 7
        let pre_ms = parse_timestamp_with_offset("2026-08-20T10:00:00Z")
            .unwrap()
            .0;
        for i in (0..40).step_by(2) {
            snap.reviews.push(RawReviewEvent {
                id: format!("pre-lapse-{i}"),
                item_id: format!("item-{i}"),
                rating: 1,
                time_taken_secs: 15,
                reviewed_at_ms: pre_ms + i as i64 * 1000,
                base_difficulty: 8.5,
                document_id: None,
                tags: vec![],
                plan_ids: vec!["plan-hard".into()],
            });
        }
        let report = run_insights(&eps, &snap);
        assert_report_language_clean(&report);
        let sleep_ins = report
            .insights
            .iter()
            .find(|i| i.metric_key == "sleep_duration")
            .unwrap();
        assert_ne!(
            sleep_ins.status, "supported",
            "Difficulty confounding leaked into sleep_duration insight: {:?}",
            sleep_ins
        );
    }

    #[test]
    fn test_05_circadian_time_of_day_confounding_removed_by_harmonics() {
        // Long sleep days studied at 09:00 (sin > 0 -> higher recall), short sleep days at 22:00 (sin < 0 -> lower recall),
        // with ZERO true direct sleep_effect!
        let (eps, snap) = simulate_dataset(26, 1, 10, 5005, 0.0, 0.25, false, false, None);
        let report = run_insights(&eps, &snap);
        assert_report_language_clean(&report);
        let sleep_ins = report
            .insights
            .iter()
            .find(|i| i.metric_key == "sleep_duration")
            .unwrap();
        assert_ne!(
            sleep_ins.status, "supported",
            "Time-of-day confound triggered false sleep duration finding: {:?}",
            sleep_ins
        );
    }

    #[test]
    fn test_06_very_small_sample_returns_insufficient_data() {
        let (eps, snap) = simulate_dataset(4, 1, 5, 6006, 0.15, 0.0, false, false, None);
        let report = run_insights(&eps, &snap);
        assert!(!report.sufficiency.meets_core_guardrails);
        assert_eq!(
            report.learning_windows.validation_status,
            "insufficient_data"
        );
        for ins in &report.insights {
            assert_eq!(ins.status, "insufficient_data");
        }
    }

    #[test]
    fn test_07_constant_sleep_duration_skips_regression_safely() {
        let (eps, snap) = simulate_dataset(20, 1, 8, 7007, 0.0, 0.0, false, true, None);
        let report = run_insights(&eps, &snap);
        let sleep_ins = report
            .insights
            .iter()
            .find(|i| i.metric_key == "sleep_duration")
            .unwrap();
        assert_eq!(sleep_ins.status, "insufficient_data");
        assert!(sleep_ins.evidence.effect_size.is_none());
    }

    #[test]
    fn test_08_missing_sleep_coverage_below_threshold_is_insufficient() {
        // Missing 2 out of every 3 nights -> ~33% coverage (< 50%)
        let (eps, snap) = simulate_dataset(24, 1, 8, 8008, 0.12, 0.0, false, false, Some(2));
        // With missing_sleep_mod = Some(2), only odd days have sleep -> ~50%, use modulo check where only d % 3 == 0 has sleep:
        let filtered_eps: Vec<CanonicalSleepEpisode> = eps
            .into_iter()
            .enumerate()
            .filter(|(idx, _)| idx % 3 == 0)
            .map(|(_, e)| e)
            .collect();
        let report = run_insights(&filtered_eps, &snap);
        assert!(!report.sufficiency.meets_core_guardrails);
        let sleep_ins = report
            .insights
            .iter()
            .find(|i| i.metric_key == "sleep_duration")
            .unwrap();
        assert_eq!(sleep_ins.status, "insufficient_data");
    }

    #[test]
    fn test_09_extreme_latency_outliers_winsorized() {
        let (eps, mut snap) = simulate_dataset(18, 1, 8, 9009, 0.0, 0.0, false, false, None);
        // Inject absurd 99999-second outlier
        if let Some(last) = snap.reviews.last_mut() {
            last.time_taken_secs = 99_999;
        }
        let report = run_insights(&eps, &snap);
        for b in &report.time_of_day_buckets {
            if let Some(lat) = b.median_latency_secs {
                assert!(lat.is_finite() && lat <= 180.0);
            }
        }
    }

    #[test]
    fn test_10_duplicate_wearable_records_do_not_inflate_sample_or_duration() {
        let wake = parse_timestamp_with_offset("2026-10-05T07:00:00Z")
            .unwrap()
            .0;
        let start = wake - 8 * 3_600_000;
        let r1 = mk_sleep("oura-1", HealthProviderId::Oura, start, 8.0);
        let mut r2 = mk_sleep(
            "hk-dup",
            HealthProviderId::AppleHealthkit,
            start + 60_000,
            8.0,
        );
        r2.source_app_bundle = Some("com.ouraring.oura".into());
        let episodes = reconcile_sleep_sessions(&[r1, r2], &[], &HashMap::new());
        assert_eq!(episodes.len(), 1);
        assert_eq!(episodes[0].members.len(), 2);
        assert!((episodes[0].total_sleep_mins - 480.0).abs() < 1.0);
    }

    #[test]
    fn test_11_day_clustered_bootstrap_runs_with_autocorrelated_days() {
        // Only 10 days with many correlated sessions per day
        let (eps, snap) = simulate_dataset(11, 3, 6, 1111, 0.05, 0.0, false, false, None);
        let report = run_insights(&eps, &snap);
        let sleep_ins = report
            .insights
            .iter()
            .find(|i| i.metric_key == "sleep_duration")
            .unwrap();
        if let (Some(lo), Some(hi)) = (sleep_ins.evidence.ci_low, sleep_ins.evidence.ci_high) {
            assert!(hi >= lo);
        }
    }

    #[test]
    fn test_12_fsrs_memory_state_evolves_across_repeated_reviews() {
        let (_, mut snap) = simulate_dataset(15, 1, 5, 1212, 0.0, 0.0, false, false, None);
        snap.reviews.truncate(5);
        for event in &mut snap.reviews {
            event.item_id = "item-0".into();
        }
        let item0 = replay_reviews_fsrs7(&snap.reviews).unwrap();
        assert_eq!(item0.len(), 5);
        assert!(item0[0].predicted_retrievability.is_none());
        assert!(item0.last().unwrap().predicted_retrievability.is_some());
    }

    #[test]
    fn test_13_study_plan_scoped_filtering_respects_guardrails() {
        let (eps, snap) = simulate_dataset(20, 1, 8, 1313, 0.08, 0.0, false, false, None);
        let start_ms = parse_timestamp_with_offset("2026-09-01T00:00:00Z")
            .unwrap()
            .0;
        let end_ms = parse_timestamp_with_offset("2026-11-30T00:00:00Z")
            .unwrap()
            .0;
        let scoped = compute_study_plan_insights(
            "nonexistent-plan",
            &snap,
            &eps,
            &[],
            &[],
            Some(start_ms),
            Some(end_ms),
            Some(0),
            true,
        )
        .unwrap();
        assert_eq!(scoped.sufficiency.paired_reviews_count(), 0);
        assert!(!scoped.sufficiency.meets_core_guardrails);
    }

    #[test]
    fn test_14_incomplete_and_mixed_mode_assessments_stay_segregated() {
        let base = parse_timestamp_with_offset("2026-10-01T10:00:00Z")
            .unwrap()
            .0;
        let eps = reconcile_sleep_sessions(
            &[mk_sleep(
                "s1",
                HealthProviderId::Oura,
                base - 10 * 3_600_000,
                8.0,
            )],
            &[],
            &HashMap::new(),
        );
        let snap = LearningTelemetrySnapshot {
            reviews: vec![],
            assessments: vec![
                FinalizedAssessmentRecord {
                    attempt_id: "ex1".into(),
                    blueprint_id: "bp1".into(),
                    blueprint_title: "Midterm".into(),
                    plan_id: None,
                    mode: "exam".into(),
                    started_at_ms: base,
                    submitted_at_ms: base + 600_000,
                    score_ratio: 0.90,
                    awarded_points: 90.0,
                    maximum_points: 100.0,
                    preceding_main_sleep_hours: None,
                    elapsed_since_awakening_hours: None,
                    sleep_regularity_bedtime_sd_mins: None,
                },
                FinalizedAssessmentRecord {
                    attempt_id: "pr1".into(),
                    blueprint_id: "bp1".into(),
                    blueprint_title: "Drill".into(),
                    plan_id: None,
                    mode: "practice".into(),
                    started_at_ms: base,
                    submitted_at_ms: base + 300_000,
                    score_ratio: 0.40,
                    awarded_points: 4.0,
                    maximum_points: 10.0,
                    preceding_main_sleep_hours: None,
                    elapsed_since_awakening_hours: None,
                    sleep_regularity_bedtime_sd_mins: None,
                },
            ],
            study_plans: vec![],
            reading_sessions: vec![],
        };
        let report = run_insights(&eps, &snap);
        let exam = report
            .assessment_breakdowns
            .iter()
            .find(|b| b.mode == "exam")
            .unwrap();
        let prac = report
            .assessment_breakdowns
            .iter()
            .find(|b| b.mode == "practice")
            .unwrap();
        assert_eq!(exam.attempts, 1);
        assert_eq!(prac.attempts, 1);
        assert!((exam.mean_score_pct.unwrap() - 90.0).abs() < 1e-6);
        assert!((prac.mean_score_pct.unwrap() - 40.0).abs() < 1e-6);
        assert!(!exam.sufficient);
    }

    #[test]
    fn test_15_predictive_model_failing_to_beat_baseline_downgrades_to_descriptive_only() {
        // Pure noise residuals across 3 populated TOD buckets -> overfitting train does NOT beat M0 on held-out 30%
        let (eps, snap) = simulate_dataset(25, 3, 6, 1515, 0.0, 0.0, false, false, None);
        let report = run_insights(&eps, &snap);
        assert_ne!(
            report.learning_windows.validation_status, "validated_predictive",
            "Noise dataset unexpectedly passed held-out validation: {:?}",
            report.learning_windows
        );
    }
}

impl DataSufficiencySummary {
    pub fn paired_reviews_count(&self) -> usize {
        self.paired_fsrs_reviews
    }
}
