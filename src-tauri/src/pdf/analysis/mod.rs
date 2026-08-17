//! Hybrid page analysis orchestrator (D1/D5/D6): raster + native text items
//! in, canonical page model out. Pure and deterministic — the command layer
//! only handles IPC, decoding, and worker bounds.
//!
//! Pipeline: words → columns (whitespace gutters) → per-column line banding
//! → reading-order sequencing (spanning lines, then columns left-to-right)
//! → marginal classification → paragraph groups → typed blocks → canonical
//! assembly with deterministic IDs.

pub mod blocks;
pub mod columns;
pub mod content_bounds;
pub mod equations;
pub mod figures;
pub mod headers_footers;
pub mod paragraphs;
pub mod raster;
pub mod reading_order;
pub mod rows;
pub mod tables;
pub mod words;

pub use crate::pdf::coordinates::{self, PdfRect};
pub use raster::{PageInkMask, PageRaster};
pub use words::TextItemInput;

use crate::error::{IncrementumError, Result};
use crate::pdf::model::{
    self, PdfCanonicalBlock, PdfCanonicalBlockKind, PdfCanonicalClassification,
    PdfCanonicalDirection, PdfCanonicalLine, PdfCanonicalPage, PdfCanonicalPageState,
    PdfCanonicalRole, PdfCanonicalWord, PdfSourceRegion, PdfWordSource,
    PDF_CANONICAL_ENGINE_VERSION, PDF_CANONICAL_SCHEMA_VERSION,
};

use blocks::{classify_group, join_block_text, WordRef};
use columns::{assign_words_to_columns, detect_columns, sequence_lines, SequencedLine};
use content_bounds::content_bounds;
use equations::is_equation_line;
use figures::{attach_captions, detect_visual_regions};
use headers_footers::{classify_marginal_line, MarginalRole, MARGINAL_ZONE_FRACTION};
use paragraphs::group_paragraphs;
use reading_order::assign_word_and_line_order;
use rows::{band_lines, line_raster_ranges, lines_without_ink, RawLine};
use tables::detect_ruled_table;
use words::{extract_words, RawWord};

/// Native-text coverage at or above this is "clean semantic".
const COVERAGE_SEMANTIC: f32 = 0.85;

/// Footnote body size relative to the page body font.
const FOOTNOTE_SIZE_RATIO: f64 = 0.9;

/// Bottom fraction of the content area where small type is footnote-like.
const FOOTNOTE_ZONE_FRACTION: f64 = 0.3;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageAnalysisRequest {
    pub page_number: u32,
    /// PDF user-space page size in points (before rotation).
    pub page_width: f64,
    pub page_height: f64,
    /// 0/90/180/270 viewer rotation of the raster.
    #[serde(default)]
    pub rotation: u16,
    /// Decoded analysis raster (PNG bytes), when the frontend produced one.
    #[serde(skip)]
    pub raster_png: Option<Vec<u8>>,
    /// Raster pixels per PDF point; required with `raster_png`.
    #[serde(default)]
    pub raster_scale: f64,
    pub text_items: Vec<TextItemInput>,
    /// Marginal-zone texts from already-analyzed neighbor pages (±1..3),
    /// supplied by the scheduler for header/footer recurrence (task 5.3).
    #[serde(default)]
    pub marginal_context: Vec<String>,
}

enum WordFate {
    /// Raw word became canonical word `canonical_index`.
    Own(usize),
    /// Raw word is the left fragment of merged word `canonical_index`.
    MergedStart(usize),
    /// Raw word was consumed by a merge into another canonical word.
    MergedAway,
}

/// One paragraph group assembled for block creation.
struct DraftGroup {
    /// Indices into the sequenced line list.
    sequenced_indices: Vec<usize>,
    /// Marginal role when the group is a classified header/footer/page-number.
    marginal: Option<(MarginalRole, bool)>,
    footnote: bool,
    /// Single math-signal line isolated as a display equation (task 6.3).
    equation: bool,
}

