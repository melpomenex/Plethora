## ADDED Requirements

### Requirement: Dedicated Audiobook View
The system SHALL provide a dedicated workspace tab/view in the main application layout for audiobooks, which is accessible via the main sidebar.

#### Scenario: Opening the Audiobooks workspace
- **WHEN** the user clicks the "Audiobooks" item in the sidebar
- **THEN** the system SHALL switch active workspace tabs to display the Audiobooks page

### Requirement: Audiobook Library Grid and Filters
The system SHALL display all imported audiobooks in a responsive cover art grid view. The system MUST support filtering by playback status (Not Started, In Progress, Finished, DNF) and sorting by Date Added, Title, Author, and Duration.

#### Scenario: Filtering library by Finished status
- **WHEN** the user selects the "Finished" filter option in the toolbar
- **THEN** the system SHALL render only the audiobook cards that have a progress percentage of 100%

### Requirement: Advanced Audiobook Player UI
The system SHALL display the premium player interface when an audiobook is selected. This player MUST support layout adaptation for both mobile and desktop screens, displaying cover art, visualizer, chapter lists, and visual progress indicators.

#### Scenario: Opening a book from the library
- **WHEN** the user clicks an audiobook card in the bookshelf grid
- **THEN** the system SHALL load the audiobook file and launch the Audiobook Player interface showing metadata and chapter list

### Requirement: Premium Sleep Timer
The system SHALL support setting a sleep timer with preset duration options (5m, 15m, 30m, 45m, 60m, or End of Chapter). When the timer expires, the system SHALL gradually fade out the audio volume over 5 seconds before pausing playback.

#### Scenario: Setting sleep timer to End of Chapter
- **WHEN** the user selects the "End of Chapter" sleep timer preset
- **THEN** the system SHALL monitor progress and pause playback precisely when the audio reaches the end timestamp of the currently active chapter

### Requirement: Playback Speed Slider
The system SHALL provide a fine-grained playback speed control slider, allowing adjustments from 0.5x to 3.0x speed in increments of 0.05x.

#### Scenario: Adjusting playback speed
- **WHEN** the user drags the speed slider to 1.75x
- **THEN** the system SHALL set the audio playback rate to 1.75 and persist this speed preference for subsequent playback sessions

### Requirement: Smart Silence Skipping and Volume Boost
The system SHALL support an optional smart silence skipping mode that dynamically detects and skips silent intervals, and a volume boost mode that amplifies voice frequencies for enhanced clarity.

#### Scenario: Enabling silence skipping
- **WHEN** the user toggles the silence skipping switch on
- **THEN** the system SHALL continuously monitor the audio signal level and advance the playback position past silent segments (audio level below threshold for more than 500ms)

### Requirement: Timestamped Bookmarks
The system SHALL allow users to create bookmarks at the current playback position. Bookmarks SHALL support custom text notes. Clicking a bookmark MUST instantly seek the playback to the corresponding timestamp.

#### Scenario: Creating a custom bookmark
- **WHEN** the user clicks the "Add Bookmark" button, enters the text note "Key definition", and clicks save
- **THEN** the system SHALL save the bookmark with the current timestamp and display it in the Bookmarks panel

### Requirement: System Media Session Integration
The system SHALL synchronize the active audiobook's metadata (title, author, cover art) and playback state (playing, paused, elapsed time) with the Web Media Session API to allow control via system lock screen, notifications, and hardware keys.

#### Scenario: Pressing hardware play/pause key
- **WHEN** the user presses the system play/pause hardware key while the app is in the background
- **THEN** the system SHALL toggle the play/pause state of the active audiobook player
