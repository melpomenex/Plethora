//! Compact page evidence for the index, independent of renderer cache eviction.

use crate::ai_learning::models::PDF_PROJECTION_VERSION;
use crate::commands::pdf_mobile::registered_pdf_revision;
use crate::database::Repository;
use crate::error::Result;
use crate::models::FileType;
use serde::{Deserialize, Serialize};
use std::path::Path;

use super::model::{
    PdfCanonicalPage, PdfCanonicalPageState, PdfCanonicalRole, PdfSourceRegion, PdfWordSource,
};

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct EvidenceBlock {
    pub id: String,
    pub text: String,
    pub extraction: PdfWordSource,
    pub confidence: f32,
    pub regions: Vec<PdfSourceRegion>,
}

fn compact_blocks(page: &PdfCanonicalPage) -> Vec<EvidenceBlock> {
    let mut blocks = page.blocks.iter().filter(|block| {
        block.role == PdfCanonicalRole::Body
            && block.extraction != PdfWordSource::Graphical
            && block.page_number == page.page_number
            && !block.text.trim().is_empty()
    }).collect::<Vec<_>>();
    blocks.sort_by_key(|block| block.reading_order);
    blocks.into_iter().map(|block| EvidenceBlock {
        id: block.id.clone(),
        text: block.text.clone(),
        extraction: block.extraction,
        confidence: block.confidence,
        regions: block.source_regions.iter()
            .filter(|region| region.page_number == page.page_number)
            .cloned()
            .collect(),
    }).collect()
}

pub(crate) async fn store_page(
    repo: &Repository,
    document_id: &str,
    revision: &str,
    page: &PdfCanonicalPage,
) -> Result<()> {
    if page.state != PdfCanonicalPageState::Ready {
        return Ok(());
    }
    let Some(document) = repo.get_document(document_id).await? else { return Ok(()); };
    if document.file_type != FileType::Pdf
        || document.is_ai_excluded
        || registered_pdf_revision(Path::new(&document.file_path)).as_deref() != Some(revision) {
        return Ok(());
    }
    let blocks = compact_blocks(page);
    if blocks.is_empty() {
        return Ok(());
    }
    let serialized = serde_json::to_string(&blocks)?;
    // Leave oversized display pages available in reflow without storing their
    // full projection in the semantic index.
    if serialized.len() > 512 * 1024 {
        return Ok(());
    }
    let mut tx = repo.pool().begin().await?;
    sqlx::query("DELETE FROM pdf_page_evidence WHERE document_id = ? AND source_revision <> ?")
        .bind(document_id)
        .bind(revision)
        .execute(&mut *tx)
        .await?;
    let changed = sqlx::query(
        "INSERT INTO pdf_page_evidence (document_id, source_revision, projection_version, page_number, blocks_json)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT DO UPDATE SET blocks_json = excluded.blocks_json WHERE blocks_json <> excluded.blocks_json",
    )
    .bind(document_id)
    .bind(revision)
    .bind(PDF_PROJECTION_VERSION)
    .bind(page.page_number)
    .bind(serialized)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if changed > 0 {
        sqlx::query("UPDATE ai_index_state SET state = 'stale' WHERE document_id = ? AND state IN ('indexed', 'lexical_only')")
            .bind(document_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn load_pages(
    repo: &Repository,
    document_id: &str,
    revision: &str,
) -> Result<Vec<(u32, Vec<EvidenceBlock>)>> {
    let rows: Vec<(u32, String)> = sqlx::query_as(
        "SELECT page_number, blocks_json FROM pdf_page_evidence
         WHERE document_id = ? AND source_revision = ? AND projection_version = ?
         ORDER BY page_number",
    )
    .bind(document_id)
    .bind(revision)
    .bind(PDF_PROJECTION_VERSION)
    .fetch_all(repo.pool())
    .await?;
    Ok(rows.into_iter().filter_map(|(page, json)| {
        serde_json::from_str(&json).ok().map(|blocks| (page, blocks))
    }).collect())
}
