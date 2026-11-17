use std::collections::{HashMap, HashSet};

use chrono::Utc;
use serde_json::Value;
use sqlx::{FromRow, Pool, Row, Sqlite, Transaction};

use super::study_source_repository::{normalize_for_match, EXCERPT_MAX_CHARS};
use super::{StudyPlanRepository, StudySourceRepository};
use crate::models::{
    PlanVersionState, StudyCommandError, StudyErrorCode, StudyPlanDetail,
    StudyPlanKnowledgeAuthority, StudyPlanStatus, StudyReadingAssignment, StudyReadingFormat,
    StudyReadingManifest, StudyReadingTrail, StudySourceRefInput, StudySourceRefV1,
    StudySourceStatus, StudyTrailSession,
};

const MAX_ASSIGNMENTS: usize = 800;
const MAX_SEGMENTS: usize = 16;
const MAX_EVIDENCE_REFS: usize = 8;
const MAX_ID_LENGTH: usize = 200;
const MAX_CONTEXT_LENGTH: usize = 300;
const MAX_MANIFEST_BYTES: usize = 4 * 1024 * 1024;

pub struct StudyReadingRepository {
    pool: Pool<Sqlite>,
}

#[derive(FromRow)]
struct TrailRow {
    revision: i64,
    manifest_json: Option<String>,
    session_json: Option<String>,
}

#[derive(FromRow, PartialEq)]
struct DocumentSnapshot {
    file_type: String,
    revision: String,
    content_revision_at: String,
    is_archived: bool,
    is_ai_excluded: bool,
}

#[derive(FromRow, PartialEq)]
struct ExtractSnapshot {
    document_id: String,
    date_modified: String,
}

const DOCUMENT_SNAPSHOT_SQL: &str = "SELECT file_type,
            COALESCE(NULLIF(trim(content_hash), ''), NULLIF(trim(content_updated_at), ''),
                     NULLIF(trim(date_added), ''), 'unknown') AS revision,
            COALESCE(content_updated_at, date_added, '') AS content_revision_at,
            COALESCE(is_archived, 0) AS is_archived, COALESCE(is_ai_excluded, 0) AS is_ai_excluded
       FROM documents WHERE id = ?1";
const EXTRACT_SNAPSHOT_SQL: &str = "SELECT document_id, date_modified FROM extracts WHERE id = ?1";

