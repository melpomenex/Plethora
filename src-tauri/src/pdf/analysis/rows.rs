//! Line banding from word geometry (D6), cross-checked against raster row
//! evidence. Words band into lines by vertical overlap; each line's words
//! order left→right (or right→left for RTL-majority lines). The raster check
//! contributes the native-text coverage signal and flags lines whose geometry
//! claims text where the page has no ink (a sign of invisible/bad text).

use super::coordinates::PdfRect;
use super::raster::PageRaster;
use super::words::RawWord;

/// Fraction of the shorter word's height that must overlap vertically to band.
const VERTICAL_OVERLAP_RATIO: f64 = 0.4;

#[derive(Debug, Clone, PartialEq)]
pub struct RawLine {
    /// Indices into the input word slice, in reading order.
    pub word_indices: Vec<usize>,
    pub bbox: PdfRect,
    pub baseline_y: f64,
    /// Dominant font size of the line (median of word heights).
    pub line_height: f64,
    pub rtl: bool,
}

/// Band words into lines. Assumes words of one column only (phase 5 splits
/// columns first); multi-column pages simply produce wider lines here until
/// then.
pub fn band_lines(words: &[RawWord]) -> Vec<RawLine> {
    if words.is_empty() {
        return Vec::new();
    }
    let mut order: Vec<usize> = (0..words.len()).collect();
    // Top of page first: larger baseline y first (PDF space, y up).
    order.sort_by(|&a, &b| {
        words[b]
            .baseline_y
            .total_cmp(&words[a].baseline_y)
            .then(words[a].bbox.x0.total_cmp(&words[b].bbox.x0))
    });

    let mut lines: Vec<RawLine> = Vec::new();
    let mut current: Vec<usize> = vec![order[0]];
    let mut current_bbox = words[order[0]].bbox;

    for &word_index in &order[1..] {
        let bbox = words[word_index].bbox;
        // Same line ⇔ vertical extents overlap (horizontal position is
        // irrelevant — adjacent words never overlap in 2D).
        let vertical_overlap =
            (current_bbox.y1.min(bbox.y1) - current_bbox.y0.max(bbox.y0)).max(0.0);
        let shorter_height = current_bbox
            .height()
            .min(bbox.height())
            .max(f64::MIN_POSITIVE);
        let same_line = vertical_overlap / shorter_height >= VERTICAL_OVERLAP_RATIO;
        if same_line {
            current_bbox = current_bbox.union(&bbox);
            current.push(word_index);
        } else {
            lines.push(finalize_line(&current, current_bbox, words));
            current = vec![word_index];
            current_bbox = bbox;
        }
    }
    lines.push(finalize_line(&current, current_bbox, words));
    lines
}

fn finalize_line(indices: &[usize], bbox: PdfRect, words: &[RawWord]) -> RawLine {
    let mut sorted: Vec<usize> = indices.to_vec();
    let rtl_count = indices.iter().filter(|&&i| words[i].rtl).count();
    // Strict majority — ties stay LTR.
    let rtl = rtl_count * 2 > indices.len();
    sorted.sort_by(|&a, &b| {
        let (x_a, x_b) = if rtl {
            (words[b].bbox.x0, words[a].bbox.x0)
        } else {
            (words[a].bbox.x0, words[b].bbox.x0)
        };
        x_a.total_cmp(&x_b)
    });
    let mut heights: Vec<f64> = indices.iter().map(|&i| words[i].bbox.height()).collect();
    heights.sort_by(|a, b| a.total_cmp(b));
    let line_height = heights[heights.len() / 2];
    RawLine {
        word_indices: sorted,
        bbox,
        baseline_y: indices
            .iter()
            .map(|&i| words[i].baseline_y)
            .fold(f64::NEG_INFINITY, f64::max),
        line_height,
        rtl,
    }
}

/// Raster y ranges (in raster pixels) covered by the given lines' boxes —
/// the input to `PageInkMask::row_coverage_of`.
pub fn line_raster_ranges(lines: &[RawLine], raster: &PageRaster) -> Vec<(f64, f64)> {
    lines
        .iter()
        .map(|line| {
            let rect = raster.geometry.pdf_rect_to_raster(&line.bbox);
            (rect.y, rect.y + rect.height)
        })
        .collect()
}

