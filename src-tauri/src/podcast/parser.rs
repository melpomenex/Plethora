//! RSS 2.0 podcast feed parser with iTunes and Podcasting 2.0 / Podlove chapters support

use crate::models::podcast::{ParsedPodcastEpisode, ParsedPodcastFeed};
use crate::models::podcast_ad::{ChapterSource, PodcastChapter};
use quick_xml::events::Event;
use quick_xml::Reader;

#[derive(Debug, Clone)]
struct RawChapter {
    start: String,
    title: String,
    href: Option<String>,
    image: Option<String>,
}

/// Parse a timestamp string into milliseconds.
///
/// Supports:
/// - "HH:MM:SS" (e.g. "01:23:45" -> 5025000)
/// - "H:MM:SS" (e.g. "1:23:45" -> 5025000)
/// - "MM:SS" (e.g. "05:30" -> 330000)
/// - "M:SS" (e.g. "5:30" -> 330000)
/// - Decimal seconds: "123.456" -> 123456, "123" -> 123000
/// - Milliseconds with dot or comma: "01:23:45.678" -> 5025678, "01:23:45,678" -> 5025678
pub fn parse_timestamp_to_ms(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }

    // Replace comma with dot for fractional seconds (e.g. 01:23:45,678)
    let s = s.replace(',', ".");

    if let Ok(secs) = s.parse::<f64>() {
        return Some((secs * 1000.0).round() as i64);
    }

    let parts: Vec<&str> = s.split(':').collect();
    match parts.len() {
        2 => {
            // MM:SS or MM:SS.mmm
            let mins: f64 = parts[0].parse().ok()?;
            let secs: f64 = parts[1].parse().ok()?;
            Some(((mins * 60.0 + secs) * 1000.0).round() as i64)
        }
        3 => {
            // HH:MM:SS or HH:MM:SS.mmm
            let hours: f64 = parts[0].parse().ok()?;
            let mins: f64 = parts[1].parse().ok()?;
            let secs: f64 = parts[2].parse().ok()?;
            Some(((hours * 3600.0 + mins * 60.0 + secs) * 1000.0).round() as i64)
        }
        4 => {
            // Rare: DD:HH:MM:SS
            let days: f64 = parts[0].parse().ok()?;
            let hours: f64 = parts[1].parse().ok()?;
            let mins: f64 = parts[2].parse().ok()?;
            let secs: f64 = parts[3].parse().ok()?;
            Some(((days * 86400.0 + hours * 3600.0 + mins * 60.0 + secs) * 1000.0).round() as i64)
        }
        _ => None,
    }
}

/// Determine if a chapter title indicates an advertisement or sponsor segment.
pub fn is_sponsor_title(title: &str) -> bool {
    let lower = title.to_lowercase();
    let keywords = [
        "sponsor",
        "advertisement",
        "promo",
        "discount",
        "patreon",
        "commercial",
        "midroll",
        "mid-roll",
        "preroll",
        "pre-roll",
        "postroll",
        "post-roll",
    ];

    for kw in &keywords {
        if lower.contains(kw) {
            return true;
        }
    }

    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();

    for w in words {
        if w == "ad" || w == "ads" || w == "break" {
            return true;
        }
    }

    false
}

/// Parse an RSS 2.0 podcast feed from raw XML text.
///
/// Supports standard RSS 2.0 elements plus iTunes namespace extensions:
/// `itunes:title`, `itunes:image`, `itunes:author`, `itunes:duration`,
/// `itunes:summary`, `itunes:category`.
/// Also supports Podcasting 2.0 (`<podcast:chapters>`) and Podlove Simple Chapters (`<psc:chapters>`).
pub fn parse_podcast_feed(xml: &str) -> Result<ParsedPodcastFeed, String> {
    parse_podcast_feed_inner(xml).map_err(|e| format!("Parse error: {}", e))
}

