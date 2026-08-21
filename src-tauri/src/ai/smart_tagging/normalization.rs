//! Canonicalization, duplicate prevention, and tag normalization
//!
//! Provides case-insensitive matching, singular/plural consolidation,
//! hyphenation/whitespace normalization, and taxonomy alignment.

use std::collections::HashMap;

/// Normalize a raw tag string for comparison:
/// - Lowercase
/// - Replace hyphens, underscores, and multiple whitespace with a single space
/// - Strip trailing 's' / 'es' for simple plural matching
pub fn normalize_for_comparison(tag: &str) -> String {
    let mut cleaned = String::new();
    let mut prev_space = false;

    for ch in tag.chars() {
        if ch.is_alphanumeric() {
            cleaned.push(ch.to_ascii_lowercase());
            prev_space = false;
        } else if (ch == '-' || ch == '_' || ch.is_whitespace() || ch == '/') && !prev_space {
            if !cleaned.is_empty() {
                cleaned.push(' ');
                prev_space = true;
            }
        }
    }

    let trimmed = cleaned.trim();
    trimmed.to_string()
}

/// Convert a normalized string to singular stem for comparison
pub fn to_singular_stem(norm: &str) -> String {
    let mut stem = norm.to_string();
    if stem.ends_with("ies") && stem.len() > 4 {
        stem.truncate(stem.len() - 3);
        stem.push('y');
    } else if stem.ends_with("es") && stem.len() > 3 {
        // e.g. classes -> class, but not games -> gam
        if stem.ends_with("sses") || stem.ends_with("shes") || stem.ends_with("ches") || stem.ends_with("xes") {
            stem.truncate(stem.len() - 2);
        } else {
            stem.truncate(stem.len() - 1);
        }
    } else if stem.ends_with('s') && !stem.ends_with("ss") && stem.len() > 2 {
        stem.truncate(stem.len() - 1);
    }
    stem
}

/// Format a tag with clean title casing for display
pub fn to_display_casing(raw: &str) -> String {
    let parts: Vec<&str> = raw.split_whitespace().collect();
    let mut result = Vec::new();

    let minor_words = ["and", "or", "of", "in", "the", "a", "an", "for", "to", "on", "with"];

    for (i, word) in parts.iter().enumerate() {
        let lower = word.to_lowercase();
        // Check acronyms / short tokens (e.g. "AI", "ML", "CPU", "GPU", "OS", "DB", "SQL", "HTML", "CSS", "API")
        let upper_acronyms = ["ai", "ml", "cpu", "gpu", "os", "db", "sql", "html", "css", "api", "tcp", "ip", "udp", "http", "llm", "rag", "ui", "ux", "toc"];
        if upper_acronyms.contains(&lower.as_str()) {
            result.push(lower.to_uppercase());
        } else if i > 0 && minor_words.contains(&lower.as_str()) {
            result.push(lower);
        } else {
            let mut c = word.chars();
            match c.next() {
                None => {}
                Some(f) => {
                    let capitalized = f.to_uppercase().collect::<String>() + c.as_str();
                    result.push(capitalized);
                }
            }
        }
    }

    result.join(" ")
}

/// Canonicalize a candidate tag against the user's existing taxonomy.
///
/// If a matching existing tag is found (case-insensitive, singular/plural, or hyphen/space variant),
/// the existing tag's exact string is returned to preserve user taxonomy and avoid synonym proliferation.
pub fn canonicalize_tag(candidate: &str, existing_tags: &[String]) -> String {
    let candidate_norm = normalize_for_comparison(candidate);
    let candidate_stem = to_singular_stem(&candidate_norm);

    if candidate_norm.is_empty() {
        return candidate.trim().to_string();
    }

    // 1. Exact or case-insensitive match
    for existing in existing_tags {
        if existing.eq_ignore_ascii_case(candidate.trim()) {
            return existing.clone();
        }
    }

    // 2. Normalized match (hyphens / underscores / spaces)
    for existing in existing_tags {
        let ext_norm = normalize_for_comparison(existing);
        if ext_norm == candidate_norm {
            return existing.clone();
        }
    }

    // 3. Singular / plural stem match
    for existing in existing_tags {
        let ext_norm = normalize_for_comparison(existing);
        let ext_stem = to_singular_stem(&ext_norm);
        if ext_stem == candidate_stem {
            return existing.clone();
        }
    }

    // 4. Known common synonym / acronym mappings if present in existing taxonomy
    let known_synonyms: &[(&[&str], &str)] = &[
        (&["machine learning", "ml"], "Machine Learning"),
        (&["artificial intelligence", "ai"], "Artificial Intelligence"),
        (&["operating systems", "operating system", "os"], "Operating Systems"),
        (&["deep learning", "dl"], "Deep Learning"),
        (&["natural language processing", "nlp"], "Natural Language Processing"),
        (&["computer science", "cs"], "Computer Science"),
        (&["large language model", "large language models", "llm", "llms"], "Large Language Models"),
    ];

    for (synonyms, _canonical) in known_synonyms {
        let is_candidate_in_group = synonyms.iter().any(|s| normalize_for_comparison(s) == candidate_norm || to_singular_stem(&normalize_for_comparison(s)) == candidate_stem);
        if is_candidate_in_group {
            for existing in existing_tags {
                let ext_norm = normalize_for_comparison(existing);
                let ext_stem = to_singular_stem(&ext_norm);
                if synonyms.iter().any(|s| normalize_for_comparison(s) == ext_norm || to_singular_stem(&normalize_for_comparison(s)) == ext_stem) {
                    return existing.clone();
                }
            }
        }
    }

    // 5. If no existing match found, format candidate nicely
    to_display_casing(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_case_and_hyphen_normalization() {
        let existing = vec!["Computer Science".to_string(), "Machine Learning".to_string()];
        assert_eq!(canonicalize_tag("computer-science", &existing), "Computer Science");
        assert_eq!(canonicalize_tag("COMPUTER SCIENCE", &existing), "Computer Science");
        assert_eq!(canonicalize_tag("computer_science", &existing), "Computer Science");
    }

    #[test]
    fn test_singular_plural_consolidation() {
        let existing = vec!["Operating System".to_string()];
        assert_eq!(canonicalize_tag("Operating Systems", &existing), "Operating System");

        let existing2 = vec!["Algorithms".to_string()];
        assert_eq!(canonicalize_tag("Algorithm", &existing2), "Algorithms");
    }

    #[test]
    fn test_synonym_mapping_to_existing_tag() {
        let existing = vec!["Machine Learning".to_string()];
        assert_eq!(canonicalize_tag("ML", &existing), "Machine Learning");
    }

    #[test]
    fn test_display_casing_for_new_tags() {
        assert_eq!(to_display_casing("linear algebra"), "Linear Algebra");
        assert_eq!(to_display_casing("cpu scheduling"), "CPU Scheduling");
        assert_eq!(to_display_casing("theory of mind"), "Theory of Mind");
    }
}
