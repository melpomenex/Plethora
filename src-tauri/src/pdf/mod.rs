//! Canonical PDF content model and reflow analysis.
//!
//! The canonical model is the single source of truth shared by the Original
//! PDF view, the Reflow view, selection/highlight resolution, extracts, TTS,
//! search, and AI context (change `add-pdf-reflow`, design D2). Pages are
//! produced by hybrid analysis (`analysis`) — a rendered-page raster provides
//! visual organization while native pdf.js text items provide exact content —
//! and persisted through the versioned cache (`cache`).

pub mod analysis;
pub mod cache;
pub mod coordinates;
pub mod fallback;
pub mod model;
pub mod ocr;
pub mod selection;

pub use model::{
    PdfCanonicalBlock, PdfCanonicalBlockKind, PdfCanonicalClassification, PdfCanonicalDirection,
    PdfCanonicalLine, PdfCanonicalPage, PdfCanonicalPageState, PdfCanonicalRole, PdfCanonicalWord,
    PdfFontInfo, PdfSourceRegion, PdfTableData, PdfWordSource, PDF_CANONICAL_ENGINE_VERSION,
    PDF_CANONICAL_SCHEMA_VERSION,
};
