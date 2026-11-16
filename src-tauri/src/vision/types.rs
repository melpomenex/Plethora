//! Core types and `0–1000` normalized coordinate utilities for Mirage Vision Engine.

use serde::{Deserialize, Serialize};

/// Sections that Mirage (`cactus_describe`) can compute in a single pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MirageSection {
    Scene,
    Objects,
    Text,
    Relations,
}

impl MirageSection {
    pub fn as_str(&self) -> &'static str {
        match self {
            MirageSection::Scene => "scene",
            MirageSection::Objects => "objects",
            MirageSection::Text => "text",
            MirageSection::Relations => "relations",
        }
    }
}

/// Request options passed to `cactus_describe`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirageRequestOptions {
    /// Sections to include in inference (default: all four).
    pub sections: Vec<MirageSection>,
    /// Object detection confidence threshold (0.0 - 1.0).
    pub conf: f32,
    /// OCR text detection confidence threshold (0.0 - 1.0).
    pub text_conf: f32,
    /// Mask output format; `"polygons"` returns normalized polygon vertices.
    pub mask_format: String,
}

impl Default for MirageRequestOptions {
    fn default() -> Self {
        Self {
            sections: vec![
                MirageSection::Scene,
                MirageSection::Objects,
                MirageSection::Text,
                MirageSection::Relations,
            ],
            conf: 0.35,
            text_conf: 0.30,
            mask_format: "polygons".to_string(),
        }
    }
}

/// Normalized bounding box `[x1, y1, x2, y2]` in Mirage `0–1000` coordinate space.
pub type NormalizedBBox = [f64; 4];

/// A 2D point `[x, y]` in `0–1000` normalized space (or `0–100` percentage when converted).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point2D {
    pub x: f64,
    pub y: f64,
}

/// Detected object with optional polygon segmentation mask (`mask_format="polygons"`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirageObject {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub confidence: f32,
    /// `[x1, y1, x2, y2]` in `0–1000` scale.
    pub bbox: NormalizedBBox,
    /// Optional attributes (e.g. `["red", "circuit", "handwritten"]`).
    #[serde(default)]
    pub attributes: Vec<String>,
    /// Polygon vertices in `0–1000` scale.
    #[serde(default)]
    pub polygon: Vec<[f64; 2]>,
}

/// Detected OCR text block in `0–1000` normalized coordinate space.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirageTextBlock {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub confidence: f32,
    /// `[x1, y1, x2, y2]` in `0–1000` scale.
    pub bbox: NormalizedBBox,
    #[serde(default)]
    pub polygon: Vec<[f64; 2]>,
}

/// Spatial or semantic relation between two detected entities.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirageRelation {
    pub subject_id: String,
    pub predicate: String,
    pub object_id: String,
    #[serde(default)]
    pub confidence: f32,
}

/// Structured output returned by Mirage inference.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirageResponse {
    #[serde(default)]
    pub scene: String,
    #[serde(default)]
    pub objects: Vec<MirageObject>,
    #[serde(default)]
    pub text: Vec<MirageTextBlock>,
    #[serde(default)]
    pub relations: Vec<MirageRelation>,
    #[serde(default)]
    pub inference_ms: u64,
    #[serde(default)]
    pub image_width: u32,
    #[serde(default)]
    pub image_height: u32,
}

/// Runtime availability and model cache status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirageStatus {
    pub available: bool,
    pub library_loaded: bool,
    pub model_loaded: bool,
    pub model_cached: bool,
    pub model_path: Option<String>,
    pub library_path: Option<String>,
    pub reason: Option<String>,
}

/// Percentage-space rectangle (`0–100`) matching Plethora's `ImageOcclusionRegion`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PercentOcclusionRegion {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub label: Option<String>,
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<Point2D>>,
}

/// Convert a Mirage `0–1000` `[x1, y1, x2, y2]` bbox into `0–100` percentage `(x, y, width, height)`.
pub fn bbox_1000_to_percent(bbox: NormalizedBBox) -> (f64, f64, f64, f64) {
    let x1 = bbox[0].clamp(0.0, 1000.0);
    let y1 = bbox[1].clamp(0.0, 1000.0);
    let x2 = bbox[2].clamp(x1, 1000.0);
    let y2 = bbox[3].clamp(y1, 1000.0);
    (
        x1 / 10.0,
        y1 / 10.0,
        ((x2 - x1) / 10.0).max(0.5),
        ((y2 - y1) / 10.0).max(0.5),
    )
}

/// Convert Mirage `0–1000` polygon vertices into `0–100` percentage `Point2D`s.
pub fn polygon_1000_to_percent(polygon: &[[f64; 2]]) -> Vec<Point2D> {
    polygon
        .iter()
        .map(|pt| Point2D {
            x: pt[0].clamp(0.0, 1000.0) / 10.0,
            y: pt[1].clamp(0.0, 1000.0) / 10.0,
        })
        .collect()
}

/// Convert a Mirage object or text block into a `PercentOcclusionRegion`.
pub fn to_percent_occlusion_region(
    id: impl Into<String>,
    bbox: NormalizedBBox,
    polygon: &[[f64; 2]],
    label: Option<String>,
    color: Option<String>,
) -> PercentOcclusionRegion {
    let (x, y, width, height) = bbox_1000_to_percent(bbox);
    let points = if polygon.len() >= 3 {
        Some(polygon_1000_to_percent(polygon))
    } else {
        None
    };
    PercentOcclusionRegion {
        id: id.into(),
        x,
        y,
        width,
        height,
        label,
        color,
        points,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_1000_bbox_and_polygon_to_percent() {
        let (x, y, w, h) = bbox_1000_to_percent([100.0, 250.0, 600.0, 750.0]);
        assert!((x - 10.0).abs() < 1e-6);
        assert!((y - 25.0).abs() < 1e-6);
        assert!((w - 50.0).abs() < 1e-6);
        assert!((h - 50.0).abs() < 1e-6);

        let pts = polygon_1000_to_percent(&[[100.0, 200.0], [500.0, 200.0], [300.0, 600.0]]);
        assert_eq!(pts.len(), 3);
        assert!((pts[1].x - 50.0).abs() < 1e-6);
        assert!((pts[2].y - 60.0).abs() < 1e-6);
    }
}
