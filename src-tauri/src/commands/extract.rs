//! Extract commands

use crate::database::Repository;
use crate::error::Result;
use crate::models::Extract;
use sqlx::Row;
use tauri::State;

#[tauri::command]
pub async fn get_extracts(
    document_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<Extract>> {
    let extracts = if let Some(id) = document_id {
        repo.list_extracts_by_document(&id).await?
    } else {
        repo.list_all_extracts().await?
    };
    Ok(extracts)
}

#[tauri::command]
pub async fn get_extract(id: String, repo: State<'_, Repository>) -> Result<Option<Extract>> {
    let extract = repo.get_extract(&id).await?;
    Ok(extract)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_extract(
    document_id: String,
    content: String,
    html_content: Option<String>,
    source_url: Option<String>,
    note: Option<String>,
    tags: Option<Vec<String>>,
    category: Option<String>,
    color: Option<String>,
    page_number: Option<i32>,
    selection_context: Option<serde_json::Value>,
    max_disclosure_level: Option<i32>,
    priority_score: Option<f64>,
    repo: State<'_, Repository>,
) -> Result<Extract> {
    create_extract_inner(
        document_id,
        content,
        html_content,
        source_url,
        note,
        tags,
        category,
        color,
        page_number,
        selection_context,
        max_disclosure_level,
        priority_score,
        &repo,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_extract_inner(
    document_id: String,
    content: String,
    html_content: Option<String>,
    source_url: Option<String>,
    note: Option<String>,
    tags: Option<Vec<String>>,
    category: Option<String>,
    color: Option<String>,
    page_number: Option<i32>,
    selection_context: Option<serde_json::Value>,
    max_disclosure_level: Option<i32>,
    priority_score: Option<f64>,
    repo: &Repository,
) -> Result<Extract> {
    let mut extract = Extract::new(document_id.clone(), content);
    extract.html_content = html_content;
    extract.source_url = source_url;
    extract.notes = note;
    extract.tags = tags.unwrap_or_default();
    extract.category = category;
    extract.highlight_color = color;
    extract.page_number = page_number;
    extract.selection_context = selection_context;
    if let Some(level) = max_disclosure_level {
        extract.max_disclosure_level = level;
    }
    // Inherit the parent document's priority score (incremental reading
    // priority chain). If manually overridden via priority_score, use that;
    // otherwise copy from the parent document if it exists.
    // Falls back to 0.0 when the document is unknown or has no priority set.
    if let Some(override_priority) = priority_score {
        extract.priority_score = override_priority;
    } else if let Ok(Some(doc)) = repo.get_document(&document_id).await {
        extract.priority_score = doc.priority_score;
    }
    let created = repo.create_extract(&extract).await?;
    append_daily_note_extract_link(&created, repo).await?;
    Ok(created)
}

/// Manually override an extract's priority. Once set, the extract will no
/// longer inherit from document priority updates (its stored key will differ
/// from the previous document key, so the cascade skips it).
///
/// `priority_score` is the caller's 0-100 slider *position*, not a value to
/// store: like documents and cards, it resolves to an order key that lands the
/// extract at that rank in the global priority queue (see
/// `database::priority_rank`).
#[tauri::command]
pub async fn set_extract_priority(
    id: String,
    priority_score: f64,
    repo: State<'_, Repository>,
) -> Result<()> {
    let slider = priority_score.clamp(0.0, 100.0).round() as i32;
    let key = crate::database::priority_rank::key_for_slider(repo.db_pool(), slider).await?;
    repo.update_extract_priority(&id, key, slider).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_extract(
    id: String,
    content: Option<String>,
    html_content: Option<String>,
    source_url: Option<String>,
    note: Option<String>,
    tags: Option<Vec<String>>,
    category: Option<String>,
    color: Option<String>,
    max_disclosure_level: Option<i32>,
    selection_context: Option<serde_json::Value>,
    priority_score: Option<f64>,
    repo: State<'_, Repository>,
) -> Result<Extract> {
    let mut extract = repo
        .get_extract(&id)
        .await?
        .ok_or_else(|| crate::error::PlethoraError::NotFound(format!("Extract {}", id)))?;

    if let Some(content) = content {
        extract.content = content;
    }
    if let Some(html_content) = html_content {
        extract.html_content = Some(html_content);
    }
    if let Some(source_url) = source_url {
        extract.source_url = Some(source_url);
    }
    if let Some(note) = note {
        extract.notes = Some(note);
    }
    if let Some(tags) = tags {
        extract.tags = tags;
    }
    if let Some(category) = category {
        extract.category = Some(category);
    }
    if let Some(color) = color {
        extract.highlight_color = Some(color);
    }
    if let Some(level) = max_disclosure_level {
        extract.max_disclosure_level = level;
    }
    if let Some(selection_context) = selection_context {
        extract.selection_context = Some(selection_context);
    }
    if let Some(priority) = priority_score {
        extract.priority_score = priority;
    }
    extract.date_modified = chrono::Utc::now();

    repo.update_extract(&extract).await?;
    Ok(extract)
}

#[tauri::command]
pub async fn delete_extract(id: String, repo: State<'_, Repository>) -> Result<()> {
    repo.delete_extract(&id).await?;
    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfAnnotationPatch {
    pub id: String,
    pub document_id: String,
    pub expected_modified_at: chrono::DateTime<chrono::Utc>,
    pub kind: Option<String>,
    pub note: Option<String>,
    pub color: Option<String>,
    pub removed: Option<bool>,
}

impl PdfAnnotationPatch {
    pub(crate) fn update_context(&self, raw: Option<&str>) -> Result<String> {
        use crate::error::PlethoraError;
        use serde_json::{json, Value};
        let invalid =
            || PlethoraError::Validation("This extract has no owned PDF annotation.".into());
        let mut context: Value = serde_json::from_str(raw.ok_or_else(invalid)?)?;
        if context["type"].as_str() != Some("pdf")
            || context["documentId"]
                .as_str()
                .is_some_and(|owner| owner != self.document_id)
            || !context["pages"].is_array()
        {
            return Err(invalid());
        }
        if self
            .color
            .as_deref()
            .is_some_and(|color| !matches!(color, "yellow" | "green" | "blue" | "pink" | "purple"))
        {
            return Err(PlethoraError::Validation(
                "Unknown PDF annotation color.".into(),
            ));
        }
        if context.get("pdfMarkup").is_none() {
            context["pdfMarkup"] = json!({ "version": 1, "kind": "highlight" });
        }
        let markup = &mut context["pdfMarkup"];
        if markup["version"].as_u64() != Some(1) {
            return Err(PlethoraError::Validation(
                "This PDF annotation version cannot be edited.".into(),
            ));
        }
        if let Some(kind) = &self.kind {
            let is_text =
                |kind: &str| matches!(kind, "highlight" | "underline" | "strikethrough" | "note");
            if !is_text(kind) || !markup["kind"].as_str().is_some_and(is_text) {
                return Err(PlethoraError::Validation(
                    "This annotation type cannot be changed.".into(),
                ));
            }
            markup["kind"] = json!(kind);
        }
        if let Some(removed) = self.removed {
            markup["removed"] = json!(removed);
        }
        Ok(serde_json::to_string(&context)?)
    }
}

#[tauri::command]
pub async fn update_pdf_annotation(
    patch: PdfAnnotationPatch,
    repo: State<'_, Repository>,
) -> Result<Extract> {
    repo.update_pdf_annotation(patch).await
}

async fn append_daily_note_extract_link(extract: &Extract, repo: &Repository) -> Result<()> {
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
        "type": "extract",
        "id": extract.id,
        "title": extract.content.chars().take(120).collect::<String>(),
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

#[tauri::command]
pub async fn get_learning_object_sources(
    target_kind: String,
    target_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<crate::database::LearningObjectSource>> {
    repo.get_learning_object_sources_for_target(&target_kind, &target_id)
        .await
}

#[tauri::command]
pub async fn get_session_learning_object_sources(
    session_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<crate::database::LearningObjectSource>> {
    repo.get_learning_object_sources_for_session(&session_id)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::issue6_test_support::issue6_repository;

    #[tokio::test]
    async fn pdf_annotation_remove_and_restore_preserve_identity_and_anchor() {
        let repo = issue6_repository().await;
        let mut extract = Extract::new("issue6-document".into(), "source passage".into());
        extract.page_number = Some(3);
        let pages = serde_json::json!([{"pageNumber": 3, "pdfRects": [{"x1": 4, "y1": 5, "x2": 12, "y2": 18}]}]);
        extract.selection_context = Some(serde_json::json!({
            "type": "pdf",
            "documentId": "issue6-document",
            "fingerprint": "original-file",
            "pages": pages.clone(),
        }));
        let created = repo.create_extract(&extract).await.unwrap();
        let patch = |modified, removed| PdfAnnotationPatch {
            id: created.id.clone(),
            document_id: created.document_id.clone(),
            expected_modified_at: modified,
            kind: Some("underline".into()),
            note: Some("review this".into()),
            color: Some("green".into()),
            removed: Some(removed),
        };
        let removed = repo
            .update_pdf_annotation(patch(created.date_modified, true))
            .await
            .unwrap();
        assert_eq!(
            removed.selection_context.as_ref().unwrap()["pdfMarkup"]["removed"],
            true
        );
        assert!(repo
            .update_pdf_annotation(patch(created.date_modified, false))
            .await
            .is_err());
        let restored = repo
            .update_pdf_annotation(patch(removed.date_modified, false))
            .await
            .unwrap();
        let context = restored.selection_context.unwrap();
        assert_eq!(restored.id, created.id);
        assert_eq!(restored.content, created.content);
        assert_eq!(restored.page_number, Some(3));
        assert_eq!(restored.notes.as_deref(), Some("review this"));
        assert_eq!(restored.highlight_color.as_deref(), Some("green"));
        assert_eq!(context["pages"], pages);
        assert_eq!(context["fingerprint"], "original-file");
        assert_eq!(context["pdfMarkup"]["removed"], false);
    }

    #[tokio::test]
    async fn test_create_extract_inherits_document_priority() {
        let repo = issue6_repository().await;
        // In issue6_repository(), "issue6-document" has priority_score = 75.0
        let doc = repo.get_document("issue6-document").await.unwrap().unwrap();
        assert_eq!(doc.priority_score, 75.0);

        let created = create_extract_inner(
            "issue6-document".to_string(),
            "Inherited priority extract".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            &repo,
        )
        .await
        .unwrap();

        assert_eq!(created.priority_score, 75.0);
    }

    #[tokio::test]
    async fn test_create_extract_manual_override() {
        let repo = issue6_repository().await;
        let created = create_extract_inner(
            "issue6-document".to_string(),
            "Overridden priority extract".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(35.5),
            &repo,
        )
        .await
        .unwrap();

        assert_eq!(created.priority_score, 35.5);
    }

    #[tokio::test]
    async fn test_create_extract_zero_priority_document_defaults_to_zero() {
        let repo = issue6_repository().await;
        let mut zero_doc = crate::models::Document::new(
            "Zero Doc".into(),
            "fixture://zero-doc".into(),
            crate::models::FileType::Markdown,
        );
        zero_doc.id = "zero-doc".into();
        zero_doc.priority_score = 0.0;
        repo.create_document(&zero_doc).await.unwrap();

        let created = create_extract_inner(
            "zero-doc".to_string(),
            "Default priority extract".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            &repo,
        )
        .await
        .unwrap();

        assert_eq!(created.priority_score, 0.0);
    }
}
