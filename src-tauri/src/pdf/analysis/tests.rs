//! Golden exactness tests for the analysis pipeline (task 2.8): canonical
//! text must equal the expected text exactly, ids must be deterministic, and
//! classification must react to raster evidence.

use super::*;

fn item(text: &str, x: f64, y: f64, font_size: f64, width: f64, bold: bool) -> TextItemInput {
    TextItemInput {
        text: text.into(),
        transform: [font_size, 0.0, 0.0, font_size, x, y],
        width,
        height: font_size,
        dir: "ltr".into(),
        font: Some(crate::pdf::model::PdfFontInfo {
            size: font_size,
            bold,
            italic: false,
            family: Some("Serif".into()),
        }),
        has_eol: false,
    }
}

fn request(items: Vec<TextItemInput>) -> PageAnalysisRequest {
    PageAnalysisRequest {
        page_number: 1,
        page_width: 612.0,
        page_height: 792.0,
        rotation: 0,
        raster_png: None,
        raster_scale: 0.0,
        text_items: items,
        marginal_context: Vec::new(),
    }
}

fn png_with_ink(width: u32, height: u32, ink_rects: &[(u32, u32, u32, u32)]) -> Vec<u8> {
    let mut data = vec![255u8; (width * height) as usize];
    for &(x0, y0, x1, y1) in ink_rects {
        for y in y0..=y1.min(height - 1) {
            for x in x0..=x1.min(width - 1) {
                data[y as usize * width as usize + x as usize] = 0;
            }
        }
    }
    let buffer = image::ImageBuffer::from_raw(width, height, data).unwrap();
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageLuma8(buffer)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}

/// Letter page at 2 px/pt (1224×1584) with ink bands behind given PDF-space
/// text line rectangles (y up).
fn raster_behind_lines(scale: f64, lines: &[(f64, f64, f64, f64)]) -> Vec<u8> {
    let width = (612.0 * scale) as u32;
    let height = (792.0 * scale) as u32;
    let mut rects = Vec::new();
    for &(x0, y0, x1, y1) in lines {
        let rect = coordinates::RasterGeometry::new(width, height, scale, 0, 612.0, 792.0)
            .pdf_rect_to_raster(&coordinates::PdfRect::new(x0, y0, x1, y1));
        rects.push((
            rect.x as u32,
            rect.y as u32,
            (rect.x + rect.width) as u32,
            (rect.y + rect.height) as u32,
        ));
    }
    png_with_ink(width, height, &rects)
}

#[test]
fn single_column_page_reconstructs_exact_text_and_kinds() {
    let items = vec![
        item("Chapter 3", 100.0, 740.0, 24.0, 120.0, true),
        // Paragraph one, three full lines.
        item(
            "The mitochondrion contains its own",
            100.0,
            700.0,
            10.0,
            330.0,
            false,
        ),
        item(
            "genome. It encodes proteins that",
            100.0,
            688.0,
            10.0,
            320.0,
            false,
        ),
        item(
            "assemble membrane complexes.",
            100.0,
            676.0,
            10.0,
            250.0,
            false,
        ),
        // Paragraph two after a gap.
        item(
            "Second paragraph text here.",
            100.0,
            640.0,
            10.0,
            240.0,
            false,
        ),
        item("More text follows.", 100.0, 628.0, 10.0, 160.0, false),
    ];
    let page = analyze_page(&request(items)).unwrap();
    assert_eq!(page.state, PdfCanonicalPageState::Ready);
    let texts: Vec<&str> = page.blocks.iter().map(|b| b.text.as_str()).collect();
    assert_eq!(
        texts,
        vec![
            "Chapter 3",
            "The mitochondrion contains its own genome. It encodes proteins that assemble membrane complexes.",
            "Second paragraph text here. More text follows.",
        ]
    );
    let kinds: Vec<_> = page.blocks.iter().map(|b| b.kind).collect();
    assert_eq!(
        kinds,
        vec![
            crate::pdf::model::PdfCanonicalBlockKind::Heading,
            crate::pdf::model::PdfCanonicalBlockKind::Paragraph,
            crate::pdf::model::PdfCanonicalBlockKind::Paragraph,
        ]
    );
    // Reading order: title first, words numbered line-major.
    assert_eq!(page.blocks[0].reading_order, 0);
    assert_eq!(page.words[0].text, "Chapter");
    assert_eq!(page.words[0].id, "p1:w0");
    let first_para_word = &page.blocks[1].word_ids[0];
    let word = page
        .words
        .iter()
        .find(|w| &w.id == first_para_word)
        .unwrap();
    assert_eq!(word.text, "The");
    assert_eq!(word.reading_order, 2); // after the two title words
}

