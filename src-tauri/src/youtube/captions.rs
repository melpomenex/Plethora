//! Caption parsers shared by the InnerTube (json3) and yt-dlp (json3/vtt) transcript paths.
//!
//! Both formats can carry per-word timings — json3 through `events[].segs[].tOffsetMs`,
//! yt-dlp auto-sub VTT through inline `<00:00:01.560><c> word</c>` cue timestamps — and both
//! are normalized here into [`TranscriptSegment::words`].
//!
//! # The ordinal invariant
//!
//! The renderer matches words to text *positionally*: the Nth whitespace-separated token of
//! `segment.text` is highlighted when word index N is active. Word strings are never compared.
//! Therefore, for every segment emitted with `words: Some(w)`:
//!
//! ```text
//! text.split_whitespace().count() == w.len()
//! ```
//!
//! `text` and `words` are always derived from the same token list, and any input where the
//! equality cannot be guaranteed emits `words: None` instead — a wrong highlight is worse
//! than no highlight.

use lazy_static::lazy_static;
use serde::Deserialize;

use crate::youtube::{TranscriptSegment, WordTiming};

lazy_static! {
    static ref TAG_REGEX: regex::Regex = regex::Regex::new(r"<[^>]+>").unwrap();
}

pub fn decode_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

pub fn strip_tags(s: &str) -> String {
    TAG_REGEX.replace_all(s, "").to_string()
}

/// Normalize whitespace with *exactly* the rule used to tokenize, so that
/// `normalize_ws(x).split_whitespace().count()` equals the number of tokens harvested.
fn normalize_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// One timed run of caption text: a json3 `seg`, or a VTT run between inline timestamps.
#[derive(Debug, Clone)]
struct Chunk {
    /// Cleaned text (entities decoded, tags stripped) with its own surrounding whitespace intact.
    text: String,
    /// Absolute start of this chunk in milliseconds.
    start_ms: i64,
    /// Offset relative to the cue/event start, when the source stated one explicitly.
    /// `None` means "inherits the cue start" — the signature of carry-over text.
    offset_ms: Option<i64>,
    /// Whether carry-over dedup may cut immediately after this chunk. Every json3 seg is a
    /// legal cut point; in VTT only line ends are, so a cue's first word (which precedes its
    /// own inline timestamp) can never be shaved off the front of a word-timed run.
    drop_boundary: bool,
}

/// YouTube ASR repeats the tail of the previous cue at the head of the next one.
/// Returns how many leading chunks to drop: the longest run of chunks that carry no
/// explicit offset and whose accumulated text is a (word-boundary) prefix of the
/// previously emitted segment's text.
fn carryover_drop_count(chunks: &[Chunk], prev_text: Option<&str>) -> usize {
    let prev = match prev_text {
        Some(p) if !p.is_empty() => p,
        _ => return 0,
    };

    let mut acc = String::new();
    let mut drop_to = 0usize;

    for (i, chunk) in chunks.iter().enumerate() {
        if !matches!(chunk.offset_ms, None | Some(0)) {
            break;
        }
        acc.push_str(&chunk.text);
        let acc_norm = normalize_ws(&acc);
        if acc_norm.is_empty() {
            // Pure whitespace so far: nothing to compare, keep scanning.
            if chunk.drop_boundary {
                drop_to = i + 1;
            }
            continue;
        }
        let is_prefix = prev == acc_norm || prev.starts_with(&format!("{} ", acc_norm));
        if !is_prefix {
            break;
        }
        if chunk.drop_boundary {
            drop_to = i + 1;
        }
    }

    drop_to
}

