//! STT Orchestrator & Token Dispatcher
//!
//! Provides word-level timestamped token extraction, normalization, and collection
//! across STT engines (Whisper, Parakeet/sherpa-onnx, Whistle/needle, Android STT, Groq).

use serde::{Deserialize, Serialize};
use crate::transcription::engine::TranscriptSegment;

/// A word-level token with high-resolution timestamps (in milliseconds) and optional confidence/probability.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodcastWordToken {
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probability: Option<f64>,
}

/// Helper struct for deserializing word timings that may use either `word` or `text`
/// and timestamps in seconds or milliseconds.
#[derive(Debug, Deserialize)]
struct GenericWordTimingEntry {
    #[serde(alias = "text")]
    word: Option<String>,
    #[serde(default)]
    start_ms: Option<i64>,
    #[serde(default)]
    end_ms: Option<i64>,
    #[serde(default)]
    start: Option<f64>,
    #[serde(default)]
    end: Option<f64>,
    #[serde(default)]
    probability: Option<f64>,
    #[serde(default)]
    confidence: Option<f64>,
}

/// Extract word-level timestamped tokens from a `TranscriptSegment`.
///
/// If `words_json` is present and valid JSON, tokens are parsed directly.
/// If `words_json` is absent or cannot be parsed, this generates interpolated
/// word tokens by dividing `segment.text` across `segment.start_ms..segment.end_ms`.
pub fn extract_word_tokens(segment: &TranscriptSegment) -> Vec<PodcastWordToken> {
    if let Some(ref words_json) = segment.words_json {
        if let Ok(tokens) = parse_words_json(words_json, segment.start_ms, segment.end_ms) {
            if !tokens.is_empty() {
                return tokens;
            }
        }
    }

    interpolate_words(&segment.text, segment.start_ms, segment.end_ms, segment.confidence as f64)
}

/// Parse a raw JSON string of word timing entries into `PodcastWordToken`s.
pub fn parse_words_json(
    words_json: &str,
    fallback_start_ms: i64,
    fallback_end_ms: i64,
) -> Result<Vec<PodcastWordToken>, serde_json::Error> {
    let entries: Vec<GenericWordTimingEntry> = serde_json::from_str(words_json)?;
    let mut tokens = Vec::with_capacity(entries.len());

    for entry in entries {
        let text = match entry.word {
            Some(w) if !w.trim().is_empty() => w.trim().to_string(),
            _ => continue,
        };

        let start_ms = entry
            .start_ms
            .or_else(|| entry.start.map(|s| (s * 1000.0).round() as i64))
            .unwrap_or(fallback_start_ms);

        let end_ms = entry
            .end_ms
            .or_else(|| entry.end.map(|e| (e * 1000.0).round() as i64))
            .unwrap_or_else(|| start_ms + 200)
            .max(start_ms + 1);

        let probability = entry.probability.or(entry.confidence);

        tokens.push(PodcastWordToken {
            text,
            start_ms,
            end_ms,
            probability,
        });
    }

    Ok(tokens)
}

/// Split text by whitespace and interpolate start/end timestamps evenly.
pub fn interpolate_words(
    text: &str,
    start_ms: i64,
    end_ms: i64,
    confidence: f64,
) -> Vec<PodcastWordToken> {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return Vec::new();
    }

    let duration_ms = (end_ms - start_ms).max(words.len() as i64 * 50);
    let step = duration_ms / words.len() as i64;

    let word_count = words.len();
    words
        .into_iter()
        .enumerate()
        .map(|(i, word)| {
            let word_start = start_ms + (i as i64 * step);
            let word_end = if i == word_count - 1 {
                end_ms
            } else {
                (word_start + step).max(word_start + 1)
            };
            PodcastWordToken {
                text: word.to_string(),
                start_ms: word_start,
                end_ms: word_end,
                probability: Some(confidence),
            }
        })
        .collect()
}

/// Extract all word tokens from a slice of segments.
pub fn collect_tokens_from_segments(segments: &[TranscriptSegment]) -> Vec<PodcastWordToken> {
    segments.iter().flat_map(extract_word_tokens).collect()
}

/// Mock STT runner emitting a token stream with timestamps for testing.
pub struct MockSttRunner {
    tokens: Vec<PodcastWordToken>,
}

impl MockSttRunner {
    pub fn new(tokens: Vec<PodcastWordToken>) -> Self {
        Self { tokens }
    }

    pub fn emit_stream<F>(&self, mut callback: F)
    where
        F: FnMut(PodcastWordToken),
    {
        for token in &self.tokens {
            callback(token.clone());
        }
    }
}

