//! Figure/visual-region detection (task 6.1): 2D spatial visual segmentation.
//! Native text line bounding boxes are subtracted from the page ink mask in 2D.
//! The remaining non-text ink is grouped into 2D connected regions, merged across
//! small visual gaps, filtered for noise, and associated with adjacent captions.
//!
//! Visual fidelity is preserved — every unexplained visual region renders as a
//! source crop, never re-created or silently dropped (D7).

use std::collections::VecDeque;

use super::coordinates::{PdfRect, RasterRect};
use super::raster::PageRaster;
use super::rows::RawLine;

/// A text line separates two visual components only when it is at least this
/// fraction of the page's widest text line — i.e. a full body-text line.
/// Short label-like lines inside a diagram must NOT block merging.
const BODY_LINE_WIDTH_FRACTION: f64 = 0.55;

/// Body-text lines are within this multiple of the median line height.
const BODY_LINE_HEIGHT_MIN: f64 = 0.6;
const BODY_LINE_HEIGHT_MAX: f64 = 2.5;

/// Secondary consolidation gap, in median line heights: components of one
/// multi-part diagram (split by an internal label row or whitespace) sit
/// within this distance of each other.
const CONSOLIDATION_GAP_LINES: f64 = 2.5;

/// Sub-glyph noise: components smaller than this fraction of a line height in
/// BOTH dimensions are rendering residue, not visual marks.
const SUB_GLYPH_FRACTION: f64 = 0.6;

#[derive(Debug, Clone, PartialEq)]
pub struct VisualRegion {
    /// Tight ink bounds of the region in PDF space.
    pub bbox: PdfRect,
    /// Caption text found adjacent (e.g. "Figure 7.3 — ...").
    pub caption: Option<String>,
}

/// Classify a text line as body text: a LONG run (≥ `body_min_length` of the
/// page's longest line) with font-sized thickness. Measured on the long/short
/// axes rather than width/height so rotated text (vertical strips in user
/// space, e.g. pages authored sideways under /Rotate 90) classifies the same
/// way as horizontal text. Label-like lines (axis labels, diagram
/// annotations) fail the length test.
fn is_body_line(line: &RawLine, body_min_length: f64, median_line_height: f64) -> bool {
    let length = line.bbox.width().max(line.bbox.height());
    let thickness = line.bbox.width().min(line.bbox.height());
    length >= body_min_length
        && thickness >= BODY_LINE_HEIGHT_MIN * median_line_height
        && thickness <= BODY_LINE_HEIGHT_MAX * median_line_height
}

