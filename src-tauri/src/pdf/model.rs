//! Canonical PDF content model (schema v2, engine `rust-hybrid-v3`).
//!
//! Field names serialize to camelCase to mirror the TypeScript types in
//! `src/types/pdfCanonical.ts`. Fields added by later analysis phases use
//! `#[serde(default)]` so page JSON written by older engine versions still
//! deserializes (the cache key already isolates engine versions; this keeps
//! in-flight upgrades from hard-failing reads).

use serde::{Deserialize, Serialize};

use super::coordinates::PdfRect;

pub const PDF_CANONICAL_SCHEMA_VERSION: u32 = 2;
// v3 (from v2): figure-geometry overhaul — rotation-aware detection/crop
// basis and stricter visual-block bbox validation changed block geometry
// output materially, so v2-keyed page caches must not survive the upgrade
// (the cache key derives from identity|schema|engine, so stale entries
// become unreachable automatically).
pub const PDF_CANONICAL_ENGINE_VERSION: &str = "rust-hybrid-v3";

/// Where a word's text came from. Born-digital pages must stay
/// `NativePdfText` — OCR is never invoked for text native extraction handles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PdfWordSource {
    NativePdfText,
    Ocr,
    Graphical,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfFontInfo {
    /// Font size in PDF user-space points.
    pub size: f64,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    /// Raw pdf.js font name (an internal identifier, not a display name).
    #[serde(default)]
    pub family: Option<String>,
}

/// One word with exact text and its source geometry in PDF user space
/// (origin bottom-left, y up). `source_bbox` is the union; `source_fragments`
/// keeps the per-piece boxes when a word was assembled from disjoint pieces
/// (de-hyphenation across a line break).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfCanonicalWord {
    /// `p{page}:w{index}` — deterministic for a fixed engine version (D3).
    pub id: String,
    /// 1-based page number, matching the app-wide convention.
    pub page_number: u32,
    pub text: String,
    pub source_bbox: PdfRect,
    #[serde(default)]
    pub source_fragments: Vec<PdfRect>,
    /// False when the bbox was interpolated proportionally along a pdf.js
    /// text item rather than measured per glyph (D6).
    #[serde(default)]
    pub bbox_exact: bool,
    pub reading_order: u32,
    pub confidence: f32,
    pub source: PdfWordSource,
    #[serde(default)]
    pub dehyphenated: bool,
    #[serde(default)]
    pub font: Option<PdfFontInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfCanonicalLine {
    /// `p{page}:l{index}`.
    pub id: String,
    pub word_ids: Vec<String>,
    pub bbox: PdfRect,
    /// Baseline y in PDF user space; lines within a column band on this.
    pub baseline_y: f64,
    pub reading_order: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PdfCanonicalBlockKind {
    Heading,
    Paragraph,
    List,
    Table,
    Figure,
    Caption,
    Footnote,
    Equation,
    Code,
    Quote,
    Sidebar,
    HorizontalRule,
    PageBreak,
    UnknownVisual,
}

/// Marginal elements are classified, never deleted: they stay in the model
/// and in the Original view, and are suppressed only in reflow rendering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PdfCanonicalRole {
    Body,
    Header,
    Footer,
    PageNumber,
}

impl Default for PdfCanonicalRole {
    fn default() -> Self {
        Self::Body
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PdfCanonicalDirection {
    Ltr,
    Rtl,
    Auto,
}

impl Default for PdfCanonicalDirection {
    fn default() -> Self {
        Self::Auto
    }
}

/// A region of the original document: page plus rectangle in PDF user space.
/// Blocks may carry several regions (multi-column paragraphs, page-spanning
/// content, graphical crops assembled from disjoint pieces).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfSourceRegion {
    /// 1-based page number.
    pub page_number: u32,
    pub bbox: PdfRect,
}

/// Structurally parsed table content. Only populated when ruling-line or
/// column-alignment confidence is high; otherwise the block renders as a
/// source crop and `rows` stays empty.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfTableData {
    pub rows: Vec<Vec<String>>,
    #[serde(default)]
    pub header_row: Option<u32>,
    #[serde(default)]
    pub ruled: bool,
}