#[test]
fn line_wrap_hyphen_merges_with_provenance() {
    let items = vec![
        item("the inter-", 100.0, 700.0, 10.0, 90.0, false),
        item("national system.", 100.0, 688.0, 10.0, 120.0, false),
    ];
    let page = analyze_page(&request(items)).unwrap();
    assert_eq!(page.blocks.len(), 1);
    assert_eq!(page.blocks[0].text, "the international system.");
    let merged = page
        .words
        .iter()
        .find(|w| w.text == "international")
        .expect("merged word exists");
    assert!(merged.dehyphenated);
    assert_eq!(merged.source_fragments.len(), 2);
    // And the original fragments' text is recoverable from the items.
    assert!(merged.source_bbox.width() > 80.0);
    // The unmerged fragment words are gone from the canonical stream.
    assert!(!page.words.iter().any(|w| w.text == "inter-"));
    assert!(!page.words.iter().any(|w| w.text == "national"));
}

#[test]
fn uppercase_hyphen_continuation_does_not_merge() {
    let items = vec![
        item("data from the Nine-", 100.0, 700.0, 10.0, 150.0, false),
        item("Teenth study.", 100.0, 688.0, 10.0, 110.0, false),
    ];
    let page = analyze_page(&request(items)).unwrap();
    // Both words stand; provenance shows the original hyphen untouched.
    assert_eq!(page.blocks[0].text, "data from the Nine- Teenth study.");
    assert!(page.words.iter().any(|w| w.text == "Nine-"));
    assert!(page.words.iter().any(|w| w.text == "Teenth"));
}

#[test]
fn ligatures_and_unicode_preserve_exactly() {
    let items = vec![item("ﬁle café 名词解释", 100.0, 700.0, 10.0, 220.0, false)];
    let page = analyze_page(&request(items)).unwrap();
    // Ligature char and accents survive; CJK runs join without spaces.
    assert_eq!(page.blocks[0].text, "ﬁle café 名词解释");
    let texts: Vec<&str> = page.words.iter().map(|w| w.text.as_str()).collect();
    assert_eq!(texts, vec!["ﬁle", "café", "名词解释"]);
}

#[test]
fn analysis_is_deterministic_across_runs() {
    let items = vec![
        item("Chapter 3", 100.0, 740.0, 24.0, 120.0, true),
        item(
            "The mitochondrion contains its own",
            100.0,
            700.0,
            10.0,
            330.0,
            false,
        ),
        item("genome.", 100.0, 688.0, 10.0, 60.0, false),
    ];
    let first = analyze_page(&request(items.clone())).unwrap();
    let second = analyze_page(&request(items)).unwrap();
    assert_eq!(first, second);
    assert_eq!(first.schema_version, PDF_CANONICAL_SCHEMA_VERSION);
    assert_eq!(first.engine_version, PDF_CANONICAL_ENGINE_VERSION);
}

#[test]
fn bullet_lines_become_list_blocks_with_items() {
    let items = vec![
        item("• First item", 100.0, 700.0, 10.0, 100.0, false),
        item("• Second item", 100.0, 688.0, 10.0, 110.0, false),
    ];
    let page = analyze_page(&request(items)).unwrap();
    assert_eq!(page.blocks.len(), 1);
    assert_eq!(
        page.blocks[0].kind,
        crate::pdf::model::PdfCanonicalBlockKind::List
    );
    assert_eq!(
        page.blocks[0].items,
        Some(vec!["• First item".into(), "• Second item".into()])
    );
}

#[test]
fn ink_without_text_is_ocr_required() {
    let mut req = request(vec![]);
    req.raster_png = Some(png_with_ink(200, 100, &[(20, 20, 180, 30)]));
    req.raster_scale = 2.0;
    let page = analyze_page(&req).unwrap();
    assert_eq!(page.state, PdfCanonicalPageState::OcrRequired);
    assert_eq!(page.classification, PdfCanonicalClassification::OcrRequired);
    assert_eq!(page.text_coverage, 0.0);
    assert!(page.blocks.is_empty());
}

#[test]
fn blank_page_is_ready_and_empty() {
    let mut req = request(vec![]);
    req.raster_png = Some(png_with_ink(200, 100, &[]));
    req.raster_scale = 2.0;
    let page = analyze_page(&req).unwrap();
    assert_eq!(page.state, PdfCanonicalPageState::Ready);
    assert!(page.blocks.is_empty());
    assert!(page.warnings.iter().any(|w| w == "blank-page"));
}

