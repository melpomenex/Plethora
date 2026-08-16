//! Canonical selection resolution (design D8): screen-derived PDF rects in,
//! word-ID-anchored selection out. Word-level snapping means any word whose
//! box intersects the selection is fully included. The same resolution
//! drives highlight painting, extracts, copy, TTS, and source navigation in
//! both views.

use serde::Serialize;

use crate::pdf::analysis::blocks::join_block_text;
use crate::pdf::coordinates::PdfRect;
use crate::pdf::model::{PdfCanonicalPage, PdfCanonicalWord, PdfSourceRegion};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalSelection {
    pub start_word_id: String,
    pub end_word_id: String,
    pub word_ids: Vec<String>,
    pub text: String,
    /// Per-line unions of the covered words' boxes, in reading order — the
    /// rectangles highlights paint with in the Original view.
    pub page_regions: Vec<PdfSourceRegion>,
}

/// Resolve a selection given as PDF-space rects on one analyzed page.
/// Returns `None` when the page has no words or the rects hit nothing
/// (callers fall back to legacy text-layer behavior).
pub fn resolve_selection(page: &PdfCanonicalPage, rects: &[PdfRect]) -> Option<CanonicalSelection> {
    if rects.is_empty() || page.words.is_empty() {
        return None;
    }
    // Any intersecting word is fully selected — word-level snapping.
    let mut hits: Vec<&PdfCanonicalWord> = page
        .words
        .iter()
        .filter(|word| {
            rects
                .iter()
                .any(|rect| word.source_bbox.overlap_area(rect) > 0.0)
        })
        .collect();
    if hits.is_empty() {
        return None;
    }
    hits.sort_by_key(|word| word.reading_order);

    let start = hits.first()?.id.clone();
    let end = hits.last()?.id.clone();
    let word_ids: Vec<String> = hits.iter().map(|word| word.id.clone()).collect();
    let texts: Vec<String> = hits.iter().map(|word| word.text.clone()).collect();
    let text = join_block_text(&texts);

    // Per-line regions: union the hit words' boxes per line, ordered by
    // line reading order.
    let hit_set: std::collections::HashSet<&str> =
        hits.iter().map(|word| word.id.as_str()).collect();
    let word_by_id: std::collections::HashMap<&str, &PdfCanonicalWord> = page
        .words
        .iter()
        .map(|word| (word.id.as_str(), word))
        .collect();
    let mut line_groups: Vec<(u32, String, PdfRect)> = Vec::new();
    for line in &page.lines {
        let mut union_rect: Option<PdfRect> = None;
        for word_id in &line.word_ids {
            if hit_set.contains(word_id.as_str()) {
                let word = word_by_id.get(word_id.as_str())?;
                union_rect = Some(match union_rect {
                    Some(rect) => rect.union(&word.source_bbox),
                    None => word.source_bbox,
                });
            }
        }
        if let Some(rect) = union_rect {
            line_groups.push((line.reading_order, line.id.clone(), rect));
        }
    }
    line_groups.sort_by_key(|(order, _, _)| *order);
    let page_regions = line_groups
        .into_iter()
        .map(|(_, _, bbox)| PdfSourceRegion {
            page_number: page.page_number,
            bbox,
        })
        .collect();

    Some(CanonicalSelection {
        start_word_id: start,
        end_word_id: end,
        word_ids,
        text,
        page_regions,
    })
}

