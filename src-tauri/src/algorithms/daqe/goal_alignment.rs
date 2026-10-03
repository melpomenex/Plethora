//! Local lexical alignment between a session goal and a candidate item.
//!
//! This is what makes the goal-relevance term work with **no decision model
//! configured**. It is deliberately crude and deliberately cheap: a ranker that
//! cannot rank without a paid API is a ranker most users never get, and the term has
//! to have an honest value before any provider is ever contacted.
//!
//! It never claims more than it knows. `None` means "no goal, or nothing comparable
//! to compare against" and flows all the way to `TermValue::unavailable()`, which is
//! what keeps the term from presenting a guess as a measurement.

/// Function words that carry no topical intent.
///
/// Small and fixed rather than a general stopword list: the goal is a short phrase
/// the user typed, so the only words worth dropping are the ones that would otherwise
/// appear in every goal and every item and dilute every ratio.
const STOPWORDS: &[&str] = &[
    "the", "and", "for", "with", "from", "into", "that", "this", "these", "those", "are", "was",
    "were", "have", "has", "had", "not", "but", "you", "your", "our", "its", "it's", "about",
    "over", "under", "some", "any", "all", "can", "will", "just", "get", "got", "use", "using",
    "how", "why", "what", "when", "where", "who", "which", "than", "then", "them", "they",
];

/// How much of a candidate's body the scorer reads, in characters.
///
/// The goal is a topic statement, so the opening of an item says as much as the tail
/// would, and an unbounded read over a 5 000-item pool is the one way this function
/// could threaten the 150 ms budget it runs inside.
const MAX_BODY_CHARS: usize = 2_000;

/// Field prominence. Weights sum to 1.0, so the result is already in `[0,1]`.
const TAG_WEIGHT: f64 = 0.5;
const TITLE_WEIGHT: f64 = 0.3;
const BODY_WEIGHT: f64 = 0.2;

/// Split text into comparable tokens.
///
/// Alphanumeric runs only, lowercased, with tokens shorter than three characters and
/// known function words dropped. Returns an empty vector rather than a partial set, so
/// a caller can treat "nothing to compare" as a single case.
fn tokenize(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|token| token.len() >= 3)
        .map(|token| token.to_lowercase())
        .filter(|token| !STOPWORDS.contains(&token.as_str()))
        .collect()
}

/// The fraction of `goal_tokens` that appear in `text`.
///
/// Deduplicated on both sides: a goal that repeats a word is still one requirement,
/// and counting it twice would let padding manufacture relevance.
fn coverage(goal_tokens: &[String], text: &str) -> f64 {
    if goal_tokens.is_empty() || text.trim().is_empty() {
        return 0.0;
    }
    let haystack: std::collections::HashSet<String> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(str::to_lowercase)
        .collect();
    let distinct: std::collections::HashSet<&String> = goal_tokens.iter().collect();
    if distinct.is_empty() {
        return 0.0;
    }
    let matched = distinct
        .iter()
        .filter(|token| haystack.contains(token.as_str()))
        .count();
    matched as f64 / distinct.len() as f64
}