#[test]
fn raster_coverage_upgrades_classification_to_semantic() {
    let items = vec![
        item("One line of text here", 100.0, 700.0, 10.0, 180.0, false),
        item("Second line follows now", 100.0, 688.0, 10.0, 170.0, false),
    ];
    let mut req = request(items);
    // Ink bands exactly behind the two text lines.
    req.raster_png = Some(raster_behind_lines(
        2.0,
        &[(100.0, 700.0, 280.0, 710.0), (100.0, 688.0, 270.0, 698.0)],
    ));
    req.raster_scale = 2.0;
    let page = analyze_page(&req).unwrap();
    assert_eq!(page.classification, PdfCanonicalClassification::Semantic);
    assert!(page.text_coverage >= COVERAGE_SEMANTIC);
    assert!(page.warnings.is_empty());

    // Now add a big figure band nobody covers → warnings.
    req.raster_png = Some(raster_behind_lines(
        2.0,
        &[
            (100.0, 700.0, 280.0, 710.0),
            (100.0, 688.0, 270.0, 698.0),
            (100.0, 400.0, 500.0, 600.0),
        ],
    ));
    let page = analyze_page(&req).unwrap();
    assert_eq!(
        page.classification,
        PdfCanonicalClassification::SemanticWithWarnings
    );
    assert!(page.warnings.iter().any(|w| w == "figure-ink-uncovered"));
}

#[test]
fn text_without_raster_evidence_is_flagged() {
    let items = vec![item("invisible text", 100.0, 700.0, 10.0, 100.0, false)];
    let mut req = request(items);
    // Ink far away from the claimed line.
    req.raster_png = Some(png_with_ink(1224, 1584, &[(100, 100, 1100, 110)]));
    req.raster_scale = 2.0;
    let page = analyze_page(&req).unwrap();
    assert!(page
        .warnings
        .iter()
        .any(|w| w.ends_with("lines-without-ink")));
}

#[test]
fn page_numbers_must_be_positive() {
    let mut req = request(vec![]);
    req.page_number = 0;
    assert!(analyze_page(&req).is_err());
}

// --- Section 5: columns, reading order, marginal elements, footnotes ---

/// Two-column raster: columns at x 20..90px and 130..200px (gutter 40px) on
/// a 200×100pt page at 2px/pt.
fn two_column_raster_png() -> Vec<u8> {
    let mut gray = vec![255u8; 400 * 200];
    for y in 10..190 {
        for x in 20..90 {
            gray[y * 400 + x] = 0;
        }
        for x in 130..200 {
            gray[y * 400 + x] = 0;
        }
    }
    let buffer = image::ImageBuffer::from_raw(400, 200, gray).unwrap();
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageLuma8(buffer)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}

#[test]
fn two_column_page_reads_left_column_first() {
    // Left column at x≈15..95pt, right at x≈70..95? Use page 200pt wide so
    // the raster columns map to x 10..45pt and 65..100pt.
    let items = vec![
        // Left column (x 12..40): "left one" then "left two".
        item("left one", 14.0, 680.0, 8.0, 24.0, false),
        item("left two", 14.0, 668.0, 8.0, 24.0, false),
        // Right column (x 68..96): "right one" then "right two".
        item("right one", 68.0, 680.0, 8.0, 26.0, false),
        item("right two", 68.0, 668.0, 8.0, 26.0, false),
    ];
    let mut req = request(items);
    req.page_width = 200.0;
    req.page_height = 100.0;
    req.raster_png = Some(two_column_raster_png());
    req.raster_scale = 2.0;
    let page = analyze_page(&req).unwrap();
    // The internal text order is left-right interleaved (L1 R1 L2 R2 by y),
    // but the canonical reading order must complete the left column first
    // (spec: pdf-canonical-content-model).
    let texts: Vec<&str> = page.blocks.iter().map(|b| b.text.as_str()).collect();
    assert!(
        texts.contains(&"left one left two") || texts.contains(&"left one left two".trim()),
        "blocks: {texts:?}"
    );
    assert!(texts.contains(&"right one right two"), "blocks: {texts:?}");
    let left_pos = texts
        .iter()
        .position(|t| *t == "left one left two")
        .unwrap();
    let right_pos = texts
        .iter()
        .position(|t| *t == "right one right two")
        .unwrap();
    assert!(left_pos < right_pos);
    // Word reading order follows the same sequence.
    let first_left = page.blocks[left_pos].word_ids[0].clone();
    let first_right = page.blocks[right_pos].word_ids[0].clone();
    let left_order = page
        .words
        .iter()
        .find(|w| w.id == first_left)
        .unwrap()
        .reading_order;
    let right_order = page
        .words
        .iter()
        .find(|w| w.id == first_right)
        .unwrap()
        .reading_order;
    assert!(left_order < right_order);
}

