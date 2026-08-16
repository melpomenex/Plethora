//! Block typing for text blocks (D6): heading/list/code/paragraph, with
//! text assembly that applies the de-hyphenation policy and CJK-aware word
//! joining. Deterministic heuristics only.

use crate::pdf::model::{
    PdfCanonicalBlock, PdfCanonicalBlockKind, PdfCanonicalDirection, PdfSourceRegion, PdfWordSource,
};

use super::coordinates::PdfRect;
use super::paragraphs::{dehyphenate_text, should_dehyphenate};
use super::rows::RawLine;
use super::words::RawWord;

/// Heading font-size ratio over the page median body size.
const HEADING_SIZE_RATIO: f64 = 1.15;

/// Headings are at most this many lines.
const HEADING_MAX_LINES: usize = 3;

#[derive(Debug, Clone, PartialEq)]
pub struct DraftBlock {
    pub kind: PdfCanonicalBlockKind,
    /// Word texts in reading order, after de-hyphenation decisions.
    pub word_texts: Vec<String>,
    /// Indices into the page word slice for non-merged words; merged
    /// fragments contribute their geometry to `merged_fragments`.
    pub word_refs: Vec<WordRef>,
    pub bbox: PdfRect,
    pub confidence: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum WordRef {
    Word(usize),
    /// Merged across a line break: (left word index, right word index, text).
    Merged(usize, usize, String),
}

/// Assemble one paragraph group into word texts + refs, applying
/// de-hyphenation at line boundaries.
pub fn assemble_group_words(
    group_lines: &[&RawLine],
    words: &[RawWord],
) -> (Vec<String>, Vec<WordRef>) {
    let mut texts: Vec<String> = Vec::new();
    let mut refs: Vec<WordRef> = Vec::new();
    let mut pending_hyphen: Option<(usize, String)> = None; // (right word idx of prev line's last word, its text)

    for (line_pos, line) in group_lines.iter().enumerate() {
        let mut indices = line.word_indices.clone().into_iter().peekable();
        while let Some(word_index) = indices.next() {
            let text = &words[word_index].text;
            if let Some((prev_index, prev_text)) = pending_hyphen.take() {
                if should_dehyphenate(&prev_text, text) {
                    let merged = dehyphenate_text(&prev_text, text);
                    // The last pushed text was prev_text; replace it with the
                    // merged form.
                    if let Some(last) = texts.last_mut() {
                        *last = merged.clone();
                    }
                    if let Some(last_ref) = refs.last_mut() {
                        *last_ref = WordRef::Merged(prev_index, word_index, merged.clone());
                    }
                    continue;
                }
                // No merge: the hyphen was lexical/ambiguously capitalized —
                // both words stand alone (originals already pushed).
            }
            texts.push(text.clone());
            refs.push(WordRef::Word(word_index));
            let _ = line_pos;
            // Track this line's final word as a potential hyphen partner.
            if indices.peek().is_none() && text.ends_with('-') {
                pending_hyphen = Some((word_index, text.clone()));
            }
        }
    }
    (texts, refs)
}

fn is_list_item(texts: &[String]) -> bool {
    let Some(first) = texts.first() else {
        return false;
    };
    let trimmed = first.trim();
    if let Some(rest) = trimmed.strip_prefix(['•', '·', '–', '▪', '◦']) {
        // Standalone bullet word, or "• text" inside one item string.
        return rest.is_empty() || rest.starts_with(char::is_whitespace);
    }
    if let Some(rest) = trimmed
        .strip_prefix('-')
        .or_else(|| trimmed.strip_prefix('*'))
    {
        return rest.is_empty() || rest.starts_with(char::is_whitespace);
    }
    numbered_list_marker(trimmed)
}

fn numbered_list_marker(trimmed: &str) -> bool {
    let digits: String = trimmed.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() || digits.len() > 3 {
        return false;
    }
    if !trimmed
        .chars()
        .nth(digits.len())
        .is_some_and(|c| c == '.' || c == ')')
    {
        return false;
    }
    let rest = &trimmed[digits.len() + 1..];
    // The marker may be a standalone word ("1." then "Intro") or carry its
    // text inline ("1. Intro").
    rest.is_empty() || rest.starts_with(char::is_whitespace)
}

fn is_monospace(group_lines: &[&RawLine], words: &[RawWord]) -> bool {
    group_lines
        .iter()
        .flat_map(|line| line.word_indices.iter())
        .filter_map(|&i| words[i].font.as_ref())
        .filter(|font| {
            font.family
                .as_deref()
                .is_some_and(|family| !family.is_empty())
        })
        .map(|font| {
            let family = font.family.as_deref().unwrap_or_default().to_lowercase();
            family.contains("mono") || family.contains("courier") || family.contains("consolas")
        })
        .filter(|mono| *mono)
        .count()
        >= group_lines.len()
}

fn is_caption_text(texts: &[String]) -> bool {
    let Some(first) = texts.first() else {
        return false;
    };
    let lower = first.trim().to_lowercase();
    let prefixes = [
        "figure", "fig.", "fig", "table", "chart", "diagram", "plate", "map",
    ];
    for prefix in prefixes {
        if lower.starts_with(prefix) {
            let rest = &lower[prefix.len()..];
            if rest.is_empty() {
                if let Some(second) = texts.get(1) {
                    let second_trimmed = second.trim();
                    if second_trimmed
                        .chars()
                        .next()
                        .is_some_and(|c| c.is_ascii_digit())
                    {
                        return true;
                    }
                }
            } else if rest.starts_with(char::is_whitespace)
                || rest.starts_with(['.', ':', '-', '—', '#'])
            {
                let after = rest.trim_start_matches(|c: char| {
                    c.is_whitespace() || c == '.' || c == ':' || c == '-' || c == '—' || c == '#'
                });
                if after.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                    return true;
                }
            } else if rest.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                return true;
            }
        }
    }
    false
}

