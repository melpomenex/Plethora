//! Recurring marginal element detection (D5): headers, footers, and page
//! numbers are *classified, never deleted* — they carry a role, render in
//! the Original view, and are suppressed only in reflow. Recurrence evidence
//! comes from neighboring analyzed pages supplied by the scheduler as
//! normalized marginal texts.

/// Normalize marginal text for recurrence matching: collapse whitespace,
/// lowercase, and replace runs of digits with `#` so "Page 12" matches
/// "Page 47".
pub fn normalize_marginal_text(text: &str) -> String {
    let lower = text.trim().to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut in_run = false;
    for ch in lower.chars() {
        if ch.is_ascii_digit() {
            if !in_run {
                out.push('#');
                in_run = true;
            }
        } else {
            in_run = false;
            if ch.is_whitespace() {
                out.push(' ');
            } else {
                out.push(ch);
            }
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A marginal text recurring on at least `MIN_RECURRENCE` neighbor pages is
/// a running header/footer.
const MIN_RECURRENCE: usize = 2;

pub fn is_recurring_marginal(text: &str, neighbor_texts: &[String]) -> bool {
    let normalized = normalize_marginal_text(text);
    if normalized.is_empty() {
        return false;
    }
    neighbor_texts
        .iter()
        .filter(|candidate| normalize_marginal_text(candidate) == normalized)
        .count()
        >= MIN_RECURRENCE
}

/// Bare page numbers: "12", "12.", "- 12 -", roman numerals.
pub fn is_page_number(text: &str) -> bool {
    let trimmed: String = text
        .trim()
        .trim_matches(['-', '–', '.', ' ', ','])
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    if trimmed.is_empty() || trimmed.len() > 6 {
        return false;
    }
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    matches!(
        trimmed.to_lowercase().as_str(),
        "i" | "ii" | "iii" | "iv" | "v" | "vi" | "vii" | "viii" | "ix" | "x" | "xi" | "xii"
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarginalRole {
    Header,
    Footer,
    PageNumber,
}

/// Vertical fraction of the content height at the top/bottom treated as the
/// marginal zone.
pub const MARGINAL_ZONE_FRACTION: f64 = 0.08;

/// Classify one marginal-zone line given its position and neighbor
/// recurrence evidence. `is_top` selects header vs footer; page numbers are
/// recognized in either zone.
pub fn classify_marginal_line(
    text: &str,
    is_top: bool,
    neighbor_texts: &[String],
) -> Option<MarginalRole> {
    if is_page_number(text) {
        return Some(MarginalRole::PageNumber);
    }
    if is_recurring_marginal(text, neighbor_texts) {
        return Some(if is_top {
            MarginalRole::Header
        } else {
            MarginalRole::Footer
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_collapses_digits_and_whitespace() {
        assert_eq!(
            normalize_marginal_text("  Chapter   3: Results "),
            "chapter #: results"
        );
        assert_eq!(
            normalize_marginal_text("Page 12"),
            normalize_marginal_text("Page 47")
        );
        assert_eq!(normalize_marginal_text("Page 12"), "page #");
    }

    #[test]
    fn recurrence_requires_two_neighbors() {
        let neighbors = vec![
            "Chapter 3: Results".to_string(),
            "chapter 9: results".to_string(),
        ];
        assert!(is_recurring_marginal("CHAPTER 3: RESULTS", &neighbors));
        assert!(!is_recurring_marginal("Different text", &neighbors));
        assert!(!is_recurring_marginal("Chapter 3: Results", &[]));
    }

    #[test]
    fn page_numbers_are_recognized_in_common_formats() {
        for text in ["12", " 12 ", "- 12 -", "12.", "xii", "XII"] {
            assert!(is_page_number(text), "{text}");
        }
        assert!(!is_page_number("12 results"));
        assert!(!is_page_number(""));
        assert!(!is_page_number("Results"));
    }

    #[test]
    fn classification_prefers_page_number_then_recurrence() {
        let neighbors = vec!["Running Head".to_string(), "running head".to_string()];
        assert_eq!(
            classify_marginal_line("42", false, &[]),
            Some(MarginalRole::PageNumber)
        );
        assert_eq!(
            classify_marginal_line("Running Head", true, &neighbors),
            Some(MarginalRole::Header)
        );
        assert_eq!(
            classify_marginal_line("Running Head", false, &neighbors),
            Some(MarginalRole::Footer)
        );
        assert_eq!(
            classify_marginal_line("Unique intro line", true, &neighbors),
            None
        );
    }
}