#[test]
fn recurring_header_gets_role_and_page_number_recognized() {
    let items = vec![
        // Top marginal zone (y ≥ ~92% of 792pt content → y ≥ 729 with full
        // page bounds; place header at the very top).
        item("Chapter 3: Results", 100.0, 760.0, 9.0, 120.0, false),
        item(
            "Body text of the chapter.",
            100.0,
            700.0,
            10.0,
            160.0,
            false,
        ),
        // Bare page number at the bottom.
        item("42", 296.0, 40.0, 10.0, 12.0, false),
    ];
    let mut req = request(items);
    req.marginal_context = vec![
        "chapter #: results".into(),
        "Chapter 3: Results".into(),
        "CHAPTER 3: RESULTS".into(),
    ];
    let page = analyze_page(&req).unwrap();
    let header = page
        .blocks
        .iter()
        .find(|b| b.text == "Chapter 3: Results")
        .unwrap();
    assert_eq!(header.role, crate::pdf::model::PdfCanonicalRole::Header);
    let body = page
        .blocks
        .iter()
        .find(|b| b.text.contains("Body text"))
        .unwrap();
    assert_eq!(body.role, crate::pdf::model::PdfCanonicalRole::Body);
    let page_number = page.blocks.iter().find(|b| b.text == "42").unwrap();
    assert_eq!(
        page_number.role,
        crate::pdf::model::PdfCanonicalRole::PageNumber
    );
}

#[test]
fn small_type_in_bottom_zone_becomes_footnote() {
    let items = vec![
        item(
            "Body text across the page here.",
            100.0,
            500.0,
            10.0,
            200.0,
            false,
        ),
        // Footnote zone: bottom 30% of the (text) content bounds, small type.
        item("1. See the appendix.", 100.0, 120.0, 7.0, 90.0, false),
    ];
    let page = analyze_page(&request(items)).unwrap();
    let footnote = page
        .blocks
        .iter()
        .find(|b| b.text.contains("appendix"))
        .unwrap();
    assert_eq!(
        footnote.kind,
        crate::pdf::model::PdfCanonicalBlockKind::Footnote
    );
}

// --- Section 6: figures, equations, tables ---

#[test]
fn display_equation_becomes_equation_block_with_alt_text() {
    let items = vec![
        item(
            "The energy relation is as follows.",
            100.0,
            700.0,
            10.0,
            280.0,
            false,
        ),
        item("E = mc2", 250.0, 680.0, 12.0, 50.0, false),
        item(
            "This holds in all inertial frames.",
            100.0,
            660.0,
            10.0,
            250.0,
            false,
        ),
    ];
    let page = analyze_page(&request(items)).unwrap();
    let equation = page
        .blocks
        .iter()
        .find(|b| b.kind == crate::pdf::model::PdfCanonicalBlockKind::Equation)
        .expect("equation block exists");
    // Glyph text is preserved as alt_text, never rendered as flowing text.
    assert_eq!(equation.alt_text.as_deref(), Some("E = mc2"));
    assert_eq!(equation.text, "");
    // Body paragraphs on both sides are untouched.
    assert!(page
        .blocks
        .iter()
        .any(|b| b.text.contains("inertial frames")));
}

#[test]
fn unexplained_ink_becomes_figure_block_with_caption() {
    let items = vec![
        item(
            "Body text above the figure.",
            100.0,
            700.0,
            10.0,
            200.0,
            false,
        ),
        item(
            "Figure 7.3 — Mitochondrial genome map",
            100.0,
            350.0,
            9.0,
            220.0,
            false,
        ),
    ];
    let mut req = request(items);
    // Raster: text line behind y 700..710; a large figure blob at PDF y
    // 380..600 (raster rows (792-600)*2=384 .. (792-380)*2=824, page 612×792
    // at 2px/pt → 1224×1584). The caption line sits just below the blob.
    let mut gray = vec![255u8; 1224 * 1584];
    for y in 670..690 {
        for x in 200..800 {
            gray[y * 1224 + x] = 0;
        }
    }
    for y in 384..824 {
        for x in 300..900 {
            gray[y * 1224 + x] = 0;
        }
    }
    for y in 874..892 {
        for x in 200..640 {
            gray[y * 1224 + x] = 0;
        }
    }
    let buffer = image::ImageBuffer::from_raw(1224, 1584, gray).unwrap();
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageLuma8(buffer)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    req.raster_png = Some(bytes.into_inner());
    req.raster_scale = 2.0;
    let page = analyze_page(&req).unwrap();
    let figure = page
        .blocks
        .iter()
        .find(|b| b.kind == crate::pdf::model::PdfCanonicalBlockKind::Figure)
        .expect("figure block exists");
    assert_eq!(
        figure.extraction,
        crate::pdf::model::PdfWordSource::Graphical
    );
    assert_eq!(
        figure.alt_text.as_deref(),
        Some("Figure 7.3 — Mitochondrial genome map")
    );
    // The figure appears between the paragraph above and the caption below.
    assert!(figure.reading_order > 0);
}

