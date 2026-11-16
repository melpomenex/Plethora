//! Background visual semantic indexing worker for SQLite FTS5 (`image_visual_search_fts`).

use crate::database::Repository;
use crate::error::{PlethoraError, Result};
use crate::vision::mirage::MirageEngine;
use crate::vision::spatial_pairing::join_reading_order_text;
use crate::vision::types::{MirageRequestOptions, MirageResponse, MirageSection};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualSearchMatch {
    pub asset_id: String,
    pub scene_description: String,
    pub ocr_text: String,
    pub tags: Vec<String>,
    pub score: f64,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
}

/// Derive normalized auto-tags from Mirage scene, object labels/attributes, and OCR text.
pub fn derive_auto_tags(response: &MirageResponse) -> Vec<String> {
    let mut tags = BTreeSet::new();
    for obj in &response.objects {
        let label = obj.label.trim().to_ascii_lowercase();
        if !label.is_empty() {
            tags.insert(label.clone());
        }
        for attr in &obj.attributes {
            let a = attr.trim().to_ascii_lowercase();
            if !a.is_empty() {
                tags.insert(a.clone());
                if !label.is_empty() {
                    tags.insert(format!("{a} {label}"));
                }
            }
        }
    }
    let scene_lower = response.scene.to_ascii_lowercase();
    for keyword in [
        "diagram",
        "circuit",
        "equation",
        "handwritten",
        "bar chart",
        "chart",
        "graph",
        "whiteboard",
        "book",
        "slide",
        "map",
        "schematic",
        "anatomy",
        "table",
    ] {
        if scene_lower.contains(keyword) {
            tags.insert(keyword.to_string());
        }
    }
    tags.into_iter().take(24).collect()
}

/// Upsert Mirage visual metadata into `image_visual_metadata` (triggers sync `image_visual_search_fts`).
pub async fn store_visual_index_entry(
    repo: &Repository,
    asset_id: &str,
    response: &MirageResponse,
) -> Result<Vec<String>> {
    let tags = derive_auto_tags(response);
    let ocr_text = join_reading_order_text(&response.text);
    let objects_text = response
        .objects
        .iter()
        .map(|o| {
            if o.attributes.is_empty() {
                o.label.clone()
            } else {
                format!("{} {}", o.attributes.join(" "), o.label)
            }
        })
        .collect::<Vec<_>>()
        .join(" | ");

    let objects_json = serde_json::to_string(&response.objects)
        .map_err(|e| PlethoraError::Internal(format!("Serialize objects failed: {e}")))?;
    let tags_json = serde_json::to_string(&tags)
        .map_err(|e| PlethoraError::Internal(format!("Serialize tags failed: {e}")))?;
    let relations_json = serde_json::to_string(&response.relations)
        .map_err(|e| PlethoraError::Internal(format!("Serialize relations failed: {e}")))?;
    let raw_json = serde_json::to_string(response)
        .map_err(|e| PlethoraError::Internal(format!("Serialize MirageResponse failed: {e}")))?;
    let indexed_at = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        r#"
        INSERT INTO image_visual_metadata (
            asset_id, scene_description, objects_text, objects_json,
            ocr_text, tags_json, relations_json, raw_json, indexed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(asset_id) DO UPDATE SET
            scene_description = excluded.scene_description,
            objects_text = excluded.objects_text,
            objects_json = excluded.objects_json,
            ocr_text = excluded.ocr_text,
            tags_json = excluded.tags_json,
            relations_json = excluded.relations_json,
            raw_json = excluded.raw_json,
            indexed_at = excluded.indexed_at
        "#,
    )
    .bind(asset_id)
    .bind(&response.scene)
    .bind(&objects_text)
    .bind(&objects_json)
    .bind(&ocr_text)
    .bind(&tags_json)
    .bind(&relations_json)
    .bind(&raw_json)
    .bind(&indexed_at)
    .execute(repo.pool())
    .await?;

    Ok(tags)
}

/// Index a single `image_assets` row by ID using Mirage.
pub async fn index_image_asset_by_id(
    repo: &Repository,
    engine: &MirageEngine,
    asset_id: &str,
) -> Result<Vec<String>> {
    let row = sqlx::query("SELECT content, mime_type FROM image_assets WHERE id = ?1")
        .bind(asset_id)
        .fetch_optional(repo.pool())
        .await?
        .ok_or_else(|| PlethoraError::NotFound(format!("Image asset {asset_id} not found")))?;

    let bytes: Vec<u8> = row.try_get("content")?;
    let options = MirageRequestOptions {
        sections: vec![
            MirageSection::Scene,
            MirageSection::Objects,
            MirageSection::Text,
        ],
        conf: 0.35,
        text_conf: 0.30,
        mask_format: "polygons".to_string(),
    };
    let (response, _) = engine.describe_image_bytes(bytes, options).await?;
    store_visual_index_entry(repo, asset_id, &response).await
}

