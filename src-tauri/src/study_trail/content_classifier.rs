use crate::models::study_trail::StructuralClass;
use crate::study_trail::structural_analyzer::StructuralUnit;

#[derive(Debug, Clone, Default)]
pub struct ClassificationContext {
    pub allow_bibliography: bool,
    pub allow_toc: bool,
    pub allow_index: bool,
    pub allow_front_matter: bool,
}

impl ClassificationContext {
    /// Derives contextual exceptions from an objective/concept description.
    pub fn from_objective_text(objective: &str) -> Self {
        let lower = objective.to_ascii_lowercase();
        Self {
            allow_bibliography: lower.contains("bibliograph")
                || lower.contains("citation style")
                || lower.contains("literature review")
                || lower.contains("reference list"),
            allow_toc: lower.contains("table of contents") || lower.contains("book structure"),
            allow_index: lower.contains("book index") || lower.contains("indexing"),
            allow_front_matter: lower.contains("colophon")
                || lower.contains("copyright notice")
                || lower.contains("epigraph")
                || lower.contains("preface")
                || lower.contains("foreword"),
        }
    }

    pub fn is_permitted(&self, class: StructuralClass) -> bool {
        match class {
            StructuralClass::Bibliography => self.allow_bibliography,
            StructuralClass::Toc => self.allow_toc,
            StructuralClass::Index => self.allow_index,
            StructuralClass::FrontMatter => self.allow_front_matter,
            _ => !class.is_excluded_by_default(),
        }
    }
}

fn heading_matches(unit: &StructuralUnit, needles: &[&str]) -> bool {
    unit.heading_path.iter().any(|h| {
        let lower = h.trim().to_ascii_lowercase();
        needles.iter().any(|n| {
            lower == *n
                || lower.starts_with(&format!("{} ", n))
                || lower.starts_with(&format!("{}:", n))
                || lower.ends_with(&format!(" {}", n))
        })
    })
}

fn looks_like_toc(unit: &StructuralUnit) -> bool {
    if heading_matches(unit, &["table of contents", "contents", "toc"]) {
        return true;
    }
    let lower = unit.text.to_ascii_lowercase();
    let trimmed_lower = lower.trim_start();
    if trimmed_lower.starts_with("contents ")
        || trimmed_lower.starts_with("contents\n")
        || trimmed_lower.starts_with("table of contents")
        || lower.contains("notes bibliography index")
    {
        return true;
    }
    if lower.contains("contents") {
        let numbered_hits = (1..=8)
            .filter(|n| lower.contains(&format!(" {}. ", n)) || lower.contains(&format!("\n{}. ", n)))
            .count();
        let chapter_num_hits = (1..=6)
            .filter(|n| lower.contains(&format!("chapter {}", n)))
            .count();
        let chapter_word_hits = ["one", "two", "three", "four", "five", "six"]
            .iter()
            .filter(|w| lower.contains(&format!("chapter {}", w)))
            .count();
        if numbered_hits >= 3 || chapter_num_hits >= 3 || chapter_word_hits >= 3 {
            return true;
        }
    }
    let lines: Vec<&str> = unit.text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    if lines.len() < 3 {
        return false;
    }
    let toc_lines = lines
        .iter()
        .filter(|line| {
            let has_dots = line.contains("...") || line.contains("…");
            let ends_with_page = line
                .split_whitespace()
                .last()
                .is_some_and(|tok| tok.chars().all(|c| c.is_ascii_digit() || c == 'p'));
            let starts_chapter = {
                let l = line.to_ascii_lowercase();
                l.starts_with("chapter ") || l.starts_with("part ") || l.starts_with("section ")
            };
            (has_dots && ends_with_page) || (starts_chapter && ends_with_page && line.len() < 90)
        })
        .count();
    toc_lines * 2 >= lines.len()
}

fn looks_like_bibliography(unit: &StructuralUnit) -> bool {
    if heading_matches(
        unit,
        &[
            "bibliography",
            "references",
            "works cited",
            "selected bibliography",
            "further reading",
            "endnotes",
            "footnotes",
        ],
    ) || unit.heading_path.iter().any(|h| {
        let l = h.trim().to_ascii_lowercase();
        l == "notes" || l == "chapter notes" || l.starts_with("notes:") || l == "notes and references"
    }) {
        return true;
    }
    let lines: Vec<&str> = unit.text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    if lines.len() >= 3 {
        let cite_lines = lines
            .iter()
            .filter(|line| {
                let lower = line.to_ascii_lowercase();
                let has_year = (1900..=2030).any(|y| {
                    lower.contains(&format!("({})", y)) || lower.contains(&format!(" {}.", y))
                }) || lower.contains("et al.")
                    || lower.contains("doi:")
                    || lower.contains("pp.")
                    || lower.contains("http://")
                    || lower.contains("https://")
                    || lower.contains("www.")
                    || lower.contains("university press");
                has_year && line.len() < 320
            })
            .count();
        if cite_lines * 2 >= lines.len() {
            return true;
        }
    }

    // Flattened single-line bibliography or endnotes fallback
    let lower = unit.text.to_ascii_lowercase();
    let url_hits = lower.matches("http://").count()
        + lower.matches("https://").count()
        + lower.matches("www.").count();
    let bib_markers = lower.matches("et al.").count()
        + lower.matches("doi:").count()
        + lower.matches("pp.").count()
        + lower.matches("ibid.").count()
        + lower.matches("university press").count()
        + lower.matches("trans.").count();
    let year_hits = unit
        .text
        .split_whitespace()
        .filter(|tok| {
            let digits: String = tok.chars().filter(|c| c.is_ascii_digit()).collect();
            digits.len() == 4
                && digits
                    .parse::<u32>()
                    .is_ok_and(|y| (1900..=2030).contains(&y))
                && (tok.starts_with('(') || tok.ends_with('.') || tok.ends_with(','))
        })
        .count();

    (url_hits >= 2 && (year_hits >= 1 || unit.word_count <= 220))
        || (bib_markers >= 3 && year_hits >= 2)
        || (year_hits >= 4 && unit.word_count <= 220 && url_hits + bib_markers >= 2)
}

