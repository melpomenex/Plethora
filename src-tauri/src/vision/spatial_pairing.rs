//! Reading-order text sorting and spatial text-to-figure pairing using Mirage
//! `0–1000` normalized bounding boxes and `relations`.

use crate::vision::types::{
    MirageObject, MirageRelation, MirageResponse, MirageTextBlock, NormalizedBBox,
};
use serde::{Deserialize, Serialize};

/// Threshold in `0–1000` normalized coordinate space for pairing a figure/diagram
/// with an adjacent text block when no explicit relation edge exists.
const DEFAULT_PAIRING_DISTANCE_THRESHOLD: f64 = 180.0;

/// A figure/diagram object paired to a text extract.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedFigure {
    pub object_id: String,
    pub label: String,
    pub bbox: NormalizedBBox,
    #[serde(default)]
    pub polygon: Vec<[f64; 2]>,
    pub relation: String,
    pub distance: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cropped_asset_id: Option<String>,
}

/// A reading-order text chunk with any spatially paired figures.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedExtractChunk {
    pub text: String,
    pub bbox: NormalizedBBox,
    pub paired_figures: Vec<PairedFigure>,
}

fn is_figure_label(label: &str) -> bool {
    let lower = label.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "diagram"
            | "chart"
            | "bar chart"
            | "line chart"
            | "pie chart"
            | "figure"
            | "schematic"
            | "circuit"
            | "circuit diagram"
            | "graph"
            | "table"
            | "equation"
            | "formula"
            | "illustration"
            | "map"
            | "callout"
            | "photo"
            | "image"
    ) || lower.contains("diagram")
        || lower.contains("chart")
        || lower.contains("figure")
        || lower.contains("schematic")
        || lower.contains("circuit")
}

/// Compute minimum edge-to-edge Euclidean distance between two `0–1000` bounding boxes.
/// Overlapping boxes have distance `0.0`.
pub fn bbox_edge_distance(a: NormalizedBBox, b: NormalizedBBox) -> f64 {
    let dx = if a[2] < b[0] {
        b[0] - a[2]
    } else if b[2] < a[0] {
        a[0] - b[2]
    } else {
        0.0
    };
    let dy = if a[3] < b[1] {
        b[1] - a[3]
    } else if b[3] < a[1] {
        a[1] - b[3]
    } else {
        0.0
    };
    (dx * dx + dy * dy).sqrt()
}