/// Lines whose claimed geometry has no ink behind it in the raster.
/// Tolerance pads the range by half a line height to absorb proportional
/// bbox drift.
pub fn lines_without_ink(lines: &[RawLine], raster: &PageRaster) -> Vec<usize> {
    let pad = lines
        .iter()
        .map(|line| line.line_height)
        .fold(0.0_f64, f64::max)
        * 0.5;
    lines
        .iter()
        .enumerate()
        .filter(|(_, line)| {
            let rect = raster.geometry.pdf_rect_to_raster(&line.bbox);
            let y0 = (rect.y - pad).max(0.0) as u32;
            let y1 = (rect.y + rect.height + pad).min(raster.mask.height.saturating_sub(1) as f64)
                as u32;
            let inked = (y0..=y1).any(|y| raster.mask.row_profile[y as usize] > 0);
            !inked
        })
        .map(|(index, _)| index)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::coordinates::RasterGeometry;
    use crate::pdf::model::PdfFontInfo;

    fn word(text: &str, x: f64, y: f64, w: f64, h: f64) -> RawWord {
        RawWord {
            text: text.into(),
            bbox: PdfRect::new(x, y, x + w, y + h),
            bbox_exact: true,
            baseline_y: y,
            font: Some(PdfFontInfo {
                size: h,
                bold: false,
                italic: false,
                family: None,
            }),
            rtl: false,
        }
    }

    #[test]
    fn words_on_the_same_baseline_band_into_one_line() {
        let words = vec![
            word("The", 100.0, 700.0, 30.0, 10.0),
            word("quick", 134.0, 700.0, 40.0, 10.0),
            word("brown", 178.0, 700.0, 42.0, 10.0),
        ];
        let lines = band_lines(&words);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].word_indices, vec![0, 1, 2]);
        assert!((lines[0].line_height - 10.0).abs() < 1e-9);
    }

    #[test]
    fn vertically_separated_words_split_into_lines_top_first() {
        let words = vec![
            word("lower", 100.0, 500.0, 50.0, 10.0),
            word("upper", 100.0, 700.0, 50.0, 10.0),
            word("middle", 100.0, 600.0, 50.0, 10.0),
        ];
        let lines = band_lines(&words);
        assert_eq!(lines.len(), 3);
        // Top of page (largest baseline) comes first.
        assert_eq!(lines[0].word_indices, vec![1]);
        assert_eq!(lines[1].word_indices, vec![2]);
        assert_eq!(lines[2].word_indices, vec![0]);
    }

    #[test]
    fn different_font_sizes_do_not_merge_when_disjoint_vertically() {
        let words = vec![
            word("title", 100.0, 700.0, 60.0, 24.0),
            word("body", 100.0, 660.0, 40.0, 10.0),
        ];
        let lines = band_lines(&words);
        assert_eq!(lines.len(), 2);
        // Superscript case: tiny word overlapping the top 40% of a big word
        // still bands (e.g. footnote markers riding a line).
        let words = vec![
            word("body", 100.0, 700.0, 200.0, 10.0),
            word("1", 304.0, 706.0, 4.0, 4.0),
        ];
        let lines = band_lines(&words);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].word_indices.len(), 2);
    }

    #[test]
    fn rtl_lines_order_right_to_left() {
        let mut a = word("أول", 200.0, 700.0, 30.0, 10.0);
        a.rtl = true;
        let mut b = word("ثاني", 100.0, 700.0, 30.0, 10.0);
        b.rtl = true;
        let words = vec![a, b];
        let lines = band_lines(&words);
        assert_eq!(lines.len(), 1);
        assert!(lines[0].rtl);
        // Right-most word first.
        assert_eq!(words[lines[0].word_indices[0]].text, "أول");
    }

    #[test]
    fn lines_without_ink_flags_geometry_without_raster_evidence() {
        // Page 100×50 pt at 2 px/pt → raster 200×100. Line 1 sits in the
        // top strip (PDF y 40..50 → raster rows 0..20, inked); line 2 in the
        // lower area (PDF y 5..15 → raster rows 70..90, blank).
        let lines = vec![
            RawLine {
                word_indices: vec![0],
                bbox: PdfRect::new(10.0, 40.0, 50.0, 50.0),
                baseline_y: 40.0,
                line_height: 10.0,
                rtl: false,
            },
            RawLine {
                word_indices: vec![1],
                bbox: PdfRect::new(10.0, 5.0, 50.0, 15.0),
                baseline_y: 5.0,
                line_height: 10.0,
                rtl: false,
            },
        ];
        let mut gray = vec![255u8; 200 * 100];
        for y in 0..40 {
            for x in 20..180 {
                gray[y * 200 + x] = 0;
            }
        }
        let mask = super::super::raster::PageInkMask::from_grayscale(200, 100, &gray);
        let raster = PageRaster {
            mask,
            geometry: RasterGeometry::new(200, 100, 2.0, 0, 100.0, 50.0),
        };
        let flagged = lines_without_ink(&lines, &raster);
        assert_eq!(flagged, vec![1]);
        let ranges = line_raster_ranges(&lines, &raster);
        assert_eq!(ranges.len(), 2);
        assert!((ranges[0].0 - 0.0).abs() < 1e-9 && (ranges[0].1 - 20.0).abs() < 1e-9);
        assert!((ranges[1].0 - 70.0).abs() < 1e-9 && (ranges[1].1 - 90.0).abs() < 1e-9);
    }
}