/// A logical content block. Text blocks reference their canonical words;
/// visual blocks (figure/equation/table-crop) reference a cached source
/// asset and may carry `alt_text` for search/TTS/AI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfCanonicalBlock {
    /// `p{page}:b{index}` — index in deterministic analysis output order.
    pub id: String,
    pub kind: PdfCanonicalBlockKind,
    #[serde(default)]
    pub role: PdfCanonicalRole,
    pub page_number: u32,
    pub source_regions: Vec<PdfSourceRegion>,
    pub word_ids: Vec<String>,
    #[serde(default)]
    pub line_ids: Vec<String>,
    pub reading_order: u32,
    pub confidence: f32,
    /// Exact canonical text ("" for purely visual blocks).
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub direction: PdfCanonicalDirection,
    #[serde(default)]
    pub language: Option<String>,
    /// List items (`kind == "list"`).
    #[serde(default)]
    pub items: Option<Vec<String>>,
    #[serde(default)]
    pub table: Option<PdfTableData>,
    /// Cached source-crop asset (`figure`, `equation`, low-confidence crops).
    #[serde(default)]
    pub asset_id: Option<String>,
    /// Intrinsic pixel size of the cached source crop (visual blocks), used
    /// by the reflow renderer to reserve layout space before the asset
    /// loads. None for text blocks and pages cached before the field
    /// existed; serialization skips None so old payloads stay byte-shaped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_height: Option<u32>,
    /// Textual fallback for visual blocks; searchable and TTS-readable but
    /// never rendered as flowing reflow text.
    #[serde(default)]
    pub alt_text: Option<String>,
    /// Caption blocks link to the figure they describe.
    #[serde(default)]
    pub caption_of: Option<String>,
    #[serde(default)]
    pub href: Option<String>,
    /// How this block's text was obtained.
    #[serde(default = "default_word_source")]
    pub extraction: PdfWordSource,
}

fn default_word_source() -> PdfWordSource {
    PdfWordSource::NativePdfText
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PdfCanonicalPageState {
    Pending,
    Processing,
    Ready,
    OcrRequired,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PdfCanonicalClassification {
    Semantic,
    SemanticWithWarnings,
    OcrRequired,
    FixedLayoutRecommended,
}

/// The canonical per-page model. Words/lines/blocks are stored flat in
/// analysis output order; consumers index by id when they need random access.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfCanonicalPage {
    /// 1-based page number.
    pub page_number: u32,
    /// PDF user-space page dimensions in points (before rotation).
    pub width: f64,
    pub height: f64,
    /// 0/90/180/270 viewport rotation the analysis raster was rendered with.
    #[serde(default)]
    pub rotation: u16,
    pub state: PdfCanonicalPageState,
    pub classification: PdfCanonicalClassification,
    pub confidence: f32,
    /// Fraction of ink-covered content accounted for by native text.
    #[serde(default)]
    pub text_coverage: f32,
    #[serde(default)]
    pub words: Vec<PdfCanonicalWord>,
    #[serde(default)]
    pub lines: Vec<PdfCanonicalLine>,
    #[serde(default)]
    pub blocks: Vec<PdfCanonicalBlock>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub error_category: Option<String>,
    /// Stamped per page so a cached file is self-describing.
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default = "default_engine_version")]
    pub engine_version: String,
}

fn default_schema_version() -> u32 {
    PDF_CANONICAL_SCHEMA_VERSION
}

fn default_engine_version() -> String {
    PDF_CANONICAL_ENGINE_VERSION.to_string()
}

pub fn word_id(page_number: u32, index: u32) -> String {
    format!("p{page_number}:w{index}")
}

pub fn line_id(page_number: u32, index: u32) -> String {
    format!("p{page_number}:l{index}")
}

