//! Local Nemotron ASR output handling (sherpa-onnx streaming runtime).
//!
//! Local inference runs through the bundled sherpa-onnx **online** sidecar
//! (`sherpa-online`), spawned by `TranscriptionEngine::run_sherpa_sidecar` with
//! the generic split-transducer contract (`--encoder/--decoder/--joiner/
//! --tokens`). The model artifact is the official sherpa-onnx int8 export of
//! NVIDIA Nemotron 3.5 ASR streaming 0.6B (see
//! `models::hf::manager::NEMOTRON_ASR_REPO_ID`).
//!
//! This module owns the online binary's output protocol: unlike the offline
//! binary (one JSON line per invocation), the online binary emits per-segment
//! JSON lines on stderr while it processes, each carrying the segment text,
//! per-token timestamps (seconds), and a segment-relative `start_time`:
//!
//! ```text
//! { "text": "…", "tokens": […], "timestamps": [1.68, …], "segment": 0,
//!   "start_time": 0.00, "is_final": false, "is_eof": false }
//! ```
//!
//! The exact recorded output lives in
//! `src-tauri/src/transcription/__fixtures__/sherpa-online-nemotron-output.txt`
//! and the parser tests run against that fixture (v1.13.6).

use crate::transcription::engine::TranscriptSegment;
use serde::{Deserialize, Serialize};

/// One JSON result line from the sherpa-onnx online binary.
#[derive(Debug, Deserialize)]
struct OnlineResult {
    text: String,
    #[serde(default)]
    tokens: Vec<String>,
    #[serde(default)]
    timestamps: Vec<f32>,
    #[serde(default)]
    start_time: f32,
}

/// Word-level timing entry stored in `words_json`.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct NemotronWordTiming {
    pub word: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

