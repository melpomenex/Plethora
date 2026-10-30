//! Learning item commands

use crate::commands::review::RepositoryExt;
use crate::database::{find_node_id_in_tx, unlink_node_in_tx, ElementKind, Repository};
use crate::error::{PlethoraError, Result};
use crate::generator::LearningItemGenerator;
use crate::models::{ItemState, ItemType, LearningItem};
use crate::sync::journal::journal_entity;
use crate::sync::types::{EntityType, SyncOperation};
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use tauri::State;

#[derive(Debug, Clone, serde::Serialize)]
pub struct DuplicateCandidate {
    pub id: String,
    pub question: String,
    pub similarity: f64,
}

pub use crate::models::CardVersionEntry;

fn tokenize(text: &str) -> HashSet<String> {
    text.to_lowercase()
        .split_whitespace()
        .map(|part| {
            part.trim_matches(|c: char| !c.is_alphanumeric())
                .to_string()
        })
        .filter(|token| !token.is_empty())
        .collect()
}

fn jaccard_similarity(a: &str, b: &str) -> f64 {
    let set_a = tokenize(a);
    let set_b = tokenize(b);
    if set_a.is_empty() || set_b.is_empty() {
        return 0.0;
    }
    let intersection = set_a.intersection(&set_b).count() as f64;
    let union = set_a.union(&set_b).count() as f64;
    if union <= 0.0 {
        0.0
    } else {
        intersection / union
    }
}

#[tauri::command]
pub async fn get_due_items(
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<LearningItem>> {
    let now = chrono::Utc::now();
    let items = repo
        .get_due_learning_items(&now, collection_id.as_deref())
        .await?;

    if items.is_empty() {
        return Ok(Vec::new());
    }

    // ---- Batched prerequisite resolution (Finding K) ----
    // Previously this did N+M sequential queries: one settings lookup per due
    // item (`load_learning_item_prerequisites`), then one `learning_items`
    // lookup per prerequisite id (itself a full-table scan). We now do at most
    // TWO batched queries regardless of how many due items / prerequisites
    // there are.
    //
    // Prerequisites are stored as JSON arrays in the `settings` table under
    // keys of the form `card_prereq:{item_id}` (see
    // `store_learning_item_prerequisites`).

    // 1. Build the exact settings keys for every due item and fetch them all
    //    at once: `SELECT key, value FROM settings WHERE key IN (...)`.
    let prereq_keys: Vec<String> = items
        .iter()
        .map(|i| format!("card_prereq:{}", i.id))
        .collect();
    let prereqs_by_item = fetch_prerequisite_map(&prereq_keys, &repo).await?;

    // 2. Collect the UNIQUE set of prerequisite ids across all due items.
    let mut unique_prereq_ids: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for ids in prereqs_by_item.values() {
        for id in ids {
            if seen.insert(id.clone()) {
                unique_prereq_ids.push(id.clone());
            }
        }
    }

    // 3. Fetch every prerequisite learning item in ONE batched query, reusing
    //    the shared row decoder so decoding stays consistent with the rest of
    //    the codebase.
    let prereq_items_map = fetch_learning_items_by_ids(&unique_prereq_ids, &repo).await?;

    // 4. Resolve blocking in memory, preserving the original semantics:
    //    an item is blocked if ANY prerequisite is missing OR not yet "mature"
    //    (review_count > 0 AND interval >= 21.0 AND state == Review).
    let mut filtered = Vec::new();
    for item in items {
        let prerequisite_ids = prereqs_by_item.get(&item.id);
        let mut blocked = false;
        if let Some(prerequisite_ids) = prerequisite_ids {
            for prerequisite_id in prerequisite_ids {
                match prereq_items_map.get(prerequisite_id) {
                    Some(prerequisite) => {
                        let is_mature = prerequisite.review_count > 0
                            && prerequisite.interval >= 21.0
                            && matches!(prerequisite.state, ItemState::Review);
                        if !is_mature {
                            blocked = true;
                            break;
                        }
                    }
                    None => {
                        // Prerequisite id referenced but no such learning item.
                        blocked = true;
                        break;
                    }
                }
            }
        }
        if !blocked {
            filtered.push(item);
        }
    }
    Ok(filtered)
}

/// Batched fetch of prerequisite id lists for many due items at once.
///
/// `keys` are the exact `settings` table keys (`card_prereq:{item_id}`) to
/// look up. Returns a map from `item_id` (parsed out of the key) to its list
/// of prerequisite item ids. Keys are chunked (900 at a time) to respect
/// SQLite's bind limit.
async fn fetch_prerequisite_map(
    keys: &[String],
    repo: &Repository,
) -> Result<HashMap<String, Vec<String>>> {
    if keys.is_empty() {
        return Ok(HashMap::new());
    }

    const CHUNK_SIZE: usize = 900;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();

    for chunk in keys.chunks(CHUNK_SIZE) {
        let placeholders: Vec<String> = chunk
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT key, value FROM settings WHERE key IN ({})",
            placeholders.join(",")
        );
        let mut query = sqlx::query(&sql);
        for k in chunk {
            query = query.bind(k);
        }
        let rows = query.fetch_all(repo.pool()).await?;

        for row in &rows {
            let key: String = row.try_get("key").unwrap_or_default();
            let value: String = row.try_get("value").unwrap_or_default();
            // Parse "card_prereq:{item_id}" back to item_id.
            let item_id = match key.strip_prefix("card_prereq:") {
                Some(id) => id.to_string(),
                None => continue,
            };
            let ids: Vec<String> = serde_json::from_str(&value).unwrap_or_default();
            map.insert(item_id, ids);
        }
    }

    Ok(map)
}

