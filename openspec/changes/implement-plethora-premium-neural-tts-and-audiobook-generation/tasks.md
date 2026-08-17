# Implementation Tasks

## 1. Provider & jobs
- [ ] 1.1 `plethora` TTS adapter (registry-conformant) + catalog endpoint client (versioned, cached)
- [ ] 1.2 `tts_generate` job kind: chapter segmentation, chunk checkpoints, resume, cancel-keeps-completed, fallback-voice config, artifact TTL
- [ ] 1.3 Segmented synthesis client: gapless AudioContext assembly, word timestamps ingestion

## 2. Playback & queue UX
- [ ] 2.1 Word/sentence synchronized highlighting across doc types (canonical reflow, EPUB, transcripts) via existing karaoke/alignment paths
- [ ] 2.2 `tts_position` persistence + continue-listening; chapter/paragraph navigation
- [ ] 2.3 Listening queue store + UI (derivation filters, manual reorder, dashboard surface)
- [ ] 2.4 Voice picker with cached previews; per-document overrides; pronunciation dictionary (local transform + settings UI)

## 3. Caching, quotas, privacy
- [ ] 3.1 Local audio cache manager (eviction, storage accounting surface, export)
- [ ] 3.2 Pre-flight estimate dialog + disclosure; exclusion enforcement; quota integration
- [ ] 3.3 Privacy tests: TTL deletion, log scans, local-provider regression suite

## 4. Validation
- [ ] 4.1 Gapless-boundary audio fixtures; position round-trips; highlighting alignment tests
- [ ] 4.2 i18n 6 locales; full gates (vitest/cargo/bench:check/build:check)