// --- Section 7: degradation ladder (task 7.6) ---

#[test]
fn degradation_ladder_never_yields_a_dead_page() {
    // 1. Best: native text + matching raster → semantic, ready.
    let native = analyze_page(&request(vec![item(
        "Native text line.",
        100.0,
        700.0,
        10.0,
        120.0,
        false,
    )]))
    .unwrap();
    assert_eq!(native.state, PdfCanonicalPageState::Ready);
    // No raster → coverage defaults to full; the no-raster warning records it.
    assert_eq!(native.classification, PdfCanonicalClassification::Semantic);
    assert!(native.warnings.contains(&"no-raster".to_string()));
    assert!(!native.blocks.is_empty());

    // 2. Scanned: ink without text → ocr-required (OCR or graphical
    //    fallback take over; the page is never rendered blank).
    let mut scanned = request(vec![]);
    scanned.raster_png = Some(png_with_ink(200, 100, &[(10, 10, 190, 90)]));
    scanned.raster_scale = 2.0;
    let scanned_page = analyze_page(&scanned).unwrap();
    assert_eq!(scanned_page.state, PdfCanonicalPageState::OcrRequired);
    assert_eq!(
        scanned_page.classification,
        PdfCanonicalClassification::OcrRequired
    );

    // 3. Graphical fallback turns that page into readable crop blocks.
    let raster =
        PageRaster::from_png(&scanned.raster_png.clone().unwrap(), 2.0, 0, 612.0, 792.0).unwrap();
    let fallback = crate::pdf::fallback::graphical::build_graphical_fallback_page(
        1,
        612.0,
        792.0,
        0,
        Some(&raster),
    )
    .unwrap();
    assert_eq!(fallback.state, PdfCanonicalPageState::Ready);
    assert!(!fallback.blocks.is_empty());
    assert!(fallback
        .blocks
        .iter()
        .all(|b| b.extraction == crate::pdf::model::PdfWordSource::Graphical));

    // 4. OCR ingestion makes real text out of the same page.
    let ocr_words = vec![crate::pdf::ocr::OcrWordInput {
        text: "Recognized".into(),
        x: 0.1,
        y: 0.1,
        width: 0.3,
        height: 0.05,
        confidence: 0.95,
    }];
    let ocr_page =
        crate::pdf::ocr::build_page_from_ocr_args(1, 612.0, 792.0, 0, &ocr_words).unwrap();
    assert_eq!(ocr_page.state, PdfCanonicalPageState::Ready);
    assert_eq!(ocr_page.blocks[0].text, "Recognized");
    assert_eq!(
        ocr_page.blocks[0].extraction,
        crate::pdf::model::PdfWordSource::Ocr
    );
}

#[test]
fn two_column_with_embedded_figure_preserves_column_reading_order() {
    // 2-column page (200x100pt, 2px/pt -> 400x200px)
    // Left column (x 10..45pt): Paragraph L1 (y 80..72), Figure L (y 65..45), Paragraph L2 (y 40..32)
    // Right column (x 65..100pt): Paragraph R1 (y 80..72), Paragraph R2 (y 40..32)
    let items = vec![
        item("left paragraph one", 14.0, 75.0, 8.0, 30.0, false),
        item("left paragraph two", 14.0, 35.0, 8.0, 30.0, false),
        item("right paragraph one", 68.0, 75.0, 8.0, 30.0, false),
        item("right paragraph two", 68.0, 35.0, 8.0, 30.0, false),
    ];
    let mut req = request(items);
    req.page_width = 200.0;
    req.page_height = 100.0;
    req.raster_scale = 2.0;

    let mut gray = vec![255u8; 400 * 200];
    // Left column text ink
    for y in 40..60 {
        for x in 20..90 {
            gray[y * 400 + x] = 0;
        }
    }
    // Left column figure ink: PDF y 45..65 -> raster rows (100-65)*2=70 .. (100-45)*2=110, x 24..80
    for y in 70..110 {
        for x in 24..80 {
            gray[y * 400 + x] = 0;
        }
    }
    // Left column text 2 ink
    for y in 120..140 {
        for x in 20..90 {
            gray[y * 400 + x] = 0;
        }
    }
    // Right column text 1 ink
    for y in 40..60 {
        for x in 130..200 {
            gray[y * 400 + x] = 0;
        }
    }
    // Right column text 2 ink
    for y in 120..140 {
        for x in 130..200 {
            gray[y * 400 + x] = 0;
        }
    }

    let buffer = image::ImageBuffer::from_raw(400, 200, gray).unwrap();
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageLuma8(buffer)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    req.raster_png = Some(bytes.into_inner());

    let page = analyze_page(&req).unwrap();
    let block_kinds_and_texts: Vec<(PdfCanonicalBlockKind, &str)> = page
        .blocks
        .iter()
        .map(|b| (b.kind, b.text.as_str()))
        .collect();

    // Reading order MUST read all of left column (L1 -> Fig L -> L2) BEFORE right column (R1 -> R2)!
    let l1_pos = page
        .blocks
        .iter()
        .position(|b| b.text.contains("left paragraph one"))
        .unwrap();
    let fig_pos = page
        .blocks
        .iter()
        .position(|b| b.kind == PdfCanonicalBlockKind::Figure)
        .unwrap();
    let l2_pos = page
        .blocks
        .iter()
        .position(|b| b.text.contains("left paragraph two"))
        .unwrap();
    let r1_pos = page
        .blocks
        .iter()
        .position(|b| b.text.contains("right paragraph one"))
        .unwrap();
    let r2_pos = page
        .blocks
        .iter()
        .position(|b| b.text.contains("right paragraph two"))
        .unwrap();

    assert!(
        l1_pos < fig_pos,
        "L1 must precede Figure: {block_kinds_and_texts:?}"
    );
    assert!(
        fig_pos < l2_pos,
        "Figure must precede L2: {block_kinds_and_texts:?}"
    );
    assert!(
        l2_pos < r1_pos,
        "L2 must precede R1: {block_kinds_and_texts:?}"
    );
    assert!(
        r1_pos < r2_pos,
        "R1 must precede R2: {block_kinds_and_texts:?}"
    );
}

