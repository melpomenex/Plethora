//! Candidate tag retrieval and ranking from user's existing taxonomy
//!
//! Ranks and returns top candidate tags (bounded to 30) from the user's library
//! based on lexical overlap, term salience, and library frequency.

use std::collections::HashMap;
use super::normalization::{normalize_for_comparison, to_singular_stem};
use super::salience::ScoredTerm;

#[derive(Debug, Clone)]
pub struct CandidateTag {
    pub tag: String,
    pub score: f64,
    pub item_count: i32,
    pub match_type: &'static str,
}

/// Retrieve and rank the top candidate tags from the user's existing taxonomy.
pub fn rank_candidate_tags(
    existing_tags: &[(String, i32)], // (tag_name, item_count)
    title: &str,
    headings: &[&str],
    salient_terms: &[ScoredTerm],
    limit: usize,
) -> Vec<CandidateTag> {
    let lower_title = title.to_lowercase();
    let norm_title = normalize_for_comparison(title);
    let title_stem = to_singular_stem(&norm_title);

    let mut term_scores: HashMap<String, f64> = HashMap::new();
    for st in salient_terms {
        let norm = normalize_for_comparison(&st.term);
        let stem = to_singular_stem(&norm);
        term_scores.insert(norm, st.score);
        term_scores.insert(stem, st.score);
    }

    let mut candidates = Vec::new();

    for (tag, item_count) in existing_tags {
        let tag_trimmed = tag.trim();
        if tag_trimmed.is_empty() {
            continue;
        }

        let norm_tag = normalize_for_comparison(tag_trimmed);
        let stem_tag = to_singular_stem(&norm_tag);

        let mut score = 0.0;
        let mut match_type = "none";

        // 1. Direct title exact or substring match
        if norm_title == norm_tag || title_stem == stem_tag {
            score += 10.0;
            match_type = "title-exact";
        } else if lower_title.contains(&tag_trimmed.to_lowercase()) || norm_title.contains(&norm_tag) {
            score += 7.0;
            match_type = "title-contains";
        }

        // 2. Headings match
        for heading in headings {
            let norm_h = normalize_for_comparison(heading);
            if norm_h.contains(&norm_tag) || norm_h.contains(&stem_tag) {
                score += 4.0;
                if match_type == "none" {
                    match_type = "heading-contains";
                }
            }
        }

        // 3. Salient term match
        if let Some(&term_score) = term_scores.get(&norm_tag).or_else(|| term_scores.get(&stem_tag)) {
            score += term_score * 2.0;
            if match_type == "none" {
                match_type = "salient-term";
            }
        } else {
            // Check word-level overlap with multi-word existing tags
            let tag_words: Vec<&str> = norm_tag.split_whitespace().collect();
            if tag_words.len() > 1 {
                let mut word_matches = 0;
                for w in &tag_words {
                    if term_scores.contains_key(*w) || term_scores.contains_key(&to_singular_stem(w)) {
                        word_matches += 1;
                    }
                }
                if word_matches == tag_words.len() {
                    score += 3.5;
                    if match_type == "none" {
                        match_type = "phrase-overlap";
                    }
                } else if word_matches > 0 {
                    score += 1.0 * (word_matches as f64);
                }
            }
        }

        // 4. Frequency / Popularity tie-breaker bonus
        if score > 0.0 {
            let popularity_bonus = (*item_count as f64).ln_1p() * 0.2;
            score += popularity_bonus;

            candidates.push(CandidateTag {
                tag: tag.clone(),
                score,
                item_count: *item_count,
                match_type,
            });
        }
    }

    candidates.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    if candidates.len() > limit {
        candidates.truncate(limit);
    }

    candidates
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_candidate_retrieval_ranking() {
        let existing = vec![
            ("Machine Learning".to_string(), 50),
            ("Operating Systems".to_string(), 30),
            ("Differential Equations".to_string(), 10),
            ("Ancient Rome".to_string(), 5),
        ];

        let salient = vec![
            ScoredTerm {
                term: "machine learning".to_string(),
                score: 6.0,
                frequency: 4,
                is_phrase: true,
            },
        ];

        let candidates = rank_candidate_tags(
            &existing,
            "An Introduction to Machine Learning and Neural Networks",
            &[],
            &salient,
            30,
        );

        assert!(!candidates.is_empty());
        assert_eq!(candidates[0].tag, "Machine Learning");
        assert!(candidates[0].score > 5.0);
    }
}