pub fn analyze_page(request: &PageAnalysisRequest) -> Result<PdfCanonicalPage> {
    if request.page_number == 0 {
        return Err(IncrementumError::InvalidInput(
            "PDF page numbers start at 1".into(),
        ));
    }
    let raster = match (&request.raster_png, request.raster_scale) {
        (Some(png), scale) if scale > 0.0 => Some(PageRaster::from_png(
            png,
            scale,
            request.rotation,
            request.page_width,
            request.page_height,
        )?),
        (Some(_), _) => {
            return Err(IncrementumError::InvalidInput(
                "rasterScale must be positive when a raster is supplied".into(),
            ));
        }
        (None, _) => None,
    };

    let mut warnings: Vec<String> = Vec::new();
    let raw_words = extract_words(&request.text_items);
    if raster.is_none() {
        warnings.push("no-raster".into());
    }

    // --- Columns and banding (tasks 5.1/5.2) ---
    let mut height_samples: Vec<f64> = raw_words.iter().map(|word| word.bbox.height()).collect();
    height_samples.sort_by(|a, b| a.total_cmp(b));
    let median_word_height = height_samples
        .get(height_samples.len() / 2)
        .copied()
        .unwrap_or(10.0);
    // Ink bounds when a raster exists; otherwise the union of word boxes so
    // marginal/footnote zones still work on text-only analysis.
    let bounds = content_bounds(raster.as_ref()).or_else(|| {
        raw_words
            .iter()
            .map(|word| word.bbox)
            .reduce(|acc, bbox| acc.union(&bbox))
    });
    let column_regions = detect_columns(
        raster.as_ref(),
        bounds,
        median_word_height,
        Some(&raw_words),
    );
    let assignment = assign_words_to_columns(&raw_words, &column_regions);

    let spanning_subset: Vec<(usize, &RawWord)> = assignment
        .spanning_word_indices
        .iter()
        .map(|&index| (index, &raw_words[index]))
        .collect();
    let spanning_lines = band_subset(&spanning_subset);
    let mut per_column_lines: Vec<Vec<RawLine>> = Vec::with_capacity(column_regions.len());
    for column_index in 0..column_regions.len() {
        let subset: Vec<(usize, &RawWord)> = raw_words
            .iter()
            .enumerate()
            .filter(|(index, _)| assignment.word_column[*index] == Some(column_index))
            .map(|(index, word)| (index, word))
            .collect();
        per_column_lines.push(band_subset(&subset));
    }
    let sequenced = sequence_lines(spanning_lines, per_column_lines);

    // Ink cross-checks and coverage inputs over every banded line.
    let all_lines: Vec<RawLine> = sequenced.iter().map(|entry| entry.line.clone()).collect();
    if let Some(raster) = &raster {
        let inkless = lines_without_ink(&all_lines, raster);
        if !inkless.is_empty() {
            warnings.push(format!("{}-lines-without-ink", inkless.len()));
        }
    }

    // --- Marginal classification (task 5.3) ---
    let zone = marginal_zone(bounds);
    let word_text = |line: &RawLine| -> String {
        line.word_indices
            .iter()
            .map(|&index| raw_words[index].text.clone())
            .collect::<Vec<_>>()
            .join(" ")
    };
    let equation_lines: Vec<bool> = sequenced
        .iter()
        .map(|entry| is_equation_line(&entry.line, &raw_words))
        .collect();
    let line_roles: Vec<Option<(MarginalRole, bool)>> = sequenced
        .iter()
        .map(|entry| {
            let center_y = entry.line.bbox.center_y();
            let Some((top_y, bottom_y)) = zone else {
                return None;
            };
            let is_top = if center_y >= top_y {
                true
            } else if center_y <= bottom_y {
                false
            } else {
                return None;
            };
            classify_marginal_line(&word_text(&entry.line), is_top, &request.marginal_context)
                .map(|role| (role, is_top))
        })
        .collect();

    // --- Paragraph grouping per (column, stretch) run (tasks 5.2/5.5) ---
    let body_font_size = median_line_height(&all_lines);
    let mut draft_groups: Vec<DraftGroup> = Vec::new();
    {
        let mut current: Vec<usize> = Vec::new();
        let mut current_key: Option<(Option<usize>, usize)> = None;
        for (index, entry) in sequenced.iter().enumerate() {
            let key = (entry.column, entry.stretch);
            let marginal = line_roles[index];
            let equation = equation_lines[index];
            let previous_breaks = current
                .last()
                .map(|&last| line_roles[last].is_some() || equation_lines[last])
                .unwrap_or(false);
            let key_changed = current_key.is_some_and(|previous| previous != key);
            if !current.is_empty()
                && (key_changed || previous_breaks || marginal.is_some() || equation)
            {
                draft_groups.push(close_group(
                    &current,
                    &line_roles,
                    &equation_lines,
                    &sequenced,
                ));
                current.clear();
            }
            current_key = Some(key);
            current.push(index);
        }
        if !current.is_empty() {
            draft_groups.push(close_group(
                &current,
                &line_roles,
                &equation_lines,
                &sequenced,
            ));
        }
    }

    // --- Blocks in reading order ---
    let mut drafts = Vec::new();
    for group in &draft_groups {
        let group_lines: Vec<&RawLine> = group
            .sequenced_indices
            .iter()
            .map(|&index| &sequenced[index].line)
            .collect();
        let owned_lines: Vec<RawLine> = group_lines.iter().map(|line| (*line).clone()).collect();
        let sub_groups = group_paragraphs(&owned_lines);
        for sub_group in sub_groups {
            let sub_lines: Vec<&RawLine> = sub_group
                .line_indices
                .iter()
                .map(|&line_index| group_lines[line_index])
                .collect();
            let mut draft = classify_group(&sub_lines, &raw_words, body_font_size);
            // Display equations: single math-signal lines (task 6.3); text
            // becomes alt_text, rendering stays a visual crop.
            if group.equation
                || (sub_lines.len() == 1 && is_equation_line(sub_lines[0], &raw_words))
            {
                draft.kind = PdfCanonicalBlockKind::Equation;
            }
            let footnote = group.marginal.is_none()
                && matches!(
                    draft.kind,
                    PdfCanonicalBlockKind::Paragraph | PdfCanonicalBlockKind::List
                )
                && is_footnote_group(&sub_lines, bounds, body_font_size);
            if footnote {
                draft.kind = PdfCanonicalBlockKind::Footnote;
            }
            let sequenced_indices: Vec<usize> = sub_group
                .line_indices
                .iter()
                .map(|&line_index| group.sequenced_indices[line_index])
                .collect();
            drafts.push((
                DraftGroup {
                    sequenced_indices,
                    marginal: group.marginal,
                    footnote,
                    equation: group.equation,
                },
                draft,
            ));
        }
    }

    // --- Canonical words in reading order ---
    let mut canonical_words: Vec<PdfCanonicalWord> = Vec::new();
    let mut fate: Vec<Option<usize>> = vec![None; raw_words.len()]; // canonical index; merged-away marked below
    let mut merged_away: Vec<bool> = vec![false; raw_words.len()];
    for (_, draft) in &drafts {
        for word_ref in &draft.word_refs {
            match *word_ref {
                WordRef::Word(index) => {
                    let raw = &raw_words[index];
                    canonical_words.push(raw_to_canonical(
                        request.page_number,
                        raw,
                        vec![raw.bbox],
                        false,
                    ));
                    fate[index] = Some(canonical_words.len() - 1);
                }
                WordRef::Merged(left, right, ref text) => {
                    let l = &raw_words[left];
                    let r = &raw_words[right];
                    let mut merged =
                        raw_to_canonical(request.page_number, l, vec![l.bbox, r.bbox], true);
                    merged.text = text.clone();
                    canonical_words.push(merged);
                    fate[left] = Some(canonical_words.len() - 1);
                    merged_away[right] = true;
                }
            }
        }
    }
    for (index, word) in canonical_words.iter_mut().enumerate() {
        word.id = model::word_id(request.page_number, index as u32);
    }

    // --- Canonical lines in reading order ---
    // (merged words anchor at their left fragment's line)
    let mut canonical_lines: Vec<PdfCanonicalLine> = Vec::with_capacity(sequenced.len());
    for entry in &sequenced {
        let mut word_ids = Vec::new();
        for &word_index in &entry.line.word_indices {
            if merged_away[word_index] {
                continue;
            }
            if let Some(ci) = fate[word_index] {
                word_ids.push(canonical_words[ci].id.clone());
            }
        }
        canonical_lines.push(PdfCanonicalLine {
            id: String::new(),
            word_ids,
            bbox: entry.line.bbox,
            baseline_y: entry.line.baseline_y,
            reading_order: 0,
        });
    }
    let word_ids_per_line: Vec<Vec<String>> = canonical_lines
        .iter()
        .map(|line| line.word_ids.clone())
        .collect();
    let mut words_mut = canonical_words;
    assign_word_and_line_order(
        request.page_number,
        &mut canonical_lines,
        &word_ids_per_line,
        &mut words_mut,
    );

    // --- Blocks ---
    let mut canonical_blocks: Vec<PdfCanonicalBlock> = drafts
        .iter()
        .enumerate()
        .map(|(block_index, (group, draft))| {
            let mut text = join_block_text(&draft.word_texts);
            // Equations keep their glyph text as alt_text only (task 6.3).
            let alt_text = if draft.kind == PdfCanonicalBlockKind::Equation {
                Some(std::mem::take(&mut text))
            } else {
                None
            };
            let items = if draft.kind == PdfCanonicalBlockKind::List {
                let group_lines: Vec<&RawLine> = group
                    .sequenced_indices
                    .iter()
                    .map(|&index| &sequenced[index].line)
                    .collect();
                Some(blocks::list_items_from_lines(&group_lines, &raw_words))
            } else {
                None
            };
            let rtl = group
                .sequenced_indices
                .iter()
                .filter(|&&i| sequenced[i].line.rtl)
                .count()
                * 2
                > group.sequenced_indices.len();
            let role = match group.marginal {
                Some((MarginalRole::Header, _)) => PdfCanonicalRole::Header,
                Some((MarginalRole::Footer, _)) => PdfCanonicalRole::Footer,
                Some((MarginalRole::PageNumber, _)) => PdfCanonicalRole::PageNumber,
                None => PdfCanonicalRole::Body,
            };
            PdfCanonicalBlock {
                id: model::block_id(request.page_number, block_index as u32),
                kind: draft.kind,
                role,
                page_number: request.page_number,
                source_regions: vec![PdfSourceRegion {
                    page_number: request.page_number,
                    bbox: draft.bbox,
                }],
                word_ids: draft
                    .word_refs
                    .iter()
                    .filter_map(|word_ref| match word_ref {
                        WordRef::Word(index) | WordRef::Merged(index, _, _) => {
                            if merged_away[*index] {
                                None
                            } else {
                                fate[*index].map(|ci| words_mut[ci].id.clone())
                            }
                        }
                    })
                    .collect(),
                line_ids: Vec::new(),
                reading_order: block_index as u32,
                confidence: draft.confidence,
                text,
                direction: if rtl {
                    PdfCanonicalDirection::Rtl
                } else {
                    PdfCanonicalDirection::Ltr
                },
                language: None,
                items,
                table: None,
                asset_id: None,
                source_width: None,
                source_height: None,
                alt_text,
                caption_of: None,
                href: None,
                extraction: PdfWordSource::NativePdfText,
            }
        })
        .collect();
    let line_ids: Vec<String> = canonical_lines.iter().map(|line| line.id.clone()).collect();
    for (block, group) in canonical_blocks
        .iter_mut()
        .zip(drafts.iter().map(|(group, _)| group))
    {
        block.line_ids = group
            .sequenced_indices
            .iter()
            .map(|&index| line_ids[index].clone())
            .collect();
    }

    // --- Visual regions: figures/tables/rules interleaved by position ---
    // (tasks 6.1/6.4/6.5) Regions with ruling-line grids become structured
    // tables; large unexplained ink becomes figures; thin wide bands become
    // rules; everything else stays `unknown-visual` — a preserved crop, never
    // dropped content.
    let has_text = !words_mut.is_empty();
    if let (true, Some(raster_ref)) = (has_text, raster.as_ref()) {
        let mut visual_regions =
            detect_visual_regions(Some(raster_ref), &all_lines, body_font_size);
        attach_captions(&mut visual_regions, &all_lines, body_font_size, |line| {
            word_text(line)
        });
        // Caption/label growth may push a bbox a hair past the page box
        // (line boxes can graze the page edge); crops clamp anyway, but the
        // model geometry stays within the page.
        for region in &mut visual_regions {
            region.bbox.x0 = region.bbox.x0.max(0.0);
            region.bbox.y0 = region.bbox.y0.max(0.0);
            region.bbox.x1 = region.bbox.x1.min(request.page_width);
            region.bbox.y1 = region.bbox.y1.min(request.page_height);
        }

        let mut spanning_centers: Vec<f64> = sequenced
            .iter()
            .filter(|entry| entry.column.is_none())
            .map(|entry| entry.line.bbox.center_y())
            .collect();
        for region in &visual_regions {
            let is_spanning = if column_regions.len() <= 1 {
                false
            } else {
                let overlapping = column_regions
                    .iter()
                    .filter(|col| region.bbox.x1 > col.x0 + 2.0 && region.bbox.x0 < col.x1 - 2.0)
                    .count();
                overlapping > 1 || region.bbox.width() >= 0.7 * request.page_width
            };
            if is_spanning {
                spanning_centers.push(region.bbox.center_y());
            }
        }
        spanning_centers.sort_by(|a, b| b.total_cmp(a));
        let stretch_of = |center_y: f64| -> usize {
            spanning_centers
                .iter()
                .filter(|&&span_y| span_y > center_y)
                .count()
        };

        struct PositionedBlock {
            stretch: usize,
            column: Option<usize>,
            top_y: f64,
            block: PdfCanonicalBlock,
        }

        let mut positioned_blocks: Vec<PositionedBlock> = canonical_blocks
            .into_iter()
            .enumerate()
            .map(|(index, block)| {
                let (group, draft) = &drafts[index];
                let first_seq_idx = group.sequenced_indices.first().copied().unwrap_or(0);
                let stretch = stretch_of(draft.bbox.center_y());
                let column = sequenced.get(first_seq_idx).and_then(|s| s.column);
                let top_y = draft.bbox.y1;
                PositionedBlock {
                    stretch,
                    column,
                    top_y,
                    block,
                }
            })
            .collect();

        for region in visual_regions {
            // Defense-in-depth bbox gate (never emit degenerate geometry):
            // invalid boxes are dropped with a warning; a figure that merely
            // misses the figure area floor downgrades to `unknown-visual`
            // (its crop is still a preserved region). Rules and ruled tables
            // are exempt above/below — rules are thin by design and ruled
            // tables carry their own structure data.
            if !visual_bbox_is_sane(&region.bbox, request.page_width, request.page_height) {
                warnings.push("figure-bbox-invalid".into());
                continue;
            }
            let table = detect_ruled_table(Some(raster_ref), region.bbox, &raw_words);
            // Wide-thin bands are horizontal rules under either test: the
            // classic "thinner than a line of body text" or an ≥8:1 aspect
            // strip at most two lines tall (chapter-opener rules on pages
            // whose median line height is small must not become image crops —
            // rules render as CSS `<hr>` in the reflow view).
            let is_rule = (region.bbox.height() <= 0.6 * body_font_size
                && region.bbox.width() >= 0.25 * request.page_width)
                || (region.bbox.width() >= 8.0 * region.bbox.height()
                    && region.bbox.height() <= 2.0 * body_font_size
                    && region.bbox.width() >= 0.25 * request.page_width);
            let mut kind = if table.data.is_some() {
                PdfCanonicalBlockKind::Table
            } else if is_rule {
                PdfCanonicalBlockKind::HorizontalRule
            } else if region.bbox.width() >= 3.0 * body_font_size
                && region.bbox.height() >= 1.5 * body_font_size
            {
                PdfCanonicalBlockKind::Figure
            } else {
                PdfCanonicalBlockKind::UnknownVisual
            };
            if kind == PdfCanonicalBlockKind::Figure
                && !figure_bbox_meets_floor(&region.bbox, body_font_size)
            {
                kind = PdfCanonicalBlockKind::UnknownVisual;
            }
            let confidence = if table.data.is_some() { 0.85 } else { 0.5 };
            let block = PdfCanonicalBlock {
                id: String::new(), // reassigned after merge
                kind,
                role: PdfCanonicalRole::Body,
                page_number: request.page_number,
                source_regions: vec![PdfSourceRegion {
                    page_number: request.page_number,
                    bbox: region.bbox,
                }],
                word_ids: Vec::new(),
                line_ids: Vec::new(),
                reading_order: 0,
                confidence,
                text: String::new(),
                direction: PdfCanonicalDirection::Auto,
                language: None,
                items: None,
                table: table.data,
                asset_id: None, // crops load lazily in the renderer
                source_width: None,
                source_height: None,
                alt_text: region.caption.clone(),
                caption_of: None,
                href: None,
                extraction: PdfWordSource::Graphical,
            };

            let center_y = region.bbox.center_y();
            let top_y = region.bbox.y1;
            let stretch = stretch_of(center_y);
            let column = if column_regions.len() <= 1 {
                None
            } else {
                let overlapping: Vec<usize> = column_regions
                    .iter()
                    .enumerate()
                    .filter(|(_, col)| {
                        region.bbox.x1 > col.x0 + 2.0 && region.bbox.x0 < col.x1 - 2.0
                    })
                    .map(|(i, _)| i)
                    .collect();
                if overlapping.len() == 1 {
                    Some(overlapping[0])
                } else {
                    None
                }
            };

            positioned_blocks.push(PositionedBlock {
                stretch,
                column,
                top_y,
                block,
            });
        }

        // Identify figure/table bounding boxes to suppress internal diagram labels
        let figure_or_table_bboxes: Vec<PdfRect> = positioned_blocks
            .iter()
            .filter(|pb| {
                matches!(
                    pb.block.kind,
                    PdfCanonicalBlockKind::Figure | PdfCanonicalBlockKind::Table
                )
            })
            .filter_map(|pb| pb.block.source_regions.first().map(|r| r.bbox))
            .collect();

        // Multi-column and stretch aware sort:
        positioned_blocks.retain(|pb| {
            if matches!(
                pb.block.kind,
                PdfCanonicalBlockKind::Figure
                    | PdfCanonicalBlockKind::Table
                    | PdfCanonicalBlockKind::UnknownVisual
                    | PdfCanonicalBlockKind::HorizontalRule
                    | PdfCanonicalBlockKind::Caption
            ) {
                return true;
            }
            // Check if pb.block sits inside any figure/table bbox
            let block_bbox = pb.block.source_regions.first().map(|r| r.bbox);
            if let Some(bbox) = block_bbox {
                let inside_visual = figure_or_table_bboxes.iter().any(|fb| {
                    let inter_x0 = bbox.x0.max(fb.x0);
                    let inter_y0 = bbox.y0.max(fb.y0);
                    let inter_x1 = bbox.x1.min(fb.x1);
                    let inter_y1 = bbox.y1.min(fb.y1);
                    if inter_x1 > inter_x0 && inter_y1 > inter_y0 {
                        let inter_area = (inter_x1 - inter_x0) * (inter_y1 - inter_y0);
                        let block_area = (bbox.width() * bbox.height()).max(1.0);
                        inter_area >= 0.50 * block_area
                    } else {
                        false
                    }
                });
                if inside_visual {
                    return false; // Suppress internal diagram label from reflow text stream
                }
            }
            true
        });

        // Total order (driftsort panics on intransitive comparators): a
        // strictly lexicographic key — stretch, then columned-before-spanning
        // (mirroring how `sequence_lines` flushes column lines ahead of the
        // spanning line that closes a stretch), then column index, then
        // top-to-bottom. `f64::total_cmp` keeps the key total even if a stray
        // NaN ever reaches `top_y`. The previous mixed comparison (None↔Some
        // by top_y while Some↔Some by column only) was intransitive and
        // panicked the analyzer on real pages.
        positioned_blocks.sort_by(|a, b| {
            a.stretch.cmp(&b.stretch).then_with(|| {
                if column_regions.len() <= 1 {
                    return b.top_y.total_cmp(&a.top_y);
                }
                (a.column.is_none() as u8)
                    .cmp(&(b.column.is_none() as u8))
                    .then_with(|| match (a.column, b.column) {
                        (Some(c1), Some(c2)) => c1.cmp(&c2),
                        _ => std::cmp::Ordering::Equal,
                    })
                    .then_with(|| b.top_y.total_cmp(&a.top_y))
            })
        });

        canonical_blocks = positioned_blocks.into_iter().map(|p| p.block).collect();

        for (block_index, block) in canonical_blocks.iter_mut().enumerate() {
            block.id = model::block_id(request.page_number, block_index as u32);
            block.reading_order = block_index as u32;
        }

        // Link captions to adjacent figures/tables
        for i in 0..canonical_blocks.len() {
            if canonical_blocks[i].kind == PdfCanonicalBlockKind::Caption {
                let target_id = if i > 0
                    && matches!(
                        canonical_blocks[i - 1].kind,
                        PdfCanonicalBlockKind::Figure
                            | PdfCanonicalBlockKind::Table
                            | PdfCanonicalBlockKind::UnknownVisual
                    ) {
                    Some(canonical_blocks[i - 1].id.clone())
                } else if i + 1 < canonical_blocks.len()
                    && matches!(
                        canonical_blocks[i + 1].kind,
                        PdfCanonicalBlockKind::Figure
                            | PdfCanonicalBlockKind::Table
                            | PdfCanonicalBlockKind::UnknownVisual
                    )
                {
                    Some(canonical_blocks[i + 1].id.clone())
                } else {
                    None
                };
                canonical_blocks[i].caption_of = target_id;
            }
        }
    }

    // --- Page classification ---
    let has_text = !words_mut.is_empty();
    let has_ink = raster.as_ref().is_some_and(|r| r.mask.total_ink > 0);
    let text_coverage_f64 = match (&raster, has_text) {
        (Some(raster), true) => {
            let ranges = line_raster_ranges(&all_lines, raster);
            raster.mask.row_coverage_of(&ranges)
        }
        (Some(_), false) => 0.0,
        (None, _) => 1.0,
    };
    let text_coverage = text_coverage_f64 as f32;
    let rtl_words = raw_words.iter().filter(|w| w.rtl).count();
    let rtl_page = rtl_words * 2 > raw_words.len() && !raw_words.is_empty();
    let (state, classification) = if !has_text && has_ink {
        (
            PdfCanonicalPageState::OcrRequired,
            PdfCanonicalClassification::OcrRequired,
        )
    } else if rtl_page {
        warnings.push("rtl-page".into());
        (
            PdfCanonicalPageState::Ready,
            PdfCanonicalClassification::FixedLayoutRecommended,
        )
    } else if text_coverage_f64 >= COVERAGE_SEMANTIC as f64 {
        (
            PdfCanonicalPageState::Ready,
            PdfCanonicalClassification::Semantic,
        )
    } else {
        if has_text {
            warnings.push("figure-ink-uncovered".into());
        }
        (
            PdfCanonicalPageState::Ready,
            PdfCanonicalClassification::SemanticWithWarnings,
        )
    };
    if !has_text && !has_ink {
        warnings.push("blank-page".into());
    }
    let confidence =
        (0.95_f32 - 0.1 * warnings.iter().filter(|w| **w != "no-raster").count() as f32).max(0.3);

    Ok(PdfCanonicalPage {
        page_number: request.page_number,
        width: request.page_width,
        height: request.page_height,
        rotation: request.rotation,
        state,
        classification,
        confidence,
        text_coverage,
        words: words_mut,
        lines: canonical_lines,
        blocks: canonical_blocks,
        warnings,
        error_category: None,
        schema_version: PDF_CANONICAL_SCHEMA_VERSION,
        engine_version: PDF_CANONICAL_ENGINE_VERSION.into(),
    })
}

