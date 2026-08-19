# listen-later-queue Specification

## Purpose
Specifies the lightweight audio queue for web articles, RSS items, and document chapters, supporting immediate vs. lazy audio synthesis and continuous playlist playback.

## ADDED Requirements

### Requirement: Listen Later Queue Management
The system SHALL provide a dedicated "Listen Later" audio queue allowing users to enqueue web articles, RSS posts, book chapters, and document selections for sequential audio playback.

#### Scenario: Article enqueued for Listen Later
- **WHEN** user selects "Listen Later" on an imported web article
- **THEN** the system SHALL extract the article content, create an Audio Edition entry, and append it to the active Listen Later queue with estimated listening time

### Requirement: Continuous Auto-Advancing Playback
The system SHALL seamlessly advance to the next item in the Listen Later queue when the current audio item finishes playing without requiring manual interaction.

#### Scenario: Queue auto-advances between items
- **WHEN** the 12-minute audio of item 1 finishes playing
- **THEN** the player SHALL automatically transition to item 2 in the queue and begin playback

### Requirement: Lazy vs. Immediate Generation Strategy
The system SHALL support both immediate audio pre-generation and lazy just-in-time generation for queued items according to user network preferences (e.g. pre-generate on Wi-Fi or generate on-demand).

#### Scenario: Lazy generation kicks off ahead of playback
- **WHEN** item 1 is playing and has 2 minutes remaining
- **THEN** the system SHALL start generating audio for item 2 in the background so it is ready for gapless playback when item 1 completes

### Requirement: Queue Reordering and Playlist Display
The system SHALL expose a visual queue drawer allowing users to reorder items, remove items, see total queue duration, and jump directly to any queued item.

#### Scenario: User reorders queue items
- **WHEN** user drags item 3 to the top of the queue
- **THEN** the system SHALL update the queue playback order and reflect the change across all connected player views