impl StudyReadingRepository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub async fn get_trail(
        &self,
        plan_id: &str,
        version_id: &str,
    ) -> Result<StudyReadingTrail, StudyCommandError> {
        let row = sqlx::query_as::<_, TrailRow>(
            "SELECT COALESCE(t.revision, 0) AS revision, t.manifest_json, t.session_json
             FROM study_plan_versions v
             LEFT JOIN study_reading_trails t ON t.version_id = v.id
             WHERE v.plan_id = ?1 AND v.id = ?2 AND v.state IN ('published', 'superseded')",
        )
        .bind(plan_id)
        .bind(version_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(storage)?
        .ok_or_else(|| StudyCommandError::not_found("study_plan.error.version_not_found"))?;

        Ok(StudyReadingTrail {
            plan_id: plan_id.into(),
            version_id: version_id.into(),
            revision: row.revision,
            manifest: row
                .manifest_json
                .map(|json| serde_json::from_str(&json))
                .transpose()
                .map_err(storage)?
                .unwrap_or_default(),
            session: row
                .session_json
                .map(|json| serde_json::from_str(&json))
                .transpose()
                .map_err(storage)?,
        })
    }

    pub async fn save_manifest(
        &self,
        plan_id: &str,
        version_id: &str,
        expected_revision: i64,
        manifest: StudyReadingManifest,
    ) -> Result<StudyReadingTrail, StudyCommandError> {
        validate_manifest(&manifest)?;
        let current = self.get_trail(plan_id, version_id).await?;
        if expected_revision != current.revision {
            return Err(stale_revision());
        }

        let manifest_json = serde_json::to_string(&manifest).map_err(storage)?;
        if manifest_json.len() > MAX_MANIFEST_BYTES {
            return Err(invalid_manifest());
        }

        let (documents, extracts) = self
            .verify_manifest_sources(plan_id, version_id, &manifest)
            .await?;
        let session = retain_unchanged_progress(current, &manifest);
        let session_json = session
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(storage)?;
        let mut tx = self.pool.begin().await.map_err(storage)?;

        let updated = if expected_revision == 0 {
            sqlx::query(
                "INSERT INTO study_reading_trails (version_id, revision, manifest_json, session_json, updated_at)
                 SELECT ?1, 1, ?2, ?3, ?4 FROM study_plans p
                 JOIN study_plan_versions v ON v.id = p.current_version_id AND v.plan_id = p.id
                 WHERE p.id = ?5 AND p.status = 'active' AND v.id = ?1 AND v.state = 'published'
                 ON CONFLICT(version_id) DO NOTHING",
            )
            .bind(version_id)
            .bind(manifest_json)
            .bind(session_json)
            .bind(Utc::now().to_rfc3339())
            .bind(plan_id)
            .execute(&mut *tx)
            .await
            .map_err(storage)?
        } else {
            sqlx::query(
                "UPDATE study_reading_trails SET
                    revision = revision + 1, manifest_json = ?1, session_json = ?2, updated_at = ?3
                 WHERE version_id = ?4 AND revision = ?5 AND EXISTS (
                     SELECT 1 FROM study_plans p JOIN study_plan_versions v
                         ON v.id = p.current_version_id AND v.plan_id = p.id
                     WHERE p.id = ?6 AND p.status = 'active' AND v.id = ?4 AND v.state = 'published'
                 )",
            )
            .bind(manifest_json)
            .bind(session_json)
            .bind(Utc::now().to_rfc3339())
            .bind(version_id)
            .bind(expected_revision)
            .bind(plan_id)
            .execute(&mut *tx)
            .await
            .map_err(storage)?
        };
        if updated.rows_affected() != 1 {
            return Err(stale_revision());
        }
        verify_source_snapshots(&mut tx, documents, extracts).await?;
        tx.commit().await.map_err(storage)?;
        Ok(StudyReadingTrail {
            plan_id: plan_id.into(),
            version_id: version_id.into(),
            revision: expected_revision + 1,
            manifest,
            session,
        })
    }

    pub async fn save_session(
        &self,
        plan_id: &str,
        version_id: &str,
        expected_revision: i64,
        session: StudyTrailSession,
    ) -> Result<StudyReadingTrail, StudyCommandError> {
        let mut current = self.get_trail(plan_id, version_id).await?;
        if current.revision == 0 || current.revision != expected_revision {
            return Err(stale_revision());
        }
        validate_session(&current.manifest, &session)?;
        let session_json = serde_json::to_string(&session).map_err(storage)?;

        let updated = sqlx::query(
            "UPDATE study_reading_trails SET
                revision = revision + 1, session_json = ?1, updated_at = ?2
             WHERE version_id = ?3 AND revision = ?4 AND EXISTS (
                 SELECT 1 FROM study_plans p JOIN study_plan_versions v
                     ON v.id = p.current_version_id AND v.plan_id = p.id
                 WHERE p.id = ?5 AND p.status = 'active' AND v.id = ?3 AND v.state = 'published'
             )",
        )
        .bind(session_json)
        .bind(Utc::now().to_rfc3339())
        .bind(version_id)
        .bind(expected_revision)
        .bind(plan_id)
        .execute(&self.pool)
        .await
        .map_err(storage)?;
        if updated.rows_affected() != 1 {
            return Err(stale_revision());
        }

        current.revision += 1;
        current.session = Some(session);
        Ok(current)
    }

    async fn verify_manifest_sources(
        &self,
        plan_id: &str,
        version_id: &str,
        manifest: &StudyReadingManifest,
    ) -> Result<
        (
            HashMap<String, DocumentSnapshot>,
            HashMap<String, ExtractSnapshot>,
        ),
        StudyCommandError,
    > {
        let detail = StudyPlanRepository::new(self.pool.clone())
            .get_study_plan(plan_id, Some(version_id))
            .await?;
        if detail.plan.status != StudyPlanStatus::Active
            || detail.plan.current_version_id.as_deref() != Some(version_id)
            || detail.version.state != PlanVersionState::Published
        {
            return Err(stale_revision());
        }

        let mut documents = HashMap::new();
        let mut extracts = HashMap::new();
        let mut inputs = Vec::new();
        let mut input_groups = Vec::new();
        let source_repo = StudySourceRepository::new(self.pool.clone());

        for assignment in &manifest.assignments {
            let references = eligible_references(&detail, assignment)?;
            let extract_id = references[0].extract_id.as_ref();
            if !documents.contains_key(&assignment.document_id) {
                let document = sqlx::query_as::<_, DocumentSnapshot>(DOCUMENT_SNAPSHOT_SQL)
                    .bind(&assignment.document_id)
                    .fetch_optional(&self.pool)
                    .await
                    .map_err(storage)?
                    .ok_or_else(source_changed)?;
                documents.insert(assignment.document_id.clone(), document);
            }
            let document = &documents[&assignment.document_id];
            if document.is_ai_excluded {
                return Err(StudyCommandError::new(
                    StudyErrorCode::SourceAiExcluded,
                    "study_source.meta.ai_excluded",
                    false,
                ));
            }
            if document.is_archived
                || document.revision != assignment.document_revision
                || document.file_type != assignment.format.as_str()
            {
                return Err(source_changed());
            }

            if let Some(extract_id) = extract_id {
                if !extracts.contains_key(extract_id) {
                    let extract = sqlx::query_as::<_, ExtractSnapshot>(EXTRACT_SNAPSHOT_SQL)
                        .bind(extract_id)
                        .fetch_optional(&self.pool)
                        .await
                        .map_err(storage)?
                        .ok_or_else(source_changed)?;
                    if extract.document_id != assignment.document_id {
                        return Err(invalid_manifest());
                    }
                    extracts.insert(extract_id.clone(), extract);
                }
            }

            for segment in &assignment.segments {
                let first = inputs.len();
                let base = StudySourceRefInput {
                    document_id: assignment.document_id.clone(),
                    extract_id: extract_id.cloned(),
                    excerpt: segment.quote.exact.clone(),
                    excerpt_sha256: None,
                    revision: Some(assignment.document_revision.clone()),
                    revision_kind: Some(references[0].revision_kind),
                    document_title: None,
                    source_type: None,
                    jump: segment.location.clone(),
                    chunk: None,
                    section_label: None,
                };
                for reference in &references {
                    if let Some(chunk) = &reference.chunk {
                        inputs.push(StudySourceRefInput {
                            chunk: Some(chunk.clone()),
                            ..base.clone()
                        });
                    }
                }
                inputs.push(base);
                input_groups.push(first..inputs.len());
            }
        }

        let resolutions = source_repo.resolve_study_source_refs(&inputs).await?;
        if input_groups.into_iter().any(|group| {
            !resolutions[group].iter().any(|resolution| {
                resolution.status == StudySourceStatus::Current
                    && resolution.navigation != crate::models::StudySourceNavigation::Unavailable
            })
        }) {
            return Err(StudyCommandError::new(
                StudyErrorCode::InvalidSource,
                "study_reading.error.unverified_passage",
                false,
            ));
        }

        Ok((documents, extracts))
    }
}

