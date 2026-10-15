## Why

Audiobook transcription currently misclassifies the desktop `.app` as mobile when its embedded user agent contains mobile markers, so desktop users receive mobile-only on-device STT guidance. Separately, `.m4b` playback can advance audibly while its displayed position remains at `0:00`, and the EPUB pairing flow needs verification and hardening so a paired audiobook can reliably highlight the spoken words. Long or containerized audiobook files can also reach Groq through a path that sends an over-limit or non-independent chunk, producing a “request too large” failure instead of a transcript.

## What Changes

- Make the native Tauri OS platform authoritative for desktop/mobile transcription routing; never infer native mobile from a user-agent string when the app is running as a desktop `.app`.
- Fix `.m4b` duration/current-time handling so playback controls, persistence, seeking, and sync receive a valid timeline.
- Make Groq audiobook transcription split every upload below a conservative byte limit into independently decodable chunks, preserve absolute timestamps across chunks, clean up temporary files on every exit path, and report progress across the complete book.
- Complete and verify the paired EPUB/audiobook follow-along path: transcript/alignment availability, chapter matching, word lookup, highlight updates, seek navigation, and degraded-confidence behavior.
- Add regression coverage for desktop platform detection, `.m4b` media metadata/progress, and the paired playback/highlight lifecycle.

## Capabilities

### New Capabilities

- `audiobook-epub-follow-along`: Reliable end-to-end pairing, alignment, word highlighting, and navigation between an EPUB and its audiobook.
- `audiobook-media-progress`: Correct duration and current-time reporting for audiobook containers including `.m4b`.

### Modified Capabilities

- `audiobook-podcast-stt-routing`: Native platform detection must route a desktop Tauri app as desktop even when its user agent contains mobile tokens, and long audiobook Groq requests must use the chunked route rather than a single over-limit upload.

## Impact

Affected areas include Tauri platform detection and transcription resolution, audiobook media playback and metadata handling, EPUB/audiobook pairing and alignment services, reader/player synchronization UI, and their unit/integration tests. No public API or persisted-data migration is intended.
