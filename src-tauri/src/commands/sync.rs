//! Cross-device sync projection commands.
//!
//! These are the receiving-side counterparts to the frontend `replicatedMap`
//! factory: when a remote Yjs entry arrives and passes the conflict check, the
//! TS layer calls one of these `upsert_synced_*` commands to write the row into
//! local SQLite. Each mirrors `upsert_synced_document` — it trusts the incoming
//! id (entities share identity across devices) and does an `INSERT OR REPLACE`,
//! because conflict resolution (last-writer-wins on the sync clock) already
//! happened on the caller side.
//!
//! `upsert_synced_review_result` is the exception: it uses `INSERT OR IGNORE`
//! against a unique `(item_id, reviewed_at_ms, device_id)` index so the same
//! review event arriving twice (a device replays its update after reconnect)
//! collapses to exactly one row. This is what makes multi-device review streams
//! merge without double-counting.

use chrono::{DateTime, Utc};
use tauri::State;
use uuid::Uuid;

use crate::commands::Result;
use crate::database::Repository;
use crate::models::collection::Collection;
use crate::models::{Extract, LearningItem};

/// Wire shape for an RSS article's synced state (field-level LWW). Only the
/// load-bearing user state is carried — `is_read`/`is_queued` plus their
/// transition clocks. Article *content* (HTML) is NEVER replicated; each device
/// re-fetches it from the feed. This keeps the shared CRDT doc small (the same
/// lesson as stripping `content`/`coverImageUrl` from synced documents).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SyncedRssArticleState {
    pub id: String,
    pub feed_id: String,
    pub url: String,
    pub guid: Option<String>,
    pub title: String,
    pub author: Option<String>,
    pub published_date: Option<String>,
    pub image_url: Option<String>,
    pub is_read: bool,
    pub read_at: Option<String>,
    pub unread_at: Option<String>,
    pub is_queued: bool,
    pub queued_at: Option<String>,
    pub unqueued_at: Option<String>,
    pub updated_at: String,
    pub date_added: String,
}

impl SyncedRssArticleState {
    /// Timestamp to stamp on the article row when we create it on first sight.
    /// Falls back to `updated_at` (which is always present) if `date_added` is
    /// empty for any reason.
    fn date_added_or_now(&self) -> String {
        if self.date_added.is_empty() {
            self.updated_at.clone()
        } else {
            self.date_added.clone()
        }
    }
}

/// Wire shape for a synced RSS feed (whole-row LWW on updated_at). Soft-deleted
/// via the `deleted_at` flag (the Yjs tombstone; late joiners learn the feed is
/// gone rather than re-subscribing from a stale local row).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SyncedRssFeed {
    pub id: String,
    pub url: String,
    pub title: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub update_interval: i32,
    pub last_fetched: Option<String>,
    pub is_active: bool,
    pub date_added: String,
    pub auto_queue: bool,
    pub auto_fetch_full_content: Option<String>,
    pub collection_id: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

/// Return this install's stable device id, creating it on first call. Persisted
/// in the single-row `sync_device_id` table so it survives cache clears and is
/// shared across windows on the same install. Used as the tiebreaker in
/// deterministic review ids and in sync-clock comparisons.
#[tauri::command]
pub async fn get_or_create_sync_device_id(repo: State<'_, Repository>) -> Result<String> {
    // Fast path: already exists.
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT value FROM sync_device_id WHERE id = 1")
            .fetch_optional(repo.pool())
            .await?;
    if let Some((value,)) = existing {
        return Ok(value);
    }

    // Create. Use UPSERT so two concurrent first-calls don't race.
    let value = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    sqlx::query("INSERT OR IGNORE INTO sync_device_id (id, value, created_at) VALUES (1, ?1, ?2)")
        .bind(&value)
        .bind(&now)
        .execute(repo.pool())
        .await?;

    // Re-read in case another call won the race (its value is canonical).
    let canonical: Option<(String,)> =
        sqlx::query_as("SELECT value FROM sync_device_id WHERE id = 1")
            .fetch_optional(repo.pool())
            .await?;
    Ok(canonical.map(|(v,)| v).unwrap_or(value))
}

