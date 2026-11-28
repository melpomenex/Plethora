//! Repository and pure 5-dimension competency estimator for the Persistent Learner Model (Phase 1B).
//!
//! Matches `openspec/changes/establish-persistent-learner-model/design.md` and
//! migration `169_persistent_learner_model`.

use crate::error::{PlethoraError, Result};
use crate::models::learner_model::{
    CompetencyDimension, CompetencyEvidenceRecord, CompetencyEvidenceSourceKind, CompetencyStatus,
    ConceptCompetencyProfile, DeclaredCompetencyLevel, DimensionProjection,
    InvalidateCompetencyEvidenceResult, LearnerCompetencyDeclaration,
    RecordCompetencyEvidenceInput, ALL_COMPETENCY_DIMENSIONS, COMPETENCY_POLICY_VERSION,
};
use chrono::{DateTime, Utc};
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

pub const RECENCY_DECAY_FLOOR: f64 = 0.15;
pub const CORRELATION_DAMPING_EXPONENT: f64 = 0.85;
pub const GROUP_WEIGHT_CAP_MULTIPLIER: f64 = 1.5;

fn parse_timestamp_ms(iso: &str) -> i64 {
    DateTime::parse_from_rfc3339(iso)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

fn utc_day_key(iso: &str) -> String {
    if let Ok(dt) = DateTime::parse_from_rfc3339(iso) {
        dt.with_timezone(&Utc).format("%Y-%m-%d").to_string()
    } else {
        iso.chars().take(10).collect()
    }
}

/// Hint discounting factor: max(0.25, 1.0 - 0.25 * hint_level).
pub fn compute_hint_discount(hint_level: i64) -> f64 {
    let hints = hint_level.max(0) as f64;
    (1.0 - 0.25 * hints).max(0.25)
}

/// Short-term cramming discount for retention FSRS reviews when elapsed_days < 1.0:
/// d_delay = 0.20 + 0.80 * max(0.0, elapsed_days).
pub fn compute_retention_delay_discount(
    dimension: CompetencyDimension,
    source_kind: CompetencyEvidenceSourceKind,
    elapsed_days: Option<f64>,
) -> f64 {
    if dimension == CompetencyDimension::Retention
        && source_kind == CompetencyEvidenceSourceKind::FsrsReview
    {
        if let Some(days) = elapsed_days {
            if days.is_finite() && days < 1.0 {
                return 0.20 + 0.80 * days.max(0.0);
            }
        }
    }
    1.0
}

/// Dimension-specific recency decay with floor 0.15:
/// r = max(0.15, 2^(-age_days / half_life_days)).
pub fn compute_recency_decay(dimension: CompetencyDimension, age_days: f64) -> f64 {
    let half_life = dimension.half_life_days();
    let non_negative_age = if age_days.is_finite() {
        age_days.max(0.0)
    } else {
        0.0
    };
    2.0_f64
        .powf(-non_negative_age / half_life)
        .max(RECENCY_DECAY_FLOOR)
}

struct WeightedObservation<'a> {
    record: &'a CompetencyEvidenceRecord,
    score: f64,
    raw_weight: f64,
    effective_weight: f64,
    age_days: f64,
    occurred_ms: i64,
}