#[test]
fn full_width_figure_between_two_column_stretches() {
    // 2-column page with full width figure in the middle
    let items = vec![
        item("top left text", 14.0, 75.0, 8.0, 30.0, false),
        item("top right text", 68.0, 75.0, 8.0, 30.0, false),
        item("bottom left text", 14.0, 20.0, 8.0, 30.0, false),
        item("bottom right text", 68.0, 20.0, 8.0, 30.0, false),
    ];
    let mut req = request(items);
    req.page_width = 200.0;
    req.page_height = 100.0;
    req.raster_scale = 2.0;

    let mut gray = vec![255u8; 400 * 200];
    // Top 2 columns ink
    for y in 40..60 {
        for x in 20..90 {
            gray[y * 400 + x] = 0;
        }
        for x in 130..200 {
            gray[y * 400 + x] = 0;
        }
    }
    // Full width spanning figure ink: x 20..380, y 80..120 (PDF y 40..60)
    for y in 80..120 {
        for x in 20..380 {
            gray[y * 400 + x] = 0;
        }
    }
    // Bottom 2 columns ink
    for y in 150..170 {
        for x in 20..90 {
            gray[y * 400 + x] = 0;
        }
        for x in 130..200 {
            gray[y * 400 + x] = 0;
        }
    }

    let buffer = image::ImageBuffer::from_raw(400, 200, gray).unwrap();
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageLuma8(buffer)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    req.raster_png = Some(bytes.into_inner());

    let page = analyze_page(&req).unwrap();
    let fig = page
        .blocks
        .iter()
        .find(|b| b.kind == PdfCanonicalBlockKind::Figure)
        .expect("spanning figure exists");
    let top_left = page
        .blocks
        .iter()
        .position(|b| b.text.contains("top left text"))
        .unwrap();
    let top_right = page
        .blocks
        .iter()
        .position(|b| b.text.contains("top right text"))
        .unwrap();
    let fig_pos = page.blocks.iter().position(|b| b.id == fig.id).unwrap();
    let bot_left = page
        .blocks
        .iter()
        .position(|b| b.text.contains("bottom left text"))
        .unwrap();
    let bot_right = page
        .blocks
        .iter()
        .position(|b| b.text.contains("bottom right text"))
        .unwrap();

    assert!(top_left < top_right);
    assert!(top_right < fig_pos);
    assert!(fig_pos < bot_left);
    assert!(bot_left < bot_right);
}

