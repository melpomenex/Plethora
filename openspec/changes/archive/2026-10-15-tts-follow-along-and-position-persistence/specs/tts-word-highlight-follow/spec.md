## MODIFIED Requirements

### Requirement: Currently spoken word is highlighted and advances with narration (mobile + desktop)
The system SHALL highlight the currently spoken word while TTS is actively reading a document, on both mobile and desktop, across supported rendering modes (EPUB continuous/paginated, reflowed documents, PDF/text layers where supported). The highlight SHALL advance with the spoken word. The existing `WordHighlighter`/`WordHighlightLayer` pipeline SHALL be retained and driven by the canonical playback position; it SHALL NOT be re-implemented as a separate mechanism.

#### Scenario: Playback progresses through words within a chunk
- **WHEN** playback is active and the canonical word index advances from 0 to N within a chunk
- **THEN** the highlighted word SHALL track the canonical word index and SHALL be visibly different from non-active words (distinct background/color), on both desktop and mobile, for EPUB, PDF, and reflowed text

#### Scenario: Highlight does not race ahead of or trail the audio
- **WHEN** audio is playing with measured provider word timings
- **THEN** the highlighted word SHALL be the word whose measured `[start_ms, end_ms]` interval contains the audio clock, with a sticky tolerance of at most 200 ms, and SHALL NOT jump more than one word ahead of or behind the audio clock position

#### Scenario: Highlight uses a deterministic fallback when timings are unavailable
- **WHEN** the active provider does not expose measured word timings (adapter flagged `supportsWordTimings: false`)
- **THEN** the system SHALL use the deterministic synthesized timing fallback (`synthesizeWordTimings`, char-length-weighted over `[startSec, endSec]` with a 60 ms floor), the highlight SHALL still advance with the audio clock, and the highlight SHALL be rendered with the "approximate" visual variant

#### Scenario: Highlight resumes at the paused word
- **WHEN** playback is paused at word index 3 of chunk 51 and then resumed
- **THEN** the highlight SHALL reappear at word index 3 (or the small look-behind position defined by pause/resume correctness) and SHALL NOT reset to chunk 37 where the session started

### Requirement: Document auto-scrolls to keep the spoken content visible
The system SHALL automatically scroll the document so the currently spoken content remains visible while TTS is actively reading, on both desktop and mobile. Scrolling SHALL be smooth (comfort-band pinning, not large segment jumps), SHALL not reposition the viewport while the spoken word remains comfortably visible, and SHALL advance the viewport only as the spoken word approaches/leaves the visible area. The existing `useSpokenWordFollow` behavior SHALL be retained and treated as the implementation.

#### Scenario: Narration moves below the visible area and the viewport follows
- **WHEN** the spoken word advances past the comfort band of the visible reading area during playback
- **THEN** the document viewport SHALL scroll so the spoken word is brought back within the comfort band (≈28% from the top on desktop, ≈18% in compact/mobile mode), and no viewport movement SHALL occur while the spoken word remains within the band

#### Scenario: Follow-along works in EPUB continuous and PDF
- **WHEN** playback is active in an EPUB continuous-scroll document or a PDF document
- **THEN** the reader SHALL auto-scroll to keep the spoken word visible in the same manner as reflowed text

### Requirement: Manual scrolling temporarily suspends narration-follow
When the user manually scrolls while TTS is playing, the system SHALL NOT immediately fight the user's scroll gesture. It SHALL suspend follow-mode and return to narration-follow only when the narration advances (arrival-based detection) or via the explicit "Re-center" action, consistent with the existing `useSpokenWordFollow` design.

#### Scenario: User scrolls away while TTS continues
- **WHEN** the user manually scrolls the document while TTS is playing, moving the spoken word out of view
- **THEN** the system SHALL NOT scroll the document again while the user is actively scrolling, and SHALL either resume following when the next word advance requires it or leave a visible "Re-center" affordance

#### Scenario: Re-center returns to narration
- **WHEN** the user activates the Re-center action while follow-mode is suspended
- **THEN** the viewport SHALL scroll to bring the currently spoken word back within the comfort band and follow-mode SHALL resume

### Requirement: Word-highlight and follow performance
Updating the active word SHALL NOT trigger a full document/reader re-render. The highlighter SHALL apply targeted DOM/CSS updates for the active word only (existing `WordHighlighter.applyHighlights` design), and the follow scroll SHALL use the existing rAF-driven, debounced scroll path.

#### Scenario: Word advance does not rerender the reader
- **WHEN** the canonical word index changes during playback in a large EPUB
- **THEN** the reader content DOM SHALL NOT be re-rendered; only the highlight layer SHALL update (targeted node updates), and frame work SHALL be bounded to animation frames during playback