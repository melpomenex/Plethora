//! Repository and deterministic feasibility engine for Unified Learning Goals (Phase 1C).
//!
//! Matches `openspec/changes/unify-learning-goals-and-study-plans/design.md` and
//! migration `170_unified_learning_goals`.

use crate::database::learning_event_repository::LearningEventRepository;
use crate::error::{PlethoraError, Result};
use crate::models::learner_model::{CompetencyDimension, CompetencyStatus};
use crate::models::learning_event::{AppendLearningEventInput, LearningEventType};
use crate::models::learning_goal::{
    validate_goal_source_link, CreateLearningGoalInput, EvaluateGoalFeasibilityContext,
    EvolveLearningGoalInput, GoalAdjustmentKind, GoalAdjustmentSuggestion,
    GoalConceptFeasibilityInput, GoalDimensionProjection, GoalFeasibilityReport,
    GoalFeasibilityStatus, GoalSourceKind, GoalSourceRole, LearningGoal, LearningGoalKind,
    LearningGoalMilestone, LearningGoalMilestoneStatus, LearningGoalSource, LearningGoalStatus,
    LinkGoalSourceInput, ListLearningGoalsFilter, UpdateLearningGoalInput,
    UpsertGoalMilestoneInput,
};
use chrono::{DateTime, Duration, Utc};
use sqlx::{Pool, QueryBuilder, Row, Sqlite};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

const DEFAULT_DAILY_MINUTES_BUDGET: i64 = 30;
const MAX_SUGGESTED_DAILY_MINUTES: i64 = 180;
const DEVELOPING_MIN_REMAINING_FRACTION: f64 = 0.15;

fn merge_json_objects(
    base: &serde_json::Value,
    overlay: &serde_json::Value,
) -> serde_json::Value {
    match (base, overlay) {
        (serde_json::Value::Object(b), serde_json::Value::Object(o)) => {
            let mut merged = b.clone();
            for (k, v) in o {
                merged.insert(k.clone(), v.clone());
            }
            serde_json::Value::Object(merged)
        }
        (_, serde_json::Value::Object(_)) => overlay.clone(),
        _ => base.clone(),
    }
}

fn dimension_remaining_fraction(
    projection: Option<&GoalDimensionProjection>,
    threshold: f64,
) -> f64 {
    let Some(proj) = projection else {
        return 1.0;
    };

    if proj.status == CompetencyStatus::Demonstrated {
        if let Some(est) = proj.estimate {
            if est >= threshold {
                return 0.0;
            }
        }
    }

    if proj.status == CompetencyStatus::Developing {
        if let Some(est) = proj.estimate {
            let ratio = (est / threshold).clamp(0.0, 1.0);
            return (1.0 - ratio).max(DEVELOPING_MIN_REMAINING_FRACTION);
        }
    }

    1.0
}

