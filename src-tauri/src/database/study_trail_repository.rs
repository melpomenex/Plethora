use crate::models::study_trail::{
    AssessmentEligibilityPolicy, FormativeCheckOutcome, FormativeCheckResult, FormativePromptFormat,
    InstructionalRole, LearningSegment, LearningSegmentObjectiveLink, ObjectiveCoverageStatus,
    SegmentReadinessStatus, SegmentValidationStatus, StructuralClass, StudyTrailItem,
    StudyTrailItemStatus, StudyTrailOverview,
};
use crate::models::StudyCommandError;
use crate::study_trail::eligibility::evaluate_assessment_eligibility;
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;

pub struct StudyTrailRepository {
    pool: SqlitePool,
}

impl StudyTrailRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn upsert_segments_and_links(
        &self,
        version_id: &str,
        node_filter: Option<&str>,
        objective_filter: Option<i64>,
        segments: &[LearningSegment],
        links: &[LearningSegmentObjectiveLink],
    ) -> Result<(), StudyCommandError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        for seg in segments {
            let start_loc = serde_json::to_string(&seg.start_locator)
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
            let end_loc = serde_json::to_string(&seg.end_locator)
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
            let prov = serde_json::to_string(&seg.provenance)
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

            sqlx::query(
                "INSERT INTO learning_segments (
                    id, document_id, document_revision, format, title, parent_section_label,
                    start_locator_json, end_locator_json, start_offset, end_offset,
                    excerpt_preview, word_count, estimated_duration_seconds,
                    structural_class, instructional_role, quality_score, quality_rationale,
                    validation_status, readiness_status, generator_version, schema_version,
                    provenance_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    parent_section_label = excluded.parent_section_label,
                    start_locator_json = excluded.start_locator_json,
                    end_locator_json = excluded.end_locator_json,
                    excerpt_preview = excluded.excerpt_preview,
                    word_count = excluded.word_count,
                    estimated_duration_seconds = excluded.estimated_duration_seconds,
                    structural_class = excluded.structural_class,
                    instructional_role = excluded.instructional_role,
                    quality_score = excluded.quality_score,
                    quality_rationale = excluded.quality_rationale,
                    validation_status = excluded.validation_status,
                    readiness_status = excluded.readiness_status,
                    generator_version = excluded.generator_version,
                    provenance_json = excluded.provenance_json,
                    updated_at = excluded.updated_at",
            )
            .bind(&seg.id)
            .bind(&seg.document_id)
            .bind(&seg.document_revision)
            .bind(&seg.format)
            .bind(&seg.title)
            .bind(&seg.parent_section_label)
            .bind(start_loc)
            .bind(end_loc)
            .bind(seg.start_offset)
            .bind(seg.end_offset)
            .bind(&seg.excerpt_preview)
            .bind(seg.word_count)
            .bind(seg.estimated_duration_seconds)
            .bind(seg.structural_class.as_str())
            .bind(seg.instructional_role.as_str())
            .bind(seg.quality_score)
            .bind(&seg.quality_rationale)
            .bind(seg.validation_status.as_str())
            .bind(seg.readiness_status.as_str())
            .bind(&seg.generator_version)
            .bind(seg.schema_version)
            .bind(prov)
            .bind(&seg.created_at)
            .bind(&seg.updated_at)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        }

        // Remove non-authored links in scope before inserting fresh links
        match (node_filter, objective_filter) {
            (Some(node_id), Some(obj_idx)) => {
                sqlx::query(
                    "DELETE FROM learning_segment_objectives
                     WHERE version_id = ? AND node_id = ? AND objective_index = ? AND authored_override = 0",
                )
                .bind(version_id)
                .bind(node_id)
                .bind(obj_idx)
                .execute(&mut *tx)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
            }
            (Some(node_id), None) => {
                sqlx::query(
                    "DELETE FROM learning_segment_objectives
                     WHERE version_id = ? AND node_id = ? AND authored_override = 0",
                )
                .bind(version_id)
                .bind(node_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
            }
            _ => {
                sqlx::query(
                    "DELETE FROM learning_segment_objectives
                     WHERE version_id = ? AND authored_override = 0",
                )
                .bind(version_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
            }
        }

        // Check which (node_id, objective_index) pairs already have authored overrides
        let authored_rows: Vec<(String, i64)> = sqlx::query_as(
            "SELECT node_id, objective_index FROM learning_segment_objectives
             WHERE version_id = ? AND authored_override = 1",
        )
        .bind(version_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        for link in links {
            if !link.authored_override
                && authored_rows
                    .iter()
                    .any(|(n, o)| n == &link.node_id && *o == link.objective_index)
            {
                continue;
            }
            sqlx::query(
                "INSERT INTO learning_segment_objectives (
                    id, plan_id, version_id, node_id, objective_index, segment_id,
                    coverage_status, alignment_score, selection_rationale,
                    is_primary, is_required, authored_override, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    coverage_status = excluded.coverage_status,
                    alignment_score = excluded.alignment_score,
                    selection_rationale = excluded.selection_rationale,
                    is_primary = excluded.is_primary,
                    is_required = excluded.is_required,
                    authored_override = excluded.authored_override,
                    updated_at = excluded.updated_at",
            )
            .bind(&link.id)
            .bind(&link.plan_id)
            .bind(&link.version_id)
            .bind(&link.node_id)
            .bind(link.objective_index)
            .bind(&link.segment_id)
            .bind(link.coverage_status.as_str())
            .bind(link.alignment_score)
            .bind(&link.selection_rationale)
            .bind(if link.is_primary { 1 } else { 0 })
            .bind(if link.is_required { 1 } else { 0 })
            .bind(if link.authored_override { 1 } else { 0 })
            .bind(&link.created_at)
            .bind(&link.updated_at)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        Ok(())
    }

    pub async fn replace_trail_items(
        &self,
        version_id: &str,
        items: &[StudyTrailItem],
    ) -> Result<(), StudyCommandError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        sqlx::query("DELETE FROM study_trail_items WHERE version_id = ?")
            .bind(version_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        for item in items {
            let last_loc = item
                .last_locator
                .as_ref()
                .map(serde_json::to_string)
                .transpose()
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

            sqlx::query(
                "INSERT INTO study_trail_items (
                    id, plan_id, version_id, node_id, objective_index, segment_id,
                    trail_order, session_group_id, status, reading_progress, last_locator_json,
                    is_required, is_remediation, remediation_gap_id, manual_order_override,
                    rejected_reason, planner_rationale, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&item.id)
            .bind(&item.plan_id)
            .bind(&item.version_id)
            .bind(&item.node_id)
            .bind(item.objective_index)
            .bind(&item.segment_id)
            .bind(item.trail_order)
            .bind(&item.session_group_id)
            .bind(item.status.as_str())
            .bind(item.reading_progress)
            .bind(last_loc)
            .bind(if item.is_required { 1 } else { 0 })
            .bind(if item.is_remediation { 1 } else { 0 })
            .bind(&item.remediation_gap_id)
            .bind(item.manual_order_override)
            .bind(&item.rejected_reason)
            .bind(&item.planner_rationale)
            .bind(&item.updated_at)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        Ok(())
    }

    pub async fn get_overview(
        &self,
        plan_id: &str,
        version_id: &str,
        policy: AssessmentEligibilityPolicy,
    ) -> Result<StudyTrailOverview, StudyCommandError> {
        let link_rows: Vec<(
            String,
            String,
            String,
            String,
            i64,
            String,
            String,
            Option<f64>,
            String,
            i64,
            i64,
            i64,
            String,
            String,
        )> = sqlx::query_as(
            "SELECT id, plan_id, version_id, node_id, objective_index, segment_id,
                    coverage_status, alignment_score, selection_rationale,
                    is_primary, is_required, authored_override, created_at, updated_at
             FROM learning_segment_objectives
             WHERE version_id = ?
             ORDER BY node_id, objective_index, is_primary DESC",
        )
        .bind(version_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let mut objective_links: Vec<LearningSegmentObjectiveLink> = link_rows
            .into_iter()
            .map(|r| LearningSegmentObjectiveLink {
                id: r.0,
                plan_id: r.1,
                version_id: r.2,
                node_id: r.3,
                objective_index: r.4,
                segment_id: r.5,
                coverage_status: ObjectiveCoverageStatus::from_str_lossy(&r.6),
                alignment_score: r.7,
                selection_rationale: r.8,
                is_primary: r.9 != 0,
                is_required: r.10 != 0,
                authored_override: r.11 != 0,
                created_at: r.12,
                updated_at: r.13,
            })
            .collect();

        let item_rows = sqlx::query(
            "SELECT id, plan_id, version_id, node_id, objective_index, segment_id,
                    trail_order, session_group_id, status, reading_progress, last_locator_json,
                    is_required, is_remediation, remediation_gap_id, manual_order_override,
                    rejected_reason, planner_rationale, updated_at
             FROM study_trail_items
             WHERE version_id = ?
             ORDER BY trail_order ASC",
        )
        .bind(version_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let trail_items: Vec<StudyTrailItem> = item_rows
            .into_iter()
            .map(|r| StudyTrailItem {
                id: r.get("id"),
                plan_id: r.get("plan_id"),
                version_id: r.get("version_id"),
                node_id: r.get("node_id"),
                objective_index: r.get("objective_index"),
                segment_id: r.get("segment_id"),
                trail_order: r.get("trail_order"),
                session_group_id: r.get("session_group_id"),
                status: StudyTrailItemStatus::from_str_lossy(&r.get::<String, _>("status")),
                reading_progress: r.get("reading_progress"),
                last_locator: r
                    .get::<Option<String>, _>("last_locator_json")
                    .and_then(|s| serde_json::from_str(&s).ok()),
                is_required: r.get::<i64, _>("is_required") != 0,
                is_remediation: r.get::<i64, _>("is_remediation") != 0,
                remediation_gap_id: r.get("remediation_gap_id"),
                manual_order_override: r.get("manual_order_override"),
                rejected_reason: r.get("rejected_reason"),
                planner_rationale: r.get("planner_rationale"),
                updated_at: r.get("updated_at"),
            })
            .collect();

        // Fetch referenced segments
        let mut seg_ids: Vec<String> = objective_links
            .iter()
            .map(|l| l.segment_id.clone())
            .chain(trail_items.iter().filter_map(|i| i.segment_id.clone()))
            .collect();
        seg_ids.sort();
        seg_ids.dedup();

        let mut segments = Vec::new();
        let mut document_titles = HashMap::new();
        let mut diagnostics = Vec::new();

        for seg_id in &seg_ids {
            let row = sqlx::query(
                "SELECT id, document_id, document_revision, format, title, parent_section_label,
                        start_locator_json, end_locator_json, start_offset, end_offset,
                        excerpt_preview, word_count, estimated_duration_seconds,
                        structural_class, instructional_role, quality_score, quality_rationale,
                        validation_status, readiness_status, generator_version, schema_version,
                        provenance_json, created_at, updated_at
                 FROM learning_segments WHERE id = ?",
            )
            .bind(seg_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

            if let Some(r) = row {
                let doc_id: String = r.get("document_id");
                let doc_rev: String = r.get("document_revision");
                let seg_title: String = r.get("title");
                let val_str: String = r.get("validation_status");
                let read_str: String = r.get("readiness_status");

                // Verify live document revision & availability
                let doc_row: Option<(String, String, i64, i64)> = sqlx::query_as(
                    "SELECT title,
                            COALESCE(NULLIF(trim(content_hash), ''), NULLIF(trim(content_updated_at), ''), NULLIF(trim(date_added), ''), 'unknown'),
                            is_archived,
                            is_ai_excluded
                     FROM documents WHERE id = ?",
                )
                .bind(&doc_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

                let mut val_status = SegmentValidationStatus::from_str_lossy(&val_str);
                let mut read_status = SegmentReadinessStatus::from_str_lossy(&read_str);

                match doc_row {
                    Some((doc_title, live_rev, is_archived, is_ai_excluded)) => {
                        document_titles.insert(doc_id.clone(), doc_title.clone());
                        if is_archived != 0 || is_ai_excluded != 0 {
                            val_status = SegmentValidationStatus::Missing;
                            read_status = SegmentReadinessStatus::Unavailable;
                            diagnostics.push(format!("Source '{}' is archived or AI-excluded", doc_title));
                        } else if live_rev != doc_rev {
                            val_status = SegmentValidationStatus::Stale;
                            diagnostics.push(format!(
                                "Source '{}' changed since segment '{}' was generated",
                                doc_title, seg_title
                            ));
                        }
                    }
                    None => {
                        val_status = SegmentValidationStatus::Missing;
                        read_status = SegmentReadinessStatus::Unavailable;
                    }
                }

                segments.push(LearningSegment {
                    id: r.get("id"),
                    document_id: doc_id,
                    document_revision: doc_rev,
                    format: r.get("format"),
                    title: seg_title,
                    parent_section_label: r.get("parent_section_label"),
                    start_locator: serde_json::from_str(&r.get::<String, _>("start_locator_json"))
                        .unwrap_or(serde_json::Value::Null),
                    end_locator: serde_json::from_str(&r.get::<String, _>("end_locator_json"))
                        .unwrap_or(serde_json::Value::Null),
                    start_offset: r.get("start_offset"),
                    end_offset: r.get("end_offset"),
                    excerpt_preview: r.get("excerpt_preview"),
                    word_count: r.get("word_count"),
                    estimated_duration_seconds: r.get("estimated_duration_seconds"),
                    structural_class: StructuralClass::from_str_lossy(&r.get::<String, _>("structural_class")),
                    instructional_role: InstructionalRole::from_str_lossy(&r.get::<String, _>("instructional_role")),
                    quality_score: r.get("quality_score"),
                    quality_rationale: r.get("quality_rationale"),
                    validation_status: val_status,
                    readiness_status: read_status,
                    generator_version: r.get("generator_version"),
                    schema_version: r.get("schema_version"),
                    provenance: serde_json::from_str(&r.get::<String, _>("provenance_json"))
                        .unwrap_or(serde_json::Value::Null),
                    created_at: r.get("created_at"),
                    updated_at: r.get("updated_at"),
                });
            }
        }

        // Propagate stale validation to links
        let stale_ids: std::collections::HashSet<&str> = segments
            .iter()
            .filter(|s| s.validation_status == SegmentValidationStatus::Stale)
            .map(|s| s.id.as_str())
            .collect();
        for link in &mut objective_links {
            if stale_ids.contains(link.segment_id.as_str()) {
                link.coverage_status = ObjectiveCoverageStatus::RevisionChanged;
            }
        }

        let check_rows: Vec<(
            String,
            String,
            String,
            String,
            String,
            i64,
            String,
            String,
            String,
            String,
            String,
            Option<String>,
            String,
        )> = sqlx::query_as(
            "SELECT id, plan_id, version_id, trail_item_id, node_id, objective_index,
                    prompt_format, prompt_text, learner_response, outcome, feedback,
                    recommended_segment_id, created_at
             FROM formative_check_results
             WHERE version_id = ?
             ORDER BY created_at DESC",
        )
        .bind(version_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let formative_checks: Vec<FormativeCheckResult> = check_rows
            .into_iter()
            .map(|r| FormativeCheckResult {
                id: r.0,
                plan_id: r.1,
                version_id: r.2,
                trail_item_id: r.3,
                node_id: r.4,
                objective_index: r.5,
                prompt_format: FormativePromptFormat::from_str_lossy(&r.6),
                prompt_text: r.7,
                learner_response: r.8,
                outcome: FormativeCheckOutcome::from_str_lossy(&r.9),
                feedback: r.10,
                recommended_segment_id: r.11,
                created_at: r.12,
            })
            .collect();

        let eligibility = evaluate_assessment_eligibility(policy, &trail_items);

        Ok(StudyTrailOverview {
            plan_id: plan_id.to_string(),
            version_id: version_id.to_string(),
            segments,
            objective_links,
            trail_items,
            formative_checks,
            eligibility,
            document_titles,
            diagnostics,
        })
    }

    pub async fn update_item_progress(
        &self,
        item_id: &str,
        status: StudyTrailItemStatus,
        reading_progress: f64,
        last_locator: Option<serde_json::Value>,
        now_iso: &str,
    ) -> Result<(), StudyCommandError> {
        let loc_str = last_locator
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        sqlx::query(
            "UPDATE study_trail_items
             SET status = ?, reading_progress = ?, last_locator_json = COALESCE(?, last_locator_json), updated_at = ?
             WHERE id = ?",
        )
        .bind(status.as_str())
        .bind(reading_progress.clamp(0.0, 1.0))
        .bind(loc_str)
        .bind(now_iso)
        .bind(item_id)
        .execute(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        Ok(())
    }

    pub async fn record_formative_check(
        &self,
        result: &FormativeCheckResult,
        now_iso: &str,
    ) -> Result<(), StudyCommandError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        sqlx::query(
            "INSERT INTO formative_check_results (
                id, plan_id, version_id, trail_item_id, node_id, objective_index,
                prompt_format, prompt_text, learner_response, outcome, feedback,
                recommended_segment_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&result.id)
        .bind(&result.plan_id)
        .bind(&result.version_id)
        .bind(&result.trail_item_id)
        .bind(&result.node_id)
        .bind(result.objective_index)
        .bind(result.prompt_format.as_str())
        .bind(&result.prompt_text)
        .bind(&result.learner_response)
        .bind(result.outcome.as_str())
        .bind(&result.feedback)
        .bind(&result.recommended_segment_id)
        .bind(&result.created_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        let new_status = match result.outcome {
            FormativeCheckOutcome::Understood => StudyTrailItemStatus::CheckPassed,
            FormativeCheckOutcome::Partial | FormativeCheckOutcome::NeedsReview => {
                StudyTrailItemStatus::CheckNeedsReview
            }
        };

        sqlx::query("UPDATE study_trail_items SET status = ?, updated_at = ? WHERE id = ?")
            .bind(new_status.as_str())
            .bind(now_iso)
            .bind(&result.trail_item_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        tx.commit()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        Ok(())
    }

    pub async fn override_trail_item(
        &self,
        item_id: &str,
        segment_id: Option<&str>,
        is_required: Option<bool>,
        manual_order_override: Option<i64>,
        rejected_reason: Option<&str>,
        now_iso: &str,
    ) -> Result<(), StudyCommandError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        if let Some(sid) = segment_id {
            sqlx::query(
                "UPDATE study_trail_items SET segment_id = ?, updated_at = ? WHERE id = ?",
            )
            .bind(sid)
            .bind(now_iso)
            .bind(item_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

            // Mark corresponding objective link as authored_override
            let row: Option<(String, String, i64)> = sqlx::query_as(
                "SELECT version_id, node_id, objective_index FROM study_trail_items WHERE id = ?",
            )
            .bind(item_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

            if let Some((ver_id, node_id, obj_idx)) = row {
                sqlx::query(
                    "UPDATE learning_segment_objectives
                     SET is_primary = CASE WHEN segment_id = ? THEN 1 ELSE 0 END,
                         authored_override = CASE WHEN segment_id = ? THEN 1 ELSE authored_override END,
                         updated_at = ?
                     WHERE version_id = ? AND node_id = ? AND objective_index = ?",
                )
                .bind(sid)
                .bind(sid)
                .bind(now_iso)
                .bind(&ver_id)
                .bind(&node_id)
                .bind(obj_idx)
                .execute(&mut *tx)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
            }
        }

        if let Some(req) = is_required {
            sqlx::query("UPDATE study_trail_items SET is_required = ?, updated_at = ? WHERE id = ?")
                .bind(if req { 1 } else { 0 })
                .bind(now_iso)
                .bind(item_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        }

        if let Some(ord) = manual_order_override {
            sqlx::query(
                "UPDATE study_trail_items SET manual_order_override = ?, trail_order = ?, updated_at = ? WHERE id = ?",
            )
            .bind(ord)
            .bind(ord)
            .bind(now_iso)
            .bind(item_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        }

        if let Some(reason) = rejected_reason {
            sqlx::query(
                "UPDATE study_trail_items SET rejected_reason = ?, status = 'skipped', updated_at = ? WHERE id = ?",
            )
            .bind(reason)
            .bind(now_iso)
            .bind(item_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        Ok(())
    }

    pub async fn upsert_remediation_item(
        &self,
        item: &StudyTrailItem,
    ) -> Result<(), StudyCommandError> {
        let last_loc = item
            .last_locator
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;

        sqlx::query(
            "INSERT INTO study_trail_items (
                id, plan_id, version_id, node_id, objective_index, segment_id,
                trail_order, session_group_id, status, reading_progress, last_locator_json,
                is_required, is_remediation, remediation_gap_id, manual_order_override,
                rejected_reason, planner_rationale, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                segment_id = excluded.segment_id,
                planner_rationale = excluded.planner_rationale,
                updated_at = excluded.updated_at",
        )
        .bind(&item.id)
        .bind(&item.plan_id)
        .bind(&item.version_id)
        .bind(&item.node_id)
        .bind(item.objective_index)
        .bind(&item.segment_id)
        .bind(item.trail_order)
        .bind(&item.session_group_id)
        .bind(item.status.as_str())
        .bind(item.reading_progress)
        .bind(last_loc)
        .bind(if item.is_required { 1 } else { 0 })
        .bind(1i64)
        .bind(&item.remediation_gap_id)
        .bind(item.manual_order_override)
        .bind(&item.rejected_reason)
        .bind(&item.planner_rationale)
        .bind(&item.updated_at)
        .execute(&self.pool)
        .await
        .map_err(|e| StudyCommandError::storage_failed(e.to_string()))?;
        Ok(())
    }
}