/// Batched fetch of `LearningItem` rows by id. Reuses
/// `Repository::row_to_learning_item` so decoding is identical to every other
/// read path. Ids are chunked (500 at a time) to respect SQLite's bind limit,
/// mirroring `get_review_log_for_items`.
async fn fetch_learning_items_by_ids(
    ids: &[String],
    repo: &Repository,
) -> Result<HashMap<String, LearningItem>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }

    const CHUNK_SIZE: usize = 500;
    let mut map: HashMap<String, LearningItem> = HashMap::new();

    for chunk in ids.chunks(CHUNK_SIZE) {
        let placeholders: Vec<String> = chunk
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT * FROM learning_items WHERE id IN ({})",
            placeholders.join(",")
        );
        let mut query = sqlx::query(&sql);
        for id in chunk {
            query = query.bind(id);
        }
        let rows = query.fetch_all(repo.pool()).await?;
        for row in &rows {
            if let Ok(item) = Repository::row_to_learning_item(row) {
                map.insert(item.id.clone(), item);
            }
        }
    }

    Ok(map)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_learning_item(
    item_type: String,
    question: String,
    answer: Option<String>,
    cloze_text: Option<String>,
    extract_id: Option<String>,
    document_id: Option<String>,
    prerequisite_item_ids: Option<Vec<String>>,
    tags: Option<Vec<String>>,
    image_asset_ids: Option<Vec<String>>,
    interaction_metadata: Option<serde_json::Value>,
    // Serialized `CardSourceReference` JSON — flashcard provenance captured
    // at creation time (document, locator, excerpt, fingerprint). Ignored
    // (stored as-is) when the card links to an extract, whose selection
    // context remains the authoritative anchor.
    source_reference: Option<String>,
    source_revision: Option<String>,
    extract_revision: Option<String>,
    allow_duplicate: Option<bool>,
    // Narrow retry-safe acceptance identity (agent learning proposals). A
    // retried call with the same pair returns the originally committed row.
    acceptance_id: Option<String>,
    proposal_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    let existing_for_acceptance = if let (Some(acceptance), Some(proposal)) = (&acceptance_id, &proposal_id) {
        find_learning_item_by_acceptance_key(acceptance, proposal, &repo).await?
    } else { None };
    let acceptance_key = acceptance_id.clone();
    let proposal_key = proposal_id.clone();

    if !allow_duplicate.unwrap_or(false) && existing_for_acceptance.is_none() {
        // Agent text proposals use a bounded candidate read; legacy/manual
        // creates keep the existing whole-library check.
        let candidates = if acceptance_id.is_some() {
            find_duplicate_candidates_bounded(&question, 3, &repo).await?
        } else {
            find_duplicate_candidates(&question, 3, &repo).await?
        };
        if !candidates.is_empty() && candidates[0].similarity >= 0.85 {
            return Err(PlethoraError::InvalidInput(format!(
                "Potential duplicate detected ({}: {:.0}% similarity). Set allow_duplicate=true to save anyway.",
                candidates[0].id,
                candidates[0].similarity * 100.0
            )));
        }
    }

    let item_type = match item_type.to_ascii_lowercase().as_str() {
        "flashcard" => ItemType::Flashcard,
        "cloze" => ItemType::Cloze,
        "qa" => ItemType::Qa,
        "basic" => ItemType::Basic,
        _ => return Err(PlethoraError::InvalidInput("Unsupported card type".into())),
    };

    let mut item = LearningItem::new(item_type, question);
    item.extract_id = extract_id.clone();
    item.document_id = document_id;
    item.answer = answer;
    item.cloze_text = cloze_text;
    item.tags = tags.unwrap_or_default();
    item.image_asset_ids = image_asset_ids.unwrap_or_default();
    item.interaction_metadata = interaction_metadata;
    item.acceptance_id = acceptance_id.filter(|value| !value.trim().is_empty());
    item.proposal_id = proposal_id.filter(|value| !value.trim().is_empty());
    // Extract linkage is the primary provenance; only anchor extract-less
    // cards so the two paths never disagree about where a card came from.
    if extract_id.is_none() {
        item.source_reference = source_reference;
    }

    // If an extract lineage was recorded but no document_id was supplied,
    // resolve the document from the extract so the element_tree edge and the
    // documents.learning_item_count bump land on the right document. (The
    // Studio sends extract_id when authoring a card against an extract; the
    // extract's document is the authoritative parent.)
    if item.extract_id.is_some() && item.document_id.is_none() {
        if let Some(ext_id) = &item.extract_id {
            if let Ok(Some(extract)) = repo.get_extract(ext_id).await {
                item.document_id = Some(extract.document_id);
            }
        }
    }
    let source = crate::database::learning_item_source::ExpectedLearningSource { document_revision: source_revision, extract_revision };
    let created = match repo.create_learning_item_with_source(&item, Some(&source)).await {
        Ok(created) => created,
        Err(error) => {
            // Concurrent retry: the unique (acceptance_id, proposal_id) index
            // let the other transaction win. Return its committed row.
            if let (Some(acceptance), Some(proposal)) = (&acceptance_key, &proposal_key) {
                if let Some(existing) =
                    find_learning_item_by_acceptance_key(acceptance, proposal, &repo).await?
                {
                    if crate::database::learning_item_source::same_learning_candidate(&existing, &item) { return Ok(existing); }
                }
            }
            return Err(error);
        }
    };
    if let Some(prerequisites) = prerequisite_item_ids {
        store_learning_item_prerequisites(&created.id, &prerequisites, &repo).await?;
    }
    append_daily_note_learning_item_link(&created.id, &created.question, &repo).await?;
    Ok(created)
}