/// Turn surviving chunks into `(text, words)`.
///
/// Each chunk's span runs from its own start to the next chunk's start (the last chunk
/// ends at `end_ms`), split evenly across the whitespace tokens it contains. A chunk with
/// no tokens contributes only its whitespace to the text and no word entry.
///
/// `words` is `None` when no chunk carried a measured offset (typical of human-authored
/// caption tracks): Rust only ever emits *measured* timings, never fabricated even spacing.
fn build_segment_body(chunks: &[Chunk], end_ms: i64) -> (String, Option<Vec<WordTiming>>) {
    let text = normalize_ws(&chunks.iter().map(|c| c.text.as_str()).collect::<String>());

    let has_measured_offsets = chunks.iter().any(|c| c.offset_ms.is_some());
    if !has_measured_offsets {
        return (text, None);
    }

    let mut words: Vec<WordTiming> = Vec::new();
    for (i, chunk) in chunks.iter().enumerate() {
        let tokens: Vec<&str> = chunk.text.split_whitespace().collect();
        if tokens.is_empty() {
            continue;
        }

        let chunk_start = chunk.start_ms;
        let chunk_end = chunks
            .get(i + 1)
            .map(|next| next.start_ms)
            .unwrap_or(end_ms)
            .max(chunk_start);
        let span = chunk_end - chunk_start;
        let n = tokens.len() as i64;

        for (k, token) in tokens.iter().enumerate() {
            let k = k as i64;
            let mut start_ms = chunk_start + (span * k) / n;
            let mut end = chunk_start + (span * (k + 1)) / n;
            if let Some(prev) = words.last() {
                start_ms = start_ms.max(prev.end_ms);
            }
            end = end.max(start_ms + 1);
            words.push(WordTiming {
                word: (*token).to_string(),
                start_ms,
                end_ms: end,
            });
        }
    }

    // The ordinal invariant: never hand the renderer a word list it would mis-align.
    if words.len() != text.split_whitespace().count() {
        return (text, None);
    }

    (text, Some(words))
}

/// Assemble a segment from chunks, applying carry-over dedup against the segments
/// emitted so far. Pushes onto `segments` unless the whole cue was carry-over/empty.
fn push_segment(
    segments: &mut Vec<TranscriptSegment>,
    chunks: Vec<Chunk>,
    cue_start_ms: i64,
    cue_end_ms: i64,
) {
    if chunks.is_empty() {
        return;
    }

    let prev_text = segments.last().map(|s| s.text.clone());
    let drop = carryover_drop_count(&chunks, prev_text.as_deref());
    if drop >= chunks.len() {
        return;
    }
    let surviving = &chunks[drop..];

    let (text, words) = build_segment_body(surviving, cue_end_ms);
    if text.is_empty() {
        return;
    }

    debug_assert!(
        words
            .as_ref()
            .is_none_or(|w| w.len() == text.split_whitespace().count()),
        "word/token count mismatch: {:?} vs {:?}",
        words.as_ref().map(|w| w.len()),
        text.split_whitespace().count()
    );

    // Segment start/duration stay the cue's own values (in seconds) — unchanged wire contract.
    let segment = TranscriptSegment {
        text,
        start: cue_start_ms as f64 / 1000.0,
        duration: (cue_end_ms - cue_start_ms).max(0) as f64 / 1000.0,
        words,
    };

    // Consecutive exact duplicates collapse (yt-dlp auto-subs repeat every line verbatim,
    // once plain and once word-tagged, in either order). The word-timed copy wins.
    if let Some(last) = segments.last_mut() {
        if last.text == segment.text {
            if last.words.is_none() && segment.words.is_some() {
                *last = segment;
            }
            return;
        }
    }

    segments.push(segment);
}

// ---------------------------------------------------------------------------
// json3
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct Json3Response {
    events: Option<Vec<Json3Event>>,
}

#[derive(Debug, Deserialize)]
struct Json3Event {
    #[serde(rename = "tStartMs")]
    t_start_ms: Option<f64>,
    #[serde(rename = "dDurationMs")]
    d_duration_ms: Option<f64>,
    segs: Option<Vec<Json3Seg>>,
    #[serde(rename = "aAppend")]
    a_append: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct Json3Seg {
    utf8: Option<String>,
    #[serde(rename = "tOffsetMs")]
    t_offset_ms: Option<i64>,
}

/// Parse YouTube's `fmt=json3` caption payload, preserving per-word `tOffsetMs` timings.
pub fn parse_json3_captions(body: &str) -> Vec<TranscriptSegment> {
    let parsed: Json3Response = match serde_json::from_str(body) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };

