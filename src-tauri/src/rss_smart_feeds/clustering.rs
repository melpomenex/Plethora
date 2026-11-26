//! Stage B: Unicode-safe duplicate & same-story clustering within a Smart Feed.

use super::models::{SmartFeedArticleItem, SmartFeedClusterMember};
use super::normalize::collapse_whitespace;
use chrono::{DateTime, NaiveDateTime, Utc};
use std::collections::{HashMap, HashSet};

/// Unicode-safe character trigram similarity in `[0.0, 1.0]`.
/// Uses `Vec<char>` windows instead of byte slicing so multi-byte UTF-8 titles
/// never panic.
pub fn unicode_trigram_similarity(a: &str, b: &str) -> f64 {
    let a_norm = collapse_whitespace(&a.to_lowercase());
    let b_norm = collapse_whitespace(&b.to_lowercase());
    if a_norm.is_empty() || b_norm.is_empty() {
        return 0.0;
    }
    if a_norm == b_norm {
        return 1.0;
    }

    let chars_a: Vec<char> = a_norm.chars().collect();
    let chars_b: Vec<char> = b_norm.chars().collect();
    if chars_a.len() < 3 || chars_b.len() < 3 {
        return if chars_a == chars_b { 1.0 } else { 0.0 };
    }

    let trigrams_a: HashSet<[char; 3]> = chars_a.windows(3).map(|w| [w[0], w[1], w[2]]).collect();
    let trigrams_b: HashSet<[char; 3]> = chars_b.windows(3).map(|w| [w[0], w[1], w[2]]).collect();
    if trigrams_a.is_empty() || trigrams_b.is_empty() {
        return 0.0;
    }

    let intersection = trigrams_a.intersection(&trigrams_b).count();
    let union = trigrams_a.union(&trigrams_b).count();
    if union == 0 {
        0.0
    } else {
        (2.0 * intersection as f64) / (trigrams_a.len() + trigrams_b.len()) as f64
    }
}

pub fn normalized_title_tokens(title: &str) -> HashSet<String> {
    const STOP: &[&str] = &[
        "the", "a", "an", "and", "or", "for", "with", "over", "into", "from", "that", "this",
        "are", "was", "were", "new", "after", "about", "amid", "says", "report", "reports", "news",
        "update", "updates", "live", "how", "why", "what", "when", "who",
    ];
    title
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .map(str::trim)
        .filter(|tok| tok.chars().count() >= 3 && !STOP.contains(tok))
        .map(ToString::to_string)
        .collect()
}

pub fn token_jaccard(a: &HashSet<String>, b: &HashSet<String>) -> (f64, usize) {
    if a.is_empty() || b.is_empty() {
        return (0.0, 0);
    }
    let inter = a.intersection(b).count();
    let union = a.union(b).count();
    if union == 0 {
        (0.0, 0)
    } else {
        (inter as f64 / union as f64, inter)
    }
}

/// Normalize a URL for duplicate detection (strips scheme, `www.`, trailing
/// slash, and common tracking query parameters).
pub fn canonical_url_key(url: &str) -> String {
    let trimmed = url.trim().to_lowercase();
    let no_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(&trimmed);
    let no_www = no_scheme.strip_prefix("www.").unwrap_or(no_scheme);
    let (base, query_opt) = match no_www.split_once('?') {
        Some((b, q)) => (b, Some(q)),
        None => (no_www, None),
    };
    let clean_base = base.trim_end_matches('/');
    let mut kept_params: Vec<&str> = Vec::new();
    if let Some(q) = query_opt {
        for pair in q.split('&') {
            let key = pair.split('=').next().unwrap_or("");
            if !key.starts_with("utm_")
                && !matches!(
                    key,
                    "fbclid" | "gclid" | "ref" | "source" | "mc_cid" | "mc_eid"
                )
                && !pair.is_empty()
            {
                kept_params.push(pair);
            }
        }
    }
    if kept_params.is_empty() {
        clean_base.to_string()
    } else {
        kept_params.sort_unstable();
        format!("{}?{}", clean_base, kept_params.join("&"))
    }
}