/// Inner parser that properly tracks element context
fn parse_podcast_feed_inner(xml: &str) -> Result<ParsedPodcastFeed, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();

    let mut feed_title = String::new();
    let mut feed_description: Option<String> = None;
    let mut feed_image_url: Option<String> = None;
    let mut feed_author: Option<String> = None;
    let mut feed_language: Option<String> = None;
    let mut feed_link: Option<String> = None;
    let mut episodes: Vec<ParsedPodcastEpisode> = Vec::new();

    let mut element_stack: Vec<String> = Vec::new();
    let mut in_channel = false;
    let mut in_item = false;

    // Item accumulators
    let mut item_guid: Option<String> = None;
    let mut item_title = String::new();
    let mut item_description: Option<String> = None;
    let mut item_published_date: Option<String> = None;
    let mut item_duration_str: Option<String> = None;
    let mut item_audio_url: Option<String> = None;
    let mut item_audio_type: Option<String> = None;
    let mut item_file_size: Option<i64> = None;
    let mut item_image_url: Option<String> = None;
    let mut item_link: Option<String> = None;
    let mut item_itunes_image: Option<String> = None;
    let mut item_itunes_title: Option<String> = None;
    let mut item_guid_is_permalink: bool = true;
    let mut item_chapters_url: Option<String> = None;
    let mut item_chapters_type: Option<String> = None;
    let mut item_raw_chapters: Vec<RawChapter> = Vec::new();
    let mut current_chapter: Option<RawChapter> = None;

    let mut collect_text = false;
    let mut text_buf = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let raw_name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let raw_name_lower = raw_name.to_lowercase();
                let name = String::from_utf8_lossy(e.local_name().as_ref()).into_owned();
                let name_lower = name.to_lowercase();

                if name_lower == "itunes:image" || name_lower == "image" {
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                        let val = String::from_utf8_lossy(&attr.value).to_string();
                        if key == "href" {
                            if in_item {
                                item_itunes_image = Some(val);
                            } else if in_channel {
                                feed_image_url = Some(val);
                            }
                        }
                    }
                }

                // Check for <podcast:chapters url="..." type="..." />
                if in_item
                    && (raw_name_lower == "podcast:chapters"
                        || (raw_name_lower.ends_with(":chapters")
                            && !raw_name_lower.starts_with("psc:"))
                        || (name_lower == "chapters" && !raw_name_lower.starts_with("psc:")))
                {
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_lowercase();
                        let val = String::from_utf8_lossy(&attr.value).to_string();
                        if key == "url" || key == "href" {
                            item_chapters_url = Some(val);
                        } else if key == "type" {
                            item_chapters_type = Some(val);
                        }
                    }
                }

                // Check for <psc:chapter start="..." title="..." />
                if in_item
                    && (raw_name_lower == "psc:chapter"
                        || raw_name_lower.ends_with(":chapter")
                        || name_lower == "chapter")
                {
                    let mut start = String::new();
                    let mut title = String::new();
                    let mut href = None;
                    let mut image = None;

                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_lowercase();
                        let val = String::from_utf8_lossy(&attr.value).to_string();
                        match key.as_str() {
                            "start" => start = val,
                            "title" => title = val,
                            "href" | "link" | "url" => href = Some(val),
                            "image" | "img" => image = Some(val),
                            _ => {}
                        }
                    }

                    current_chapter = Some(RawChapter {
                        start,
                        title,
                        href,
                        image,
                    });
                }

                element_stack.push(name.clone());

                if name_lower == "channel" {
                    in_channel = true;
                } else if name_lower == "item" && in_channel {
                    in_item = true;
                    item_guid = None;
                    item_title.clear();
                    item_description = None;
                    item_published_date = None;
                    item_duration_str = None;
                    item_audio_url = None;
                    item_audio_type = None;
                    item_file_size = None;
                    item_image_url = None;
                    item_link = None;
                    item_itunes_image = None;
                    item_itunes_title = None;
                    item_guid_is_permalink = true;
                    item_chapters_url = None;
                    item_chapters_type = None;
                    item_raw_chapters.clear();
                    current_chapter = None;
                }

                // Decide whether to collect text content
                if in_channel {
                    let full_path = element_stack.join("/").to_lowercase();
                    if in_item {
                        match full_path.as_str() {
                            s if s.ends_with("/title") || s.ends_with("/itunes:title") => {
                                collect_text = true
                            }
                            s if s.ends_with("/description")
                                || s.ends_with("/itunes:summary")
                                || s.ends_with("/summary") =>
                            {
                                collect_text = true
                            }
                            s if s.ends_with("/pubdate") => collect_text = true,
                            s if s.ends_with("/duration") || s.ends_with("/itunes:duration") => {
                                collect_text = true
                            }
                            s if s.ends_with("/link") => collect_text = true,
                            s if s.ends_with("/guid") => collect_text = true,
                            _ => collect_text = false,
                        }
                    } else {
                        // Channel-level matching (case-insensitive and root-tag robust)
                        match full_path.as_str() {
                            s if s.ends_with("/channel/title")
                                || s == "channel/title"
                                || s.ends_with("/title") =>
                            {
                                collect_text = true
                            }
                            s if s.ends_with("/channel/description")
                                || s == "channel/description"
                                || s.ends_with("/description") =>
                            {
                                collect_text = true
                            }
                            s if s.ends_with("/channel/link")
                                || s == "channel/link"
                                || s.ends_with("/link") =>
                            {
                                collect_text = true
                            }
                            s if s.ends_with("/channel/language")
                                || s == "channel/language"
                                || s.ends_with("/language") =>
                            {
                                collect_text = true
                            }
                            s if s.ends_with("/author") || s.ends_with("/itunes:author") => {
                                collect_text = true
                            }
                            s if s.ends_with("/image/url") => collect_text = true,
                            _ => collect_text = false,
                        }
                    }
                    if collect_text {
                        text_buf.clear();
                    }
                }
            }
            Ok(Event::Empty(ref e)) => {
                let raw_name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let raw_name_lower = raw_name.to_lowercase();
                let name = String::from_utf8_lossy(e.local_name().as_ref()).into_owned();
                let name_lower = name.to_lowercase();

                // Handle self-closing attributes (like <itunes:image href="..." /> or <enclosure url="..." />)
                if name_lower == "itunes:image" || name_lower == "image" {
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                        let val = String::from_utf8_lossy(&attr.value).to_string();
                        if key == "href" {
                            if in_item {
                                item_itunes_image = Some(val);
                            } else if in_channel {
                                feed_image_url = Some(val);
                            }
                        }
                    }
                }

                if name_lower == "enclosure" && in_item {
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                        let val = String::from_utf8_lossy(&attr.value).to_string();
                        match key.as_str() {
                            "url" => item_audio_url = Some(val),
                            "type" => item_audio_type = Some(val),
                            "length" => item_file_size = val.parse::<i64>().ok(),
                            _ => {}
                        }
                    }
                }

                // Check for self-closing <podcast:chapters url="..." type="..." />
                if in_item
                    && (raw_name_lower == "podcast:chapters"
                        || (raw_name_lower.ends_with(":chapters")
                            && !raw_name_lower.starts_with("psc:"))
                        || (name_lower == "chapters" && !raw_name_lower.starts_with("psc:")))
                {
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_lowercase();
                        let val = String::from_utf8_lossy(&attr.value).to_string();
                        if key == "url" || key == "href" {
                            item_chapters_url = Some(val);
                        } else if key == "type" {
                            item_chapters_type = Some(val);
                        }
                    }
                }

                // Check for self-closing <psc:chapter start="..." title="..." />
                if in_item
                    && (raw_name_lower == "psc:chapter"
                        || raw_name_lower.ends_with(":chapter")
                        || name_lower == "chapter")
                {
                    let mut start = String::new();
                    let mut title = String::new();
                    let mut href = None;
                    let mut image = None;

                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_lowercase();
                        let val = String::from_utf8_lossy(&attr.value).to_string();
                        match key.as_str() {
                            "start" => start = val,
                            "title" => title = val,
                            "href" | "link" | "url" => href = Some(val),
                            "image" | "img" => image = Some(val),
                            _ => {}
                        }
                    }

                    if !start.is_empty() || !title.is_empty() {
                        item_raw_chapters.push(RawChapter {
                            start,
                            title,
                            href,
                            image,
                        });
                    }
                }
            }
            Ok(Event::Text(ref e)) => {
                if collect_text {
                    if let Ok(t) = e.unescape() {
                        text_buf.push_str(&t);
                    }
                }
            }
            Ok(Event::CData(ref e)) => {
                if collect_text {
                    text_buf.push_str(&String::from_utf8_lossy(e.as_ref()));
                }
            }
            Ok(Event::End(ref e)) => {
                let raw_name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let raw_name_lower = raw_name.to_lowercase();
                let name = String::from_utf8_lossy(e.local_name().as_ref()).into_owned();
                let name_lower = name.to_lowercase();

                if in_item
                    && (raw_name_lower == "psc:chapter"
                        || raw_name_lower.ends_with(":chapter")
                        || name_lower == "chapter")
                {
                    if let Some(chap) = current_chapter.take() {
                        if !chap.start.is_empty() || !chap.title.is_empty() {
                            item_raw_chapters.push(chap);
                        }
                    }
                }

                if collect_text {
                    let full_path = element_stack.join("/").to_lowercase();
                    let text = text_buf.trim().to_string();

                    if in_item {
                        match full_path.as_str() {
                            s if s.ends_with("/itunes:title") => {
                                item_itunes_title = if text.is_empty() { None } else { Some(text) };
                            }
                            s if s.ends_with("/title") => {
                                item_title = text;
                            }
                            s if s.ends_with("/itunes:summary") || s.ends_with("/summary") => {
                                item_description = if text.is_empty() { None } else { Some(text) };
                            }
                            s if s.ends_with("/description") => {
                                if item_description.is_none() && !text.is_empty() {
                                    item_description = Some(text);
                                }
                            }
                            s if s.ends_with("/pubdate") => {
                                item_published_date =
                                    if text.is_empty() { None } else { Some(text) };
                            }
                            s if s.ends_with("/itunes:duration") || s.ends_with("/duration") => {
                                item_duration_str = if text.is_empty() { None } else { Some(text) };
                            }
                            s if s.ends_with("/link") => {
                                item_link = if text.is_empty() { None } else { Some(text) };
                            }
                            _ => {}
                        }
                    } else if in_channel {
                        match full_path.as_str() {
                            s if s.ends_with("/channel/title")
                                || s == "channel/title"
                                || s.ends_with("/title") =>
                            {
                                feed_title = text
                            }
                            s if s.ends_with("/channel/description")
                                || s == "channel/description"
                                || s.ends_with("/description") =>
                            {
                                feed_description = if text.is_empty() { None } else { Some(text) };
                            }
                            s if s.ends_with("/channel/link")
                                || s == "channel/link"
                                || s.ends_with("/link") =>
                            {
                                feed_link = if text.is_empty() { None } else { Some(text) };
                            }
                            s if s.ends_with("/channel/language")
                                || s == "channel/language"
                                || s.ends_with("/language") =>
                            {
                                feed_language = if text.is_empty() { None } else { Some(text) };
                            }
                            s if s.ends_with("/author") || s.ends_with("/itunes:author") => {
                                feed_author = if text.is_empty() { None } else { Some(text) };
                            }
                            s if s.ends_with("/image/url") => {
                                feed_image_url = if text.is_empty() { None } else { Some(text) };
                            }
                            _ => {}
                        }
                    }
                    collect_text = false;
                }

                // Handle guid element (has isPermaLink attribute)
                if name_lower == "guid" && in_item {
                    let text = text_buf.trim().to_string();
                    if !text.is_empty() {
                        item_guid = Some(text);
                    }
                }

                if name_lower == "item" && in_item {
                    if let Some(audio_url) = item_audio_url.take() {
                        let title = item_itunes_title
                            .take()
                            .unwrap_or_else(|| std::mem::take(&mut item_title));
                        if !title.is_empty() {
                            let duration =
                                item_duration_str.as_deref().and_then(parse_itunes_duration);
                            let image = item_itunes_image.take().or(item_image_url.take());

                            // Construct inline chapters from parsed raw chapters
                            let mut parsed_chapters = Vec::new();
                            item_raw_chapters
                                .sort_by_key(|c| parse_timestamp_to_ms(&c.start).unwrap_or(0));

                            let ep_id = item_guid.as_deref().unwrap_or(if !title.is_empty() {
                                &title
                            } else {
                                "episode"
                            });

                            let num_chaps = item_raw_chapters.len();
                            for idx in 0..num_chaps {
                                let start_ms = parse_timestamp_to_ms(&item_raw_chapters[idx].start)
                                    .unwrap_or(0);
                                let next_start = if idx + 1 < num_chaps {
                                    parse_timestamp_to_ms(&item_raw_chapters[idx + 1].start)
                                } else {
                                    None
                                };
                                let end_ms = next_start
                                    .or_else(|| duration.map(|d| d * 1000))
                                    .unwrap_or(start_ms);
                                let is_sponsor = is_sponsor_title(&item_raw_chapters[idx].title);

                                parsed_chapters.push(PodcastChapter {
                                    id: format!("{}:chapter:{}", ep_id, idx),
                                    episode_id: String::new(),
                                    chapter_index: idx as i32,
                                    title: item_raw_chapters[idx].title.clone(),
                                    start_ms,
                                    end_ms,
                                    image_url: item_raw_chapters[idx].image.clone(),
                                    link_url: item_raw_chapters[idx].href.clone(),
                                    source: ChapterSource::PodloveXml.as_str().to_string(),
                                    is_advertisement: is_sponsor,
                                });
                            }

                            episodes.push(ParsedPodcastEpisode {
                                guid: item_guid.take(),
                                title,
                                description: item_description.take(),
                                published_date: item_published_date.take(),
                                duration,
                                audio_url,
                                audio_type: item_audio_type.take(),
                                file_size: item_file_size.take(),
                                image_url: image,
                                link: item_link.take(),
                                chapters_url: item_chapters_url.take(),
                                chapters_type: item_chapters_type.take(),
                                inline_chapters: parsed_chapters,
                            });
                        }
                    }
                    in_item = false;
                    item_guid_is_permalink = true;
                }

                if name_lower == "channel" {
                    in_channel = false;
                }

                // Pop element stack
                if let Some(top) = element_stack.last() {
                    if top.to_lowercase() == name_lower {
                        element_stack.pop();
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(format!(
                    "XML parse error at position {}: {}",
                    reader.error_position(),
                    e
                ));
            }
            _ => {}
        }
        buf.clear();
    }

    // Fallback: use feed_title from RSS <image> if still empty
    if feed_title.is_empty() {
        feed_title = "Untitled Podcast".to_string();
    }

    Ok(ParsedPodcastFeed {
        title: feed_title,
        description: feed_description,
        image_url: feed_image_url,
        author: feed_author,
        language: feed_language,
        link: feed_link,
        episodes,
    })
}

