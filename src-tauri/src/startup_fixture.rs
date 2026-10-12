//! Compiled only into the disposable startup measurement APK.
use sqlx::SqlitePool;
use std::path::Path;

pub fn validate_dir(app_dir: &Path) -> anyhow::Result<()> {
    // Even a wrongly packaged benchmark binary cannot seed the user's app.
    anyhow::ensure!(
        app_dir
            .components()
            .any(|part| part.as_os_str() == "com.plethora.app.startupbench"),
        "Startup fixture requires the separate com.plethora.app.startupbench package"
    );
    Ok(())
}

pub async fn prepare(app_dir: &Path, pool: &SqlitePool) -> anyhow::Result<()> {
    validate_dir(app_dir)?;
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM documents")
        .fetch_one(pool)
        .await?;
    if exists == 0 {
        let mut tx = pool.begin().await?;
        sqlx::query("WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1000)
            INSERT INTO documents (id, collection_id, title, file_path, file_type, tags, content, date_added, date_modified, learning_item_count)
            SELECT 'startup-doc-'||n, '00000000-0000-0000-0000-000000000001', 'Fixture '||n,
                '/fixture/'||n||'.html', 'html', '[]', '<p>Disposable startup fixture.</p>', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0 FROM seq")
            .execute(&mut *tx).await?;
        sqlx::query("WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<5000)
            INSERT INTO learning_items (id, collection_id, document_id, item_type, question, answer, due_date, date_created, date_modified, tags, image_asset_ids)
            SELECT 'startup-item-'||n, '00000000-0000-0000-0000-000000000001', 'startup-doc-'||(((n-1)/5)+1),
                'flashcard', 'Fixture question', 'Fixture answer', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '[]', '[]' FROM seq")
            .execute(&mut *tx).await?;
        tx.commit().await?;
    }
    let items: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM learning_items")
        .fetch_one(pool)
        .await?;
    let docs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM documents")
        .fetch_one(pool)
        .await?;
    anyhow::ensure!(
        docs == 1000 && items == 5000,
        "Startup fixture counts differ from 1000/5000; refusing measurement"
    );
    // Repair only the disposable fixture's derived count if an older diagnostic
    // build seeded it before accounting for the insert-count triggers.
    sqlx::query(
        "UPDATE documents SET learning_item_count = (
        SELECT COUNT(*) FROM learning_items WHERE document_id = documents.id)
        WHERE learning_item_count != (
        SELECT COUNT(*) FROM learning_items WHERE document_id = documents.id)",
    )
    .execute(pool)
    .await?;
    crate::startup_trace::mark("fixture-1000-5000-verified");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn production_path_is_rejected_before_any_database_query() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect_lazy("sqlite::memory:")
            .unwrap();
        let error = prepare(Path::new("/data/user/0/com.plethora.app/files"), &pool)
            .await
            .unwrap_err();
        assert!(error
            .to_string()
            .contains("separate com.plethora.app.startupbench"));
    }

    #[tokio::test]
    async fn disposable_fixture_is_idempotent_and_populates_the_startup_queries() {
        let db = crate::database::Database::new(":memory:".into())
            .await
            .unwrap();
        db.migrate().await.unwrap();
        let dir = Path::new("/data/user/0/com.plethora.app.startupbench/files");
        prepare(dir, db.pool()).await.unwrap();
        prepare(dir, db.pool()).await.unwrap();
        let repo = crate::database::Repository::new(db.pool().clone());
        let (documents, total) = repo
            .list_startup_document_summaries(crate::models::DEFAULT_COLLECTION_ID, 50, 0)
            .await
            .unwrap();
        assert_eq!(total, 1000);
        assert_eq!(documents.len(), 50);
        let invalid_counts: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM documents WHERE learning_item_count != 5")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(invalid_counts, 0);
        let (queue, total) = crate::commands::queue::get_startup_queue_preview_from_repo(
            &repo,
            Some(crate::models::DEFAULT_COLLECTION_ID),
            50,
            None,
        )
        .await
        .unwrap();
        assert!(total >= 5000);
        assert_eq!(queue.len(), 50);
    }
}
