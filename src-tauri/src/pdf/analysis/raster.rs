//! Raster preprocessing: PNG decode → grayscale → binarized ink mask with
//! row/column ink projections (D5). All downstream consumers work in PDF
//! space via `RasterGeometry`; the raster itself is never persisted.

use crate::error::{IncrementumError, Result};

use super::coordinates::RasterGeometry;

/// Luminance at or below this is "ink". 200 keeps anti-aliased glyph edges
/// while rejecting paper/parchment backgrounds up to light-gray.
const INK_THRESHOLD: u8 = 200;

/// A row/column counts as inked when at least this many ink pixels are
/// present, filtering single-pixel specks.
const MIN_INK_RUN_DENSITY: u32 = 3;

#[derive(Debug, Clone)]
pub struct PageInkMask {
    pub width: u32,
    pub height: u32,
    /// One byte per pixel, 1 = ink, 0 = background.
    pub ink: Vec<u8>,
    /// Ink pixel count per raster row.
    pub row_profile: Vec<u32>,
    /// Ink pixel count per raster column.
    pub col_profile: Vec<u32>,
    pub total_ink: u64,
}

/// A contiguous band of inked rows (text lines, rules, figure regions).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct InkRowBand {
    /// Inclusive raster-space y range, top-left origin.
    pub y0: u32,
    pub y1: u32,
    pub peak_ink: u32,
}

impl PageInkMask {
    pub fn from_grayscale(width: u32, height: u32, gray: &[u8]) -> Self {
        assert_eq!(gray.len(), (width as usize) * (height as usize));
        let mut ink = vec![0u8; gray.len()];
        let mut row_profile = vec![0u32; height as usize];
        let mut col_profile = vec![0u32; width as usize];
        let mut total_ink = 0u64;
        for y in 0..height as usize {
            let row_offset = y * width as usize;
            for x in 0..width as usize {
                if gray[row_offset + x] <= INK_THRESHOLD {
                    ink[row_offset + x] = 1;
                    row_profile[y] += 1;
                    col_profile[x] += 1;
                    total_ink += 1;
                }
            }
        }
        Self {
            width,
            height,
            ink,
            row_profile,
            col_profile,
            total_ink,
        }
    }

    pub fn from_png(png: &[u8]) -> Result<Self> {
        let image = image::load_from_memory(png).map_err(|error| {
            IncrementumError::InvalidInput(format!("Analysis raster decode failed: {error}"))
        })?;
        let luma = image.to_luma8();
        let (width, height) = luma.dimensions();
        Ok(Self::from_grayscale(width, height, luma.as_raw()))
    }

    pub fn is_inked(&self, x: u32, y: u32) -> bool {
        if x >= self.width || y >= self.height {
            return false;
        }
        self.ink[y as usize * self.width as usize + x as usize] == 1
    }

    /// Contiguous bands of inked rows, merged when separated by fewer than
    /// `merge_gap` blank rows (tight text leading should stay one band only
    /// when intended — callers pass 0 for strict line splitting).
    pub fn row_bands(&self, merge_gap: u32) -> Vec<InkRowBand> {
        let mut bands: Vec<InkRowBand> = Vec::new();
        let mut current: Option<InkRowBand> = None;
        let mut blank_run = 0u32;
        for (y, &count) in self.row_profile.iter().enumerate() {
            let inked = count >= MIN_INK_RUN_DENSITY;
            let y = y as u32;
            if inked {
                blank_run = 0;
                match current.as_mut() {
                    Some(band) => {
                        band.y1 = y;
                        band.peak_ink = band.peak_ink.max(count);
                    }
                    None => {
                        current = Some(InkRowBand {
                            y0: y,
                            y1: y,
                            peak_ink: count,
                        });
                    }
                }
            } else if let Some(band) = current.as_mut() {
                blank_run += 1;
                if blank_run > merge_gap {
                    bands.push(*band);
                    current = None;
                }
            }
        }
        if let Some(band) = current {
            bands.push(band);
        }
        bands
    }

    /// Tight ink bounding box in raster pixels; `None` for a blank page.
    pub fn ink_bounds(&self) -> Option<(u32, u32, u32, u32)> {
        let mut x0 = self.width;
        let mut y0 = self.height;
        let mut x1 = 0u32;
        let mut y1 = 0u32;
        let mut found = false;
        for (y, &count) in self.row_profile.iter().enumerate() {
            if count == 0 {
                continue;
            }
            found = true;
            let y = y as u32;
            y0 = y0.min(y);
            y1 = y1.max(y);
        }
        if !found {
            return None;
        }
        for (x, &count) in self.col_profile.iter().enumerate() {
            if count == 0 {
                continue;
            }
            let x = x as u32;
            x0 = x0.min(x);
            x1 = x1.max(x);
        }
        Some((x0, y0, x1, y1))
    }

