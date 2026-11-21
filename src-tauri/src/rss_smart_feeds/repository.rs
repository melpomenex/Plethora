//! SQLite repository operations for Smart Feeds, matches, feedback events,
//! feed-level embeddings, and JSON export/import.

use super::models::*;
use super::retrieval::build_safe_fts_query;
use crate::database::QueueItemEmbedding;
use crate::error::{PlethoraError, Result};
use chrono::Utc;
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};
use std::collections::{HashMap, HashSet};

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

fn embedding_to_bytes(v: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(v.len() * 4);
    for &f in v {
        bytes.extend_from_slice(&f.to_le_bytes());
    }
    bytes
}

fn bytes_to_embedding(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

fn row_to_smart_feed(row: &SqliteRow) -> Result<SmartFeed> {
    let scope_cfg_raw: String = row.try_get("source_scope_config")?;
    let source_scope_config: SourceScopeConfig =
        serde_json::from_str(&scope_cfg_raw).unwrap_or_default();
    Ok(SmartFeed {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        inclusion_criteria: row.try_get("inclusion_criteria")?,
        exclusion_criteria: row.try_get("exclusion_criteria")?,
        source_scope: SourceScope::from_str(&row.try_get::<String, _>("source_scope")?),
        source_scope_config,
        classification_mode: ClassificationMode::from_str(
            &row.try_get::<String, _>("classification_mode")?,
        ),
        curation_strictness: CurationStrictness::from_str(
            &row.try_get::<String, _>("curation_strictness")?,
        ),
        minimum_relevance: row.try_get("minimum_relevance")?,
        freshness_window_days: row.try_get("freshness_window_days")?,
        sort_order: SmartFeedSortOrder::from_str(&row.try_get::<String, _>("sort_order")?),
        group_similar_stories: row.try_get::<i64, _>("group_similar_stories")? != 0,
        is_enabled: row.try_get::<i64, _>("is_enabled")? != 0,
        cloud_consent_granted: row.try_get::<i64, _>("cloud_consent_granted")? != 0,
        preferred_provider: row.try_get("preferred_provider")?,
        preferred_model: row.try_get("preferred_model")?,
        definition_revision: row.try_get("definition_revision")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
        last_evaluated_at: row.try_get("last_evaluated_at")?,
    })
}

pub async fn create_feed(pool: &SqlitePool, input: CreateSmartFeedInput) -> Result<SmartFeed> {
    let name = input.name.trim().to_string();
    let description = input.description.trim().to_string();
    if name.is_empty() {
        return Err(PlethoraError::InvalidInput(
            "Smart Feed name is required".to_string(),
        ));
    }
    if input.source_scope == SourceScope::ExternalDiscovery {
        return Err(PlethoraError::InvalidInput(
            "External web discovery is not enabled; select all feeds, specific feeds, or folders."
                .to_string(),
        ));
    }
    if description.is_empty() && input.inclusion_criteria.trim().is_empty() {
        return Err(PlethoraError::InvalidInput(
            "Smart Feed description or inclusion criteria is required".to_string(),
        ));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let scope_cfg_json =
        serde_json::to_string(&input.source_scope_config).unwrap_or_else(|_| "{}".to_string());

    sqlx::query(
        r#"
        INSERT INTO rss_smart_feeds (
            id, name, description, inclusion_criteria, exclusion_criteria,
            source_scope, source_scope_config, classification_mode, curation_strictness,
            minimum_relevance, freshness_window_days, sort_order, group_similar_stories,
            is_enabled, cloud_consent_granted, preferred_provider, preferred_model,
            definition_revision, created_at, updated_at, last_evaluated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 1, ?18, ?18, NULL)
        "#,
    )
    .bind(&id)
    .bind(&name)
    .bind(&description)
    .bind(input.inclusion_criteria.trim())
    .bind(input.exclusion_criteria.trim())
    .bind(input.source_scope.as_str())
    .bind(&scope_cfg_json)
    .bind(input.classification_mode.as_str())
    .bind(input.curation_strictness.as_str())
    .bind(input.minimum_relevance)
    .bind(input.freshness_window_days)
    .bind(input.sort_order.as_str())
    .bind(if input.group_similar_stories { 1i64 } else { 0i64 })
    .bind(if input.is_enabled { 1i64 } else { 0i64 })
    .bind(if input.cloud_consent_granted { 1i64 } else { 0i64 })
    .bind(input.preferred_provider.as_deref())
    .bind(input.preferred_model.as_deref())
    .bind(&now)
    .execute(pool)
    .await?;

    get_feed(pool, &id).await
}

pub async fn get_feed(pool: &SqlitePool, id: &str) -> Result<SmartFeed> {
    let row = sqlx::query("SELECT * FROM rss_smart_feeds WHERE id = ?1")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| PlethoraError::NotFound(format!("Smart Feed '{}' not found", id)))?;
    row_to_smart_feed(&row)
}

pub async fn get_feed_with_stats(pool: &SqlitePool, id: &str) -> Result<SmartFeedWithStats> {
    let feed = get_feed(pool, id).await?;
    attach_stats(pool, vec![feed])
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| PlethoraError::NotFound(format!("Smart Feed '{}' not found", id)))
}

pub async fn list_feeds_with_stats(pool: &SqlitePool) -> Result<Vec<SmartFeedWithStats>> {
    let rows = sqlx::query("SELECT * FROM rss_smart_feeds ORDER BY created_at DESC")
        .fetch_all(pool)
        .await?;
    let mut feeds = Vec::with_capacity(rows.len());
    for row in rows {
        feeds.push(row_to_smart_feed(&row)?);
    }
    attach_stats(pool, feeds).await
}