/// One card in a `create_learning_items_batch` request. Mirrors the fields the
/// frontend sends for `create_learning_item`, without prerequisite handling
/// (batch flows have no prerequisites).
#[derive(serde::Deserialize)]
pub struct CreateLearningItemBatchEntry {
    #[serde(rename = "item_type")]
    pub item_type: String,
    pub question: String,
    pub answer: Option<String>,
    #[serde(rename = "cloze_text")]
    pub cloze_text: Option<String>,
    #[serde(rename = "extract_id")]
    pub extract_id: Option<String>,
    #[serde(rename = "document_id")]
    pub document_id: Option<String>,
    pub tags: Option<Vec<String>>,
    #[serde(rename = "image_asset_ids")]
    pub image_asset_ids: Option<Vec<String>>,
    #[serde(rename = "interaction_metadata")]
    pub interaction_metadata: Option<serde_json::Value>,
    #[serde(rename = "source_reference")]
    pub source_reference: Option<String>,
    /// Narrow acceptance identity for agent text proposals. Entries WITHOUT a
    /// proposal_id (e.g. every occlusion-composer row) keep the historical
    /// no-duplicate-check batch semantics.
    #[serde(rename = "acceptance_id")]
    pub acceptance_id: Option<String>,
    #[serde(rename = "proposal_id")]
    pub proposal_id: Option<String>,
}

/// Create several cards in one transaction (all or none), reporting the whole
/// session's result. Used by the Image Occlusion Composer, where one authoring
/// session produces multiple cards. Semantic duplicate detection is skipped by
/// design on this path.
#[tauri::command]
pub async fn create_learning_items_batch(
    items: Vec<CreateLearningItemBatchEntry>,
    repo: State<'_, Repository>,
) -> Result<Vec<LearningItem>> {
    // 1. Resolve already-committed rows for retried acceptance keys. This is
    //    the retry-safe path: only unsaved proposals are inserted.
    let mut results: Vec<Option<LearningItem>> = vec![None; items.len()];
    for (index, entry) in items.iter().enumerate() {
        if let (Some(acceptance), Some(proposal)) = (&entry.acceptance_id, &entry.proposal_id) {
            if let Some(existing) =
                find_learning_item_by_acceptance_key(acceptance, proposal, &repo).await?
            {
                results[index] = Some(existing);
            }
        }
    }

    // 2. Scoped text-proposal duplicate enforcement. Only entries carrying an
    //    application-assigned proposal id are checked; occlusion batches are
    //    intentionally unchanged.
    for (index, entry) in items.iter().enumerate() {
        if results[index].is_some() || entry.proposal_id.is_none() {
            continue;
        }
        let candidates = find_duplicate_candidates_bounded(&entry.question, 3, &repo).await?;
        if !candidates.is_empty() && candidates[0].similarity >= 0.85 {
            return Err(PlethoraError::InvalidInput(format!(
                "Potential duplicate detected for proposal {} ({}: {:.0}% similarity).",
                entry.proposal_id.as_deref().unwrap_or("unknown"),
                candidates[0].id,
                candidates[0].similarity * 100.0
            )));
        }
    }

    // 3. Build and insert only the missing rows.
    let mut to_create: Vec<LearningItem> = Vec::new();
    let mut create_indices: Vec<usize> = Vec::new();
    for (index, entry) in items.iter().enumerate() {
        if results[index].is_some() {
            continue;
        }
        let item_type = match entry.item_type.as_str() {
            "flashcard" => ItemType::Flashcard,
            "cloze" => ItemType::Cloze,
            "qa" => ItemType::Qa,
            _ => ItemType::Basic,
        };
        let mut item = LearningItem::new(item_type, entry.question.clone());
        item.extract_id = entry.extract_id.clone();
        item.document_id = entry.document_id.clone();
        item.answer = entry.answer.clone();
        item.cloze_text = entry.cloze_text.clone().or_else(|| (item.item_type == ItemType::Cloze).then(|| item.question.clone()));
        item.tags = entry.tags.clone().unwrap_or_default();
        item.image_asset_ids = entry.image_asset_ids.clone().unwrap_or_default();
        item.interaction_metadata = entry.interaction_metadata.clone();
        item.acceptance_id = entry
            .acceptance_id
            .clone()
            .filter(|value| !value.trim().is_empty());
        item.proposal_id = entry
            .proposal_id
            .clone()
            .filter(|value| !value.trim().is_empty());
        // Same rule as the single create: extract linkage wins; the serialized
        // source reference only anchors extract-less cards.
        if entry.extract_id.is_none() {
            item.source_reference = entry.source_reference.clone();
        }
        if item.extract_id.is_some() && item.document_id.is_none() {
            if let Some(ext_id) = &item.extract_id {
                if let Ok(Some(extract)) = repo.get_extract(ext_id).await {
                    item.document_id = Some(extract.document_id);
                }
            }
        }
        to_create.push(item);
        create_indices.push(index);
    }

    if !to_create.is_empty() {
        let created = match repo.create_learning_items_batch(&to_create).await {
            Ok(created) => created,
            Err(error) => {
                // Concurrent retry: if another transaction committed the same
                // acceptance keys, reconcile and return those rows instead of
                // failing the whole batch.
                let mut recovered: Vec<LearningItem> = Vec::with_capacity(items.len());
                let mut complete = true;
                for entry in &items {
                    match (&entry.acceptance_id, &entry.proposal_id) {
                        (Some(acceptance), Some(proposal)) => {
                            match find_learning_item_by_acceptance_key(acceptance, proposal, &repo)
                                .await?
                            {
                                Some(existing) => recovered.push(existing),
                                None => {
                                    complete = false;
                                    break;
                                }
                            }
                        }
                        _ => {
                            complete = false;
                            break;
                        }
                    }
                }
                if complete {
                    return Ok(recovered);
                }
                return Err(error);
            }
        };
        for (offset, created_item) in created.into_iter().enumerate() {
            if let Some(index) = create_indices.get(offset) {
                append_daily_note_learning_item_link(
                    &created_item.id,
                    &created_item.question,
                    &repo,
                )
                .await?;
                results[*index] = Some(created_item);
            }
        }
    }

    let mut ordered = Vec::with_capacity(items.len());
    for (index, item) in results.into_iter().enumerate() {
        match item {
            Some(item) => ordered.push(item),
            None => {
                return Err(PlethoraError::Internal(format!(
                    "Batch acceptance lost row {}; nothing was reported as saved",
                    index
                )))
            }
        }
    }
    Ok(ordered)
}