/// Band a subset of words while preserving GLOBAL word indices.
fn band_subset(subset: &[(usize, &RawWord)]) -> Vec<RawLine> {
    let words: Vec<RawWord> = subset.iter().map(|(_, word)| (*word).clone()).collect();
    band_lines(&words)
        .into_iter()
        .map(|line| RawLine {
            word_indices: line
                .word_indices
                .iter()
                .map(|&local| subset[local].0)
                .collect(),
            bbox: line.bbox,
            baseline_y: line.baseline_y,
            line_height: line.line_height,
            rtl: line.rtl,
        })
        .collect()
}

fn median_line_height(lines: &[RawLine]) -> f64 {
    let mut heights: Vec<f64> = lines.iter().map(|line| line.line_height).collect();
    heights.sort_by(|a, b| a.total_cmp(b));
    heights.get(heights.len() / 2).copied().unwrap_or(10.0)
}

/// Marginal zone (top_y, bottom_y) in PDF space: center y ≥ top_y is the
/// header zone, ≤ bottom_y the footer zone.
fn marginal_zone(bounds: Option<crate::pdf::coordinates::PdfRect>) -> Option<(f64, f64)> {
    let bounds = bounds?;
    let height = bounds.height().max(1.0);
    Some((
        bounds.y1 - MARGINAL_ZONE_FRACTION * height,
        bounds.y0 + MARGINAL_ZONE_FRACTION * height,
    ))
}

