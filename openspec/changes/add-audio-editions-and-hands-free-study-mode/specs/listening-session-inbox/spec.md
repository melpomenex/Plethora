# listening-session-inbox Specification

## Purpose

Specifies the deferred review workflow for hands-free listening sessions ("Remember now, organize later"): real session lifecycle management wired into playback, session aggregation, batch triage UI with working persistence on all platforms, duplicate protection, and daily listening analytics aggregation.

## ADDED Requirements

### Requirement: Listening Session Lifecycle Wired into Playback

The audio player SHALL create or resume a `ListeningSession` for the active edition/audiobook when playback begins (resuming an existing active session whose last activity is within 15 minutes; otherwise creating a new one), SHALL append every capture to it, and SHALL close it (with final duration and counts) when playback stops beyond the inactivity horizon (2 minutes), the player closes, the content changes, or the user ends it explicitly. Brief pauses SHALL NOT produce micro-sessions. Session state SHALL persist robustly across app restarts.

#### Scenario: Session resumed after a short break

- **WHEN** the user pauses for 5 minutes and resumes the same edition
- **THEN** captures SHALL continue to accumulate in a single resumed session rather than a new session per pause

#### Scenario: Session items collected while listening

- **WHEN** user listens for 40 minutes and saves 3 extracts and 1 confusing marker
- **THEN** one `ListeningSession` SHALL contain all 4 items with timestamps, source text, and marker types

### Requirement: Listening Session Inbox Review Interface

The system SHALL surface a "Review Listening Session" entry when the user returns to the app after a session with unreviewed items, and the Inbox component SHALL be mounted and reachable in the actual app UI (player surface and/or library shelf), displaying captures chronologically with source context, capture-window provenance, status badges (resolved / needs confirmation / pending bookmark / persistence error), and one-click triage.

#### Scenario: User opens app after commute

- **WHEN** user opens Plethora after concluding a listening session with captures
- **THEN** the Listening Session Inbox SHALL be discoverable and display every captured passage with context and triage controls

### Requirement: Rapid Inbox Item Triage with Working Persistence

The Inbox SHALL provide: Keep Extract, Edit / Add Note, Make Flashcard, Ask Plethora (opens Document Q&A scoped to the passage), Mark Interesting, Mark Confusing, and Discard. All triage mutations SHALL persist on every supported platform (Tauri and browser fallback) — including item updates. Already-created permanent extracts SHALL NOT be duplicated during triage, and Discard SHALL NOT delete extracts the user has already kept.

#### Scenario: Confusing passage explained from inbox

- **WHEN** the user taps "Ask Plethora" on a confusing marker
- **THEN** Document Q&A SHALL open scoped to the passage, and any resulting insight SHALL be savable as a note or flashcard

#### Scenario: Triage note survives restart

- **WHEN** the user edits an item's note in the Inbox and restarts the app
- **THEN** the note SHALL persist (no silent no-op writes on Tauri)

### Requirement: Daily Listening Analytics Aggregation

The system SHALL record cumulative listening time, chapters finished, and captures into daily study statistics, integrating with Plethora's existing reading stats and workload calendar.

#### Scenario: Listening time counted in daily stats

- **WHEN** a 35-minute listening session concludes
- **THEN** 35 minutes SHALL be added to the user's daily audio study stats in `DailyReadingStats`