    /// Fraction (0..=1) of ink row bands that overlap the given raster y
    /// ranges — the native-text coverage signal for page classification.
    pub fn row_coverage_of(&self, ranges: &[(f64, f64)]) -> f64 {
        let bands = self.row_bands(0);
        if bands.is_empty() {
            return 1.0;
        }
        let covered = bands
            .iter()
            .filter(|band| {
                let band_mid = (band.y0 + band.y1) as f64 / 2.0;
                ranges
                    .iter()
                    .any(|(lo, hi)| band_mid >= *lo && band_mid <= *hi)
            })
            .count();
        covered as f64 / bands.len() as f64
    }
}

/// Geometry binding the decoded mask to PDF space.
#[derive(Debug, Clone)]
pub struct PageRaster {
    pub mask: PageInkMask,
    pub geometry: RasterGeometry,
}

impl PageRaster {
    pub fn from_png(
        png: &[u8],
        scale: f64,
        rotation: u16,
        page_width: f64,
        page_height: f64,
    ) -> Result<Self> {
        let mask = PageInkMask::from_png(png)?;
        let geometry = RasterGeometry::new(
            mask.width,
            mask.height,
            scale,
            rotation,
            page_width,
            page_height,
        );
        Ok(Self { mask, geometry })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gray_with_ink(width: u32, height: u32, ink: &[(u32, u32)]) -> Vec<u8> {
        let mut buffer = vec![255u8; (width * height) as usize];
        for &(x, y) in ink {
            buffer[y as usize * width as usize + x as usize] = 0;
        }
        buffer
    }

    #[test]
    fn ink_mask_counts_rows_columns_and_total() {
        // Two words on one line plus a separate line below.
        let ink = [(5, 5), (6, 5), (20, 5), (5, 30), (6, 30)];
        let mask = PageInkMask::from_grayscale(32, 40, &gray_with_ink(32, 40, &ink));
        assert_eq!(mask.total_ink, 5);
        assert_eq!(mask.row_profile[5], 3);
        assert_eq!(mask.row_profile[30], 2);
        assert_eq!(mask.col_profile[5], 2);
        assert_eq!(mask.col_profile[6], 2);
        assert_eq!(mask.col_profile[20], 1);
        assert!(mask.is_inked(5, 5));
        assert!(!mask.is_inked(7, 5));
    }

    #[test]
    fn row_bands_split_on_blank_gaps_and_merge_small_ones() {
        // Contiguous line at y=5..7, own line at y=20; speck at y=9 ignored.
        let mut ink = Vec::new();
        for y in 5..=7 {
            for x in 0..10 {
                ink.push((x, y));
            }
        }
        for x in 0..10 {
            ink.push((x, 20));
        }
        ink.push((50, 9)); // below MIN_INK_RUN_DENSITY=3
        let mask = PageInkMask::from_grayscale(64, 32, &gray_with_ink(64, 32, &ink));
        let strict = mask.row_bands(0);
        assert_eq!(strict.len(), 2);
        assert_eq!((strict[0].y0, strict[0].y1), (5, 7));
        assert_eq!((strict[1].y0, strict[1].y1), (20, 20));

        // y=5..7 and y=20 separated by 12 blank rows: merge_gap 12 fuses them.
        let merged = mask.row_bands(12);
        assert_eq!(merged.len(), 1);
        assert_eq!((merged[0].y0, merged[0].y1), (5, 20));
    }

    #[test]
    fn ink_bounds_use_raw_profiles_including_specks() {
        let mut ink = Vec::new();
        for y in 10..=11 {
            for x in 100..=119 {
                ink.push((x, y));
            }
        }
        ink.push((200, 3)); // single-pixel speck at (200, 3)
        let mask = PageInkMask::from_grayscale(256, 32, &gray_with_ink(256, 32, &ink));
        // Bounds are profile-based, not density-filtered, so the speck
        // extends them; row_bands/density checks are where specks are
        // ignored. The test pins that contract.
        assert_eq!(mask.ink_bounds(), Some((100, 3, 200, 11)));
    }

    #[test]
    fn blank_page_has_no_bounds_and_full_coverage() {
        let mask = PageInkMask::from_grayscale(8, 8, &vec![255u8; 64]);
        assert_eq!(mask.ink_bounds(), None);
        assert!(mask.row_bands(0).is_empty());
        assert_eq!(mask.row_coverage_of(&[]), 1.0);
    }

    #[test]
    fn row_coverage_counts_bands_inside_ranges() {
        let mut ink = Vec::new();
        for y in [5u32, 20, 40] {
            for x in 0..10 {
                ink.push((x, y));
            }
        }
        let mask = PageInkMask::from_grayscale(32, 64, &gray_with_ink(32, 64, &ink));
        // Text occupies bands at y≈5 and y≈20; band at y≈40 is figure ink.
        assert!((mask.row_coverage_of(&[(0.0, 12.0), (15.0, 25.0)]) - 2.0 / 3.0).abs() < 1e-9);
        assert_eq!(mask.row_coverage_of(&[(0.0, 64.0)]), 1.0);
        assert_eq!(mask.row_coverage_of(&[(30.0, 50.0)]), 1.0 / 3.0);
    }
}