pub fn block_id(page_number: u32, index: u32) -> String {
    format!("p{page_number}:b{index}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_use_the_deterministic_page_scoped_scheme() {
        assert_eq!(word_id(237, 4), "p237:w4");
        assert_eq!(line_id(2, 0), "p2:l0");
        assert_eq!(block_id(19, 88), "p19:b88");
    }

    #[test]
    fn enums_serialize_to_the_typescript_vocabulary() {
        assert_eq!(
            serde_json::to_string(&PdfWordSource::NativePdfText).unwrap(),
            "\"native-pdf-text\""
        );
        assert_eq!(
            serde_json::to_string(&PdfCanonicalBlockKind::UnknownVisual).unwrap(),
            "\"unknown-visual\""
        );
        assert_eq!(
            serde_json::to_string(&PdfCanonicalRole::PageNumber).unwrap(),
            "\"page-number\""
        );
        assert_eq!(
            serde_json::to_string(&PdfCanonicalClassification::FixedLayoutRecommended).unwrap(),
            "\"fixed-layout-recommended\""
        );
    }

    #[test]
    fn page_json_round_trips_with_camel_case_fields() {
        let page = PdfCanonicalPage {
            page_number: 3,
            width: 612.0,
            height: 792.0,
            rotation: 0,
            state: PdfCanonicalPageState::Ready,
            classification: PdfCanonicalClassification::Semantic,
            confidence: 0.97,
            text_coverage: 0.91,
            words: vec![PdfCanonicalWord {
                id: word_id(3, 0),
                page_number: 3,
                text: "international".into(),
                source_bbox: PdfRect::new(100.0, 700.0, 140.0, 712.0),
                source_fragments: vec![
                    PdfRect::new(100.0, 700.0, 118.0, 712.0),
                    PdfRect::new(60.0, 688.0, 82.0, 700.0),
                ],
                bbox_exact: false,
                reading_order: 0,
                confidence: 1.0,
                source: PdfWordSource::NativePdfText,
                dehyphenated: true,
                font: Some(PdfFontInfo {
                    size: 11.0,
                    bold: false,
                    italic: false,
                    family: Some("g_d0_f1".into()),
                }),
            }],
            lines: vec![],
            blocks: vec![PdfCanonicalBlock {
                id: block_id(3, 0),
                kind: PdfCanonicalBlockKind::Paragraph,
                role: PdfCanonicalRole::Body,
                page_number: 3,
                source_regions: vec![PdfSourceRegion {
                    page_number: 3,
                    bbox: PdfRect::new(100.0, 688.0, 140.0, 712.0),
                }],
                word_ids: vec![word_id(3, 0)],
                line_ids: vec![],
                reading_order: 0,
                confidence: 0.95,
                text: "international".into(),
                direction: PdfCanonicalDirection::Ltr,
                language: None,
                items: None,
                table: None,
                asset_id: None,
                source_width: None,
                source_height: None,
                alt_text: None,
                caption_of: None,
                href: None,
                extraction: PdfWordSource::NativePdfText,
            }],
            warnings: vec![],
            error_category: None,
            schema_version: PDF_CANONICAL_SCHEMA_VERSION,
            engine_version: PDF_CANONICAL_ENGINE_VERSION.into(),
        };
        let json = serde_json::to_string(&page).unwrap();
        assert!(json.contains("\"pageNumber\":3"));
        assert!(json.contains("\"sourceBbox\""));
        let parsed: PdfCanonicalPage = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, page);
    }

    /// The golden fixture is shared with the TypeScript parity test
    /// (`src/types/__tests__/pdfCanonical.test.ts`): this side pins the serde
    /// field names/vocabulary, that side pins the TS mirror. A Value-equality
    /// round trip fails when the fixture carries keys the Rust struct dropped
    /// or lacks keys the struct now emits — exactly the drift we want caught.
    #[test]
    fn golden_fixture_round_trips_exactly() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/pdf-reflow/golden-page-v2.json");
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read golden fixture {}: {error}", path.display()));
        let page: PdfCanonicalPage = serde_json::from_str(&raw).unwrap();
        assert_eq!(page.page_number, 237);
        assert_eq!(page.words.len(), 2);
        assert_eq!(page.blocks.len(), 2);
        let output = serde_json::to_value(&page).unwrap();
        let expected: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(output, expected, "golden fixture and serde output drifted");
    }

    /// Figure intrinsic dims are optional: present blocks round trip them,
    /// absent blocks (older cache entries, text blocks) serialize without
    /// the keys so the payload shape is stable across the field's rollout.
    #[test]
    fn source_dims_serialize_only_when_present() {
        let mut block = PdfCanonicalBlock {
            id: block_id(1, 0),
            kind: PdfCanonicalBlockKind::Figure,
            role: PdfCanonicalRole::Body,
            page_number: 1,
            source_regions: vec![PdfSourceRegion {
                page_number: 1,
                bbox: PdfRect::new(105.0, 400.0, 510.0, 583.0),
            }],
            word_ids: vec![],
            line_ids: vec![],
            reading_order: 0,
            confidence: 0.5,
            text: String::new(),
            direction: PdfCanonicalDirection::Auto,
            language: None,
            items: None,
            table: None,
            asset_id: Some("f00f".into()),
            source_width: Some(818),
            source_height: Some(374),
            alt_text: None,
            caption_of: None,
            href: None,
            extraction: PdfWordSource::Graphical,
        };
        let json = serde_json::to_string(&block).unwrap();
        assert!(json.contains("\"sourceWidth\":818"));
        assert!(json.contains("\"sourceHeight\":374"));
        let parsed: PdfCanonicalBlock = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, block);
        block.source_width = None;
        block.source_height = None;
        let none_json = serde_json::to_string(&block).unwrap();
        assert!(!none_json.contains("sourceWidth"));
        assert!(!none_json.contains("sourceHeight"));
    }

    #[test]
    fn block_deserialization_tolerates_missing_later_phase_fields() {
        // Minimal payload a first engine version might have written: only the
        // fields that existed at schema introduction.
        let json = r#"{
            "pageNumber": 1,
            "width": 612.0,
            "height": 792.0,
            "state": "ready",
            "classification": "semantic",
            "confidence": 0.9,
            "words": [],
            "lines": [],
            "blocks": [{
                "id": "p1:b0",
                "kind": "paragraph",
                "pageNumber": 1,
                "sourceRegions": [],
                "wordIds": [],
                "readingOrder": 0,
                "confidence": 0.9
            }]
        }"#;
        let page: PdfCanonicalPage = serde_json::from_str(json).unwrap();
        let block = &page.blocks[0];
        assert_eq!(block.role, PdfCanonicalRole::Body);
        assert_eq!(block.extraction, PdfWordSource::NativePdfText);
        assert_eq!(page.schema_version, PDF_CANONICAL_SCHEMA_VERSION);
        assert_eq!(page.engine_version, PDF_CANONICAL_ENGINE_VERSION);
    }
}