/// Parse an iTunes duration string into seconds.
///
/// Supports formats:
/// - "HH:MM:SS"
/// - "MM:SS"
/// - "SS" (pure seconds)
/// - "HH:MM:SS.mmm" (with milliseconds)
fn parse_itunes_duration(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }

    // Try pure integer seconds first
    if let Ok(secs) = s.parse::<i64>() {
        return Some(secs);
    }

    // Try parsing as HH:MM:SS or MM:SS
    let parts: Vec<&str> = s.split(':').collect();
    let seconds = match parts.len() {
        2 => {
            // MM:SS
            let mins: i64 = parts[0].parse().ok()?;
            let secs: f64 = parts[1].parse().ok()?;
            (mins * 60) + secs as i64
        }
        3 => {
            // HH:MM:SS
            let hours: i64 = parts[0].parse().ok()?;
            let mins: i64 = parts[1].parse().ok()?;
            let secs: f64 = parts[2].parse().ok()?;
            (hours * 3600) + (mins * 60) + secs as i64
        }
        _ => return None,
    };

    Some(seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_duration_seconds() {
        assert_eq!(parse_itunes_duration("3600"), Some(3600));
        assert_eq!(parse_itunes_duration("0"), Some(0));
    }

    #[test]
    fn test_parse_duration_mm_ss() {
        assert_eq!(parse_itunes_duration("45:30"), Some(2730));
        assert_eq!(parse_itunes_duration("01:00"), Some(60));
    }

    #[test]
    fn test_parse_duration_hh_mm_ss() {
        assert_eq!(parse_itunes_duration("1:30:00"), Some(5400));
        assert_eq!(parse_itunes_duration("02:15:30"), Some(8130));
    }

    #[test]
    fn test_parse_duration_with_milliseconds() {
        assert_eq!(parse_itunes_duration("01:02:03.500"), Some(3723));
    }

    #[test]
    fn test_parse_duration_empty() {
        assert_eq!(parse_itunes_duration(""), None);
        assert_eq!(parse_itunes_duration("  "), None);
    }

    #[test]
    fn test_parse_minimal_rss_feed() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Podcast</title>
    <link>https://example.com</link>
    <description>A test podcast</description>
    <item>
      <title>Episode 1</title>
      <enclosure url="https://example.com/ep1.mp3" type="audio/mpeg" length="12345"/>
      <pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>"#;

        let feed = parse_podcast_feed(xml).unwrap();
        assert_eq!(feed.title, "Test Podcast");
        assert_eq!(feed.episodes.len(), 1);
        assert_eq!(feed.episodes[0].title, "Episode 1");
        assert_eq!(feed.episodes[0].audio_url, "https://example.com/ep1.mp3");
    }

    #[test]
    fn test_parse_itunes_namespace() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>iTunes Podcast</title>
    <itunes:author>John Doe</itunes:author>
    <itunes:image href="https://example.com/cover.jpg"/>
    <language>en</language>
    <item>
      <itunes:title>iTunes Episode</itunes:title>
      <itunes:duration>1:30:00</itunes:duration>
      <itunes:summary>An episode summary</itunes:summary>
      <enclosure url="https://example.com/ep1.mp3" type="audio/mpeg" length="5432100"/>
      <guid>abc123</guid>
    </item>
  </channel>