async fn attach_stats(pool: &SqlitePool, feeds: Vec<SmartFeed>) -> Result<Vec<SmartFeedWithStats>> {
    if feeds.is_empty() {
        return Ok(Vec::new());
    }

    let agg_rows = sqlx::query(
        r#"
        SELECT
            m.smart_feed_id,
            SUM(CASE WHEN m.decision = 'INCLUDE' THEN 1 ELSE 0 END) AS matched_count,
            SUM(CASE WHEN m.decision = 'INCLUDE' AND a.is_read = 0 THEN 1 ELSE 0 END) AS unread_count,
            SUM(CASE WHEN m.decision = 'UNCERTAIN' THEN 1 ELSE 0 END) AS uncertain_count,
            SUM(CASE WHEN m.decision = 'EXCLUDE' THEN 1 ELSE 0 END) AS excluded_count,
            SUM(CASE WHEN m.decision = 'PENDING' OR m.evaluation_status IN ('pending', 'deferred', 'error') THEN 1 ELSE 0 END) AS pending_count,
            COUNT(DISTINCT CASE WHEN m.decision = 'INCLUDE' THEN a.feed_id END) AS source_feed_count,
            SUM(CASE WHEN m.evaluation_status = 'completed_lexical' THEN 1 ELSE 0 END) AS lexical_only_count
        FROM rss_smart_feed_matches m
        INNER JOIN rss_articles a ON a.id = m.article_id
        GROUP BY m.smart_feed_id
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut map: HashMap<String, (i64, i64, i64, i64, i64, i64, i64)> = HashMap::new();
    for r in agg_rows {
        let fid: String = r.try_get("smart_feed_id")?;
        map.insert(
            fid,
            (
                r.try_get::<Option<i64>, _>("matched_count")?.unwrap_or(0),
                r.try_get::<Option<i64>, _>("unread_count")?.unwrap_or(0),
                r.try_get::<Option<i64>, _>("uncertain_count")?.unwrap_or(0),
                r.try_get::<Option<i64>, _>("excluded_count")?.unwrap_or(0),
                r.try_get::<Option<i64>, _>("pending_count")?.unwrap_or(0),
                r.try_get::<Option<i64>, _>("source_feed_count")?
                    .unwrap_or(0),
                r.try_get::<Option<i64>, _>("lexical_only_count")?
                    .unwrap_or(0),
            ),
        );
    }

    Ok(feeds
        .into_iter()
        .map(|feed| {
            let (matched, unread, uncertain, excluded, pending, sources, lexical) =
                map.get(&feed.id).copied().unwrap_or((0, 0, 0, 0, 0, 0, 0));
            SmartFeedWithStats {
                feed,
                matched_count: matched,
                unread_count: unread,
                uncertain_count: uncertain,
                excluded_count: excluded,
                pending_count: pending,
                source_feed_count: sources,
                lexical_only_count: lexical,
            }
        })
        .collect())
}

/// Update a Smart Feed. Increments `definition_revision` and invalidates
/// definition embeddings (while preserving `rss_smart_feed_feedback` and
/// explicit user overrides!) whenever matching semantics change.
/// Returns `(updated_feed, definition_changed)`.
pub async fn update_feed(
    pool: &SqlitePool,
    id: &str,
    input: UpdateSmartFeedInput,
) -> Result<(SmartFeed, bool)> {
    let existing = get_feed(pool, id).await?;

    let name = input
        .name
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| existing.name.clone());
    if name.is_empty() {
        return Err(PlethoraError::InvalidInput(
            "Smart Feed name cannot be empty".to_string(),
        ));
    }
    let description = input
        .description
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| existing.description.clone());
    let inclusion_criteria = input
        .inclusion_criteria
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| existing.inclusion_criteria.clone());
    let exclusion_criteria = input
        .exclusion_criteria
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| existing.exclusion_criteria.clone());
    let source_scope = input.source_scope.unwrap_or(existing.source_scope);
    if source_scope == SourceScope::ExternalDiscovery {
        return Err(PlethoraError::InvalidInput(
            "External web discovery is not enabled; select all feeds, specific feeds, or folders."
                .to_string(),
        ));
    }
    let source_scope_config = input
        .source_scope_config
        .unwrap_or_else(|| existing.source_scope_config.clone());
    let classification_mode = input
        .classification_mode
        .unwrap_or(existing.classification_mode);
    let curation_strictness = input
        .curation_strictness
        .unwrap_or(existing.curation_strictness);
    let minimum_relevance = match input.minimum_relevance {
        Some(v) => v,
        None => existing.minimum_relevance,
    };
    let freshness_window_days = match input.freshness_window_days {
        Some(v) => v,
        None => existing.freshness_window_days,
    };
    let sort_order = input.sort_order.unwrap_or(existing.sort_order);
    let group_similar_stories = input
        .group_similar_stories
        .unwrap_or(existing.group_similar_stories);
    let is_enabled = input.is_enabled.unwrap_or(existing.is_enabled);
    let cloud_consent_granted = input
        .cloud_consent_granted
        .unwrap_or(existing.cloud_consent_granted);
    let preferred_provider = match input.preferred_provider {
        Some(v) => v,
        None => existing.preferred_provider.clone(),
    };
    let preferred_model = match input.preferred_model {
        Some(v) => v,
        None => existing.preferred_model.clone(),
    };

    let semantic_def_changed = name != existing.name
        || description != existing.description
        || inclusion_criteria != existing.inclusion_criteria
        || exclusion_criteria != existing.exclusion_criteria;

    let policy_changed = semantic_def_changed
        || source_scope != existing.source_scope
        || source_scope_config != existing.source_scope_config
        || classification_mode != existing.classification_mode
        || curation_strictness != existing.curation_strictness
        || minimum_relevance != existing.minimum_relevance
        || freshness_window_days != existing.freshness_window_days
        || preferred_provider != existing.preferred_provider
        || preferred_model != existing.preferred_model;

    let new_revision = if policy_changed {
        existing.definition_revision + 1
    } else {
        existing.definition_revision
    };

    let now = Utc::now().to_rfc3339();
    let scope_cfg_json =
        serde_json::to_string(&source_scope_config).unwrap_or_else(|_| "{}".to_string());

    let mut tx = pool.begin().await?;
    sqlx::query(
        r#"
        UPDATE rss_smart_feeds
        SET name = ?1,
            description = ?2,
            inclusion_criteria = ?3,
            exclusion_criteria = ?4,
            source_scope = ?5,
            source_scope_config = ?6,
            classification_mode = ?7,
            curation_strictness = ?8,
            minimum_relevance = ?9,
            freshness_window_days = ?10,
            sort_order = ?11,
            group_similar_stories = ?12,
            is_enabled = ?13,
            cloud_consent_granted = ?14,
            preferred_provider = ?15,
            preferred_model = ?16,
            definition_revision = ?17,
            updated_at = ?18
        WHERE id = ?19
        "#,
    )
    .bind(&name)
    .bind(&description)
    .bind(&inclusion_criteria)
    .bind(&exclusion_criteria)
    .bind(source_scope.as_str())
    .bind(&scope_cfg_json)
    .bind(classification_mode.as_str())
    .bind(curation_strictness.as_str())
    .bind(minimum_relevance)
    .bind(freshness_window_days)
    .bind(sort_order.as_str())
    .bind(if group_similar_stories { 1i64 } else { 0i64 })
    .bind(if is_enabled { 1i64 } else { 0i64 })
    .bind(if cloud_consent_granted { 1i64 } else { 0i64 })
    .bind(preferred_provider.as_deref())
    .bind(preferred_model.as_deref())
    .bind(new_revision)
    .bind(&now)
    .bind(id)
    .execute(&mut *tx)
    .await?;

    if semantic_def_changed {
        sqlx::query(
            "DELETE FROM rss_smart_feed_embeddings WHERE smart_feed_id = ?1 AND role IN ('positive', 'negative')",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }

    // If source scope narrowed, drop stale automated matches outside the new
    // scope while keeping user feedback overrides intact until resolved.
    if source_scope != existing.source_scope || source_scope_config != existing.source_scope_config
    {
        let allowed_feed_ids =
            resolve_allowed_feed_ids_conn(&mut tx, source_scope, &source_scope_config).await?;
        if let Some(allowed) = allowed_feed_ids {
            if allowed.is_empty() {
                sqlx::query(
                    "DELETE FROM rss_smart_feed_matches WHERE smart_feed_id = ?1 AND is_user_override = 0",
                )
                .bind(id)
                .execute(&mut *tx)
                .await?;
            } else {
                let placeholders: Vec<String> =
                    (0..allowed.len()).map(|i| format!("?{}", i + 2)).collect();
                let sql = format!(
                    "DELETE FROM rss_smart_feed_matches WHERE smart_feed_id = ?1 AND is_user_override = 0 AND article_id NOT IN (SELECT id FROM rss_articles WHERE feed_id IN ({}))",
                    placeholders.join(",")
                );
                let mut q = sqlx::query(&sql).bind(id);
                for fid in &allowed {
                    q = q.bind(fid);
                }
                q.execute(&mut *tx).await?;
            }
        }
    }

    tx.commit().await?;
    let updated = get_feed(pool, id).await?;
    Ok((updated, policy_changed))
}