/// Detect 2D ink regions not explained by text lines.
pub fn detect_visual_regions(
    raster: Option<&PageRaster>,
    text_lines: &[RawLine],
    median_line_height: f64,
) -> Vec<VisualRegion> {
    let Some(raster) = raster else {
        return Vec::new();
    };
    let mask = &raster.mask;
    if mask.total_ink == 0 {
        return Vec::new();
    }

    // 1. Copy the 2D ink mask and subtract all detected text lines in 2D.
    //
    // Reported text-item geometry is not glyph-exact: ascenders, descenders,
    // diacritics and fonts with under-reported metrics leave ink outside the
    // line bbox, which fragments text pages into dozens of sub-glyph "visual"
    // regions. Instead of trusting the bbox rows, snap each line's exclusion
    // rectangle to the ink row bands it overlaps — the raster's ground truth
    // for where that line's ink actually is. Growth per side is capped at one
    // line height so a line adjacent to (or on top of) figure ink cannot
    // swallow the figure; the horizontal pad only covers anti-aliased glyph
    // edges.
    let mut non_text_ink = mask.ink.clone();
    let bands = mask.row_bands(0);
    let growth_cap_px = (median_line_height * raster.geometry.scale)
        .round()
        .max(6.0) as i64;
    for line in text_lines {
        let rect = raster.geometry.pdf_rect_to_raster(&line.bbox);
        // Off-page line boxes (possible when item geometry disagrees with the
        // page box) are skipped; the clamps below keep every cast in range.
        if rect.y + rect.height < 0.0 || rect.y > mask.height as f64 {
            continue;
        }
        let x0 = (rect.x.floor() as i64 - 2).clamp(0, mask.width as i64 - 1) as u32;
        let x1 =
            ((rect.x + rect.width).ceil() as i64 + 2).clamp(x0 as i64, mask.width as i64) as u32;
        let by0 = rect.y.floor() as i64;
        let by1 = (rect.y + rect.height).ceil() as i64;
        let mut y0 = by0;
        let mut y1 = by1;
        for band in &bands {
            let (b0, b1) = (band.y0 as i64, band.y1 as i64);
            if b1 >= by0 - 1 && b0 <= by1 + 1 {
                y0 = y0.min(b0);
                y1 = y1.max(b1);
            }
        }
        let y0 = (y0.max(by0 - growth_cap_px)).clamp(0, mask.height as i64 - 1) as u32;
        let y1 = (y1.min(by1 + growth_cap_px)).clamp(y0 as i64, mask.height as i64 - 1) as u32;
        for y in y0..=y1 {
            let offset = y as usize * mask.width as usize;
            for x in x0..x1 {
                non_text_ink[offset + x as usize] = 0;
            }
        }
    }

    // 2. Coarse grid aggregation for fast 2D connected-component analysis.
    let tile_size = (4.0 * raster.geometry.scale / 2.0).round().max(2.0) as u32;
    let grid_w = (mask.width + tile_size - 1) / tile_size;
    let grid_h = (mask.height + tile_size - 1) / tile_size;
    let mut grid = vec![0u32; (grid_w * grid_h) as usize];

    for gy in 0..grid_h {
        let y_min = gy * tile_size;
        let y_max = (y_min + tile_size).min(mask.height);
        for gx in 0..grid_w {
            let x_min = gx * tile_size;
            let x_max = (x_min + tile_size).min(mask.width);
            let mut count = 0u32;
            for y in y_min..y_max {
                let offset = y as usize * mask.width as usize;
                for x in x_min..x_max {
                    if non_text_ink[offset + x as usize] == 1 {
                        count += 1;
                    }
                }
            }
            grid[(gy * grid_w + gx) as usize] = count;
        }
    }

    // 3. Find 8-connected components of active tiles.
    let mut visited = vec![false; (grid_w * grid_h) as usize];
    let mut raw_components: Vec<(u32, u32, u32, u32, u64)> = Vec::new(); // (x0, y0, x1, y1, ink_count)

    for start_gy in 0..grid_h {
        for start_gx in 0..grid_w {
            let start_idx = (start_gy * grid_w + start_gx) as usize;
            if visited[start_idx] || grid[start_idx] == 0 {
                continue;
            }

            // BFS flood fill
            let mut queue = VecDeque::new();
            queue.push_back((start_gx, start_gy));
            visited[start_idx] = true;

            let mut comp_tiles = Vec::new();

            while let Some((gx, gy)) = queue.pop_front() {
                comp_tiles.push((gx, gy));

                for dy in -1..=1 {
                    for dx in -1..=1 {
                        if dx == 0 && dy == 0 {
                            continue;
                        }
                        let nx = gx as i32 + dx;
                        let ny = gy as i32 + dy;
                        if nx >= 0 && nx < grid_w as i32 && ny >= 0 && ny < grid_h as i32 {
                            let n_idx = (ny as u32 * grid_w + nx as u32) as usize;
                            if !visited[n_idx] && grid[n_idx] > 0 {
                                visited[n_idx] = true;
                                queue.push_back((nx as u32, ny as u32));
                            }
                        }
                    }
                }
            }

            // Find exact pixel bounds of this component from the original mask
            let mut min_px = mask.width;
            let mut max_px = 0u32;
            let mut min_py = mask.height;
            let mut max_py = 0u32;
            let mut total_ink = 0u64;

            for &(gx, gy) in &comp_tiles {
                let y_min = gy * tile_size;
                let y_max = (y_min + tile_size).min(mask.height);
                let x_min = gx * tile_size;
                let x_max = (x_min + tile_size).min(mask.width);
                for y in y_min..y_max {
                    let offset = y as usize * mask.width as usize;
                    for x in x_min..x_max {
                        if non_text_ink[offset + x as usize] == 1 {
                            min_px = min_px.min(x);
                            max_px = max_px.max(x);
                            min_py = min_py.min(y);
                            max_py = max_py.max(y);
                            total_ink += 1;
                        }
                    }
                }
            }

            if max_px >= min_px && max_py >= min_py && total_ink >= 4 {
                raw_components.push((min_px, min_py, max_px, max_py, total_ink));
            }
        }
    }

    // 4. Merge nearby visual components that belong to the same visual
    //    structure. A merge is blocked only by a FULL body-text line crossing
    //    the union — label-like lines inside a diagram (axis labels, node
    //    captions) must not fragment the figure.
    let line_h_px = median_line_height * raster.geometry.scale;
    let body_line_length = text_lines
        .iter()
        .map(|line| line.bbox.width().max(line.bbox.height()))
        .fold(0.0_f64, f64::max);
    let body_min_length = BODY_LINE_WIDTH_FRACTION * body_line_length;
    let separated_by_text = |union_pdf: PdfRect| -> bool {
        text_lines.iter().any(|line| {
            is_body_line(line, body_min_length, median_line_height)
                && line.bbox.intersects(&union_pdf)
        })
    };

    let mut merged_boxes = merge_nearby_components(
        raw_components,
        (1.5 * line_h_px).max(8.0) as u32,
        &separated_by_text,
        raster,
        0.0,
    );

    // 4b. Secondary consolidation: parts of one diagram separated by an
    //     internal label row or deliberate whitespace merge across a larger
    //     gap when no body text lies between them. Only figure-like
    //     components participate: merging requires at least one side taller
    //     than a text line, so repeated thin strips (table-of-contents
    //     leader-dot rows, ruled separators) never glue into page-covering
    //     towers.
    merged_boxes = merge_nearby_components(
        merged_boxes,
        (CONSOLIDATION_GAP_LINES * line_h_px).max(12.0) as u32,
        &separated_by_text,
        raster,
        1.2 * line_h_px,
    );

    // 5. Filter noise specks and convert to PDF space.
    //
    // Sub-glyph fragments (both dimensions well under a line height) are
    // rendering residue by construction — the text subtraction above removes
    // exactly the text ink, so what remains at that scale is anti-aliasing
    // residue or glyph overshoot, never a perceptual visual mark.
    let min_dimension_px = (0.4 * median_line_height * raster.geometry.scale).max(2.0);
    let sub_glyph_px = SUB_GLYPH_FRACTION * median_line_height * raster.geometry.scale;
    let mut visual_regions: Vec<VisualRegion> = merged_boxes
        .into_iter()
        .filter(|&(x0, y0, x1, y1, ink)| {
            let w = (x1 - x0 + 1) as f64;
            let h = (y1 - y0 + 1) as f64;
            let sub_glyph = w < sub_glyph_px && h < sub_glyph_px;
            // Hairline residue: a sub-4px sliver with negligible ink is a
            // glyph-edge artifact, not a mark (a real hairline carries ink).
            let hairline = w.min(h) < 4.0 && ink < 120;
            !sub_glyph
                && !hairline
                && (w >= min_dimension_px || h >= min_dimension_px || ink >= 12)
                && ink >= 6
        })
        .map(|(x0, y0, x1, y1, _)| {
            let bbox = raster.geometry.raster_rect_to_pdf(&RasterRect {
                x: x0 as f64,
                y: y0 as f64,
                width: (x1 - x0 + 1) as f64,
                height: (y1 - y0 + 1) as f64,
            });
            VisualRegion {
                bbox,
                caption: None,
            }
        })
        .collect();

    visual_regions.sort_by(|a, b| b.bbox.y1.total_cmp(&a.bbox.y1));

    visual_regions
}