/// Deterministic pure 5-dimension competency estimator matching `competencyEstimator.ts`
/// and `openspec/changes/establish-persistent-learner-model/design.md` §3.
pub fn estimate_dimension_competency(
    records: &[CompetencyEvidenceRecord],
    dimension: CompetencyDimension,
    now_iso: &str,
    exclude_ai_excluded: bool,
    policy_version: Option<&str>,
) -> DimensionProjection {
    let policy = policy_version
        .unwrap_or(COMPETENCY_POLICY_VERSION)
        .to_string();
    let now_ms = parse_timestamp_ms(now_iso);
    let half_life_days = dimension.half_life_days();

    // Step 1: Filtering
    let active_records: Vec<&CompetencyEvidenceRecord> = records
        .iter()
        .filter(|r| {
            if r.dimension != dimension {
                return false;
            }
            if r.is_invalidated || !r.is_verified {
                return false;
            }
            if exclude_ai_excluded && r.is_ai_excluded {
                return false;
            }
            match r.observed_score {
                Some(s) if s.is_finite() => {}
                _ => return false,
            }
            if !r.base_weight.is_finite() || r.base_weight <= 0.0 {
                return false;
            }
            if dimension != CompetencyDimension::Exposure && r.source_kind.is_exposure_only() {
                return false;
            }
            true
        })
        .collect();

    if active_records.is_empty() {
        return DimensionProjection {
            dimension,
            status: CompetencyStatus::Unknown,
            estimate: None,
            confidence: 0.0,
            effective_weight: 0.0,
            raw_evidence_count: 0,
            independent_groups: 0,
            distinct_days: 0,
            uncertainty_reasons: vec!["no_evidence".to_string()],
            evidence_ids: vec![],
            last_evidence_at: None,
            policy_version: policy,
        };
    }

    // Step 2: Per-observation adjustments
    let mut observations_by_group: HashMap<&str, Vec<WeightedObservation<'_>>> = HashMap::new();
    let mut distinct_day_set: HashSet<String> = HashSet::new();

    for record in active_records {
        let occurred_ms = parse_timestamp_ms(&record.occurred_at);
        let age_days = ((now_ms - occurred_ms) as f64 / 86_400_000.0).max(0.0);
        let base_weight = record.base_weight.clamp(0.0, 2.0);
        let score = record.observed_score.unwrap_or(0.0).clamp(0.0, 1.0);
        let hint_discount = compute_hint_discount(record.hint_level);
        let delay_discount =
            compute_retention_delay_discount(dimension, record.source_kind, record.elapsed_days);
        let recency_decay = compute_recency_decay(dimension, age_days);
        let raw_weight = base_weight * hint_discount * delay_discount * recency_decay;

        let group_key = record
            .card_family_id
            .as_deref()
            .unwrap_or(record.evidence_group_id.as_str());

        observations_by_group
            .entry(group_key)
            .or_default()
            .push(WeightedObservation {
                record,
                score,
                raw_weight,
                effective_weight: 0.0,
                age_days,
                occurred_ms,
            });
        distinct_day_set.insert(utc_day_key(&record.occurred_at));
    }

    let independent_groups = observations_by_group.len() as i64;
    let distinct_days = distinct_day_set.len() as i64;

    // Step 3: Correlated-card / same-group harmonic damping with 1.5 * max_k(w_raw) cap
    let mut damped_observations: Vec<WeightedObservation<'_>> = Vec::new();
    for (_group_key, mut group_obs) in observations_by_group {
        group_obs.sort_by(|a, b| {
            b.occurred_ms
                .cmp(&a.occurred_ms)
                .then_with(|| a.record.id.cmp(&b.record.id))
        });

        let mut max_raw_weight = 0.0_f64;
        let mut group_damped_sum = 0.0_f64;

        for (k, obs) in group_obs.iter_mut().enumerate() {
            if obs.raw_weight > max_raw_weight {
                max_raw_weight = obs.raw_weight;
            }
            let damped = obs.raw_weight / ((k as f64) + 1.0).powf(CORRELATION_DAMPING_EXPONENT);
            obs.effective_weight = damped;
            group_damped_sum += damped;
        }

        let group_cap = GROUP_WEIGHT_CAP_MULTIPLIER * max_raw_weight;
        if group_damped_sum > group_cap && group_damped_sum > 0.0 {
            let scale = group_cap / group_damped_sum;
            for obs in &mut group_obs {
                obs.effective_weight *= scale;
            }
        }

        damped_observations.extend(group_obs);
    }

    // Deterministic global ordering (most recent first)
    damped_observations.sort_by(|a, b| {
        b.occurred_ms
            .cmp(&a.occurred_ms)
            .then_with(|| a.record.id.cmp(&b.record.id))
    });

    // Step 4: Posterior estimate, confidence, uncertainty reasons, status classification
    let mut total_effective_weight = 0.0_f64;
    let mut weighted_score_sum = 0.0_f64;
    let mut all_stale = true;

    for obs in &damped_observations {
        total_effective_weight += obs.effective_weight;
        weighted_score_sum += obs.effective_weight * obs.score;
        if obs.age_days <= half_life_days {
            all_stale = false;
        }
    }

    let estimate = if total_effective_weight > 0.0 {
        Some((weighted_score_sum / total_effective_weight).clamp(0.0, 1.0))
    } else {
        None
    };

    let raw_evidence_count = damped_observations.len() as i64;

    let base_confidence = 1.0 - (-total_effective_weight / 2.0).exp();
    let confidence = if dimension == CompetencyDimension::Exposure {
        base_confidence.clamp(0.0, 1.0)
    } else {
        (base_confidence
            * (independent_groups as f64 / 2.0).min(1.0)
            * (distinct_days as f64 / 2.0).min(1.0))
        .clamp(0.0, 1.0)
    };

    let mut uncertainty_reasons: Vec<String> = Vec::new();
    if dimension == CompetencyDimension::Exposure {
        if total_effective_weight < 0.5 {
            uncertainty_reasons.push("low_effective_weight".to_string());
        }
    } else {
        if total_effective_weight < 1.0 {
            uncertainty_reasons.push("low_effective_weight".to_string());
        }
        if independent_groups < 2 {
            uncertainty_reasons.push("single_evidence_group".to_string());
        }
        if matches!(
            dimension,
            CompetencyDimension::Retention | CompetencyDimension::Comprehension
        ) && distinct_days < 2
        {
            uncertainty_reasons.push("single_day_only".to_string());
        }
    }
    if all_stale {
        uncertainty_reasons.push("stale_evidence".to_string());
    }

    let status = match estimate {
        None => CompetencyStatus::Unknown,
        Some(_) if dimension == CompetencyDimension::Exposure && total_effective_weight < 0.5 => {
            CompetencyStatus::InsufficientEvidence
        }
        Some(_)
            if dimension != CompetencyDimension::Exposure
                && (total_effective_weight < 0.75
                    || (independent_groups == 1
                        && raw_evidence_count >= 2
                        && total_effective_weight < 1.2)) =>
        {
            CompetencyStatus::InsufficientEvidence
        }
        Some(mu) if mu < 0.5 => CompetencyStatus::NeedsAttention,
        Some(mu) if mu < 0.8 || confidence < 0.6 => CompetencyStatus::Developing,
        Some(_) => CompetencyStatus::Demonstrated,
    };

    let evidence_ids = damped_observations
        .iter()
        .map(|o| o.record.id.clone())
        .collect();
    let last_evidence_at = damped_observations
        .first()
        .map(|o| o.record.occurred_at.clone());

    DimensionProjection {
        dimension,
        status,
        estimate,
        confidence,
        effective_weight: total_effective_weight,
        raw_evidence_count,
        independent_groups,
        distinct_days,
        uncertainty_reasons,
        evidence_ids,
        last_evidence_at,
        policy_version: policy,
    }
}