#[test]
fn caption_links_to_adjacent_figure() {
    let items = vec![
        item("Paragraph before figure.", 100.0, 700.0, 10.0, 200.0, false),
        item(
            "Figure 1: Architecture of the system",
            100.0,
            350.0,
            9.0,
            200.0,
            false,
        ),
        item("Paragraph after caption.", 100.0, 300.0, 10.0, 200.0, false),
    ];
    let mut req = request(items);
    req.raster_scale = 2.0;

    let mut gray = vec![255u8; 1224 * 1584];
    // Text lines
    for y in 670..690 {
        for x in 200..800 {
            gray[y * 1224 + x] = 0;
        }
    }
    // Figure ink at raster rows 384..824 (PDF y 380..600)
    for y in 384..824 {
        for x in 300..900 {
            gray[y * 1224 + x] = 0;
        }
    }
    // Caption text ink
    for y in 874..892 {
        for x in 200..640 {
            gray[y * 1224 + x] = 0;
        }
    }
    // Paragraph after
    for y in 970..990 {
        for x in 200..800 {
            gray[y * 1224 + x] = 0;
        }
    }

    let buffer = image::ImageBuffer::from_raw(1224, 1584, gray).unwrap();
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageLuma8(buffer)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    req.raster_png = Some(bytes.into_inner());

    let page = analyze_page(&req).unwrap();
    let fig = page
        .blocks
        .iter()
        .find(|b| b.kind == PdfCanonicalBlockKind::Figure)
        .expect("figure exists");
    let caption = page
        .blocks
        .iter()
        .find(|b| b.kind == PdfCanonicalBlockKind::Caption)
        .expect("caption exists");

    assert_eq!(caption.caption_of, Some(fig.id.clone()));
    assert_eq!(caption.text, "Figure 1: Architecture of the system");
}

#[test]
fn diagram_with_internal_labels_is_unified_and_labels_suppressed() {
    // Page with Header, Paragraph before, Diagram with internal labels (left, center, right), Caption, Paragraph after
    let items = vec![
        item("Header line", 50.0, 750.0, 10.0, 100.0, false),
        item("Paragraph before diagram.", 50.0, 700.0, 10.0, 300.0, false),
        // Diagram internal labels
        item("Goals & motives", 200.0, 620.0, 9.0, 80.0, false),
        item("Cognitive biases", 60.0, 560.0, 9.0, 80.0, false),
        item("Collective behaviour", 340.0, 560.0, 9.0, 90.0, false),
        item("Social processes", 50.0, 480.0, 9.0, 80.0, false),
        item("Symbolic sensibilities", 350.0, 480.0, 9.0, 100.0, false),
        item("Credit crunch", 200.0, 420.0, 9.0, 70.0, false),
        // Caption
        item(
            "Fig. 3.1 Human nature and the Credit Crunch.",
            50.0,
            380.0,
            9.0,
            240.0,
            false,
        ),
        // Body paragraph after
        item(
            "Paragraph after diagram continues here.",
            50.0,
            340.0,
            10.0,
            300.0,
            false,
        ),
    ];
    let mut req = request(items);
    req.page_width = 500.0;
    req.page_height = 800.0;
    req.raster_scale = 1.0;

    let mut gray = vec![255u8; 500 * 800];
    // Diagram radial spoke ink: PDF y 450..580, x 180..320 -> raster y (800-580)=220 .. (800-450)=350
    for y in 220..350 {
        for x in 180..320 {
            gray[y * 500 + x] = 0;
        }
    }

    let buffer = image::ImageBuffer::from_raw(500, 800, gray).unwrap();
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageLuma8(buffer)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    req.raster_png = Some(bytes.into_inner());

    let page = analyze_page(&req).unwrap();

    // Verify Figure exists
    let fig = page
        .blocks
        .iter()
        .find(|b| b.kind == PdfCanonicalBlockKind::Figure)
        .expect("unified figure exists");
    let fig_bbox = fig.source_regions.first().unwrap().bbox;

    // Figure bounding box MUST cover the left labels (x ~ 50) and right labels (x ~ 450)!
    assert!(
        fig_bbox.x0 <= 50.0,
        "Figure bbox.x0 must cover left labels: got {}",
        fig_bbox.x0
    );
    assert!(
        fig_bbox.x1 >= 440.0,
        "Figure bbox.x1 must cover right labels: got {}",
        fig_bbox.x1
    );
    assert!(
        fig_bbox.y0 <= 395.0,
        "Figure bbox.y0 must reach caption: got {}",
        fig_bbox.y0
    );
    assert!(
        fig_bbox.y1 >= 620.0,
        "Figure bbox.y1 must reach top label: got {}",
        fig_bbox.y1
    );

    // Internal labels MUST NOT exist as standalone body text blocks!
    assert!(!page.blocks.iter().any(|b| b.text == "Cognitive biases"));
    assert!(!page.blocks.iter().any(|b| b.text == "Collective behaviour"));
    assert!(!page.blocks.iter().any(|b| b.text == "Social processes"));
    assert!(!page
        .blocks
        .iter()
        .any(|b| b.text == "Symbolic sensibilities"));
    assert!(!page.blocks.iter().any(|b| b.text == "Credit crunch"));

    // Caption exists and points to figure
    let caption = page
        .blocks
        .iter()
        .find(|b| b.kind == PdfCanonicalBlockKind::Caption)
        .expect("caption exists");
    assert_eq!(caption.caption_of, Some(fig.id.clone()));

    // Paragraph before and after are in correct reading order
    let p_before = page
        .blocks
        .iter()
        .position(|b| b.text.contains("Paragraph before"))
        .unwrap();
    let fig_pos = page.blocks.iter().position(|b| b.id == fig.id).unwrap();
    let cap_pos = page.blocks.iter().position(|b| b.id == caption.id).unwrap();
    let p_after = page
        .blocks
        .iter()
        .position(|b| b.text.contains("Paragraph after"))
        .unwrap();

    assert!(p_before < fig_pos);
    assert!(fig_pos < cap_pos);
    assert!(cap_pos < p_after);
}

