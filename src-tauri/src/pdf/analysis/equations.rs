//! Equation detection (task 6.3): display lines dominated by math signals
//! become equation blocks. Visual fidelity wins — the block renders as a
//! source crop; the native glyph text is kept as `alt_text` for search/TTS
//! and never rendered as flowing reflow text (D7).

use super::rows::RawLine;
use super::words::RawWord;

/// Characters that indicate math content.
const MATH_SYMBOLS: &[char] = &[
    '+', '=', '≠', '≈', '≤', '≥', '<', '>', '±', '×', '÷', '∑', '∫', '√', '∞', '∂', '∇', '→', '↔',
    'α', 'β', 'γ', 'δ', 'θ', 'λ', 'μ', 'π', 'σ', 'φ', 'ω', 'Γ', 'Δ', 'Ω',
];

/// A line is equation-like when at least this fraction of non-space
/// characters are math symbols/digits, or it uses caret sub/superscripts.
const MATH_CHAR_THRESHOLD: f64 = 0.2;

/// Minimum fraction of single-character words for the "glyph soup" signal.
const GLYPH_SOUP_RATIO: f64 = 0.5;

pub fn is_equation_line(line: &RawLine, words: &[RawWord]) -> bool {
    let line_words: Vec<&RawWord> = line.word_indices.iter().map(|&i| &words[i]).collect();
    let text: String = line_words
        .iter()
        .map(|w| w.text.clone())
        .collect::<Vec<_>>()
        .join("");
    let non_space: Vec<char> = text.chars().filter(|c| !c.is_whitespace()).collect();
    if non_space.is_empty() {
        return false;
    }
    // Math symbols only — digits alone (page numbers, years) are not
    // equations. Structure markers ( ^ _ = ) plus any symbol qualify;
    // symbol-dense lines ( ∑ x → ∞ ) qualify without them.
    let symbol_count = non_space
        .iter()
        .filter(|c| MATH_SYMBOLS.contains(c))
        .count();
    let has_structure = text.contains('^') || text.contains('_') || text.contains('=');
    if symbol_count >= 1 && has_structure {
        return true;
    }
    if symbol_count as f64 / non_space.len() as f64 >= MATH_CHAR_THRESHOLD {
        return true;
    }
    // Glyph soup: mostly single-char words (x = f(a)) with an equals sign.
    let single = line_words
        .iter()
        .filter(|w| w.text.chars().count() == 1)
        .count();
    line_words.len() >= 3
        && single as f64 / line_words.len() as f64 >= GLYPH_SOUP_RATIO
        && text.contains('=')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pdf::analysis::coordinates::PdfRect;

    fn word(text: &str) -> RawWord {
        RawWord {
            text: text.into(),
            bbox: PdfRect::new(0.0, 0.0, 10.0, 8.0),
            bbox_exact: true,
            baseline_y: 0.0,
            font: None,
            rtl: false,
        }
    }

    fn line_of(indices: Vec<usize>) -> RawLine {
        RawLine {
            word_indices: indices,
            bbox: PdfRect::new(0.0, 0.0, 100.0, 10.0),
            baseline_y: 0.0,
            line_height: 10.0,
            rtl: false,
        }
    }

    #[test]
    fn math_lines_are_detected() {
        let words = vec![word("E"), word("="), word("mc2")];
        assert!(is_equation_line(&line_of(vec![0, 1, 2]), &words));

        let sum = vec![word("∑i=1n"), word("xi"), word("→"), word("∞")];
        assert!(is_equation_line(&line_of(vec![0, 1, 2, 3]), &sum));

        let caret = vec![word("x^2"), word("+"), word("y_1")];
        assert!(is_equation_line(&line_of(vec![0, 1, 2]), &caret));
    }

    #[test]
    fn prose_lines_are_not_equations() {
        let words = vec![word("The"), word("quick"), word("brown"), word("fox")];
        assert!(!is_equation_line(&line_of(vec![0, 1, 2, 3]), &words));

        let sentence = vec![word("In"), word("2023"), word("results"), word("improved")];
        assert!(!is_equation_line(&line_of(vec![0, 1, 2, 3]), &sentence));

        // Bare numbers (page numbers, years) are not equations.
        let digits = vec![word("42")];
        assert!(!is_equation_line(&line_of(vec![0]), &digits));
    }
}