/// Insert or replace a learning item received from another device via sync.
/// Trusts the incoming id; conflict resolution by `updated_at` happened on the
/// caller side. This is the flashcard-state replication path: a card reviewed on
/// device A appears with its new due date / reps / stability on device B.
#[tauri::command]
pub async fn upsert_synced_learning_item(
    item: LearningItem,
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
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
            is_suspended, tags, image_asset_ids, interaction_metadata,
            memory_state_stability, memory_state_difficulty,
            algorithm_type, algorithm_state, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28)
        ON CONFLICT(id) DO UPDATE SET
            collection_id = excluded.collection_id,
            extract_id = excluded.extract_id,
            document_id = excluded.document_id,
            item_type = excluded.item_type,
            question = excluded.question,
            answer = excluded.answer,
            cloze_text = excluded.cloze_text,
            cloze_ranges = excluded.cloze_ranges,
            difficulty = excluded.difficulty,
            interval = excluded.interval,
            ease_factor = excluded.ease_factor,
            due_date = excluded.due_date,
            date_created = excluded.date_created,
            date_modified = excluded.date_modified,
            last_review_date = excluded.last_review_date,
            review_count = excluded.review_count,
            lapses = excluded.lapses,
            state = excluded.state,
            is_suspended = excluded.is_suspended,
            tags = excluded.tags,
            image_asset_ids = excluded.image_asset_ids,
            interaction_metadata = excluded.interaction_metadata,
            memory_state_stability = excluded.memory_state_stability,
            memory_state_difficulty = excluded.memory_state_difficulty,
            algorithm_type = excluded.algorithm_type,
            algorithm_state = excluded.algorithm_state,
            updated_at = excluded.updated_at
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
    .execute(repo.pool())
    .await?;

    Ok(item)
}

/// Soft-delete (tombstone) a learning item that was deleted on another device.
/// Marks the local row deleted by removing it; the Yjs tombstone ensures a
/// freshly-installed device also learns the card is gone rather than re-adding
/// it from a stale local replica.
#[tauri::command]
pub async fn delete_synced_learning_item(id: String, repo: State<'_, Repository>) -> Result<()> {
    sqlx::query("DELETE FROM learning_items WHERE id = ?1")
        .bind(&id)
        .execute(repo.pool())
        .await?;
    Ok(())
}

/// A single review event, as replicated across devices. The wire shape the TS
/// layer publishes into the `reviews` Yjs map. `reviewed_at_ms` and `device_id`
/// together form the deterministic id (see `syncClock.ts`); the unique index on
/// `(item_id, reviewed_at_ms, device_id)` makes upserts idempotent.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SyncedReviewResult {
    pub id: String,
    pub collection_id: String,
    pub session_id: Option<String>,
    pub item_id: String,
    pub rating: i32,
    pub time_taken: i32,
    pub new_due_date: DateTime<Utc>,
    pub new_interval: f64,
    pub new_ease_factor: f64,
    pub timestamp: DateTime<Utc>,
    pub reviewed_at_ms: i64,
    pub device_id: String,
    #[serde(default)]
    pub schedule_source: Option<String>,
    #[serde(default)]
    pub schedule_model_id: Option<String>,
    #[serde(default)]
    pub arena_commit_id: Option<String>,
    #[serde(default)]
    pub arena_recommended_interval: Option<f64>,
    #[serde(default)]
    pub arena_decision_time_ms: Option<i64>,
    #[serde(default)]
    pub arena_snapshot: Option<String>,
}

/// Insert a review event received from another device, idempotently. Uses
/// `INSERT OR IGNORE` against the unique `(item_id, reviewed_at_ms, device_id)`
/// index so a replayed update collapses to one row — the core of correct
/// multi-device review-history merge (two devices reviewing the same card both
/// count once; the same review arriving twice counts once).
#[tauri::command]
pub async fn upsert_synced_review_result(
    review: SyncedReviewResult,
    repo: State<'_, Repository>,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO review_results (
            id, collection_id, session_id, item_id, rating, time_taken,
            new_due_date, new_interval, new_ease_factor, timestamp,
            reviewed_at_ms, device_id, schedule_source, schedule_model_id,
            arena_commit_id, arena_recommended_interval,
            arena_decision_time_ms, arena_snapshot
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
            ?13, ?14, ?15, ?16, ?17, ?18
        )
        "#,
    )
    .bind(&review.id)
    .bind(&review.collection_id)
    .bind(&review.session_id)
    .bind(&review.item_id)
    .bind(review.rating)
    .bind(review.time_taken)
    .bind(review.new_due_date)
    .bind(review.new_interval)
    .bind(review.new_ease_factor)
    .bind(review.timestamp)
    .bind(review.reviewed_at_ms)
    .bind(&review.device_id)
    .bind(&review.schedule_source)
    .bind(&review.schedule_model_id)
    .bind(&review.arena_commit_id)
    .bind(review.arena_recommended_interval)
    .bind(review.arena_decision_time_ms)
    .bind(&review.arena_snapshot)
    .execute(repo.pool())
    .await?;
    Ok(())
}