/// Iteratively merge components whose bounding boxes are within `gap` pixels
/// (dx and dy), unless a blocking body-text line crosses the union of a pair.
/// When `min_figure_height_px` is positive, a pair only merges if at least one
/// component is at least that tall (figure-like, not a thin strip).
fn merge_nearby_components(
    boxes: Vec<(u32, u32, u32, u32, u64)>,
    gap: u32,
    separated_by_text: &dyn Fn(PdfRect) -> bool,
    raster: &PageRaster,
    min_figure_height_px: f64,
) -> Vec<(u32, u32, u32, u32, u64)> {
    let mut merged_boxes = boxes;
    let mut changed = true;
    while changed {
        changed = false;
        let mut next_boxes: Vec<(u32, u32, u32, u32, u64)> = Vec::new();
        let mut used = vec![false; merged_boxes.len()];

        for i in 0..merged_boxes.len() {
            if used[i] {
                continue;
            }
            let (mut x0, mut y0, mut x1, mut y1, mut ink) = merged_boxes[i];
            used[i] = true;

            for j in (i + 1)..merged_boxes.len() {
                if used[j] {
                    continue;
                }
                let (bx0, by0, bx1, by1, bink) = merged_boxes[j];

                let figure_like = min_figure_height_px <= 0.0
                    || (y1 - y0 + 1) as f64 >= min_figure_height_px
                    || (by1 - by0 + 1) as f64 >= min_figure_height_px;
                if !figure_like {
                    continue;
                }

                // Check distance between bounding boxes
                let dx = if x1 < bx0 {
                    bx0 - x1
                } else if bx1 < x0 {
                    x0 - bx1
                } else {
                    0
                };
                let dy = if y1 < by0 {
                    by0 - y1
                } else if by1 < y0 {
                    y0 - by1
                } else {
                    0
                };

                if dx <= gap && dy <= gap {
                    let union_rect = RasterRect {
                        x: x0.min(bx0) as f64,
                        y: y0.min(by0) as f64,
                        width: (x1.max(bx1) - x0.min(bx0) + 1) as f64,
                        height: (y1.max(by1) - y0.min(by0) + 1) as f64,
                    };
                    let union_pdf = raster.geometry.raster_rect_to_pdf(&union_rect);

                    // Only a full body-text line crossing the union means the
                    // two components are genuinely separate visuals.
                    if !separated_by_text(union_pdf) {
                        x0 = x0.min(bx0);
                        y0 = y0.min(by0);
                        x1 = x1.max(bx1);
                        y1 = y1.max(by1);
                        ink += bink;
                        used[j] = true;
                        changed = true;
                    }
                }
            }
            next_boxes.push((x0, y0, x1, y1, ink));
        }
        merged_boxes = next_boxes;
    }
    merged_boxes
}

