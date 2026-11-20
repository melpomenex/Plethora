//! Read-only loader for Plethora learning telemetry (`plethora.db`) paired
//! chronologically with FSRS-7 zero-leakage replay and UTC timestamp-aligned
//! canonical sleep/physiological context.
//!
//! CRITICAL INVARIANT: This module performs strictly READ-ONLY queries against
//! `plethora.db`. It never inserts, updates, deletes, or writes health data into
//! `plethora.db`.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use sqlx::{Pool, Row, Sqlite};

use crate::algorithms::fsrs7::{
    create_fsrs7, current_retrievability, from_fsrs_memory_state, next_states_fractional,
};
use crate::models::MemoryState as PlethoraMemoryState;

use super::models::{
    CanonicalSleepEpisode, HrvMethod, PhysiologicalMetricType, PhysiologicalObservation,
    RecoveryObservation, SleepKind,
};
use super::sleep_analytics::{classify_sleep_kind, compute_circular_minutes_stats};
use super::time::{local_date_string, local_minutes_of_day};

pub const SESSION_GAP_MS: i64 = 30 * 60 * 1000;
pub const MAIN_SLEEP_LOOKBACK_MS: i64 = 36 * 3_600 * 1000;
pub const NAP_LOOKBACK_MS: i64 = 12 * 3_600 * 1000;

#[derive(Debug, Clone)]
pub struct RawReviewEvent {
    pub id: String,
    pub item_id: String,
    pub rating: i32,
    pub time_taken_secs: i64,
    pub reviewed_at_ms: i64,
    pub base_difficulty: f64,
    pub document_id: Option<String>,
    pub tags: Vec<String>,
    pub plan_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ReplayedReview {
    pub id: String,
    pub item_id: String,
    pub reviewed_at_ms: i64,
    pub rating: i32,
    pub recalled: f64,
    pub predicted_retrievability: Option<f64>,
    pub fsrs_residual: Option<f64>,
    pub item_difficulty: f64,
    pub latency_secs: f64,
    pub log_latency: f64,
    pub item_latency_z: Option<f64>,
    pub document_id: Option<String>,
    pub plan_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ComparableStudySession {
    pub session_id: String,
    pub started_at_ms: i64,
    pub ended_at_ms: i64,
    pub local_date: String,
    pub local_start_hour: f64,
    pub total_reviews: usize,
    pub fsrs_residual_reviews: usize,
    pub mean_raw_recall: f64,
    pub mean_fsrs_residual: Option<f64>,
    pub median_latency_secs: f64,
    pub mean_log_latency: f64,
    pub mean_item_latency_z: Option<f64>,
    pub mean_item_difficulty: f64,
    pub prior_workload_24h: usize,
    pub plan_ids: Vec<String>,
    // Timestamp-aligned physiological / sleep context (preceding events ONLY):
    pub preceding_main_sleep_id: Option<String>,
    pub preceding_main_sleep_hours: Option<f64>,
    pub preceding_main_sleep_efficiency_pct: Option<f64>,
    pub preceding_main_sleep_deep_pct: Option<f64>,
    pub preceding_main_sleep_rem_pct: Option<f64>,
    pub elapsed_since_awakening_hours: Option<f64>,
    pub has_recent_nap: bool,
    pub recent_nap_mins: f64,
    pub trailing_7d_sleep_hours_mean: Option<f64>,
    pub trailing_7d_bedtime_sd_mins: Option<f64>,
    pub overnight_rmssd_ms: Option<f64>,
    pub overnight_rmssd_z: Option<f64>,
    pub overnight_sdnn_ms: Option<f64>,
    pub overnight_sdnn_z: Option<f64>,
    pub resting_hr_bpm: Option<f64>,
    pub recovery_score_norm: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct FinalizedAssessmentRecord {
    pub attempt_id: String,
    pub blueprint_id: String,
    pub blueprint_title: String,
    pub plan_id: Option<String>,
    pub mode: String, // "exam" | "practice" | "diagnostic"
    pub started_at_ms: i64,
    pub submitted_at_ms: i64,
    pub score_ratio: f64,
    pub awarded_points: f64,
    pub maximum_points: f64,
    pub preceding_main_sleep_hours: Option<f64>,
    pub elapsed_since_awakening_hours: Option<f64>,
    pub sleep_regularity_bedtime_sd_mins: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StudyPlanRef {
    pub id: String,
    pub title: String,
    pub status: String,
}

#[derive(Debug, Clone)]
pub struct ReadingSessionSummary {
    pub id: String,
    pub document_id: String,
    pub started_at_ms: i64,
    pub ended_at_ms: i64,
    pub duration_secs: i64,
}

#[derive(Debug, Clone, Default)]
pub struct LearningTelemetrySnapshot {
    pub reviews: Vec<RawReviewEvent>,
    pub assessments: Vec<FinalizedAssessmentRecord>,
    pub study_plans: Vec<StudyPlanRef>,
    pub reading_sessions: Vec<ReadingSessionSummary>,
}

async fn table_exists(pool: &Pool<Sqlite>, table_name: &str) -> Result<bool, String> {
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
            .bind(table_name)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed checking table existence ({table_name}): {e}"))?;
    Ok(exists.is_some())
}

fn parse_rfc3339_ms(raw: &str) -> Option<i64> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw.trim()) {
        return Some(dt.timestamp_millis());
    }
    super::time::parse_timestamp_with_offset(raw)
        .ok()
        .map(|v| v.0)
}

/// Load learning telemetry strictly read-only from `plethora.db`.
pub async fn load_learning_telemetry(
    pool: &Pool<Sqlite>,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
) -> Result<LearningTelemetrySnapshot, String> {
    let mut snapshot = LearningTelemetrySnapshot::default();

    // 1. Review -> Plan mapping from `learning_evidence` (if present)
    let mut review_plan_map: HashMap<String, Vec<String>> = HashMap::new();
    if table_exists(pool, "learning_evidence").await? {
        let rows = sqlx::query(
            "SELECT source_id, plan_id
             FROM learning_evidence
             WHERE source_kind = 'review-result' AND plan_id IS NOT NULL",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed reading learning_evidence: {e}"))?;
        for r in rows {
            let sid: String = r.try_get("source_id").unwrap_or_default();
            let pid: String = r.try_get("plan_id").unwrap_or_default();
            if !sid.is_empty() && !pid.is_empty() {
                review_plan_map.entry(sid).or_default().push(pid);
            }
        }
    }

    // 2. All review_results joined with learning_items (full history loaded so
    // FSRS replay starts chronologically from each item's true first review).
    if table_exists(pool, "review_results").await? && table_exists(pool, "learning_items").await? {
        let rows = sqlx::query(
            "SELECT rr.id, rr.item_id, rr.rating, rr.time_taken,
                    COALESCE(rr.reviewed_at_ms, CAST(strftime('%s', rr.timestamp) AS INTEGER) * 1000) AS reviewed_at_ms,
                    li.difficulty AS item_difficulty, li.document_id, li.tags
             FROM review_results rr
             JOIN learning_items li ON li.id = rr.item_id
             ORDER BY reviewed_at_ms ASC, rr.id ASC",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed reading review_results: {e}"))?;

        for row in rows {
            let id: String = row.try_get("id").unwrap_or_default();
            let item_id: String = row.try_get("item_id").unwrap_or_default();
            let rating: i32 = row.try_get("rating").unwrap_or(3);
            let time_taken_secs: i64 = row.try_get("time_taken").unwrap_or(0);
            let reviewed_at_ms: i64 = row.try_get("reviewed_at_ms").unwrap_or(0);
            if id.is_empty() || item_id.is_empty() || reviewed_at_ms <= 0 {
                continue;
            }
            if let Some(end) = end_ms {
                if reviewed_at_ms > end {
                    continue;
                }
            }
            let diff_i32: i32 = row.try_get("item_difficulty").unwrap_or(3);
            let tags_raw: String = row.try_get("tags").unwrap_or_else(|_| "[]".into());
            let tags: Vec<String> = serde_json::from_str(&tags_raw).unwrap_or_default();
            let document_id: Option<String> = row.try_get("document_id").ok().flatten();
            let plan_ids = review_plan_map.remove(&id).unwrap_or_default();

            snapshot.reviews.push(RawReviewEvent {
                id,
                item_id,
                rating,
                time_taken_secs,
                reviewed_at_ms,
                base_difficulty: (diff_i32 as f64).clamp(1.0, 10.0),
                document_id,
                tags,
                plan_ids,
            });
        }
    }

