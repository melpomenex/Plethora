//! Table detection (task 6.4): ruling-line grids yield structured rows when
//! confidence is high; anything else stays a preserved crop (fidelity first,
//! D7). A ruled table is detected from long horizontal + vertical ink runs
//! forming ≥2×2 cells; cell text comes from native words inside each cell.

use crate::pdf::model::PdfTableData;

use super::coordinates::PdfRect;
use super::raster::PageRaster;
use super::words::RawWord;

/// A row/column of the mask counts as a ruling line when at least this
/// fraction of its span is inked.
const RULE_COVERAGE: f64 = 0.75;

#[derive(Debug, Clone, PartialEq)]
pub struct TableCandidate {
    pub bbox: PdfRect,
    pub data: Option<PdfTableData>,
}

/// Detect ruled tables within a visual region. Returns `data: None` when the
/// region is not a clean ruled grid (callers render it as a crop).
pub fn detect_ruled_table(
    raster: Option<&PageRaster>,
    region: PdfRect,
    words: &[RawWord],
) -> TableCandidate {
    let Some(raster) = raster else {
        return TableCandidate {
            bbox: region,
            data: None,
        };
    };
    let raster_region = raster.geometry.pdf_rect_to_raster(&region);
    let x_start = raster_region.x as u32;
    let x_end = (raster_region.x + raster_region.width) as u32;
    let y_start = raster_region.y as u32;
    let y_end = (raster_region.y + raster_region.height) as u32;
    if x_end <= x_start + 2
        || y_end <= y_start + 2
        || x_end > raster.mask.width
        || y_end > raster.mask.height
    {
        return TableCandidate {
            bbox: region,
            data: None,
        };
    }

    let width = (x_end - x_start) as f64;
    let height = (y_end - y_start) as f64;

    // A ruled table is mostly empty cells: if the region is over half ink
    // (solid blobs, dense images), rule detection is meaningless.
    let total_px = (width * height).max(1.0);
    let ink_px: f64 = (y_start..y_end)
        .flat_map(|y| (x_start..x_end).filter(move |&x| raster.mask.is_inked(x, y)))
        .count() as f64;
    if ink_px / total_px >= 0.5 {
        return TableCandidate {
            bbox: region,
            data: None,
        };
    }

    // Horizontal rules: rows whose inked fraction within the region ≥ threshold.
    let mut h_rules: Vec<u32> = Vec::new();
    for y in y_start..y_end {
        let inked = (x_start..x_end)
            .filter(|&x| raster.mask.is_inked(x, y))
            .count() as f64;
        if inked / width >= RULE_COVERAGE {
            if h_rules.last().map_or(true, |&last| y - last > 2) {
                h_rules.push(y);
            }
        }
    }
    let mut v_rules: Vec<u32> = Vec::new();
    for x in x_start..x_end {
        let inked = (y_start..y_end)
            .filter(|&y| raster.mask.is_inked(x, y))
            .count() as f64;
        if inked / height >= RULE_COVERAGE {
            if v_rules.last().map_or(true, |&last| x - last > 2) {
                v_rules.push(x);
            }
        }
    }

    // A grid needs at least 2 horizontal and 2 vertical rules (border + at
    // least one split each way).
    if h_rules.len() < 2 || v_rules.len() < 2 {
        return TableCandidate {
            bbox: region,
            data: None,
        };
    }

    let mut rows: Vec<Vec<String>> = Vec::new();
    for row_window in h_rules.windows(2) {
        let (top, bottom) = (row_window[0], row_window[1]);
        let mut row: Vec<String> = Vec::new();
        for column_window in v_rules.windows(2) {
            let (left, right) = (column_window[0], column_window[1]);
            let cell = raster
                .geometry
                .raster_rect_to_pdf(&super::coordinates::RasterRect {
                    x: left as f64 + 1.0,
                    y: top as f64 + 1.0,
                    width: (right - left - 1) as f64,
                    height: (bottom - top - 1) as f64,
                });
            let mut cell_words: Vec<&RawWord> = words
                .iter()
                .filter(|word| {
                    word.bbox.center_x() >= cell.x0
                        && word.bbox.center_x() <= cell.x1
                        && word.bbox.center_y() >= cell.y0
                        && word.bbox.center_y() <= cell.y1
                })
                .collect();
            cell_words.sort_by(|a, b| {
                b.baseline_y
                    .total_cmp(&a.baseline_y)
                    .then(a.bbox.x0.total_cmp(&b.bbox.x0))
            });
            row.push(
                cell_words
                    .iter()
                    .map(|word| word.text.clone())
                    .collect::<Vec<_>>()
                    .join(" "),
            );
        }
        rows.push(row);
    }
    let ruled = true;
    // A grid whose cells are all empty carries no structure worth parsing.
    if rows
        .iter()
        .all(|row| row.iter().all(|cell| cell.is_empty()))
    {
        return TableCandidate {
            bbox: region,
            data: None,
        };
    }
    TableCandidate {
        bbox: region,
        data: Some(PdfTableData {
            rows,
            header_row: Some(0),
            ruled,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::analysis::raster::PageInkMask;
    use crate::pdf::coordinates::RasterGeometry;

    fn word(text: &str, x: f64, y: f64) -> RawWord {
        RawWord {
            text: text.into(),
            bbox: PdfRect::new(x, y, x + 20.0, y + 8.0),
            bbox_exact: true,
            baseline_y: y,
            font: None,
            rtl: false,
        }
    }

    fn ruled_grid_raster() -> PageRaster {
        // 200×100pt at 2px/pt → 400×200. Grid: x rules at px 60,190,320;
        // y rules at px 60,120,180. Cell centers (PDF pt): x ≈ 33,97,160;
        // y ≈ 55,85 (raster 120 mid ↔ PDF y = 100-60=40? compute: PDF y =
        // (200 - vy)/2 → rows 60..120 → y 70..40; center 55. rows 120..180 →
        // y 40..10; center 25.)
        let mut gray = vec![255u8; 400 * 200];
        for &y in &[60, 120, 180] {
            for x in 60..320 {
                gray[y * 400 + x] = 0;
            }
        }
        for &x in &[60, 190, 320] {
            for y in 60..180 {
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
    fn ruled_grid_extracts_cells() {
        let raster = ruled_grid_raster();
        let region = PdfRect::new(28.0, 8.0, 162.0, 72.0);
        let words = vec![
            word("alpha", 33.0, 52.0),
            word("beta", 97.0, 52.0),
            word("gamma", 140.0, 22.0),
        ];
        let candidate = detect_ruled_table(Some(&raster), region, &words);
        let data = candidate.data.expect("ruled grid parses");
        assert_eq!(data.rows.len(), 2);
        assert_eq!(data.rows[0].len(), 2);
        assert_eq!(data.rows[0][0], "alpha");
        assert_eq!(data.rows[0][1], "beta");
        assert_eq!(data.rows[1][1], "gamma");
        assert_eq!(data.rows[1][0], "");
        assert!(data.ruled);
    }

    #[test]
    fn non_ruled_regions_return_none_data() {
        let mut gray = vec![255u8; 400 * 200];
        // Scattered ink: no long rules.
        for y in (60..180).step_by(7) {
            for x in (60..320).step_by(9) {
                gray[y * 400 + x] = 0;
            }
        }
        let mask = PageInkMask::from_grayscale(400, 200, &gray);
        let raster = PageRaster {
            mask,
            geometry: RasterGeometry::new(400, 200, 2.0, 0, 200.0, 100.0),
        };
        let candidate =
            detect_ruled_table(Some(&raster), PdfRect::new(28.0, 8.0, 162.0, 72.0), &[]);
        assert!(candidate.data.is_none());
        // And without a raster, never guess.
        assert!(
            detect_ruled_table(None, PdfRect::new(0.0, 0.0, 10.0, 10.0), &[])
                .data
                .is_none()
        );
    }
}
