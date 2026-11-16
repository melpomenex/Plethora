//! Tauri commands for Cactus Compute's Mirage Vision Engine.

use crate::commands::extract::create_extract_inner;
use crate::commands::image_registry::ingest_image_bytes;
use crate::database::Repository;
use crate::error::{PlethoraError, Result};
use crate::models::{Extract, ItemType, LearningItem};
use crate::vision::mirage::{crop_rgb_bbox_to_png, MirageEngine};
use crate::vision::search_worker::{
    index_image_asset_by_id, query_visual_fts, store_visual_index_entry, VisualSearchMatch,
};
use crate::vision::spatial_pairing::{
    join_reading_order_text, pair_text_and_figures, PairedExtractChunk,
};
use crate::vision::types::{
    to_percent_occlusion_region, MirageRequestOptions, MirageResponse, MirageStatus,
    PercentOcclusionRegion,
};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirageAnalyzeResult {
    pub response: MirageResponse,
    pub regions: Vec<PercentOcclusionRegion>,
    pub reading_order_text: String,
    pub paired_chunks: Vec<PairedExtractChunk>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirageSnapExtractResult {
    pub extract: Extract,
    pub source_asset_id: String,
    pub cropped_figure_asset_ids: Vec<String>,
    pub scene: String,
    pub reading_order_text: String,
    pub paired_chunks: Vec<PairedExtractChunk>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirageRegionInput {
    pub id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub label: Option<String>,
    pub color: Option<String>,
    pub points: Option<Vec<crate::vision::types::Point2D>>,
}

async fn resolve_image_bytes(
    base64_data: Option<String>,
    file_path: Option<String>,
    asset_id: Option<String>,
    repo: &Repository,
) -> Result<Vec<u8>> {
    if let Some(b64) = base64_data {
        let trimmed = b64
            .split_once(',')
            .map(|(_, rest)| rest)
            .unwrap_or(b64.as_str());
        return general_purpose::STANDARD
            .decode(trimmed.as_bytes())
            .map_err(|e| PlethoraError::InvalidInput(format!("Invalid base64 image: {e}")));
    }
    if let Some(path) = file_path {
        return tokio::fs::read(&path)
            .await
            .map_err(|e| PlethoraError::NotFound(format!("Failed to read image {path}: {e}")));
    }
    if let Some(id) = asset_id {
        let row = sqlx::query("SELECT content FROM image_assets WHERE id = ?1")
            .bind(&id)
            .fetch_optional(repo.pool())
            .await?
            .ok_or_else(|| PlethoraError::NotFound(format!("Image asset {id} not found")))?;
        let bytes: Vec<u8> = row.try_get("content")?;
        return Ok(bytes);
    }
    Err(PlethoraError::InvalidInput(
        "Provide base64Data, filePath, or assetId".to_string(),
    ))
}

#[tauri::command]
pub async fn mirage_status(engine: State<'_, MirageEngine>) -> Result<MirageStatus> {
    Ok(engine.status())
}

#[tauri::command]
pub async fn mirage_ensure_model(
    download_url: Option<String>,
    engine: State<'_, MirageEngine>,
) -> Result<String> {
    let path = engine.ensure_model_cached(download_url).await?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub async fn mirage_analyze_image(
    base64_data: Option<String>,
    file_path: Option<String>,
    asset_id: Option<String>,
    options: Option<MirageRequestOptions>,
    repo: State<'_, Repository>,
    engine: State<'_, MirageEngine>,
) -> Result<MirageAnalyzeResult> {
    let bytes = resolve_image_bytes(base64_data, file_path, asset_id.clone(), repo.inner()).await?;
    let opts = options.unwrap_or_default();
    let (response, _) = engine.describe_image_bytes(bytes, opts).await?;

    if let Some(id) = asset_id {
        let _ = store_visual_index_entry(repo.inner(), &id, &response).await;
    }

    let mut regions = Vec::new();
    for obj in &response.objects {
        regions.push(to_percent_occlusion_region(
            &obj.id,
            obj.bbox,
            &obj.polygon,
            Some(obj.label.clone()),
            Some("#6366f1".to_string()),
        ));
    }
    for tb in &response.text {
        regions.push(to_percent_occlusion_region(
            &tb.id,
            tb.bbox,
            &tb.polygon,
            Some(tb.text.clone()),
            Some("#0ea5e9".to_string()),
        ));
    }

    let reading_order_text = join_reading_order_text(&response.text);
    let paired_chunks = pair_text_and_figures(&response);

    Ok(MirageAnalyzeResult {
        response,
        regions,
        reading_order_text,
        paired_chunks,
    })
}

/// Core Snap-to-Extract pipeline shared by the Tauri command and the browser clipper.
#[allow(clippy::too_many_arguments)]
pub async fn snap_image_bytes_to_extract_inner(
    bytes: Vec<u8>,
    mime_type: Option<String>,
    file_name: Option<String>,
    document_id: String,
    source_url: Option<String>,
    note: Option<String>,
    tags: Option<Vec<String>>,
    page_number: Option<i32>,
    repo: &Repository,
    engine: &MirageEngine,
) -> Result<MirageSnapExtractResult> {
    let (source_asset, _) =
        ingest_image_bytes(bytes.clone(), mime_type, file_name, repo).await?;

    let (response, rgb_buf) = engine
        .describe_image_bytes(bytes, MirageRequestOptions::default())
        .await?;

    let auto_tags = store_visual_index_entry(repo, &source_asset.id, &response)
        .await
        .unwrap_or_default();

    let reading_order_text = join_reading_order_text(&response.text);
    let mut paired_chunks = pair_text_and_figures(&response);
    let mut cropped_figure_asset_ids = Vec::new();

    // Crop unique paired figures into `image_assets` so review cards can render them offline.
    let mut cropped_by_obj: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for chunk in &mut paired_chunks {
        for fig in &mut chunk.paired_figures {
            if let Some(existing_id) = cropped_by_obj.get(&fig.object_id) {
                fig.cropped_asset_id = Some(existing_id.clone());
                continue;
            }
            if let Ok(png_bytes) = crop_rgb_bbox_to_png(&rgb_buf, fig.bbox) {
                let crop_name = format!("mirage-figure-{}.png", fig.object_id);
                if let Ok((crop_asset, _)) =
                    ingest_image_bytes(png_bytes, Some("image/png".to_string()), Some(crop_name), repo)
                        .await
                {
                    cropped_by_obj.insert(fig.object_id.clone(), crop_asset.id.clone());
                    cropped_figure_asset_ids.push(crop_asset.id.clone());
                    fig.cropped_asset_id = Some(crop_asset.id);
                }
            }
        }
    }

    let content = if !reading_order_text.trim().is_empty() {
        reading_order_text.clone()
    } else if !response.scene.trim().is_empty() {
        response.scene.clone()
    } else {
        "Visual extract".to_string()
    };

    let mut merged_tags = tags.unwrap_or_default();
    for t in auto_tags {
        if !merged_tags.iter().any(|existing| existing.eq_ignore_ascii_case(&t)) {
            merged_tags.push(t);
        }
    }

    let selection_context = json!({
        "type": "mirage-visual-extract",
        "sourceAssetId": source_asset.id,
        "mirageScene": response.scene,
        "pairedChunks": paired_chunks,
        "croppedFigureAssetIds": cropped_figure_asset_ids,
        "inferenceMs": response.inference_ms,
    });

    let extract = create_extract_inner(
        document_id,
        content,
        None,
        source_url,
        note,
        Some(merged_tags),
        Some("mirage-snap".to_string()),
        None,
        page_number,
        Some(selection_context),
        None,
        None,
        repo,
    )
    .await?;

    Ok(MirageSnapExtractResult {
        extract,
        source_asset_id: source_asset.id,
        cropped_figure_asset_ids,
        scene: response.scene,
        reading_order_text,
        paired_chunks,
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mirage_snap_to_extract(
    base64_data: Option<String>,
    file_path: Option<String>,
    document_id: String,
    source_url: Option<String>,
    note: Option<String>,
    tags: Option<Vec<String>>,
    page_number: Option<i32>,
    repo: State<'_, Repository>,
    engine: State<'_, MirageEngine>,
) -> Result<MirageSnapExtractResult> {
    let bytes = resolve_image_bytes(base64_data, file_path.clone(), None, repo.inner()).await?;
    let file_name = file_path.as_deref().and_then(|p| {
        std::path::Path::new(p)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
    });
    snap_image_bytes_to_extract_inner(
        bytes,
        None,
        file_name,
        document_id,
        source_url,
        note,
        tags,
        page_number,
        repo.inner(),
        engine.inner(),
    )
    .await
}

#[tauri::command]
pub async fn mirage_generate_occlusion_cards(
    asset_id: Option<String>,
    base64_data: Option<String>,
    document_id: Option<String>,
    prompt: Option<String>,
    include_text: Option<bool>,
    include_objects: Option<bool>,
    repo: State<'_, Repository>,
    engine: State<'_, MirageEngine>,
) -> Result<Vec<LearningItem>> {
    let resolved_asset_id = if let Some(id) = asset_id {
        id
    } else if let Some(b64) = base64_data {
        let bytes = resolve_image_bytes(Some(b64), None, None, repo.inner()).await?;
        let (asset, _) = ingest_image_bytes(bytes, None, None, repo.inner()).await?;
        asset.id
    } else {
        return Err(PlethoraError::InvalidInput(
            "Provide assetId or base64Data".to_string(),
        ));
    };

    let bytes = resolve_image_bytes(None, None, Some(resolved_asset_id.clone()), repo.inner()).await?;
    let (response, _) = engine
        .describe_image_bytes(bytes, MirageRequestOptions::default())
        .await?;
    let _ = store_visual_index_entry(repo.inner(), &resolved_asset_id, &response).await;

    let mut regions: Vec<PercentOcclusionRegion> = Vec::new();
    if include_objects.unwrap_or(true) {
        for obj in &response.objects {
            regions.push(to_percent_occlusion_region(
                &obj.id,
                obj.bbox,
                &obj.polygon,
                Some(obj.label.clone()),
                Some("#6366f1".to_string()),
            ));
        }
    }
    if include_text.unwrap_or(true) {
        for tb in &response.text {
            regions.push(to_percent_occlusion_region(
                &tb.id,
                tb.bbox,
                &tb.polygon,
                Some(tb.text.clone()),
                Some("#0ea5e9".to_string()),
            ));
        }
    }

    if regions.is_empty() {
        return Ok(Vec::new());
    }

    let occlusion_set_id = uuid::Uuid::new_v4().to_string();
    let question_prompt = prompt.unwrap_or_else(|| {
        if response.scene.trim().is_empty() {
            "Identify the occluded region".to_string()
        } else {
            format!("Identify the occluded region ({})", response.scene)
        }
    });

    let mut created = Vec::with_capacity(regions.len());
    for region in &regions {
        let mut item = LearningItem::new(ItemType::Qa, question_prompt.clone());
        item.document_id = document_id.clone();
        item.answer = region.label.clone();
        item.image_asset_ids = vec![resolved_asset_id.clone()];
        item.tags = vec!["image-occlusion".to_string(), "mirage".to_string()];
        item.interaction_metadata = Some(json!({
            "interactionType": "image-occlusion",
            "imageOcclusionAssetId": resolved_asset_id,
            "imageOcclusionRegions": regions,
            "imageOcclusionPrompt": question_prompt,
            "occlusionSetId": occlusion_set_id,
            "targetRegionId": region.id,
            "occlusionMode": "hide-one",
        }));
        let saved = repo.create_learning_item(&item).await?;
        created.push(saved);
    }

    Ok(created)
}

#[tauri::command]
pub async fn mirage_create_region_occlusion_card(
    asset_id: String,
    region: MirageRegionInput,
    all_regions: Option<Vec<MirageRegionInput>>,
    document_id: Option<String>,
    prompt: Option<String>,
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    let target_id = region
        .id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let target_json = json!({
        "id": target_id,
        "x": region.x,
        "y": region.y,
        "width": region.width,
        "height": region.height,
        "label": region.label,
        "color": region.color.unwrap_or_else(|| "#6366f1".to_string()),
        "points": region.points,
    });

    let regions_json: Vec<serde_json::Value> = if let Some(list) = all_regions {
        list.into_iter()
            .map(|r| {
                json!({
                    "id": r.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                    "x": r.x,
                    "y": r.y,
                    "width": r.width,
                    "height": r.height,
                    "label": r.label,
                    "color": r.color.unwrap_or_else(|| "#6366f1".to_string()),
                    "points": r.points,
                })
            })
            .collect()
    } else {
        vec![target_json]
    };

    let question = prompt.unwrap_or_else(|| "Identify the occluded region".to_string());
    let mut item = LearningItem::new(ItemType::Qa, question.clone());
    item.document_id = document_id;
    item.answer = region.label;
    item.image_asset_ids = vec![asset_id.clone()];
    item.tags = vec!["image-occlusion".to_string(), "mirage-tap-to-mask".to_string()];
    item.interaction_metadata = Some(json!({
        "interactionType": "image-occlusion",
        "imageOcclusionAssetId": asset_id,
        "imageOcclusionRegions": regions_json,
        "imageOcclusionPrompt": question,
        "targetRegionId": target_id,
        "occlusionMode": "hide-one",
    }));
    repo.create_learning_item(&item).await
}

#[tauri::command]
pub async fn mirage_search_visual(
    query: String,
    limit: Option<u32>,
    repo: State<'_, Repository>,
) -> Result<Vec<VisualSearchMatch>> {
    query_visual_fts(repo.inner(), &query, limit.unwrap_or(20)).await
}

#[tauri::command]
pub async fn mirage_index_asset(
    asset_id: String,
    repo: State<'_, Repository>,
    engine: State<'_, MirageEngine>,
) -> Result<Vec<String>> {
    index_image_asset_by_id(repo.inner(), engine.inner(), &asset_id).await
}
