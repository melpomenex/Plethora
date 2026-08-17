//! Pluggable OCR (design D11, task 7.2): engines live where they already
//! exist (desktop providers under `src/ocr/`, Android AICore via the genai
//! plugin, browser fallback) — this module defines the contract and turns
//! recognized words into canonical model pages. Every word carries text,
//! bbox, and confidence; born-digital pages never pass through here.

use serde::Deserialize;

use crate::error::Result;
use crate::pdf::model::{
    PdfCanonicalBlock, PdfCanonicalBlockKind, PdfCanonicalClassification, PdfCanonicalDirection,
    PdfCanonicalLine, PdfCanonicalPage, PdfCanonicalPageState, PdfCanonicalRole, PdfCanonicalWord,
    PdfSourceRegion, PdfWordSource, PDF_CANONICAL_ENGINE_VERSION, PDF_CANONICAL_SCHEMA_VERSION,
};

/// OCR engines produce words with source geometry and confidence. Bboxes
/// arrive normalized (0..1, top-left origin in RENDER space) and convert to
/// PDF user space here.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrWordInput {
    pub text: String,
    /// Normalized render-space box: x/y/width/height in 0..1 (top-left).
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// 0..1 engine confidence.
    pub confidence: f32,
}

/// The engine contract — implemented by whichever local engine the host
/// routes to. Keeping it here documents the shape every engine must produce
/// (recognize returns words in reading order when possible).
pub trait PdfOcrEngine {
    fn recognize(&self, image_png: &[u8]) -> Result<Vec<OcrWordInput>>;
}

/// Average OCR line confidence below this degrades the block to a visual
/// crop with the text retained as alt_text (spec: pdf-scanned-fallback).
const LOW_CONFIDENCE: f32 = 0.5;

struct OcrWord {
    text: String,
    bbox: crate::pdf::coordinates::PdfRect,
    confidence: f32,
}

fn to_pdf_space(word: &OcrWordInput, page_width: f64, page_height: f64, rotation: u16) -> OcrWord {
    // Normalized top-left box → PDF user space (bottom-left, y up). For
    // rotated renders the collector sends unrotated-page normalized coords,
    // so rotation does not change the mapping.
    let _ = rotation;
    OcrWord {
        text: word.text.clone(),
        bbox: crate::pdf::coordinates::PdfRect::new(
            word.x * page_width,
            (1.0 - word.y - word.height) * page_height,
            (word.x + word.width) * page_width,
            (1.0 - word.y) * page_height,
        ),
        confidence: word.confidence,
    }
}