fn close_group(
    indices: &[usize],
    line_roles: &[Option<(MarginalRole, bool)>],
    equation_lines: &[bool],
    _sequenced: &[SequencedLine],
) -> DraftGroup {
    // A single classified marginal line becomes its own group.
    if indices.len() == 1 && line_roles[indices[0]].is_some() {
        return DraftGroup {
            sequenced_indices: indices.to_vec(),
            marginal: line_roles[indices[0]],
            footnote: false,
            equation: false,
        };
    }
    // A single equation line becomes its own equation group (task 6.3).
    if indices.len() == 1 && equation_lines[indices[0]] {
        return DraftGroup {
            sequenced_indices: indices.to_vec(),
            marginal: None,
            footnote: false,
            equation: true,
        };
    }
    // A run whose FIRST line is classified marginal is a marginal group.
    DraftGroup {
        sequenced_indices: indices.to_vec(),
        marginal: line_roles[indices[0]],
        footnote: false,
        equation: false,
    }
}

/// Defense-in-depth bbox gate for visual blocks (figures/unknown-visual):
/// positive finite dimensions, inside the (already-clamped) page box, and an
/// aspect ratio within [1/50, 50]. A region that fails any check is dropped
/// with a `figure-bbox-invalid` warning — never a panic, never a degenerate
/// block whose crop would be an empty or absurd strip.
fn visual_bbox_is_sane(bbox: &PdfRect, page_width: f64, page_height: f64) -> bool {
    let w = bbox.width();
    let h = bbox.height();
    if !w.is_finite() || !h.is_finite() || w <= 0.0 || h <= 0.0 {
        return false;
    }
    let eps = 1e-6;
    if bbox.x0 < -eps || bbox.y0 < -eps || bbox.x1 > page_width + eps || bbox.y1 > page_height + eps
    {
        return false;
    }
    let aspect = w / h;
    (1.0 / 50.0..=50.0).contains(&aspect)
}

