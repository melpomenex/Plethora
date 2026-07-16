//! Learning item commands

use crate::commands::review::RepositoryExt;
use crate::database::Repository;
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
    let prereq_keys: Vec<String> = items.iter().map(|i| format!("card_prereq:{}", i.id)).collect();
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
        let sql = format!("SELECT key, value FROM settings WHERE key IN ({})", placeholders.join(","));
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
        let sql = format!("SELECT * FROM learning_items WHERE id IN ({})", placeholders.join(","));
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
    item.document_id = document_id;
    item.answer = answer;
    item.cloze_text = cloze_text;
    item.tags = tags.unwrap_or_default();
    item.image_asset_ids = image_asset_ids.unwrap_or_default();
    item.interaction_metadata = interaction_metadata;
    let created = repo.create_learning_item(&item).await?;
    if let Some(prerequisites) = prerequisite_item_ids {
        store_learning_item_prerequisites(&created.id, &prerequisites, &repo).await?;
    }
    append_daily_note_learning_item_link(&created.id, &created.question, &repo).await?;
    Ok(created)
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
    reason: Option<String>,
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    let mut item = repo
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

    item.question = question;
    item.answer = answer;
    item.date_modified = chrono::Utc::now();
    repo.update_learning_item(&item).await?;
    Ok(item)
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
