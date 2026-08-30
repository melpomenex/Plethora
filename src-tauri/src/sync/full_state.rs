use crate::error::{PlethoraError, Result};
use crate::models::{Document, Extract, LearningItem};
use sqlx::{Sqlite, Transaction};

fn is_v2_payload(payload: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(payload)
        .ok()
        .and_then(|value| value.get("schema_version").and_then(|v| v.as_u64()))
        .is_some_and(|version| version >= 2)
}

pub const LEARNING_ITEM_GROUPS: &[&str] = &[
    "collection", "content", "tags", "media", "schedule", "priority", "suspension",
];
pub const DOCUMENT_GROUPS: &[&str] = &[
    "collection", "content", "tags", "position", "flags", "priority", "schedule", "activity",
];
pub const EXTRACT_GROUPS: &[&str] = &[
    "collection", "content", "tags", "schedule", "priority", "activity",
];

pub fn sync_fields(payload: &[u8], all_groups: &[&str]) -> Vec<String> {
    let raw = serde_json::from_slice::<serde_json::Value>(payload)
        .ok()
        .and_then(|value| value.get("sync_fields").cloned())
        .and_then(|value| value.as_array().cloned())
        .map(|values| {
            values
                .into_iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec!["*".to_string()]);

    if raw.iter().any(|field| field == "*") {
        return all_groups.iter().map(|field| (*field).to_string()).collect();
    }

    raw.into_iter()
        .filter(|field| all_groups.iter().any(|known| field == known))
        .collect()
}

fn parse_hlc(raw: &str) -> (i64, i64) {
    let mut parts = raw.split(':');
    (
        parts.next().and_then(|v| v.parse().ok()).unwrap_or(0),
        parts.next().and_then(|v| v.parse().ok()).unwrap_or(0),
    )
}

pub async fn winning_field_groups(
    tx: &mut Transaction<'_, Sqlite>,
    entity_type: &str,
    entity_id: &str,
    hlc: &str,
    device_id: &str,
    fields: &[String],
) -> Result<Vec<String>> {
    let mut winners = Vec::new();
    for field in fields {
        let existing = sqlx::query_as::<_, (String, String)>(
            r#"
            SELECT last_hlc, last_device_id
            FROM sync_field_state
            WHERE entity_type = ?1 AND entity_id = ?2 AND field_group = ?3
            "#,
        )
        .bind(entity_type)
        .bind(entity_id)
        .bind(field)
        .fetch_optional(&mut **tx)
        .await?;

        let wins = existing
            .map(|(existing_hlc, existing_device)| {
                let incoming = parse_hlc(hlc);
                let current = parse_hlc(&existing_hlc);
                incoming > current || (incoming == current && device_id > existing_device.as_str())
            })
            .unwrap_or(true);
        if wins {
            winners.push(field.clone());
        }
    }
    Ok(winners)
}

pub async fn record_field_groups(
    tx: &mut Transaction<'_, Sqlite>,
    entity_type: &str,
    entity_id: &str,
    hlc: &str,
    device_id: &str,
    fields: &[String],
) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    for field in fields {
        sqlx::query(
            r#"
            INSERT INTO sync_field_state (
                entity_type, entity_id, field_group, last_hlc, last_device_id, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(entity_type, entity_id, field_group) DO UPDATE SET
                last_hlc = excluded.last_hlc,
                last_device_id = excluded.last_device_id,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(entity_type)
        .bind(entity_id)
        .bind(field)
        .bind(hlc)
        .bind(device_id)
        .bind(now)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

pub fn decode_learning_item(payload: &[u8]) -> Option<LearningItem> {
    if !is_v2_payload(payload) {
        return None;
    }
    serde_json::from_slice(payload).ok()
}

pub fn decode_document(payload: &[u8]) -> Option<Document> {
    if !is_v2_payload(payload) {
        return None;
    }
    serde_json::from_slice(payload).ok()
}

pub fn decode_extract(payload: &[u8]) -> Option<Extract> {
    if !is_v2_payload(payload) {
        return None;
    }
    serde_json::from_slice(payload).ok()
}

fn canonicalize_source_url(raw: &str) -> Option<String> {
    let mut url = url::Url::parse(raw.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    url.set_fragment(None);

    // Tracking-only query parameters should never make two imports distinct.
    let tracking = [
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
        "utm_id", "gclid", "fbclid", "mc_cid", "mc_eid",
    ];
    if url.query().is_some() {
        let retained: Vec<(String, String)> = url
            .query_pairs()
            .filter(|(key, _)| !tracking.iter().any(|blocked| key.eq_ignore_ascii_case(blocked)))
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect();
        url.set_query(None);
        if !retained.is_empty() {
            let mut pairs = url.query_pairs_mut();
            for (key, value) in retained {
                pairs.append_pair(&key, &value);
            }
        }
    }
    Some(url.to_string())
}

fn portable_source_url(document: &Document) -> Option<String> {
    canonicalize_source_url(&document.file_path).or_else(|| {
        document
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.source.as_deref())
            .and_then(canonicalize_source_url)
    })
}

pub fn document_identity_key(document: &Document) -> Option<String> {
    if candidate.is_none() {
        if let Some(hash) = document
        .content_hash
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(format!("content:{}", hash.to_ascii_lowercase()));
    }

    portable_source_url(document).map(|url| format!("url:{url}"))
}

pub async fn resolve_alias(
    tx: &mut Transaction<'_, Sqlite>,
    entity_type: &str,
    source_id: &str,
) -> Result<String> {
    let alias: Option<String> = sqlx::query_scalar(
        "SELECT canonical_id FROM sync_entity_aliases WHERE entity_type = ?1 AND source_id = ?2",
    )
    .bind(entity_type)
    .bind(source_id)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(alias.unwrap_or_else(|| source_id.to_string()))
}

pub(crate) async fn register_alias(
    tx: &mut Transaction<'_, Sqlite>,
    entity_type: &str,
    source_id: &str,
    canonical_id: &str,
    identity_key: Option<&str>,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO sync_entity_aliases (
            entity_type, source_id, canonical_id, identity_key, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(entity_type, source_id) DO UPDATE SET
            canonical_id = excluded.canonical_id,
            identity_key = COALESCE(excluded.identity_key, sync_entity_aliases.identity_key)
        "#,
    )
    .bind(entity_type)
    .bind(source_id)
    .bind(canonical_id)
    .bind(identity_key)
    .bind(chrono::Utc::now().timestamp_millis())
    .execute(&mut **tx)
    .await?;

    // If the source ID already accumulated sync ordering state before we
    // discovered the duplicate, fold the newer state onto the canonical key.
    let source_state = sqlx::query_as::<_, (String, String, Option<i64>, i64, i64)>(
        r#"
        SELECT last_hlc, last_device_id, server_revision, tombstoned, updated_at
        FROM sync_entity_state
        WHERE entity_type = ?1 AND entity_id = ?2
        "#,
    )
    .bind(entity_type)
    .bind(source_id)
    .fetch_optional(&mut **tx)
    .await?;

    if let Some((hlc, device, revision, tombstoned, updated_at)) = source_state {
        let canonical_state = sqlx::query_as::<_, (String, String)>(
            "SELECT last_hlc, last_device_id FROM sync_entity_state WHERE entity_type = ?1 AND entity_id = ?2",
        )
        .bind(entity_type)
        .bind(canonical_id)
        .fetch_optional(&mut **tx)
        .await?;

        let source_is_newer = canonical_state
            .map(|(existing_hlc, existing_device)| {
                let parse = |raw: &str| {
                    let mut parts = raw.split(':');
                    (
                        parts.next().and_then(|v| v.parse::<i64>().ok()).unwrap_or(0),
                        parts.next().and_then(|v| v.parse::<i64>().ok()).unwrap_or(0),
                    )
                };
                let left = parse(&hlc);
                let right = parse(&existing_hlc);
                left > right || (left == right && device > existing_device)
            })
            .unwrap_or(true);

        if source_is_newer {
            sqlx::query(
                r#"
                INSERT INTO sync_entity_state (
                    entity_type, entity_id, last_hlc, last_device_id,
                    server_revision, tombstoned, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                    last_hlc = excluded.last_hlc,
                    last_device_id = excluded.last_device_id,
                    server_revision = COALESCE(excluded.server_revision, sync_entity_state.server_revision),
                    tombstoned = excluded.tombstoned,
                    updated_at = excluded.updated_at
                "#,
            )
            .bind(entity_type)
            .bind(canonical_id)
            .bind(hlc)
            .bind(device)
            .bind(revision)
            .bind(tombstoned)
            .bind(updated_at)
            .execute(&mut **tx)
            .await?;
        }
    }

    Ok(())
}

pub async fn index_local_document_identities(pool: &sqlx::Pool<Sqlite>) -> Result<usize> {
    let rows = sqlx::query_as::<_, (String, Option<String>, String)>(
        "SELECT id, content_hash, file_path FROM documents ORDER BY id",
    )
    .fetch_all(pool)
    .await?;
    let mut indexed = 0usize;
    let mut tx = pool.begin().await?;
    for (id, content_hash, file_path) in rows {
        let identity = content_hash
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|hash| format!("content:{}", hash.to_ascii_lowercase()))
            .or_else(|| canonicalize_source_url(&file_path).map(|url| format!("url:{url}")));
        if let Some(identity) = identity {
            register_alias(&mut tx, "document", &id, &id, Some(&identity)).await?;
            indexed += 1;
        }
    }
    tx.commit().await?;
    Ok(indexed)
}

pub async fn prepare_document_target(
    tx: &mut Transaction<'_, Sqlite>,
    document: &Document,
) -> Result<String> {
    if let Some(alias) = sqlx::query_scalar::<_, String>(
        "SELECT canonical_id FROM sync_entity_aliases WHERE entity_type = 'document' AND source_id = ?1",
    )
    .bind(&document.id)
    .fetch_optional(&mut **tx)
    .await?
    {
        return Ok(alias);
    }

    let identity = document_identity_key(document);
    let mut candidate: Option<String> = if let Some(identity_key) = identity.as_deref() {
        sqlx::query_scalar(
            "SELECT canonical_id FROM sync_entity_aliases WHERE entity_type = 'document' AND identity_key = ?1 ORDER BY canonical_id LIMIT 1",
        )
        .bind(identity_key)
        .fetch_optional(&mut **tx)
        .await?
    } else {
        None
    };

    // Content hashes are strong identities for independently imported copies.
    if candidate.is_none() {
        if let Some(hash) = document
            .content_hash
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            candidate = sqlx::query_scalar(
                "SELECT id FROM documents WHERE content_hash = ?1 AND id != ?2 ORDER BY id LIMIT 1",
            )
            .bind(hash)
            .bind(&document.id)
            .fetch_optional(&mut **tx)
            .await?;
        }
    }

    // URL identity is a fallback for articles/media where no content hash was
    // produced. Exact canonical URL only: titles are never used for dedupe.
    if candidate.is_none() {
        if let Some(source_url) = portable_source_url(document) {
            let without_trailing = source_url.trim_end_matches('/').to_string();
            candidate = sqlx::query_scalar(
                "SELECT id FROM documents WHERE (file_path = ?1 OR file_path = ?2) AND id != ?3 ORDER BY id LIMIT 1",
            )
            .bind(&source_url)
            .bind(&without_trailing)
            .bind(&document.id)
            .fetch_optional(&mut **tx)
            .await?;
        }
    }

    let target = candidate.unwrap_or_else(|| document.id.clone());
    register_alias(
        tx,
        "document",
        &document.id,
        &target,
        identity.as_deref(),
    )
    .await?;
    Ok(target)
}

pub async fn upsert_learning_item(
    tx: &mut Transaction<'_, Sqlite>,
    item: &LearningItem,
) -> Result<()> {
    let item_type = format!("{:?}", item.item_type).to_lowercase();
    let state = format!("{:?}", item.state).to_lowercase();
    let tags = serde_json::to_string(&item.tags)
        .map_err(|e| PlethoraError::Internal(format!("Sync item tags encode failed: {e}")))?;
    let mut resolved_image_asset_ids = Vec::with_capacity(item.image_asset_ids.len());
    for asset_id in &item.image_asset_ids {
        resolved_image_asset_ids.push(resolve_alias(tx, "image_asset", asset_id).await?);
    }
    let image_asset_ids = serde_json::to_string(&resolved_image_asset_ids)
        .map_err(|e| PlethoraError::Internal(format!("Sync item assets encode failed: {e}")))?;
    let interaction_metadata = item
        .interaction_metadata
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| PlethoraError::Internal(format!("Sync item metadata encode failed: {e}")))?;
    let cloze_ranges = item
        .cloze_ranges
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| PlethoraError::Internal(format!("Sync cloze ranges encode failed: {e}")))?;
    let (stability, memory_difficulty) = item
        .memory_state
        .as_ref()
        .map(|state| (Some(state.stability), Some(state.difficulty)))
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
            algorithm_type, algorithm_state, updated_at, first_reviewed_at,
            priority_slider, priority_score, priority_explicitly_set
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6,
            ?7, ?8, ?9, ?10, ?11,
            ?12, ?13, ?14, ?15,
            ?16, ?17, ?18, ?19,
            ?20, ?21, ?22, ?23,
            ?24, ?25,
            ?26, ?27, ?28, ?29,
            ?30, ?31, ?32
        )
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
            updated_at = excluded.updated_at,
            first_reviewed_at = excluded.first_reviewed_at,
            priority_slider = excluded.priority_slider,
            priority_score = excluded.priority_score,
            priority_explicitly_set = excluded.priority_explicitly_set
        "#,
    )
    .bind(&item.id)
    .bind(&item.collection_id)
    .bind(
        match item.extract_id.as_deref() {
            Some(id) => Some(resolve_alias(tx, "extract", id).await?),
            None => None,
        }
    )
    .bind(
        match item.document_id.as_deref() {
            Some(id) => Some(resolve_alias(tx, "document", id).await?),
            None => None,
        }
    )
    .bind(item_type)
    .bind(&item.question)
    .bind(&item.answer)
    .bind(&item.cloze_text)
    .bind(cloze_ranges)
    .bind(item.difficulty)
    .bind(item.interval)
    .bind(item.ease_factor)
    .bind(item.due_date)
    .bind(item.date_created)
    .bind(item.date_modified)
    .bind(item.last_review_date)
    .bind(item.review_count)
    .bind(item.lapses)
    .bind(state)
    .bind(item.is_suspended)
    .bind(tags)
    .bind(image_asset_ids)
    .bind(interaction_metadata)
    .bind(stability)
    .bind(memory_difficulty)
    .bind(&item.algorithm_type)
    .bind(&item.algorithm_state)
    .bind(&item.updated_at)
    .bind(item.first_reviewed_at)
    .bind(item.priority_slider)
    .bind(item.priority_score)
    .bind(item.priority_explicitly_set)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

