## Purpose

Provides one accessible workspace for capture, processing, transcript reading and explicit learning-material review across desktop and mobile layouts.

## ADDED Requirements

### Requirement: Coherent session workspace
The workspace SHALL expose Overview, Transcript, Extracts, Flashcards and Ask Plethora using shared session data. Capture and processing SHALL remain reachable in the same session, and navigation away/return SHALL preserve progress. Completed background processing SHALL NOT steal focus.

#### Scenario: Return after processing
- **WHEN** the user returns from another document to an imported recording
- **THEN** the same session shows current media/transcript/draft states without restarting work

### Requirement: Recording controls and marker feedback
Active recording SHALL show status, elapsed recorded time, audio activity, truthful save health, optional temporary captions, supported pause/resume and explicit Finish. Important, Confusing, Save Recent Extract and Card Candidate actions SHALL persist one-interaction markers linked to actual audio time without requiring continuous user interaction.

#### Scenario: Confusing moment
- **WHEN** a user taps Confusing during recording
- **THEN** a committed marker appears at the measured position and later opens that moment in Learning Studio, including when AI is unavailable

### Requirement: Accessible adaptive interaction
Desktop and mobile SHALL share functional data/actions while adapting layout through existing design and accessibility conventions. Controls SHALL have accessible names/focus behavior, usable coarse-pointer targets, reduced-motion support and status signals beyond color. Haptics SHALL be optional supported feedback, never the sole confirmation.

#### Scenario: Mobile draft approval
- **WHEN** a screen-reader user edits and accepts a card on mobile
- **THEN** the source, validation outcome and save result are announced, focus remains usable and the accepted item matches desktop semantics

### Requirement: Truthful operational and empty states
Every stage SHALL distinguish loading, empty, permission denied, offline, partial success, failed and recovered states with retained work and actionable remedies. Progress percentages SHALL use actual measurable denominators; lack of an AI provider SHALL NOT block saved audio or manual learning.

#### Scenario: No AI configured
- **WHEN** a recording is saved with no configured AI provider
- **THEN** it remains playable with markers/export, and transcript/manual actions remain available to the extent actual text exists

#### Scenario: Partial transcript ready
- **WHEN** transcription completes only part of the source
- **THEN** completed segments are readable and clearly partial while failed work has a retry action

### Requirement: Source-preserving transcript and review interactions
Transcript reading SHALL support search, section navigation, supported playback synchronization, exact text selection, extraction, card authoring, Ask and corrections. Proposed extracts and cards SHALL visibly show evidence, approval state, stale/duplicate reasons and per-item acceptance errors.

#### Scenario: Transcript correction
- **WHEN** a user corrects a source term after accepting an extract/card
- **THEN** canonical transcript/search update, affected suggestions are marked stale and accepted wording/history remain unchanged