// --- Defense-in-depth visual-bbox gates -------------------------------------

#[test]
fn visual_bbox_gate_accepts_ordinary_figures() {
    use crate::pdf::coordinates::PdfRect;
    let page_w = 612.0;
    let page_h = 792.0;
    assert!(visual_bbox_is_sane(
        &PdfRect::new(72.0, 300.0, 540.0, 500.0),
        page_w,
        page_h
    ));
    // An 8:1 wide banner is unusual but a legitimate figure.
    assert!(visual_bbox_is_sane(
        &PdfRect::new(72.0, 300.0, 552.0, 345.0),
        page_w,
        page_h
    ));
    assert!(figure_bbox_meets_floor(
        &PdfRect::new(72.0, 300.0, 540.0, 500.0),
        10.0
    ));
}

#[test]
fn visual_bbox_gate_rejects_degenerate_geometry() {
    use crate::pdf::coordinates::PdfRect;
    let page_w = 612.0;
    let page_h = 792.0;
    // Zero width/height (PdfRect::new normalizes inverted inputs, so only
    // degenerate-but-ordered boxes remain possible here).
    assert!(!visual_bbox_is_sane(&PdfRect::new(72.0, 300.0, 72.0, 500.0), page_w, page_h));
    assert!(!visual_bbox_is_sane(&PdfRect::new(72.0, 300.0, 540.0, 300.0), page_w, page_h));
    // Non-finite extents.
    assert!(!visual_bbox_is_sane(
        &PdfRect::new(f64::NAN, 300.0, 540.0, 500.0),
        page_w,
        page_h
    ));
    assert!(!visual_bbox_is_sane(
        &PdfRect::new(72.0, 300.0, f64::INFINITY, 500.0),
        page_w,
        page_h
    ));
}

#[test]
fn visual_bbox_gate_rejects_out_of_page_bboxes() {
    use crate::pdf::coordinates::PdfRect;
    let page_w = 612.0;
    let page_h = 792.0;
    // Beyond the right/top edges (a clamp that inverted the box collapses
    // width/height to <= 0 and is rejected too).
    assert!(!visual_bbox_is_sane(
        &PdfRect::new(600.0, 300.0, 700.0, 500.0),
        page_w,
        page_h
    ));
    assert!(!visual_bbox_is_sane(
        &PdfRect::new(72.0, 700.0, 540.0, 900.0),
        page_w,
        page_h
    ));
    assert!(!visual_bbox_is_sane(
        &PdfRect::new(650.0, 300.0, 660.0, 500.0),
        page_w,
        page_h
    ));
}

#[test]
fn visual_bbox_gate_rejects_extreme_aspect_ratios() {
    use crate::pdf::coordinates::PdfRect;
    let page_w = 612.0;
    let page_h = 792.0;
    // 60:1 horizontal sliver — beyond the 50:1 ceiling.
    assert!(!visual_bbox_is_sane(
        &PdfRect::new(10.0, 300.0, 610.0, 310.0),
        page_w,
        page_h
    ));
    // 60:1 vertical sliver.
    assert!(!visual_bbox_is_sane(
        &PdfRect::new(300.0, 10.0, 310.0, 610.0),
        page_w,
        page_h
    ));
}

#[test]
fn figure_area_floor_downgrades_small_figures() {
    use crate::pdf::coordinates::PdfRect;
    // (2 × body font)² floor: a 20×20 region fails a 10pt body font floor
    // (400pt² needed, 400pt² exactly met — use 19×20 to fail).
    assert!(figure_bbox_meets_floor(&PdfRect::new(0.0, 0.0, 20.0, 20.0), 10.0));
    assert!(!figure_bbox_meets_floor(&PdfRect::new(0.0, 0.0, 19.0, 20.0), 10.0));
    assert!(!figure_bbox_meets_floor(&PdfRect::new(0.0, 0.0, 7.2, 7.2), 10.0));
}