</rss>"#;

        let feed = parse_podcast_feed(xml).unwrap();
        assert_eq!(feed.title, "iTunes Podcast");
        assert_eq!(feed.author.as_deref(), Some("John Doe"));
        assert_eq!(
            feed.image_url.as_deref(),
            Some("https://example.com/cover.jpg")
        );
        assert_eq!(feed.language.as_deref(), Some("en"));
        assert_eq!(feed.episodes.len(), 1);
        let ep = &feed.episodes[0];
        assert_eq!(ep.title, "iTunes Episode");
        assert_eq!(ep.duration, Some(5400));
        assert_eq!(ep.description.as_deref(), Some("An episode summary"));
        assert_eq!(ep.guid.as_deref(), Some("abc123"));
    }

    #[test]
    fn test_parse_uppercase_and_custom_feed() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<FEED xmlns="http://www.w3.org/2005/Atom">
  <CHANNEL>
    <TITLE>Uppercase Podcast</TITLE>
    <description>An uppercase description</description>
    <LINK>https://example.com/uppercase</LINK>
    <language>en-US</language>
    <item>
      <title>Episode 1</title>
      <enclosure url="https://example.com/ep1.mp3" type="audio/mpeg" length="12345"/>
    </item>
  </CHANNEL>
</FEED>"#;

        let feed = parse_podcast_feed(xml).unwrap();
        assert_eq!(feed.title, "Uppercase Podcast");
        assert_eq!(
            feed.description.as_deref(),
            Some("An uppercase description")
        );
        assert_eq!(feed.link.as_deref(), Some("https://example.com/uppercase"));
        assert_eq!(feed.language.as_deref(), Some("en-US"));
        assert_eq!(feed.episodes.len(), 1);
        assert_eq!(feed.episodes[0].title, "Episode 1");
    }

    #[test]
    fn test_parse_standard_rss_image() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Standard Image Podcast</title>
    <image>
      <url>https://example.com/standard-cover.png</url>
      <title>Standard Image Podcast</title>
      <link>https://example.com</link>
    </image>
    <item>
      <title>Episode 1</title>
      <enclosure url="https://example.com/ep1.mp3" type="audio/mpeg" length="12345"/>
    </item>
  </channel>
