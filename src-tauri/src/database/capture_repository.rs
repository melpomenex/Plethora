//! Metadata-only browser saves. Eligibility is applied before pagination and counting.

use crate::database::Repository;
use crate::error::Result;
use crate::models::{
    capture::{browser_capture_url, share_capture_eligible, share_capture_url},
    Document,
};
use chrono::{DateTime, Utc};
use futures::TryStreamExt;
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};

// A coarse SQL prefilter only: the shared Rust classifier remains authoritative.
// Removing article payloads here prevents rich HTML/images from crossing the query boundary.
const CAPTURE_ROWS: &str = "SELECT id, title, file_type, file_path, date_added, cover_image_url, cover_image_source,
    CASE WHEN json_valid(metadata) THEN json_object(
      'source', json_extract(metadata, '$.source'),
      'captureProvenance', json_extract(metadata, '$.captureProvenance'),
      'shareProvenance', json_extract(metadata, '$.shareProvenance'),
      'browserCaptureContext', json_extract(metadata, '$.browserCaptureContext'),
      'originalUrl', json_extract(metadata, '$.originalUrl'),
      'url', json_extract(metadata, '$.url'),
      'webArticle', json_object('originalUrl', json_extract(metadata, '$.webArticle.originalUrl'))
    ) ELSE NULL END AS capture_metadata
    FROM documents WHERE is_archived = 0 AND COALESCE(is_dismissed, 0) = 0
    AND CASE WHEN json_valid(metadata) THEN
      json_extract(metadata, '$.source') = 'browser_extension'
      OR json_extract(metadata, '$.captureProvenance.source') = 'browser_extension'
      OR json_extract(metadata, '$.source') IN ('share_extension', 'android_share')
      OR json_extract(metadata, '$.captureProvenance.source') IN ('share_extension', 'android_share')
      OR json_extract(metadata, '$.shareProvenance') IS NOT NULL
    ELSE 0 END
    ORDER BY date_added DESC, id DESC";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureListingSource {
    BrowserExtension,
    ShareTarget,
}

impl TryFrom<&str> for CaptureListingSource {
    type Error = crate::error::PlethoraError;

    fn try_from(source: &str) -> std::result::Result<Self, Self::Error> {
        match source {
            "browser-extension" => Ok(Self::BrowserExtension),
            "share-target" => Ok(Self::ShareTarget),
            other => Err(crate::error::PlethoraError::InvalidInput(format!(
                "Unsupported capture source: {other}"
            ))),
        }
    }
}

impl CaptureListingSource {
    fn eligible(self, metadata: Option<&str>, file_path: &str) -> bool {
        match self {
            Self::BrowserExtension => browser_capture_url(metadata, file_path).is_some(),
            Self::ShareTarget => share_capture_eligible(metadata),
        }
    }

    fn source_url(self, metadata: Option<&str>, file_path: &str) -> Option<String> {
        match self {
            Self::BrowserExtension => browser_capture_url(metadata, file_path),
            Self::ShareTarget => share_capture_url(metadata, file_path),
        }
    }
}

#[derive(Debug, serde::Serialize)]
pub struct CaptureDocument {
    pub document_id: String,
    pub title: String,
    pub file_type: String,
    pub source_url: Option<String>,
    pub date_added: DateTime<Utc>,
    pub cover_image_url: Option<String>,
    pub cover_image_source: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct CapturePage {
    pub items: Vec<CaptureDocument>,
    pub total_count: usize,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, serde::Serialize)]
