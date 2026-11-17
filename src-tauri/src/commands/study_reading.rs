use crate::database::{
    ExamSessionRepository, Repository, StudyPlanRepository, StudyReadingRepository,
    StudySourceRepository,
};
use crate::models::{
    PlanVersionState, StudyCommandError, StudyErrorCode, StudyPlanKnowledgeAuthority,
    StudyReadingChunk, StudyReadingManifest, StudyReadingTrail, StudySourceRefInput,
    StudySourceResolution, StudySourceStatus, StudyTrailSession,
};
use std::collections::BTreeSet;
use tauri::State;

#[tauri::command]
pub async fn get_study_reading_trail(
    plan_id: String,
    version_id: String,
    repo: State<'_, Repository>,
) -> Result<StudyReadingTrail, StudyCommandError> {
    StudyReadingRepository::new(repo.pool().clone())
        .get_trail(&plan_id, &version_id)
        .await
}

#[tauri::command]
pub async fn save_study_reading_manifest(
    plan_id: String,
    version_id: String,
    expected_revision: i64,
    manifest: StudyReadingManifest,
    repo: State<'_, Repository>,
) -> Result<StudyReadingTrail, StudyCommandError> {
    StudyReadingRepository::new(repo.pool().clone())
        .save_manifest(&plan_id, &version_id, expected_revision, manifest)
        .await
}

#[tauri::command]
pub async fn save_study_trail_session(
    plan_id: String,
    version_id: String,
    expected_revision: i64,
    session: StudyTrailSession,
    repo: State<'_, Repository>,
) -> Result<StudyReadingTrail, StudyCommandError> {
    StudyReadingRepository::new(repo.pool().clone())
        .save_session(&plan_id, &version_id, expected_revision, session)
        .await
}

#[tauri::command]
pub async fn get_study_attempt_sources(
    attempt_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<StudySourceResolution>, StudyCommandError> {
    let detail = ExamSessionRepository::get_exam_attempt(repo.pool(), &attempt_id).await?;
    if detail.attempt.submitted_at.is_none()
        || matches!(detail.attempt.status.as_str(), "in-progress" | "cancelled")
    {
        return Err(StudyCommandError::new(
            StudyErrorCode::InvalidState,
            "study_reading.error.attempt_not_submitted",
            false,
        ));
    }
    let ids: BTreeSet<String> = detail
        .questions
        .iter()
        .filter(|question| question.committed_at.is_some())
        .filter_map(|question| question.question.get("sourceRefIds")?.as_array())
        .flatten()
        .filter_map(|id| id.as_str().map(str::to_owned))
        .collect();
    let source_repo = StudySourceRepository::new(repo.pool().clone());
    let stored: Vec<_> = source_repo
        .get_source_refs_batch(&ids.into_iter().collect::<Vec<_>>())
        .await?
        .into_values()
        .collect();
    let inputs: Vec<_> = stored
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
        .collect();
    let resolutions = source_repo.resolve_study_source_refs(&inputs).await?;
    Ok(stored
        .into_iter()
        .zip(resolutions)
        .map(|(reference, mut resolution)| {
            resolution.ref_item = reference;
            resolution
        })
        .collect())
}

#[tauri::command]
pub async fn get_study_reading_chunks(
    plan_id: String,
    version_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<StudyReadingChunk>, StudyCommandError> {
    let detail = StudyPlanRepository::new(repo.pool().clone())
        .get_study_plan(&plan_id, Some(&version_id))
        .await?;
    if detail.version.state != PlanVersionState::Published
        || matches!(
            detail.version.knowledge_authority,
            StudyPlanKnowledgeAuthority::ModelOnly
        )
    {
        return Ok(vec![]);
    }
    let whole_documents = detail
        .version
        .source_scope
        .as_ref()
        .and_then(|scope| scope.pointer("/selected/documentIds"))
        .and_then(serde_json::Value::as_array);
    let mut seen = BTreeSet::new();
    let mut result = Vec::new();
    for resolution in detail.source_refs.values() {
        let reference = &resolution.ref_item;
        let Some(chunk) = &reference.chunk else {
            continue;
        };
        if resolution.status != StudySourceStatus::Current
            || reference.extract_id.is_some()
            || !whole_documents.is_some_and(|ids| {
                ids.iter()
                    .any(|id| id.as_str() == Some(&reference.document_id))
            })
            || !seen.insert(&chunk.chunk_id)
        {
            continue;
        }
        let row = sqlx::query_as::<_, (String, String)>(
            "SELECT c.text, c.location_json FROM semantic_chunks c
             JOIN documents d ON d.id = c.document_id
             WHERE c.id = ? AND c.document_id = ? AND c.source_type = 'document'
               AND d.is_ai_excluded = 0 AND d.is_archived = 0
               AND COALESCE(NULLIF(trim(d.content_hash), ''), NULLIF(trim(d.content_updated_at), ''),
                            NULLIF(trim(d.date_added), ''), 'unknown') = ?",
        )
        .bind(&chunk.chunk_id)
        .bind(&reference.document_id)
        .bind(&reference.revision)
        .fetch_optional(repo.pool())
        .await
        .map_err(|error| StudyCommandError::storage_failed(error.to_string()))?;
        if let Some((text, location)) = row {
            if let Ok(position) =
                serde_json::from_str::<crate::ai_learning::models::ChunkLocation>(&location)
            {
                if position.ordinal == i64::from(chunk.ordinal)
                    && position.start_offset == chunk.start_offset as usize
                    && position.end_offset == chunk.end_offset as usize
                {
                    result.push(StudyReadingChunk {
                        chunk_id: chunk.chunk_id.clone(),
                        text,
                        position,
                    });
                }
            }
        }
    }
    Ok(result)
}