/// Figure area floor: a "figure" must be at least as large as a 2×2 block of
/// body-font glyphs; smaller regions downgrade to `unknown-visual` (still a
/// preserved crop) instead of claiming figure semantics.
fn figure_bbox_meets_floor(bbox: &PdfRect, body_font_size: f64) -> bool {
    bbox.width() * bbox.height() >= (2.0 * body_font_size).powi(2)
}

/// Footnote heuristic (task 5.5): small type, entirely in the bottom zone
/// of the content area.
fn is_footnote_group(
    lines: &[&RawLine],
    bounds: Option<crate::pdf::coordinates::PdfRect>,
    body_font_size: f64,
) -> bool {
    if lines.is_empty() {
        return false;
    }
    let max_height = lines
        .iter()
        .map(|line| line.line_height)
        .fold(0.0_f64, f64::max);
    let Some(bounds) = bounds else {
        return false;
    };
    let zone_y = bounds.y0 + FOOTNOTE_ZONE_FRACTION * bounds.height().max(1.0);
    max_height <= FOOTNOTE_SIZE_RATIO * body_font_size
        && lines.iter().all(|line| line.bbox.center_y() <= zone_y)
}

fn raw_to_canonical(
    page_number: u32,
    raw: &RawWord,
    fragments: Vec<crate::pdf::coordinates::PdfRect>,
    dehyphenated: bool,
) -> PdfCanonicalWord {
    PdfCanonicalWord {
        id: String::new(), // assigned in reading order
        page_number,
        text: raw.text.clone(),
        source_bbox: fragments.iter().fold(raw.bbox, |acc, bbox| acc.union(bbox)),
        source_fragments: fragments,
        bbox_exact: raw.bbox_exact,
        reading_order: 0,
        confidence: 1.0,
        source: PdfWordSource::NativePdfText,
        dehyphenated,
        font: raw.font.clone(),
    }
}

#[cfg(test)]
mod tests;