pub fn parse_pub_timestamp(raw: Option<&str>) -> Option<DateTime<Utc>> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        return Some(dt.with_timezone(&Utc));
    }
    if let Ok(dt) = DateTime::parse_from_rfc2822(raw) {
        return Some(dt.with_timezone(&Utc));
    }
    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(raw, fmt) {
            return Some(DateTime::from_naive_utc_and_offset(naive, Utc));
        }
    }
    None
}

fn within_hours(a: Option<DateTime<Utc>>, b: Option<DateTime<Utc>>, max_hours: i64) -> bool {
    match (a, b) {
        (Some(ta), Some(tb)) => (ta - tb).num_hours().abs() <= max_hours,
        // When publication timestamps are missing, stay conservative on time
        // checks only for same-day style defaults.
        _ => true,
    }
}

fn exact_cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || a.len() != b.len() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for (&x, &y) in a.iter().zip(b.iter()) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        dot / denom
    }
}

/// Embedding record keyed by article_id with model provenance so clustering
/// never compares vectors across incompatible embedding spaces.
#[derive(Debug, Clone)]
pub struct ClusterVector<'a> {
    pub provider: &'a str,
    pub model: &'a str,
    pub vector: &'a [f32],
}

/// Collapse duplicate and same-story articles into primary stories while
/// preserving full access to all covering source articles via `cluster_members`.
pub fn group_feed_articles(
    articles: Vec<SmartFeedArticleItem>,
    embeddings: &HashMap<String, ClusterVector<'_>>,
) -> Vec<SmartFeedArticleItem> {
    if articles.len() <= 1 {
        return articles;
    }

    let n = articles.len();
    let urls: Vec<String> = articles.iter().map(|a| canonical_url_key(&a.url)).collect();
    let tokens: Vec<HashSet<String>> = articles
        .iter()
        .map(|a| normalized_title_tokens(&a.title))
        .collect();
    let dates: Vec<Option<DateTime<Utc>>> = articles
        .iter()
        .map(|a| parse_pub_timestamp(a.published_date.as_deref()))
        .collect();

    // Pre-order indices so primary story selection prefers highest ranking score,
    // then full content availability, then earliest publication or existing order.
    let mut priority_order: Vec<usize> = (0..n).collect();
    priority_order.sort_by(|&ia, &ib| {
        articles[ib]
            .ranking_score
            .partial_cmp(&articles[ia].ranking_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                articles[ib]
                    .full_content
                    .is_some()
                    .cmp(&articles[ia].full_content.is_some())
            })
            .then_with(|| ia.cmp(&ib))
    });

    let mut assigned = vec![false; n];
    let mut grouped = Vec::with_capacity(n);

    for &primary_idx in &priority_order {
        if assigned[primary_idx] {
            continue;
        }
        assigned[primary_idx] = true;
        let mut primary = articles[primary_idx].clone();
        let mut members: Vec<SmartFeedClusterMember> = Vec::new();

        for cand_idx in 0..n {
            if assigned[cand_idx] || cand_idx == primary_idx {
                continue;
            }
            let same_url = !urls[primary_idx].is_empty() && urls[primary_idx] == urls[cand_idx];
            let kind = if same_url {
                Some("duplicate")
            } else if within_hours(dates[primary_idx], dates[cand_idx], 72)
                && unicode_trigram_similarity(
                    &articles[primary_idx].title,
                    &articles[cand_idx].title,
                ) >= 0.80
            {
                Some("duplicate")
            } else {
                let (jac, shared) = token_jaccard(&tokens[primary_idx], &tokens[cand_idx]);
                let different_feed = articles[primary_idx].feed_id != articles[cand_idx].feed_id;
                let shared_enough = shared >= 3 || (shared >= 2 && tokens[primary_idx].len() <= 5);
                if different_feed
                    && within_hours(dates[primary_idx], dates[cand_idx], 72)
                    && jac >= 0.45
                    && shared_enough
                {
                    Some("same_story")
                } else if within_hours(dates[primary_idx], dates[cand_idx], 48) {
                    let same_model_sim = match (
                        embeddings.get(&articles[primary_idx].article_id),
                        embeddings.get(&articles[cand_idx].article_id),
                    ) {
                        (Some(va), Some(vb))
                            if va.provider == vb.provider
                                && va.model == vb.model
                                && va.vector.len() == vb.vector.len() =>
                        {
                            exact_cosine(va.vector, vb.vector)
                        }
                        _ => 0.0,
                    };
                    if same_model_sim >= 0.90 {
                        Some("same_story")
                    } else {
                        None
                    }
                } else {
                    None
                }
            };

            if let Some(similarity_kind) = kind {
                assigned[cand_idx] = true;
                let cand = &articles[cand_idx];
                members.push(SmartFeedClusterMember {
                    article_id: cand.article_id.clone(),
                    feed_id: cand.feed_id.clone(),
                    feed_title: cand.feed_title.clone(),
                    title: cand.title.clone(),
                    url: cand.url.clone(),
                    published_date: cand.published_date.clone(),
                    similarity_kind: similarity_kind.to_string(),
                });
            }
        }

        if !members.is_empty() {
            primary.cluster_id = Some(primary.article_id.clone());
            primary.cluster_size = members.len() + 1;
            primary.cluster_members = members;
        } else {
            primary.cluster_id = None;
            primary.cluster_size = 1;
            primary.cluster_members = Vec::new();
        }
        grouped.push(primary);
    }

    // Preserve original display sort order of primary items by original index map
    let index_by_id: HashMap<&str, usize> = articles
        .iter()
        .enumerate()
        .map(|(i, a)| (a.article_id.as_str(), i))
        .collect();
    grouped.sort_by_key(|item| {
        index_by_id
            .get(item.article_id.as_str())
            .copied()
            .unwrap_or(usize::MAX)
    });
    grouped
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rss_smart_feeds::models::{DecisionSource, EvaluationStatus, MatchDecision};

    fn dummy_item(
        id: &str,
        feed_id: &str,
        feed_title: &str,
        title: &str,
        url: &str,
    ) -> SmartFeedArticleItem {
        SmartFeedArticleItem {
            article_id: id.into(),
            feed_id: feed_id.into(),
            feed_title: feed_title.into(),
            url: url.into(),
            guid: None,
            title: title.into(),
            author: None,
            published_date: Some("2026-11-20T12:00:00Z".into()),
            content: None,
            summary: None,
            image_url: None,
            categories: Vec::new(),
            is_queued: false,
            is_read: false,
            date_added: "2026-11-20T12:00:00Z".into(),
            full_content: None,
            full_content_fetched_at: None,
            decision: MatchDecision::INCLUDE,
            relevance_score: 0.8,
            ranking_score: 0.8,
            decision_reason: "matched".into(),
            matched_evidence: Vec::new(),
            decision_source: DecisionSource::FastLocal,
            evaluation_status: EvaluationStatus::Completed,
            error_message: None,
            is_user_override: false,
            evaluated_at: "2026-11-20T12:00:00Z".into(),
            active_feedback: None,
            also_in_smart_feeds: Vec::new(),
            cluster_id: None,
            cluster_size: 1,
            cluster_members: Vec::new(),
            evaluation_depth: Default::default(),
            content_provenance: Default::default(),
            passages_evaluated: 0,
            passages_total: 0,
            unexpected_truncation: false,
            diagnostics: None,
        }
    }

    #[test]
    fn unicode_trigram_does_not_panic_on_multibyte_utf8() {
        let sim = unicode_trigram_similarity(
            "گزارش مذاکرات آتش‌بس — تحلیل جدید 🚀",
            "گزارش مذاکرات آتش‌بس — تحلیل جدید",
        );
        assert!(sim > 0.85);
    }

    #[test]
    fn groups_same_story_across_sources_and_preserves_members() {
        let a = dummy_item(
            "a1",
            "f1",
            "TechWire",
            "Open Source Reasoning Model Launches With Tool Calling Support",
            "https://techwire.example/model-launch",
        );
        let b = dummy_item(
            "a2",
            "f2",
            "ML Daily",
            "New Open Source Reasoning Model Launches Supporting Tool Calling",
            "https://mldaily.example/model-launch",
        );
        let c = dummy_item(
            "a3",
            "f3",
            "Systems Weekly",
            "Distributed Raft Consensus Latency Benchmarks",
            "https://sysweekly.example/raft",
        );
        let grouped = group_feed_articles(vec![a, b, c], &HashMap::new());
        assert_eq!(grouped.len(), 2);
        assert_eq!(grouped[0].cluster_size, 2);
        assert_eq!(grouped[0].cluster_members.len(), 1);
        assert_eq!(grouped[0].cluster_members[0].article_id, "a2");
    }
}
