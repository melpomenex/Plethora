//! Paragraph reconstruction (D6): merges banded lines into paragraph groups
//! using vertical gaps, indentation, and font signals, and performs
//! conservative de-hyphenation with retained provenance.
//!
//! All thresholds are relative to the page's median line height/leading so
//! the same constants work for 9pt footnotes and 24pt titles.

use super::rows::RawLine;
use super::words::RawWord;

/// A leading gap beyond this multiple of the median leading starts a new
/// paragraph.
const PARAGRAPH_GAP_FACTOR: f64 = 1.45;

/// A left edge this far right of the body edge (in median line heights)
/// counts as indentation.
const INDENT_FACTOR: f64 = 0.8;

/// The previous line must end this far short of the body right edge for an
/// indented next line to be a new paragraph (classic first-line indent).
const SHORT_LINE_FACTOR: f64 = 1.5;

/// Font sizes differing by more than this ratio belong to different blocks.
const FONT_BUCKET_RATIO: f64 = 1.2;

#[derive(Debug, Clone, PartialEq)]
pub struct ParagraphGroup {
    /// Line indices (into the page line slice) in reading order.
    pub line_indices: Vec<usize>,
}

#[derive(Debug, Clone, Copy)]
struct LineMetrics {
    body_x0: f64,
    body_x1: f64,
    median_leading: f64,
    median_height: f64,
}

fn median(values: &mut Vec<f64>) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.total_cmp(b));
    values[values.len() / 2]
}

fn line_metrics(lines: &[RawLine]) -> LineMetrics {
    let mut x0s: Vec<f64> = lines.iter().map(|line| line.bbox.x0).collect();
    let mut x1s: Vec<f64> = lines.iter().map(|line| line.bbox.x1).collect();
    let mut heights: Vec<f64> = lines.iter().map(|line| line.line_height).collect();
    let mut leadings: Vec<f64> = Vec::new();
    for pair in lines.windows(2) {
        // Lines are ordered top-first (baseline decreasing); positive gap =
        // distance moved down the page.
        let gap = pair[0].baseline_y - pair[1].baseline_y;
        if gap > 0.0 {
            leadings.push(gap);
        }
    }
    LineMetrics {
        body_x0: median(&mut x0s),
        body_x1: median(&mut x1s),
        median_leading: median(&mut leadings).max(1.0),
        median_height: median(&mut heights).max(1.0),
    }
}

pub fn group_paragraphs(lines: &[RawLine]) -> Vec<ParagraphGroup> {
    if lines.is_empty() {
        return Vec::new();
    }
    let metrics = line_metrics(lines);
    let mut groups: Vec<ParagraphGroup> = Vec::new();
    let mut current: Vec<usize> = vec![0];

    for pair in 1..lines.len() {
        let prev = &lines[pair - 1];
        let next = &lines[pair];
        let gap = prev.baseline_y - next.baseline_y;
        let font_leading = metrics.median_height * 1.35;
        let effective_leading = metrics.median_leading.min(font_leading);
        let big_gap = gap > PARAGRAPH_GAP_FACTOR * effective_leading;
        let next_indented = next.bbox.x0 > metrics.body_x0 + INDENT_FACTOR * metrics.median_height;
        let prev_short = prev.bbox.x1 < metrics.body_x1 - SHORT_LINE_FACTOR * metrics.median_height;
        let font_shift = prev.line_height.max(1.0) / next.line_height.max(1.0);
        let font_break = font_shift > FONT_BUCKET_RATIO || font_shift < 1.0 / FONT_BUCKET_RATIO;
        let rtl_flip = prev.rtl != next.rtl;

        if big_gap || (next_indented && prev_short) || font_break || rtl_flip {
            groups.push(ParagraphGroup {
                line_indices: std::mem::take(&mut current),
            });
        }
        current.push(pair);
    }
    groups.push(ParagraphGroup {
        line_indices: current,
    });
    groups
}

/// Common hyphenated compounds: when one of these is split across a line
/// break, the hyphen is lexical and must survive the merge. The list is
/// deliberately small — unknown lowercase continuations default to the
/// statistically common case (soft line-wrap hyphenation) and provenance is
/// retained either way.
const LEXICAL_HYPHEN_COMPOUNDS: &[&str] = &[
    "co-author",
    "co-worker",
    "cross-reference",
    "custom-built",
    "decision-making",
    "double-check",
    "end-to-end",
    "face-to-face",
    "first-class",
    "free-for-all",
    "full-scale",
    "high-level",
    "high-performance",
    "large-scale",
    "left-hand",
    "long-term",
    "low-level",
    "machine-generated",
    "middle-class",
    "next-generation",
    "non-trivial",
    "north-america",
    "north-east",
    "north-west",
    "open-source",
    "part-of-speech",
    "pre-processing",
    "real-world",
    "right-hand",
    "second-hand",
    "self-contained",
    "short-term",
    "single-column",
    "so-called",
    "south-america",
    "south-east",
    "south-west",
    "state-of-the-art",
    "third-party",
    "user-defined",
    "well-being",
    "well-defined",
    "well-designed",
    "well-documented",
    "well-known",
    "wide-ranging",
    "zero-based",
];

