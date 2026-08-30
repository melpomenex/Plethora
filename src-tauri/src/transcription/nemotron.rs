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
use serde::Deserialize;

/// One JSON result line from the sherpa-onnx online binary.
#[derive(Debug, Deserialize)]
struct OnlineResult {
    text: String,
    #[serde(default)]
    timestamps: Vec<f32>,
    #[serde(default)]
    start_time: f32,
}

/// Parse the online binary's raw stderr into timestamped segments.
///
/// `offset_ms` shifts every segment by the containing audio chunk's start
/// (the engine transcribes long files in 30 s windows). Lines that are not
/// JSON objects (config dumps, echo lines, RTF stats) are skipped; malformed
/// JSON lines are skipped rather than failing the whole transcription.
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
        // Timestamps are token-level seconds relative to `start_time`
        // (seconds, also relative to the wav fed to the binary).
        let base_ms = (result.start_time * 1000.0).round() as i64;
        let (first, last) = match (
            result.timestamps.first(),
            result.timestamps.last(),
        ) {
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
}
