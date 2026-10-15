## ADDED Requirements

### Requirement: TOC navigation updates the next TTS start while stopped
When the user navigates via a document's Table of Contents while TTS is stopped, the system SHALL resolve the new visible reading anchor (after the rendition/scroll has actually settled at the target) and publish it as the authoritative next TTS start point, invalidating stale TTS start state from the previous location. The system MUST NOT automatically start speaking merely because a chapter entry was clicked. The system MUST NOT trust a stale scroll percentage immediately after navigation.

#### Scenario: Chapter jump while stopped
- **WHEN** the user navigates from Chapter 1 to Chapter 8 via the EPUB TOC while stopped and then presses Play
- **THEN** playback begins at the first visible readable word of Chapter 8's current viewport, not at the previous location, the book start, or a chapter-start chunk when the viewport shows a mid-chapter position

#### Scenario: EPUB TOC entry with fragment anchor
- **WHEN** an EPUB TOC href contains an `#anchor` fragment pointing to a heading in the middle of a spine item and the user navigates to it
- **THEN** the next Play starts at the resulting visible target, not at the beginning of the spine item

#### Scenario: Anchor resolved only after the target settles
- **WHEN** a TOC navigation triggers a rendition relocation that has not finished rendering
- **THEN** the system waits for the relocation/render to settle before resolving the anchor, and the resolved anchor reflects the new location

### Requirement: TOC navigation during active playback retargets playback
When the user navigates via the TOC while TTS is actively playing, the system SHALL interpret it as an intentional listening retarget: cancel the old utterance/audio and stale generation, navigate, resolve the new visible anchor after it settles, and automatically resume playback at the new location. When TTS is paused, the system SHALL preserve the paused state while rebasing the resume position to the new location without unexpected playback.

#### Scenario: TOC jump while playing
- **WHEN** TTS is playing Chapter 3 and the user jumps to Chapter 12 via the TOC
- **THEN** playback of Chapter 3 is cancelled (no stale audio becomes audible) and playback automatically resumes at the first visible readable word of Chapter 12

#### Scenario: TOC jump while paused
- **WHEN** TTS is paused and the user jumps to another chapter via the TOC
- **THEN** TTS remains paused, and pressing resume/play continues from the new location rather than the old one

#### Scenario: No autoplay from stopped state
- **WHEN** TTS is stopped and the user clicks TOC entries repeatedly
- **THEN** no playback starts and only the next-play anchor is updated

### Requirement: Stale work is invalidated on TOC retarget
TOC-driven retargeting SHALL use the session/race invalidation semantics: old generation results MUST NOT play, prefetch buffers SHALL be rebased to the new location, cached audio MAY remain cached, and native events belonging to the previous location MUST be ignored.

#### Scenario: Old chapter's events after navigation
- **WHEN** a native or audio event from the previous chapter arrives after a TOC retarget
- **THEN** it is ignored and does not move playback or the highlight

#### Scenario: Prefetch rebases
- **WHEN** playback resumes at the new TOC location
- **THEN** buffering proceeds forward from the new anchor and previously buffered ahead-chunks from the old location are not played