/// Attach captions: lines starting with "Figure N"/"Fig. N"/"Table N" within
/// a short distance above or below each region.
/// Consolidates multi-component diagrams into one figure bounding box.
pub fn attach_captions(
    regions: &mut Vec<VisualRegion>,
    text_lines: &[RawLine],
    median_line_height: f64,
    line_text: impl Fn(&RawLine) -> String,
) {
    let search = (25.0 * median_line_height).max(350.0);
    for region in regions.iter_mut() {
        let mut best: Option<(f64, String, PdfRect)> = None;
        for line in text_lines {
            let text = line_text(line);
            let trimmed = text.trim();
            let looks_like_caption = trimmed.len() < 240 && regexish_caption_prefix(trimmed);
            if !looks_like_caption {
                continue;
            }
            let distance = if line.bbox.y0 >= region.bbox.y1 {
                line.bbox.y0 - region.bbox.y1 // caption above
            } else if line.bbox.y1 <= region.bbox.y0 {
                region.bbox.y0 - line.bbox.y1 // caption below
            } else {
                continue;
            };
            if distance <= search && best.as_ref().map_or(true, |(d, _, _)| distance < *d) {
                best = Some((distance, text, line.bbox));
            }
        }
        if let Some((_, caption, cap_bbox)) = best {
            region.caption = Some(caption);
            // Expand region bbox downwards to reach the top of the caption line
            if cap_bbox.y1 <= region.bbox.y0 {
                region.bbox.y0 = (cap_bbox.y1 + 2.0).min(region.bbox.y0);
            }
        }
    }

    // Consolidate adjacent visual regions sharing the same caption into one figure
    let mut consolidated: Vec<VisualRegion> = Vec::new();
    for region in regions.drain(..) {
        if let Some(ref cap) = region.caption {
            if let Some(existing) = consolidated
                .iter_mut()
                .find(|r| r.caption.as_deref() == Some(cap))
            {
                existing.bbox = existing.bbox.union(&region.bbox);
                continue;
            }
        }
        consolidated.push(region);
    }

    // Body-text classifier for label absorption (same criterion as the merge
    // pass, so a region absorbs only lines that could not have separated it).
    let body_line_length = text_lines
        .iter()
        .map(|line| line.bbox.width().max(line.bbox.height()))
        .fold(0.0_f64, f64::max);
    let body_min_length = BODY_LINE_WIDTH_FRACTION * body_line_length;

    // Expand each figure's bounding box to include its internal diagram text
    // lines. Captioned figures (confirmed visuals) absorb every line inside
    // plus label-like lines directly above; uncaptioned ones absorb only
    // label-like lines — inside ones always, above ones only when the line is
    // centered over the region (a diagram title), so a short last line of a
    // body paragraph above an uncaptioned visual is never swallowed.
    for region in consolidated.iter_mut() {
        let captioned = region.caption.is_some();
        // A directly-above label block (figure title) may extend the bbox
        // upward by at most this much in total, proportional to the region's
        // own height — without the cap, iterative absorption ladders up
        // stacked text lines one by one and towers over neighboring content.
        let up_cap = (2.0 * median_line_height).max(0.75 * region.bbox.height());
        let original_y1 = region.bbox.y1;
        let mut sorted_lines: Vec<&RawLine> = text_lines
            .iter()
            .filter(|line| !regexish_caption_prefix(line_text(line).trim()))
            .collect();
        sorted_lines.sort_by(|a, b| a.bbox.y0.total_cmp(&b.bbox.y0));

        let mut changed = true;
        while changed {
            changed = false;
            for line in &sorted_lines {
                let text = line_text(line);
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let is_inside_vertical =
                    line.bbox.y0 >= region.bbox.y0 - 4.0 && line.bbox.y1 <= region.bbox.y1 + 4.0;
                let is_directly_above = line.bbox.y0 >= region.bbox.y1
                    && line.bbox.y0 <= region.bbox.y1 + (2.5 * median_line_height).max(45.0)
                    && line.bbox.y1 <= original_y1 + up_cap
                    // A title/label above the region is at most a little
                    // wider than the region itself — a body-width line above
                    // a narrow region is neighboring text, not a label.
                    && line.bbox.width()
                        <= (1.5 * region.bbox.width()).max(3.0 * median_line_height);
                let looks_like_label = trimmed.len() < 50 || line.bbox.width() < 220.0;
                let centered_over_region = line.bbox.center_x()
                    >= region.bbox.x0 + region.bbox.width() * 0.2
                    && line.bbox.center_x() <= region.bbox.x1 - region.bbox.width() * 0.2
                    && line.bbox.x0 >= region.bbox.x0 - region.bbox.width() * 0.1
                    && line.bbox.x1 <= region.bbox.x1 + region.bbox.width() * 0.1;
                let is_label_like = !is_body_line(line, body_min_length, median_line_height);

                let absorb = if captioned {
                    is_inside_vertical || (is_directly_above && looks_like_label)
                } else {
                    (is_inside_vertical && is_label_like)
                        || (is_directly_above && is_label_like && centered_over_region)
                };

                if absorb {
                    let new_x0 = region.bbox.x0.min(line.bbox.x0 - 4.0);
                    let new_x1 = region.bbox.x1.max(line.bbox.x1 + 4.0);
                    let new_y0 = region.bbox.y0.min(line.bbox.y0 - 2.0);
                    let new_y1 = region.bbox.y1.max(line.bbox.y1 + 2.0);
                    if (new_x0 - region.bbox.x0).abs() > 0.1
                        || (new_x1 - region.bbox.x1).abs() > 0.1
                        || (new_y0 - region.bbox.y0).abs() > 0.1
                        || (new_y1 - region.bbox.y1).abs() > 0.1
                    {
                        region.bbox.x0 = new_x0;
                        region.bbox.x1 = new_x1;
                        region.bbox.y0 = new_y0;
                        region.bbox.y1 = new_y1;
                        changed = true;
                    }
                }
            }
        }
    }

    // Regions grown into each other (or overlapping fragments of one
    // diagram) merge. Substantial overlap (≥25% of the smaller box) is by
    // itself proof of one perceptual object — text checks do not override
    // it; merely touching regions still need the no-body-text evidence.
    let mut changed = true;
    while changed {
        changed = false;
        let mut next: Vec<VisualRegion> = Vec::new();
        let mut used = vec![false; consolidated.len()];
        for i in 0..consolidated.len() {
            if used[i] {
                continue;
            }
            let mut region = consolidated[i].clone();
            used[i] = true;
            for j in (i + 1)..consolidated.len() {
                if used[j] {
                    continue;
                }
                let other = &consolidated[j];
                if !region.bbox.intersects(&other.bbox) {
                    continue;
                }
                let inter = region.bbox.overlap_area(&other.bbox);
                let smaller = (region.bbox.width() * region.bbox.height())
                    .min(other.bbox.width() * other.bbox.height());
                let same_object = inter >= 0.25 * smaller;
                let union = region.bbox.union(&other.bbox);
                let separated = text_lines.iter().any(|line| {
                    is_body_line(line, body_min_length, median_line_height)
                        && line.bbox.intersects(&union)
                });
                if same_object || !separated {
                    region.bbox = union;
                    region.caption = region.caption.or_else(|| other.caption.clone());
                    used[j] = true;
                    changed = true;
                }
            }
            next.push(region);
        }
        consolidated = next;
    }

    *regions = consolidated;
}

