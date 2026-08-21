//! Smart Tagging Module
//!
//! Provides two-tier automatic document and item tagging:
//! - Tier 1: Local deterministic statistical baseline (zero LLM / offline)
//! - Tier 2: LLM semantic refinement (structured task)

pub mod candidate_retrieval;
pub mod domain_signatures;
pub mod normalization;
pub mod policy;
pub mod salience;
pub mod tokenizer;

#[cfg(test)]
pub mod tests;

use crate::models::SmartTagDetail;
use policy::PolicyConfig;
use salience::DocumentContentParts;

/// Classify document using Tier 1 statistical baseline engine.
pub fn classify_document_baseline(
    title: &str,
    headings: &[&str],
    body: &str,
    existing_library_tags: &[(String, i32)],
    manual_tags: &[String],
    dismissed_tags: &[String],
    config: Option<&PolicyConfig>,
) -> Vec<SmartTagDetail> {
    let default_config = PolicyConfig::default();
    let effective_config = config.unwrap_or(&default_config);

    // 1. Extract salient terms with positional weights (Title 5x, Headings 3x, Body 1x)
    let parts = DocumentContentParts {
        title,
        headings,
        body,
    };
    let salient_terms = salience::extract_salient_terms(&parts, 30);

    // 2. Check composite multi-term domain signatures
    let domain_matches = domain_signatures::match_domain_signatures(title, headings, &salient_terms);

    // 3. Rank candidate tags from user's existing taxonomy
    let candidate_tags = candidate_retrieval::rank_candidate_tags(
        existing_library_tags,
        title,
        headings,
        &salient_terms,
        30,
    );

    // 4. Extract existing tag names
    let existing_names: Vec<String> = existing_library_tags.iter().map(|(n, _)| n.clone()).collect();

    // 5. Evaluate and filter according to policy (threshold >= 0.70, max tags, duplicate prevention)
    policy::evaluate_and_filter_tags(
        title,
        &domain_matches,
        &candidate_tags,
        &salient_terms,
        &existing_names,
        manual_tags,
        dismissed_tags,
        effective_config,
    )
}