    // 3. Finalized assessments (strictly separated by mode; exclude incomplete/ungraded)
    if table_exists(pool, "exam_attempts").await?
        && table_exists(pool, "assessment_blueprint_revisions").await?
        && table_exists(pool, "assessment_blueprints").await?
        && table_exists(pool, "exam_response_submissions").await?
        && table_exists(pool, "exam_grades").await?
    {
        let rows = sqlx::query(
            "SELECT ea.id, ab.id AS blueprint_id, ab.title AS blueprint_title, ab.plan_id,
                    ea.mode, ea.started_at, COALESCE(ea.completed_at, ea.submitted_at, ea.started_at) AS done_at,
                    ea.awarded_points, ea.maximum_points
             FROM exam_attempts ea
             JOIN assessment_blueprint_revisions abr ON abr.id = ea.blueprint_revision_id
             JOIN assessment_blueprints ab ON ab.id = abr.blueprint_id
             WHERE ea.status = 'complete' AND ea.awarded_points IS NOT NULL AND ea.maximum_points > 0
               AND json_array_length(ea.question_revision_ids_json) > 0
               AND NOT EXISTS (
                 SELECT 1 FROM json_each(ea.question_revision_ids_json) question
                 WHERE NOT EXISTS (
                   SELECT 1 FROM exam_grades grade
                   JOIN exam_response_submissions submission ON submission.id = grade.response_submission_id
                   WHERE submission.attempt_id = ea.id AND grade.question_revision_id = question.value
                     AND grade.is_current = 1 AND grade.state = 'final' AND grade.points IS NOT NULL
                     AND NOT EXISTS (
                       SELECT 1 FROM exam_response_submissions newer
                       WHERE newer.response_id = submission.response_id
                         AND newer.ordinal > submission.ordinal
                     )
                 )
               )
             ORDER BY ea.started_at ASC, ea.id ASC",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed reading exam_attempts: {e}"))?;

