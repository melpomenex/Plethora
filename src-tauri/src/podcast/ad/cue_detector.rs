//! Transcript Acoustic & Text Cue Detector
//!
//! Scans podcast transcript segments for sponsor intros, promo codes,
//! landing pages, and transition phrases to identify candidate ad intervals.

use crate::transcription::engine::TranscriptSegment;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

static INTRO_REGEX: OnceLock<Regex> = OnceLock::new();
static PROMO_REGEX: OnceLock<Regex> = OnceLock::new();
static URL_REGEX: OnceLock<Regex> = OnceLock::new();
static OUTRO_REGEX: OnceLock<Regex> = OnceLock::new();
static SELF_PROMO_REGEX: OnceLock<Regex> = OnceLock::new();

fn intro_regex() -> &'static Regex {
    INTRO_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\b(?:sponsored\s+by|brought\s+to\s+you\s+by|presented\s+by|made\s+possible\s+by|support\s+(?:for|from)\s+this\s+(?:podcast|show)|a\s+word\s+from\s+our\s+sponsors?|thanks\s+to\s+our\s+sponsors?|thank\s+you\s+to\s+our\s+(?:partner|sponsor)|special\s+thanks\s+to|today's\s+(?:episode|show)\s+is\s+(?:supported|brought\s+to\s+you|sponsored)\s+by|this\s+(?:episode|show|podcast)\s+is\s+(?:supported|brought\s+to\s+you|sponsored)\s+by|a\s+quick\s+break\s+from\s+our\s+sponsor|our\s+(?:presenting\s+)?sponsor|before\s+we\s+(?:get\s+started|begin|dive\s+in|jump\s+in)|let\s+me\s+tell\s+you\s+about|i\s+want\s+to\s+tell\s+you\s+about|we(?:'re|\s+are)\s+partnering\s+with|i(?:'ve|\s+have)\s+partnered\s+with|our\s+friends\s+at|this\s+message\s+is\s+from|a\s+quick\s+message\s+from|proudly\s+sponsored\s+by)\b")
            .expect("Valid intro regex")
    })
}

fn promo_regex() -> &'static Regex {
    PROMO_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\b(?:promo\s+code|use\s+(?:the\s+|my\s+)?code|with\s+code|discount\s+code|coupon\s+code|at\s+checkout|(?:for|save|get)\s+\d+%\s+off|\d+%\s+off|free\s+(?:shipping|trial|sample|guide|kit)|enter\s+code|money[- ]back\s+guarantee|risk[- ]free\s+trial|link\s+in\s+(?:the\s+)?(?:description|show\s+notes)|call\s+(?:1[-.\s]?)?(?:800|888|877|866|855|844|833)[-.\s]?\d{3}[-.\s]?\d{4}|text\s+[a-z0-9]+\s+to\s+\d{4,6})\b")
            .expect("Valid promo regex")
    })
}

fn url_regex() -> &'static Regex {
    URL_REGEX.get_or_init(|| {
        Regex::new(
            r"(?i)\b(?:(?:dot\s+com\s+slash|\.com/|https?://[^\s]+|\.org/|\.co/)[a-zA-Z0-9_\-]+|[a-zA-Z0-9\-]+\.(?:com|org|co|io|net|tv)(?:/[a-zA-Z0-9_\-]+)?|(?:go\s+to|visit|head\s+to|check\s+out|sign\s+up\s+at|learn\s+more\s+at)\s+[a-zA-Z0-9\-\s]{2,40}\s+dot\s+(?:com|org|co|io))\b",
        )
        .expect("Valid URL regex")
    })
}

fn outro_regex() -> &'static Regex {
    OUTRO_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\b(?:welcome\s+back\s+to|now\s+back\s+to\s+(?:the\s+show|our\s+conversation|the\s+episode|the\s+interview)|back\s+to\s+the\s+podcast|now\s+let's\s+get\s+back|and\s+we're\s+back|welcome\s+to\s+(?:the\s+|today's\s+)?(?:show|episode|podcast|program)|joining\s+us\s+today|our\s+guest\s+today|today\s+we(?:'re|\s+are)\s+talking|let's\s+get\s+started|let's\s+dive\s+in|let's\s+jump\s+right\s+in)\b")
            .expect("Valid outro regex")
    })
}

fn self_promo_regex() -> &'static Regex {
    SELF_PROMO_REGEX.get_or_init(|| {
        Regex::new(r"(?i)\b(?:patreon\.com|support\s+us\s+on\s+patreon|join\s+our\s+discord|leave\s+us\s+a\s+review|rate\s+and\s+review|subscribe\s+to\s+our\s+newsletter|merch\s+store)\b")
            .expect("Valid self promo regex")
    })
}