/// Parse the online binary's raw stderr into timestamped segments.
///
/// `offset_ms` shifts every segment by the containing audio chunk's start
/// (or resume start). If token-level timestamps are present, the transcript is
/// split into natural sentence segments (on punctuation or ~12s max duration)
/// with embedded word timings (`words_json`).
///
/// Lines that are not JSON objects (config dumps, echo lines, RTF stats) are
/// skipped; malformed JSON lines are skipped rather than failing the whole
/// transcription.
pub fn parse_online_segments(raw: &str, offset_ms: i64) -> Vec<TranscriptSegment> {
    let mut segments = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('{') {
            continue;
        }
        let Ok(result) = serde_json::from_str::<OnlineResult>(trimmed) else {
            continue;
        };
        let text = result.text.trim();
        if text.is_empty() {
            continue;
        }

        let base_ms = (result.start_time * 1000.0).round() as i64;

        // If tokens and timestamps aren't available or have mismatched lengths,
        // fall back to a single segment for this JSON line.
        if result.tokens.is_empty() || result.tokens.len() != result.timestamps.len() {
            let (first, last) = match (result.timestamps.first(), result.timestamps.last()) {
                (Some(f), Some(l)) => (
                    (f * 1000.0).round() as i64,
                    (l * 1000.0).round() as i64,
                ),
                _ => (0, 0),
            };
            segments.push(TranscriptSegment {
                start_ms: offset_ms + base_ms + first,
                end_ms: offset_ms + base_ms + last,
                text: text.to_string(),
                confidence: 1.0,
                words_json: None,
            });
            continue;
        }

        // Reconstruct words from BPE/SentencePiece tokens
        let mut words: Vec<NemotronWordTiming> = Vec::new();
        let mut cur_word = String::new();
        let mut cur_word_start = 0i64;
        let mut cur_word_end = 0i64;

        for (tok, &ts) in result.tokens.iter().zip(result.timestamps.iter()) {
            let t_ms = base_ms + (ts * 1000.0).round() as i64;
            let is_new_word = tok.starts_with(' ') || tok.starts_with(' ');

            if is_new_word && !cur_word.trim().is_empty() {
                words.push(NemotronWordTiming {
                    word: cur_word.trim().to_string(),
                    start_ms: cur_word_start,
                    end_ms: cur_word_end,
                });
                cur_word.clear();
            }

            let clean = tok.trim_start_matches(|c| c == ' ' || c == ' ');
            if cur_word.is_empty() {
                cur_word.push_str(clean);
                cur_word_start = t_ms;
                cur_word_end = t_ms;
            } else {
                cur_word.push_str(clean);
                cur_word_end = t_ms;
            }
        }

        if !cur_word.trim().is_empty() {
            words.push(NemotronWordTiming {
                word: cur_word.trim().to_string(),
                start_ms: cur_word_start,
                end_ms: cur_word_end,
            });
        }

        if words.is_empty() {
            let (first, last) = match (result.timestamps.first(), result.timestamps.last()) {
                (Some(f), Some(l)) => (
                    (f * 1000.0).round() as i64,
                    (l * 1000.0).round() as i64,
                ),
                _ => (0, 0),
            };
            segments.push(TranscriptSegment {
                start_ms: offset_ms + base_ms + first,
                end_ms: offset_ms + base_ms + last,
                text: text.to_string(),
                confidence: 1.0,
                words_json: None,
            });
            continue;
        }

        // Slice words into segments based on sentence-ending punctuation or max duration
        let mut cur_seg_words: Vec<NemotronWordTiming> = Vec::new();

        let flush_segment = |seg_words: &[NemotronWordTiming], segs: &mut Vec<TranscriptSegment>| {
            if seg_words.is_empty() {
                return;
            }
            let seg_start = seg_words.first().unwrap().start_ms;
            let seg_end = seg_words.last().unwrap().end_ms;
            let seg_text = seg_words
                .iter()
                .map(|w| w.word.as_str())
                .collect::<Vec<_>>()
                .join(" ");

            let shifted_words: Vec<NemotronWordTiming> = seg_words
                .iter()
                .map(|w| NemotronWordTiming {
                    word: w.word.clone(),
                    start_ms: offset_ms + w.start_ms,
                    end_ms: offset_ms + w.end_ms,
                })
                .collect();

            let words_json = serde_json::to_string(&shifted_words).ok();

            segs.push(TranscriptSegment {
                start_ms: offset_ms + seg_start,
                end_ms: offset_ms + seg_end,
                text: seg_text,
                confidence: 1.0,
                words_json,
            });
        };

        for w in words {
            let ends_sentence = w.word.ends_with('.')
                || w.word.ends_with('?')
                || w.word.ends_with('!')
                || w.word.ends_with('。')
                || w.word.ends_with('？')
                || w.word.ends_with('！')
                || w.word.ends_with(';')
                || w.word.ends_with('；');

            let too_long = !cur_seg_words.is_empty()
                && (w.end_ms - cur_seg_words[0].start_ms) >= 12_000;

            cur_seg_words.push(w);

            if ends_sentence || (too_long && cur_seg_words.len() >= 3) {
                flush_segment(&cur_seg_words, &mut segments);
                cur_seg_words.clear();
            }
        }

        if !cur_seg_words.is_empty() {
            flush_segment(&cur_seg_words, &mut segments);
        }
    }
    segments
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The recorded v1.13.6 output for the pinned 560 ms int8 model on the
    /// repo's en.wav test file — the parser's contract fixture.
    const FIXTURE: &str = include_str!("__fixtures__/sherpa-online-nemotron-output.txt");

    #[test]
    fn parses_the_recorded_fixture() {
        let segments = parse_online_segments(FIXTURE, 0);
        assert_eq!(segments.len(), 1, "one endpointed segment in the fixture");
        let seg = &segments[0];
        assert_eq!(
            seg.text,
            "The tribal chief then called for the boy and presented him with fifty pieces of gold"
        );
        // First token ts 1.68 s, last token ts 7.12 s (start_time 0.0).
        assert_eq!(seg.start_ms, 1680);
        assert_eq!(seg.end_ms, 7120);
        assert_eq!(seg.confidence, 1.0);
    }

    #[test]
    fn applies_chunk_offsets() {
        let segments = parse_online_segments(FIXTURE, 30_000);
        assert_eq!(segments[0].start_ms, 30_000 + 1680);
        assert_eq!(segments[0].end_ms, 30_000 + 7120);
    }

    #[test]
    fn skips_noise_and_malformed_lines() {
        let raw = "\
Usage: sherpa-onnx
some/config/dump OnlineRecognizerConfig(...)
model/en.wav
Number of threads: 4, Elapsed seconds: 1.4, RTF = 0.2
{ not valid json
The tribal chief then called for the boy
{\"text\": \"  \", \"timestamps\": [0.1], \"start_time\": 0.0}
{\"text\": \"hello world\", \"timestamps\": [0.5, 1.25], \"start_time\": 2.0}
";
        let segments = parse_online_segments(raw, 0);
        assert_eq!(segments.len(), 1, "only the well-formed non-empty line");
        assert_eq!(segments[0].text, "hello world");
        assert_eq!(segments[0].start_ms, 2500);
        assert_eq!(segments[0].end_ms, 3250);
    }

    #[test]
    fn handles_multiple_endpointed_segments() {
        let raw = concat!(
            "{\"text\": \"first utterance\", \"timestamps\": [0.1, 0.9], \"start_time\": 0.0}\n",
            "{\"text\": \"second utterance\", \"timestamps\": [0.2, 1.4], \"start_time\": 4.0}\n",
        );
        let segments = parse_online_segments(raw, 0);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].end_ms, 900);
        assert_eq!(segments[1].start_ms, 4200);
        assert_eq!(segments[1].end_ms, 5400);
    }

    #[test]
    fn empty_output_yields_no_segments() {
        assert!(parse_online_segments("", 0).is_empty());
        assert!(parse_online_segments("no json here at all", 0).is_empty());
    }

    #[test]
    fn splits_long_multi_sentence_transcripts() {
        let raw = "{\"text\": \"Hello world. This is a test! And here is more.\", \"tokens\": [\" Hello\", \" world\", \".\", \" This\", \" is\", \" a\", \" test\", \"!\", \" And\", \" here\", \" is\", \" more\", \".\"], \"timestamps\": [0.1, 0.5, 0.6, 1.0, 1.2, 1.4, 1.8, 1.9, 2.5, 2.7, 2.9, 3.2, 3.3], \"start_time\": 0.0}\n";
        let segments = parse_online_segments(raw, 0);
        assert_eq!(segments.len(), 3, "should split into 3 sentences");
        assert_eq!(segments[0].text, "Hello world.");
        assert_eq!(segments[1].text, "This is a test!");
        assert_eq!(segments[2].text, "And here is more.");
        assert!(segments[0].words_json.is_some());
        let words: Vec<NemotronWordTiming> =
            serde_json::from_str(segments[0].words_json.as_ref().unwrap()).unwrap();
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].word, "Hello");
        assert_eq!(words[1].word, "world.");
    }
}