</rss>"#;

        let feed = parse_podcast_feed(xml).unwrap();
        assert_eq!(feed.title, "Standard Image Podcast");
        assert_eq!(
            feed.image_url.as_deref(),
            Some("https://example.com/standard-cover.png")
        );
    }

    #[test]
    fn test_parse_timestamp_to_ms() {
        assert_eq!(parse_timestamp_to_ms("00:00:00"), Some(0));
        assert_eq!(parse_timestamp_to_ms("01:23:45"), Some(5025000));
        assert_eq!(parse_timestamp_to_ms("1:00:00"), Some(3600000));
        assert_eq!(parse_timestamp_to_ms("05:30"), Some(330000));
        assert_eq!(parse_timestamp_to_ms("5:30"), Some(330000));
        assert_eq!(parse_timestamp_to_ms("00:05:30.500"), Some(330500));
        assert_eq!(parse_timestamp_to_ms("00:05:30,500"), Some(330500));
        assert_eq!(parse_timestamp_to_ms("120.5"), Some(120500));
        assert_eq!(parse_timestamp_to_ms("invalid"), None);
        assert_eq!(parse_timestamp_to_ms(""), None);
    }

    #[test]
    fn test_is_sponsor_title() {
        assert!(is_sponsor_title("Sponsor Break"));
        assert!(is_sponsor_title("Ad: Squarespace"));
        assert!(is_sponsor_title("Mid-roll Ads"));
        assert!(is_sponsor_title("Our Generous Sponsors"));
        assert!(is_sponsor_title("Patreon shoutouts"));
        assert!(is_sponsor_title("Commercial Break"));
        assert!(is_sponsor_title("Special Discount Code"));

        assert!(!is_sponsor_title("Introduction"));
        assert!(!is_sponsor_title("Chapter 1: The Adventure Begins"));
        assert!(!is_sponsor_title("Road Trip Stories"));
        assert!(!is_sponsor_title("Breakdown of the Election"));
        assert!(!is_sponsor_title("Listener Feedback"));
    }

    #[test]
    fn test_parse_podcast_2_0_chapters() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>Podcasting 2.0 Feed</title>
    <link>https://example.com</link>
    <description>Testing chapters url</description>
    <item>
      <title>Episode with JSON Chapters</title>
      <enclosure url="https://example.com/ep1.mp3" type="audio/mpeg" length="12345"/>
      <podcast:chapters url="https://example.com/ep1/chapters.json" type="application/json+chapters"/>
    </item>
  </channel>
