//! Repository pattern for database operations

use crate::database::{DocumentChunkEmbedding, QueueItemEmbedding};
use crate::error::{IncrementumError, Result};
use crate::models::collection::{Collection, DEFAULT_COLLECTION_ID};
use crate::models::{
    Document, DocumentMetadata, Extract, FileType, ImageAsset, ImageAssetWithUsage, ItemState,
    ItemType, LearningItem, StartupDocumentSummary, TranscriptionJobStatus,
    TranscriptionQueueEntry, TranscriptionQueueEntryWithDoc, VideoExtract,
};
use chrono::Utc;
use sqlx::{sqlite::SqliteRow, Pool, Row, Sqlite};
use std::collections::HashMap;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DocumentQueueInfo {
    pub title: String,
    pub is_archived: bool,
    pub is_dismissed: bool,
}

#[derive(Debug, Clone)]
pub struct SM20OptimizerProfileRow {
    pub coefficients: crate::algorithms::sm20::SM20RecallCoefficients,
    pub objective_score: Option<f64>,
    pub sample_count: u32,
    pub optimizer_version: i32,
    pub model_version: i32,
    pub activation_state: String,
    pub last_optimized_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ArenaReviewProvenance<'a> {
    pub schedule_source: &'a str,
    pub schedule_model_id: Option<&'a str>,
    pub arena_commit_id: &'a str,
    pub recommended_interval: f64,
    pub decision_time_ms: u64,
    pub snapshot: &'a str,
}

#[derive(Clone)]
pub struct Repository {
    pool: Pool<Sqlite>,
}

impl Repository {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    /// Get a reference to the connection pool (for raw queries in import modules).
    pub fn db_pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    // Helper to parse file type from string
    fn parse_file_type(s: &str) -> FileType {
        match s {
            "pdf" => FileType::Pdf,
            "epub" => FileType::Epub,
            "markdown" => FileType::Markdown,
            "html" => FileType::Html,
            "youtube" => FileType::Youtube,
            "audio" => FileType::Audio,
            "video" => FileType::Video,
            _ => FileType::Other,
        }
    }

    // Helper to parse item type from string
    fn parse_item_type(s: &str) -> ItemType {
        match s {
            "flashcard" => ItemType::Flashcard,
            "cloze" => ItemType::Cloze,
            "qa" => ItemType::Qa,
            _ => ItemType::Basic,
        }
    }

    // Helper to parse item state from string
    fn parse_item_state(s: &str) -> ItemState {
        match s {
            "new" => ItemState::New,
            "learning" => ItemState::Learning,
            "review" => ItemState::Review,
            _ => ItemState::Relearning,
        }
    }

    // Helper to parse memory state from optional stability and difficulty
    fn parse_memory_state(
        stability: Option<f64>,
        difficulty: Option<f64>,
    ) -> Option<crate::models::MemoryState> {
        match (stability, difficulty) {
            (Some(s), Some(d)) => Some(crate::models::MemoryState {
                stability: s,
                difficulty: d,
            }),
            _ => None,
        }
    }

    /// Decode one `learning_items` row into a `LearningItem`. Centralized so the
    /// four read methods stay in sync (and so the `updated_at` sync-clock field
    /// is mapped consistently — it is `None` on legacy rows until next review).
    pub fn row_to_learning_item(row: &SqliteRow) -> Result<LearningItem> {
        let item_type_str: String = row.try_get("item_type")?;
        let state_str: String = row.try_get("state")?;
        let tags_json: String = row.try_get("tags")?;
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        let image_asset_ids_json: String = row
            .try_get("image_asset_ids")
            .unwrap_or_else(|_| "[]".to_string());
        let image_asset_ids: Vec<String> =
            serde_json::from_str(&image_asset_ids_json).unwrap_or_default();
        let interaction_metadata_json: Option<String> = row.try_get("interaction_metadata").ok();
        let interaction_metadata = interaction_metadata_json
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok());

        let stability: Option<f64> = row.try_get("memory_state_stability").ok();
        let difficulty: Option<f64> = row.try_get("memory_state_difficulty").ok();
        let memory_state = Self::parse_memory_state(stability, difficulty);

        let algorithm_type: String = row
            .try_get("algorithm_type")
            .unwrap_or_else(|_| "fsrs".to_string());
        let algorithm_state: Option<String> = row.try_get("algorithm_state").ok();