fn eligible_references<'a>(
    detail: &'a StudyPlanDetail,
    assignment: &StudyReadingAssignment,
) -> Result<Vec<&'a StudySourceRefV1>, StudyCommandError> {
    let node = detail
        .version
        .nodes
        .iter()
        .find(|node| node.included && node.node_id == assignment.topic_id)
        .ok_or_else(invalid_manifest)?;
    if assignment
        .objective_indexes
        .iter()
        .any(|index| *index >= node.learning_objectives.len())
    {
        return Err(invalid_manifest());
    }

    if matches!(
        detail.version.knowledge_authority,
        StudyPlanKnowledgeAuthority::ModelOnly
    ) {
        return Err(invalid_manifest());
    }
    let scope = detail.version.source_scope.as_ref();
    let manual_unscoped = scope.is_none()
        && matches!(
            detail.version.knowledge_authority,
            StudyPlanKnowledgeAuthority::Manual
        );
    let document = scope
        .and_then(|scope| scope.get("resolvedDocuments"))
        .and_then(Value::as_array)
        .and_then(|documents| {
            documents.iter().find(|document| {
                document.get("documentId").and_then(Value::as_str) == Some(&assignment.document_id)
            })
        });
    if document.is_none() && !manual_unscoped {
        return Err(invalid_manifest());
    }
    let extract_ids = document
        .and_then(|value| value.get("extractIds"))
        .and_then(Value::as_array);
    let selected_ids = scope
        .and_then(|scope| scope.pointer("/selected/documentIds"))
        .and_then(Value::as_array);
    let whole_document = contains_id(selected_ids, &assignment.document_id)
        || (document.is_some() && selected_ids.is_none() && extract_ids.is_none_or(Vec::is_empty));
    let mut references = Vec::new();
    for ref_id in &assignment.source_ref_ids {
        if !node.source_ref_ids.contains(ref_id) {
            return Err(invalid_manifest());
        }
        let resolution = detail
            .source_refs
            .get(ref_id)
            .ok_or_else(invalid_manifest)?;
        let reference = &resolution.ref_item;
        if resolution.status != StudySourceStatus::Current
            || reference.document_id != assignment.document_id
            || reference.revision != assignment.document_revision
            || document.is_some_and(|value| {
                value.get("revision").and_then(Value::as_str) != Some(&reference.revision)
            })
        {
            return Err(source_changed());
        }
        if !whole_document
            && !manual_unscoped
            && !reference
                .extract_id
                .as_ref()
                .is_some_and(|id| contains_id(extract_ids, id))
        {
            return Err(invalid_manifest());
        }
        if references
            .first()
            .is_some_and(|first: &&StudySourceRefV1| first.extract_id != reference.extract_id)
        {
            return Err(invalid_manifest());
        }
        references.push(reference);
    }
    if manual_unscoped
        && assignment.segments.iter().any(|segment| {
            let quote = normalize_for_match(&segment.quote.exact);
            !references
                .iter()
                .any(|reference| normalize_for_match(&reference.excerpt).contains(&quote))
        })
    {
        return Err(invalid_manifest());
    }
    Ok(references)
}

