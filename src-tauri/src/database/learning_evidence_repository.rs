//! Learning Evidence, Mastery Summaries, Knowledge Gaps, and Remediation Repository.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§8, 9, 11
//! - openspec/planning/study-plans-assessments-program/04-DATA-AND-MIGRATION-PLAN.md §7
//! - openspec/changes/derive-study-gaps-from-exam-evidence/ (C6-T04)

use crate::models::learning_evidence::*;
use crate::models::study_source::StudyCommandError;
use chrono::{DateTime, Utc};
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

#[derive(Clone)]
pub struct LearningEvidenceRepository {
    pool: Pool<Sqlite>,
}

impl LearningEvidenceRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    /// Transactional record evidence for a grade.
    /// Only processes current, final grades.
    pub async fn record_evidence_for_grade_tx(
        tx: &mut Transaction<'_, Sqlite>,
        grade_id: &str,
    ) -> Result<Vec<String>, StudyCommandError> {
        let now = Utc::now().to_rfc3339();

        // 1. Fetch grade details
        let grade_row = sqlx::query(
            "SELECT g.id, g.response_submission_id, g.question_revision_id, g.origin, g.state,
                    g.points, g.max_points, g.assessment_json, g.is_current,
                    s.attempt_id, s.kind as submission_kind, s.mark, s.hint_level,
                    s.response_json, s.created_at as submission_time,
                    a.mode as attempt_mode,
                    b.plan_id,
                    bpr.config_json as blueprint_config
             FROM exam_grades g
             JOIN exam_response_submissions s ON s.id = g.response_submission_id
             JOIN exam_attempts a ON a.id = s.attempt_id
             JOIN assessment_blueprint_revisions bpr ON bpr.id = a.blueprint_revision_id
             LEFT JOIN assessment_blueprints b ON b.id = bpr.blueprint_id
             WHERE g.id = ?1",
        )
        .bind(grade_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to fetch grade for evidence: {}", e))
        })?;

        let row = match grade_row {
            Some(r) => r,
            None => return Ok(vec![]),
        };

        let is_current: i64 = row.get("is_current");
        let state: String = row.get("state");
        if is_current != 1 || state != "final" {
            // Noncurrent, failed, or needs-review grades are excluded from evidence
            return Ok(vec![]);
        }

        // Unverified model-only practice and self-checks carry the
        // `model-only` knowledge policy on their blueprint revision. They
        // never enter demonstrated evidence, even when structurally valid and
        // correctly graded.
        if let Ok(Some(config_json)) = row.try_get::<Option<String>, _>("blueprint_config") {
            if let Ok(config) = serde_json::from_str::<serde_json::Value>(&config_json) {
                if config.get("knowledgePolicy").and_then(|v| v.as_str()) == Some("model-only") {
                    return Ok(vec![]);
                }
            }
        }

        let submission_id: String = row.get("response_submission_id");
        let question_revision_id: String = row.get("question_revision_id");
        let grader_origin: String = row.get("origin");
        let points: Option<f64> = row
            .try_get("points")
            .or_else(|_| {
                row.try_get::<Option<i64>, _>("points")
                    .map(|opt| opt.map(|i| i as f64))
            })
            .unwrap_or(None);
        let max_points: f64 = row
            .try_get("max_points")
            .or_else(|_| row.try_get::<i64, _>("max_points").map(|i| i as f64))
            .unwrap_or(1.0);
        let assessment_json: Option<String> = row.get("assessment_json");
        let attempt_id: String = row.get("attempt_id");
        let submission_kind: String = row.get("submission_kind");
        let mark: String = row.get("mark");
        let hint_level: i64 = row.get("hint_level");
        let response_json_str: String = row.get("response_json");
        let occurred_at: String = row.get("submission_time");
        let attempt_mode: String = row.get("attempt_mode");
        let plan_id: Option<String> = row.get("plan_id");

        // Source kind
        let source_kind = if attempt_mode == "diagnostic" {
            "diagnostic-final"
        } else if submission_kind == "practice-check" {
            "practice-check"
        } else {
            "exam-final"
        };

        // Score
        let observed_score = if mark == "unanswered" || mark == "skipped" {
            Some(0.0)
        } else {
            points.map(|p| (p / max_points).clamp(0.0, 1.0))
        };

        // Misconception
        let mut misconception: Option<String> = None;
        if let Some(ref a_json) = assessment_json {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(a_json) {
                if let Some(misc_str) = val.get("misconception").and_then(|v| v.as_str()) {
                    if !misc_str.trim().is_empty() {
                        misconception = Some(misc_str.trim().to_string());
                    }
                }
            }
        }

        // Outcome
        let outcome = if mark == "unanswered" {
            "unanswered"
        } else if mark == "skipped" {
            "skipped"
        } else if misconception.is_some() {
            "misconception"
        } else if let Some(score) = observed_score {
            if score >= 0.75 {
                "correct"
            } else if score > 0.0 {
                "partial"
            } else {
                "incorrect"
            }
        } else {
            "incorrect"
        };

        // Learner confidence
        let learner_confidence = if mark == "unanswered" || mark == "skipped" {
            None
        } else if let Ok(val) = serde_json::from_str::<serde_json::Value>(&response_json_str) {
            val.get("confidence").and_then(|c| c.as_f64())
        } else {
            None
        };

        // Question fingerprint
        let q_fingerprint: Option<String> = sqlx::query_scalar(
            "SELECT fingerprint FROM assessment_question_revisions WHERE id = ?1",
        )
        .bind(&question_revision_id)
        .fetch_optional(&mut **tx)
        .await
        .unwrap_or(None);

        // Fetch targets
        let targets = sqlx::query(
            "SELECT concept_id, concept_label, node_id
             FROM assessment_question_targets
             WHERE question_revision_id = ?1
             ORDER BY ordinal ASC",
        )
        .bind(&question_revision_id)
        .fetch_all(&mut **tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to fetch question targets: {}", e))
        })?;

        let mut affected_concepts = Vec::new();

        for target in targets {
            let raw_concept_id: Option<String> = target.get("concept_id");
            let concept_label: String = target.get("concept_label");
            let node_id: Option<String> = target.get("node_id");

            let concept_id = match raw_concept_id {
                Some(ref id) if !id.trim().is_empty() => id.clone(),
                _ => {
                    if !concept_label.trim().is_empty() {
                        format!(
                            "concept:{}",
                            concept_label.trim().to_lowercase().replace(' ', "_")
                        )
                    } else {
                        continue;
                    }
                }
            };

            let evidence_id = format!("ev_{}", Uuid::new_v4().simple());
            let evidence_group_id = format!("{}:{}", attempt_id, concept_id);

            sqlx::query(
                "INSERT INTO learning_evidence (
                    id, concept_id, concept_label, plan_id, node_id, source_kind, source_id, grade_id,
                    evidence_group_id, question_fingerprint, observed_score, outcome, misconception,
                    learner_confidence, hint_level, grader_origin, occurred_at, policy_version, created_at, updated_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                    ?9, ?10, ?11, ?12, ?13,
                    ?14, ?15, ?16, ?17, 'evidence-v1', ?18, ?18
                )
                ON CONFLICT(source_kind, source_id, concept_id) DO UPDATE SET
                    grade_id = excluded.grade_id,
                    observed_score = excluded.observed_score,
                    outcome = excluded.outcome,
                    misconception = excluded.misconception,
                    learner_confidence = excluded.learner_confidence,
                    hint_level = excluded.hint_level,
                    grader_origin = excluded.grader_origin,
                    updated_at = excluded.updated_at",
            )
            .bind(&evidence_id)
            .bind(&concept_id)
            .bind(&concept_label)
            .bind(&plan_id)
            .bind(&node_id)
            .bind(source_kind)
            .bind(&submission_id)
            .bind(grade_id)
            .bind(&evidence_group_id)
            .bind(&q_fingerprint)
            .bind(observed_score)
            .bind(outcome)
            .bind(&misconception)
            .bind(learner_confidence)
            .bind(hint_level)
            .bind(&grader_origin)
            .bind(&occurred_at)
            .bind(&now)
            .execute(&mut **tx)
            .await
            .map_err(|e| {
                StudyCommandError::storage_failed(format!("Failed to upsert learning evidence: {}", e))
            })?;

            affected_concepts.push(concept_id);
        }

        if !affected_concepts.is_empty() {
            Self::recompute_concepts_tx(tx, &affected_concepts, plan_id.as_deref()).await?;
        }

        Ok(affected_concepts)
    }

    /// Pure evidence-v1 recompute for affected concepts.
    pub async fn recompute_concepts_tx(
        tx: &mut Transaction<'_, Sqlite>,
        concept_ids: &[String],
        plan_id: Option<&str>,
    ) -> Result<(), StudyCommandError> {
        let now_dt = Utc::now();
        let now_iso = now_dt.to_rfc3339();

        for concept_id in concept_ids {
            let evidence_rows = sqlx::query(
                "SELECT id, concept_label, plan_id, node_id, source_kind, source_id, grade_id,
                        evidence_group_id, question_fingerprint, observed_score, outcome,
                        misconception, learner_confidence, hint_level, grader_origin, occurred_at
                 FROM learning_evidence
                 WHERE concept_id = ?1
                 ORDER BY occurred_at ASC",
            )
            .bind(concept_id)
            .fetch_all(&mut **tx)
            .await
            .map_err(|e| {
                StudyCommandError::storage_failed(format!(
                    "Failed to fetch evidence for recompute: {}",
                    e
                ))
            })?;

            if evidence_rows.is_empty() {
                // Delete existing summary and resolve any active gaps
                sqlx::query("DELETE FROM learning_concept_summaries WHERE concept_id = ?1")
                    .bind(concept_id)
                    .execute(&mut **tx)
                    .await
                    .ok();

                sqlx::query(
                    "UPDATE learning_gaps SET status = 'resolved', updated_at = ?1
                     WHERE concept_id = ?2 AND status = 'active'",
                )
                .bind(&now_iso)
                .bind(concept_id)
                .execute(&mut **tx)
                .await
                .ok();

                continue;
            }

            let concept_label: String = evidence_rows[0].get("concept_label");

            // Group evidence by (evidence_group_id, utc_date)
            struct GroupAccumulator {
                group_id: String,
                utc_date: String,
                scores: Vec<f64>,
                kinds: Vec<String>,
                hint_levels: Vec<i64>,
                origins: Vec<String>,
                occurred_at: String,
                fingerprints: Vec<String>,
                misconceptions: Vec<String>,
            }

            let mut group_map: HashMap<(String, String), GroupAccumulator> = HashMap::new();
            let mut all_evidence_ids = Vec::new();
            let mut distinct_sessions = HashSet::new();
            let mut distinct_days = HashSet::new();
            let mut distinct_fingerprints = HashSet::new();
            let mut min_observed: Option<f64> = None;
            let mut max_observed: Option<f64> = None;
            let mut latest_evidence_at: Option<String> = None;
            let mut has_low_confidence = false;
            let mut has_high_confidence_error = false;
            let mut seen_fingerprints_before = HashSet::new();
            let mut any_same_question_rep = false;
            let mut any_hints = false;
            let mut any_ai = false;
            let mut has_deterministic_or_manual = false;

            for r in &evidence_rows {
                let ev_id: String = r.get("id");
                let group_id: String = r.get("evidence_group_id");
                let occurred_at: String = r.get("occurred_at");
                let utc_date = occurred_at.chars().take(10).collect::<String>();
                let score: Option<f64> = r
                    .try_get("observed_score")
                    .or_else(|_| {
                        r.try_get::<Option<i64>, _>("observed_score")
                            .map(|opt| opt.map(|i| i as f64))
                    })
                    .unwrap_or(None);
                let kind: String = r.get("source_kind");
                let hint_level: i64 = r.get("hint_level");
                let origin: String = r.get("grader_origin");
                let fp: Option<String> = r.get("question_fingerprint");
                let misc: Option<String> = r.get("misconception");
                let conf: Option<f64> = r
                    .try_get("learner_confidence")
                    .or_else(|_| {
                        r.try_get::<Option<i64>, _>("learner_confidence")
                            .map(|opt| opt.map(|i| i as f64))
                    })
                    .unwrap_or(None);

                all_evidence_ids.push(ev_id);
                distinct_sessions.insert(group_id.clone());
                distinct_days.insert(utc_date.clone());

                if let Some(ref f) = fp {
                    distinct_fingerprints.insert(f.clone());
                }

                if let Some(s) = score {
                    min_observed = Some(min_observed.map_or(s, |m| m.min(s)));
                    max_observed = Some(max_observed.map_or(s, |m| m.max(s)));

                    if let Some(c) = conf {
                        if c <= 0.3 {
                            has_low_confidence = true;
                        }
                        if c >= 0.9 && s < 0.6 {
                            has_high_confidence_error = true;
                        }
                    }
                }

                if latest_evidence_at
                    .as_ref()
                    .map_or(true, |lat| &occurred_at > lat)
                {
                    latest_evidence_at = Some(occurred_at.clone());
                }

                let key = (group_id.clone(), utc_date.clone());
                let entry = group_map.entry(key).or_insert_with(|| GroupAccumulator {
                    group_id: group_id.clone(),
                    utc_date: utc_date.clone(),
                    scores: Vec::new(),
                    kinds: Vec::new(),
                    hint_levels: Vec::new(),
                    origins: Vec::new(),
                    occurred_at: occurred_at.clone(),
                    fingerprints: Vec::new(),
                    misconceptions: Vec::new(),
                });

                if let Some(s) = score {
                    entry.scores.push(s);
                }
                entry.kinds.push(kind);
                entry.hint_levels.push(hint_level);
                entry.origins.push(origin);
                if let Some(f) = fp {
                    entry.fingerprints.push(f);
                }
                if let Some(m) = misc {
                    entry.misconceptions.push(m);
                }
            }

            // Sort groups chronologically
            let mut sorted_groups: Vec<GroupAccumulator> = group_map.into_values().collect();
            sorted_groups.sort_by(|a, b| a.occurred_at.cmp(&b.occurred_at));

            let mut weighted_score_sum = 0.0;
            let mut weight_sum = 0.0;
            let mut group_scores = Vec::new();
            let mut group_misconceptions = Vec::new();

            for grp in &sorted_groups {
                if grp.scores.is_empty() {
                    continue;
                }
                let group_mean = grp.scores.iter().sum::<f64>() / grp.scores.len() as f64;
                group_scores.push(group_mean);
                group_misconceptions.push(!grp.misconceptions.is_empty());

                // Base weight
                let has_exam = grp
                    .kinds
                    .iter()
                    .any(|k| k == "exam-final" || k == "diagnostic-final");
                let base_weight = if has_exam {
                    1.0
                } else if grp.hint_levels.iter().all(|&h| h == 0) {
                    0.75
                } else {
                    0.5
                };

                let all_ai = grp.origins.iter().all(|o| o == "ai");
                let ai_multiplier = if all_ai {
                    any_ai = true;
                    0.75
                } else {
                    if grp
                        .origins
                        .iter()
                        .any(|o| o == "deterministic" || o == "manual")
                    {
                        has_deterministic_or_manual = true;
                    }
                    1.0
                };

                if grp.hint_levels.iter().any(|&h| h > 0) {
                    any_hints = true;
                }

                // Recency: 0.5^(ageDays / 90)
                let group_dt = DateTime::parse_from_rfc3339(&grp.occurred_at)
                    .map(|d| d.with_timezone(&Utc))
                    .unwrap_or(now_dt);
                let age_days = (now_dt - group_dt).num_days().max(0);
                let recency_multiplier = 0.5_f64.powf(age_days as f64 / 90.0);

                // Repeat multiplier
                let mut repeat_multiplier = 1.0;
                for f in &grp.fingerprints {
                    if seen_fingerprints_before.contains(f) {
                        repeat_multiplier = 0.25;
                        any_same_question_rep = true;
                        break;
                    }
                }
                for f in &grp.fingerprints {
                    seen_fingerprints_before.insert(f.clone());
                }

                let final_group_weight =
                    base_weight * ai_multiplier * recency_multiplier * repeat_multiplier;
                weighted_score_sum += group_mean * final_group_weight;
                weight_sum += final_group_weight;
            }

            let observed_mean = if weight_sum > 0.0 {
                Some(weighted_score_sum / weight_sum)
            } else {
                None
            };

            let independent_sessions = distinct_sessions.len() as i64;
            let distinct_days_count = distinct_days.len() as i64;
            let distinct_fp_count = distinct_fingerprints.len() as i64;

            let latest_two_failing = if group_scores.len() >= 2 {
                let len = group_scores.len();
                group_scores[len - 1] < 0.6 && group_scores[len - 2] < 0.6
            } else {
                false
            };

            let latest_two_succeeding = if group_scores.len() >= 2 {
                let len = group_scores.len();
                group_scores[len - 1] >= 0.8 && group_scores[len - 2] >= 0.8
            } else {
                false
            };

            let latest_three_succeeding = if group_scores.len() >= 3 {
                let len = group_scores.len();
                group_scores[len - 1] >= 0.8
                    && group_scores[len - 2] >= 0.8
                    && group_scores[len - 3] >= 0.8
            } else {
                false
            };

            let unresolved_latest_misconception =
                group_misconceptions.last().copied().unwrap_or(false);

            let level = if independent_sessions < 2 || weight_sum == 0.0 || observed_mean.is_none()
            {
                "insufficient-evidence"
            } else if latest_two_failing
                || unresolved_latest_misconception
                || observed_mean.unwrap_or(0.0) < 0.6
            {
                "needs-attention"
            } else if independent_sessions >= 3
                && distinct_days_count >= 2
                && distinct_fp_count >= 3
                && latest_three_succeeding
                && !unresolved_latest_misconception
                && has_deterministic_or_manual
            {
                "demonstrated-consistently"
            } else {
                "developing"
            };

            // Derive uncertainty reasons
            let mut uncertainty = Vec::new();
            if group_scores.is_empty() {
                uncertainty.push("no-assessment".to_string());
            }
            if independent_sessions < 3 {
                uncertainty.push("few-independent-sessions".to_string());
            }
            if any_same_question_rep {
                uncertainty.push("same-question-repetition".to_string());
            }
            if any_ai {
                uncertainty.push("ai-graded".to_string());
            }
            if any_hints {
                uncertainty.push("hints-used".to_string());
            }
            if let (Some(min_s), Some(max_s)) = (min_observed, max_observed) {
                if max_s - min_s >= 0.4 {
                    uncertainty.push("conflicting-outcomes".to_string());
                }
            }
            if let Some(ref lat) = latest_evidence_at {
                if let Ok(lat_dt) = DateTime::parse_from_rfc3339(lat) {
                    if (now_dt - lat_dt.with_timezone(&Utc)).num_days() > 90 {
                        uncertainty.push("stale-evidence".to_string());
                    }
                }
            }
            if has_low_confidence {
                uncertainty.push("low-learner-confidence".to_string());
            }
            if has_high_confidence_error {
                uncertainty.push("high-confidence-error".to_string());
            }

            let stats_val = serde_json::json!({
                "observedMean": observed_mean,
                "evidenceWeight": weight_sum,
                "independentSessions": independent_sessions,
                "distinctDays": distinct_days_count,
                "minimumObserved": min_observed,
                "maximumObserved": max_observed,
                "latestEvidenceAt": latest_evidence_at,
                "uncertainty": uncertainty,
            });
            let stats_json = serde_json::to_string(&stats_val).unwrap_or_default();
            let evidence_ids_json = serde_json::to_string(&all_evidence_ids).unwrap_or_default();
            let evidence_cutoff = latest_evidence_at
                .clone()
                .unwrap_or_else(|| now_iso.clone());

            // Upsert concept summary
            sqlx::query(
                "INSERT INTO learning_concept_summaries (
                    concept_id, concept_label, policy_version, evidence_cutoff, level,
                    stats_json, evidence_ids_json, computed_at
                ) VALUES (?1, ?2, 'evidence-v1', ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(concept_id) DO UPDATE SET
                    concept_label = excluded.concept_label,
                    evidence_cutoff = excluded.evidence_cutoff,
                    level = excluded.level,
                    stats_json = excluded.stats_json,
                    evidence_ids_json = excluded.evidence_ids_json,
                    computed_at = excluded.computed_at",
            )
            .bind(concept_id)
            .bind(&concept_label)
            .bind(&evidence_cutoff)
            .bind(level)
            .bind(&stats_json)
            .bind(&evidence_ids_json)
            .bind(&now_iso)
            .execute(&mut **tx)
            .await
            .map_err(|e| {
                StudyCommandError::storage_failed(format!(
                    "Failed to upsert concept summary: {}",
                    e
                ))
            })?;

            // Evaluate Gap Rules
            // Rule 1: assessment-repeated-failure-v1
            let rule_id = "assessment-repeated-failure-v1";
            let kind = "repeatedly_failed";

            let existing_gap = sqlx::query(
                "SELECT id, status, evidence_cutoff FROM learning_gaps
                 WHERE concept_id = ?1 AND kind = ?2 AND rule_id = ?3",
            )
            .bind(concept_id)
            .bind(kind)
            .bind(rule_id)
            .fetch_optional(&mut **tx)
            .await
            .ok()
            .flatten();

            if latest_two_failing {
                let should_activate = match &existing_gap {
                    None => true,
                    Some(row) => {
                        let status: String = row.get("status");
                        let cutoff: String = row.get("evidence_cutoff");
                        if status == "dismissed" {
                            // Re-surface only if new evidence arrived after cutoff
                            evidence_cutoff > cutoff
                        } else {
                            true
                        }
                    }
                };

                if should_activate {
                    let gap_id = match &existing_gap {
                        Some(row) => row.get("id"),
                        None => format!("gap_{}", Uuid::new_v4().simple()),
                    };

                    sqlx::query(
                        "INSERT INTO learning_gaps (
                            id, concept_id, concept_label, plan_id, node_id, kind, rule_id,
                            status, first_detected_at, last_detected_at, evidence_cutoff, created_at, updated_at
                        ) VALUES (
                            ?1, ?2, ?3, ?4, NULL, ?5, ?6,
                            'active', ?7, ?7, ?8, ?7, ?7
                        )
                        ON CONFLICT(concept_id, kind, rule_id) DO UPDATE SET
                            status = 'active',
                            last_detected_at = excluded.last_detected_at,
                            evidence_cutoff = excluded.evidence_cutoff,
                            updated_at = excluded.updated_at",
                    )
                    .bind(&gap_id)
                    .bind(concept_id)
                    .bind(&concept_label)
                    .bind(plan_id)
                    .bind(kind)
                    .bind(rule_id)
                    .bind(&now_iso)
                    .bind(&evidence_cutoff)
                    .execute(&mut **tx)
                    .await
                    .ok();

                    // Upsert gap evidence
                    for ev_id in &all_evidence_ids {
                        sqlx::query(
                            "INSERT OR IGNORE INTO learning_gap_evidence (
                                gap_id, evidence_id, record_id, kind, description, source_ref_id, payload_json
                            ) VALUES (?1, ?2, ?3, 'assessment', 'Repeated failure on concept', NULL, '{}')",
                        )
                        .bind(&gap_id)
                        .bind(ev_id)
                        .bind(ev_id)
                        .execute(&mut **tx)
                        .await
                        .ok();
                    }

                    // Upsert standard remediations for repeatedly_failed
                    for r_kind in &["open-source", "targeted-practice", "follow-up-exam"] {
                        let rem_id = format!("rem_{}", Uuid::new_v4().simple());
                        let payload = serde_json::json!({
                            "conceptId": concept_id,
                            "planId": plan_id,
                            "evidenceSummary": format!("Repeated failure observed across recent sessions on {}", concept_label)
                        });
                        sqlx::query(
                            "INSERT INTO learning_remediations (
                                id, gap_id, kind, status, source_ref_ids_json, payload_json, created_at, updated_at
                            ) VALUES (?1, ?2, ?3, 'suggested', '[]', ?4, ?5, ?5)
                            ON CONFLICT(gap_id, kind) DO NOTHING",
                        )
                        .bind(&rem_id)
                        .bind(&gap_id)
                        .bind(r_kind)
                        .bind(serde_json::to_string(&payload).unwrap_or_default())
                        .bind(&now_iso)
                        .execute(&mut **tx)
                        .await
                        .ok();
                    }
                }
            } else if latest_two_succeeding && !unresolved_latest_misconception {
                // Resolution condition
                if let Some(row) = &existing_gap {
                    let status: String = row.get("status");
                    if status == "active" {
                        let gap_id: String = row.get("id");
                        sqlx::query(
                            "UPDATE learning_gaps SET status = 'resolved', updated_at = ?1 WHERE id = ?2",
                        )
                        .bind(&now_iso)
                        .bind(&gap_id)
                        .execute(&mut **tx)
                        .await
                        .ok();
                    }
                }
            }
        }

        Ok(())
    }

    /// Reconciles learning evidence from current final exam grades.
    pub async fn reconcile_learning_evidence(
        &self,
        after_grade_id: Option<&str>,
        batch_limit: i64,
    ) -> Result<LearningEvidenceReconcileResult, StudyCommandError> {
        let limit = batch_limit.clamp(1, 100);

        let mut tx = self.pool.begin().await.map_err(|e| {
            StudyCommandError::storage_failed(format!(
                "Failed to begin reconcile transaction: {}",
                e
            ))
        })?;

        let candidate_grades = sqlx::query(
            "SELECT id FROM exam_grades
             WHERE is_current = 1 AND state = 'final'
               AND (?1 IS NULL OR id > ?1)
             ORDER BY id ASC
             LIMIT ?2",
        )
        .bind(after_grade_id)
        .bind(limit + 1)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!(
                "Failed to fetch grades for reconcile: {}",
                e
            ))
        })?;

        let has_more = candidate_grades.len() as i64 > limit;
        let process_count = candidate_grades.len().min(limit as usize);
        let mut last_processed_id: Option<String> = None;

        for i in 0..process_count {
            let gid: String = candidate_grades[i].get("id");
            Self::record_evidence_for_grade_tx(&mut tx, &gid).await?;
            last_processed_id = Some(gid);
        }

        let remaining: i64 = if has_more {
            let total_remaining: (i64,) = sqlx::query_as(
                "SELECT count(*) FROM exam_grades
                 WHERE is_current = 1 AND state = 'final'
                   AND id > ?1",
            )
            .bind(&last_processed_id)
            .fetch_one(&mut *tx)
            .await
            .unwrap_or((0,));
            total_remaining.0
        } else {
            0
        };

        tx.commit().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to commit reconcile: {}", e))
        })?;

        Ok(LearningEvidenceReconcileResult {
            processed: process_count as i64,
            remaining,
            next_after_grade_id: if has_more { last_processed_id } else { None },
            completed: !has_more,
        })
    }

    /// Queries ConceptMasterySummary for a concept.
    pub async fn get_concept_mastery_summary(
        &self,
        concept_id: &str,
    ) -> Result<ConceptMasterySummary, StudyCommandError> {
        let row = sqlx::query(
            "SELECT concept_id, level, stats_json, evidence_ids_json, policy_version
             FROM learning_concept_summaries
             WHERE concept_id = ?1",
        )
        .bind(concept_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!(
                "Failed to fetch concept mastery summary: {}",
                e
            ))
        })?;

        match row {
            Some(r) => {
                let stats_json: String = r.get("stats_json");
                let stats: serde_json::Value =
                    serde_json::from_str(&stats_json).unwrap_or_default();
                let evidence_ids_json: String = r.get("evidence_ids_json");
                let evidence_ids: Vec<String> =
                    serde_json::from_str(&evidence_ids_json).unwrap_or_default();

                Ok(ConceptMasterySummary {
                    concept_id: r.get("concept_id"),
                    level: r.get("level"),
                    observed_mean: stats.get("observedMean").and_then(|v| v.as_f64()),
                    evidence_weight: stats
                        .get("evidenceWeight")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0),
                    independent_sessions: stats
                        .get("independentSessions")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0),
                    distinct_days: stats
                        .get("distinctDays")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0),
                    minimum_observed: stats.get("minimumObserved").and_then(|v| v.as_f64()),
                    maximum_observed: stats.get("maximumObserved").and_then(|v| v.as_f64()),
                    latest_evidence_at: stats
                        .get("latestEvidenceAt")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    uncertainty: stats
                        .get("uncertainty")
                        .and_then(|v| serde_json::from_value(v.clone()).ok())
                        .unwrap_or_default(),
                    evidence_ids,
                    policy_version: r.get("policy_version"),
                })
            }
            None => Ok(ConceptMasterySummary {
                concept_id: concept_id.to_string(),
                level: "insufficient-evidence".to_string(),
                observed_mean: None,
                evidence_weight: 0.0,
                independent_sessions: 0,
                distinct_days: 0,
                minimum_observed: None,
                maximum_observed: None,
                latest_evidence_at: None,
                uncertainty: vec!["no-assessment".to_string()],
                evidence_ids: vec![],
                policy_version: "evidence-v1".to_string(),
            }),
        }
    }

    /// Queries PlanEvidenceSummary.
    pub async fn get_study_plan_evidence(
        &self,
        plan_id: &str,
    ) -> Result<PlanEvidenceSummary, StudyCommandError> {
        let version_id: Option<String> =
            sqlx::query_scalar("SELECT current_version_id FROM study_plans WHERE id = ?1")
                .bind(plan_id)
                .fetch_optional(&self.pool)
                .await
                .unwrap_or(None);

        let version_id = version_id.unwrap_or_default();

        let nodes = sqlx::query(
            "SELECT node_id, concept_id FROM study_plan_version_nodes
             WHERE version_id = ?1 AND included = 1",
        )
        .bind(&version_id)
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default();

        let mut node_progresses = Vec::new();
        for node in nodes {
            let nid: String = node.get("node_id");
            let cid: Option<String> = node.get("concept_id");
            let summary = if let Some(ref c) = cid {
                self.get_concept_mastery_summary(c).await.ok()
            } else {
                None
            };

            node_progresses.push(NodeLearningProgress {
                node_id: nid,
                activity: serde_json::json!("not-started"),
                content_coverage: serde_json::json!("not-computed"),
                coverage_activity: serde_json::json!("not-computed"),
                demonstrated: summary,
                source_statuses: vec![],
            });
        }

        let active_gaps: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM learning_gaps WHERE plan_id = ?1 AND status = 'active'",
        )
        .bind(plan_id)
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default();

        Ok(PlanEvidenceSummary {
            plan_id: plan_id.to_string(),
            version_id,
            nodes: node_progresses,
            active_gap_ids: active_gaps,
            computed_at: Utc::now().to_rfc3339(),
        })
    }

    /// Lists knowledge gaps for a plan or across plans.
    pub async fn list_learning_gaps(
        &self,
        plan_id: Option<&str>,
        include_dismissed: bool,
    ) -> Result<Vec<KnowledgeGapView>, StudyCommandError> {
        let gaps = sqlx::query(
            "SELECT id, concept_id, concept_label, plan_id, node_id, kind, rule_id,
                    status, first_detected_at, last_detected_at, evidence_cutoff
             FROM learning_gaps
             WHERE (?1 IS NULL OR plan_id = ?1)
               AND (?2 = 1 OR status = 'active')
             ORDER BY last_detected_at DESC",
        )
        .bind(plan_id)
        .bind(if include_dismissed { 1 } else { 0 })
        .fetch_all(&self.pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to list learning gaps: {}", e))
        })?;

        let mut views = Vec::new();
        for g in gaps {
            let gid: String = g.get("id");
            let cid: String = g.get("concept_id");

            let ev_rows = sqlx::query(
                "SELECT record_id, kind, description, evidence_id, source_ref_id, payload_json
                 FROM learning_gap_evidence
                 WHERE gap_id = ?1",
            )
            .bind(&gid)
            .fetch_all(&self.pool)
            .await
            .unwrap_or_default();

            let evidence = ev_rows
                .into_iter()
                .map(|r| {
                    let payload_json: String = r.get("payload_json");
                    GapEvidenceRecord {
                        record_id: r.get("record_id"),
                        kind: r.get("kind"),
                        description: r.get("description"),
                        learning_evidence_id: r.get("evidence_id"),
                        source_ref_id: r.get("source_ref_id"),
                        payload: serde_json::from_str(&payload_json).unwrap_or_default(),
                    }
                })
                .collect();

            let demonstrated = self.get_concept_mastery_summary(&cid).await.ok();

            views.push(KnowledgeGapView {
                id: gid,
                kind: g.get("kind"),
                concept_id: cid,
                concept_name: g.get("concept_label"),
                plan_id: g.get("plan_id"),
                node_id: g.get("node_id"),
                rule_id: g.get("rule_id"),
                status: g.get("status"),
                evidence,
                demonstrated,
                first_detected_at: g.get("first_detected_at"),
                last_detected_at: g.get("last_detected_at"),
                evidence_cutoff: g.get("evidence_cutoff"),
            });
        }

        Ok(views)
    }

    /// Dismisses a knowledge gap.
    pub async fn dismiss_learning_gap(
        &self,
        gap_id: &str,
        evidence_cutoff: &str,
    ) -> Result<(), StudyCommandError> {
        let now = Utc::now().to_rfc3339();
        let res = sqlx::query(
            "UPDATE learning_gaps
             SET status = 'dismissed', evidence_cutoff = ?1, updated_at = ?2
             WHERE id = ?3",
        )
        .bind(evidence_cutoff)
        .bind(&now)
        .bind(gap_id)
        .execute(&self.pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to dismiss learning gap: {}", e))
        })?;

        if res.rows_affected() == 0 {
            return Err(StudyCommandError::not_found(format!(
                "Gap '{}' not found",
                gap_id
            )));
        }

        Ok(())
    }

    /// Local explicit refresh of gaps for a study plan.
    pub async fn refresh_local_learning_gaps(
        &self,
        plan_id: &str,
    ) -> Result<Vec<KnowledgeGapView>, StudyCommandError> {
        let mut tx = self.pool.begin().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to begin refresh transaction: {}", e))
        })?;

        // Recompute all concepts linked to this plan
        let concepts: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT concept_id FROM learning_evidence WHERE plan_id = ?1",
        )
        .bind(plan_id)
        .fetch_all(&mut *tx)
        .await
        .unwrap_or_default();

        if !concepts.is_empty() {
            Self::recompute_concepts_tx(&mut tx, &concepts, Some(plan_id)).await?;
        }

        tx.commit().await.map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to commit gap refresh: {}", e))
        })?;

        self.list_learning_gaps(Some(plan_id), false).await
    }

    /// Gets prior evidence for a diagnostic attempt (Change 7 integration).
    /// Strict read-only adapter: asserts mode=diagnostic, status complete,
    /// all official items final. No writes, no migration.
    pub async fn get_diagnostic_prior_evidence(
        &self,
        attempt_id: &str,
    ) -> Result<CurriculumPriorEvidence, StudyCommandError> {
        let attempt_row = sqlx::query(
            "SELECT id, mode, status, blueprint_revision_id FROM exam_attempts WHERE id = ?1",
        )
        .bind(attempt_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to query diagnostic attempt: {}", e))
        })?;
        let row = attempt_row.ok_or_else(|| {
            StudyCommandError::not_found(format!("Diagnostic attempt '{}' not found", attempt_id))
        })?;
        let mode: String = row.get("mode");
        let status: String = row.get("status");
        if mode != "diagnostic" {
            return Err(StudyCommandError::invalid_state(
                "study.diagnostic.error.invalid_mode",
            ));
        }
        if status != "complete" {
            return Err(StudyCommandError::invalid_state(
                "study.diagnostic.error.incomplete_attempt",
            ));
        }
        // All official items must be final with non-null points.
        let non_final: (i64,) = sqlx::query_as(
            "SELECT count(*) FROM exam_grades g
             JOIN exam_response_submissions s ON s.id = g.response_submission_id
             WHERE s.attempt_id = ?1 AND g.is_current = 1 AND (g.state != 'final' OR g.points IS NULL)",
        )
        .bind(attempt_id)
        .fetch_one(&self.pool)
        .await
        .unwrap_or((1,));
        if non_final.0 > 0 {
            return Err(StudyCommandError::invalid_state(
                "study.diagnostic.error.missing_final_grades",
            ));
        }
        let concepts: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT concept_id FROM learning_evidence
             WHERE source_kind = 'diagnostic-final'
               AND evidence_group_id LIKE ?1",
        )
        .bind(format!("{}:%", attempt_id))
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default();
        if concepts.is_empty() {
            return Err(StudyCommandError::invalid_state(
                "study.diagnostic.error.no_evidence",
            ));
        }

        let mut concept_list = Vec::new();
        for (cid,) in concepts {
            let summary = self.get_concept_mastery_summary(&cid).await?;
            concept_list.push(CurriculumPriorEvidenceConcept {
                concept_id: cid.clone(),
                level: summary.level,
                observed_mean: summary.observed_mean,
                uncertainty: summary.uncertainty,
                evidence_group_ids: vec![format!("{}:{}", attempt_id, cid)],
            });
        }

        Ok(CurriculumPriorEvidence {
            diagnostic_attempt_id: attempt_id.to_string(),
            concepts: concept_list,
        })
    }

    /// Updates remediation disposition.
    pub async fn record_remediation_disposition(
        &self,
        recommendation_id: &str,
        status: &str,
    ) -> Result<RemediationRecommendation, StudyCommandError> {
        if !["suggested", "accepted", "dismissed", "completed"].contains(&status) {
            return Err(StudyCommandError::invalid_input("invalid_status", vec![]));
        }

        let now = Utc::now().to_rfc3339();
        let res = sqlx::query(
            "UPDATE learning_remediations
             SET status = ?1, updated_at = ?2
             WHERE id = ?3",
        )
        .bind(status)
        .bind(&now)
        .bind(recommendation_id)
        .execute(&self.pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to update remediation: {}", e))
        })?;

        if res.rows_affected() == 0 {
            return Err(StudyCommandError::not_found(format!(
                "Remediation '{}' not found",
                recommendation_id
            )));
        }

        let row = sqlx::query(
            "SELECT id, gap_id, kind, status, source_ref_ids_json, payload_json, created_at, updated_at
             FROM learning_remediations
             WHERE id = ?1",
        )
        .bind(recommendation_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| {
            StudyCommandError::storage_failed(format!("Failed to fetch updated remediation: {}", e))
        })?;

        let source_refs_json: String = row.get("source_ref_ids_json");
        let payload_json: String = row.get("payload_json");

        Ok(RemediationRecommendation {
            id: row.get("id"),
            gap_id: row.get("gap_id"),
            kind: row.get("kind"),
            status: row.get("status"),
            source_ref_ids: serde_json::from_str(&source_refs_json).unwrap_or_default(),
            payload: serde_json::from_str(&payload_json).unwrap_or_default(),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::exam_grading_repository::ExamGradingRepository;
    use crate::database::exam_session_repository::ExamSessionRepository;
    use crate::database::migrations::run_migrations;
    use crate::models::rubric_grade::RecordRubricGradeInput;

    async fn test_pool() -> Pool<Sqlite> {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open in-memory db");
        run_migrations(&pool).await.expect("apply migrations");
        pool
    }

    async fn seed_test_exam(pool: &Pool<Sqlite>) -> (String, String, String, String) {
        sqlx::query(
            "INSERT INTO concepts (id, name, normalized_name, created_at, updated_at)
             VALUES ('c_photosynthesis', 'Photosynthesis', 'photosynthesis', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')",
        )
        .execute(pool)
        .await
        .expect("insert concept");

        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified, content)
             VALUES ('doc_ev', 'Doc', '/p.pdf', 'pdf', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z', 'text')",
        )
        .execute(pool)
        .await
        .expect("insert document");

        sqlx::query(
            "INSERT INTO study_plans (id, title, goal, depth, status, current_version, revision, created_at, updated_at)
             VALUES ('plan_ev', 'Bio Plan', 'Goal', 'survey', 'active', 0, 1, '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')",
        )
        .execute(pool)
        .await
        .expect("insert study plan");

        sqlx::query(
            "INSERT INTO assessment_blueprints (id, plan_id, title, lifecycle, revision, created_at, updated_at)
             VALUES ('bp_ev', 'plan_ev', 'Bio Exam', 'active', 1, '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')",
        )
        .execute(pool)
        .await
        .expect("insert blueprint");

        sqlx::query(
            "INSERT INTO assessment_blueprint_revisions (
                id, blueprint_id, revision, state, config_json, scoring_json,
                source_scope_json, quota_json, source_snapshot_hash, created_at, published_at
            ) VALUES ('bpr_ev', 'bp_ev', 1, 'ready', '{}', '{}', '{}', '{}', 'hash', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')",
        )
        .execute(pool)
        .await
        .expect("insert blueprint revision");

        sqlx::query(
            "INSERT INTO assessment_questions (id, blueprint_id, semantic_fingerprint, created_at)
             VALUES ('q_ev1', 'bp_ev', 'fp_ev1', '2026-11-10T12:00:00Z')",
        )
        .execute(pool)
        .await
        .expect("insert question");

        sqlx::query(
            "INSERT INTO assessment_question_revisions (
                id, question_id, blueprint_revision_id, revision, slot_key, fingerprint,
                kind, payload_json, answer_key_json, max_points, difficulty, validation, committed_at, created_at
            ) VALUES ('aqr_ev1', 'q_ev1', 'bpr_ev', 1, 'slot_0', 'fp_ev1',
                      'short-answer', '{\"prompt\":\"What is photosynthesis?\"}', '{}', 4, 3, 'valid', '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')",
        )
        .execute(pool)
        .await
        .expect("insert question revision");

        sqlx::query(
            "INSERT INTO assessment_question_targets (
                question_revision_id, concept_id, concept_label, node_id, objective_text, ordinal
            ) VALUES ('aqr_ev1', 'c_photosynthesis', 'Photosynthesis', 'node_photo', 'Explain photosynthesis', 0)",
        )
        .execute(pool)
        .await
        .expect("insert question target");

        (
            "bp_ev".to_string(),
            "bpr_ev".to_string(),
            "aqr_ev1".to_string(),
            "c_photosynthesis".to_string(),
        )
    }

    async fn create_attempt_and_submission(
        pool: &Pool<Sqlite>,
        bpr_id: &str,
        q_rev_id: &str,
        att_id: &str,
        occurred_at: &str,
    ) -> (String, String) {
        sqlx::query(
            "INSERT INTO exam_attempts (
                id, blueprint_revision_id, client_start_key, mode, status,
                question_revision_ids_json, revision, started_at, maximum_points, created_at, updated_at
            ) VALUES (?1, ?2, ?3, 'exam', 'submitted', ?4, 1, ?5, 4.0, ?5, ?5)",
        )
        .bind(att_id)
        .bind(bpr_id)
        .bind(format!("start_{}", att_id))
        .bind(serde_json::to_string(&vec![q_rev_id]).unwrap())
        .bind(occurred_at)
        .execute(pool)
        .await
        .expect("insert attempt");

        let resp_id = format!("resp_{}", att_id);
        sqlx::query(
            "INSERT INTO exam_responses (
                id, attempt_id, question_revision_id, draft_json, mark, revision, last_client_mutation_id, updated_at
            ) VALUES (?1, ?2, ?3, '{\"text\":\"Answer\"}', 'answered', 1, 'mut_1', ?4)",
        )
        .bind(&resp_id)
        .bind(att_id)
        .bind(q_rev_id)
        .bind(occurred_at)
        .execute(pool)
        .await
        .expect("insert response");

        let sub_id = format!("sub_{}", att_id);
        sqlx::query(
            "INSERT INTO exam_response_submissions (
                id, response_id, attempt_id, question_revision_id, ordinal, kind,
                response_json, mark, hint_level, created_at
            ) VALUES (?1, ?2, ?3, ?4, 1, 'exam-final', '{\"text\":\"Answer\",\"confidence\":0.8}', 'answered', 0, ?5)",
        )
        .bind(&sub_id)
        .bind(&resp_id)
        .bind(att_id)
        .bind(q_rev_id)
        .bind(occurred_at)
        .execute(pool)
        .await
        .expect("insert submission");

        (resp_id, sub_id)
    }

    #[tokio::test]
    async fn test_record_evidence_and_summary_lifecycle() {
        let pool = test_pool().await;
        let (_bp_id, bpr_id, q_rev_id, concept_id) = seed_test_exam(&pool).await;
        let grading_repo = ExamGradingRepository::new(pool.clone());
        let evidence_repo = LearningEvidenceRepository::new(pool.clone());

        // 1. Create attempt 1 and grade it (Final, points = 4/4 => 1.0 score)
        let (_resp_1, sub_1) = create_attempt_and_submission(
            &pool,
            &bpr_id,
            &q_rev_id,
            "att_1",
            "2026-11-10T12:00:00Z",
        )
        .await;
        let grade_res_1 = grading_repo
            .record_rubric_grade(RecordRubricGradeInput {
                attempt_id: "att_1".to_string(),
                response_submission_id: sub_1,
                question_revision_id: q_rev_id.clone(),
                expected_attempt_revision: 1,
                origin: "ai".to_string(),
                state: "final".to_string(),
                points: Some(4.0),
                max_points: 4.0,
                outcome: Some("correct".to_string()),
                assessment_json: None,
                criteria_json: "[]".to_string(),
                provenance_json: None,
                manual_reason: None,
                job_id: None,
                step_key: None,
                lease_owner: None,
                cancellation_epoch: None,
                input_hash: None,
            })
            .await
            .expect("grade 1 succeeds");

        assert_eq!(grade_res_1.grade.state, "final");

        // Verify evidence row
        let ev_rows: Vec<(String, f64, String)> = sqlx::query_as(
            "SELECT id, observed_score, outcome FROM learning_evidence WHERE concept_id = ?1",
        )
        .bind(&concept_id)
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(ev_rows.len(), 1);
        assert!((ev_rows[0].1 - 1.0).abs() < 1e-4);
        assert_eq!(ev_rows[0].2, "correct");

        // Verify concept mastery summary: 1 session => insufficient-evidence
        let summary = evidence_repo
            .get_concept_mastery_summary(&concept_id)
            .await
            .unwrap();
        assert_eq!(summary.level, "insufficient-evidence");
        assert_eq!(summary.independent_sessions, 1);
        assert!(summary.observed_mean.is_some());

        // 2. Create attempt 2 and grade it (Final, points = 4/4)
        let (_resp_2, sub_2) = create_attempt_and_submission(
            &pool,
            &bpr_id,
            &q_rev_id,
            "att_2",
            "2026-11-11T12:00:00Z",
        )
        .await;
        let _ = grading_repo
            .record_rubric_grade(RecordRubricGradeInput {
                attempt_id: "att_2".to_string(),
                response_submission_id: sub_2,
                question_revision_id: q_rev_id.clone(),
                expected_attempt_revision: 1,
                origin: "deterministic".to_string(),
                state: "final".to_string(),
                points: Some(4.0),
                max_points: 4.0,
                outcome: Some("correct".to_string()),
                assessment_json: None,
                criteria_json: "[]".to_string(),
                provenance_json: None,
                manual_reason: None,
                job_id: None,
                step_key: None,
                lease_owner: None,
                cancellation_epoch: None,
                input_hash: None,
            })
            .await
            .expect("grade 2 succeeds");

        let summary_2 = evidence_repo
            .get_concept_mastery_summary(&concept_id)
            .await
            .unwrap();
        assert_eq!(summary_2.independent_sessions, 2);

        // 3. Delete attempt 1 -> cascades evidence, recomputes summary
        ExamSessionRepository::delete_exam_history(&pool, "att_1")
            .await
            .expect("delete succeeds");

        let remaining_ev: Vec<(String,)> =
            sqlx::query_as("SELECT id FROM learning_evidence WHERE concept_id = ?1")
                .bind(&concept_id)
                .fetch_all(&pool)
                .await
                .unwrap();

        assert_eq!(remaining_ev.len(), 1, "Evidence for att_1 must be gone");

        let summary_after_delete = evidence_repo
            .get_concept_mastery_summary(&concept_id)
            .await
            .unwrap();
        assert_eq!(summary_after_delete.independent_sessions, 1);
    }

    #[tokio::test]
    async fn test_repeated_failure_gap_and_resolution() {
        let pool = test_pool().await;
        let (_bp_id, bpr_id, q_rev_id, concept_id) = seed_test_exam(&pool).await;
        let grading_repo = ExamGradingRepository::new(pool.clone());
        let evidence_repo = LearningEvidenceRepository::new(pool.clone());

        // Attempt 1: Low score 0/4 (0.0)
        let (_resp_1, sub_1) = create_attempt_and_submission(
            &pool,
            &bpr_id,
            &q_rev_id,
            "att_f1",
            "2026-11-10T12:00:00Z",
        )
        .await;
        grading_repo
            .record_rubric_grade(RecordRubricGradeInput {
                attempt_id: "att_f1".to_string(),
                response_submission_id: sub_1,
                question_revision_id: q_rev_id.clone(),
                expected_attempt_revision: 1,
                origin: "ai".to_string(),
                state: "final".to_string(),
                points: Some(0.0),
                max_points: 4.0,
                outcome: Some("incorrect".to_string()),
                assessment_json: None,
                criteria_json: "[]".to_string(),
                provenance_json: None,
                manual_reason: None,
                job_id: None,
                step_key: None,
                lease_owner: None,
                cancellation_epoch: None,
                input_hash: None,
            })
            .await
            .unwrap();

        // 1 failure alone does not create repeated failure gap
        let gaps_1 = evidence_repo.list_learning_gaps(None, false).await.unwrap();
        assert_eq!(gaps_1.len(), 0);

        // Attempt 2: Low score 1/4 (0.25) -> triggers assessment-repeated-failure-v1!
        let (_resp_2, sub_2) = create_attempt_and_submission(
            &pool,
            &bpr_id,
            &q_rev_id,
            "att_f2",
            "2026-11-11T12:00:00Z",
        )
        .await;
        grading_repo
            .record_rubric_grade(RecordRubricGradeInput {
                attempt_id: "att_f2".to_string(),
                response_submission_id: sub_2,
                question_revision_id: q_rev_id.clone(),
                expected_attempt_revision: 1,
                origin: "ai".to_string(),
                state: "final".to_string(),
                points: Some(1.0),
                max_points: 4.0,
                outcome: Some("incorrect".to_string()),
                assessment_json: None,
                criteria_json: "[]".to_string(),
                provenance_json: None,
                manual_reason: None,
                job_id: None,
                step_key: None,
                lease_owner: None,
                cancellation_epoch: None,
                input_hash: None,
            })
            .await
            .unwrap();

        let gaps_2 = evidence_repo.list_learning_gaps(None, false).await.unwrap();
        assert_eq!(gaps_2.len(), 1);
        assert_eq!(gaps_2[0].kind, "repeatedly_failed");
        assert_eq!(gaps_2[0].status, "active");
        assert!(!gaps_2[0].evidence.is_empty());

        // Verify remediations were created
        let rem_count: (i64,) =
            sqlx::query_as("SELECT count(*) FROM learning_remediations WHERE gap_id = ?1")
                .bind(&gaps_2[0].id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(
            rem_count.0 >= 3,
            "Expected at least 3 remediations suggested"
        );

        // Attempt 3 & 4: Success (>= 0.8) -> resolves repeated failure gap
        let (_resp_3, sub_3) = create_attempt_and_submission(
            &pool,
            &bpr_id,
            &q_rev_id,
            "att_s3",
            "2026-11-12T12:00:00Z",
        )
        .await;
        grading_repo
            .record_rubric_grade(RecordRubricGradeInput {
                attempt_id: "att_s3".to_string(),
                response_submission_id: sub_3,
                question_revision_id: q_rev_id.clone(),
                expected_attempt_revision: 1,
                origin: "ai".to_string(),
                state: "final".to_string(),
                points: Some(4.0),
                max_points: 4.0,
                outcome: Some("correct".to_string()),
                assessment_json: None,
                criteria_json: "[]".to_string(),
                provenance_json: None,
                manual_reason: None,
                job_id: None,
                step_key: None,
                lease_owner: None,
                cancellation_epoch: None,
                input_hash: None,
            })
            .await
            .unwrap();

        let (_resp_4, sub_4) = create_attempt_and_submission(
            &pool,
            &bpr_id,
            &q_rev_id,
            "att_s4",
            "2026-11-13T12:00:00Z",
        )
        .await;
        grading_repo
            .record_rubric_grade(RecordRubricGradeInput {
                attempt_id: "att_s4".to_string(),
                response_submission_id: sub_4,
                question_revision_id: q_rev_id.clone(),
                expected_attempt_revision: 1,
                origin: "ai".to_string(),
                state: "final".to_string(),
                points: Some(4.0),
                max_points: 4.0,
                outcome: Some("correct".to_string()),
                assessment_json: None,
                criteria_json: "[]".to_string(),
                provenance_json: None,
                manual_reason: None,
                job_id: None,
                step_key: None,
                lease_owner: None,
                cancellation_epoch: None,
                input_hash: None,
            })
            .await
            .unwrap();

        let active_gaps = evidence_repo.list_learning_gaps(None, false).await.unwrap();
        assert_eq!(active_gaps.len(), 0, "Gap should be resolved");

        let all_gaps = evidence_repo.list_learning_gaps(None, true).await.unwrap();
        assert_eq!(all_gaps.len(), 1);
        assert_eq!(all_gaps[0].status, "resolved");
    }

    #[tokio::test]
    async fn test_reconcile_evidence_pagination() {
        let pool = test_pool().await;
        let (_bp_id, bpr_id, q_rev_id, _concept_id) = seed_test_exam(&pool).await;
        let grading_repo = ExamGradingRepository::new(pool.clone());
        let evidence_repo = LearningEvidenceRepository::new(pool.clone());

        for i in 1..=3 {
            let att_id = format!("att_rec_{}", i);
            let date = format!("2026-11-1{}T12:00:00Z", i);
            let (_r, sub) =
                create_attempt_and_submission(&pool, &bpr_id, &q_rev_id, &att_id, &date).await;
            grading_repo
                .record_rubric_grade(RecordRubricGradeInput {
                    attempt_id: att_id,
                    response_submission_id: sub,
                    question_revision_id: q_rev_id.clone(),
                    expected_attempt_revision: 1,
                    origin: "deterministic".to_string(),
                    state: "final".to_string(),
                    points: Some(4.0),
                    max_points: 4.0,
                    outcome: Some("correct".to_string()),
                    assessment_json: None,
                    criteria_json: "[]".to_string(),
                    provenance_json: None,
                    manual_reason: None,
                    job_id: None,
                    step_key: None,
                    lease_owner: None,
                    cancellation_epoch: None,
                    input_hash: None,
                })
                .await
                .unwrap();
        }

        // Test reconcile with batch_limit = 2
        let res_1 = evidence_repo
            .reconcile_learning_evidence(None, 2)
            .await
            .unwrap();
        assert_eq!(res_1.processed, 2);
        assert_eq!(res_1.remaining, 1);
        assert!(!res_1.completed);
        assert!(res_1.next_after_grade_id.is_some());

        // Second batch
        let res_2 = evidence_repo
            .reconcile_learning_evidence(res_1.next_after_grade_id.as_deref(), 2)
            .await
            .unwrap();
        assert_eq!(res_2.processed, 1);
        assert_eq!(res_2.remaining, 0);
        assert!(res_2.completed);
        assert!(res_2.next_after_grade_id.is_none());
    }

    #[tokio::test]
    async fn test_diagnostic_prior_evidence_adapter() {
        let pool = test_pool().await;
        let (_bp_id, bpr_id, q_rev_id, _concept_id) = seed_test_exam(&pool).await;
        // Mark blueprint revision diagnostic by inserting a diagnostic attempt directly.
        sqlx::query(
            "INSERT INTO exam_attempts (
                id, blueprint_revision_id, client_start_key, mode, status,
                question_revision_ids_json, revision, started_at, maximum_points, created_at, updated_at
            ) VALUES ('att_diag_1', ?1, 'start_diag_1', 'diagnostic', 'complete', ?2, 1, '2026-11-10T12:00:00Z', 4.0, '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')",
        )
        .bind(&bpr_id)
        .bind(serde_json::to_string(&vec![q_rev_id.clone()]).unwrap())
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO exam_responses (
                id, attempt_id, question_revision_id, draft_json, mark, revision, last_client_mutation_id, updated_at
            ) VALUES ('resp_diag_1', 'att_diag_1', ?1, '{\"text\":\"Answer\"}', 'answered', 1, 'mut_1', '2026-11-10T12:00:00Z')",
        )
        .bind(&q_rev_id)
        .execute(&pool)
        .await
        .unwrap();
        let sub_id = "sub_diag_1";
        sqlx::query(
            "INSERT INTO exam_response_submissions (
                id, response_id, attempt_id, question_revision_id, ordinal, kind,
                response_json, mark, hint_level, created_at
            ) VALUES (?1, 'resp_diag_1', 'att_diag_1', ?2, 1, 'exam-final', '{\"text\":\"Answer\"}', 'answered', 0, '2026-11-10T12:00:00Z')",
        )
        .bind(sub_id)
        .bind(&q_rev_id)
        .execute(&pool)
        .await
        .unwrap();
        // Seed diagnostic-final evidence row directly (bypasses grading hook mode mapping).
        sqlx::query(
            "INSERT INTO learning_evidence (
                id, concept_id, concept_label, plan_id, node_id, source_kind, source_id, grade_id,
                evidence_group_id, question_fingerprint, observed_score, outcome, misconception,
                learner_confidence, hint_level, grader_origin, occurred_at, policy_version, created_at, updated_at
            ) VALUES (
                'ev_diag_1', 'c_photosynthesis', 'Photosynthesis', 'plan_ev', 'node_photo',
                'diagnostic-final', ?1, NULL, 'att_diag_1:c_photosynthesis', 'fp_ev1',
                1.0, 'correct', NULL, NULL, 0, 'deterministic', '2026-11-10T12:00:00Z', 'evidence-v1',
                '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z'
            )",
        )
        .bind(sub_id)
        .execute(&pool)
        .await
        .unwrap();

        let evidence_repo = LearningEvidenceRepository::new(pool.clone());
        let prior = evidence_repo
            .get_diagnostic_prior_evidence("att_diag_1")
            .await
            .expect("diagnostic adapter succeeds");
        assert_eq!(prior.diagnostic_attempt_id, "att_diag_1");
        assert_eq!(prior.concepts.len(), 1);
        assert_eq!(
            prior.concepts[0].evidence_group_ids,
            vec!["att_diag_1:c_photosynthesis".to_string()]
        );

        // Exam-mode attempt with same evidence shape must be rejected.
        sqlx::query(
            "INSERT INTO exam_attempts (
                id, blueprint_revision_id, client_start_key, mode, status,
                question_revision_ids_json, revision, started_at, maximum_points, created_at, updated_at
            ) VALUES ('att_exam_x', ?1, 'start_exam_x', 'exam', 'complete', ?2, 1, '2026-11-10T12:00:00Z', 4.0, '2026-11-10T12:00:00Z', '2026-11-10T12:00:00Z')",
        )
        .bind(&bpr_id)
        .bind(serde_json::to_string(&vec![q_rev_id.clone()]).unwrap())
        .execute(&pool)
        .await
        .unwrap();
        let rejected = evidence_repo
            .get_diagnostic_prior_evidence("att_exam_x")
            .await;
        assert!(rejected.is_err());
    }

    #[tokio::test]
    async fn test_model_only_practice_never_enters_demonstrated_evidence() {
        let pool = test_pool().await;
        let (_bp_id, bpr_id, q_rev_id, concept_id) = seed_test_exam(&pool).await;
        // Mark the blueprint revision as unverified model-only practice.
        sqlx::query("UPDATE assessment_blueprint_revisions SET config_json = ?1 WHERE id = ?2")
            .bind(r#"{"knowledgePolicy":"model-only","mode":"practice"}"#)
            .bind(&bpr_id)
            .execute(&pool)
            .await
            .unwrap();

        let grading_repo = ExamGradingRepository::new(pool.clone());
        let evidence_repo = LearningEvidenceRepository::new(pool.clone());
        let (_resp, sub) = create_attempt_and_submission(
            &pool,
            &bpr_id,
            &q_rev_id,
            "att_model_only_1",
            "2026-11-10T12:00:00Z",
        )
        .await;
        let grade = grading_repo
            .record_rubric_grade(RecordRubricGradeInput {
                attempt_id: "att_model_only_1".to_string(),
                response_submission_id: sub,
                question_revision_id: q_rev_id.clone(),
                expected_attempt_revision: 1,
                origin: "deterministic".to_string(),
                state: "final".to_string(),
                points: Some(4.0),
                max_points: 4.0,
                outcome: Some("correct".to_string()),
                assessment_json: None,
                criteria_json: "[]".to_string(),
                provenance_json: None,
                manual_reason: None,
                job_id: None,
                step_key: None,
                lease_owner: None,
                cancellation_epoch: None,
                input_hash: None,
            })
            .await
            .expect("structurally valid grade succeeds");
        assert_eq!(grade.grade.state, "final");

        // Even though the item is structurally valid and graded correct, no
        // demonstrated evidence row may be created.
        let ev_rows: Vec<(String,)> = sqlx::query_as(
            "SELECT id FROM learning_evidence WHERE concept_id = ?1",
        )
        .bind(&concept_id)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(ev_rows.len(), 0);

        let summary = evidence_repo
            .get_concept_mastery_summary(&concept_id)
            .await
            .unwrap();
        assert_eq!(summary.level, "insufficient-evidence");
        assert!(summary.observed_mean.is_none());
    }
}
