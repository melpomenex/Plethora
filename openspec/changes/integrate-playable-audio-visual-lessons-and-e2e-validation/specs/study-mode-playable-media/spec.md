# Study Mode Playable Media Specification

## ADDED Requirements

### Requirement: Playable Audio Lessons with Synchronized Transcript and Active Recall Pauses
Study Mode SHALL render generated audio lesson scripts as playable audio experiences integrated with Plethora's TTS infrastructure, providing play/pause, seek across turns, speed controls (`0.75x`, `1x`, `1.25x`, `1.5x`, `2x`), synchronized active-turn highlighting, and an optional Active Recall Pause toggle, without granting concept mastery merely for listening.

#### Scenario: Learner plays, seeks, adjusts speed, and hits an active recall pause
- **GIVEN** a teacher–student audio lesson artifact is loaded with Active Recall Pauses enabled
- **WHEN** the learner starts playback and reaches a student misconception turn
- **THEN** the active transcript turn is highlighted, playback pauses at the recall checkpoint prompting the learner to formulate an answer, and clicking Resume continues to the teacher's explanation.

### Requirement: Interactive Narrated Slides with Citations and Embedded Knowledge Checks
Study Mode SHALL render generated slide decks as an interactive step-by-step presentation with synchronized TTS narration, deterministic visual/key-point layouts, clickable source-anchor citations, and embedded per-slide knowledge checks.

#### Scenario: Learner navigates slides, plays narration, and clicks a source citation
- **GIVEN** a generated slide deck artifact with citations and narration
- **WHEN** the learner steps to slide 2, starts narration, and clicks a citation chip
- **THEN** slide 2 narration plays via Plethora's TTS bridge and the citation highlights the supporting quote in the Original Source pane.

### Requirement: Local Offline Caching of Audio and Slide Lessons
Generated audio lesson narration metadata/assets and slide deck metadata SHALL be cached locally by scope and artifact revision so reopening a lesson offline reuses cached media without regenerating via AI or TTS.

#### Scenario: Offline reopening reuses cached audio and slide assets
- **GIVEN** an audio lesson or narrated slide deck was previously synthesized and cached locally
- **WHEN** the learner reopens the lesson while offline
- **THEN** the cached entry is resolved from local cache with a "Cached for offline" indicator and plays without issuing network regeneration requests.