    let mut segments: Vec<TranscriptSegment> = Vec::new();

    for event in parsed.events.unwrap_or_default() {
        // Roll-up bookkeeping events carry no new text of their own.
        if event.a_append == Some(1) {
            continue;
        }
        let segs = match event.segs {
            Some(s) if !s.is_empty() => s,
            _ => continue,
        };

        let t_start_ms = event.t_start_ms.unwrap_or(0.0).round() as i64;
        let d_duration_ms = event.d_duration_ms.unwrap_or(0.0).round() as i64;

        let chunks: Vec<Chunk> = segs
            .iter()
            .map(|seg| {
                // Decode + strip PER SEG, before any joining.
                let text = strip_tags(&decode_html_entities(seg.utf8.as_deref().unwrap_or("")));
                Chunk {
                    text,
                    start_ms: t_start_ms + seg.t_offset_ms.unwrap_or(0),
                    offset_ms: seg.t_offset_ms,
                    drop_boundary: true,
                }
            })
            .collect();

        push_segment(
            &mut segments,
            chunks,
            t_start_ms,
            t_start_ms + d_duration_ms.max(0),
        );
    }

    segments
}

// ---------------------------------------------------------------------------
// WebVTT
// ---------------------------------------------------------------------------

/// Parse WebVTT, preserving yt-dlp auto-sub inline `<HH:MM:SS.mmm>` word timings.
pub fn parse_vtt_with_words(content: &str) -> Vec<TranscriptSegment> {
    let mut segments: Vec<TranscriptSegment> = Vec::new();
    let lines: Vec<&str> = content.lines().collect();

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();

        // Skip header and empty lines
        if line.is_empty() || line == "WEBVTT" {
            i += 1;
            continue;
        }

        // Look for timestamp line: 00:00:00.000 --> 00:00:02.500
        if let Some((start, end)) = crate::youtube::parse_timestamp_line(line) {
            let cue_start_ms = (start * 1000.0).round() as i64;
            let cue_end_ms = ((end * 1000.0).round() as i64).max(cue_start_ms);

            // Collect text until next timestamp or empty line
            i += 1;
            let mut payload: Vec<&str> = Vec::new();
            while i < lines.len() && !lines[i].trim().is_empty() && !lines[i].contains("-->") {
                let text_line = lines[i].trim();
                if !text_line.starts_with("NOTE") && !text_line.starts_with("STYLE") {
                    payload.push(text_line);
                }
                i += 1;
            }

            let chunks = tokenize_vtt_payload(&payload, cue_start_ms);
            push_segment(&mut segments, chunks, cue_start_ms, cue_end_ms);
        } else {
            i += 1;
        }
    }

    segments
}

/// Split a cue payload into timed chunks.
///
/// Chunk boundaries are inline `<HH:MM:SS.mmm>` timestamps and line breaks. Text before the
/// first inline timestamp on a cue belongs to the cue's own start time (`offset_ms: None`),
/// which is exactly the carry-over signature yt-dlp's rolling auto-subs produce.
/// Non-timestamp tags (`<c>`, `</c>`, `<c.colorE5E5E5>`, `<v Speaker>`) are transparent.
fn tokenize_vtt_payload(payload: &[&str], cue_start_ms: i64) -> Vec<Chunk> {
    let mut chunks: Vec<Chunk> = Vec::new();
    let mut buf = String::new();
    let mut current_ms = cue_start_ms;
    let mut current_offset: Option<i64> = None;

    for (line_idx, raw_line) in payload.iter().enumerate() {
        let mut chars = raw_line.chars().peekable();
        while let Some(ch) = chars.next() {
            if ch != '<' {
                buf.push(ch);
                continue;
            }

            // Consume the tag body.
            let mut tag = String::new();
            let mut closed = false;
            for tag_ch in chars.by_ref() {
                if tag_ch == '>' {
                    closed = true;
                    break;
                }
                tag.push(tag_ch);
            }
            if !closed {
                // Unterminated '<' — treat literally.
                buf.push('<');
                buf.push_str(&tag);
                continue;
            }

            // A non-timestamp tag (`<c>`, `</c>`, `<c.colorE5E5E5>`, `<v Speaker>`) is
            // transparent: it is dropped without breaking the token being accumulated.
            if let Some(seconds) = crate::youtube::parse_vtt_timestamp(tag.trim()) {
                // Flush what came before this timestamp, then retime.
                flush_vtt_chunk(&mut chunks, &mut buf, current_ms, current_offset, false);
                let abs_ms = (seconds * 1000.0).round() as i64;
                current_ms = abs_ms;
                current_offset = Some(abs_ms - cue_start_ms);
            }
        }

        // A line break is a token boundary; keep the separating space in the text.
        if line_idx + 1 < payload.len() && !buf.is_empty() {
            buf.push(' ');
            flush_vtt_chunk(&mut chunks, &mut buf, current_ms, current_offset, true);
        }
    }

    flush_vtt_chunk(&mut chunks, &mut buf, current_ms, current_offset, true);
    chunks
}

