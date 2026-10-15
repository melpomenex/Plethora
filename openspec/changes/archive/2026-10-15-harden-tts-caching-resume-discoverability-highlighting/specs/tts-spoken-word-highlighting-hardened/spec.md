## MODIFIED Requirements

### Requirement: Spoken-word highlighting is ON by default for all users

The system SHALL persist a user preference `tts.highlightSpokenWord` whose default is **ON** for both new installs and existing installs whose persisted settings predate the `highlightSpokenWord` field (previously defined in schema v4). The user's choice (ON/OFF) SHALL survive reopening the document and restarting the app. The preference MUST be a normal persisted Plethora setting (`settingsStore` → `ttsSettings.ts`), not transient component state that resets on every mount. The previous requirement that highlighting defaults to OFF is explicitly superseded by this change (archived `improve-pocket-tts` behavior).

#### Scenario: New install highlighted without toggling

- **WHEN** a fresh user with no prior `tts.highlightSpokenWord` opens a supported document and starts TTS
- **THEN** the spoken word is highlighted from the first audible word without requiring the user to enable a toggle

#### Scenario: Existing pre-v4 user migrated to default ON

- **WHEN** a user whose persisted `tts` has `schemaVersion<4` and no `highlightSpokenWord` field upgrades to this build and starts TTS
- **THEN** highlighting is ON by default (not OFF) and the store is migrated, preserving the new value on subsequent reads of `sanitizeTTSSettings`

#### Scenario: Toggle OFF persists after reopen

- **WHEN** a user disables "Highlight words while reading aloud" and later reopens the document or restarts the app and starts TTS again
- **THEN** highlighting remains OFF until re-enabled via the same toggle; the preference is not reset to ON on remount

#### Scenario: Preference lives in Settings → Text to Speech

- **WHEN** the user opens **Settings → Text to Speech**
- **THEN** a row **Highlight words while reading aloud** (default ON, copy "Highlights the current word as Plethora reads the document aloud.") reflects and mutates `tts.highlightSpokenWord` with keyboard and screen-reader accessibility

### Requirement: Highlight follows the spoken word and clears correctly

While TTS is actively speaking, the system SHALL highlight the currently spoken word and remove the highlight from the previous word on sentence and on chunk boundaries. Pausing freezes the current highlight; resuming continues from the correct word. Seeking, skipping, retargeting, or resuming from a stored checkpoint moves the highlight to the new start word. When playback stops, or when the user changes chapter/section/document, the transient TTS highlight SHALL be cleared. This transient highlight MUST remain visually distinct from permanent user highlights, extracts, search result marks, active selections, and flashcard/learning annotations.

#### Scenario: Stop clears the transient mark

- **WHEN** playback stops (stop control or reaching document end)
- **THEN** no word remains highlighted by TTS and the document shows no residual transient marks

#### Scenario: Pause keeps the correct word, resume continues

- **WHEN** playback pauses mid-sentence, then resumes after a short delay without a scroll
- **THEN** the highlight freezes on the paused word and resumes advancing from that same word

#### Scenario: Next/Prev chunk resets mapping

- **WHEN** the user skips to the next or previous segment
- **THEN** the highlight immediately addresses the first word of the target segment's correct occurrence, not the tail of the previous segment

#### Scenario: Visible follow when auto-follow enabled

- **WHEN** auto-follow (`followSpokenWord`) is enabled and the spoken word moves outside the comfortable viewport band
- **THEN** the reader viewport follows the highlighted word per `useSpokenWordFollow` semantics (comfort offset, debounced/coalesced, arrival-based user-scroll detection, Re-center to resume), and the highlighted text remains readable in light, dark, custom, and e-ink themes

### Requirement: Timing is capability-driven, with exact data preferred and approximate as fallback only