pub async fn delete_feed(pool: &SqlitePool, id: &str) -> Result<()> {
    let res = sqlx::query("DELETE FROM rss_smart_feeds WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(PlethoraError::NotFound(format!(
            "Smart Feed '{}' not found",
            id
        )));
    }
    Ok(())
}

pub async fn touch_last_evaluated(pool: &SqlitePool, smart_feed_id: &str) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE rss_smart_feeds SET last_evaluated_at = ?1 WHERE id = ?2")
        .bind(&now)
        .bind(smart_feed_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Resolve concrete `feed_id` allowlist (`None` means all subscribed feeds).
pub async fn resolve_allowed_feed_ids(
    pool: &SqlitePool,
    scope: SourceScope,
    config: &SourceScopeConfig,
) -> Result<Option<HashSet<String>>> {
    let mut conn = pool.acquire().await?;
    resolve_allowed_feed_ids_conn(&mut conn, scope, config).await
}

async fn resolve_allowed_feed_ids_conn(
    conn: &mut sqlx::sqlite::SqliteConnection,
    scope: SourceScope,
    config: &SourceScopeConfig,
) -> Result<Option<HashSet<String>>> {
    match scope {
        SourceScope::All | SourceScope::ExternalDiscovery => Ok(None),
        SourceScope::SelectedFeeds => Ok(Some(config.feed_ids.iter().cloned().collect())),
        SourceScope::SelectedFolders => {
            if config.folder_ids.is_empty() {
                return Ok(Some(HashSet::new()));
            }
            // Include child folders recursively via BFS over rss_folders.
            let folder_rows = sqlx::query("SELECT id, parent_id FROM rss_folders")
                .fetch_all(&mut *conn)
                .await?;
            let mut children_map: HashMap<String, Vec<String>> = HashMap::new();
            for row in folder_rows {
                let id: String = row.try_get("id")?;
                let parent_id: Option<String> = row.try_get("parent_id")?;
                if let Some(pid) = parent_id {
                    children_map.entry(pid).or_default().push(id);
                }
            }
            let mut expanded_folders: HashSet<String> = config.folder_ids.iter().cloned().collect();
            let mut queue: Vec<String> = config.folder_ids.clone();
            while let Some(curr) = queue.pop() {
                if let Some(children) = children_map.get(&curr) {
                    for child in children {
                        if expanded_folders.insert(child.clone()) {
                            queue.push(child.clone());
                        }
                    }
                }
            }
            let folder_vec: Vec<String> = expanded_folders.into_iter().collect();
            let placeholders: Vec<String> = (0..folder_vec.len())
                .map(|i| format!("?{}", i + 1))
                .collect();
            let sql = format!(
                "SELECT DISTINCT feed_id FROM rss_feed_folders WHERE folder_id IN ({})",
                placeholders.join(",")
            );
            let mut q = sqlx::query_scalar::<_, String>(&sql);
            for fid in &folder_vec {
                q = q.bind(fid);
            }
            let mut feed_ids: HashSet<String> =
                q.fetch_all(&mut *conn).await?.into_iter().collect();
            // Also include any explicit feed_ids supplied alongside folder_ids.
            for explicit in &config.feed_ids {
                feed_ids.insert(explicit.clone());
            }
            Ok(Some(feed_ids))
        }
    }
}

fn row_to_scoped_article(row: &SqliteRow) -> Result<ScopedArticleRow> {
    let cats_raw: String = row
        .try_get("categories")
        .unwrap_or_else(|_| "[]".to_string());
    let categories: Vec<String> = serde_json::from_str(&cats_raw).unwrap_or_default();
    Ok(ScopedArticleRow {
        id: row.try_get("id")?,
        feed_id: row.try_get("feed_id")?,
        feed_title: row
            .try_get::<Option<String>, _>("feed_title")?
            .unwrap_or_default(),
        url: row.try_get("url")?,
        guid: row.try_get("guid")?,
        title: row.try_get("title")?,
        author: row.try_get("author")?,
        published_date: row.try_get("published_date")?,
        content: decode_optional_text(row, "content"),
        summary: decode_optional_text(row, "summary"),
        image_url: row.try_get("image_url")?,
        is_queued: row.try_get::<i64, _>("is_queued")? != 0,
        is_read: row.try_get::<i64, _>("is_read")? != 0,
        date_added: row.try_get("date_added")?,
        full_content: decode_optional_text(row, "full_content"),
        full_content_fetched_at: row.try_get("full_content_fetched_at").ok().flatten(),
        categories,
    })
}

pub async fn load_scoped_articles(
    pool: &SqlitePool,
    feed: &SmartFeed,
    article_ids_filter: Option<&[String]>,
) -> Result<Vec<ScopedArticleRow>> {
    let allowed_feeds =
        resolve_allowed_feed_ids(pool, feed.source_scope, &feed.source_scope_config).await?;
    if matches!(allowed_feeds, Some(ref s) if s.is_empty()) {
        return Ok(Vec::new());
    }

    let cutoff_iso = feed
        .freshness_window_days
        .filter(|&d| d > 0)
        .map(|days| (Utc::now() - chrono::Duration::days(i64::from(days))).to_rfc3339());

    let rows = if let Some(filter_ids) = article_ids_filter {
        if filter_ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut collected = Vec::new();
        for chunk in filter_ids.chunks(450) {
            let placeholders: Vec<String> =
                (0..chunk.len()).map(|i| format!("?{}", i + 1)).collect();
            let sql = format!(
                r#"
                SELECT a.*, COALESCE(f.title, '') AS feed_title
                FROM rss_articles a
                LEFT JOIN rss_feeds f ON f.id = a.feed_id
                WHERE a.id IN ({})
                ORDER BY COALESCE(a.published_date, a.date_added) DESC
                "#,
                placeholders.join(",")
            );
            let mut q = sqlx::query(&sql);
            for id in chunk {
                q = q.bind(id);
            }
            collected.extend(q.fetch_all(pool).await?);
        }
        collected
    } else {
        sqlx::query(
            r#"
            SELECT a.*, COALESCE(f.title, '') AS feed_title
            FROM rss_articles a
            LEFT JOIN rss_feeds f ON f.id = a.feed_id
            ORDER BY COALESCE(a.published_date, a.date_added) DESC
            "#,
        )
        .fetch_all(pool)
        .await?
    };

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let art = row_to_scoped_article(&row)?;
        if let Some(ref allowed) = allowed_feeds {
            if !allowed.contains(&art.feed_id) {
                continue;
            }
        }
        if let Some(ref cutoff) = cutoff_iso {
            let effective_date = art.published_date.as_deref().unwrap_or(&art.date_added);
            if effective_date < cutoff.as_str() {
                continue;
            }
        }
        out.push(art);
    }
    Ok(out)
}

