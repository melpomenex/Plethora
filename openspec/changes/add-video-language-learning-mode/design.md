## Context

The app has YouTube captions, local video players, transcript segment storage, word timings, `YouTubeViewer`, and mobile transcript fixes. The language mode should be a wrapper/presentation state around existing playback and transcript records, not a new video ingestion or vocabulary database.

## Dependencies

- Hard: #1–#7, #13, and existing video/transcription playback.
- Soft: #12, #15, #16, #11, plus active `youtube-transcript-playback-sync`, `update-scroll-mode-queue-youtube`, and mobile transcript fixes.
- Must coordinate all edits to `YouTubeViewer*`, transcript timing, and mobile playback files; do not parallelize those files with #13/#15.

## Goals / Non-Goals

**Goals:**

- Keep video and transcript synchronized while adding profile-aware learning actions.
- Support target subtitles, optional base translation, vocabulary highlights, sentence controls, and mining.
- Degrade to transcript learning when playback is unsupported (especially e-ink).

**Non-Goals:**

- Rebuilding YouTube playback, importing a second transcript, or removing normal playback.
- Requiring video playback on e-ink.

## Decisions

1. **Existing viewer composition.** Add a language-mode controller around the existing player/transcript, with a shared transcript sentence/token adapter and alignment resolver.
2. **Responsive layout.** Desktop/tablet may use video beside transcript; mobile stacks video and thumb-friendly transcript controls; e-ink hides/defers video but retains text, translation, state, and source timestamp.
3. **Live highlighting uses current timing.** Prefer existing word timings; if only sentence timing exists, highlight sentence only. Never show a wrong word highlight when alignment confidence is insufficient.
4. **Subtitle layers are derived.** Target subtitles use source captions/transcript; base translation is a cached translation layer; original playback remains available.
5. **Normal mode is preserved.** Language Mode is explicit/profile-associated, and its unmount leaves playback/listening position and normal transcript behavior intact.

## Risks / Trade-offs

- [YouTube caption drift] → Use existing versioned transcript/alignment and stale checks.
- [Small mobile viewport] → Collapse secondary actions and keep sentence seek/replay visible.
- [Provider/rate limits] → Do not translate or analyze the full video eagerly; cache visible/on-demand sentences.
- [Cross-feature file overlap] → Coordinate changes to shared `YouTubeViewer`/transcript components with existing sync fixes.

## Migration Plan

1. Add profile-aware transcript adapter and language-mode toggle over current viewer.
2. Add sentence/token states, translation, alignment replay, and mining hooks.
3. Add mobile/e-ink layout and performance hardening.

## Open Questions

- Whether target subtitles should use captions when transcript is auto-generated but lower quality.
- Whether video frame capture belongs here or the mining proposal.
- How to handle multiple caption languages in one video/profile.