/// Query `image_visual_search_fts` with sanitized FTS5 terms.
pub async fn query_visual_fts(
    repo: &Repository,
    query: &str,
    limit: u32,
) -> Result<Vec<VisualSearchMatch>> {
    let tokens: Vec<String> = query
        .split_whitespace()
        .map(|w| {
            w.chars()
                .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
                .collect::<String>()
        })
        .filter(|w| !w.is_empty())
        .map(|w| format!("\"{}\"*", w))
        .collect();
    if tokens.is_empty() {
        return Ok(Vec::new());
    }
    let fts_query = tokens.join(" AND ");

    let rows = sqlx::query(
        r#"
        SELECT
            fts.asset_id,
            m.scene_description,
            m.ocr_text,
            m.tags_json,
            bm25(image_visual_search_fts, 2.0, 2.5, 1.2, 2.0) AS rank_score,
            a.file_name,
            a.mime_type
        FROM image_visual_search_fts fts
        JOIN image_visual_metadata m ON m.asset_id = fts.asset_id
        LEFT JOIN image_assets a ON a.id = fts.asset_id
        WHERE image_visual_search_fts MATCH ?1
        ORDER BY rank_score ASC
        LIMIT ?2
        "#,
    )
    .bind(&fts_query)
    .bind(limit as i64)
    .fetch_all(repo.pool())
    .await?;

    let mut matches = Vec::with_capacity(rows.len());
    for row in rows {
        let tags_json: String = row.try_get("tags_json")?;
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        let rank_score: f64 = row.try_get("rank_score").unwrap_or(0.0);
        matches.push(VisualSearchMatch {
            asset_id: row.try_get("asset_id")?,
            scene_description: row.try_get("scene_description")?,
            ocr_text: row.try_get("ocr_text")?,
            tags,
            score: (-rank_score).max(0.01),
            file_name: row.try_get("file_name")?,
            mime_type: row.try_get("mime_type")?,
        });
    }
    Ok(matches)
}

/// Spawn a non-blocking background worker that indexes up to `batch_size` unindexed
/// `image_assets` when Mirage is available.
pub fn spawn_background_visual_indexer(
    repo: Repository,
    engine: MirageEngine,
    batch_size: usize,
) {
    tokio::spawn(async move {
        if !engine.status().available {
            return;
        }
        let unindexed: Vec<String> = match sqlx::query_scalar(
            r#"
            SELECT a.id
            FROM image_assets a
            LEFT JOIN image_visual_metadata m ON m.asset_id = a.id
            WHERE m.asset_id IS NULL
              AND a.mime_type != 'image/svg+xml'
            ORDER BY a.created_at DESC
            LIMIT ?1
            "#,
        )
        .bind(batch_size as i64)
        .fetch_all(repo.pool())
        .await
        {
            Ok(ids) => ids,
            Err(e) => {
                tracing::debug!("Mirage background indexer query skipped: {}", e);
                return;
            }
        };

        for asset_id in unindexed {
            if let Err(e) = index_image_asset_by_id(&repo, &engine, &asset_id).await {
                tracing::debug!("Mirage background index failed for {}: {}", asset_id, e);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vision::types::{MirageObject, MirageTextBlock};

    #[tokio::test]
    async fn indexes_and_queries_visual_fts5() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::database::migrations::run_migrations(&pool)
            .await
            .unwrap();
        let repo = Repository::new(pool);

        sqlx::query(
            "INSERT INTO image_assets (id, mime_type, file_name, content, byte_size, sha256, width, height, created_at, updated_at)
             VALUES ('asset-mirage-1', 'image/png', 'rc_filter.png', X'89504E47', 4, 'sha-m1', 640, 480, '2026-11-16T00:00:00Z', '2026-11-16T00:00:00Z')"
        )
        .execute(repo.pool())
        .await
        .unwrap();

        let resp = MirageResponse {
            scene: "A red circuit diagram on a whiteboard".into(),
            objects: vec![MirageObject {
                id: "o1".into(),
                label: "circuit diagram".into(),
                confidence: 0.92,
                bbox: [100.0, 100.0, 800.0, 700.0],
                attributes: vec!["red".into()],
                polygon: vec![],
            }],
            text: vec![MirageTextBlock {
                id: "t1".into(),
                text: "fc = 1 / (2 pi R C)".into(),
                confidence: 0.95,
                bbox: [150.0, 750.0, 600.0, 820.0],
                polygon: vec![],
            }],
            relations: vec![],
            inference_ms: 78,
            image_width: 640,
            image_height: 480,
        };

        let tags = store_visual_index_entry(&repo, "asset-mirage-1", &resp)
            .await
            .unwrap();
        assert!(tags.iter().any(|t| t == "red circuit diagram"));

        let hits = query_visual_fts(&repo, "red circuit diagram", 10)
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].asset_id, "asset-mirage-1");
    }
}
