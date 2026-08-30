use crate::error::{PlethoraError, Result};
use crate::models::{Document, Extract, LearningItem};
use sqlx::{Sqlite, Transaction};

fn is_v2_payload(payload: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(payload)
        .ok()
        .and_then(|value| value.get("schema_version").and_then(|v| v.as_u64()))
        .is_some_and(|version| version >= 2)
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

pub async fn upsert_learning_item(
    tx: &mut Transaction<'_, Sqlite>,
    item: &LearningItem,
) -> Result<()> {
    let item_type = format!("{:?}", item.item_type).to_lowercase();
    let state = format!("{:?}", item.state).to_lowercase();
    let tags = serde_json::to_string(&item.tags)
        .map_err(|e| PlethoraError::Internal(format!("Sync item tags encode failed: {e}")))?;
    let image_asset_ids = serde_json::to_string(&item.image_asset_ids)
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
    .bind(&item.extract_id)
    .bind(&item.document_id)
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
) -> Result<()> {
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
            ?1, ?2, ?3, '', ?4, ?5, ?6,
            ?7, ?8, ?9, ?10,
            ?11, ?12, ?13, ?14, ?15,
            ?16, ?17, ?18,
            ?19, ?20, ?21, ?22,
            ?23, ?24, ?25, ?26,
            ?27, ?28,
            ?29, ?30, ?31, ?32, ?33,
            ?34, ?35, ?36, ?37
        )
        ON CONFLICT(id) DO UPDATE SET
            collection_id = excluded.collection_id,
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
    .bind(&document.id)
    .bind(&document.collection_id)
    .bind(&document.title)
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

    Ok(())
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
    .bind(&extract.document_id)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v2_payload_detection_requires_schema_two() {
        assert!(!is_v2_payload(br#"{"schema_version":1}"#));
        assert!(is_v2_payload(br#"{"schema_version":2}"#));
    }
}
