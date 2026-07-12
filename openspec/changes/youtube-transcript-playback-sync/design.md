## Context

Incrementum renders YouTube videos (and local videos, and audiobooks) next to a timestamped transcript list. The active transcript line — the one whose `[start, end)` range contains the current playback time — is highlighted, and the list is supposed to scroll to keep it visible as the video plays.

Today that behavior lives in `src/components/media/TranscriptSync.tsx` (shared by all three viewers) with a parallel implementation in `src/components/media/TranscriptPanel.tsx` for audiobooks. The mechanism has three compounding problems that make the transcript appear "stuck":

1. **Late active detection.** `YouTubeViewer.tsx` polls `player.getCurrentTime()` once per 1000ms (line 762). So the active line is already up to a second stale before anything can scroll.
2. **Per-index throttle.** `TranscriptSync` suppresses every scroll to the *same* active index for 2000ms (lines 167–169). For short caption segments (<2s) this means several segments pass with no scroll at all.
3. **Bottom-edge trigger.** Scrolling only fires when the active element is already outside the visible area by 80px (lines 188–191). The line is allowed to drift to the bottom of the panel before anything moves, so even when scrolling works it feels like it's lagging the spoken word.

There is also no user-scroll detection: if a reader scrolls up to re-read something, the panel snaps back to the active line on the next tick.

## Goals / Non-Goals

**Goals:**
- The transcript visibly tracks the spoken word with low latency, across YouTube, local video, and audiobook viewers.
- A "comfortable reading offset" (active line near the top/center, not the bottom edge) so the eye leads the audio.
- Respect manual scrolling: pause follow while the user is reading elsewhere; resume when playback catches up or the user seeks.
- A persistent auto-follow toggle consistent with the audiobook panel's existing checkbox.
- Keep the change contained to the transcript scroll layer; no playback, seek, SponsorBlock, or search behavior changes.

**Non-Goals:**
- Replacing `react-youtube` or the IFrame player plumbing.
- Changing how transcripts are fetched (Rust `yt-dlp` / hosted API / Whisper STT).
- Word-level (sub-segment) karaoke highlighting. We follow segment granularity, matching the data we actually have.
- Redesigning the transcript panel layout, timestamps, or search UI.

## Decisions

### Decision 1: Centralize follow logic in `TranscriptSync`, not per viewer
All three viewers already render `TranscriptSync`. The follow math, throttle, and user-scroll detection belong in one place. `TranscriptPanel.tsx` (audiobook) keeps its own copy for now but is updated to the same algorithm; a future change can unify them.

**Alternatives considered:** Lift follow into a custom hook (`useTranscriptFollow`) shared by both. Rejected for this change — adds refactoring surface without changing behavior; revisit when unifying the two components.

### Decision 2: "Comfortable reading offset" instead of "only when out of view"
Replace the bottom-edge trigger with a target offset. When the active segment changes, scroll so its top sits at ~25–30% from the top of the visible region (configurable constant). This positions the next few upcoming lines below it, matching how a human reads ahead of audio. For the compact mobile layout, use a smaller offset so the active line is nearer the top.

- If the active segment is *already* within the comfort band, do nothing (avoids jitter).
- Behavior is identical for side and below layouts because it's container-relative (existing `getBoundingClientRect` math at `TranscriptSync.tsx:175–184`).

**Alternatives considered:** Center the active line (current jump-nav behavior at line 184). Rejected — centering wastes the lower half and forces more frequent scrolls. Pin to the very top. Rejected — feels aggressive and hides the line just spoken.

### Decision 3: Replace per-index throttle with a short time-based debounce + active-change trigger
Drop the 2-second `lastScrolledIndexRef`/`scrollThrottleRef` gate. Instead:
- Scroll is triggered by `activeIndex` *change* (the existing effect dependency), not by time alone.
- Add a small debounce (~150ms) so rapid back-to-back segment changes (fast speech) coalesce into one smooth scroll rather than a stutter.
- Keep a minimum interval (~400ms) only to prevent re-centering the *same* index if `currentTime` wobbles within one segment.