fn flush_vtt_chunk(
    chunks: &mut Vec<Chunk>,
    buf: &mut String,
    start_ms: i64,
    offset_ms: Option<i64>,
    drop_boundary: bool,
) {
    if buf.is_empty() {
        return;
    }
    let text = decode_html_entities(buf);
    buf.clear();
    chunks.push(Chunk {
        text,
        start_ms,
        offset_ms,
        drop_boundary,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The one invariant the renderer depends on.
    fn assert_ordinal_invariant(segments: &[TranscriptSegment]) {
        for seg in segments {
            if let Some(words) = &seg.words {
                assert_eq!(
                    words.len(),
                    seg.text.split_whitespace().count(),
                    "ordinal invariant violated for segment {:?}",
                    seg.text
                );
            }
        }
    }

    fn assert_monotonic_words(segments: &[TranscriptSegment]) {
        for seg in segments {
            if let Some(words) = &seg.words {
                for pair in words.windows(2) {
                    assert!(
                        pair[0].start_ms < pair[1].start_ms,
                        "word starts not strictly increasing: {:?}",
                        words
                    );
                    assert!(
                        pair[0].end_ms <= pair[1].start_ms,
                        "words overlap: {:?}",
                        words
                    );
                }
                for w in words {
                    assert!(w.end_ms > w.start_ms, "zero-length word: {:?}", w);
                }
            }
        }
    }

    #[test]
    fn test_decode_html_entities() {
        assert_eq!(
            decode_html_entities("&amp; &lt; &gt; &quot; &#39; &apos;"),
            "& < > \" ' '"
        );
    }

    #[test]
    fn test_strip_tags() {
        assert_eq!(
            strip_tags("<font color=\"#ffffff\">hello</font> <b>world</b>"),
            "hello world"
        );
    }

    #[test]
    fn json3_asr_emits_one_word_per_token() {
        let body = r#"{
            "events": [
                {
                    "tStartMs": 1000,
                    "dDurationMs": 2000,
                    "segs": [
                        {"utf8": "hello"},
                        {"utf8": " brave", "tOffsetMs": 500},
                        {"utf8": " world", "tOffsetMs": 1200}
                    ]
                }
            ]
        }"#;

        let segments = parse_json3_captions(body);
        assert_eq!(segments.len(), 1);
        let seg = &segments[0];
        assert_eq!(seg.text, "hello brave world");
        assert_eq!(seg.start, 1.0);
        assert_eq!(seg.duration, 2.0);

        let words = seg.words.as_ref().expect("ASR json3 must carry words");
        assert_eq!(words.len(), 3);
        assert_eq!(words[0].word, "hello");
        assert_eq!(words[0].start_ms, 1000);
        assert_eq!(words[1].word, "brave");
        assert_eq!(words[1].start_ms, 1500);
        assert_eq!(words[2].word, "world");
        assert_eq!(words[2].start_ms, 2200);
        assert_eq!(words[2].end_ms, 3000);

        assert_ordinal_invariant(&segments);
        assert_monotonic_words(&segments);
    }

    #[test]
    fn json3_multi_token_seg_splits_span_evenly() {
        let body = r#"{
            "events": [
                {
                    "tStartMs": 0,
                    "dDurationMs": 4000,
                    "segs": [
                        {"utf8": "one two"},
                        {"utf8": " three", "tOffsetMs": 2000}
                    ]
                }
            ]
        }"#;

        let segments = parse_json3_captions(body);
        assert_eq!(segments.len(), 1);
        let words = segments[0].words.as_ref().unwrap();
        assert_eq!(words.len(), 3);
        assert_eq!(words[0].start_ms, 0);
        assert_eq!(words[1].start_ms, 1000);
        assert_eq!(words[2].start_ms, 2000);
        assert_eq!(words[2].end_ms, 4000);
        assert_ordinal_invariant(&segments);
        assert_monotonic_words(&segments);
    }

    #[test]
    fn json3_manual_track_without_offsets_emits_no_words() {
        let body = r#"{
            "events": [
                {
                    "tStartMs": 0,
                    "dDurationMs": 3000,
                    "segs": [{"utf8": "The quick brown fox"}]
                },
                {
                    "tStartMs": 3000,
                    "dDurationMs": 2500,
                    "segs": [{"utf8": "jumps over\nthe lazy dog"}]
                }
            ]
        }"#;

        let segments = parse_json3_captions(body);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].text, "The quick brown fox");
        assert_eq!(segments[1].text, "jumps over the lazy dog");
        assert!(segments[0].words.is_none());
        assert!(segments[1].words.is_none());
        assert_ordinal_invariant(&segments);
    }

    #[test]
    fn json3_rolling_window_emits_each_line_once() {
        // Event 2 repeats event 1's text as its (offset-less) head before adding new words.
        let body = r#"{
            "events": [
                {
                    "tStartMs": 0,
                    "dDurationMs": 2000,
                    "segs": [
                        {"utf8": "now"},
                        {"utf8": " that's", "tOffsetMs": 400},
                        {"utf8": " a", "tOffsetMs": 900}
                    ]
                },
                {
                    "tStartMs": 2000,
                    "dDurationMs": 2000,
                    "segs": [
                        {"utf8": "now that's a"},
                        {"utf8": " lot", "tOffsetMs": 300},
                        {"utf8": " of", "tOffsetMs": 800},
                        {"utf8": " words", "tOffsetMs": 1400}
                    ]
                }
            ]
        }"#;

        let segments = parse_json3_captions(body);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].text, "now that's a");
        assert_eq!(segments[1].text, "lot of words");

        let w1 = segments[1].words.as_ref().unwrap();
        assert_eq!(w1.len(), 3);
        assert_eq!(w1[0].word, "lot");
        assert_eq!(w1[0].start_ms, 2300);
        assert_eq!(w1[1].start_ms, 2800);
        assert_eq!(w1[2].start_ms, 3400);

        assert!(segments[0].start < segments[1].start);
        assert_ordinal_invariant(&segments);
        assert_monotonic_words(&segments);
    }

    #[test]
    fn json3_append_events_are_skipped() {
        let body = r#"{
            "events": [
                {"tStartMs": 0, "dDurationMs": 1000, "segs": [{"utf8": "keep me"}]},
                {"tStartMs": 1000, "dDurationMs": 1000, "aAppend": 1, "segs": [{"utf8": "\n"}]},
                {"tStartMs": 2000, "dDurationMs": 1000, "segs": [{"utf8": "and me"}]}
            ]
        }"#;

        let segments = parse_json3_captions(body);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].text, "keep me");
        assert_eq!(segments[1].text, "and me");
        assert_ordinal_invariant(&segments);
    }

    #[test]
    fn json3_entities_and_tags_are_cleaned_per_seg() {
        let body = r#"{
            "events": [
                {
                    "tStartMs": 0,
                    "dDurationMs": 2000,
                    "segs": [
                        {"utf8": "<i>rock</i>"},
                        {"utf8": " &amp;", "tOffsetMs": 500},
                        {"utf8": " roll", "tOffsetMs": 1000}
                    ]
                }
            ]
        }"#;

        let segments = parse_json3_captions(body);
        assert_eq!(segments[0].text, "rock & roll");
        let words = segments[0].words.as_ref().unwrap();
        assert_eq!(words.len(), 3);
        assert_eq!(words[1].word, "&");
        assert_ordinal_invariant(&segments);
        assert_monotonic_words(&segments);
    }

    #[test]
    fn json3_empty_or_invalid_body_yields_nothing() {
        assert!(parse_json3_captions("not json").is_empty());
        assert!(parse_json3_captions(r#"{"events":[]}"#).is_empty());
        assert!(parse_json3_captions(r#"{"events":[{"tStartMs":0}]}"#).is_empty());
    }

    #[test]
    fn vtt_auto_sub_word_timings_dedupe_plain_duplicate() {
        let content = "WEBVTT\n\
                       \n\
                       00:00:01.000 --> 00:00:03.000 align:start position:0%\n\
                       hello world\n\
                       \n\
                       00:00:01.000 --> 00:00:03.000 align:start position:0%\n\
                       hello<00:00:01.560><c> world</c>\n";

        let segments = parse_vtt_with_words(content);
        assert_eq!(segments.len(), 1, "plain duplicate cue must collapse");
        let seg = &segments[0];
        assert_eq!(seg.text, "hello world");
        assert_eq!(seg.start, 1.0);

        let words = seg
            .words
            .as_ref()
            .expect("word-tagged cue must carry words");
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].word, "hello");
        assert_eq!(words[0].start_ms, 1000);
        assert_eq!(words[1].word, "world");
        assert_eq!(words[1].start_ms, 1560);
        assert_eq!(words[1].end_ms, 3000);

        assert_ordinal_invariant(&segments);
        assert_monotonic_words(&segments);
    }

    #[test]
    fn vtt_auto_sub_plain_duplicate_after_tagged_cue() {
        // The order yt-dlp actually emits: the word-tagged cue, then a sliver cue
        // repeating the same line in plain text.
        let content = "WEBVTT\n\
                       \n\
                       00:00:01.000 --> 00:00:03.000 align:start position:0%\n\
                       hello<00:00:01.560><c> world</c>\n\
                       \n\
                       00:00:03.000 --> 00:00:03.010 align:start position:0%\n\
                       hello world\n";

        let segments = parse_vtt_with_words(content);
        assert_eq!(segments.len(), 1, "plain duplicate cue must collapse");
        let words = segments[0].words.as_ref().unwrap();
        assert_eq!(words.len(), 2);
        assert_eq!(words[1].start_ms, 1560);
        assert_ordinal_invariant(&segments);
        assert_monotonic_words(&segments);
    }

    #[test]
    fn vtt_rolling_auto_subs_drop_carried_over_line() {
        // The real yt-dlp shape: each cue repeats the previous line, then adds a tagged one.
        let content = "WEBVTT\n\
                       \n\
                       00:00:00.000 --> 00:00:02.000 align:start position:0%\n\
                       now<00:00:00.630><c> that's</c><00:00:00.960><c> a</c>\n\
                       \n\
                       00:00:02.000 --> 00:00:04.000 align:start position:0%\n\
                       now that's a\n\
                       lot<00:00:02.500><c> of</c><00:00:03.100><c> words</c>\n";

        let segments = parse_vtt_with_words(content);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].text, "now that's a");
        assert_eq!(segments[1].text, "lot of words");

        let w0 = segments[0].words.as_ref().unwrap();
        assert_eq!(w0[0].start_ms, 0);
        assert_eq!(w0[1].start_ms, 630);
        assert_eq!(w0[2].start_ms, 960);

        let w1 = segments[1].words.as_ref().unwrap();
        assert_eq!(w1.len(), 3);
        assert_eq!(w1[0].word, "lot");
        assert_eq!(w1[0].start_ms, 2000);
        assert_eq!(w1[1].start_ms, 2500);
        assert_eq!(w1[2].start_ms, 3100);

        assert!(segments[0].start < segments[1].start);
        assert_ordinal_invariant(&segments);
        assert_monotonic_words(&segments);
    }

    #[test]
    fn vtt_manual_captions_have_no_words() {
        let content = "WEBVTT\n\
                       \n\
                       1\n\
                       00:00:00.000 --> 00:00:02.500\n\
                       <v Narrator>The quick brown fox\n\
                       jumps over the lazy dog\n\
                       \n\
                       2\n\
                       00:00:02.500 --> 00:00:05.000\n\
                       Pack my box with five dozen liquor jugs\n";

        let segments = parse_vtt_with_words(content);
        assert_eq!(segments.len(), 2);
        assert_eq!(
            segments[0].text,
            "The quick brown fox jumps over the lazy dog"
        );
        assert_eq!(segments[0].duration, 2.5);
        assert_eq!(segments[1].text, "Pack my box with five dozen liquor jugs");
        assert!(segments[0].words.is_none());
        assert!(segments[1].words.is_none());
        assert_ordinal_invariant(&segments);
    }

    #[test]
    fn vtt_short_timestamps_and_entities() {
        let content = "WEBVTT\n\
                       \n\
                       00:01.000 --> 00:03.000\n\
                       rock<00:00:01.500><c> &amp;</c><00:00:02.000><c> roll</c>\n";

        let segments = parse_vtt_with_words(content);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].text, "rock & roll");
        let words = segments[0].words.as_ref().unwrap();
        assert_eq!(words.len(), 3);
        assert_eq!(words[1].word, "&");
        assert_eq!(words[1].start_ms, 1500);
        assert_ordinal_invariant(&segments);
        assert_monotonic_words(&segments);
    }

    #[test]
    fn vtt_empty_input_yields_nothing() {
        assert!(parse_vtt_with_words("").is_empty());
        assert!(parse_vtt_with_words("WEBVTT\n\n").is_empty());
    }

    // ---- wire-format guarantees -------------------------------------------------

    #[test]
    fn segment_without_words_serializes_to_legacy_shape() {
        let seg = TranscriptSegment {
            text: "hello".to_string(),
            start: 1.5,
            duration: 2.0,
            words: None,
        };
        let json = serde_json::to_string(&seg).unwrap();
        assert_eq!(json, r#"{"text":"hello","start":1.5,"duration":2.0}"#);
    }

    #[test]
    fn segment_with_words_serializes_word_timings() {
        let seg = TranscriptSegment {
            text: "hi there".to_string(),
            start: 0.0,
            duration: 1.0,
            words: Some(vec![
                WordTiming {
                    word: "hi".to_string(),
                    start_ms: 0,
                    end_ms: 500,
                },
                WordTiming {
                    word: "there".to_string(),
                    start_ms: 500,
                    end_ms: 1000,
                },
            ]),
        };
        let json = serde_json::to_string(&seg).unwrap();
        assert_eq!(
            json,
            r#"{"text":"hi there","start":0.0,"duration":1.0,"words":[{"word":"hi","start_ms":0,"end_ms":500},{"word":"there","start_ms":500,"end_ms":1000}]}"#
        );
    }

    #[test]
    fn legacy_cached_blob_without_words_still_deserializes() {
        let legacy = r#"[{"text":"hello","start":0.0,"duration":1.0},
                         {"text":"world","start":1.0,"duration":1.0}]"#;
        let segments: Vec<TranscriptSegment> = serde_json::from_str(legacy).unwrap();
        assert_eq!(segments.len(), 2);
        assert!(segments.iter().all(|s| s.words.is_none()));
    }

    #[test]
    fn explicit_null_words_deserializes_as_none() {
        let blob = r#"[{"text":"hello","start":0.0,"duration":1.0,"words":null}]"#;
        let segments: Vec<TranscriptSegment> = serde_json::from_str(blob).unwrap();
        assert!(segments[0].words.is_none());
    }
}
