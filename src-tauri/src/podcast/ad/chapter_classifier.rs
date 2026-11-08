//! Chapter Metadata Heuristic Classifier
//!
//! Scans ingested podcast chapters for sponsor keywords in titles and external links,
//! detecting sponsor intervals with high precision and confidence >= 0.85.

use regex::Regex;
use std::sync::OnceLock;
use uuid::Uuid;
use crate::models::podcast_ad::{AdDetectionMethod, PodcastAdInterval, PodcastChapter};

static SPONSOR_KEYWORD_REGEX: OnceLock<Regex> = OnceLock::new();
static SELF_PROMO_REGEX: OnceLock<Regex> = OnceLock::new();
static CROSS_PROMO_REGEX: OnceLock<Regex> = OnceLock::new();
static BUMPER_REGEX: OnceLock<Regex> = OnceLock::new();

fn sponsor_regex() -> &'static Regex {
    SPONSOR_KEYWORD_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\b(?:sponsor(?:ed|ship)?|advert(?:isement)?|ads?|promo(?:tion)?|discount|break|commercial|midroll|preroll|postroll|partner)\b")
            .expect("Valid sponsor keyword regex")
    })
}

fn self_promo_regex() -> &'static Regex {
    SELF_PROMO_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\b(?:patreon|merch(?:andise)?|support us|donate|tip jar|newsletter|membership|community)\b")
            .expect("Valid self-promo regex")
    })
}

fn cross_promo_regex() -> &'static Regex {
    CROSS_PROMO_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\b(?:cross[- ]promo|recommendation|shoutout|guest appearance|featured show)\b")
            .expect("Valid cross-promo regex")
    })
}

fn bumper_regex() -> &'static Regex {
    BUMPER_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\b(?:bumper|station id|intermission|station break)\b")
            .expect("Valid bumper regex")
    })
}

