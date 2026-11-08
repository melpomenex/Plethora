//! Episode description / show notes timestamp parser.
//!
//! Extracts chapter timestamps from episode show notes and descriptions when
//! formal chapter tracks (JSON/ID3/Podlove) are missing.
//!
//! Requires >= 3 chronological timestamps to filter out isolated time mentions.

use crate::models::podcast_ad::{ChapterSource, PodcastChapter};
use crate::podcast::parser::{is_sponsor_title, parse_timestamp_to_ms};
use regex::Regex;

/// Strip HTML formatting and decode common entities to plain text
pub fn strip_html_to_plain_text(html: &str) -> String {
    let mut text = html
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</p>", "\n")
        .replace("</div>", "\n")
        .replace("</li>", "\n")
        .replace("&ndash;", "-")
        .replace("&mdash;", "-")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ");

    let mut in_tag = false;
    let mut cleaned = String::with_capacity(text.len());
    for c in text.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
        } else if !in_tag {
            cleaned.push(c);
        }
    }
    cleaned
}

/// Parse chapter timestamps from episode description text.
pub fn parse_description_chapters(
    description: &str,
    episode_id: &str,
    duration_secs: Option<i64>,
) -> Vec<PodcastChapter> {
    if description.trim().is_empty() {
        return Vec::new();
    }

    let plain_text = strip_html_to_plain_text(description);

    // Regex 1: Timestamp at beginning of line (e.g. "00:00 Intro", "01:23:45 - Topic", "[05:30] Discussion")
    let re_start = Regex::new(
        r"^\s*(?:(?:[-*•]|\d+\.)\s+)?[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d+)?)[\])]?\s*[-–—:|]?\s*(.+)$",
    )
    .unwrap();

    // Regex 2: Title first, timestamp at end (e.g. "Introduction - 00:00", "Main Topic (12:30)")
    let re_end = Regex::new(
        r"^\s*(?:(?:[-*•]|\d+\.)\s+)?(.+?)\s*[-–—:|]?\s*[\[(]((?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d+)?)[\])]\s*$",
    )
    .unwrap();

    let mut raw_candidates: Vec<(i64, String)> = Vec::new();

    for line in plain_text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some(caps) = re_start.captures(line) {
            let ts_str = caps.get(1).map_or("", |m| m.as_str());
            let title = caps.get(2).map_or("", |m| m.as_str()).trim();
            if let Some(start_ms) = parse_timestamp_to_ms(ts_str) {
                if !title.is_empty() && title.len() < 120 {
                    raw_candidates.push((start_ms, title.to_string()));
                    continue;
                }
            }
        }

        if let Some(caps) = re_end.captures(line) {
            let title = caps.get(1).map_or("", |m| m.as_str()).trim();
            let ts_str = caps.get(2).map_or("", |m| m.as_str());
            if let Some(start_ms) = parse_timestamp_to_ms(ts_str) {
                if !title.is_empty() && title.len() < 120 {
                    raw_candidates.push((start_ms, title.to_string()));
                    continue;
                }
            }
        }
    }

    // Require >= 3 timestamps to filter out false positives
    if raw_candidates.len() < 3 {
        return Vec::new();
    }

    // Verify chronological order (timestamps must be monotonically non-decreasing)
    for i in 1..raw_candidates.len() {
        if raw_candidates[i].0 < raw_candidates[i - 1].0 {
            return Vec::new();
        }
    }

    let num_chaps = raw_candidates.len();
    let mut chapters = Vec::with_capacity(num_chaps);

    for (idx, (start_ms, title)) in raw_candidates.into_iter().enumerate() {
        let is_sponsor = is_sponsor_title(&title);
        chapters.push(PodcastChapter {
            id: format!("{}:desc:{}", episode_id, idx),
            episode_id: episode_id.to_string(),
            chapter_index: idx as i32,
            title,
            start_ms,
            end_ms: start_ms, // assigned below
            image_url: None,
            link_url: None,
            source: ChapterSource::DescriptionTimestamp.as_str().to_string(),
            is_advertisement: is_sponsor,
        });
    }

    for idx in 0..chapters.len() {
        if idx + 1 < chapters.len() {
            chapters[idx].end_ms = chapters[idx + 1].start_ms;
        } else if let Some(d_secs) = duration_secs {
            let total_ms = d_secs * 1000;
            if chapters[idx].end_ms < total_ms {
                chapters[idx].end_ms = total_ms;
            }
        }
    }

    chapters
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_youtube_format() {
        let text = r#"
Episode 100 special celebration!

TIMESTAMPS:
0:00 - Introduction & Welcome
3:20 - How we got started
8:45 - Sponsor: Squarespace
15:10 - Deep Dive Q&A
45:00 - Wrap-up and Next Week
"#;

        let chaps = parse_description_chapters(text, "ep100", Some(3000));
        assert_eq!(chaps.len(), 5);

        assert_eq!(chaps[0].title, "Introduction & Welcome");
        assert_eq!(chaps[0].start_ms, 0);
        assert_eq!(chaps[0].end_ms, 200000); // 3:20 = 200s
        assert!(!chaps[0].is_advertisement);

        assert_eq!(chaps[2].title, "Sponsor: Squarespace");
        assert_eq!(chaps[2].start_ms, 525000); // 8:45 = 525s
        assert_eq!(chaps[2].end_ms, 910000); // 15:10 = 910s
        assert!(chaps[2].is_advertisement);

        assert_eq!(chaps[4].title, "Wrap-up and Next Week");
        assert_eq!(chaps[4].start_ms, 2700000); // 45:00 = 2700s
        assert_eq!(chaps[4].end_ms, 3000000);
    }

    #[test]
    fn test_parse_patreon_format() {
        let text = r#"
Show Chapters:
(00:00:00) Welcome to the show
(00:04:15) Patreon shoutouts & discounts
(00:10:30) Guest interview with Alice
(00:55:00) Outro
"#;

        let chaps = parse_description_chapters(text, "ep_patreon", Some(3600));
        assert_eq!(chaps.len(), 4);

        assert_eq!(chaps[0].title, "Welcome to the show");
        assert_eq!(chaps[0].start_ms, 0);
        assert_eq!(chaps[0].end_ms, 255000); // 4:15

        assert_eq!(chaps[1].title, "Patreon shoutouts & discounts");
        assert!(chaps[1].is_advertisement);

        assert_eq!(chaps[3].title, "Outro");
        assert_eq!(chaps[3].start_ms, 3300000);
        assert_eq!(chaps[3].end_ms, 3600000);
    }

    #[test]
    fn test_parse_html_npr_format() {
        let html = r#"
<p>Today on the program:</p>
<p>01:30 &ndash; Opening thoughts on economy<br/>
06:45 &ndash; Climate policy changes<br/>
18:20 &ndash; Interview with Secretary<br/>
32:00 &ndash; Commercial Break<br/>
34:00 &ndash; Closing reflections</p>
"#;

        let chaps = parse_description_chapters(html, "ep_npr", None);
        assert_eq!(chaps.len(), 5);

        assert_eq!(chaps[0].title, "Opening thoughts on economy");
        assert_eq!(chaps[0].start_ms, 90000);
        assert_eq!(chaps[0].end_ms, 405000);

        assert_eq!(chaps[3].title, "Commercial Break");
        assert!(chaps[3].is_advertisement);
    }

    #[test]
    fn test_filters_single_timestamps_and_non_chronological() {
        // Less than 3 timestamps -> ignored
        let text_few = "Catch us live at 12:30 on Thursdays or 18:00 on Fridays!";
        assert!(parse_description_chapters(text_few, "ep_few", None).is_empty());

        // Non-chronological timestamps -> ignored
        let text_unordered = r#"
05:00 - First
02:00 - Second (went back)
10:00 - Third
"#;
        assert!(parse_description_chapters(text_unordered, "ep_unordered", None).is_empty());
    }
}