/// Set a learning item's user-set priority.
/// Mirrors `update_document_priority`: the slider is the authoritative
/// importance rank on the 0-100 scale; the score is derived from it. FSRS
/// urgency (which drives *when* the card is scheduled) is untouched.
#[tauri::command]
pub async fn update_learning_item_priority(
    id: String,
    slider: i32,
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    let slider_value = slider.clamp(0, 100);
    let score =
        crate::database::priority_rank::key_for_slider(repo.db_pool(), slider_value).await?;
    let updated = repo
        .update_learning_item_priority(&id, slider_value, score)
        .await?;
    Ok(updated)
}

#[tauri::command]
pub async fn generate_learning_items_from_extract(
    extract_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<LearningItem>> {
    let extract = repo
        .get_extract(&extract_id)
        .await?
        .ok_or_else(|| crate::error::PlethoraError::NotFound(format!("Extract {}", extract_id)))?;

    // Generate learning items
    let generator = LearningItemGenerator::new();
    let items = generator.generate_from_extract(&extract);

    let mut created_items = Vec::new();
    for item in items {
        let created = repo.create_learning_item(&item).await?;
        append_daily_note_learning_item_link(&created.id, &created.question, &repo).await?;
        created_items.push(created);
    }

    Ok(created_items)
}

#[tauri::command]
pub async fn get_learning_items(
    document_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<LearningItem>> {
    let items = repo.get_learning_items_by_document(&document_id).await?;
    Ok(items)
}

#[tauri::command]
pub async fn get_learning_item(
    item_id: String,
    repo: State<'_, Repository>,
) -> Result<Option<LearningItem>> {
    let item = repo.get_learning_item(&item_id).await?;
    Ok(item)
}

#[tauri::command]
pub async fn delete_learning_item(item_id: String, repo: State<'_, Repository>) -> Result<()> {
    let item = repo
        .get_learning_item(&item_id)
        .await?
        .ok_or_else(|| PlethoraError::NotFound(format!("Learning item {}", item_id)))?;

    let mut transaction = repo.pool().begin().await?;

    // Unlink the learning item's element_tree node from the overlay topology,
    // mirroring create_learning_item's register_node edge.
    if let Some(node_id) = find_node_id_in_tx(&mut transaction, ElementKind::LearningItem, &item_id)
        .await
        .ok()
        .flatten()
    {
        unlink_node_in_tx(&mut transaction, node_id).await?;
    }

    let delete_payload = serde_json::json!({
        "schema_version": 1,
        "entity_type": "learning_item",
        "id": item_id,
        "deleted_at": chrono::Utc::now().to_rfc3339(),
    });
    journal_entity(
        &mut transaction,
        EntityType::LearningItem,
        &item_id,
        SyncOperation::Delete,
        crate::sync::outbox::learning_item_revision(item.updated_at.as_deref()),
        serde_json::to_vec(&delete_payload)
            .map_err(|e| PlethoraError::Internal(format!("Sync payload encode failed: {e}")))?,
    )
    .await?;

    let deleted = sqlx::query("DELETE FROM learning_items WHERE id = ?1")
        .bind(&item_id)
        .execute(&mut *transaction)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(PlethoraError::NotFound(format!(
            "Learning item {}",
            item_id
        )));
    }

    if let Some(document_id) = item.document_id {
        sqlx::query(
            r#"
            UPDATE documents
            SET learning_item_count = (
                SELECT COUNT(*) FROM learning_items WHERE document_id = ?1
            )
            WHERE id = ?1
            "#,
        )
        .bind(document_id)
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn restore_learning_item(
    item: LearningItem,
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    let restored = repo.create_learning_item(&item).await?;
    if let Some(document_id) = &restored.document_id {
        sqlx::query(
            r#"
            UPDATE documents
            SET learning_item_count = (
                SELECT COUNT(*) FROM learning_items WHERE document_id = ?1
            )
            WHERE id = ?1
            "#,
        )
        .bind(document_id)
        .execute(repo.pool())
        .await?;
    }
    Ok(restored)
}

#[tauri::command]
pub async fn get_learning_items_by_extract(
    extract_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<LearningItem>> {
    let items = repo.get_learning_items_by_extract(&extract_id).await?;
    Ok(items)
}

#[tauri::command]
pub async fn get_all_learning_items(repo: State<'_, Repository>) -> Result<Vec<LearningItem>> {
    let items = repo.get_all_learning_items().await?;
    Ok(items)
}

#[tauri::command]
pub async fn update_learning_item_content_with_version(
    item_id: String,
    question: String,
    answer: Option<String>,
    cloze_text: Option<String>,
    cloze_ranges: Option<Vec<(usize, usize)>>,
    tags: Option<Vec<String>>,
    reason: Option<String>,
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    repo.update_learning_item_content_and_tags_with_version(
        &item_id,
        &question,
        answer.as_deref(),
        cloze_text.as_deref(),
        cloze_ranges.as_deref(),
        tags.as_deref(),
        reason.as_deref(),
    )
    .await?
    .ok_or_else(|| PlethoraError::NotFound(format!("Learning item {}", item_id)))
}

#[tauri::command]
pub async fn update_learning_item_tags(
    item_id: String,
    tags: Vec<String>,
    interaction_metadata: Option<serde_json::Value>,
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    let mut item = repo
        .get_learning_item(&item_id)
        .await?
        .ok_or_else(|| PlethoraError::NotFound(format!("Learning item {}", item_id)))?;

    repo.update_learning_item_tags_and_metadata(&item_id, &tags, interaction_metadata.as_ref())
        .await
}

#[tauri::command]
pub async fn get_learning_item_versions(
    item_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<CardVersionEntry>> {
    let rows = sqlx::query(
        "SELECT key, value FROM settings WHERE key LIKE ?1 ORDER BY date_modified DESC",
    )
    .bind(format!("card_version:{}:%", item_id))
    .fetch_all(repo.pool())
    .await?;

    let mut versions = Vec::new();
    for row in rows {
        let value: String = row.try_get("value").unwrap_or_default();
        if let Ok(version) = serde_json::from_str::<CardVersionEntry>(&value) {
            versions.push(version);
        }
    }
    Ok(versions)
}

#[tauri::command]
pub async fn revert_learning_item_version(
    item_id: String,
    version_id: String,
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    let key = format!("card_version:{}:{}", item_id, version_id);
    let row = sqlx::query("SELECT value FROM settings WHERE key = ?1")
        .bind(&key)
        .fetch_optional(repo.pool())
        .await?;

    let value: String = row
        .ok_or_else(|| PlethoraError::NotFound(format!("Version {}", version_id)))?
        .try_get("value")
        .unwrap_or_default();
    let version: CardVersionEntry = serde_json::from_str(&value)
        .map_err(|e| PlethoraError::Internal(format!("Invalid version payload: {}", e)))?;

    repo.update_learning_item_content_and_tags_with_version(
        &item_id,
        &version.question,
        version.answer.as_deref(),
        version.cloze_text.as_deref(),
        version.cloze_ranges.as_deref(),
        version.tags.as_deref(),
        Some(&format!("Revert to version {}", version_id)),
    )
    .await?
    .ok_or_else(|| PlethoraError::NotFound(format!("Learning item {}", item_id)))
}

#[tauri::command]
pub async fn export_mnemosyne(
    output_path: Option<String>,
    repo: State<'_, Repository>,
) -> Result<String> {
    let items = repo.get_all_learning_items().await?;
    let mut content = String::from("# Mnemosyne Export\n");
    for item in items {
        let question = item.question.replace('\n', " ");
        let answer = item.answer.unwrap_or_default().replace('\n', " ");
        content.push_str(&format!("{}\t{}\n", question, answer));
    }

    let target = output_path.unwrap_or_else(|| {
        std::env::temp_dir()
            .join(format!(
                "plethora-mnemosyne-{}.txt",
                chrono::Utc::now().timestamp()
            ))
            .to_string_lossy()
            .to_string()
    });
    std::fs::write(&target, content)
        .map_err(|e| PlethoraError::Internal(format!("Failed to write export: {}", e)))?;
    Ok(target)
}

#[tauri::command]
pub async fn set_learning_item_prerequisites(
    item_id: String,
    prerequisite_item_ids: Vec<String>,
    repo: State<'_, Repository>,
) -> Result<()> {
    store_learning_item_prerequisites(&item_id, &prerequisite_item_ids, &repo).await
}

#[tauri::command]
pub async fn get_learning_item_prerequisites(
    item_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<String>> {
    load_learning_item_prerequisites(&item_id, &repo).await
}

#[tauri::command]
pub async fn get_daily_note_links(
    date: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<serde_json::Value>> {
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let key = format!("daily_note:{}", date.unwrap_or(today));
    let row = sqlx::query("SELECT value FROM settings WHERE key = ?1")
        .bind(key)
        .fetch_optional(repo.pool())
        .await?;
    let value = row
        .and_then(|record| record.try_get::<String, _>("value").ok())
        .unwrap_or_else(|| "[]".to_string());
    let parsed = serde_json::from_str::<Vec<serde_json::Value>>(&value).unwrap_or_default();
    Ok(parsed)
}

async fn store_learning_item_prerequisites(
    item_id: &str,
    prerequisite_item_ids: &[String],
    repo: &Repository,
) -> Result<()> {
    let key = format!("card_prereq:{}", item_id);
    let value = serde_json::to_string(prerequisite_item_ids).unwrap_or_else(|_| "[]".to_string());
    sqlx::query(
        "INSERT INTO settings (key, value, date_modified) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, date_modified = excluded.date_modified"
    )
    .bind(key)
    .bind(value)
    .bind(chrono::Utc::now())
    .execute(repo.pool())
    .await?;
    Ok(())
}

async fn load_learning_item_prerequisites(item_id: &str, repo: &Repository) -> Result<Vec<String>> {
    let key = format!("card_prereq:{}", item_id);
    let row = sqlx::query("SELECT value FROM settings WHERE key = ?1")
        .bind(key)
        .fetch_optional(repo.pool())
        .await?;
    if let Some(record) = row {
        let value: String = record.try_get("value").unwrap_or_default();
        let parsed = serde_json::from_str::<Vec<String>>(&value).unwrap_or_default();
        return Ok(parsed);
    }
    Ok(Vec::new())
}

async fn append_daily_note_learning_item_link(
    item_id: &str,
    question: &str,
    repo: &Repository,
) -> Result<()> {
    let key = format!("daily_note:{}", chrono::Utc::now().format("%Y-%m-%d"));
    let row = sqlx::query("SELECT value FROM settings WHERE key = ?1")
        .bind(&key)
        .fetch_optional(repo.pool())
        .await?;
    let mut entries = row
        .and_then(|record| record.try_get::<String, _>("value").ok())
        .and_then(|value| serde_json::from_str::<Vec<serde_json::Value>>(&value).ok())
        .unwrap_or_default();
    entries.push(serde_json::json!({
        "type": "learning_item",
        "id": item_id,
        "title": question,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    }));
    let value = serde_json::to_string(&entries).unwrap_or_else(|_| "[]".to_string());
    sqlx::query(
        "INSERT INTO settings (key, value, date_modified) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, date_modified = excluded.date_modified"
    )
    .bind(key)
    .bind(value)
    .bind(chrono::Utc::now())
    .execute(repo.pool())
    .await?;
    Ok(())
}

async fn find_duplicate_candidates(
    question: &str,
    limit: usize,
    repo: &Repository,
) -> Result<Vec<DuplicateCandidate>> {
    let items = repo.get_all_learning_items().await?;
    let mut scored = items
        .into_iter()
        .map(|item| DuplicateCandidate {
            id: item.id,
            question: item.question.clone(),
            similarity: jaccard_similarity(question, &item.question),
        })
        .filter(|candidate| candidate.similarity >= 0.6)
        .collect::<Vec<_>>();

    scored.sort_by(|a, b| {
        b.similarity
            .partial_cmp(&a.similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    scored.truncate(limit);
    Ok(scored)
}

/// Bounded duplicate candidates: SQL prefilter (token LIKE) + LIMIT, then the
/// same Jaccard score used by the single-create path. Used for narrow
/// text-proposal enforcement so an agent batch never scans the whole library.
async fn find_duplicate_candidates_bounded(
    question: &str,
    limit: usize,
    repo: &Repository,
) -> Result<Vec<DuplicateCandidate>> {
    let mut seen = HashSet::new();
    let tokens: Vec<String> = tokenize(question)
        .into_iter()
        .filter(|token| token.len() >= 4 && seen.insert(token.clone()))
        .take(4)
        .collect();
    if tokens.is_empty() {
        return Ok(Vec::new());
    }
    let mut clauses = Vec::new();
    for _ in 0..tokens.len() {
        clauses.push(
            "(lower(question) LIKE ? OR lower(COALESCE(answer, '')) LIKE ? OR lower(COALESCE(cloze_text, '')) LIKE ?)"
                .to_string(),
        );
    }
    let sql = format!(
        "SELECT * FROM learning_items WHERE {} ORDER BY date_modified DESC LIMIT 200",
        clauses.join(" OR ")
    );
    let mut query = sqlx::query(&sql);
    for token in &tokens {
        let pattern = format!("%{}%", token.to_lowercase());
        query = query
            .bind(pattern.clone())
            .bind(pattern.clone())
            .bind(pattern);
    }
    let rows = query.fetch_all(repo.pool()).await?;
    let mut scored = rows
        .iter()
        .filter_map(|row| Repository::row_to_learning_item(row).ok())
        .map(|item| DuplicateCandidate {
            id: item.id,
            question: item.question.clone(),
            similarity: jaccard_similarity(question, &item.question),
        })
        .filter(|candidate| candidate.similarity >= 0.6)
        .collect::<Vec<_>>();
    scored.sort_by(|a, b| {
        b.similarity
            .partial_cmp(&a.similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    scored.truncate(limit);
    Ok(scored)
}

/// Retry-safe lookup for the narrow (acceptance_id, proposal_id) identity.
pub(crate) async fn find_learning_item_by_acceptance_key(
    acceptance_id: &str,
    proposal_id: &str,
    repo: &Repository,
) -> Result<Option<LearningItem>> {
    let row = sqlx::query(
        "SELECT * FROM learning_items WHERE acceptance_id = ?1 AND proposal_id = ?2 LIMIT 1",
    )
    .bind(acceptance_id)
    .bind(proposal_id)
    .fetch_optional(repo.pool())
    .await?;
    match row {
        Some(row) => Ok(Some(Repository::row_to_learning_item(&row)?)),
        None => Ok(None),
    }
}

/// Reconcile an ambiguous acceptance transport failure: every row already
/// committed under this acceptance id, in creation order. Read-only.
#[tauri::command]
pub async fn get_learning_items_by_acceptance_key(
    acceptance_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<LearningItem>> {
    let rows = sqlx::query(
        "SELECT * FROM learning_items WHERE acceptance_id = ?1 ORDER BY date_created ASC",
    )
    .bind(&acceptance_id)
    .fetch_all(repo.pool())
    .await?;
    let mut items = Vec::with_capacity(rows.len());
    for row in &rows {
        items.push(Repository::row_to_learning_item(row)?);
    }
    Ok(items)
}

/// Bounded, server-filtered card read for the learning agent (task 1.3).
/// Never returns more than 50 rows and never scans/returns the whole library.
#[tauri::command]
pub async fn search_learning_items_bounded(
    query: Option<String>,
    document_ids: Option<Vec<String>>,
    limit: Option<i64>,
    repo: State<'_, Repository>,
) -> Result<Vec<LearningItem>> {
    let limit = limit.unwrap_or(20).clamp(1, 50);
    let mut conditions: Vec<String> = Vec::new();
    let mut bindings: Vec<String> = Vec::new();

    if let Some(text) = query
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        let mut seen = HashSet::new();
        let tokens: Vec<String> = tokenize(text)
            .into_iter()
            .filter(|token| seen.insert(token.clone()))
            .take(4)
            .collect();
        if tokens.is_empty() {
            return Ok(Vec::new());
        }
        let mut token_clauses = Vec::new();
        for _ in 0..tokens.len() {
            token_clauses.push(
                "(lower(question) LIKE ? OR lower(COALESCE(answer, '')) LIKE ? OR lower(COALESCE(cloze_text, '')) LIKE ? OR lower(tags) LIKE ?)"
                    .to_string(),
            );
        }
        for token in tokens {
            let pattern = format!("%{}%", token.to_lowercase());
            for _ in 0..4 {
                bindings.push(pattern.clone());
            }
        }
        conditions.push(format!("({})", token_clauses.join(" OR ")));
    }

    if let Some(ids) = document_ids.as_ref().filter(|ids| !ids.is_empty()) {
        let placeholders: Vec<String> = (0..ids.len()).map(|_| "?".to_string()).collect();
        conditions.push(format!("document_id IN ({})", placeholders.join(",")));
        for id in ids {
            bindings.push(id.clone());
        }
    }

    let where_clause = if conditions.is_empty() {
        "1=1".to_string()
    } else {
        conditions.join(" AND ")
    };
    let sql = format!(
        "SELECT * FROM learning_items WHERE {} ORDER BY date_modified DESC LIMIT {}",
        where_clause, limit
    );
    let mut q = sqlx::query(&sql);
    for binding in bindings {
        q = q.bind(binding);
    }
    let rows = q.fetch_all(repo.pool()).await?;
    let mut items = Vec::with_capacity(rows.len());
    for row in &rows {
        items.push(Repository::row_to_learning_item(row)?);
    }
    Ok(items)
}

/// Bounded due-item read for the agent's "what should I review" answer.
#[tauri::command]
pub async fn get_due_learning_items_bounded(
    limit: Option<i64>,
    repo: State<'_, Repository>,
) -> Result<Vec<LearningItem>> {
    let limit = limit.unwrap_or(20).clamp(1, 50);
    let now = chrono::Utc::now();
    let sql = format!(
        "SELECT * FROM learning_items WHERE due_date <= ? AND is_suspended = false ORDER BY due_date LIMIT {}",
        limit
    );
    let rows = sqlx::query(&sql).bind(now).fetch_all(repo.pool()).await?;
    let mut items = Vec::with_capacity(rows.len());
    for row in &rows {
        items.push(Repository::row_to_learning_item(row)?);
    }
    Ok(items)
}

#[tauri::command]
pub async fn check_semantic_duplicate_candidates(
    question: String,
    limit: Option<i32>,
    repo: State<'_, Repository>,
) -> Result<Vec<DuplicateCandidate>> {
    let top_k = limit.unwrap_or(5).max(1) as usize;
    find_duplicate_candidates(&question, top_k, &repo).await
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
/// Bulk queue actions previously called `get_all_learning_items` (a full
/// `SELECT *` of the table including cloze/answer/tags text) and then filtered
/// client-side by `updated_at > since`, pulling the entire library into the
/// WebView heap. This returns only the ids newer than the cutoff (the
/// `idx_learning_items_updated_at` index serves it), so the caller can
/// re-fetch full rows for just the handful of survivors.
#[tauri::command]
pub async fn get_learning_item_ids_modified_since(
    since_hlc: String,
    repo: State<'_, Repository>,
) -> Result<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT id FROM learning_items WHERE updated_at > ?1 ORDER BY updated_at ASC",
    )
    .bind(since_hlc)
    .fetch_all(repo.pool())
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Fetch the projected scheduling fields for the given learning-item ids.
///
/// Used by the queue auto-postpone path, which previously called
/// `get_all_learning_items` and built a Map of full rows (with all card text)
/// just to read a few scheduling fields. This returns only those fields for
/// the ids actually in the queue, so none of the heavy text columns cross the
/// IPC boundary. An empty/missing id is simply absent from the result.
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
mod acceptance_tests {
    use super::*;
    use crate::database::connection::Database;
    use crate::models::{FileType, ItemType, LearningItem};
    use std::path::PathBuf;

    async fn setup_repo() -> Repository {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");
        Repository::new(db.pool().clone())
    }

    fn card_with_key(question: &str, acceptance: &str, proposal: &str) -> LearningItem {
        let mut item = LearningItem::new(ItemType::Flashcard, question.to_string());
        item.answer = Some("answer".to_string());
        item.acceptance_id = Some(acceptance.to_string());
        item.proposal_id = Some(proposal.to_string());
        item
    }

    #[tokio::test]
    async fn acceptance_key_lookup_returns_the_committed_row() {
        let repo = setup_repo().await;
        let item = card_with_key("What is entropy?", "run-1", "run-1:p1");
        let created = repo.create_learning_item(&item).await.expect("create");

        let found = find_learning_item_by_acceptance_key("run-1", "run-1:p1", &repo)
            .await
            .expect("lookup");
        assert_eq!(found.map(|row| row.id), Some(created.id));
    }

    #[tokio::test]
    async fn duplicate_acceptance_pair_is_rejected_by_the_unique_index() {
        let repo = setup_repo().await;
        repo.create_learning_item(&card_with_key("First?", "run-2", "run-2:p1"))
            .await
            .expect("first create");
        let duplicate = repo
            .create_learning_item(&card_with_key("Second?", "run-2", "run-2:p1"))
            .await;
        assert!(
            duplicate.is_err(),
            "the database must protect (acceptance_id, proposal_id)"
        );
    }

    #[tokio::test]
    async fn different_proposals_in_one_acceptance_are_allowed() {
        let repo = setup_repo().await;
        repo.create_learning_item(&card_with_key("First?", "run-3", "run-3:p1"))
            .await
            .expect("first create");
        repo.create_learning_item(&card_with_key("Second?", "run-3", "run-3:p2"))
            .await
            .expect("second create");
        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM learning_items WHERE acceptance_id = 'run-3'")
                .fetch_one(repo.pool())
                .await
                .expect("count");
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn legacy_rows_without_keys_stay_null_and_readable() {
        let repo = setup_repo().await;
        let legacy = LearningItem::new(ItemType::Flashcard, "Legacy?".to_string());
        let created = repo.create_learning_item(&legacy).await.expect("create");
        assert!(created.acceptance_id.is_none());
        assert!(created.proposal_id.is_none());
    }

    #[tokio::test]
    async fn bounded_duplicate_check_finds_a_near_duplicate_without_a_full_scan() {
        let repo = setup_repo().await;
        let existing = LearningItem::new(
            ItemType::Flashcard,
            "What is the pumping lemma for context free languages?".to_string(),
        );
        repo.create_learning_item(&existing).await.expect("create");

        let candidates = find_duplicate_candidates_bounded(
            "What is the pumping lemma for context free languages?",
            3,
            &repo,
        )
        .await
        .expect("bounded duplicate check");
        assert_eq!(
            candidates.first().map(|row| row.id.as_str()),
            Some(existing.id.as_str())
        );
    }

    #[tokio::test]
    async fn bounded_card_read_respects_document_filter_and_limit() {
        let repo = setup_repo().await;
        let document = crate::models::Document::new(
            "Paper".to_string(),
            "/tmp/paper.pdf".to_string(),
            FileType::Pdf,
        );
        let document_id = document.id.clone();
        repo.create_document(&document).await.expect("document");
        for index in 0..4 {
            let mut item = LearningItem::new(
                ItemType::Flashcard,
                format!("Question about entropy {index}?"),
            );
            item.document_id = Some(document_id.clone());
            repo.create_learning_item(&item).await.expect("card");
        }
        let rows = sqlx::query(
            "SELECT * FROM learning_items WHERE document_id = ?1 ORDER BY date_modified DESC LIMIT 2",
        )
        .bind(&document_id)
        .fetch_all(repo.pool())
        .await
        .expect("bounded rows");
        assert_eq!(rows.len(), 2);
    }
}