        for row in rows {
            let started_at_str: String = row.try_get("started_at").unwrap_or_default();
            let done_at_str: String = row.try_get("done_at").unwrap_or_default();
            let Some(started_at_ms) = parse_rfc3339_ms(&started_at_str) else {
                continue;
            };
            let submitted_at_ms = parse_rfc3339_ms(&done_at_str).unwrap_or(started_at_ms);
            if let Some(s) = start_ms {
                if started_at_ms < s {
                    continue;
                }
            }
            if let Some(e) = end_ms {
                if started_at_ms > e {
                    continue;
                }
            }
            let awarded_points: f64 = row.try_get("awarded_points").unwrap_or(0.0);
            let maximum_points: f64 = row.try_get("maximum_points").unwrap_or(1.0);
            if !awarded_points.is_finite() || !maximum_points.is_finite() || maximum_points <= 0.0 {
                continue;
            }
            snapshot.assessments.push(FinalizedAssessmentRecord {
                attempt_id: row.try_get("id").unwrap_or_default(),
                blueprint_id: row.try_get("blueprint_id").unwrap_or_default(),
                blueprint_title: row.try_get("blueprint_title").unwrap_or_default(),
                plan_id: row.try_get("plan_id").ok().flatten(),
                mode: row.try_get("mode").unwrap_or_else(|_| "practice".into()),
                started_at_ms,
                submitted_at_ms,
                score_ratio: (awarded_points / maximum_points).clamp(0.0, 1.0),
                awarded_points,
                maximum_points,
                preceding_main_sleep_hours: None,
                elapsed_since_awakening_hours: None,
                sleep_regularity_bedtime_sd_mins: None,
            });
        }
    }

    // 4. Study plans catalog
    if table_exists(pool, "study_plans").await? {
        let rows =
            sqlx::query("SELECT id, title, status FROM study_plans ORDER BY updated_at DESC")
                .fetch_all(pool)
                .await
                .map_err(|e| format!("Failed reading study_plans: {e}"))?;
        for row in rows {
            snapshot.study_plans.push(StudyPlanRef {
                id: row.try_get("id").unwrap_or_default(),
                title: row.try_get("title").unwrap_or_default(),
                status: row.try_get("status").unwrap_or_else(|_| "active".into()),
            });
        }
    }

    // 5. Reading sessions
    if table_exists(pool, "reading_sessions").await? {
        let rows = sqlx::query(
            "SELECT id, document_id, started_at, ended_at, duration_seconds
             FROM reading_sessions
             WHERE duration_seconds > 0
             ORDER BY started_at ASC",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| format!("Failed reading reading_sessions: {e}"))?;
        for row in rows {
            let started_str: String = row.try_get("started_at").unwrap_or_default();
            let Some(started_at_ms) = parse_rfc3339_ms(&started_str) else {
                continue;
            };
            if let Some(s) = start_ms {
                if started_at_ms < s {
                    continue;
                }
            }
            if let Some(e) = end_ms {
                if started_at_ms > e {
                    continue;
                }
            }
            let duration_secs: i64 = row.try_get("duration_seconds").unwrap_or(0);
            let ended_at_ms = row
                .try_get::<Option<String>, _>("ended_at")
                .ok()
                .flatten()
                .and_then(|v| parse_rfc3339_ms(&v))
                .unwrap_or_else(|| started_at_ms + duration_secs * 1000);
            snapshot.reading_sessions.push(ReadingSessionSummary {
                id: row.try_get("id").unwrap_or_default(),
                document_id: row.try_get("document_id").unwrap_or_default(),
                started_at_ms,
                ended_at_ms,
                duration_secs,
            });
        }
    }

    Ok(snapshot)
}

