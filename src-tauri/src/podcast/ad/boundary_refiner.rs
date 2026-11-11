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

/// Snap a candidate timestamp to the center of any acoustic silence window (>250ms)
/// located within `search_window_ms` (typically ±1500ms).
pub fn snap_to_silence_window(
    candidate_ms: i64,
    silence_gaps: &[SilenceGap],
    search_window_ms: i64,
) -> i64 {
    let min_search = (candidate_ms - search_window_ms).max(0);
    let max_search = candidate_ms + search_window_ms;

    // Find silence gaps that:
    // 1. Are >= 250ms in duration
    // 2. Overlap or are closest to candidate_ms within ±search_window_ms
    let mut best_gap: Option<SilenceGap> = None;
    let mut min_distance = i64::MAX;

    for gap in silence_gaps {
        if gap.duration_ms() < 250 {
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
/// 2. If an acoustic pause (>250ms) exists within ±1.5s, snap to center of pause
pub fn refine_boundary(
    tokens: &[PodcastWordToken],
    silence_gaps: &[SilenceGap],
    rough_ms: i64,
    is_start_boundary: bool,
) -> i64 {
    let word_snapped = snap_to_word_boundary(tokens, rough_ms, is_start_boundary);
    snap_to_silence_window(word_snapped, silence_gaps, 1500)
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
    fn ignores_micro_pauses_under_250ms() {
        let tokens = vec![token("quick", 1000, 1400), token("words", 1550, 2000)];

        // 150ms gap is < 250ms
        let micro_pause = vec![SilenceGap {
            start_ms: 1400,
            end_ms: 1550,
        }];

        let refined = refine_boundary(&tokens, &micro_pause, 1420, true);
        // Should NOT snap to micro pause center, but stay at word boundary
        assert_eq!(refined, 1400);
    }
}