/// Build a canonical page from OCR results: words band into lines by
/// vertical overlap, lines group into paragraphs by gaps, low-confidence
/// lines degrade to visual crops with alt_text (task 7.4).
#[allow(clippy::too_many_arguments)]
pub fn build_page_from_ocr_args(
    page_number: u32,
    page_width: f64,
    page_height: f64,
    rotation: u16,
    words: &[OcrWordInput],
) -> Result<PdfCanonicalPage> {
    use crate::error::PlethoraError;
    if page_number == 0 {
        return Err(PlethoraError::InvalidInput(
            "PDF page numbers start at 1".into(),
        ));
    }
    let words: Vec<OcrWord> = words
        .iter()
        .filter(|word| !word.text.trim().is_empty())
        .map(|word| to_pdf_space(word, page_width, page_height, rotation))
        .collect();

    // Band lines by vertical overlap (top-first).
    let mut order: Vec<usize> = (0..words.len()).collect();
    order.sort_by(|&a, &b| {
        words[b]
            .bbox
            .center_y()
            .partial_cmp(&words[a].bbox.center_y())
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(
                words[a]
                    .bbox
                    .x0
                    .partial_cmp(&words[b].bbox.x0)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });
    let mut line_groups: Vec<Vec<usize>> = Vec::new();
    for &index in &order {
        match line_groups.last_mut() {
            Some(group) => {
                let group_top = group
                    .iter()
                    .map(|&i| words[i].bbox.y1)
                    .fold(f64::NEG_INFINITY, f64::max);
                let group_bottom = group
                    .iter()
                    .map(|&i| words[i].bbox.y0)
                    .fold(f64::INFINITY, f64::min);
                let word_height = words[index].bbox.height().max(1.0);
                let overlap = (group_top.min(words[index].bbox.y1)
                    - group_bottom.max(words[index].bbox.y0))
                .max(0.0);
                if overlap / word_height >= 0.4 {
                    group.push(index);
                } else {
                    line_groups.push(vec![index]);
                }
            }
            None => line_groups.push(vec![index]),
        }
    }

    // Paragraphs: gap > 1.45 × median leading splits (mirrors native path).
    let centers: Vec<f64> = line_groups
        .iter()
        .map(|group| {
            group.iter().map(|&i| words[i].bbox.center_y()).sum::<f64>() / group.len() as f64
        })
        .collect();
    let mut leadings: Vec<f64> = centers
        .windows(2)
        .map(|pair| pair[0] - pair[1])
        .filter(|gap| gap > &0.0)
        .collect();
    leadings.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    // Lower-middle for even counts: with only two gaps (body + big jump) the
    // tight body leading is the right baseline, not the jump.
    let median_leading = leadings
        .get(leadings.len().saturating_sub(1) / 2)
        .copied()
        .unwrap_or(12.0)
        .max(1.0);

    let mut paragraphs: Vec<Vec<usize>> = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    for (position, group) in line_groups.iter().enumerate() {
        let split =
            position > 0 && centers[position - 1] - centers[position] > 1.45 * median_leading;
        if split && !current.is_empty() {
            paragraphs.push(std::mem::take(&mut current));
        }
        current.push(position);
    }
    if !current.is_empty() {
        paragraphs.push(current);
    }

    // Assemble canonical words/lines/blocks.
    let mut canonical_words: Vec<PdfCanonicalWord> = Vec::new();
    let mut canonical_lines: Vec<PdfCanonicalLine> = Vec::new();
    let mut blocks: Vec<PdfCanonicalBlock> = Vec::new();
    let mut line_index = 0u32;
    for (paragraph_index, paragraph) in paragraphs.iter().enumerate() {
        let mut paragraph_word_ids = Vec::new();
        let mut paragraph_line_ids = Vec::new();
        let mut text_parts: Vec<String> = Vec::new();
        let mut confidence_sum = 0.0_f32;
        let mut confidence_count = 0u32;
        let mut paragraph_bbox: Option<crate::pdf::coordinates::PdfRect> = None;
        let mut low_confidence = false;
        for &line_position in paragraph {
            let group = &line_groups[line_position];
            let mut line_word_ids = Vec::new();
            let mut line_bbox: Option<crate::pdf::coordinates::PdfRect> = None;
            let mut line_conf = 0.0_f32;
            for &word_index in group {
                let word = &words[word_index];
                let canonical = PdfCanonicalWord {
                    id: format!("p{page_number}:w{}", canonical_words.len()),
                    page_number,
                    text: word.text.clone(),
                    source_bbox: word.bbox,
                    source_fragments: vec![],
                    bbox_exact: false, // OCR geometry is engine-estimated
                    reading_order: canonical_words.len() as u32,
                    confidence: word.confidence,
                    source: PdfWordSource::Ocr,
                    dehyphenated: false,
                    font: None,
                };
                line_conf += word.confidence;
                confidence_sum += word.confidence;
                confidence_count += 1;
                line_word_ids.push(canonical.id.clone());
                paragraph_word_ids.push(canonical.id.clone());
                paragraph_bbox = Some(match paragraph_bbox {
                    Some(rect) => rect.union(&word.bbox),
                    None => word.bbox,
                });
                line_bbox = Some(match line_bbox {
                    Some(rect) => rect.union(&word.bbox),
                    None => word.bbox,
                });
                canonical_words.push(canonical);
            }
            let line_count = group.len().max(1);
            if line_conf / (line_count as f32) < LOW_CONFIDENCE {
                low_confidence = true;
            }
            let line = PdfCanonicalLine {
                id: format!("p{page_number}:l{line_index}"),
                word_ids: line_word_ids,
                bbox: line_bbox.unwrap_or_default(),
                baseline_y: line_bbox.map(|rect| rect.y0).unwrap_or(0.0),
                reading_order: line_index,
            };
            text_parts.push(
                group
                    .iter()
                    .map(|&i| words[i].text.clone())
                    .collect::<Vec<_>>()
                    .join(" "),
            );
            paragraph_line_ids.push(line.id.clone());
            canonical_lines.push(line);
            line_index += 1;
        }
        let text = text_parts.join(" ");
        let avg_confidence = if confidence_count == 0 {
            0.0
        } else {
            confidence_sum / confidence_count as f32
        };
        // Low-confidence paragraphs degrade to visual crops; the OCR text
        // stays searchable as alt_text (spec: pdf-scanned-fallback).
        let (kind, block_text, alt_text) = if low_confidence {
            (
                PdfCanonicalBlockKind::UnknownVisual,
                String::new(),
                Some(text),
            )
        } else {
            (PdfCanonicalBlockKind::Paragraph, text, None)
        };
        blocks.push(PdfCanonicalBlock {
            id: format!("p{page_number}:b{paragraph_index}"),
            kind,
            role: PdfCanonicalRole::Body,
            page_number,
            source_regions: vec![PdfSourceRegion {
                page_number,
                bbox: paragraph_bbox.unwrap_or_default(),
            }],
            word_ids: paragraph_word_ids,
            line_ids: paragraph_line_ids,
            reading_order: paragraph_index as u32,
            confidence: avg_confidence,
            text: block_text,
            direction: PdfCanonicalDirection::Auto,
            language: None,
            items: None,
            table: None,
            asset_id: None,
            source_width: None,
            source_height: None,
            alt_text,
            caption_of: None,
            href: None,
            extraction: PdfWordSource::Ocr,
        });
    }

    let confidence =
        words.iter().map(|word| word.confidence).sum::<f32>() / words.len().max(1) as f32;
    Ok(PdfCanonicalPage {
        page_number,
        width: page_width,
        height: page_height,
        rotation,
        state: PdfCanonicalPageState::Ready,
        classification: PdfCanonicalClassification::SemanticWithWarnings,
        confidence,
        text_coverage: 0.0, // OCR pages have no native text coverage signal
        words: canonical_words,
        lines: canonical_lines,
        blocks,
        warnings: vec!["ocr-derived".into()],
        error_category: None,
        schema_version: PDF_CANONICAL_SCHEMA_VERSION,
        engine_version: PDF_CANONICAL_ENGINE_VERSION.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(text: &str, x: f64, y: f64, w: f64, h: f64, confidence: f32) -> OcrWordInput {
        OcrWordInput {
            text: text.into(),
            x,
            y,
            width: w,
            height: h,
            confidence,
        }
    }

    #[test]
    fn ocr_words_become_real_text_paragraphs() {
        // Page 200×100pt. Line 1 at normalized y 0.1, line 2 at y 0.2 —
        // same paragraph; line 3 far below at y 0.8 — second paragraph.
        let words = vec![
            word("Scanned", 0.1, 0.10, 0.08, 0.02, 0.95),
            word("text", 0.19, 0.10, 0.05, 0.02, 0.95),
            word("here", 0.25, 0.10, 0.05, 0.02, 0.95),
            word("continues", 0.1, 0.14, 0.10, 0.02, 0.95),
            word("Footer", 0.1, 0.80, 0.06, 0.02, 0.95),
        ];
        let page = build_page_from_ocr_args(7, 200.0, 100.0, 0, &words).unwrap();
        assert_eq!(page.state, PdfCanonicalPageState::Ready);
        assert_eq!(page.blocks.len(), 2);
        assert_eq!(page.blocks[0].text, "Scanned text here continues");
        assert_eq!(page.blocks[1].text, "Footer");
        assert!(page
            .blocks
            .iter()
            .all(|b| b.extraction == PdfWordSource::Ocr));
        // Bboxes converted to PDF space (y flip).
        let first = &page.words[0];
        assert!((first.source_bbox.y1 - 100.0 * (1.0 - 0.10)).abs() < 1e-9);
        assert!((first.source_bbox.y0 - 100.0 * (1.0 - 0.12)).abs() < 1e-9);
        assert!(!first.bbox_exact);
        assert!(page.warnings.contains(&"ocr-derived".to_string()));
    }

    #[test]
    fn low_confidence_paragraphs_keep_text_as_alt() {
        let words = vec![
            word("garbled", 0.1, 0.1, 0.08, 0.02, 0.2),
            word("noise", 0.19, 0.1, 0.05, 0.02, 0.3),
        ];
        let page = build_page_from_ocr_args(1, 200.0, 100.0, 0, &words).unwrap();
        assert_eq!(page.blocks[0].kind, PdfCanonicalBlockKind::UnknownVisual);
        assert_eq!(page.blocks[0].alt_text.as_deref(), Some("garbled noise"));
        assert_eq!(page.blocks[0].text, "");
        // The words still exist for search/TTS.
        assert_eq!(page.words.len(), 2);
    }

    #[test]
    fn empty_ocr_yields_empty_ready_page() {
        let page = build_page_from_ocr_args(2, 100.0, 100.0, 0, &[]).unwrap();
        assert_eq!(page.state, PdfCanonicalPageState::Ready);
        assert!(page.blocks.is_empty());
        assert!(page.words.is_empty());
    }

    #[test]
    fn page_number_validation() {
        assert!(build_page_from_ocr_args(0, 100.0, 100.0, 0, &[]).is_err());
    }
}