The highlighting system SHALL prefer real timing sources when available and treat approximate interpolation strictly as a fallback, marked visually as approximate. Priority: (1) provider-supplied word/sentence timestamps or speech marks (`supportsWordTimings:true` adapters: `elevenlabs`/`fal`/`openai`/`openai-compatible`/`plethora`) normalized via `src/api/tts/timing.ts` into `WordTiming[] source:"measured"`; (2) System Web Speech `SpeechSynthesisUtterance.onboundary charIndex→word` exact mapping; (3) native Android `tts://word-position` (`onRangeStart`) where the fallback engine supports it; (4) approximate `synthesizeWordTimings(text,0,durationSec)` (weighted `charLength+1`, 60 ms floor, `source:"synthesized"`). Approximate timings MUST be rendered softer (e.g., `tts-word-highlight--approx`) but remain distinctly readable, never persisted or reported as measured, and never used to seek into a cached full-chunk clip without alignment.

#### Scenario: Provider word timestamps drive measured highlighting

- **WHEN** a cloud adapter returns measured `wordTimings` that align with the chunk text (`wordTimingsAlignWith`)
- **THEN** the highlight advances according to those timestamps (`resolveChunkTimings` prefers measured), not according to linear `currentTime/duration` approximation, and the highlight style is the stronger measured variant that persists correctly when replaying from the persistent cache

#### Scenario: System TTS exact boundary used when present

- **WHEN** System (`speechSynthesis`) TTS is used
- **THEN** `onboundary charIndex` maps to the exact chunk word via `normStart/normEnd` binary search (not character-fraction estimation) and drives the highlight

#### Scenario: Approximate interpolation is fallback only and visibly softer

- **WHEN** no measured word timestamps or boundary events are available for a chunk (e.g., `groq`/`pocket` or cached clip missing `wordTimings`)
- **THEN** `synthesizeWordTimings(text,0,durationSec)` is used as fallback, the highlight is the softer `approximate` variant, and playback caching does not mark approximate timings as measured

### Requirement: Highlight resolves against the chunk's exact document occurrence and is distinct from other marks

For documents with proper structure (PDF with pdf.js text layers or reflow `[data-w]` spans, EPUB via `sectionContainers`/`sectionKey` routing, Markdown/HTML/article via rendered DOM offsets), the highlight SHALL map the TTS chunk's source anchor to its rendered occurrence and highlight that occurrence only (duplicate text elsewhere MUST NOT receive the highlight). Comparison for the fallback constrained-text match MUST use `foldForMatch` (NFC, curly quotes/apostrophes, en/em dashes, ligatures) so smart-quote/dash differences do not mis-anchor. Highlight styling MUST remain visually distinct from user highlights, extracts, search marks, selection highlights, and annotations; color MUST NOT be the only indicator of selection; e-ink mode receives a flat high-contrast variant; animation is not used per-word; `prefers-reduced-motion` is respected and high-frequency pulsing is prohibited.

#### Scenario: PDF fixed-layout highlights in the correct text layer

- **WHEN** a PDF page's TTS segment corresponds to the second paragraph of that page
- **THEN** the highlight applies inside that page's rendered text layer at the second paragraph occurrence, not as a whole-page mark

#### Scenario: EPUB highlights the correct iframe section

- **WHEN** an EPUB document has two mounted spine iframes containing identical quotations and TTS is reading the occurrence in the second section
- **THEN** the highlight appears inside the second section's iframe body and not in the first section's duplicate occurrence

#### Scenario: Markdown/HTML normalized matching fixes smart quotes

- **WHEN** the document text contains curly quotes/dashes/ligatures that the TTS chunk text normalized to ASCII punctuation
- **THEN** the highlight still resolves to the correct DOM range via `foldForMatch` before word indexing and does not mis-highlight a nearby identical word in another paragraph

#### Scenario: Scan/reflow PDFs fall back gracefully

- **WHEN** TTS reads reflowed/OCR'd PDF content (no usable text-layer span or `[data-w]` mapping)
- **THEN** the highlight correctly addresses the reflowed HTML's word/section occurrence, or, when no trustworthy mapping exists, falls back to chunk-level highlight or no highlight rather than highlighting an unrelated occurrence

#### Scenario: Fallback hierarchy is graceful

- **WHEN** exact word-range resolution fails for a chunk
- **THEN** the system falls back per: exact word timing + exact text anchor → exact timing + best document range → estimated word timing → chunk-level highlight → no highlight, and never highlights an unrelated occurrence merely because the same word exists elsewhere
