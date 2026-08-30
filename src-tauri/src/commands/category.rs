//! Category commands
//!
//! Categories are **name-identity** values: the authoritative state is the
//! free-form `category` string stored on `documents` and `extracts` (the FK to
//! the `categories` table was deliberately removed in migrations 028/038).
//! The `categories` table acts as a sidecar registry that additionally
//! records created-but-unassigned names so management surfaces and
//! `get_categories_by_collection` (collection-archive export) can see them.
//!
//! Because identity is the name, rename/delete propagate by name across every
//! document and extract (no orphaned or silently-lost assignments), and a
//! rename keeps the registry row in sync. Delete clears the name from all
//! items (leaving them uncategorized) and removes the registry row.

use crate::database::Repository;
use crate::error::{PlethoraError, Result};
use crate::models::Category;
use crate::sync::journal::{journal_entity, notify_after_commit};
use crate::sync::payload;
use crate::sync::types::{EntityType, SyncOperation};
use sqlx::Row;
use tauri::State;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorySummary {
    pub name: String,
    pub item_count: i64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryRenameResult {
    pub documents_updated: i64,
    pub extracts_updated: i64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryDeleteResult {
    pub documents_cleared: i64,
    pub extracts_cleared: i64,
}

/// List every distinct category name in use across documents and extracts,
/// plus names recorded in the `categories` table (created-but-unassigned),
/// each with the number of items carrying it.
#[tauri::command]
pub async fn get_categories(repo: State<'_, Repository>) -> Result<Vec<CategorySummary>> {
    category_list(repo.pool()).await
}

/// Create a category (name-identity). Registers the name in the `categories`
/// table so it persists even before any item is assigned, and so it is
/// included in collection-archive exports. Creating an existing name is
/// idempotent and returns the existing registry row.
#[tauri::command]
pub async fn create_category(name: String, repo: State<'_, Repository>) -> Result<Category> {
    category_create(repo.pool(), &name).await
}

/// Rename a category. Propagates the new name to every document and extract
/// carrying the old name (no orphaned items) and keeps the registry row in
/// sync.
#[tauri::command]
pub async fn rename_category(
    name: String,
    new_name: String,
    repo: State<'_, Repository>,
) -> Result<CategoryRenameResult> {
    category_rename(repo.pool(), &name, &new_name).await
}

/// Delete a category. Clears the name from every document and extract
/// (leaving them uncategorized — no item is deleted or left referencing a
/// non-existent category) and removes the registry row.
#[tauri::command]
pub async fn delete_category(
    name: String,
    repo: State<'_, Repository>,
) -> Result<CategoryDeleteResult> {
    category_delete(repo.pool(), &name).await
}

async fn category_list(pool: &sqlx::SqlitePool) -> Result<Vec<CategorySummary>> {
    let rows = sqlx::query(
        r#"
        WITH names AS (
            SELECT TRIM(category) AS name FROM documents WHERE TRIM(category) <> ''
            UNION
            SELECT TRIM(category) FROM extracts WHERE TRIM(category) <> ''
            UNION
            SELECT name FROM categories WHERE TRIM(name) <> ''
        ),
        counts AS (
            SELECT TRIM(category) AS name, COUNT(*) AS n FROM documents WHERE TRIM(category) <> '' GROUP BY TRIM(category)
            UNION ALL
            SELECT TRIM(category), COUNT(*) FROM extracts WHERE TRIM(category) <> '' GROUP BY TRIM(category)
        )
        SELECT n.name AS name, COALESCE(SUM(c.n), 0) AS item_count
        FROM names n
        LEFT JOIN counts c ON c.name = n.name
        GROUP BY n.name
        ORDER BY n.name COLLATE NOCASE
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(PlethoraError::Database)?;

    Ok(rows
        .iter()
        .map(|row| CategorySummary {
            name: row.get("name"),
            item_count: row.get("item_count"),
        })
        .collect())
}

async fn category_create(pool: &sqlx::SqlitePool, name: &str) -> Result<Category> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(PlethoraError::InvalidInput(
            "Category name must not be empty".to_string(),
        ));
    }

    let existing = sqlx::query(
        r#"SELECT id, collection_id, name, parent_id, color, icon, description, date_created, date_modified, document_count
           FROM categories WHERE TRIM(name) = ?1 LIMIT 1"#,
    )
    .bind(&name)
    .fetch_optional(pool)
    .await
    .map_err(PlethoraError::Database)?;

    if let Some(row) = existing {
        return Ok(Category {
            id: row.get("id"),
            collection_id: row.get("collection_id"),
            name: row.get("name"),
            parent_id: row.get::<Option<String>, _>("parent_id"),
            color: row.get::<Option<String>, _>("color"),
            icon: row.get::<Option<String>, _>("icon"),
            description: row.get::<Option<String>, _>("description"),
            date_created: row.get("date_created"),
            date_modified: row.get("date_modified"),
            document_count: row.get("document_count"),
        });
    }

    let category = Category::new(name.clone());
    sqlx::query(
        r#"INSERT INTO categories
           (id, collection_id, name, parent_id, color, icon, description, date_created, date_modified, document_count)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"#,
    )
    .bind(&category.id)
    .bind(&category.collection_id)
    .bind(&category.name)
    .bind(&category.parent_id)
    .bind(&category.color)
    .bind(&category.icon)
    .bind(&category.description)
    .bind(category.date_created)
    .bind(category.date_modified)
    .bind(category.document_count)
    .execute(pool)
    .await
    .map_err(PlethoraError::Database)?;

    Ok(category)
}

/// Rename a category. Propagates the new name to every document and extract
/// carrying the old name (no orphaned items) and keeps the registry row in
/// sync. Matching is case-sensitive (category strings are identity everywhere:
/// filters, `get_category_stats` grouping and the library dropdown all compare
/// exact strings), with surrounding whitespace trimmed. Renaming into an
/// already-existing registry name merges the rows so the registry never holds
/// duplicate names. Runs in one transaction so a mid-sequence failure cannot
/// leave documents/extracts and the registry out of sync (rollback on error).
async fn category_rename(
    pool: &sqlx::SqlitePool,
    name: &str,
    new_name: &str,
) -> Result<CategoryRenameResult> {
    let old_name = name.trim().to_string();
    let new_name = new_name.trim().to_string();

    if old_name.is_empty() || new_name.is_empty() {
        return Err(PlethoraError::InvalidInput(
            "Category names must not be empty".to_string(),
        ));
    }
    if old_name == new_name {
        return Err(PlethoraError::InvalidInput(
            "New category name must differ from the old one".to_string(),
        ));
    }

    let mut tx = pool.begin().await?;

    // Capture the exact affected identities before the rename. Querying by the
    // new name afterwards would also pick up rows that already belonged to the
    // merge target and incorrectly journal them as locally changed.
    let document_ids: Vec<String> =
        sqlx::query_scalar(r#"SELECT id FROM documents WHERE TRIM(category) = ?1"#)
            .bind(&old_name)
            .fetch_all(&mut *tx)
            .await?;
    let extract_ids: Vec<String> =
        sqlx::query_scalar(r#"SELECT id FROM extracts WHERE TRIM(category) = ?1"#)
            .bind(&old_name)
            .fetch_all(&mut *tx)
            .await?;

    let documents = sqlx::query(
        r#"UPDATE documents SET category = ?1, date_modified = ?2 WHERE TRIM(category) = ?3"#,
    )
    .bind(&new_name)
    .bind(chrono::Utc::now())
    .bind(&old_name)
    .execute(&mut *tx)
    .await?;

    let extracts = sqlx::query(
        r#"UPDATE extracts SET category = ?1, date_modified = ?2 WHERE TRIM(category) = ?3"#,
    )
    .bind(&new_name)
    .bind(chrono::Utc::now())
    .bind(&old_name)
    .execute(&mut *tx)
    .await?;

    // Keep the registry free of duplicate names: when the old name has a
    // registry row, either rename it to the new name or, if a registry row
    // for the new name already exists, drop the old row (the new-name row
    // already represents the merged target).
    let old_registry_exists: i64 =
        sqlx::query_scalar(r#"SELECT COUNT(*) FROM categories WHERE TRIM(name) = ?1"#)
            .bind(&old_name)
            .fetch_one(&mut *tx)
            .await?;

    if old_registry_exists > 0 {
        let new_registry_exists: i64 =
            sqlx::query_scalar(r#"SELECT COUNT(*) FROM categories WHERE TRIM(name) = ?1"#)
                .bind(&new_name)
                .fetch_one(&mut *tx)
                .await?;

        if new_registry_exists > 0 {
            sqlx::query(r#"DELETE FROM categories WHERE TRIM(name) = ?1"#)
                .bind(&old_name)
                .execute(&mut *tx)
                .await?;
        } else {
            sqlx::query(
                r#"UPDATE categories SET name = ?1, date_modified = ?2 WHERE TRIM(name) = ?3"#,
            )
            .bind(&new_name)
            .bind(chrono::Utc::now())
            .bind(&old_name)
            .execute(&mut *tx)
            .await?;
        }
    }

    journal_category_assignments(&mut tx, &document_ids, &extract_ids).await?;

    tx.commit().await?;
    if !document_ids.is_empty() || !extract_ids.is_empty() {
        notify_after_commit();
    }

    Ok(CategoryRenameResult {
        documents_updated: documents.rows_affected() as i64,
        extracts_updated: extracts.rows_affected() as i64,
    })
}

/// Delete a category. Clears the name from every document and extract
/// (leaving them uncategorized — no item is deleted or left referencing a
/// non-existent category) and removes the registry row. Runs in one
/// transaction so a mid-sequence failure cannot leave items and the registry
/// out of sync (rollback on error).
async fn category_delete(pool: &sqlx::SqlitePool, name: &str) -> Result<CategoryDeleteResult> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(PlethoraError::InvalidInput(
            "Category name must not be empty".to_string(),
        ));
    }

    let mut tx = pool.begin().await?;

    let document_ids: Vec<String> =
        sqlx::query_scalar(r#"SELECT id FROM documents WHERE TRIM(category) = ?1"#)
            .bind(&name)
            .fetch_all(&mut *tx)
            .await?;
    let extract_ids: Vec<String> =
        sqlx::query_scalar(r#"SELECT id FROM extracts WHERE TRIM(category) = ?1"#)
            .bind(&name)
            .fetch_all(&mut *tx)
            .await?;

    let documents = sqlx::query(
        r#"UPDATE documents SET category = NULL, date_modified = ?1 WHERE TRIM(category) = ?2"#,
    )
    .bind(chrono::Utc::now())
    .bind(&name)
    .execute(&mut *tx)
    .await?;

    let extracts = sqlx::query(
        r#"UPDATE extracts SET category = NULL, date_modified = ?1 WHERE TRIM(category) = ?2"#,
    )
    .bind(chrono::Utc::now())
    .bind(&name)
    .execute(&mut *tx)
    .await?;

    sqlx::query(r#"DELETE FROM categories WHERE TRIM(name) = ?1"#)
        .bind(&name)
        .execute(&mut *tx)
        .await?;

    journal_category_assignments(&mut tx, &document_ids, &extract_ids).await?;

    tx.commit().await?;
    if !document_ids.is_empty() || !extract_ids.is_empty() {
        notify_after_commit();
    }

    Ok(CategoryDeleteResult {
        documents_cleared: documents.rows_affected() as i64,
        extracts_cleared: extracts.rows_affected() as i64,
    })
}

/// Journal category changes as part of the same transaction as the propagated
/// domain writes. Category is part of the `tags` merge group for both entities.
async fn journal_category_assignments(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    document_ids: &[String],
    extract_ids: &[String],
) -> Result<()> {
    for id in document_ids {
        let row = sqlx::query("SELECT * FROM documents WHERE id = ?1")
            .bind(id)
            .fetch_one(&mut **tx)
            .await?;
        let document = Repository::row_to_document(&row)?;
        let sync_payload = payload::document_payload_with_fields(&document, &["tags"])
            .map_err(|e| PlethoraError::Internal(format!("Sync payload encode failed: {e}")))?;
        journal_entity(
            tx,
            EntityType::Document,
            id,
            SyncOperation::Update,
            None,
            sync_payload,
        )
        .await?;
    }

    for id in extract_ids {
        let row = sqlx::query("SELECT * FROM extracts WHERE id = ?1")
            .bind(id)
            .fetch_one(&mut **tx)
            .await?;
        let extract = Repository::row_to_extract(&row)?;
        let sync_payload = payload::extract_payload_with_fields(&extract, &["tags"])
            .map_err(|e| PlethoraError::Internal(format!("Sync payload encode failed: {e}")))?;
        journal_entity(
            tx,
            EntityType::Extract,
            id,
            SyncOperation::Update,
            None,
            sync_payload,
        )
        .await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
    use std::path::PathBuf;

    async fn setup_pool() -> sqlx::SqlitePool {
        let database = Database::new(PathBuf::from(":memory:"))
            .await
            .expect("database");
        database.migrate().await.expect("migrations");
        database.pool().clone()
    }

    async fn insert_document(pool: &sqlx::SqlitePool, id: &str, category: &str) {
        sqlx::query(
            r#"INSERT INTO documents (id, title, file_path, file_type, tags, date_added, date_modified, category)
               VALUES (?1, ?2, ?3, 'pdf', '[]', ?4, ?4, ?5)"#,
        )
        .bind(id)
        .bind(format!("Title {id}"))
        .bind(format!("/tmp/{id}.pdf"))
        .bind(chrono::Utc::now())
        .bind(category)
        .execute(pool)
        .await
        .expect("insert document");
    }

    async fn insert_extract(pool: &sqlx::SqlitePool, id: &str, document_id: &str, category: &str) {
        sqlx::query(
            r#"INSERT INTO extracts (id, document_id, content, date_created, date_modified, category)
               VALUES (?1, ?2, 'content', ?3, ?3, ?4)"#,
        )
        .bind(id)
        .bind(document_id)
        .bind(chrono::Utc::now())
        .bind(category)
        .execute(pool)
        .await
        .expect("insert extract");
    }

    #[tokio::test]
    async fn get_categories_returns_name_identity_union() {
        let pool = setup_pool().await;
        insert_document(&pool, "d1", "Work").await;
        insert_document(&pool, "d2", "  Work  ").await;
        insert_document(&pool, "d3", "Personal").await;
        insert_extract(&pool, "e1", "d1", "Work").await;
        insert_extract(&pool, "e2", "d3", "").await;

        let mut categories = category_list(&pool).await.expect("category_list");
        categories.sort_by(|a, b| a.name.cmp(&b.name));

        assert_eq!(categories.len(), 2);
        assert_eq!(categories[0].name, "Personal");
        assert_eq!(categories[0].item_count, 1);
        assert_eq!(categories[1].name, "Work");
        // 2 documents + 1 extract carry "Work"
        assert_eq!(categories[1].item_count, 3);
    }

    #[tokio::test]
    async fn create_category_is_idempotent_and_persists_empty_names() {
        let pool = setup_pool().await;

        let created = category_create(&pool, "Work").await.expect("create");
        assert_eq!(created.name, "Work");

        let again = category_create(&pool, "Work").await.expect("create again");
        assert_eq!(again.id, created.id);

        let names = category_list(&pool).await.expect("list");
        assert!(names.iter().any(|c| c.name == "Work" && c.item_count == 0));
    }

    #[tokio::test]
    async fn create_category_rejects_empty_name() {
        let pool = setup_pool().await;
        let err = category_create(&pool, "   ")
            .await
            .expect_err("empty name must fail");
        assert!(matches!(err, PlethoraError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn rename_category_propagates_to_all_items_and_registry() {
        let pool = setup_pool().await;
        insert_document(&pool, "d1", "Work").await;
        insert_document(&pool, "d2", "Work").await;
        insert_extract(&pool, "e1", "d1", "Work").await;
        let created = category_create(&pool, "Work").await.expect("create");

        let result = category_rename(&pool, "Work", "Career")
            .await
            .expect("rename");
        assert_eq!(result.documents_updated, 2);
        assert_eq!(result.extracts_updated, 1);

        let docs: Vec<String> = sqlx::query_scalar("SELECT category FROM documents ORDER BY id")
            .fetch_all(&pool)
            .await
            .expect("read categories");
        assert_eq!(docs, vec!["Career".to_string(), "Career".to_string()]);

        let renamed: Option<String> =
            sqlx::query_scalar("SELECT name FROM categories WHERE id = ?1")
                .bind(&created.id)
                .fetch_optional(&pool)
                .await
                .expect("read registry");
        assert_eq!(renamed, Some("Career".to_string()));

        let names = category_list(&pool).await.expect("list");
        assert!(names.iter().all(|c| c.name != "Work"));
        assert!(names
            .iter()
            .any(|c| c.name == "Career" && c.item_count == 3));
    }

    #[tokio::test]
    async fn rename_into_existing_name_merges_registry_without_duplicates() {
        let pool = setup_pool().await;
        // Both names exist as registry rows AND on items.
        insert_document(&pool, "d1", "Work").await;
        insert_document(&pool, "d2", "Career").await;
        let _work_row = category_create(&pool, "Work").await.expect("create Work");
        let career_row = category_create(&pool, "Career")
            .await
            .expect("create Career");

        let result = category_rename(&pool, "Work", "Career")
            .await
            .expect("rename");
        assert_eq!(result.documents_updated, 1);
        assert_eq!(result.extracts_updated, 0);

        // Every item carries the merged name.
        let docs: Vec<String> = sqlx::query_scalar("SELECT category FROM documents ORDER BY id")
            .fetch_all(&pool)
            .await
            .expect("read categories");
        assert_eq!(docs, vec!["Career".to_string(), "Career".to_string()]);

        // Exactly one registry row remains, and it is the pre-existing
        // "Career" row (its id survives; the old "Work" row was merged away).
        let registry_names: Vec<String> =
            sqlx::query_scalar("SELECT name FROM categories ORDER BY id")
                .fetch_all(&pool)
                .await
                .expect("read registry names");
        assert_eq!(registry_names, vec!["Career".to_string()]);
        let remaining_id: Option<String> =
            sqlx::query_scalar("SELECT id FROM categories WHERE name = 'Career'")
                .fetch_optional(&pool)
                .await
                .expect("read surviving row");
        assert_eq!(remaining_id, Some(career_row.id));

        // The merged category lists once with the combined item count.
        let names = category_list(&pool).await.expect("list");
        assert_eq!(names.len(), 1);
        assert_eq!(names[0].name, "Career");
        assert_eq!(names[0].item_count, 2);
    }

    #[tokio::test]
    async fn rename_keeps_registry_consistent_when_only_items_exist() {
        let pool = setup_pool().await;
        // "Work" is in use on items but was never registered; "Career" has no
        // registry row either. Renaming must propagate to items and leave the
        // registry empty (no synthetic row, no duplicates).
        insert_document(&pool, "d1", "Work").await;

        let result = category_rename(&pool, "Work", "Career")
            .await
            .expect("rename");
        assert_eq!(result.documents_updated, 1);

        let docs: Vec<String> = sqlx::query_scalar("SELECT category FROM documents")
            .fetch_all(&pool)
            .await
            .expect("read categories");
        assert_eq!(docs, vec!["Career".to_string()]);

        let registry_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories")
            .fetch_one(&pool)
            .await
            .expect("count registry");
        assert_eq!(registry_count, 0);
    }

    #[tokio::test]
    async fn delete_category_clears_assignments_safely() {
        let pool = setup_pool().await;
        insert_document(&pool, "d1", "Work").await;
        insert_extract(&pool, "e1", "d1", "Work").await;
        let _created = category_create(&pool, "Work").await.expect("create");

        let result = category_delete(&pool, "Work").await.expect("delete");
        assert_eq!(result.documents_cleared, 1);
        assert_eq!(result.extracts_cleared, 1);

        let doc_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM documents")
            .fetch_one(&pool)
            .await
            .expect("count docs");
        assert_eq!(doc_count, 1);
        let docs_with_category: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM documents WHERE category IS NOT NULL")
                .fetch_one(&pool)
                .await
                .expect("count categorized");
        assert_eq!(docs_with_category, 0);

        let registry_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories")
            .fetch_one(&pool)
            .await
            .expect("count registry");
        assert_eq!(registry_count, 0);

        let names = category_list(&pool).await.expect("list");
        assert!(names.is_empty());
    }
}
