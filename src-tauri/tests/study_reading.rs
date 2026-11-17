use plethora_tauri_lib::database::{migrations::run_migrations, StudyReadingRepository};
use plethora_tauri_lib::models::{
    StudyErrorCode, StudyReadingAssignment, StudyReadingFormat, StudyReadingManifest,
    StudyReadingQuote, StudyReadingSegment, StudyTrailSession,
};
use sqlx::{Pool, Sqlite};

const QUOTE: &str = "A quorum can intersect across two majorities.";
const NOW: &str = "2026-11-17T00:00:00Z";

async fn fixture() -> Pool<Sqlite> {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    run_migrations(&pool).await.unwrap();
    sqlx::query("INSERT INTO study_plans (id,title,goal,depth,created_at,updated_at) VALUES ('p','Reading','Learn','survey',?1,?1)")
        .bind(NOW).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO study_plan_versions
        (id,plan_id,version,state,source_scope_json,knowledge_authority_json,created_by,created_at,published_at)
        VALUES ('v1','p',1,'published',?1,'{\"kind\":\"manual\"}','user',?2,?2)")
        .bind(r#"{"selected":{"documentIds":["doc"]},"resolvedDocuments":[{"documentId":"doc","revision":"r1"}]}"#)
        .bind(NOW).execute(&pool).await.unwrap();
    sqlx::query(
        "UPDATE study_plans SET current_version_id = 'v1', current_version = 1 WHERE id = 'p'",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO study_plan_nodes (id,plan_id,semantic_key,created_at) VALUES ('topic','p','topic',?1)")
        .bind(NOW).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO study_plan_version_nodes
        (version_id,node_id,title,learning_objectives_json,concept_label,position,included,locked,user_added,user_modified,material_support)
        VALUES ('v1','topic','Quorums','[\"Understand quorum intersection\"]','',0,1,0,0,0,'grounded')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO documents
        (id,collection_id,title,file_path,file_type,content,content_hash,date_added,date_modified)
        VALUES ('doc','00000000-0000-0000-0000-000000000001','Reading','doc.md','markdown',?1,'r1',?2,?2)")
        .bind(QUOTE).bind(NOW).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO study_source_refs
        (id,document_id,excerpt,excerpt_sha256,revision,revision_kind,document_title,source_type,captured_at,jump_json)
        VALUES ('ref','doc',?1,'fixture','r1','content-hash','Reading','markdown',?2,'{\"kind\":\"markdown\",\"scrollPercent\":0}')")
        .bind(QUOTE).bind(NOW).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO study_plan_node_sources VALUES ('v1','topic','ref',0,'primary')")
        .execute(&pool)
        .await
        .unwrap();
    pool
}

fn manifest(quote: &str) -> StudyReadingManifest {
    StudyReadingManifest {
        assignments: vec![StudyReadingAssignment {
            schema_version: 1,
            id: "assignment".into(),
            topic_id: "topic".into(),
            document_id: "doc".into(),
            document_title: "Reading".into(),
            document_revision: "r1".into(),
            format: StudyReadingFormat::Markdown,
            segments: vec![StudyReadingSegment {
                quote: StudyReadingQuote {
                    exact: quote.into(),
                    prefix: None,
                    suffix: None,
                },
                location: Some(serde_json::json!({"kind":"markdown","scrollPercent":0})),
                spine_index: None,
                heading: None,
            }],
            objective_indexes: vec![0],
            source_ref_ids: vec!["ref".into()],
            label: None,
            rationale: None,
            authored: false,
        }],
    }
}

#[tokio::test]
async fn reading_trail_cas_resume_version_isolation_and_cleanup() {
    let pool = fixture().await;
    let repo = StudyReadingRepository::new(pool.clone());
    assert_eq!(repo.get_trail("p", "v1").await.unwrap().revision, 0);
    let saved = repo
        .save_manifest("p", "v1", 0, manifest(QUOTE))
        .await
        .unwrap();
    let session = StudyTrailSession {
        current_assignment_id: Some("assignment".into()),
        completed_assignment_ids: vec!["assignment".into()],
        skipped_assignment_ids: vec![],
        topic_id: Some("topic".into()),
    };
    assert_eq!(
        repo.save_session("p", "v1", 0, session.clone())
            .await
            .unwrap_err()
            .code,
        StudyErrorCode::StaleRevision
    );
    let updated = repo
        .save_session("p", "v1", saved.revision, session.clone())
        .await
        .unwrap();
    let reloaded = StudyReadingRepository::new(pool.clone())
        .get_trail("p", "v1")
        .await
        .unwrap();
    assert_eq!(updated, reloaded);
    assert_eq!(reloaded.session.as_ref(), Some(&session));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM study_plan_node_activity")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );

    let mut modified = manifest("A quorum can intersect");
    modified.assignments[0].authored = true;
    let changed = repo
        .save_manifest("p", "v1", updated.revision, modified)
        .await
        .unwrap();
    assert!(changed.session.unwrap().completed_assignment_ids.is_empty());

    sqlx::query("UPDATE study_plan_versions SET state = 'superseded' WHERE id = 'v1'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO study_plan_versions
        (id,plan_id,version,state,source_scope_json,created_by,created_at,published_at)
        VALUES ('v2','p',2,'published','{}','user',?1,?1)",
    )
    .bind(NOW)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE study_plans SET current_version_id = 'v2' WHERE id = 'p'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(repo.get_trail("p", "v2").await.unwrap().revision, 0);
    assert_eq!(
        repo.get_trail("p", "v1").await.unwrap().revision,
        changed.revision
    );
    assert_eq!(
        repo.save_session("p", "v1", changed.revision, session)
            .await
            .unwrap_err()
            .code,
        StudyErrorCode::StaleRevision
    );
    sqlx::query("DELETE FROM study_plans WHERE id = 'p'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM study_reading_trails")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn reading_trail_rejects_unverified_and_excluded_sources_atomically() {
    let pool = fixture().await;
    let repo = StudyReadingRepository::new(pool.clone());
    assert_eq!(
        repo.save_manifest("p", "v1", 0, manifest("This text is absent."))
            .await
            .unwrap_err()
            .code,
        StudyErrorCode::InvalidSource
    );
    sqlx::query("UPDATE documents SET is_ai_excluded = 1 WHERE id = 'doc'")
        .execute(&pool)
        .await
        .unwrap();
    assert!(repo
        .save_manifest("p", "v1", 0, manifest(QUOTE))
        .await
        .is_err());
    assert_eq!(repo.get_trail("p", "v1").await.unwrap().revision, 0);
}