pub struct BrowserCaptureDocument {
    pub document_id: String,
    pub title: String,
    pub file_type: String,
    pub source_url: String,
    pub date_added: DateTime<Utc>,
    pub cover_image_url: Option<String>,
    pub cover_image_source: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct BrowserCapturePage {
    pub items: Vec<BrowserCaptureDocument>,
    pub total_count: usize,
    pub limit: i64,
    pub offset: i64,
}

pub async fn browser_capture_documents(
    pool: &SqlitePool,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<BrowserCapturePage> {
    let page = capture_documents(
        pool,
        "browser-extension",
        limit,
        offset,
    )
    .await?;
    let items = page
        .items
        .into_iter()
        .filter_map(|item| {
            Some(BrowserCaptureDocument {
                document_id: item.document_id,
                title: item.title,
                file_type: item.file_type,
                source_url: item.source_url?,
                date_added: item.date_added,
                cover_image_url: item.cover_image_url,
                cover_image_source: item.cover_image_source,
            })
        })
        .collect();
    Ok(BrowserCapturePage {
        items,
        total_count: page.total_count,
        limit: page.limit,
        offset: page.offset,
    })
}

pub async fn capture_documents(
    pool: &SqlitePool,
    source: &str,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<CapturePage> {
    let source = CaptureListingSource::try_from(source)?;
    let limit = limit.unwrap_or(6).clamp(1, 100);
    let offset = offset.unwrap_or(0).max(0);
    let mut result = CapturePage {
        items: Vec::new(),
        total_count: 0,
        limit,
        offset,
    };
    let mut rows = sqlx::query(CAPTURE_ROWS).fetch(pool);
    while let Some(row) = rows.try_next().await? {
        let metadata: Option<String> = row.try_get("capture_metadata")?;
        let path: String = row.try_get("file_path")?;
        if !source.eligible(metadata.as_deref(), &path) {
            continue;
        }
        let source_url = source.source_url(metadata.as_deref(), &path);
        let Ok(date_added) = row.try_get::<DateTime<Utc>, _>("date_added") else {
            continue;
        };
        let index = result.total_count;
        result.total_count += 1;
        if index < offset as usize || result.items.len() >= limit as usize {
            continue;
        }
        result.items.push(CaptureDocument {
            document_id: row.try_get("id")?,
            title: row.try_get("title")?,
            file_type: row.try_get("file_type")?,
            source_url,
            date_added,
            cover_image_url: row.try_get("cover_image_url")?,
            cover_image_source: row.try_get("cover_image_source")?,
        });
    }
    Ok(result)
}

impl Repository {
    /// Existing Library summary contract, filtered in persisted data and without article bodies.
    pub async fn list_capture_summaries(&self, source: &str) -> Result<Vec<Document>> {
        let source = CaptureListingSource::try_from(source)?;
        let mut ids = Vec::<String>::new();
        let mut rows = sqlx::query(CAPTURE_ROWS).fetch(self.pool());
        while let Some(row) = rows.try_next().await? {
            let metadata: Option<String> = row.try_get("capture_metadata")?;
            let path: String = row.try_get("file_path")?;
            if source.eligible(metadata.as_deref(), &path)
                && row.try_get::<DateTime<Utc>, _>("date_added").is_ok()
            {
                ids.push(row.try_get("id")?);
            }
        }
        drop(rows);
        let mut documents = Vec::new();
        for chunk in ids.chunks(100) {
            let mut query = QueryBuilder::<Sqlite>::new("SELECT id, collection_id, title, file_path, file_type, total_pages, current_page, current_scroll_percent, current_cfi, current_view_state, position_json, progress_percent, category, tags, date_added, date_modified, date_last_reviewed, extract_count, learning_item_count, priority_rating, priority_slider, priority_score, priority_explicitly_set, is_archived, is_favorite, is_dismissed, cover_image_url, cover_image_source, next_reading_date, reading_count, stability, difficulty, reps, total_time_spent, consecutive_count, interval_modifier, first_reviewed_at, NULL AS content, NULL AS content_hash, CASE WHEN json_valid(metadata) THEN json_remove(metadata, '$.articleHtml', '$.extractedImages', '$.structuredContent') ELSE NULL END AS metadata FROM documents WHERE id IN (");
            let mut separated = query.separated(", ");
            for id in chunk {
                separated.push_bind(id);
            }
            separated.push_unseparated(") ORDER BY date_added DESC, id DESC");
            for row in query.build().fetch_all(self.pool()).await? {
                documents.push(Self::row_to_document(&row)?);
            }
        }
        Ok(documents)
    }

    pub async fn list_browser_capture_summaries(&self) -> Result<Vec<Document>> {
        self.list_capture_summaries("browser-extension").await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn browser_saves_are_filtered_before_paging_with_stable_order() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE documents (id TEXT, title TEXT, file_type TEXT, file_path TEXT, date_added TEXT, cover_image_url TEXT, cover_image_source TEXT, metadata TEXT, is_archived INTEGER, is_dismissed INTEGER)")
            .execute(&pool).await.unwrap();
        for n in 0..12 {
            sqlx::query("INSERT INTO documents VALUES (?, 'Page', 'html', 'https://example.org/page', '2025-01-01T00:00:00Z', NULL, NULL, ?, 0, 0)")
                .bind(format!("doc-{n:02}"))
                .bind(r#"{"source":"browser_extension","articleHtml":"large body is not selected"}"#)
                .execute(&pool).await.unwrap();
        }
        for (id, metadata, archived, dismissed, path) in [
            ("bad-json", "not JSON", 0, 0, "https://example.org"),
            (
                "share",
                r#"{"source":"browser_extension","shareProvenance":{}}"#,
                0,
                0,
                "https://example.org",
            ),
            (
                "archived",
                r#"{"source":"browser_extension"}"#,
                1,
                0,
                "https://example.org",
            ),
            (
                "dismissed",
                r#"{"source":"browser_extension"}"#,
                0,
                1,
                "https://example.org",
            ),
            (
                "invalid-url",
                r#"{"source":"browser_extension"}"#,
                0,
                0,
                "javascript:alert(1)",
            ),
        ] {
            sqlx::query("INSERT INTO documents VALUES (?, 'Excluded', 'html', ?, '2026-10-14T00:00:00Z', NULL, NULL, ?, ?, ?)")
                .bind(id).bind(path).bind(metadata).bind(archived).bind(dismissed)
                .execute(&pool).await.unwrap();
        }
        sqlx::query("ALTER TABLE documents ADD COLUMN collection_id TEXT DEFAULT 'default'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE documents SET collection_id = 'another-collection' WHERE id = 'doc-11'",
        )
        .execute(&pool)
        .await
        .unwrap();
        let first = browser_capture_documents(&pool, None, None).await.unwrap();
        assert_eq!(first.total_count, 12);
        assert_eq!(first.items.len(), 6);
        assert_eq!(first.items[0].document_id, "doc-11");
        let next = browser_capture_documents(&pool, Some(6), Some(6))
            .await
            .unwrap();
        assert_eq!(next.items[0].document_id, "doc-05");
        let bounded = browser_capture_documents(&pool, Some(1000), Some(-1))
            .await
            .unwrap();
        assert_eq!((bounded.limit, bounded.offset), (100, 0));
        assert_eq!(bounded.items.len(), 12);
    }

    #[tokio::test]
    async fn share_captures_keep_local_items_and_count_only_valid_live_rows() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE documents (id TEXT, title TEXT, file_type TEXT, file_path TEXT, date_added TEXT, cover_image_url TEXT, cover_image_source TEXT, metadata TEXT, is_archived INTEGER, is_dismissed INTEGER, collection_id TEXT)")
            .execute(&pool).await.unwrap();
        for (id, path, date, metadata, archived, dismissed) in [
            ("share-a", "/private/a.pdf", "2025-01-01T00:00:00Z", r#"{"shareProvenance":{"source":"share_extension"}}"#, 0, 0),
            ("share-b", "/private/b.png", "2025-01-01T00:00:00Z", r#"{"captureProvenance":{"source":"android_share"}}"#, 0, 0),
            ("share-text", "note://local", "2024-01-01T00:00:00Z", r#"{"shareProvenance":{}}"#, 0, 0),
            ("bad-date", "/private/bad", "not-a-date", r#"{"source":"share_extension"}"#, 0, 0),
            ("manual", "https://example.org/manual", "2026-01-01T00:00:00Z", r#"{"source":"manual","url":"https://example.org/manual"}"#, 0, 0),
            ("archived", "/private/archived", "2026-02-01T00:00:00Z", r#"{"source":"share_extension"}"#, 1, 0),
            ("dismissed", "/private/dismissed", "2026-03-01T00:00:00Z", r#"{"source":"android_share"}"#, 0, 1),
        ] {
            sqlx::query("INSERT INTO documents VALUES (?, ?, 'pdf', ?, ?, NULL, NULL, ?, ?, ?, ?)")
                .bind(id).bind(id).bind(path).bind(date).bind(metadata).bind(archived).bind(dismissed)
                .bind(if id == "share-a" { "collection-a" } else { "collection-b" })
                .execute(&pool).await.unwrap();
        }

        let page = capture_documents(&pool, "share-target", Some(2), Some(0)).await.unwrap();
        assert_eq!(page.total_count, 3);
        assert_eq!(page.items.iter().map(|item| item.document_id.as_str()).collect::<Vec<_>>(), ["share-b", "share-a"]);
        assert!(page.items.iter().all(|item| item.source_url.is_none()));
        let later = capture_documents(&pool, "share-target", Some(1), Some(1)).await.unwrap();
        assert_eq!(later.total_count, 3);
        assert_eq!(later.items[0].document_id, "share-a");
        assert!(capture_documents(&pool, "everything", None, None).await.is_err());
    }
    #[tokio::test]
    async fn filtered_library_uses_all_collections_and_omits_article_bodies() {
        let dir = tempfile::tempdir().unwrap();
        let db = crate::database::Database::new(dir.path().join("capture.db"))
            .await
            .unwrap();
        db.migrate().await.unwrap();
        let repo = Repository::new(db.pool().clone());
        let mut doc = Document::new(
            "Browser save".into(),
            "https://example.org/article".into(),
            crate::models::FileType::Html,
        );
        doc.metadata = Some(crate::models::DocumentMetadata {
            source: Some("browser_extension".into()),
            article_html: Some("large article body".into()),
            ..Default::default()
        });
        doc.content = Some("Large document body".into());
        repo.create_document(&doc).await.unwrap();
        let manual = Document::new(
            "Manual".into(),
            "https://example.org/manual".into(),
            crate::models::FileType::Html,
        );
        repo.create_document(&manual).await.unwrap();
        let found = repo.list_browser_capture_summaries().await.unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, doc.id);
        assert!(found[0].content.is_none());
        assert!(found[0].metadata.as_ref().unwrap().article_html.is_none());
        let plan = sqlx::query("EXPLAIN QUERY PLAN SELECT id FROM documents WHERE is_archived = 0 ORDER BY date_added DESC")
            .fetch_all(repo.pool()).await.unwrap();
        assert!(!plan.is_empty());
    }
}
