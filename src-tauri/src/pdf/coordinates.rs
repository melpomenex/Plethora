//! Coordinate spaces and the only sanctioned transforms between them (D4).
//!
//! Spaces:
//! - **PDF user space**: origin bottom-left, y up, units are points. All
//!   canonical geometry (`PdfRect`, word/line/block boxes) lives here.
//! - **Raster space**: origin top-left, y down, units are pixels of the
//!   analysis render at `scale` pixels per point with the viewer `rotation`
//!   (0/90/180/270, degrees clockwise) already applied — the same basis a
//!   pdf.js `PageViewport` produces.
//! - **Normalized space**: PDF user space scaled to [0, 1] per axis, for
//!   storage-stable positions independent of page size.
//!
//! Rotation formulas mirror pdf.js `PageViewport` point transforms for a page
//! of user-space size `W × H`:
//!
//! | rotation | viewport →       | pdf point → raster        |
//! |----------|------------------|---------------------------|
//! | 0        | `W·s × H·s`      | `vx = x·s`, `vy = (H−y)·s` |
//! | 90       | `H·s × W·s`      | `vx = y·s`, `vy = x·s`     |
//! | 180      | `W·s × H·s`      | `vx = (W−x)·s`, `vy = y·s` |
//! | 270      | `H·s × W·s`      | `vx = (H−y)·s`, `vy = (W−x)·s` |

use serde::{Deserialize, Serialize};

/// Axis-aligned rectangle in PDF user space. Constructor normalizes corners
/// so `x0 <= x1` and `y0 <= y1` always hold.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfRect {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

impl PdfRect {
    pub fn new(x0: f64, y0: f64, x1: f64, y1: f64) -> Self {
        Self {
            x0: x0.min(x1),
            y0: y0.min(y1),
            x1: x0.max(x1),
            y1: y0.max(y1),
        }
    }

    pub fn width(&self) -> f64 {
        self.x1 - self.x0
    }

    pub fn height(&self) -> f64 {
        self.y1 - self.y0
    }

    pub fn center_x(&self) -> f64 {
        (self.x0 + self.x1) / 2.0
    }

    pub fn center_y(&self) -> f64 {
        (self.y0 + self.y1) / 2.0
    }

    pub fn is_empty(&self) -> bool {
        self.width() <= 0.0 || self.height() <= 0.0
    }

    pub fn contains_point(&self, x: f64, y: f64) -> bool {
        x >= self.x0 && x <= self.x1 && y >= self.y0 && y <= self.y1
    }

    pub fn intersects(&self, other: &PdfRect) -> bool {
        self.x0 <= other.x1 && other.x0 <= self.x1 && self.y0 <= other.y1 && other.y0 <= self.y1
    }

    pub fn overlap_area(&self, other: &PdfRect) -> f64 {
        let w = (self.x1.min(other.x1) - self.x0.max(other.x0)).max(0.0);
        let h = (self.y1.min(other.y1) - self.y0.max(other.y0)).max(0.0);
        w * h
    }

    pub fn union(&self, other: &PdfRect) -> PdfRect {
        PdfRect {
            x0: self.x0.min(other.x0),
            y0: self.y0.min(other.y0),
            x1: self.x1.max(other.x1),
            y1: self.y1.max(other.y1),
        }
    }
}

/// Axis-aligned rectangle in raster space (origin top-left, y down).
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RasterRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// PDF user space scaled to [0, 1] per axis (y measured from the bottom).
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedRect {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

/// Geometry binding a raster to its PDF page: pixel size, pixels-per-point
/// scale, viewer rotation, and the unrotated user-space page size.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RasterGeometry {
    pub width: u32,
    pub height: u32,
    /// Raster pixels per PDF point (> 0).
    pub scale: f64,
    /// 0, 90, 180, or 270 — viewer rotation already baked into the raster.
    pub rotation: u16,
    /// User-space page width in points.
    pub page_width: f64,
    /// User-space page height in points.
    pub page_height: f64,
}

impl RasterGeometry {
    pub fn new(
        width: u32,
        height: u32,
        scale: f64,
        rotation: u16,
        page_width: f64,
        page_height: f64,
    ) -> Self {
        debug_assert!(
            matches!(rotation, 0 | 90 | 180 | 270),
            "rotation must be 0/90/180/270"
        );
        // Finite-guard the float inputs: a NaN page dim or scale would make
        // every coordinate transform produce NaN. `max(f64::NAN, x)` returns
        // x, so clamp explicitly.
        let safe_scale = if scale.is_finite() && scale > 0.0 {
            scale
        } else {
            1.0
        };
        let safe_width = if page_width.is_finite() && page_width > 0.0 {
            page_width
        } else {
            1.0
        };
        let safe_height = if page_height.is_finite() && page_height > 0.0 {
            page_height
        } else {
            1.0
        };
        Self {
            width,
            height,
            scale: safe_scale.max(f64::MIN_POSITIVE),
            rotation: rotation % 360,
            page_width: safe_width,
            page_height: safe_height,
        }
    }