/// Read a learning item by id for the sync conflict check. Returns the row (with
/// its `updated_at` sync clock) or null if absent. Cheaper than the store-based
/// loaders and avoids depending on frontend state being warm.
#[tauri::command]
pub async fn get_synced_learning_item(
    id: String,
    repo: State<'_, Repository>,
) -> Result<Option<LearningItem>> {
    let row = sqlx::query("SELECT * FROM learning_items WHERE id = ?1")
        .bind(&id)
        .fetch_optional(repo.pool())
        .await?;
    match row {
        Some(row) => Ok(Some(Repository::row_to_learning_item(&row)?)),
        None => Ok(None),
    }
}

/// Upsert a synced RSS feed (whole-row LWW already resolved on the caller side
/// by `updated_at`). If a local feed with the same `url` already exists under a
/// different id, merge into the existing row so we don't create a duplicate
/// subscription. Trusts the incoming id when no url-collision exists.
#[tauri::command]
pub async fn upsert_synced_rss_feed(
    feed: SyncedRssFeed,
    repo: State<'_, Repository>,
) -> Result<()> {
    // Dedupe by url: prefer an existing local row with the same url so a feed
    // subscribed independently on two devices converges to one row.
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT id FROM rss_feeds WHERE url = ?1 AND id != ?2")
            .bind(&feed.url)
            .bind(&feed.id)
            .fetch_optional(repo.pool())
            .await?;
    let id = existing.map(|(i,)| i).unwrap_or_else(|| feed.id.clone());

    sqlx::query(
        r#"
        INSERT INTO rss_feeds (
            id, url, title, description, category, update_interval,
            last_fetched, is_active, date_added, auto_queue,
            auto_fetch_full_content, collection_id, updated_at, deleted_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        ON CONFLICT(id) DO UPDATE SET
            url = excluded.url,
            title = excluded.title,
            description = excluded.description,
            category = excluded.category,
            update_interval = excluded.update_interval,
            last_fetched = excluded.last_fetched,
            is_active = excluded.is_active,
            date_added = excluded.date_added,
            auto_queue = excluded.auto_queue,
            auto_fetch_full_content = excluded.auto_fetch_full_content,
            collection_id = excluded.collection_id,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at
        "#,
    )
    .bind(&id)
    .bind(&feed.url)
    .bind(&feed.title)
    .bind(&feed.description)
    .bind(&feed.category)
    .bind(feed.update_interval)
    .bind(&feed.last_fetched)
    .bind(feed.is_active)
    .bind(&feed.date_added)
    .bind(feed.auto_queue)
    .bind(&feed.auto_fetch_full_content)
    .bind(&feed.collection_id)
    .bind(&feed.updated_at)
    .bind(&feed.deleted_at)
    .execute(repo.pool())
    .await?;
    Ok(())
}

/// Upsert a synced RSS article's user state. The article row is created if
/// absent (so a feed's articles appear on a freshly-installed device); only the
/// lightweight state is carried. Field-level LWW (is_read by read_at/unread_at,
/// is_queued by queued_at/unqueued_at) was already resolved by the TS factory's
/// `mergeFieldLww`, so here we trust the merged values.
#[tauri::command]
pub async fn upsert_synced_rss_article_state(
    state: SyncedRssArticleState,
    repo: State<'_, Repository>,
) -> Result<()> {
    // Insert the article if missing (content left NULL — re-fetched locally).
    // `INSERT OR IGNORE` keeps an existing row's content/intelligence_score.
    sqlx::query(
        r#"INSERT OR IGNORE INTO rss_articles
           (id, feed_id, url, guid, title, author, published_date, content,
            summary, image_url, is_queued, is_read, date_added)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, ?8, 0, 0, ?9)"#,
    )
    .bind(&state.id)
    .bind(&state.feed_id)
    .bind(&state.url)
    .bind(&state.guid)
    .bind(&state.title)
    .bind(&state.author)
    .bind(&state.published_date)
    .bind(&state.image_url)
    .bind(&state.date_added_or_now())
    .execute(repo.pool())
    .await?;

    // Apply the merged user state + clocks.
    sqlx::query(
        r#"
        UPDATE rss_articles SET
            is_read = ?1, read_at = ?2, unread_at = ?3,
            is_queued = ?4, queued_at = ?5, unqueued_at = ?6,
            updated_at = ?7
        WHERE id = ?8
        "#,
    )
    .bind(state.is_read)
    .bind(&state.read_at)
    .bind(&state.unread_at)
    .bind(state.is_queued)
    .bind(&state.queued_at)
    .bind(&state.unqueued_at)
    .bind(&state.updated_at)
    .bind(&state.id)
    .execute(repo.pool())
    .await?;
    Ok(())
}

