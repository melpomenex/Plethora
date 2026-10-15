## Purpose

Enables Audio Editions to be enqueued into the user's study Queue and consumed directly within Queue list and Scroll Mode interfaces.

## ADDED Requirements

### Requirement: Audio Editions can be added to Queue

The system SHALL allow users to add Audio Editions into their study Queue upon edition creation or from library interfaces. When an Audio Edition is added to the Queue, its underlying document is scheduled for review with audio-first listening metadata.

#### Scenario: Enqueueing on creation
- **WHEN** the user creates an Audio Edition in CreateAudioEditionDialog with "Add to Queue" checked
- **THEN** the Audio Edition is placed into the user's active Queue upon generation completion
- **AND** appears in Queue listings with scheduled audio priority

#### Scenario: Enqueueing from Audiobooks tab
- **WHEN** the user opens the context menu on a ready Audio Edition in the Audiobooks tab and selects "Add to Queue"
- **THEN** the item is added to the Queue
- **AND** a feedback toast confirms the item was added to the Queue

### Requirement: Audio Editions presented in Queue listings

In Queue list views, items representing Audio Editions SHALL display audio-specific visual indicators (headphones icon, audio duration in minutes/hours, and listening progress) and offer audio-first primary actions.

#### Scenario: Queue item rendering for Audio Edition
- **WHEN** a queued item has a ready Audio Edition
- **THEN** the row displays a headphones icon and indicates it is an Audio Edition
- **AND** shows the percentage of audio listened and total duration

#### Scenario: Primary action on Audio Edition queue item
- **WHEN** the user clicks the primary action button ("Listen") on an Audio Edition queue item
- **THEN** the system launches the Audio Edition player in listening mode
- **AND** automatically resumes from the user's last saved listening position

### Requirement: In-stream Audio Edition consumption in Queue Scroll Mode

When the user reviews their Queue in Scroll Mode, queued Audio Editions SHALL be presented as full interactive audio players directly within the scroll feed.

#### Scenario: Encountering an Audio Edition in Scroll Mode
- **WHEN** the user scrolls to an Audio Edition item in Queue Scroll Mode
- **THEN** the view renders the audiobook/edition player with playback controls, progress slider, and chapter list
- **AND** restores the user's saved section and timestamp without starting over at section 0

#### Scenario: Completing an Audio Edition in Scroll Mode
- **WHEN** playback of an Audio Edition reaches the end of the final section in Scroll Mode
- **THEN** the item is marked as completed or advanced
- **AND** if auto-proceed is enabled, Scroll Mode advances to the next queue item
