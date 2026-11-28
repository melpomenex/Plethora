//! Silence & Word Timestamp Boundary Snapper
//!
//! Refines rough ad boundaries by snapping to exact word timestamps and acoustic silence gaps.

use crate::transcription::manager::PodcastWordToken;

/// A detected acoustic pause / silence window
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SilenceGap {
    pub start_ms: i64,
    pub end_ms: i64,
}

impl SilenceGap {
    pub fn duration_ms(&self) -> i64 {
        self.end_ms - self.start_ms
    }

    pub fn center_ms(&self) -> i64 {
        (self.start_ms + self.end_ms) / 2
    }
}

/// Snap a rough timestamp to the nearest word boundary
pub fn snap_to_word_boundary(
    tokens: &[PodcastWordToken],
    rough_ms: i64,
    is_start_boundary: bool,
) -> i64 {
    if tokens.is_empty() {
        return rough_ms;
    }

    // Check if rough_ms falls inside a word
    for (i, token) in tokens.iter().enumerate() {
        if rough_ms >= token.start_ms && rough_ms <= token.end_ms {
            return if is_start_boundary {
                // For ad start: snap to the start of this word so we don't clip the beginning
                token.start_ms
            } else {
                // For ad end: snap to the end of this word so we don't clip the tail of the sponsor
                token.end_ms
            };
        }

        // If rough_ms is between tokens[i] and tokens[i+1], snap to the closest boundary
        if i + 1 < tokens.len() {
            let next = &tokens[i + 1];
            if rough_ms > token.end_ms && rough_ms < next.start_ms {
                return if rough_ms - token.end_ms <= next.start_ms - rough_ms {
                    token.end_ms
                } else {
                    next.start_ms
                };
            }
        }
    }

    // If before first token or after last token
    if rough_ms < tokens[0].start_ms {
        tokens[0].start_ms
    } else {
        tokens.last().map(|t| t.end_ms).unwrap_or(rough_ms)
    }
}

/// Snap a candidate timestamp to the center of any acoustic silence window (>=150ms)
/// located within `search_window_ms` (typically ±2500ms).
pub fn snap_to_silence_window(
    candidate_ms: i64,
    silence_gaps: &[SilenceGap],
    search_window_ms: i64,
) -> i64 {
    let min_search = (candidate_ms - search_window_ms).max(0);
    let max_search = candidate_ms + search_window_ms;

    // Find silence gaps that:
    // 1. Are >= 150ms in duration
    // 2. Overlap or are closest to candidate_ms within ±search_window_ms
    let mut best_gap: Option<SilenceGap> = None;
    let mut min_distance = i64::MAX;

    for gap in silence_gaps {
        if gap.duration_ms() < 150 {
            continue;
        }

        let center = gap.center_ms();
        if center >= min_search && center <= max_search {
            let dist = (center - candidate_ms).abs();
            if dist < min_distance {
                min_distance = dist;
                best_gap = Some(*gap);
            }
        }
    }

    match best_gap {
        Some(gap) => gap.center_ms(),
        None => candidate_ms,
    }
}

/// Full refinement pipeline:
/// 1. Snap rough timestamp to word boundary
/// 2. If an acoustic pause (>=150ms) exists within ±`search_window_ms` (default ±2500ms), snap to center of pause
pub fn refine_boundary_with_window(
    tokens: &[PodcastWordToken],
    silence_gaps: &[SilenceGap],
    rough_ms: i64,
    is_start_boundary: bool,
    search_window_ms: i64,
) -> i64 {
    let word_snapped = snap_to_word_boundary(tokens, rough_ms, is_start_boundary);
    snap_to_silence_window(word_snapped, silence_gaps, search_window_ms.max(0))
}

/// Full refinement pipeline with the default ±2.5s search window.
pub fn refine_boundary(
    tokens: &[PodcastWordToken],
    silence_gaps: &[SilenceGap],
    rough_ms: i64,
    is_start_boundary: bool,
) -> i64 {
    refine_boundary_with_window(tokens, silence_gaps, rough_ms, is_start_boundary, 2500)
}

/// Scan PCM s16le 16kHz mono samples for contiguous silence gaps (< -40 dBFS for >= 150ms).
pub fn find_silence_gaps_in_pcm(
    samples: &[i16],
    sample_rate_hz: u32,
    offset_ms: i64,
    threshold_dbfs: f64,
    min_duration_ms: i64,
) -> Vec<SilenceGap> {
    if samples.is_empty() || sample_rate_hz == 0 {
        return Vec::new();
    }

    let frame_samples = ((sample_rate_hz as usize) / 100).max(1); // 10ms frames
    let frame_ms = 10i64;
    let linear_threshold = 10f64.powf(threshold_dbfs / 20.0) * 32768.0;

    let mut gaps = Vec::new();
    let mut silence_start_ms: Option<i64> = None;

    for (idx, chunk) in samples.chunks(frame_samples).enumerate() {
        let sum_sq: f64 = chunk.iter().map(|&s| (s as f64) * (s as f64)).sum();
        let rms = (sum_sq / chunk.len() as f64).sqrt();
        let t_ms = offset_ms + (idx as i64) * frame_ms;

        if rms < linear_threshold {
            if silence_start_ms.is_none() {
                silence_start_ms = Some(t_ms);
            }
        } else if let Some(start) = silence_start_ms.take() {
            if t_ms - start >= min_duration_ms {
                gaps.push(SilenceGap {
                    start_ms: start,
                    end_ms: t_ms,
                });
            }
        }
    }

    if let Some(start) = silence_start_ms {
        let total_ms = offset_ms + ((samples.len() as i64) * 1000) / (sample_rate_hz as i64);
        if total_ms - start >= min_duration_ms {
            gaps.push(SilenceGap {
                start_ms: start,
                end_ms: total_ms,
            });
        }
    }

    gaps
}