/// Classify chapter metadata into candidate advertisement intervals.
pub fn classify_chapter_metadata(
    episode_id: &str,
    media_revision: &str,
    chapters: &[PodcastChapter],
) -> Vec<PodcastAdInterval> {
    let mut intervals = Vec::new();

    for chapter in chapters {
        let title_clean = chapter.title.trim();
        let link_clean = chapter.link_url.as_deref().unwrap_or("").trim();

        // 1. Explicitly flagged in feed / ID3 metadata
        if chapter.is_advertisement {
            intervals.push(PodcastAdInterval {
                id: Uuid::new_v4().to_string(),
                episode_id: episode_id.to_string(),
                media_revision: media_revision.to_string(),
                start_ms: chapter.start_ms,
                end_ms: chapter.end_ms,
                category: "external_ad".to_string(),
                confidence: 1.0,
                origin: AdDetectionMethod::MetadataChapter.as_str().to_string(),
                metadata_json: Some(serde_json::json!({
                    "chapterIndex": chapter.chapter_index,
                    "chapterTitle": chapter.title,
                    "reason": "explicit_chapter_flag",
                }).to_string()),
            });
            continue;
        }

        // 2. Check title and link for sponsor/promo keywords
        let matches_title = sponsor_regex().is_match(title_clean)
            || self_promo_regex().is_match(title_clean)
            || cross_promo_regex().is_match(title_clean)
            || bumper_regex().is_match(title_clean);

        let matches_link = !link_clean.is_empty()
            && (sponsor_regex().is_match(link_clean)
                || self_promo_regex().is_match(link_clean)
                || link_clean.contains("patreon.com")
                || link_clean.contains("sponsor")
                || link_clean.contains("promo"));

        if matches_title || matches_link {
            let category = if bumper_regex().is_match(title_clean) {
                "bumper"
            } else if self_promo_regex().is_match(title_clean)
                || link_clean.contains("patreon.com")
            {
                "host_self_promo"
            } else if cross_promo_regex().is_match(title_clean) {
                "podcast_cross_promo"
            } else {
                "external_ad"
            };

            intervals.push(PodcastAdInterval {
                id: Uuid::new_v4().to_string(),
                episode_id: episode_id.to_string(),
                media_revision: media_revision.to_string(),
                start_ms: chapter.start_ms,
                end_ms: chapter.end_ms,
                category: category.to_string(),
                confidence: 0.85,
                origin: AdDetectionMethod::MetadataChapter.as_str().to_string(),
                metadata_json: Some(serde_json::json!({
                    "chapterIndex": chapter.chapter_index,
                    "chapterTitle": chapter.title,
                    "linkUrl": chapter.link_url,
                    "reason": "keyword_heuristic",
                }).to_string()),
            });
        }
    }

    intervals
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_chap(index: i32, title: &str, start_ms: i64, end_ms: i64, is_ad: bool, link: Option<&str>) -> PodcastChapter {
        PodcastChapter {
            id: format!("ch-{}", index),
            episode_id: "ep-test".into(),
            chapter_index: index,
            title: title.into(),
            start_ms,
            end_ms,
            image_url: None,
            link_url: link.map(String::from),
            source: "podcast20_json".into(),
            is_advertisement: is_ad,
        }
    }

    #[test]
    fn classifies_20_synthetic_chapter_sets() {
        let test_cases = vec![
            // (title, is_ad, link, expect_ad, expected_category)
            ("Introduction", false, None, false, ""),
            ("A Word From Our Sponsor", false, None, true, "external_ad"),
            ("Sponsor: Squarespace", false, Some("https://squarespace.com/code"), true, "external_ad"),
            ("Deep Dive into Economics", false, None, false, ""),
            ("Commercial Break", false, None, true, "external_ad"),
            ("Join our Patreon Community", false, Some("https://patreon.com/show"), true, "host_self_promo"),
            ("Discussion with Guest", false, None, false, ""),
            ("Promo: Season 2 Announcement", false, None, true, "external_ad"),
            ("Audible Discount Code", false, None, true, "external_ad"),
            ("Midroll Ads", false, None, true, "external_ad"),
            ("Q&A Session", false, None, false, ""),
            ("Cross-Promo: Listen to TechTalk", false, None, true, "podcast_cross_promo"),
            ("Merchandise & Store Update", false, Some("https://shop.show.com"), true, "host_self_promo"),
            ("Station ID & Bumper", false, None, true, "bumper"),
            ("Book Recommendations", false, None, false, ""),
            ("Explicit Sponsor Flagged Chapter", true, None, true, "external_ad"),
            ("Support Us on Patreon", false, None, true, "host_self_promo"),
            ("Postroll Advertisement", false, None, true, "external_ad"),
            ("Audience Feedback", false, None, false, ""),
            ("Concluding Remarks", false, None, false, ""),
        ];

        let chapters: Vec<PodcastChapter> = test_cases
            .iter()
            .enumerate()
            .map(|(i, (title, is_ad, link, _, _))| {
                make_chap(i as i32, title, (i as i64) * 60_000, (i as i64 + 1) * 60_000, *is_ad, *link)
            })
            .collect();

        let intervals = classify_chapter_metadata("ep-test", "rev-1", &chapters);

        // Count expected ads
        let expected_ad_count = test_cases.iter().filter(|c| c.3).count();
        assert_eq!(intervals.len(), expected_ad_count);

        for (i, (title, _, _, expect_ad, expected_cat)) in test_cases.iter().enumerate() {
            let start = (i as i64) * 60_000;
            let found = intervals.iter().find(|inv| inv.start_ms == start);
            if *expect_ad {
                assert!(found.is_some(), "Expected chapter '{}' to be detected as ad", title);
                let inv = found.unwrap();
                assert_eq!(inv.category, *expected_cat, "Mismatch category for chapter '{}'", title);
                assert!(inv.confidence >= 0.85);
            } else {
                assert!(found.is_none(), "Expected chapter '{}' NOT to be detected as ad", title);
            }
        }
    }
}