pub async fn load_articles_by_ids(
    pool: &SqlitePool,
    article_ids: &[String],
) -> Result<Vec<ScopedArticleRow>> {
    if article_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for chunk in article_ids.chunks(450) {
        let placeholders: Vec<String> = (0..chunk.len()).map(|i| format!("?{}", i + 1)).collect();
        let sql = format!(
            r#"
            SELECT a.*, COALESCE(f.title, '') AS feed_title
            FROM rss_articles a
            LEFT JOIN rss_feeds f ON f.id = a.feed_id
            WHERE a.id IN ({})
            "#,
            placeholders.join(",")
        );
        let mut q = sqlx::query(&sql);
        for id in chunk {
            q = q.bind(id);
        }
        let rows = q.fetch_all(pool).await?;
        for row in rows {
            out.push(row_to_scoped_article(&row)?);
        }
    }
    Ok(out)
}

/// Query FTS5 `rss_articles_fts` to get BM25 lexical boost scores keyed by
/// `article_id` (`0.0..=1.0`). Safely returns empty map if FTS query fails.
pub async fn query_fts_boosts(pool: &SqlitePool, raw_text: &str) -> HashMap<String, f64> {
    let Some(fts_expr) = build_safe_fts_query(raw_text) else {
        return HashMap::new();
    };
    let rows = sqlx::query(
        r#"
        SELECT a.id, bm25(rss_articles_fts) AS score
        FROM rss_articles_fts f
        INNER JOIN rss_articles a ON f.rowid = a.rowid
        WHERE rss_articles_fts MATCH ?1
        ORDER BY score ASC
        LIMIT 800
        "#,
    )
    .bind(&fts_expr)
    .fetch_all(pool)
    .await;

    let Ok(rows) = rows else {
        return HashMap::new();
    };
    let mut map = HashMap::with_capacity(rows.len());
    for row in rows {
        if let (Ok(id), Ok(raw_score)) = (
            row.try_get::<String, _>("id"),
            row.try_get::<f64, _>("score"),
        ) {
            // SQLite bm25() returns negative values where more negative = better match.
            let norm = (1.0 / (1.0 + (-raw_score).abs().recip())).clamp(0.05, 1.0);
            map.insert(id, norm);
        }
    }
    map
}