pub async fn upsert_document(
    tx: &mut Transaction<'_, Sqlite>,
    document: &Document,
) -> Result<String> {
    let target_id = prepare_document_target(tx, document).await?;
    let file_type = format!("{:?}", document.file_type).to_lowercase();
    let tags = serde_json::to_string(&document.tags)
        .map_err(|e| PlethoraError::Internal(format!("Sync document tags encode failed: {e}")))?;
    let metadata = document
        .metadata
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| PlethoraError::Internal(format!("Sync document metadata encode failed: {e}")))?;

    sqlx::query(
        r#"
        INSERT INTO documents (
            id, collection_id, title, file_path, file_type, content, content_hash,
            total_pages, current_page, current_scroll_percent, current_cfi,
            current_view_state, position_json, progress_percent, category, tags,
            date_added, date_modified, date_last_reviewed,
            priority_rating, priority_slider, priority_score, priority_explicitly_set,
            is_archived, is_favorite, is_dismissed, metadata,
            cover_image_url, cover_image_source,
            next_reading_date, reading_count, stability, difficulty, reps,
            total_time_spent, consecutive_count, interval_modifier, first_reviewed_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7,
            ?8, ?9, ?10, ?11,
            ?12, ?13, ?14, ?15, ?16,
            ?17, ?18, ?19,
            ?20, ?21, ?22, ?23,
            ?24, ?25, ?26, ?27,
            ?28, ?29,
            ?30, ?31, ?32, ?33, ?34,
            ?35, ?36, ?37, ?38
        )
        ON CONFLICT(id) DO UPDATE SET
            collection_id = excluded.collection_id,
            file_path = CASE
                WHEN excluded.file_path != ''
                 AND (documents.file_path = '' OR documents.file_path LIKE 'http://%' OR documents.file_path LIKE 'https://%')
                THEN excluded.file_path
                ELSE documents.file_path
            END,
            title = excluded.title,
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
            date_modified = excluded.date_modified,
            date_last_reviewed = excluded.date_last_reviewed,
            priority_rating = excluded.priority_rating,
            priority_slider = excluded.priority_slider,
            priority_score = excluded.priority_score,
            priority_explicitly_set = excluded.priority_explicitly_set,
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
            consecutive_count = excluded.consecutive_count,
            interval_modifier = excluded.interval_modifier,
            first_reviewed_at = excluded.first_reviewed_at
        "#,
    )
    .bind(&target_id)
    .bind(&document.collection_id)
    .bind(&document.title)
    .bind(portable_source_url(document).unwrap_or_default())
    .bind(file_type)
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
    .bind(tags)
    .bind(document.date_added)
    .bind(document.date_modified)
    .bind(document.date_last_reviewed)
    .bind(document.priority_rating)
    .bind(document.priority_slider)
    .bind(document.priority_score)
    .bind(document.priority_explicitly_set)
    .bind(document.is_archived)
    .bind(document.is_favorite)
    .bind(document.is_dismissed)
    .bind(metadata)
    .bind(&document.cover_image_url)
    .bind(&document.cover_image_source)
    .bind(document.next_reading_date)
    .bind(document.reading_count)
    .bind(document.stability)
    .bind(document.difficulty)
    .bind(document.reps)
    .bind(document.total_time_spent)
    .bind(document.consecutive_count)
    .bind(document.interval_modifier)
    .bind(document.first_reviewed_at)
    .execute(&mut **tx)
    .await?;

    Ok(target_id)
}

