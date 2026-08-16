//! Word extraction from pdf.js text items (D6).
//!
//! pdf.js items are strings with a text-space transform; they are not
//! word-segmented. Words come from whitespace-splitting each item, with
//! per-word bboxes interpolated proportionally along the item's advance
//! direction (overlap-accurate, not glyph-exact — `bbox_exact` records the
//! distinction). Item text itself is preserved exactly.

use serde::Deserialize;

use super::coordinates::PdfRect;
use crate::pdf::model::PdfFontInfo;

/// A pdf.js `TextItem` as collected by the frontend
/// (`page.getTextContent({ disableCombineTextItems: true })`), with font
/// metadata pre-resolved from the text-content styles map.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextItemInput {
    #[serde(rename = "str")]
    pub text: String,
    /// Text-space → PDF-user-space transform `[a, b, c, d, e, f]`;
    /// `(e, f)` is the baseline origin.
    pub transform: [f64; 6],
    /// Advance extent in user units along the writing direction.
    pub width: f64,
    /// Glyph height in user units.
    pub height: f64,
    #[serde(default = "default_dir")]
    pub dir: String,
    #[serde(default)]
    pub font: Option<PdfFontInfo>,
    #[serde(default)]
    pub has_eol: bool,
}

fn default_dir() -> String {
    "ltr".into()
}

/// A word before reading-order assignment (ids come later, in reading order).
#[derive(Debug, Clone, PartialEq)]
pub struct RawWord {
    pub text: String,
    pub bbox: PdfRect,
    pub bbox_exact: bool,
    /// Baseline origin y (PDF user space) — the line-banding anchor.
    pub baseline_y: f64,
    pub font: Option<PdfFontInfo>,
    pub rtl: bool,
}

/// Fallback advance per character when an item reports zero width: half the
/// glyph height, a typical average for proportional Latin text.
const ZERO_WIDTH_ADVANCE_FACTOR: f64 = 0.5;

pub fn extract_words(items: &[TextItemInput]) -> Vec<RawWord> {
    let mut words = Vec::new();
    for item in items {
        // Boundary sanitization: a single non-finite transform/width/height
        // value would poison every downstream geometry computation with NaN
        // (line bboxes, ink subtraction, sorts). Degenerate-but-finite items
        // are handled below; non-finite ones have no usable geometry at all.
        let finite = item.transform.iter().all(|v| v.is_finite())
            && item.width.is_finite()
            && item.height.is_finite();
        if !finite {
            continue;
        }
        if item.text.chars().all(char::is_whitespace) {
            continue;
        }
        let origin = (item.transform[4], item.transform[5]);
        let advance_dir = unit_or_default(item.transform[0], item.transform[1], (1.0, 0.0));
        let up_dir = unit_or_default(item.transform[2], item.transform[3], (0.0, 1.0));
        let total_chars = item.text.chars().count().max(1) as f64;
        // Degenerate items still lay out along the advance direction.
        let advance_len = if item.width > 0.0 {
            item.width
        } else {
            total_chars * ZERO_WIDTH_ADVANCE_FACTOR * item.height.max(1.0)
        };
        let height = item.height.max(0.0);
        let rtl = item.dir.eq_ignore_ascii_case("rtl");

        let mut start_char = 0usize;
        let mut in_token = false;
        let mut token_start = 0usize;
        let mut char_index = 0usize;
        for (byte_index, ch) in item.text.char_indices() {
            let _ = byte_index;
            if ch.is_whitespace() {
                if in_token {
                    push_word(
                        &mut words,
                        item,
                        &token_start,
                        char_index,
                        start_char,
                        &mut start_char,
                        total_chars,
                        advance_len,
                        advance_dir,
                        up_dir,
                        origin,
                        height,
                        rtl,
                    );
                    in_token = false;
                }
            } else if !in_token {
                in_token = true;
                token_start = char_index;
            }
            char_index += 1;
        }
        if in_token {
            let end = item.text.chars().count();
            push_word(
                &mut words,
                item,
                &token_start,
                end,
                start_char,
                &mut start_char,
                total_chars,
                advance_len,
                advance_dir,
                up_dir,
                origin,
                height,
                rtl,
            );
        }
    }
    words
}

#[allow(clippy::too_many_arguments)]
fn push_word(
    words: &mut Vec<RawWord>,
    item: &TextItemInput,
    token_start: &usize,
    token_end: usize,
    _prev_start: usize,
    _start_out: &mut usize,
    total_chars: f64,
    advance_len: f64,
    advance_dir: (f64, f64),
    up_dir: (f64, f64),
    origin: (f64, f64),
    height: f64,
    rtl: bool,
) {
    let start_frac = *token_start as f64 / total_chars;
    let end_frac = token_end as f64 / total_chars;
    let ax = origin.0 + advance_dir.0 * start_frac * advance_len;
    let ay = origin.1 + advance_dir.1 * start_frac * advance_len;
    let bx = origin.0 + advance_dir.0 * end_frac * advance_len;
    let by = origin.1 + advance_dir.1 * end_frac * advance_len;
    let top_ax = ax + up_dir.0 * height;
    let top_ay = ay + up_dir.1 * height;
    let top_bx = bx + up_dir.0 * height;
    let top_by = by + up_dir.1 * height;
    let bbox = PdfRect::new(
        ax.min(top_ax).min(bx).min(top_bx),
        ay.min(top_ay).min(by).min(top_by),
        ax.max(top_ax).max(bx).max(top_bx),
        ay.max(top_ay).max(by).max(top_by),
    );
    let text: String = item
        .text
        .chars()
        .skip(*token_start)
        .take(token_end - *token_start)
        .collect();
    words.push(RawWord {
        text,
        bbox,
        bbox_exact: token_end - *token_start == total_chars as usize,
        baseline_y: origin.1,
        font: item.font.clone(),
        rtl,
    });
}