/// Classify one paragraph group into a draft block.
pub fn classify_group(
    group_lines: &[&RawLine],
    words: &[RawWord],
    body_font_size: f64,
) -> DraftBlock {
    let (texts, refs) = assemble_group_words(group_lines, words);
    let bbox = group_lines
        .iter()
        .map(|line| line.bbox)
        .reduce(|acc, bbox| acc.union(&bbox))
        .unwrap_or_default();
    let max_size = group_lines
        .iter()
        .map(|line| line.line_height)
        .fold(0.0, f64::max);
    let all_bold = group_lines
        .iter()
        .flat_map(|line| line.word_indices.iter())
        .filter_map(|&i| words[i].font.as_ref())
        .map(|font| font.bold)
        .collect::<Vec<_>>();
    let bold_ratio = if all_bold.is_empty() {
        0.0
    } else {
        all_bold.iter().filter(|&&b| b).count() as f64 / all_bold.len() as f64
    };

    let kind = if is_monospace(group_lines, words) {
        PdfCanonicalBlockKind::Code
    } else if is_list_item(&texts) {
        PdfCanonicalBlockKind::List
    } else if group_lines.len() <= 4 && is_caption_text(&texts) {
        PdfCanonicalBlockKind::Caption
    } else if group_lines.len() <= HEADING_MAX_LINES
        && (max_size >= HEADING_SIZE_RATIO * body_font_size || bold_ratio >= 0.8)
        && !texts
            .last()
            .and_then(|t| t.chars().last())
            .is_some_and(|c| c == '.' || c == ',')
    {
        PdfCanonicalBlockKind::Heading
    } else {
        PdfCanonicalBlockKind::Paragraph
    };
    let confidence = match kind {
        PdfCanonicalBlockKind::Heading
        | PdfCanonicalBlockKind::Code
        | PdfCanonicalBlockKind::Caption => 0.85,
        PdfCanonicalBlockKind::List => 0.8,
        _ => 0.95,
    };
    DraftBlock {
        kind,
        word_texts: texts,
        word_refs: refs,
        bbox,
        confidence,
    }
}

/// CJK-aware join of word texts into block text: no space between CJK
/// characters, single space otherwise. De-hyphenation already merged
/// line-broken words into single entries; a word merely *ending* in a hyphen
/// is a standalone word and still gets a space after it.
pub fn join_block_text(texts: &[String]) -> String {
    let mut out = String::new();
    for (i, text) in texts.iter().enumerate() {
        if i == 0 {
            out.push_str(text);
            continue;
        }
        let prev = texts[i - 1].chars().last();
        let curr = text.chars().next();
        let cjk_adjacent = matches!((prev, curr), (Some(a), Some(b)) if is_cjk(a) && is_cjk(b));
        if !cjk_adjacent {
            out.push(' ');
        }
        out.push_str(text);
    }
    out
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x4E00..=0x9FFF   // CJK Unified
        | 0x3400..=0x4DBF // Extension A
        | 0xF900..=0xFAFF // Compatibility
        | 0x3000..=0x303F // CJK punctuation
        | 0x3040..=0x30FF // Hiragana/Katakana
    )
}

