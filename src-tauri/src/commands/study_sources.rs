//! Tauri commands for Study Sources resolution and metadata.
//!
//! Implements specifications from:
//! - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §11
//! - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T06)

use crate::database::{Repository, StudySourceRepository};
use crate::models::{StudyCommandError, StudySourceRefInput, StudySourceResolution};
use tauri::State;

fn repository(repo: &Repository) -> StudySourceRepository {
    StudySourceRepository::new(repo.pool().clone())
}

#[tauri::command]
pub async fn resolve_study_source_refs(
    input: Vec<StudySourceRefInput>,
    repo: State<'_, Repository>,
) -> Result<Vec<StudySourceResolution>, StudyCommandError> {
    repository(&repo).resolve_study_source_refs(&input).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
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
    async fn test_resolve_study_source_refs_command() {
        let repo = setup_test_repo().await;
        let source_repo = repository(&repo);

        // Seed a document
        sqlx::query(
            r#"INSERT INTO documents (id, title, file_path, file_type, content, content_hash, date_added, date_modified)
               VALUES ('doc_cmd1', 'Command Doc', '/path.pdf', 'pdf', 'Some test content here.', 'hash123', '2026-11-10T10:00:00Z', '2026-11-10T10:00:00Z')"#,
        )
        .execute(repo.pool())
        .await
        .expect("seed doc");

        let input = StudySourceRefInput {
            document_id: "doc_cmd1".to_string(),
            extract_id: None,
            excerpt: "Some test content here.".to_string(),
            excerpt_sha256: None,
            revision: Some("hash123".to_string()),
            revision_kind: None,
            document_title: Some("Command Doc".to_string()),
            source_type: Some("pdf".to_string()),
            jump: Some(json!({"page": 1})),
            chunk: None,
            section_label: None,
        };

        let res = source_repo
            .resolve_study_source_refs(&[input])
            .await
            .expect("resolve");
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].status, crate::models::StudySourceStatus::Current);
    }
}
