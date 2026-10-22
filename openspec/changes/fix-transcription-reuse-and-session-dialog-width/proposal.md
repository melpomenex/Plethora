## Why

Items marked Completed in the Transcription Queue can start transcription again when opened because the queue and podcast viewer read different transcript stores. Customize Session also regressed from a bounded, centered desktop dialog to a nearly window-wide form; both failures interrupt existing workflows.

## What Changes

- Resolve saved transcripts across the document and linked podcast episode identities before deciding that transcription is missing, preserving saved text, segment timing, and word timing.
- Reuse results produced before this fix, including after restart or removal of finished queue rows, without requiring another transcription run.
- Make queue completion, active-job visibility, and viewer loading agree; opening a transcript must not launch duplicate work while saved data or an existing job is being resolved.
- Restore Customize Session's previous 42rem desktop width limit and centered placement, while retaining compact sheets, scrolling, accessible dialog behavior, and reachable footer actions.
- Add behavioral and rendered-geometry regression coverage for the two reported failures.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `auto-transcription-pipeline`: Require saved queue transcripts to be reusable from linked podcast and document views, with durable lookup and duplicate-start protection.
- `material-adaptive-shell`: Require Customize Session to retain its bounded desktop dialog geometry through adaptive-surface changes.

## Impact

- Transcript persistence and resolution: `src-tauri/src/transcription/auto_queue.rs`, `src-tauri/src/commands/podcast.rs`, and associated repository queries/tests.
- Viewer identity, loading, and job state: `src/components/viewer/AudiobookViewer.tsx`, `src/api/podcast.ts`, and the existing transcription store/API boundaries as needed.
- Dialog sizing: `src/components/review/SessionCustomizeModal.tsx`, `src/components/adaptive/ResponsiveDialogSheet.tsx`, shared dialog sizing styles, and existing session-customize browser fixtures.
- Coordinate with `fix-session-customize-mobile-layering` so desktop sizing repairs preserve its portal, layer, safe-area, and keyboard behavior.
- No new provider, model, dependency, Settings control, or intentional performance change is planned. This proposal does not include unrelated cover-art or theme changes visible in the screenshots.