/// Perform zero-leakage chronological FSRS-7 replay over raw review events.
///
/// For each item, predicted retrievability `R_pred` on review `i >= 2` is evaluated
/// strictly from the FSRS-7 memory state accumulated from reviews `1..i-1` BEFORE
/// observing rating `i`. First-ever reviews have `predicted_retrievability = None`.
pub fn replay_reviews_fsrs7(raw_reviews: &[RawReviewEvent]) -> Result<Vec<ReplayedReview>, String> {
    let fsrs = create_fsrs7().map_err(|e| format!("Failed initializing FSRS-7 engine: {e}"))?;

    let mut by_item: HashMap<&str, Vec<&RawReviewEvent>> = HashMap::new();
    for ev in raw_reviews {
        by_item.entry(ev.item_id.as_str()).or_default().push(ev);
    }

    let mut out = Vec::with_capacity(raw_reviews.len());
    for (_item_id, mut events) in by_item {
        events.sort_by_key(|e| (e.reviewed_at_ms, e.id.as_str()));

        let mut prev_ms = None;
        let reviews: Vec<fsrs::FSRSReview> = events
            .iter()
            .map(|event| {
                let delta_t = prev_ms.map_or(0.0, |previous: i64| {
                    event.reviewed_at_ms.saturating_sub(previous).max(0) as f64 / 86_400_000.0
                });
                prev_ms = Some(event.reviewed_at_ms);
                fsrs::FSRSReview {
                    rating: match event.rating {
                        1 | 2 | 4 => event.rating as u32,
                        _ => 3,
                    },
                    delta_t: delta_t as f32,
                }
            })
            .collect();
        // Replay only the ratings that happened. The scheduling API computes
        // four hypothetical transitions and intervals that analytics never uses.
        let history = fsrs
            .historical_memory_states(
                fsrs::FSRSItem {
                    reviews: reviews.clone(),
                },
                None,
            )
            .ok();
        let mut mem_state: Option<PlethoraMemoryState> = None;
        let mut item_latencies: Vec<f64> = Vec::with_capacity(events.len());
        let mut temp_item_out: Vec<ReplayedReview> = Vec::with_capacity(events.len());

        for (index, (ev, review)) in events.into_iter().zip(reviews).enumerate() {
            let (predicted_r, item_difficulty) = match mem_state.as_ref() {
                Some(state) => (
                    current_retrievability(state, f64::from(review.delta_t)),
                    state.difficulty.clamp(1.0, 10.0),
                ),
                None => (None, ev.base_difficulty),
            };

            let recalled = if ev.rating >= 2 { 1.0 } else { 0.0 };
            let residual = predicted_r.map(|r| (recalled - r).clamp(-1.0, 1.0));
            let latency_secs = (ev.time_taken_secs.max(1) as f64).clamp(0.5, 180.0);
            let log_latency = latency_secs.ln();
            item_latencies.push(log_latency);

            // Advance after scoring. The sequential fallback retains valid
            // history when the engine rejects an entire item's replay.
            if let Some(state) = history.as_ref().and_then(|states| states.get(index)) {
                mem_state = Some(from_fsrs_memory_state(state));
            } else if let Ok(next_states) =
                next_states_fractional(&fsrs, mem_state.as_ref(), 0.9, review.delta_t)
            {
                let chosen = match review.rating {
                    1 => next_states.again.memory,
                    2 => next_states.hard.memory,
                    4 => next_states.easy.memory,
                    _ => next_states.good.memory,
                };
                mem_state = Some(from_fsrs_memory_state(&chosen));
            }

            temp_item_out.push(ReplayedReview {
                id: ev.id.clone(),
                item_id: ev.item_id.clone(),
                reviewed_at_ms: ev.reviewed_at_ms,
                rating: ev.rating,
                recalled,
                predicted_retrievability: predicted_r,
                fsrs_residual: residual,
                item_difficulty,
                latency_secs,
                log_latency,
                item_latency_z: None,
                document_id: ev.document_id.clone(),
                plan_ids: ev.plan_ids.clone(),
            });
        }

        // Compute within-item z-score of log-latency if >= 3 reviews
        if item_latencies.len() >= 3 {
            let mean_l = item_latencies.iter().sum::<f64>() / item_latencies.len() as f64;
            let var_l = item_latencies
                .iter()
                .map(|x| (x - mean_l).powi(2))
                .sum::<f64>()
                / (item_latencies.len() - 1) as f64;
            let sd_l = var_l.sqrt();
            if sd_l > 1e-6 {
                for (row, &ll) in temp_item_out.iter_mut().zip(item_latencies.iter()) {
                    row.item_latency_z = Some(((ll - mean_l) / sd_l).clamp(-4.0, 4.0));
                }
            }
        }

        out.extend(temp_item_out);
    }

    out.sort_by(|left, right| {
        (left.reviewed_at_ms, &left.id).cmp(&(right.reviewed_at_ms, &right.id))
    });
    Ok(out)
}

fn median(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut copy = values.to_vec();
    copy.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = copy.len() / 2;
    if copy.len() % 2 == 1 {
        copy[mid]
    } else {
        (copy[mid - 1] + copy[mid]) / 2.0
    }
}

