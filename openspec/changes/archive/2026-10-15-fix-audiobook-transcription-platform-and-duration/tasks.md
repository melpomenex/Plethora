## 1. Platform routing

- [x] 1.1 Make the Tauri native OS value authoritative in `isNativeMobile`, with no mobile user-agent override
- [x] 1.2 Add a regression test for a desktop Tauri app with a mobile-looking user agent
- [x] 1.3 Verify desktop transcription resolution no longer selects mobile-only guidance for that runtime

## 2. Audiobook playback timeline

- [x] 2.1 Remove the paired EPUB view's duplicate local audio-source resolution and let `AudiobookViewer` own playback source preparation
- [x] 2.2 Ensure desktop `.m4b` preparation and range-capable serving are used before the paired viewer reports progress
- [x] 2.3 Publish a finite parsed-metadata duration when the media element reports an unusable M4B duration, while preferring a later finite media duration
- [x] 2.4 Add viewer regression coverage for M4B preparation, source selection, duration, and current-time callbacks

## 3. Groq audiobook chunking

- [x] 3.1 Audit and consolidate local audiobook Groq routing so every Tauri path uses safe chunking rather than a single over-limit upload
- [x] 3.2 Produce independently decodable chunks for containerized audiobook formats and keep every upload below the provider limit
- [x] 3.3 Preserve absolute segment timestamps, progress, checkpoint/resume behavior, and cleanup on success and failure
- [x] 3.4 Add regression coverage for long audiobook chunk sizing, M4B handling, timestamp offsets, and actionable chunking errors

## 4. EPUB follow-along verification

- [x] 4.1 Add DOM-level coverage that wraps the active EPUB word and clears the prior sync highlight
- [x] 4.2 Verify alignment activation, chapter transitions, audio-to-word updates, click-to-seek, and low-confidence segment fallback against existing contracts
- [x] 4.3 Run focused frontend/Rust tests and type/lint checks; resolve regressions caused by the changes