/// Projects a full 5-dimension competency profile for a concept from evidence + declaration.
pub fn project_concept_profile(
    concept_id: &str,
    concept_name: &str,
    evidence: &[CompetencyEvidenceRecord],
    declaration: Option<LearnerCompetencyDeclaration>,
    now_iso: &str,
    exclude_ai_excluded: bool,
) -> ConceptCompetencyProfile {
    let concept_evidence: Vec<CompetencyEvidenceRecord> = evidence
        .iter()
        .filter(|r| r.concept_id == concept_id)
        .cloned()
        .collect();

    let mut dimensions = HashMap::with_capacity(5);
    for dim in ALL_COMPETENCY_DIMENSIONS {
        dimensions.insert(
            dim,
            estimate_dimension_competency(
                &concept_evidence,
                dim,
                now_iso,
                exclude_ai_excluded,
                None,
            ),
        );
    }

    let active_visible: Vec<&CompetencyEvidenceRecord> = concept_evidence
        .iter()
        .filter(|r| {
            !r.is_invalidated
                && r.is_verified
                && r.observed_score.is_some()
                && (!exclude_ai_excluded || !r.is_ai_excluded)
        })
        .collect();

    ConceptCompetencyProfile {
        concept_id: concept_id.to_string(),
        concept_name: concept_name.to_string(),
        dimensions,
        self_declaration: declaration,
        contains_local_only_evidence: active_visible.iter().any(|r| r.is_local_only),
        contains_ai_excluded_evidence: active_visible.iter().any(|r| r.is_ai_excluded),
    }
}

#[derive(Clone)]
pub struct LearnerModelRepository {
    pool: Pool<Sqlite>,
}

