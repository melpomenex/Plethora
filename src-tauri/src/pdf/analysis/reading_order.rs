//! Reading-order assignment (D3/D5). Phase 2 covers a single region: blocks
//! order top-to-bottom by their first line; words and lines number in
//! line-major order. Phase 5 (columns) replaces the ordering input with the
//! region tree while keeping this ID-assignment contract unchanged.

use crate::pdf::model::{PdfCanonicalBlock, PdfCanonicalLine, PdfCanonicalWord};

/// Blocks arrive top-to-bottom already; this function is the stable seam
/// where column-aware ordering plugs in later.
pub fn order_blocks_single_region(blocks: &mut [PdfCanonicalBlock]) {
    for (index, block) in blocks.iter_mut().enumerate() {
        block.reading_order = index as u32;
    }
}

/// Assign word and line IDs/reading order in line-major order. `word_ids`
/// maps each line's words (in line order) to already-assembled canonical
/// words, one entry per line.
pub fn assign_word_and_line_order(
    page_number: u32,
    lines: &mut [PdfCanonicalLine],
    word_ids_per_line: &[Vec<String>],
    words: &mut [PdfCanonicalWord],
) {
    debug_assert_eq!(lines.len(), word_ids_per_line.len());
    let lookup: std::collections::HashMap<String, usize> = words
        .iter()
        .enumerate()
        .map(|(index, word)| (word.id.clone(), index))
        .collect();
    let mut next_word_order = 0u32;
    for (line_index, line) in lines.iter_mut().enumerate() {
        line.id = super::super::model::line_id(page_number, line_index as u32);
        line.reading_order = line_index as u32;
        line.word_ids = word_ids_per_line[line_index].clone();
        for word_id in &line.word_ids {
            if let Some(&word_index) = lookup.get(word_id.as_str()) {
                words[word_index].reading_order = next_word_order;
                next_word_order += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::coordinates::PdfRect;
    use crate::pdf::model::{
        PdfCanonicalBlockKind, PdfCanonicalDirection, PdfCanonicalRole, PdfSourceRegion,
        PdfWordSource,
    };

    fn block(id: &str) -> PdfCanonicalBlock {
        PdfCanonicalBlock {
            id: id.into(),
            kind: PdfCanonicalBlockKind::Paragraph,
            role: PdfCanonicalRole::Body,
            page_number: 1,
            source_regions: vec![],
            word_ids: vec![],
            line_ids: vec![],
            reading_order: 0,
            confidence: 1.0,
            text: String::new(),
            direction: PdfCanonicalDirection::Auto,
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
        }
    }

    fn word(id: &str) -> PdfCanonicalWord {
        PdfCanonicalWord {
            id: id.into(),
            page_number: 1,
            text: "x".into(),
            source_bbox: PdfRect::default(),
            source_fragments: vec![],
            bbox_exact: true,
            reading_order: 0,
            confidence: 1.0,
            source: PdfWordSource::NativePdfText,
            dehyphenated: false,
            font: None,
        }
    }

    #[test]
    fn blocks_get_sequential_reading_order() {
        let mut blocks = vec![block("p1:b0"), block("p1:b1"), block("p1:b2")];
        order_blocks_single_region(&mut blocks);
        assert_eq!(blocks[0].reading_order, 0);
        assert_eq!(blocks[2].reading_order, 2);
    }

    #[test]
    fn words_and_lines_are_numbered_line_major() {
        let mut words = vec![word("p1:w0"), word("p1:w1"), word("p1:w2")];
        let mut lines = vec![
            PdfCanonicalLine {
                id: String::new(),
                word_ids: vec![],
                bbox: PdfRect::default(),
                baseline_y: 0.0,
                reading_order: 0,
            },
            PdfCanonicalLine {
                id: String::new(),
                word_ids: vec![],
                bbox: PdfRect::default(),
                baseline_y: 0.0,
                reading_order: 0,
            },
        ];
        assign_word_and_line_order(
            1,
            &mut lines,
            &[vec!["p1:w2".into(), "p1:w0".into()], vec!["p1:w1".into()]],
            &mut words,
        );
        assert_eq!(lines[0].id, "p1:l0");
        assert_eq!(lines[1].id, "p1:l1");
        // Reading order follows each line's word sequence.
        assert_eq!(words[2].reading_order, 0);
        assert_eq!(words[0].reading_order, 1);
        assert_eq!(words[1].reading_order, 2);
    }
}