fn is_index_page_token(tok: &str) -> bool {
    let trimmed = tok.trim_matches(|c: char| matches!(c, ',' | ';' | '.' | '(' | ')'));
    if trimmed.is_empty() {
        return false;
    }
    let has_digit = trimmed.chars().any(|c| c.is_ascii_digit());
    has_digit
        && trimmed
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '-' | '–' | '—' | 'n' | 'f'))
}

fn looks_like_index(unit: &StructuralUnit) -> bool {
    if heading_matches(unit, &["index", "subject index", "name index", "author index"]) {
        return true;
    }
    let lower = unit.text.to_ascii_lowercase();
    if lower.contains("note about the index") || lower.contains("pages referenced in this index") {
        return true;
    }
    let tokens: Vec<&str> = unit.text.split_whitespace().collect();
    if tokens.len() >= 12 {
        let page_tokens = tokens.iter().filter(|t| is_index_page_token(t)).count();
        let has_see_also = lower.contains("see also ");
        if (page_tokens >= 6 && page_tokens * 8 >= tokens.len())
            || (has_see_also && page_tokens >= 4 && page_tokens * 12 >= tokens.len())
        {
            return true;
        }
    }

    let lines: Vec<&str> = unit.text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    if lines.len() < 4 {
        return false;
    }
    let index_lines = lines
        .iter()
        .filter(|line| {
            let parts: Vec<&str> = line.split(',').collect();
            parts.len() >= 2
                && parts[1..]
                    .iter()
                    .any(|p| p.trim().chars().any(|c| c.is_ascii_digit()))
                && !line.ends_with('.')
                && line.len() < 90
        })
        .count();
    index_lines * 2 >= lines.len()
}

fn looks_like_front_matter(unit: &StructuralUnit) -> bool {
    if heading_matches(
        unit,
        &[
            "copyright",
            "colophon",
            "dedication",
            "acknowledgments",
            "acknowledgements",
            "title page",
            "half title",
            "cover",
            "about the author",
            "also by",
            "praise for",
            "epigraph",
        ],
    ) {
        return true;
    }
    let lower = unit.text.to_ascii_lowercase();
    let markers = [
        "all rights reserved",
        "isbn ",
        "isbn:",
        "library of congress",
        "published by",
        "printed in the",
        "first published",
        "copyright ©",
        "copyright (c)",
        "thank you for downloading",
        "join our mailing list",
        "exclusive offers in your inbox",
        "about the author",
    ];
    let hits = markers.iter().filter(|m| lower.contains(*m)).count();
    hits >= 2 || (hits >= 1 && unit.word_count < 140)
}

fn sentence_count(text: &str) -> usize {
    text.split(['.', '!', '?'])
        .filter(|s| s.split_whitespace().count() >= 4)
        .count()
}

/// Deterministically classifies a structural unit's pedagogical content type.
pub fn classify_structural_unit(unit: &StructuralUnit) -> StructuralClass {
    if unit.is_repeated_running_line {
        return StructuralClass::RunningHeaderFooter;
    }
    if unit.is_heading_only || (unit.word_count < 12 && sentence_count(&unit.text) == 0) {
        return StructuralClass::HeadingOnly;
    }
    if looks_like_toc(unit) {
        return StructuralClass::Toc;
    }
    if looks_like_bibliography(unit) {
        return StructuralClass::Bibliography;
    }
    if looks_like_index(unit) {
        return StructuralClass::Index;
    }
    if looks_like_front_matter(unit) {
        return StructuralClass::FrontMatter;
    }

    let sentences = sentence_count(&unit.text);
    if unit.word_count < 28 || sentences < 2 {
        return StructuralClass::IncidentalMention;
    }

    let lower = unit.text.to_ascii_lowercase();
    if lower.contains("for example") || lower.contains("suppose that") || lower.contains("consider the case") {
        return StructuralClass::WorkedExample;
    }
    if lower.contains("is defined as") || lower.contains("means that") || lower.contains("refers to") {
        return StructuralClass::Definition;
    }
    if lower.contains("therefore") || lower.contains("it follows that") || lower.contains("premise") || lower.contains("because ") {
        return StructuralClass::Argument;
    }
    StructuralClass::InstructionalProse
}