impl LearnerModelRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    fn row_to_evidence(row: &sqlx::sqlite::SqliteRow) -> Result<CompetencyEvidenceRecord> {
        let dim_str: String = row.try_get("dimension")?;
        let source_kind_str: String = row.try_get("source_kind")?;
        Ok(CompetencyEvidenceRecord {
            id: row.try_get("id")?,
            concept_id: row.try_get("concept_id")?,
            dimension: CompetencyDimension::from_db_str(&dim_str)?,
            source_kind: CompetencyEvidenceSourceKind::from_db_str(&source_kind_str)?,
            source_event_id: row.try_get("source_event_id")?,
            source_record_id: row.try_get("source_record_id")?,
            evidence_group_id: row.try_get("evidence_group_id")?,
            card_family_id: row.try_get("card_family_id")?,
            session_id: row.try_get("session_id")?,
            observed_score: row.try_get("observed_score")?,
            base_weight: row.try_get("base_weight")?,
            elapsed_days: row.try_get("elapsed_days")?,
            hint_level: row.try_get("hint_level")?,
            is_verified: row.try_get::<i64, _>("is_verified")? != 0,
            is_invalidated: row.try_get::<i64, _>("is_invalidated")? != 0,
            invalidated_by_event_id: row.try_get("invalidated_by_event_id")?,
            document_id: row.try_get("document_id")?,
            is_local_only: row.try_get::<i64, _>("is_local_only")? != 0,
            is_ai_excluded: row.try_get::<i64, _>("is_ai_excluded")? != 0,
            occurred_at: row.try_get("occurred_at")?,
            policy_version: row.try_get("policy_version")?,
            created_at: row.try_get("created_at")?,
        })
    }

    fn row_to_declaration(row: &sqlx::sqlite::SqliteRow) -> Result<LearnerCompetencyDeclaration> {
        let level_str: String = row.try_get("declared_level")?;
        Ok(LearnerCompetencyDeclaration {
            id: row.try_get("id")?,
            concept_id: row.try_get("concept_id")?,
            declared_level: DeclaredCompetencyLevel::from_db_str(&level_str)?,
            note: row.try_get("note")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }

    async fn recompute_concept_dimension_tx(
        tx: &mut Transaction<'_, Sqlite>,
        concept_id: &str,
        dimension: CompetencyDimension,
        now_iso: &str,
    ) -> Result<DimensionProjection> {
        let rows = sqlx::query(
            "SELECT id, concept_id, dimension, source_kind, source_event_id, source_record_id,
                    evidence_group_id, card_family_id, session_id, observed_score, base_weight,
                    elapsed_days, hint_level, is_verified, is_invalidated, invalidated_by_event_id,
                    document_id, is_local_only, is_ai_excluded, occurred_at, policy_version, created_at
             FROM competency_evidence
             WHERE concept_id = ?1 AND dimension = ?2",
        )
        .bind(concept_id)
        .bind(dimension.as_str())
        .fetch_all(&mut **tx)
        .await?;

        let records: Vec<CompetencyEvidenceRecord> = rows
            .iter()
            .map(Self::row_to_evidence)
            .collect::<Result<Vec<_>>>()?;

        let projection =
            estimate_dimension_competency(&records, dimension, now_iso, false, None);

        let contains_local_only = records
            .iter()
            .any(|r| !r.is_invalidated && r.is_verified && r.is_local_only);
        let contains_ai_excluded = records
            .iter()
            .any(|r| !r.is_invalidated && r.is_verified && r.is_ai_excluded);

        let uncertainty_json = serde_json::to_string(&projection.uncertainty_reasons)?;
        let evidence_ids_json = serde_json::to_string(&projection.evidence_ids)?;

        sqlx::query(
            "INSERT INTO competency_projections (
                concept_id, dimension, status, estimate, confidence, effective_weight,
                raw_evidence_count, independent_groups, distinct_days,
                uncertainty_reasons_json, evidence_ids_json,
                contains_local_only_evidence, contains_ai_excluded_evidence,
                last_evidence_at, policy_version, updated_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9,
                ?10, ?11,
                ?12, ?13,
                ?14, ?15, ?16
            )
            ON CONFLICT(concept_id, dimension) DO UPDATE SET
                status = excluded.status,
                estimate = excluded.estimate,
                confidence = excluded.confidence,
                effective_weight = excluded.effective_weight,
                raw_evidence_count = excluded.raw_evidence_count,
                independent_groups = excluded.independent_groups,
                distinct_days = excluded.distinct_days,
                uncertainty_reasons_json = excluded.uncertainty_reasons_json,
                evidence_ids_json = excluded.evidence_ids_json,
                contains_local_only_evidence = excluded.contains_local_only_evidence,
                contains_ai_excluded_evidence = excluded.contains_ai_excluded_evidence,
                last_evidence_at = excluded.last_evidence_at,
                policy_version = excluded.policy_version,
                updated_at = excluded.updated_at",
        )
        .bind(concept_id)
        .bind(dimension.as_str())
        .bind(projection.status.as_str())
        .bind(projection.estimate)
        .bind(projection.confidence)
        .bind(projection.effective_weight)
        .bind(projection.raw_evidence_count)
        .bind(projection.independent_groups)
        .bind(projection.distinct_days)
        .bind(&uncertainty_json)
        .bind(&evidence_ids_json)
        .bind(if contains_local_only { 1_i64 } else { 0_i64 })
        .bind(if contains_ai_excluded { 1_i64 } else { 0_i64 })
        .bind(&projection.last_evidence_at)
        .bind(&projection.policy_version)
        .bind(now_iso)
        .execute(&mut **tx)
        .await?;

        Ok(projection)
    }

    pub async fn record_competency_evidence(
        &self,
        input: &RecordCompetencyEvidenceInput,
    ) -> Result<CompetencyEvidenceRecord> {
        if input.source_kind.is_exposure_only() && input.dimension != CompetencyDimension::Exposure
        {
            return Err(PlethoraError::Validation(format!(
                "Source kind '{}' can only record 'exposure' evidence, not '{}'",
                input.source_kind.as_str(),
                input.dimension.as_str()
            )));
        }
        if !input.base_weight.is_finite() || input.base_weight <= 0.0 || input.base_weight > 2.0 {
            return Err(PlethoraError::Validation(
                "base_weight must be in (0.0, 2.0]".to_string(),
            ));
        }
        if let Some(score) = input.observed_score {
            if !score.is_finite() || !(0.0..=1.0).contains(&score) {
                return Err(PlethoraError::Validation(
                    "observed_score must be in [0.0, 1.0]".to_string(),
                ));
            }
        }
        let hint_level = input.hint_level.unwrap_or(0);
        if hint_level < 0 {
            return Err(PlethoraError::Validation(
                "hint_level must be >= 0".to_string(),
            ));
        }

        let mut tx = self.pool.begin().await?;

        let mut is_local_only = input.is_local_only.unwrap_or(false);
        let mut is_ai_excluded = input.is_ai_excluded.unwrap_or(false);

        if let Some(ref doc_id) = input.document_id {
            if let Some(doc_row) = sqlx::query(
                "SELECT is_local_only, is_ai_excluded FROM documents WHERE id = ?1",
            )
            .bind(doc_id)
            .fetch_optional(&mut *tx)
            .await?
            {
                let doc_local: i64 = doc_row.try_get("is_local_only").unwrap_or(0);
                let doc_ai: i64 = doc_row.try_get("is_ai_excluded").unwrap_or(0);
                is_local_only = is_local_only || doc_local != 0;
                is_ai_excluded = is_ai_excluded || doc_ai != 0;
            }
        }

        let id = input
            .id
            .clone()
            .unwrap_or_else(|| format!("ce_{}", Uuid::new_v4()));
        let now = Utc::now().to_rfc3339();
        let occurred_at = input
            .occurred_at
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| now.clone());
        let policy_version = input
            .policy_version
            .clone()
            .unwrap_or_else(|| COMPETENCY_POLICY_VERSION.to_string());
        let is_verified = input.is_verified.unwrap_or(true);

        sqlx::query(
            "INSERT INTO competency_evidence (
                id, concept_id, dimension, source_kind, source_event_id, source_record_id,
                evidence_group_id, card_family_id, session_id, observed_score, base_weight,
                elapsed_days, hint_level, is_verified, is_invalidated, invalidated_by_event_id,
                document_id, is_local_only, is_ai_excluded, occurred_at, policy_version, created_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9, ?10, ?11,
                ?12, ?13, ?14, 0, NULL,
                ?15, ?16, ?17, ?18, ?19, ?20
            )
            ON CONFLICT(concept_id, dimension, source_kind, source_record_id) DO NOTHING",
        )
        .bind(&id)
        .bind(&input.concept_id)
        .bind(input.dimension.as_str())
        .bind(input.source_kind.as_str())
        .bind(&input.source_event_id)
        .bind(&input.source_record_id)
        .bind(&input.evidence_group_id)
        .bind(&input.card_family_id)
        .bind(&input.session_id)
        .bind(input.observed_score)
        .bind(input.base_weight)
        .bind(input.elapsed_days)
        .bind(hint_level)
        .bind(if is_verified { 1_i64 } else { 0_i64 })
        .bind(&input.document_id)
        .bind(if is_local_only { 1_i64 } else { 0_i64 })
        .bind(if is_ai_excluded { 1_i64 } else { 0_i64 })
        .bind(&occurred_at)
        .bind(&policy_version)
        .bind(&now)
        .execute(&mut *tx)
        .await?;

        let row = sqlx::query(
            "SELECT id, concept_id, dimension, source_kind, source_event_id, source_record_id,
                    evidence_group_id, card_family_id, session_id, observed_score, base_weight,
                    elapsed_days, hint_level, is_verified, is_invalidated, invalidated_by_event_id,
                    document_id, is_local_only, is_ai_excluded, occurred_at, policy_version, created_at
             FROM competency_evidence
             WHERE concept_id = ?1 AND dimension = ?2 AND source_kind = ?3 AND source_record_id = ?4",
        )
        .bind(&input.concept_id)
        .bind(input.dimension.as_str())
        .bind(input.source_kind.as_str())
        .bind(&input.source_record_id)
        .fetch_one(&mut *tx)
        .await?;

        let record = Self::row_to_evidence(&row)?;

        Self::recompute_concept_dimension_tx(&mut tx, &input.concept_id, input.dimension, &now)
            .await?;

        tx.commit().await?;
        Ok(record)
    }

    pub async fn invalidate_competency_evidence(
        &self,
        evidence_ids: Option<&[String]>,
        source_event_id: Option<&str>,
        invalidated_by_event_id: Option<&str>,
    ) -> Result<InvalidateCompetencyEvidenceResult> {
        let mut tx = self.pool.begin().await?;
        let now = Utc::now().to_rfc3339();

        let mut target_rows: Vec<(String, String, String)> = Vec::new();
        let mut seen_ids: HashSet<String> = HashSet::new();

        if let Some(ids) = evidence_ids {
            for eid in ids {
                if let Some((id, concept_id, dim)) = sqlx::query_as::<_, (String, String, String)>(
                    "SELECT id, concept_id, dimension FROM competency_evidence
                     WHERE id = ?1 AND is_invalidated = 0",
                )
                .bind(eid)
                .fetch_optional(&mut *tx)
                .await?
                {
                    if seen_ids.insert(id.clone()) {
                        target_rows.push((id, concept_id, dim));
                    }
                }
            }
        }

        if let Some(src_ev_id) = source_event_id {
            let rows = sqlx::query_as::<_, (String, String, String)>(
                "SELECT id, concept_id, dimension FROM competency_evidence
                 WHERE source_event_id = ?1 AND is_invalidated = 0",
            )
            .bind(src_ev_id)
            .fetch_all(&mut *tx)
            .await?;
            for (id, concept_id, dim) in rows {
                if seen_ids.insert(id.clone()) {
                    target_rows.push((id, concept_id, dim));
                }
            }
        }

        let mut affected_pairs: HashSet<(String, CompetencyDimension)> = HashSet::new();
        let mut affected_concepts: HashSet<String> = HashSet::new();

        for (id, concept_id, dim_str) in &target_rows {
            sqlx::query(
                "UPDATE competency_evidence
                 SET is_invalidated = 1, invalidated_by_event_id = ?1
                 WHERE id = ?2",
            )
            .bind(invalidated_by_event_id)
            .bind(id)
            .execute(&mut *tx)
            .await?;

            if let Ok(dim) = CompetencyDimension::from_db_str(dim_str) {
                affected_pairs.insert((concept_id.clone(), dim));
            }
            affected_concepts.insert(concept_id.clone());
        }

        for (concept_id, dim) in affected_pairs {
            Self::recompute_concept_dimension_tx(&mut tx, &concept_id, dim, &now).await?;
        }

        tx.commit().await?;

        let mut affected_concept_ids: Vec<String> = affected_concepts.into_iter().collect();
        affected_concept_ids.sort();

        Ok(InvalidateCompetencyEvidenceResult {
            invalidated_count: target_rows.len() as i64,
            affected_concept_ids,
        })
    }

    pub async fn recompute_concept_competency(
        &self,
        concept_id: &str,
        now_iso: Option<&str>,
    ) -> Result<ConceptCompetencyProfile> {
        let now = now_iso
            .map(|s| s.to_string())
            .unwrap_or_else(|| Utc::now().to_rfc3339());
        let mut tx = self.pool.begin().await?;
        for dim in ALL_COMPETENCY_DIMENSIONS {
            Self::recompute_concept_dimension_tx(&mut tx, concept_id, dim, &now).await?;
        }
        tx.commit().await?;
        self.get_concept_competency_profile(concept_id, false).await
    }

    async fn fetch_concept_name(&self, concept_id: &str) -> Result<String> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT name FROM concepts WHERE id = ?1")
                .bind(concept_id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|r| r.0).unwrap_or_else(|| concept_id.to_string()))
    }

    async fn fetch_declaration(
        &self,
        concept_id: &str,
    ) -> Result<Option<LearnerCompetencyDeclaration>> {
        let row = sqlx::query(
            "SELECT id, concept_id, declared_level, note, created_at, updated_at
             FROM learner_competency_declarations
             WHERE concept_id = ?1",
        )
        .bind(concept_id)
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(r) => Ok(Some(Self::row_to_declaration(&r)?)),
            None => Ok(None),
        }
    }

    pub async fn get_concept_competency_profile(
        &self,
        concept_id: &str,
        ai_context: bool,
    ) -> Result<ConceptCompetencyProfile> {
        let concept_name = self.fetch_concept_name(concept_id).await?;
        let declaration = self.fetch_declaration(concept_id).await?;
        let evidence = self
            .get_concept_evidence_history(concept_id, None, true, false)
            .await?;
        let now = Utc::now().to_rfc3339();

        Ok(project_concept_profile(
            concept_id,
            &concept_name,
            &evidence,
            declaration,
            &now,
            ai_context,
        ))
    }

    pub async fn list_concept_competency_profiles(
        &self,
        concept_ids: Option<&[String]>,
        ai_context: bool,
    ) -> Result<Vec<ConceptCompetencyProfile>> {
        let ids: Vec<String> = match concept_ids {
            Some(list) => list.to_vec(),
            None => {
                let rows: Vec<(String,)> = sqlx::query_as(
                    "SELECT concept_id FROM competency_evidence
                     UNION
                     SELECT concept_id FROM learner_competency_declarations
                     UNION
                     SELECT concept_id FROM competency_projections
                     ORDER BY concept_id ASC",
                )
                .fetch_all(&self.pool)
                .await?;
                rows.into_iter().map(|r| r.0).collect()
            }
        };

        let mut profiles = Vec::with_capacity(ids.len());
        for cid in ids {
            profiles.push(self.get_concept_competency_profile(&cid, ai_context).await?);
        }
        Ok(profiles)
    }

    pub async fn set_learner_competency_declaration(
        &self,
        concept_id: &str,
        declared_level: DeclaredCompetencyLevel,
        note: Option<&str>,
    ) -> Result<LearnerCompetencyDeclaration> {
        let id = format!("lcd_{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO learner_competency_declarations (
                id, concept_id, declared_level, note, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(concept_id) DO UPDATE SET
                declared_level = excluded.declared_level,
                note = excluded.note,
                updated_at = excluded.updated_at",
        )
        .bind(&id)
        .bind(concept_id)
        .bind(declared_level.as_str())
        .bind(note)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        self.fetch_declaration(concept_id)
            .await?
            .ok_or_else(|| PlethoraError::Internal("Failed to fetch saved declaration".into()))
    }

    pub async fn get_concept_evidence_history(
        &self,
        concept_id: &str,
        dimension: Option<CompetencyDimension>,
        include_invalidated: bool,
        ai_context: bool,
    ) -> Result<Vec<CompetencyEvidenceRecord>> {
        let mut query = String::from(
            "SELECT id, concept_id, dimension, source_kind, source_event_id, source_record_id,
                    evidence_group_id, card_family_id, session_id, observed_score, base_weight,
                    elapsed_days, hint_level, is_verified, is_invalidated, invalidated_by_event_id,
                    document_id, is_local_only, is_ai_excluded, occurred_at, policy_version, created_at
             FROM competency_evidence
             WHERE concept_id = ?1",
        );

        if dimension.is_some() {
            query.push_str(" AND dimension = ?2");
        }
        if !include_invalidated {
            query.push_str(" AND is_invalidated = 0");
        }
        if ai_context {
            query.push_str(" AND is_ai_excluded = 0");
        }
        query.push_str(" ORDER BY occurred_at DESC, id ASC");

        let rows = if let Some(dim) = dimension {
            sqlx::query(&query)
                .bind(concept_id)
                .bind(dim.as_str())
                .fetch_all(&self.pool)
                .await?
        } else {
            sqlx::query(&query)
                .bind(concept_id)
                .fetch_all(&self.pool)
                .await?
        };

        rows.iter().map(Self::row_to_evidence).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_pool_with_concept(concept_id: &str, name: &str) -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();

        sqlx::query(
            "INSERT INTO concepts (id, name, normalized_name) VALUES (?1, ?2, ?3)",
        )
        .bind(concept_id)
        .bind(name)
        .bind(name.to_lowercase())
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    #[tokio::test]
    async fn migration_169_zero_evidence_is_unknown_and_page_views_only_update_exposure() {
        let pool = setup_pool_with_concept("c-1", "Backpropagation").await;
        let repo = LearnerModelRepository::new(pool.clone());

        let initial = repo
            .get_concept_competency_profile("c-1", false)
            .await
            .unwrap();
        for dim in ALL_COMPETENCY_DIMENSIONS {
            let proj = &initial.dimensions[&dim];
            assert_eq!(proj.status, CompetencyStatus::Unknown);
            assert_eq!(proj.estimate, None);
            assert_eq!(proj.uncertainty_reasons, vec!["no_evidence"]);
        }

        // Reading progress rejected for comprehension
        let bad = RecordCompetencyEvidenceInput {
            id: None,
            concept_id: "c-1".into(),
            dimension: CompetencyDimension::Comprehension,
            source_kind: CompetencyEvidenceSourceKind::ReadingProgress,
            source_event_id: None,
            source_record_id: "read-1".into(),
            evidence_group_id: "doc-1".into(),
            card_family_id: None,
            session_id: None,
            observed_score: Some(0.9),
            base_weight: 0.8,
            elapsed_days: None,
            hint_level: None,
            is_verified: Some(true),
            document_id: None,
            is_local_only: None,
            is_ai_excluded: None,
            occurred_at: Some("2026-11-28T10:00:00Z".into()),
            policy_version: None,
        };
        assert!(repo.record_competency_evidence(&bad).await.is_err());

        // Reading progress accepted for exposure only
        let good_exposure = RecordCompetencyEvidenceInput {
            dimension: CompetencyDimension::Exposure,
            ..bad
        };
        repo.record_competency_evidence(&good_exposure)
            .await
            .unwrap();

        let after = repo
            .get_concept_competency_profile("c-1", false)
            .await
            .unwrap();
        assert_ne!(
            after.dimensions[&CompetencyDimension::Exposure].status,
            CompetencyStatus::Unknown
        );
        assert_eq!(
            after.dimensions[&CompetencyDimension::Comprehension].status,
            CompetencyStatus::Unknown
        );
        assert_eq!(
            after.dimensions[&CompetencyDimension::Retention].status,
            CompetencyStatus::Unknown
        );

        let fk_violations: Vec<(String, i64, String, i64)> =
            sqlx::query_as("PRAGMA foreign_key_check")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(fk_violations.is_empty());
    }

    #[test]
    fn correlated_cards_damped_and_capped_never_demonstrated() {
        let now = "2026-11-28T12:00:00Z";
        let records: Vec<CompetencyEvidenceRecord> = (0..10)
            .map(|i| CompetencyEvidenceRecord {
                id: format!("ev-{}", i),
                concept_id: "c-1".into(),
                dimension: CompetencyDimension::Retention,
                source_kind: CompetencyEvidenceSourceKind::FsrsReview,
                source_event_id: None,
                source_record_id: format!("rev-{}", i),
                evidence_group_id: "grp-1".into(),
                card_family_id: Some("family-cloze-1".into()),
                session_id: Some("sess-1".into()),
                observed_score: Some(1.0),
                base_weight: 1.0,
                elapsed_days: Some(3.0),
                hint_level: 0,
                is_verified: true,
                is_invalidated: false,
                invalidated_by_event_id: None,
                document_id: None,
                is_local_only: false,
                is_ai_excluded: false,
                occurred_at: format!("2026-11-28T10:{:02}:00Z", i),
                policy_version: COMPETENCY_POLICY_VERSION.into(),
                created_at: now.into(),
            })
            .collect();

        let proj = estimate_dimension_competency(
            &records,
            CompetencyDimension::Retention,
            now,
            false,
            None,
        );
        assert_eq!(proj.independent_groups, 1);
        assert_eq!(proj.distinct_days, 1);
        assert!(
            proj.effective_weight <= 1.500001,
            "Correlated card family weight must be capped at 1.5 * max_w, got {}",
            proj.effective_weight
        );
        assert_ne!(
            proj.status,
            CompetencyStatus::Demonstrated,
            "Single correlated card family on one day must never reach Demonstrated"
        );
        assert!(proj
            .uncertainty_reasons
            .contains(&"single_evidence_group".to_string()));
        assert!(proj
            .uncertainty_reasons
            .contains(&"single_day_only".to_string()));
    }

    #[test]
    fn delayed_multi_day_independent_reviews_reach_demonstrated_and_unverified_excluded() {
        let now = "2026-11-28T12:00:00Z";
        let records = vec![
            CompetencyEvidenceRecord {
                id: "ev-1".into(),
                concept_id: "c-1".into(),
                dimension: CompetencyDimension::Retention,
                source_kind: CompetencyEvidenceSourceKind::FsrsReview,
                source_event_id: None,
                source_record_id: "rev-1".into(),
                evidence_group_id: "card-a".into(),
                card_family_id: None,
                session_id: None,
                observed_score: Some(0.95),
                base_weight: 1.2,
                elapsed_days: Some(4.0),
                hint_level: 0,
                is_verified: true,
                is_invalidated: false,
                invalidated_by_event_id: None,
                document_id: None,
                is_local_only: false,
                is_ai_excluded: false,
                occurred_at: "2026-11-24T12:00:00Z".into(),
                policy_version: COMPETENCY_POLICY_VERSION.into(),
                created_at: now.into(),
            },
            CompetencyEvidenceRecord {
                id: "ev-2".into(),
                concept_id: "c-1".into(),
                dimension: CompetencyDimension::Retention,
                source_kind: CompetencyEvidenceSourceKind::FsrsReview,
                source_event_id: None,
                source_record_id: "rev-2".into(),
                evidence_group_id: "card-b".into(),
                card_family_id: None,
                session_id: None,
                observed_score: Some(0.90),
                base_weight: 1.2,
                elapsed_days: Some(7.0),
                hint_level: 0,
                is_verified: true,
                is_invalidated: false,
                invalidated_by_event_id: None,
                document_id: None,
                is_local_only: false,
                is_ai_excluded: false,
                occurred_at: "2026-11-27T12:00:00Z".into(),
                policy_version: COMPETENCY_POLICY_VERSION.into(),
                created_at: now.into(),
            },
            // Unverified low-score record must be completely ignored
            CompetencyEvidenceRecord {
                id: "ev-unverified".into(),
                concept_id: "c-1".into(),
                dimension: CompetencyDimension::Retention,
                source_kind: CompetencyEvidenceSourceKind::SocraticPractice,
                source_event_id: None,
                source_record_id: "soc-1".into(),
                evidence_group_id: "card-c".into(),
                card_family_id: None,
                session_id: None,
                observed_score: Some(0.0),
                base_weight: 2.0,
                elapsed_days: None,
                hint_level: 0,
                is_verified: false,
                is_invalidated: false,
                invalidated_by_event_id: None,
                document_id: None,
                is_local_only: false,
                is_ai_excluded: false,
                occurred_at: "2026-11-28T11:00:00Z".into(),
                policy_version: COMPETENCY_POLICY_VERSION.into(),
                created_at: now.into(),
            },
        ];

        let proj = estimate_dimension_competency(
            &records,
            CompetencyDimension::Retention,
            now,
            false,
            None,
        );
        assert_eq!(proj.raw_evidence_count, 2);
        assert_eq!(proj.independent_groups, 2);
        assert_eq!(proj.distinct_days, 2);
        assert_eq!(proj.status, CompetencyStatus::Demonstrated);
        assert!(proj.estimate.unwrap() > 0.90);
        assert!(proj.confidence >= 0.60);
    }

    #[tokio::test]
    async fn invalidation_and_ai_excluded_filtering_and_self_declaration() {
        let pool = setup_pool_with_concept("c-2", "Gradient Descent").await;
        let repo = LearnerModelRepository::new(pool);

        let rec1 = repo
            .record_competency_evidence(&RecordCompetencyEvidenceInput {
                id: Some("ce-keep".into()),
                concept_id: "c-2".into(),
                dimension: CompetencyDimension::Comprehension,
                source_kind: CompetencyEvidenceSourceKind::ExamGrade,
                source_event_id: None,
                source_record_id: "grade-1".into(),
                evidence_group_id: "exam-1".into(),
                card_family_id: None,
                session_id: None,
                observed_score: Some(0.9),
                base_weight: 1.5,
                elapsed_days: None,
                hint_level: Some(0),
                is_verified: Some(true),
                document_id: None,
                is_local_only: Some(false),
                is_ai_excluded: Some(true),
                occurred_at: Some("2026-11-27T10:00:00Z".into()),
                policy_version: None,
            })
            .await
            .unwrap();

        // AI-context profile excludes is_ai_excluded evidence
        let ai_profile = repo
            .get_concept_competency_profile("c-2", true)
            .await
            .unwrap();
        assert_eq!(
            ai_profile.dimensions[&CompetencyDimension::Comprehension].status,
            CompetencyStatus::Unknown
        );

        // Local profile sees it
        let local_profile = repo
            .get_concept_competency_profile("c-2", false)
            .await
            .unwrap();
        assert_ne!(
            local_profile.dimensions[&CompetencyDimension::Comprehension].status,
            CompetencyStatus::Unknown
        );
        assert!(local_profile.contains_ai_excluded_evidence);

        // Self-declaration stored separately without mutating demonstrated estimates
        let decl = repo
            .set_learner_competency_declaration(
                "c-2",
                DeclaredCompetencyLevel::Confident,
                Some("Studied in grad school"),
            )
            .await
            .unwrap();
        assert_eq!(decl.declared_level, DeclaredCompetencyLevel::Confident);

        // Invalidate evidence -> projection reverts to unknown
        let inv = repo
            .invalidate_competency_evidence(Some(&[rec1.id]), None, None)
            .await
            .unwrap();
        assert_eq!(inv.invalidated_count, 1);
        assert_eq!(inv.affected_concept_ids, vec!["c-2"]);

        let after_inv = repo
            .get_concept_competency_profile("c-2", false)
            .await
            .unwrap();
        assert_eq!(
            after_inv.dimensions[&CompetencyDimension::Comprehension].status,
            CompetencyStatus::Unknown
        );
        assert_eq!(
            after_inv.self_declaration.unwrap().declared_level,
            DeclaredCompetencyLevel::Confident
        );
    }
}
