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

    let documents = sqlx::query(
        r#"UPDATE documents SET category = ?1, date_modified = ?2 WHERE TRIM(category) = ?3"#,
    )
    .bind(&new_name)
    .bind(chrono::Utc::now())
    .bind(&old_name)
    .execute(pool)
    .await
    .map_err(PlethoraError::Database)?;

    let extracts = sqlx::query(
        r#"UPDATE extracts SET category = ?1, date_modified = ?2 WHERE TRIM(category) = ?3"#,
    )
    .bind(&new_name)
    .bind(chrono::Utc::now())
    .bind(&old_name)
    .execute(pool)
    .await
    .map_err(PlethoraError::Database)?;

    sqlx::query(r#"UPDATE categories SET name = ?1, date_modified = ?2 WHERE TRIM(name) = ?3"#)
        .bind(&new_name)
        .bind(chrono::Utc::now())
        .bind(&old_name)
        .execute(pool)
        .await
        .map_err(PlethoraError::Database)?;

    Ok(CategoryRenameResult {
        documents_updated: documents.rows_affected() as i64,
        extracts_updated: extracts.rows_affected() as i64,
    })
}

async fn category_delete(
    pool: &sqlx::SqlitePool,
    name: &str,
) -> Result<CategoryDeleteResult> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(PlethoraError::InvalidInput(
            "Category name must not be empty".to_string(),
        ));
    }

    let documents = sqlx::query(
        r#"UPDATE documents SET category = NULL, date_modified = ?1 WHERE TRIM(category) = ?2"#,
    )
    .bind(chrono::Utc::now())
    .bind(&name)
    .execute(pool)
    .await
    .map_err(PlethoraError::Database)?;

    let extracts = sqlx::query(
        r#"UPDATE extracts SET category = NULL, date_modified = ?1 WHERE TRIM(category) = ?2"#,
    )
    .bind(chrono::Utc::now())
    .bind(&name)
    .execute(pool)
    .await
    .map_err(PlethoraError::Database)?;

    sqlx::query(r#"DELETE FROM categories WHERE TRIM(name) = ?1"#)
        .bind(&name)
        .execute(pool)
        .await
        .map_err(PlethoraError::Database)?;

    Ok(CategoryDeleteResult {
        documents_cleared: documents.rows_affected() as i64,
        extracts_cleared: extracts.rows_affected() as i64,
    })
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
        let err = category_create(&pool, "   ").await.expect_err("empty name must fail");
        assert!(matches!(err, PlethoraError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn rename_category_propagates_to_all_items_and_registry() {
        let pool = setup_pool().await;
        insert_document(&pool, "d1", "Work").await;
        insert_document(&pool, "d2", "Work").await;
        insert_extract(&pool, "e1", "d1", "Work").await;
        let created = category_create(&pool, "Work").await.expect("create");

        let result = category_rename(&pool, "Work", "Career").await.expect("rename");
        assert_eq!(result.documents_updated, 2);
        assert_eq!(result.extracts_updated, 1);

        let docs: Vec<String> = sqlx::query_scalar("SELECT category FROM documents ORDER BY id")
            .fetch_all(&pool)
            .await
            .expect("read categories");
        assert_eq!(docs, vec!["Career".to_string(), "Career".to_string()]);

        let renamed: Option<String> = sqlx::query_scalar("SELECT name FROM categories WHERE id = ?1")
            .bind(&created.id)
            .fetch_optional(&pool)
            .await
            .expect("read registry");
        assert_eq!(renamed, Some("Career".to_string()));

        let names = category_list(&pool).await.expect("list");
        assert!(names.iter().all(|c| c.name != "Work"));
        assert!(names.iter().any(|c| c.name == "Career" && c.item_count == 3));
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