fn contains_id(values: Option<&Vec<Value>>, id: &str) -> bool {
    values.is_some_and(|values| values.iter().any(|value| value.as_str() == Some(id)))
}

async fn verify_source_snapshots(
    tx: &mut Transaction<'_, Sqlite>,
    documents: HashMap<String, DocumentSnapshot>,
    extracts: HashMap<String, ExtractSnapshot>,
) -> Result<(), StudyCommandError> {
    for (id, snapshot) in documents {
        let current = sqlx::query_as::<_, DocumentSnapshot>(DOCUMENT_SNAPSHOT_SQL)
            .bind(id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(storage)?;
        if current.as_ref() != Some(&snapshot) {
            return Err(source_changed());
        }
    }
    for (id, snapshot) in extracts {
        let current = sqlx::query_as::<_, ExtractSnapshot>(EXTRACT_SNAPSHOT_SQL)
            .bind(id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(storage)?;
        if current.as_ref() != Some(&snapshot) {
            return Err(source_changed());
        }
    }
    Ok(())
}

fn retain_unchanged_progress(
    current: StudyReadingTrail,
    manifest: &StudyReadingManifest,
) -> Option<StudyTrailSession> {
    let mut session = current.session?;
    let old_assignments: HashMap<_, _> = current
        .manifest
        .assignments
        .iter()
        .map(|assignment| (assignment.id.as_str(), assignment))
        .collect();
    let retained: HashSet<_> = manifest
        .assignments
        .iter()
        .filter(|assignment| {
            old_assignments
                .get(assignment.id.as_str())
                .is_some_and(|old| {
                    old.document_id == assignment.document_id
                        && old.document_revision == assignment.document_revision
                        && old.topic_id == assignment.topic_id
                        && old.format == assignment.format
                        && old.segments == assignment.segments
                        && old.objective_indexes == assignment.objective_indexes
                })
        })
        .map(|assignment| assignment.id.as_str())
        .collect();
    session
        .completed_assignment_ids
        .retain(|id| retained.contains(id.as_str()));
    session
        .skipped_assignment_ids
        .retain(|id| retained.contains(id.as_str()));
    if session
        .current_assignment_id
        .as_deref()
        .is_some_and(|id| !retained.contains(id))
    {
        session.current_assignment_id = None;
    }
    if session.topic_id.as_ref().is_some_and(|topic_id| {
        !manifest
            .assignments
            .iter()
            .any(|assignment| &assignment.topic_id == topic_id)
    }) {
        session.topic_id = None;
    }
    Some(session)
}

fn validate_session(
    manifest: &StudyReadingManifest,
    session: &StudyTrailSession,
) -> Result<(), StudyCommandError> {
    let assignments: HashMap<_, _> = manifest
        .assignments
        .iter()
        .map(|assignment| (assignment.id.as_str(), assignment.topic_id.as_str()))
        .collect();
    let mut processed = HashSet::new();
    let progress_is_valid = session.completed_assignment_ids.len()
        + session.skipped_assignment_ids.len()
        <= assignments.len()
        && session
            .completed_assignment_ids
            .iter()
            .chain(&session.skipped_assignment_ids)
            .all(|id| assignments.contains_key(id.as_str()) && processed.insert(id));
    let current_is_valid = session.current_assignment_id.as_ref().is_none_or(|id| {
        assignments.get(id.as_str()).is_some_and(|topic| {
            session
                .topic_id
                .as_deref()
                .is_none_or(|wanted| *topic == wanted)
        })
    });
    let topic_is_valid = session
        .topic_id
        .as_deref()
        .is_none_or(|topic| assignments.values().any(|candidate| *candidate == topic));
    if !progress_is_valid || !current_is_valid || !topic_is_valid {
        return Err(StudyCommandError::invalid_input(
            "study_reading.error.invalid_session",
            vec![],
        ));
    }
    Ok(())
}

fn validate_manifest(manifest: &StudyReadingManifest) -> Result<(), StudyCommandError> {
    let mut ids = HashSet::new();
    if manifest.assignments.len() > MAX_ASSIGNMENTS {
        return Err(invalid_manifest());
    }
    for assignment in &manifest.assignments {
        if assignment.schema_version != 1
            || !ids.insert(&assignment.id)
            || [
                &assignment.id,
                &assignment.topic_id,
                &assignment.document_id,
                &assignment.document_revision,
            ]
            .iter()
            .any(|id| !bounded_text(id, MAX_ID_LENGTH))
            || assignment.document_revision == "unknown"
            || !bounded_text(&assignment.document_title, 512)
            || assignment
                .label
                .as_ref()
                .is_some_and(|label| !bounded_text(label, 240))
            || assignment
                .rationale
                .as_ref()
                .is_some_and(|text| !bounded_text(text, 1000))
            || !(1..=MAX_SEGMENTS).contains(&assignment.segments.len())
            || !(1..=MAX_EVIDENCE_REFS).contains(&assignment.source_ref_ids.len())
            || assignment
                .source_ref_ids
                .iter()
                .collect::<HashSet<_>>()
                .len()
                != assignment.source_ref_ids.len()
            || assignment
                .source_ref_ids
                .iter()
                .any(|id| !bounded_text(id, MAX_ID_LENGTH))
            || assignment.objective_indexes.len()
                > super::study_plan_repository::MAX_OBJECTIVES_COUNT
            || assignment
                .objective_indexes
                .iter()
                .collect::<HashSet<_>>()
                .len()
                != assignment.objective_indexes.len()
        {
            return Err(invalid_manifest());
        }
        for segment in &assignment.segments {
            if !bounded_text(&segment.quote.exact, EXCERPT_MAX_CHARS)
                || normalize_for_match(&segment.quote.exact).is_empty()
                || segment.spine_index.is_some_and(|index| {
                    assignment.format != StudyReadingFormat::Epub || index > i32::MAX as u32
                })
                || segment
                    .heading
                    .as_ref()
                    .is_some_and(|heading| !bounded_text(heading, 240))
                || [&segment.quote.prefix, &segment.quote.suffix]
                    .iter()
                    .any(|context| {
                        context
                            .as_ref()
                            .is_some_and(|text| !bounded_text(text, MAX_CONTEXT_LENGTH))
                    })
                || segment
                    .location
                    .as_ref()
                    .is_some_and(|location| !valid_location(assignment.format, location))
            {
                return Err(invalid_manifest());
            }
        }
    }
    Ok(())
}

fn bounded_text(value: &str, limit: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= limit && !value.contains('\0')
}

fn valid_location(format: StudyReadingFormat, location: &Value) -> bool {
    let Some(fields) = location.as_object() else {
        return false;
    };
    if fields.get("kind").and_then(Value::as_str) != Some(format.as_str()) {
        return false;
    }

    fields
        .iter()
        .all(|(key, value)| match (format, key.as_str()) {
            (_, "kind") => true,
            (_, "textQuote") => value
                .as_str()
                .is_some_and(|text| bounded_text(text, EXCERPT_MAX_CHARS)),
            (StudyReadingFormat::Pdf, "pageNumber") => value
                .as_u64()
                .is_some_and(|page| (1..=i32::MAX as u64).contains(&page)),
            (StudyReadingFormat::Pdf, "textOffsetHint")
            | (StudyReadingFormat::Epub, "matchIndex") => value
                .as_u64()
                .is_some_and(|offset| offset <= i32::MAX as u64),
            (StudyReadingFormat::Epub, "cfi" | "cfiRange") => {
                value.as_str().is_some_and(|cfi| bounded_text(cfi, 1000))
            }
            (StudyReadingFormat::Html, "selector") => value
                .as_str()
                .is_some_and(|selector| bounded_text(selector, 512)),
            (StudyReadingFormat::Html | StudyReadingFormat::Markdown, "scrollPercent") => value
                .as_f64()
                .is_some_and(|percent| (0.0..=100.0).contains(&percent)),
            _ => false,
        })
        && (format != StudyReadingFormat::Pdf || fields.contains_key("pageNumber"))
        && (format != StudyReadingFormat::Epub || fields.contains_key("cfi"))
}

fn storage(error: impl std::fmt::Display) -> StudyCommandError {
    StudyCommandError::storage_failed(error.to_string())
}

fn invalid_manifest() -> StudyCommandError {
    StudyCommandError::invalid_input("study_reading.error.invalid_manifest", vec![])
}

fn stale_revision() -> StudyCommandError {
    StudyCommandError::stale_revision("study_plan.error.stale_revision")
}

fn source_changed() -> StudyCommandError {
    StudyCommandError::new(
        StudyErrorCode::SourceChanged,
        "study_reading.error.source_changed",
        true,
    )
}
