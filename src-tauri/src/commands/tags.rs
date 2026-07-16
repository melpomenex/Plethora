//! Cross-type tag lookup commands

use crate::database::Repository;
use crate::error::Result;
use sqlx::Row;
use tauri::State;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaggedItemSummary {
    pub id: String,
    pub item_type: String,
    pub title: String,
    pub category: Option<String>,
    /// The document to open to view this item. For `document` this equals
    /// `id`; for `extract`/`learning-item` it's the parent document (`None`
    /// for a learning item with no `document_id`, e.g. extract-only cards).
    pub document_id: Option<String>,
}

/// Find every document, extract, and learning item whose `tags` JSON array
/// contains an exact (case-sensitive) match for `tag`. Uses `json_each` so a
/// tag like "a" doesn't match a stored tag "abc" the way a LIKE scan would.
/// Learning items have no `category` column (unlike documents/extracts), so
/// that field is always `None` for them; their title falls back to `question`
/// since they have no dedicated title field.
pub async fn get_items_by_tag_from_repo(
    repo: &Repository,
    tag: &str,
) -> Result<Vec<TaggedItemSummary>> {
    let pool = repo.pool();
    let mut results = Vec::new();

    let document_rows = sqlx::query(
        r#"
        SELECT DISTINCT d.id, d.title, d.category
        FROM documents d, json_each(d.tags)
        WHERE json_each.value = ?1
        ORDER BY d.title ASC
        "#,
    )
    .bind(tag)
    .fetch_all(pool)
    .await?;

    for row in document_rows {
        let id: String = row.try_get("id")?;
        results.push(TaggedItemSummary {
            id: id.clone(),
            item_type: "document".to_string(),
            title: row.try_get("title")?,
            category: row.try_get("category")?,
            document_id: Some(id),
        });
    }

    let extract_rows = sqlx::query(
        r#"
        SELECT DISTINCT e.id, e.page_title, e.content, e.category, e.document_id
        FROM extracts e, json_each(e.tags)
        WHERE json_each.value = ?1
        ORDER BY e.page_title ASC
        "#,
    )
    .bind(tag)
    .fetch_all(pool)
    .await?;

    for row in extract_rows {
        let page_title: Option<String> = row.try_get("page_title")?;
        let content: String = row.try_get("content")?;
        let title = page_title.unwrap_or_else(|| content.chars().take(80).collect());
        results.push(TaggedItemSummary {
            id: row.try_get("id")?,
            item_type: "extract".to_string(),
            title,
            category: row.try_get("category")?,
            document_id: row.try_get("document_id")?,
        });
    }

    let learning_item_rows = sqlx::query(
        r#"
        SELECT DISTINCT li.id, li.question, li.document_id
        FROM learning_items li, json_each(li.tags)
        WHERE json_each.value = ?1
        ORDER BY li.question ASC
        "#,
    )
    .bind(tag)
    .fetch_all(pool)
    .await?;

    for row in learning_item_rows {
        results.push(TaggedItemSummary {
            id: row.try_get("id")?,
            item_type: "learning-item".to_string(),
            title: row.try_get("question")?,
            category: None,
            document_id: row.try_get("document_id")?,
        });
    }

    Ok(results)
}

#[tauri::command]
pub async fn get_items_by_tag(
    tag: String,
    repo: State<'_, Repository>,
) -> Result<Vec<TaggedItemSummary>> {
    get_items_by_tag_from_repo(&repo, &tag).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
    use crate::models::{Document, Extract, FileType, ItemType, LearningItem};
    use std::path::PathBuf;

    async fn setup_repo() -> Repository {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");
        Repository::new(db.pool().clone())
    }

    #[tokio::test]
    async fn returns_empty_when_no_matches() {
        let repo = setup_repo().await;
        let mut document = Document::new("Doc One".to_string(), "/tmp/doc1.pdf".to_string(), FileType::Pdf);
        document.tags = vec!["other".to_string()];
        repo.create_document(&document).await.expect("create document");

        let results = get_items_by_tag_from_repo(&repo, "missing").await.expect("query");
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn matches_across_all_three_tables() {
        let repo = setup_repo().await;

        let mut document = Document::new("Doc One".to_string(), "/tmp/doc1.pdf".to_string(), FileType::Pdf);
        document.tags = vec!["shared".to_string()];
        let document = repo.create_document(&document).await.expect("create document");

        let mut extract = Extract::new(document.id.clone(), "Some extract content".to_string());
        extract.tags = vec!["shared".to_string()];
        let extract = repo.create_extract(&extract).await.expect("create extract");

        let mut learning_item = LearningItem::new(ItemType::Qa, "What?".to_string());
        learning_item.tags = vec!["shared".to_string()];
        let learning_item = repo
            .create_learning_item(&learning_item)
            .await
            .expect("create learning item");

        let results = get_items_by_tag_from_repo(&repo, "shared").await.expect("query");
        assert_eq!(results.len(), 3);
        assert!(results
            .iter()
            .any(|r| r.item_type == "document" && r.id == document.id));
        assert!(results
            .iter()
            .any(|r| r.item_type == "extract" && r.id == extract.id));
        assert!(results
            .iter()
            .any(|r| r.item_type == "learning-item" && r.id == learning_item.id));
    }

    #[tokio::test]
    async fn tag_match_is_case_sensitive() {
        let repo = setup_repo().await;
        let mut document = Document::new("Doc One".to_string(), "/tmp/doc1.pdf".to_string(), FileType::Pdf);
        document.tags = vec!["Shared".to_string()];
        repo.create_document(&document).await.expect("create document");

        let lower = get_items_by_tag_from_repo(&repo, "shared").await.expect("query");
        assert!(lower.is_empty());

        let exact = get_items_by_tag_from_repo(&repo, "Shared").await.expect("query");
        assert_eq!(exact.len(), 1);
    }
}
