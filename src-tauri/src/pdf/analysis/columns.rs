//! Column detection via whitespace gutters (D5): column projection profiles
//! of the ink mask reveal vertical blank valleys; valleys wider than a
//! gutter threshold split the content into column regions. Words are then
//! assigned to regions by horizontal overlap; lines crossing a gutter span
//! the columns (full-width titles, figures) and band separately.

use super::coordinates::{PdfRect, RasterGeometry};
use super::raster::PageRaster;
use super::rows::RawLine;
use super::words::RawWord;

/// A gutter must be at least this fraction of the page's median line height
/// to be a column separator (avoids inter-word gaps).
const GUTTER_TO_LINE_HEIGHT: f64 = 1.2;

/// A column must hold at least this fraction of total text-line ink to count
/// (filters sidebar slivers).
const MIN_COLUMN_INK_SHARE: f64 = 0.04;

#[derive(Debug, Clone, PartialEq)]
pub struct ColumnRegion {
    /// Column x-range in PDF user space.
    pub x0: f64,
    pub x1: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpanningAssignment {
    /// Column regions, left to right (single full-width region when no
    /// gutters were found).
    pub columns: Vec<ColumnRegion>,
    /// Indices of words that cross a gutter — they band above the columns
    /// they span (full-width titles, wide figures).
    pub spanning_word_indices: Vec<usize>,
    /// Word index → column index (spanning words excluded).
    pub word_column: Vec<Option<usize>>,
}

/// Detect text columns from the raster's column ink profile inside the
fn detect_columns_from_words(
    words: &[RawWord],
    bounds: PdfRect,
    median_line_height: f64,
) -> Option<Vec<ColumnRegion>> {
    if words.is_empty() {
        return None;
    }
    let gutter_min = (GUTTER_TO_LINE_HEIGHT * median_line_height).max(6.0);
    let total_width = bounds.x1 - bounds.x0;
    if total_width <= gutter_min * 2.0 {
        return None;
    }

    let non_spanning_words: Vec<&RawWord> = words
        .iter()
        .filter(|w| (w.bbox.x1 - w.bbox.x0) < total_width * 0.6)
        .collect();
    if non_spanning_words.len() < 4 {
        return None;
    }

    let bins = 200;
    let mut occupied = vec![false; bins];
    for w in &non_spanning_words {
        let b0 = (((w.bbox.x0 - bounds.x0) / total_width) * bins as f64).floor() as usize;
        let b1 = (((w.bbox.x1 - bounds.x0) / total_width) * bins as f64).ceil() as usize;
        let b0 = b0.min(bins - 1);
        let b1 = b1.min(bins);
        for b in b0..b1 {
            occupied[b] = true;
        }
    }

    let gutter_bins = ((gutter_min / total_width) * bins as f64).ceil() as usize;
    let mut columns: Vec<ColumnRegion> = Vec::new();
    let mut run_start: Option<usize> = None;
    let mut blank_run_start: Option<usize> = None;
    for (b, &is_occ) in occupied.iter().enumerate() {
        if is_occ {
            if let Some(blank_from) = blank_run_start.take() {
                let blank_width = b - blank_from;
                if blank_width >= gutter_bins {
                    if let Some(from) = run_start.take() {
                        let x0 = bounds.x0 + total_width * (from as f64 / bins as f64);
                        let x1 = bounds.x0 + total_width * (blank_from as f64 / bins as f64);
                        columns.push(ColumnRegion { x0, x1 });
                    }
                }
            }
            if run_start.is_none() {
                run_start = Some(b);
            }
        } else if blank_run_start.is_none() {
            blank_run_start = Some(b);
        }
    }
    if let Some(from) = run_start {
        let x0 = bounds.x0 + total_width * (from as f64 / bins as f64);
        let x1 = bounds.x0 + total_width;
        columns.push(ColumnRegion { x0, x1 });
    }

    if columns.len() >= 2 {
        Some(columns)
    } else {
        None
    }
}

/// Detect text columns from native word layout or raster ink profile.
/// Returns a single full-width region when no gutters exist.
pub fn detect_columns(
    raster: Option<&PageRaster>,
    content_bounds: Option<PdfRect>,
    median_line_height: f64,
    words: Option<&[RawWord]>,
) -> Vec<ColumnRegion> {
    let Some(bounds) = content_bounds else {
        return vec![ColumnRegion {
            x0: 0.0,
            x1: f64::MAX,
        }];
    };
    if let Some(words) = words {
        if let Some(cols) = detect_columns_from_words(words, bounds, median_line_height) {
            return cols;
        }
    }
    let Some(raster) = raster else {
        return vec![ColumnRegion {
            x0: 0.0,
            x1: f64::MAX,
        }];
    };
    let gutter_px = (GUTTER_TO_LINE_HEIGHT * median_line_height * raster.geometry.scale).max(4.0);
    let raster_bounds = raster.geometry.pdf_rect_to_raster(&bounds);
    let x_start = raster_bounds.x as usize;
    let x_end = ((raster_bounds.x + raster_bounds.width) as usize).min(raster.mask.width as usize);
    if x_start >= x_end {
        return vec![ColumnRegion {
            x0: 0.0,
            x1: f64::MAX,
        }];
    }

    // Ink presence per pixel column, restricted to the bounded rows.
    let y_start = raster_bounds.y as usize;
    let y_end =
        ((raster_bounds.y + raster_bounds.height) as usize).min(raster.mask.height as usize);
    let total_rows = (y_end - y_start).max(1);
    let mut ink_counts = vec![0u32; x_end - x_start];
    let mut max_ink = 0u32;
    for x in 0..ink_counts.len() {
        let count = count_bounded_ink(raster, x_start + x, y_start, y_end);
        ink_counts[x] = count;
        max_ink = max_ink.max(count);
    }
    // Gutter columns have significantly lower ink height than text columns
    let ink_threshold = (max_ink as f64 * 0.20)
        .max(3.0)
        .min(total_rows as f64 * 0.35) as u32;
    let mut inked = vec![false; x_end - x_start];
    for x in 0..inked.len() {
        inked[x] = ink_counts[x] >= ink_threshold;
    }

    // Blank runs wider than the gutter threshold split columns.
    let mut columns: Vec<ColumnRegion> = Vec::new();
    let mut run_start: Option<usize> = None;
    let mut blank_run_start: Option<usize> = None;
    for (x, &is_ink) in inked.iter().enumerate() {
        if is_ink {
            if let Some(blank_from) = blank_run_start.take() {
                let blank_width = x - blank_from;
                if blank_width as f64 >= gutter_px {
                    if let Some(from) = run_start.take() {
                        columns.push(pdf_column(raster, &bounds, from, blank_from));
                    }
                }
            }
            if run_start.is_none() {
                run_start = Some(x);
            }
        } else if blank_run_start.is_none() {
            blank_run_start = Some(x);
        }
    }
    if let Some(from) = run_start {
        columns.push(pdf_column(raster, &bounds, from, x_end - x_start));
    }

    if columns.len() <= 1 {
        return vec![full_width(bounds)];
    }
    // Drop sliver columns holding almost no text ink (e.g. a page number in
    // the margin) by checking word mass later — here, keep columns that are
    // at least a quarter of the widest.
    let widest = columns
        .iter()
        .map(|column| column.x1 - column.x0)
        .fold(0.0_f64, f64::max);
    let kept: Vec<ColumnRegion> = columns
        .into_iter()
        .filter(|column| (column.x1 - column.x0) >= MIN_COLUMN_INK_SHARE * widest)
        .collect();
    if kept.is_empty() {
        vec![full_width(bounds)]
    } else {
        kept
    }
}

fn count_bounded_ink(raster: &PageRaster, x: usize, y_start: usize, y_end: usize) -> u32 {
    let mut count = 0;
    for y in y_start..y_end {
        if raster.mask.is_inked(x as u32, y as u32) {
            count += 1;
        }
    }
    count
}

fn pdf_column(
    raster: &PageRaster,
    bounds: &PdfRect,
    px_start: usize,
    px_end: usize,
) -> ColumnRegion {
    let _ = raster;
    let width = bounds.x1 - bounds.x0;
    let total_px = ((raster.geometry.pdf_rect_to_raster(bounds).width) as usize).max(1);
    let x0 = bounds.x0 + width * (px_start as f64 / total_px as f64);
    let x1 = bounds.x0 + width * (px_end as f64 / total_px as f64);
    ColumnRegion { x0, x1 }
}

fn full_width(bounds: PdfRect) -> ColumnRegion {
    ColumnRegion {
        x0: bounds.x0,
        x1: bounds.x1,
    }
}

/// Assign words to detected columns; words crossing a gutter are spanning.
pub fn assign_words_to_columns(words: &[RawWord], columns: &[ColumnRegion]) -> SpanningAssignment {
    if columns.len() <= 1 {
        return SpanningAssignment {
            columns: columns.to_vec(),
            spanning_word_indices: Vec::new(),
            word_column: words.iter().map(|_| Some(0)).collect(),
        };
    }
    let mut spanning = Vec::new();
    let mut word_column = vec![None; words.len()];
    for (index, word) in words.iter().enumerate() {
        let overlaps: Vec<usize> = columns
            .iter()
            .enumerate()
            .filter(|(_, column)| word.bbox.x1 > column.x0 && word.bbox.x0 < column.x1)
            .map(|(column_index, _)| column_index)
            .collect();
        match overlaps.len() {
            0 => {
                // Word in the gutter or margin — attach to nearest column.
                let nearest = columns
                    .iter()
                    .enumerate()
                    .min_by(|(_, a), (_, b)| {
                        let da = (a.x0 - word.bbox.center_x())
                            .abs()
                            .min((a.x1 - word.bbox.center_x()).abs());
                        let db = (b.x0 - word.bbox.center_x())
                            .abs()
                            .min((b.x1 - word.bbox.center_x()).abs());
                        da.total_cmp(&db)
                    })
                    .map(|(column_index, _)| column_index);
                word_column[index] = nearest;
            }
            1 => word_column[index] = Some(overlaps[0]),
            _ => {
                // Crossing two columns: spanning content.
                spanning.push(index);
            }
        }
    }
    SpanningAssignment {
        columns: columns.to_vec(),
        spanning_word_indices: spanning,
        word_column,
    }
}

/// Reading-order position of a band of lines: spanning bands precede the
/// column streams whose vertical range they intersect.
#[derive(Debug, Clone, PartialEq)]
pub enum RegionSlot {
    Spanning,
    Column(usize),
}

/// A line placed in the page-wide reading sequence (task 5.2).
#[derive(Debug, Clone, PartialEq)]
pub struct SequencedLine {
    pub line: RawLine,
    /// None = spanning line (crosses gutters).
    pub column: Option<usize>,
    /// Vertical stretch index: spanning lines delimit stretches; column
    /// content above a spanning line belongs to the earlier stretch.
    pub stretch: usize,
}

/// Interleave spanning lines and per-column line streams into reading order:
/// stretches run top-to-bottom; spanning lines first within their stretch
/// boundary, then columns left-to-right, each top-to-bottom.
pub fn sequence_lines(
    spanning: Vec<RawLine>,
    mut per_column: Vec<Vec<RawLine>>,
) -> Vec<SequencedLine> {
    let mut ordered_spanning: Vec<RawLine> = spanning;
    ordered_spanning.sort_by(|a, b| b.baseline_y.total_cmp(&a.baseline_y));
    for stream in per_column.iter_mut() {
        stream.sort_by(|a, b| b.baseline_y.total_cmp(&a.baseline_y));
    }

    // Stretch boundaries: the vertical midpoints between consecutive
    // spanning lines; a column line's stretch = number of spanning lines
    // whose center y is above (greater than) the line's center y.
    let spanning_centers: Vec<f64> = ordered_spanning
        .iter()
        .map(|line| line.bbox.center_y())
        .collect();

    let mut sequenced: Vec<SequencedLine> = Vec::new();
    let stretch_of = |center_y: f64| -> usize {
        spanning_centers
            .iter()
            .filter(|&&span_y| span_y > center_y)
            .count()
    };

    let mut column_iter: Vec<(usize, RawLine, usize)> = per_column
        .iter()
        .enumerate()
        .flat_map(|(column_index, stream)| {
            stream
                .iter()
                .map(move |line| (column_index, line.clone(), stretch_of(line.bbox.center_y())))
        })
        .collect();
    column_iter.sort_by(|a, b| {
        a.2.cmp(&b.2)
            .then(a.0.cmp(&b.0))
            .then(b.1.baseline_y.total_cmp(&a.1.baseline_y))
    });

    let mut column_pos = 0;
    for (span_index, spanning_line) in ordered_spanning.iter().enumerate() {
        // Column lines of this stretch precede the spanning line that
        // terminates it.
        while column_pos < column_iter.len() && column_iter[column_pos].2 == span_index {
            let (column_index, line, stretch) = column_iter[column_pos].clone();
            sequenced.push(SequencedLine {
                line,
                column: Some(column_index),
                stretch,
            });
            column_pos += 1;
        }
        sequenced.push(SequencedLine {
            line: spanning_line.clone(),
            column: None,
            stretch: span_index,
        });
    }
    for (column_index, line, stretch) in column_iter.into_iter().skip(column_pos) {
        sequenced.push(SequencedLine {
            line,
            column: Some(column_index),
            stretch,
        });
    }
    sequenced
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::analysis::raster::{PageInkMask, PageRaster};
    use crate::pdf::coordinates::RasterGeometry;

    fn word_at(x0: f64, x1: f64) -> RawWord {
        RawWord {
            text: "x".into(),
            bbox: PdfRect::new(x0, 700.0, x1, 710.0),
            bbox_exact: true,
            baseline_y: 700.0,
            font: None,
            rtl: false,
        }
    }

    fn two_column_raster() -> PageRaster {
        // Page 200×100pt at 2px/pt → 400×200 raster. Two text columns at
        // x 20..90px and 130..200px (gutter 90..130 = 40px), full height.
        let mut gray = vec![255u8; 400 * 200];
        for y in 10..190 {
            for x in 20..90 {
                gray[y * 400 + x] = 0;
            }
            for x in 130..200 {
                gray[y * 400 + x] = 0;
            }
        }
        let mask = PageInkMask::from_grayscale(400, 200, &gray);
        let geometry = RasterGeometry::new(400, 200, 2.0, 0, 200.0, 100.0);
        PageRaster { mask, geometry }
    }

    #[test]
    fn detects_two_columns_from_gutter() {
        let bounds = PdfRect::new(10.0, 5.0, 100.0, 95.0); // pt
        let columns = detect_columns(Some(&two_column_raster()), Some(bounds), 10.0, None);
        assert_eq!(columns.len(), 2, "gutter splits the page: {columns:?}");
        assert!(columns[0].x1 <= columns[1].x0);
        // Columns sit inside the content bounds.
        assert!(columns[0].x0 >= bounds.x0 - 0.51);
        assert!(columns[1].x1 <= bounds.x1 + 0.51);
    }

    #[test]
    fn single_column_page_stays_single() {
        let mut gray = vec![255u8; 400 * 200];
        for y in 10..190 {
            for x in 20..380 {
                gray[y * 400 + x] = 0;
            }
        }
        let mask = PageInkMask::from_grayscale(400, 200, &gray);
        let raster = PageRaster {
            mask,
            geometry: RasterGeometry::new(400, 200, 2.0, 0, 200.0, 100.0),
        };
        let columns = detect_columns(
            Some(&raster),
            Some(PdfRect::new(10.0, 5.0, 190.0, 95.0)),
            10.0,
            None,
        );
        assert_eq!(columns.len(), 1);
    }

    #[test]
    fn no_raster_means_one_full_width_region() {
        let columns = detect_columns(None, None, 10.0, None);
        assert_eq!(columns.len(), 1);
        assert_eq!(columns[0].x1, f64::MAX);
    }

    #[test]
    fn words_assign_to_columns_and_gutters_span() {
        let columns = vec![
            ColumnRegion { x0: 0.0, x1: 100.0 },
            ColumnRegion {
                x0: 120.0,
                x1: 220.0,
            },
        ];
        let words = vec![
            word_at(10.0, 50.0),   // left column
            word_at(130.0, 170.0), // right column
            word_at(10.0, 210.0),  // crosses the gutter → spanning
            word_at(104.0, 112.0), // inside the gutter → nearest column
        ];
        let assignment = assign_words_to_columns(&words, &columns);
        assert_eq!(assignment.word_column[0], Some(0));
        assert_eq!(assignment.word_column[1], Some(1));
        assert!(assignment.spanning_word_indices.contains(&2));
        assert_eq!(assignment.word_column[2], None);
        assert!(assignment.word_column[3].is_some());
    }

    #[test]
    fn single_region_assigns_everything_to_column_zero() {
        let columns = vec![ColumnRegion {
            x0: 0.0,
            x1: f64::MAX,
        }];
        let words = vec![word_at(0.0, 10.0), word_at(500.0, 600.0)];
        let assignment = assign_words_to_columns(&words, &columns);
        assert!(assignment.spanning_word_indices.is_empty());
        assert!(assignment.word_column.iter().all(|slot| *slot == Some(0)));
    }

    fn line_at(y: f64, x0: f64, x1: f64) -> RawWord {
        RawWord {
            text: format!("{y}-{x0}"),
            bbox: PdfRect::new(x0, y, x1, y + 10.0),
            bbox_exact: true,
            baseline_y: y,
            font: None,
            rtl: false,
        }
    }

    fn raw_line(y: f64, x0: f64, x1: f64) -> super::super::rows::RawLine {
        super::super::rows::RawLine {
            word_indices: vec![],
            bbox: PdfRect::new(x0, y, x1, y + 10.0),
            baseline_y: y,
            line_height: 10.0,
            rtl: false,
        }
    }

    #[test]
    fn sequencing_reads_columns_before_spanning_dividers() {
        // Left column lines at y=700..676, right column at y=700..676, a
        // full-width divider at y=660, and post-divider content at 640.
        let spanning = vec![raw_line(660.0, 10.0, 590.0)];
        let left = vec![raw_line(700.0, 10.0, 290.0), raw_line(688.0, 10.0, 290.0)];
        let right = vec![raw_line(700.0, 310.0, 590.0), raw_line(688.0, 310.0, 590.0)];
        let below = vec![raw_line(640.0, 10.0, 290.0)];
        let sequenced = sequence_lines(spanning, vec![left, right.clone(), below]);
        let order: Vec<(Option<usize>, f64)> = sequenced
            .iter()
            .map(|entry| (entry.column, entry.line.baseline_y))
            .collect();
        assert_eq!(
            order,
            vec![
                (Some(0), 700.0),
                (Some(0), 688.0),
                (Some(1), 700.0),
                (Some(1), 688.0),
                (None, 660.0), // spanning divider after the stretch above
                (Some(2), 640.0),
            ]
        );
        // Stretches: pre-divider lines share stretch 0; post-divider line
        // is stretch 1.
        assert_eq!(sequenced[0].stretch, 0);
        assert_eq!(sequenced[4].stretch, 0);
        assert_eq!(sequenced[5].stretch, 1);
    }
}
