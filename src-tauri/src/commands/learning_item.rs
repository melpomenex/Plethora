//! Learning item commands

use crate::commands::review::RepositoryExt;
use crate::database::{find_node_id_in_tx, unlink_node_in_tx, ElementKind, Repository};
use crate::error::{IncrementumError, Result};
use crate::generator::LearningItemGenerator;
use crate::models::{ItemState, ItemType, LearningItem};
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use tauri::State;

#[derive(Debug, Clone, serde::Serialize)]
pub struct DuplicateCandidate {
    pub id: String,
    pub question: String,
    pub similarity: f64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CardVersionEntry {
    pub version_id: String,
    pub item_id: String,
    pub timestamp: String,
    pub reason: Option<String>,
    pub question: String,
    pub answer: Option<String>,
}

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
    allow_duplicate: Option<bool>,
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    if !allow_duplicate.unwrap_or(false) {
        let candidates = find_duplicate_candidates(&question, 3, &repo).await?;
        if !candidates.is_empty() && candidates[0].similarity >= 0.85 {
            return Err(IncrementumError::InvalidInput(format!(
                "Potential duplicate detected ({}: {:.0}% similarity). Set allow_duplicate=true to save anyway.",
                candidates[0].id,
                candidates[0].similarity * 100.0
            )));
        }
    }

    let item_type = match item_type.as_str() {
        "flashcard" => ItemType::Flashcard,
        "cloze" => ItemType::Cloze,
        "qa" => ItemType::Qa,
        _ => ItemType::Basic,
    };

    let mut item = LearningItem::new(item_type, question);
    item.extract_id = extract_id.clone();
    item.document_id = document_id;
    item.answer = answer;
    item.cloze_text = cloze_text;
    item.tags = tags.unwrap_or_default();
    item.image_asset_ids = image_asset_ids.unwrap_or_default();
    item.interaction_metadata = interaction_metadata;

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
    let created = repo.create_learning_item(&item).await?;
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
    let mut to_create: Vec<LearningItem> = Vec::with_capacity(items.len());
    for entry in items {
        let item_type = match entry.item_type.as_str() {
            "flashcard" => ItemType::Flashcard,
            "cloze" => ItemType::Cloze,
            "qa" => ItemType::Qa,
            _ => ItemType::Basic,
        };
        let mut item = LearningItem::new(item_type, entry.question);
        item.extract_id = entry.extract_id.clone();
        item.document_id = entry.document_id;
        item.answer = entry.answer;
        item.cloze_text = entry.cloze_text;
        item.tags = entry.tags.unwrap_or_default();
        item.image_asset_ids = entry.image_asset_ids.unwrap_or_default();
        item.interaction_metadata = entry.interaction_metadata;
        if item.extract_id.is_some() && item.document_id.is_none() {
            if let Some(ext_id) = &item.extract_id {
                if let Ok(Some(extract)) = repo.get_extract(ext_id).await {
                    item.document_id = Some(extract.document_id);
                }
            }
        }
        to_create.push(item);
    }

    let created = repo.create_learning_items_batch(&to_create).await?;
    for item in &created {
        append_daily_note_learning_item_link(&item.id, &item.question, &repo).await?;
    }
    Ok(created)
}

/// Set a learning item's user-set priority (supermemo-faithful-queue Phase 3).
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
    let extract = repo.get_extract(&extract_id).await?.ok_or_else(|| {
        crate::error::IncrementumError::NotFound(format!("Extract {}", extract_id))
    })?;

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
        .ok_or_else(|| IncrementumError::NotFound(format!("Learning item {}", item_id)))?;

    let mut transaction = repo.pool().begin().await?;

    // Unlink the learning item's element_tree node from the overlay topology
    // (supermemo-faithful-queue Phase 2), mirroring create_learning_item's
    // register_node edge.
    if let Some(node_id) = find_node_id_in_tx(&mut transaction, ElementKind::LearningItem, &item_id)
        .await
        .ok()
        .flatten()
    {
        unlink_node_in_tx(&mut transaction, node_id).await?;
    }

    let deleted = sqlx::query("DELETE FROM learning_items WHERE id = ?1")
        .bind(&item_id)
        .execute(&mut *transaction)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(IncrementumError::NotFound(format!(
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
    reason: Option<String>,
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    let item = repo
        .get_learning_item(&item_id)
        .await?
        .ok_or_else(|| IncrementumError::NotFound(format!("Learning item {}", item_id)))?;

    let version_id = uuid::Uuid::new_v4().to_string();
    let timestamp = chrono::Utc::now().to_rfc3339();
    let version = CardVersionEntry {
        version_id: version_id.clone(),
        item_id: item_id.clone(),
        timestamp: timestamp.clone(),
        reason,
        question: item.question.clone(),
        answer: item.answer.clone(),
    };

    sqlx::query("INSERT INTO settings (key, value, date_modified) VALUES (?1, ?2, ?3)")
        .bind(format!("card_version:{}:{}", item_id, version_id))
        .bind(serde_json::to_string(&version).unwrap_or_else(|_| "{}".to_string()))
        .bind(chrono::Utc::now())
        .execute(repo.pool())
        .await?;

    // Direct content write: question always, answer/cloze_text only when
    // supplied (omitted columns keep their stored values — callers like the
    // Knowledge Sphere rename pass question only). Scheduling columns are
    // never touched by this path.
    repo.update_learning_item_content(
        &item_id,
        &question,
        answer.as_deref(),
        cloze_text.as_deref(),
    )
    .await?
    .ok_or_else(|| IncrementumError::NotFound(format!("Learning item {}", item_id)))
}

#[tauri::command]
pub async fn update_learning_item_tags(
    item_id: String,
    tags: Vec<String>,
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    let mut item = repo
        .get_learning_item(&item_id)
        .await?
        .ok_or_else(|| IncrementumError::NotFound(format!("Learning item {}", item_id)))?;

    item.tags = tags;
    item.date_modified = chrono::Utc::now();
    repo.update_learning_item(&item).await?;
    Ok(item)
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
        .ok_or_else(|| IncrementumError::NotFound(format!("Version {}", version_id)))?
        .try_get("value")
        .unwrap_or_default();
    let version: CardVersionEntry = serde_json::from_str(&value)
        .map_err(|e| IncrementumError::Internal(format!("Invalid version payload: {}", e)))?;

    let mut item = repo
        .get_learning_item(&item_id)
        .await?
        .ok_or_else(|| IncrementumError::NotFound(format!("Learning item {}", item_id)))?;
    item.question = version.question;
    item.answer = version.answer;
    item.date_modified = chrono::Utc::now();
    repo.update_learning_item(&item).await?;
    Ok(item)
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
                "incrementum-mnemosyne-{}.txt",
                chrono::Utc::now().timestamp()
            ))
            .to_string_lossy()
            .to_string()
    });
    std::fs::write(&target, content)
        .map_err(|e| IncrementumError::Internal(format!("Failed to write export: {}", e)))?;
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
