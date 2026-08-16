//! Content-bounds detection from the ink mask (D5): the tight ink rectangle
//! that margin trimming in the reflow renderer works from. Coordinates are
//! returned in PDF user space; blocks keep absolute coordinates regardless.

use super::coordinates::PdfRect;
use super::raster::PageRaster;
use crate::pdf::model::PdfSourceRegion;

/// Tight ink bounds in PDF space; `None` for a blank (or missing) raster.
pub fn content_bounds(raster: Option<&PageRaster>) -> Option<PdfRect> {
    let raster = raster?;
    let bounds = raster.mask.ink_bounds()?;
    let rect = raster
        .geometry
        .raster_rect_to_pdf(&super::coordinates::RasterRect {
            x: bounds.0 as f64,
            y: bounds.1 as f64,
            width: (bounds.2 - bounds.0) as f64,
            height: (bounds.3 - bounds.1) as f64,
        });
    Some(rect)
}

/// Union region of a set of source regions (single-page in phase 2).
pub fn union_regions(regions: &[PdfSourceRegion]) -> Option<PdfSourceRegion> {
    let mut iter = regions.iter();
    let first = iter.next()?.clone();
    Some(iter.fold(first, |acc, region| PdfSourceRegion {
        page_number: acc.page_number,
        bbox: acc.bbox.union(&region.bbox),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::analysis::raster::{PageInkMask, PageRaster};
    use crate::pdf::coordinates::RasterGeometry;

    fn raster_with_ink(scale: f64) -> PageRaster {
        // 100×200 raster, ink rectangle at pixels (20..=80, 60..=140) →
        // 61×81 px at 2 px/pt; rotation 0 flips y.
        let mut gray = vec![255u8; 100 * 200];
        for y in 60..=140 {
            for x in 20..=80 {
                gray[y * 100 + x] = 0;
            }
        }
        let mask = PageInkMask::from_grayscale(100, 200, &gray);
        let geometry = RasterGeometry::new(100, 200, scale, 0, 50.0, 100.0);
        PageRaster { mask, geometry }
    }

    #[test]
    fn content_bounds_maps_to_pdf_space_with_y_flip() {
        let bounds = content_bounds(Some(&raster_with_ink(2.0))).unwrap();
        assert!((bounds.x0 - 10.0).abs() < 1e-9);
        assert!((bounds.x1 - 40.0).abs() < 1e-9);
        // Raster y 60..=140 → PDF y (100 − 70) .. (100 − 30) = 30..70.
        assert!((bounds.y0 - 30.0).abs() < 1e-9);
        assert!((bounds.y1 - 70.0).abs() < 1e-9);
    }

    #[test]
    fn missing_or_blank_raster_has_no_bounds() {
        assert_eq!(content_bounds(None), None);
        let mut blank = vec![255u8; 64];
        let mask = PageInkMask::from_grayscale(8, 8, &mut blank);
        let geometry = RasterGeometry::new(8, 8, 1.0, 0, 8.0, 8.0);
        assert_eq!(content_bounds(Some(&PageRaster { mask, geometry })), None);
    }

    #[test]
    fn union_regions_merges_bboxes() {
        let regions = vec![
            PdfSourceRegion {
                page_number: 3,
                bbox: PdfRect::new(10.0, 10.0, 20.0, 20.0),
            },
            PdfSourceRegion {
                page_number: 3,
                bbox: PdfRect::new(15.0, 18.0, 40.0, 50.0),
            },
        ];
        let union = union_regions(&regions).unwrap();
        assert_eq!(union.bbox, PdfRect::new(10.0, 10.0, 40.0, 50.0));
        assert_eq!(union.page_number, 3);
        assert_eq!(union_regions(&[]), None);
    }
}
