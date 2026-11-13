//! Tauri commands for Study Plans lifecycle management.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §11
//! - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T06)

use crate::database::{Repository, StudyPlanRepository};
use crate::models::{
    CreateStudyPlanInput, LegacyImportResult, NodeActivity, RenameStudyPlanInput,
    SaveStudyPlanDraftInput, StudyCommandError, StudyPlan, StudyPlanDetail,
    StudyPlanPreferences, StudyPlanSummary,
};
use tauri::State;

fn repository(repo: &Repository) -> StudyPlanRepository {
    StudyPlanRepository::new(repo.pool().clone())
}

#[tauri::command]
pub async fn create_study_plan(
    input: CreateStudyPlanInput,
    repo: State<'_, Repository>,
) -> Result<StudyPlanDetail, StudyCommandError> {
    repository(&repo).create_study_plan(input).await
}

#[tauri::command]
pub async fn list_study_plans(
    include_archived: Option<bool>,
    repo: State<'_, Repository>,
) -> Result<Vec<StudyPlanSummary>, StudyCommandError> {
    repository(&repo)
        .list_study_plans(include_archived.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn get_study_plan_preferences(
    plan_id: String,
    repo: State<'_, Repository>,
) -> Result<StudyPlanPreferences, StudyCommandError> {
    repository(&repo).get_study_plan_preferences(&plan_id).await
}

#[tauri::command]
pub async fn update_study_plan_preferences(
    plan_id: String,
    preferences: StudyPlanPreferences,
    repo: State<'_, Repository>,
) -> Result<StudyPlanPreferences, StudyCommandError> {
    repository(&repo)
        .update_study_plan_preferences(&plan_id, preferences)
        .await
}

#[tauri::command]
pub async fn get_study_plan(
    plan_id: String,
    version_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<StudyPlanDetail, StudyCommandError> {
    repository(&repo)
        .get_study_plan(&plan_id, version_id.as_deref())
        .await
}

#[tauri::command]
pub async fn save_study_plan_draft(
    input: SaveStudyPlanDraftInput,
    repo: State<'_, Repository>,
) -> Result<StudyPlanDetail, StudyCommandError> {
    repository(&repo).save_study_plan_draft(input).await
}

#[tauri::command]
pub async fn rename_study_plan(
    input: RenameStudyPlanInput,
    repo: State<'_, Repository>,
) -> Result<StudyPlan, StudyCommandError> {
    repository(&repo)
        .rename_study_plan(
            &input.plan_id,
            &input.title,
            &input.expected_title,
            input.expected_plan_revision,
        )
        .await
}

#[tauri::command]
pub async fn publish_study_plan_version(
    plan_id: String,
    draft_version_id: String,
    expected_plan_revision: i64,
    repo: State<'_, Repository>,
) -> Result<StudyPlanDetail, StudyCommandError> {
    repository(&repo)
        .publish_study_plan_version(&plan_id, &draft_version_id, expected_plan_revision)
        .await
}

#[tauri::command]
pub async fn discard_study_plan_draft(
    plan_id: String,
    expected_plan_revision: i64,
    repo: State<'_, Repository>,
) -> Result<StudyPlanDetail, StudyCommandError> {
    repository(&repo)
        .discard_study_plan_draft(&plan_id, expected_plan_revision)
        .await
}

#[tauri::command]
pub async fn set_study_plan_node_activity(
    plan_id: String,
    node_id: String,
    activity: NodeActivity,
    expected_plan_revision: i64,
    repo: State<'_, Repository>,
) -> Result<StudyPlanDetail, StudyCommandError> {
    repository(&repo)
        .set_study_plan_node_activity(&plan_id, &node_id, activity, expected_plan_revision)
        .await
}

#[tauri::command]
pub async fn archive_study_plan(
    plan_id: String,
    expected_plan_revision: i64,
    repo: State<'_, Repository>,
) -> Result<(), StudyCommandError> {
    repository(&repo)
        .archive_study_plan(&plan_id, expected_plan_revision)
        .await
}

#[tauri::command]
pub async fn delete_study_plan(
    plan_id: String,
    expected_plan_revision: i64,
    repo: State<'_, Repository>,
) -> Result<(), StudyCommandError> {
    repository(&repo)
        .delete_study_plan(&plan_id, expected_plan_revision)
        .await
}

#[tauri::command]
pub async fn import_legacy_study_plans(
    payload: String,
    import_hash: String,
    repo: State<'_, Repository>,
) -> Result<LegacyImportResult, StudyCommandError> {
    repository(&repo)
        .import_legacy_study_plans(&payload, &import_hash)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
    use crate::models::{MaterialSupport, StudyDepth, StudyPlanVersionNode};
    use serde_json::json;
    use std::path::PathBuf;

    async fn setup_test_repo() -> Repository {
        let db = Database::new(PathBuf::from(":memory:"))
            .await
            .expect("memory db");
        db.migrate().await.expect("migrate");
        Repository::new(db.pool().clone())
    }

    #[tokio::test]
    async fn test_study_plan_commands_direct_flow() {
        let repo = setup_test_repo().await;
        let plan_repo = repository(&repo);

        let input = CreateStudyPlanInput {
            title: "Command Test Plan".to_string(),
            goal: "Master Rust commands".to_string(),
            depth: StudyDepth::Foundational,
            source_scope: Some(json!({
                "schemaVersion": 1,
                "selected": {
                    "documentIds": ["d1"],
                    "extractIds": [],
                    "collectionIds": [],
                    "tagIds": []
                },
                "resolvedDocuments": [],
                "frozenAt": "2026-11-10T12:00:00Z",
                "indexCompleteness": "complete"
            })),
            knowledge_authority: None,
            initial_nodes: Some(vec![StudyPlanVersionNode {
                node_id: "spn_c1".to_string(),
                title: "Rust Commands".to_string(),
                summary: "Learn commands".to_string(),
                learning_objectives: vec!["Write command".to_string()],
                concept_id: None,
                concept_label: "Commands".to_string(),
                position: 0,
                included: true,
                locked: false,
                user_added: true,
                user_modified: false,
                material_support: MaterialSupport::Grounded,
                why_here: None,
                source_ref_ids: vec![],
            }]),
            initial_prerequisites: Some(vec![]),
        };

        // 1. Create plan
        let detail = plan_repo.create_study_plan(input).await.expect("create");
        assert_eq!(detail.plan.title, "Command Test Plan");
        assert_eq!(detail.version.nodes.len(), 1);

        // 2. List plans
        let summaries = plan_repo.list_study_plans(false).await.expect("list");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].title, "Command Test Plan");

        // 3. Get plan
        let fetched = plan_repo
            .get_study_plan(&detail.plan.id, None)
            .await
            .expect("get");
        assert_eq!(fetched.plan.id, detail.plan.id);

        // 4. Set activity
        let with_act = plan_repo
            .set_study_plan_node_activity(
                &detail.plan.id,
                "spn_c1",
                NodeActivity::InProgress,
                detail.plan.revision,
            )
            .await
            .expect("activity");
        assert_eq!(
            with_act.activity_by_node_id.get("spn_c1"),
            Some(&NodeActivity::InProgress)
        );

        // 5. Publish
        let published = plan_repo
            .publish_study_plan_version(&detail.plan.id, &detail.version.id, with_act.plan.revision)
            .await
            .expect("publish");
        assert_eq!(published.plan.current_version, 1);

        // 6. Archive
        plan_repo
            .archive_study_plan(&detail.plan.id, published.plan.revision)
            .await
            .expect("archive");
        let active = plan_repo
            .list_study_plans(false)
            .await
            .expect("active list");
        assert!(active.is_empty());
        let archived = plan_repo.list_study_plans(true).await.expect("all list");
        assert_eq!(archived.len(), 1);

        // 7. Delete
        let archived_detail = plan_repo
            .get_study_plan(&detail.plan.id, None)
            .await
            .expect("get archived");
        plan_repo
            .delete_study_plan(&detail.plan.id, archived_detail.plan.revision)
            .await
            .expect("delete");
        let after_del = plan_repo.list_study_plans(true).await.expect("after del");
        assert!(after_del.is_empty());
    }

    #[tokio::test]
    async fn test_study_plan_command_error_shapes() {
        let repo = setup_test_repo().await;
        let plan_repo = repository(&repo);

        // Not found
        let err = plan_repo
            .get_study_plan("sp_nonexistent", None)
            .await
            .expect_err("should fail");
        assert_eq!(err.code, crate::models::StudyErrorCode::NotFound);
        assert!(!err.retryable);

        // Serializes to valid JSON matching camelCase
        let err_json = serde_json::to_string(&err).expect("serialize error");
        assert!(err_json.contains("\"code\":\"not_found\""));
        assert!(err_json.contains("\"messageKey\":"));
        assert!(err_json.contains("\"retryable\":false"));
    }
}