This satisfies the spec's "no per-segment throttle longer than 1 second" and the 600ms latency budget.

### Decision 4: Detect manual user scroll and pause follow
Track the last time the user touched the transcript scroll container (`scroll` event filtered to user-initiated — i.e. not immediately following our own programmatic `scrollTo`). While paused:
- Don't auto-scroll on active-segment change.
- Show a small "Auto-follow paused — click to resume" chip (consistent with the audiobook panel's pattern).
- Auto-resume when the active segment re-enters the visible region (playback catches up to where the reader scrolled), or immediately when the user seeks (clicks a segment).

Implementation: a `userScrollingRef` set on user-scroll events and cleared on programmatic scrolls (we set a brief `programmaticScrollRef` flag around our `scrollTo` calls so the listener can ignore them).

**Alternatives considered:** A separate "manual" mode toggle only. Rejected — users expect the view to "wake up" when playback reaches them, like Spotify lyrics. Never pause (old behavior). Rejected — that's the bug.

### Decision 5: Reduce YouTube active-detection latency
The 1000ms poll exists to limit cross-origin iframe calls (comment at `YouTubeViewer.tsx:760–761`). We keep the 1000ms position-save/SponsorBlock poll **as-is** (it does real work that shouldn't run more often), but add a second, lighter 250ms interval that *only* reads `getCurrentTime()` and updates `currentTime`. This gets active-segment detection under the 600ms latency budget without multiplying the expensive SponsorBlock/position-save work.

If the lighter poll proves costly on Linux WebKitGTK (the origin-mismatch-prone platform), fall back to ~500ms there via the existing `isLinuxWebKit` detection.

**Alternatives considered:** Use the IFrame API's `onTimeUpdate`-equivalent. The YT IFrame API has no high-frequency time event; polling is the documented approach. Use `requestAnimationFrame` reading `getCurrentTime`. Rejected — too many cross-origin calls.

### Decision 6: Auto-follow toggle persistence
New localStorage key `transcript-autoscroll` (default `"true"`), read on mount in `TranscriptSync`, toggled by a small button in the header next to the existing copy/export buttons. Mirrors the existing `transcript-visibility` and `transcript-panel-width` key pattern. The audiobook `TranscriptPanel` already has a checkbox; we keep it but back it with the same key.

## Risks / Trade-offs

- **[Over-scrolling on mobile compact layout]** → Use a smaller comfort offset for `compact` mode and validate on a small viewport; the per-index throttle removal is the main risk, mitigated by the 150ms debounce.
- **[User-scroll detection false negatives]** → If we fail to detect a user scroll (e.g. trackpad inertia), the panel could snap back. Mitigation: treat *any* scroll not preceded by our programmatic flag within ~80ms as user-initiated; err on the side of pausing.
- **[Extra 250ms YouTube poll increases cross-origin calls]** → The lighter poll does no SponsorBlock/position work, just one `getCurrentTime()`. On Linux WebKitGTK, gate to 500ms. Monitor; revert to single-poll if it causes origin-mismatch errors (the existing failure mode).
- **[Two scroll implementations drift]** → `TranscriptPanel.tsx` and `TranscriptSync.tsx` both change. Mitigation: keep the algorithm comments in sync; note unification as a follow-up. Low risk since both are simple.
- **[Behavior change for users who relied on the "stuck" panel]** → The new default follows playback, which is the requested behavior. Users who dislike it have a one-click toggle that persists.

## Migration Plan

No data migration. The only persisted state is the new `transcript-autoscroll` localStorage key (default on). Users with no stored value get auto-follow enabled, matching the prior default intent. Rollback is purely code-level (revert the change); no stored state needs cleaning.

## Open Questions

- Exact comfort-offset percentage (25% vs 30%) — pick in implementation by eye-testing on a real transcript; make it a named constant for easy tuning.
- Whether to surface the "follow paused" chip on mobile where space is tight, or rely on auto-resume only. Lean: rely on auto-resume on mobile, show chip on desktop.
