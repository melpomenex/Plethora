## Implementation evidence

- Episode transcript lookup now resolves completed document transcripts through the persisted `podcast:<episode-id>` link. It retains segment/word timings and does not depend on finished queue rows. The regression fixture explicitly demonstrates that the former episode-only text lookup returns no text despite the saved document result.
- Document-level transcript lookup also recovers completed legacy chapter identities after finished queue cleanup. Explicit unrelated chapter requests remain isolated.
- The viewer distinguishes loading, saved results, active work, absence, and errors. Queue updates refresh unfinished items; completed viewers do not reload their entire transcript on unrelated queue progress. Automatic starts share one request per episode, recheck saved state, and ignore abandoned identities.
- Segment database failures propagate out of the queue consumer. Document text and transcript completion are committed together before a job can be reported completed.
- Adaptive dialog sizing owns an explicit width while preserving caller max-width constraints. Customize Session requests its historical 42rem desktop width; its compact sheet and existing modal behavior remain intact.

## Verification

- Focused frontend suites: 80 tests passed across eight files, covering viewer regressions, actual API timing normalization, concurrent/remounted starts, adaptive sizing, session goals, and queue modal behavior.
- Command entry points: 40 tests passed across registry acceptance and destination routing, including the New Queue action.
- Transcription store integration: seven tests passed across the transcript and queue stores, bringing frontend verification to 127 tests.
- Browser checks: all seven session-customize checks passed with real app CSS at phone, tablet, 1440px desktop, and 2466px desktop widths, including long tag lists, Save-as entry, keyboard-reduced height, resizing, and effective zoomed viewport bounds.
- Desktop and phone screenshots were inspected at `.playwright/results/session-customize-crowded-2466.png` and `.playwright/results/session-customize-phone-390.png`.
- TypeScript checks passed. The production frontend build and bundle budget passed. Changed-file ESLint completed with no errors; its warnings concern existing unused declarations/directives.
- Backend transcript fixtures: eight tests passed with `cargo test --lib --no-default-features podcast_transcript`, including active episode precedence over stale failed queue history. Queue persistence: four tests passed with `cargo test --lib --no-default-features transcription::auto_queue::tests`. Both final runs use the current native sources.
- Strict OpenSpec validation and `git diff --check` passed.

## Performance gate limitation

`npm run bench:check` completed measurement but failed eight existing benchmark budgets. An isolated snapshot of unchanged HEAD (`40f871248`) also failed its benchmark budget comparison, with nine failures; five names overlap. The changing failures include unrelated scheduler, import, speech-index, ambient-rendering, and haptic benchmarks. No benchmarked implementation or baseline was changed by this fix. Bundle budgets passed independently in `npm run build:check`.

Detailed local logs: `/tmp/plethora-reuse-bench.log` and `/tmp/plethora-reuse-head-bench.log`. The unchanged snapshot location is recorded in `/tmp/plethora-reuse-head-path`. These results are recorded as a failing pre-existing/noisy local gate, not a clean performance pass.

## Scope and limits

Verification uses deterministic saved-data/provider fixtures and the real session dialog browser harness. No production transcript database was modified and no real transcription provider was invoked. The native application was not rebuilt or installed as a release artifact. The previous mobile-layering behavior is retained; this change is not archived or committed automatically.

The design detector flagged existing type-ramp and transcript-selection styling. Ripwire reported normalized SQL-binding/test-fixture similarity; those are distinct queries/fixtures, and the transcript API's callers retain compatible signatures. These observations do not replace the behavioral and rendered-geometry checks.