/// Read an RSS article's state for the field-LWW conflict check.
#[tauri::command]
pub async fn get_synced_rss_article_state(
    id: String,
    repo: State<'_, Repository>,
) -> Result<Option<SyncedRssArticleState>> {
    let row = sqlx::query(
        r#"SELECT id, feed_id, url, guid, title, author, published_date, image_url,
                  is_read, read_at, unread_at, is_queued, queued_at, unqueued_at,
                  updated_at, date_added
           FROM rss_articles WHERE id = ?1"#,
    )
    .bind(&id)
    .fetch_optional(repo.pool())
    .await?;
    match row {
        Some(row) => {
            use sqlx::Row;
            Ok(Some(SyncedRssArticleState {
                id: row.try_get("id")?,
                feed_id: row.try_get("feed_id")?,
                url: row.try_get("url")?,
                guid: row.try_get("guid").ok(),
                title: row.try_get("title")?,
                author: row.try_get("author").ok(),
                published_date: row.try_get("published_date").ok(),
                image_url: row.try_get("image_url").ok(),
                is_read: row.try_get::<i64, _>("is_read").unwrap_or(0) != 0,
                read_at: row.try_get("read_at").ok(),
                unread_at: row.try_get("unread_at").ok(),
                is_queued: row.try_get::<i64, _>("is_queued").unwrap_or(0) != 0,
                queued_at: row.try_get("queued_at").ok(),
                unqueued_at: row.try_get("unqueued_at").ok(),
                updated_at: row.try_get("updated_at").ok().unwrap_or_default(),
                date_added: row.try_get("date_added").ok().unwrap_or_default(),
            }))
        }
        None => Ok(None),
    }
}

/// Wire shape for a synced podcast feed (whole-row LWW on updated_at + tombstone
/// via deleted_at). Subscribing/unsubscribing propagates across devices.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedPodcastFeed {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub author: Option<String>,
    pub language: Option<String>,
    pub link: Option<String>,
    pub feed_url: String,
    pub last_fetched: Option<String>,
    pub subscribed_at: String,
    pub sort_order: i32,
    pub auto_transcribe: bool,
    pub transcribe_language: Option<String>,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedTranscriptSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub word_timings_json: Option<String>,
}

/// Wire shape for a synced podcast episode. The high-churn fields (`played`,
/// `playback_position`, `download_intent`) each resolve by their own per-field
/// clock; `download_intent` is the synced "should be downloaded" flag — each
/// device honors it subject to its own wifi/storage settings; audio bytes are
/// NEVER replicated.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedPodcastEpisode {
    pub id: String,
    pub feed_id: String,
    pub guid: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub published_date: Option<String>,
    pub duration: Option<i64>,
    pub audio_url: String,
    pub audio_type: Option<String>,
    pub file_size: Option<i64>,
    pub image_url: Option<String>,
    pub link: Option<String>,
    pub played: bool,
    pub played_at: Option<String>,
    pub unplayed_at: Option<String>,
    pub playback_position: f64,
    pub position_updated_at: Option<String>,
    pub download_intent: i64,
    pub download_intent_at: Option<String>,
    pub download_intent_device: Option<String>,
    pub date_added: String,
    pub updated_at: String,
    pub transcript_text: Option<String>,
    pub transcript_status: Option<String>,
    pub transcript_error: Option<String>,
    pub transcribed_at: Option<String>,
    pub segments: Option<Vec<SyncedTranscriptSegment>>,
}