fn winsorize_log_latencies(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    if values.len() < 4 {
        return values.iter().sum::<f64>() / values.len() as f64;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let lo_idx = ((sorted.len() as f64) * 0.05).floor() as usize;
    let hi_idx = (((sorted.len() as f64) * 0.95).ceil() as usize)
        .saturating_sub(1)
        .min(sorted.len() - 1);
    let lo = sorted[lo_idx];
    let hi = sorted[hi_idx];
    let sum: f64 = values.iter().map(|v| v.clamp(lo, hi)).sum();
    sum / values.len() as f64
}

/// Group replayed reviews into 30-minute study sessions and align each session strictly
/// against preceding sleep/physiological context using UTC timestamps (never upcoming sleep!).
pub fn build_comparable_sessions(
    replayed: &[ReplayedReview],
    episodes: &[CanonicalSleepEpisode],
    physio: &[PhysiologicalObservation],
    recovery: &[RecoveryObservation],
    filter_start_ms: Option<i64>,
    filter_end_ms: Option<i64>,
    plan_filter: Option<&str>,
    tz_offset_secs: Option<i32>,
) -> Vec<ComparableStudySession> {
    let filtered_reviews: Vec<&ReplayedReview> = replayed
        .iter()
        .filter(|r| {
            filter_start_ms
                .map(|s| r.reviewed_at_ms >= s)
                .unwrap_or(true)
                && filter_end_ms.map(|e| r.reviewed_at_ms <= e).unwrap_or(true)
                && plan_filter
                    .map(|p| r.plan_ids.iter().any(|pid| pid == p))
                    .unwrap_or(true)
        })
        .collect();

    if filtered_reviews.is_empty() {
        return Vec::new();
    }

    // Separate classified main sleeps vs naps sorted by `end_at_ms`
    let mut main_sleeps: Vec<&CanonicalSleepEpisode> = Vec::new();
    let mut naps: Vec<&CanonicalSleepEpisode> = Vec::new();
    for ep in episodes {
        match classify_sleep_kind(ep, episodes) {
            SleepKind::Nap => naps.push(ep),
            SleepKind::MainSleep | SleepKind::Unknown => main_sleeps.push(ep),
        }
    }
    main_sleeps.sort_by_key(|e| e.end_at_ms);
    naps.sort_by_key(|e| e.end_at_ms);

    // Precompute segregated within-person RMSSD & SDNN z-scores
    let rmssd_vals: Vec<f64> = physio
        .iter()
        .filter(|p| {
            !p.is_deleted
                && p.metric_type == PhysiologicalMetricType::Hrv
                && p.hrv_method == HrvMethod::Rmssd
                && p.value.is_finite()
        })
        .map(|p| p.value)
        .collect();
    let sdnn_vals: Vec<f64> = physio
        .iter()
        .filter(|p| {
            !p.is_deleted
                && p.metric_type == PhysiologicalMetricType::Hrv
                && p.hrv_method == HrvMethod::Sdnn
                && p.value.is_finite()
        })
        .map(|p| p.value)
        .collect();
    let (rmssd_mean, rmssd_sd) = mean_sd(&rmssd_vals);
    let (sdnn_mean, sdnn_sd) = mean_sd(&sdnn_vals);
    let mut measured: Vec<_> = physio
        .iter()
        .filter(|sample| {
            !sample.is_deleted
                && sample.value.is_finite()
                && matches!(
                    sample.metric_type,
                    PhysiologicalMetricType::Hrv | PhysiologicalMetricType::RestingHeartRate
                )
        })
        .collect();
    measured.sort_unstable_by_key(|sample| sample.measured_at_ms);

    // Cluster into <= 30-min gap sessions
    let mut clusters: Vec<Vec<&ReplayedReview>> = Vec::new();
    let mut current: Vec<&ReplayedReview> = Vec::new();
    for r in filtered_reviews {
        if let Some(prev) = current.last() {
            if r.reviewed_at_ms - prev.reviewed_at_ms > SESSION_GAP_MS {
                clusters.push(current);
                current = Vec::new();
            }
        }
        current.push(r);
    }
    if !current.is_empty() {
        clusters.push(current);
    }

    let mut sessions = Vec::with_capacity(clusters.len());
    // Index for fast 24h workload lookup across `replayed`
    let mut workload_cursor = 0usize;

    for (idx, chunk) in clusters.into_iter().enumerate() {
        let started_at_ms = chunk.first().unwrap().reviewed_at_ms;
        let ended_at_ms = chunk.last().unwrap().reviewed_at_ms;
        let window_24h_start = started_at_ms - 86_400_000;
        while workload_cursor < replayed.len()
            && replayed[workload_cursor].reviewed_at_ms < window_24h_start
        {
            workload_cursor += 1;
        }
        let prior_workload_24h = replayed[workload_cursor..]
            .iter()
            .take_while(|r| r.reviewed_at_ms < started_at_ms)
            .count();

        let residuals: Vec<f64> = chunk.iter().filter_map(|r| r.fsrs_residual).collect();
        let mean_fsrs_residual = if residuals.is_empty() {
            None
        } else {
            Some(residuals.iter().sum::<f64>() / residuals.len() as f64)
        };
        let mean_raw_recall = chunk.iter().map(|r| r.recalled).sum::<f64>() / chunk.len() as f64;
        let latencies: Vec<f64> = chunk.iter().map(|r| r.latency_secs).collect();
        let log_latencies: Vec<f64> = chunk.iter().map(|r| r.log_latency).collect();
        let latency_zs: Vec<f64> = chunk.iter().filter_map(|r| r.item_latency_z).collect();
        let mean_item_latency_z = if latency_zs.is_empty() {
            None
        } else {
            Some(latency_zs.iter().sum::<f64>() / latency_zs.len() as f64)
        };
        let mean_item_difficulty =
            chunk.iter().map(|r| r.item_difficulty).sum::<f64>() / chunk.len() as f64;

        let mut plan_set = HashSet::new();
        for r in &chunk {
            for pid in &r.plan_ids {
                plan_set.insert(pid.clone());
            }
        }
        let mut plan_ids: Vec<String> = plan_set.into_iter().collect();
        plan_ids.sort();

        // Preceding main sleep strictly ended BEFORE session started (within 36h)
        let prec_main = main_sleeps
            .iter()
            .rfind(|ep| {
                ep.end_at_ms <= started_at_ms
                    && (started_at_ms - ep.end_at_ms) <= MAIN_SLEEP_LOOKBACK_MS
            })
            .copied();

        let session_tz = prec_main
            .and_then(|ep| ep.end_tz_offset_secs.or(ep.start_tz_offset_secs))
            .or(tz_offset_secs);
        let local_date = local_date_string(started_at_ms, session_tz);
        let local_start_hour = local_minutes_of_day(started_at_ms, session_tz) / 60.0;

        let (
            preceding_main_sleep_id,
            preceding_main_sleep_hours,
            preceding_main_sleep_efficiency_pct,
            preceding_main_sleep_deep_pct,
            preceding_main_sleep_rem_pct,
            elapsed_since_awakening_hours,
        ) = if let Some(ep) = prec_main {
            let deep_pct = if ep.stage_coverage_ratio >= 0.70 && ep.total_sleep_mins > 0.0 {
                ep.deep_mins.map(|d| d / ep.total_sleep_mins * 100.0)
            } else {
                None
            };
            let rem_pct = if ep.stage_coverage_ratio >= 0.70 && ep.total_sleep_mins > 0.0 {
                ep.rem_mins.map(|r| r / ep.total_sleep_mins * 100.0)
            } else {
                None
            };
            (
                Some(ep.id.clone()),
                Some(ep.total_sleep_mins / 60.0),
                ep.sleep_efficiency_pct,
                deep_pct,
                rem_pct,
                Some((started_at_ms - ep.end_at_ms) as f64 / 3_600_000.0),
            )
        } else {
            (None, None, None, None, None, None)
        };

        // Recent naps strictly completed BEFORE session start within 12h
        let recent_nap_mins: f64 = naps
            .iter()
            .filter(|n| {
                n.end_at_ms <= started_at_ms && (started_at_ms - n.end_at_ms) <= NAP_LOOKBACK_MS
            })
            .map(|n| n.total_sleep_mins)
            .sum();

        // Trailing 7d sleep regularity strictly BEFORE session start
        let seven_days_ago = started_at_ms - 7 * 86_400_000;
        let trail_mains: Vec<&CanonicalSleepEpisode> = main_sleeps
            .iter()
            .filter(|ep| ep.end_at_ms <= started_at_ms && ep.end_at_ms >= seven_days_ago)
            .copied()
            .collect();
        let trailing_7d_sleep_hours_mean = if trail_mains.len() >= 3 {
            Some(
                trail_mains
                    .iter()
                    .map(|e| e.total_sleep_mins / 60.0)
                    .sum::<f64>()
                    / trail_mains.len() as f64,
            )
        } else {
            None
        };
        let trail_beds: Vec<f64> = trail_mains
            .iter()
            .map(|e| local_minutes_of_day(e.start_at_ms, e.start_tz_offset_secs.or(session_tz)))
            .collect();
        let trailing_7d_bedtime_sd_mins = if trail_beds.len() >= 3 {
            compute_circular_minutes_stats(&trail_beds).map(|s| s.sd_mins)
        } else {
            None
        };

        // Overnight RMSSD/SDNN & RHR preceding session within 36h
        let prec_phys_window_start = started_at_ms - MAIN_SLEEP_LOOKBACK_MS;
        let preceding_samples = &measured[measured
            .partition_point(|sample| sample.measured_at_ms < prec_phys_window_start)
            ..measured.partition_point(|sample| sample.measured_at_ms <= started_at_ms)];
        let overnight_rmssd_ms = latest_mean_metric(
            preceding_samples,
            PhysiologicalMetricType::Hrv,
            Some(HrvMethod::Rmssd),
        );
        let overnight_sdnn_ms = latest_mean_metric(
            preceding_samples,
            PhysiologicalMetricType::Hrv,
            Some(HrvMethod::Sdnn),
        );
        let resting_hr_bpm = latest_mean_metric(
            preceding_samples,
            PhysiologicalMetricType::RestingHeartRate,
            None,
        );

        let overnight_rmssd_z = match (overnight_rmssd_ms, rmssd_mean, rmssd_sd) {
            (Some(v), Some(m), Some(sd)) if sd > 1e-6 => Some(((v - m) / sd).clamp(-4.0, 4.0)),
            _ => None,
        };
        let overnight_sdnn_z = match (overnight_sdnn_ms, sdnn_mean, sdnn_sd) {
            (Some(v), Some(m), Some(sd)) if sd > 1e-6 => Some(((v - m) / sd).clamp(-4.0, 4.0)),
            _ => None,
        };

        let recovery_score_norm = recovery
            .iter()
            .filter(|r| {
                r.score_value.is_some()
                    && r.measured_at_ms <= started_at_ms
                    && r.measured_at_ms >= prec_phys_window_start
                    && r.scale_max > r.scale_min
            })
            .max_by_key(|r| r.measured_at_ms)
            .and_then(|r| {
                r.score_value
                    .map(|val| ((val - r.scale_min) / (r.scale_max - r.scale_min)).clamp(0.0, 1.0))
            });

        sessions.push(ComparableStudySession {
            session_id: format!("sess-{idx}-{started_at_ms}"),
            started_at_ms,
            ended_at_ms,
            local_date,
            local_start_hour,
            total_reviews: chunk.len(),
            fsrs_residual_reviews: residuals.len(),
            mean_raw_recall,
            mean_fsrs_residual,
            median_latency_secs: median(&latencies),
            mean_log_latency: winsorize_log_latencies(&log_latencies),
            mean_item_latency_z,
            mean_item_difficulty,
            prior_workload_24h,
            plan_ids,
            preceding_main_sleep_id,
            preceding_main_sleep_hours,
            preceding_main_sleep_efficiency_pct,
            preceding_main_sleep_deep_pct,
            preceding_main_sleep_rem_pct,
            elapsed_since_awakening_hours,
            has_recent_nap: recent_nap_mins >= 10.0,
            recent_nap_mins,
            trailing_7d_sleep_hours_mean,
            trailing_7d_bedtime_sd_mins,
            overnight_rmssd_ms,
            overnight_rmssd_z,
            overnight_sdnn_ms,
            overnight_sdnn_z,
            resting_hr_bpm,
            recovery_score_norm,
        });
    }

    sessions
}

/// Align finalized assessment attempts with preceding main sleep strictly before attempt start.
pub fn align_assessments_with_sleep(
    mut assessments: Vec<FinalizedAssessmentRecord>,
    episodes: &[CanonicalSleepEpisode],
    tz_offset_secs: Option<i32>,
) -> Vec<FinalizedAssessmentRecord> {
    let mut main_sleeps: Vec<&CanonicalSleepEpisode> = episodes
        .iter()
        .filter(|e| classify_sleep_kind(e, episodes) == SleepKind::MainSleep)
        .collect();
    main_sleeps.sort_by_key(|e| e.end_at_ms);

    for item in &mut assessments {
        let prec_main = main_sleeps
            .iter()
            .rfind(|ep| {
                ep.end_at_ms <= item.started_at_ms
                    && (item.started_at_ms - ep.end_at_ms) <= MAIN_SLEEP_LOOKBACK_MS
            })
            .copied();
        if let Some(ep) = prec_main {
            item.preceding_main_sleep_hours = Some(ep.total_sleep_mins / 60.0);
            item.elapsed_since_awakening_hours =
                Some((item.started_at_ms - ep.end_at_ms) as f64 / 3_600_000.0);
        }
        let seven_days_ago = item.started_at_ms - 7 * 86_400_000;
        let trail: Vec<f64> = main_sleeps
            .iter()
            .filter(|ep| ep.end_at_ms <= item.started_at_ms && ep.end_at_ms >= seven_days_ago)
            .map(|ep| {
                local_minutes_of_day(ep.start_at_ms, ep.start_tz_offset_secs.or(tz_offset_secs))
            })
            .collect();
        if trail.len() >= 3 {
            item.sleep_regularity_bedtime_sd_mins =
                compute_circular_minutes_stats(&trail).map(|s| s.sd_mins);
        }
    }
    assessments
}

fn mean_sd(values: &[f64]) -> (Option<f64>, Option<f64>) {
    if values.len() < 3 {
        return (None, None);
    }
    let m = values.iter().sum::<f64>() / values.len() as f64;
    let var = values.iter().map(|v| (v - m).powi(2)).sum::<f64>() / (values.len() - 1) as f64;
    (Some(m), Some(var.sqrt()))
}

fn latest_mean_metric(
    physio: &[&PhysiologicalObservation],
    metric_type: PhysiologicalMetricType,
    required_hrv_method: Option<HrvMethod>,
) -> Option<f64> {
    let (sum, count) = physio
        .iter()
        .filter(|p| {
            p.metric_type == metric_type
                && required_hrv_method.is_none_or(|method| p.hrv_method == method)
        })
        .fold((0.0, 0), |(sum, count), sample| {
            (sum + sample.value, count + 1)
        });
    (count > 0).then(|| sum / f64::from(count))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::health::models::HealthProviderId;
    use crate::health::time::parse_timestamp_with_offset;

    #[tokio::test]
    async fn assessment_telemetry_requires_current_final_grades() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(r#"
          CREATE TABLE assessment_blueprints (id TEXT, title TEXT, plan_id TEXT);
          CREATE TABLE assessment_blueprint_revisions (id TEXT, blueprint_id TEXT);
          CREATE TABLE exam_attempts (id TEXT, blueprint_revision_id TEXT, mode TEXT, started_at TEXT,
            completed_at TEXT, submitted_at TEXT, awarded_points REAL, maximum_points REAL,
            status TEXT, question_revision_ids_json TEXT);
          CREATE TABLE exam_response_submissions (id TEXT, attempt_id TEXT, response_id TEXT, ordinal INTEGER);
          CREATE TABLE exam_grades (response_submission_id TEXT, question_revision_id TEXT, is_current INTEGER,
            state TEXT, points REAL);
          INSERT INTO assessment_blueprints VALUES ('bp','Paper','p');
          INSERT INTO assessment_blueprint_revisions VALUES ('revision','bp');
          INSERT INTO exam_attempts VALUES
           ('completed','revision','exam','2026-11-01T12:00:00Z',NULL,NULL,2.0,2.0,'complete','["q"]'),
           ('superseded','revision','practice','2026-11-01T14:00:00Z',NULL,NULL,2.0,2.0,'complete','["q"]');
          INSERT INTO exam_response_submissions VALUES
           ('s1','completed','r1',1),('s2','superseded','r2',1),('s3','superseded','r2',2);
          INSERT INTO exam_grades VALUES
           ('s1','q',1,'final',2.0),('s2','q',1,'final',2.0),('s3','q',1,'needs-review',NULL);
        "#).execute(&pool).await.unwrap();
        let snapshot = load_learning_telemetry(&pool, None, None).await.unwrap();
        assert_eq!(snapshot.assessments.len(), 1);
        assert_eq!(snapshot.assessments[0].attempt_id, "completed");
    }

    #[test]
    fn fsrs_replay_excludes_first_review_and_prevents_future_leakage() {
        let base_ms = parse_timestamp_with_offset("2026-11-01T10:00:00Z")
            .unwrap()
            .0;
        let reviews_a = vec![
            RawReviewEvent {
                id: "r1".into(),
                item_id: "card1".into(),
                rating: 3,
                time_taken_secs: 4,
                reviewed_at_ms: base_ms,
                base_difficulty: 3.0,
                document_id: None,
                tags: vec![],
                plan_ids: vec![],
            },
            RawReviewEvent {
                id: "r2".into(),
                item_id: "card1".into(),
                rating: 3,
                time_taken_secs: 5,
                reviewed_at_ms: base_ms + 43_200_000,
                base_difficulty: 3.0,
                document_id: None,
                tags: vec![],
                plan_ids: vec![],
            },
            RawReviewEvent {
                id: "r3".into(),
                item_id: "card1".into(),
                rating: 3, // Good on r3 vs Again on r3 below
                time_taken_secs: 6,
                reviewed_at_ms: base_ms + 3 * 86_400_000,
                base_difficulty: 3.0,
                document_id: None,
                tags: vec![],
                plan_ids: vec![],
            },
        ];
        let mut reviews_b = reviews_a.clone();
        reviews_b[2].rating = 1; // Change ONLY future review r3 to Again

        let rep_a = replay_reviews_fsrs7(&reviews_a).unwrap();
        let rep_b = replay_reviews_fsrs7(&reviews_b).unwrap();

        // First review has no prior retrievability prediction.
        assert!(rep_a[0].predicted_retrievability.is_none());
        let fsrs = create_fsrs7().unwrap();
        let initial = next_states_fractional(&fsrs, None, 0.9, 0.0).unwrap();
        let initial = from_fsrs_memory_state(&initial.good.memory);
        assert_eq!(
            rep_a[1].predicted_retrievability,
            current_retrievability(&initial, 0.5)
        );
        let next = next_states_fractional(&fsrs, Some(&initial), 0.9, 0.5).unwrap();
        let next = from_fsrs_memory_state(&next.good.memory);
        assert_eq!(
            rep_a[2].predicted_retrievability,
            current_retrievability(&next, 2.5)
        );
        // r2 prediction MUST be completely identical regardless of r3 rating (zero leakage).
        assert_eq!(
            rep_a[1].predicted_retrievability,
            rep_b[1].predicted_retrievability
        );
        assert_eq!(
            rep_a[2].predicted_retrievability,
            rep_b[2].predicted_retrievability
        );
        // Only the observed residual on r3 itself differs (+ vs -).
        assert!(rep_a[2].fsrs_residual.unwrap() > 0.0);
        assert!(rep_b[2].fsrs_residual.unwrap() < 0.0);
    }

    #[test]
    fn early_morning_review_does_not_join_upcoming_sleep() {
        let sleep_start = parse_timestamp_with_offset("2026-11-20T02:00:00Z")
            .unwrap()
            .0;
        let sleep_end = parse_timestamp_with_offset("2026-11-20T10:00:00Z")
            .unwrap()
            .0;
        let study_0130 = parse_timestamp_with_offset("2026-11-20T01:30:00Z")
            .unwrap()
            .0;

        let ep = CanonicalSleepEpisode {
            id: "upcoming-sleep".into(),
            primary_raw_session_id: "raw-u".into(),
            primary_provider_id: HealthProviderId::Manual,
            start_at_ms: sleep_start,
            end_at_ms: sleep_end,
            start_tz_offset_secs: Some(0),
            end_tz_offset_secs: Some(0),
            anchor_local_date: "2026-11-20".into(),
            sleep_kind: SleepKind::MainSleep,
            user_sleep_kind_override: None,
            total_sleep_mins: 480.0,
            time_in_bed_mins: Some(490.0),
            sleep_efficiency_pct: Some(98.0),
            waso_mins: None,
            stage_coverage_ratio: 0.0,
            awake_mins: None,
            light_mins: None,
            deep_mins: None,
            rem_mins: None,
            has_source_conflict: false,
            conflict_duration_diff_mins: None,
            quality_flags: vec![],
            is_synthetic: true,
            stages: vec![],
            members: vec![],
        };
        let rev = ReplayedReview {
            id: "rev1".into(),
            item_id: "i1".into(),
            reviewed_at_ms: study_0130,
            rating: 3,
            recalled: 1.0,
            predicted_retrievability: Some(0.9),
            fsrs_residual: Some(0.1),
            item_difficulty: 3.0,
            latency_secs: 4.0,
            log_latency: 4.0_f64.ln(),
            item_latency_z: None,
            document_id: None,
            plan_ids: vec![],
        };

        let sessions =
            build_comparable_sessions(&[rev], &[ep], &[], &[], None, None, None, Some(0));
        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].preceding_main_sleep_id.is_none());
    }
}