    /// Map a PDF user-space point to raster pixel coordinates.
    pub fn pdf_point_to_raster(&self, x: f64, y: f64) -> (f64, f64) {
        let s = self.scale;
        let (w, h) = (self.page_width, self.page_height);
        match self.rotation {
            90 => (y * s, x * s),
            180 => ((w - x) * s, y * s),
            270 => ((h - y) * s, (w - x) * s),
            _ => (x * s, (h - y) * s),
        }
    }

    /// Map a raster pixel coordinate back to PDF user space (exact inverse of
    /// `pdf_point_to_raster`).
    pub fn raster_point_to_pdf(&self, vx: f64, vy: f64) -> (f64, f64) {
        let s = self.scale;
        let (w, h) = (self.page_width, self.page_height);
        match self.rotation {
            90 => (vy / s, vx / s),
            180 => (w - vx / s, vy / s),
            270 => (w - vy / s, h - vx / s),
            _ => (vx / s, h - vy / s),
        }
    }

    /// Map a PDF rect to a raster rect. Under 90/270 rotation the axes swap,
    /// so the result is built from the transformed min/max rather than
    /// transforming corners directly.
    pub fn pdf_rect_to_raster(&self, rect: &PdfRect) -> RasterRect {
        let (ax, ay) = self.pdf_point_to_raster(rect.x0, rect.y0);
        let (bx, by) = self.pdf_point_to_raster(rect.x1, rect.y1);
        RasterRect {
            x: ax.min(bx),
            y: ay.min(by),
            width: (ax - bx).abs(),
            height: (ay - by).abs(),
        }
    }

    /// Map a raster rect back to PDF user space.
    pub fn raster_rect_to_pdf(&self, rect: &RasterRect) -> PdfRect {
        let (ax, ay) = self.raster_point_to_pdf(rect.x, rect.y);
        let (bx, by) = self.raster_point_to_pdf(rect.x + rect.width, rect.y + rect.height);
        PdfRect::new(ax, ay, bx, by)
    }
}

pub fn pdf_rect_to_normalized(rect: &PdfRect, page_width: f64, page_height: f64) -> NormalizedRect {
    let (w, h) = (
        page_width.max(f64::MIN_POSITIVE),
        page_height.max(f64::MIN_POSITIVE),
    );
    NormalizedRect {
        x0: rect.x0 / w,
        y0: rect.y0 / h,
        x1: rect.x1 / w,
        y1: rect.y1 / h,
    }
}