/// Upsert a synced podcast feed (whole-row LWW already resolved by the TS
/// factory). Dedupes by `feed_url` so a podcast subscribed on two devices
/// converges to one row. `deleted_at` carries the unsubscribe tombstone.
#[tauri::command]
pub async fn upsert_synced_podcast_feed(
    feed: SyncedPodcastFeed,
    repo: State<'_, Repository>,
) -> Result<()> {
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT id FROM podcast_feeds WHERE feed_url = ?1 AND id != ?2")
            .bind(&feed.feed_url)
            .bind(&feed.id)
            .fetch_optional(repo.pool())
            .await?;
    let id = existing.map(|(i,)| i).unwrap_or_else(|| feed.id.clone());

    sqlx::query(
        r#"
        INSERT INTO podcast_feeds (
            id, title, description, image_url, author, language, link, feed_url,
            last_fetched, subscribed_at, sort_order, auto_transcribe,
            transcribe_language, updated_at, deleted_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            description = excluded.description,
            image_url = excluded.image_url,
            author = excluded.author,
            language = excluded.language,
            link = excluded.link,
            feed_url = excluded.feed_url,
            last_fetched = excluded.last_fetched,
            subscribed_at = excluded.subscribed_at,
            sort_order = excluded.sort_order,
            auto_transcribe = excluded.auto_transcribe,
            transcribe_language = excluded.transcribe_language,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at
        "#,
    )
    .bind(&id)
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
    .bind(feed.auto_transcribe)
    .bind(&feed.transcribe_language)
    .bind(&feed.updated_at)
    .bind(&feed.deleted_at)
    .execute(repo.pool())
    .await?;
    Ok(())
}

/// Upsert a synced podcast episode. Creates the episode row if missing (so a
/// feed's episodes appear on a freshly-installed device), then applies the
/// field-LWW-resolved played/position/download_intent state + clocks.
///
/// CRITICAL dedup: each device assigns its own random UUID when it parses a
/// feed (see `insert_podcast_episode`), so the SAME logical episode arrives
/// under different `ep.id` values from different devices. Naively trusting
/// `ep.id` (the original `INSERT OR IGNORE ... id = ep.id`) created one row
/// per publishing device — a podcast subscribed on three devices triplicated
/// every episode on each receiver. We resolve the canonical id by the episode's
/// *natural* key first — `(feed_id, guid)` when a guid is present, else
/// `(feed_id, audio_url)` — exactly mirroring how `upsert_synced_podcast_feed`
/// dedupes by `feed_url`. SQLite treats NULL guids as distinct under UNIQUE,
/// so we must not rely on the `UNIQUE(feed_id, guid)` index alone for episodes
/// whose guid is missing.
#[tauri::command]
pub async fn upsert_synced_podcast_episode(
    ep: SyncedPodcastEpisode,
    repo: State<'_, Repository>,
) -> Result<()> {
    // Resolve the canonical local id for this logical episode. Prefer guid
    // (the RSS-standard episode identity); fall back to audio_url (universally
    // present, unique within a feed in practice).
    let existing: Option<(String,)> = if ep.guid.as_deref().filter(|g| !g.is_empty()).is_some() {
        sqlx::query_as(
            "SELECT id FROM podcast_episodes WHERE feed_id = ?1 AND guid = ?2 AND id != ?3",
        )
        .bind(&ep.feed_id)
        .bind(&ep.guid)
        .bind(&ep.id)
        .fetch_optional(repo.pool())
        .await?
    } else {
        sqlx::query_as(
            "SELECT id FROM podcast_episodes WHERE feed_id = ?1 AND audio_url = ?2 AND id != ?3",
        )
        .bind(&ep.feed_id)
        .bind(&ep.audio_url)
        .bind(&ep.id)
        .fetch_optional(repo.pool())
        .await?
    };
    let id = existing.map(|(i,)| i).unwrap_or_else(|| ep.id.clone());

    // Insert the episode row if missing.
    sqlx::query(
        r#"INSERT OR IGNORE INTO podcast_episodes
           (id, feed_id, guid, title, description, published_date, duration,
            audio_url, audio_type, file_size, image_url, link, played,
            playback_position, date_added, transcript_text, transcript_status,
            transcript_error, transcribed_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, 0.0, ?13, ?14, ?15, ?16, ?17)"#,
    )
    .bind(&id)
    .bind(&ep.feed_id)
    .bind(&ep.guid)
    .bind(&ep.title)
    .bind(&ep.description)
    .bind(&ep.published_date)
    .bind(ep.duration)
    .bind(&ep.audio_url)
    .bind(&ep.audio_type)
    .bind(ep.file_size)
    .bind(&ep.image_url)
    .bind(&ep.link)
    .bind(&ep.date_added)
    .bind(&ep.transcript_text)
    .bind(&ep.transcript_status)
    .bind(&ep.transcript_error)
    .bind(&ep.transcribed_at)
    .execute(repo.pool())
    .await?;

    sqlx::query(
        r#"
        UPDATE podcast_episodes SET
            played = ?1, played_at = ?2, unplayed_at = ?3,
            playback_position = ?4, position_updated_at = ?5,
            download_intent = ?6, download_intent_at = ?7, download_intent_device = ?8,
            updated_at = ?9,
            transcript_text = ?10,
            transcript_status = ?11,
            transcript_error = ?12,
            transcribed_at = ?13
        WHERE id = ?14
        "#,
    )
    .bind(ep.played)
    .bind(&ep.played_at)
    .bind(&ep.unplayed_at)
    .bind(ep.playback_position)
    .bind(&ep.position_updated_at)
    .bind(ep.download_intent)
    .bind(&ep.download_intent_at)
    .bind(&ep.download_intent_device)
    .bind(&ep.updated_at)
    .bind(&ep.transcript_text)
    .bind(&ep.transcript_status)
    .bind(&ep.transcript_error)
    .bind(&ep.transcribed_at)
    .bind(&id)
    .execute(repo.pool())
    .await?;

    if let Some(segs) = ep.segments {
        // Delete existing segments
        sqlx::query("DELETE FROM podcast_transcript_segments WHERE episode_id = ?1")
            .bind(&id)
            .execute(repo.pool())
            .await?;
        // Insert new segments
        for (index, seg) in segs.into_iter().enumerate() {
            sqlx::query(
                r#"INSERT INTO podcast_transcript_segments
                   (episode_id, segment_index, start_ms, end_ms, text, word_timings_json)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
            )
            .bind(&id)
            .bind(index as i32)
            .bind(seg.start_ms)
            .bind(seg.end_ms)
            .bind(&seg.text)
            .bind(&seg.word_timings_json)
            .execute(repo.pool())
            .await?;
        }
    }

    Ok(())
}

/// Read a podcast episode's synced state for the field-LWW conflict check.
#[tauri::command]
pub async fn get_synced_podcast_episode(
    id: String,
    repo: State<'_, Repository>,
) -> Result<Option<SyncedPodcastEpisode>> {
    let row = sqlx::query(
        r#"SELECT id, feed_id, guid, title, description, published_date, duration,
                  audio_url, audio_type, file_size, image_url, link, played,
                  played_at, unplayed_at, playback_position, position_updated_at,
                  download_intent, download_intent_at, download_intent_device,
                  date_added, updated_at,
                  transcript_text, transcript_status, transcript_error, transcribed_at
           FROM podcast_episodes WHERE id = ?1"#,
    )
    .bind(&id)
    .fetch_optional(repo.pool())
    .await?;
    match row {
        Some(row) => {
            use sqlx::Row;
            let transcript_status: Option<String> = row.try_get("transcript_status").ok();
            let mut segments = None;
            if let Some(ref status) = transcript_status {
                if status == "done" {
                    let seg_rows = sqlx::query(
                        "SELECT start_ms, end_ms, text, word_timings_json FROM podcast_transcript_segments WHERE episode_id = ?1 ORDER BY segment_index ASC"
                    )
                    .bind(&id)
                    .fetch_all(repo.pool())
                    .await?;
                    let mut segs = Vec::new();
                    for r in seg_rows {
                        segs.push(SyncedTranscriptSegment {
                            start_ms: r.try_get("start_ms")?,
                            end_ms: r.try_get("end_ms")?,
                            text: r.try_get("text")?,
                            word_timings_json: r.try_get("word_timings_json").ok(),
                        });
                    }
                    segments = Some(segs);
                }
            }

            Ok(Some(SyncedPodcastEpisode {
                id: row.try_get("id")?,
                feed_id: row.try_get("feed_id")?,
                guid: row.try_get("guid").ok(),
                title: row.try_get("title")?,
                description: row.try_get("description").ok(),
                published_date: row.try_get("published_date").ok(),
                duration: row.try_get("duration").ok(),
                audio_url: row.try_get("audio_url")?,
                audio_type: row.try_get("audio_type").ok(),
                file_size: row.try_get("file_size").ok(),
                image_url: row.try_get("image_url").ok(),
                link: row.try_get("link").ok(),
                played: row.try_get::<i64, _>("played").unwrap_or(0) != 0,
                played_at: row.try_get("played_at").ok(),
                unplayed_at: row.try_get("unplayed_at").ok(),
                playback_position: row.try_get("playback_position").unwrap_or(0.0),
                position_updated_at: row.try_get("position_updated_at").ok(),
                download_intent: row.try_get("download_intent").unwrap_or(0),
                download_intent_at: row.try_get("download_intent_at").ok(),
                download_intent_device: row.try_get("download_intent_device").ok(),
                date_added: row.try_get("date_added").ok().unwrap_or_default(),
                updated_at: row.try_get("updated_at").ok().unwrap_or_default(),
                transcript_text: row.try_get("transcript_text").ok(),
                transcript_status: row.try_get("transcript_status").ok(),
                transcript_error: row.try_get("transcript_error").ok(),
                transcribed_at: row.try_get("transcribed_at").ok(),
                segments,
            }))
        }
        None => Ok(None),
    }
}

/// Count reviews recorded for an item (used by migration/status UI). Cheap
/// aggregate over the revlog.
#[tauri::command]
pub async fn count_review_results(
    item_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<i64> {
    let count: (i64,) = if let Some(id) = item_id {
        sqlx::query_as("SELECT COUNT(*) FROM review_results WHERE item_id = ?1")
            .bind(&id)
            .fetch_one(repo.pool())
            .await?
    } else {
        sqlx::query_as("SELECT COUNT(*) FROM review_results")
            .fetch_one(repo.pool())
            .await?
    };
    Ok(count.0)
}

/// Insert or replace an extract received from another device via sync.
/// Trusts the incoming id; conflict resolution by `date_modified` happens on the
/// caller side.
#[tauri::command]
pub async fn upsert_synced_extract(
    extract: Extract,
    repo: State<'_, Repository>,
) -> Result<Extract> {
    let upserted = repo.upsert_synced_extract(&extract).await?;
    Ok(upserted)
}

/// Delete an extract received from another device via sync.
#[tauri::command]
pub async fn delete_synced_extract(id: String, repo: State<'_, Repository>) -> Result<()> {
    repo.delete_extract(&id).await?;
    Ok(())
}

/// Read an extract by id for the sync conflict check.
#[tauri::command]
pub async fn get_synced_extract(
    id: String,
    repo: State<'_, Repository>,
) -> Result<Option<Extract>> {
    let row = repo.get_extract(&id).await?;
    Ok(row)
}

/// Insert or replace a collection received from another device via sync.
/// Trusts the incoming id; conflict resolution by `updated_at` happens on the
/// caller side.
#[tauri::command]
pub async fn upsert_synced_collection(
    collection: Collection,
    repo: State<'_, Repository>,
) -> Result<Collection> {
    let upserted = repo.upsert_synced_collection(&collection).await?;
    Ok(upserted)
}

/// Delete a collection received from another device via sync.
#[tauri::command]
pub async fn delete_synced_collection(id: String, repo: State<'_, Repository>) -> Result<()> {
    repo.delete_collection(&id).await?;
    Ok(())
}

/// Read a collection by id for the sync conflict check.
#[tauri::command]
pub async fn get_synced_collection(
    id: String,
    repo: State<'_, Repository>,
) -> Result<Option<Collection>> {
    let row = repo.get_collection(&id).await?;
    Ok(row)
}

/// Retrieve the clocks (updated_at) for all learning items in the database in bulk.
/// Used by the frontend to populate its startup clock cache.
#[tauri::command]
pub async fn get_all_learning_item_clocks(
    repo: State<'_, Repository>,
) -> Result<std::collections::HashMap<String, String>> {
    let rows: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT id, updated_at FROM learning_items")
            .fetch_all(repo.pool())
            .await?;

    let mut map = std::collections::HashMap::new();
    for (id, updated_at) in rows {
        if let Some(ua) = updated_at {
            map.insert(id, ua);
        }
    }
    Ok(map)
}

/// Retrieve the clocks (date_modified) for all documents in the database in bulk.
/// Used by the frontend to populate its startup clock cache.
#[tauri::command]
pub async fn get_all_document_clocks(
    repo: State<'_, Repository>,
) -> Result<std::collections::HashMap<String, String>> {
    let rows: Vec<(String, Option<DateTime<Utc>>)> =
        sqlx::query_as("SELECT id, date_modified FROM documents")
            .fetch_all(repo.pool())
            .await?;

    let mut map = std::collections::HashMap::new();
    for (id, date_modified) in rows {
        if let Some(dm) = date_modified {
            map.insert(id, dm.to_rfc3339());
        }
    }
    Ok(map)
}

/// Insert a batch of review events received from another device, idempotently
/// within a single SQLite transaction to optimize disk fsync overhead.
#[tauri::command]
pub async fn upsert_synced_review_results_batch(
    reviews: Vec<SyncedReviewResult>,
    repo: State<'_, Repository>,
) -> Result<()> {
    if reviews.is_empty() {
        return Ok(());
    }

    let mut tx = repo.pool().begin().await?;

    for review in reviews {
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO review_results (
                id, collection_id, session_id, item_id, rating, time_taken,
                new_due_date, new_interval, new_ease_factor, timestamp,
                reviewed_at_ms, device_id, schedule_source, schedule_model_id,
                arena_commit_id, arena_recommended_interval,
                arena_decision_time_ms, arena_snapshot
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                ?13, ?14, ?15, ?16, ?17, ?18
            )
            "#,
        )
        .bind(&review.id)
        .bind(&review.collection_id)
        .bind(&review.session_id)
        .bind(&review.item_id)
        .bind(review.rating)
        .bind(review.time_taken)
        .bind(review.new_due_date)
        .bind(review.new_interval)
        .bind(review.new_ease_factor)
        .bind(review.timestamp)
        .bind(review.reviewed_at_ms)
        .bind(&review.device_id)
        .bind(&review.schedule_source)
        .bind(&review.schedule_model_id)
        .bind(&review.arena_commit_id)
        .bind(review.arena_recommended_interval)
        .bind(review.arena_decision_time_ms)
        .bind(&review.arena_snapshot)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

/// The subset of a `learning_items` row that the queue auto-postpone engine
/// reads. Returning a projected slice (instead of `SELECT *`) keeps the full
/// card body — question/answer/cloze text, tags, image assets, interaction
/// metadata — out of the WebView heap on the bulk postpone path.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PostponeLearningItem {
    pub id: String,
    pub interval: f64,
    pub difficulty: f64,
    pub ease_factor: f64,
    pub review_count: i64,
    pub lapses: i64,
    pub last_review_date: Option<String>,
    pub memory_state_stability: Option<f64>,
    pub memory_state_difficulty: Option<f64>,
}

/// Server-side filter for learning items modified after an HLC timestamp.
///
/// `publishRecentlyModifiedCards` previously called `get_all_learning_items`
/// (a full `SELECT *` of the table including cloze/answer/tags text) and then
/// filtered client-side by `updated_at > since`. That pulled the entire library
/// into the WebView heap on every bulk queue action. This returns only the ids
/// newer than the cutoff (the `idx_learning_items_updated_at` index serves it),
/// so the caller can re-fetch full rows for just the handful of survivors.
#[tauri::command]
pub async fn get_learning_item_ids_modified_since(
    since_hlc: String,
    repo: State<'_, Repository>,
) -> Result<Vec<String>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT id FROM learning_items WHERE updated_at > ?1 ORDER BY updated_at ASC")
            .bind(since_hlc)
            .fetch_all(repo.pool())
            .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Fetch the projected scheduling fields for the given learning-item ids.
///
/// Used by the queue auto-postpone path, which previously called
/// `get_all_learning_items` and built a Map of full rows (with all card text)
/// just to read a few scheduling fields. This returns only those fields for the
/// ids actually in the queue, so none of the heavy text columns cross the IPC
/// boundary. An empty/missing id is simply absent from the result.
#[tauri::command]
pub async fn get_learning_items_for_postpone(
    ids: Vec<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<PostponeLearningItem>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    // Bind a variable-length IN(...) via SQLite's json_each to stay within
    // sqlx's bind limits regardless of queue size. Columns are read positionally
    // as a tuple to match the get_all_learning_item_clocks house style.
    let ids_json = serde_json::to_string(&ids)?;
    let rows: Vec<(
        String,
        f64,
        f64,
        f64,
        i64,
        i64,
        Option<String>,
        Option<f64>,
        Option<f64>,
    )> = sqlx::query_as(
        r#"
        SELECT
            li.id,
            li.interval,
            li.difficulty,
            li.ease_factor,
            li.review_count,
            li.lapses,
            li.last_review_date,
            li.memory_state_stability,
            li.memory_state_difficulty
        FROM learning_items AS li
        JOIN json_each(?1) AS j ON j.value = li.id
        WHERE li.is_suspended = 0
        "#,
    )
    .bind(ids_json)
    .fetch_all(repo.pool())
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(
                id,
                interval,
                difficulty,
                ease_factor,
                review_count,
                lapses,
                last_review_date,
                memory_state_stability,
                memory_state_difficulty,
            )| PostponeLearningItem {
                id,
                interval,
                difficulty,
                ease_factor,
                review_count,
                lapses,
                last_review_date,
                memory_state_stability,
                memory_state_difficulty,
            },
        )
        .collect())
}