</rss>"#;

        let feed = parse_podcast_feed(xml).unwrap();
        assert_eq!(feed.episodes.len(), 1);
        let ep = &feed.episodes[0];
        assert_eq!(
            ep.chapters_url.as_deref(),
            Some("https://example.com/ep1/chapters.json")
        );
        assert_eq!(
            ep.chapters_type.as_deref(),
            Some("application/json+chapters")
        );
    }

    #[test]
    fn test_parse_podlove_simple_chapters() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:psc="http://podlove.org/simple-chapters" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Podlove Podcast</title>
    <link>https://example.com</link>
    <description>Podlove chapters test</description>
    <item>
      <title>Episode with Inline Chapters</title>
      <guid>podlove-ep-1</guid>
      <enclosure url="https://example.com/ep1.mp3" type="audio/mpeg" length="12345"/>
      <itunes:duration>00:20:00</itunes:duration>
      <psc:chapters version="1.2">
        <psc:chapter start="00:00:00" title="Intro" href="https://example.com/intro" image="https://example.com/intro.png"/>
        <psc:chapter start="00:05:00" title="Sponsor: NordVPN"/>
        <psc:chapter start="00:07:30" title="Deep Dive Interview"/>
      </psc:chapters>
    </item>
  </channel>
</rss>"#;

        let feed = parse_podcast_feed(xml).unwrap();
        assert_eq!(feed.episodes.len(), 1);
        let ep = &feed.episodes[0];
        assert_eq!(ep.inline_chapters.len(), 3);

        let c1 = &ep.inline_chapters[0];
        assert_eq!(c1.title, "Intro");
        assert_eq!(c1.start_ms, 0);
        assert_eq!(c1.end_ms, 300000);
        assert_eq!(c1.link_url.as_deref(), Some("https://example.com/intro"));
        assert_eq!(
            c1.image_url.as_deref(),
            Some("https://example.com/intro.png")
        );
        assert!(!c1.is_advertisement);

        let c2 = &ep.inline_chapters[1];
        assert_eq!(c2.title, "Sponsor: NordVPN");
        assert_eq!(c2.start_ms, 300000);
        assert_eq!(c2.end_ms, 450000);
        assert!(c2.is_advertisement);

        let c3 = &ep.inline_chapters[2];
        assert_eq!(c3.title, "Deep Dive Interview");
        assert_eq!(c3.start_ms, 450000);
        assert_eq!(c3.end_ms, 1200000); // total duration 20:00 = 1200s = 1200000ms
        assert!(!c3.is_advertisement);
    }
}