/// A candidate advertisement span detected via acoustic/text cues
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CueSpan {
    pub start_ms: i64,
    pub end_ms: i64,
    pub score: f32,
    pub matched_cues: Vec<String>,
    pub category: String,
}

/// Detect advertisement cue spans across transcript segments
pub fn detect_cue_spans(segments: &[TranscriptSegment]) -> Vec<CueSpan> {
    if segments.is_empty() {
        return Vec::new();
    }

    let mut spans = Vec::new();
    let mut i = 0;

    while i < segments.len() {
        let seg = &segments[i];
        let text = &seg.text;

        let has_intro = intro_regex().is_match(text);
        let has_promo = promo_regex().is_match(text);
        let has_url = url_regex().is_match(text);
        let has_self = self_promo_regex().is_match(text);

        let initial_score: f32 = (if has_intro { 0.50f32 } else { 0.0f32 })
            + (if has_promo { 0.45f32 } else { 0.0f32 })
            + (if has_url { 0.35f32 } else { 0.0f32 })
            + (if has_self { 0.45f32 } else { 0.0f32 });

        if initial_score >= 0.35f32 {
            // If the cue is in segment 1 right after a short pre-roll lead-in at 00:00,
            // include segment 0 unless it is already a show-opening greeting/transition.
            let mut start_ms = seg.start_ms;
            if i == 1
                && spans.is_empty()
                && segments[0].start_ms <= 2_000
                && segments[0].end_ms <= 12_000
            {
                let seg0_lower = segments[0].text.to_lowercase();
                let is_show_greeting = outro_regex().is_match(&segments[0].text)
                    || seg0_lower.contains("welcome")
                    || seg0_lower.contains("today's episode")
                    || seg0_lower.contains("today's show");
                if !is_show_greeting {
                    start_ms = segments[0].start_ms;
                }
            }
            let mut end_ms = seg.end_ms;
            let mut last_cue_ms = seg.end_ms;
            let mut total_score: f32 = initial_score;
            let mut matched_cues = Vec::new();
            if has_intro {
                matched_cues.push("intro".into());
            }
            if has_promo {
                matched_cues.push("promo_code".into());
            }
            if has_url {
                matched_cues.push("landing_url".into());
            }
            if has_self {
                matched_cues.push("self_promo".into());
            }

            let category = if has_self && !has_intro && !has_promo {
                "host_self_promo"
            } else {
                "external_ad"
            };

            // Scan forward up to 180s or until outro transition
            let mut j = i + 1;
            while j < segments.len() {
                let next_seg = &segments[j];
                // Don't extend past 180 seconds for a single ad spot
                if next_seg.end_ms - start_ms > 180_000 {
                    break;
                }

                let next_text = &next_seg.text;
                let next_has_outro = outro_regex().is_match(next_text);
                let next_has_intro = intro_regex().is_match(next_text);
                let next_has_promo = promo_regex().is_match(next_text);
                let next_has_url = url_regex().is_match(next_text);

                if next_has_intro && !matched_cues.contains(&"intro".to_string()) {
                    matched_cues.push("intro".into());
                    total_score += 0.35f32;
                }
                if next_has_promo && !matched_cues.contains(&"promo_code".to_string()) {
                    matched_cues.push("promo_code".into());
                    total_score += 0.35f32;
                }
                if next_has_url && !matched_cues.contains(&"landing_url".to_string()) {
                    matched_cues.push("landing_url".into());
                    total_score += 0.25f32;
                }
                if next_has_intro || next_has_promo || next_has_url {
                    last_cue_ms = next_seg.end_ms;
                }

                if next_has_outro {
                    matched_cues.push("outro_transition".into());
                    // Ad ends right where the outro transition starts
                    end_ms = next_seg.start_ms.max(end_ms);
                    j += 1;
                    break;
                }

                end_ms = next_seg.end_ms;
                // If this segment has no cues and we've gone 45s past the last cue, stop extending
                if !next_has_intro
                    && !next_has_promo
                    && !next_has_url
                    && (next_seg.end_ms - last_cue_ms > 45_000)
                {
                    break;
                }
                j += 1;
            }

            // Calibrate confidence so multi-cue ads and explicit sponsor intros meet the
            // default 0.85 minConfidence threshold, while isolated URLs remain below 0.85.
            let confidence = if matched_cues.len() >= 2 {
                total_score.max(0.88f32).min(1.0f32)
            } else if has_intro {
                0.85f32
            } else {
                total_score.min(1.0f32)
            };

            if total_score >= 0.45f32 && end_ms > start_ms {
                spans.push(CueSpan {
                    start_ms,
                    end_ms,
                    score: confidence,
                    matched_cues,
                    category: category.into(),
                });
                i = j;
                continue;
            }
        }
        i += 1;
    }

    spans
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(id: i64, start_ms: i64, end_ms: i64, text: &str) -> TranscriptSegment {
        TranscriptSegment {
            start_ms,
            end_ms,
            text: text.to_string(),
            confidence: 0.95,
            words_json: None,
        }
    }

    #[test]
    fn detects_sponsor_and_promo_cues() {
        let segments = vec![
            seg(1, 0, 10_000, "Welcome everyone to today's episode."),
            seg(
                2,
                10_000,
                25_000,
                "This episode is brought to you by Athletic Greens!",
            ),
            seg(
                3,
                25_000,
                45_000,
                "Go to athleticgreens.com/show and use promo code SHOW at checkout for 20% off.",
            ),
            seg(
                4,
                45_000,
                60_000,
                "Now back to the show and our conversation with Jane.",
            ),
            seg(
                5,
                60_000,
                90_000,
                "Jane, tell us how you began your career.",
            ),
        ];

        let spans = detect_cue_spans(&segments);
        assert_eq!(spans.len(), 1);
        let ad = &spans[0];
        assert_eq!(ad.start_ms, 10_000);
        assert!(ad.end_ms >= 45_000);
        assert!(ad.matched_cues.contains(&"intro".to_string()));
        assert!(ad.matched_cues.contains(&"promo_code".to_string()));
        assert!(ad.matched_cues.contains(&"landing_url".to_string()));
        assert_eq!(ad.category, "external_ad");
    }

    #[test]
    fn detects_self_promo_cues() {
        let segments = vec![
            seg(1, 0, 10_000, "That's all for today's discussion."),
            seg(2, 10_000, 30_000, "If you loved this, support us on patreon at patreon.com/dailycast for bonus content."),
            seg(3, 30_000, 45_000, "See you next Tuesday!"),
        ];

        let spans = detect_cue_spans(&segments);
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].category, "host_self_promo");
    }

    #[test]
    fn detects_immediate_preroll_ad_with_spoken_url_and_show_welcome_outro() {
        let segments = vec![
            seg(1, 0, 8_000, "Hey, it's Tucker. The dollar is losing value every single day."),
            seg(
                2,
                8_000,
                22_000,
                "Go to American Hartford Gold dot com or call 866-555-0199 for your free gold guide.",
            ),
            seg(
                3,
                22_000,
                32_000,
                "Welcome to the show. Joining us today is our guest.",
            ),
            seg(4, 32_000, 60_000, "Let's talk about current events."),
        ];

        let spans = detect_cue_spans(&segments);
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].start_ms, 0);
        assert_eq!(spans[0].end_ms, 22_000);
        assert!(spans[0].score >= 0.85);
    }

    #[test]
    fn tests_against_15_podcast_episode_transcripts() {
        let transcripts: Vec<Vec<TranscriptSegment>> = (0..15)
            .map(|idx| {
                let is_ad_episode = idx % 2 == 1;
                if is_ad_episode {
                    vec![
                        seg(1, 0, 15_000, &format!("Episode {}: Greeting listeners.", idx)),
                        seg(2, 15_000, 40_000, "This podcast is sponsored by NordVPN. Protect your privacy online."),
                        seg(3, 40_000, 65_000, "Visit nordvpn.com/secure and enter code SECURE for free shipping and discount."),
                        seg(4, 65_000, 80_000, "Welcome back to the episode."),
                        seg(5, 80_000, 120_000, "Let's explore our main topic."),
                    ]
                } else {
                    vec![
                        seg(1, 0, 30_000, &format!("Episode {}: Opening interview.", idx)),
                        seg(2, 30_000, 60_000, "Continuing the discussion about biology and marine life."),
                        seg(3, 60_000, 90_000, "The ocean currents shift dramatically during winter."),
                        seg(4, 90_000, 120_000, "Thank you for listening today."),
                    ]
                }
            })
            .collect();

        let start_time = std::time::Instant::now();
        let mut total_ads_found = 0;

        for (idx, ep_segments) in transcripts.iter().enumerate() {
            let spans = detect_cue_spans(ep_segments);
            if idx % 2 == 1 {
                assert!(
                    !spans.is_empty(),
                    "Episode {} should have detected an ad",
                    idx
                );
                total_ads_found += spans.len();
            } else {
                assert!(
                    spans.is_empty(),
                    "Episode {} should not have false positives",
                    idx
                );
            }
        }

        let elapsed = start_time.elapsed();
        assert_eq!(total_ads_found, 7);
        // Verify regex matching speed is under 50ms across all 15 episodes
        assert!(
            elapsed.as_millis() < 50,
            "Matching took too long: {:?}",
            elapsed
        );
    }
}