        let cloze_ranges_json: Option<String> = row.try_get("cloze_ranges").ok();
        let cloze_ranges: Option<Vec<(usize, usize)>> = cloze_ranges_json
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok());

        Ok(LearningItem {
            id: row.try_get("id")?,
            collection_id: row
                .try_get("collection_id")
                .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
            extract_id: row.try_get("extract_id")?,
            document_id: row.try_get("document_id")?,
            item_type: Self::parse_item_type(&item_type_str),
            question: row.try_get("question")?,
            answer: row.try_get("answer")?,
            cloze_text: row.try_get("cloze_text")?,
            cloze_ranges,
            difficulty: row.try_get("difficulty")?,
            interval: row.try_get("interval")?,
            ease_factor: row.try_get("ease_factor")?,
            due_date: row.try_get("due_date")?,
            date_created: row.try_get("date_created")?,
            date_modified: row.try_get("date_modified")?,
            last_review_date: row.try_get("last_review_date")?,
            review_count: row.try_get("review_count")?,
            lapses: row.try_get("lapses")?,
            state: Self::parse_item_state(&state_str),
            is_suspended: row.try_get("is_suspended")?,
            tags,
            image_asset_ids,
            interaction_metadata,
            memory_state,
            algorithm_type,
            algorithm_state,
            updated_at: row.try_get("updated_at").ok(),
        })
    }

    // Helper to decode possibly-corrupt UTF-8 text columns without panicking.
    fn decode_optional_text(row: &SqliteRow, column: &str) -> Option<String> {
        match row.try_get::<Option<String>, _>(column) {
            Ok(value) => value,
            Err(_) => match row.try_get::<Option<Vec<u8>>, _>(column) {
                Ok(Some(bytes)) => Some(String::from_utf8_lossy(&bytes).into_owned()),
                Ok(None) => None,
                Err(_) => None,
            },
        }
    }

    // Collection operations

    pub async fn create_collection(
        &self,
        name: &str,
        icon: Option<&str>,
        color: Option<&str>,
    ) -> Result<Collection> {
        let collection = Collection::new(name.to_string());
        let now = Utc::now();
        sqlx::query(
            "INSERT INTO collections (id, name, icon, color, created_at, modified_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
        )
        .bind(&collection.id)
        .bind(&collection.name)
        .bind(icon)
        .bind(color)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(collection)
    }

    pub async fn get_collections(&self) -> Result<Vec<Collection>> {
        let rows = sqlx::query("SELECT * FROM collections ORDER BY name ASC")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .iter()
            .map(|row| Collection {
                id: row.get("id"),
                name: row.get("name"),
                icon: row.try_get("icon").ok(),
                color: row.try_get("color").ok(),
                is_default: row.try_get("is_default").unwrap_or(false),
                created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
                updated_at: row
                    .try_get("modified_at")
                    .or_else(|_| row.try_get("updated_at"))
                    .unwrap_or_else(|_| Utc::now()),
            })
            .collect())
    }

    pub async fn get_collection(&self, id: &str) -> Result<Option<Collection>> {
        let row = sqlx::query("SELECT * FROM collections WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|row| Collection {
            id: row.get("id"),
            name: row.get("name"),
            icon: row.try_get("icon").ok(),
            color: row.try_get("color").ok(),
            is_default: row.try_get("is_default").unwrap_or(false),
            created_at: row.try_get("created_at").unwrap_or_else(|_| Utc::now()),
            updated_at: row
                .try_get("modified_at")
                .or_else(|_| row.try_get("updated_at"))
                .unwrap_or_else(|_| Utc::now()),
        }))
    }

    pub async fn update_collection(
        &self,
        id: &str,
        name: Option<&str>,
        icon: Option<&str>,
        color: Option<&str>,
    ) -> Result<Collection> {
        let existing = self
            .get_collection(id)
            .await?
            .ok_or_else(|| IncrementumError::NotFound(format!("Collection {} not found", id)))?;

        let new_name = name.unwrap_or(&existing.name);
        let new_icon = icon.or(existing.icon.as_deref());
        let new_color = color.or(existing.color.as_deref());

        sqlx::query("UPDATE collections SET name = ?1, icon = ?2, color = ?3, modified_at = ?4 WHERE id = ?5")
            .bind(new_name)
            .bind(new_icon)
            .bind(new_color)
            .bind(Utc::now())
            .bind(id)
            .execute(&self.pool)
            .await?;

        self.get_collection(id)
            .await?
            .ok_or_else(|| IncrementumError::NotFound("Collection disappeared".into()))
    }

    pub async fn delete_collection(&self, id: &str) -> Result<()> {
        let collection = self
            .get_collection(id)
            .await?
            .ok_or_else(|| IncrementumError::NotFound(format!("Collection {} not found", id)))?;

        if collection.id == DEFAULT_COLLECTION_ID {
            return Err(IncrementumError::Validation(
                "Cannot delete the default collection".into(),
            ));
        }

        // Reassign all items to the default collection
        let tables = [
            "documents",
            "extracts",
            "learning_items",
            "review_sessions",
            "review_results",
            "annotations",
            "categories",
        ];
        for table in &tables {
            let _ = sqlx::query(&format!(
                "UPDATE {} SET collection_id = ? WHERE collection_id = ?",
                table
            ))
            .bind(DEFAULT_COLLECTION_ID)
            .bind(id)
            .execute(&self.pool)
            .await;
        }

        sqlx::query("DELETE FROM collections WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn get_collection_due_count(&self, collection_id: &str) -> Result<i64> {
        let now = Utc::now();
        let row = sqlx::query("SELECT COUNT(*) as count FROM learning_items WHERE collection_id = ? AND due_date <= ? AND is_suspended = false")
            .bind(collection_id)
            .bind(now)
            .fetch_one(&self.pool)
            .await?;
        Ok(row.get("count"))
    }

    pub async fn get_default_collection_id(&self) -> Result<String> {
        let row = sqlx::query("SELECT id FROM collections WHERE id = ? LIMIT 1")
            .bind(DEFAULT_COLLECTION_ID)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row
            .map(|r| r.get::<String, _>("id"))
            .unwrap_or_else(|| DEFAULT_COLLECTION_ID.to_string()))
    }

    // Document operations
    pub async fn create_document(&self, document: &Document) -> Result<Document> {
        let file_type_str = format!("{:?}", document.file_type).to_lowercase();
        let tags_json = serde_json::to_string(&document.tags)?;
        let metadata_json = document
            .metadata
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        sqlx::query(
            r#"
            INSERT INTO documents (
                id, collection_id, title, file_path, file_type, content, content_hash,
                total_pages, current_page, current_scroll_percent, current_cfi, current_view_state, category, tags,
                date_added, date_modified, date_last_reviewed,
                extract_count, learning_item_count, priority_rating, priority_slider, priority_score,
                is_archived, is_favorite, is_dismissed, metadata, cover_image_url, cover_image_source
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28)
            "#,
        )
        .bind(&document.id)
        .bind(&document.collection_id)
        .bind(&document.title)
        .bind(&document.file_path)
        .bind(&file_type_str)
        .bind(&document.content)
        .bind(&document.content_hash)
        .bind(document.total_pages)
        .bind(document.current_page)
        .bind(document.current_scroll_percent)
        .bind(&document.current_cfi)
        .bind(&document.current_view_state)
        .bind(&document.category)
        .bind(&tags_json)
        .bind(document.date_added)
        .bind(document.date_modified)
        .bind(document.date_last_reviewed)
        .bind(document.extract_count)
        .bind(document.learning_item_count)
        .bind(document.priority_rating)
        .bind(document.priority_slider)
        .bind(document.priority_score)
        .bind(document.is_archived)
        .bind(document.is_favorite)
        .bind(document.is_dismissed)
        .bind(metadata_json)
        .bind(&document.cover_image_url)
        .bind(&document.cover_image_source)
        .execute(&self.pool)
        .await?;

        Ok(document.clone())
    }

    /// Insert a document received from another device via sync, or replace the
    /// existing row if one with the same id is present (conflict resolution by
    /// `date_modified` happens on the caller side — the TS replication layer
    /// only calls this for rows newer than what's local). Trusts the incoming
    /// id so document identity is shared across devices (fileId + reading
    /// positions line up).
    pub async fn upsert_synced_document(&self, document: &Document) -> Result<Document> {
        let file_type_str = format!("{:?}", document.file_type).to_lowercase();
        let tags_json = serde_json::to_string(&document.tags)?;
        let metadata_json = document
            .metadata
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        sqlx::query(
            r#"
            INSERT INTO documents (
                id, title, file_path, file_type, content, content_hash,
                total_pages, current_page, current_scroll_percent, current_cfi, current_view_state,
                position_json, progress_percent,
                category, tags,
                date_added, date_modified, date_last_reviewed,
                extract_count, learning_item_count, priority_rating, priority_slider, priority_score,
                is_archived, is_favorite, is_dismissed, metadata, cover_image_url, cover_image_source,
                next_reading_date, reading_count, stability, difficulty, reps, total_time_spent, consecutive_count
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                file_path = excluded.file_path,
                file_type = excluded.file_type,
                content = excluded.content,
                content_hash = excluded.content_hash,
                total_pages = excluded.total_pages,
                current_page = excluded.current_page,
                current_scroll_percent = excluded.current_scroll_percent,
                current_cfi = excluded.current_cfi,
                current_view_state = excluded.current_view_state,
                position_json = excluded.position_json,
                progress_percent = excluded.progress_percent,
                category = excluded.category,
                tags = excluded.tags,
                date_added = excluded.date_added,
                date_modified = excluded.date_modified,
                date_last_reviewed = excluded.date_last_reviewed,
                extract_count = excluded.extract_count,
                learning_item_count = excluded.learning_item_count,
                priority_rating = excluded.priority_rating,
                priority_slider = excluded.priority_slider,
                priority_score = excluded.priority_score,
                is_archived = excluded.is_archived,
                is_favorite = excluded.is_favorite,
                is_dismissed = excluded.is_dismissed,
                metadata = excluded.metadata,
                cover_image_url = excluded.cover_image_url,
                cover_image_source = excluded.cover_image_source,
                next_reading_date = excluded.next_reading_date,
                reading_count = excluded.reading_count,
                stability = excluded.stability,
                difficulty = excluded.difficulty,
                reps = excluded.reps,
                total_time_spent = excluded.total_time_spent,
                consecutive_count = excluded.consecutive_count
            "#,
        )
        .bind(&document.id)
        .bind(&document.title)
        .bind(&document.file_path)
        .bind(&file_type_str)
        .bind(&document.content)
        .bind(&document.content_hash)
        .bind(document.total_pages)
        .bind(document.current_page)
        .bind(document.current_scroll_percent)
        .bind(&document.current_cfi)
        .bind(&document.current_view_state)
        .bind(&document.position_json)
        .bind(document.progress_percent)
        .bind(&document.category)
        .bind(tags_json)
        .bind(document.date_added)
        .bind(document.date_modified)
        .bind(document.date_last_reviewed)
        .bind(document.extract_count)
        .bind(document.learning_item_count)
        .bind(document.priority_rating)
        .bind(document.priority_slider)
        .bind(document.priority_score)
        .bind(document.is_archived)
        .bind(document.is_favorite)
        .bind(document.is_dismissed)
        .bind(metadata_json)
        .bind(&document.cover_image_url)
        .bind(&document.cover_image_source)
        .bind(document.next_reading_date)
        .bind(document.reading_count)
        .bind(document.stability)
        .bind(document.difficulty)
        .bind(document.reps)
        .bind(document.total_time_spent)
        .bind(document.consecutive_count)
        .execute(&self.pool)
        .await?;

        Ok(document.clone())
    }

    pub async fn get_document(&self, id: &str) -> Result<Option<Document>> {
        let row = sqlx::query("SELECT * FROM documents WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(row) => {
                let file_type: String = row.get("file_type");
                let tags_json: String = row.get("tags");
                let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

                let metadata_json: Option<String> = row.try_get("metadata")?;
                let metadata: Option<crate::models::DocumentMetadata> =
                    metadata_json.and_then(|json| serde_json::from_str(&json).ok());

                Ok(Some(Document {
                    id: row.get("id"),
                    collection_id: row
                        .try_get("collection_id")
                        .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                    title: row.get("title"),
                    file_path: row.get("file_path"),
                    file_type: Self::parse_file_type(&file_type),
                    content: Self::decode_optional_text(&row, "content"),
                    content_hash: row.get("content_hash"),
                    total_pages: row.get("total_pages"),
                    current_page: row.get("current_page"),
                    current_scroll_percent: row.try_get("current_scroll_percent").ok(),
                    current_cfi: row.try_get("current_cfi").ok(),
                    current_view_state: row.try_get("current_view_state").ok(),
                    position_json: row.try_get("position_json").ok(),
                    progress_percent: row.try_get("progress_percent").ok(),
                    category: row.get("category"),
                    tags,
                    date_added: row.get("date_added"),
                    date_modified: row.get("date_modified"),
                    date_last_reviewed: row.get("date_last_reviewed"),
                    extract_count: row.get("extract_count"),
                    learning_item_count: row.get("learning_item_count"),
                    priority_rating: row.get("priority_rating"),
                    priority_slider: row.get("priority_slider"),
                    priority_score: row.get("priority_score"),
                    is_archived: row.get("is_archived"),
                    is_favorite: row.get("is_favorite"),
                    is_dismissed: row.try_get("is_dismissed").unwrap_or(false),
                    metadata,
                    cover_image_url: row.try_get("cover_image_url").ok(),
                    cover_image_source: row.try_get("cover_image_source").ok(),
                    // Scheduling fields - use try_get for compatibility with existing databases
                    next_reading_date: row.try_get("next_reading_date").ok(),
                    reading_count: row.try_get("reading_count").unwrap_or(0),
                    stability: row.try_get("stability").ok(),
                    difficulty: row.try_get("difficulty").ok(),
                    reps: row.try_get("reps").ok(),
                    total_time_spent: row.try_get("total_time_spent").ok(),
                    consecutive_count: row.try_get("consecutive_count").ok(),
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn get_document_titles(&self, ids: &[String]) -> Result<HashMap<String, String>> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let placeholders: Vec<String> = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT id, title FROM documents WHERE id IN ({})",
            placeholders.join(", ")
        );
        let mut query = sqlx::query_as::<_, (String, String)>(&sql);
        for id in ids {
            query = query.bind(id);
        }
        let rows = query.fetch_all(&self.pool).await?;
        Ok(rows.into_iter().collect())
    }

    pub async fn get_document_queue_info(
        &self,
        ids: &[String],
    ) -> Result<HashMap<String, DocumentQueueInfo>> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let placeholders: Vec<String> = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT id, title, is_archived, is_dismissed FROM documents WHERE id IN ({})",
            placeholders.join(", ")
        );
        let mut query = sqlx::query(&sql);
        for id in ids {
            query = query.bind(id);
        }
        let rows = query.fetch_all(&self.pool).await?;
        let mut result = HashMap::new();
        for row in rows {
            use sqlx::Row;
            let id: String = row.get("id");
            let title: String = row.get("title");
            let is_archived: bool = row.try_get("is_archived").unwrap_or(false);
            let is_dismissed: bool = row.try_get("is_dismissed").unwrap_or(false);
            result.insert(
                id,
                DocumentQueueInfo {
                    title,
                    is_archived,
                    is_dismissed,
                },
            );
        }
        Ok(result)
    }

    pub async fn find_document_by_url(&self, url: &str) -> Result<Option<Document>> {
        let row = sqlx::query("SELECT * FROM documents WHERE file_path = ? LIMIT 1")
            .bind(url)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(row) => {
                let file_type: String = row.get("file_type");
                let tags_json: String = row.get("tags");
                let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

                let metadata_json: Option<String> = row.try_get("metadata")?;
                let metadata: Option<crate::models::DocumentMetadata> =
                    metadata_json.and_then(|json| serde_json::from_str(&json).ok());

                Ok(Some(Document {
                    id: row.get("id"),
                    collection_id: row
                        .try_get("collection_id")
                        .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                    title: row.get("title"),
                    file_path: row.get("file_path"),
                    file_type: Self::parse_file_type(&file_type),
                    content: Self::decode_optional_text(&row, "content"),
                    content_hash: row.get("content_hash"),
                    total_pages: row.get("total_pages"),
                    current_page: row.get("current_page"),
                    current_scroll_percent: row.try_get("current_scroll_percent").ok(),
                    current_cfi: row.try_get("current_cfi").ok(),
                    current_view_state: row.try_get("current_view_state").ok(),
                    position_json: row.try_get("position_json").ok(),
                    progress_percent: row.try_get("progress_percent").ok(),
                    category: row.get("category"),
                    tags,
                    date_added: row.get("date_added"),
                    date_modified: row.get("date_modified"),
                    date_last_reviewed: row.get("date_last_reviewed"),
                    extract_count: row.get("extract_count"),
                    learning_item_count: row.get("learning_item_count"),
                    priority_rating: row.get("priority_rating"),
                    priority_slider: row.get("priority_slider"),
                    priority_score: row.get("priority_score"),
                    is_archived: row.get("is_archived"),
                    is_favorite: row.get("is_favorite"),
                    is_dismissed: row.try_get("is_dismissed").unwrap_or(false),
                    metadata,
                    cover_image_url: row.try_get("cover_image_url").ok(),
                    cover_image_source: row.try_get("cover_image_source").ok(),
                    // Scheduling fields - use try_get for compatibility with existing databases
                    next_reading_date: row.try_get("next_reading_date").ok(),
                    reading_count: row.try_get("reading_count").unwrap_or(0),
                    stability: row.try_get("stability").ok(),
                    difficulty: row.try_get("difficulty").ok(),
                    reps: row.try_get("reps").ok(),
                    total_time_spent: row.try_get("total_time_spent").ok(),
                    consecutive_count: row.try_get("consecutive_count").ok(),
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn list_documents(&self) -> Result<Vec<Document>> {
        let rows = sqlx::query("SELECT * FROM documents ORDER BY date_added DESC")
            .fetch_all(&self.pool)
            .await?;

        let mut docs = Vec::new();
        for row in rows {
            let file_type: String = row.get("file_type");
            let tags_json: String = row.get("tags");
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            let metadata_json: Option<String> = row.try_get("metadata")?;
            let metadata: Option<crate::models::DocumentMetadata> =
                metadata_json.and_then(|json| serde_json::from_str(&json).ok());

            docs.push(Document {
                id: row.get("id"),
                collection_id: row
                    .try_get("collection_id")
                    .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                title: row.get("title"),
                file_path: row.get("file_path"),
                file_type: Self::parse_file_type(&file_type),
                content: Self::decode_optional_text(&row, "content"),
                content_hash: row.get("content_hash"),
                total_pages: row.get("total_pages"),
                current_page: row.get("current_page"),
                current_scroll_percent: row.try_get("current_scroll_percent").ok(),
                current_cfi: row.try_get("current_cfi").ok(),
                current_view_state: row.try_get("current_view_state").ok(),
                position_json: row.try_get("position_json").ok(),
                progress_percent: row.try_get("progress_percent").ok(),
                category: row.get("category"),
                tags,
                date_added: row.get("date_added"),
                date_modified: row.get("date_modified"),
                date_last_reviewed: row.get("date_last_reviewed"),
                extract_count: row.get("extract_count"),
                learning_item_count: row.get("learning_item_count"),
                priority_rating: row.get("priority_rating"),
                priority_slider: row.get("priority_slider"),
                priority_score: row.get("priority_score"),
                is_archived: row.get("is_archived"),
                is_favorite: row.get("is_favorite"),
                is_dismissed: row.try_get("is_dismissed").unwrap_or(false),
                metadata,
                cover_image_url: row.try_get("cover_image_url").ok(),
                cover_image_source: row.try_get("cover_image_source").ok(),
                // Scheduling fields - use try_get for compatibility with existing databases
                next_reading_date: row.try_get("next_reading_date").ok(),
                reading_count: row.try_get("reading_count").unwrap_or(0),
                stability: row.try_get("stability").ok(),
                difficulty: row.try_get("difficulty").ok(),
                reps: row.try_get("reps").ok(),
                total_time_spent: row.try_get("total_time_spent").ok(),
                consecutive_count: row.try_get("consecutive_count").ok(),
            });
        }

        Ok(docs)
    }

    pub async fn list_documents_by_collection(&self, collection_id: &str) -> Result<Vec<Document>> {
        let rows =
            sqlx::query("SELECT * FROM documents WHERE collection_id = ? ORDER BY date_added DESC")
                .bind(collection_id)
                .fetch_all(&self.pool)
                .await?;

        let mut docs = Vec::new();
        for row in rows {
            let file_type: String = row.get("file_type");
            let tags_json: String = row.get("tags");
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            let metadata_json: Option<String> = row.try_get("metadata")?;
            let metadata: Option<crate::models::DocumentMetadata> =
                metadata_json.and_then(|json| serde_json::from_str(&json).ok());

            docs.push(Document {
                id: row.get("id"),
                collection_id: row
                    .try_get("collection_id")
                    .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                title: row.get("title"),
                file_path: row.get("file_path"),
                file_type: Self::parse_file_type(&file_type),
                content: Self::decode_optional_text(&row, "content"),
                content_hash: row.get("content_hash"),
                total_pages: row.get("total_pages"),
                current_page: row.get("current_page"),
                current_scroll_percent: row.try_get("current_scroll_percent").ok(),
                current_cfi: row.try_get("current_cfi").ok(),
                current_view_state: row.try_get("current_view_state").ok(),
                position_json: row.try_get("position_json").ok(),
                progress_percent: row.try_get("progress_percent").ok(),
                category: row.get("category"),
                tags,
                date_added: row.get("date_added"),
                date_modified: row.get("date_modified"),
                date_last_reviewed: row.get("date_last_reviewed"),
                extract_count: row.get("extract_count"),
                learning_item_count: row.get("learning_item_count"),
                priority_rating: row.get("priority_rating"),
                priority_slider: row.get("priority_slider"),
                priority_score: row.get("priority_score"),
                is_archived: row.get("is_archived"),
                is_favorite: row.get("is_favorite"),
                is_dismissed: row.try_get("is_dismissed").unwrap_or(false),
                metadata,
                cover_image_url: row.try_get("cover_image_url").ok(),
                cover_image_source: row.try_get("cover_image_source").ok(),
                next_reading_date: row.try_get("next_reading_date").ok(),
                reading_count: row.try_get("reading_count").unwrap_or(0),
                stability: row.try_get("stability").ok(),
                difficulty: row.try_get("difficulty").ok(),
                reps: row.try_get("reps").ok(),
                total_time_spent: row.try_get("total_time_spent").ok(),
                consecutive_count: row.try_get("consecutive_count").ok(),
            });
        }

        Ok(docs)
    }

    /// Lightweight variant of [`list_documents`](Self::list_documents) for the
    /// library/list UI. The library list only needs metadata (title, progress,
    /// scheduling fields, cover image, etc.) and never renders the document's
    /// full text, so we avoid shipping the large `content`/`content_hash`/
    /// `metadata` columns across IPC by selecting them as NULL. The row-mapping
    /// code is identical to `list_documents` (it already treats these columns
    /// as optional), so callers simply see `content: None`, etc.
    pub async fn list_documents_summary(&self) -> Result<Vec<Document>> {
        // NOTE: content / content_hash / metadata are intentionally NULLed out
        // here to keep the IPC payload small; the library list never needs them.
        let rows = sqlx::query(
            "SELECT id, collection_id, title, file_path, file_type, \
             NULL AS content, NULL AS content_hash, \
             total_pages, current_page, current_scroll_percent, current_cfi, current_view_state, \
             position_json, progress_percent, category, tags, date_added, date_modified, \
             date_last_reviewed, extract_count, learning_item_count, priority_rating, \
             priority_slider, priority_score, is_archived, is_favorite, is_dismissed, \
             NULL AS metadata, cover_image_url, cover_image_source, \
             next_reading_date, reading_count, stability, difficulty, reps, total_time_spent, \
             consecutive_count \
             FROM documents ORDER BY date_added DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut docs = Vec::new();
        for row in rows {
            let file_type: String = row.get("file_type");
            let tags_json: String = row.get("tags");
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            docs.push(Document {
                id: row.get("id"),
                collection_id: row
                    .try_get("collection_id")
                    .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                title: row.get("title"),
                file_path: row.get("file_path"),
                file_type: Self::parse_file_type(&file_type),
                content: None,
                content_hash: None,
                total_pages: row.get("total_pages"),
                current_page: row.get("current_page"),
                current_scroll_percent: row.try_get("current_scroll_percent").ok(),
                current_cfi: row.try_get("current_cfi").ok(),
                current_view_state: row.try_get("current_view_state").ok(),
                position_json: row.try_get("position_json").ok(),
                progress_percent: row.try_get("progress_percent").ok(),
                category: row.get("category"),
                tags,
                date_added: row.get("date_added"),
                date_modified: row.get("date_modified"),
                date_last_reviewed: row.get("date_last_reviewed"),
                extract_count: row.get("extract_count"),
                learning_item_count: row.get("learning_item_count"),
                priority_rating: row.get("priority_rating"),
                priority_slider: row.get("priority_slider"),
                priority_score: row.get("priority_score"),
                is_archived: row.get("is_archived"),
                is_favorite: row.get("is_favorite"),
                is_dismissed: row.try_get("is_dismissed").unwrap_or(false),
                metadata: None,
                cover_image_url: row.try_get("cover_image_url").ok(),
                cover_image_source: row.try_get("cover_image_source").ok(),
                // Scheduling fields - use try_get for compatibility with existing databases
                next_reading_date: row.try_get("next_reading_date").ok(),
                reading_count: row.try_get("reading_count").unwrap_or(0),
                stability: row.try_get("stability").ok(),
                difficulty: row.try_get("difficulty").ok(),
                reps: row.try_get("reps").ok(),
                total_time_spent: row.try_get("total_time_spent").ok(),
                consecutive_count: row.try_get("consecutive_count").ok(),
            });
        }

        Ok(docs)
    }

    /// Collection-scoped variant of [`list_documents_summary`](Self::list_documents_summary).
    /// See that method for why `content`/`content_hash`/`metadata` are NULLed.
    pub async fn list_documents_summary_by_collection(
        &self,
        collection_id: &str,
    ) -> Result<Vec<Document>> {
        // NOTE: content / content_hash / metadata are intentionally NULLed out
        // here to keep the IPC payload small; the library list never needs them.
        let rows = sqlx::query(
            "SELECT id, collection_id, title, file_path, file_type, \
             NULL AS content, NULL AS content_hash, \
             total_pages, current_page, current_scroll_percent, current_cfi, current_view_state, \
             position_json, progress_percent, category, tags, date_added, date_modified, \
             date_last_reviewed, extract_count, learning_item_count, priority_rating, \
             priority_slider, priority_score, is_archived, is_favorite, is_dismissed, \
             NULL AS metadata, cover_image_url, cover_image_source, \
             next_reading_date, reading_count, stability, difficulty, reps, total_time_spent, \
             consecutive_count \
             FROM documents WHERE collection_id = ? ORDER BY date_added DESC",
        )
        .bind(collection_id)
        .fetch_all(&self.pool)
        .await?;

        let mut docs = Vec::new();
        for row in rows {
            let file_type: String = row.get("file_type");
            let tags_json: String = row.get("tags");
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            docs.push(Document {
                id: row.get("id"),
                collection_id: row
                    .try_get("collection_id")
                    .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                title: row.get("title"),
                file_path: row.get("file_path"),
                file_type: Self::parse_file_type(&file_type),
                content: None,
                content_hash: None,
                total_pages: row.get("total_pages"),
                current_page: row.get("current_page"),
                current_scroll_percent: row.try_get("current_scroll_percent").ok(),
                current_cfi: row.try_get("current_cfi").ok(),
                current_view_state: row.try_get("current_view_state").ok(),
                position_json: row.try_get("position_json").ok(),
                progress_percent: row.try_get("progress_percent").ok(),
                category: row.get("category"),
                tags,
                date_added: row.get("date_added"),
                date_modified: row.get("date_modified"),
                date_last_reviewed: row.get("date_last_reviewed"),
                extract_count: row.get("extract_count"),
                learning_item_count: row.get("learning_item_count"),
                priority_rating: row.get("priority_rating"),
                priority_slider: row.get("priority_slider"),
                priority_score: row.get("priority_score"),
                is_archived: row.get("is_archived"),
                is_favorite: row.get("is_favorite"),
                is_dismissed: row.try_get("is_dismissed").unwrap_or(false),
                metadata: None,
                cover_image_url: row.try_get("cover_image_url").ok(),
                cover_image_source: row.try_get("cover_image_source").ok(),
                // Scheduling fields - use try_get for compatibility with existing databases
                next_reading_date: row.try_get("next_reading_date").ok(),
                reading_count: row.try_get("reading_count").unwrap_or(0),
                stability: row.try_get("stability").ok(),
                difficulty: row.try_get("difficulty").ok(),
                reps: row.try_get("reps").ok(),
                total_time_spent: row.try_get("total_time_spent").ok(),
                consecutive_count: row.try_get("consecutive_count").ok(),
            });
        }

        Ok(docs)
    }

    /// Return a bounded, content-free document page for the startup snapshot.
    pub async fn list_startup_document_summaries(
        &self,
        collection_id: &str,
        limit: u32,
        offset: u32,
    ) -> Result<(Vec<StartupDocumentSummary>, i64)> {
        let limit = i64::from(limit);
        let offset = i64::from(offset);
        let total: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM documents WHERE collection_id = ?1")
                .bind(collection_id)
                .fetch_one(&self.pool)
                .await?;

        let rows = sqlx::query(
            "SELECT id, collection_id, title, file_path, file_type, total_pages,
                    current_page, current_scroll_percent, current_cfi, current_view_state,
                    position_json, progress_percent, category, tags, date_added, date_modified,
                    date_last_reviewed, extract_count, learning_item_count, priority_rating,
                    priority_slider, priority_score, is_archived, is_favorite, is_dismissed,
                    next_reading_date, reading_count, stability, difficulty, reps,
                    total_time_spent, consecutive_count
             FROM documents
             WHERE collection_id = ?1
             ORDER BY date_added DESC
             LIMIT ?2 OFFSET ?3",
        )
        .bind(collection_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        let summaries = rows
            .into_iter()
            .map(|row| {
                let file_type: String = row.get("file_type");
                let tags_json: String = row.get("tags");
                StartupDocumentSummary {
                    id: row.get("id"),
                    collection_id: row
                        .try_get("collection_id")
                        .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                    title: row.get("title"),
                    file_path: row.get("file_path"),
                    file_type: Self::parse_file_type(&file_type),
                    total_pages: row.try_get("total_pages").ok(),
                    current_page: row.try_get("current_page").ok(),
                    current_scroll_percent: row.try_get("current_scroll_percent").ok(),
                    current_cfi: row.try_get("current_cfi").ok(),
                    current_view_state: row.try_get("current_view_state").ok(),
                    position_json: row.try_get("position_json").ok(),
                    progress_percent: row.try_get("progress_percent").ok(),
                    category: row.try_get("category").ok(),
                    tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                    date_added: row.get("date_added"),
                    date_modified: row.get("date_modified"),
                    date_last_reviewed: row.try_get("date_last_reviewed").ok(),
                    extract_count: row.try_get("extract_count").unwrap_or(0),
                    learning_item_count: row.try_get("learning_item_count").unwrap_or(0),
                    priority_rating: row.try_get("priority_rating").unwrap_or(0),
                    priority_slider: row.try_get("priority_slider").unwrap_or(0),
                    priority_score: row.try_get("priority_score").unwrap_or(0.0),
                    is_archived: row.try_get("is_archived").unwrap_or(false),
                    is_favorite: row.try_get("is_favorite").unwrap_or(false),
                    is_dismissed: row.try_get("is_dismissed").unwrap_or(false),
                    next_reading_date: row.try_get("next_reading_date").ok(),
                    reading_count: row.try_get("reading_count").unwrap_or(0),
                    stability: row.try_get("stability").ok(),
                    difficulty: row.try_get("difficulty").ok(),
                    reps: row.try_get("reps").ok(),
                    total_time_spent: row.try_get("total_time_spent").ok(),
                    consecutive_count: row.try_get("consecutive_count").ok(),
                }
            })
            .collect();

        Ok((summaries, total.0))
    }

    pub async fn list_documents_for_queue(&self) -> Result<Vec<Document>> {
        let rows = sqlx::query(
            "SELECT id, title, file_path, file_type, content_hash, total_pages, current_page, \
             current_scroll_percent, current_cfi, current_view_state, position_json, \
             progress_percent, category, tags, date_added, date_modified, date_last_reviewed, \
             extract_count, learning_item_count, priority_rating, priority_slider, priority_score, \
             is_archived, is_favorite, is_dismissed, metadata, cover_image_url, cover_image_source, \
             next_reading_date, reading_count, stability, difficulty, reps, total_time_spent, consecutive_count, \
             collection_id \
             FROM documents ORDER BY date_added DESC"
        )
        .fetch_all(&self.pool)
        .await?;

        let mut docs = Vec::new();
        for row in rows {
            let file_type: String = row.get("file_type");
            let tags_json: String = row.get("tags");
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            let metadata_json: Option<String> = row.try_get("metadata")?;
            let metadata: Option<DocumentMetadata> =
                metadata_json.and_then(|json| serde_json::from_str(&json).ok());

            docs.push(Document {
                id: row.get("id"),
                collection_id: row
                    .try_get("collection_id")
                    .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                title: row.get("title"),
                file_path: row.get("file_path"),
                file_type: Self::parse_file_type(&file_type),
                content: None,
                content_hash: row.get("content_hash"),
                total_pages: row.get("total_pages"),
                current_page: row.get("current_page"),
                current_scroll_percent: row.try_get("current_scroll_percent").ok(),
                current_cfi: row.try_get("current_cfi").ok(),
                current_view_state: row.try_get("current_view_state").ok(),
                position_json: row.try_get("position_json").ok(),
                progress_percent: row.try_get("progress_percent").ok(),
                category: row.get("category"),
                tags,
                date_added: row.get("date_added"),
                date_modified: row.get("date_modified"),
                date_last_reviewed: row.get("date_last_reviewed"),
                extract_count: row.get("extract_count"),
                learning_item_count: row.get("learning_item_count"),
                priority_rating: row.get("priority_rating"),
                priority_slider: row.get("priority_slider"),
                priority_score: row.get("priority_score"),
                is_archived: row.get("is_archived"),
                is_favorite: row.get("is_favorite"),
                is_dismissed: row.try_get("is_dismissed").unwrap_or(false),
                metadata,
                cover_image_url: row.try_get("cover_image_url").ok(),
                cover_image_source: row.try_get("cover_image_source").ok(),
                next_reading_date: row.try_get("next_reading_date").ok(),
                reading_count: row.try_get("reading_count").unwrap_or(0),
                stability: row.try_get("stability").ok(),
                difficulty: row.try_get("difficulty").ok(),
                reps: row.try_get("reps").ok(),
                total_time_spent: row.try_get("total_time_spent").ok(),
                consecutive_count: row.try_get("consecutive_count").ok(),
            });
        }

        Ok(docs)
    }

    pub async fn list_due_documents_for_queue(
        &self,
        before: &chrono::DateTime<chrono::Utc>,
        collection_id: Option<&str>,
    ) -> Result<Vec<Document>> {
        let columns = "id, title, file_path, file_type, total_pages, current_page, \
             current_scroll_percent, current_cfi, current_view_state, position_json, \
             progress_percent, category, tags, date_added, date_modified, date_last_reviewed, \
             extract_count, learning_item_count, priority_rating, priority_slider, priority_score, \
             is_archived, is_favorite, is_dismissed, \
             next_reading_date, reading_count, stability, difficulty, reps, total_time_spent, consecutive_count, \
             collection_id";

        let rows = if let Some(cid) = collection_id {
            sqlx::query(&format!(
                "SELECT {} FROM documents \
                 WHERE is_archived = 0 \
                   AND COALESCE(is_dismissed, 0) = 0 \
                   AND collection_id = ? \
                   AND (next_reading_date IS NULL OR next_reading_date <= ?) \
                 ORDER BY next_reading_date IS NULL, next_reading_date, date_added DESC",
                columns
            ))
            .bind(cid)
            .bind(before)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query(&format!(
                "SELECT {} FROM documents \
                 WHERE is_archived = 0 \
                   AND COALESCE(is_dismissed, 0) = 0 \
                   AND (next_reading_date IS NULL OR next_reading_date <= ?) \
                 ORDER BY next_reading_date IS NULL, next_reading_date, date_added DESC",
                columns
            ))
            .bind(before)
            .fetch_all(&self.pool)
            .await?
        };

        let mut docs = Vec::new();
        for row in rows {
            let file_type: String = row.get("file_type");
            let tags_json: String = row.get("tags");
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            docs.push(Document {
                id: row.get("id"),
                collection_id: row
                    .try_get("collection_id")
                    .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                title: row.get("title"),
                file_path: row.get("file_path"),
                file_type: Self::parse_file_type(&file_type),
                content: None,
                content_hash: None,
                total_pages: row.get("total_pages"),
                current_page: row.get("current_page"),
                current_scroll_percent: row.try_get("current_scroll_percent").ok(),
                current_cfi: row.try_get("current_cfi").ok(),
                current_view_state: row.try_get("current_view_state").ok(),
                position_json: row.try_get("position_json").ok(),
                progress_percent: row.try_get("progress_percent").ok(),
                category: row.get("category"),
                tags,
                date_added: row.get("date_added"),
                date_modified: row.get("date_modified"),
                date_last_reviewed: row.get("date_last_reviewed"),
                extract_count: row.get("extract_count"),
                learning_item_count: row.get("learning_item_count"),
                priority_rating: row.get("priority_rating"),
                priority_slider: row.get("priority_slider"),
                priority_score: row.get("priority_score"),
                is_archived: row.get("is_archived"),
                is_favorite: row.get("is_favorite"),
                is_dismissed: row.try_get("is_dismissed").unwrap_or(false),
                metadata: None,
                cover_image_url: None,
                cover_image_source: None,
                next_reading_date: row.try_get("next_reading_date").ok(),
                reading_count: row.try_get("reading_count").unwrap_or(0),
                stability: row.try_get("stability").ok(),
                difficulty: row.try_get("difficulty").ok(),
                reps: row.try_get("reps").ok(),
                total_time_spent: row.try_get("total_time_spent").ok(),
                consecutive_count: row.try_get("consecutive_count").ok(),
            });
        }

        Ok(docs)
    }

    pub async fn update_document(&self, id: &str, updates: &Document) -> Result<Document> {
        let tags_json = serde_json::to_string(&updates.tags)?;
        // See document_repository.rs::update_document: empty-string == not provided,
        // so partial updates don't clobber content-bearing columns (notably
        // file_path, whose YouTube URL IS the content).
        let file_path = if updates.file_path.is_empty() {
            None
        } else {
            Some(&updates.file_path)
        };
        let category = updates.category.as_ref().filter(|c| !c.is_empty());

        sqlx::query(
            r#"
            UPDATE documents SET
                title = ?1,
                file_path = COALESCE(?2, file_path),
                current_page = COALESCE(?3, current_page),
                category = COALESCE(?4, category),
                tags = ?5, date_modified = ?6, priority_rating = ?7,
                priority_slider = ?8, priority_score = ?9,
                is_archived = ?10, is_favorite = ?11,
                total_pages = COALESCE(?12, total_pages)
            WHERE id = ?13
            "#,
        )
        .bind(&updates.title)
        .bind(file_path)
        .bind(updates.current_page)
        .bind(category)
        .bind(&tags_json)
        .bind(updates.date_modified)
        .bind(updates.priority_rating)
        .bind(updates.priority_slider)
        .bind(updates.priority_score)
        .bind(updates.is_archived)
        .bind(updates.is_favorite)
        .bind(updates.total_pages)
        .bind(id)
        .execute(&self.pool)
        .await?;

        self.get_document(id)
            .await?
            .ok_or_else(|| crate::error::IncrementumError::NotFound(format!("Document {}", id)))
    }

    pub async fn update_document_cover(
        &self,
        id: &str,
        cover_image_url: Option<String>,
        cover_image_source: Option<String>,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE documents SET
                cover_image_url = ?1,
                cover_image_source = ?2,
                date_modified = ?3
            WHERE id = ?4
            "#,
        )
        .bind(cover_image_url)
        .bind(cover_image_source)
        .bind(Utc::now())
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn update_document_content(
        &self,
        id: &str,
        content: &str,
        content_hash: Option<String>,
        total_pages: Option<i32>,
        metadata: Option<DocumentMetadata>,
    ) -> Result<()> {
        let metadata_json = metadata.as_ref().map(serde_json::to_string).transpose()?;

        sqlx::query(
            r#"
            UPDATE documents SET
                content = ?1,
                content_hash = COALESCE(?2, content_hash),
                total_pages = COALESCE(?3, total_pages),
                metadata = COALESCE(?4, metadata),
                date_modified = ?5
            WHERE id = ?6
            "#,
        )
        .bind(content)
        .bind(content_hash)
        .bind(total_pages)
        .bind(metadata_json)
        .bind(Utc::now())
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Apply asynchronous browser-article enrichment only when it is still an
    /// improvement over the exact document version that started the fetch.
    pub async fn guarded_enrich_browser_document(
        &self,
        id: &str,
        expected_date_modified: chrono::DateTime<chrono::Utc>,
        candidate_content: &str,
        metadata: DocumentMetadata,
    ) -> Result<bool> {
        let candidate = candidate_content.trim();
        if candidate.is_empty() {
            return Ok(false);
        }

        let metadata_json = serde_json::to_string(&metadata)?;
        let result = sqlx::query(
            r#"
            UPDATE documents SET
                content = ?1,
                metadata = ?2,
                date_modified = ?3
            WHERE id = ?4
              AND date_modified = ?5
              AND LENGTH(TRIM(COALESCE(content, ''))) < ?6
            "#,
        )
        .bind(candidate)
        .bind(metadata_json)
        .bind(Utc::now())
        .bind(id)
        .bind(expected_date_modified)
        .bind(candidate.chars().count() as i64)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() == 1)
    }

    pub async fn update_document_priority(
        &self,
        id: &str,
        priority_rating: i32,
        priority_slider: i32,
        priority_score: f64,
    ) -> Result<Document> {
        let now = Utc::now();

        sqlx::query(
            r#"
            UPDATE documents SET
                priority_rating = ?1,
                priority_slider = ?2,
                priority_score = ?3,
                date_modified = ?4
            WHERE id = ?5
            "#,
        )
        .bind(priority_rating)
        .bind(priority_slider)
        .bind(priority_score)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await?;

        self.get_document(id)
            .await?
            .ok_or_else(|| crate::error::IncrementumError::NotFound(format!("Document {}", id)))
    }

    pub async fn update_document_dismiss(&self, id: &str, is_dismissed: bool) -> Result<Document> {
        let now = Utc::now();

        sqlx::query(
            r#"
            UPDATE documents SET
                is_dismissed = ?1,
                date_modified = ?2
            WHERE id = ?3
            "#,
        )
        .bind(is_dismissed)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await?;

        self.get_document(id)
            .await?
            .ok_or_else(|| crate::error::IncrementumError::NotFound(format!("Document {}", id)))
    }

    pub async fn update_document_progress(
        &self,
        id: &str,
        current_page: Option<i32>,
        current_scroll_percent: Option<f64>,
        current_cfi: Option<String>,
        current_view_state: Option<String>,
    ) -> Result<Document> {
        let now = Utc::now();

        sqlx::query(
            r#"
            UPDATE documents SET
                current_page = COALESCE(?1, current_page),
                current_scroll_percent = COALESCE(?2, current_scroll_percent),
                current_cfi = COALESCE(?3, current_cfi),
                current_view_state = COALESCE(?4, current_view_state),
                date_modified = ?5
            WHERE id = ?6
            "#,
        )
        .bind(current_page)
        .bind(current_scroll_percent)
        .bind(current_cfi)
        .bind(current_view_state)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await?;

        self.get_document(id)
            .await?
            .ok_or_else(|| crate::error::IncrementumError::NotFound(format!("Document {}", id)))
    }

    pub async fn update_document_scheduling(
        &self,
        id: &str,
        next_reading_date: Option<chrono::DateTime<Utc>>,
        stability: Option<f64>,
        difficulty: Option<f64>,
        reps: Option<i32>,
        total_time_spent: Option<i32>,
    ) -> Result<()> {
        let now = Utc::now();
        sqlx::query(
            r#"
            UPDATE documents SET
                next_reading_date = ?1,
                stability = ?2,
                difficulty = ?3,
                reps = ?4,
                total_time_spent = ?5,
                date_last_reviewed = ?6,
                date_modified = ?7
            WHERE id = ?8
            "#,
        )
        .bind(next_reading_date)
        .bind(stability)
        .bind(difficulty)
        .bind(reps)
        .bind(total_time_spent)
        .bind(now)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn update_document_scheduling_with_consecutive(
        &self,
        id: &str,
        next_reading_date: Option<chrono::DateTime<Utc>>,
        stability: Option<f64>,
        difficulty: Option<f64>,
        reps: Option<i32>,
        total_time_spent: Option<i32>,
        consecutive_count: Option<i32>,
    ) -> Result<()> {
        let now = Utc::now();
        sqlx::query(
            r#"
            UPDATE documents SET
                next_reading_date = ?1,
                stability = ?2,
                difficulty = ?3,
                reps = ?4,
                total_time_spent = ?5,
                consecutive_count = ?6,
                date_last_reviewed = ?7,
                date_modified = ?8
            WHERE id = ?9
            "#,
        )
        .bind(next_reading_date)
        .bind(stability)
        .bind(difficulty)
        .bind(reps)
        .bind(total_time_spent)
        .bind(consecutive_count)
        .bind(now)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn restore_document_scheduling(
        &self,
        id: &str,
        next_reading_date: Option<chrono::DateTime<Utc>>,
        stability: Option<f64>,
        difficulty: Option<f64>,
        reps: Option<i32>,
        total_time_spent: Option<i32>,
        consecutive_count: Option<i32>,
        date_last_reviewed: Option<chrono::DateTime<Utc>>,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE documents SET
                next_reading_date = ?1,
                stability = ?2,
                difficulty = ?3,
                reps = ?4,
                total_time_spent = ?5,
                consecutive_count = ?6,
                date_last_reviewed = ?7,
                date_modified = ?8
            WHERE id = ?9
            "#,
        )
        .bind(next_reading_date)
        .bind(stability)
        .bind(difficulty)
        .bind(reps)
        .bind(total_time_spent)
        .bind(consecutive_count)
        .bind(date_last_reviewed)
        .bind(Utc::now())
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn delete_document(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM documents WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn create_extract(&self, extract: &Extract) -> Result<Extract> {
        let tags_json = serde_json::to_string(&extract.tags)?;
        let (stability, difficulty) = extract
            .memory_state
            .as_ref()
            .map(|s| (Some(s.stability), Some(s.difficulty)))
            .unwrap_or((None, None));
        let selection_context_json = match &extract.selection_context {
            Some(value) => Some(serde_json::to_string(value)?),
            None => None,
        };
        let progressive_summaries_json = extract
            .progressive_summaries
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        sqlx::query(
            r#"
            INSERT INTO extracts (
                id, collection_id, document_id, content, html_content, source_url, page_title, page_number,
                selection_context, highlight_color, notes, progressive_disclosure_level,
                max_disclosure_level, progressive_summaries, date_created, date_modified,
                tags, category, memory_state_stability, memory_state_difficulty,
                next_review_date, last_review_date, review_count, reps, source_hash, priority_score, is_dismissed
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27)
            "#,
        )
        .bind(&extract.id)
        .bind(&extract.collection_id)
        .bind(&extract.document_id)
        .bind(&extract.content)
        .bind(&extract.html_content)
        .bind(&extract.source_url)
        .bind(&extract.page_title)
        .bind(extract.page_number)
        .bind(selection_context_json)
        .bind(&extract.highlight_color)
        .bind(&extract.notes)
        .bind(extract.progressive_disclosure_level)
        .bind(extract.max_disclosure_level)
        .bind(&progressive_summaries_json)
        .bind(extract.date_created)
        .bind(extract.date_modified)
        .bind(&tags_json)
        .bind(&extract.category)
        .bind(stability)
        .bind(difficulty)
        .bind(extract.next_review_date)
        .bind(extract.last_review_date)
        .bind(extract.review_count)
        .bind(extract.reps)
        .bind(&extract.source_hash)
        .bind(extract.priority_score)
        .bind(extract.is_dismissed)
        .execute(&self.pool)
        .await?;

        Ok(extract.clone())
    }

    pub async fn get_extract(&self, id: &str) -> Result<Option<Extract>> {
        let row = sqlx::query("SELECT * FROM extracts WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(row) => {
                let tags_json: String = row.try_get("tags")?;
                let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

                let stability: Option<f64> = row.try_get("memory_state_stability").ok();
                let difficulty: Option<f64> = row.try_get("memory_state_difficulty").ok();
                let memory_state = Self::parse_memory_state(stability, difficulty);
                let selection_context_json: Option<String> = row.try_get("selection_context").ok();
                let selection_context =
                    selection_context_json.and_then(|json| serde_json::from_str(&json).ok());

                Ok(Some(Extract {
                    id: row.try_get("id")?,
                    collection_id: row
                        .try_get("collection_id")
                        .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                    document_id: row.try_get("document_id")?,
                    content: row.try_get("content")?,
                    html_content: row.try_get("html_content").ok(),
                    source_url: row.try_get("source_url").ok(),
                    page_title: row.try_get("page_title")?,
                    page_number: row.try_get("page_number")?,
                    selection_context,
                    highlight_color: row.try_get("highlight_color")?,
                    notes: row.try_get("notes")?,
                    progressive_disclosure_level: row.try_get("progressive_disclosure_level")?,
                    max_disclosure_level: row.try_get("max_disclosure_level")?,
                    progressive_summaries: row
                        .try_get::<Option<String>, _>("progressive_summaries")
                        .ok()
                        .flatten()
                        .and_then(|s| serde_json::from_str(&s).ok()),
                    date_created: row.try_get("date_created")?,
                    date_modified: row.try_get("date_modified")?,
                    tags,
                    category: row.try_get("category")?,
                    memory_state,
                    next_review_date: row.try_get("next_review_date").ok(),
                    last_review_date: row.try_get("last_review_date").ok(),
                    review_count: row.try_get("review_count").unwrap_or(0),
                    reps: row.try_get("reps").unwrap_or(0),
                    source_hash: row.try_get("source_hash").ok(),
                    priority_score: row.try_get::<f64, _>("priority_score").unwrap_or(0.0),
                    is_dismissed: row.try_get::<bool, _>("is_dismissed").unwrap_or(false),
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn list_extracts_by_document(&self, document_id: &str) -> Result<Vec<Extract>> {
        let rows = sqlx::query("SELECT * FROM extracts WHERE document_id = ? ORDER BY page_number")
            .bind(document_id)
            .fetch_all(&self.pool)
            .await?;

        let mut extracts = Vec::new();
        for row in rows {
            let tags_json: String = row.try_get("tags")?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            let stability: Option<f64> = row.try_get("memory_state_stability").ok();
            let difficulty: Option<f64> = row.try_get("memory_state_difficulty").ok();
            let memory_state = Self::parse_memory_state(stability, difficulty);
            let selection_context_json: Option<String> = row.try_get("selection_context").ok();
            let selection_context =
                selection_context_json.and_then(|json| serde_json::from_str(&json).ok());

            extracts.push(Extract {
                id: row.try_get("id")?,
                collection_id: row
                    .try_get("collection_id")
                    .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                document_id: row.try_get("document_id")?,
                content: row.try_get("content")?,
                html_content: row.try_get("html_content").ok(),
                source_url: row.try_get("source_url").ok(),
                page_title: row.try_get("page_title")?,
                page_number: row.try_get("page_number")?,
                selection_context,
                highlight_color: row.try_get("highlight_color")?,
                notes: row.try_get("notes")?,
                progressive_disclosure_level: row.try_get("progressive_disclosure_level")?,
                max_disclosure_level: row.try_get("max_disclosure_level")?,
                date_created: row.try_get("date_created")?,
                date_modified: row.try_get("date_modified")?,
                tags,
                category: row.try_get("category")?,
                memory_state,
                next_review_date: row.try_get("next_review_date").ok(),
                last_review_date: row.try_get("last_review_date").ok(),
                review_count: row.try_get("review_count").unwrap_or(0),
                reps: row.try_get("reps").unwrap_or(0),
                progressive_summaries: row
                    .try_get::<Option<String>, _>("progressive_summaries")
                    .ok()
                    .flatten()
                    .and_then(|s| serde_json::from_str(&s).ok()),
                source_hash: row.try_get("source_hash").ok(),
                priority_score: row.try_get::<f64, _>("priority_score").unwrap_or(0.0),
                is_dismissed: row.try_get::<bool, _>("is_dismissed").unwrap_or(false),
            });
        }

        Ok(extracts)
    }

    pub async fn list_all_extracts(&self) -> Result<Vec<Extract>> {
        let rows = sqlx::query("SELECT * FROM extracts ORDER BY date_created DESC")
            .fetch_all(&self.pool)
            .await?;

        let mut extracts = Vec::new();
        for row in rows {
            let tags_json: String = row.try_get("tags")?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            let stability: Option<f64> = row.try_get("memory_state_stability").ok();
            let difficulty: Option<f64> = row.try_get("memory_state_difficulty").ok();
            let memory_state = Self::parse_memory_state(stability, difficulty);
            let selection_context_json: Option<String> = row.try_get("selection_context").ok();
            let selection_context =
                selection_context_json.and_then(|json| serde_json::from_str(&json).ok());

            extracts.push(Extract {
                id: row.try_get("id")?,
                collection_id: row
                    .try_get("collection_id")
                    .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                document_id: row.try_get("document_id")?,
                content: row.try_get("content")?,
                html_content: row.try_get("html_content").ok(),
                source_url: row.try_get("source_url").ok(),
                page_title: row.try_get("page_title")?,
                page_number: row.try_get("page_number")?,
                selection_context,
                highlight_color: row.try_get("highlight_color")?,
                notes: row.try_get("notes")?,
                progressive_disclosure_level: row.try_get("progressive_disclosure_level")?,
                max_disclosure_level: row.try_get("max_disclosure_level")?,
                date_created: row.try_get("date_created")?,
                date_modified: row.try_get("date_modified")?,
                tags,
                category: row.try_get("category")?,
                memory_state,
                next_review_date: row.try_get("next_review_date").ok(),
                last_review_date: row.try_get("last_review_date").ok(),
                review_count: row.try_get("review_count").unwrap_or(0),
                reps: row.try_get("reps").unwrap_or(0),
                progressive_summaries: row
                    .try_get::<Option<String>, _>("progressive_summaries")
                    .ok()
                    .flatten()
                    .and_then(|s| serde_json::from_str(&s).ok()),
                source_hash: row.try_get("source_hash").ok(),
                priority_score: row.try_get::<f64, _>("priority_score").unwrap_or(0.0),
                is_dismissed: row.try_get::<bool, _>("is_dismissed").unwrap_or(false),
            });
        }

        Ok(extracts)
    }

    pub async fn update_extract(&self, extract: &Extract) -> Result<Extract> {
        let tags_json = serde_json::to_string(&extract.tags)?;
        let (stability, difficulty) = extract
            .memory_state
            .as_ref()
            .map(|s| (Some(s.stability), Some(s.difficulty)))
            .unwrap_or((None, None));
        let progressive_summaries_json = extract
            .progressive_summaries
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        sqlx::query(
            r#"
            UPDATE extracts SET
                content = ?1, html_content = ?2, source_url = ?3,
                notes = ?4, highlight_color = ?5,
                tags = ?6, category = ?7, date_modified = ?8,
                memory_state_stability = ?9, memory_state_difficulty = ?10,
                next_review_date = ?11, last_review_date = ?12,
                review_count = ?13, reps = ?14,
                progressive_disclosure_level = ?15, max_disclosure_level = ?16,
                progressive_summaries = ?17
            WHERE id = ?18
            "#,
        )
        .bind(&extract.content)
        .bind(&extract.html_content)
        .bind(&extract.source_url)
        .bind(&extract.notes)
        .bind(&extract.highlight_color)
        .bind(&tags_json)
        .bind(&extract.category)
        .bind(extract.date_modified)
        .bind(stability)
        .bind(difficulty)
        .bind(extract.next_review_date)
        .bind(extract.last_review_date)
        .bind(extract.review_count)
        .bind(extract.reps)
        .bind(extract.progressive_disclosure_level)
        .bind(extract.max_disclosure_level)
        .bind(&progressive_summaries_json)
        .bind(&extract.id)
        .execute(&self.pool)
        .await?;

        Ok(extract.clone())
    }

    pub async fn upsert_synced_extract(&self, extract: &Extract) -> Result<Extract> {
        let tags_json = serde_json::to_string(&extract.tags)?;
        let (stability, difficulty) = extract
            .memory_state
            .as_ref()
            .map(|s| (Some(s.stability), Some(s.difficulty)))
            .unwrap_or((None, None));
        let selection_context_json = match &extract.selection_context {
            Some(value) => Some(serde_json::to_string(value)?),
            None => None,
        };
        let progressive_summaries_json = extract
            .progressive_summaries
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        sqlx::query(
            r#"
            INSERT INTO extracts (
                id, collection_id, document_id, content, html_content, source_url, page_title, page_number,
                selection_context, highlight_color, notes, progressive_disclosure_level,
                max_disclosure_level, progressive_summaries, date_created, date_modified,
                tags, category, memory_state_stability, memory_state_difficulty,
                next_review_date, last_review_date, review_count, reps, source_hash, priority_score, is_dismissed
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27)
            ON CONFLICT(id) DO UPDATE SET
                collection_id = excluded.collection_id,
                document_id = excluded.document_id,
                content = excluded.content,
                html_content = excluded.html_content,
                source_url = excluded.source_url,
                page_title = excluded.page_title,
                page_number = excluded.page_number,
                selection_context = excluded.selection_context,
                highlight_color = excluded.highlight_color,
                notes = excluded.notes,
                progressive_disclosure_level = excluded.progressive_disclosure_level,
                max_disclosure_level = excluded.max_disclosure_level,
                progressive_summaries = excluded.progressive_summaries,
                date_created = excluded.date_created,
                date_modified = excluded.date_modified,
                tags = excluded.tags,
                category = excluded.category,
                memory_state_stability = excluded.memory_state_stability,
                memory_state_difficulty = excluded.memory_state_difficulty,
                next_review_date = excluded.next_review_date,
                last_review_date = excluded.last_review_date,
                review_count = excluded.review_count,
                reps = excluded.reps,
                source_hash = excluded.source_hash,
                priority_score = excluded.priority_score,
                is_dismissed = excluded.is_dismissed
            "#,
        )
        .bind(&extract.id)
        .bind(&extract.collection_id)
        .bind(&extract.document_id)
        .bind(&extract.content)
        .bind(&extract.html_content)
        .bind(&extract.source_url)
        .bind(&extract.page_title)
        .bind(extract.page_number)
        .bind(selection_context_json)
        .bind(&extract.highlight_color)
        .bind(&extract.notes)
        .bind(extract.progressive_disclosure_level)
        .bind(extract.max_disclosure_level)
        .bind(&progressive_summaries_json)
        .bind(extract.date_created)
        .bind(extract.date_modified)
        .bind(&tags_json)
        .bind(&extract.category)
        .bind(stability)
        .bind(difficulty)
        .bind(extract.next_review_date)
        .bind(extract.last_review_date)
        .bind(extract.review_count)
        .bind(extract.reps)
        .bind(&extract.source_hash)
        .bind(extract.priority_score)
        .bind(extract.is_dismissed)
        .execute(&self.pool)
        .await?;

        Ok(extract.clone())
    }

    pub async fn upsert_synced_collection(&self, collection: &Collection) -> Result<Collection> {
        sqlx::query(
            r#"
            INSERT INTO collections (id, name, icon, color, is_default, created_at, modified_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                icon = excluded.icon,
                color = excluded.color,
                is_default = excluded.is_default,
                created_at = excluded.created_at,
                modified_at = excluded.modified_at
            "#,
        )
        .bind(&collection.id)
        .bind(&collection.name)
        .bind(&collection.icon)
        .bind(&collection.color)
        .bind(collection.is_default)
        .bind(collection.created_at)
        .bind(collection.updated_at)
        .execute(&self.pool)
        .await?;

        Ok(collection.clone())
    }

    pub async fn update_extract_disclosure_level(&self, id: &str, level: i32) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE extracts SET
                progressive_disclosure_level = ?1,
                date_modified = ?2
            WHERE id = ?3
            "#,
        )
        .bind(level)
        .bind(Utc::now())
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_extract(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM extracts WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn get_due_extracts(
        &self,
        before: &chrono::DateTime<chrono::Utc>,
    ) -> Result<Vec<Extract>> {
        let rows = sqlx::query("SELECT * FROM extracts WHERE is_dismissed = 0 AND next_review_date IS NOT NULL AND next_review_date <= ? ORDER BY next_review_date")
            .bind(before)
            .fetch_all(&self.pool)
            .await?;

        let mut extracts = Vec::new();
        for row in rows {
            let tags_json: String = row.try_get("tags")?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            let stability: Option<f64> = row.try_get("memory_state_stability").ok();
            let difficulty: Option<f64> = row.try_get("memory_state_difficulty").ok();
            let memory_state = Self::parse_memory_state(stability, difficulty);
            let selection_context_json: Option<String> = row.try_get("selection_context").ok();
            let selection_context =
                selection_context_json.and_then(|json| serde_json::from_str(&json).ok());

            extracts.push(Extract {
                id: row.try_get("id")?,
                collection_id: row
                    .try_get("collection_id")
                    .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                document_id: row.try_get("document_id")?,
                content: row.try_get("content")?,
                html_content: row.try_get("html_content").ok(),
                source_url: row.try_get("source_url").ok(),
                page_title: row.try_get("page_title")?,
                page_number: row.try_get("page_number")?,
                selection_context,
                highlight_color: row.try_get("highlight_color")?,
                notes: row.try_get("notes")?,
                progressive_disclosure_level: row.try_get("progressive_disclosure_level")?,
                max_disclosure_level: row.try_get("max_disclosure_level")?,
                date_created: row.try_get("date_created")?,
                date_modified: row.try_get("date_modified")?,
                tags,
                category: row.try_get("category")?,
                memory_state,
                next_review_date: row.try_get("next_review_date").ok(),
                last_review_date: row.try_get("last_review_date").ok(),
                review_count: row.try_get("review_count").unwrap_or(0),
                reps: row.try_get("reps").unwrap_or(0),
                progressive_summaries: row
                    .try_get::<Option<String>, _>("progressive_summaries")
                    .ok()
                    .flatten()
                    .and_then(|s| serde_json::from_str(&s).ok()),
                source_hash: row.try_get("source_hash").ok(),
                priority_score: row.try_get::<f64, _>("priority_score").unwrap_or(0.0),
                is_dismissed: row.try_get::<bool, _>("is_dismissed").unwrap_or(false),
            });
        }

        Ok(extracts)
    }

    /// Get extracts that have never been reviewed (new extracts without next_review_date)
    pub async fn get_new_extracts(&self) -> Result<Vec<Extract>> {
        let rows = sqlx::query("SELECT * FROM extracts WHERE is_dismissed = 0 AND next_review_date IS NULL ORDER BY date_created DESC")
            .fetch_all(&self.pool)
            .await?;

        let mut extracts = Vec::new();
        for row in rows {
            let tags_json: String = row.try_get("tags")?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            let stability: Option<f64> = row.try_get("memory_state_stability").ok();
            let difficulty: Option<f64> = row.try_get("memory_state_difficulty").ok();
            let memory_state = Self::parse_memory_state(stability, difficulty);
            let selection_context_json: Option<String> = row.try_get("selection_context").ok();
            let selection_context =
                selection_context_json.and_then(|json| serde_json::from_str(&json).ok());

            extracts.push(Extract {
                id: row.try_get("id")?,
                collection_id: row
                    .try_get("collection_id")
                    .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                document_id: row.try_get("document_id")?,
                content: row.try_get("content")?,
                html_content: row.try_get("html_content").ok(),
                source_url: row.try_get("source_url").ok(),
                page_title: row.try_get("page_title")?,
                page_number: row.try_get("page_number")?,
                selection_context,
                highlight_color: row.try_get("highlight_color")?,
                notes: row.try_get("notes")?,
                progressive_disclosure_level: row.try_get("progressive_disclosure_level")?,
                max_disclosure_level: row.try_get("max_disclosure_level")?,
                date_created: row.try_get("date_created")?,
                date_modified: row.try_get("date_modified")?,
                tags,
                category: row.try_get("category")?,
                memory_state,
                next_review_date: row.try_get("next_review_date").ok(),
                last_review_date: row.try_get("last_review_date").ok(),
                review_count: row.try_get("review_count").unwrap_or(0),
                reps: row.try_get("reps").unwrap_or(0),
                progressive_summaries: row
                    .try_get::<Option<String>, _>("progressive_summaries")
                    .ok()
                    .flatten()
                    .and_then(|s| serde_json::from_str(&s).ok()),
                source_hash: row.try_get("source_hash").ok(),
                priority_score: row.try_get::<f64, _>("priority_score").unwrap_or(0.0),
                is_dismissed: row.try_get::<bool, _>("is_dismissed").unwrap_or(false),
            });
        }

        Ok(extracts)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn update_extract_scheduling(
        &self,
        id: &str,
        next_review_date: Option<chrono::DateTime<Utc>>,
        stability: Option<f64>,
        difficulty: Option<f64>,
        review_count: Option<i32>,
        reps: Option<i32>,
        last_review_date: Option<chrono::DateTime<Utc>>,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE extracts SET
                next_review_date = ?1,
                memory_state_stability = ?2,
                memory_state_difficulty = ?3,
                review_count = ?4,
                reps = ?5,
                last_review_date = ?6,
                date_modified = ?7
            WHERE id = ?8
            "#,
        )
        .bind(next_review_date)
        .bind(stability)
        .bind(difficulty)
        .bind(review_count)
        .bind(reps)
        .bind(last_review_date)
        .bind(Utc::now())
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Update an extract's inherited priority score (manual override).
    pub async fn update_extract_priority(&self, id: &str, priority_score: f64) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE extracts SET
                priority_score = ?1,
                date_modified = ?2
            WHERE id = ?3
            "#,
        )
        .bind(priority_score.clamp(0.0, 100.0))
        .bind(Utc::now())
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Set an extract's dismissed flag (SuperMemo-style Dismiss lifecycle).
    /// Dismissed extracts leave the review queue but remain in the library.
    pub async fn update_extract_dismissed(&self, id: &str, is_dismissed: bool) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE extracts SET
                is_dismissed = ?1,
                date_modified = ?2
            WHERE id = ?3
            "#,
        )
        .bind(is_dismissed)
        .bind(Utc::now())
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Reset an extract's FSRS memory state to initial values and clear its
    /// scheduling (SuperMemo-style Forget lifecycle). Returns it to the
    /// new-extract queue.
    pub async fn forget_extract(&self, id: &str) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE extracts SET
                memory_state_stability = 0.5,
                memory_state_difficulty = 5.0,
                reps = 0,
                review_count = 0,
                next_review_date = NULL,
                last_review_date = NULL,
                date_modified = ?1
            WHERE id = ?2
            "#,
        )
        .bind(Utc::now())
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Graduate an extract: schedule it far in the future and mark high
    /// stability (SuperMemo-style Done lifecycle).
    pub async fn graduate_extract(
        &self,
        id: &str,
        far_future: chrono::DateTime<Utc>,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE extracts SET
                next_review_date = ?1,
                memory_state_stability = 1825.0,
                date_modified = ?2
            WHERE id = ?3
            "#,
        )
        .bind(far_future)
        .bind(Utc::now())
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Cascade a document's new priority to child extracts that still carry
    /// the document's *previous* score. Extracts whose priority has been
    /// individually overridden (and therefore differs from the previous
    /// document score) are left untouched.
    pub async fn cascade_document_priority(
        &self,
        document_id: &str,
        previous_score: f64,
        new_score: f64,
    ) -> Result<u64> {
        let result = sqlx::query(
            r#"
            UPDATE extracts SET
                priority_score = ?1,
                date_modified = ?2
            WHERE document_id = ?3 AND ABS(priority_score - ?4) < 0.001
            "#,
        )
        .bind(new_score.clamp(0.0, 100.0))
        .bind(Utc::now())
        .bind(document_id)
        .bind(previous_score)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
    }

    // Learning item operations
    pub async fn create_learning_item(&self, item: &LearningItem) -> Result<LearningItem> {
        // Retry once on I/O errors (common on SD cards / low-storage devices)
        match self.create_learning_item_inner(item).await {
            Ok(created) => Ok(created),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("I/O error") || msg.contains("disk") {
                    tracing::warn!(
                        "create_learning_item failed with I/O error, retrying in 500ms: {}",
                        e
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    self.create_learning_item_inner(item).await
                } else {
                    Err(e)
                }
            }
        }
    }

    async fn create_learning_item_inner(&self, item: &LearningItem) -> Result<LearningItem> {
        let item_type_str = format!("{:?}", item.item_type).to_lowercase();
        let state_str = format!("{:?}", item.state).to_lowercase();
        let tags_json = serde_json::to_string(&item.tags)?;
        let image_asset_ids_json = serde_json::to_string(&item.image_asset_ids)?;
        let interaction_metadata_json = item
            .interaction_metadata
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let cloze_ranges_json = item
            .cloze_ranges
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        let (stability, difficulty) = item
            .memory_state
            .as_ref()
            .map(|s| (Some(s.stability), Some(s.difficulty)))
            .unwrap_or((None, None));

        sqlx::query(
            r#"
            INSERT INTO learning_items (
                id, collection_id, extract_id, document_id, item_type, question,
                answer, cloze_text, cloze_ranges, difficulty, interval,
                ease_factor, due_date, date_created, date_modified,
                last_review_date, review_count, lapses, state,
                is_suspended, tags, image_asset_ids, interaction_metadata, memory_state_stability, memory_state_difficulty,
                algorithm_type, algorithm_state, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28)
            "#,
        )
        .bind(&item.id)
        .bind(&item.collection_id)
        .bind(&item.extract_id)
        .bind(&item.document_id)
        .bind(&item_type_str)
        .bind(&item.question)
        .bind(&item.answer)
        .bind(&item.cloze_text)
        .bind(&cloze_ranges_json)
        .bind(item.difficulty)
        .bind(item.interval)
        .bind(item.ease_factor)
        .bind(item.due_date)
        .bind(item.date_created)
        .bind(item.date_modified)
        .bind(item.last_review_date)
        .bind(item.review_count)
        .bind(item.lapses)
        .bind(&state_str)
        .bind(item.is_suspended)
        .bind(&tags_json)
        .bind(&image_asset_ids_json)
        .bind(&interaction_metadata_json)
        .bind(stability)
        .bind(difficulty)
        .bind(&item.algorithm_type)
        .bind(&item.algorithm_state)
        .bind(&item.updated_at)
        .execute(&self.pool)
        .await?;

        Ok(item.clone())
    }

    pub async fn get_due_learning_items(
        &self,
        before: &chrono::DateTime<chrono::Utc>,
        collection_id: Option<&str>,
    ) -> Result<Vec<LearningItem>> {
        let rows = if let Some(cid) = collection_id {
            sqlx::query("SELECT * FROM learning_items WHERE due_date <= ? AND is_suspended = false AND collection_id = ? ORDER BY due_date")
                .bind(before)
                .bind(cid)
                .fetch_all(&self.pool)
                .await?
        } else {
            sqlx::query("SELECT * FROM learning_items WHERE due_date <= ? AND is_suspended = false ORDER BY due_date")
                .bind(before)
                .fetch_all(&self.pool)
                .await?
        };

        let mut items = Vec::new();
        for row in rows {
            items.push(Self::row_to_learning_item(&row)?);
        }

        Ok(items)
    }

    pub async fn get_learning_items_by_document(
        &self,
        document_id: &str,
    ) -> Result<Vec<LearningItem>> {
        let rows = sqlx::query(
            "SELECT * FROM learning_items WHERE document_id = ? ORDER BY date_created DESC",
        )
        .bind(document_id)
        .fetch_all(&self.pool)
        .await?;

        let mut items = Vec::new();
        for row in rows {
            items.push(Self::row_to_learning_item(&row)?);
        }

        Ok(items)
    }

    pub async fn get_learning_items_by_extract(
        &self,
        extract_id: &str,
    ) -> Result<Vec<LearningItem>> {
        let rows = sqlx::query(
            "SELECT * FROM learning_items WHERE extract_id = ? ORDER BY date_created DESC",
        )
        .bind(extract_id)
        .fetch_all(&self.pool)
        .await?;

        let mut items = Vec::new();
        for row in rows {
            items.push(Self::row_to_learning_item(&row)?);
        }

        Ok(items)
    }

    pub async fn update_learning_item(&self, item: &LearningItem) -> Result<LearningItem> {
        let _item_type_str = format!("{:?}", item.item_type).to_lowercase();
        let state_str = format!("{:?}", item.state).to_lowercase();
        let tags_json = serde_json::to_string(&item.tags)?;
        let interaction_metadata_json = item
            .interaction_metadata
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        let (stability, difficulty) = item
            .memory_state
            .as_ref()
            .map(|s| (Some(s.stability), Some(s.difficulty)))
            .unwrap_or((None, None));

        sqlx::query(
            r#"
            UPDATE learning_items SET
                due_date = ?1, interval = ?2, ease_factor = ?3,
                state = ?4, review_count = ?5, lapses = ?6,
                last_review_date = ?7, date_modified = ?8,
                memory_state_stability = ?9, memory_state_difficulty = ?10,
                interaction_metadata = ?12, algorithm_type = ?13, algorithm_state = ?14,
                updated_at = COALESCE(?15, updated_at), tags = ?16, difficulty = ?17
            WHERE id = ?11
            "#,
        )
        .bind(item.due_date)
        .bind(item.interval)
        .bind(item.ease_factor)
        .bind(&state_str)
        .bind(item.review_count)
        .bind(item.lapses)
        .bind(item.last_review_date)
        .bind(item.date_modified)
        .bind(stability)
        .bind(difficulty)
        .bind(&item.id)
        .bind(&interaction_metadata_json)
        .bind(&item.algorithm_type)
        .bind(&item.algorithm_state)
        .bind(&item.updated_at)
        .bind(&tags_json)
        .bind(item.difficulty)
        .execute(&self.pool)
        .await?;

        Ok(item.clone())
    }

    pub async fn get_all_learning_items(&self) -> Result<Vec<LearningItem>> {
        let rows = sqlx::query(
            "SELECT * FROM learning_items WHERE is_suspended = false ORDER BY due_date ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut items = Vec::new();
        for row in rows {
            items.push(Self::row_to_learning_item(&row)?);
        }

        Ok(items)
    }

    /// Fetch a single learning item by its primary key, without scanning the
    /// whole table. Use this instead of `get_all_learning_items().find(...)`
    /// when only one item is needed (e.g. review scheduling). Mirrors the other
    /// `get_*_by_id` accessors and reuses the shared `row_to_learning_item`
    /// mapper so decoding stays consistent. Unlike `get_all_learning_items`,
    /// this does NOT filter out suspended items — a suspended item looked up by
    /// id is still returned.
    pub async fn get_learning_item_by_id(&self, id: &str) -> Result<Option<LearningItem>> {
        let row = sqlx::query("SELECT * FROM learning_items WHERE id = ?1 LIMIT 1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(row) => Ok(Some(Self::row_to_learning_item(&row)?)),
            None => Ok(None),
        }
    }

    pub async fn create_or_get_image_asset(
        &self,
        mime_type: &str,
        file_name: Option<&str>,
        content: &[u8],
        sha256: &str,
        width: Option<i32>,
        height: Option<i32>,
    ) -> Result<ImageAsset> {
        if let Some(existing) = self.get_image_asset_by_sha256(sha256).await? {
            return Ok(existing);
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let byte_size = i64::try_from(content.len()).unwrap_or(i64::MAX);

        sqlx::query(
            r#"
            INSERT INTO image_assets (
                id, mime_type, file_name, content, byte_size, sha256, width, height, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
        )
        .bind(&id)
        .bind(mime_type)
        .bind(file_name)
        .bind(content)
        .bind(byte_size)
        .bind(sha256)
        .bind(width)
        .bind(height)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(ImageAsset {
            id,
            mime_type: mime_type.to_string(),
            file_name: file_name.map(|s| s.to_string()),
            content: content.to_vec(),
            byte_size,
            sha256: sha256.to_string(),
            width,
            height,
            created_at: now,
            updated_at: now,
        })
    }

    pub async fn get_image_asset(&self, id: &str) -> Result<Option<ImageAsset>> {
        let row = sqlx::query("SELECT * FROM image_assets WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        Ok(row.map(|r| ImageAsset {
            id: r.try_get("id").unwrap_or_default(),
            mime_type: r
                .try_get("mime_type")
                .unwrap_or_else(|_| "image/png".to_string()),
            file_name: r.try_get("file_name").ok(),
            content: r.try_get("content").unwrap_or_default(),
            byte_size: r.try_get("byte_size").unwrap_or_default(),
            sha256: r.try_get("sha256").unwrap_or_default(),
            width: r.try_get("width").ok(),
            height: r.try_get("height").ok(),
            created_at: r.try_get("created_at").unwrap_or_else(|_| Utc::now()),
            updated_at: r.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
        }))
    }

    pub async fn list_image_assets(&self) -> Result<Vec<ImageAsset>> {
        let rows = sqlx::query("SELECT * FROM image_assets ORDER BY created_at DESC")
            .fetch_all(&self.pool)
            .await?;

        Ok(rows
            .into_iter()
            .map(|r| ImageAsset {
                id: r.try_get("id").unwrap_or_default(),
                mime_type: r
                    .try_get("mime_type")
                    .unwrap_or_else(|_| "image/png".to_string()),
                file_name: r.try_get("file_name").ok(),
                content: r.try_get("content").unwrap_or_default(),
                byte_size: r.try_get("byte_size").unwrap_or_default(),
                sha256: r.try_get("sha256").unwrap_or_default(),
                width: r.try_get("width").ok(),
                height: r.try_get("height").ok(),
                created_at: r.try_get("created_at").unwrap_or_else(|_| Utc::now()),
                updated_at: r.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
            })
            .collect())
    }

    pub async fn list_image_assets_with_usage(&self) -> Result<Vec<ImageAssetWithUsage>> {
        let rows = sqlx::query(
            r#"
            SELECT
                ia.*,
                COALESCE(asset_refs.reference_count, 0) AS reference_count
            FROM image_assets ia
            LEFT JOIN (
                SELECT
                    json_each.value AS asset_id,
                    COUNT(DISTINCT li.id) AS reference_count
                FROM learning_items li,
                     json_each(COALESCE(li.image_asset_ids, '[]'))
                GROUP BY json_each.value
            ) asset_refs ON asset_refs.asset_id = ia.id
            ORDER BY ia.created_at DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| ImageAssetWithUsage {
                asset: ImageAsset {
                    id: r.try_get("id").unwrap_or_default(),
                    mime_type: r
                        .try_get("mime_type")
                        .unwrap_or_else(|_| "image/png".to_string()),
                    file_name: r.try_get("file_name").ok(),
                    content: r.try_get("content").unwrap_or_default(),
                    byte_size: r.try_get("byte_size").unwrap_or_default(),
                    sha256: r.try_get("sha256").unwrap_or_default(),
                    width: r.try_get("width").ok(),
                    height: r.try_get("height").ok(),
                    created_at: r.try_get("created_at").unwrap_or_else(|_| Utc::now()),
                    updated_at: r.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
                },
                reference_count: r.try_get("reference_count").unwrap_or_default(),
            })
            .collect())
    }

    pub async fn delete_image_asset_if_unreferenced(&self, id: &str) -> Result<bool> {
        let count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*) as count
            FROM learning_items li
            WHERE EXISTS (
                SELECT 1
                FROM json_each(COALESCE(li.image_asset_ids, '[]'))
                WHERE json_each.value = ?1
            )
            "#,
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;

        if count > 0 {
            return Ok(false);
        }

        let result = sqlx::query("DELETE FROM image_assets WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(result.rows_affected() > 0)
    }

    async fn get_image_asset_by_sha256(&self, sha256: &str) -> Result<Option<ImageAsset>> {
        let row = sqlx::query("SELECT * FROM image_assets WHERE sha256 = ?1 LIMIT 1")
            .bind(sha256)
            .fetch_optional(&self.pool)
            .await?;

        Ok(row.map(|r| ImageAsset {
            id: r.try_get("id").unwrap_or_default(),
            mime_type: r
                .try_get("mime_type")
                .unwrap_or_else(|_| "image/png".to_string()),
            file_name: r.try_get("file_name").ok(),
            content: r.try_get("content").unwrap_or_default(),
            byte_size: r.try_get("byte_size").unwrap_or_default(),
            sha256: r.try_get("sha256").unwrap_or_default(),
            width: r.try_get("width").ok(),
            height: r.try_get("height").ok(),
            created_at: r.try_get("created_at").unwrap_or_else(|_| Utc::now()),
            updated_at: r.try_get("updated_at").unwrap_or_else(|_| Utc::now()),
        }))
    }

    /// Create a new review session
    pub async fn create_review_session(&self, id: &str, collection_id: &str) -> Result<()> {
        let now = Utc::now();
        sqlx::query(
            r#"
            INSERT INTO review_sessions (id, collection_id, start_time, items_reviewed, correct_answers, total_time)
            VALUES (?1, ?2, ?3, 0, 0, 0)
            "#,
        )
        .bind(id)
        .bind(collection_id)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Update a review session (increment counters, optionally set end_time)
    pub async fn update_review_session(
        &self,
        id: &str,
        items_reviewed: i32,
        correct_answers: i32,
        total_time: i32,
        end_session: bool,
    ) -> Result<()> {
        let end_time = if end_session { Some(Utc::now()) } else { None };

        if end_session {
            sqlx::query(
                r#"
                UPDATE review_sessions SET
                    items_reviewed = items_reviewed + ?1,
                    correct_answers = correct_answers + ?2,
                    total_time = total_time + ?3,
                    end_time = ?4
                WHERE id = ?5
                "#,
            )
            .bind(items_reviewed)
            .bind(correct_answers)
            .bind(total_time)
            .bind(end_time)
            .bind(id)
            .execute(&self.pool)
            .await?;
        } else {
            sqlx::query(
                r#"
                UPDATE review_sessions SET
                    items_reviewed = items_reviewed + ?1,
                    correct_answers = correct_answers + ?2,
                    total_time = total_time + ?3
                WHERE id = ?4
                "#,
            )
            .bind(items_reviewed)
            .bind(correct_answers)
            .bind(total_time)
            .bind(id)
            .execute(&self.pool)
            .await?;
        }

        Ok(())
    }

    /// Create a review result record for a single card review
    #[allow(clippy::too_many_arguments)]
    pub async fn create_review_result(
        &self,
        id: &str,
        collection_id: &str,
        session_id: Option<&str>,
        item_id: &str,
        rating: i32,
        time_taken: i32,
        new_due_date: &chrono::DateTime<chrono::Utc>,
        new_interval: f64,
        new_ease_factor: f64,
    ) -> Result<()> {
        self.create_review_result_with_arena(
            id,
            collection_id,
            session_id,
            item_id,
            rating,
            time_taken,
            new_due_date,
            new_interval,
            new_ease_factor,
            None,
        )
        .await
    }

    /// Create a review result with optional Algorithm Arena decision provenance.
    /// Legacy/direct reviews use `None` and remain byte-for-byte compatible.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_review_result_with_arena(
        &self,
        id: &str,
        collection_id: &str,
        session_id: Option<&str>,
        item_id: &str,
        rating: i32,
        time_taken: i32,
        new_due_date: &chrono::DateTime<chrono::Utc>,
        new_interval: f64,
        new_ease_factor: f64,
        arena: Option<&ArenaReviewProvenance<'_>>,
    ) -> Result<()> {
        let now = Utc::now();
        sqlx::query(
            r#"
            INSERT INTO review_results (
                id, collection_id, session_id, item_id, rating, time_taken,
                new_due_date, new_interval, new_ease_factor, timestamp,
                schedule_source, schedule_model_id, arena_commit_id,
                arena_recommended_interval, arena_decision_time_ms, arena_snapshot
            )
            VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15, ?16
            )
            "#,
        )
        .bind(id)
        .bind(collection_id)
        .bind(session_id)
        .bind(item_id)
        .bind(rating)
        .bind(time_taken)
        .bind(new_due_date)
        .bind(new_interval)
        .bind(new_ease_factor)
        .bind(now)
        .bind(arena.map(|value| value.schedule_source))
        .bind(arena.and_then(|value| value.schedule_model_id))
        .bind(arena.map(|value| value.arena_commit_id))
        .bind(arena.map(|value| value.recommended_interval))
        .bind(arena.map(|value| value.decision_time_ms as i64))
        .bind(arena.map(|value| value.snapshot))
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn get_review_item_by_arena_commit_id(
        &self,
        arena_commit_id: &str,
    ) -> Result<Option<String>> {
        Ok(sqlx::query_scalar::<_, String>(
            "SELECT item_id FROM review_results WHERE arena_commit_id = ?1 LIMIT 1",
        )
        .bind(arena_commit_id)
        .fetch_optional(&self.pool)
        .await?)
    }

    /// Reconcile the append-only event and collection-wide learning side
    /// effects when the user immediately undoes an Arena review.
    pub async fn undo_arena_review_by_commit_id(&self, arena_commit_id: &str) -> Result<bool> {
        #[derive(serde::Deserialize)]
        struct UndoCollection {
            m2_optimizer: crate::algorithms::sm20::model2::ClassicM2Optimizer,
            m3_matrices: crate::algorithms::sm20::model3::M3MatrixState,
            arena: crate::algorithms::sm20::arena::ArenaState,
        }
        #[derive(serde::Deserialize)]
        struct UndoSnapshot {
            grade: i32,
            #[serde(default)]
            prior_item_state: String,
            #[serde(default)]
            undo_collection: Option<UndoCollection>,
        }

        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT arena_snapshot, session_id, timestamp, time_taken
             FROM review_results WHERE arena_commit_id = ?1 LIMIT 1",
        )
        .bind(arena_commit_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            tx.rollback().await?;
            return Ok(false);
        };

        let snapshot_json: Option<String> = row.try_get("arena_snapshot").ok();
        let snapshot = snapshot_json
            .as_deref()
            .and_then(|json| serde_json::from_str::<UndoSnapshot>(json).ok());
        let session_id: Option<String> = row.try_get("session_id").ok().flatten();
        let timestamp: chrono::DateTime<Utc> = row.try_get("timestamp")?;
        let time_taken: i32 = row.try_get("time_taken")?;

        if let Some(collection) = snapshot
            .as_ref()
            .and_then(|value| value.undo_collection.as_ref())
        {
            let now_text = Utc::now().to_rfc3339();
            sqlx::query(
                "INSERT INTO sm20_m2_optimizer (id, optimizer_state, date_modified)
                 VALUES ('global', ?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET optimizer_state = excluded.optimizer_state, date_modified = excluded.date_modified",
            )
            .bind(serde_json::to_vec(&collection.m2_optimizer)?)
            .bind(&now_text)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO sm20_m3_matrices
                 (id, outcome_count, outcome_success, smoothing_count, smoothing_value,
                  lapse_observed, lapse_remembered, first_stage_observed, first_stage_remembered, date_modified)
                 VALUES ('global', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                    outcome_count = excluded.outcome_count,
                    outcome_success = excluded.outcome_success,
                    smoothing_count = excluded.smoothing_count,
                    smoothing_value = excluded.smoothing_value,
                    lapse_observed = excluded.lapse_observed,
                    lapse_remembered = excluded.lapse_remembered,
                    first_stage_observed = excluded.first_stage_observed,
                    first_stage_remembered = excluded.first_stage_remembered,
                    date_modified = excluded.date_modified",
            )
            .bind(Self::u32_slice_to_bytes(&collection.m3_matrices.outcome_count))
            .bind(Self::u32_slice_to_bytes(&collection.m3_matrices.outcome_success))
            .bind(Self::u32_slice_to_bytes(&collection.m3_matrices.smoothing_count))
            .bind(Self::f64_slice_to_bytes(&collection.m3_matrices.smoothing_value))
            .bind(Self::u32_slice_to_bytes(&collection.m3_matrices.lapse_observed))
            .bind(Self::u32_slice_to_bytes(&collection.m3_matrices.lapse_remembered))
            .bind(Self::u32_slice_to_bytes(&collection.m3_matrices.first_stage_observed))
            .bind(Self::u32_slice_to_bytes(&collection.m3_matrices.first_stage_remembered))
            .bind(&now_text)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO sm20_arena (id, state, date_modified)
                 VALUES ('global', ?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET state = excluded.state, date_modified = excluded.date_modified",
            )
            .bind(serde_json::to_string(&collection.arena)?)
            .bind(&now_text)
            .execute(&mut *tx)
            .await?;
        }

        let grade = snapshot.as_ref().map(|value| value.grade).unwrap_or(0);
        let prior_state = snapshot
            .as_ref()
            .map(|value| value.prior_item_state.as_str())
            .unwrap_or("");
        let (new_cards, learning_cards, review_cards) = match prior_state {
            "new" => (1, 0, 0),
            "learning" | "relearning" => (0, 1, 0),
            "review" => (0, 0, 1),
            _ => (0, 0, 0),
        };
        let statistics_date = timestamp.format("%Y-%m-%d").to_string();
        sqlx::query(
            "UPDATE study_statistics SET
                cards_reviewed = MAX(0, cards_reviewed - 1),
                correct_reviews = MAX(0, correct_reviews - ?1),
                total_study_time = MAX(0, total_study_time - ?2),
                new_cards = MAX(0, new_cards - ?3),
                learning_cards = MAX(0, learning_cards - ?4),
                review_cards = MAX(0, review_cards - ?5)
             WHERE date = ?6",
        )
        .bind(if grade >= 3 { 1 } else { 0 })
        .bind(time_taken)
        .bind(new_cards)
        .bind(learning_cards)
        .bind(review_cards)
        .bind(&statistics_date)
        .execute(&mut *tx)
        .await?;
        if let Some(session_id) = session_id.as_deref() {
            sqlx::query(
                "UPDATE review_sessions SET
                    items_reviewed = MAX(0, items_reviewed - 1),
                    correct_answers = MAX(0, correct_answers - ?1),
                    total_time = MAX(0, total_time - ?2)
                 WHERE id = ?3",
            )
            .bind(if grade >= 3 { 1 } else { 0 })
            .bind(time_taken)
            .bind(session_id)
            .execute(&mut *tx)
            .await?;
        }
        sqlx::query("DELETE FROM review_results WHERE arena_commit_id = ?1")
            .bind(arena_commit_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(true)
    }

    async fn load_sm20_collection_in_transaction(
        tx: &mut sqlx::Transaction<'_, Sqlite>,
    ) -> Result<crate::algorithms::sm20::SM20CollectionState> {
        use crate::algorithms::sm20::model3::{LAPSE_CELLS, OUTCOME_CELLS};
        use crate::algorithms::sm20::{
            arena::ArenaState, model3::M3MatrixState, SM20CollectionState,
        };
        const FIRST_STAGE_DIM: usize = 36;

        let m2_optimizer = sqlx::query_scalar::<_, Vec<u8>>(
            "SELECT optimizer_state FROM sm20_m2_optimizer WHERE id = 'global'",
        )
        .fetch_optional(&mut **tx)
        .await?
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_else(crate::algorithms::sm20::model2::ClassicM2Optimizer::fresh);

        let m3_row: Option<(
            Vec<u8>,
            Vec<u8>,
            Vec<u8>,
            Vec<u8>,
            Vec<u8>,
            Vec<u8>,
            Vec<u8>,
            Vec<u8>,
        )> = sqlx::query_as(
            "SELECT outcome_count, outcome_success, smoothing_count, smoothing_value,
                    lapse_observed, lapse_remembered, first_stage_observed, first_stage_remembered
             FROM sm20_m3_matrices WHERE id = 'global'",
        )
        .fetch_optional(&mut **tx)
        .await?;
        let m3_matrices = m3_row
            .map(|(oc, os, sc, sv, lo, lr, fso, fsr)| M3MatrixState {
                outcome_count: Self::bytes_to_u32_vec(&oc, OUTCOME_CELLS),
                outcome_success: Self::bytes_to_u32_vec(&os, OUTCOME_CELLS),
                smoothing_count: Self::bytes_to_u32_vec(&sc, OUTCOME_CELLS),
                smoothing_value: Self::bytes_to_f64_vec(&sv, OUTCOME_CELLS),
                lapse_observed: Self::bytes_to_u32_vec(&lo, LAPSE_CELLS),
                lapse_remembered: Self::bytes_to_u32_vec(&lr, LAPSE_CELLS),
                first_stage_observed: Self::bytes_to_u32_vec(&fso, FIRST_STAGE_DIM),
                first_stage_remembered: Self::bytes_to_u32_vec(&fsr, FIRST_STAGE_DIM),
            })
            .unwrap_or_default();

        let arena =
            sqlx::query_scalar::<_, String>("SELECT state FROM sm20_arena WHERE id = 'global'")
                .fetch_optional(&mut **tx)
                .await?
                .and_then(|json| serde_json::from_str::<ArenaState>(&json).ok())
                .unwrap_or_default()
                .sanitized();

        let fsrs_params = sqlx::query_scalar::<_, String>(
            "SELECT params FROM sm20_model_params WHERE id = 'fsrs'",
        )
        .fetch_optional(&mut **tx)
        .await?
        .and_then(|json| serde_json::from_str::<Vec<f32>>(&json).ok())
        .filter(|params| !params.is_empty() && params.iter().all(|value| value.is_finite()));
        let m4_params =
            sqlx::query_scalar::<_, String>("SELECT params FROM sm20_model_params WHERE id = 'm4'")
                .fetch_optional(&mut **tx)
                .await?
                .and_then(|json| serde_json::from_str::<Vec<f64>>(&json).ok())
                .filter(|params| {
                    params.len() == 35 && params.iter().all(|value| value.is_finite())
                });

        Ok(SM20CollectionState {
            m2_optimizer,
            m3_matrices,
            arena,
            fsrs_params,
            m4_params,
        })
    }

    /// Commit an Algorithm Arena review as one SQLite unit. The review row is
    /// inserted first to acquire SQLite's write reservation; item and Arena
    /// revisions are then rechecked under that reservation before any durable
    /// scheduler state is replaced. Any error rolls every write back.
    #[allow(clippy::too_many_arguments)]
    pub async fn commit_sm20_arena_review(
        &self,
        item: &LearningItem,
        collection: &crate::algorithms::sm20::SM20CollectionState,
        review_result_id: &str,
        session_id: Option<&str>,
        rating: i32,
        time_taken: i32,
        provenance: &ArenaReviewProvenance<'_>,
        expected_item_revision: &str,
        expected_arena_revision: &str,
        statistics_date: &str,
        correct_reviews: i32,
        new_cards: i32,
        learning_cards: i32,
        review_cards: i32,
    ) -> Result<bool> {
        let mut tx = self.pool.begin().await?;

        if let Some(existing_item_id) = sqlx::query_scalar::<_, String>(
            "SELECT item_id FROM review_results WHERE arena_commit_id = ?1 LIMIT 1",
        )
        .bind(provenance.arena_commit_id)
        .fetch_optional(&mut *tx)
        .await?
        {
            tx.rollback().await?;
            if existing_item_id == item.id {
                return Ok(false);
            }
            return Err(IncrementumError::ArenaAlreadyCommitted(
                "commit_id belongs to another learning item".to_string(),
            ));
        }

        // This first write reserves the database for the rest of the commit.
        // It remains invisible and is removed automatically if validation or
        // any later write fails.
        let inserted = sqlx::query(
            r#"
            INSERT INTO review_results (
                id, collection_id, session_id, item_id, rating, time_taken,
                new_due_date, new_interval, new_ease_factor, timestamp,
                schedule_source, schedule_model_id, arena_commit_id,
                arena_recommended_interval, arena_decision_time_ms, arena_snapshot
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15, ?16
            )
            "#,
        )
        .bind(review_result_id)
        .bind(&item.collection_id)
        .bind(session_id)
        .bind(&item.id)
        .bind(rating)
        .bind(time_taken)
        .bind(item.due_date)
        .bind(item.interval)
        .bind(item.ease_factor)
        .bind(Utc::now())
        .bind(provenance.schedule_source)
        .bind(provenance.schedule_model_id)
        .bind(provenance.arena_commit_id)
        .bind(provenance.recommended_interval)
        .bind(provenance.decision_time_ms as i64)
        .bind(provenance.snapshot)
        .execute(&mut *tx)
        .await;
        if let Err(error) = inserted {
            let duplicate = error
                .as_database_error()
                .is_some_and(|database_error| database_error.is_unique_violation());
            tx.rollback().await?;
            if duplicate {
                return Ok(false);
            }
            return Err(error.into());
        }

        let current_item_row = sqlx::query("SELECT * FROM learning_items WHERE id = ?1 LIMIT 1")
            .bind(&item.id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| IncrementumError::NotFound(format!("Learning item {}", item.id)))?;
        let current_item = Self::row_to_learning_item(&current_item_row)?;
        let current_item_revision = crate::commands::review::sm20_item_revision(&current_item)?;
        if current_item_revision != expected_item_revision {
            tx.rollback().await?;
            return Err(IncrementumError::ArenaPreviewStale(
                "the card changed before the Arena decision was committed".to_string(),
            ));
        }

        let current_collection = Self::load_sm20_collection_in_transaction(&mut tx).await?;
        let current_arena_revision =
            crate::commands::review::sm20_arena_revision(&current_collection)?;
        if current_arena_revision != expected_arena_revision {
            tx.rollback().await?;
            return Err(IncrementumError::ArenaPreviewStale(
                "the Algorithm Arena changed before the decision was committed".to_string(),
            ));
        }

        let state_str = format!("{:?}", item.state).to_lowercase();
        let tags_json = serde_json::to_string(&item.tags)?;
        let interaction_metadata_json = item
            .interaction_metadata
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let (stability, memory_difficulty) = item
            .memory_state
            .as_ref()
            .map(|state| (Some(state.stability), Some(state.difficulty)))
            .unwrap_or((None, None));
        sqlx::query(
            r#"
            UPDATE learning_items SET
                due_date = ?1, interval = ?2, ease_factor = ?3,
                state = ?4, review_count = ?5, lapses = ?6,
                last_review_date = ?7, date_modified = ?8,
                memory_state_stability = ?9, memory_state_difficulty = ?10,
                interaction_metadata = ?12, algorithm_type = ?13, algorithm_state = ?14,
                updated_at = COALESCE(?15, updated_at), tags = ?16, difficulty = ?17
            WHERE id = ?11
            "#,
        )
        .bind(item.due_date)
        .bind(item.interval)
        .bind(item.ease_factor)
        .bind(&state_str)
        .bind(item.review_count)
        .bind(item.lapses)
        .bind(item.last_review_date)
        .bind(item.date_modified)
        .bind(stability)
        .bind(memory_difficulty)
        .bind(&item.id)
        .bind(&interaction_metadata_json)
        .bind(&item.algorithm_type)
        .bind(&item.algorithm_state)
        .bind(&item.updated_at)
        .bind(&tags_json)
        .bind(item.difficulty)
        .execute(&mut *tx)
        .await?;

        let now_text = Utc::now().to_rfc3339();
        let m2_bytes = serde_json::to_vec(&collection.m2_optimizer)?;
        sqlx::query(
            "INSERT INTO sm20_m2_optimizer (id, optimizer_state, date_modified)
             VALUES ('global', ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET optimizer_state = excluded.optimizer_state, date_modified = excluded.date_modified",
        )
        .bind(m2_bytes)
        .bind(&now_text)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO sm20_m3_matrices
             (id, outcome_count, outcome_success, smoothing_count, smoothing_value,
              lapse_observed, lapse_remembered, first_stage_observed, first_stage_remembered, date_modified)
             VALUES ('global', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                outcome_count = excluded.outcome_count,
                outcome_success = excluded.outcome_success,
                smoothing_count = excluded.smoothing_count,
                smoothing_value = excluded.smoothing_value,
                lapse_observed = excluded.lapse_observed,
                lapse_remembered = excluded.lapse_remembered,
                first_stage_observed = excluded.first_stage_observed,
                first_stage_remembered = excluded.first_stage_remembered,
                date_modified = excluded.date_modified",
        )
        .bind(Self::u32_slice_to_bytes(&collection.m3_matrices.outcome_count))
        .bind(Self::u32_slice_to_bytes(&collection.m3_matrices.outcome_success))
        .bind(Self::u32_slice_to_bytes(&collection.m3_matrices.smoothing_count))
        .bind(Self::f64_slice_to_bytes(&collection.m3_matrices.smoothing_value))
        .bind(Self::u32_slice_to_bytes(&collection.m3_matrices.lapse_observed))
        .bind(Self::u32_slice_to_bytes(&collection.m3_matrices.lapse_remembered))
        .bind(Self::u32_slice_to_bytes(&collection.m3_matrices.first_stage_observed))
        .bind(Self::u32_slice_to_bytes(&collection.m3_matrices.first_stage_remembered))
        .bind(&now_text)
        .execute(&mut *tx)
        .await?;
        let arena_json = serde_json::to_string(&collection.arena)?;
        sqlx::query(
            "INSERT INTO sm20_arena (id, state, date_modified)
             VALUES ('global', ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET state = excluded.state, date_modified = excluded.date_modified",
        )
        .bind(arena_json)
        .bind(&now_text)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO study_statistics (
                id, date, cards_reviewed, correct_reviews, total_study_time,
                new_cards, learning_cards, review_cards
            ) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(date) DO UPDATE SET
                cards_reviewed = cards_reviewed + 1,
                correct_reviews = correct_reviews + excluded.correct_reviews,
                total_study_time = total_study_time + excluded.total_study_time,
                new_cards = new_cards + excluded.new_cards,
                learning_cards = learning_cards + excluded.learning_cards,
                review_cards = review_cards + excluded.review_cards
            "#,
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(statistics_date)
        .bind(correct_reviews)
        .bind(time_taken)
        .bind(new_cards)
        .bind(learning_cards)
        .bind(review_cards)
        .execute(&mut *tx)
        .await?;

        if let Some(session_id) = session_id {
            sqlx::query(
                "UPDATE review_sessions SET
                    items_reviewed = items_reviewed + 1,
                    correct_answers = correct_answers + ?1,
                    total_time = total_time + ?2
                 WHERE id = ?3",
            )
            .bind(correct_reviews)
            .bind(time_taken)
            .bind(session_id)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(true)
    }

    /// Batch-insert review log entries (used for Anki revlog import).
    ///
    /// Inserts all entries in a single transaction using chunked multi-row
    /// `INSERT` statements instead of one round-trip per row. The chunk size
    /// is derived from SQLite's bind limit: each row binds 11 columns, and the
    /// default `SQLITE_MAX_VARIABLE_NUMBER` is 999, so up to `90` rows
    /// (`999 / 11`) fit per statement. We use 90 to stay safely under the limit.
    pub async fn batch_insert_review_log(
        &self,
        entries: &[crate::anki::AnkiRevLogEntry],
        item_id: &str,
    ) -> Result<()> {
        if entries.is_empty() {
            return Ok(());
        }

        // 11 columns per row -> floor(999 / 11) = 90 rows per statement.
        const COLS_PER_ROW: usize = 11;
        const CHUNK_SIZE: usize = 999 / COLS_PER_ROW;

        let mut tx = self.pool().begin().await?;

        for chunk in entries.chunks(CHUNK_SIZE) {
            let mut builder: sqlx::QueryBuilder<Sqlite> = sqlx::QueryBuilder::new(
                r#"INSERT INTO review_log (
                    id, item_id, rating, interval_days, last_interval_days,
                    ease_factor, time_ms, review_type, source, anki_revlog_id, timestamp
                ) "#,
            );
            builder.push_values(chunk.iter(), |mut b, entry| {
                let id = uuid::Uuid::new_v4().to_string();
                // revlog id is a millisecond timestamp
                let timestamp =
                    chrono::DateTime::from_timestamp_millis(entry.id).unwrap_or_else(Utc::now);
                let interval_days = if entry.ivl < 0 {
                    // Negative intervals are in seconds
                    entry.ivl as f64 / 86400.0
                } else {
                    entry.ivl as f64
                };
                let last_interval_days = if entry.last_ivl < 0 {
                    Some(entry.last_ivl as f64 / 86400.0)
                } else {
                    Some(entry.last_ivl as f64)
                };
                let ease_factor = entry.factor as f64 / 1000.0;

                b.push_bind(id)
                    .push_bind(item_id)
                    .push_bind(entry.ease)
                    .push_bind(interval_days)
                    .push_bind(last_interval_days)
                    .push_bind(ease_factor)
                    .push_bind(entry.time_ms)
                    .push_bind(entry.rev_type)
                    .push_bind("anki-import")
                    .push_bind(entry.id)
                    .push_bind(timestamp);
            });
            builder.build().execute(&mut *tx).await?;
        }

        tx.commit().await?;
        Ok(())
    }

    /// Get review log entries for a specific learning item
    pub async fn get_review_log_for_item(
        &self,
        item_id: &str,
    ) -> Result<Vec<crate::anki::ReviewLogRow>> {
        let rows = sqlx::query(
            r#"
            SELECT id, item_id, rating, interval_days, last_interval_days,
                   ease_factor, time_ms, review_type, source, anki_revlog_id, timestamp
            FROM review_log WHERE item_id = ?1 ORDER BY timestamp
            "#,
        )
        .bind(item_id)
        .fetch_all(&self.pool)
        .await?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(crate::anki::ReviewLogRow {
                id: row.try_get("id")?,
                item_id: row.try_get("item_id")?,
                rating: row.try_get("rating")?,
                interval_days: row.try_get("interval_days")?,
                last_interval_days: row.try_get("last_interval_days")?,
                ease_factor: row.try_get("ease_factor")?,
                time_ms: row.try_get("time_ms")?,
                review_type: row.try_get("review_type")?,
                anki_revlog_id: row.try_get("anki_revlog_id")?,
                timestamp: row.try_get("timestamp")?,
            });
        }
        Ok(entries)
    }

    /// Get review log entries for multiple learning items
    pub async fn get_review_log_for_items(
        &self,
        item_ids: &[String],
    ) -> Result<Vec<crate::anki::ReviewLogRow>> {
        if item_ids.is_empty() {
            return Ok(Vec::new());
        }
        // SQLite has a limit on bind params, so batch in groups of 500
        let mut entries = Vec::new();
        for chunk in item_ids.chunks(500) {
            let placeholders: Vec<String> = chunk
                .iter()
                .enumerate()
                .map(|(i, _)| format!("?{}", i + 1))
                .collect();
            let query = format!(
                r#"
                SELECT id, item_id, rating, interval_days, last_interval_days,
                       ease_factor, time_ms, review_type, source, anki_revlog_id, timestamp
                FROM review_log WHERE item_id IN ({}) ORDER BY timestamp
                "#,
                placeholders.join(",")
            );
            let mut query = sqlx::query(&query);
            for id in chunk {
                query = query.bind(id);
            }
            let rows = query.fetch_all(&self.pool).await?;
            for row in rows {
                entries.push(crate::anki::ReviewLogRow {
                    id: row.try_get("id")?,
                    item_id: row.try_get("item_id")?,
                    rating: row.try_get("rating")?,
                    interval_days: row.try_get("interval_days")?,
                    last_interval_days: row.try_get("last_interval_days")?,
                    ease_factor: row.try_get("ease_factor")?,
                    time_ms: row.try_get("time_ms")?,
                    review_type: row.try_get("review_type")?,
                    anki_revlog_id: row.try_get("anki_revlog_id")?,
                    timestamp: row.try_get("timestamp")?,
                });
            }
        }
        Ok(entries)
    }

    /// Get or create study statistics for a specific date
    pub async fn get_study_statistics(&self, date: &str) -> Result<Option<StudyStatsRow>> {
        let row =
            sqlx::query_as::<_, StudyStatsRow>("SELECT * FROM study_statistics WHERE date = ?1")
                .bind(date)
                .fetch_optional(&self.pool)
                .await?;

        Ok(row)
    }

    /// Create study statistics for a specific date
    pub async fn create_study_statistics(&self, date: &str) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO study_statistics (id, date, cards_reviewed, correct_reviews, total_study_time, new_cards, learning_cards, review_cards)
            VALUES (?1, ?2, 0, 0, 0, 0, 0, 0)
            "#,
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(date)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Update study statistics for a specific date
    #[allow(clippy::too_many_arguments)]
    pub async fn update_study_statistics(
        &self,
        date: &str,
        cards_reviewed: i32,
        correct_reviews: i32,
        study_time: i32,
        new_cards: i32,
        learning_cards: i32,
        review_cards: i32,
    ) -> Result<()> {
        // First try to get existing stats
        let existing = self.get_study_statistics(date).await?;

        if existing.is_some() {
            sqlx::query(
                r#"
                UPDATE study_statistics SET
                    cards_reviewed = cards_reviewed + ?1,
                    correct_reviews = correct_reviews + ?2,
                    total_study_time = total_study_time + ?3,
                    new_cards = new_cards + ?4,
                    learning_cards = learning_cards + ?5,
                    review_cards = review_cards + ?6
                WHERE date = ?7
                "#,
            )
            .bind(cards_reviewed)
            .bind(correct_reviews)
            .bind(study_time)
            .bind(new_cards)
            .bind(learning_cards)
            .bind(review_cards)
            .bind(date)
            .execute(&self.pool)
            .await?;
        } else {
            self.create_study_statistics(date).await?;
            sqlx::query(
                r#"
                UPDATE study_statistics SET
                    cards_reviewed = cards_reviewed + ?1,
                    correct_reviews = correct_reviews + ?2,
                    total_study_time = total_study_time + ?3,
                    new_cards = new_cards + ?4,
                    learning_cards = learning_cards + ?5,
                    review_cards = review_cards + ?6
                WHERE date = ?7
                "#,
            )
            .bind(cards_reviewed)
            .bind(correct_reviews)
            .bind(study_time)
            .bind(new_cards)
            .bind(learning_cards)
            .bind(review_cards)
            .bind(date)
            .execute(&self.pool)
            .await?;
        }

        Ok(())
    }

    pub async fn get_youtube_transcript_by_video_id(
        &self,
        video_id: &str,
    ) -> Result<Option<(String, String)>> {
        let row = sqlx::query(
            "SELECT transcript, segments_json FROM youtube_transcripts WHERE video_id = ?1 LIMIT 1",
        )
        .bind(video_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| {
            let transcript: String = row.get("transcript");
            let segments_json: String = row.get("segments_json");
            (transcript, segments_json)
        }))
    }

    /// Same as [`Self::get_youtube_transcript_by_video_id`] but also returns the
    /// `word_timings_version` of the cached row so callers can decide whether the
    /// blob predates per-word timings and must be re-fetched.
    pub async fn get_youtube_transcript_by_video_id_with_version(
        &self,
        video_id: &str,
    ) -> Result<Option<(String, String, i32)>> {
        let row = sqlx::query(
            "SELECT transcript, segments_json, word_timings_version FROM youtube_transcripts WHERE video_id = ?1 LIMIT 1",
        )
        .bind(video_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| {
            let transcript: String = row.get("transcript");
            let segments_json: String = row.get("segments_json");
            let word_timings_version: i32 = row.get("word_timings_version");
            (transcript, segments_json, word_timings_version)
        }))
    }

    pub async fn get_youtube_transcript_by_document_id(
        &self,
        document_id: &str,
    ) -> Result<Option<(String, String)>> {
        let row = sqlx::query(
            "SELECT transcript, segments_json FROM youtube_transcripts WHERE document_id = ?1 LIMIT 1",
        )
        .bind(document_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| {
            let transcript: String = row.get("transcript");
            let segments_json: String = row.get("segments_json");
            (transcript, segments_json)
        }))
    }

    pub async fn upsert_youtube_transcript(
        &self,
        document_id: Option<&str>,
        video_id: &str,
        transcript: &str,
        segments_json: &str,
        word_timings_version: i32,
    ) -> Result<()> {
        let now = Utc::now();
        let id = uuid::Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO youtube_transcripts (
                id, document_id, video_id, transcript, segments_json, date_created, date_modified,
                word_timings_version
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(video_id) DO UPDATE SET
                document_id = COALESCE(excluded.document_id, youtube_transcripts.document_id),
                transcript = excluded.transcript,
                segments_json = excluded.segments_json,
                date_modified = excluded.date_modified,
                word_timings_version = excluded.word_timings_version
            "#,
        )
        .bind(id)
        .bind(document_id)
        .bind(video_id)
        .bind(transcript)
        .bind(segments_json)
        .bind(now)
        .bind(now)
        .bind(word_timings_version)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn upsert_embedding(&self, emb: &QueueItemEmbedding) -> Result<()> {
        let mut bytes = Vec::with_capacity(emb.embedding.len() * 4);
        for &val in &emb.embedding {
            bytes.extend_from_slice(&val.to_le_bytes());
        }

        sqlx::query(
            r#"INSERT OR REPLACE INTO queue_item_embeddings (item_id, embedding, content_hash, provider, model, dimension, created_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
        )
        .bind(&emb.item_id)
        .bind(&bytes)
        .bind(&emb.content_hash)
        .bind(&emb.provider)
        .bind(&emb.model)
        .bind(emb.dimension)
        .bind(emb.created_at)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn get_embeddings_for_items(
        &self,
        item_ids: &[String],
    ) -> Result<Vec<QueueItemEmbedding>> {
        if item_ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = item_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT * FROM queue_item_embeddings WHERE item_id IN ({})",
            placeholders.join(", ")
        );
        let mut query = sqlx::query(&sql);
        for id in item_ids {
            query = query.bind(id);
        }
        let rows = query.fetch_all(&self.pool).await?;

        let mut results = Vec::new();
        for row in rows {
            let item_id: String = row.try_get("item_id")?;
            let blob: Vec<u8> = row.try_get("embedding")?;
            let dimension: i32 = row.try_get("dimension")?;
            let embedding = Self::bytes_to_embedding(&blob, dimension as usize);
            results.push(QueueItemEmbedding {
                item_id,
                embedding,
                content_hash: row.try_get("content_hash")?,
                provider: row.try_get("provider")?,
                model: row.try_get("model")?,
                dimension,
                created_at: row.try_get("created_at")?,
            });
        }
        Ok(results)
    }

    /// Returns item IDs from the given list that have stale or missing embeddings
    /// (content hash mismatch or wrong provider/model).
    pub async fn get_stale_embedding_item_ids(
        &self,
        items: &[(String, String)], // (item_id, current_content_hash)
        provider: &str,
        model: &str,
    ) -> Result<Vec<String>> {
        if items.is_empty() {
            return Ok(Vec::new());
        }
        let ids: Vec<&str> = items.iter().map(|(id, _)| id.as_str()).collect();
        let placeholders: Vec<String> = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT item_id, content_hash FROM queue_item_embeddings WHERE item_id IN ({}) AND provider = ?{} AND model = ?{}",
            placeholders.join(", "),
            ids.len() + 1,
            ids.len() + 2
        );
        let mut query = sqlx::query(&sql);
        for id in &ids {
            query = query.bind(*id);
        }
        query = query.bind(provider).bind(model);
        let rows = query.fetch_all(&self.pool).await?;

        let valid_ids: std::collections::HashSet<String> = rows
            .iter()
            .filter_map(|row| {
                let item_id: String = row.try_get("item_id").ok()?;
                let stored_hash: String = row.try_get("content_hash").ok()?;
                let expected_hash = items.iter().find(|(id, _)| id == &item_id)?.1.clone();
                if stored_hash == expected_hash {
                    Some(item_id)
                } else {
                    None
                }
            })
            .collect();

        let stale: Vec<String> = items
            .iter()
            .filter(|(id, _)| !valid_ids.contains(id))
            .map(|(id, _)| id.clone())
            .collect();
        Ok(stale)
    }

    pub async fn count_embeddings(&self) -> Result<i64> {
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM queue_item_embeddings")
            .fetch_one(&self.pool)
            .await?;
        Ok(row.0)
    }

    // -----------------------------------------------------------------------
    // SM-20 local recall optimizer
    // -----------------------------------------------------------------------

    pub async fn record_sm20_recall_observation(
        &self,
        retrievability_bucket: u8,
        difficulty_bucket: u8,
        passed: bool,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"INSERT INTO sm20_recall_cells
               (retrievability_bucket, difficulty_bucket, total_count, pass_count, date_modified)
               VALUES (?1, ?2, 1, ?3, ?4)
               ON CONFLICT(retrievability_bucket, difficulty_bucket) DO UPDATE SET
                   total_count = total_count + 1,
                   pass_count = pass_count + excluded.pass_count,
                   date_modified = excluded.date_modified"#,
        )
        .bind(i64::from(retrievability_bucket.clamp(1, 20)))
        .bind(i64::from(difficulty_bucket.clamp(1, 20)))
        .bind(if passed { 1_i64 } else { 0_i64 })
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_sm20_recall_cells(
        &self,
    ) -> Result<Vec<crate::algorithms::sm20::SM20RecallCell>> {
        let rows = sqlx::query(
            r#"SELECT retrievability_bucket, difficulty_bucket, total_count, pass_count
               FROM sm20_recall_cells ORDER BY retrievability_bucket, difficulty_bucket"#,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(crate::algorithms::sm20::SM20RecallCell {
                    retrievability_bucket: row.try_get::<i64, _>("retrievability_bucket")? as u8,
                    difficulty_bucket: row.try_get::<i64, _>("difficulty_bucket")? as u8,
                    total_count: row.try_get::<i64, _>("total_count")? as u32,
                    pass_count: row.try_get::<i64, _>("pass_count")? as u32,
                })
            })
            .collect()
    }

    pub async fn get_sm20_optimizer_profile(&self) -> Result<Option<SM20OptimizerProfileRow>> {
        let row = sqlx::query(
            r#"SELECT model_version, optimizer_version, coefficient_1, coefficient_2,
                      coefficient_3, coefficient_4, objective_score, sample_count,
                      activation_state, last_optimized_at
               FROM sm20_optimizer_profiles WHERE id = 'global'"#,
        )
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else { return Ok(None) };
        Ok(Some(SM20OptimizerProfileRow {
            coefficients: crate::algorithms::sm20::SM20RecallCoefficients {
                coefficient_1: row.try_get("coefficient_1")?,
                coefficient_2: row.try_get("coefficient_2")?,
                coefficient_3: row.try_get("coefficient_3")?,
                coefficient_4: row.try_get("coefficient_4")?,
            },
            objective_score: row.try_get("objective_score")?,
            sample_count: row.try_get::<i64, _>("sample_count")? as u32,
            optimizer_version: row.try_get("optimizer_version")?,
            model_version: row.try_get("model_version")?,
            activation_state: row.try_get("activation_state")?,
            last_optimized_at: row.try_get("last_optimized_at")?,
        }))
    }

    pub async fn save_sm20_optimizer_profile(
        &self,
        coefficients: crate::algorithms::sm20::SM20RecallCoefficients,
        objective_score: f64,
        sample_count: u32,
        optimized_at: &str,
    ) -> Result<()> {
        sqlx::query(
            r#"INSERT INTO sm20_optimizer_profiles
               (id, model_version, optimizer_version, coefficient_1, coefficient_2,
                coefficient_3, coefficient_4, objective_score, sample_count,
                activation_state, last_optimized_at, date_modified)
               VALUES ('global', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'diagnostic', ?9, ?9)
               ON CONFLICT(id) DO UPDATE SET
                   model_version = excluded.model_version,
                   optimizer_version = excluded.optimizer_version,
                   coefficient_1 = excluded.coefficient_1,
                   coefficient_2 = excluded.coefficient_2,
                   coefficient_3 = excluded.coefficient_3,
                   coefficient_4 = excluded.coefficient_4,
                   objective_score = excluded.objective_score,
                   sample_count = excluded.sample_count,
                   activation_state = 'diagnostic',
                   last_optimized_at = excluded.last_optimized_at,
                   date_modified = excluded.date_modified"#,
        )
        .bind(crate::algorithms::sm20::SM20_MODEL_VERSION)
        .bind(crate::algorithms::sm20::SM20_OPTIMIZER_VERSION)
        .bind(coefficients.coefficient_1)
        .bind(coefficients.coefficient_2)
        .bind(coefficients.coefficient_3)
        .bind(coefficients.coefficient_4)
        .bind(objective_score)
        .bind(i64::from(sample_count))
        .bind(optimized_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Legacy SM-20 Bayesian matrices (retained for rollback; no active callers)
    // -----------------------------------------------------------------------

    /// Size of each SM-20 matrix dimension (21³ = 9,261 cells).
    pub const SM20_MATRIX_SIZE: usize = 9261;

    /// Load the global SM-20 Bayesian matrices. Returns `None` on first run
    /// (no row yet). The returned arrays are little-endian-deserialized BLOBs.
    pub async fn get_sm20_matrices(&self) -> Result<Option<([f64; 9261], [u32; 9261])>> {
        let row = sqlx::query(
            r#"SELECT interval_matrix, count_matrix FROM sm20_matrices WHERE id = 'global'"#,
        )
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else { return Ok(None) };

        let interval_blob: Vec<u8> = row.try_get("interval_matrix")?;
        let count_blob: Vec<u8> = row.try_get("count_matrix")?;

        Ok(Some((
            Self::bytes_to_sm20_interval_matrix(&interval_blob)?,
            Self::bytes_to_sm20_count_matrix(&count_blob)?,
        )))
    }

    /// Persist the global SM-20 Bayesian matrices, creating or replacing the
    /// single `global` row.
    pub async fn upsert_sm20_matrices(
        &self,
        interval: &[f64; 9261],
        count: &[u32; 9261],
    ) -> Result<()> {
        let interval_bytes = Self::sm20_interval_matrix_to_bytes(interval);
        let count_bytes = Self::sm20_count_matrix_to_bytes(count);
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            r#"INSERT INTO sm20_matrices (id, collection_id, interval_matrix, count_matrix, date_modified)
               VALUES ('global', ?1, ?2, ?3, ?4)
               ON CONFLICT(id) DO UPDATE SET
                   interval_matrix = excluded.interval_matrix,
                   count_matrix = excluded.count_matrix,
                   date_modified = excluded.date_modified"#,
        )
        .bind(DEFAULT_COLLECTION_ID)
        .bind(&interval_bytes)
        .bind(&count_bytes)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Deserialize the interval_matrix BLOB (9,261 × f64 little-endian) into a
    /// fixed-size array. Errors if the blob is not exactly 74,088 bytes.
    fn bytes_to_sm20_interval_matrix(bytes: &[u8]) -> Result<[f64; 9261]> {
        const EXPECTED: usize = 9261 * 8;
        if bytes.len() != EXPECTED {
            return Err(IncrementumError::Internal(format!(
                "sm20 interval_matrix blob is {} bytes, expected {EXPECTED}",
                bytes.len()
            )));
        }
        let mut out = [0.0f64; 9261];
        for (i, cell) in out.iter_mut().enumerate() {
            let off = i * 8;
            *cell = f64::from_le_bytes([
                bytes[off],
                bytes[off + 1],
                bytes[off + 2],
                bytes[off + 3],
                bytes[off + 4],
                bytes[off + 5],
                bytes[off + 6],
                bytes[off + 7],
            ]);
        }
        Ok(out)
    }

    /// Deserialize the count_matrix BLOB (9,261 × u32 little-endian) into a
    /// fixed-size array. Errors if the blob is not exactly 37,044 bytes.
    fn bytes_to_sm20_count_matrix(bytes: &[u8]) -> Result<[u32; 9261]> {
        const EXPECTED: usize = 9261 * 4;
        if bytes.len() != EXPECTED {
            return Err(IncrementumError::Internal(format!(
                "sm20 count_matrix blob is {} bytes, expected {EXPECTED}",
                bytes.len()
            )));
        }
        let mut out = [0u32; 9261];
        for (i, cell) in out.iter_mut().enumerate() {
            let off = i * 4;
            *cell =
                u32::from_le_bytes([bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]]);
        }
        Ok(out)
    }

    /// Serialize the interval_matrix into a little-endian f64 byte blob.
    fn sm20_interval_matrix_to_bytes(interval: &[f64; 9261]) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(9261 * 8);
        for &val in interval {
            bytes.extend_from_slice(&val.to_le_bytes());
        }
        bytes
    }

    /// Serialize the count_matrix into a little-endian u32 byte blob.
    fn sm20_count_matrix_to_bytes(count: &[u32; 9261]) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(9261 * 4);
        for &val in count {
            bytes.extend_from_slice(&val.to_le_bytes());
        }
        bytes
    }

    // -----------------------------------------------------------------------
    // SM-20 Ensemble collection-wide state (M2 optimizer + M3 matrices)
    // -----------------------------------------------------------------------

    /// Load the M2 optimizer state (JSON blob). Returns None if not yet initialized.
    pub async fn get_sm20_m2_optimizer(&self) -> Result<Option<Vec<u8>>> {
        let row: Option<(Vec<u8>,)> =
            sqlx::query_as("SELECT optimizer_state FROM sm20_m2_optimizer WHERE id = 'global'")
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|(state,)| state))
    }

    /// Save the M2 optimizer state (JSON blob).
    pub async fn save_sm20_m2_optimizer(&self, state: &[u8]) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO sm20_m2_optimizer (id, optimizer_state, date_modified)
             VALUES ('global', ?, ?)
             ON CONFLICT(id) DO UPDATE SET optimizer_state = excluded.optimizer_state, date_modified = excluded.date_modified",
        )
        .bind(state)
        .bind(&now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Load the M3 matrix state. Returns None if not yet initialized.
    pub async fn get_sm20_m3_matrices(
        &self,
    ) -> Result<Option<crate::algorithms::sm20::model3::M3MatrixState>> {
        use crate::algorithms::sm20::model3::{M3MatrixState, LAPSE_CELLS, OUTCOME_CELLS};
        const FIRST_STAGE_DIM: usize = 36;

        let row: Option<(
            Vec<u8>,
            Vec<u8>,
            Vec<u8>,
            Vec<u8>,
            Vec<u8>,
            Vec<u8>,
            Vec<u8>,
            Vec<u8>,
        )> = sqlx::query_as(
            "SELECT outcome_count, outcome_success, smoothing_count, smoothing_value,
                    lapse_observed, lapse_remembered, first_stage_observed, first_stage_remembered
             FROM sm20_m3_matrices WHERE id = 'global'",
        )
        .fetch_optional(&self.pool)
        .await?;

        if let Some((oc, os_, sc, sv, lo, lr, fso, fsr)) = row {
            let outcome_count = Self::bytes_to_u32_vec(&oc, OUTCOME_CELLS);
            let outcome_success = Self::bytes_to_u32_vec(&os_, OUTCOME_CELLS);
            let smoothing_count = Self::bytes_to_u32_vec(&sc, OUTCOME_CELLS);
            let smoothing_value = Self::bytes_to_f64_vec(&sv, OUTCOME_CELLS);
            let lapse_observed = Self::bytes_to_u32_vec(&lo, LAPSE_CELLS);
            let lapse_remembered = Self::bytes_to_u32_vec(&lr, LAPSE_CELLS);
            let first_stage_observed = Self::bytes_to_u32_vec(&fso, FIRST_STAGE_DIM);
            let first_stage_remembered = Self::bytes_to_u32_vec(&fsr, FIRST_STAGE_DIM);

            Ok(Some(M3MatrixState {
                outcome_count,
                outcome_success,
                smoothing_count,
                smoothing_value,
                lapse_observed,
                lapse_remembered,
                first_stage_observed,
                first_stage_remembered,
            }))
        } else {
            Ok(None)
        }
    }

    /// Save the M3 matrix state.
    pub async fn save_sm20_m3_matrices(
        &self,
        state: &crate::algorithms::sm20::model3::M3MatrixState,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO sm20_m3_matrices
             (id, outcome_count, outcome_success, smoothing_count, smoothing_value,
              lapse_observed, lapse_remembered, first_stage_observed, first_stage_remembered, date_modified)
             VALUES ('global', ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                outcome_count = excluded.outcome_count,
                outcome_success = excluded.outcome_success,
                smoothing_count = excluded.smoothing_count,
                smoothing_value = excluded.smoothing_value,
                lapse_observed = excluded.lapse_observed,
                lapse_remembered = excluded.lapse_remembered,
                first_stage_observed = excluded.first_stage_observed,
                first_stage_remembered = excluded.first_stage_remembered,
                date_modified = excluded.date_modified",
        )
        .bind(Self::u32_slice_to_bytes(&state.outcome_count))
        .bind(Self::u32_slice_to_bytes(&state.outcome_success))
        .bind(Self::u32_slice_to_bytes(&state.smoothing_count))
        .bind(Self::f64_slice_to_bytes(&state.smoothing_value))
        .bind(Self::u32_slice_to_bytes(&state.lapse_observed))
        .bind(Self::u32_slice_to_bytes(&state.lapse_remembered))
        .bind(Self::u32_slice_to_bytes(&state.first_stage_observed))
        .bind(Self::u32_slice_to_bytes(&state.first_stage_remembered))
        .bind(&now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Load the Algorithm Arena state (JSON `ArenaState`).
    pub async fn get_sm20_arena(&self) -> Result<Option<String>> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT state FROM sm20_arena WHERE id = 'global'")
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|(s,)| s))
    }

    /// Save the Algorithm Arena state (JSON `ArenaState`).
    pub async fn save_sm20_arena(&self, state_json: &str) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO sm20_arena (id, state, date_modified)
             VALUES ('global', ?, ?)
             ON CONFLICT(id) DO UPDATE SET state = excluded.state, date_modified = excluded.date_modified",
        )
        .bind(state_json)
        .bind(&now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Load per-user optimized model parameters (`id` = 'fsrs' or 'm4').
    /// Returns the params JSON string.
    pub async fn get_sm20_model_params(&self, id: &str) -> Result<Option<String>> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT params FROM sm20_model_params WHERE id = ?")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|(s,)| s))
    }

    /// Save per-user optimized model parameters (`id` = 'fsrs' or 'm4').
    pub async fn save_sm20_model_params(
        &self,
        id: &str,
        params_json: &str,
        meta_json: Option<&str>,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO sm20_model_params (id, params, meta, date_modified)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET params = excluded.params, meta = excluded.meta, date_modified = excluded.date_modified",
        )
        .bind(id)
        .bind(params_json)
        .bind(meta_json)
        .bind(&now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Fetch the full review log for optimizer training:
    /// `(item_id, rating, timestamp)` ordered by item then time.
    pub async fn get_revlog_for_training(&self) -> Result<Vec<(String, i32, String)>> {
        let rows: Vec<(String, i32, String)> = sqlx::query_as(
            "SELECT item_id, rating, timestamp FROM review_results ORDER BY item_id, timestamp",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    fn bytes_to_u32_vec(bytes: &[u8], expected_len: usize) -> Vec<u32> {
        bytes
            .chunks_exact(4)
            .take(expected_len)
            .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect()
    }

    fn bytes_to_f64_vec(bytes: &[u8], expected_len: usize) -> Vec<f64> {
        bytes
            .chunks_exact(8)
            .take(expected_len)
            .map(|c| f64::from_le_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]]))
            .collect()
    }

    fn u32_slice_to_bytes(slice: &[u32]) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(slice.len() * 4);
        for &val in slice {
            bytes.extend_from_slice(&val.to_le_bytes());
        }
        bytes
    }

    fn f64_slice_to_bytes(slice: &[f64]) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(slice.len() * 8);
        for &val in slice {
            bytes.extend_from_slice(&val.to_le_bytes());
        }
        bytes
    }

    fn bytes_to_embedding(bytes: &[u8], dimension: usize) -> Vec<f32> {
        let mut result = Vec::with_capacity(dimension);
        for chunk in bytes.chunks_exact(4).take(dimension) {
            result.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
        }
        result
    }

    // -----------------------------------------------------------------------
    // Document chunk embeddings (whole-library RAG)
    // -----------------------------------------------------------------------

    /// Upsert a document chunk embedding. The `id` is `{document_id}:{chunk_index}`.
    pub async fn upsert_chunk_embedding(&self, emb: &DocumentChunkEmbedding) -> Result<()> {
        let mut bytes = Vec::with_capacity(emb.embedding.len() * 4);
        for &val in &emb.embedding {
            bytes.extend_from_slice(&val.to_le_bytes());
        }

        sqlx::query(
            r#"INSERT OR REPLACE INTO document_chunk_embeddings
               (id, document_id, chunk_index, chunk_text, embedding, content_hash, provider, model, dimension, created_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"#,
        )
        .bind(&emb.id)
        .bind(&emb.document_id)
        .bind(emb.chunk_index)
        .bind(&emb.chunk_text)
        .bind(&bytes)
        .bind(&emb.content_hash)
        .bind(&emb.provider)
        .bind(&emb.model)
        .bind(emb.dimension)
        .bind(emb.created_at)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Return chunk embeddings for a given provider+model, optionally filtered
    /// to a set of document_ids. Used by rag_search for top-k cosine.
    pub async fn get_chunk_embeddings(
        &self,
        document_ids: Option<&[String]>,
        provider: &str,
        model: &str,
    ) -> Result<Vec<DocumentChunkEmbedding>> {
        let rows = if let Some(ids) = document_ids {
            if ids.is_empty() {
                return Ok(Vec::new());
            }
            let placeholders: Vec<String> = (0..ids.len()).map(|i| format!("?{}", i + 3)).collect();
            let sql = format!(
                "SELECT id, document_id, chunk_index, chunk_text, embedding, content_hash, provider, model, dimension, created_at
                 FROM document_chunk_embeddings
                 WHERE provider = ?1 AND model = ?2 AND document_id IN ({})",
                placeholders.join(", ")
            );
            let mut q = sqlx::query(&sql).bind(provider).bind(model);
            for id in ids {
                q = q.bind(id);
            }
            q.fetch_all(&self.pool).await?
        } else {
            sqlx::query(
                "SELECT id, document_id, chunk_index, chunk_text, embedding, content_hash, provider, model, dimension, created_at
                 FROM document_chunk_embeddings
                 WHERE provider = ?1 AND model = ?2",
            )
            .bind(provider)
            .bind(model)
            .fetch_all(&self.pool)
            .await?
        };

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let dim: i32 = row.try_get("dimension")?;
            let bytes: Vec<u8> = row.try_get("embedding")?;
            out.push(DocumentChunkEmbedding {
                id: row.try_get("id")?,
                document_id: row.try_get("document_id")?,
                chunk_index: row.try_get("chunk_index")?,
                chunk_text: row.try_get("chunk_text")?,
                embedding: Self::bytes_to_embedding(&bytes, dim as usize),
                content_hash: row.try_get("content_hash")?,
                provider: row.try_get("provider")?,
                model: row.try_get("model")?,
                dimension: dim,
                created_at: row.try_get("created_at")?,
            });
        }
        Ok(out)
    }

    /// Compute the content hashes for a document's chunks that are already
    /// stored for this provider+model, so we can skip re-embedding unchanged
    /// chunks. Returns a set of stored hashes keyed by chunk_index.
    pub async fn get_stored_chunk_hashes(
        &self,
        document_id: &str,
        provider: &str,
        model: &str,
    ) -> Result<std::collections::HashMap<i32, String>> {
        let rows = sqlx::query(
            "SELECT chunk_index, content_hash FROM document_chunk_embeddings
             WHERE document_id = ?1 AND provider = ?2 AND model = ?3",
        )
        .bind(document_id)
        .bind(provider)
        .bind(model)
        .fetch_all(&self.pool)
        .await?;

        let mut map = std::collections::HashMap::with_capacity(rows.len());
        for row in rows {
            let idx: i32 = row.try_get("chunk_index")?;
            let hash: String = row.try_get("content_hash")?;
            map.insert(idx, hash);
        }
        Ok(map)
    }

    /// Delete all chunk embeddings for a document (e.g. when chunks shrink).
    pub async fn delete_document_chunk_embeddings(&self, document_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM document_chunk_embeddings WHERE document_id = ?1")
            .bind(document_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Delete chunk-embedding rows whose id matches `{document_id}:{chunk_index}`
    /// or `{document_id}:{chunk_index}:N` (split sub-chunks). Used to clear
    /// stale rows before re-inserting split pieces for a changed segment.
    pub async fn delete_chunk_embeddings_for_index(
        &self,
        document_id: &str,
        chunk_index: i32,
    ) -> Result<()> {
        // Match both "doc:idx" and "doc:idx:N" forms via a LIKE prefix.
        let prefix = format!("{}:{}%", document_id, chunk_index);
        sqlx::query("DELETE FROM document_chunk_embeddings WHERE id LIKE ?1")
            .bind(&prefix)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Count distinct documents that have at least one chunk embedding for the
    /// given provider+model.
    pub async fn count_indexed_documents(&self, provider: &str, model: &str) -> Result<i64> {
        let row: (i64,) = sqlx::query_as(
            "SELECT COUNT(DISTINCT document_id) FROM document_chunk_embeddings
             WHERE provider = ?1 AND model = ?2",
        )
        .bind(provider)
        .bind(model)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }

    /// Count total chunk embeddings for the given provider+model.
    pub async fn count_chunk_embeddings(&self, provider: &str, model: &str) -> Result<i64> {
        let row: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM document_chunk_embeddings WHERE provider = ?1 AND model = ?2",
        )
        .bind(provider)
        .bind(model)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }

    /// Get the count of unread articles for a specific RSS feed
    pub async fn get_rss_feed_unread_count(&self, feed_id: &str) -> Result<i32> {
        let row = sqlx::query(
            "SELECT COUNT(*) as count FROM rss_articles WHERE feed_id = ?1 AND is_read = 0",
        )
        .bind(feed_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(row.get("count"))
    }

    /// Get RSS user preferences for a specific feed or user
    pub async fn get_rss_user_preferences(
        &self,
        feed_id: Option<&str>,
        user_id: Option<&str>,
    ) -> Result<Option<crate::commands::rss::RssUserPreference>> {
        let row = match (feed_id, user_id) {
            (Some(fid), Some(uid)) => sqlx::query(
                "SELECT * FROM rss_user_preferences WHERE feed_id = ?1 AND user_id = ?2 LIMIT 1",
            )
            .bind(fid)
            .bind(uid)
            .fetch_optional(&self.pool)
            .await?,
            (Some(fid), None) => {
                sqlx::query("SELECT * FROM rss_user_preferences WHERE feed_id = ?1 LIMIT 1")
                    .bind(fid)
                    .fetch_optional(&self.pool)
                    .await?
            }
            (None, Some(uid)) => {
                sqlx::query("SELECT * FROM rss_user_preferences WHERE user_id = ?1 LIMIT 1")
                    .bind(uid)
                    .fetch_optional(&self.pool)
                    .await?
            }
            (None, None) => {
                sqlx::query("SELECT * FROM rss_user_preferences LIMIT 1")
                    .fetch_optional(&self.pool)
                    .await?
            }
        };

        Ok(row.map(|r| self.row_to_rss_user_preference(r)))
    }

    /// Set or update RSS user preferences
    pub async fn set_rss_user_preferences(
        &self,
        feed_id: Option<&str>,
        user_id: Option<&str>,
        prefs: crate::commands::rss::RssUserPreferenceUpdate,
    ) -> Result<crate::commands::rss::RssUserPreference> {
        let now = Utc::now().to_rfc3339();

        let existing = self.get_rss_user_preferences(feed_id, user_id).await?;

        let pref = if let Some(existing) = existing {
            let id = existing.id;
            sqlx::query(
                r#"
                UPDATE rss_user_preferences SET
                    keyword_include = COALESCE(?1, keyword_include),
                    keyword_exclude = COALESCE(?2, keyword_exclude),
                    author_whitelist = COALESCE(?3, author_whitelist),
                    author_blacklist = COALESCE(?4, author_blacklist),
                    category_filter = COALESCE(?5, category_filter),
                    view_mode = COALESCE(?6, view_mode),
                    theme_mode = COALESCE(?7, theme_mode),
                    density = COALESCE(?8, density),
                    column_count = COALESCE(?9, column_count),
                    show_thumbnails = COALESCE(?10, show_thumbnails),
                    excerpt_length = COALESCE(?11, excerpt_length),
                    show_author = COALESCE(?12, show_author),
                    show_date = COALESCE(?13, show_date),
                    show_feed_icon = COALESCE(?14, show_feed_icon),
                    sort_by = COALESCE(?15, sort_by),
                    sort_order = COALESCE(?16, sort_order),
                    date_modified = ?17
                WHERE id = ?18
                "#,
            )
            .bind(&prefs.keyword_include)
            .bind(&prefs.keyword_exclude)
            .bind(&prefs.author_whitelist)
            .bind(&prefs.author_blacklist)
            .bind(&prefs.category_filter)
            .bind(&prefs.view_mode)
            .bind(&prefs.theme_mode)
            .bind(&prefs.density)
            .bind(prefs.column_count)
            .bind(prefs.show_thumbnails)
            .bind(prefs.excerpt_length)
            .bind(prefs.show_author)
            .bind(prefs.show_date)
            .bind(prefs.show_feed_icon)
            .bind(&prefs.sort_by)
            .bind(&prefs.sort_order)
            .bind(&now)
            .bind(&id)
            .execute(&self.pool)
            .await?;

            self.get_rss_user_preferences_by_id(&id)
                .await?
                .ok_or_else(|| {
                    IncrementumError::Internal(
                        "failed to read back rss_user_preferences after update".into(),
                    )
                })?
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO rss_user_preferences (
                    id, user_id, feed_id,
                    keyword_include, keyword_exclude, author_whitelist, author_blacklist, category_filter,
                    view_mode, theme_mode, density, column_count,
                    show_thumbnails, excerpt_length, show_author, show_date, show_feed_icon,
                    sort_by, sort_order,
                    date_created, date_modified
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
                "#,
            )
            .bind(&id)
            .bind(user_id)
            .bind(feed_id)
            .bind(&prefs.keyword_include)
            .bind(&prefs.keyword_exclude)
            .bind(&prefs.author_whitelist)
            .bind(&prefs.author_blacklist)
            .bind(&prefs.category_filter)
            .bind(&prefs.view_mode)
            .bind(&prefs.theme_mode)
            .bind(&prefs.density)
            .bind(prefs.column_count)
            .bind(prefs.show_thumbnails)
            .bind(prefs.excerpt_length)
            .bind(prefs.show_author)
            .bind(prefs.show_date)
            .bind(prefs.show_feed_icon)
            .bind(&prefs.sort_by)
            .bind(&prefs.sort_order)
            .bind(&now)
            .bind(&now)
            .execute(&self.pool)
            .await?;

            self.get_rss_user_preferences_by_id(&id)
                .await?
                .ok_or_else(|| {
                    IncrementumError::Internal(
                        "failed to read back rss_user_preferences after insert".into(),
                    )
                })?
        };

        Ok(pref)
    }

    /// Get RSS user preferences by ID
    async fn get_rss_user_preferences_by_id(
        &self,
        id: &str,
    ) -> Result<Option<crate::commands::rss::RssUserPreference>> {
        let row = sqlx::query("SELECT * FROM rss_user_preferences WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        Ok(row.map(|r| self.row_to_rss_user_preference(r)))
    }

    /// Get all RSS user preferences for a user
    pub async fn get_all_rss_user_preferences(
        &self,
        user_id: &str,
    ) -> Result<Vec<crate::commands::rss::RssUserPreference>> {
        let rows = sqlx::query("SELECT * FROM rss_user_preferences WHERE user_id = ?1")
            .bind(user_id)
            .fetch_all(&self.pool)
            .await?;

        Ok(rows
            .into_iter()
            .map(|r| self.row_to_rss_user_preference(r))
            .collect())
    }

    /// Helper to convert database row to RssUserPreference
    fn row_to_rss_user_preference(
        &self,
        row: sqlx::sqlite::SqliteRow,
    ) -> crate::commands::rss::RssUserPreference {
        crate::commands::rss::RssUserPreference {
            id: row.get("id"),
            user_id: row.try_get("user_id").ok(),
            feed_id: row.try_get("feed_id").ok(),
            keyword_include: row.try_get("keyword_include").ok(),
            keyword_exclude: row.try_get("keyword_exclude").ok(),
            author_whitelist: row.try_get("author_whitelist").ok(),
            author_blacklist: row.try_get("author_blacklist").ok(),
            category_filter: row.try_get("category_filter").ok(),
            view_mode: row.try_get("view_mode").ok(),
            theme_mode: row.try_get("theme_mode").ok(),
            density: row.try_get("density").ok(),
            column_count: row.try_get("column_count").ok(),
            show_thumbnails: row.try_get("show_thumbnails").ok(),
            excerpt_length: row.try_get("excerpt_length").ok(),
            show_author: row.try_get("show_author").ok(),
            show_date: row.try_get("show_date").ok(),
            show_feed_icon: row.try_get("show_feed_icon").ok(),
            sort_by: row.try_get("sort_by").ok(),
            sort_order: row.try_get("sort_order").ok(),
            date_created: row.get("date_created"),
            date_modified: row.get("date_modified"),
        }
    }

    /// Create a video bookmark
    pub async fn create_video_bookmark(
        &self,
        id: &str,
        document_id: &str,
        title: &str,
        time: f64,
        thumbnail: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now();
        sqlx::query(
            r#"
            INSERT INTO video_bookmarks (id, document_id, title, time, thumbnail, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
        )
        .bind(id)
        .bind(document_id)
        .bind(title)
        .bind(time)
        .bind(thumbnail)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get all bookmarks for a video document
    pub async fn get_video_bookmarks(
        &self,
        document_id: &str,
    ) -> Result<Vec<crate::commands::video::VideoBookmark>> {
        let rows =
            sqlx::query("SELECT * FROM video_bookmarks WHERE document_id = ?1 ORDER BY time")
                .bind(document_id)
                .fetch_all(&self.pool)
                .await?;

        let bookmarks = rows
            .into_iter()
            .map(|row| crate::commands::video::VideoBookmark {
                id: row.get("id"),
                document_id: row.get("document_id"),
                title: row.get("title"),
                time: row.get("time"),
                thumbnail_url: row.try_get("thumbnail").ok(),
                created_at: row.get("created_at"),
            })
            .collect();

        Ok(bookmarks)
    }

    /// Delete a video bookmark
    pub async fn delete_video_bookmark(&self, bookmark_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM video_bookmarks WHERE id = ?1")
            .bind(bookmark_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Create a video chapter
    pub async fn create_video_chapter(
        &self,
        id: &str,
        document_id: &str,
        title: &str,
        start_time: f64,
        end_time: f64,
        order_index: i32,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO video_chapters (id, document_id, title, start_time, end_time, order_index)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
        )
        .bind(id)
        .bind(document_id)
        .bind(title)
        .bind(start_time)
        .bind(end_time)
        .bind(order_index)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get all chapters for a video document
    pub async fn get_video_chapters(
        &self,
        document_id: &str,
    ) -> Result<Vec<crate::commands::video::VideoChapter>> {
        let rows =
            sqlx::query("SELECT * FROM video_chapters WHERE document_id = ?1 ORDER BY order_index")
                .bind(document_id)
                .fetch_all(&self.pool)
                .await?;

        let chapters = rows
            .into_iter()
            .map(|row| crate::commands::video::VideoChapter {
                id: row.get("id"),
                document_id: row.get("document_id"),
                title: row.get("title"),
                start_time: row.get("start_time"),
                end_time: row.get("end_time"),
                order: row.get("order_index"),
            })
            .collect();

        Ok(chapters)
    }

    /// Set chapters for a video document (replaces all existing chapters)
    pub async fn set_video_chapters(
        &self,
        document_id: &str,
        chapters: &[crate::commands::video::VideoChapter],
    ) -> Result<()> {
        sqlx::query("DELETE FROM video_chapters WHERE document_id = ?1")
            .bind(document_id)
            .execute(&self.pool)
            .await?;

        // Insert new chapters
        for chapter in chapters {
            sqlx::query(
                r#"
                INSERT INTO video_chapters (id, document_id, title, start_time, end_time, order_index)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                "#,
            )
            .bind(&chapter.id)
            .bind(document_id)
            .bind(&chapter.title)
            .bind(chapter.start_time)
            .bind(chapter.end_time)
            .bind(chapter.order)
            .execute(&self.pool)
            .await?;
        }

        Ok(())
    }

    /// Set transcript for a video document
    pub async fn set_video_transcript(
        &self,
        document_id: &str,
        transcript: &str,
        segments_json: &str,
    ) -> Result<()> {
        let now = Utc::now();

        let existing = sqlx::query("SELECT id FROM video_transcripts WHERE document_id = ?1")
            .bind(document_id)
            .fetch_optional(&self.pool)
            .await?;

        if existing.is_some() {
            sqlx::query(
                r#"
                UPDATE video_transcripts
                SET transcript = ?1, segments_json = ?2, updated_at = ?3
                WHERE document_id = ?4
                "#,
            )
            .bind(transcript)
            .bind(segments_json)
            .bind(now)
            .bind(document_id)
            .execute(&self.pool)
            .await?;
        } else {
            // Insert new
            let id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO video_transcripts (id, document_id, transcript, segments_json, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                "#,
            )
            .bind(id)
            .bind(document_id)
            .bind(transcript)
            .bind(segments_json)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
            .await?;
        }

        Ok(())
    }

    /// Get transcript for a video document
    pub async fn get_video_transcript(
        &self,
        document_id: &str,
    ) -> Result<Option<(String, String)>> {
        let row = sqlx::query(
            "SELECT transcript, segments_json FROM video_transcripts WHERE document_id = ?1 LIMIT 1"
        )
        .bind(document_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|row| {
            let transcript: String = row.get("transcript");
            let segments_json: String = row.get("segments_json");
            (transcript, segments_json)
        }))
    }

    /// Create a new playlist subscription
    #[allow(clippy::too_many_arguments)]
    pub async fn create_playlist_subscription(
        &self,
        id: &str,
        playlist_id: &str,
        playlist_url: &str,
        title: Option<&str>,
        channel_name: Option<&str>,
        channel_id: Option<&str>,
        description: Option<&str>,
        thumbnail_url: Option<&str>,
        total_videos: Option<i32>,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            r#"
            INSERT INTO youtube_playlist_subscriptions (
                id, playlist_id, playlist_url, title, channel_name, channel_id,
                description, thumbnail_url, total_videos,
                is_active, auto_import_new, queue_intersperse_interval, priority_rating,
                last_refreshed_at, refresh_interval_hours, created_at, modified_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, 1, 5, 5, NULL, 24, ?10, ?10)
            "#,
        )
        .bind(id)
        .bind(playlist_id)
        .bind(playlist_url)
        .bind(title)
        .bind(channel_name)
        .bind(channel_id)
        .bind(description)
        .bind(thumbnail_url)
        .bind(total_videos)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get all playlist subscriptions
    pub async fn get_playlist_subscriptions(
        &self,
    ) -> Result<Vec<crate::models::PlaylistSubscription>> {
        let rows =
            sqlx::query("SELECT * FROM youtube_playlist_subscriptions ORDER BY created_at DESC")
                .fetch_all(&self.pool)
                .await?;

        Ok(rows
            .into_iter()
            .map(|row| crate::models::PlaylistSubscription {
                id: row.get("id"),
                playlist_id: row.get("playlist_id"),
                playlist_url: row.get("playlist_url"),
                title: row.get("title"),
                channel_name: row.get("channel_name"),
                channel_id: row.get("channel_id"),
                description: row.get("description"),
                thumbnail_url: row.get("thumbnail_url"),
                total_videos: row.get("total_videos"),
                is_active: row.get::<i32, _>("is_active") != 0,
                auto_import_new: row.get::<i32, _>("auto_import_new") != 0,
                queue_intersperse_interval: row.get("queue_intersperse_interval"),
                priority_rating: row.get("priority_rating"),
                last_refreshed_at: row.get("last_refreshed_at"),
                refresh_interval_hours: row.get("refresh_interval_hours"),
                created_at: row.get("created_at"),
                modified_at: row.get("modified_at"),
            })
            .collect())
    }

    /// Get a single playlist subscription by ID
    pub async fn get_playlist_subscription(
        &self,
        id: &str,
    ) -> Result<Option<crate::models::PlaylistSubscription>> {
        let row = sqlx::query("SELECT * FROM youtube_playlist_subscriptions WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        Ok(row.map(|row| crate::models::PlaylistSubscription {
            id: row.get("id"),
            playlist_id: row.get("playlist_id"),
            playlist_url: row.get("playlist_url"),
            title: row.get("title"),
            channel_name: row.get("channel_name"),
            channel_id: row.get("channel_id"),
            description: row.get("description"),
            thumbnail_url: row.get("thumbnail_url"),
            total_videos: row.get("total_videos"),
            is_active: row.get::<i32, _>("is_active") != 0,
            auto_import_new: row.get::<i32, _>("auto_import_new") != 0,
            queue_intersperse_interval: row.get("queue_intersperse_interval"),
            priority_rating: row.get("priority_rating"),
            last_refreshed_at: row.get("last_refreshed_at"),
            refresh_interval_hours: row.get("refresh_interval_hours"),
            created_at: row.get("created_at"),
            modified_at: row.get("modified_at"),
        }))
    }

    /// Get a playlist subscription by playlist_id
    pub async fn get_playlist_subscription_by_playlist_id(
        &self,
        playlist_id: &str,
    ) -> Result<Option<crate::models::PlaylistSubscription>> {
        let row =
            sqlx::query("SELECT * FROM youtube_playlist_subscriptions WHERE playlist_id = ?1")
                .bind(playlist_id)
                .fetch_optional(&self.pool)
                .await?;

        Ok(row.map(|row| crate::models::PlaylistSubscription {
            id: row.get("id"),
            playlist_id: row.get("playlist_id"),
            playlist_url: row.get("playlist_url"),
            title: row.get("title"),
            channel_name: row.get("channel_name"),
            channel_id: row.get("channel_id"),
            description: row.get("description"),
            thumbnail_url: row.get("thumbnail_url"),
            total_videos: row.get("total_videos"),
            is_active: row.get::<i32, _>("is_active") != 0,
            auto_import_new: row.get::<i32, _>("auto_import_new") != 0,
            queue_intersperse_interval: row.get("queue_intersperse_interval"),
            priority_rating: row.get("priority_rating"),
            last_refreshed_at: row.get("last_refreshed_at"),
            refresh_interval_hours: row.get("refresh_interval_hours"),
            created_at: row.get("created_at"),
            modified_at: row.get("modified_at"),
        }))
    }

    /// Update a playlist subscription
    #[allow(clippy::too_many_arguments)]
    pub async fn update_playlist_subscription(
        &self,
        id: &str,
        title: Option<&str>,
        is_active: Option<bool>,
        auto_import_new: Option<bool>,
        queue_intersperse_interval: Option<i32>,
        priority_rating: Option<i32>,
        refresh_interval_hours: Option<i32>,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            r#"
            UPDATE youtube_playlist_subscriptions SET
                title = COALESCE(?1, title),
                is_active = COALESCE(?2, is_active),
                auto_import_new = COALESCE(?3, auto_import_new),
                queue_intersperse_interval = COALESCE(?4, queue_intersperse_interval),
                priority_rating = COALESCE(?5, priority_rating),
                refresh_interval_hours = COALESCE(?6, refresh_interval_hours),
                modified_at = ?7
            WHERE id = ?8
            "#,
        )
        .bind(title)
        .bind(is_active.map(|v| if v { 1 } else { 0 }))
        .bind(auto_import_new.map(|v| if v { 1 } else { 0 }))
        .bind(queue_intersperse_interval)
        .bind(priority_rating)
        .bind(refresh_interval_hours)
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Delete a playlist subscription
    pub async fn delete_playlist_subscription(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM youtube_playlist_subscriptions WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Update last refreshed timestamp
    pub async fn update_playlist_last_refreshed(&self, id: &str) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            r#"
            UPDATE youtube_playlist_subscriptions SET
                last_refreshed_at = ?1,
                modified_at = ?1
            WHERE id = ?2
            "#,
        )
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Add a video to a playlist tracking
    #[allow(clippy::too_many_arguments)]
    pub async fn add_playlist_video(
        &self,
        id: &str,
        subscription_id: &str,
        video_id: &str,
        video_title: Option<&str>,
        video_duration: Option<i32>,
        thumbnail_url: Option<&str>,
        position: Option<i32>,
        published_at: Option<&str>,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            r#"
            INSERT OR IGNORE INTO youtube_playlist_videos (
                id, subscription_id, video_id, video_title, video_duration,
                thumbnail_url, position, is_imported, document_id, added_to_queue,
                queue_position, published_at, discovered_at, imported_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, NULL, 0, NULL, ?8, ?9, NULL)
            "#,
        )
        .bind(id)
        .bind(subscription_id)
        .bind(video_id)
        .bind(video_title)
        .bind(video_duration)
        .bind(thumbnail_url)
        .bind(position)
        .bind(published_at)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get videos for a subscription
    pub async fn get_playlist_videos(
        &self,
        subscription_id: &str,
        only_unimported: bool,
    ) -> Result<Vec<crate::models::PlaylistVideo>> {
        let query = if only_unimported {
            "SELECT * FROM youtube_playlist_videos WHERE subscription_id = ?1 AND is_imported = 0 ORDER BY position ASC"
        } else {
            "SELECT * FROM youtube_playlist_videos WHERE subscription_id = ?1 ORDER BY position ASC"
        };

        let rows = sqlx::query(query)
            .bind(subscription_id)
            .fetch_all(&self.pool)
            .await?;

        Ok(rows
            .into_iter()
            .map(|row| crate::models::PlaylistVideo {
                id: row.get("id"),
                subscription_id: row.get("subscription_id"),
                video_id: row.get("video_id"),
                video_title: row.get("video_title"),
                video_duration: row.get("video_duration"),
                thumbnail_url: row.get("thumbnail_url"),
                position: row.get("position"),
                is_imported: row.get::<i32, _>("is_imported") != 0,
                document_id: row.get("document_id"),
                added_to_queue: row.get::<i32, _>("added_to_queue") != 0,
                queue_position: row.get("queue_position"),
                published_at: row.get("published_at"),
                discovered_at: row.get("discovered_at"),
                imported_at: row.get("imported_at"),
            })
            .collect())
    }

    /// Get videos ready for queue interspersion (imported but not yet added to queue)
    pub async fn get_videos_for_queue_interspersion(
        &self,
    ) -> Result<Vec<crate::models::PlaylistVideo>> {
        let rows = sqlx::query(
            r#"
            SELECT pv.* FROM youtube_playlist_videos pv
            JOIN youtube_playlist_subscriptions ps ON pv.subscription_id = ps.id
            WHERE pv.is_imported = 1 
              AND pv.added_to_queue = 0
              AND ps.is_active = 1
            ORDER BY pv.discovered_at ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| crate::models::PlaylistVideo {
                id: row.get("id"),
                subscription_id: row.get("subscription_id"),
                video_id: row.get("video_id"),
                video_title: row.get("video_title"),
                video_duration: row.get("video_duration"),
                thumbnail_url: row.get("thumbnail_url"),
                position: row.get("position"),
                is_imported: row.get::<i32, _>("is_imported") != 0,
                document_id: row.get("document_id"),
                added_to_queue: row.get::<i32, _>("added_to_queue") != 0,
                queue_position: row.get("queue_position"),
                published_at: row.get("published_at"),
                discovered_at: row.get("discovered_at"),
                imported_at: row.get("imported_at"),
            })
            .collect())
    }

    /// Mark a video as imported
    pub async fn mark_video_imported(&self, video_id: &str, document_id: &str) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            r#"
            UPDATE youtube_playlist_videos SET
                is_imported = 1,
                document_id = ?1,
                imported_at = ?2
            WHERE id = ?3
            "#,
        )
        .bind(document_id)
        .bind(&now)
        .bind(video_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Mark a video as added to queue
    pub async fn mark_video_added_to_queue(
        &self,
        video_id: &str,
        queue_position: i32,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE youtube_playlist_videos SET
                added_to_queue = 1,
                queue_position = ?1
            WHERE id = ?2
            "#,
        )
        .bind(queue_position)
        .bind(video_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get global playlist settings
    pub async fn get_playlist_settings(&self) -> Result<crate::models::PlaylistSettings> {
        let row = sqlx::query("SELECT * FROM youtube_playlist_settings WHERE id = 'global'")
            .fetch_one(&self.pool)
            .await?;

        Ok(crate::models::PlaylistSettings {
            id: row.get("id"),
            enabled: row.get::<i32, _>("enabled") != 0,
            default_intersperse_interval: row.get("default_intersperse_interval"),
            default_priority: row.get("default_priority"),
            max_consecutive_playlist_videos: row.get("max_consecutive_playlist_videos"),
            prefer_new_videos: row.get::<i32, _>("prefer_new_videos") != 0,
            created_at: row.get("created_at"),
            modified_at: row.get("modified_at"),
        })
    }

    /// Update global playlist settings
    pub async fn update_playlist_settings(
        &self,
        enabled: Option<bool>,
        default_intersperse_interval: Option<i32>,
        default_priority: Option<i32>,
        max_consecutive_playlist_videos: Option<i32>,
        prefer_new_videos: Option<bool>,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            r#"
            UPDATE youtube_playlist_settings SET
                enabled = COALESCE(?1, enabled),
                default_intersperse_interval = COALESCE(?2, default_intersperse_interval),
                default_priority = COALESCE(?3, default_priority),
                max_consecutive_playlist_videos = COALESCE(?4, max_consecutive_playlist_videos),
                prefer_new_videos = COALESCE(?5, prefer_new_videos),
                modified_at = ?6
            WHERE id = 'global'
            "#,
        )
        .bind(enabled.map(|v| if v { 1 } else { 0 }))
        .bind(default_intersperse_interval)
        .bind(default_priority)
        .bind(max_consecutive_playlist_videos)
        .bind(prefer_new_videos.map(|v| if v { 1 } else { 0 }))
        .bind(&now)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Create a video extract
    pub async fn create_video_extract(
        &self,
        extract: &crate::models::VideoExtract,
    ) -> Result<crate::models::VideoExtract> {
        let tags_json = serde_json::to_string(&extract.tags)?;
        let memory_state_json = extract
            .memory_state
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        sqlx::query(
            r#"
            INSERT INTO video_extracts (
                id, document_id, start_time, end_time, title,
                transcript_text, notes, tags, thumbnail_url,
                memory_state, next_review_date, last_review_date,
                review_count, reps, date_created, date_modified
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
            "#,
        )
        .bind(&extract.id)
        .bind(&extract.document_id)
        .bind(extract.start_time)
        .bind(extract.end_time)
        .bind(&extract.title)
        .bind(&extract.transcript_text)
        .bind(&extract.notes)
        .bind(&tags_json)
        .bind(&extract.thumbnail_url)
        .bind(&memory_state_json)
        .bind(extract.next_review_date)
        .bind(extract.last_review_date)
        .bind(extract.review_count)
        .bind(extract.reps)
        .bind(extract.date_created)
        .bind(extract.date_modified)
        .execute(&self.pool)
        .await?;

        Ok(extract.clone())
    }

    /// Get a video extract by ID
    pub async fn get_video_extract(&self, id: &str) -> Result<Option<crate::models::VideoExtract>> {
        let row = sqlx::query("SELECT * FROM video_extracts WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(row) => {
                let tags_json: String = row.try_get("tags")?;
                let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

                let memory_state_json: Option<String> = row.try_get("memory_state").ok();
                let memory_state =
                    memory_state_json.and_then(|json| serde_json::from_str(&json).ok());

                Ok(Some(crate::models::VideoExtract {
                    id: row.try_get("id")?,
                    document_id: row.try_get("document_id")?,
                    collection_id: row
                        .try_get("collection_id")
                        .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                    start_time: row.try_get("start_time")?,
                    end_time: row.try_get("end_time")?,
                    title: row.try_get("title")?,
                    transcript_text: row.try_get("transcript_text").ok(),
                    notes: row.try_get("notes").ok(),
                    tags,
                    thumbnail_url: row.try_get("thumbnail_url").ok(),
                    memory_state,
                    next_review_date: row.try_get("next_review_date").ok(),
                    last_review_date: row.try_get("last_review_date").ok(),
                    review_count: row.try_get("review_count").unwrap_or(0),
                    reps: row.try_get("reps").unwrap_or(0),
                    date_created: row.try_get("date_created")?,
                    date_modified: row.try_get("date_modified")?,
                }))
            }
            None => Ok(None),
        }
    }

    /// Get all video extracts for a document
    pub async fn get_video_extracts_by_document(
        &self,
        document_id: &str,
    ) -> Result<Vec<crate::models::VideoExtract>> {
        let rows =
            sqlx::query("SELECT * FROM video_extracts WHERE document_id = ? ORDER BY start_time")
                .bind(document_id)
                .fetch_all(&self.pool)
                .await?;

        let mut extracts = Vec::new();
        for row in rows {
            let tags_json: String = row.try_get("tags")?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            let memory_state_json: Option<String> = row.try_get("memory_state").ok();
            let memory_state = memory_state_json.and_then(|json| serde_json::from_str(&json).ok());

            extracts.push(crate::models::VideoExtract {
                id: row.try_get("id")?,
                document_id: row.try_get("document_id")?,
                collection_id: row
                    .try_get("collection_id")
                    .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                start_time: row.try_get("start_time")?,
                end_time: row.try_get("end_time")?,
                title: row.try_get("title")?,
                transcript_text: row.try_get("transcript_text").ok(),
                notes: row.try_get("notes").ok(),
                tags,
                thumbnail_url: row.try_get("thumbnail_url").ok(),
                memory_state,
                next_review_date: row.try_get("next_review_date").ok(),
                last_review_date: row.try_get("last_review_date").ok(),
                review_count: row.try_get("review_count").unwrap_or(0),
                reps: row.try_get("reps").unwrap_or(0),
                date_created: row.try_get("date_created")?,
                date_modified: row.try_get("date_modified")?,
            });
        }

        Ok(extracts)
    }

    /// Get due video extracts (for review queue)
    pub async fn get_due_video_extracts(
        &self,
        before: &chrono::DateTime<chrono::Utc>,
    ) -> Result<Vec<crate::models::VideoExtract>> {
        let rows = sqlx::query("SELECT * FROM video_extracts WHERE next_review_date IS NOT NULL AND next_review_date <= ? ORDER BY next_review_date")
            .bind(before)
            .fetch_all(&self.pool)
            .await?;

        let mut extracts = Vec::new();
        for row in rows {
            let tags_json: String = row.try_get("tags")?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            let memory_state_json: Option<String> = row.try_get("memory_state").ok();
            let memory_state = memory_state_json.and_then(|json| serde_json::from_str(&json).ok());

            extracts.push(crate::models::VideoExtract {
                id: row.try_get("id")?,
                document_id: row.try_get("document_id")?,
                collection_id: row
                    .try_get("collection_id")
                    .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                start_time: row.try_get("start_time")?,
                end_time: row.try_get("end_time")?,
                title: row.try_get("title")?,
                transcript_text: row.try_get("transcript_text").ok(),
                notes: row.try_get("notes").ok(),
                tags,
                thumbnail_url: row.try_get("thumbnail_url").ok(),
                memory_state,
                next_review_date: row.try_get("next_review_date").ok(),
                last_review_date: row.try_get("last_review_date").ok(),
                review_count: row.try_get("review_count").unwrap_or(0),
                reps: row.try_get("reps").unwrap_or(0),
                date_created: row.try_get("date_created")?,
                date_modified: row.try_get("date_modified")?,
            });
        }

        Ok(extracts)
    }

    /// Get new video extracts (no reviews yet) — server-side filtered
    pub async fn get_new_video_extracts(&self) -> Result<Vec<crate::models::VideoExtract>> {
        let rows = sqlx::query(
            "SELECT * FROM video_extracts WHERE review_count = 0 AND next_review_date IS NULL ORDER BY date_created DESC"
        )
        .fetch_all(&self.pool)
        .await?;

        let mut extracts = Vec::new();
        for row in rows {
            let tags_json: String = row.try_get("tags")?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            let memory_state_json: Option<String> = row.try_get("memory_state").ok();
            let memory_state = memory_state_json.and_then(|json| serde_json::from_str(&json).ok());

            extracts.push(crate::models::VideoExtract {
                id: row.try_get("id")?,
                document_id: row.try_get("document_id")?,
                collection_id: row
                    .try_get("collection_id")
                    .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                start_time: row.try_get("start_time")?,
                end_time: row.try_get("end_time")?,
                title: row.try_get("title")?,
                transcript_text: row.try_get("transcript_text").ok(),
                notes: row.try_get("notes").ok(),
                tags,
                thumbnail_url: row.try_get("thumbnail_url").ok(),
                memory_state,
                next_review_date: row.try_get("next_review_date").ok(),
                last_review_date: row.try_get("last_review_date").ok(),
                review_count: row.try_get("review_count").unwrap_or(0),
                reps: row.try_get("reps").unwrap_or(0),
                date_created: row.try_get("date_created")?,
                date_modified: row.try_get("date_modified")?,
            });
        }

        Ok(extracts)
    }

    /// Batch fetch documents by IDs
    pub async fn get_documents_by_ids(&self, ids: &[String]) -> Result<HashMap<String, Document>> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let placeholders: Vec<String> = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let query_str = format!(
            "SELECT * FROM documents WHERE id IN ({})",
            placeholders.join(", ")
        );
        let mut query = sqlx::query(&query_str);
        for id in ids {
            query = query.bind(id);
        }
        let rows = query.fetch_all(&self.pool).await?;

        let mut map = HashMap::new();
        for row in rows {
            let file_type: String = row.get("file_type");
            let tags_json: String = row.get("tags");
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            let metadata_json: Option<String> = row.try_get("metadata")?;
            let metadata: Option<DocumentMetadata> =
                metadata_json.and_then(|json| serde_json::from_str(&json).ok());

            let doc = Document {
                id: row.get("id"),
                collection_id: row
                    .try_get("collection_id")
                    .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                title: row.get("title"),
                file_path: row.get("file_path"),
                file_type: Self::parse_file_type(&file_type),
                content: Self::decode_optional_text(&row, "content"),
                content_hash: row.get("content_hash"),
                total_pages: row.get("total_pages"),
                current_page: row.get("current_page"),
                current_scroll_percent: row.try_get("current_scroll_percent").ok(),
                current_cfi: row.try_get("current_cfi").ok(),
                current_view_state: row.try_get("current_view_state").ok(),
                position_json: row.try_get("position_json").ok(),
                progress_percent: row.try_get("progress_percent").ok(),
                category: row.get("category"),
                tags,
                date_added: row.get("date_added"),
                date_modified: row.get("date_modified"),
                date_last_reviewed: row.get("date_last_reviewed"),
                extract_count: row.get("extract_count"),
                learning_item_count: row.get("learning_item_count"),
                priority_rating: row.get("priority_rating"),
                priority_slider: row.get("priority_slider"),
                priority_score: row.get("priority_score"),
                is_archived: row.get("is_archived"),
                is_favorite: row.get("is_favorite"),
                is_dismissed: row.try_get("is_dismissed").unwrap_or(false),
                metadata,
                cover_image_url: row.try_get("cover_image_url").ok(),
                cover_image_source: row.try_get("cover_image_source").ok(),
                next_reading_date: row.try_get("next_reading_date").ok(),
                reading_count: row.try_get("reading_count").unwrap_or(0),
                stability: row.try_get("stability").ok(),
                difficulty: row.try_get("difficulty").ok(),
                reps: row.try_get("reps").ok(),
                total_time_spent: row.try_get("total_time_spent").ok(),
                consecutive_count: row.try_get("consecutive_count").ok(),
            };
            map.insert(doc.id.clone(), doc);
        }
        Ok(map)
    }

    /// Batch fetch playlist subscriptions by IDs
    pub async fn get_playlist_subscriptions_by_ids(
        &self,
        ids: &[String],
    ) -> Result<HashMap<String, crate::models::PlaylistSubscription>> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        let placeholders: Vec<String> = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let query_str = format!(
            "SELECT * FROM youtube_playlist_subscriptions WHERE id IN ({})",
            placeholders.join(", ")
        );
        let mut query = sqlx::query(&query_str);
        for id in ids {
            query = query.bind(id);
        }
        let rows = query.fetch_all(&self.pool).await?;

        let mut map = HashMap::new();
        for row in rows {
            let sub = crate::models::PlaylistSubscription {
                id: row.get("id"),
                playlist_id: row.get("playlist_id"),
                playlist_url: row.get("playlist_url"),
                title: row.get("title"),
                channel_name: row.get("channel_name"),
                channel_id: row.get("channel_id"),
                description: row.get("description"),
                thumbnail_url: row.get("thumbnail_url"),
                total_videos: row.get("total_videos"),
                is_active: row.get::<i32, _>("is_active") != 0,
                auto_import_new: row.get::<i32, _>("auto_import_new") != 0,
                queue_intersperse_interval: row.get("queue_intersperse_interval"),
                priority_rating: row.get("priority_rating"),
                last_refreshed_at: row.get("last_refreshed_at"),
                refresh_interval_hours: row.get("refresh_interval_hours"),
                created_at: row.get("created_at"),
                modified_at: row.get("modified_at"),
            };
            map.insert(sub.id.clone(), sub);
        }
        Ok(map)
    }

    /// Get workload forecast using GROUP BY aggregation (replaces per-day loop)
    pub async fn get_workload_forecast_grouped(
        &self,
        start_date: chrono::NaiveDate,
        horizon_days: i32,
    ) -> Result<(Vec<(String, i64)>, Vec<(String, i64)>)> {
        let end_date = start_date + chrono::Duration::days(horizon_days as i64 - 1);
        let day_start = start_date
            .and_hms_opt(0, 0, 0)
            .expect("invalid time 0:0:0")
            .and_utc();
        let day_end = end_date
            .and_hms_opt(23, 59, 59)
            .expect("invalid time 23:59:59")
            .and_utc();

        let learning_rows: Vec<(String, i64)> = sqlx::query_as(
            "SELECT DATE(due_date) as day, COUNT(*) as count FROM learning_items WHERE due_date >= ?1 AND due_date <= ?2 AND is_suspended = false GROUP BY DATE(due_date)"
        )
        .bind(day_start)
        .bind(day_end)
        .fetch_all(&self.pool)
        .await
        .map_err(IncrementumError::Database)?;

        let doc_rows: Vec<(String, i64)> = sqlx::query_as(
            "SELECT DATE(next_reading_date) as day, COUNT(*) as count FROM documents WHERE next_reading_date >= ?1 AND next_reading_date <= ?2 AND is_archived = false GROUP BY DATE(next_reading_date)"
        )
        .bind(day_start)
        .bind(day_end)
        .fetch_all(&self.pool)
        .await
        .map_err(IncrementumError::Database)?;

        Ok((learning_rows, doc_rows))
    }

    /// Get all video extracts
    pub async fn get_all_video_extracts(&self) -> Result<Vec<crate::models::VideoExtract>> {
        let rows = sqlx::query("SELECT * FROM video_extracts ORDER BY date_created DESC")
            .fetch_all(&self.pool)
            .await?;

        let mut extracts = Vec::new();
        for row in rows {
            let tags_json: String = row.try_get("tags")?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

            let memory_state_json: Option<String> = row.try_get("memory_state").ok();
            let memory_state = memory_state_json.and_then(|json| serde_json::from_str(&json).ok());

            extracts.push(crate::models::VideoExtract {
                id: row.try_get("id")?,
                document_id: row.try_get("document_id")?,
                collection_id: row
                    .try_get("collection_id")
                    .unwrap_or_else(|_| DEFAULT_COLLECTION_ID.to_string()),
                start_time: row.try_get("start_time")?,
                end_time: row.try_get("end_time")?,
                title: row.try_get("title")?,
                transcript_text: row.try_get("transcript_text").ok(),
                notes: row.try_get("notes").ok(),
                tags,
                thumbnail_url: row.try_get("thumbnail_url").ok(),
                memory_state,
                next_review_date: row.try_get("next_review_date").ok(),
                last_review_date: row.try_get("last_review_date").ok(),
                review_count: row.try_get("review_count").unwrap_or(0),
                reps: row.try_get("reps").unwrap_or(0),
                date_created: row.try_get("date_created")?,
                date_modified: row.try_get("date_modified")?,
            });
        }

        Ok(extracts)
    }

    /// Update a video extract
    pub async fn update_video_extract(
        &self,
        extract: &crate::models::VideoExtract,
    ) -> Result<crate::models::VideoExtract> {
        let tags_json = serde_json::to_string(&extract.tags)?;
        let memory_state_json = extract
            .memory_state
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        sqlx::query(
            r#"
            UPDATE video_extracts SET
                title = ?1,
                transcript_text = ?2,
                notes = ?3,
                tags = ?4,
                thumbnail_url = ?5,
                memory_state = ?6,
                next_review_date = ?7,
                last_review_date = ?8,
                review_count = ?9,
                reps = ?10,
                date_modified = ?11
            WHERE id = ?12
            "#,
        )
        .bind(&extract.title)
        .bind(&extract.transcript_text)
        .bind(&extract.notes)
        .bind(&tags_json)
        .bind(&extract.thumbnail_url)
        .bind(&memory_state_json)
        .bind(extract.next_review_date)
        .bind(extract.last_review_date)
        .bind(extract.review_count)
        .bind(extract.reps)
        .bind(extract.date_modified)
        .bind(&extract.id)
        .execute(&self.pool)
        .await?;

        Ok(extract.clone())
    }

    /// Update video extract scheduling (FSRS)
    pub async fn update_video_extract_scheduling(
        &self,
        id: &str,
        next_review_date: Option<chrono::DateTime<Utc>>,
        memory_state: Option<crate::models::MemoryState>,
        review_count: Option<i32>,
        reps: Option<i32>,
        last_review_date: Option<chrono::DateTime<Utc>>,
    ) -> Result<()> {
        let memory_state_json = memory_state
            .map(|value| serde_json::to_string(&value))
            .transpose()?;
        let now = Utc::now();

        sqlx::query(
            r#"
            UPDATE video_extracts SET
                next_review_date = ?1,
                memory_state = ?2,
                review_count = ?3,
                reps = ?4,
                last_review_date = ?5,
                date_modified = ?6
            WHERE id = ?7
            "#,
        )
        .bind(next_review_date)
        .bind(&memory_state_json)
        .bind(review_count)
        .bind(reps)
        .bind(last_review_date)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Delete a video extract
    pub async fn delete_video_extract(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM video_extracts WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Populate transcript text for a video extract from transcript segments
    pub async fn populate_video_extract_transcript(
        &self,
        extract: &mut crate::models::VideoExtract,
    ) -> Result<()> {
        if extract.transcript_text.is_some() {
            return Ok(());
        }

        if let Some((_, segments_json)) = self.get_video_transcript(&extract.document_id).await? {
            let segments: Vec<crate::youtube::TranscriptSegment> =
                serde_json::from_str(&segments_json).map_err(|e| {
                    crate::error::IncrementumError::Internal(format!(
                        "Failed to parse transcript segments: {}",
                        e
                    ))
                })?;

            // Filter segments within the extract's time range and concatenate
            let transcript_text: String = segments
                .iter()
                .filter(|seg| {
                    seg.start >= extract.start_time
                        && (seg.start + seg.duration) <= extract.end_time
                })
                .map(|seg| seg.text.trim())
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join(" ");

            if !transcript_text.is_empty() {
                extract.transcript_text = Some(transcript_text);
            }
        }

        Ok(())
    }

    fn parse_job_status(s: &str) -> TranscriptionJobStatus {
        match s {
            "pending" => TranscriptionJobStatus::Pending,
            "processing" => TranscriptionJobStatus::Processing,
            "completed" => TranscriptionJobStatus::Completed,
            "failed" => TranscriptionJobStatus::Failed,
            "cancelled" => TranscriptionJobStatus::Cancelled,
            _ => TranscriptionJobStatus::Pending,
        }
    }

    pub async fn enqueue_transcription(&self, entry: &TranscriptionQueueEntry) -> Result<()> {
        let status_str = match entry.status {
            TranscriptionJobStatus::Pending => "pending",
            TranscriptionJobStatus::Processing => "processing",
            TranscriptionJobStatus::Completed => "completed",
            TranscriptionJobStatus::Failed => "failed",
            TranscriptionJobStatus::Cancelled => "cancelled",
        };
        sqlx::query(
            "INSERT INTO transcription_queue (id, document_id, audio_path, provider, model_id, language, status, error_message, priority, created_at, started_at, completed_at, retry_count, progress) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)"
        )
        .bind(&entry.id)
        .bind(&entry.document_id)
        .bind(&entry.audio_path)
        .bind(&entry.provider)
        .bind(&entry.model_id)
        .bind(&entry.language)
        .bind(status_str)
        .bind(&entry.error_message)
        .bind(entry.priority)
        .bind(entry.created_at.to_rfc3339())
        .bind(entry.started_at.map(|t| t.to_rfc3339()))
        .bind(entry.completed_at.map(|t| t.to_rfc3339()))
        .bind(entry.retry_count)
        .bind(entry.progress)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn dequeue_next_transcription(&self) -> Result<Option<TranscriptionQueueEntry>> {
        let row = sqlx::query_as::<_, (String, String, String, String, String, String, String, Option<String>, i32, String, Option<String>, Option<String>, i32, i32)>(
            "SELECT id, document_id, audio_path, provider, model_id, language, status, error_message, priority, created_at, started_at, completed_at, retry_count, progress FROM transcription_queue WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 1"
        )
        .fetch_optional(self.pool())
        .await?;

        match row {
            Some((
                id,
                document_id,
                audio_path,
                provider,
                model_id,
                language,
                status_str,
                error_message,
                priority,
                created_at,
                started_at,
                completed_at,
                retry_count,
                progress,
            )) => Ok(Some(TranscriptionQueueEntry {
                id,
                document_id,
                audio_path,
                provider,
                model_id,
                language,
                status: Self::parse_job_status(&status_str),
                error_message,
                priority,
                created_at: created_at.parse().unwrap_or(Utc::now()),
                started_at: started_at.and_then(|t| t.parse().ok()),
                completed_at: completed_at.and_then(|t| t.parse().ok()),
                retry_count,
                progress,
            })),
            None => Ok(None),
        }
    }

    pub async fn update_transcription_status(
        &self,
        id: &str,
        status: TranscriptionJobStatus,
        error_message: Option<&str>,
        progress: Option<i32>,
    ) -> Result<()> {
        let status_str = match status {
            TranscriptionJobStatus::Pending => "pending",
            TranscriptionJobStatus::Processing => "processing",
            TranscriptionJobStatus::Completed => "completed",
            TranscriptionJobStatus::Failed => "failed",
            TranscriptionJobStatus::Cancelled => "cancelled",
        };
        let now = Utc::now().to_rfc3339();

        match status {
            TranscriptionJobStatus::Processing => {
                sqlx::query("UPDATE transcription_queue SET status = ?1, started_at = ?2, progress = ?3 WHERE id = ?4")
                    .bind(status_str)
                    .bind(&now)
                    .bind(progress.unwrap_or(0))
                    .bind(id)
                    .execute(self.pool())
                    .await?;
            }
            TranscriptionJobStatus::Completed => {
                sqlx::query("UPDATE transcription_queue SET status = ?1, completed_at = ?2, progress = ?3 WHERE id = ?4")
                    .bind(status_str)
                    .bind(&now)
                    .bind(progress.unwrap_or(100))
                    .bind(id)
                    .execute(self.pool())
                    .await?;
            }
            TranscriptionJobStatus::Failed => {
                sqlx::query("UPDATE transcription_queue SET status = ?1, error_message = ?2, retry_count = retry_count + 1 WHERE id = ?3")
                    .bind(status_str)
                    .bind(error_message)
                    .bind(id)
                    .execute(self.pool())
                    .await?;
            }
            _ => {
                sqlx::query("UPDATE transcription_queue SET status = ?1 WHERE id = ?2")
                    .bind(status_str)
                    .bind(id)
                    .execute(self.pool())
                    .await?;
            }
        }
        Ok(())
    }

    pub async fn reset_transcription_to_pending(&self, id: &str, retry_count: i32) -> Result<()> {
        sqlx::query("UPDATE transcription_queue SET status = 'pending', retry_count = ?1, error_message = NULL, started_at = NULL, progress = 0 WHERE id = ?2")
            .bind(retry_count)
            .bind(id)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    pub async fn get_transcription_queue_entry(
        &self,
        document_id: &str,
    ) -> Result<Option<TranscriptionQueueEntry>> {
        let row = sqlx::query_as::<_, (String, String, String, String, String, String, String, Option<String>, i32, String, Option<String>, Option<String>, i32, i32)>(
            "SELECT id, document_id, audio_path, provider, model_id, language, status, error_message, priority, created_at, started_at, completed_at, retry_count, progress FROM transcription_queue WHERE document_id = ?1 ORDER BY created_at DESC LIMIT 1"
        )
        .bind(document_id)
        .fetch_optional(self.pool())
        .await?;

        match row {
            Some((
                id,
                document_id,
                audio_path,
                provider,
                model_id,
                language,
                status_str,
                error_message,
                priority,
                created_at,
                started_at,
                completed_at,
                retry_count,
                progress,
            )) => Ok(Some(TranscriptionQueueEntry {
                id,
                document_id,
                audio_path,
                provider,
                model_id,
                language,
                status: Self::parse_job_status(&status_str),
                error_message,
                priority,
                created_at: created_at.parse().unwrap_or(Utc::now()),
                started_at: started_at.and_then(|t| t.parse().ok()),
                completed_at: completed_at.and_then(|t| t.parse().ok()),
                retry_count,
                progress,
            })),
            None => Ok(None),
        }
    }

    pub async fn get_transcription_queue_by_status(
        &self,
        status: TranscriptionJobStatus,
    ) -> Result<Vec<TranscriptionQueueEntry>> {
        let status_str = match status {
            TranscriptionJobStatus::Pending => "pending",
            TranscriptionJobStatus::Processing => "processing",
            TranscriptionJobStatus::Completed => "completed",
            TranscriptionJobStatus::Failed => "failed",
            TranscriptionJobStatus::Cancelled => "cancelled",
        };
        let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String, Option<String>, i32, String, Option<String>, Option<String>, i32, i32)>(
            "SELECT id, document_id, audio_path, provider, model_id, language, status, error_message, priority, created_at, started_at, completed_at, retry_count, progress FROM transcription_queue WHERE status = ?1 ORDER BY priority DESC, created_at ASC"
        )
        .bind(status_str)
        .fetch_all(self.pool())
        .await?;

        Ok(rows
            .into_iter()
            .map(
                |(
                    id,
                    document_id,
                    audio_path,
                    provider,
                    model_id,
                    language,
                    status_str,
                    error_message,
                    priority,
                    created_at,
                    started_at,
                    completed_at,
                    retry_count,
                    progress,
                )| {
                    TranscriptionQueueEntry {
                        id,
                        document_id,
                        audio_path,
                        provider,
                        model_id,
                        language,
                        status: Self::parse_job_status(&status_str),
                        error_message,
                        priority,
                        created_at: created_at.parse().unwrap_or(Utc::now()),
                        started_at: started_at.and_then(|t| t.parse().ok()),
                        completed_at: completed_at.and_then(|t| t.parse().ok()),
                        retry_count,
                        progress,
                    }
                },
            )
            .collect())
    }

    pub async fn get_full_transcription_queue(
        &self,
    ) -> Result<Vec<TranscriptionQueueEntryWithDoc>> {
        let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String, Option<String>, i32, String, Option<String>, Option<String>, i32, i32, String)>(
            "SELECT tq.id, tq.document_id, tq.audio_path, tq.provider, tq.model_id, tq.language, tq.status, tq.error_message, tq.priority, tq.created_at, tq.started_at, tq.completed_at, tq.retry_count, tq.progress, COALESCE(d.title, 'Unknown') FROM transcription_queue tq LEFT JOIN documents d ON tq.document_id = d.id ORDER BY tq.priority DESC, tq.created_at ASC"
        )
        .fetch_all(self.pool())
        .await?;

        Ok(rows
            .into_iter()
            .map(
                |(
                    id,
                    document_id,
                    audio_path,
                    provider,
                    model_id,
                    language,
                    status_str,
                    error_message,
                    priority,
                    created_at,
                    started_at,
                    completed_at,
                    retry_count,
                    progress,
                    document_title,
                )| {
                    TranscriptionQueueEntryWithDoc {
                        entry: TranscriptionQueueEntry {
                            id,
                            document_id,
                            audio_path,
                            provider,
                            model_id,
                            language,
                            status: Self::parse_job_status(&status_str),
                            error_message,
                            priority,
                            created_at: created_at.parse().unwrap_or(Utc::now()),
                            started_at: started_at.and_then(|t| t.parse().ok()),
                            completed_at: completed_at.and_then(|t| t.parse().ok()),
                            retry_count,
                            progress,
                        },
                        document_title,
                    }
                },
            )
            .collect())
    }

    pub async fn cancel_transcription_job(&self, id: &str) -> Result<()> {
        sqlx::query("UPDATE transcription_queue SET status = 'cancelled' WHERE id = ?1")
            .bind(id)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    pub async fn get_untranscribed_media_documents(&self) -> Result<Vec<(String, String, String)>> {
        let rows = sqlx::query_as::<_, (String, String, String)>(
            "SELECT d.id, d.title, d.file_path FROM documents d WHERE d.file_type IN ('audio', 'video') AND (d.content IS NULL OR d.content = '') AND d.id NOT IN (SELECT document_id FROM transcription_queue WHERE status IN ('pending', 'processing', 'completed'))"
        )
        .fetch_all(self.pool())
        .await?;
        Ok(rows)
    }

    pub async fn reset_processing_transcriptions(&self) -> Result<()> {
        sqlx::query("UPDATE transcription_queue SET status = 'pending', started_at = NULL WHERE status = 'processing'")
            .execute(self.pool())
            .await?;
        Ok(())
    }

    pub async fn update_transcription_progress(&self, id: &str, progress: i32) -> Result<()> {
        sqlx::query("UPDATE transcription_queue SET progress = ?1 WHERE id = ?2")
            .bind(progress)
            .bind(id)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    pub async fn delete_transcription_queue_by_status(&self, statuses: &[String]) -> Result<u64> {
        if statuses.is_empty() {
            return Ok(0);
        }
        let placeholders: Vec<String> = statuses
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let query = format!(
            "DELETE FROM transcription_queue WHERE status IN ({})",
            placeholders.join(",")
        );
        let mut q = sqlx::query(&query);
        for status in statuses {
            q = q.bind(status);
        }
        let result = q.execute(self.pool()).await?;
        Ok(result.rows_affected())
    }

    pub async fn delete_transcription_queue_entry(&self, id: &str) -> Result<bool> {
        let result = sqlx::query("DELETE FROM transcription_queue WHERE id = ?1")
            .bind(id)
            .execute(self.pool())
            .await?;
        Ok(result.rows_affected() > 0)
    }

    // ── Podcast feed operations ──────────────────────────────────────────────

    pub async fn insert_podcast_feed(
        &self,
        feed: &crate::models::podcast::PodcastFeed,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO podcast_feeds (
                id, title, description, image_url, author, language,
                link, feed_url, last_fetched, subscribed_at, sort_order,
                auto_transcribe, transcribe_language
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            "#,
        )
        .bind(&feed.id)
        .bind(&feed.title)
        .bind(&feed.description)
        .bind(&feed.image_url)
        .bind(&feed.author)
        .bind(&feed.language)
        .bind(&feed.link)
        .bind(&feed.feed_url)
        .bind(&feed.last_fetched)
        .bind(&feed.subscribed_at)
        .bind(feed.sort_order)
        .bind(feed.auto_transcribe as i32)
        .bind(&feed.transcribe_language)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn get_podcast_feed(
        &self,
        id: &str,
    ) -> Result<Option<crate::models::podcast::PodcastFeed>> {
        let row = sqlx::query("SELECT * FROM podcast_feeds WHERE id = ?")
            .bind(id)
            .fetch_optional(self.pool())
            .await?;

        match row {
            Some(row) => Ok(Some(map_row_to_podcast_feed(&row))),
            None => Ok(None),
        }
    }

    pub async fn get_podcast_feed_by_url(
        &self,
        feed_url: &str,
    ) -> Result<Option<crate::models::podcast::PodcastFeed>> {
        let row = sqlx::query("SELECT * FROM podcast_feeds WHERE feed_url = ?")
            .bind(feed_url)
            .fetch_optional(self.pool())
            .await?;

        match row {
            Some(row) => Ok(Some(map_row_to_podcast_feed(&row))),
            None => Ok(None),
        }
    }

    pub async fn get_podcast_feeds(&self) -> Result<Vec<crate::models::podcast::PodcastFeed>> {
        let rows = sqlx::query("SELECT * FROM podcast_feeds ORDER BY sort_order, subscribed_at")
            .fetch_all(self.pool())
            .await?;

        Ok(rows.iter().map(map_row_to_podcast_feed).collect())
    }

    pub async fn rename_podcast_feed(&self, id: &str, new_title: &str) -> Result<()> {
        sqlx::query("UPDATE podcast_feeds SET title = ?1 WHERE id = ?2")
            .bind(new_title)
            .bind(id)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    pub async fn delete_podcast_feed(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM podcast_feeds WHERE id = ?")
            .bind(id)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    pub async fn update_podcast_feed_last_fetched(
        &self,
        id: &str,
        last_fetched: &str,
    ) -> Result<()> {
        sqlx::query("UPDATE podcast_feeds SET last_fetched = ?1 WHERE id = ?2")
            .bind(last_fetched)
            .bind(id)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    pub async fn update_podcast_feed_metadata(
        &self,
        feed: &crate::models::podcast::PodcastFeed,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE podcast_feeds SET
                title = ?1, description = ?2, image_url = ?3,
                author = ?4, link = ?5
            WHERE id = ?6
            "#,
        )
        .bind(&feed.title)
        .bind(&feed.description)
        .bind(&feed.image_url)
        .bind(&feed.author)
        .bind(&feed.link)
        .bind(&feed.id)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn count_podcast_episodes(&self, feed_id: &str) -> Result<i64> {
        let result: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM podcast_episodes WHERE feed_id = ?")
                .bind(feed_id)
                .fetch_one(self.pool())
                .await?;
        Ok(result.0)
    }

    pub async fn count_unplayed_podcast_episodes(&self, feed_id: &str) -> Result<i64> {
        let result: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM podcast_episodes WHERE feed_id = ? AND played = 0",
        )
        .bind(feed_id)
        .fetch_one(self.pool())
        .await?;
        Ok(result.0)
    }

    pub async fn insert_podcast_episode(
        &self,
        feed_id: &str,
        episode: &crate::models::podcast::ParsedPodcastEpisode,
    ) -> Result<()> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            r#"
            INSERT OR IGNORE INTO podcast_episodes (
                id, feed_id, guid, title, description, published_date,
                duration, audio_url, audio_type, file_size, image_url,
                link, played, playback_position, date_added
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, 0.0, ?13)
            "#,
        )
        .bind(&id)
        .bind(feed_id)
        .bind(&episode.guid)
        .bind(&episode.title)
        .bind(&episode.description)
        .bind(&episode.published_date)
        .bind(episode.duration)
        .bind(&episode.audio_url)
        .bind(&episode.audio_type)
        .bind(episode.file_size)
        .bind(&episode.image_url)
        .bind(&episode.link)
        .bind(&now)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    /// Bulk insert podcast episodes, deduplicating by (feed_id, guid).
    /// Uses INSERT OR IGNORE so existing episodes (with their played/position state) are preserved.
    pub async fn insert_podcast_episodes_bulk(
        &self,
        feed_id: &str,
        episodes: &[crate::models::podcast::ParsedPodcastEpisode],
    ) -> Result<()> {
        if episodes.is_empty() {
            return Ok(());
        }

        let mut tx = self.pool().begin().await.map_err(|e| {
            IncrementumError::Internal(format!("Failed to begin transaction: {}", e))
        })?;

        for episode in episodes {
            let id = uuid::Uuid::new_v4().to_string();
            let now = Utc::now().to_rfc3339();

            sqlx::query(
                r#"
                INSERT OR IGNORE INTO podcast_episodes (
                    id, feed_id, guid, title, description, published_date,
                    duration, audio_url, audio_type, file_size, image_url,
                    link, played, playback_position, date_added
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, 0.0, ?13)
                "#,
            )
            .bind(&id)
            .bind(feed_id)
            .bind(&episode.guid)
            .bind(&episode.title)
            .bind(&episode.description)
            .bind(&episode.published_date)
            .bind(episode.duration)
            .bind(&episode.audio_url)
            .bind(&episode.audio_type)
            .bind(episode.file_size)
            .bind(&episode.image_url)
            .bind(&episode.link)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await.map_err(|e| {
            IncrementumError::Internal(format!("Failed to commit bulk insert: {}", e))
        })?;

        Ok(())
    }

    pub async fn get_podcast_episodes(
        &self,
        feed_id: Option<&str>,
        include_played: Option<bool>,
    ) -> Result<Vec<crate::models::podcast::PodcastEpisode>> {
        let rows = match (feed_id, include_played) {
            (Some(id), Some(false)) => {
                let sql = "SELECT * FROM podcast_episodes WHERE feed_id = ? AND played = 0 ORDER BY published_date DESC";
                sqlx::query(sql).bind(id).fetch_all(self.pool()).await?
            }
            (Some(id), _) => {
                let sql =
                    "SELECT * FROM podcast_episodes WHERE feed_id = ? ORDER BY published_date DESC";
                sqlx::query(sql).bind(id).fetch_all(self.pool()).await?
            }
            (None, Some(false)) => {
                let sql =
                    "SELECT * FROM podcast_episodes WHERE played = 0 ORDER BY published_date DESC";
                sqlx::query(sql).fetch_all(self.pool()).await?
            }
            (None, _) => {
                let sql = "SELECT * FROM podcast_episodes ORDER BY published_date DESC";
                sqlx::query(sql).fetch_all(self.pool()).await?
            }
        };

        Ok(rows.iter().map(map_row_to_podcast_episode).collect())
    }

    pub async fn update_episode_played(&self, episode_id: &str, played: bool) -> Result<()> {
        sqlx::query("UPDATE podcast_episodes SET played = ?1 WHERE id = ?2")
            .bind(played as i32)
            .bind(episode_id)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    pub async fn update_episode_position(&self, episode_id: &str, position: f64) -> Result<()> {
        sqlx::query("UPDATE podcast_episodes SET playback_position = ?1 WHERE id = ?2")
            .bind(position)
            .bind(episode_id)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    pub async fn get_episode_position(&self, episode_id: &str) -> Result<f64> {
        let result: (f64,) =
            sqlx::query_as("SELECT playback_position FROM podcast_episodes WHERE id = ?")
                .bind(episode_id)
                .fetch_one(self.pool())
                .await?;
        Ok(result.0)
    }

    // ── Podcast transcription helpers ────────────────────────────────────────

    pub async fn get_podcast_episode_by_id(
        &self,
        episode_id: &str,
    ) -> Result<Option<crate::models::podcast::PodcastEpisode>> {
        let row = sqlx::query("SELECT * FROM podcast_episodes WHERE id = ?")
            .bind(episode_id)
            .fetch_optional(self.pool())
            .await?;
        match row {
            Some(row) => Ok(Some(map_row_to_podcast_episode(&row))),
            None => Ok(None),
        }
    }

    pub async fn update_episode_transcript_status(
        &self,
        episode_id: &str,
        status: &str,
        error: Option<&str>,
        transcript: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            UPDATE podcast_episodes
            SET transcript_status = ?1,
                transcript_error = ?2,
                transcript_text = COALESCE(?3, transcript_text),
                transcribed_at = CASE WHEN ?1 = 'done' THEN ?4 ELSE transcribed_at END
            WHERE id = ?5
            "#,
        )
        .bind(status)
        .bind(error)
        .bind(transcript)
        .bind(&now)
        .bind(episode_id)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    /// Replace the per-segment + word-level timings for a podcast episode.
    /// Called after transcription (local Whisper or Groq) completes with real
    /// `start_ms`/`end_ms` per segment (and, when available from Groq word-level
    /// transcription, the per-word timings as JSON). Existing rows for the
    /// episode are deleted first so re-transcription replaces cleanly.
    pub async fn save_podcast_transcript_segments(
        &self,
        episode_id: &str,
        segments: &[crate::transcription::engine::TranscriptSegment],
        word_timings_by_segment: &[Option<String>],
    ) -> Result<()> {
        let mut tx = self.pool().begin().await?;
        sqlx::query("DELETE FROM podcast_transcript_segments WHERE episode_id = ?")
            .bind(episode_id)
            .execute(&mut *tx)
            .await?;
        for (idx, seg) in segments.iter().enumerate() {
            let words = word_timings_by_segment.get(idx).cloned().flatten();
            sqlx::query(
                r#"
                INSERT INTO podcast_transcript_segments
                    (episode_id, segment_index, start_ms, end_ms, text, word_timings_json)
                VALUES (?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(episode_id)
            .bind(idx as i64)
            .bind(seg.start_ms)
            .bind(seg.end_ms)
            .bind(&seg.text)
            .bind(words.as_deref())
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    /// Fetch the persisted per-segment timings (with optional word timings) for
    /// a podcast episode, ordered by start time. Returns an empty vec when no
    /// real segments have been stored yet (caller falls back to the blob split).
    pub async fn get_podcast_transcript_segments(
        &self,
        episode_id: &str,
    ) -> Result<Vec<crate::transcription::engine::TranscriptSegment>> {
        let rows = sqlx::query_as::<_, PodcastTranscriptSegmentRow>(
            r#"
            SELECT start_ms, end_ms, text, word_timings_json
            FROM podcast_transcript_segments
            WHERE episode_id = ?
            ORDER BY start_ms ASC
            "#,
        )
        .bind(episode_id)
        .fetch_all(self.pool())
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| crate::transcription::engine::TranscriptSegment {
                start_ms: r.start_ms,
                end_ms: r.end_ms,
                text: r.text,
                confidence: r.word_timings_json.as_deref().map(|_| 1.0).unwrap_or(0.0),
            })
            .collect())
    }

    /// Fetch the per-word timings JSON for a specific segment (by start_ms) of a
    /// podcast episode. Used for word-level (karaoke) highlighting when Groq
    /// word-level transcription provided timings. Returns None when only
    /// segment-level timings are available.
    pub async fn get_podcast_segment_word_timings(
        &self,
        episode_id: &str,
        start_ms: i64,
    ) -> Result<Option<String>> {
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT word_timings_json FROM podcast_transcript_segments WHERE episode_id = ? AND start_ms = ? LIMIT 1",
        )
        .bind(episode_id)
        .bind(start_ms)
        .fetch_optional(self.pool())
        .await?;
        Ok(row.and_then(|(w,)| w))
    }

    /// Fetch the persisted per-segment timings INCLUDING the per-word timings
    /// JSON for a podcast episode, ordered by start time. Returns the
    /// TranscriptSegmentInfo shape (start_ms/end_ms/text/word_timings_json) so
    /// the API response carries word-level data straight to the viewer. Returns
    /// an empty vec when no real segments are stored (caller falls back to blob).
    pub async fn get_podcast_transcript_segments_with_words(
        &self,
        episode_id: &str,
    ) -> Result<Vec<crate::commands::podcast::TranscriptSegmentInfo>> {
        let rows = sqlx::query_as::<_, PodcastTranscriptSegmentWithWordsRow>(
            r#"
            SELECT start_ms, end_ms, text, word_timings_json
            FROM podcast_transcript_segments
            WHERE episode_id = ?
            ORDER BY start_ms ASC
            "#,
        )
        .bind(episode_id)
        .fetch_all(self.pool())
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| crate::commands::podcast::TranscriptSegmentInfo {
                start_ms: r.start_ms,
                end_ms: r.end_ms,
                text: r.text,
                word_timings_json: r.word_timings_json,
            })
            .collect())
    }

    pub async fn set_feed_auto_transcribe(
        &self,
        feed_id: &str,
        enabled: bool,
        language: Option<&str>,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE podcast_feeds SET auto_transcribe = ?1, transcribe_language = ?2 WHERE id = ?3",
        )
        .bind(enabled as i32)
        .bind(language)
        .bind(feed_id)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    pub async fn get_untranscribed_episodes(
        &self,
        feed_id: &str,
    ) -> Result<Vec<crate::models::podcast::PodcastEpisode>> {
        let rows = sqlx::query(
            r#"
            SELECT * FROM podcast_episodes
            WHERE feed_id = ?
              AND (transcript_status IS NULL OR transcript_status = 'none')
              AND audio_url IS NOT NULL
              AND audio_url != ''
            ORDER BY published_date DESC
            "#,
        )
        .bind(feed_id)
        .fetch_all(self.pool())
        .await?;
        Ok(rows.iter().map(map_row_to_podcast_episode).collect())
    }

    // ===========================================================================
    // Tag-Aware Scheduling (TAS) — Tag CRUD
    // ===========================================================================

    /// Sync tags: scan all items for tag names and insert any that don't yet
    /// exist in the `tags` table. Returns the count of newly created tags.
    pub async fn sync_tags_from_items(&self) -> Result<usize> {
        // Collect all unique tag names from learning_items, extracts, and documents
        let mut all_names = std::collections::HashSet::new();

        // From learning_items
        let item_rows = sqlx::query("SELECT tags FROM learning_items")
            .fetch_all(self.pool())
            .await?;
        for row in &item_rows {
            let tags_json: String = row.try_get("tags").unwrap_or_else(|_| "[]".into());
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            all_names.extend(tags);
        }

        // From extracts
        let extract_rows = sqlx::query("SELECT tags FROM extracts")
            .fetch_all(self.pool())
            .await?;
        for row in &extract_rows {
            let tags_json: String = row.try_get("tags").unwrap_or_else(|_| "[]".into());
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            all_names.extend(tags);
        }

        // From documents
        let doc_rows = sqlx::query("SELECT tags FROM documents")
            .fetch_all(self.pool())
            .await?;
        for row in &doc_rows {
            let tags_json: String = row.try_get("tags").unwrap_or_else(|_| "[]".into());
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            all_names.extend(tags);
        }

        // Get existing tag names
        let existing_rows = sqlx::query("SELECT name FROM tags")
            .fetch_all(self.pool())
            .await?;
        let existing_names: std::collections::HashSet<String> = existing_rows
            .iter()
            .map(|r: &sqlx::sqlite::SqliteRow| r.get("name"))
            .collect();

        // Insert new tags
        let now = chrono::Utc::now().to_rfc3339();
        let mut created = 0usize;

        for name in &all_names {
            if existing_names.contains(name) {
                continue;
            }
            let id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO tags (id, name, prerequisites, maturity_threshold, item_count, mature_count, date_created, date_modified)
                 VALUES (?, ?, '[]', 0.8, 0, 0, ?, ?)"
            )
            .bind(&id)
            .bind(name)
            .bind(&now)
            .bind(&now)
            .execute(self.pool())
            .await?;
            created += 1;
        }

        // Update item counts for all tags
        for name in &all_names {
            let tag = self.get_tag_by_name(name).await?;
            if let Some(tag) = tag {
                let items = self.get_learning_items_for_tag(name).await?;
                let stabilities: Vec<Option<f64>> = items
                    .iter()
                    .map(|item| item.memory_state.as_ref().map(|ms| ms.stability))
                    .collect();
                let stats = crate::tas::maturity::recompute_tag_stability_stats(&stabilities, &tag);
                self.update_tag_stability_stats(
                    &tag.id,
                    stats.item_count,
                    stats.avg_stability,
                    stats.mature_count,
                )
                .await?;
            }
        }

        Ok(created)
    }

    /// Get a tag by name
    pub async fn get_tag_by_name(&self, name: &str) -> Result<Option<crate::models::Tag>> {
        let row = sqlx::query(
            "SELECT id, name, prerequisites, maturity_threshold, centroid, coherence,
                    item_count, avg_stability, mature_count, date_created, date_modified
             FROM tags WHERE name = ?",
        )
        .bind(name)
        .fetch_optional(self.pool())
        .await?;

        match row {
            Some(row) => {
                let prereqs_json: String =
                    row.try_get("prerequisites").unwrap_or_else(|_| "[]".into());
                let prerequisites: Vec<String> =
                    serde_json::from_str(&prereqs_json).unwrap_or_default();
                let centroid_blob: Option<Vec<u8>> = row.try_get("centroid").ok();
                let centroid: Option<Vec<f32>> = centroid_blob.and_then(|b| {
                    if b.len() % 4 != 0 {
                        return None;
                    }
                    let mut vec = Vec::with_capacity(b.len() / 4);
                    for chunk in b.chunks_exact(4) {
                        vec.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
                    }
                    Some(vec)
                });

                Ok(Some(crate::models::Tag {
                    id: row.try_get("id")?,
                    name: row.try_get("name")?,
                    prerequisites,
                    maturity_threshold: row.try_get("maturity_threshold").unwrap_or(0.8),
                    centroid,
                    coherence: row.try_get("coherence").ok(),
                    item_count: row.try_get("item_count").unwrap_or(0),
                    avg_stability: row.try_get("avg_stability").ok(),
                    mature_count: row.try_get("mature_count").unwrap_or(0),
                    date_created: row.try_get("date_created")?,
                    date_modified: row.try_get("date_modified")?,
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn get_all_tags(&self) -> Result<Vec<crate::models::Tag>> {
        let rows = sqlx::query(
            "SELECT id, name, prerequisites, maturity_threshold, centroid, coherence,
                    item_count, avg_stability, mature_count, date_created, date_modified
             FROM tags ORDER BY name",
        )
        .fetch_all(self.pool())
        .await?;

        let mut tags = Vec::new();
        for row in rows {
            let prereqs_json: String = row.try_get("prerequisites").unwrap_or_else(|_| "[]".into());
            let prerequisites: Vec<String> =
                serde_json::from_str(&prereqs_json).unwrap_or_default();
            let centroid_blob: Option<Vec<u8>> = row.try_get("centroid").ok();
            let centroid: Option<Vec<f32>> = centroid_blob.and_then(|b| {
                if b.len() % 4 != 0 {
                    return None;
                }
                let mut vec = Vec::with_capacity(b.len() / 4);
                for chunk in b.chunks_exact(4) {
                    vec.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
                }
                Some(vec)
            });

            tags.push(crate::models::Tag {
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                prerequisites,
                maturity_threshold: row.try_get("maturity_threshold").unwrap_or(0.8),
                centroid,
                coherence: row.try_get("coherence").ok(),
                item_count: row.try_get("item_count").unwrap_or(0),
                avg_stability: row.try_get("avg_stability").ok(),
                mature_count: row.try_get("mature_count").unwrap_or(0),
                date_created: row.try_get("date_created")?,
                date_modified: row.try_get("date_modified")?,
            });
        }
        Ok(tags)
    }

    pub async fn get_tag(&self, tag_id: &str) -> Result<crate::models::Tag> {
        let row = sqlx::query(
            "SELECT id, name, prerequisites, maturity_threshold, centroid, coherence,
                    item_count, avg_stability, mature_count, date_created, date_modified
             FROM tags WHERE id = ?",
        )
        .bind(tag_id)
        .fetch_optional(self.pool())
        .await?
        .ok_or_else(|| IncrementumError::NotFound(format!("Tag not found: {tag_id}")))?;

        let prereqs_json: String = row.try_get("prerequisites").unwrap_or_else(|_| "[]".into());
        let prerequisites: Vec<String> = serde_json::from_str(&prereqs_json).unwrap_or_default();
        let centroid_blob: Option<Vec<u8>> = row.try_get("centroid").ok();
        let centroid: Option<Vec<f32>> = centroid_blob.and_then(|b| {
            if b.len() % 4 != 0 {
                return None;
            }
            let mut vec = Vec::with_capacity(b.len() / 4);
            for chunk in b.chunks_exact(4) {
                vec.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
            }
            Some(vec)
        });

        Ok(crate::models::Tag {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            prerequisites,
            maturity_threshold: row.try_get("maturity_threshold").unwrap_or(0.8),
            centroid,
            coherence: row.try_get("coherence").ok(),
            item_count: row.try_get("item_count").unwrap_or(0),
            avg_stability: row.try_get("avg_stability").ok(),
            mature_count: row.try_get("mature_count").unwrap_or(0),
            date_created: row.try_get("date_created")?,
            date_modified: row.try_get("date_modified")?,
        })
    }

    pub async fn set_tag_prerequisites(
        &self,
        tag_id: &str,
        prerequisite_ids: &[String],
    ) -> Result<crate::models::Tag> {
        let prereqs_json = serde_json::to_string(prerequisite_ids).map_err(|e| {
            IncrementumError::Internal(format!("Failed to serialize prerequisites: {e}"))
        })?;
        let now = Utc::now().to_rfc3339();

        sqlx::query("UPDATE tags SET prerequisites = ?, date_modified = ? WHERE id = ?")
            .bind(&prereqs_json)
            .bind(&now)
            .bind(tag_id)
            .execute(self.pool())
            .await?;

        self.get_tag(tag_id).await
    }

    pub async fn upsert_tag(
        &self,
        name: &str,
        prerequisites: &[String],
        maturity_threshold: f64,
    ) -> Result<crate::models::Tag> {
        // Check if tag exists by name
        let existing = sqlx::query("SELECT id FROM tags WHERE name = ?")
            .bind(name)
            .fetch_optional(self.pool())
            .await?;

        let now = Utc::now().to_rfc3339();

        if let Some((id,)) =
            existing.map(|row: sqlx::sqlite::SqliteRow| (row.get::<String, _>("id"),))
        {
            // Update existing
            let prereqs_json = serde_json::to_string(prerequisites).map_err(|e| {
                IncrementumError::Internal(format!("Failed to serialize prerequisites: {e}"))
            })?;
            sqlx::query(
                "UPDATE tags SET prerequisites = ?, maturity_threshold = ?, date_modified = ? WHERE id = ?"
            )
            .bind(&prereqs_json)
            .bind(maturity_threshold)
            .bind(&now)
            .bind(&id)
            .execute(self.pool())
            .await?;
            self.get_tag(&id).await
        } else {
            // Create new
            let id = uuid::Uuid::new_v4().to_string();
            let prereqs_json = serde_json::to_string(prerequisites).map_err(|e| {
                IncrementumError::Internal(format!("Failed to serialize prerequisites: {e}"))
            })?;
            sqlx::query(
                "INSERT INTO tags (id, name, prerequisites, maturity_threshold, item_count, mature_count, date_created, date_modified)
                 VALUES (?, ?, ?, ?, 0, 0, ?, ?)"
            )
            .bind(&id)
            .bind(name)
            .bind(&prereqs_json)
            .bind(maturity_threshold)
            .bind(&now)
            .bind(&now)
            .execute(self.pool())
            .await?;
            self.get_tag(&id).await
        }
    }

    pub async fn delete_tag(&self, tag_id: &str) -> Result<()> {
        let rows = sqlx::query("DELETE FROM tags WHERE id = ?")
            .bind(tag_id)
            .execute(self.pool())
            .await?
            .rows_affected();

        if rows == 0 {
            return Err(IncrementumError::NotFound(format!(
                "Tag not found: {tag_id}"
            )));
        }
        Ok(())
    }

    pub async fn remove_tag_from_prerequisites(&self, tag_id: &str) -> Result<()> {
        // Get all tags that reference this tag as a prerequisite
        let all_tags = self.get_all_tags().await?;
        let now = Utc::now().to_rfc3339();

        for mut tag in all_tags {
            if tag.prerequisites.contains(&tag_id.to_string()) {
                tag.prerequisites.retain(|p| p != tag_id);
                let prereqs_json = serde_json::to_string(&tag.prerequisites).map_err(|e| {
                    IncrementumError::Internal(format!("Failed to serialize prerequisites: {e}"))
                })?;
                sqlx::query("UPDATE tags SET prerequisites = ?, date_modified = ? WHERE id = ?")
                    .bind(&prereqs_json)
                    .bind(&now)
                    .bind(&tag.id)
                    .execute(self.pool())
                    .await?;
            }
        }
        Ok(())
    }

    pub async fn get_learning_items_for_tag(
        &self,
        tag_name: &str,
    ) -> Result<Vec<crate::models::LearningItem>> {
        // Learning items store tags as JSON array in a TEXT column
        // We search for tag_name appearing in the JSON array
        let all_items = self.get_all_learning_items().await?;
        Ok(all_items
            .into_iter()
            .filter(|item| item.tags.contains(&tag_name.to_string()))
            .collect())
    }

    /// Generic setting getter (key-value store)
    pub async fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let row = sqlx::query("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(self.pool())
            .await?;
        Ok(row.map(|r: sqlx::sqlite::SqliteRow| r.get("value")))
    }

    /// Generic setting setter (key-value store)
    pub async fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO settings (key, value, date_modified) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, date_modified = excluded.date_modified"
        )
        .bind(key)
        .bind(value)
        .bind(&now)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    /// Update tag stability stats in the database
    pub async fn update_tag_stability_stats(
        &self,
        tag_id: &str,
        item_count: i32,
        avg_stability: Option<f64>,
        mature_count: i32,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE tags SET item_count = ?, avg_stability = ?, mature_count = ?, date_modified = ? WHERE id = ?"
        )
        .bind(item_count)
        .bind(avg_stability)
        .bind(mature_count)
        .bind(&now)
        .bind(tag_id)
        .execute(self.pool())
        .await?;
        Ok(())
    }

    /// Compute tag centroids and coherence from existing item embeddings.
    ///
    /// For each tag, collects embeddings of all learning items with that tag,
    /// computes the centroid (mean vector) and coherence (avg pairwise cosine
    /// similarity of items within the tag), and writes them to the `tags` table.
    /// Returns the number of tags updated.
    pub async fn compute_tag_centroids(&self) -> Result<usize> {
        // 1. Load all tags
        let tags = self.get_all_tags().await?;
        if tags.is_empty() {
            return Ok(0);
        }

        // 2. Load all learning items with their tags
        let all_items = self.get_all_learning_items().await?;

        // 3. Build map: learning_item.id -> tags
        let item_tags: std::collections::HashMap<String, Vec<String>> = all_items
            .iter()
            .map(|item| (item.id.clone(), item.tags.clone()))
            .collect();

        // 4. Collect all relevant item IDs and load embeddings in one query
        let all_item_ids: Vec<String> = item_tags.keys().cloned().collect();
        let embeddings = self.get_embeddings_for_items(&all_item_ids).await?;
        let emb_map: std::collections::HashMap<String, &[f32]> = embeddings
            .iter()
            .map(|e| (e.item_id.clone(), e.embedding.as_slice()))
            .collect();

        // 5. For each tag, collect embeddings and compute centroid + coherence
        let now = Utc::now().to_rfc3339();
        let mut updated = 0usize;

        for tag in &tags {
            // Find all items with this tag
            let mut tag_embeddings: Vec<&[f32]> = Vec::new();

            for (item_id, item_tag_list) in &item_tags {
                if item_tag_list.contains(&tag.name) {
                    if let Some(emb) = emb_map.get(item_id.as_str()) {
                        tag_embeddings.push(emb);
                    }
                }
            }

            if tag_embeddings.is_empty() {
                continue;
            }

            // Compute centroid
            let dim = tag_embeddings[0].len();
            if dim == 0 {
                continue;
            }

            let centroid = compute_centroid(&tag_embeddings, dim);
            let coherence = if tag_embeddings.len() >= 2 {
                compute_avg_pairwise_cosine(&tag_embeddings)
            } else {
                // Single item: maximum coherence by definition
                1.0
            };

            // Serialize centroid to blob
            let centroid_blob: Vec<u8> = centroid.iter().flat_map(|v| v.to_le_bytes()).collect();

            // Write to tags table
            sqlx::query(
                "UPDATE tags SET centroid = ?, coherence = ?, date_modified = ? WHERE id = ?",
            )
            .bind(&centroid_blob)
            .bind(coherence)
            .bind(&now)
            .bind(&tag.id)
            .execute(self.pool())
            .await?;

            updated += 1;
        }

        Ok(updated)
    }
}

/// Compute the centroid (element-wise mean) of a set of equal-length vectors.
fn compute_centroid(embeddings: &[&[f32]], dim: usize) -> Vec<f32> {
    let mut centroid = vec![0.0f32; dim];
    let count = embeddings.len() as f32;
    for emb in embeddings {
        for (i, &val) in emb.iter().enumerate() {
            centroid[i] += val;
        }
    }
    for val in &mut centroid {
        *val /= count;
    }
    centroid
}

/// Compute average pairwise cosine similarity among a set of vectors.
fn compute_avg_pairwise_cosine(embeddings: &[&[f32]]) -> f64 {
    let n = embeddings.len();
    if n < 2 {
        return 1.0;
    }
    let mut total: f64 = 0.0;
    let mut pairs: usize = 0;
    for i in 0..n {
        for j in (i + 1)..n {
            let sim = cosine_similarity_f32(embeddings[i], embeddings[j]);
            total += sim as f64;
            pairs += 1;
        }
    }
    total / pairs as f64
}

/// Cosine similarity between two f32 slices.
fn cosine_similarity_f32(a: &[f32], b: &[f32]) -> f32 {
    let (dot, norm_a, norm_b) = a
        .iter()
        .zip(b.iter())
        .fold((0.0f32, 0.0f32, 0.0f32), |(d, na, nb), (&x, &y)| {
            (d + x * y, na + x * x, nb + y * y)
        });
    let denom = (norm_a.sqrt() * norm_b.sqrt()).max(1e-12);
    (dot / denom).clamp(-1.0, 1.0)
}

// Helper structs for podcast transcript segment rows (migration 052).
#[derive(sqlx::FromRow, Debug, Clone)]
struct PodcastTranscriptSegmentRow {
    start_ms: i64,
    end_ms: i64,
    text: String,
    word_timings_json: Option<String>,
}

#[derive(sqlx::FromRow, Debug, Clone)]
struct PodcastTranscriptSegmentWithWordsRow {
    start_ms: i64,
    end_ms: i64,
    text: String,
    word_timings_json: Option<String>,
}

// Helper struct for study statistics rows
#[derive(sqlx::FromRow)]
struct StudyStatsRow {
    id: String,
    date: String,
    cards_reviewed: i32,
    correct_reviews: i32,
    total_study_time: i32,
    new_cards: i32,
    learning_cards: i32,
    review_cards: i32,
}

// ── Podcast row mapping helpers ─────────────────────────────────────────────

use crate::models::podcast::{PodcastEpisode, PodcastFeed};

fn map_row_to_podcast_feed(row: &SqliteRow) -> PodcastFeed {
    PodcastFeed {
        id: row.get("id"),
        title: row.get("title"),
        description: row.try_get("description").ok().flatten(),
        image_url: row.try_get("image_url").ok().flatten(),
        author: row.try_get("author").ok().flatten(),
        language: row.try_get("language").ok().flatten(),
        link: row.try_get("link").ok().flatten(),
        feed_url: row.get("feed_url"),
        last_fetched: row.try_get("last_fetched").ok().flatten(),
        subscribed_at: row.get("subscribed_at"),
        sort_order: row.get("sort_order"),
        auto_transcribe: row.try_get("auto_transcribe").unwrap_or(0) != 0,
        transcribe_language: row.try_get("transcribe_language").ok().flatten(),
    }
}

fn map_row_to_podcast_episode(row: &SqliteRow) -> PodcastEpisode {
    let played: i32 = row.try_get("played").unwrap_or(0);
    PodcastEpisode {
        id: row.get("id"),
        feed_id: row.get("feed_id"),
        guid: row.try_get("guid").ok().flatten(),
        title: row.get("title"),
        description: row.try_get("description").ok().flatten(),
        published_date: row.try_get("published_date").ok().flatten(),
        duration: row.try_get("duration").ok().flatten(),
        audio_url: row.get("audio_url"),
        audio_type: row.try_get("audio_type").ok().flatten(),
        file_size: row.try_get("file_size").ok().flatten(),
        image_url: row.try_get("image_url").ok().flatten(),
        link: row.try_get("link").ok().flatten(),
        played: played != 0,
        playback_position: row.try_get("playback_position").unwrap_or(0.0),
        date_added: row.get("date_added"),
        transcript_text: row.try_get("transcript_text").ok().flatten(),
        transcript_status: row
            .try_get("transcript_status")
            .unwrap_or_else(|_| "none".to_string()),
        transcript_error: row.try_get("transcript_error").ok().flatten(),
        transcribed_at: row.try_get("transcribed_at").ok().flatten(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
    use crate::models::{Document, DocumentMetadata, Extract, FileType, ItemType, LearningItem};
    use sha2::{Digest, Sha256};
    use std::path::PathBuf;

    async fn setup_repo() -> Repository {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");
        Repository::new(db.pool().clone())
    }

    fn sha_hex(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        format!("{:x}", hasher.finalize())
    }

    #[tokio::test]
    async fn arena_review_provenance_round_trips_and_commit_ids_are_unique() {
        let repo = setup_repo().await;
        let item = LearningItem::new(ItemType::Flashcard, "Arena prompt".to_string());
        repo.create_learning_item(&item)
            .await
            .expect("learning item");
        let due = Utc::now();

        for (index, (source, model)) in [("arena", None), ("model", Some("sm19")), ("custom", None)]
            .into_iter()
            .enumerate()
        {
            let result_id = format!("arena-result-{index}");
            let commit_id = format!("arena-commit-{index}");
            let snapshot = format!(r#"{{"version":1,"source":"{source}"}}"#);
            let provenance = ArenaReviewProvenance {
                schedule_source: source,
                schedule_model_id: model,
                arena_commit_id: &commit_id,
                recommended_interval: 4.25 + index as f64,
                decision_time_ms: 900 + index as u64,
                snapshot: &snapshot,
            };

            repo.create_review_result_with_arena(
                &result_id,
                &item.collection_id,
                None,
                &item.id,
                3,
                12,
                &due,
                5.0 + index as f64,
                2.5,
                Some(&provenance),
            )
            .await
            .expect("create Arena review result");

            let row = sqlx::query(
                "SELECT schedule_source, schedule_model_id, arena_commit_id, \
                        arena_recommended_interval, arena_decision_time_ms, arena_snapshot \
                 FROM review_results WHERE id = ?1",
            )
            .bind(&result_id)
            .fetch_one(repo.pool())
            .await
            .expect("read Arena provenance");
            assert_eq!(row.get::<String, _>("schedule_source"), source);
            assert_eq!(
                row.get::<Option<String>, _>("schedule_model_id").as_deref(),
                model
            );
            assert_eq!(row.get::<String, _>("arena_commit_id"), commit_id);
            assert_eq!(
                row.get::<i64, _>("arena_decision_time_ms"),
                900 + index as i64
            );
            assert_eq!(row.get::<String, _>("arena_snapshot"), snapshot);
            assert_eq!(
                repo.get_review_item_by_arena_commit_id(&commit_id)
                    .await
                    .expect("commit lookup")
                    .as_deref(),
                Some(item.id.as_str()),
            );
        }

        let duplicate_snapshot = "{}";
        let duplicate = ArenaReviewProvenance {
            schedule_source: "arena",
            schedule_model_id: None,
            arena_commit_id: "arena-commit-0",
            recommended_interval: 4.25,
            decision_time_ms: 1,
            snapshot: duplicate_snapshot,
        };
        let duplicate_result = repo
            .create_review_result_with_arena(
                "duplicate-arena-result",
                &item.collection_id,
                None,
                &item.id,
                3,
                1,
                &due,
                4.25,
                2.5,
                Some(&duplicate),
            )
            .await;
        assert!(
            duplicate_result.is_err(),
            "unique partial index must reject duplicate commit IDs"
        );
        assert!(repo
            .undo_arena_review_by_commit_id("arena-commit-0")
            .await
            .expect("delete Arena review event"));
        assert!(repo
            .get_review_item_by_arena_commit_id("arena-commit-0")
            .await
            .expect("deleted commit lookup")
            .is_none());

        repo.create_review_result(
            "legacy-result",
            &item.collection_id,
            None,
            &item.id,
            3,
            4,
            &due,
            3.0,
            2.5,
        )
        .await
        .expect("legacy result remains writable");
        let legacy_source: Option<String> = sqlx::query_scalar(
            "SELECT schedule_source FROM review_results WHERE id = 'legacy-result'",
        )
        .fetch_one(repo.pool())
        .await
        .expect("legacy result remains readable");
        assert!(legacy_source.is_none());
    }

    #[tokio::test]
    async fn arena_commit_is_atomic_stale_safe_and_idempotent() {
        let repo = setup_repo().await;
        let original = LearningItem::new(ItemType::Flashcard, "Atomic Arena prompt".to_string());
        repo.create_learning_item(&original)
            .await
            .expect("learning item");
        let original = repo
            .get_learning_item_by_id(&original.id)
            .await
            .expect("stored item read")
            .expect("stored item");
        let expected_item_revision =
            crate::commands::review::sm20_item_revision(&original).expect("item revision");
        let collection = crate::algorithms::sm20::SM20CollectionState::default();
        let expected_arena_revision =
            crate::commands::review::sm20_arena_revision(&collection).expect("Arena revision");

        let mut scheduled = original.clone();
        scheduled.interval = 12.0;
        scheduled.due_date = Utc::now() + chrono::Duration::days(12);
        scheduled.review_count += 1;
        scheduled.last_review_date = Some(Utc::now());
        scheduled.state = ItemState::Review;
        scheduled.algorithm_type = "sm20".to_string();
        scheduled.algorithm_state = Some(r#"{"interval":12}"#.to_string());
        let provenance_snapshot = serde_json::to_string(&serde_json::json!({
            "version": 1,
            "grade": 4,
            "prior_item_state": "new",
            "undo_collection": {
                "m2_optimizer": &collection.m2_optimizer,
                "m3_matrices": &collection.m3_matrices,
                "arena": &collection.arena,
            },
        }))
        .expect("provenance snapshot");
        let provenance = ArenaReviewProvenance {
            schedule_source: "arena",
            schedule_model_id: None,
            arena_commit_id: "atomic-arena-commit",
            recommended_interval: 12.0,
            decision_time_ms: 1_250,
            snapshot: &provenance_snapshot,
        };
        let statistics_date = Utc::now().format("%Y-%m-%d").to_string();

        let stale = repo
            .commit_sm20_arena_review(
                &scheduled,
                &collection,
                "atomic-stale-result",
                None,
                3,
                8,
                &provenance,
                "stale-item-revision",
                &expected_arena_revision,
                &statistics_date,
                1,
                1,
                0,
                0,
            )
            .await;
        assert!(matches!(stale, Err(IncrementumError::ArenaPreviewStale(_))));
        let rolled_back_result_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM review_results WHERE arena_commit_id = 'atomic-arena-commit'",
        )
        .fetch_one(repo.pool())
        .await
        .expect("rollback result count");
        assert_eq!(rolled_back_result_count, 0);
        assert_eq!(
            repo.get_learning_item_by_id(&original.id)
                .await
                .expect("item read")
                .expect("item")
                .interval,
            original.interval,
            "stale transaction must not change the item",
        );

        sqlx::query(&format!(
            "CREATE TRIGGER inject_arena_failure BEFORE UPDATE ON learning_items \
             WHEN NEW.id = '{}' BEGIN SELECT RAISE(ABORT, 'injected Arena failure'); END",
            original.id,
        ))
        .execute(repo.pool())
        .await
        .expect("failure trigger");
        let injected_failure = repo
            .commit_sm20_arena_review(
                &scheduled,
                &collection,
                "atomic-injected-failure-result",
                None,
                3,
                8,
                &provenance,
                &expected_item_revision,
                &expected_arena_revision,
                &statistics_date,
                1,
                1,
                0,
                0,
            )
            .await;
        assert!(injected_failure.is_err());
        sqlx::query("DROP TRIGGER inject_arena_failure")
            .execute(repo.pool())
            .await
            .expect("drop failure trigger");
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM review_results WHERE arena_commit_id = 'atomic-arena-commit'",
            )
            .fetch_one(repo.pool())
            .await
            .expect("injected rollback result count"),
            0,
        );
        assert_eq!(
            repo.get_learning_item_by_id(&original.id)
                .await
                .expect("item read after injected failure")
                .expect("item after injected failure")
                .interval,
            original.interval,
            "an injected mid-transaction failure must roll the item back",
        );

        let committed = repo
            .commit_sm20_arena_review(
                &scheduled,
                &collection,
                "atomic-valid-result",
                None,
                3,
                8,
                &provenance,
                &expected_item_revision,
                &expected_arena_revision,
                &statistics_date,
                1,
                1,
                0,
                0,
            )
            .await
            .expect("valid Arena commit");
        assert!(committed);
        assert_eq!(
            repo.get_learning_item_by_id(&original.id)
                .await
                .expect("item read")
                .expect("item")
                .interval,
            12.0,
        );
        let statistics: (i64, i64, i64) = sqlx::query_as(
            "SELECT cards_reviewed, correct_reviews, new_cards FROM study_statistics WHERE date = ?1",
        )
        .bind(&statistics_date)
        .fetch_one(repo.pool())
        .await
        .expect("statistics");
        assert_eq!(statistics, (1, 1, 1));

        let repeated = repo
            .commit_sm20_arena_review(
                &scheduled,
                &collection,
                "atomic-retry-result",
                None,
                3,
                8,
                &provenance,
                &expected_item_revision,
                &expected_arena_revision,
                &statistics_date,
                1,
                1,
                0,
                0,
            )
            .await
            .expect("idempotent retry");
        assert!(!repeated);
        let unchanged_statistics: i64 =
            sqlx::query_scalar("SELECT cards_reviewed FROM study_statistics WHERE date = ?1")
                .bind(&statistics_date)
                .fetch_one(repo.pool())
                .await
                .expect("statistics after retry");
        assert_eq!(unchanged_statistics, 1);

        assert!(repo
            .undo_arena_review_by_commit_id("atomic-arena-commit")
            .await
            .expect("undo Arena review event"));
        let reconciled_statistics: (i64, i64, i64) = sqlx::query_as(
            "SELECT cards_reviewed, correct_reviews, new_cards FROM study_statistics WHERE date = ?1",
        )
        .bind(&statistics_date)
        .fetch_one(repo.pool())
        .await
        .expect("statistics after undo");
        assert_eq!(reconciled_statistics, (0, 0, 0));
        assert!(repo
            .get_review_item_by_arena_commit_id("atomic-arena-commit")
            .await
            .expect("commit lookup after undo")
            .is_none());
    }

    #[tokio::test]
    async fn image_assets_are_deduplicated_by_sha256() {
        let repo = setup_repo().await;
        let bytes = vec![1_u8, 2, 3, 4, 5];
        let sha = sha_hex(&bytes);

        let first = repo
            .create_or_get_image_asset(
                "image/png",
                Some("a.png"),
                &bytes,
                &sha,
                Some(100),
                Some(100),
            )
            .await
            .expect("first");
        let second = repo
            .create_or_get_image_asset(
                "image/png",
                Some("b.png"),
                &bytes,
                &sha,
                Some(100),
                Some(100),
            )
            .await
            .expect("second");

        assert_eq!(first.id, second.id);
    }

    #[tokio::test]
    async fn delete_image_asset_is_blocked_when_referenced() {
        let repo = setup_repo().await;
        let bytes = vec![9_u8, 8, 7, 6];
        let sha = sha_hex(&bytes);
        let asset = repo
            .create_or_get_image_asset(
                "image/png",
                Some("asset.png"),
                &bytes,
                &sha,
                Some(10),
                Some(10),
            )
            .await
            .expect("asset");

        let mut item = LearningItem::new(ItemType::Flashcard, "Question".to_string());
        item.answer = Some("Answer".to_string());
        item.image_asset_ids = vec![asset.id.clone()];
        repo.create_learning_item(&item)
            .await
            .expect("learning item");

        let deleted = repo
            .delete_image_asset_if_unreferenced(&asset.id)
            .await
            .expect("delete");
        assert!(!deleted);
    }

    #[tokio::test]
    async fn startup_document_summaries_are_bounded_and_use_collection_index() {
        let repo = setup_repo().await;
        for index in 0..3 {
            let mut document = Document::new(
                format!("startup-{index}"),
                format!("/tmp/startup-{index}.pdf"),
                FileType::Pdf,
            );
            document.content = Some("large document body".repeat(100));
            repo.create_document(&document).await.expect("document");
        }

        let (page, total) = repo
            .list_startup_document_summaries(DEFAULT_COLLECTION_ID, 2, 0)
            .await
            .expect("startup page");
        assert_eq!(page.len(), 2);
        assert_eq!(total, 3);
        assert_eq!(page[0].collection_id, DEFAULT_COLLECTION_ID);

        let plans = sqlx::query(
            "EXPLAIN QUERY PLAN SELECT id, title, date_added FROM documents
             WHERE collection_id = ?1 ORDER BY date_added DESC LIMIT ?2",
        )
        .bind(DEFAULT_COLLECTION_ID)
        .bind(2_i64)
        .fetch_all(repo.pool())
        .await
        .expect("query plan");
        let details = plans
            .iter()
            .filter_map(|row| row.try_get::<String, _>("detail").ok())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            details.contains("idx_documents_collection_date_added"),
            "startup query should use the collection/date index: {details}"
        );

        let (empty_page, empty_total) = repo
            .list_startup_document_summaries("empty-collection", 50, 0)
            .await
            .expect("empty startup page");
        assert!(empty_page.is_empty());
        assert_eq!(empty_total, 0);
    }

    #[tokio::test]
    async fn list_image_assets_reports_reference_counts() {
        let repo = setup_repo().await;
        let bytes = vec![137, 80, 78, 71];
        let sha = "usage-sha";
        let asset = repo
            .create_or_get_image_asset(
                "image/png",
                Some("asset.png"),
                &bytes,
                sha,
                Some(10),
                Some(10),
            )
            .await
            .expect("create image asset");

        // Create a document first (LearningItem::with_answer requires a valid document_id FK)
        let doc = repo
            .create_document(&Document::new(
                "Test Doc".to_string(),
                "/tmp/test.pdf".to_string(),
                FileType::Pdf,
            ))
            .await
            .expect("create document");
        let mut item = LearningItem::with_answer(
            doc.id,
            ItemType::Flashcard,
            "prompt".to_string(),
            "answer".to_string(),
        );
        item.image_asset_ids = vec![asset.id.clone()];
        repo.create_learning_item(&item)
            .await
            .expect("create learning item");

        let assets = repo
            .list_image_assets_with_usage()
            .await
            .expect("list image assets with usage");
        let matching = assets
            .into_iter()
            .find(|candidate| candidate.asset.id == asset.id)
            .expect("matching asset present");

        assert_eq!(matching.reference_count, 1);
    }

    #[tokio::test]
    async fn document_create_read_roundtrip() {
        let repo = setup_repo().await;
        let mut doc = Document::new(
            "Test Book".to_string(),
            "/tmp/test.pdf".to_string(),
            FileType::Pdf,
        );
        doc.tags = vec!["tag1".to_string(), "tag2".to_string()];
        doc.category = Some("science".to_string());
        doc.priority_rating = 3;
        let created = repo.create_document(&doc).await.expect("create");
        let read = repo
            .get_document(&created.id)
            .await
            .expect("get")
            .expect("found");

        assert_eq!(read.id, created.id);
        assert_eq!(read.title, "Test Book");
        assert!(matches!(read.file_type, FileType::Pdf));
        assert_eq!(read.tags, vec!["tag1".to_string(), "tag2".to_string()]);
        assert_eq!(read.category.as_deref(), Some("science"));
        assert_eq!(read.priority_rating, 3);
    }

    #[tokio::test]
    async fn extract_create_read_roundtrip() {
        let repo = setup_repo().await;
        let doc = repo
            .create_document(&Document::new(
                "Src".to_string(),
                "/tmp/s.epub".to_string(),
                FileType::Epub,
            ))
            .await
            .expect("doc");
        let mut ext = Extract::new(
            doc.id.clone(),
            "Important passage about gravity.".to_string(),
        );
        ext.notes = Some("key concept".to_string());
        ext.highlight_color = Some("yellow".to_string());
        let created = repo.create_extract(&ext).await.expect("create");
        let read = repo
            .get_extract(&created.id)
            .await
            .expect("get")
            .expect("found");

        assert_eq!(read.id, created.id);
        assert_eq!(read.document_id, doc.id);
        assert_eq!(read.content, "Important passage about gravity.");
        assert_eq!(read.notes.as_deref(), Some("key concept"));
        assert_eq!(read.highlight_color.as_deref(), Some("yellow"));
    }

    #[tokio::test]
    async fn learning_item_create_read_roundtrip() {
        let repo = setup_repo().await;
        let doc = repo
            .create_document(&Document::new(
                "Src".to_string(),
                "/tmp/s.pdf".to_string(),
                FileType::Pdf,
            ))
            .await
            .expect("doc");
        let mut item = LearningItem::new(ItemType::Qa, "What is gravity?".to_string());
        item.document_id = Some(doc.id.clone());
        item.answer = Some("A fundamental force of nature.".to_string());
        item.difficulty = 5;
        item.tags = vec!["physics".to_string()];
        let created = repo.create_learning_item(&item).await.expect("create");
        let items = repo
            .get_learning_items_by_document(&doc.id)
            .await
            .expect("get");

        assert_eq!(items.len(), 1);
        let read = &items[0];
        assert_eq!(read.id, created.id);
        assert_eq!(read.question, "What is gravity?");
        assert_eq!(
            read.answer.as_deref(),
            Some("A fundamental force of nature.")
        );
        assert_eq!(read.difficulty, 5);
        assert_eq!(read.tags, vec!["physics".to_string()]);
    }

    #[tokio::test]
    async fn full_document_hierarchy_roundtrip() {
        let repo = setup_repo().await;

        let doc = repo
            .create_document(&Document::new(
                "Hierarchy Test".to_string(),
                "/tmp/h.pdf".to_string(),
                FileType::Pdf,
            ))
            .await
            .expect("doc");

        let ext = Extract::new(doc.id.clone(), "Extract content here.".to_string());
        let created_ext = repo.create_extract(&ext).await.expect("extract");

        let mut item1 = LearningItem::new(ItemType::Flashcard, "Flashcard Q".to_string());
        item1.document_id = Some(doc.id.clone());
        item1.extract_id = Some(created_ext.id.clone());
        item1.answer = Some("Flashcard A".to_string());

        let mut item2 = LearningItem::with_answer(
            doc.id.clone(),
            ItemType::Cloze,
            "Cloze {{c1::text}} here.".to_string(),
            "text".to_string(),
        );
        item2.extract_id = Some(created_ext.id.clone());

        repo.create_learning_item(&item1).await.expect("item1");
        repo.create_learning_item(&item2).await.expect("item2");

        // Verify hierarchy
        let read_doc = repo
            .get_document(&doc.id)
            .await
            .expect("get doc")
            .expect("doc exists");
        assert_eq!(read_doc.id, doc.id);

        let read_ext = repo
            .get_extract(&created_ext.id)
            .await
            .expect("get ext")
            .expect("ext exists");
        assert_eq!(read_ext.document_id, doc.id);

        let ext_items = repo
            .get_learning_items_by_extract(&created_ext.id)
            .await
            .expect("ext items");
        assert_eq!(ext_items.len(), 2);

        let doc_items = repo
            .get_learning_items_by_document(&doc.id)
            .await
            .expect("doc items");
        assert_eq!(doc_items.len(), 2);
    }

    #[tokio::test]
    async fn document_update_roundtrip() {
        let repo = setup_repo().await;
        let doc = repo
            .create_document(&Document::new(
                "Original".to_string(),
                "/tmp/u.pdf".to_string(),
                FileType::Pdf,
            ))
            .await
            .expect("create");

        let mut updated = doc.clone();
        updated.title = "Updated Title".to_string();
        updated.category = Some("history".to_string());
        updated.tags = vec!["a".to_string(), "b".to_string()];
        repo.update_document(&updated.id, &updated)
            .await
            .expect("update");

        repo.update_document_dismiss(&doc.id, true)
            .await
            .expect("dismiss");

        // Update priority (requires rating, slider, score)
        repo.update_document_priority(&doc.id, 4, 0, 0.0)
            .await
            .expect("priority");

        let read = repo
            .get_document(&doc.id)
            .await
            .expect("get")
            .expect("found");
        assert_eq!(read.title, "Updated Title");
        assert_eq!(read.category.as_deref(), Some("history"));
        assert_eq!(read.tags, vec!["a".to_string(), "b".to_string()]);
        assert!(read.is_dismissed);
        assert_eq!(read.priority_rating, 4);
    }

    #[tokio::test]
    async fn all_migrations_apply_cleanly() {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");

        // Verify all migrations were tracked
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM _schema_migrations")
            .fetch_one(db.pool())
            .await
            .expect("count migrations");
        let total = crate::database::migrations::MIGRATIONS.len() as i64;
        assert_eq!(
            count.0, total,
            "All {} migrations should be tracked, but got {}",
            total, count.0
        );
    }

    #[tokio::test]
    async fn all_migrations_are_idempotent() {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate 1");
        db.migrate().await.expect("migrate 2");

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM _schema_migrations")
            .fetch_one(db.pool())
            .await
            .expect("count");
        let total = crate::database::migrations::MIGRATIONS.len() as i64;
        assert_eq!(
            count.0, total,
            "Migration count should be unchanged after second pass"
        );
    }

    #[tokio::test]
    async fn fresh_db_passes_integrity_check() {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");

        let row: (String,) = sqlx::query_as("PRAGMA integrity_check")
            .fetch_one(db.pool())
            .await
            .expect("integrity check");
        assert_eq!(row.0, "ok", "Fresh migrated DB should pass integrity check");
    }

    #[tokio::test]
    async fn sm20_recall_observations_aggregate_pass_and_total() {
        let repo = setup_repo().await;
        repo.record_sm20_recall_observation(8, 4, true)
            .await
            .expect("record pass");
        repo.record_sm20_recall_observation(8, 4, false)
            .await
            .expect("record failure");
        let cells = repo.get_sm20_recall_cells().await.expect("load cells");
        assert_eq!(cells.len(), 1);
        assert_eq!(cells[0].retrievability_bucket, 8);
        assert_eq!(cells[0].difficulty_bucket, 4);
        assert_eq!(cells[0].total_count, 2);
        assert_eq!(cells[0].pass_count, 1);
    }

    #[tokio::test]
    async fn sm20_optimizer_profile_round_trip_stays_diagnostic() {
        let repo = setup_repo().await;
        let coefficients = crate::algorithms::sm20::SM20RecallCoefficients {
            coefficient_1: 0.1,
            coefficient_2: 0.2,
            coefficient_3: 0.3,
            coefficient_4: 0.4,
        };
        repo.save_sm20_optimizer_profile(coefficients, 7.5, 250, "2026-07-14T00:00:00Z")
            .await
            .expect("save profile");
        let profile = repo
            .get_sm20_optimizer_profile()
            .await
            .expect("load profile")
            .expect("profile");
        assert_eq!(profile.coefficients, coefficients);
        assert_eq!(profile.objective_score, Some(7.5));
        assert_eq!(profile.sample_count, 250);
        assert_eq!(profile.activation_state, "diagnostic");
    }

    #[tokio::test]
    async fn core_tables_exist_after_migration() {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");

        let expected_tables = [
            "documents",
            "extracts",
            "learning_items",
            "review_results",
            "study_statistics",
            "rss_folders",
            "_schema_migrations",
        ];

        for table in &expected_tables {
            let result: (i64,) = sqlx::query_as(&format!(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{}'",
                table
            ))
            .fetch_one(db.pool())
            .await
            .unwrap_or((0,));

            assert_eq!(
                result.0, 1,
                "Table '{}' should exist after migrations",
                table
            );
        }
    }

    #[tokio::test]
    async fn podcast_transcript_segments_round_trip() {
        // Verifies the persistence path used by Groq (and local Whisper)
        // transcription: real per-segment start_ms/end_ms timings + optional
        // per-word timings JSON are saved and retrieved intact, and that the
        // save replaces prior segments for the episode (idempotent re-transcribe).
        let repo = setup_repo().await;

        let episode_id = "ep-test-1";
        let segments = vec![
            crate::transcription::engine::TranscriptSegment {
                start_ms: 0,
                end_ms: 2000,
                text: "Hello world.".to_string(),
                confidence: 1.0,
            },
            crate::transcription::engine::TranscriptSegment {
                start_ms: 2000,
                end_ms: 4000,
                text: "Good morning.".to_string(),
                confidence: 1.0,
            },
        ];
        let word_timings = vec![
            // Word-level timings only on the first segment (as Groq would produce).
            Some(r#"[{"word":"Hello","start_ms":0,"end_ms":500},{"word":"world.","start_ms":600,"end_ms":1000}]"#.to_string()),
            None,
        ];

        repo.save_podcast_transcript_segments(episode_id, &segments, &word_timings)
            .await
            .expect("save");

        // Retrieve with words.
        let got = repo
            .get_podcast_transcript_segments_with_words(episode_id)
            .await
            .expect("get with words");
        assert_eq!(got.len(), 2, "both segments returned");
        assert_eq!(got[0].start_ms, 0);
        assert_eq!(got[0].end_ms, 2000);
        assert_eq!(got[0].text, "Hello world.");
        assert!(
            got[0].word_timings_json.is_some(),
            "word timings preserved on seg 0"
        );
        assert!(
            got[1].word_timings_json.is_none(),
            "no word timings on seg 1"
        );

        // The word-timings JSON is retrievable per-segment by start_ms too.
        let wt = repo
            .get_podcast_segment_word_timings(episode_id, 0)
            .await
            .expect("get words");
        assert!(wt.is_some());

        // Re-saving replaces (re-transcription is idempotent, no duplicates).
        repo.save_podcast_transcript_segments(
            episode_id,
            &segments[..1],
            &[word_timings[0].clone()],
        )
        .await
        .expect("re-save");
        let got2 = repo
            .get_podcast_transcript_segments_with_words(episode_id)
            .await
            .expect("get after re-save");
        assert_eq!(got2.len(), 1, "re-save replaced prior segments");
    }

    #[tokio::test]
    async fn sm20_matrices_round_trip_preserves_every_cell() {
        // The round-trip holds four 9,261-element arrays live across an await
        // (two inputs + two returned), which the #[tokio::test] async state
        // machine captures into its Future struct and overflows the default
        // 2 MB test stack. Run the body on a thread with a larger stack.
        std::thread::Builder::new()
            .stack_size(8 * 1024 * 1024)
            .spawn(|| {
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async {
                    let repo = setup_repo().await;

                    // First read on a fresh DB: no row yet.
                    assert!(repo.get_sm20_matrices().await.expect("get none").is_none());

                    // Build deterministic non-zero matrices so any encoding bug shows up.
                    let mut interval = Box::new([0.0f64; 9261]);
                    let mut count = Box::new([0u32; 9261]);
                    for i in 0..9261 {
                        interval[i] = (i as f64) * 1.5 + 0.25;
                        count[i] = (i as u32) % 1000;
                    }
                    // Pin a few cells with awkward IEEE-754 values.
                    interval[0] = f64::INFINITY.recip();
                    interval[1] = -3.5;
                    count[0] = u32::MAX;

                    repo.upsert_sm20_matrices(&interval, &count)
                        .await
                        .expect("upsert");

                    let (got_interval, got_count) = repo
                        .get_sm20_matrices()
                        .await
                        .expect("get")
                        .expect("row present after upsert");

                    assert_eq!(
                        &got_count[..],
                        &count[..],
                        "count_matrix must round-trip exactly"
                    );
                    for i in 0..9261 {
                        assert!(
                            got_interval[i].to_bits() == interval[i].to_bits(),
                            "interval[{i}]: got {} expected {} (bit-exact)",
                            got_interval[i],
                            interval[i]
                        );
                    }
                });
            })
            .expect("spawn test thread")
            .join()
            .expect("test thread panicked");
    }

    #[tokio::test]
    async fn sm20_matrices_upsert_replaces_existing() {
        let repo = setup_repo().await;

        let mut interval = Box::new([0.0f64; 9261]);
        let count = Box::new([0u32; 9261]);
        interval[42] = 7.0;
        repo.upsert_sm20_matrices(&interval, &count)
            .await
            .expect("first upsert");

        // Second upsert should replace, not duplicate.
        interval[42] = 99.0;
        repo.upsert_sm20_matrices(&interval, &count)
            .await
            .expect("second upsert");

        let (got_interval, _) = repo.get_sm20_matrices().await.expect("get").expect("row");
        assert_eq!(got_interval[42], 99.0, "ON CONFLICT must update in place");
    }

    #[tokio::test]
    async fn guarded_browser_enrichment_accepts_only_current_improvements() {
        let repo = setup_repo().await;
        let mut doc = Document::new(
            "Browser article".to_string(),
            "https://example.com/article".to_string(),
            FileType::Html,
        );
        doc.content = Some("short body".to_string());
        doc.metadata = Some(DocumentMetadata {
            source: Some("browser_extension".to_string()),
            ..Default::default()
        });
        let created = repo
            .create_document(&doc)
            .await
            .expect("create browser document");
        let richer_metadata = DocumentMetadata {
            source: Some("browser_extension".to_string()),
            article_html: Some(
                "<article>A substantially longer durable article body.</article>".to_string(),
            ),
            ..Default::default()
        };

        assert!(!repo
            .guarded_enrich_browser_document(
                &created.id,
                created.date_modified,
                "",
                richer_metadata.clone(),
            )
            .await
            .expect("reject empty"));
        assert!(repo
            .guarded_enrich_browser_document(
                &created.id,
                created.date_modified,
                "A substantially longer durable article body.",
                richer_metadata.clone(),
            )
            .await
            .expect("accept improvement"));

        let enriched = repo
            .get_document(&created.id)
            .await
            .expect("get")
            .expect("document");
        assert_eq!(
            enriched.content.as_deref(),
            Some("A substantially longer durable article body.")
        );
        assert!(!repo
            .guarded_enrich_browser_document(
                &created.id,
                created.date_modified,
                "A stale result that is longer than both previous article bodies but must not win.",
                richer_metadata,
            )
            .await
            .expect("reject stale"));
    }

    #[tokio::test]
    async fn browser_document_content_survives_reopening_the_database() {
        let temp = tempfile::tempdir().expect("tempdir");
        let path = temp.path().join("browser-import.sqlite");
        let document_id;

        {
            let db = Database::new(path.clone()).await.expect("first database");
            db.migrate().await.expect("first migration");
            let repo = Repository::new(db.pool().clone());
            let mut doc = Document::new(
                "Persisted article".to_string(),
                "https://example.com/persisted".to_string(),
                FileType::Html,
            );
            doc.content = Some("Article text stored on the parent document.".to_string());
            doc.metadata = Some(DocumentMetadata {
                source: Some("browser_extension".to_string()),
                article_html: Some(
                    "<article>Article text stored on the parent document.</article>".to_string(),
                ),
                ..Default::default()
            });
            document_id = repo.create_document(&doc).await.expect("create").id;
            assert!(repo
                .list_extracts_by_document(&document_id)
                .await
                .expect("extracts")
                .is_empty());
            db.pool().close().await;
        }

        let reopened = Database::new(path).await.expect("reopened database");
        reopened.migrate().await.expect("reopened migration");
        let repo = Repository::new(reopened.pool().clone());
        let doc = repo
            .get_document(&document_id)
            .await
            .expect("get")
            .expect("document");
        assert_eq!(
            doc.content.as_deref(),
            Some("Article text stored on the parent document.")
        );
        assert!(repo
            .list_extracts_by_document(&document_id)
            .await
            .expect("extracts")
            .is_empty());
    }
}