/// The merge decision for a line-ending hyphen (D6): join only when the
/// hyphen is line-final and the continuation starts a lowercase letter.
/// Compounds in the lexical list keep their hyphen; all other merges are
/// treated as soft line-wrap hyphenation. Capitalized continuations stay
/// split (too ambiguous); provenance is retained in every branch.
pub fn should_dehyphenate(prev_word: &str, next_word: &str) -> bool {
    let Some(stripped) = prev_word.strip_suffix('-') else {
        return false;
    };
    if stripped.is_empty() {
        return false;
    }
    next_word.chars().next().is_some_and(char::is_lowercase)
}

/// Whether a hyphen-ending join is a lexical compound (hyphen survives).
pub fn is_lexical_hyphen_compound(prev_word: &str, next_word: &str) -> bool {
    let joined = format!(
        "{}-{}",
        prev_word
            .strip_suffix('-')
            .unwrap_or(prev_word)
            .to_lowercase(),
        next_word.to_lowercase()
    );
    LEXICAL_HYPHEN_COMPOUNDS.contains(&joined.as_str())
}

/// Join two hyphen-split fragments into the canonical merged word text.
/// Lexical compounds keep the hyphen; soft hyphenation drops it.
pub fn dehyphenate_text(prev_word: &str, next_word: &str) -> String {
    let keep_hyphen = is_lexical_hyphen_compound(prev_word, next_word);
    let mut merged = String::with_capacity(prev_word.len() + next_word.len() + 1);
    if keep_hyphen {
        merged.push_str(prev_word);
    } else {
        merged.push_str(prev_word.strip_suffix('-').unwrap_or(prev_word));
    }
    merged.push_str(next_word);
    merged
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::analysis::coordinates::PdfRect;

    fn line(y: f64, x0: f64, x1: f64, height: f64) -> RawLine {
        RawLine {
            word_indices: vec![],
            bbox: PdfRect::new(x0, y, x1, y + height),
            baseline_y: y,
            line_height: height,
            rtl: false,
        }
    }

    /// Body text: x 100..500, leading 12, height 10.
    fn body_lines(count: usize) -> Vec<RawLine> {
        (0..count)
            .map(|i| {
                line(
                    700.0 - i as f64 * 12.0,
                    100.0,
                    495.0 - (i % 3) as f64 * 2.0,
                    10.0,
                )
            })
            .collect()
    }

    #[test]
    fn continuous_lines_form_one_paragraph() {
        let groups = group_paragraphs(&body_lines(5));
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].line_indices, vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn vertical_gap_splits_paragraphs() {
        let mut lines = body_lines(3);
        // Gap of 30 ≈ 2.5 × leading 12 → new paragraph.
        lines.push(line(700.0 - 3.0 * 12.0 - 30.0, 100.0, 490.0, 10.0));
        lines.push(line(700.0 - 3.0 * 12.0 - 30.0 - 12.0, 100.0, 490.0, 10.0));
        let groups = group_paragraphs(&lines);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[1].line_indices, vec![3, 4]);
    }

    #[test]
    fn indented_line_after_short_line_starts_paragraph() {
        let mut lines = body_lines(2);
        // Second body line ends far short of the right edge…
        lines[1] = line(688.0, 100.0, 340.0, 10.0);
        // …and the next line is indented → classic first-line indent.
        lines.push(line(676.0, 120.0, 490.0, 10.0));
        lines.push(line(664.0, 100.0, 490.0, 10.0));
        let groups = group_paragraphs(&lines);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[1].line_indices, vec![2, 3]);
    }

    #[test]
    fn font_size_change_splits_blocks() {
        let mut lines = body_lines(2);
        lines.push(line(664.0, 100.0, 480.0, 24.0)); // heading-sized
        let groups = group_paragraphs(&lines);
        assert_eq!(groups.len(), 2);
    }

    #[test]
    fn hyphen_merges_only_with_lowercase_continuation() {
        assert!(should_dehyphenate("inter-", "national"));
        assert!(should_dehyphenate("gene-", "ralized"));
        assert!(should_dehyphenate("Nine-", "teenth"));
        // Capitalized continuation: too ambiguous (compound or new
        // sentence) — both words stand.
        assert!(!should_dehyphenate("inter-", "National"));
        // No trailing hyphen: never merge.
        assert!(!should_dehyphenate("state", "of"));
        // Bare hyphen: nothing to keep on the left.
        assert!(!should_dehyphenate("-", "day"));
        assert_eq!(dehyphenate_text("inter-", "national"), "international");
        assert_eq!(dehyphenate_text("Nine-", "teenth"), "Nineteenth");
        // Lexical compound split across a break keeps its hyphen.
        assert_eq!(dehyphenate_text("well-", "known"), "well-known");
        assert!(is_lexical_hyphen_compound("well-", "known"));
        assert!(!is_lexical_hyphen_compound("inter-", "national"));
    }

    #[test]
    fn empty_input_returns_no_groups() {
        assert!(group_paragraphs(&[]).is_empty());
    }
}