/// How well `item_text` matches the user's stated `goal`.
///
/// `title`, `tags` and `body` are the item's comparable surfaces, strongest first: a
/// tag is something the user chose deliberately, body text is whatever the author
/// wrote. Any of them may be absent.
///
/// Returns `None` when there is no goal to score against, when the goal has no usable
/// tokens, or when the item has no comparable text at all — each of which the ranker
/// reports as an unavailable term rather than as a score.
pub fn local_goal_alignment(
    goal: &str,
    title: Option<&str>,
    tags: &[String],
    body: Option<&str>,
) -> Option<f64> {
    let goal_tokens = tokenize(goal);
    if goal_tokens.is_empty() {
        return None;
    }
    if title.unwrap_or_default().trim().is_empty()
        && tags.is_empty()
        && body.unwrap_or_default().trim().is_empty()
    {
        return None;
    }

    let tag_text = tags.join(" ");
    let body_text = body.map(|text| text.chars().take(MAX_BODY_CHARS).collect::<String>());

    let mut score = TAG_WEIGHT * coverage(&goal_tokens, &tag_text);
    score += TITLE_WEIGHT * coverage(&goal_tokens, title.unwrap_or_default());
    score += BODY_WEIGHT * coverage(&goal_tokens, body_text.as_deref().unwrap_or_default());

    // The empty-string goal and the no-content item both land here rather than being
    // special-cased at every call site.
    if score <= 0.0 {
        None
    } else {
        Some(score.clamp(0.0, 1.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn an_empty_goal_has_nothing_to_align() {
        assert!(local_goal_alignment("", Some("Linear Algebra"), &[], None).is_none());
        assert!(local_goal_alignment("   ", Some("Linear Algebra"), &[], None).is_none());
    }

    #[test]
    fn a_goal_of_only_function_words_has_nothing_to_align() {
        assert!(local_goal_alignment("the and for", Some("Linear Algebra"), &[], None).is_none());
    }

    #[test]
    fn an_item_with_no_comparable_text_is_unavailable_not_zero() {
        assert!(local_goal_alignment("Linear Algebra", Some("   "), &[], None).is_none());
        assert!(local_goal_alignment("Linear Algebra", None, &[], Some("  ")).is_none());
    }

    #[test]
    fn a_matching_tag_raises_the_score() {
        let matched = local_goal_alignment("linear algebra", Some("Notes"), &tags(&["linear algebra"]), None);
        let unmatched = local_goal_alignment("linear algebra", Some("Notes"), &tags(&["cooking"]), None);
        assert!(matched.unwrap() > unmatched.unwrap_or(0.0));
    }

    #[test]
    fn tags_outweigh_the_title_which_outweighs_the_body() {
        let via_tag = local_goal_alignment("eigenvalues", Some("Unrelated"), &tags(&["eigenvalues"]), None);
        let via_title = local_goal_alignment("eigenvalues", Some("Eigenvalues"), &[], None);
        let via_body = local_goal_alignment("eigenvalues", Some("Unrelated"), &[], Some("eigenvalues"));
        assert!(via_tag.unwrap() > via_title.unwrap());
        assert!(via_title.unwrap() > via_body.unwrap());
    }

    #[test]
    fn identical_input_gives_an_identical_score() {
        let first = local_goal_alignment("exam review", Some("CS 101"), &tags(&["exam"]), Some("review notes"));
        let second = local_goal_alignment("exam review", Some("CS 101"), &tags(&["exam"]), Some("review notes"));
        assert_eq!(first, second);
    }

    #[test]
    fn the_result_is_always_within_zero_and_one() {
        for goal in ["linear algebra", "eigenvalues", "exam review and cs foundations"] {
            for title in [None, Some("Linear Algebra"), Some("unrelated")] {
                let value = local_goal_alignment(goal, title, &tags(&["a", "b"]), Some("some body text"));
                if let Some(score) = value {
                    assert!((0.0..=1.0).contains(&score), "{goal} produced {score}");
                }
            }
        }
    }

    #[test]
    fn matching_more_of_the_goal_scores_higher() {
        let one = local_goal_alignment("linear algebra", Some("Notes"), &tags(&["linear"]), None);
        let two = local_goal_alignment("linear algebra", Some("Notes"), &tags(&["linear", "algebra"]), None);
        assert!(one.is_some() && two.is_some());
        assert!(two.unwrap() > one.unwrap());
    }

    #[test]
    fn matching_is_case_insensitive() {
        let lower = local_goal_alignment("eigenvalues", Some("Notes"), &tags(&["eigenvalues"]), None);
        let upper = local_goal_alignment("EigenValues", Some("Notes"), &tags(&["EIGENVALUES"]), None);
        assert_eq!(lower, upper);
    }

    #[test]
    fn a_repeated_goal_word_counts_once() {
        let repeated = local_goal_alignment("algebra algebra algebra", Some("Notes"), &tags(&["algebra"]), None);
        let single = local_goal_alignment("algebra", Some("Notes"), &tags(&["algebra"]), None);
        assert_eq!(repeated, single);
    }

    #[test]
    fn a_non_matching_goal_scores_nothing_at_all() {
        assert!(local_goal_alignment("topology", Some("Notes"), &tags(&["cooking"]), Some("pasta")).is_none());
    }

    #[test]
    fn the_body_read_is_bounded() {
        let long = "filler ".repeat(2_000);
        let score = local_goal_alignment("eigenvalues", Some("Notes"), &[], Some(&long));
        assert!(score.is_none(), "the word is past the read limit");
    }
}