pub fn normalized_rect_to_pdf(rect: &NormalizedRect, page_width: f64, page_height: f64) -> PdfRect {
    PdfRect {
        x0: rect.x0 * page_width,
        y0: rect.y0 * page_height,
        x1: rect.x1 * page_width,
        y1: rect.y1 * page_height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Letter portrait page at 2 px/pt — comfortably exact in f64.
    const W: f64 = 612.0;
    const H: f64 = 792.0;

    fn geometry(rotation: u16) -> RasterGeometry {
        let s = 2.0;
        let (rw, rh) = match rotation {
            90 | 270 => ((H * s) as u32, (W * s) as u32),
            _ => ((W * s) as u32, (H * s) as u32),
        };
        RasterGeometry::new(rw, rh, s, rotation, W, H)
    }

    #[test]
    fn rect_constructor_normalizes_corners() {
        let rect = PdfRect::new(5.0, 9.0, 1.0, 2.0);
        assert_eq!(
            rect,
            PdfRect {
                x0: 1.0,
                y0: 2.0,
                x1: 5.0,
                y1: 9.0
            }
        );
    }

    #[test]
    fn overlap_and_contains_agree_with_geometry() {
        let a = PdfRect::new(0.0, 0.0, 10.0, 10.0);
        let b = PdfRect::new(5.0, 5.0, 15.0, 15.0);
        assert_eq!(a.overlap_area(&b), 25.0);
        assert!(a.intersects(&b));
        assert!(a.contains_point(5.0, 5.0));
        assert!(!a.contains_point(10.5, 5.0));
        let disjoint = PdfRect::new(20.0, 20.0, 30.0, 30.0);
        assert_eq!(a.overlap_area(&disjoint), 0.0);
        assert!(!a.intersects(&disjoint));
    }

    #[test]
    fn rotation_zero_maps_user_corners_correctly() {
        let g = geometry(0);
        // Bottom-left user corner → raster top-left area (y flips).
        let (vx, vy) = g.pdf_point_to_raster(0.0, H);
        assert_eq!((vx, vy), (0.0, 0.0));
        let (vx, vy) = g.pdf_point_to_raster(0.0, 0.0);
        assert_eq!((vx, vy), (0.0, H * 2.0));
        // Top-right user corner → raster bottom-right.
        let (vx, vy) = g.pdf_point_to_raster(W, H);
        assert_eq!((vx, vy), (W * 2.0, 0.0));
    }

    #[test]
    fn rotation_90_maps_user_corners_correctly() {
        let g = geometry(90);
        // Viewport is H·s wide, W·s tall. Clockwise quarter turn: the page's
        // top-left corner stays display top-left... it maps to display
        // top-right; bottom-left user corner becomes display top-left.
        let (vx, vy) = g.pdf_point_to_raster(0.0, H);
        assert_eq!((vx, vy), (H * 2.0, 0.0));
        let (vx, vy) = g.pdf_point_to_raster(0.0, 0.0);
        assert_eq!((vx, vy), (0.0, 0.0));
    }

    #[test]
    fn rotation_180_maps_user_corners_correctly() {
        let g = geometry(180);
        let (vx, vy) = g.pdf_point_to_raster(0.0, H); // page top-left
        assert_eq!((vx, vy), (W * 2.0, H * 2.0)); // display bottom-right
        let (vx, vy) = g.pdf_point_to_raster(W, H); // page top-right
        assert_eq!((vx, vy), (0.0, H * 2.0));
    }

    #[test]
    fn rotation_270_maps_user_corners_correctly() {
        let g = geometry(270);
        let (vx, vy) = g.pdf_point_to_raster(0.0, H); // page top-left
        assert_eq!((vx, vy), (0.0, W * 2.0)); // display bottom-left
        let (vx, vy) = g.pdf_point_to_raster(W, 0.0); // page bottom-right
        assert_eq!((vx, vy), (H * 2.0, 0.0)); // display top-right
    }

    #[test]
    fn points_round_trip_for_every_rotation() {
        for rotation in [0, 90, 180, 270] {
            let g = geometry(rotation);
            for (x, y) in [(0.0, 0.0), (W, H), (100.5, 333.25), (W - 1.0, 42.0)] {
                let (vx, vy) = g.pdf_point_to_raster(x, y);
                let (rx, ry) = g.raster_point_to_pdf(vx, vy);
                assert!(
                    (rx - x).abs() < 1e-9 && (ry - y).abs() < 1e-9,
                    "round trip failed at rotation {rotation} for ({x}, {y}): ({rx}, {ry})"
                );
            }
        }
    }

    #[test]
    fn rects_round_trip_for_every_rotation() {
        let rect = PdfRect::new(72.0, 96.5, 300.25, 700.0);
        for rotation in [0, 90, 180, 270] {
            let g = geometry(rotation);
            let raster = g.pdf_rect_to_raster(&rect);
            let back = g.raster_rect_to_pdf(&raster);
            assert!(
                (back.x0 - rect.x0).abs() < 1e-9
                    && (back.y0 - rect.y0).abs() < 1e-9
                    && (back.x1 - rect.x1).abs() < 1e-9
                    && (back.y1 - rect.y1).abs() < 1e-9,
                "rect round trip failed at rotation {rotation}: {back:?}"
            );
        }
    }

    #[test]
    fn raster_rect_dimensions_swap_under_quarter_rotation() {
        let rect = PdfRect::new(100.0, 100.0, 200.0, 350.0); // 100 × 250 pt
        let straight = geometry(0).pdf_rect_to_raster(&rect);
        assert_eq!((straight.width, straight.height), (200.0, 500.0));
        let turned = geometry(90).pdf_rect_to_raster(&rect);
        assert_eq!((turned.width, turned.height), (500.0, 200.0));
    }

    #[test]
    fn normalized_rects_round_trip() {
        let rect = PdfRect::new(61.2, 79.2, 306.0, 712.8);
        let normalized = pdf_rect_to_normalized(&rect, W, H);
        let back = normalized_rect_to_pdf(&normalized, W, H);
        assert!((back.x0 - rect.x0).abs() < 1e-9);
        assert!((back.y1 - rect.y1).abs() < 1e-9);
        assert!(normalized.x0 >= 0.0 && normalized.x1 <= 1.0);
        assert!(normalized.y0 >= 0.0 && normalized.y1 <= 1.0);
    }
}