/// Decode small ±`search_window_ms` windows around candidate timestamps using `ffmpeg`
/// (if available) and return detected silence gaps (< -40 dBFS for >= 150ms).
pub fn detect_silence_gaps_around_points(
    audio_path: &std::path::Path,
    candidate_points_ms: &[i64],
    search_window_ms: i64,
) -> Vec<SilenceGap> {
    if !audio_path.exists() || candidate_points_ms.is_empty() || search_window_ms <= 0 {
        return Vec::new();
    }

    let Some(ffmpeg_path) = crate::utils::ffmpeg::resolve_tool_path("ffmpeg") else {
        return Vec::new();
    };

    // Merge overlapping ±search_window_ms windows so we decode each region at most once.
    let mut windows: Vec<(i64, i64)> = candidate_points_ms
        .iter()
        .map(|&pt| ((pt - search_window_ms).max(0), pt + search_window_ms))
        .collect();
    windows.sort_by_key(|w| w.0);

    let mut merged: Vec<(i64, i64)> = Vec::new();
    for (s, e) in windows {
        if let Some(last) = merged.last_mut() {
            if s <= last.1 {
                last.1 = last.1.max(e);
                continue;
            }
        }
        merged.push((s, e));
    }

    let mut all_gaps = Vec::new();
    for (start_ms, end_ms) in merged {
        let start_sec = (start_ms as f64) / 1000.0;
        let dur_sec = ((end_ms - start_ms).max(100) as f64) / 1000.0;

        let output = std::process::Command::new(&ffmpeg_path)
            .env("PATH", crate::utils::ffmpeg::enhanced_path())
            .args([
                "-v",
                "error",
                "-ss",
                &format!("{:.3}", start_sec),
                "-t",
                &format!("{:.3}", dur_sec),
                "-i",
                &audio_path.to_string_lossy(),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-f",
                "s16le",
                "-",
            ])
            .output();

        if let Ok(out) = output {
            if out.status.success() && out.stdout.len() >= 2 {
                let samples: Vec<i16> = out
                    .stdout
                    .chunks_exact(2)
                    .map(|b| i16::from_le_bytes([b[0], b[1]]))
                    .collect();
                all_gaps.extend(find_silence_gaps_in_pcm(
                    &samples, 16_000, start_ms, -40.0, 150,
                ));
            }
        }
    }

    all_gaps
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token(text: &str, start_ms: i64, end_ms: i64) -> PodcastWordToken {
        PodcastWordToken {
            text: text.into(),
            start_ms,
            end_ms,
            probability: Some(0.99),
        }
    }

    #[test]
    fn snaps_rough_timestamp_inside_word_to_outer_boundary() {
        let tokens = vec![
            token("We", 1000, 1200),
            token("love", 1300, 1600),
            token("sponsors", 1700, 2400),
            token("today", 2500, 2800),
        ];

        // Start boundary inside "sponsors" (2000ms) snaps to start (1700ms)
        let snapped_start = snap_to_word_boundary(&tokens, 2000, true);
        assert_eq!(snapped_start, 1700);

        // End boundary inside "sponsors" (2000ms) snaps to end (2400ms)
        let snapped_end = snap_to_word_boundary(&tokens, 2000, false);
        assert_eq!(snapped_end, 2400);
    }

    #[test]
    fn snaps_boundary_to_center_of_silence_pause() {
        let tokens = vec![token("before", 1000, 1500), token("after", 2500, 3000)];

        // 1000ms silence gap between 1500ms and 2500ms
        let pauses = vec![SilenceGap {
            start_ms: 1500,
            end_ms: 2500,
        }];

        let refined = refine_boundary(&tokens, &pauses, 1600, true);
        // Center of 1500..2500 is 2000
        assert_eq!(refined, 2000);
    }

    #[test]
    fn ignores_micro_pauses_under_150ms() {
        let tokens = vec![token("quick", 1000, 1400), token("words", 1500, 2000)];

        // 100ms gap is < 150ms
        let micro_pause = vec![SilenceGap {
            start_ms: 1400,
            end_ms: 1500,
        }];

        let refined = refine_boundary(&tokens, &micro_pause, 1420, true);
        // Should NOT snap to micro pause center, but stay at word boundary
        assert_eq!(refined, 1400);
    }

    #[test]
    fn detects_silence_gaps_in_pcm_below_minus_40dbfs() {
        // 16kHz mono: 0.2s loud, 0.3s silence, 0.2s loud
        let mut samples = vec![10_000i16; 3_200];
        samples.extend(vec![10i16; 4_800]);
        samples.extend(vec![10_000i16; 3_200]);

        let gaps = find_silence_gaps_in_pcm(&samples, 16_000, 1_000, -40.0, 150);
        assert_eq!(gaps.len(), 1);
        assert!(gaps[0].start_ms >= 1_190 && gaps[0].start_ms <= 1_210);
        assert!(gaps[0].duration_ms() >= 280);
    }
}