/// Sort Mirage OCR text blocks into top-to-bottom, left-to-right reading order.
/// Blocks whose vertical centers are within half of the average line height are
/// grouped onto the same visual line and ordered left-to-right.
pub fn sort_text_reading_order(blocks: &[MirageTextBlock]) -> Vec<MirageTextBlock> {
    if blocks.is_empty() {
        return Vec::new();
    }
    let mut sorted = blocks.to_vec();
    let avg_height = sorted
        .iter()
        .map(|b| (b.bbox[3] - b.bbox[1]).abs().max(8.0))
        .sum::<f64>()
        / sorted.len() as f64;
    let line_tolerance = (avg_height * 0.55).max(12.0);

    // First sort by top y coordinate
    sorted.sort_by(|a, b| {
        a.bbox[1]
            .partial_cmp(&b.bbox[1])
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Group into lines and sort each line by x1
    let mut lines: Vec<Vec<MirageTextBlock>> = Vec::new();
    for block in sorted {
        let cy = (block.bbox[1] + block.bbox[3]) * 0.5;
        if let Some(last_line) = lines.last_mut() {
            let line_cy = last_line
                .iter()
                .map(|b| (b.bbox[1] + b.bbox[3]) * 0.5)
                .sum::<f64>()
                / last_line.len() as f64;
            if (cy - line_cy).abs() <= line_tolerance {
                last_line.push(block);
                continue;
            }
        }
        lines.push(vec![block]);
    }

    let mut result = Vec::with_capacity(blocks.len());
    for mut line in lines {
        line.sort_by(|a, b| {
            a.bbox[0]
                .partial_cmp(&b.bbox[0])
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        result.extend(line);
    }
    result
}

/// Pair reading-order text blocks with nearby or relation-linked figure objects.
pub fn pair_text_and_figures(response: &MirageResponse) -> Vec<PairedExtractChunk> {
    let ordered_text = sort_text_reading_order(&response.text);
    let figure_objects: Vec<&MirageObject> = response
        .objects
        .iter()
        .filter(|obj| is_figure_label(&obj.label) || !obj.polygon.is_empty())
        .collect();

    ordered_text
        .into_iter()
        .map(|tb| {
            let mut paired = Vec::new();
            for obj in &figure_objects {
                let rel_match = response.relations.iter().find(|r| {
                    (r.subject_id == tb.id && r.object_id == obj.id)
                        || (r.object_id == tb.id && r.subject_id == obj.id)
                });
                let dist = bbox_edge_distance(tb.bbox, obj.bbox);
                if let Some(rel) = rel_match {
                    paired.push(PairedFigure {
                        object_id: obj.id.clone(),
                        label: obj.label.clone(),
                        bbox: obj.bbox,
                        polygon: obj.polygon.clone(),
                        relation: rel.predicate.clone(),
                        distance: dist,
                        cropped_asset_id: None,
                    });
                } else if dist <= DEFAULT_PAIRING_DISTANCE_THRESHOLD {
                    paired.push(PairedFigure {
                        object_id: obj.id.clone(),
                        label: obj.label.clone(),
                        bbox: obj.bbox,
                        polygon: obj.polygon.clone(),
                        relation: "near".to_string(),
                        distance: dist,
                        cropped_asset_id: None,
                    });
                }
            }
            paired.sort_by(|a, b| {
                a.distance
                    .partial_cmp(&b.distance)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            PairedExtractChunk {
                text: tb.text,
                bbox: tb.bbox,
                paired_figures: paired,
            }
        })
        .collect()
}

/// Join reading-order text blocks into clean prose paragraphs.
pub fn join_reading_order_text(blocks: &[MirageTextBlock]) -> String {
    sort_text_reading_order(blocks)
        .into_iter()
        .map(|b| b.text.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_out_of_order_text_into_reading_order() {
        let blocks = vec![
            MirageTextBlock {
                id: "t3".into(),
                text: "Second line".into(),
                confidence: 0.95,
                bbox: [100.0, 220.0, 400.0, 260.0],
                polygon: vec![],
            },
            MirageTextBlock {
                id: "t2".into(),
                text: "world".into(),
                confidence: 0.95,
                bbox: [260.0, 102.0, 420.0, 142.0],
                polygon: vec![],
            },
            MirageTextBlock {
                id: "t1".into(),
                text: "Hello".into(),
                confidence: 0.96,
                bbox: [100.0, 100.0, 240.0, 140.0],
                polygon: vec![],
            },
        ];

        let sorted = sort_text_reading_order(&blocks);
        let texts: Vec<&str> = sorted.iter().map(|b| b.text.as_str()).collect();
        assert_eq!(texts, vec!["Hello", "world", "Second line"]);
    }

    #[test]
    fn pairs_nearby_diagram_with_adjacent_text() {
        let resp = MirageResponse {
            scene: "Textbook page with circuit diagram".into(),
            text: vec![MirageTextBlock {
                id: "t1".into(),
                text: "Figure 1 shows an RC low-pass filter.".into(),
                confidence: 0.94,
                bbox: [80.0, 420.0, 500.0, 480.0],
                polygon: vec![],
            }],
            objects: vec![
                MirageObject {
                    id: "obj1".into(),
                    label: "circuit diagram".into(),
                    confidence: 0.91,
                    bbox: [80.0, 100.0, 500.0, 380.0],
                    attributes: vec!["red".into()],
                    polygon: vec![[80.0, 100.0], [500.0, 100.0], [500.0, 380.0], [80.0, 380.0]],
                },
                MirageObject {
                    id: "obj2".into(),
                    label: "chart".into(),
                    confidence: 0.88,
                    bbox: [800.0, 800.0, 980.0, 980.0],
                    attributes: vec![],
                    polygon: vec![],
                },
            ],
            relations: vec![MirageRelation {
                subject_id: "t1".into(),
                predicate: "describes".into(),
                object_id: "obj1".into(),
                confidence: 0.89,
            }],
            inference_ms: 85,
            image_width: 1000,
            image_height: 1000,
        };

        let paired = pair_text_and_figures(&resp);
        assert_eq!(paired.len(), 1);
        assert_eq!(paired[0].paired_figures.len(), 1);
        assert_eq!(paired[0].paired_figures[0].object_id, "obj1");
        assert_eq!(paired[0].paired_figures[0].relation, "describes");
    }
}
