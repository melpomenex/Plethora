//! Study plan persistence, draft editing, version history, and CAS state transitions.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §3, §11, §12
//! - openspec/planning/study-plans-assessments-program/04-DATA-AND-MIGRATION-PLAN.md §3
//! - openspec/changes/establish-persistent-study-plans/

use super::study_source_repository::{
    compute_excerpt_sha256, compute_sha256, StudySourceRepository,
};
use crate::models::study_plan::{
    CreateStudyPlanInput, LegacyImportResult, LibraryKnowledgePolicy, LockConflict,
    MaterialSupport, NodeActivity, PlanPrerequisite, PlanVersionDiff, PlanVersionState,
    SaveStudyPlanDraftInput, StudyDepth, StudyPlan, StudyPlanDetail, StudyPlanKnowledgeAuthority,
    StudyPlanPreferences, StudyPlanStatus, StudyPlanSummary, StudyPlanVersion, StudyPlanVersionNode,
};
use crate::models::study_source::{
    FieldIssue, RevisionKind, StudyCommandError, StudyCommandErrorDetails, StudyErrorCode,
    StudySourceRefInput, StudySourceStatus,
};
use chrono::Utc;
use sqlx::{Pool, Row, Sqlite};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

pub const MAX_PLAN_TITLE_CHARS: usize = 120;
pub const MAX_PLAN_GOAL_CHARS: usize = 200;
pub const MAX_MANUAL_NODES: usize = 100;
pub const MAX_NODE_TITLE_CHARS: usize = 160;
pub const MAX_NODE_SUMMARY_CHARS: usize = 1000;
pub const MAX_OBJECTIVES_COUNT: usize = 6;
pub const MAX_OBJECTIVE_CHARS: usize = 240;

fn has_resolved_documents(scope: Option<&serde_json::Value>) -> bool {
    scope
        .and_then(|value| value.get("resolvedDocuments"))
        .and_then(serde_json::Value::as_array)
        .is_some_and(|documents| !documents.is_empty())
}

fn default_knowledge_authority(scope: Option<&serde_json::Value>) -> StudyPlanKnowledgeAuthority {
    if has_resolved_documents(scope) {
        StudyPlanKnowledgeAuthority::Library {
            policy: LibraryKnowledgePolicy::SourceOnly,
        }
    } else {
        StudyPlanKnowledgeAuthority::Manual
    }
}

fn validate_knowledge_authority(
    authority: &StudyPlanKnowledgeAuthority,
    scope: Option<&serde_json::Value>,
) -> Result<(), StudyCommandError> {
    let valid = match authority {
        StudyPlanKnowledgeAuthority::Library { .. } => has_resolved_documents(scope),
        StudyPlanKnowledgeAuthority::ModelOnly => scope.is_none(),
        StudyPlanKnowledgeAuthority::Manual => true,
    };
    if valid {
        return Ok(());
    }
    Err(StudyCommandError::invalid_input(
        "study_plan.error.invalid_knowledge_authority_scope",
        vec![FieldIssue {
            path: "knowledgeAuthority".to_string(),
            code: "invalid_knowledge_authority_scope".to_string(),
            message_key: "study_plan.error.invalid_knowledge_authority_scope".to_string(),
        }],
    ))
}

fn validate_publishable_plan(detail: &StudyPlanDetail) -> Result<(), StudyCommandError> {
    let version = &detail.version;
    validate_knowledge_authority(&version.knowledge_authority, version.source_scope.as_ref())?;
    if matches!(
        version.knowledge_authority,
        StudyPlanKnowledgeAuthority::ModelOnly
    ) && (version.nodes.iter().any(|node| {
        node.material_support == MaterialSupport::Grounded || !node.source_ref_ids.is_empty()
    }) || version
        .prerequisites
        .iter()
        .any(|edge| !edge.source_ref_ids.is_empty()))
    {
        return Err(StudyCommandError::new(
            StudyErrorCode::InvalidSource,
            "study_plan.error.model_only_contains_library_evidence",
            false,
        ));
    }
    // Enforce the library policy at publication: source-only plans must not
    // publish AI-supplement (unsupported) topics or prerequisite edges as if
    // they were verified library content.
    let is_source_only = matches!(
        version.knowledge_authority,
        StudyPlanKnowledgeAuthority::Library {
            policy: LibraryKnowledgePolicy::SourceOnly
        }
    );
    if is_source_only {
        if let Some(node) = version
            .nodes
            .iter()
            .find(|node| node.included && node.material_support == MaterialSupport::Unsupported)
        {
            return Err(StudyCommandError::new(
                StudyErrorCode::InvalidSource,
                "study_plan.error.source_only_unsupported_node",
                false,
            ));
        }
        if let Some(edge) = version
            .prerequisites
            .iter()
            .find(|edge| edge.support == "unsupported")
        {
            return Err(StudyCommandError::new(
                StudyErrorCode::InvalidSource,
                "study_plan.error.source_only_unsupported_prerequisite",
                false,
            ));
        }
    }
    let mut indegree = HashMap::new();
    for node in version.nodes.iter().filter(|node| node.included) {
        if node.title.trim().is_empty()
            || node.title.chars().count() > MAX_NODE_TITLE_CHARS
            || node.summary.chars().count() > MAX_NODE_SUMMARY_CHARS
            || node.learning_objectives.is_empty()
            || node.learning_objectives.len() > MAX_OBJECTIVES_COUNT
            || node.learning_objectives.iter().any(|objective| {
                objective.trim().is_empty() || objective.chars().count() > MAX_OBJECTIVE_CHARS
            })
        {
            return Err(StudyCommandError::invalid_input(
                "study_plan.error.invalid_topic",
                vec![],
            ));
        }
        if node.material_support == MaterialSupport::Grounded
            && (node.source_ref_ids.is_empty()
                || node.source_ref_ids.iter().any(|id| {
                    !detail
                        .source_refs
                        .get(id)
                        .is_some_and(|source| source.status == StudySourceStatus::Current)
                }))
        {
            return Err(StudyCommandError::new(
                StudyErrorCode::InvalidSource,
                "study_plan.error.unverified_topic_source",
                false,
            ));
        }
        indegree.insert(node.node_id.as_str(), 0usize);
    }

    let mut dependents = HashMap::<&str, Vec<&str>>::new();
    for edge in &version.prerequisites {
        let from = edge.prerequisite_node_id.as_str();
        let to = edge.dependent_node_id.as_str();
        if !indegree.contains_key(from) || !indegree.contains_key(to) {
            return Err(StudyCommandError::new(
                StudyErrorCode::DanglingPrerequisite,
                "study_plan.error.dangling_prerequisite",
                false,
            ));
        }
        *indegree.get_mut(to).expect("dependent was validated") += 1;
        dependents.entry(from).or_default().push(to);
    }

    let mut ready = indegree
        .iter()
        .filter_map(|(node, count)| (*count == 0).then_some(*node))
        .collect::<Vec<_>>();
    let mut visited = 0;
    while let Some(node) = ready.pop() {
        visited += 1;
        for &dependent in dependents.get(node).into_iter().flatten() {
            if let Some(count) = indegree.get_mut(dependent) {
                *count -= 1;
                if *count == 0 {
                    ready.push(dependent);
                }
            }
        }
    }
    if visited != indegree.len() {
        return Err(StudyCommandError::new(
            StudyErrorCode::DependencyCycle,
            "study_plan.error.dependency_cycle",
            false,
        ));
    }
    Ok(())
}

#[derive(Clone)]
pub struct StudyPlanRepository {
    pool: Pool<Sqlite>,
    source_repo: StudySourceRepository,
}