/// Load cached embeddings from `queue_item_embeddings` using chunked queries
/// (`<=450` placeholders per query) keyed by raw `article_id`.
pub async fn load_article_embeddings_chunked(
    pool: &SqlitePool,
    article_ids: &[String],
) -> Result<HashMap<String, QueueItemEmbedding>> {
    let mut out = HashMap::new();
    if article_ids.is_empty() {
        return Ok(out);
    }

    let mut prefixed: Vec<String> = article_ids
        .iter()
        .map(|id| {
            if id.starts_with("rss-") {
                id.clone()
            } else {
                format!("rss-{}", id)
            }
        })
        .collect();
    prefixed.sort();
    prefixed.dedup();

    for chunk in prefixed.chunks(450) {
        let placeholders: Vec<String> = (0..chunk.len()).map(|i| format!("?{}", i + 1)).collect();
        let sql = format!(
            "SELECT * FROM queue_item_embeddings WHERE item_id IN ({})",
            placeholders.join(",")
        );
        let mut q = sqlx::query(&sql);
        for id in chunk {
            q = q.bind(id);
        }
        let rows = q.fetch_all(pool).await?;
        for row in rows {
            let item_id: String = row.try_get("item_id")?;
            let blob: Vec<u8> = row.try_get("embedding")?;
            let dim: i32 = row.try_get("dimension")?;
            let embedding = bytes_to_embedding(&blob);
            if embedding.len() != dim.max(0) as usize {
                continue;
            }
            let raw_id = item_id.strip_prefix("rss-").unwrap_or(&item_id).to_string();
            out.insert(
                raw_id,
                QueueItemEmbedding {
                    item_id,
                    embedding,
                    content_hash: row.try_get("content_hash")?,
                    provider: row.try_get("provider")?,
                    model: row.try_get("model")?,
                    dimension: dim,
                    created_at: row.try_get("created_at")?,
                },
            );
        }
    }
    Ok(out)
}

pub async fn get_feed_embeddings(
    pool: &SqlitePool,
    smart_feed_id: &str,
) -> Result<Vec<SmartFeedEmbeddingRecord>> {
    let rows = sqlx::query("SELECT * FROM rss_smart_feed_embeddings WHERE smart_feed_id = ?1")
        .bind(smart_feed_id)
        .fetch_all(pool)
        .await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let role_str: String = row.try_get("role")?;
        let role = match role_str.as_str() {
            "positive" => EmbeddingRole::Positive,
            "negative" => EmbeddingRole::Negative,
            "feedback_pos" => EmbeddingRole::FeedbackPos,
            "feedback_neg" => EmbeddingRole::FeedbackNeg,
            _ => continue,
        };
        let blob: Vec<u8> = row.try_get("embedding")?;
        out.push(SmartFeedEmbeddingRecord {
            smart_feed_id: row.try_get("smart_feed_id")?,
            role,
            definition_revision: row.try_get("definition_revision")?,
            provider: row.try_get("provider")?,
            model: row.try_get("model")?,
            dimension: row.try_get("dimension")?,
            embedding: bytes_to_embedding(&blob),
            weight: row.try_get("weight")?,
            content_hash: row.try_get("content_hash")?,
            updated_at: row.try_get("updated_at")?,
        });
    }
    Ok(out)
}