fn unit_or_default(x: f64, y: f64, default: (f64, f64)) -> (f64, f64) {
    let norm = (x * x + y * y).sqrt();
    if norm < 1e-9 {
        default
    } else {
        (x / norm, y / norm)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Horizontal LTR item at (100, 700), 10pt font, 200pt wide.
    fn item(text: &str, width: f64) -> TextItemInput {
        TextItemInput {
            text: text.into(),
            transform: [10.0, 0.0, 0.0, 10.0, 100.0, 700.0],
            width,
            height: 10.0,
            dir: "ltr".into(),
            font: Some(PdfFontInfo {
                size: 10.0,
                bold: false,
                italic: false,
                family: Some("serif".into()),
            }),
            has_eol: false,
        }
    }

    #[test]
    fn splits_on_whitespace_with_proportional_boxes() {
        // "The quick" over 180pt: "The" (3/9 chars) → 60pt wide from x=100.
        let words = extract_words(&[item("The quick", 180.0)]);
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "The");
        assert_eq!(words[1].text, "quick");
        assert!((words[0].bbox.x0 - 100.0).abs() < 1e-9);
        assert!((words[0].bbox.x1 - 160.0).abs() < 1e-9);
        // "quick" spans chars 4..9 → its box starts after the space's
        // proportional advance (4/9 × 180pt = 80pt from the origin).
        assert!((words[1].bbox.x0 - 180.0).abs() < 1e-9);
        assert!((words[1].bbox.x1 - 280.0).abs() < 1e-9);
        // Height extends upward from the baseline.
        assert!((words[0].bbox.y0 - 700.0).abs() < 1e-9);
        assert!((words[0].bbox.y1 - 710.0).abs() < 1e-9);
        assert!(!words[0].bbox_exact);
        assert_eq!(words[0].baseline_y, 700.0);
    }

    #[test]
    fn single_word_item_has_exact_bbox() {
        let words = extract_words(&[item("genome", 60.0)]);
        assert_eq!(words.len(), 1);
        assert!(words[0].bbox_exact);
        assert!((words[0].bbox.x0 - 100.0).abs() < 1e-9);
        assert!((words[0].bbox.x1 - 160.0).abs() < 1e-9);
    }

    #[test]
    fn whitespace_only_items_are_skipped_and_leading_trailing_trimmed() {
        let words = extract_words(&[item("  \t ", 50.0), item(" hello world ", 120.0)]);
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "hello");
        assert_eq!(words[1].text, "world");
    }

    #[test]
    fn unicode_text_preserves_characters_exactly() {
        // Ligature, CJK run, and combining mark must survive verbatim.
        let words = extract_words(&[item("ﬁle café 名词", 200.0)]);
        let texts: Vec<&str> = words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(texts, vec!["ﬁle", "café", "名词"]);
    }

    #[test]
    fn zero_width_items_still_get_geometry() {
        let words = extract_words(&[item("A", 0.0)]);
        assert_eq!(words.len(), 1);
        assert_eq!(words[0].text, "A");
        assert!(words[0].bbox.width() > 0.0);
        assert!(words[0].bbox.height() > 0.0);
    }

    #[test]
    fn rotated_text_advances_along_its_transform() {
        // 90° rotated text: advance +y, up −x (matrix [0,1,-1,0]).
        let rotated = TextItemInput {
            text: "abc def".into(),
            transform: [0.0, 10.0, -10.0, 0.0, 300.0, 100.0],
            width: 140.0,
            height: 10.0,
            dir: "ltr".into(),
            font: None,
            has_eol: false,
        };
        let words = extract_words(&[rotated]);
        assert_eq!(words.len(), 2);
        // "abc" advances from y=100 to y=160; glyph tops extend to x=290.
        assert!((words[0].bbox.y0 - 100.0).abs() < 1e-9);
        assert!((words[0].bbox.y1 - 160.0).abs() < 1e-9);
        assert!((words[0].bbox.x0 - 290.0).abs() < 1e-9);
        assert!((words[0].bbox.x1 - 300.0).abs() < 1e-9);
    }

    #[test]
    fn rtl_flag_is_carried_from_item_dir() {
        let mut rtl_item = item("مرحبا", 50.0);
        rtl_item.dir = "rtl".into();
        let words = extract_words(&[rtl_item]);
        assert!(words[0].rtl);
    }
}