#[cfg(test)]
mod arena_sync_tests {
    use super::SyncedReviewResult;
    use serde_json::json;

    fn base_review() -> serde_json::Value {
        json!({
            "id": "review-1",
            "collection_id": "collection-1",
            "session_id": null,
            "item_id": "card-1",
            "rating": 3,
            "time_taken": 8,
            "new_due_date": "2026-08-01T00:00:00Z",
            "new_interval": 12.0,
            "new_ease_factor": 2.5,
            "timestamp": "2026-07-20T00:00:00Z",
            "reviewed_at_ms": 1784505600000i64,
            "device_id": "device-a"
        })
    }

    #[test]
    fn arena_review_wire_fields_round_trip_and_legacy_events_remain_valid() {
        for (source, model_id) in [("arena", None), ("model", Some("sm19")), ("custom", None)] {
            let mut value = base_review();
            let object = value.as_object_mut().unwrap();
            object.insert("schedule_source".into(), json!(source));
            object.insert("schedule_model_id".into(), json!(model_id));
            object.insert("arena_commit_id".into(), json!(format!("commit-{source}")));
            object.insert("arena_recommended_interval".into(), json!(12.0));
            object.insert("arena_decision_time_ms".into(), json!(321));
            object.insert(
                "arena_snapshot".into(),
                json!(format!(r#"{{"version":1,"source":"{source}"}}"#)),
            );

            let review: SyncedReviewResult = serde_json::from_value(value).unwrap();
            assert_eq!(review.schedule_source.as_deref(), Some(source));
            assert_eq!(review.schedule_model_id.as_deref(), model_id);
            let encoded = serde_json::to_value(review).unwrap();
            assert_eq!(encoded["schedule_source"], source);
            assert_eq!(encoded["schedule_model_id"], json!(model_id));
            assert_eq!(encoded["arena_decision_time_ms"], 321);
        }

        let legacy: SyncedReviewResult = serde_json::from_value(base_review()).unwrap();
        assert!(legacy.schedule_source.is_none());
        assert!(legacy.schedule_model_id.is_none());
        assert!(legacy.arena_commit_id.is_none());
        assert!(legacy.arena_snapshot.is_none());
    }
}