pub async fn upsert_extract(
    tx: &mut Transaction<'_, Sqlite>,
    extract: &Extract,
) -> Result<()> {
    let tags = serde_json::to_string(&extract.tags)
        .map_err(|e| PlethoraError::Internal(format!("Sync extract tags encode failed: {e}")))?;
    let selection_context = extract
        .selection_context
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| PlethoraError::Internal(format!("Sync extract selection encode failed: {e}")))?;
    let progressive_summaries = extract
        .progressive_summaries
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| PlethoraError::Internal(format!("Sync extract summaries encode failed: {e}")))?;
    let (stability, memory_difficulty) = extract
        .memory_state
        .as_ref()
        .map(|state| (Some(state.stability), Some(state.difficulty)))
        .unwrap_or((None, None));

    sqlx::query(
        r#"
        INSERT INTO extracts (
            id, collection_id, document_id, content, html_content, source_url,
            page_title, page_number, selection_context, highlight_color, notes,
            progressive_disclosure_level, max_disclosure_level, progressive_summaries,
            date_created, date_modified, tags, category,
            memory_state_stability, memory_state_difficulty,
            next_review_date, last_review_date, review_count, reps,
            source_hash, priority_score, is_dismissed, total_time_spent
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6,
            ?7, ?8, ?9, ?10, ?11,
            ?12, ?13, ?14,
            ?15, ?16, ?17, ?18,
            ?19, ?20,
            ?21, ?22, ?23, ?24,
            ?25, ?26, ?27, ?28
        )
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
            is_dismissed = excluded.is_dismissed,
            total_time_spent = excluded.total_time_spent
        "#,
    )
    .bind(&extract.id)
    .bind(&extract.collection_id)
    .bind(resolve_alias(tx, "document", &extract.document_id).await?)
    .bind(&extract.content)
    .bind(&extract.html_content)
    .bind(&extract.source_url)
    .bind(&extract.page_title)
    .bind(extract.page_number)
    .bind(selection_context)
    .bind(&extract.highlight_color)
    .bind(&extract.notes)
    .bind(extract.progressive_disclosure_level)
    .bind(extract.max_disclosure_level)
    .bind(progressive_summaries)
    .bind(extract.date_created)
    .bind(extract.date_modified)
    .bind(tags)
    .bind(&extract.category)
    .bind(stability)
    .bind(memory_difficulty)
    .bind(extract.next_review_date)
    .bind(extract.last_review_date)
    .bind(extract.review_count)
    .bind(extract.reps)
    .bind(&extract.source_hash)
    .bind(extract.priority_score)
    .bind(extract.is_dismissed)
    .bind(extract.total_time_spent)
    .execute(&mut **tx)
    .await?;

    Ok(())
}
pub async fn apply_learning_item_groups(
    tx: &mut Transaction<'_, Sqlite>,
    item: &LearningItem,
    groups: &[String],
) -> Result<()> {
    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM learning_items WHERE id = ?1")
        .bind(&item.id)
        .fetch_optional(&mut **tx)
        .await?;
    if exists.is_none() {
        return upsert_learning_item(tx, item).await;
    }

    if groups.iter().any(|group| group == "collection") {
        sqlx::query("UPDATE learning_items SET collection_id = ?1 WHERE id = ?2")
            .bind(&item.collection_id)
            .bind(&item.id)
            .execute(&mut **tx)
            .await?;
    }
    if groups.iter().any(|group| group == "content") {
        let item_type = format!("{:?}", item.item_type).to_lowercase();
        let cloze_ranges = item
            .cloze_ranges
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| PlethoraError::Internal(format!("Sync cloze ranges encode failed: {e}")))?;
        let extract_id = match item.extract_id.as_deref() {
            Some(id) => Some(resolve_alias(tx, "extract", id).await?),
            None => None,
        };
        let document_id = match item.document_id.as_deref() {
            Some(id) => Some(resolve_alias(tx, "document", id).await?),
            None => None,
        };
        sqlx::query(
            r#"
            UPDATE learning_items SET
                extract_id = ?1, document_id = ?2, item_type = ?3,
                question = ?4, answer = ?5, cloze_text = ?6, cloze_ranges = ?7,
                date_modified = MAX(date_modified, ?8)
            WHERE id = ?9
            "#,
        )
        .bind(extract_id)
        .bind(document_id)
        .bind(item_type)
        .bind(&item.question)
        .bind(&item.answer)
        .bind(&item.cloze_text)
        .bind(cloze_ranges)
        .bind(item.date_modified)
        .bind(&item.id)
        .execute(&mut **tx)
        .await?;
    }
    if groups.iter().any(|group| group == "tags") {
        let tags = serde_json::to_string(&item.tags)
            .map_err(|e| PlethoraError::Internal(format!("Sync item tags encode failed: {e}")))?;
        sqlx::query("UPDATE learning_items SET tags = ?1 WHERE id = ?2")
            .bind(tags)
            .bind(&item.id)
            .execute(&mut **tx)
            .await?;
    }
    if groups.iter().any(|group| group == "media") {
        let mut resolved_image_asset_ids = Vec::with_capacity(item.image_asset_ids.len());
        for asset_id in &item.image_asset_ids {
            resolved_image_asset_ids.push(resolve_alias(tx, "image_asset", asset_id).await?);
        }
        let image_asset_ids = serde_json::to_string(&resolved_image_asset_ids)
            .map_err(|e| PlethoraError::Internal(format!("Sync item assets encode failed: {e}")))?;
        let interaction_metadata = item
            .interaction_metadata
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| PlethoraError::Internal(format!("Sync item metadata encode failed: {e}")))?;
        sqlx::query(
            "UPDATE learning_items SET image_asset_ids = ?1, interaction_metadata = ?2 WHERE id = ?3",
        )
        .bind(image_asset_ids)
        .bind(interaction_metadata)
        .bind(&item.id)
        .execute(&mut **tx)
        .await?;
    }
    if groups.iter().any(|group| group == "schedule") {
        let state = format!("{:?}", item.state).to_lowercase();
        let (stability, memory_difficulty) = item
            .memory_state
            .as_ref()
            .map(|state| (Some(state.stability), Some(state.difficulty)))
            .unwrap_or((None, None));
        sqlx::query(
            r#"
            UPDATE learning_items SET
                difficulty = ?1, interval = ?2, ease_factor = ?3, due_date = ?4,
                last_review_date = ?5, review_count = ?6, lapses = ?7, state = ?8,
                memory_state_stability = ?9, memory_state_difficulty = ?10,
                algorithm_type = ?11, algorithm_state = ?12, updated_at = ?13,
                first_reviewed_at = ?14, date_modified = MAX(date_modified, ?15)
            WHERE id = ?16
            "#,
        )
        .bind(item.difficulty)
        .bind(item.interval)
        .bind(item.ease_factor)
        .bind(item.due_date)
        .bind(item.last_review_date)
        .bind(item.review_count)
        .bind(item.lapses)
        .bind(state)
        .bind(stability)
        .bind(memory_difficulty)
        .bind(&item.algorithm_type)
        .bind(&item.algorithm_state)
        .bind(&item.updated_at)
        .bind(item.first_reviewed_at)
        .bind(item.date_modified)
        .bind(&item.id)
        .execute(&mut **tx)
        .await?;
    }
    if groups.iter().any(|group| group == "priority") {
        sqlx::query(
            "UPDATE learning_items SET priority_slider = ?1, priority_score = ?2, priority_explicitly_set = ?3 WHERE id = ?4",
        )
        .bind(item.priority_slider)
        .bind(item.priority_score)
        .bind(item.priority_explicitly_set)
        .bind(&item.id)
        .execute(&mut **tx)
        .await?;
    }
    if groups.iter().any(|group| group == "suspension") {
        sqlx::query("UPDATE learning_items SET is_suspended = ?1 WHERE id = ?2")
            .bind(item.is_suspended)
            .bind(&item.id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

pub async fn apply_document_groups(
    tx: &mut Transaction<'_, Sqlite>,
    document: &Document,
    groups: &[String],
) -> Result<String> {
    let target_id = prepare_document_target(tx, document).await?;
    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM documents WHERE id = ?1")
        .bind(&target_id)
        .fetch_optional(&mut **tx)
        .await?;
    if exists.is_none() {
        return upsert_document(tx, document).await;
    }

    if groups.iter().any(|group| group == "collection") {
        sqlx::query("UPDATE documents SET collection_id = ?1 WHERE id = ?2")
            .bind(&document.collection_id)
            .bind(&target_id)
            .execute(&mut **tx)
            .await?;
    }
    if groups.iter().any(|group| group == "content") {
        let file_type = format!("{:?}", document.file_type).to_lowercase();
        let metadata = document
            .metadata
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| PlethoraError::Internal(format!("Sync document metadata encode failed: {e}")))?;
        let source_url = portable_source_url(document).unwrap_or_default();
        sqlx::query(
            r#"
            UPDATE documents SET
                title = ?1,
                file_path = CASE
                    WHEN ?2 != '' AND (file_path = '' OR file_path LIKE 'http://%' OR file_path LIKE 'https://%')
                    THEN ?2 ELSE file_path END,
                file_type = ?3, content = ?4, content_hash = ?5, total_pages = ?6,
                metadata = ?7, cover_image_url = ?8, cover_image_source = ?9,
                date_modified = MAX(date_modified, ?10)
            WHERE id = ?11
            "#,
        )
        .bind(&document.title)
        .bind(source_url)
        .bind(file_type)
        .bind(&document.content)
        .bind(&document.content_hash)
        .bind(document.total_pages)
        .bind(metadata)
        .bind(&document.cover_image_url)
        .bind(&document.cover_image_source)
        .bind(document.date_modified)
        .bind(&target_id)
        .execute(&mut **tx)
        .await?;
    }
    if groups.iter().any(|group| group == "tags") {
        let tags = serde_json::to_string(&document.tags)
            .map_err(|e| PlethoraError::Internal(format!("Sync document tags encode failed: {e}")))?;
        sqlx::query("UPDATE documents SET category = ?1, tags = ?2 WHERE id = ?3")
            .bind(&document.category)
            .bind(tags)
            .bind(&target_id)
            .execute(&mut **tx)
            .await?;
    }
    if groups.iter().any(|group| group == "position") {
        sqlx::query(
            r#"
            UPDATE documents SET
                current_page = ?1, current_scroll_percent = ?2, current_cfi = ?3,
                current_view_state = ?4, position_json = ?5, progress_percent = ?6
            WHERE id = ?7
            "#,
        )
        .bind(document.current_page)
        .bind(document.current_scroll_percent)
        .bind(&document.current_cfi)
        .bind(&document.current_view_state)
        .bind(&document.position_json)
        .bind(document.progress_percent)
        .bind(&target_id)
        .execute(&mut **tx)
        .await?;
    }
    if groups.iter().any(|group| group == "flags") {
        sqlx::query(
            "UPDATE documents SET is_archived = ?1, is_favorite = ?2, is_dismissed = ?3 WHERE id = ?4",
        )
        .bind(document.is_archived)
        .bind(document.is_favorite)
        .bind(document.is_dismissed)
        .bind(&target_id)
        .execute(&mut **tx)
        .await?;
    }
    if groups.iter().any(|group| group == "priority") {
        sqlx::query(
            "UPDATE documents SET priority_rating = ?1, priority_slider = ?2, priority_score = ?3, priority_explicitly_set = ?4 WHERE id = ?5",
        )
        .bind(document.priority_rating)
        .bind(document.priority_slider)
        .bind(document.priority_score)
        .bind(document.priority_explicitly_set)
        .bind(&target_id)
        .execute(&mut **tx)
        .await?;
    }
    if groups.iter().any(|group| group == "schedule") {
        sqlx::query(
            r#"
            UPDATE documents SET
                date_last_reviewed = ?1, next_reading_date = ?2, reading_count = ?3,
                stability = ?4, difficulty = ?5, reps = ?6, consecutive_count = ?7,
                interval_modifier = ?8, first_reviewed_at = ?9
            WHERE id = ?10
            "#,
        )
        .bind(document.date_last_reviewed)
        .bind(document.next_reading_date)
        .bind(document.reading_count)
        .bind(document.stability)
        .bind(document.difficulty)
        .bind(document.reps)
        .bind(document.consecutive_count)
        .bind(document.interval_modifier)
        .bind(document.first_reviewed_at)
        .bind(&target_id)
        .execute(&mut **tx)
        .await?;
    }
    if groups.iter().any(|group| group == "activity") {
        sqlx::query("UPDATE documents SET total_time_spent = ?1 WHERE id = ?2")
            .bind(document.total_time_spent)
            .bind(&target_id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(target_id)
}

pub async fn apply_extract_groups(
    tx: &mut Transaction<'_, Sqlite>,
    extract: &Extract,
    groups: &[String],
) -> Result<()> {
    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM extracts WHERE id = ?1")
        .bind(&extract.id)
        .fetch_optional(&mut **tx)
        .await?;
    if exists.is_none() {
        return upsert_extract(tx, extract).await;
    }

    if groups.iter().any(|group| group == "collection") {
        sqlx::query("UPDATE extracts SET collection_id = ?1 WHERE id = ?2")
            .bind(&extract.collection_id)
            .bind(&extract.id)
            .execute(&mut **tx)
            .await?;
    }
    if groups.iter().any(|group| group == "content") {
        let selection_context = extract
            .selection_context
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| PlethoraError::Internal(format!("Sync extract selection encode failed: {e}")))?;
        let progressive_summaries = extract
            .progressive_summaries
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| PlethoraError::Internal(format!("Sync extract summaries encode failed: {e}")))?;
        sqlx::query(
            r#"
            UPDATE extracts SET
                document_id = ?1, content = ?2, html_content = ?3, source_url = ?4,
                page_title = ?5, page_number = ?6, selection_context = ?7,
                highlight_color = ?8, notes = ?9,
                progressive_disclosure_level = ?10, max_disclosure_level = ?11,
                progressive_summaries = ?12, source_hash = ?13,
                date_modified = MAX(date_modified, ?14)
            WHERE id = ?15
            "#,
        )
        .bind(resolve_alias(tx, "document", &extract.document_id).await?)
        .bind(&extract.content)
        .bind(&extract.html_content)
        .bind(&extract.source_url)
        .bind(&extract.page_title)
        .bind(extract.page_number)
        .bind(selection_context)
        .bind(&extract.highlight_color)
        .bind(&extract.notes)
        .bind(extract.progressive_disclosure_level)
        .bind(extract.max_disclosure_level)
        .bind(progressive_summaries)
        .bind(&extract.source_hash)
        .bind(extract.date_modified)
        .bind(&extract.id)
        .execute(&mut **tx)
        .await?;
    }
    if groups.iter().any(|group| group == "tags") {
        let tags = serde_json::to_string(&extract.tags)
            .map_err(|e| PlethoraError::Internal(format!("Sync extract tags encode failed: {e}")))?;
        sqlx::query("UPDATE extracts SET tags = ?1, category = ?2 WHERE id = ?3")
            .bind(tags)
            .bind(&extract.category)
            .bind(&extract.id)
            .execute(&mut **tx)
            .await?;
    }
    if groups.iter().any(|group| group == "schedule") {
        let (stability, memory_difficulty) = extract
            .memory_state
            .as_ref()
            .map(|state| (Some(state.stability), Some(state.difficulty)))
            .unwrap_or((None, None));
        sqlx::query(
            r#"
            UPDATE extracts SET
                memory_state_stability = ?1, memory_state_difficulty = ?2,
                next_review_date = ?3, last_review_date = ?4,
                review_count = ?5, reps = ?6
            WHERE id = ?7
            "#,
        )
        .bind(stability)
        .bind(memory_difficulty)
        .bind(extract.next_review_date)
        .bind(extract.last_review_date)
        .bind(extract.review_count)
        .bind(extract.reps)
        .bind(&extract.id)
        .execute(&mut **tx)
        .await?;
    }
    if groups.iter().any(|group| group == "priority") {
        sqlx::query("UPDATE extracts SET priority_score = ?1, is_dismissed = ?2 WHERE id = ?3")
            .bind(extract.priority_score)
            .bind(extract.is_dismissed)
            .bind(&extract.id)
            .execute(&mut **tx)
            .await?;
    }
    if groups.iter().any(|group| group == "activity") {
        sqlx::query("UPDATE extracts SET total_time_spent = ?1 WHERE id = ?2")
            .bind(extract.total_time_spent)
            .bind(&extract.id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v2_payload_detection_requires_schema_two() {
        assert!(!is_v2_payload(br#"{"schema_version":1}"#));
        assert!(is_v2_payload(br#"{"schema_version":2}"#));
    }
}
