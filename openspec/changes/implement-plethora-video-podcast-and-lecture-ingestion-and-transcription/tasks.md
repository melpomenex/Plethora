# Implementation Tasks

## 1. Engine routing & cloud tier
- [ ] 1.1 Engine router (local/cloud/BYO rules + settings); pre-flight estimate + disclosure dialog
- [ ] 1.2 `transcribe` job kind: audio upload (local extraction first), chunking, checkpoints, diarization option, provider abstraction
- [ ] 1.3 Additive `speaker` column on `transcript_segments` (+ index); segment-merge safety with existing 084 unique constraint

## 2. Transcript → document pipeline
- [ ] 2.1 Document builder: speaker turns → sections/paragraphs, timestamp locators, auto-title/summary/tags
- [ ] 2.2 Optional cleanup pass (filler/punctuation/paragraphing) as per-import toggle
- [ ] 2.3 Import dialog: source picker (file/folder/podcast/YouTube/URL), engine choice, diarization/cleanup toggles
- [ ] 2.4 Timestamp locators flow into citations (7 contract) and jump-to-media playback

## 3. UX & corrections
- [ ] 3.1 Unified transcription queue UI evolution (progress/retry/cancel/priority across engines)
- [ ] 3.2 Segment editor: text edits, speaker rename/merge propagation
- [ ] 3.3 YouTube cloud-boundary enforcement (client + server)

## 4. Validation
- [ ] 4.1 Fixture pipelines (multi-speaker, long-file resume, cleanup toggles); correction propagation tests
- [ ] 4.2 Privacy tests (no audio retention, TTL, log scans, exclusion); local-engine regression suite
- [ ] 4.3 i18n 6 locales; full gates (vitest/cargo/bench:check/build:check)