/// Extract list items from a list block's line texts.
pub fn list_items_from_lines(group_lines: &[&RawLine], words: &[RawWord]) -> Vec<String> {
    group_lines
        .iter()
        .map(|line| {
            line.word_indices
                .iter()
                .map(|&i| words[i].text.clone())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect()
}

pub fn to_source_region(page_number: u32, bbox: PdfRect) -> PdfSourceRegion {
    PdfSourceRegion { page_number, bbox }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::model::PdfFontInfo;

    fn word(text: &str, x: f64, y: f64, w: f64, h: f64, font: Option<PdfFontInfo>) -> RawWord {
        RawWord {
            text: text.into(),
            bbox: PdfRect::new(x, y, x + w, y + h),
            bbox_exact: true,
            baseline_y: y,
            font,
            rtl: false,
        }
    }

    fn serif(size: f64, bold: bool) -> Option<PdfFontInfo> {
        Some(PdfFontInfo {
            size,
            bold,
            italic: false,
            family: Some("serif".into()),
        })
    }

    fn line_of(y: f64, height: f64, word_indices: Vec<usize>) -> RawLine {
        RawLine {
            word_indices,
            bbox: PdfRect::new(100.0, y, 400.0, y + height),
            baseline_y: y,
            line_height: height,
            rtl: false,
        }
    }

    #[test]
    fn hyphen_across_lines_merges_with_provenance() {
        let words = vec![
            word("inter-", 100.0, 700.0, 30.0, 10.0, serif(10.0, false)),
            word("national", 100.0, 688.0, 50.0, 10.0, serif(10.0, false)),
        ];
        let lines = vec![line_of(700.0, 10.0, vec![0]), line_of(688.0, 10.0, vec![1])];
        let refs: Vec<&RawLine> = lines.iter().collect();
        let (texts, refs) = assemble_group_words(&refs, &words);
        assert_eq!(texts, vec!["international"]);
        assert_eq!(
            refs,
            vec![WordRef::Merged(0, 1, "international".to_string())]
        );
    }

    #[test]
    fn lexical_hyphen_compound_keeps_hyphen_across_break() {
        let words = vec![
            word("well-", 100.0, 700.0, 30.0, 10.0, serif(10.0, false)),
            word("known", 100.0, 688.0, 40.0, 10.0, serif(10.0, false)),
        ];
        let lines = vec![line_of(700.0, 10.0, vec![0]), line_of(688.0, 10.0, vec![1])];
        let line_refs: Vec<&RawLine> = lines.iter().collect();
        let (texts, _) = assemble_group_words(&line_refs, &words);
        assert_eq!(texts, vec!["well-known"]);
    }

    #[test]
    fn join_block_text_handles_cjk_and_spaces() {
        assert_eq!(
            join_block_text(&["The".into(), "quick".into()]),
            "The quick"
        );
        assert_eq!(join_block_text(&["名词".into(), "解释".into()]), "名词解释");
        assert_eq!(join_block_text(&["café".into()]), "café");
    }

    #[test]
    fn large_or_bold_short_blocks_are_headings() {
        let words = vec![word(
            "Chapter",
            100.0,
            700.0,
            80.0,
            24.0,
            serif(24.0, false),
        )];
        let lines = [line_of(700.0, 24.0, vec![0])];
        let group: Vec<&RawLine> = lines.iter().collect();
        let block = classify_group(&group, &words, 10.0);
        assert_eq!(block.kind, PdfCanonicalBlockKind::Heading);

        // Bold body-size short line without sentence punctuation is a heading.
        let words2 = vec![word("Results", 100.0, 700.0, 50.0, 10.0, serif(10.0, true))];
        let l2 = line_of(700.0, 10.0, vec![0]);
        let g2: Vec<&RawLine> = vec![&l2];
        assert_eq!(
            classify_group(&g2, &words2, 10.0).kind,
            PdfCanonicalBlockKind::Heading
        );

        // Sentence-like bold text stays a paragraph.
        let words3 = vec![word("Note.", 100.0, 700.0, 50.0, 10.0, serif(10.0, true))];
        let l3 = line_of(700.0, 10.0, vec![0]);
        let g3: Vec<&RawLine> = vec![&l3];
        assert_eq!(
            classify_group(&g3, &words3, 10.0).kind,
            PdfCanonicalBlockKind::Paragraph
        );
    }

    #[test]
    fn bullet_and_numbered_lines_are_lists() {
        assert!(is_list_item(&["•".into(), "First".into()]));
        assert!(is_list_item(&["1.".into(), "Intro".into()]));
        assert!(is_list_item(&["12)".into(), "Item".into()]));
        assert!(!is_list_item(&["The".into(), "quick".into()]));
        assert!(!is_list_item(&["2023".into(), "was".into()]));
    }

    #[test]
    fn monospace_lines_are_code() {
        let mono = Some(PdfFontInfo {
            size: 10.0,
            bold: false,
            italic: false,
            family: Some("Courier".into()),
        });
        let words = vec![word("let", 100.0, 700.0, 20.0, 10.0, mono.clone())];
        let line = line_of(700.0, 10.0, vec![0]);
        let group: Vec<&RawLine> = vec![&line];
        assert_eq!(
            classify_group(&group, &words, 10.0).kind,
            PdfCanonicalBlockKind::Code
        );
    }
}