/// Pure, deterministic competency-aware feasibility evaluation matching `feasibility.ts`
/// and `openspec/changes/unify-learning-goals-and-study-plans/design.md` §3.
pub fn evaluate_goal_feasibility(
    goal: &LearningGoal,
    concept_states: &[GoalConceptFeasibilityInput],
    uncompleted_reading_minutes: f64,
    projected_due_review_minutes: f64,
    now_iso: &str,
) -> GoalFeasibilityReport {
    let now_dt = DateTime::parse_from_rfc3339(now_iso)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());

    let target_dimensions = if goal.target_dimensions.is_empty() {
        goal.kind.default_dimensions()
    } else {
        goal.target_dimensions.clone()
    };

    let threshold = if goal.target_mastery_threshold > 0.0 {
        goal.target_mastery_threshold.clamp(0.01, 1.0)
    } else {
        goal.kind.default_mastery_threshold()
    };

    let daily_budget = goal
        .daily_minutes_budget
        .or_else(|| goal.kind.default_daily_minutes_budget())
        .unwrap_or(DEFAULT_DAILY_MINUTES_BUDGET)
        .max(1);

    let reading_minutes = uncompleted_reading_minutes.max(0.0);
    let review_minutes = projected_due_review_minutes.max(0.0);

    let mut total_concept_effort = 0.0_f64;
    let mut remaining_concept_effort = 0.0_f64;
    let mut prior_mastered_concept_count: i64 = 0;

    let mut dimension_gap_totals: HashMap<CompetencyDimension, f64> = HashMap::new();
    for &dim in &target_dimensions {
        dimension_gap_totals.insert(dim, 0.0);
    }

    struct UnmasteredConcept {
        concept_id: String,
        priority: i64,
        remaining_minutes: f64,
    }
    let mut unmastered_concepts: Vec<UnmasteredConcept> = Vec::new();

    for concept in concept_states {
        let estimated = concept.estimated_minutes_to_master.max(0.0);
        total_concept_effort += estimated;

        let mut dim_fraction_sum = 0.0_f64;
        let mut all_dimensions_mastered = true;

        for &dim in &target_dimensions {
            let frac = dimension_remaining_fraction(concept.dimensions.get(&dim), threshold);
            dim_fraction_sum += frac;
            *dimension_gap_totals.entry(dim).or_insert(0.0) += frac;
            if frac > 0.0 {
                all_dimensions_mastered = false;
            }
        }

        let mean_fraction = dim_fraction_sum / (target_dimensions.len().max(1) as f64);
        let concept_remaining = estimated * mean_fraction;
        remaining_concept_effort += concept_remaining;

        if all_dimensions_mastered {
            prior_mastered_concept_count += 1;
        } else {
            unmastered_concepts.push(UnmasteredConcept {
                concept_id: concept.concept_id.clone(),
                priority: concept.priority.unwrap_or(50),
                remaining_minutes: concept_remaining,
            });
        }
    }

    let remaining_concept_minutes = remaining_concept_effort.round() as i64;
    let remaining_reading_minutes = reading_minutes.round() as i64;
    let projected_review_minutes = review_minutes.round() as i64;
    let remaining_minutes =
        remaining_concept_minutes + remaining_reading_minutes + projected_review_minutes;

    let progress_ratio = if total_concept_effort > 0.0 {
        (1.0 - remaining_concept_effort / total_concept_effort).clamp(0.0, 1.0)
    } else if !concept_states.is_empty() {
        (prior_mastered_concept_count as f64 / concept_states.len() as f64).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let Some(ref target_date) = goal.target_date else {
        return GoalFeasibilityReport {
            goal_id: goal.id.clone(),
            status: GoalFeasibilityStatus::Unbounded,
            remaining_minutes,
            remaining_concept_minutes,
            remaining_reading_minutes,
            projected_review_minutes,
            available_minutes: None,
            days_remaining: None,
            required_daily_minutes: None,
            utilization_ratio: None,
            progress_ratio,
            prior_mastered_concept_count,
            total_concept_count: concept_states.len() as i64,
            recommendations: vec![],
            uncertainty_reasons: vec![],
            evaluated_at: now_iso.to_string(),
        };
    };

    let days_remaining = match DateTime::parse_from_rfc3339(target_date) {
        Ok(target_dt) => {
            let diff_ms = target_dt.with_timezone(&Utc).timestamp_millis() - now_dt.timestamp_millis();
            ((diff_ms as f64) / 86_400_000.0).ceil().max(0.0) as i64
        }
        Err(_) => 0,
    };
    let available_minutes = days_remaining * daily_budget;

    let has_workload_data =
        !concept_states.is_empty() || reading_minutes > 0.0 || review_minutes > 0.0;
    if !has_workload_data {
        return GoalFeasibilityReport {
            goal_id: goal.id.clone(),
            status: GoalFeasibilityStatus::InsufficientData,
            remaining_minutes: 0,
            remaining_concept_minutes: 0,
            remaining_reading_minutes: 0,
            projected_review_minutes: 0,
            available_minutes: Some(available_minutes),
            days_remaining: Some(days_remaining),
            required_daily_minutes: None,
            utilization_ratio: None,
            progress_ratio: 0.0,
            prior_mastered_concept_count: 0,
            total_concept_count: 0,
            recommendations: vec![],
            uncertainty_reasons: vec![
                "No linked concepts, reading workload, or projected review workload available to estimate deadline feasibility.".to_string(),
            ],
            evaluated_at: now_iso.to_string(),
        };
    }

    let (status, required_daily_minutes, utilization_ratio) = if days_remaining == 0 && remaining_minutes > 0 {
        (GoalFeasibilityStatus::Infeasible, remaining_minutes, None)
    } else if remaining_minutes == 0 {
        (GoalFeasibilityStatus::OnTrack, 0, Some(0.0))
    } else {
        let req_daily = ((remaining_minutes as f64) / (days_remaining as f64)).ceil() as i64;
        let util = (remaining_minutes as f64) / (available_minutes.max(1) as f64);
        let st = if util <= 0.80 {
            GoalFeasibilityStatus::OnTrack
        } else if util <= 1.05 {
            GoalFeasibilityStatus::Tight
        } else if util <= 1.40 {
            GoalFeasibilityStatus::AtRisk
        } else {
            GoalFeasibilityStatus::Infeasible
        };
        (st, req_daily, Some(util))
    };

    let mut recommendations = Vec::new();
    if matches!(
        status,
        GoalFeasibilityStatus::AtRisk | GoalFeasibilityStatus::Infeasible
    ) {
        let suggested_daily = daily_budget
            .max(required_daily_minutes)
            .min(MAX_SUGGESTED_DAILY_MINUTES);
        recommendations.push(GoalAdjustmentSuggestion {
            kind: GoalAdjustmentKind::IncreaseDailyBudget,
            summary: format!(
                "Increase daily study budget from {} min/day to {} min/day.",
                daily_budget, suggested_daily
            ),
            suggested_daily_minutes_budget: Some(suggested_daily),
            suggested_target_date: None,
            deferrable_source_ids: None,
            deferrable_concept_ids: None,
            focus_dimensions: None,
        });

        let needed_days =
            ((remaining_minutes as f64) / ((daily_budget as f64) * 0.80).max(1.0)).ceil() as i64;
        let suggested_date = (now_dt + Duration::days(needed_days)).to_rfc3339();
        recommendations.push(GoalAdjustmentSuggestion {
            kind: GoalAdjustmentKind::ExtendDeadline,
            summary: format!(
                "Extend deadline by {} day(s) to reach an on-track pace at {} min/day.",
                (needed_days - days_remaining).max(1),
                daily_budget
            ),
            suggested_daily_minutes_budget: None,
            suggested_target_date: Some(suggested_date),
            deferrable_source_ids: None,
            deferrable_concept_ids: None,
            focus_dimensions: None,
        });

        let deferrable_source_ids: Vec<String> = goal
            .sources
            .iter()
            .filter(|s| s.source_role == GoalSourceRole::Supplemental)
            .map(|s| s.source_id.clone())
            .collect();

        let deferrable_concept_ids: Vec<String> = if unmastered_concepts.len() > 1 {
            unmastered_concepts.sort_by(|a, b| {
                a.priority.cmp(&b.priority).then_with(|| {
                    b.remaining_minutes
                        .partial_cmp(&a.remaining_minutes)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
            });
            let take_n = (unmastered_concepts.len() / 2).max(1);
            unmastered_concepts
                .iter()
                .take(take_n)
                .map(|c| c.concept_id.clone())
                .collect()
        } else {
            vec![]
        };

        if !deferrable_source_ids.is_empty() || !deferrable_concept_ids.is_empty() {
            recommendations.push(GoalAdjustmentSuggestion {
                kind: GoalAdjustmentKind::NarrowScope,
                summary: "Defer supplemental sources or lower-priority concepts to reduce required workload without deleting content.".to_string(),
                suggested_daily_minutes_budget: None,
                suggested_target_date: None,
                deferrable_source_ids: if deferrable_source_ids.is_empty() {
                    None
                } else {
                    Some(deferrable_source_ids)
                },
                deferrable_concept_ids: if deferrable_concept_ids.is_empty() {
                    None
                } else {
                    Some(deferrable_concept_ids)
                },
                focus_dimensions: None,
            });
        }

        if !concept_states.is_empty() && !target_dimensions.is_empty() {
            let mut ranked: Vec<(CompetencyDimension, f64)> = target_dimensions
                .iter()
                .map(|&dim| {
                    let avg_gap = dimension_gap_totals.get(&dim).copied().unwrap_or(0.0)
                        / (concept_states.len() as f64);
                    (dim, avg_gap)
                })
                .filter(|(_, avg_gap)| *avg_gap > 0.25)
                .collect();
            ranked.sort_by(|a, b| {
                b.1.partial_cmp(&a.1)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let focus_dims: Vec<CompetencyDimension> =
                ranked.into_iter().take(2).map(|(d, _)| d).collect();
            if !focus_dims.is_empty() {
                let dim_names: Vec<&str> = focus_dims.iter().map(|d| d.as_str()).collect();
                recommendations.push(GoalAdjustmentSuggestion {
                    kind: GoalAdjustmentKind::FocusWeakestDimensions,
                    summary: format!(
                        "Prioritize weakest target dimensions ({}) for highest mastery gain per minute.",
                        dim_names.join(", ")
                    ),
                    suggested_daily_minutes_budget: None,
                    suggested_target_date: None,
                    deferrable_source_ids: None,
                    deferrable_concept_ids: None,
                    focus_dimensions: Some(focus_dims),
                });
            }
        }
    }

    GoalFeasibilityReport {
        goal_id: goal.id.clone(),
        status,
        remaining_minutes,
        remaining_concept_minutes,
        remaining_reading_minutes,
        projected_review_minutes,
        available_minutes: Some(available_minutes),
        days_remaining: Some(days_remaining),
        required_daily_minutes: Some(required_daily_minutes),
        utilization_ratio,
        progress_ratio,
        prior_mastered_concept_count,
        total_concept_count: concept_states.len() as i64,
        recommendations,
        uncertainty_reasons: vec![],
        evaluated_at: now_iso.to_string(),
    }
}

#[derive(Clone)]
pub struct LearningGoalRepository {
    pool: Pool<Sqlite>,
}

impl LearningGoalRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    fn row_to_source(row: &sqlx::sqlite::SqliteRow) -> Result<LearningGoalSource> {
        let kind_str: String = row.try_get("source_kind")?;
        let role_str: String = row.try_get("source_role")?;
        Ok(LearningGoalSource {
            id: row.try_get("id")?,
            goal_id: row.try_get("goal_id")?,
            source_kind: GoalSourceKind::from_db_str(&kind_str)?,
            source_id: row.try_get("source_id")?,
            source_role: GoalSourceRole::from_db_str(&role_str)?,
            weight: row.try_get("weight")?,
            added_at: row.try_get("added_at")?,
            label: None,
            is_ai_excluded: None,
        })
    }

    fn row_to_milestone(row: &sqlx::sqlite::SqliteRow) -> Result<LearningGoalMilestone> {
        let status_str: String = row.try_get("status")?;
        Ok(LearningGoalMilestone {
            id: row.try_get("id")?,
            goal_id: row.try_get("goal_id")?,
            title: row.try_get("title")?,
            target_date: row.try_get("target_date")?,
            status: LearningGoalMilestoneStatus::from_db_str(&status_str)?,
            linked_node_id: row.try_get("linked_node_id")?,
            sort_order: row.try_get("sort_order")?,
            completed_at: row.try_get("completed_at")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }

    async fn load_goal_sources(&self, goal_id: &str) -> Result<Vec<LearningGoalSource>> {
        let rows = sqlx::query(
            "SELECT id, goal_id, source_kind, source_id, source_role, weight, added_at
             FROM learning_goal_sources
             WHERE goal_id = ?1
             ORDER BY added_at ASC, id ASC",
        )
        .bind(goal_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(Self::row_to_source).collect()
    }

    async fn load_goal_milestones(&self, goal_id: &str) -> Result<Vec<LearningGoalMilestone>> {
        let rows = sqlx::query(
            "SELECT id, goal_id, title, target_date, status, linked_node_id,
                    sort_order, completed_at, created_at, updated_at
             FROM learning_goal_milestones
             WHERE goal_id = ?1
             ORDER BY sort_order ASC, created_at ASC",
        )
        .bind(goal_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(Self::row_to_milestone).collect()
    }

    async fn hydrate_goal_row(&self, row: &sqlx::sqlite::SqliteRow) -> Result<LearningGoal> {
        let id: String = row.try_get("id")?;
        let kind_str: String = row.try_get("kind")?;
        let status_str: String = row.try_get("status")?;
        let target_dims_json: String = row.try_get("target_dimensions_json")?;
        let policy_json: String = row.try_get("policy_json")?;

        let target_dimensions: Vec<CompetencyDimension> =
            serde_json::from_str(&target_dims_json).unwrap_or_default();
        let policy: serde_json::Value = serde_json::from_str(&policy_json)
            .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new()));

        let sources = self.load_goal_sources(&id).await?;
        let milestones = self.load_goal_milestones(&id).await?;

        Ok(LearningGoal {
            id,
            title: row.try_get("title")?,
            description: row.try_get("description")?,
            kind: LearningGoalKind::from_db_str(&kind_str)?,
            status: LearningGoalStatus::from_db_str(&status_str)?,
            priority: row.try_get("priority")?,
            study_plan_id: row.try_get("study_plan_id")?,
            language_code: row.try_get("language_code")?,
            target_date: row.try_get("target_date")?,
            daily_minutes_budget: row.try_get("daily_minutes_budget")?,
            target_dimensions,
            target_mastery_threshold: row.try_get("target_mastery_threshold")?,
            policy,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
            completed_at: row.try_get("completed_at")?,
            sources,
            milestones,
        })
    }

    pub async fn create_learning_goal(
        &self,
        input: &CreateLearningGoalInput,
    ) -> Result<LearningGoal> {
        let title = input.title.trim();
        if title.is_empty() {
            return Err(PlethoraError::Validation(
                "Learning goal title cannot be empty".to_string(),
            ));
        }

        let kind = input.kind.unwrap_or(LearningGoalKind::Exploration);
        let priority = input.priority.unwrap_or(50).clamp(0, 100);
        let daily_minutes_budget = input
            .daily_minutes_budget
            .or_else(|| kind.default_daily_minutes_budget());
        if let Some(budget) = daily_minutes_budget {
            if !(5..=480).contains(&budget) {
                return Err(PlethoraError::Validation(
                    "daily_minutes_budget must be between 5 and 480".to_string(),
                ));
            }
        }
        let target_dimensions = match &input.target_dimensions {
            Some(dims) if !dims.is_empty() => dims.clone(),
            _ => kind.default_dimensions(),
        };
        let target_mastery_threshold = input
            .target_mastery_threshold
            .unwrap_or_else(|| kind.default_mastery_threshold());
        if !target_mastery_threshold.is_finite()
            || target_mastery_threshold <= 0.0
            || target_mastery_threshold > 1.0
        {
            return Err(PlethoraError::Validation(
                "target_mastery_threshold must be in (0.0, 1.0]".to_string(),
            ));
        }

        let default_policy = kind.default_policy_json();
        let policy = match &input.policy {
            Some(p) => merge_json_objects(&default_policy, p),
            None => default_policy,
        };

        // Validate all initial sources upfront
        let initial_sources = input.initial_sources.as_deref().unwrap_or(&[]);
        for src in initial_sources {
            let role = src
                .source_role
                .unwrap_or_else(|| src.source_kind.default_role());
            validate_goal_source_link(src.source_kind, role)?;
        }

        let id = format!("goal_{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();
        let target_dims_json = serde_json::to_string(&target_dimensions)?;
        let policy_json = serde_json::to_string(&policy)?;

        let mut tx = self.pool.begin().await?;

        sqlx::query(
            "INSERT INTO learning_goals (
                id, title, description, kind, status, priority, study_plan_id,
                language_code, target_date, daily_minutes_budget,
                target_dimensions_json, target_mastery_threshold, policy_json,
                created_at, updated_at, completed_at
            ) VALUES (
                ?1, ?2, ?3, ?4, 'active', ?5, ?6,
                ?7, ?8, ?9,
                ?10, ?11, ?12,
                ?13, ?14, NULL
            )",
        )
        .bind(&id)
        .bind(title)
        .bind(&input.description)
        .bind(kind.as_str())
        .bind(priority)
        .bind(&input.study_plan_id)
        .bind(&input.language_code)
        .bind(&input.target_date)
        .bind(daily_minutes_budget)
        .bind(&target_dims_json)
        .bind(target_mastery_threshold)
        .bind(&policy_json)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;

        let mut seen_keys: HashSet<(String, String)> = HashSet::new();
        for src in initial_sources {
            let key = (src.source_kind.as_str().to_string(), src.source_id.clone());
            if !seen_keys.insert(key) {
                continue;
            }
            let role = src
                .source_role
                .unwrap_or_else(|| src.source_kind.default_role());
            let weight = src.weight.unwrap_or(1.0).clamp(0.01, 5.0);
            let src_row_id = format!("gsrc_{}", Uuid::new_v4());
            sqlx::query(
                "INSERT INTO learning_goal_sources (
                    id, goal_id, source_kind, source_id, source_role, weight, added_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(goal_id, source_kind, source_id) DO NOTHING",
            )
            .bind(&src_row_id)
            .bind(&id)
            .bind(src.source_kind.as_str())
            .bind(&src.source_id)
            .bind(role.as_str())
            .bind(weight)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
        }

        let event_input = AppendLearningEventInput {
            idempotency_key: format!("goal_created:{}", id),
            event_type: LearningEventType::GoalCreated,
            actor: Some("user".to_string()),
            surface: "today_dashboard".to_string(),
            session_id: None,
            goal_id: Some(id.clone()),
            entity_kind: "learning_goal".to_string(),
            entity_id: id.clone(),
            document_id: None,
            is_local_only: None,
            is_ai_excluded: None,
            payload: serde_json::json!({
                "kind": kind.as_str(),
                "title": title,
            }),
            occurred_at: Some(now.clone()),
            retracts_event_id: None,
        };
        LearningEventRepository::append_learning_event_tx(&mut tx, &event_input).await?;

        tx.commit().await?;

        self.get_learning_goal_detail(&id)
            .await?
            .ok_or_else(|| PlethoraError::Internal("Failed to load created learning goal".into()))
    }

    pub async fn get_learning_goal_detail(&self, goal_id: &str) -> Result<Option<LearningGoal>> {
        let row = sqlx::query(
            "SELECT id, title, description, kind, status, priority, study_plan_id,
                    language_code, target_date, daily_minutes_budget,
                    target_dimensions_json, target_mastery_threshold, policy_json,
                    created_at, updated_at, completed_at
             FROM learning_goals
             WHERE id = ?1",
        )
        .bind(goal_id)
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(r) => Ok(Some(self.hydrate_goal_row(&r).await?)),
            None => Ok(None),
        }
    }

    pub async fn list_learning_goals(
        &self,
        filter: Option<&ListLearningGoalsFilter>,
    ) -> Result<Vec<LearningGoal>> {
        let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(
            "SELECT id, title, description, kind, status, priority, study_plan_id,
                    language_code, target_date, daily_minutes_budget,
                    target_dimensions_json, target_mastery_threshold, policy_json,
                    created_at, updated_at, completed_at
             FROM learning_goals WHERE 1 = 1",
        );

        if let Some(f) = filter {
            if let Some(ref status_filter) = f.status {
                let statuses = status_filter.into_vec();
                if !statuses.is_empty() {
                    qb.push(" AND status IN (");
                    let mut sep = qb.separated(", ");
                    for s in statuses {
                        sep.push_bind(s.as_str());
                    }
                    qb.push(")");
                }
            }
            if let Some(kind) = f.kind {
                qb.push(" AND kind = ").push_bind(kind.as_str());
            }
        }

        qb.push(" ORDER BY priority DESC, updated_at DESC");

        let rows = qb.build().fetch_all(&self.pool).await?;
        let mut goals = Vec::with_capacity(rows.len());
        for row in &rows {
            goals.push(self.hydrate_goal_row(row).await?);
        }
        Ok(goals)
    }

    pub async fn update_learning_goal(
        &self,
        goal_id: &str,
        patch: &UpdateLearningGoalInput,
    ) -> Result<LearningGoal> {
        let existing = self
            .get_learning_goal_detail(goal_id)
            .await?
            .ok_or_else(|| {
                PlethoraError::NotFound(format!("Learning goal '{}' not found", goal_id))
            })?;

        let now = Utc::now().to_rfc3339();
        let next_title = match &patch.title {
            Some(t) if !t.trim().is_empty() => t.trim().to_string(),
            _ => existing.title.clone(),
        };
        let next_description = match &patch.description {
            Some(d) => d.clone(),
            None => existing.description.clone(),
        };
        let next_priority = patch.priority.unwrap_or(existing.priority).clamp(0, 100);
        let next_language_code = match &patch.language_code {
            Some(l) => l.clone(),
            None => existing.language_code.clone(),
        };
        let next_target_date = match &patch.target_date {
            Some(td) => td.clone(),
            None => existing.target_date.clone(),
        };
        let next_daily_budget = match &patch.daily_minutes_budget {
            Some(b) => *b,
            None => existing.daily_minutes_budget,
        };
        if let Some(budget) = next_daily_budget {
            if !(5..=480).contains(&budget) {
                return Err(PlethoraError::Validation(
                    "daily_minutes_budget must be between 5 and 480".to_string(),
                ));
            }
        }
        let next_target_dimensions = patch
            .target_dimensions
            .clone()
            .unwrap_or_else(|| existing.target_dimensions.clone());
        let next_threshold = patch
            .target_mastery_threshold
            .unwrap_or(existing.target_mastery_threshold);
        let next_policy = match &patch.policy {
            Some(p) => merge_json_objects(&existing.policy, p),
            None => existing.policy.clone(),
        };
        let next_status = patch.status.unwrap_or(existing.status);
        let next_completed_at = match next_status {
            LearningGoalStatus::Completed => existing.completed_at.clone().or_else(|| Some(now.clone())),
            LearningGoalStatus::Active => None,
            _ => existing.completed_at.clone(),
        };

        let target_dims_json = serde_json::to_string(&next_target_dimensions)?;
        let policy_json = serde_json::to_string(&next_policy)?;

        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "UPDATE learning_goals
             SET title = ?1, description = ?2, priority = ?3, language_code = ?4,
                 target_date = ?5, daily_minutes_budget = ?6,
                 target_dimensions_json = ?7, target_mastery_threshold = ?8,
                 policy_json = ?9, status = ?10, completed_at = ?11, updated_at = ?12
             WHERE id = ?13",
        )
        .bind(&next_title)
        .bind(&next_description)
        .bind(next_priority)
        .bind(&next_language_code)
        .bind(&next_target_date)
        .bind(next_daily_budget)
        .bind(&target_dims_json)
        .bind(next_threshold)
        .bind(&policy_json)
        .bind(next_status.as_str())
        .bind(&next_completed_at)
        .bind(&now)
        .bind(goal_id)
        .execute(&mut *tx)
        .await?;

        let event_type = if next_status == LearningGoalStatus::Completed
            && existing.status != LearningGoalStatus::Completed
        {
            LearningEventType::GoalCompleted
        } else {
            LearningEventType::GoalUpdated
        };
        let event_input = AppendLearningEventInput {
            idempotency_key: format!("goal_update:{}:{}", goal_id, Uuid::new_v4()),
            event_type,
            actor: Some("user".to_string()),
            surface: "today_dashboard".to_string(),
            session_id: None,
            goal_id: Some(goal_id.to_string()),
            entity_kind: "learning_goal".to_string(),
            entity_id: goal_id.to_string(),
            document_id: None,
            is_local_only: None,
            is_ai_excluded: None,
            payload: serde_json::json!({
                "status": next_status.as_str(),
                "title": next_title,
            }),
            occurred_at: Some(now.clone()),
            retracts_event_id: None,
        };
        LearningEventRepository::append_learning_event_tx(&mut tx, &event_input).await?;
        tx.commit().await?;

        self.get_learning_goal_detail(goal_id)
            .await?
            .ok_or_else(|| PlethoraError::Internal("Failed to reload updated goal".into()))
    }

    /// In-place goal evolution: preserves `id`, existing `sources`, and `milestones`
    /// while updating `kind`, `study_plan_id`, `target_date`, budget, dimensions, or policy.
    pub async fn evolve_learning_goal(
        &self,
        goal_id: &str,
        evolution: &EvolveLearningGoalInput,
    ) -> Result<LearningGoal> {
        let existing = self
            .get_learning_goal_detail(goal_id)
            .await?
            .ok_or_else(|| {
                PlethoraError::NotFound(format!("Learning goal '{}' not found", goal_id))
            })?;

        let now = Utc::now().to_rfc3339();
        let next_kind = evolution.kind.unwrap_or(existing.kind);
        let next_study_plan_id = match &evolution.study_plan_id {
            Some(sp) => sp.clone(),
            None => existing.study_plan_id.clone(),
        };
        let next_target_date = match &evolution.target_date {
            Some(td) => td.clone(),
            None => existing.target_date.clone(),
        };
        let next_daily_budget = match &evolution.daily_minutes_budget {
            Some(b) => *b,
            None => existing
                .daily_minutes_budget
                .or_else(|| next_kind.default_daily_minutes_budget()),
        };
        if let Some(budget) = next_daily_budget {
            if !(5..=480).contains(&budget) {
                return Err(PlethoraError::Validation(
                    "daily_minutes_budget must be between 5 and 480".to_string(),
                ));
            }
        }
        let next_target_dimensions = evolution
            .target_dimensions
            .clone()
            .unwrap_or_else(|| existing.target_dimensions.clone());
        let next_threshold = evolution
            .target_mastery_threshold
            .unwrap_or(existing.target_mastery_threshold);
        let next_language_code = match &evolution.language_code {
            Some(l) => l.clone(),
            None => existing.language_code.clone(),
        };

        let kind_policy = next_kind.default_policy_json();
        let merged_policy = merge_json_objects(&existing.policy, &kind_policy);
        let next_policy = match &evolution.policy {
            Some(p) => merge_json_objects(&merged_policy, p),
            None => merged_policy,
        };

        let target_dims_json = serde_json::to_string(&next_target_dimensions)?;
        let policy_json = serde_json::to_string(&next_policy)?;

        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "UPDATE learning_goals
             SET kind = ?1, study_plan_id = ?2, target_date = ?3,
                 daily_minutes_budget = ?4, target_dimensions_json = ?5,
                 target_mastery_threshold = ?6, language_code = ?7,
                 policy_json = ?8, updated_at = ?9
             WHERE id = ?10",
        )
        .bind(next_kind.as_str())
        .bind(&next_study_plan_id)
        .bind(&next_target_date)
        .bind(next_daily_budget)
        .bind(&target_dims_json)
        .bind(next_threshold)
        .bind(&next_language_code)
        .bind(&policy_json)
        .bind(&now)
        .bind(goal_id)
        .execute(&mut *tx)
        .await?;

        let event_input = AppendLearningEventInput {
            idempotency_key: format!("goal_evolved:{}:{}", goal_id, Uuid::new_v4()),
            event_type: LearningEventType::GoalUpdated,
            actor: Some("user".to_string()),
            surface: "today_dashboard".to_string(),
            session_id: None,
            goal_id: Some(goal_id.to_string()),
            entity_kind: "learning_goal".to_string(),
            entity_id: goal_id.to_string(),
            document_id: None,
            is_local_only: None,
            is_ai_excluded: None,
            payload: serde_json::json!({
                "evolved": true,
                "previousKind": existing.kind.as_str(),
                "nextKind": next_kind.as_str(),
                "studyPlanId": next_study_plan_id,
                "targetDate": next_target_date,
            }),
            occurred_at: Some(now.clone()),
            retracts_event_id: None,
        };
        LearningEventRepository::append_learning_event_tx(&mut tx, &event_input).await?;
        tx.commit().await?;

        self.get_learning_goal_detail(goal_id)
            .await?
            .ok_or_else(|| PlethoraError::Internal("Failed to reload evolved goal".into()))
    }

    /// Non-destructive deletion: cascades only `learning_goal_sources` and
    /// `learning_goal_milestones`, preserving documents, cards, concepts, and study plans.
    pub async fn delete_learning_goal(&self, goal_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM learning_goals WHERE id = ?1")
            .bind(goal_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn link_goal_source(
        &self,
        input: &LinkGoalSourceInput,
    ) -> Result<LearningGoalSource> {
        let role = input
            .source_role
            .unwrap_or_else(|| input.source_kind.default_role());
        validate_goal_source_link(input.source_kind, role)?;

        let weight = input.weight.unwrap_or(1.0);
        if !weight.is_finite() || weight <= 0.0 || weight > 5.0 {
            return Err(PlethoraError::Validation(
                "source weight must be in (0.0, 5.0]".to_string(),
            ));
        }

        let exists: Option<(String,)> =
            sqlx::query_as("SELECT id FROM learning_goals WHERE id = ?1")
                .bind(&input.goal_id)
                .fetch_optional(&self.pool)
                .await?;
        if exists.is_none() {
            return Err(PlethoraError::NotFound(format!(
                "Learning goal '{}' not found",
                input.goal_id
            )));
        }

        let id = format!("gsrc_{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO learning_goal_sources (
                id, goal_id, source_kind, source_id, source_role, weight, added_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(goal_id, source_kind, source_id) DO UPDATE SET
                source_role = excluded.source_role,
                weight = excluded.weight",
        )
        .bind(&id)
        .bind(&input.goal_id)
        .bind(input.source_kind.as_str())
        .bind(&input.source_id)
        .bind(role.as_str())
        .bind(weight)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        sqlx::query("UPDATE learning_goals SET updated_at = ?1 WHERE id = ?2")
            .bind(&now)
            .bind(&input.goal_id)
            .execute(&self.pool)
            .await?;

        let row = sqlx::query(
            "SELECT id, goal_id, source_kind, source_id, source_role, weight, added_at
             FROM learning_goal_sources
             WHERE goal_id = ?1 AND source_kind = ?2 AND source_id = ?3",
        )
        .bind(&input.goal_id)
        .bind(input.source_kind.as_str())
        .bind(&input.source_id)
        .fetch_one(&self.pool)
        .await?;

        Self::row_to_source(&row)
    }

    pub async fn unlink_goal_source(
        &self,
        goal_id: &str,
        source_kind: GoalSourceKind,
        source_id: &str,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "DELETE FROM learning_goal_sources
             WHERE goal_id = ?1 AND source_kind = ?2 AND source_id = ?3",
        )
        .bind(goal_id)
        .bind(source_kind.as_str())
        .bind(source_id)
        .execute(&self.pool)
        .await?;

        sqlx::query("UPDATE learning_goals SET updated_at = ?1 WHERE id = ?2")
            .bind(&now)
            .bind(goal_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn upsert_goal_milestone(
        &self,
        goal_id: &str,
        milestone: &UpsertGoalMilestoneInput,
    ) -> Result<LearningGoalMilestone> {
        let exists: Option<(String,)> =
            sqlx::query_as("SELECT id FROM learning_goals WHERE id = ?1")
                .bind(goal_id)
                .fetch_optional(&self.pool)
                .await?;
        if exists.is_none() {
            return Err(PlethoraError::NotFound(format!(
                "Learning goal '{}' not found",
                goal_id
            )));
        }

        let title = milestone.title.trim();
        if title.is_empty() {
            return Err(PlethoraError::Validation(
                "Milestone title cannot be empty".to_string(),
            ));
        }

        let now = Utc::now().to_rfc3339();
        let status = milestone
            .status
            .unwrap_or(LearningGoalMilestoneStatus::Pending);
        let id = milestone
            .id
            .clone()
            .unwrap_or_else(|| format!("gmile_{}", Uuid::new_v4()));

        let existing_completed_at: Option<Option<String>> = sqlx::query_scalar(
            "SELECT completed_at FROM learning_goal_milestones WHERE id = ?1 AND goal_id = ?2",
        )
        .bind(&id)
        .bind(goal_id)
        .fetch_optional(&self.pool)
        .await?;

        let completed_at = match status {
            LearningGoalMilestoneStatus::Completed => existing_completed_at
                .flatten()
                .or_else(|| Some(now.clone())),
            LearningGoalMilestoneStatus::Pending => None,
            LearningGoalMilestoneStatus::Skipped => existing_completed_at.flatten(),
        };

        let sort_order = match milestone.sort_order {
            Some(order) => order,
            None => {
                let count: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM learning_goal_milestones WHERE goal_id = ?1",
                )
                .bind(goal_id)
                .fetch_one(&self.pool)
                .await?;
                count
            }
        };

        sqlx::query(
            "INSERT INTO learning_goal_milestones (
                id, goal_id, title, target_date, status, linked_node_id,
                sort_order, completed_at, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                target_date = excluded.target_date,
                status = excluded.status,
                linked_node_id = excluded.linked_node_id,
                sort_order = excluded.sort_order,
                completed_at = excluded.completed_at,
                updated_at = excluded.updated_at",
        )
        .bind(&id)
        .bind(goal_id)
        .bind(title)
        .bind(&milestone.target_date)
        .bind(status.as_str())
        .bind(&milestone.linked_node_id)
        .bind(sort_order)
        .bind(&completed_at)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        sqlx::query("UPDATE learning_goals SET updated_at = ?1 WHERE id = ?2")
            .bind(&now)
            .bind(goal_id)
            .execute(&self.pool)
            .await?;

        let row = sqlx::query(
            "SELECT id, goal_id, title, target_date, status, linked_node_id,
                    sort_order, completed_at, created_at, updated_at
             FROM learning_goal_milestones
             WHERE id = ?1",
        )
        .bind(&id)
        .fetch_one(&self.pool)
        .await?;

        Self::row_to_milestone(&row)
    }

    pub async fn list_goals_for_source(
        &self,
        source_kind: GoalSourceKind,
        source_id: &str,
    ) -> Result<Vec<LearningGoal>> {
        let rows = sqlx::query(
            "SELECT g.id, g.title, g.description, g.kind, g.status, g.priority, g.study_plan_id,
                    g.language_code, g.target_date, g.daily_minutes_budget,
                    g.target_dimensions_json, g.target_mastery_threshold, g.policy_json,
                    g.created_at, g.updated_at, g.completed_at
             FROM learning_goals g
             JOIN learning_goal_sources s ON s.goal_id = g.id
             WHERE s.source_kind = ?1 AND s.source_id = ?2
             ORDER BY g.priority DESC, g.updated_at DESC",
        )
        .bind(source_kind.as_str())
        .bind(source_id)
        .fetch_all(&self.pool)
        .await?;

        let mut goals = Vec::with_capacity(rows.len());
        for row in &rows {
            goals.push(self.hydrate_goal_row(row).await?);
        }
        Ok(goals)
    }

    pub async fn get_learning_goal_feasibility(
        &self,
        goal_id: &str,
        context: Option<&EvaluateGoalFeasibilityContext>,
    ) -> Result<GoalFeasibilityReport> {
        let goal = self
            .get_learning_goal_detail(goal_id)
            .await?
            .ok_or_else(|| {
                PlethoraError::NotFound(format!("Learning goal '{}' not found", goal_id))
            })?;

        let now_iso = context
            .and_then(|c| c.now_iso.clone())
            .unwrap_or_else(|| Utc::now().to_rfc3339());

        let concept_states: Vec<GoalConceptFeasibilityInput> = match context
            .and_then(|c| c.concept_states.as_ref())
        {
            Some(states) => states.clone(),
            None => {
                let mut states = Vec::new();
                for src in goal
                    .sources
                    .iter()
                    .filter(|s| s.source_kind == GoalSourceKind::Concept)
                {
                    let proj_rows = sqlx::query(
                        "SELECT dimension, status, estimate, confidence, last_evidence_at
                         FROM competency_projections
                         WHERE concept_id = ?1",
                    )
                    .bind(&src.source_id)
                    .fetch_all(&self.pool)
                    .await?;

                    let mut dimensions = HashMap::new();
                    for row in proj_rows {
                        let dim_str: String = row.try_get("dimension")?;
                        let status_str: String = row.try_get("status")?;
                        if let (Ok(dim), Ok(status)) = (
                            CompetencyDimension::from_db_str(&dim_str),
                            CompetencyStatus::from_db_str(&status_str),
                        ) {
                            dimensions.insert(
                                dim,
                                GoalDimensionProjection {
                                    dimension: dim,
                                    status,
                                    estimate: row.try_get("estimate")?,
                                    confidence: row.try_get("confidence")?,
                                    last_evidence_at: row.try_get("last_evidence_at")?,
                                },
                            );
                        }
                    }

                    states.push(GoalConceptFeasibilityInput {
                        concept_id: src.source_id.clone(),
                        estimated_minutes_to_master: 30.0 * src.weight,
                        priority: Some(50),
                        dimensions,
                    });
                }
                states
            }
        };

        let reading_mins = context
            .and_then(|c| c.uncompleted_reading_minutes)
            .unwrap_or(0.0);
        let review_mins = context
            .and_then(|c| c.projected_due_review_minutes)
            .unwrap_or(0.0);

        Ok(evaluate_goal_feasibility(
            &goal,
            &concept_states,
            reading_mins,
            review_mins,
            &now_iso,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::learning_event_repository::LearningEventRepository;
    use crate::database::migrations::run_migrations;
    use crate::database::Repository;
    use crate::models::learning_event::LearningEventFilter;
    use crate::models::learning_goal::CreateLearningGoalSourceInput;
    use crate::models::{Document, FileType};
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_pool() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn goal_lifecycle_evolution_sharing_and_non_destructive_delete() {
        let pool = setup_pool().await;
        let main_repo = Repository::new(pool.clone());
        let goal_repo = LearningGoalRepository::new(pool.clone());
        let event_repo = LearningEventRepository::new(pool.clone());

        // Create a real document shared by two goals
        let doc = Document::new("Linear Algebra".into(), "la.pdf".into(), FileType::Pdf);
        main_repo.create_document(&doc).await.unwrap();

        // Create Goal A (exploration)
        let goal_a = goal_repo
            .create_learning_goal(&CreateLearningGoalInput {
                title: "Explore Linear Algebra".into(),
                description: None,
                kind: Some(LearningGoalKind::Exploration),
                priority: Some(70),
                study_plan_id: None,
                language_code: None,
                target_date: None,
                daily_minutes_budget: None,
                target_dimensions: None,
                target_mastery_threshold: None,
                policy: None,
                initial_sources: Some(vec![CreateLearningGoalSourceInput {
                    source_kind: GoalSourceKind::Document,
                    source_id: doc.id.clone(),
                    source_role: Some(GoalSourceRole::Primary),
                    weight: Some(1.0),
                }]),
            })
            .await
            .unwrap();
        assert_eq!(goal_a.kind, LearningGoalKind::Exploration);
        assert_eq!(goal_a.sources.len(), 1);

        // Create Goal B referencing the SAME document (zero duplication)
        let goal_b = goal_repo
            .create_learning_goal(&CreateLearningGoalInput {
                title: "ML Foundations".into(),
                description: None,
                kind: Some(LearningGoalKind::Mastery),
                priority: Some(80),
                study_plan_id: None,
                language_code: None,
                target_date: None,
                daily_minutes_budget: Some(45),
                target_dimensions: None,
                target_mastery_threshold: None,
                policy: None,
                initial_sources: Some(vec![CreateLearningGoalSourceInput {
                    source_kind: GoalSourceKind::Document,
                    source_id: doc.id.clone(),
                    source_role: Some(GoalSourceRole::Primary),
                    weight: Some(1.0),
                }]),
            })
            .await
            .unwrap();

        let goals_for_doc = goal_repo
            .list_goals_for_source(GoalSourceKind::Document, &doc.id)
            .await
            .unwrap();
        assert_eq!(goals_for_doc.len(), 2);

        // Evolve Goal A in-place from exploration -> deadline
        let evolved = goal_repo
            .evolve_learning_goal(
                &goal_a.id,
                &EvolveLearningGoalInput {
                    kind: Some(LearningGoalKind::Deadline),
                    target_date: Some(Some("2026-12-20T00:00:00Z".into())),
                    daily_minutes_budget: Some(Some(60)),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(evolved.id, goal_a.id, "Evolution must preserve goal ID");
        assert_eq!(evolved.kind, LearningGoalKind::Deadline);
        assert_eq!(evolved.sources.len(), 1, "Evolution must preserve linked sources");

        // Verify goal_updated event was emitted
        let events = event_repo
            .list_learning_events(&LearningEventFilter {
                goal_id: Some(goal_a.id.clone()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert!(events
            .iter()
            .any(|e| e.event_type == LearningEventType::GoalCreated));
        assert!(events
            .iter()
            .any(|e| e.event_type == LearningEventType::GoalUpdated));

        // Upsert milestone on Goal A
        let ms = goal_repo
            .upsert_goal_milestone(
                &goal_a.id,
                &UpsertGoalMilestoneInput {
                    id: None,
                    title: "Finish eigenvalues chapter".into(),
                    target_date: Some("2026-12-05T00:00:00Z".into()),
                    status: Some(LearningGoalMilestoneStatus::Pending),
                    linked_node_id: None,
                    sort_order: Some(0),
                },
            )
            .await
            .unwrap();
        assert_eq!(ms.goal_id, goal_a.id);

        // Delete Goal A -> cascades its links/milestones ONLY, preserving Goal B and the Document
        goal_repo.delete_learning_goal(&goal_a.id).await.unwrap();
        assert!(goal_repo
            .get_learning_goal_detail(&goal_a.id)
            .await
            .unwrap()
            .is_none());
        assert!(goal_repo
            .get_learning_goal_detail(&goal_b.id)
            .await
            .unwrap()
            .is_some());
        assert!(main_repo.get_document(&doc.id).await.unwrap().is_some());

        let fk_violations: Vec<(String, i64, String, i64)> =
            sqlx::query_as("PRAGMA foreign_key_check")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(fk_violations.is_empty());
    }

    #[tokio::test]
    async fn smart_feed_boundary_and_unique_source_link() {
        let pool = setup_pool().await;
        let goal_repo = LearningGoalRepository::new(pool);

        let goal = goal_repo
            .create_learning_goal(&CreateLearningGoalInput {
                title: "AI Research Radar".into(),
                description: None,
                kind: Some(LearningGoalKind::Continuous),
                priority: None,
                study_plan_id: None,
                language_code: None,
                target_date: None,
                daily_minutes_budget: None,
                target_dimensions: None,
                target_mastery_threshold: None,
                policy: None,
                initial_sources: None,
            })
            .await
            .unwrap();

        // Smart feed with primary role MUST be rejected
        let bad_sf = goal_repo
            .link_goal_source(&LinkGoalSourceInput {
                goal_id: goal.id.clone(),
                source_kind: GoalSourceKind::SmartFeed,
                source_id: "sf-1".into(),
                source_role: Some(GoalSourceRole::Primary),
                weight: None,
            })
            .await;
        assert!(bad_sf.is_err());

        // Smart feed with exploration_candidate succeeds, and re-linking updates in-place (no duplicate)
        let sf1 = goal_repo
            .link_goal_source(&LinkGoalSourceInput {
                goal_id: goal.id.clone(),
                source_kind: GoalSourceKind::SmartFeed,
                source_id: "sf-1".into(),
                source_role: Some(GoalSourceRole::ExplorationCandidate),
                weight: Some(1.0),
            })
            .await
            .unwrap();
        let sf2 = goal_repo
            .link_goal_source(&LinkGoalSourceInput {
                goal_id: goal.id.clone(),
                source_kind: GoalSourceKind::SmartFeed,
                source_id: "sf-1".into(),
                source_role: Some(GoalSourceRole::ExplorationCandidate),
                weight: Some(2.0),
            })
            .await
            .unwrap();
        assert_eq!(sf1.id, sf2.id);
        assert!((sf2.weight - 2.0).abs() < 1e-6);

        let reloaded = goal_repo
            .get_learning_goal_detail(&goal.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(reloaded.sources.len(), 1);
    }

    #[test]
    fn feasibility_reuses_prior_mastery_and_suggests_adjustments() {
        let goal = LearningGoal {
            id: "g-1".into(),
            title: "Exam Prep".into(),
            description: None,
            kind: LearningGoalKind::Deadline,
            status: LearningGoalStatus::Active,
            priority: 90,
            study_plan_id: None,
            language_code: None,
            target_date: Some("2026-12-03T12:00:00Z".into()), // 5 days from now
            daily_minutes_budget: Some(30),                    // 150 available mins
            target_dimensions: vec![
                CompetencyDimension::Comprehension,
                CompetencyDimension::Retention,
            ],
            target_mastery_threshold: 0.80,
            policy: serde_json::json!({}),
            created_at: "2026-11-28T12:00:00Z".into(),
            updated_at: "2026-11-28T12:00:00Z".into(),
            completed_at: None,
            sources: vec![],
            milestones: vec![],
        };

        let mut mastered_dims = HashMap::new();
        mastered_dims.insert(
            CompetencyDimension::Comprehension,
            GoalDimensionProjection {
                dimension: CompetencyDimension::Comprehension,
                status: CompetencyStatus::Demonstrated,
                estimate: Some(0.92),
                confidence: Some(0.85),
                last_evidence_at: None,
            },
        );
        mastered_dims.insert(
            CompetencyDimension::Retention,
            GoalDimensionProjection {
                dimension: CompetencyDimension::Retention,
                status: CompetencyStatus::Demonstrated,
                estimate: Some(0.88),
                confidence: Some(0.80),
                last_evidence_at: None,
            },
        );

        let concept_states = vec![
            GoalConceptFeasibilityInput {
                concept_id: "c-mastered".into(),
                estimated_minutes_to_master: 120.0,
                priority: Some(80),
                dimensions: mastered_dims,
            },
            GoalConceptFeasibilityInput {
                concept_id: "c-new".into(),
                estimated_minutes_to_master: 240.0,
                priority: Some(60),
                dimensions: HashMap::new(),
            },
        ];

        let report = evaluate_goal_feasibility(
            &goal,
            &concept_states,
            0.0,
            0.0,
            "2026-11-28T12:00:00Z",
        );
        assert_eq!(report.prior_mastered_concept_count, 1);
        assert_eq!(report.remaining_concept_minutes, 240);
        assert_eq!(report.status, GoalFeasibilityStatus::Infeasible);
        assert!(report
            .recommendations
            .iter()
            .any(|r| r.kind == GoalAdjustmentKind::IncreaseDailyBudget));
        assert!(report
            .recommendations
            .iter()
            .any(|r| r.kind == GoalAdjustmentKind::ExtendDeadline));
    }
}
