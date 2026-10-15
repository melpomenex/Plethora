## Purpose

Coordinates real-time audio playback synchronization with the reading viewport, visual karaoke sentence highlighting, hotkey navigation, and DAQE queue scheduling hooks.

## ADDED Requirements

### Requirement: Karaoke-Style Visual Reading Synchronization
The system SHALL synchronize audio playback with the reading UI in real time. As audio for each sentence plays, the reading viewport SHALL apply visual highlighting to the active sentence using character offsets provided by the segmenter, and SHALL smoothly auto-scroll the document to maintain the spoken text within the central reading zone.

#### Scenario: Visual highlight follows spoken sentence
- **WHEN** audio for sentence $K$ begins playing
- **THEN** the reader viewport SHALL highlight sentence $K$, remove highlight from sentence $K-1$, and keep the active text clearly visible

#### Scenario: Auto-scrolling reader viewport during playback
- **WHEN** audio playback advances to a sentence located below the current visible viewport boundary
- **THEN** the system SHALL smoothly scroll the reading panel so that the active sentence is centered in the comfortable reading area

#### Scenario: Manual user scroll pauses auto-scroll lock
- **WHEN** the user manually scrolls the viewport away from the active sentence while audio continues playing
- **THEN** the system SHALL temporarily suspend auto-scrolling until the user resumes following or the next paragraph boundary is reached

### Requirement: Audio Incremental Reading Hotkey Controls
The system SHALL provide dedicated global and contextual hotkeys during active study reading: `Space` for play/pause, `J` to jump forward by one sentence, `K` to jump backward by one sentence, `[` to decrease playback speed (down to 0.75x in 0.1x steps), `]` to increase playback speed (up to 2.5x in 0.1x steps), and `E` to immediately generate an incremental reading extract from the current spoken sentence.

#### Scenario: Play and pause toggle with Spacebar
- **WHEN** the user presses the `Space` key while focused on a reading item
- **THEN** active audio playback SHALL immediately toggle between playing and paused states without losing the current sentence cursor

#### Scenario: Jump sentence forward and backward
- **WHEN** the user presses `J` or `K` during playback
- **THEN** the player SHALL skip directly to the start of the next or preceding sentence respectively and resume audio playback immediately

#### Scenario: Rapid extract creation from spoken audio
- **WHEN** the user hears a valuable insight and presses `E`
- **THEN** the system SHALL capture the text corresponding to the current active sentence, create a new child extract in Plethora, and display a confirmation toast

#### Scenario: Dynamic playback speed adjustment
- **WHEN** the user presses `]` or `[`
- **THEN** the audio playback speed SHALL increase or decrease accordingly, updating the audio rate in real time without pitching distortion

### Requirement: DAQE Queue State and Cognitive Weight Synchronization
The system SHALL report audio study progress events to Plethora's Dynamic Adaptive Queue Engine (DAQE). When audio playback completes for an incremental reading extract or flashcard, the system SHALL update the item's review status, record cognitive consumption metrics, update spaced repetition intervals, and optionally advance to the next queue item.

#### Scenario: Extract marked consumed on complete playback
- **WHEN** audio playback finishes the final sentence of an extract
- **THEN** the system SHALL mark the extract item as read in the DAQE database and record the elapsed listening duration

#### Scenario: Queue auto-advance on completion
- **WHEN** auto-advance is enabled in queue settings and audio for the current item reaches completion
- **THEN** the system SHALL seamlessly load the next scheduled queue item and initiate audio playback according to user preference