pub async fn upsert_feed_embedding(
    pool: &SqlitePool,
    rec: &SmartFeedEmbeddingRecord,
) -> Result<()> {
    let bytes = embedding_to_bytes(&rec.embedding);
    sqlx::query(
        r#"
        INSERT OR REPLACE INTO rss_smart_feed_embeddings (
            smart_feed_id, role, definition_revision, provider, model, dimension,
            embedding, weight, content_hash, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        "#,
    )
    .bind(&rec.smart_feed_id)
    .bind(rec.role.as_str())
    .bind(rec.definition_revision)
    .bind(&rec.provider)
    .bind(&rec.model)
    .bind(rec.dimension)
    .bind(&bytes)
    .bind(rec.weight)
    .bind(&rec.content_hash)
    .bind(&rec.updated_at)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_feed_embedding_role(
    pool: &SqlitePool,
    smart_feed_id: &str,
    role: EmbeddingRole,
) -> Result<()> {
    sqlx::query("DELETE FROM rss_smart_feed_embeddings WHERE smart_feed_id = ?1 AND role = ?2")
        .bind(smart_feed_id)
        .bind(role.as_str())
        .execute(pool)
        .await?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct ExistingMatchState {
    pub content_hash: String,
    pub definition_revision: i64,
    pub embedding_provider: String,
    pub embedding_model: String,
    pub evaluation_status: EvaluationStatus,
    pub is_user_override: bool,
    pub decision: MatchDecision,
}

pub async fn get_existing_match_states(
    pool: &SqlitePool,
    smart_feed_id: &str,
) -> Result<HashMap<String, ExistingMatchState>> {
    let rows = sqlx::query(
        r#"
        SELECT article_id, content_hash, definition_revision, embedding_provider,
               embedding_model, evaluation_status, is_user_override, decision
        FROM rss_smart_feed_matches
        WHERE smart_feed_id = ?1
        "#,
    )
    .bind(smart_feed_id)
    .fetch_all(pool)
    .await?;

    let mut out = HashMap::with_capacity(rows.len());
    for row in rows {
        let article_id: String = row.try_get("article_id")?;
        out.insert(
            article_id,
            ExistingMatchState {
                content_hash: row.try_get("content_hash")?,
                definition_revision: row.try_get("definition_revision")?,
                embedding_provider: row.try_get("embedding_provider")?,
                embedding_model: row.try_get("embedding_model")?,
                evaluation_status: EvaluationStatus::from_str(
                    &row.try_get::<String, _>("evaluation_status")?,
                ),
                is_user_override: row.try_get::<i64, _>("is_user_override")? != 0,
                decision: MatchDecision::from_str(&row.try_get::<String, _>("decision")?),
            },
        );
    }
    Ok(out)
}

/// Upsert a batch of match records inside a single SQLite transaction.
/// Explicit user overrides (`is_user_override = 1`) are NEVER silently
/// overwritten by automated reevaluation.
pub async fn upsert_matches_batch(pool: &SqlitePool, matches: &[SmartFeedMatch]) -> Result<()> {
    if matches.is_empty() {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    for m in matches {
        let evidence_json =
            serde_json::to_string(&m.matched_evidence).unwrap_or_else(|_| "[]".into());
        sqlx::query(
            r#"
            INSERT INTO rss_smart_feed_matches (
                smart_feed_id, article_id, decision, relevance_score, ranking_score,
                decision_reason, matched_evidence, decision_source, content_hash,
                definition_revision, classifier_version, embedding_provider, embedding_model,
                evaluation_status, error_message, is_user_override, evaluated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
            ON CONFLICT(smart_feed_id, article_id) DO UPDATE SET
                decision = excluded.decision,
                relevance_score = excluded.relevance_score,
                ranking_score = excluded.ranking_score,
                decision_reason = excluded.decision_reason,
                matched_evidence = excluded.matched_evidence,
                decision_source = excluded.decision_source,
                content_hash = excluded.content_hash,
                definition_revision = excluded.definition_revision,
                classifier_version = excluded.classifier_version,
                embedding_provider = excluded.embedding_provider,
                embedding_model = excluded.embedding_model,
                evaluation_status = excluded.evaluation_status,
                error_message = excluded.error_message,
                is_user_override = excluded.is_user_override,
                evaluated_at = excluded.evaluated_at
            WHERE rss_smart_feed_matches.is_user_override = 0 OR excluded.is_user_override = 1
            "#,
        )
        .bind(&m.smart_feed_id)
        .bind(&m.article_id)
        .bind(m.decision.as_str())
        .bind(m.relevance_score)
        .bind(m.ranking_score)
        .bind(&m.decision_reason)
        .bind(&evidence_json)
        .bind(m.decision_source.as_str())
        .bind(&m.content_hash)
        .bind(m.definition_revision)
        .bind(&m.classifier_version)
        .bind(&m.embedding_provider)
        .bind(&m.embedding_model)
        .bind(m.evaluation_status.as_str())
        .bind(m.error_message.as_deref())
        .bind(if m.is_user_override { 1i64 } else { 0i64 })
        .bind(&m.evaluated_at)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn insert_feedback_event(
    pool: &SqlitePool,
    smart_feed_id: &str,
    article_id: &str,
    feedback_type: FeedbackType,
    previous_decision: Option<MatchDecision>,
    note: Option<&str>,
) -> Result<SmartFeedFeedbackEvent> {
    let id = uuid::Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    let prev_str = previous_decision.map(|d| d.as_str().to_string());
    sqlx::query(
        r#"
        INSERT INTO rss_smart_feed_feedback (
            id, smart_feed_id, article_id, feedback_type, previous_decision, note, created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
    )
    .bind(&id)
    .bind(smart_feed_id)
    .bind(article_id)
    .bind(feedback_type.as_str())
    .bind(prev_str.as_deref())
    .bind(note)
    .bind(&created_at)
    .execute(pool)
    .await?;

    Ok(SmartFeedFeedbackEvent {
        id,
        smart_feed_id: smart_feed_id.to_string(),
        article_id: article_id.to_string(),
        feedback_type,
        previous_decision,
        note: note.map(ToString::to_string),
        created_at,
    })
}

/// Replay feedback history per article to obtain currently active feedback
/// (`SHOULD_INCLUDE` or `SHOULD_EXCLUDE`), respecting `UNDO`.
pub async fn get_active_feedback_map(
    pool: &SqlitePool,
    smart_feed_id: &str,
) -> Result<HashMap<String, FeedbackType>> {
    let rows = sqlx::query(
        r#"
        SELECT article_id, feedback_type
        FROM rss_smart_feed_feedback
        WHERE smart_feed_id = ?1
        ORDER BY created_at ASC, rowid ASC
        "#,
    )
    .bind(smart_feed_id)
    .fetch_all(pool)
    .await?;

    let mut active = HashMap::new();
    for row in rows {
        let article_id: String = row.try_get("article_id")?;
        let fb_str: String = row.try_get("feedback_type")?;
        if let Some(fb) = FeedbackType::from_str(&fb_str) {
            match fb {
                FeedbackType::UNDO => {
                    active.remove(&article_id);
                }
                FeedbackType::SHOULD_INCLUDE | FeedbackType::SHOULD_EXCLUDE => {
                    active.insert(article_id, fb);
                }
            }
        }
    }
    Ok(active)
}

pub async fn get_match_decision(
    pool: &SqlitePool,
    smart_feed_id: &str,
    article_id: &str,
) -> Result<Option<MatchDecision>> {
    let dec: Option<String> = sqlx::query_scalar(
        "SELECT decision FROM rss_smart_feed_matches WHERE smart_feed_id = ?1 AND article_id = ?2",
    )
    .bind(smart_feed_id)
    .bind(article_id)
    .fetch_optional(pool)
    .await?;
    Ok(dec.map(|s| MatchDecision::from_str(&s)))
}

pub async fn clear_match_user_override(
    pool: &SqlitePool,
    smart_feed_id: &str,
    article_id: &str,
) -> Result<()> {
    sqlx::query(
        "UPDATE rss_smart_feed_matches SET is_user_override = 0 WHERE smart_feed_id = ?1 AND article_id = ?2",
    )
    .bind(smart_feed_id)
    .bind(article_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_article_memberships_batch(
    pool: &SqlitePool,
    article_ids: &[String],
) -> Result<HashMap<String, Vec<SmartFeedBadge>>> {
    let mut out: HashMap<String, Vec<SmartFeedBadge>> = HashMap::new();
    if article_ids.is_empty() {
        return Ok(out);
    }
    for chunk in article_ids.chunks(450) {
        let placeholders: Vec<String> = (0..chunk.len()).map(|i| format!("?{}", i + 1)).collect();
        let sql = format!(
            r#"
            SELECT m.article_id, m.smart_feed_id, f.name AS smart_feed_name, m.relevance_score
            FROM rss_smart_feed_matches m
            INNER JOIN rss_smart_feeds f ON f.id = m.smart_feed_id
            WHERE m.decision = 'INCLUDE' AND m.article_id IN ({})
            ORDER BY m.relevance_score DESC, f.name ASC
            "#,
            placeholders.join(",")
        );
        let mut q = sqlx::query(&sql);
        for id in chunk {
            q = q.bind(id);
        }
        let rows = q.fetch_all(pool).await?;
        for row in rows {
            let article_id: String = row.try_get("article_id")?;
            out.entry(article_id).or_default().push(SmartFeedBadge {
                smart_feed_id: row.try_get("smart_feed_id")?,
                smart_feed_name: row.try_get("smart_feed_name")?,
                relevance_score: row.try_get("relevance_score")?,
            });
        }
    }
    Ok(out)
}

pub async fn query_feed_articles(
    pool: &SqlitePool,
    smart_feed_id: &str,
    filter: &SmartFeedArticlesFilter,
) -> Result<(Vec<SmartFeedArticleItem>, i64)> {
    let feed = get_feed(pool, smart_feed_id).await?;
    let bucket = filter.bucket.unwrap_or(MatchDecision::INCLUDE);
    let sort_order = filter.sort_order.unwrap_or(feed.sort_order);

    let active_feedback = get_active_feedback_map(pool, smart_feed_id).await?;

    let order_sql = match sort_order {
        SmartFeedSortOrder::Relevance => {
            "m.ranking_score DESC, COALESCE(a.published_date, a.date_added) DESC"
        }
        SmartFeedSortOrder::Newest => {
            "COALESCE(a.published_date, a.date_added) DESC, m.ranking_score DESC"
        }
        SmartFeedSortOrder::Oldest => {
            "COALESCE(a.published_date, a.date_added) ASC, m.ranking_score DESC"
        }
        SmartFeedSortOrder::UnreadFirst => {
            "a.is_read ASC, m.ranking_score DESC, COALESCE(a.published_date, a.date_added) DESC"
        }
    };

    let bucket_clause = if bucket == MatchDecision::PENDING {
        "(m.decision = 'PENDING' OR m.evaluation_status IN ('pending', 'deferred', 'error'))"
    } else {
        "m.decision = ?2"
    };

    let sql = format!(
        r#"
        SELECT
            a.id AS article_id, a.feed_id, COALESCE(rf.title, '') AS feed_title,
            a.url, a.guid, a.title, a.author, a.published_date,
            a.content, a.summary, a.image_url, a.categories,
            a.is_queued, a.is_read, a.date_added, a.full_content, a.full_content_fetched_at,
            m.decision, m.relevance_score, m.ranking_score, m.decision_reason,
            m.matched_evidence, m.decision_source, m.evaluation_status,
            m.error_message, m.is_user_override, m.evaluated_at
        FROM rss_smart_feed_matches m
        INNER JOIN rss_articles a ON a.id = m.article_id
        LEFT JOIN rss_feeds rf ON rf.id = a.feed_id
        WHERE m.smart_feed_id = ?1
          AND {bucket_clause}
        ORDER BY {order_sql}
        "#
    );

    let mut q = sqlx::query(&sql).bind(smart_feed_id);
    if bucket != MatchDecision::PENDING {
        q = q.bind(bucket.as_str());
    }
    let rows = q.fetch_all(pool).await?;

    let search_lower = filter
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_lowercase);

    let mut items = Vec::new();
    for row in rows {
        let is_read = row.try_get::<i64, _>("is_read")? != 0;
        if filter.unread_only && is_read {
            continue;
        }
        let article_id: String = row.try_get("article_id")?;
        let title: String = row.try_get("title")?;
        let feed_title: String = row
            .try_get::<Option<String>, _>("feed_title")?
            .unwrap_or_default();
        let summary = decode_optional_text(&row, "summary");
        let content = decode_optional_text(&row, "content");
        let full_content = decode_optional_text(&row, "full_content");
        let decision_reason: String = row.try_get("decision_reason")?;

        if let Some(ref needle) = search_lower {
            let haystack = format!(
                "{} {} {} {} {}",
                title,
                feed_title,
                summary.as_deref().unwrap_or(""),
                content.as_deref().unwrap_or(""),
                decision_reason
            )
            .to_lowercase();
            if !haystack.contains(needle) {
                continue;
            }
        }

        let cats_raw: String = row.try_get("categories").unwrap_or_else(|_| "[]".into());
        let categories: Vec<String> = serde_json::from_str(&cats_raw).unwrap_or_default();
        let evidence_raw: String = row
            .try_get("matched_evidence")
            .unwrap_or_else(|_| "[]".into());
        let matched_evidence: Vec<String> = serde_json::from_str(&evidence_raw).unwrap_or_default();

        let fb = active_feedback.get(&article_id).copied();

        items.push(SmartFeedArticleItem {
            article_id: article_id.clone(),
            feed_id: row.try_get("feed_id")?,
            feed_title,
            url: row.try_get("url")?,
            guid: row.try_get("guid")?,
            title,
            author: row.try_get("author")?,
            published_date: row.try_get("published_date")?,
            content,
            summary,
            image_url: row.try_get("image_url")?,
            categories,
            is_queued: row.try_get::<i64, _>("is_queued")? != 0,
            is_read,
            date_added: row.try_get("date_added")?,
            full_content,
            full_content_fetched_at: row.try_get("full_content_fetched_at").ok().flatten(),
            decision: MatchDecision::from_str(&row.try_get::<String, _>("decision")?),
            relevance_score: row.try_get("relevance_score")?,
            ranking_score: row.try_get("ranking_score")?,
            decision_reason,
            matched_evidence,
            decision_source: DecisionSource::from_str(
                &row.try_get::<String, _>("decision_source")?,
            ),
            evaluation_status: EvaluationStatus::from_str(
                &row.try_get::<String, _>("evaluation_status")?,
            ),
            error_message: row.try_get("error_message")?,
            is_user_override: row.try_get::<i64, _>("is_user_override")? != 0,
            evaluated_at: row.try_get("evaluated_at")?,
            active_feedback: fb,
            also_in_smart_feeds: Vec::new(),
            cluster_id: None,
            cluster_size: 1,
            cluster_members: Vec::new(),
        });
    }

    let total_in_bucket = items.len() as i64;
    let offset = filter.offset.unwrap_or(0).max(0) as usize;
    let limit = filter.limit.unwrap_or(200).clamp(1, 1000) as usize;
    let sliced: Vec<SmartFeedArticleItem> = items.into_iter().skip(offset).take(limit).collect();

    Ok((sliced, total_in_bucket))
}

pub async fn export_all_feeds(pool: &SqlitePool) -> Result<SmartFeedsExportPayload> {
    let rows = sqlx::query("SELECT * FROM rss_smart_feeds ORDER BY created_at ASC")
        .fetch_all(pool)
        .await?;
    let mut smart_feeds = Vec::with_capacity(rows.len());
    for row in rows {
        let mut feed = row_to_smart_feed(&row)?;
        // Never persist/export cloud consent across devices implicitly unless
        // user explicitly confirms on target device; keep definitions intact.
        feed.cloud_consent_granted = false;
        smart_feeds.push(feed);
    }
    Ok(SmartFeedsExportPayload {
        schema_version: 1,
        exported_at: Utc::now().to_rfc3339(),
        smart_feeds,
    })
}

pub async fn import_feeds_payload(
    pool: &SqlitePool,
    payload: SmartFeedsExportPayload,
) -> Result<SmartFeedsImportResult> {
    let mut imported = 0usize;
    let mut skipped = 0usize;
    let mut ids = Vec::new();

    for item in payload.smart_feeds {
        if item.name.trim().is_empty()
            || (item.description.trim().is_empty() && item.inclusion_criteria.trim().is_empty())
        {
            skipped += 1;
            continue;
        }
        let existing_id: Option<String> =
            sqlx::query_scalar("SELECT id FROM rss_smart_feeds WHERE id = ?1")
                .bind(&item.id)
                .fetch_optional(pool)
                .await?;
        if existing_id.is_some() {
            skipped += 1;
            continue;
        }
        let created = create_feed(
            pool,
            CreateSmartFeedInput {
                name: item.name,
                description: item.description,
                inclusion_criteria: item.inclusion_criteria,
                exclusion_criteria: item.exclusion_criteria,
                source_scope: item.source_scope,
                source_scope_config: item.source_scope_config,
                classification_mode: item.classification_mode,
                curation_strictness: item.curation_strictness,
                minimum_relevance: item.minimum_relevance,
                freshness_window_days: item.freshness_window_days,
                sort_order: item.sort_order,
                group_similar_stories: item.group_similar_stories,
                is_enabled: item.is_enabled,
                cloud_consent_granted: false, // require fresh explicit opt-in after import
                preferred_provider: item.preferred_provider,
                preferred_model: item.preferred_model,
            },
        )
        .await?;
        ids.push(created.id);
        imported += 1;
    }

    Ok(SmartFeedsImportResult {
        imported,
        skipped,
        ids,
    })
}