fn regexish_caption_prefix(trimmed: &str) -> bool {
    let lower = trimmed.to_lowercase();
    let prefixes = [
        "figure ", "fig. ", "fig ", "diagram ", "plate ", "chart ", "table ",
    ];
    prefixes.iter().any(|prefix| {
        lower.starts_with(prefix)
            && lower[prefix.len()..]
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_digit())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::analysis::raster::PageInkMask;
    use crate::pdf::coordinates::RasterGeometry;

    fn line(y: f64, x0: f64, x1: f64, height: f64) -> RawLine {
        RawLine {
            word_indices: vec![],
            bbox: PdfRect::new(x0, y, x1, y + height),
            baseline_y: y,
            line_height: height,
            rtl: false,
        }
    }

    fn raster_with_figure() -> PageRaster {
        // 200×100pt at 2px/pt → 400×200. Text line at PDF y 90..98 (raster
        // rows 4..20), figure ink at raster rows 60..140.
        let mut gray = vec![255u8; 400 * 200];
        for y in 4..20 {
            for x in 20..380 {
                gray[y * 400 + x] = 0;
            }
        }
        for y in 60..140 {
            for x in 60..340 {
                gray[y * 400 + x] = 0;
            }
        }
        let mask = PageInkMask::from_grayscale(400, 200, &gray);
        PageRaster {
            mask,
            geometry: RasterGeometry::new(400, 200, 2.0, 0, 200.0, 100.0),
        }
    }

    #[test]
    fn ink_without_text_becomes_visual_region() {
        let raster = raster_with_figure();
        let text_lines = vec![line(90.0, 10.0, 190.0, 8.0)];
        let regions = detect_visual_regions(Some(&raster), &text_lines, 8.0);
        assert_eq!(regions.len(), 1, "regions: {regions:?}");
        // Raster rows 60..140 → PDF y 30..70; x 60..340 px → 30..170 pt.
        assert!((regions[0].bbox.y1 - 70.0).abs() < 1.01);
        assert!((regions[0].bbox.y0 - 30.0).abs() < 1.01);
        assert!((regions[0].bbox.x0 - 30.0).abs() < 1.01);
        assert!((regions[0].bbox.x1 - 170.5).abs() < 1.01);
    }

    #[test]
    fn side_by_side_illustration_and_text_is_detected() {
        // Page 200x100pt: Left half has illustration at PDF y 30..70 (x 10..40pt),
        // right half has text line at PDF y 30..70 (x 60..100pt).
        // In 1D horizontal row analysis, the text line would mask out the entire y range!
        // In our 2D spatial analysis, the illustration is preserved!
        let mut gray = vec![255u8; 400 * 200];
        // Figure on the left: x 20..80 px (10..40 pt), y 60..140 px (PDF y 30..70)
        for y in 60..140 {
            for x in 20..80 {
                gray[y * 400 + x] = 0;
            }
        }
        // Text on the right: x 120..200 px (60..100 pt), y 60..76 px (PDF y 62..70)
        for y in 60..76 {
            for x in 120..200 {
                gray[y * 400 + x] = 0;
            }
        }
        let mask = PageInkMask::from_grayscale(400, 200, &gray);
        let raster = PageRaster {
            mask,
            geometry: RasterGeometry::new(400, 200, 2.0, 0, 200.0, 100.0),
        };
        let text_lines = vec![line(62.0, 60.0, 100.0, 8.0)];
        let regions = detect_visual_regions(Some(&raster), &text_lines, 8.0);
        assert_eq!(
            regions.len(),
            1,
            "Side-by-side figure must be detected: {regions:?}"
        );
        assert!((regions[0].bbox.x0 - 10.0).abs() < 1.01);
        assert!((regions[0].bbox.x1 - 40.0).abs() < 1.01);
    }

    #[test]
    fn no_raster_or_all_text_yields_no_regions() {
        assert!(detect_visual_regions(None, &[], 10.0).is_empty());
        let raster = raster_with_figure();
        let lines = vec![
            line(90.0, 10.0, 190.0, 8.0),
            line(30.0, 25.0, 175.0, 40.0), // covers the figure band
        ];
        assert!(detect_visual_regions(Some(&raster), &lines, 8.0).is_empty());
    }

    #[test]
    fn captions_attach_to_nearby_regions() {
        let mut regions = vec![VisualRegion {
            bbox: PdfRect::new(30.0, 40.0, 170.0, 70.0),
            caption: None,
        }];
        let caption_line = line(31.0, 30.0, 150.0, 9.0);
        let far_line = line(5.0, 30.0, 150.0, 9.0);
        let lines = vec![far_line, caption_line];
        attach_captions(&mut regions, &lines, 9.0, |line| {
            if line.baseline_y == 31.0 {
                "Figure 7.3 — Mitochondrial genome".into()
            } else {
                "Unrelated body text that is long enough not to be a caption".into()
            }
        });
        assert_eq!(
            regions[0].caption.as_deref(),
            Some("Figure 7.3 — Mitochondrial genome")
        );
    }

    /// Text ink whose rows sit OUTSIDE the reported line bbox (mis-metriced
    /// font, ascender overshoot) must still be subtracted — the exclusion
    /// rectangle snaps to the ink band it overlaps.
    #[test]
    fn glyph_ink_outside_line_bbox_is_still_subtracted() {
        // Ink band at raster rows 10..20; the line's reported bbox maps to
        // rows 4..12 (offset high, like the observed running-header drift).
        let mut gray = vec![255u8; 400 * 200];
        for y in 10..20 {
            for x in 20..380 {
                gray[y * 400 + x] = 0;
            }
        }
        let mask = PageInkMask::from_grayscale(400, 200, &gray);
        let raster = PageRaster {
            mask,
            geometry: RasterGeometry::new(400, 200, 2.0, 0, 200.0, 100.0),
        };
        // bbox PDF y 94..98 → raster rows 4..12 — overlaps the band 10..20.
        let text_lines = vec![line(94.0, 10.0, 190.0, 4.0)];
        let regions = detect_visual_regions(Some(&raster), &text_lines, 8.0);
        assert!(
            regions.is_empty(),
            "mis-metriced glyph rows leaked: {regions:?}"
        );
    }

    /// A short internal label line must not split a diagram; a full body-text
    /// line between two ink areas must keep them separate.
    #[test]
    fn internal_labels_do_not_split_but_body_text_separates() {
        // Two ink blocks (rows 60..100 and 116..156) with a text line band
        // (rows 100..116) between them.
        let mut gray = vec![255u8; 400 * 200];
        for y in 60..100 {
            for x in 60..340 {
                gray[y * 400 + x] = 0;
            }
        }
        for y in 100..116 {
            for x in 150..250 {
                gray[y * 400 + x] = 0;
            }
        }
        for y in 116..156 {
            for x in 60..340 {
                gray[y * 400 + x] = 0;
            }
        }
        let mask = PageInkMask::from_grayscale(400, 200, &gray);
        let raster = PageRaster {
            mask,
            geometry: RasterGeometry::new(400, 200, 2.0, 0, 200.0, 100.0),
        };

        // Label-like middle line (narrow, next to a real body-width line
        // elsewhere on the page): the diagram merges into one region.
        let body_elsewhere = line(90.0, 20.0, 180.0, 8.0); // wide, not near the diagram
        let label = line(44.0, 90.0, 110.0, 8.0); // rows 100..116
        let lines = [body_elsewhere, label];
        let regions = detect_visual_regions(Some(&raster), &lines, 8.0);
        assert_eq!(
            regions.len(),
            1,
            "label-split diagram must merge: {regions:?}"
        );
        assert!(
            regions[0].bbox.height() >= 46.0,
            "merged region must span the diagram: {regions:?}"
        );

        // Body-width middle line: the two blocks stay separate visuals.
        let body = line(44.0, 30.0, 180.0, 8.0);
        let regions = detect_visual_regions(Some(&raster), std::slice::from_ref(&body), 8.0);
        assert_eq!(
            regions.len(),
            2,
            "body text must separate visuals: {regions:?}"
        );
    }

    /// Sub-glyph residue (both dimensions under ~0.6 line heights) is dropped.
    #[test]
    fn sub_glyph_fragments_are_filtered() {
        let mut gray = vec![255u8; 400 * 200];
        // A 6×4 px speck at rows 60..64 — under a line height (8pt × 2px/pt
        // = 16px) in both dimensions.
        for y in 60..64 {
            for x in 200..206 {
                gray[y * 400 + x] = 0;
            }
        }
        let mask = PageInkMask::from_grayscale(400, 200, &gray);
        let raster = PageRaster {
            mask,
            geometry: RasterGeometry::new(400, 200, 2.0, 0, 200.0, 100.0),
        };
        let regions = detect_visual_regions(Some(&raster), &[], 8.0);
        assert!(
            regions.is_empty(),
            "sub-glyph speck must be filtered: {regions:?}"
        );
    }

    /// Uncaptioned regions absorb internal label lines the same way
    /// captioned ones do (complete-figure bbox growth).
    #[test]
    fn uncaptioned_regions_absorb_internal_labels() {
        let mut regions = vec![VisualRegion {
            bbox: PdfRect::new(60.0, 40.0, 170.0, 70.0),
            caption: None,
        }];
        // A short label fully inside the region's vertical range.
        let label = line(50.0, 90.0, 120.0, 8.0);
        // A wide body line (not label-like, not absorbable).
        let body = line(48.0, 20.0, 180.0, 8.0);
        let lines = vec![body, label];
        attach_captions(&mut regions, &lines, 8.0, |l| {
            if l.bbox.width() > 100.0 {
                "a full-width body text line that is clearly long enough to be body text".into()
            } else {
                "age 25".into()
            }
        });
        // The label is absorbed; the body line is not.
        assert!(
            (regions[0].bbox.x0 - 60.0).abs() < 0.2,
            "label x0 absorbed: {regions:?}"
        );
        assert!(
            (regions[0].bbox.y0 - 40.0).abs() < 0.2,
            "body line must not be absorbed: {regions:?}"
        );
        assert!(
            (regions[0].bbox.y1 - 70.0).abs() < 0.2,
            "body line must not raise y1: {regions:?}"
        );
    }
}
