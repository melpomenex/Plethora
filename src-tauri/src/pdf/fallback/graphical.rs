//! Graphical fallback reflow (design D12, task 7.5): for regions where
//! neither native text nor OCR yields confident words, ink rows become
//! per-line source-crop blocks. The renderer scales each row crop to the
//! viewport width — KOReader-style bitmap reflow implemented independently
//! (no GPL code). Nothing is ever dropped.

use crate::error::{IncrementumError, Result};
use crate::pdf::model::{
    PdfCanonicalBlock, PdfCanonicalBlockKind, PdfCanonicalClassification, PdfCanonicalDirection,
    PdfCanonicalPage, PdfCanonicalPageState, PdfCanonicalRole, PdfSourceRegion, PdfWordSource,
    PDF_CANONICAL_ENGINE_VERSION, PDF_CANONICAL_SCHEMA_VERSION,
};

use crate::pdf::analysis::coordinates::RasterRect;
use crate::pdf::analysis::raster::PageRaster;

/// Ink bands shorter than this (px) are treated as specks/rules and skipped.
const MIN_ROW_INK_PX: u32 = 3;

/// Blank rows that still belong to one text line (leading gaps).
const ROW_MERGE_GAP: u32 = 3;

/// Confidence stamped on graphical crops — always below the semantic path.
const GRAPHICAL_CONFIDENCE: f32 = 0.4;

/// Build a full-page graphical fallback model: one crop block per detected
/// ink line, top to bottom. Word-level splitting is unnecessary when each
/// row crop scales to the viewport width — the row IS the reflow unit.
pub fn build_graphical_fallback_page(
    page_number: u32,
    page_width: f64,
    page_height: f64,
    rotation: u16,
    raster: Option<&PageRaster>,
) -> Result<PdfCanonicalPage> {
    if page_number == 0 {
        return Err(IncrementumError::InvalidInput(
            "PDF page numbers start at 1".into(),
        ));
    }
    let mut blocks = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    if let Some(raster) = raster {
        for (index, band) in raster.mask.row_bands(ROW_MERGE_GAP).into_iter().enumerate() {
            if band.peak_ink < MIN_ROW_INK_PX {
                continue;
            }
            let rect = RasterRect {
                x: 0.0,
                y: band.y0 as f64,
                width: raster.mask.width as f64,
                height: (band.y1 - band.y0 + 1) as f64,
            };
            let bbox = raster.geometry.raster_rect_to_pdf(&rect);
            blocks.push(PdfCanonicalBlock {
                id: format!("p{page_number}:b{index}"),
                kind: PdfCanonicalBlockKind::UnknownVisual,
                role: PdfCanonicalRole::Body,
                page_number,
                source_regions: vec![PdfSourceRegion { page_number, bbox }],
                word_ids: vec![],
                line_ids: vec![],
                reading_order: index as u32,
                confidence: GRAPHICAL_CONFIDENCE,
                text: String::new(),
                direction: PdfCanonicalDirection::Auto,
                language: None,
                items: None,
                table: None,
                asset_id: None,
                source_width: None,
                source_height: None,
                alt_text: None,
                caption_of: None,
                href: None,
                extraction: PdfWordSource::Graphical,
            });
        }
    } else {
        warnings.push("no-raster".into());
    }
    Ok(PdfCanonicalPage {
        page_number,
        width: page_width,
        height: page_height,
        rotation,
        state: PdfCanonicalPageState::Ready,
        classification: PdfCanonicalClassification::FixedLayoutRecommended,
        confidence: GRAPHICAL_CONFIDENCE,
        text_coverage: 0.0,
        words: vec![],
        lines: vec![],
        blocks,
        warnings,
        error_category: None,
        schema_version: PDF_CANONICAL_SCHEMA_VERSION,
        engine_version: PDF_CANONICAL_ENGINE_VERSION.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::analysis::raster::{PageInkMask, PageRaster};
    use crate::pdf::coordinates::RasterGeometry;

    #[test]
    fn ink_lines_become_crop_blocks_top_first() {
        // Three text lines at raster rows 10, 40, 70 (≥3 px ink each).
        let mut gray = vec![255u8; 100 * 100];
        for &y in &[10, 40, 70] {
            for x in 10..90 {
                gray[y * 100 + x] = 0;
            }
        }
        let mask = PageInkMask::from_grayscale(100, 100, &gray);
        let raster = PageRaster {
            mask,
            geometry: RasterGeometry::new(100, 100, 2.0, 0, 50.0, 50.0),
        };
        let page = build_graphical_fallback_page(3, 50.0, 50.0, 0, Some(&raster)).unwrap();
        assert_eq!(page.state, PdfCanonicalPageState::Ready);
        assert_eq!(page.blocks.len(), 3);
        assert!(page
            .blocks
            .iter()
            .all(|b| b.extraction == PdfWordSource::Graphical));
        // Reading order top-first: first block's bbox higher on the page
        // (larger y) than the last.
        assert!(
            page.blocks[0].source_regions[0].bbox.y1 > page.blocks[2].source_regions[0].bbox.y1
        );
        assert!(page.words.is_empty());
    }

    #[test]
    fn blank_or_missing_raster_yields_empty_page_never_error() {
        let gray = vec![255u8; 64];
        let mask = PageInkMask::from_grayscale(8, 8, &gray);
        let raster = PageRaster {
            mask,
            geometry: RasterGeometry::new(8, 8, 1.0, 0, 8.0, 8.0),
        };
        let blank = build_graphical_fallback_page(1, 8.0, 8.0, 0, Some(&raster)).unwrap();
        assert!(blank.blocks.is_empty());
        assert_eq!(blank.state, PdfCanonicalPageState::Ready);
        let no_raster = build_graphical_fallback_page(1, 8.0, 8.0, 0, None).unwrap();
        assert!(no_raster.blocks.is_empty());
        assert!(no_raster.warnings.contains(&"no-raster".to_string()));
    }

    #[test]
    fn page_number_validation() {
        assert!(build_graphical_fallback_page(0, 8.0, 8.0, 0, None).is_err());
    }
}