impl StudyPlanRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        let source_repo = StudySourceRepository::new(pool.clone());
        Self { pool, source_repo }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    /// Creates a new Study Plan with an initial Draft version atomically.
    pub async fn create_study_plan(
        &self,
        input: CreateStudyPlanInput,
    ) -> Result<StudyPlanDetail, StudyCommandError> {
        let title = input.title.trim();
        if title.is_empty() || title.len() > MAX_PLAN_TITLE_CHARS {
            return Err(StudyCommandError::invalid_input(
                "study_plan.error.invalid_title_length",
                vec![FieldIssue {
                    path: "title".to_string(),
                    code: "invalid_title_length".to_string(),
                    message_key: "study_plan.error.invalid_title_length".to_string(),
                }],
            ));
        }

        let goal = input.goal.trim();
        if goal.is_empty() || goal.len() > MAX_PLAN_GOAL_CHARS {
            return Err(StudyCommandError::invalid_input(
                "study_plan.error.invalid_goal_length",
                vec![FieldIssue {
                    path: "goal".to_string(),
                    code: "invalid_goal_length".to_string(),
                    message_key: "study_plan.error.invalid_goal_length".to_string(),
                }],
            ));
        }

        let plan_id = format!("sp_{}", Uuid::new_v4());
        let draft_version_id = format!("spv_{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();
        let depth_str = input.depth.to_string();

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        // 1. Create study_plan with NULL version pointers initially to satisfy FKs
        sqlx::query(
            "INSERT INTO study_plans (
                id, title, goal, depth, status, current_version_id, draft_version_id,
                current_version, revision, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, 'active', NULL, NULL, 0, 1, ?5, ?5)",
        )
        .bind(&plan_id)
        .bind(title)
        .bind(goal)
        .bind(&depth_str)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        // 2. Create study_plan_versions for initial draft
        let authority = input
            .knowledge_authority
            .clone()
            .unwrap_or_else(|| default_knowledge_authority(input.source_scope.as_ref()));
        validate_knowledge_authority(&authority, input.source_scope.as_ref())?;
        let scope_json =
            serde_json::to_string(&input.source_scope).unwrap_or_else(|_| "null".to_string());
        let authority_json = serde_json::to_string(&authority)
            .unwrap_or_else(|_| "{\"kind\":\"manual\"}".to_string());
        sqlx::query(
            "INSERT INTO study_plan_versions (
                id, plan_id, version, state, base_version_id, source_scope_json, knowledge_authority_json,
                change_summary_json, created_by, created_at, published_at
             ) VALUES (?1, ?2, 1, 'draft', NULL, ?3, ?4, NULL, 'user', ?5, NULL)",
        )
        .bind(&draft_version_id)
        .bind(&plan_id)
        .bind(&scope_json)
        .bind(&authority_json)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        // 3. Insert initial nodes and prerequisites if provided
        if let Some(nodes) = input.initial_nodes {
            if nodes.len() > MAX_MANUAL_NODES {
                return Err(StudyCommandError::invalid_input(
                    "study_plan.error.max_nodes_exceeded",
                    vec![FieldIssue {
                        path: "initialNodes".to_string(),
                        code: "max_nodes_exceeded".to_string(),
                        message_key: "study_plan.error.max_nodes_exceeded".to_string(),
                    }],
                ));
            }

            for node in &nodes {
                let node_id = if node.node_id.starts_with("spn_") {
                    node.node_id.clone()
                } else {
                    format!("spn_{}", Uuid::new_v4())
                };

                let sem_key = compute_node_semantic_key(
                    node.concept_id.as_deref(),
                    &node.title,
                    node.learning_objectives.first().map(|s| s.as_str()),
                );

                sqlx::query(
                    "INSERT INTO study_plan_nodes (id, plan_id, semantic_key, created_at)
                     VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(plan_id, semantic_key) DO NOTHING",
                )
                .bind(&node_id)
                .bind(&plan_id)
                .bind(&sem_key)
                .bind(&now)
                .execute(&mut *tx)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

                let objectives_json = serde_json::to_string(&node.learning_objectives)
                    .unwrap_or_else(|_| "[]".to_string());
                let mat_support = node.material_support.to_string();

                sqlx::query(
                    "INSERT INTO study_plan_version_nodes (
                        version_id, node_id, title, summary, learning_objectives_json,
                        concept_id, concept_label, position, included, locked, user_added,
                        user_modified, material_support, why_here
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                )
                .bind(&draft_version_id)
                .bind(&node_id)
                .bind(&node.title)
                .bind(&node.summary)
                .bind(&objectives_json)
                .bind(node.concept_id.as_deref())
                .bind(&node.concept_label)
                .bind(node.position)
                .bind(if node.included { 1 } else { 0 })
                .bind(if node.locked { 1 } else { 0 })
                .bind(if node.user_added { 1 } else { 0 })
                .bind(if node.user_modified { 1 } else { 0 })
                .bind(&mat_support)
                .bind(node.why_here.as_deref())
                .execute(&mut *tx)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

                for (ord, ref_id) in node.source_ref_ids.iter().enumerate() {
                    sqlx::query(
                        "INSERT INTO study_plan_node_sources (version_id, node_id, source_ref_id, ordinal, role)
                         VALUES (?1, ?2, ?3, ?4, 'primary')",
                    )
                    .bind(&draft_version_id)
                    .bind(&node_id)
                    .bind(ref_id)
                    .bind(ord as i32)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
                }

                sqlx::query(
                    "INSERT INTO study_plan_node_activity (plan_id, node_id, activity, updated_at)
                     VALUES (?1, ?2, 'not-started', ?3)
                     ON CONFLICT(plan_id, node_id) DO NOTHING",
                )
                .bind(&plan_id)
                .bind(&node_id)
                .bind(&now)
                .execute(&mut *tx)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
            }
        }

        if let Some(prereqs) = input.initial_prerequisites {
            for prereq in &prereqs {
                sqlx::query(
                    "INSERT INTO study_plan_prerequisites (
                        version_id, prerequisite_node_id, dependent_node_id, support, rationale
                     ) VALUES (?1, ?2, ?3, ?4, ?5)",
                )
                .bind(&draft_version_id)
                .bind(&prereq.prerequisite_node_id)
                .bind(&prereq.dependent_node_id)
                .bind(&prereq.support)
                .bind(prereq.rationale.as_deref())
                .execute(&mut *tx)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

                for (ord, ref_id) in prereq.source_ref_ids.iter().enumerate() {
                    sqlx::query(
                        "INSERT INTO study_plan_prerequisite_sources (
                            version_id, prerequisite_node_id, dependent_node_id, source_ref_id, ordinal
                         ) VALUES (?1, ?2, ?3, ?4, ?5)",
                    )
                    .bind(&draft_version_id)
                    .bind(&prereq.prerequisite_node_id)
                    .bind(&prereq.dependent_node_id)
                    .bind(ref_id)
                    .bind(ord as i32)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
                }
            }
        }

        // 4. Update study_plans pointing draft_version_id to initial draft
        sqlx::query("UPDATE study_plans SET draft_version_id = ?1 WHERE id = ?2")
            .bind(&draft_version_id)
            .bind(&plan_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        tx.commit()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        self.get_study_plan(&plan_id, Some(&draft_version_id)).await
    }

    /// Lists study plan summaries.
    /// Reads the optional per-plan preferences (backward-compatible default).
    pub async fn get_study_plan_preferences(
        &self,
        plan_id: &str,
    ) -> Result<StudyPlanPreferences, StudyCommandError> {
        let row = sqlx::query("SELECT preferences_json FROM study_plans WHERE id = ?1 LIMIT 1")
            .bind(plan_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        let row = row.ok_or_else(|| {
            StudyCommandError::new(
                StudyErrorCode::NotFound,
                "study_plan.error.plan_not_found",
                false,
            )
        })?;
        let raw: String = row.get("preferences_json");
        Ok(serde_json::from_str(&raw).unwrap_or_default())
    }

    /// Updates preferences without touching plan versions, activity or history.
    /// A passed deadline is preserved as history and never mutated implicitly.
    pub async fn update_study_plan_preferences(
        &self,
        plan_id: &str,
        preferences: StudyPlanPreferences,
    ) -> Result<StudyPlanPreferences, StudyCommandError> {
        if let Some(ref deadline) = preferences.deadline {
            if chrono::NaiveDate::parse_from_str(deadline, "%Y-%m-%d").is_err() {
                return Err(StudyCommandError::invalid_input(
                    "study_plan.error.invalid_deadline",
                    vec![FieldIssue {
                        path: "preferences.deadline".to_string(),
                        code: "invalid_deadline".to_string(),
                        message_key: "study_plan.error.invalid_deadline".to_string(),
                    }],
                ));
            }
        }
        let mut days = preferences.rest_days.clone();
        days.sort_unstable();
        days.dedup();
        if days.iter().any(|d| *d > 6) {
            return Err(StudyCommandError::invalid_input(
                "study_plan.error.invalid_rest_day",
                vec![FieldIssue {
                    path: "preferences.restDays".to_string(),
                    code: "invalid_rest_day".to_string(),
                    message_key: "study_plan.error.invalid_rest_day".to_string(),
                }],
            ));
        }
        let normalized = StudyPlanPreferences {
            deadline: preferences.deadline,
            rest_days: days,
        };
        let payload = serde_json::to_string(&normalized)
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        let now = Utc::now().to_rfc3339();
        let updated = sqlx::query(
            "UPDATE study_plans SET preferences_json = ?1, updated_at = ?2 WHERE id = ?3",
        )
        .bind(payload)
        .bind(now)
        .bind(plan_id)
        .execute(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        if updated.rows_affected() == 0 {
            return Err(StudyCommandError::new(
                StudyErrorCode::NotFound,
                "study_plan.error.plan_not_found",
                false,
            ));
        }
        Ok(normalized)
    }

    /// Lists study plan summaries.
    pub async fn list_study_plans(
        &self,
        include_archived: bool,
    ) -> Result<Vec<StudyPlanSummary>, StudyCommandError> {
        let sql = if include_archived {
            "SELECT id, title, goal, depth, status, current_version, revision, current_version_id, draft_version_id, updated_at
             FROM study_plans ORDER BY updated_at DESC"
        } else {
            "SELECT id, title, goal, depth, status, current_version, revision, current_version_id, draft_version_id, updated_at
             FROM study_plans WHERE status = 'active' ORDER BY updated_at DESC"
        };

        let rows = sqlx::query(sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let mut summaries = Vec::with_capacity(rows.len());

        for r in rows {
            let plan_id: String = r.get("id");
            let title: String = r.get("title");
            let goal: String = r.get("goal");
            let depth_str: String = r.get("depth");
            let status_str: String = r.get("status");
            let current_version: i64 = r.get("current_version");
            let revision: i64 = r.get("revision");
            let current_version_id: Option<String> = r.get("current_version_id");
            let draft_version_id: Option<String> = r.get("draft_version_id");
            let updated_at: String = r.get("updated_at");

            let active_version_id = current_version_id.as_ref().or(draft_version_id.as_ref());

            let node_count: i64 = if let Some(v_id) = active_version_id {
                sqlx::query_scalar(
                    "SELECT COUNT(*) FROM study_plan_version_nodes WHERE version_id = ?1 AND included = 1",
                )
                .bind(v_id)
                .fetch_one(&self.pool)
                .await
                .unwrap_or(0)
            } else {
                0
            };

            let completed_node_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM study_plan_node_activity WHERE plan_id = ?1 AND activity = 'completed'",
            )
            .bind(&plan_id)
            .fetch_one(&self.pool)
            .await
            .unwrap_or(0);

            let source_document_count: i64 = if let Some(v_id) = active_version_id {
                sqlx::query_scalar(
                    "SELECT COUNT(DISTINCT document_id) FROM study_source_refs
                     WHERE id IN (
                         SELECT source_ref_id FROM study_plan_node_sources WHERE version_id = ?1
                     )",
                )
                .bind(v_id)
                .fetch_one(&self.pool)
                .await
                .unwrap_or(0)
            } else {
                0
            };

            summaries.push(StudyPlanSummary {
                id: plan_id,
                title,
                goal,
                depth: depth_str.parse().unwrap_or(StudyDepth::Foundational),
                status: status_str.parse().unwrap_or(StudyPlanStatus::Active),
                current_version,
                revision,
                node_count,
                completed_node_count,
                source_document_count,
                has_draft: draft_version_id.is_some(),
                updated_at,
            });
        }

        Ok(summaries)
    }

    /// Fetches a full StudyPlanDetail including version, nodes, prerequisites, activity, and source refs.
    pub async fn get_study_plan(
        &self,
        plan_id: &str,
        version_id: Option<&str>,
    ) -> Result<StudyPlanDetail, StudyCommandError> {
        let plan_row = sqlx::query(
            "SELECT id, title, goal, depth, status, current_version_id, draft_version_id,
                    current_version, revision, created_at, updated_at
             FROM study_plans WHERE id = ?1 LIMIT 1",
        )
        .bind(plan_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let plan_row = plan_row
            .ok_or_else(|| StudyCommandError::not_found("study_plan.error.plan_not_found"))?;

        let depth_str: String = plan_row.get("depth");
        let status_str: String = plan_row.get("status");
        let current_version_id: Option<String> = plan_row.get("current_version_id");
        let draft_version_id: Option<String> = plan_row.get("draft_version_id");

        let plan = StudyPlan {
            id: plan_row.get("id"),
            title: plan_row.get("title"),
            goal: plan_row.get("goal"),
            depth: depth_str.parse().unwrap_or(StudyDepth::Foundational),
            status: status_str.parse().unwrap_or(StudyPlanStatus::Active),
            current_version_id: current_version_id.clone(),
            current_version: plan_row.get("current_version"),
            draft_version_id: draft_version_id.clone(),
            revision: plan_row.get("revision"),
            created_at: plan_row.get("created_at"),
            updated_at: plan_row.get("updated_at"),
        };

        // Determine target version id
        let target_version_id = if let Some(v_id) = version_id {
            v_id.to_string()
        } else if let Some(ref d_id) = draft_version_id {
            d_id.clone()
        } else if let Some(ref c_id) = current_version_id {
            c_id.clone()
        } else {
            return Err(StudyCommandError::not_found(
                "study_plan.error.no_version_found",
            ));
        };

        // Fetch version row
        let version_row = sqlx::query(
            "SELECT id, plan_id, version, state, base_version_id, source_scope_json, knowledge_authority_json,
                    change_summary_json, created_by, created_at, published_at
             FROM study_plan_versions WHERE id = ?1 AND plan_id = ?2 LIMIT 1",
        )
        .bind(&target_version_id)
        .bind(plan_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let version_row = version_row
            .ok_or_else(|| StudyCommandError::not_found("study_plan.error.version_not_found"))?;

        let state_str: String = version_row.get("state");
        let scope_json: String = version_row.get("source_scope_json");
        let scope_value = serde_json::from_str::<serde_json::Value>(&scope_json)
            .unwrap_or(serde_json::Value::Null);
        let source_scope = (!scope_value.is_null()).then_some(scope_value);
        let authority_json: String = version_row.get("knowledge_authority_json");
        let knowledge_authority = serde_json::from_str(&authority_json)
            .unwrap_or_else(|_| default_knowledge_authority(source_scope.as_ref()));
        let diff_json: Option<String> = version_row.get("change_summary_json");

        // Hydrate version nodes
        let node_rows = sqlx::query(
            "SELECT node_id, title, summary, learning_objectives_json, concept_id, concept_label,
                    position, included, locked, user_added, user_modified, material_support, why_here
             FROM study_plan_version_nodes WHERE version_id = ?1 ORDER BY position ASC",
        )
        .bind(&target_version_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        // Hydrate node sources
        let node_source_rows = sqlx::query(
            "SELECT node_id, source_ref_id FROM study_plan_node_sources WHERE version_id = ?1 ORDER BY ordinal ASC",
        )
        .bind(&target_version_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let mut sources_by_node: HashMap<String, Vec<String>> = HashMap::new();
        let mut all_source_ref_ids = Vec::new();
        for ns in node_source_rows {
            let n_id: String = ns.get("node_id");
            let s_id: String = ns.get("source_ref_id");
            sources_by_node.entry(n_id).or_default().push(s_id.clone());
            all_source_ref_ids.push(s_id);
        }

        let mut nodes = Vec::with_capacity(node_rows.len());
        for nr in node_rows {
            let node_id: String = nr.get("node_id");
            let objectives_raw: String = nr.get("learning_objectives_json");
            let mat_support_raw: String = nr.get("material_support");

            nodes.push(StudyPlanVersionNode {
                node_id: node_id.clone(),
                title: nr.get("title"),
                summary: nr.get("summary"),
                learning_objectives: serde_json::from_str(&objectives_raw).unwrap_or_default(),
                concept_id: nr.get("concept_id"),
                concept_label: nr.get("concept_label"),
                position: nr.get("position"),
                included: nr.get::<i32, _>("included") == 1,
                locked: nr.get::<i32, _>("locked") == 1,
                user_added: nr.get::<i32, _>("user_added") == 1,
                user_modified: nr.get::<i32, _>("user_modified") == 1,
                material_support: mat_support_raw
                    .parse()
                    .unwrap_or(MaterialSupport::NotValidated),
                why_here: nr.get("why_here"),
                source_ref_ids: sources_by_node.remove(&node_id).unwrap_or_default(),
            });
        }

        // Hydrate prerequisites
        let prereq_rows = sqlx::query(
            "SELECT prerequisite_node_id, dependent_node_id, support, rationale
             FROM study_plan_prerequisites WHERE version_id = ?1",
        )
        .bind(&target_version_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let prereq_source_rows = sqlx::query(
            "SELECT prerequisite_node_id, dependent_node_id, source_ref_id
             FROM study_plan_prerequisite_sources WHERE version_id = ?1 ORDER BY ordinal ASC",
        )
        .bind(&target_version_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let mut sources_by_prereq: HashMap<(String, String), Vec<String>> = HashMap::new();
        for ps in prereq_source_rows {
            let p_id: String = ps.get("prerequisite_node_id");
            let d_id: String = ps.get("dependent_node_id");
            let s_id: String = ps.get("source_ref_id");
            sources_by_prereq
                .entry((p_id, d_id))
                .or_default()
                .push(s_id.clone());
            all_source_ref_ids.push(s_id);
        }

        let mut prerequisites = Vec::with_capacity(prereq_rows.len());
        for pr in prereq_rows {
            let p_id: String = pr.get("prerequisite_node_id");
            let d_id: String = pr.get("dependent_node_id");
            prerequisites.push(PlanPrerequisite {
                prerequisite_node_id: p_id.clone(),
                dependent_node_id: d_id.clone(),
                support: pr.get("support"),
                rationale: pr.get("rationale"),
                source_ref_ids: sources_by_prereq.remove(&(p_id, d_id)).unwrap_or_default(),
            });
        }

        // Hydrate activity map
        let activity_rows = sqlx::query(
            "SELECT node_id, activity FROM study_plan_node_activity WHERE plan_id = ?1",
        )
        .bind(plan_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let mut activity_by_node_id = HashMap::new();
        for ar in activity_rows {
            let n_id: String = ar.get("node_id");
            let act_str: String = ar.get("activity");
            activity_by_node_id.insert(n_id, act_str.parse().unwrap_or(NodeActivity::NotStarted));
        }

        // Hydrate source refs
        let source_refs_map = self
            .source_repo
            .get_source_refs_batch(&all_source_ref_ids)
            .await?;
        let stored_refs = source_refs_map.into_values().collect::<Vec<_>>();
        let ref_inputs = stored_refs
            .iter()
            .map(|reference| StudySourceRefInput {
                document_id: reference.document_id.clone(),
                extract_id: reference.extract_id.clone(),
                excerpt: reference.excerpt.clone(),
                excerpt_sha256: None,
                revision: Some(reference.revision.clone()),
                revision_kind: Some(reference.revision_kind),
                document_title: Some(reference.document_title.clone()),
                source_type: Some(reference.source_type.clone()),
                jump: reference.jump.clone(),
                chunk: reference.chunk.clone(),
                section_label: reference.section_label.clone(),
            })
            .collect::<Vec<_>>();
        let live_resolutions = self
            .source_repo
            .resolve_study_source_refs(&ref_inputs)
            .await?;
        let source_resolutions = stored_refs
            .into_iter()
            .zip(live_resolutions)
            .map(|(stored, mut live)| {
                // Keep the original excerpt and revision in the historical plan.
                live.ref_item = stored;
                (live.ref_item.id.clone(), live)
            })
            .collect();

        let version = StudyPlanVersion {
            id: version_row.get("id"),
            plan_id: version_row.get("plan_id"),
            version: version_row.get("version"),
            state: state_str.parse().unwrap_or(PlanVersionState::Draft),
            base_version_id: version_row.get("base_version_id"),
            source_scope,
            knowledge_authority,
            nodes,
            prerequisites,
            change_summary: diff_json.and_then(|j| serde_json::from_str(&j).ok()),
            created_by: version_row.get("created_by"),
            created_at: version_row.get("created_at"),
            published_at: version_row.get("published_at"),
        };

        Ok(StudyPlanDetail {
            plan,
            version,
            activity_by_node_id,
            source_refs: source_resolutions,
        })
    }

    /// Saves a draft version under CAS expectedDraftRevision, replacing all draft nodes and prerequisites.
    pub async fn save_study_plan_draft(
        &self,
        input: SaveStudyPlanDraftInput,
    ) -> Result<StudyPlanDetail, StudyCommandError> {
        let plan_row = sqlx::query(
            "SELECT id, draft_version_id, revision FROM study_plans WHERE id = ?1 LIMIT 1",
        )
        .bind(&input.plan_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let plan_row = plan_row
            .ok_or_else(|| StudyCommandError::not_found("study_plan.error.plan_not_found"))?;

        let draft_version_id: Option<String> = plan_row.get("draft_version_id");
        let current_revision: i64 = plan_row.get("revision");

        let draft_version_id = draft_version_id.ok_or_else(|| {
            StudyCommandError::new(
                StudyErrorCode::InvalidState,
                "study_plan.error.no_active_draft",
                false,
            )
        })?;

        let current_draft = self
            .get_study_plan(&input.plan_id, Some(&draft_version_id))
            .await?;
        let knowledge_authority = input
            .knowledge_authority
            .clone()
            .unwrap_or_else(|| current_draft.version.knowledge_authority.clone());
        let source_scope = if matches!(knowledge_authority, StudyPlanKnowledgeAuthority::ModelOnly)
        {
            None
        } else {
            input
                .source_scope
                .clone()
                .or_else(|| current_draft.version.source_scope.clone())
        };
        validate_knowledge_authority(&knowledge_authority, source_scope.as_ref())?;

        // CAS check
        if current_revision != input.expected_draft_revision {
            let mut details = StudyCommandErrorDetails::default();
            details.expected_revision = Some(input.expected_draft_revision);
            details.actual_revision = Some(current_revision);
            return Err(StudyCommandError {
                code: StudyErrorCode::StaleRevision,
                message_key: "study_plan.error.stale_revision".to_string(),
                retryable: true,
                field_issues: None,
                details: Some(details),
            });
        }

        // Validate node limits
        if input.nodes.len() > MAX_MANUAL_NODES {
            return Err(StudyCommandError::invalid_input(
                "study_plan.error.max_nodes_exceeded",
                vec![FieldIssue {
                    path: "nodes".to_string(),
                    code: "max_nodes_exceeded".to_string(),
                    message_key: "study_plan.error.max_nodes_exceeded".to_string(),
                }],
            ));
        }

        if input.source_refs.len() > 96 {
            return Err(StudyCommandError::invalid_input(
                "study_source.error.too_many_refs",
                vec![],
            ));
        }
        let resolutions = self
            .source_repo
            .resolve_study_source_refs(&input.source_refs.values().cloned().collect::<Vec<_>>())
            .await?;

        let now = Utc::now().to_rfc3339();
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let updated = sqlx::query(
            "UPDATE study_plans SET revision = revision + 1, updated_at = ?1
             WHERE id = ?2 AND revision = ?3 AND draft_version_id = ?4",
        )
        .bind(&now)
        .bind(&input.plan_id)
        .bind(input.expected_draft_revision)
        .bind(&draft_version_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        if updated.rows_affected() == 0 {
            return Err(StudyCommandError::new(
                StudyErrorCode::StaleRevision,
                "study_plan.error.stale_revision",
                true,
            ));
        }

        let mut canonical_refs = HashMap::new();
        for (provisional_id, resolution) in input.source_refs.keys().zip(resolutions) {
            if resolution.status != StudySourceStatus::Current {
                return Err(StudyCommandError::new(
                    StudyErrorCode::StaleSource,
                    "study_generation.error.source_changed",
                    false,
                ));
            }
            let id = self
                .source_repo
                .upsert_source_ref_in_tx(&mut tx, &resolution.ref_item)
                .await?;
            canonical_refs.insert(provisional_id, id);
        }

        // 1. Delete prior draft contents in reverse dependency order
        sqlx::query("DELETE FROM study_plan_node_sources WHERE version_id = ?1")
            .bind(&draft_version_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        sqlx::query("DELETE FROM study_plan_prerequisite_sources WHERE version_id = ?1")
            .bind(&draft_version_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        sqlx::query("DELETE FROM study_plan_prerequisites WHERE version_id = ?1")
            .bind(&draft_version_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        sqlx::query("DELETE FROM study_plan_version_nodes WHERE version_id = ?1")
            .bind(&draft_version_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        // 2. Insert new nodes and prerequisites
        for node in &input.nodes {
            let node_id = if node.node_id.starts_with("spn_") {
                node.node_id.clone()
            } else {
                format!("spn_{}", Uuid::new_v4())
            };

            let sem_key = compute_node_semantic_key(
                node.concept_id.as_deref(),
                &node.title,
                node.learning_objectives.first().map(|s| s.as_str()),
            );

            sqlx::query(
                "INSERT INTO study_plan_nodes (id, plan_id, semantic_key, created_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(plan_id, semantic_key) DO NOTHING",
            )
            .bind(&node_id)
            .bind(&input.plan_id)
            .bind(&sem_key)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

            let objectives_json = serde_json::to_string(&node.learning_objectives)
                .unwrap_or_else(|_| "[]".to_string());
            let mat_support = node.material_support.to_string();

            sqlx::query(
                "INSERT INTO study_plan_version_nodes (
                    version_id, node_id, title, summary, learning_objectives_json,
                    concept_id, concept_label, position, included, locked, user_added,
                    user_modified, material_support, why_here
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            )
            .bind(&draft_version_id)
            .bind(&node_id)
            .bind(&node.title)
            .bind(&node.summary)
            .bind(&objectives_json)
            .bind(node.concept_id.as_deref())
            .bind(&node.concept_label)
            .bind(node.position)
            .bind(if node.included { 1 } else { 0 })
            .bind(if node.locked { 1 } else { 0 })
            .bind(if node.user_added { 1 } else { 0 })
            .bind(if node.user_modified { 1 } else { 0 })
            .bind(&mat_support)
            .bind(node.why_here.as_deref())
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

            for (ord, ref_id) in node.source_ref_ids.iter().enumerate() {
                sqlx::query(
                    "INSERT INTO study_plan_node_sources (version_id, node_id, source_ref_id, ordinal, role)
                     VALUES (?1, ?2, ?3, ?4, 'primary')",
                )
                .bind(&draft_version_id)
                .bind(&node_id)
                .bind(canonical_refs.get(ref_id).unwrap_or(ref_id))
                .bind(ord as i32)
                .execute(&mut *tx)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
            }

            sqlx::query(
                "INSERT INTO study_plan_node_activity (plan_id, node_id, activity, updated_at)
                 VALUES (?1, ?2, 'not-started', ?3)
                 ON CONFLICT(plan_id, node_id) DO NOTHING",
            )
            .bind(&input.plan_id)
            .bind(&node_id)
            .bind(&now)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        }

        for prereq in &input.prerequisites {
            sqlx::query(
                "INSERT INTO study_plan_prerequisites (
                    version_id, prerequisite_node_id, dependent_node_id, support, rationale
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
            )
            .bind(&draft_version_id)
            .bind(&prereq.prerequisite_node_id)
            .bind(&prereq.dependent_node_id)
            .bind(&prereq.support)
            .bind(prereq.rationale.as_deref())
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

            for (ord, ref_id) in prereq.source_ref_ids.iter().enumerate() {
                sqlx::query(
                    "INSERT INTO study_plan_prerequisite_sources (
                        version_id, prerequisite_node_id, dependent_node_id, source_ref_id, ordinal
                     ) VALUES (?1, ?2, ?3, ?4, ?5)",
                )
                .bind(&draft_version_id)
                .bind(&prereq.prerequisite_node_id)
                .bind(&prereq.dependent_node_id)
                .bind(canonical_refs.get(ref_id).unwrap_or(ref_id))
                .bind(ord as i32)
                .execute(&mut *tx)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
            }
        }

        let scope_json =
            serde_json::to_string(&source_scope).unwrap_or_else(|_| "null".to_string());
        let authority_json = serde_json::to_string(&knowledge_authority)
            .unwrap_or_else(|_| "{\"kind\":\"manual\"}".to_string());
        sqlx::query("UPDATE study_plan_versions SET source_scope_json = ?1, knowledge_authority_json = ?2 WHERE id = ?3")
            .bind(&scope_json)
            .bind(&authority_json)
            .bind(&draft_version_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        tx.commit()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        self.get_study_plan(&input.plan_id, Some(&draft_version_id))
            .await
    }

    /// Publishes a draft version under CAS expected_plan_revision, superseding the old published version.
    pub async fn publish_study_plan_version(
        &self,
        plan_id: &str,
        draft_version_id: &str,
        expected_plan_revision: i64,
    ) -> Result<StudyPlanDetail, StudyCommandError> {
        let plan_row = sqlx::query(
            "SELECT id, current_version_id, draft_version_id, current_version, revision
             FROM study_plans WHERE id = ?1 LIMIT 1",
        )
        .bind(plan_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let plan_row = plan_row
            .ok_or_else(|| StudyCommandError::not_found("study_plan.error.plan_not_found"))?;

        let current_revision: i64 = plan_row.get("revision");
        let active_draft_id: Option<String> = plan_row.get("draft_version_id");
        let old_published_id: Option<String> = plan_row.get("current_version_id");

        // CAS check
        if current_revision != expected_plan_revision {
            let mut details = StudyCommandErrorDetails::default();
            details.expected_revision = Some(expected_plan_revision);
            details.actual_revision = Some(current_revision);
            return Err(StudyCommandError {
                code: StudyErrorCode::StaleRevision,
                message_key: "study_plan.error.stale_revision".to_string(),
                retryable: true,
                field_issues: None,
                details: Some(details),
            });
        }

        if active_draft_id.as_deref() != Some(draft_version_id) {
            return Err(StudyCommandError::new(
                StudyErrorCode::InvalidState,
                "study_plan.error.draft_mismatch",
                false,
            ));
        }

        let draft = self.get_study_plan(plan_id, Some(draft_version_id)).await?;
        validate_publishable_plan(&draft)?;
        let draft_ver_num = draft.version.version;

        let now = Utc::now().to_rfc3339();
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        // Reserve the head change under CAS before updating the version rows.
        let updated = sqlx::query(
            "UPDATE study_plans
             SET current_version_id = ?1, current_version = ?2, draft_version_id = NULL,
                 revision = revision + 1, updated_at = ?3
             WHERE id = ?4 AND revision = ?5 AND draft_version_id = ?1",
        )
        .bind(draft_version_id)
        .bind(draft_ver_num)
        .bind(&now)
        .bind(plan_id)
        .bind(expected_plan_revision)
        .execute(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        if updated.rows_affected() == 0 {
            return Err(StudyCommandError::new(
                StudyErrorCode::StaleRevision,
                "study_plan.error.stale_revision",
                true,
            ));
        }

        // 1. Supersede old published version if present
        if let Some(ref old_id) = old_published_id {
            sqlx::query("UPDATE study_plan_versions SET state = 'superseded' WHERE id = ?1")
                .bind(old_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        }

        // 2. Mark draft version as published
        sqlx::query(
            "UPDATE study_plan_versions
             SET state = 'published', published_at = ?1
             WHERE id = ?2",
        )
        .bind(&now)
        .bind(draft_version_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        tx.commit()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        self.get_study_plan(plan_id, Some(draft_version_id)).await
    }

    /// Discards an active draft version.
    pub async fn discard_study_plan_draft(
        &self,
        plan_id: &str,
        expected_plan_revision: i64,
    ) -> Result<StudyPlanDetail, StudyCommandError> {
        let plan_row = sqlx::query(
            "SELECT id, draft_version_id, revision FROM study_plans WHERE id = ?1 LIMIT 1",
        )
        .bind(plan_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let plan_row = plan_row
            .ok_or_else(|| StudyCommandError::not_found("study_plan.error.plan_not_found"))?;

        let current_revision: i64 = plan_row.get("revision");
        let draft_version_id: Option<String> = plan_row.get("draft_version_id");

        if current_revision != expected_plan_revision {
            let mut details = StudyCommandErrorDetails::default();
            details.expected_revision = Some(expected_plan_revision);
            details.actual_revision = Some(current_revision);
            return Err(StudyCommandError {
                code: StudyErrorCode::StaleRevision,
                message_key: "study_plan.error.stale_revision".to_string(),
                retryable: true,
                field_issues: None,
                details: Some(details),
            });
        }

        let draft_version_id = draft_version_id.ok_or_else(|| {
            StudyCommandError::new(
                StudyErrorCode::InvalidState,
                "study_plan.error.no_active_draft",
                false,
            )
        })?;

        let now = Utc::now().to_rfc3339();
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        // Delete draft version row (cascades version nodes and prerequisites)
        sqlx::query("DELETE FROM study_plan_versions WHERE id = ?1")
            .bind(&draft_version_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        // Clear draft pointer on plan
        sqlx::query(
            "UPDATE study_plans SET draft_version_id = NULL, revision = revision + 1, updated_at = ?1 WHERE id = ?2",
        )
        .bind(&now)
        .bind(plan_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        tx.commit()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        self.get_study_plan(plan_id, None).await
    }

    /// Sets explicit activity for a single node.
    pub async fn set_study_plan_node_activity(
        &self,
        plan_id: &str,
        node_id: &str,
        activity: NodeActivity,
        expected_plan_revision: i64,
    ) -> Result<StudyPlanDetail, StudyCommandError> {
        let plan_row = sqlx::query("SELECT id, revision FROM study_plans WHERE id = ?1 LIMIT 1")
            .bind(plan_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let plan_row = plan_row
            .ok_or_else(|| StudyCommandError::not_found("study_plan.error.plan_not_found"))?;

        let current_revision: i64 = plan_row.get("revision");
        if current_revision != expected_plan_revision {
            let mut details = StudyCommandErrorDetails::default();
            details.expected_revision = Some(expected_plan_revision);
            details.actual_revision = Some(current_revision);
            return Err(StudyCommandError {
                code: StudyErrorCode::StaleRevision,
                message_key: "study_plan.error.stale_revision".to_string(),
                retryable: true,
                field_issues: None,
                details: Some(details),
            });
        }

        let now = Utc::now().to_rfc3339();
        let act_str = activity.to_string();

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        sqlx::query(
            "INSERT INTO study_plan_node_activity (plan_id, node_id, activity, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(plan_id, node_id) DO UPDATE SET activity = ?3, updated_at = ?4",
        )
        .bind(plan_id)
        .bind(node_id)
        .bind(&act_str)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        sqlx::query(
            "UPDATE study_plans SET revision = revision + 1, updated_at = ?1 WHERE id = ?2",
        )
        .bind(&now)
        .bind(plan_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        tx.commit()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        self.get_study_plan(plan_id, None).await
    }

    /// Archives a study plan.
    pub async fn archive_study_plan(
        &self,
        plan_id: &str,
        expected_plan_revision: i64,
    ) -> Result<(), StudyCommandError> {
        let current_revision: i64 =
            sqlx::query_scalar("SELECT revision FROM study_plans WHERE id = ?1 LIMIT 1")
                .bind(plan_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?
                .ok_or_else(|| StudyCommandError::not_found("study_plan.error.plan_not_found"))?;

        if current_revision != expected_plan_revision {
            return Err(StudyCommandError::new(
                StudyErrorCode::StaleRevision,
                "study_plan.error.stale_revision",
                true,
            ));
        }

        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE study_plans SET status = 'archived', revision = revision + 1, updated_at = ?1 WHERE id = ?2",
        )
        .bind(&now)
        .bind(plan_id)
        .execute(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        Ok(())
    }

    /// Deletes a study plan permanently, removing all C1 plan-owned rows and cleaning up unreferenced source refs.
    pub async fn delete_study_plan(
        &self,
        plan_id: &str,
        expected_plan_revision: i64,
    ) -> Result<(), StudyCommandError> {
        let current_revision: i64 =
            sqlx::query_scalar("SELECT revision FROM study_plans WHERE id = ?1 LIMIT 1")
                .bind(plan_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?
                .ok_or_else(|| StudyCommandError::not_found("study_plan.error.plan_not_found"))?;

        if current_revision != expected_plan_revision {
            return Err(StudyCommandError::new(
                StudyErrorCode::StaleRevision,
                "study_plan.error.stale_revision",
                true,
            ));
        }

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        sqlx::query("DELETE FROM study_plans WHERE id = ?1")
            .bind(plan_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        self.source_repo
            .cleanup_unused_source_refs_in_tx(&mut tx)
            .await?;

        tx.commit()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        Ok(())
    }

    /// Idempotently imports legacy study plans with replay deduplication via legacy_import_key.
    pub async fn import_legacy_study_plans(
        &self,
        payload: &str,
        import_hash: &str,
    ) -> Result<LegacyImportResult, StudyCommandError> {
        // 1. Check for replay idempotency
        let existing: Option<(String, i64)> = sqlx::query_as(
            "SELECT id, current_version FROM study_plans WHERE legacy_import_key = ?1 LIMIT 1",
        )
        .bind(import_hash)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        if let Some((existing_id, current_ver)) = existing {
            let node_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM study_plan_nodes WHERE plan_id = ?1")
                    .bind(&existing_id)
                    .fetch_one(&self.pool)
                    .await
                    .unwrap_or(0);

            return Ok(LegacyImportResult {
                plan_id: existing_id,
                imported_node_count: node_count as usize,
                imported_version: current_ver,
                is_retry: true,
            });
        }

        // 2. Parse legacy JSON
        let parsed: serde_json::Value = serde_json::from_str(payload).map_err(|_e| {
            StudyCommandError::invalid_input("study_plan.error.invalid_legacy_payload", vec![])
        })?;

        let (title, goal, raw_nodes_opt) = if let Some(state) = parsed.get("state") {
            let path = state
                .get("paths")
                .and_then(|p| p.as_array())
                .and_then(|arr| arr.first());
            let goal_id = path.and_then(|p| p.get("goalId")).and_then(|g| g.as_str());
            let goal_obj = state
                .get("goals")
                .and_then(|g| g.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find(|g| g.get("id").and_then(|id| id.as_str()) == goal_id)
                });

            let p_title = path
                .and_then(|p| p.get("title"))
                .and_then(|t| t.as_str())
                .unwrap_or("Imported Study Plan");
            let g_desc = goal_obj
                .and_then(|g| g.get("description").or_else(|| g.get("title")))
                .and_then(|d| d.as_str())
                .unwrap_or("Legacy imported learning path");
            let nodes = path.and_then(|p| p.get("nodes")).and_then(|n| n.as_array());
            (p_title.to_string(), g_desc.to_string(), nodes.cloned())
        } else {
            let p_title = parsed
                .get("title")
                .and_then(|t| t.as_str())
                .unwrap_or("Imported Study Plan");
            let g_desc = parsed
                .get("goal")
                .and_then(|g| g.as_str())
                .unwrap_or("Legacy imported learning path");
            let nodes = parsed.get("nodes").and_then(|n| n.as_array());
            (p_title.to_string(), g_desc.to_string(), nodes.cloned())
        };

        let mut initial_nodes = Vec::new();
        let mut initial_prerequisites = Vec::new();
        let mut old_to_new_id_map = HashMap::new();
        let mut activity_map = HashMap::new();

        if let Some(raw_nodes) = raw_nodes_opt {
            for (idx, node_val) in raw_nodes.iter().enumerate() {
                let old_id = node_val
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&format!("legacy_node_{}", idx))
                    .to_string();
                let new_id = format!("spn_{}", Uuid::new_v4());
                old_to_new_id_map.insert(old_id.clone(), new_id.clone());

                let n_title = node_val
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Untitled Node")
                    .to_string();
                let concept_id = node_val
                    .get("conceptId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let concept_label = node_val
                    .get("conceptName")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&n_title)
                    .to_string();
                let is_user_modified = node_val
                    .get("isUserModified")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                // Map legacy status to NodeActivity
                if let Some(status_str) = node_val.get("status").and_then(|v| v.as_str()) {
                    let act = match status_str {
                        "completed" => Some(NodeActivity::Completed),
                        "active" => Some(NodeActivity::InProgress),
                        "skipped" => Some(NodeActivity::Skipped),
                        "pending" => Some(NodeActivity::NotStarted),
                        _ => None,
                    };
                    if let Some(act) = act {
                        activity_map.insert(new_id.clone(), act);
                    }
                }

                initial_nodes.push(StudyPlanVersionNode {
                    node_id: new_id,
                    title: n_title,
                    summary: String::new(),
                    learning_objectives: vec!["Master legacy topic".to_string()],
                    concept_id,
                    concept_label,
                    position: idx as i32,
                    included: true,
                    locked: false,
                    user_added: false,
                    user_modified: is_user_modified,
                    material_support: MaterialSupport::NotValidated,
                    why_here: None,
                    source_ref_ids: Vec::new(),
                });
            }

            // Build prerequisites
            for (idx, node_val) in raw_nodes.iter().enumerate() {
                let fallback = format!("legacy_node_{}", idx);
                let old_id = node_val
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&fallback);
                if let Some(dep_new_id) = old_to_new_id_map.get(old_id) {
                    if let Some(prereq_ids) = node_val
                        .get("prerequisiteNodeIds")
                        .and_then(|v| v.as_array())
                    {
                        for prereq_val in prereq_ids {
                            if let Some(prereq_old_id) = prereq_val.as_str() {
                                if let Some(prereq_new_id) = old_to_new_id_map.get(prereq_old_id) {
                                    if prereq_new_id != dep_new_id {
                                        initial_prerequisites.push(PlanPrerequisite {
                                            prerequisite_node_id: prereq_new_id.clone(),
                                            dependent_node_id: dep_new_id.clone(),
                                            support: "user".to_string(),
                                            rationale: None,
                                            source_ref_ids: Vec::new(),
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        let node_count = initial_nodes.len();

        let input = CreateStudyPlanInput {
            title,
            goal,
            depth: StudyDepth::Foundational,
            source_scope: Some(serde_json::json!({
                "schemaVersion": 1,
                "selected": { "documentIds": [], "extractIds": [], "collectionIds": [], "tagIds": [] },
                "resolvedDocuments": [],
                "frozenAt": Utc::now().to_rfc3339(),
                "indexCompleteness": "complete",
                "limitations": []
            })),
            knowledge_authority: None,
            initial_nodes: if initial_nodes.is_empty() {
                None
            } else {
                Some(initial_nodes)
            },
            initial_prerequisites: if initial_prerequisites.is_empty() {
                None
            } else {
                Some(initial_prerequisites)
            },
        };

        let detail = self.create_study_plan(input).await?;

        // Apply activity states if any
        for (node_id, activity) in activity_map {
            let _ = self
                .set_study_plan_node_activity(
                    &detail.plan.id,
                    &node_id,
                    activity,
                    detail.plan.revision,
                )
                .await;
        }

        // Update legacy_import_key on newly created plan
        sqlx::query("UPDATE study_plans SET legacy_import_key = ?1 WHERE id = ?2")
            .bind(import_hash)
            .bind(&detail.plan.id)
            .execute(&self.pool)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        Ok(LegacyImportResult {
            plan_id: detail.plan.id,
            imported_node_count: node_count,
            imported_version: 1,
            is_retry: false,
        })
    }
}

fn compute_node_semantic_key(
    concept_id: Option<&str>,
    title: &str,
    first_objective: Option<&str>,
) -> String {
    if let Some(cid) = concept_id {
        if !cid.trim().is_empty() {
            return compute_sha256(cid.trim());
        }
    }
    let norm_title = title.trim().to_lowercase();
    let norm_obj = first_objective.unwrap_or("").trim().to_lowercase();
    compute_sha256(&format!("{}:{}", norm_title, norm_obj))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn create_test_db() -> Pool<Sqlite> {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        crate::database::migrations::run_migrations(&pool)
            .await
            .unwrap();

        pool
    }

    #[tokio::test]
    async fn test_create_get_and_list_study_plan() {
        let pool = create_test_db().await;
        let repo = StudyPlanRepository::new(pool);

        let input = CreateStudyPlanInput {
            title: "Operating Systems".to_string(),
            goal: "Master kernel structures and concurrency".to_string(),
            depth: StudyDepth::Foundational,
            source_scope: Some(serde_json::json!({ "schemaVersion": 1 })),
            knowledge_authority: None,
            initial_nodes: Some(vec![StudyPlanVersionNode {
                node_id: "spn_n1".to_string(),
                title: "Processes".to_string(),
                summary: "Process models".to_string(),
                learning_objectives: vec!["Understand PCB".to_string()],
                concept_id: None,
                concept_label: "Processes".to_string(),
                position: 0,
                included: true,
                locked: false,
                user_added: true,
                user_modified: false,
                material_support: MaterialSupport::NotValidated,
                why_here: None,
                source_ref_ids: vec![],
            }]),
            initial_prerequisites: None,
        };

        let detail = repo.create_study_plan(input).await.unwrap();
        assert_eq!(detail.plan.title, "Operating Systems");
        assert_eq!(detail.plan.current_version, 0); // 0 until published
        assert!(detail.plan.draft_version_id.is_some());
        assert_eq!(detail.version.nodes.len(), 1);

        // List
        let list = repo.list_study_plans(false).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "Operating Systems");
        assert!(list[0].has_draft);
    }

    #[tokio::test]
    async fn test_model_only_authority_roundtrips_and_rejects_library_scope() {
        let pool = create_test_db().await;
        let repo = StudyPlanRepository::new(pool);
        let authority = StudyPlanKnowledgeAuthority::ModelOnly;
        let created = repo
            .create_study_plan(CreateStudyPlanInput {
                title: "Source-free plan".to_string(),
                goal: "Learn a new subject".to_string(),
                depth: StudyDepth::Foundational,
                source_scope: None,
                knowledge_authority: Some(authority.clone()),
                initial_nodes: Some(vec![StudyPlanVersionNode {
                    node_id: "spn_model_only".to_string(),
                    title: "First topic".to_string(),
                    summary: "Unverified model proposal".to_string(),
                    learning_objectives: vec!["Explain the topic".to_string()],
                    concept_id: None,
                    concept_label: "First topic".to_string(),
                    position: 0,
                    included: true,
                    locked: false,
                    user_added: false,
                    user_modified: false,
                    material_support: MaterialSupport::Unsupported,
                    why_here: Some("Proposed from model knowledge".to_string()),
                    source_ref_ids: vec![],
                }]),
                initial_prerequisites: None,
            })
            .await
            .unwrap();

        assert_eq!(created.version.source_scope, None);
        assert_eq!(created.version.knowledge_authority, authority);
        let published = repo
            .publish_study_plan_version(
                &created.plan.id,
                &created.version.id,
                created.plan.revision,
            )
            .await
            .unwrap();
        assert_eq!(
            published.version.knowledge_authority,
            StudyPlanKnowledgeAuthority::ModelOnly
        );

        let invalid = repo
            .create_study_plan(CreateStudyPlanInput {
                title: "Invalid model-only scope".to_string(),
                goal: "Do not read library data".to_string(),
                depth: StudyDepth::Survey,
                source_scope: Some(serde_json::json!({ "schemaVersion": 1 })),
                knowledge_authority: Some(StudyPlanKnowledgeAuthority::ModelOnly),
                initial_nodes: None,
                initial_prerequisites: None,
            })
            .await;
        assert!(invalid.is_err());
        assert_eq!(invalid.unwrap_err().code, StudyErrorCode::InvalidInput);

        let library_scope = serde_json::json!({
            "resolvedDocuments": [{ "documentId": "d1", "revision": "r1" }]
        });
        assert_eq!(
            default_knowledge_authority(Some(&library_scope)),
            StudyPlanKnowledgeAuthority::Library { policy: LibraryKnowledgePolicy::SourceOnly }
        );
        assert_eq!(
            default_knowledge_authority(None),
            StudyPlanKnowledgeAuthority::Manual
        );
    }

    #[tokio::test]
    async fn test_study_plan_preferences_lifecycle() {
        let pool = create_test_db().await;
        let repo = StudyPlanRepository::new(pool.clone());

        let created = repo
            .create_study_plan(CreateStudyPlanInput {
                title: "Prefs plan".to_string(),
                goal: "Preferences".to_string(),
                depth: StudyDepth::Survey,
                source_scope: None,
                knowledge_authority: Some(StudyPlanKnowledgeAuthority::Manual),
                initial_nodes: None,
                initial_prerequisites: None,
            })
            .await
            .unwrap();
        let plan_id = created.plan.id.clone();
        let revision_before = created.plan.revision;

        // Backward-compatible default.
        let defaults = repo.get_study_plan_preferences(&plan_id).await.unwrap();
        assert_eq!(defaults, StudyPlanPreferences::default());

        // Set a deadline and rest days.
        let set = repo
            .update_study_plan_preferences(
                &plan_id,
                StudyPlanPreferences {
                    deadline: Some("2026-12-31".to_string()),
                    rest_days: vec![0, 6, 6, 0],
                },
            )
            .await
            .unwrap();
        assert_eq!(set.deadline.as_deref(), Some("2026-12-31"));
        assert_eq!(set.rest_days, vec![0, 6]); // deduped

        // Extend the date.
        let extended = repo
            .update_study_plan_preferences(
                &plan_id,
                StudyPlanPreferences {
                    deadline: Some("2027-01-15".to_string()),
                    rest_days: vec![0, 6],
                },
            )
            .await
            .unwrap();
        assert_eq!(extended.deadline.as_deref(), Some("2027-01-15"));

        // Remove the deadline.
        let removed = repo
            .update_study_plan_preferences(
                &plan_id,
                StudyPlanPreferences {
                    deadline: None,
                    rest_days: vec![0, 6],
                },
            )
            .await
            .unwrap();
        assert_eq!(removed.deadline, None);

        // Invalid date and rest-day values are rejected.
        let bad_date = repo
            .update_study_plan_preferences(
                &plan_id,
                StudyPlanPreferences {
                    deadline: Some("2026-13-40".to_string()),
                    rest_days: vec![],
                },
            )
            .await
            .unwrap_err();
        assert_eq!(bad_date.code, StudyErrorCode::InvalidInput);

        let bad_day = repo
            .update_study_plan_preferences(
                &plan_id,
                StudyPlanPreferences {
                    deadline: None,
                    rest_days: vec![7],
                },
            )
            .await
            .unwrap_err();
        assert_eq!(bad_day.code, StudyErrorCode::InvalidInput);

        // Preference edits never bump plan revision or touch version history.
        let after = repo.get_study_plan(&plan_id, None).await.unwrap();
        assert_eq!(after.plan.revision, revision_before);
        assert_eq!(after.plan.current_version, 0);
    }

    #[tokio::test]
    async fn test_legacy_authority_row_falls_back() {
        let pool = create_test_db().await;
        let repo = StudyPlanRepository::new(pool.clone());

        // Create a source-backed plan (default authority = Library SourceOnly)
        let library_scope = serde_json::json!({
            "resolvedDocuments": [{ "documentId": "d1", "revision": "r1" }]
        });
        let created = repo
            .create_study_plan(CreateStudyPlanInput {
                title: "Legacy source-backed".to_string(),
                goal: "Study legacy behavior".to_string(),
                depth: StudyDepth::Survey,
                source_scope: Some(library_scope.clone()),
                knowledge_authority: None,
                initial_nodes: None,
                initial_prerequisites: None,
            })
            .await
            .unwrap();

        // Corrupt the authority column to simulate a legacy row written before
        // the authority column existed (or an unknown older encoding).
        sqlx::query("UPDATE study_plan_versions SET knowledge_authority_json = ?1 WHERE id = ?2")
            .bind("{\"kind\":\"ancient-unknown\"}")
            .bind(&created.version.id)
            .execute(&pool)
            .await
            .unwrap();
        let reopened = repo.get_study_plan(&created.plan.id, None).await.unwrap();
        assert_eq!(
            reopened.version.knowledge_authority,
            StudyPlanKnowledgeAuthority::Library {
                policy: LibraryKnowledgePolicy::SourceOnly
            }
        );

        // A corrupt authority on a source-free draft falls back to Manual.
        let free = repo
            .create_study_plan(CreateStudyPlanInput {
                title: "Legacy source-free".to_string(),
                goal: "Manual draft".to_string(),
                depth: StudyDepth::Survey,
                source_scope: None,
                knowledge_authority: None,
                initial_nodes: None,
                initial_prerequisites: None,
            })
            .await
            .unwrap();
        sqlx::query("UPDATE study_plan_versions SET knowledge_authority_json = ?1 WHERE id = ?2")
            .bind("{\"kind\":\"library\",\"policy\":\"revolutionary\"}")
            .bind(&free.version.id)
            .execute(&pool)
            .await
            .unwrap();
        let reopened_free = repo.get_study_plan(&free.plan.id, None).await.unwrap();
        assert_eq!(
            reopened_free.version.knowledge_authority,
            StudyPlanKnowledgeAuthority::Manual
        );
    }

    #[tokio::test]
    async fn test_publish_stale_head_rejected() {
        let pool = create_test_db().await;
        let repo = StudyPlanRepository::new(pool);
        let created = repo
            .create_study_plan(CreateStudyPlanInput {
                title: "CAS plan".to_string(),
                goal: "Reject stale head".to_string(),
                depth: StudyDepth::Survey,
                source_scope: None,
                knowledge_authority: Some(StudyPlanKnowledgeAuthority::Manual),
                initial_nodes: Some(vec![StudyPlanVersionNode {
                    node_id: "spn_cas1".to_string(),
                    title: "Topic".to_string(),
                    summary: "Summary".to_string(),
                    learning_objectives: vec!["Objective".to_string()],
                    concept_id: None,
                    concept_label: "Topic".to_string(),
                    position: 0,
                    included: true,
                    locked: false,
                    user_added: true,
                    user_modified: false,
                    material_support: MaterialSupport::NotValidated,
                    why_here: None,
                    source_ref_ids: vec![],
                }]),
                initial_prerequisites: None,
            })
            .await
            .unwrap();
        // Publish with a stale expected plan revision must be rejected.
        let err = repo
            .publish_study_plan_version(
                &created.plan.id,
                &created.version.id,
                created.plan.revision + 99,
            )
            .await
            .unwrap_err();
        assert_eq!(err.code, StudyErrorCode::StaleRevision);
    }

    #[tokio::test]
    async fn test_source_only_policy_rejects_unsupported_nodes_on_publish() {
        let pool = create_test_db().await;
        let repo = StudyPlanRepository::new(pool);

        let library_scope = serde_json::json!({
            "resolvedDocuments": [{ "documentId": "d1", "revision": "r1" }]
        });
        let unsupported_node = |node_id: &str| StudyPlanVersionNode {
            node_id: node_id.to_string(),
            title: "AI supplement topic".to_string(),
            summary: "Proposed by the model on top of the library".to_string(),
            learning_objectives: vec!["Explain the supplement".to_string()],
            concept_id: None,
            concept_label: "Supplement".to_string(),
            position: 0,
            included: true,
            locked: false,
            user_added: false,
            user_modified: false,
            material_support: MaterialSupport::Unsupported,
            why_here: Some("Not covered by selected sources".to_string()),
            source_ref_ids: vec![],
        };

        // Source-only: publishing an unsupported topic must fail.
        let source_only = repo
            .create_study_plan(CreateStudyPlanInput {
                title: "Source-only".to_string(),
                goal: "Only verified content".to_string(),
                depth: StudyDepth::Survey,
                source_scope: Some(library_scope.clone()),
                knowledge_authority: Some(StudyPlanKnowledgeAuthority::Library {
                    policy: LibraryKnowledgePolicy::SourceOnly,
                }),
                initial_nodes: Some(vec![unsupported_node("spn_u1")]),
                initial_prerequisites: None,
            })
            .await
            .unwrap();
        let err = repo
            .publish_study_plan_version(
                &source_only.plan.id,
                &source_only.version.id,
                source_only.plan.revision,
            )
            .await
            .unwrap_err();
        assert_eq!(err.code, StudyErrorCode::InvalidSource);

        // Source + model knowledge: unsupported topics publish visibly.
        let mixed = repo
            .create_study_plan(CreateStudyPlanInput {
                title: "Mixed".to_string(),
                goal: "Library plus supplements".to_string(),
                depth: StudyDepth::Survey,
                source_scope: Some(library_scope),
                knowledge_authority: Some(StudyPlanKnowledgeAuthority::Library {
                    policy: LibraryKnowledgePolicy::SourcePlusModelKnowledge,
                }),
                initial_nodes: Some(vec![unsupported_node("spn_u2")]),
                initial_prerequisites: None,
            })
            .await
            .unwrap();
        let published = repo
            .publish_study_plan_version(
                &mixed.plan.id,
                &mixed.version.id,
                mixed.plan.revision,
            )
            .await
            .unwrap();
        assert_eq!(
            published.version.knowledge_authority,
            StudyPlanKnowledgeAuthority::Library {
                policy: LibraryKnowledgePolicy::SourcePlusModelKnowledge
            }
        );
    }

    #[tokio::test]
    async fn test_save_draft_publish_and_cas_revisions() {
        let pool = create_test_db().await;
        let repo = StudyPlanRepository::new(pool.clone());
        sqlx::query("INSERT INTO documents (id, title, file_path, file_type, content, content_hash, date_added, date_modified)
            VALUES ('raft_doc', 'Raft', '/raft.md', 'markdown', 'Term numbers are monotonic.', 'rev1', '2026-11-11T00:00:00Z', '2026-11-11T00:00:00Z')")
            .execute(&pool).await.unwrap();

        let input = CreateStudyPlanInput {
            title: "Distributed Databases".to_string(),
            goal: "Master replication".to_string(),
            depth: StudyDepth::Deep,
            source_scope: Some(serde_json::json!({ "schemaVersion": 1 })),
            knowledge_authority: None,
            initial_nodes: None,
            initial_prerequisites: None,
        };

        let created = repo.create_study_plan(input).await.unwrap();
        let plan_id = created.plan.id;
        let draft_id = created.plan.draft_version_id.unwrap();
        assert_eq!(created.plan.revision, 1);

        // 1. Save draft under valid CAS (revision 1)
        let save_input = SaveStudyPlanDraftInput {
            plan_id: plan_id.clone(),
            expected_draft_revision: 1,
            source_scope: None,
            knowledge_authority: None,
            source_refs: [(
                "provisional_ref".into(),
                StudySourceRefInput {
                    document_id: "raft_doc".into(),
                    extract_id: None,
                    excerpt: "Term numbers are monotonic.".into(),
                    excerpt_sha256: None,
                    revision: Some("rev1".into()),
                    revision_kind: None,
                    document_title: None,
                    source_type: None,
                    jump: None,
                    chunk: None,
                    section_label: None,
                },
            )]
            .into(),
            nodes: vec![StudyPlanVersionNode {
                node_id: "spn_node1".to_string(),
                title: "Raft".to_string(),
                summary: "Leader election".to_string(),
                learning_objectives: vec!["Term numbers".to_string()],
                concept_id: None,
                concept_label: "Raft".to_string(),
                position: 0,
                included: true,
                locked: false,
                user_added: true,
                user_modified: true,
                material_support: MaterialSupport::Grounded,
                why_here: None,
                source_ref_ids: vec!["provisional_ref".into()],
            }],
            prerequisites: vec![],
        };

        let saved = repo.save_study_plan_draft(save_input).await.unwrap();
        assert_eq!(saved.plan.revision, 2);
        assert_eq!(saved.version.nodes.len(), 1);
        let canonical_ref_id = &saved.version.nodes[0].source_ref_ids[0];
        assert!(canonical_ref_id.starts_with("ssr_"));
        assert_eq!(
            saved.source_refs[canonical_ref_id].status,
            StudySourceStatus::Current
        );
        let reopened = repo.get_study_plan(&plan_id, None).await.unwrap();
        assert_eq!(
            reopened.source_refs[canonical_ref_id].ref_item.excerpt,
            "Term numbers are monotonic."
        );

        // 2. Stale CAS save draft (using stale revision 1) must fail with StaleRevision
        let stale_save = SaveStudyPlanDraftInput {
            plan_id: plan_id.clone(),
            expected_draft_revision: 1, // Stale!
            source_scope: None,
            knowledge_authority: None,
            source_refs: Default::default(),
            nodes: vec![],
            prerequisites: vec![],
        };
        let stale_res = repo.save_study_plan_draft(stale_save).await;
        assert!(stale_res.is_err());
        assert_eq!(stale_res.unwrap_err().code, StudyErrorCode::StaleRevision);

        // 3. Publish draft under valid CAS (revision 2)
        let published = repo
            .publish_study_plan_version(&plan_id, &draft_id, 2)
            .await
            .unwrap();
        assert_eq!(published.plan.current_version, 1);
        assert_eq!(
            published.plan.current_version_id.as_deref(),
            Some(draft_id.as_str())
        );
        assert!(published.plan.draft_version_id.is_none());
        assert_eq!(published.version.state, PlanVersionState::Published);
        assert_eq!(published.plan.revision, 3);
    }

    #[tokio::test]
    async fn test_node_activity_and_delete_cascade() {
        let pool = create_test_db().await;
        let repo = StudyPlanRepository::new(pool);

        let input = CreateStudyPlanInput {
            title: "Compilers".to_string(),
            goal: "Lexing and parsing".to_string(),
            depth: StudyDepth::Survey,
            source_scope: Some(serde_json::json!({ "schemaVersion": 1 })),
            knowledge_authority: None,
            initial_nodes: Some(vec![StudyPlanVersionNode {
                node_id: "spn_c1".to_string(),
                title: "AST".to_string(),
                summary: "Trees".to_string(),
                learning_objectives: vec!["Tree walks".to_string()],
                concept_id: None,
                concept_label: "AST".to_string(),
                position: 0,
                included: true,
                locked: false,
                user_added: true,
                user_modified: false,
                material_support: MaterialSupport::NotValidated,
                why_here: None,
                source_ref_ids: vec![],
            }]),
            initial_prerequisites: None,
        };

        let created = repo.create_study_plan(input).await.unwrap();
        let plan_id = created.plan.id;

        // Update node activity
        let updated = repo
            .set_study_plan_node_activity(&plan_id, "spn_c1", NodeActivity::Completed, 1)
            .await
            .unwrap();
        assert_eq!(
            updated.activity_by_node_id.get("spn_c1"),
            Some(&NodeActivity::Completed)
        );
        assert_eq!(updated.plan.revision, 2);

        // Delete plan
        repo.delete_study_plan(&plan_id, 2).await.unwrap();

        // Check get returns not found
        let get_res = repo.get_study_plan(&plan_id, None).await;
        assert!(get_res.is_err());
        assert_eq!(get_res.unwrap_err().code, StudyErrorCode::NotFound);
    }

    #[tokio::test]
    async fn test_legacy_import_idempotency() {
        let pool = create_test_db().await;
        let repo = StudyPlanRepository::new(pool);

        let payload = r#"{"title":"Imported Goal","goal":"Master rust concurrency"}"#;
        let import_hash = "hash_legacy_key_12345";

        let res1 = repo
            .import_legacy_study_plans(payload, import_hash)
            .await
            .unwrap();
        assert!(!res1.is_retry);

        // Replay same import hash
        let res2 = repo
            .import_legacy_study_plans(payload, import_hash)
            .await
            .unwrap();
        assert!(res2.is_retry);
        assert_eq!(res2.plan_id, res1.plan_id);
    }
}