/// Reconstruct per-line highlight rects for a stored word-ID range — the
/// painting input for highlights/extracts created in either view.
pub fn selection_rects(
    page: &PdfCanonicalPage,
    start_word_id: &str,
    end_word_id: &str,
) -> Option<Vec<PdfSourceRegion>> {
    let start = page.words.iter().position(|w| w.id == start_word_id)?;
    let end = page.words.iter().position(|w| w.id == end_word_id)?;
    let start_order = page.words[start]
        .reading_order
        .min(page.words[end].reading_order);
    let end_order = page.words[start]
        .reading_order
        .max(page.words[end].reading_order);
    let rects: Vec<PdfRect> = page
        .words
        .iter()
        .filter(|w| w.reading_order >= start_order && w.reading_order <= end_order)
        .map(|w| w.source_bbox)
        .collect();
    resolve_selection(page, &rects).map(|selection| selection.page_regions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::model::{
        PdfCanonicalBlock, PdfCanonicalBlockKind, PdfCanonicalLine, PdfCanonicalRole,
        PdfCanonicalWord, PdfWordSource,
    };

    fn sentence_page() -> PdfCanonicalPage {
        // "The quick brown fox jumps over the lazy dog." on one line.
        let words_raw = [
            ("The", 100.0, 120.0),
            ("quick", 122.0, 152.0),
            ("brown", 154.0, 186.0),
            ("fox", 188.0, 210.0),
            ("jumps", 212.0, 246.0),
            ("over", 248.0, 274.0),
            ("the", 276.0, 292.0),
            ("lazy", 294.0, 318.0),
            ("dog.", 320.0, 344.0),
        ];
        let words: Vec<PdfCanonicalWord> = words_raw
            .iter()
            .enumerate()
            .map(|(index, &(text, x0, x1))| PdfCanonicalWord {
                id: format!("p1:w{index}"),
                page_number: 1,
                text: text.into(),
                source_bbox: crate::pdf::coordinates::PdfRect::new(x0, 700.0, x1, 710.0),
                source_fragments: vec![],
                bbox_exact: true,
                reading_order: index as u32,
                confidence: 1.0,
                source: PdfWordSource::NativePdfText,
                dehyphenated: false,
                font: None,
            })
            .collect();
        let line = PdfCanonicalLine {
            id: "p1:l0".into(),
            word_ids: words.iter().map(|w| w.id.clone()).collect(),
            bbox: crate::pdf::coordinates::PdfRect::new(100.0, 700.0, 344.0, 710.0),
            baseline_y: 700.0,
            reading_order: 0,
        };
        let block = PdfCanonicalBlock {
            id: "p1:b0".into(),
            kind: PdfCanonicalBlockKind::Paragraph,
            role: PdfCanonicalRole::Body,
            page_number: 1,
            source_regions: vec![PdfSourceRegion {
                page_number: 1,
                bbox: crate::pdf::coordinates::PdfRect::new(100.0, 700.0, 344.0, 710.0),
            }],
            word_ids: words.iter().map(|w| w.id.clone()).collect(),
            line_ids: vec!["p1:l0".into()],
            reading_order: 0,
            confidence: 0.95,
            text: "The quick brown fox jumps over the lazy dog.".into(),
            direction: crate::pdf::model::PdfCanonicalDirection::Ltr,
            language: None,
            items: None,
            table: None,
            asset_id: None,
            source_width: None,
            source_height: None,
            alt_text: None,
            caption_of: None,
            href: None,
            extraction: PdfWordSource::NativePdfText,
        };
        PdfCanonicalPage {
            page_number: 1,
            width: 612.0,
            height: 792.0,
            rotation: 0,
            state: crate::pdf::model::PdfCanonicalPageState::Ready,
            classification: crate::pdf::model::PdfCanonicalClassification::Semantic,
            confidence: 0.95,
            text_coverage: 1.0,
            words,
            lines: vec![line],
            blocks: vec![block],
            warnings: vec![],
            error_category: None,
            schema_version: crate::pdf::model::PDF_CANONICAL_SCHEMA_VERSION,
            engine_version: crate::pdf::model::PDF_CANONICAL_ENGINE_VERSION.into(),
        }
    }

    /// The acceptance-criteria exactness case: a drag across "brown fox
    /// jumps" produces exactly that text with word-snapped boundaries.
    #[test]
    fn brown_fox_jumps_selection_is_exact() {
        let page = sentence_page();
        // Drag covering the middle of "brown" through the middle of "jumps".
        let rect = crate::pdf::coordinates::PdfRect::new(160.0, 700.0, 230.0, 710.0);
        let selection = resolve_selection(&page, &[rect]).unwrap();
        assert_eq!(selection.text, "brown fox jumps");
        assert_eq!(selection.start_word_id, "p1:w2");
        assert_eq!(selection.end_word_id, "p1:w4");
        assert_eq!(
            selection.word_ids,
            vec![
                "p1:w2".to_string(),
                "p1:w3".to_string(),
                "p1:w4".to_string()
            ]
        );
        // Snapped region covers the full words (154..246), not the drag.
        assert_eq!(selection.page_regions.len(), 1);
        let region = &selection.page_regions[0];
        assert!((region.bbox.x0 - 154.0).abs() < 1e-9);
        assert!((region.bbox.x1 - 246.0).abs() < 1e-9);
    }

    #[test]
    fn empty_or_non_overlapping_selections_return_none() {
        let page = sentence_page();
        assert!(resolve_selection(&page, &[]).is_none());
        let miss = crate::pdf::coordinates::PdfRect::new(400.0, 100.0, 500.0, 120.0);
        assert!(resolve_selection(&page, &[miss]).is_none());
    }

    #[test]
    fn multi_line_selections_produce_per_line_regions() {
        let mut page = sentence_page();
        // Move the last three words to a second line and renumber lines.
        let second_line = PdfCanonicalLine {
            id: "p1:l1".into(),
            word_ids: vec!["p1:w6".into(), "p1:w7".into(), "p1:w8".into()],
            bbox: crate::pdf::coordinates::PdfRect::new(100.0, 680.0, 344.0, 690.0),
            baseline_y: 680.0,
            reading_order: 1,
        };
        for word in page.words.iter_mut().take(6) {
            word.source_bbox = crate::pdf::coordinates::PdfRect::new(
                word.source_bbox.x0,
                700.0,
                word.source_bbox.x1,
                710.0,
            );
        }
        for word in page.words.iter_mut().skip(6) {
            word.source_bbox = crate::pdf::coordinates::PdfRect::new(
                word.source_bbox.x0,
                680.0,
                word.source_bbox.x1,
                690.0,
            );
        }
        page.lines.push(second_line);
        // Select from the end of line 1 into line 2.
        let rects = vec![
            crate::pdf::coordinates::PdfRect::new(200.0, 700.0, 344.0, 710.0),
            crate::pdf::coordinates::PdfRect::new(100.0, 680.0, 330.0, 690.0),
        ];
        let selection = resolve_selection(&page, &rects).unwrap();
        assert!(selection.text.contains("fox"));
        assert!(selection.text.contains("dog."));
        assert_eq!(selection.page_regions.len(), 2);
        assert_eq!(selection.page_regions[0].page_number, 1);
    }

    #[test]
    fn stored_range_reconstructs_paint_rects() {
        let page = sentence_page();
        let regions = selection_rects(&page, "p1:w2", "p1:w4").unwrap();
        assert_eq!(regions.len(), 1);
        assert!((regions[0].bbox.x0 - 154.0).abs() < 1e-9);
        assert!((regions[0].bbox.x1 - 246.0).abs() < 1e-9);
        // Unknown ids → None.
        assert!(selection_rects(&page, "p1:w99", "p1:w100").is_none());
    }

    #[test]
    fn selection_json_uses_camel_case() {
        let page = sentence_page();
        let rect = crate::pdf::coordinates::PdfRect::new(160.0, 700.0, 230.0, 710.0);
        let selection = resolve_selection(&page, &[rect]).unwrap();
        let json = serde_json::to_string(&selection).unwrap();
        assert!(json.contains("\"startWordId\":\"p1:w2\""));
        assert!(json.contains("\"pageRegions\""));
    }
}