/// Determine optimal STT worker thread count based on platform and thermal state.
///
/// On mobile platforms, limits concurrency to 1 or 2 threads to prevent UI stutters.
/// Drops to 1 thread under moderate or severe thermal pressure, and 0 on critical.
pub fn determine_stt_worker_threads(is_mobile: bool, thermal_status: &str) -> usize {
    if is_mobile {
        match thermal_status.to_lowercase().as_str() {
            "critical" => 0,
            "severe" | "moderate" => 1,
            _ => 2,
        }
    } else {
        let cores = std::thread::available_parallelism()
            .map(|p| p.get())
            .unwrap_or(4);
        match thermal_status.to_lowercase().as_str() {
            "critical" => 0,
            "severe" => 1,
            "moderate" => cores.min(2),
            _ => cores,
        }
    }
}

/// Action to take when evaluating thermal state during long-running STT chunk processing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SttThermalAction {
    Continue,
    PauseWorker(std::time::Duration),
    AbortChunk { reason: &'static str },
}

/// Check thermal state during active transcription chunk execution.
pub fn evaluate_stt_thermal_state(thermal_status: &str) -> SttThermalAction {
    match thermal_status.to_lowercase().as_str() {
        "critical" => SttThermalAction::AbortChunk {
            reason: "thermal_critical",
        },
        "severe" => SttThermalAction::PauseWorker(std::time::Duration::from_secs(30)),
        _ => SttThermalAction::Continue,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_whistle_word_timings() {
        let json = r#"[
            {"word":"Hello","start_ms":100,"end_ms":400,"probability":0.95},
            {"word":"world","start_ms":450,"end_ms":800,"probability":0.99}
        ]"#;
        let tokens = parse_words_json(json, 0, 1000).unwrap();
        assert_eq!(tokens.len(), 2);
        assert_eq!(tokens[0].text, "Hello");
        assert_eq!(tokens[0].start_ms, 100);
        assert_eq!(tokens[0].end_ms, 400);
        assert_eq!(tokens[0].probability, Some(0.95));
        assert_eq!(tokens[1].text, "world");
        assert_eq!(tokens[1].start_ms, 450);
        assert_eq!(tokens[1].end_ms, 800);
    }

    #[test]
    fn parses_seconds_float_word_timings() {
        let json = r#"[
            {"word":"Welcome","start":1.25,"end":1.75,"confidence":0.88}
        ]"#;
        let tokens = parse_words_json(json, 0, 2000).unwrap();
        assert_eq!(tokens.len(), 1);
        assert_eq!(tokens[0].text, "Welcome");
        assert_eq!(tokens[0].start_ms, 1250);
        assert_eq!(tokens[0].end_ms, 1750);
        assert_eq!(tokens[0].probability, Some(0.88));
    }

    #[test]
    fn interpolates_missing_word_timings() {
        let seg = TranscriptSegment {
            start_ms: 1000,
            end_ms: 3000,
            text: "This is a test".into(),
            confidence: 0.9,
            words_json: None,
        };
        let tokens = extract_word_tokens(&seg);
        assert_eq!(tokens.len(), 4);
        assert_eq!(tokens[0].text, "This");
        assert_eq!(tokens[0].start_ms, 1000);
        assert!(tokens[0].end_ms > 1000);
        assert_eq!(tokens[3].text, "test");
        assert!(tokens[3].end_ms <= 3000);
    }

    #[test]
    fn mock_stt_runner_emits_stream_and_receiver_collects() {
        let runner = MockSttRunner::new(vec![
            PodcastWordToken {
                text: "Sponsor".into(),
                start_ms: 500,
                end_ms: 900,
                probability: Some(0.92),
            },
            PodcastWordToken {
                text: "Message".into(),
                start_ms: 950,
                end_ms: 1400,
                probability: Some(0.96),
            },
        ]);

        let mut collected = Vec::new();
        runner.emit_stream(|token| {
            collected.push(token);
        });

        assert_eq!(collected.len(), 2);
        assert_eq!(collected[0].text, "Sponsor");
        assert_eq!(collected[1].text, "Message");
    }

    #[test]
    fn test_stt_worker_threads_and_thermal_actions() {
        // Mobile thread limits
        assert_eq!(determine_stt_worker_threads(true, "normal"), 2);
        assert_eq!(determine_stt_worker_threads(true, "light"), 2);
        assert_eq!(determine_stt_worker_threads(true, "moderate"), 1);
        assert_eq!(determine_stt_worker_threads(true, "severe"), 1);
        assert_eq!(determine_stt_worker_threads(true, "critical"), 0);

        // Thermal actions
        assert_eq!(evaluate_stt_thermal_state("normal"), SttThermalAction::Continue);
        assert_eq!(
            evaluate_stt_thermal_state("severe"),
            SttThermalAction::PauseWorker(std::time::Duration::from_secs(30))
        );
        assert_eq!(
            evaluate_stt_thermal_state("critical"),
            SttThermalAction::AbortChunk {
                reason: "thermal_critical"
            }
        );
    }
}
